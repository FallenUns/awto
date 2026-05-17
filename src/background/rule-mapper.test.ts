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

function labelledField(
  id: number,
  label: string,
  type = "text",
  options?: string[]
): ScannedField {
  return {
    id,
    selector: `#f${id}`,
    label,
    placeholder: null,
    type,
    required: false,
    ...(options ? { options } : {}),
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

  it("prefers the visible label over a misleading autocomplete token", () => {
    const { ruleMappings } = ruleMap(
      [
        {
          ...field(0, "address-line1", "City"),
          autocomplete: "address-line1",
        },
      ],
      { addressLine1: "206 327 La Trobe St", city: "Melbourne", custom: {} }
    );

    expect(ruleMappings[0]).toMatchObject({
      actionType: "fill",
      profileKey: "city",
    });
  });

  it("uses plain addressLine1 when the form has a separate address line 2", () => {
    const { ruleMappings } = ruleMap(
      [
        labelledField(0, "Street address"),
        labelledField(1, "Address Line 2"),
      ],
      {
        unitNumber: "5",
        addressLine1: "327 La Trobe Street",
        addressLine2: "Level 2",
        custom: {},
      }
    );

    expect(ruleMappings[0]).toMatchObject({
      actionType: "fill",
      profileKey: "addressLine1",
    });
  });

  it("maps split date-of-birth selects to computed DOB parts", () => {
    const { ruleMappings, remaining } = ruleMap(
      [
        labelledField(0, "Date Of Birth", "select", ["Month", "Jan", "Feb"]),
        labelledField(1, "Date Of Birth", "select", ["Day", "01", "02"]),
        labelledField(2, "Date Of Birth", "select", ["Year", "1999", "2000"]),
      ],
      { dateOfBirth: "2000-01-02", custom: {} }
    );

    expect(remaining).toEqual([]);
    expect(ruleMappings.map((m) => m.profileKey)).toEqual([
      "dateOfBirthMonth",
      "dateOfBirthDay",
      "dateOfBirthYear",
    ]);
  });

  it("maps month/day/year labels to computed DOB parts", () => {
    const { ruleMappings } = ruleMap(
      [
        labelledField(0, "Month", "select", ["Month", "Jan"]),
        labelledField(1, "Day", "select", ["Day", "01"]),
        labelledField(2, "Year", "select", ["Year", "2000"]),
      ],
      { dateOfBirth: "2000-01-02", custom: {} }
    );

    expect(ruleMappings.map((m) => m.profileKey)).toEqual([
      "dateOfBirthMonth",
      "dateOfBirthDay",
      "dateOfBirthYear",
    ]);
  });

  it("maps age to a computed value when date of birth exists", () => {
    const { ruleMappings } = ruleMap(
      [labelledField(0, "Age")],
      { dateOfBirth: "2000-01-01", custom: {} }
    );

    expect(ruleMappings[0]).toMatchObject({
      actionType: "fill",
      profileKey: "age",
    });
  });

  it("asks for age when no date of birth exists", () => {
    const { ruleMappings } = ruleMap([labelledField(0, "Age")], { custom: {} });

    expect(ruleMappings[0]).toMatchObject({
      actionType: "missing",
      suggestedKey: "age",
    });
  });

  it("handles RoboForm-style identity fields without the LLM", () => {
    const richProfile: Profile = {
      title: "Mr",
      firstName: "Patrick",
      lastName: "Adrianus",
      gender: "Male",
      email: "patrick@example.com",
      phone: "0400 000 000",
      mobilePhone: "0404 040 404",
      addressLine1: "327 La Trobe Street",
      city: "Melbourne",
      state: "Victoria",
      postcode: "3000",
      country: "Australia",
      driverLicense: "D1234567",
      dateOfBirth: "2000-01-01",
      custom: {},
    };
    const roboFields = [
      labelledField(0, "Title"),
      labelledField(1, "First Name"),
      labelledField(2, "Middle Initial"),
      labelledField(3, "Last Name"),
      labelledField(4, "Full Name"),
      labelledField(5, "Company"),
      labelledField(6, "Position"),
      labelledField(7, "Address Line 1"),
      labelledField(8, "Address Line 2"),
      labelledField(9, "City"),
      labelledField(10, "State / Province"),
      labelledField(11, "Country"),
      labelledField(12, "Zip"),
      labelledField(13, "Home Phone"),
      labelledField(14, "Work Telephone"),
      labelledField(15, "Fax"),
      labelledField(16, "Cell Phone"),
      labelledField(17, "E-mail"),
      labelledField(18, "Web Site"),
      labelledField(19, "User ID"),
      labelledField(20, "Password", "password"),
      labelledField(21, "Credit Card Type", "select", ["(Select Card Type)"]),
      labelledField(22, "Credit Card Number"),
      labelledField(23, "Card Verification Code"),
      labelledField(24, "Card Expiration Date", "select", ["01", "02"]),
      labelledField(25, "Card User Name"),
      labelledField(26, "Card Issuing Bank"),
      labelledField(27, "Card Customer Service Phone"),
      labelledField(28, "Sex"),
      labelledField(29, "Social Security Number"),
      labelledField(30, "Driver License Number"),
      labelledField(31, "Date Of Birth", "select", ["Month", "Jan"]),
      labelledField(32, "Month", "select", ["Month", "Jan"]),
      labelledField(33, "Day", "select", ["Day", "01"]),
      labelledField(34, "Year", "select", ["Year", "2000"]),
      labelledField(35, "Age"),
      labelledField(36, "Birth Place"),
      labelledField(37, "Income"),
      labelledField(38, "Custom Message"),
      labelledField(39, "Comments"),
    ];

    const { ruleMappings, remaining } = ruleMap(roboFields, richProfile);

    expect(remaining).toEqual([]);
    expect(ruleMappings).toHaveLength(roboFields.length);
    expect(ruleMappings.find((m) => m.fieldId === 28)).toMatchObject({
      actionType: "fill",
      profileKey: "gender",
    });
    expect(ruleMappings.find((m) => m.fieldId === 21)).toMatchObject({
      actionType: "skip",
      reason: "Payment field — fill manually",
    });
    expect(ruleMappings.find((m) => m.fieldId === 31)).toMatchObject({
      actionType: "fill",
      profileKey: "dateOfBirthMonth",
    });
    expect(ruleMappings.find((m) => m.fieldId === 35)).toMatchObject({
      actionType: "fill",
      profileKey: "age",
    });
  });
});
