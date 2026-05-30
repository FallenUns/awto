import type { ScannedField } from "@/shared/messages";
import type { ConsentDecision, ConsentType } from "@/shared/consent";

const MARKETING_RE =
  /\b(emails?|newsletter|tips|offers?|promo(?:tion(?:al|s)?)?|marketing|updates?|subscribe|deals?|news)\b/i;
const LEGAL_RE =
  /\b(terms|conditions|privacy|policy|policies|agree|agreement|consent|i am over|over 18|18 years|age of)\b/i;

export function classifyConsent(field: ScannedField): ConsentType | null {
  if (field.type !== "checkbox") return null;
  const label = field.label ?? "";
  // Legal takes priority — a label matching both families (e.g. "agree to receive marketing
  // emails per the Privacy Policy") is a legal requirement, not an opt-in preference.
  if (LEGAL_RE.test(label)) return "legal";
  if (MARKETING_RE.test(label)) return "marketing";
  return null;
}

export function buildConsentDecisions(
  fields: ScannedField[],
  marketingPref: "optIn" | "optOut"
): { consent: ConsentDecision[]; consentIds: Set<number> } {
  const consent: ConsentDecision[] = [];
  const consentIds = new Set<number>();
  for (const field of fields) {
    const type = classifyConsent(field);
    if (!type) continue;
    consentIds.add(field.id);
    consent.push({
      fieldId: field.id,
      selector: field.selector,
      label: field.label,
      consentType: type,
      proposedChecked: type === "marketing" ? marketingPref === "optIn" : false,
      ...(field.links ? { links: field.links } : {}),
    });
  }
  return { consent, consentIds };
}
