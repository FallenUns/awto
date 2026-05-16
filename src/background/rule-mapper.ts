import type { FieldMapping } from "@/shared/mapping";
import { getProfileValue, type Profile } from "@/shared/profile";
import type { ScannedField } from "@/shared/messages";

const TOKEN_TO_KEY: Record<string, string | null> = {
  "name": "fullName",
  "given-name": "firstName",
  "additional-name": "middleName",
  "family-name": "lastName",
  "honorific-prefix": "title",
  "nickname": "preferredName",
  "email": "email",
  "tel": "phone",
  "tel-national": "phone",
  "mobile": "mobilePhone",
  "street-address": "addressLine1",
  "address-line1": "addressLine1",
  "address-line2": "addressLine2",
  "address-level1": "state",
  "address-level2": "city",
  "postal-code": "postcode",
  "country": "country",
  "country-name": "country",
  "bday": "dateOfBirth",
  "organization": "currentEmployer",
  "organization-title": "jobTitle",
  "url": "website",
  "cc-name": null,
  "cc-number": null,
  "cc-csc": null,
  "cc-exp": null,
  "cc-exp-month": null,
  "cc-exp-year": null,
  "current-password": null,
  "new-password": null,
  "one-time-code": null,
};

type KeyChoice = string | string[];

interface LabelRule {
  key: KeyChoice;
  patterns: RegExp[];
}

