import type { FieldMapping } from "@/shared/mapping";
import type { ScannedField } from "@/shared/messages";

export function sanitizeMappings(
  fields: ScannedField[],
  mappings: FieldMapping[]
): FieldMapping[] {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));

  return mappings.map((mapping) => {
    if (mapping.actionType !== "fill" || mapping.profileKey !== "dateOfBirth") {
      return mapping;
    }

    const field = fieldsById.get(mapping.fieldId);
    if (!field || isBirthField(field)) return mapping;

    return {
      fieldId: mapping.fieldId,
      actionType: "missing",
      profileKey: null,
      suggestedKey: suggestedKey(field),
      promptText: promptText(field),
      reason: null,
      confidence: 1,
    };
  });
}

function isBirthField(field: ScannedField): boolean {
  return /\b(date\s*of\s*birth|birth\s*date|dob|birthday)\b/.test(
    fieldSignal(field)
  );
}

function suggestedKey(field: ScannedField): string {
  const words = wordsFromField(field);
  if (words.length === 0) return "unknownField";
  return words
    .map((word, index) =>
      index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`
    )
    .join("");
}

function promptText(field: ScannedField): string {
  const label = humanLabel(field);
  return `What's your ${label}?`;
}

function humanLabel(field: ScannedField): string {
  const visible = normalizeSpaces(field.label || field.placeholder || "");
  if (visible) return visible.charAt(0).toLowerCase() + visible.slice(1);
  const words = wordsFromField(field);
  return words.length > 0 ? words.join(" ") : "answer for this field";
}

function wordsFromField(field: ScannedField): string[] {
  return fieldSignal(field)
    .split(" ")
    .filter((word) => /^[a-z0-9]+$/.test(word));
}

function fieldSignal(field: ScannedField): string {
  const visible = normalizeSignal([field.label, field.placeholder ?? ""].join(" "));
  return visible || normalizeSignal(selectorHint(field.selector));
}

function selectorHint(selector: string): string {
  const attrMatch = selector.match(/\[(?:name|data-testid)="([^"]+)"\]/);
  if (attrMatch?.[1]) return attrMatch[1];
  if (selector.startsWith("#")) return selector.slice(1);
  return "";
}

function normalizeSignal(value: string): string {
  return normalizeSpaces(
    value
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[-_./:[\]"'=#>]+/g, " ")
      .toLowerCase()
  );
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
