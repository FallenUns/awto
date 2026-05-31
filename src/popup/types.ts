import type { FieldMapping } from "@/shared/mapping";
import type { ScannedField } from "@/shared/messages";
import type { ConsentLink } from "@/shared/consent";

export type FlowStatus =
  | "scanning"
  | "mapping"
  | "ready"
  | "filling"
  | "done"
  | "error"
  | "no-form";

export interface FillRow {
  fieldId: number;
  selector: string;
  label: string;
  profileKey: string;
  resolvedValue: string;
  confidence: number;
}

export interface MissingRow {
  fieldId: number;
  selector: string;
  label: string;
  suggestedKey: string;
  promptText: string;
  userValue: string;
}

export interface SkippedRow {
  fieldId: number;
  label: string;
  reason: string;
}

export interface ConsentRow {
  fieldId: number;
  selector: string;
  label: string;
  consentType: "marketing" | "legal";
  checked: boolean;
  links?: ConsentLink[];
}

export interface FailedFill {
  fieldId: number;
  label: string;
  reason: string;
}

export interface FlowState {
  status: FlowStatus;
  error: string | null;
  fields: ScannedField[];
  loadingFields: ScannedField[];
  mappings: FieldMapping[];
  fillRows: FillRow[];
  missingRows: MissingRow[];
  skippedRows: SkippedRow[];
  consentRows: ConsentRow[];
  filledCount: number;
  failedFills: FailedFill[];
  chunksCompleted: number;
}
