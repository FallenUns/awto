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

  it("forwards radios — no longer hard-skipped at this layer", () => {
    const fields = [text(0, "Name"), radio(1, "Size")];
    const result = prefilter(fields, baseProfile);
    expect(result.toLLM).toEqual(fields);
    expect(result.skipped).toEqual([]);
  });

  it("forwards checkboxes — no longer hard-skipped at this layer", () => {
    const fields = [
      text(0, "Name"),
      checkbox(1, "Bacon"),
      checkbox(2, "Extra Cheese"),
    ];
    const result = prefilter(fields, baseProfile);
    expect(result.toLLM).toEqual(fields);
    expect(result.skipped).toEqual([]);
  });

  it("returns a new array (doesn't mutate input)", () => {
    const fields = [text(0, "Name")];
    const result = prefilter(fields, baseProfile);
    expect(result.toLLM).not.toBe(fields);
    expect(result.toLLM).toEqual(fields);
  });
});
