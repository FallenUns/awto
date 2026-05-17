import { afterEach, describe, it, expect, vi } from "vitest";
import {
  ProfileSchema,
  EMPTY_PROFILE,
  BUILT_IN_KEYS,
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
      custom: { favouriteColour: "https://red" },
    });
    expect(profile.custom.favouriteColour).toBe("https://red");
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
      custom: { favouriteColour: "https://red" },
    });
    const keys = profileKeys(profile);
    expect(keys).toContain("firstName");
    expect(keys).toContain("email");
    expect(keys).toContain("favouriteColour");
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
    custom: { favouriteColour: "https://red" },
  });

  it("returns a built-in field value", () => {
    expect(getProfileValue(profile, "firstName")).toBe("Patrick");
    expect(getProfileValue(profile, "email")).toBe("patrick@example.com");
  });

  it("returns a custom field value", () => {
    expect(getProfileValue(profile, "favouriteColour")).toBe(
      "https://red"
    );
  });

  it("returns undefined for an unknown key", () => {
    expect(getProfileValue(profile, "nonexistent")).toBeUndefined();
  });

  it("returns computed fullName when first and last name are present", () => {
    const named: Profile = ProfileSchema.parse({
      firstName: "Patrick",
      lastName: "Adrianus",
    });
    expect(getProfileValue(named, "fullName")).toBe("Patrick Adrianus");
  });

  it("BUILT_IN_KEYS includes unitNumber", () => {
    expect(BUILT_IN_KEYS).toContain("unitNumber");
  });

  it("ProfileSchema accepts unitNumber", () => {
    const result = ProfileSchema.safeParse({ unitNumber: "5" });
    expect(result.success).toBe(true);
  });

  it("getProfileValue composes addressLine1WithUnit from unitNumber + addressLine1", () => {
    const p = { unitNumber: "5", addressLine1: "206 La Trobe St", custom: {} };
    expect(getProfileValue(p as Profile, "addressLine1WithUnit")).toBe(
      "5/206 La Trobe St"
    );
  });

  it("getProfileValue returns undefined for addressLine1WithUnit when no unitNumber", () => {
    const p = { addressLine1: "206 La Trobe St", custom: {} };
    expect(getProfileValue(p as Profile, "addressLine1WithUnit")).toBeUndefined();
  });

  it("getProfileValue returns undefined for addressLine1WithUnit when no addressLine1", () => {
    expect(
      getProfileValue({ custom: {} } as Profile, "addressLine1WithUnit")
    ).toBeUndefined();
  });

  it("returns computed dateOfBirth parts", () => {
    const p = { dateOfBirth: "2000-01-31", custom: {} };
    expect(getProfileValue(p as Profile, "dateOfBirthYear")).toBe("2000");
    expect(getProfileValue(p as Profile, "dateOfBirthMonth")).toBe("01");
    expect(getProfileValue(p as Profile, "dateOfBirthDay")).toBe("31");
  });

  it("returns computed age from dateOfBirth after this year's birthday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 16));
    const p = { dateOfBirth: "2000-01-01", custom: {} };
    expect(getProfileValue(p as Profile, "age")).toBe("26");
  });

  it("returns computed age from dateOfBirth before this year's birthday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 16));
    const p = { dateOfBirth: "2000-12-31", custom: {} };
    expect(getProfileValue(p as Profile, "age")).toBe("25");
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("setProfileValue", () => {
  it("writes a built-in key to the top level", () => {
    const next = setProfileValue(EMPTY_PROFILE, "firstName", "Patrick");
    expect(next.firstName).toBe("Patrick");
    expect(next.custom).toEqual({});
  });

  it("writes an unknown key to the custom map", () => {
    const next = setProfileValue(EMPTY_PROFILE, "favouriteColour", "red");
    expect(next.custom.favouriteColour).toBe("red");
    expect((next as Record<string, unknown>).favouriteColour).toBeUndefined();
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
