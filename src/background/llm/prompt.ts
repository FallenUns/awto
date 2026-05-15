import { zodToJsonSchema } from "zod-to-json-schema";
import { LLMResponseSchema } from "@/shared/mapping";
import { profileKeys, getProfileValue, type Profile } from "@/shared/profile";
import type { ScannedField } from "@/shared/messages";

export const SYSTEM_PROMPT = `You are a form-field mapping assistant. Your job is to map web form fields to keys in the user's saved profile so the user can autofill the form.

For every field in the input, choose exactly one action:

- "fill": you are confident this field corresponds to a known profile key. Set "profileKey" to the matching key (which MUST be one of the keys listed as available in the user's profile). Set "suggestedKey", "promptText", and "reason" to null.
- "missing": the field is something the user could reasonably answer but the value is not in the profile (e.g. Medicare number, LinkedIn URL, referee name). Set "suggestedKey" to a short camelCase key under which the new value should be saved, and "promptText" to a clear human-readable question asking the user for the value. Set "profileKey" and "reason" to null.
- "skip": the field is not user-fillable or not safe to fill (e.g. CAPTCHA, file upload, "I am not a robot", honeypot, search boxes, hidden fields). Set "reason" to a short explanation. Set "profileKey", "suggestedKey", and "promptText" to null.

For each mapping include a "confidence" score in [0, 1] reflecting how sure you are. Be conservative: if a label is ambiguous, prefer "missing" or a lower confidence over a wrong "fill". Wrong values on tax, insurance, or government forms can be irreversible.

Rules:
- "profileKey" MUST be one of the profile keys listed in the user prompt. Never invent profile keys for "fill".
- Use the profile VALUES as semantic hints (e.g. an email-looking value matches an <input type="email">).
- Output ONLY the JSON object that matches the provided schema. No prose. No markdown. No code fences.`;

export function buildUserPrompt(
  profile: Profile,
  fields: ScannedField[]
): string {
  const keys = profileKeys(profile);
  const profileLines = keys.map((key) => {
    const value = getProfileValue(profile, key);
    return `- ${key}: ${value ?? ""}`;
  });
  const profileSection =
    keys.length > 0
      ? `Available profile keys (with values):\n${profileLines.join("\n")}`
      : "Available profile keys (with values):\n(profile is empty)";

  const fieldLines = fields.map((field) => {
    const parts = [
      `Field ${field.id}:`,
      `label="${field.label}"`,
      `placeholder="${field.placeholder ?? ""}"`,
      `type="${field.type}"`,
      `required=${field.required}`,
    ];
    if (field.options && field.options.length > 0) {
      parts.push(`options=[${field.options.join(", ")}]`);
    }
    return parts.join(" ");
  });
  const fieldSection =
    fields.length > 0
      ? `Form fields:\n${fieldLines.join("\n")}`
      : "Form fields:\n(no fields)";

  return `${profileSection}\n\n${fieldSection}\n\nReturn a single JSON object with a "mappings" array — one entry per field — strictly matching the provided JSON schema.`;
}

export function getOutputJsonSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(LLMResponseSchema, {
    name: "LLMResponse",
    target: "openApi3",
  }) as Record<string, unknown>;

  // zodToJsonSchema with `name` wraps the schema under definitions.<name>.
  // Inline it so the top-level object is the actual response schema, since
  // Anthropic's input_schema and Ollama's format both want a flat object
  // with `type: "object"` and `properties` at the top level.
  const definitions =
    (schema.definitions as Record<string, Record<string, unknown>> | undefined) ??
    (schema.components as { schemas?: Record<string, Record<string, unknown>> } | undefined)
      ?.schemas;
  if (definitions && definitions["LLMResponse"]) {
    return definitions["LLMResponse"] as Record<string, unknown>;
  }
  return schema;
}
