export interface ConsentLink {
  text: string;
  href: string;
}

export type ConsentType = "marketing" | "legal";

export interface ConsentDecision {
  fieldId: number;
  selector: string;
  label: string;
  consentType: ConsentType;
  proposedChecked: boolean;
  links?: ConsentLink[];
}
