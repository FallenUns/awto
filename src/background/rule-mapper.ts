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

export interface RuleMapResult {
  ruleMappings: FieldMapping[];
  remaining: ScannedField[];
}

function resolveValue(profile: Profile, key: string): string | undefined {
  if (key === "fullName") {
    const first = profile.firstName?.trim();
    const last = profile.lastName?.trim();
    if (first && last) return `${first} ${last}`;
    return undefined;
  }
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
    const token = field.autocomplete;
    if (!token) {
      remaining.push(field);
      continue;
    }

    if (!(token in TOKEN_TO_KEY)) {
      remaining.push(field);
      continue;
    }

    const keyOrNull = TOKEN_TO_KEY[token];
    if (keyOrNull === null) {
      ruleMappings.push(makeSkip(field.id, "Sensitive field — won't autofill"));
      continue;
    }

    if (keyOrNull === undefined) {
      remaining.push(field);
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
