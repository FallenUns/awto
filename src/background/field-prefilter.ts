import type { FieldMapping } from "@/shared/mapping";
import { profileKeys, type Profile } from "@/shared/profile";
import type { ScannedField } from "@/shared/messages";

export interface PrefilterResult {
  toLLM: ScannedField[];
  skipped: FieldMapping[];
}

const CONSENT_KEY_PATTERNS = [
  /agree/i,
  /consent/i,
  /subscribe/i,
  /newsletter/i,
  /opt[-_ ]?in/i,
  /marketing/i,
  /terms/i,
  /privacy/i,
];

function hasConsentKey(profile: Profile): boolean {
  const keys = profileKeys(profile);
  return keys.some((k) => CONSENT_KEY_PATTERNS.some((re) => re.test(k)));
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

export function prefilter(
  fields: ScannedField[],
  profile: Profile
): PrefilterResult {
  const toLLM: ScannedField[] = [];
  const skipped: FieldMapping[] = [];
  const consentAvailable = hasConsentKey(profile);

  for (const field of fields) {
    if (field.type === "radio") {
      skipped.push(makeSkip(field.id, "Radio button — pick manually"));
      continue;
    }
    if (field.type === "checkbox" && !consentAvailable) {
      skipped.push(makeSkip(field.id, "Checkbox — fill manually"));
      continue;
    }
    toLLM.push(field);
  }

  return { toLLM, skipped };
}
