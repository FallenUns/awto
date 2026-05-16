import { describe, it, expect } from "vitest";
import { prefilter } from "./field-prefilter";
import type { Profile } from "@/shared/profile";
import type { ScannedField } from "@/shared/messages";

const baseProfile: Profile = { firstName: "Pat", custom: {} };

function text(id: number, label: string, type = "text"): ScannedField {
  return { id, selector: `#f${id}`, label, placeholder: null, type, required: false };
}

function checkbox(id: number, label: string): ScannedField {
  return { id, selector: `#f${id}`, label, placeholder: null, type: "checkbox", required: false };
}

function radio(id: number, label: string): ScannedField {
  return {
    id,
    selector: `#f${id}`,
    label,
    placeholder: null,
    type: "radio",
    required: false,
    options: ["Small", "Medium", "Large"],
  };
}

describe("prefilter", () => {
  it("forwards regular text fields to the LLM", () => {
    const fields = [text(0, "First name"), text(1, "Email", "email")];
    const result = prefilter(fields, baseProfile);
    expect(result.toLLM).toEqual(fields);
    expect(result.skipped).toEqual([]);
  });

  it("always skips radios", () => {
    const fields = [text(0, "Name"), radio(1, "Size")];
    const result = prefilter(fields, baseProfile);
    expect(result.toLLM).toEqual([fields[0]]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      fieldId: 1,
      actionType: "skip",
      reason: expect.stringContaining("manual"),
    });
  });

  it("skips checkboxes when no consent-like profile keys exist", () => {
    const fields = [text(0, "Name"), checkbox(1, "Bacon"), checkbox(2, "Extra Cheese")];
    const result = prefilter(fields, baseProfile);
    expect(result.toLLM).toEqual([fields[0]]);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.every((m) => m.actionType === "skip")).toBe(true);
  });

  it("forwards checkboxes when profile has a matching consent-like key", () => {
    const fields = [text(0, "Name"), checkbox(1, "I agree to the terms")];
    const profile: Profile = {
      ...baseProfile,
      custom: { agreeToTerms: "true" },
    };
    const result = prefilter(fields, profile);
    expect(result.toLLM).toEqual(fields);
    expect(result.skipped).toEqual([]);
  });

  it("synthetic skip mappings have valid shape (FieldMapping)", () => {
    const fields = [radio(0, "Size")];
    const result = prefilter(fields, baseProfile);
    expect(result.skipped[0]).toEqual({
      fieldId: 0,
      actionType: "skip",
      profileKey: null,
      suggestedKey: null,
      promptText: null,
      reason: expect.any(String),
      confidence: 1,
    });
  });
});
