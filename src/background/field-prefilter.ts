import type { FieldMapping } from "@/shared/mapping";
import type { Profile } from "@/shared/profile";
import type { ScannedField } from "@/shared/messages";

export interface PrefilterResult {
  toLLM: ScannedField[];
  skipped: FieldMapping[];
}

export function prefilter(
  fields: ScannedField[],
  _profile: Profile
): PrefilterResult {
  return { toLLM: [...fields], skipped: [] };
}
