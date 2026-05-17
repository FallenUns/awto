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
  key?: KeyChoice;
  patterns: RegExp[];
  skipReason?: string;
  missingKey?: string;
  missingPrompt?: string;
}

const LABEL_RULES: LabelRule[] = [
  { patterns: [/\b(password|passcode|pin)\b/], skipReason: "Sensitive credential — fill manually" },
  { patterns: [/\bcredit\s*card\b/, /\bcard\s*(number|verification|expiration|expiry|issuing|bank|customer\s*service|type|user\s*name)\b/, /\bcvv\b/, /\bcvc\b/, /\bccv\b/], skipReason: "Payment field — fill manually" },
  { patterns: [/\bsocial\s*security\b/, /\bssn\b/], skipReason: "Sensitive government identifier — fill manually" },
  { patterns: [/\bfax\b/], skipReason: "Fax number not in profile" },
  { patterns: [/\bmiddle\s*initial\b/], missingKey: "middleInitial", missingPrompt: "What's your middle initial?" },
  { patterns: [/\buser\s*id\b/, /\buser\s*name\b/, /\blogin\b/], missingKey: "userId", missingPrompt: "What's your user ID?" },
  { patterns: [/\bbirth\s*place\b/, /\bplace\s*of\s*birth\b/], missingKey: "birthPlace", missingPrompt: "What's your birth place?" },
  { patterns: [/\bincome\b/, /\bsalary\b/], missingKey: "income", missingPrompt: "What's your income?" },
  { patterns: [/\bcustom\s*message\b/], missingKey: "customMessage", missingPrompt: "What's your custom message?" },
  { patterns: [/\bcomments?\b/, /\bnotes?\b/], missingKey: "comments", missingPrompt: "Any comments?" },
  { key: "dateOfBirthMonth", patterns: [/^month$/] },
  { key: "dateOfBirthDay", patterns: [/^day$/] },
  { key: "dateOfBirthYear", patterns: [/^year$/] },
  { key: "title", patterns: [/\b(title|honou?rific|salutation)\b/] },
  { key: "firstName", patterns: [/\b(first|given|forename)\s*name\b/, /\bgiven\b/] },
  { key: "middleName", patterns: [/\b(middle|additional)\s*name\b/] },
  { key: "lastName", patterns: [/\b(last|family|sur)\s*name\b/, /\bsurname\b/] },
  { key: "preferredName", patterns: [/\bpreferred\s*name\b/, /\bnickname\b/] },
  { key: "fullName", patterns: [/\b(full|your|customer|applicant|contact)\s*name\b/, /^name$/] },
  { key: "pronouns", patterns: [/\bpronouns?\b/] },
  { key: "gender", patterns: [/\bgender\b/, /\bsex\b/] },
  { key: "dateOfBirth", patterns: [/\bdate\s*of\s*birth\b/, /\bbirth\s*date\b/, /\bdob\b/] },
  { key: "age", patterns: [/\bage\b/] },
  { key: "secondaryEmail", patterns: [/\b(secondary|alternate|alternative)\s*e\s*mail\b/, /\b(secondary|alternate|alternative)\s*email\b/] },
  { key: "email", patterns: [/\be\s*mail\b/, /\bemail\b/] },
  { key: ["mobilePhone", "phone"], patterns: [/\b(mobile|cell)\b/] },
  { key: ["phone", "mobilePhone"], patterns: [/\b(phone|telephone|tel)\b/] },
  { key: "addressLine2", patterns: [/\b(address|street)?\s*line\s*2\b/, /\bapt\b/, /\bapartment\b/, /\bunit\b/, /\bsuite\b/] },
  { key: ["addressLine1WithUnit", "addressLine1"], patterns: [/\bstreet\s*address\b/, /\b(address|street)?\s*line\s*1\b/, /^address$/] },
  { key: "suburb", patterns: [/\bsuburb\b/] },
  { key: "city", patterns: [/\bcity\b/, /\btown\b/, /\blocality\b/] },
  { key: "state", patterns: [/\bstate\b/, /\bprovince\b/, /\bregion\b/] },
  { key: "postcode", patterns: [/\bpost\s*code\b/, /\bpostcode\b/, /\bzip(\s*code)?\b/, /\bpostal\s*code\b/] },
  { key: "country", patterns: [/\bcountry\b/] },
  { key: "currentEmployer", patterns: [/\bcurrent\s*employer\b/, /\bemployer\b/, /\bcompany\b/] },
  { key: "jobTitle", patterns: [/\bjob\s*title\b/, /\bposition\s*title\b/, /\bposition\b/] },
  { key: "linkedIn", patterns: [/\blinked\s*in\b/] },
  { key: "github", patterns: [/\bgithub\b/] },
  { key: "website", patterns: [/\b(personal\s*)?(web\s*site|website|url)\b/] },
  { key: "highestQualification", patterns: [/\b(highest\s*)?qualification\b/, /\beducation\b/] },
  { key: "university", patterns: [/\buniversity\b/, /\binstitution\b/] },
  { key: "graduationYear", patterns: [/\bgraduation\s*year\b/] },
  { key: "taxFileNumber", patterns: [/\btax\s*file\s*number\b/, /\btfn\b/] },
  { key: "medicareNumber", patterns: [/\bmedicare\b/] },
  { key: "driverLicense", patterns: [/\b(driver'?s?\s*)?licen[cs]e(\s*number)?\b/] },
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

function makeMissing(
  fieldId: number,
  key: string,
  label: string,
  promptText?: string
): FieldMapping {
  return {
    fieldId,
    actionType: "missing",
    profileKey: null,
    suggestedKey: key,
    promptText: promptText ?? phrasePrompt(label, key),
    reason: null,
    confidence: 1,
  };
}

export function phrasePrompt(label: string, fallbackKey: string): string {
  const trimmed = label.trim();
  if (!trimmed) return `What's your ${fallbackKey}?`;
  if (trimmed.endsWith("?")) return trimmed;
  if (looksLikeQuestion(trimmed)) {
    const withoutTrailingPunct = trimmed.replace(/[.:!]+$/, "");
    return `${withoutTrailingPunct}?`;
  }
  const stripped = trimmed.replace(/[:.!]+$/, "");
  return `What's your ${stripped}?`;
}

function looksLikeQuestion(text: string): boolean {
  return /^(what|where|when|why|how|who|which|to\s+what|is|are|do|does|did|can|could|should|would|will|tell|describe)\b/i.test(
    text
  );
}

function matchesAnyOption(value: string, options: string[]): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  return options.some((o) => o.trim().toLowerCase() === v);
}

export function ruleMap(
  fields: ScannedField[],
  profile: Profile
): RuleMapResult {
  const ruleMappings: FieldMapping[] = [];
  const remaining: ScannedField[] = [];
  const hasSeparateUnitOrAddressLine2 = fields.some((field) =>
    /\b(address|street)?\s*line\s*2\b|\bapt\b|\bapartment\b|\bunit\b|\bsuite\b/.test(
      fieldSignal(field)
    )
  );

  for (const field of fields) {
    if (field.type === "password") {
      ruleMappings.push(makeSkip(field.id, "Sensitive credential — fill manually"));
      continue;
    }

    const labelResult = resultFromLabel(field, profile);
    const autocompleteKey = keyFromAutocomplete(field.autocomplete);
    const keyOrNull =
      labelResult?.type === "key" ? labelResult.key : autocompleteKey;
    if (labelResult?.type === "skip") {
      ruleMappings.push(makeSkip(field.id, labelResult.reason));
      continue;
    }
    if (labelResult?.type === "missing") {
      ruleMappings.push(makeMissing(
        field.id,
        labelResult.key,
        field.label,
        labelResult.promptText
      ));
      continue;
    }
    if (keyOrNull === undefined) {
      remaining.push(field);
      continue;
    }

    if (keyOrNull === null) {
      ruleMappings.push(makeSkip(field.id, "Sensitive field — won't autofill"));
      continue;
    }

    const key =
      keyOrNull === "addressLine1WithUnit" && hasSeparateUnitOrAddressLine2
        ? "addressLine1"
        : keyOrNull;
    const value = resolveValue(profile, key);
    if (value !== undefined && value !== "") {
      if (
        field.type === "radio" &&
        field.options &&
        field.options.length > 0 &&
        !matchesAnyOption(value, field.options)
      ) {
        remaining.push(field);
        continue;
      }
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

type LabelResult =
  | { type: "key"; key: string }
  | { type: "skip"; reason: string }
  | { type: "missing"; key: string; promptText: string };

function resultFromLabel(
  field: ScannedField,
  profile: Profile
): LabelResult | undefined {
  const signal = fieldSignal(field);
  if (!signal) return undefined;

  const dobPartKey = dateOfBirthPartKey(field, signal);
  if (dobPartKey) {
    return resolveValue(profile, dobPartKey)
      ? { type: "key", key: dobPartKey }
      : {
          type: "missing",
          key: "dateOfBirth",
          promptText: "What's your date of birth?",
        };
  }

  for (const rule of LABEL_RULES) {
    if (!rule.patterns.some((pattern) => pattern.test(signal))) continue;
    if (rule.skipReason) return { type: "skip", reason: rule.skipReason };
    if (rule.missingKey) {
      return {
        type: "missing",
        key: rule.missingKey,
        promptText: rule.missingPrompt ?? `What's your ${field.label || rule.missingKey}?`,
      };
    }
    if (!rule.key) return undefined;
    const keys = Array.isArray(rule.key) ? rule.key : [rule.key];
    const key = pickBestAvailableKey(profile, keys);
    return { type: "key", key };
  }

  return undefined;
}

function dateOfBirthPartKey(
  field: ScannedField,
  signal: string
): "dateOfBirthMonth" | "dateOfBirthDay" | "dateOfBirthYear" | null {
  if (field.type !== "select") return null;
  const hint = normalizeSignal(selectorHint(field.selector));
  const combined = `${signal} ${hint}`.trim();
  if (
    !/\b(date\s*of\s*birth|birth\s*date|birthday|dob|month|day|year)\b/.test(
      combined
    )
  ) {
    return null;
  }

  if (/\bmonth\b/.test(hint)) return "dateOfBirthMonth";
  if (/\bday\b/.test(hint)) return "dateOfBirthDay";
  if (/\byear\b/.test(hint)) return "dateOfBirthYear";

  const options = (field.options ?? []).map(normalizeSignal).filter(Boolean);
  if (/^month$/.test(signal) || options.some((o) => MONTH_OPTION_WORDS.has(o))) {
    return "dateOfBirthMonth";
  }
  if (/^day$/.test(signal) || options.includes("day")) {
    return "dateOfBirthDay";
  }
  if (/^year$/.test(signal) || options.includes("year") || options.some((o) => /^\d{4}$/.test(o))) {
    return "dateOfBirthYear";
  }

  return null;
}

const MONTH_OPTION_WORDS = new Set([
  "month",
  "jan",
  "january",
  "feb",
  "february",
  "mar",
  "march",
  "apr",
  "april",
  "may",
  "jun",
  "june",
  "jul",
  "july",
  "aug",
  "august",
  "sep",
  "sept",
  "september",
  "oct",
  "october",
  "nov",
  "november",
  "dec",
  "december",
]);

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
