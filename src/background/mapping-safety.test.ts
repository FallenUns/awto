import { describe, it, expect } from "vitest";
import type { FieldMapping } from "@/shared/mapping";
import type { ScannedField } from "@/shared/messages";
import { sanitizeMappings } from "./mapping-safety";

function field(id: number, label: string, type = "text"): ScannedField {
  return {
    id,
    selector: `#f${id}`,
    label,
    placeholder: null,
    type,
    required: false,
  };
}

function dobFill(fieldId: number): FieldMapping {
  return {
    fieldId,
    actionType: "fill",
    profileKey: "dateOfBirth",
    suggestedKey: null,
    promptText: null,
    reason: null,
    confidence: 0.93,
  };
}

describe("sanitizeMappings", () => {
  it("keeps dateOfBirth for actual birth fields", () => {
    const mapping = dobFill(0);

    expect(sanitizeMappings([field(0, "Date of birth")], [mapping])).toEqual([
      mapping,
    ]);
    expect(sanitizeMappings([field(0, "DOB")], [mapping])).toEqual([mapping]);
  });

  it("turns dateOfBirth on delivery time into a missing field", () => {
    const sanitized = sanitizeMappings(
      [field(0, "Preferred delivery time")],
      [dobFill(0)]
    );

    expect(sanitized[0]).toMatchObject({
      fieldId: 0,
      actionType: "missing",
      profileKey: null,
      suggestedKey: "preferredDeliveryTime",
      promptText: "What's your preferred delivery time?",
      confidence: 1,
    });
  });
});
