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

  it("maps common visible labels without needing the LLM", () => {
    const richProfile: Profile = {
      firstName: "FName",
      middleName: "MName",
      lastName: "LName",
      phone: "0404040404",
      addressLine1: "Address Line Test",
      addressLine2: "Address Line 2 Test",
      city: "City Test",
      state: "State Test",
      postcode: "0000",
      country: "CTest",
      custom: {},
    };

    const { ruleMappings, remaining } = ruleMap(
      [
        field(0, undefined, "First name"),
        field(1, undefined, "Middle name"),
        field(2, undefined, "Last name"),
        field(3, undefined, "Phone number"),
        field(4, undefined, "Street address"),
        field(5, undefined, "City"),
        field(6, undefined, "State"),
        field(7, undefined, "Zip"),
        field(8, undefined, "Country"),
      ],
      richProfile
    );

    expect(remaining).toEqual([]);
    expect(ruleMappings.map((m) => m.profileKey)).toEqual([
      "firstName",
      "middleName",
      "lastName",
      "phone",
      "addressLine1",
      "city",
      "state",
      "postcode",
      "country",
    ]);
  });

  it("does not confuse city with address line 2", () => {
    const richProfile: Profile = {
      addressLine2: "Address Line 2 Test",
      city: "City Test",
      custom: {},
    };

    const { ruleMappings } = ruleMap(
      [field(0, undefined, "Address line 2"), field(1, undefined, "City")],
      richProfile
    );

    expect(ruleMappings[0]?.profileKey).toBe("addressLine2");
    expect(ruleMappings[1]?.profileKey).toBe("city");
  });

  it("uses mobilePhone for mobile labels but falls back to phone", () => {
    const withBoth: Profile = {
      phone: "03 9000 0000",
      mobilePhone: "0404 040 404",
      custom: {},
    };
    expect(
      ruleMap([field(0, undefined, "Mobile")], withBoth).ruleMappings[0]?.profileKey
    ).toBe("mobilePhone");

    const phoneOnly: Profile = { phone: "0404 040 404", custom: {} };
    expect(
      ruleMap([field(0, undefined, "Mobile")], phoneOnly).ruleMappings[0]?.profileKey
    ).toBe("phone");
  });
});
