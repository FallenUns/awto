import Anthropic from "@anthropic-ai/sdk";
import { LLMResponseSchema, type LLMResponse } from "@/shared/mapping";
import type { Profile } from "@/shared/profile";
import type { ScannedField } from "@/shared/messages";
import { SYSTEM_PROMPT, buildUserPrompt, getOutputJsonSchema } from "./prompt";

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
  signal?: AbortSignal;
  claimedKeys?: string[];
}

const TOOL_NAME = "submit_mapping";

export async function callCloud(
  profile: Profile,
  fields: ScannedField[],
  opts: CloudCallOpts
): Promise<LLMResponse> {
  if (!opts.anthropicApiKey) {
    throw new CloudLLMError("Anthropic API key is not configured");
  }

  const client = new Anthropic({
    apiKey: opts.anthropicApiKey,
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
            content: buildUserPrompt(profile, fields, opts.claimedKeys),
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
