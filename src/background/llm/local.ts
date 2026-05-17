import { LLMResponseSchema, type LLMResponse } from "@/shared/mapping";
import type { Profile } from "@/shared/profile";
import type { ScannedField } from "@/shared/messages";
import { SYSTEM_PROMPT, buildUserPrompt, getOutputJsonSchema } from "./prompt";

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
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${trimmed}${path}`;
}

export async function callLocal(
  profile: Profile,
  fields: ScannedField[],
  opts: LocalCallOpts
): Promise<LLMResponse> {
  const url = joinUrl(opts.ollamaUrl, "/api/chat");
  const timeoutMs = opts.timeoutMs ?? 30000;
  const body = {
    model: opts.ollamaModel,
    stream: false,
    format: getOutputJsonSchema(),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(profile, fields, opts.claimedKeys) },
    ],
    options: { temperature: 0 },
  };

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

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new LocalLLMError(
      `Ollama message.content was not valid JSON: ${stringifyError(err)}`,
      err
    );
  }

  const result = LLMResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new LocalLLMError(
      `Ollama output failed schema validation: ${result.error.message}`,
      result.error
    );
  }

  return result.data;
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
