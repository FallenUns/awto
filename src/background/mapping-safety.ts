import type { FieldMapping } from "@/shared/mapping";
import type { ScannedField } from "@/shared/messages";

type Decision =
  | { kind: "allow" }
  | { kind: "skip"; reason: string }
  | { kind: "missing"; suggestedKey: string; promptText: string };

interface IntentRule {
  patterns: RegExp[];
  allow?: string[];
  skipReason?: string;
  suggestedKey?: string;
}

const INTENT_RULES: IntentRule[] = [
  {
    patterns: [/\b(password|passcode|pin)\b/],
    skipReason: "Sensitive credential — fill manually",
  },
  {
    patterns: [/\bcredit\s*card\b/, /\bcard\s*(number|verification|expiration|expiry|issuing|bank|customer\s*service|type|user\s*name)\b/, /\bcvv\b/, /\bcvc\b/, /\bccv\b/],
    skipReason: "Payment field — fill manually",
  },
  {
    patterns: [/\bsocial\s*security\b/, /\bssn\b/],
    skipReason: "Sensitive government identifier — fill manually",
  },
  {
    patterns: [/\bfax\b/],
    skipReason: "Fax number not in profile",
  },
  {
    patterns: [/\b(delivery|pickup|appointment|booking)\b.*\b(time|date)\b/, /\bpreferred\s*time\b/],
    allow: ["preferredDeliveryTime", "deliveryTime", "preferredPickupTime", "appointmentTime"],
    suggestedKey: "preferredDeliveryTime",
  },
  {
    patterns: [/\bmiddle\s*initial\b/],
    suggestedKey: "middleInitial",
  },
  {
    patterns: [/\buser\s*id\b/, /\buser\s*name\b/, /\blogin\b/],
    allow: ["userId", "username"],
    suggestedKey: "userId",
  },
  {
    patterns: [/\bage\b/],
    allow: ["age"],
    suggestedKey: "age",
  },
  {
    patterns: [/\bbirth\s*place\b/, /\bplace\s*of\s*birth\b/],
    suggestedKey: "birthPlace",
  },
  {
    patterns: [/\bincome\b/, /\bsalary\b/],
    suggestedKey: "income",
  },
  {
    patterns: [/\bcustom\s*message\b/, /\bcomments?\b/, /\bnotes?\b/],
    suggestedKey: "comments",
  },
  { patterns: [/\btitle\b/, /\bhonou?rific\b/, /\bsalutation\b/], allow: ["title"] },
  { patterns: [/\bfirst\s*name\b/, /\bgiven\s*name\b/, /\bforename\b/], allow: ["firstName"] },
  { patterns: [/\bmiddle\s*name\b/], allow: ["middleName"] },
  { patterns: [/\blast\s*name\b/, /\bfamily\s*name\b/, /\bsurname\b/], allow: ["lastName"] },
  { patterns: [/\bfull\s*name\b/, /\byour\s*name\b/, /\bcustomer\s*name\b/], allow: ["fullName"] },
  { patterns: [/\bcompany\b/, /\bemployer\b/], allow: ["currentEmployer"] },
  { patterns: [/\bposition\b/, /\bjob\s*title\b/], allow: ["jobTitle"] },
  { patterns: [/\baddress\s*line\s*1\b/, /\bstreet\s*address\b/], allow: ["addressLine1"] },
  { patterns: [/\baddress\s*line\s*2\b/, /\bapt\b/, /\bapartment\b/, /\bunit\b/, /\bsuite\b/], allow: ["addressLine2"] },
  { patterns: [/\bcity\b/, /\btown\b/, /\blocality\b/], allow: ["city", "suburb"] },
  { patterns: [/\bstate\b/, /\bprovince\b/, /\bregion\b/], allow: ["state"] },
  { patterns: [/\bcountry\b/], allow: ["country"] },
  { patterns: [/\bzip\b/, /\bpost\s*code\b/, /\bpostcode\b/, /\bpostal\s*code\b/], allow: ["postcode"] },
  { patterns: [/\bcell\s*phone\b/, /\bmobile\b/, /\bcell\b/], allow: ["mobilePhone", "phone"] },
  { patterns: [/\b(home\s*)?phone\b/, /\btelephone\b/, /\btel\b/], allow: ["phone", "mobilePhone"] },
  { patterns: [/\be\s*mail\b/, /\bemail\b/], allow: ["email", "secondaryEmail"], suggestedKey: "email" },
  { patterns: [/\bweb\s*site\b/, /\bwebsite\b/, /\burl\b/], allow: ["website", "linkedIn", "github"] },
  { patterns: [/\bsex\b/, /\bgender\b/], allow: ["gender"] },
  { patterns: [/\bdriver\s*licen[cs]e\b/], allow: ["driverLicense"] },
  { patterns: [/\bdate\s*of\s*birth\b/, /\bbirth\s*date\b/, /\bdob\b/, /\bbirthday\b/], allow: ["dateOfBirth"] },
];

export function sanitizeMappings(
  fields: ScannedField[],
  mappings: FieldMapping[]
): FieldMapping[] {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));

  return mappings.map((mapping) => {
    if (mapping.actionType !== "fill" || !mapping.profileKey) {
      return mapping;
    }

    const field = fieldsById.get(mapping.fieldId);
    if (!field) return mapping;

    const decision = decide(field, mapping.profileKey);
    if (decision.kind === "allow") return mapping;
    if (decision.kind === "skip") return makeSkip(mapping.fieldId, decision.reason);
    return makeMissing(mapping.fieldId, decision.suggestedKey, decision.promptText);
  });
}

function decide(field: ScannedField, profileKey: string): Decision {
  if (field.type === "password") {
    return { kind: "skip", reason: "Sensitive credential — fill manually" };
  }

  const signal = fieldSignal(field);
  if (!signal) return { kind: "allow" };

  for (const rule of INTENT_RULES) {
    if (!rule.patterns.some((pattern) => pattern.test(signal))) continue;
    if (rule.skipReason) return { kind: "skip", reason: rule.skipReason };
    if (rule.allow?.includes(profileKey)) return { kind: "allow" };

    const key = rule.suggestedKey ?? suggestedKey(field);
    return {
      kind: "missing",
      suggestedKey: key,
      promptText: promptText(field, key),
    };
  }

  if (profileKey === "dateOfBirth") {
    return {
      kind: "missing",
      suggestedKey: suggestedKey(field),
      promptText: promptText(field),
    };
  }

  return { kind: "allow" };
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

function promptText(field: ScannedField, fallbackKey?: string): string {
  const label = humanLabel(field);
  if (label !== "answer for this field") return `What's your ${label}?`;
  return `What's your ${fallbackKey ?? "answer for this field"}?`;
}

function makeSkip(fieldId: number, reason: string): FieldMapping {
  return {
    fieldId,
    actionType: "skip",
    profileKey: null,
    suggestedKey: null,
    promptText: null,
    reason,
    confidence: 1,
  };
}

function makeMissing(
  fieldId: number,
  key: string,
  prompt: string
): FieldMapping {
  return {
    fieldId,
    actionType: "missing",
    profileKey: null,
    suggestedKey: key,
    promptText: prompt,
    reason: null,
    confidence: 1,
  };
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
