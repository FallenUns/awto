import { describe, it, expect } from "vitest";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  getOutputJsonSchema,
} from "./prompt";
import type { Profile } from "@/shared/profile";
import type { ScannedField } from "@/shared/messages";

describe("SYSTEM_PROMPT", () => {
  it("is non-empty", () => {
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("mentions the three action types", () => {
    expect(SYSTEM_PROMPT).toMatch(/fill/);
    expect(SYSTEM_PROMPT).toMatch(/missing/);
    expect(SYSTEM_PROMPT).toMatch(/skip/);
  });

  it("mentions the profile", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toMatch(/profile/);
  });

  it("warns against markdown / prose output", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toMatch(/markdown|prose|json/);
  });
});

describe("SYSTEM_PROMPT type-specific guidance", () => {
  it("instructs on checkbox handling", () => {
    expect(SYSTEM_PROMPT).toContain("checkbox");
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("true");
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("false");
  });

  it("instructs on radio handling", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("radio");
  });

  it("instructs on select-options verbatim", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("options");
    expect(SYSTEM_PROMPT.toLowerCase()).toMatch(/verbatim|copy|exactly/);
  });

  it("instructs on time/date formats", () => {
    expect(SYSTEM_PROMPT).toContain("HH:MM");
    expect(SYSTEM_PROMPT).toContain("YYYY-MM-DD");
  });

  it("lists common phone-label synonyms", () => {
    const lower = SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain("phone");
    expect(lower).toMatch(/telephone|mobile|tel\b/);
  });

  it("warns against duplicating values across semantically different fields", () => {
    const lower = SYSTEM_PROMPT.toLowerCase();
    expect(lower).toMatch(/duplicate|same value|do not put the same/);
  });

  it("instructs lower confidence for fuzzy matches", () => {
    expect(SYSTEM_PROMPT).toMatch(/0\.6|0\.7|0\.8/);
  });
});

describe("buildUserPrompt", () => {
  const profile: Profile = {
    firstName: "Patrick",
    lastName: "Adrianus",
    email: "patrick@example.com",
    phone: "+61400000000",
    custom: { favouriteColour: "https://red" },
  };

  const fields: ScannedField[] = [
    {
      id: 0,
      selector: "#fname",
      label: "First name",
      placeholder: "Given name",
      type: "text",
      required: true,
    },
    {
      id: 1,
      selector: "#email",
      label: "Email address",
      placeholder: null,
      type: "email",
      required: true,
    },
  ];

  it("includes every profile key", () => {
    const prompt = buildUserPrompt(profile, fields);
    expect(prompt).toContain("firstName");
    expect(prompt).toContain("lastName");
    expect(prompt).toContain("email");
    expect(prompt).toContain("phone");
    expect(prompt).toContain("favouriteColour");
  });

  it("includes every profile value", () => {
    const prompt = buildUserPrompt(profile, fields);
    expect(prompt).toContain("Patrick");
    expect(prompt).toContain("Adrianus");
    expect(prompt).toContain("patrick@example.com");
    expect(prompt).toContain("+61400000000");
    expect(prompt).toContain("https://red");
  });

  it("includes every field's label, placeholder, and type", () => {
    const prompt = buildUserPrompt(profile, fields);
    expect(prompt).toContain("First name");
    expect(prompt).toContain("Given name");
    expect(prompt).toContain('type="text"');
    expect(prompt).toContain("Email address");
    expect(prompt).toContain('type="email"');
  });

  it("includes select options when present", () => {
    const withOptions: ScannedField[] = [
      {
        id: 0,
        selector: "#state",
        label: "State",
        placeholder: null,
        type: "select",
        required: true,
        options: ["VIC", "NSW", "QLD"],
      },
    ];
    const prompt = buildUserPrompt(profile, withOptions);
    expect(prompt).toContain("VIC");
    expect(prompt).toContain("NSW");
    expect(prompt).toContain("QLD");
  });

  it("handles an empty profile", () => {
    const empty: Profile = { custom: {} };
    const prompt = buildUserPrompt(empty, fields);
    expect(prompt).toContain("empty");
    expect(prompt).toContain("First name");
  });

  it("handles an empty field list", () => {
    const prompt = buildUserPrompt(profile, []);
    expect(prompt).toContain("Patrick");
    expect(prompt).toMatch(/no fields/i);
  });
});

describe("getOutputJsonSchema", () => {
  it("returns an object type at the top level", () => {
    const schema = getOutputJsonSchema();
    expect(schema.type).toBe("object");
  });

  it("contains a mappings property", () => {
    const schema = getOutputJsonSchema();
    const properties = schema.properties as Record<string, unknown>;
    expect(properties.mappings).toBeDefined();
  });

  it("has no oneOf/anyOf/allOf at the top level", () => {
    const schema = getOutputJsonSchema();
    const keys = Object.keys(schema);
    expect(keys).not.toContain("oneOf");
    expect(keys).not.toContain("anyOf");
    expect(keys).not.toContain("allOf");
  });

  it("is not a $ref wrapper", () => {
    const schema = getOutputJsonSchema();
    expect(schema.$ref).toBeUndefined();
  });
});

describe("buildUserPrompt fullName composite", () => {
  it("injects a fullName composite when both names exist", () => {
    const profile: Profile = {
      firstName: "Patrick",
      lastName: "Adrianus",
      custom: {},
    };
    const prompt = buildUserPrompt(profile, []);
    expect(prompt).toContain("fullName: Patrick Adrianus");
  });

  it("does NOT inject fullName when only firstName exists", () => {
    const profile: Profile = {
      firstName: "Patrick",
      custom: {},
    };
    const prompt = buildUserPrompt(profile, []);
    expect(prompt).not.toMatch(/^- fullName:/m);
  });

  it("does NOT inject fullName when only lastName exists", () => {
    const profile: Profile = {
      lastName: "Adrianus",
      custom: {},
    };
    const prompt = buildUserPrompt(profile, []);
    expect(prompt).not.toMatch(/^- fullName:/m);
  });
});

describe("SYSTEM_PROMPT fullName rule", () => {
  it("instructs to use fullName for single name-style fields", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toMatch(
      /customer name|full name|single name-style/
    );
    expect(SYSTEM_PROMPT).toContain("fullName");
  });
});

describe("buildUserPrompt addressLine1WithUnit composite", () => {
  it("buildUserPrompt injects addressLine1WithUnit when both unit and street exist", () => {
    const profile: Profile = {
      unitNumber: "5",
      addressLine1: "206 La Trobe St",
      custom: {},
    };
    const prompt = buildUserPrompt(profile, []);
    expect(prompt).toContain("addressLine1WithUnit: 5/206 La Trobe St");
  });

  it("buildUserPrompt does NOT inject addressLine1WithUnit when no unit", () => {
    const profile: Profile = {
      addressLine1: "206 La Trobe St",
      custom: {},
    };
    const prompt = buildUserPrompt(profile, []);
    expect(prompt).not.toMatch(/^- addressLine1WithUnit:/m);
  });

  it("SYSTEM_PROMPT instructs on unit/apt handling", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toMatch(/unit|apartment|apt/);
    expect(SYSTEM_PROMPT).toContain("addressLine1WithUnit");
  });
});
