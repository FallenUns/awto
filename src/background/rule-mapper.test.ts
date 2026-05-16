import { describe, it, expect } from "vitest";
import { ruleMap } from "./rule-mapper";
import type { Profile } from "@/shared/profile";
import type { ScannedField } from "@/shared/messages";

function field(id: number, autocomplete?: string, label = ""): ScannedField {
  return {
    id,
    selector: `#f${id}`,
    label,
    placeholder: null,
    type: "text",
    required: false,
    ...(autocomplete ? { autocomplete } : {}),
  };
}

const profile: Profile = {
  firstName: "Patrick",
  lastName: "Adrianus",
  email: "p@x.com",
  custom: {},
};

describe("ruleMap", () => {
  it("fills given-name from profile.firstName", () => {
    const { ruleMappings, remaining } = ruleMap([field(0, "given-name")], profile);
    expect(ruleMappings).toHaveLength(1);
    expect(ruleMappings[0]).toMatchObject({
      fieldId: 0, actionType: "fill", profileKey: "firstName", confidence: 1,
    });
    expect(remaining).toEqual([]);
  });

  it("fills family-name from profile.lastName", () => {
    const { ruleMappings } = ruleMap([field(0, "family-name")], profile);
    expect(ruleMappings[0]?.profileKey).toBe("lastName");
  });

  it("fills email from profile.email", () => {
    const { ruleMappings } = ruleMap([field(0, "email")], profile);
    expect(ruleMappings[0]?.profileKey).toBe("email");
  });

  it("marks missing when profile lacks the key", () => {
    const { ruleMappings } = ruleMap([field(0, "tel")], profile);
    expect(ruleMappings[0]).toMatchObject({
      fieldId: 0, actionType: "missing", suggestedKey: "phone",
    });
  });

  it("skips sensitive autocomplete tokens (cc-number, current-password)", () => {
    const fields = [field(0, "cc-number"), field(1, "current-password")];
    const { ruleMappings } = ruleMap(fields, profile);
    expect(ruleMappings).toHaveLength(2);
    expect(ruleMappings[0]).toMatchObject({ actionType: "skip" });
    expect(ruleMappings[0]?.reason).toMatch(/sensitive/i);
    expect(ruleMappings[1]).toMatchObject({ actionType: "skip" });
  });

  it("carries forward fields without autocomplete", () => {
    const f = field(0, undefined, "Mystery field");
    const { ruleMappings, remaining } = ruleMap([f], profile);
    expect(ruleMappings).toEqual([]);
    expect(remaining).toEqual([f]);
  });

  it("composes fullName when given autocomplete=name and both names exist", () => {
    const { ruleMappings } = ruleMap([field(0, "name")], profile);
    expect(ruleMappings[0]).toMatchObject({
      actionType: "fill", profileKey: "fullName",
    });
  });

  it("marks autocomplete=name as missing when only firstName exists", () => {
    const partial: Profile = { firstName: "Patrick", custom: {} };
    const { ruleMappings } = ruleMap([field(0, "name")], partial);
    expect(ruleMappings[0]).toMatchObject({
      actionType: "missing", suggestedKey: "fullName",
    });
  });

  it("ignores unknown autocomplete tokens (carries to remaining)", () => {
    const f = field(0, "wibble");
    const { remaining } = ruleMap([f], profile);
    expect(remaining).toEqual([f]);
  });
});
