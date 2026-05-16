import { describe, it, expect, beforeEach } from "vitest";
import type { ScannedField } from "@/shared/messages";
import { cacheKey, getCached, setCached, invalidateTab, _clearCache } from "./result-cache";

const fieldsA: ScannedField[] = [
  { id: 0, selector: "#a", label: "First name", placeholder: null, type: "text", required: false },
  { id: 1, selector: "#b", label: "Email", placeholder: "you@x.com", type: "email", required: true },
];

const fieldsB: ScannedField[] = [
  { id: 0, selector: "#a", label: "Email", placeholder: "you@x.com", type: "email", required: true },
];

beforeEach(() => {
  _clearCache();
});

describe("cacheKey", () => {
  it("returns the same key for identical fields in the same tab", () => {
    expect(cacheKey(1, fieldsA)).toBe(cacheKey(1, fieldsA));
  });

  it("differs when fields differ", () => {
    expect(cacheKey(1, fieldsA)).not.toBe(cacheKey(1, fieldsB));
  });

  it("differs when tabId differs", () => {
    expect(cacheKey(1, fieldsA)).not.toBe(cacheKey(2, fieldsA));
  });

  it("differs when a label changes", () => {
    const changed: ScannedField[] = [
      { ...fieldsA[0]!, label: "Given name" },
      fieldsA[1]!,
    ];
    expect(cacheKey(1, fieldsA)).not.toBe(cacheKey(1, changed));
  });
});

describe("getCached / setCached", () => {
  it("returns null when no entry is set", () => {
    expect(getCached("missing")).toBeNull();
  });

  it("returns the stored entry when set", () => {
    const key = cacheKey(1, fieldsA);
    setCached(key, {
      mappings: [
        {
          fieldId: 0,
          actionType: "fill",
          profileKey: "firstName",
          suggestedKey: null,
          promptText: null,
          reason: null,
          confidence: 0.9,
        },
      ],
      source: "local",
    });
    const entry = getCached(key);
    expect(entry).not.toBeNull();
    expect(entry?.source).toBe("local");
    expect(entry?.mappings).toHaveLength(1);
    expect(entry?.cachedAt).toBeTypeOf("number");
  });
});

describe("invalidateTab", () => {
  it("removes only the targeted tab's entries", () => {
    const key1 = cacheKey(1, fieldsA);
    const key2 = cacheKey(2, fieldsA);
    setCached(key1, { mappings: [], source: "local" });
    setCached(key2, { mappings: [], source: "local" });

    invalidateTab(1);

    expect(getCached(key1)).toBeNull();
    expect(getCached(key2)).not.toBeNull();
  });
});