const LABEL_RULES: LabelRule[] = [
  { key: "title", patterns: [/\b(title|honou?rific|salutation)\b/] },
  { key: "firstName", patterns: [/\b(first|given|forename)\s*name\b/, /\bgiven\b/] },
  { key: "middleName", patterns: [/\b(middle|additional)\s*name\b/] },
  { key: "lastName", patterns: [/\b(last|family|sur)\s*name\b/, /\bsurname\b/] },
  { key: "preferredName", patterns: [/\bpreferred\s*name\b/, /\bnickname\b/] },
  { key: "fullName", patterns: [/\b(full|your|customer|applicant|contact)\s*name\b/, /^name$/] },
  { key: "pronouns", patterns: [/\bpronouns?\b/] },
  { key: "gender", patterns: [/\bgender\b/] },
  { key: "dateOfBirth", patterns: [/\bdate\s*of\s*birth\b/, /\bbirth\s*date\b/, /\bdob\b/] },
  { key: "secondaryEmail", patterns: [/\b(secondary|alternate|alternative)\s*e-?mail\b/] },
  { key: "email", patterns: [/\be-?mail\b/] },
  { key: ["mobilePhone", "phone"], patterns: [/\b(mobile|cell)\b/] },
  { key: ["phone", "mobilePhone"], patterns: [/\b(phone|telephone|tel)\b/] },
  { key: "addressLine2", patterns: [/\b(address|street)?\s*line\s*2\b/, /\bapt\b/, /\bapartment\b/, /\bunit\b/, /\bsuite\b/] },
  { key: "addressLine1", patterns: [/\bstreet\s*address\b/, /\b(address|street)?\s*line\s*1\b/, /^address$/] },
  { key: "suburb", patterns: [/\bsuburb\b/] },
  { key: "city", patterns: [/\bcity\b/, /\btown\b/, /\blocality\b/] },
  { key: "state", patterns: [/\bstate\b/, /\bprovince\b/, /\bregion\b/] },
  { key: "postcode", patterns: [/\bpost\s*code\b/, /\bpostcode\b/, /\bzip(\s*code)?\b/, /\bpostal\s*code\b/] },
  { key: "country", patterns: [/\bcountry\b/] },
  { key: "currentEmployer", patterns: [/\bcurrent\s*employer\b/, /\bemployer\b/, /\bcompany\b/] },
  { key: "jobTitle", patterns: [/\bjob\s*title\b/, /\bposition\s*title\b/] },
  { key: "linkedIn", patterns: [/\blinked\s*in\b/] },
  { key: "github", patterns: [/\bgithub\b/] },
  { key: "website", patterns: [/\b(personal\s*)?(website|url)\b/] },
  { key: "highestQualification", patterns: [/\b(highest\s*)?qualification\b/, /\beducation\b/] },
  { key: "university", patterns: [/\buniversity\b/, /\binstitution\b/] },
  { key: "graduationYear", patterns: [/\bgraduation\s*year\b/] },
  { key: "taxFileNumber", patterns: [/\btax\s*file\s*number\b/, /\btfn\b/] },
  { key: "medicareNumber", patterns: [/\bmedicare\b/] },
  { key: "driverLicense", patterns: [/\b(driver'?s?\s*)?licen[cs]e\b/] },
  { key: "nationality", patterns: [/\bnationality\b/] },
  { key: "workRights", patterns: [/\bwork\s*rights?\b/, /\bright\s*to\s*work\b/] },
];

export interface RuleMapResult {
  ruleMappings: FieldMapping[];
  remaining: ScannedField[];
}

function resolveValue(profile: Profile, key: string): string | undefined {
  return getProfileValue(profile, key);
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

function makeFill(fieldId: number, key: string): FieldMapping {
  return {
    fieldId,
    actionType: "fill",
    profileKey: key,
    suggestedKey: null,
    promptText: null,
    reason: null,
    confidence: 1,
  };
}

function makeMissing(fieldId: number, key: string, label: string): FieldMapping {
  const friendly = label || key;
  return {
    fieldId,
    actionType: "missing",
    profileKey: null,
    suggestedKey: key,
    promptText: `What's your ${friendly}?`,
    reason: null,
    confidence: 1,
  };
}

export function ruleMap(
  fields: ScannedField[],
  profile: Profile
): RuleMapResult {
  const ruleMappings: FieldMapping[] = [];
  const remaining: ScannedField[] = [];

  for (const field of fields) {
    const autocompleteKey = keyFromAutocomplete(field.autocomplete);
    const keyOrNull =
      autocompleteKey !== undefined ? autocompleteKey : keyFromLabel(field, profile);
    if (keyOrNull === undefined) {
      remaining.push(field);
      continue;
    }

    if (keyOrNull === null) {
      ruleMappings.push(makeSkip(field.id, "Sensitive field — won't autofill"));
      continue;
    }

    const key = keyOrNull;
    const value = resolveValue(profile, key);
    if (value !== undefined && value !== "") {
      ruleMappings.push(makeFill(field.id, key));
    } else {
      ruleMappings.push(makeMissing(field.id, key, field.label));
    }
  }

  return { ruleMappings, remaining };
}

function keyFromAutocomplete(token: string | undefined): string | null | undefined {
  if (!token) return undefined;
  return TOKEN_TO_KEY[token];
}

function keyFromLabel(
  field: ScannedField,
  profile: Profile
): string | undefined {
  const signal = fieldSignal(field);
  if (!signal) return undefined;

  for (const rule of LABEL_RULES) {
    if (!rule.patterns.some((pattern) => pattern.test(signal))) continue;
    const keys = Array.isArray(rule.key) ? rule.key : [rule.key];
    return pickBestAvailableKey(profile, keys);
  }

  return undefined;
}

function pickBestAvailableKey(profile: Profile, keys: string[]): string {
  return keys.find((key) => {
    const value = resolveValue(profile, key);
    return value !== undefined && value !== "";
  }) ?? keys[0]!;
}

function fieldSignal(field: ScannedField): string {
  const visible = [field.label, field.placeholder ?? ""].join(" ");
  const visibleSignal = normalizeSignal(visible);
  return visibleSignal || normalizeSignal(selectorHint(field.selector));
}

function selectorHint(selector: string): string {
  const attrMatch = selector.match(/\[(?:name|data-testid)="([^"]+)"\]/);
  if (attrMatch?.[1]) return attrMatch[1];
  if (selector.startsWith("#")) return selector.slice(1);
  return "";
}

function normalizeSignal(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_./:[\]"'=#>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
