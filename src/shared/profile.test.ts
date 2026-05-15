import { describe, it, expect } from "vitest";
import {
  ProfileSchema,
  EMPTY_PROFILE,
  profileKeys,
  getProfileValue,
  setProfileValue,
  type Profile,
} from "./profile";

describe("ProfileSchema", () => {
  it("parses an empty object into a profile with empty custom map", () => {
    const profile = ProfileSchema.parse({});
    expect(profile.custom).toEqual({});
    expect(profile.firstName).toBeUndefined();
  });

  it("parses a partial profile with built-in fields", () => {
    const profile = ProfileSchema.parse({
      firstName: "Patrick",
      email: "patrick@example.com",
      postcode: "3000",
    });
    expect(profile.firstName).toBe("Patrick");
    expect(profile.email).toBe("patrick@example.com");
    expect(profile.postcode).toBe("3000");
    expect(profile.custom).toEqual({});
  });

  it("rejects an invalid email", () => {
    expect(() => ProfileSchema.parse({ email: "not-an-email" })).toThrow();
  });

  it("rejects a malformed date of birth", () => {
    expect(() => ProfileSchema.parse({ dateOfBirth: "15/05/1990" })).toThrow();
  });

  it("accepts an ISO date of birth", () => {
    const profile = ProfileSchema.parse({ dateOfBirth: "1990-05-15" });
    expect(profile.dateOfBirth).toBe("1990-05-15");
  });

  it("preserves the custom map when provided", () => {
    const profile = ProfileSchema.parse({
      custom: { linkedIn: "https://linkedin.com/in/patrick" },
    });
    expect(profile.custom.linkedIn).toBe("https://linkedin.com/in/patrick");
  });
});

describe("EMPTY_PROFILE", () => {
  it("has an empty custom map and no built-in fields set", () => {
    expect(EMPTY_PROFILE.custom).toEqual({});
    expect(EMPTY_PROFILE.firstName).toBeUndefined();
    expect(EMPTY_PROFILE.email).toBeUndefined();
  });
});

describe("profileKeys", () => {
  it("returns built-in field names that have values plus custom keys", () => {
    const profile: Profile = ProfileSchema.parse({
      firstName: "Patrick",
      email: "patrick@example.com",
      custom: { linkedIn: "https://linkedin.com/in/patrick" },
    });
    const keys = profileKeys(profile);
    expect(keys).toContain("firstName");
    expect(keys).toContain("email");
    expect(keys).toContain("linkedIn");
    expect(keys).not.toContain("lastName");
  });

  it("returns only custom keys when profile is otherwise empty", () => {
    const profile: Profile = ProfileSchema.parse({
      custom: { hobby: "running" },
    });
    expect(profileKeys(profile)).toEqual(["hobby"]);
  });
});

describe("getProfileValue", () => {
  const profile: Profile = ProfileSchema.parse({
    firstName: "Patrick",
    email: "patrick@example.com",
    custom: { linkedIn: "https://linkedin.com/in/patrick" },
  });

  it("returns a built-in field value", () => {
    expect(getProfileValue(profile, "firstName")).toBe("Patrick");
    expect(getProfileValue(profile, "email")).toBe("patrick@example.com");
  });

  it("returns a custom field value", () => {
    expect(getProfileValue(profile, "linkedIn")).toBe(
      "https://linkedin.com/in/patrick"
    );
  });

  it("returns undefined for an unknown key", () => {
    expect(getProfileValue(profile, "nonexistent")).toBeUndefined();
  });
});

describe("setProfileValue", () => {
  it("writes a built-in key to the top level", () => {
    const next = setProfileValue(EMPTY_PROFILE, "firstName", "Patrick");
    expect(next.firstName).toBe("Patrick");
    expect(next.custom).toEqual({});
  });

  it("writes an unknown key to the custom map", () => {
    const next = setProfileValue(EMPTY_PROFILE, "linkedIn", "https://x");
    expect(next.custom.linkedIn).toBe("https://x");
    expect((next as Record<string, unknown>).linkedIn).toBeUndefined();
  });

  it("does not mutate the input profile", () => {
    const before = ProfileSchema.parse({ firstName: "Old" });
    const after = setProfileValue(before, "firstName", "New");
    expect(before.firstName).toBe("Old");
    expect(after.firstName).toBe("New");
    expect(before).not.toBe(after);
  });

  it("does not mutate the input profile's custom map", () => {
    const before = ProfileSchema.parse({ custom: { a: "1" } });
    const after = setProfileValue(before, "b", "2");
    expect(before.custom).toEqual({ a: "1" });
    expect(after.custom).toEqual({ a: "1", b: "2" });
    expect(before.custom).not.toBe(after.custom);
  });
});
