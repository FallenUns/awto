import { describe, it, expect } from "vitest";
import { COUNTRIES, TITLES, PRONOUNS } from "./countries";

describe("country / enum lists", () => {
  it("COUNTRIES has the 5 pinned entries at the top in order", () => {
    expect(COUNTRIES.slice(0, 5)).toEqual([
      "Australia",
      "New Zealand",
      "United Kingdom",
      "United States",
      "Canada",
    ]);
  });

  it("COUNTRIES contains at least 150 countries total", () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(150);
  });

  it("COUNTRIES has no duplicates", () => {
    const set = new Set(COUNTRIES);
    expect(set.size).toBe(COUNTRIES.length);
  });

  it("countries after the pinned 5 are sorted alphabetically", () => {
    const tail = COUNTRIES.slice(5);
    const sorted = [...tail].sort();
    expect(tail).toEqual(sorted);
  });

  it("TITLES includes the common honorifics", () => {
    expect(TITLES).toContain("Mr");
    expect(TITLES).toContain("Mrs");
    expect(TITLES).toContain("Ms");
    expect(TITLES).toContain("Mx");
    expect(TITLES).toContain("Dr");
    expect(TITLES).toContain("Prof");
  });

  it("PRONOUNS includes the common defaults", () => {
    expect(PRONOUNS).toEqual(["he/him", "she/her", "they/them"]);
  });
});
