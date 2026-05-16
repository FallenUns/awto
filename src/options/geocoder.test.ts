import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchAddresses } from "./geocoder";

describe("searchAddresses", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns [] on empty query", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await searchAddresses("")).toEqual([]);
    expect(await searchAddresses("   ")).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps Nominatim response to AddressResult", async () => {
    const sample = [
      {
        display_name: "206 La Trobe Street, Melbourne, VIC 3000, Australia",
        address: {
          house_number: "206",
          road: "La Trobe Street",
          suburb: "Melbourne",
          city: "Melbourne",
          state: "Victoria",
          postcode: "3000",
          country: "Australia",
        },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(sample) })
    );

    const results = await searchAddresses("206 la trobe");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      addressLine1: "206 La Trobe Street",
      suburb: "Melbourne",
      city: "Melbourne",
      state: "Victoria",
      postcode: "3000",
      country: "Australia",
    });
  });

  it("returns [] on non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 })
    );
    expect(await searchAddresses("anywhere")).toEqual([]);
  });

  it("returns [] on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await searchAddresses("anywhere")).toEqual([]);
  });

  it("rethrows AbortError when signal aborts", async () => {
    const fetchSpy = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const ctl = new AbortController();
    const promise = searchAddresses("anywhere", { signal: ctl.signal });
    ctl.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("falls back to neighbourhood / town / village when suburb / city are absent", async () => {
    const sample = [
      {
        display_name: "Sample, NSW",
        address: {
          road: "Main St",
          neighbourhood: "Old Town",
          town: "Bathurst",
          state: "New South Wales",
          country: "Australia",
        },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(sample) })
    );

    const [r] = await searchAddresses("main");
    expect(r?.suburb).toBe("Old Town");
    expect(r?.city).toBe("Bathurst");
  });
});
