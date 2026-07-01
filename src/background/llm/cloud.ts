import Anthropic from "@anthropic-ai/sdk";
import { LLMResponseSchema, type LLMResponse } from "@/shared/mapping";
import type { Profile } from "@/shared/profile";
import type { ScannedField } from "@/shared/messages";
import { SYSTEM_PROMPT, buildUserPrompt, getOutputJsonSchema } from "./prompt";
import type { PromptPageContext } from "@/shared/page-context";

export class CloudLLMError extends Error {
  override readonly name = "CloudLLMError";
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

export interface CloudCallOpts {
  anthropicApiKey: string;
  anthropicModel: string;
  cloudProvider?: string;
  cloudApiKeys?: Record<string, string>;
  cloudModels?: Record<string, string>;
  cloudBaseUrl?: string;
  signal?: AbortSignal;
  claimedKeys?: string[];
  pageContext?: PromptPageContext;
}

// OpenAI-compatible chat-completions base URLs. "custom" uses opts.cloudBaseUrl.
const OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  openrouter: "https://openrouter.ai/api/v1",
};

export type ResolvedCloud =
  | { kind: "anthropic"; key: string; model: string }
  | { kind: "openai"; key: string; model: string; baseUrl: string };

export function resolveCloud(opts: CloudCallOpts): ResolvedCloud {
  const provider = opts.cloudProvider ?? "anthropic";
  if (provider === "anthropic") {
    return { kind: "anthropic", key: opts.anthropicApiKey, model: opts.anthropicModel };
  }
  const baseUrl =
    provider === "custom"
      ? (opts.cloudBaseUrl ?? "").replace(/\/+$/, "")
      : OPENAI_COMPATIBLE_BASE_URLS[provider] ?? "";
  return {
    kind: "openai",
    key: opts.cloudApiKeys?.[provider] ?? "",
    model: opts.cloudModels?.[provider] ?? "",
    baseUrl,
  };
}

const TOOL_NAME = "submit_mapping";

export async function callCloud(
  profile: Profile,
  fields: ScannedField[],
  opts: CloudCallOpts
): Promise<LLMResponse> {
  const resolved = resolveCloud(opts);
  if (resolved.kind === "openai") {
    return callOpenAICompatible(profile, fields, opts, resolved);
  }

  if (!resolved.key) {
    throw new CloudLLMError("Anthropic API key is not configured");
  }

  const client = new Anthropic({
    apiKey: resolved.key,
    dangerouslyAllowBrowser: true,
  });

  const inputSchema = getOutputJsonSchema() as Record<string, unknown> & {
    type?: string;
  };

  let response: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    response = await client.messages.create(
      {
        model: opts.anthropicModel,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildUserPrompt(profile, fields, opts.claimedKeys, opts.pageContext),
          },
        ],
        tools: [
          {
            name: TOOL_NAME,
            description:
              "Submit the field-to-profile mapping for the form on the page.",
            input_schema: inputSchema as never,
          },
        ],
        tool_choice: { type: "tool", name: TOOL_NAME },
      },
      opts.signal ? { signal: opts.signal } : undefined
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new CloudLLMError(
      `Anthropic API request failed: ${redact(stringifyError(err), opts.anthropicApiKey)}`,
      err
    );
  }

  const toolUse = extractToolUse(response, TOOL_NAME);
  if (!toolUse) {
    throw new CloudLLMError(
      "Anthropic response did not include the submit_mapping tool use (model may have refused)"
    );
  }

  const parsed = LLMResponseSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new CloudLLMError(
      `Anthropic tool input failed schema validation: ${parsed.error.message}`,
      parsed.error
    );
  }
  return parsed.data;
}

interface ToolUseLike {
  type: "tool_use";
  name: string;
  input: unknown;
}

function extractToolUse(
  response: unknown,
  toolName: string
): ToolUseLike | null {
  if (!response || typeof response !== "object") return null;
  const content = (response as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "tool_use" &&
      (block as { name?: unknown }).name === toolName
    ) {
      return block as ToolUseLike;
    }
  }
  return null;
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function redact(message: string, apiKey: string): string {
  if (!apiKey) return message;
  return message.split(apiKey).join("***");
}

async function callOpenAICompatible(
  profile: Profile,
  fields: ScannedField[],
  opts: CloudCallOpts,
  resolved: Extract<ResolvedCloud, { kind: "openai" }>
): Promise<LLMResponse> {
  const { key, model, baseUrl } = resolved;
  if (!baseUrl) throw new CloudLLMError("Custom provider base URL is not configured");
  if (!key) throw new CloudLLMError("Cloud API key is not configured");
  if (!model) throw new CloudLLMError("Cloud model is not configured");

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: buildUserPrompt(profile, fields, opts.claimedKeys, opts.pageContext),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "LLMResponse", schema: getOutputJsonSchema() },
        },
      }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new CloudLLMError(`Cloud API request failed: ${redact(stringifyError(err), key)}`, err);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new CloudLLMError(
      `Cloud API returned ${res.status}: ${redact(body.slice(0, 500), key)}`
    );
  }

  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string; refusal?: string } }[];
  } | null;
  const message = data?.choices?.[0]?.message;
  if (message?.refusal) {
    throw new CloudLLMError(`Cloud model refused: ${message.refusal}`);
  }
  const content = message?.content;
  if (!content) {
    throw new CloudLLMError("Cloud response did not include any content");
  }

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (err) {
    throw new CloudLLMError(`Cloud response was not valid JSON: ${stringifyError(err)}`, err);
  }
  const parsed = LLMResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new CloudLLMError(
      `Cloud response failed schema validation: ${parsed.error.message}`,
      parsed.error
    );
  }
  return parsed.data;
}
