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
  return fill(fieldId, "dateOfBirth");
}

function fill(fieldId: number, profileKey: string): FieldMapping {
  return {
    fieldId,
    actionType: "fill",
    profileKey,
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

  it("turns name values on delivery time into a missing field", () => {
    const sanitized = sanitizeMappings(
      [field(0, "Preferred delivery time", "time")],
      [fill(0, "preferredName")]
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

  it("allows a specific saved delivery time key", () => {
    const mapping = fill(0, "preferredDeliveryTime");
    expect(
      sanitizeMappings([field(0, "Preferred delivery time", "time")], [mapping])
    ).toEqual([mapping]);
  });

  it("blocks wrong values on sensitive and account fields", () => {
    const sanitized = sanitizeMappings(
      [
        field(0, "User ID"),
        field(1, "Password", "password"),
        field(2, "Credit Card Number"),
        field(3, "Card Verification Code"),
        field(4, "Social Security Number"),
      ],
      [
        fill(0, "addressLine2"),
        fill(1, "preferredName"),
        fill(2, "firstName"),
        fill(3, "middleName"),
        fill(4, "taxFileNumber"),
      ]
    );

    expect(sanitized[0]).toMatchObject({
      actionType: "missing",
      suggestedKey: "userId",
    });
    expect(sanitized[1]).toMatchObject({
      actionType: "skip",
      reason: "Sensitive credential — fill manually",
    });
    expect(sanitized[2]).toMatchObject({
      actionType: "skip",
      reason: "Payment field — fill manually",
    });
    expect(sanitized[3]).toMatchObject({
      actionType: "skip",
      reason: "Payment field — fill manually",
    });
    expect(sanitized[4]).toMatchObject({
      actionType: "skip",
      reason: "Sensitive government identifier — fill manually",
    });
  });

  it("allows semantically compatible profile keys", () => {
    const mappings = [
      fill(0, "title"),
      fill(1, "fullName"),
      fill(2, "phone"),
      fill(3, "mobilePhone"),
      fill(4, "email"),
      fill(5, "website"),
      fill(6, "dateOfBirth"),
      fill(7, "age"),
    ];

    expect(
      sanitizeMappings(
        [
          field(0, "Title"),
          field(1, "Full Name"),
          field(2, "Home Phone"),
          field(3, "Cell Phone"),
          field(4, "E-mail"),
          field(5, "Web Site"),
          field(6, "Date Of Birth"),
          field(7, "Age"),
        ],
        mappings
      )
    ).toEqual(mappings);
  });

  describe("name/pronoun/phone deny-list", () => {
    it("skips firstName on a Color picker field", () => {
      const sanitized = sanitizeMappings(
        [field(0, "Color picker", "color")],
        [fill(0, "firstName")]
      );
      expect(sanitized[0]).toMatchObject({
        actionType: "skip",
        reason: expect.stringMatching(/doesn't fit/i),
      });
    });

    it("skips fullName on a Search field", () => {
      const sanitized = sanitizeMappings(
        [field(0, "Search", "search")],
        [fill(0, "fullName")]
      );
      expect(sanitized[0]).toMatchObject({ actionType: "skip" });
    });

    it("skips pronouns on a Search field", () => {
      const sanitized = sanitizeMappings(
        [field(0, "Search", "search")],
        [fill(0, "pronouns")]
      );
      expect(sanitized[0]).toMatchObject({ actionType: "skip" });
    });

    it("skips phone on an Account field", () => {
      const sanitized = sanitizeMappings(
        [field(0, "Account")],
        [fill(0, "phone")]
      );
      expect(sanitized[0]).toMatchObject({ actionType: "skip" });
    });

    it("skips preferredName on a generic 'Quality' field", () => {
      const sanitized = sanitizeMappings(
        [field(0, "Quality")],
        [fill(0, "preferredName")]
      );
      expect(sanitized[0]).toMatchObject({ actionType: "skip" });
    });

    it("allows pronouns on a Pronouns field", () => {
      const m = fill(0, "pronouns");
      expect(sanitizeMappings([field(0, "Pronouns")], [m])).toEqual([m]);
    });

    it("allows firstName on a First Name field (regression)", () => {
      const m = fill(0, "firstName");
      expect(sanitizeMappings([field(0, "First Name")], [m])).toEqual([m]);
    });

    it("allows fullName on a plain 'Name:' field (Google Forms pattern)", () => {
      const m = fill(0, "fullName");
      expect(sanitizeMappings([field(0, "Name:")], [m])).toEqual([m]);
    });

    it("allows fullName on a label 'Name' with no qualifier", () => {
      const m = fill(0, "fullName");
      expect(sanitizeMappings([field(0, "Name")], [m])).toEqual([m]);
    });

    it("still blocks fullName on a 'Username' field (no false positive)", () => {
      const sanitized = sanitizeMappings(
        [field(0, "Username")],
        [fill(0, "fullName")]
      );
      expect(sanitized[0]).toMatchObject({ actionType: "missing" });
    });
  });

  describe("quiz / trivia question detection", () => {
    it("skips lastName on a trivia question that asks about a third party", () => {
      const sanitized = sanitizeMappings(
        [field(0, "What was Luke Skywalker's original last name? 1 point")],
        [fill(0, "lastName")]
      );
      expect(sanitized[0]).toMatchObject({
        actionType: "skip",
        reason: expect.stringMatching(/quiz|question about|third party|trivia/i),
      });
    });

    it("skips firstName on a long quiz question with no name keyword at all", () => {
      const sanitized = sanitizeMappings(
        [
          field(
            0,
            "Given the formula below for light speed travel, Han Solo did the Kessel Run in how many parsecs? 3 points"
          ),
        ],
        [fill(0, "firstName")]
      );
      expect(sanitized[0]).toMatchObject({ actionType: "skip" });
    });

    it("skips fullName on a long question about a third party", () => {
      const sanitized = sanitizeMappings(
        [field(0, "The latest villain, Kylo Ren, what is his real name? 1 point")],
        [fill(0, "fullName")]
      );
      expect(sanitized[0]).toMatchObject({ actionType: "skip" });
    });

    it("STILL allows fullName when the question says 'your' (user-targeted)", () => {
      const m = fill(0, "fullName");
      expect(
        sanitizeMappings(
          [field(0, "What is your full legal name as it appears on your passport?")],
          [m]
        )
      ).toEqual([m]);
    });

    it("STILL allows lastName on a plain 'Last name:' field (no false positive on length)", () => {
      const m = fill(0, "lastName");
      expect(sanitizeMappings([field(0, "Last name:")], [m])).toEqual([m]);
    });

    it("STILL allows lastName on a question 'What is your last name?'", () => {
      const m = fill(0, "lastName");
      expect(
        sanitizeMappings([field(0, "What is your last name?")], [m])
      ).toEqual([m]);
    });
  });

  describe("LLM-generated promptText normalisation", () => {
    it("normalises 'What's your date:?' into 'What's your Date?'", () => {
      const sanitized = sanitizeMappings(
        [field(0, "Date:", "date")],
        [
          {
            fieldId: 0,
            actionType: "missing",
            profileKey: null,
            suggestedKey: "appointmentDate",
            promptText: "What's your date:?",
            reason: null,
            confidence: 1,
          },
        ]
      );
      expect(sanitized[0]?.promptText).toBe("What's your Date?");
    });

    it("leaves a clean promptText untouched", () => {
      const m: FieldMapping = {
        fieldId: 0,
        actionType: "missing",
        profileKey: null,
        suggestedKey: "x",
        promptText: "What's your favourite colour?",
        reason: null,
        confidence: 1,
      };
      expect(sanitizeMappings([field(0, "Colour")], [m])).toEqual([m]);
    });
  });

  it("converts mismatched profile keys into missing questions", () => {
    const sanitized = sanitizeMappings(
      [
        field(0, "Middle Initial"),
        field(1, "Home Phone"),
        field(2, "Fax"),
        field(3, "Age"),
        field(4, "Birth Place"),
        field(5, "E-mail"),
        field(6, "Web Site"),
      ],
      [
        fill(0, "firstName"),
        fill(1, "title"),
        fill(2, "addressLine1"),
        fill(3, "addressLine1"),
        fill(4, "addressLine2"),
        fill(5, "addressLine2"),
        fill(6, "addressLine2"),
      ]
    );

    expect(sanitized[0]).toMatchObject({
      actionType: "missing",
      suggestedKey: "middleInitial",
    });
    expect(sanitized[1]).toMatchObject({
      actionType: "missing",
      suggestedKey: "homePhone",
    });
    expect(sanitized[2]).toMatchObject({
      actionType: "skip",
      reason: "Fax number not in profile",
    });
    expect(sanitized[3]).toMatchObject({
      actionType: "missing",
      suggestedKey: "age",
    });
    expect(sanitized[4]).toMatchObject({
      actionType: "missing",
      suggestedKey: "birthPlace",
    });
    expect(sanitized[5]).toMatchObject({
      actionType: "missing",
      suggestedKey: "email",
    });
    expect(sanitized[6]).toMatchObject({
      actionType: "missing",
      suggestedKey: "webSite",
    });
  });
});

describe("phone and apt mapping safety", () => {
  const fill = (fieldId: number, profileKey: string): FieldMapping => ({
    fieldId,
    actionType: "fill",
    profileKey,
    suggestedKey: null,
    promptText: null,
    reason: null,
    confidence: 0.95,
  });

  it("allows unitNumber into an Apt/Suite field", () => {
    const out = sanitizeMappings([field(0, "Apt/Suite")], [fill(0, "unitNumber")]);
    expect(out[0]).toMatchObject({ actionType: "fill", profileKey: "unitNumber" });
  });

  it("allows phone into a type=tel input despite a country-ish label", () => {
    const out = sanitizeMappings(
      [field(0, "Country code Australia +61", "tel")],
      [fill(0, "phone")]
    );
    expect(out[0]).toMatchObject({ actionType: "fill", profileKey: "phone" });
  });

  it("blocks country from a type=tel input", () => {
    const out = sanitizeMappings(
      [field(0, "Country code Australia +61", "tel")],
      [fill(0, "country")]
    );
    expect(out[0]?.actionType).toBe("skip");
  });
});
