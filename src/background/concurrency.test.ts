import { describe, it, expect, vi } from "vitest";
import { chunkArray, runWithConcurrency } from "./concurrency";

describe("chunkArray", () => {
  it("splits an array into groups of the given size", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("returns an empty array for empty input", () => {
    expect(chunkArray([], 3)).toEqual([]);
  });
  it("yields a single chunk when n exceeds length", () => {
    expect(chunkArray([1, 2], 10)).toEqual([[1, 2]]);
  });
  it("rejects non-positive chunk size", () => {
    expect(() => chunkArray([1, 2], 0)).toThrow();
  });
});

describe("runWithConcurrency", () => {
  it("runs all items respecting the concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = [1, 2, 3, 4, 5, 6];
    const results: number[] = [];
    await runWithConcurrency(items, 2, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      results.push(n * 2);
      inFlight--;
    });
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(results.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it("propagates errors from individual tasks", async () => {
    await expect(
      runWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });
});
