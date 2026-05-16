import { zodToJsonSchema } from "zod-to-json-schema";
import { LLMResponseSchema } from "@/shared/mapping";
import { profileKeys, getProfileValue, type Profile } from "@/shared/profile";
import type { ScannedField } from "@/shared/messages";

export const SYSTEM_PROMPT = `You are a form-field mapping assistant. Your job is to map web form fields to keys in the user's saved profile so the user can autofill the form.

For every field, choose exactly one action:

- "fill": you are confident this field corresponds to a known profile key. Set "profileKey" to the matching key (which MUST be one of the keys listed as available in the user's profile). Set "suggestedKey", "promptText", and "reason" to null.
- "missing": the field is something the user could reasonably answer but the value is not in the profile (e.g. Medicare number, LinkedIn URL, referee name). Set "suggestedKey" to a short camelCase key under which the new value should be saved, and "promptText" to a clear human-readable question asking the user for the value. Set "profileKey" and "reason" to null.
- "skip": the field is not user-fillable or not safe to fill (CAPTCHA, file upload, "I am not a robot", honeypot, search box, hidden field, OR an input type you cannot confidently produce a correct value for). Set "reason" to a short explanation. Set "profileKey", "suggestedKey", and "promptText" to null.

For each mapping include a "confidence" score in [0, 1]. Be conservative: wrong values on tax, insurance, or government forms can be irreversible.

Per-type rules:

- type="checkbox": only "fill" if the profile contains a clear boolean answer for this question (e.g. an "agreeToTerms" custom field). The value must be the string "true" or "false". Otherwise "skip" with reason "Checkbox — fill manually".
- type="radio": only "fill" if you can find a radio option that matches a profile value. The value MUST be copied verbatim from the radio group's options. Otherwise "skip".
- type="select": the value MUST be copied verbatim from the field's "options" list. Do not paraphrase or abbreviate ("VIC" is wrong if options are ["Victoria", ...] — use "Victoria"). If no option matches a profile value, prefer "missing" or "skip" with a lower confidence.
- type="time": the value must be HH:MM in 24-hour format. If no time-typed profile value is available, "skip".
- type="date": the value must be YYYY-MM-DD. profile.dateOfBirth already uses this format.
- Never map profile.dateOfBirth to delivery, pickup, appointment, availability, or preferred-time fields. If the form asks for a delivery/pickup/appointment/preferred time/date and no matching profile key exists, use "missing" or "skip".
- type="email": map to profile.email or profile.secondaryEmail.
- type="tel" or labels mentioning "Phone", "Phone number", "Telephone", "Mobile", "Cell", "Tel": map to profile.phone or profile.mobilePhone.
- type="url": map to profile.website, profile.linkedIn, or profile.github based on label.

When forced to fuzzy-match an enum (e.g. a select with no exact option for the profile value), lower confidence to 0.6–0.8 so the user knows to verify.

Do not put the same value into two semantically different fields. If "Street address" and "City" both look like they could take an address, do NOT use the same profile value for both — pick the most specific match for each, or "skip" the less-specific one.

Common label synonyms to map to a single profile key:
- "First name" / "Given name" / "Forename" → profile.firstName
- "Last name" / "Family name" / "Surname" → profile.lastName
- "Phone" / "Phone number" / "Telephone" / "Mobile" / "Cell" / "Tel" → profile.phone or profile.mobilePhone
- "Postcode" / "Zip" / "Zip code" / "Postal code" → profile.postcode
- "Suburb" / "City" / "Town" / "Locality" → profile.suburb or profile.city (whichever you populated)

When the form has a single name-style field labeled "Name", "Full name", "Customer name", "Your name", or similar, map to "fullName" (the firstName + lastName composite) — do NOT use firstName alone.

For street address fields: if the form has a SEPARATE field labeled "Unit", "Apt", "Apartment", "Suite", "#", or has autocomplete="address-line2", map that field to "unitNumber". If the form has only ONE street-address field and the profile has unitNumber set, use "addressLine1WithUnit" (the composed "unit/street" string) — do NOT use just "addressLine1" alone in that case.

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

  const first = profile.firstName?.trim();
  const last = profile.lastName?.trim();
  if (first && last) {
    profileLines.push(
      `- fullName: ${first} ${last}    (computed; use for single name-style form fields)`
    );
  }

  const unit = profile.unitNumber?.trim();
  const line1 = profile.addressLine1?.trim();
  if (unit && line1) {
    profileLines.push(
      `- addressLine1WithUnit: ${unit}/${line1}    (computed; use for single street-address fields when the form has no separate unit/apt input)`
    );
  }

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
