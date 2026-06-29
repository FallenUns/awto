import { describe, it, expect } from "vitest";
import {
  MODEL_CATALOG, findCatalogModel, isHeavyForDevice, TROUBLESHOOTING_URL,
} from "./model-catalog";

describe("MODEL_CATALOG integrity", () => {
  it("has unique ids and all required fields", () => {
    const ids = new Set<string>();
    for (const m of MODEL_CATALOG) {
      expect(m.id).toMatch(/^[a-z0-9.:_-]+$/i);
      expect(ids.has(m.id)).toBe(false);
      ids.add(m.id);
      expect(m.displayName.length).toBeGreaterThan(0);
      expect(m.params.length).toBeGreaterThan(0);
      expect(m.downloadGB).toBeGreaterThan(0);
      expect(m.ramGB).toBeGreaterThan(0);
      expect(["light", "balanced", "heavy"]).toContain(m.tier);
      expect(m.blurb.length).toBeGreaterThan(0);
    }
  });

  it("marks exactly one model as recommended", () => {
    expect(MODEL_CATALOG.filter((m) => m.recommended)).toHaveLength(1);
    expect(MODEL_CATALOG.find((m) => m.recommended)?.id).toBe("qwen2.5:7b");
  });

  it("includes the packaged default and excludes reasoning models", () => {
    expect(findCatalogModel("llama3.2:3b")).toBeDefined();
    expect(MODEL_CATALOG.some((m) => /deepseek-r1|qwq/i.test(m.id))).toBe(false);
  });
});

describe("isHeavyForDevice", () => {
  const heavy = { id: "x", displayName: "X", params: "27B", downloadGB: 17, ramGB: 32, tier: "heavy", recommended: false, blurb: "b" } as const;
  const light = { id: "y", displayName: "Y", params: "3B", downloadGB: 2, ramGB: 8, tier: "light", recommended: false, blurb: "b" } as const;
  it("is false when device memory is unknown", () => {
    expect(isHeavyForDevice(heavy, undefined)).toBe(false);
  });
  it("is true when the model needs more RAM than the device reports", () => {
    expect(isHeavyForDevice(heavy, 8)).toBe(true);
  });
  it("is false when the model fits", () => {
    expect(isHeavyForDevice(light, 8)).toBe(false);
  });
});

describe("TROUBLESHOOTING_URL", () => {
  it("points at the GitHub troubleshooting doc", () => {
    expect(TROUBLESHOOTING_URL).toBe(
      "https://github.com/FallenUns/awto/blob/main/docs/TROUBLESHOOTING.md"
    );
  });
});
