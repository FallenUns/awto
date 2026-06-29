import { LLMResponseSchema, type LLMResponse } from "@/shared/mapping";
import type { Profile } from "@/shared/profile";
import type { ScannedField } from "@/shared/messages";
import { SYSTEM_PROMPT, buildUserPrompt, getOutputJsonSchema } from "./prompt";
import type { PromptPageContext } from "@/shared/page-context";

// Ollama answers only allow-listed origins. Chrome attaches a
// "chrome-extension://<id>" Origin that is rejected with 403 unless the user
// adds it to OLLAMA_ORIGINS, so a raw "HTTP 403" is surfaced as actionable help.
export const OLLAMA_ORIGINS_HELP =
  'Ollama refused the request (HTTP 403). Ollama only serves allow-listed origins, ' +
  'and Chrome sends a "chrome-extension://…" origin that is blocked by default. ' +
  'Add it to OLLAMA_ORIGINS and restart Ollama. macOS app: run ' +
  'launchctl setenv OLLAMA_ORIGINS "chrome-extension://*" then relaunch Ollama. ' +
  'CLI: OLLAMA_ORIGINS="chrome-extension://*" ollama serve';

export class LocalLLMError extends Error {
  override readonly name = "LocalLLMError";
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

export interface LocalCallOpts {
  ollamaUrl: string;
  ollamaModel: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  claimedKeys?: string[];
  pageContext?: PromptPageContext;
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${trimmed}${path}`;
}

// Small local models (e.g. llama3.2:3b) intermittently emit empty or partial
// mapping objects under structured output. On the second attempt we nudge with
// an explicit repair instruction and a non-zero temperature to break the
// deterministic bad output.
const SCHEMA_REPAIR_HINT =
  'Your previous response did not match the required JSON schema. Return ONLY a ' +
  'single JSON object with a "mappings" array — one entry per field — and every ' +
  'property present on every entry (fieldId, actionType, profileKey, suggestedKey, ' +
  "promptText, reason, confidence). No prose, no markdown.";

function malformedOutputHelp(model: string): string {
  return (
    `The local model (${model}) returned output that did not match the expected ` +
    `format, even after a retry. Try a more capable model (e.g. llama3.1:8b) in ` +
    `Options, or add an Anthropic API key to enable cloud fallback for hard forms.`
  );
}

export async function callLocal(
  profile: Profile,
  fields: ScannedField[],
  opts: LocalCallOpts
): Promise<LLMResponse> {
  const url = joinUrl(opts.ollamaUrl, "/api/chat");
  const timeoutMs = opts.timeoutMs ?? 30000;
  const format = getOutputJsonSchema();
  const baseMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: buildUserPrompt(profile, fields, opts.claimedKeys, opts.pageContext),
    },
  ];

  const MAX_ATTEMPTS = 2;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const body = {
      model: opts.ollamaModel,
      stream: false,
      format,
      messages:
        attempt === 0
          ? baseMessages
          : [...baseMessages, { role: "user", content: SCHEMA_REPAIR_HINT }],
      options: { temperature: attempt === 0 ? 0 : 0.5 },
    };

    // Transport / HTTP / abort failures throw here and propagate immediately —
    // they are not malformed output and must not be retried (so hybrid can fall
    // back to cloud). Only unparseable / schema-invalid output is retried below.
    const content = await performChat(url, body, opts, timeoutMs);

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      continue;
    }
    const result = LLMResponseSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
  }

  throw new LocalLLMError(malformedOutputHelp(opts.ollamaModel));
}

async function performChat(
  url: string,
  body: unknown,
  opts: LocalCallOpts,
  timeoutMs: number
): Promise<string> {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

  const composedSignal: AbortSignal = opts.signal
    ? anySignal([opts.signal, timeoutController.signal])
    : timeoutController.signal;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: composedSignal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      if (opts.signal?.aborted) throw err;
      if (timeoutController.signal.aborted) {
        throw new LocalLLMError(
          `Ollama call timed out after ${timeoutMs}ms`,
          err
        );
      }
    }
    throw new LocalLLMError(
      `Failed to reach Ollama at ${opts.ollamaUrl}: ${stringifyError(err)}`,
      err
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    if (res.status === 403) {
      throw new LocalLLMError(OLLAMA_ORIGINS_HELP);
    }
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    throw new LocalLLMError(
      `Ollama returned HTTP ${res.status}${detail ? `: ${truncate(detail, 200)}` : ""}`
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new LocalLLMError(
      `Ollama response was not JSON: ${stringifyError(err)}`,
      err
    );
  }

  const content = extractMessageContent(json);
  if (content === null) {
    throw new LocalLLMError("Ollama response missing message.content");
  }
  return content;
}

function extractMessageContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const message = (payload as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string") return null;
  return content;
}

export async function pingOllama(
  ollamaUrl: string,
  timeoutMs: number = 3000
): Promise<{ ok: boolean; error?: string }> {
  const url = joinUrl(ollamaUrl, "/api/version");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: stringifyError(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function listOllamaModels(
  ollamaUrl: string,
  timeoutMs: number = 3000
): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  const url = joinUrl(ollamaUrl, "/api/tags");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { models?: Array<{ name?: unknown }> };
    const models = (data.models ?? [])
      .map((m) => (typeof m.name === "string" ? m.name : null))
      .filter((n): n is string => n !== null);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: stringifyError(err) };
  } finally {
    clearTimeout(timer);
  }
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const AnyFn = (
    AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }
  ).any;
  if (typeof AnyFn === "function") {
    return AnyFn.call(AbortSignal, signals);
  }
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort((s as AbortSignal & { reason?: unknown }).reason);
      return controller.signal;
    }
    s.addEventListener(
      "abort",
      () => controller.abort((s as AbortSignal & { reason?: unknown }).reason),
      { once: true }
    );
  }
  return controller.signal;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}
