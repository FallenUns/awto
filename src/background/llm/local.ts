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
  const body = {
    model: opts.ollamaModel,
    stream: false,
    format: getOutputJsonSchema(),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(profile, fields) },
    ],
    options: { temperature: 0 },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new LocalLLMError(
      `Failed to reach Ollama at ${opts.ollamaUrl}: ${stringifyError(err)}`,
      err
    );
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

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}
