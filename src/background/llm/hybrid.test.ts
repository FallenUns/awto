import { describe, it, expect, vi } from "vitest";
import { callHybrid, type HybridCallOpts } from "./hybrid";
import type { LLMResponse } from "@/shared/mapping";
import type { Profile } from "@/shared/profile";
import type { ScannedField } from "@/shared/messages";

const profile: Profile = { firstName: "Patrick", custom: {} };
const fields: ScannedField[] = [
  {
    id: 0,
    selector: "#fname",
    label: "First name",
    placeholder: null,
    type: "text",
    required: true,
  },
];

function makeOpts(overrides: Partial<HybridCallOpts> = {}): HybridCallOpts {
  return {
    ollamaUrl: "http://localhost:11434",
    ollamaModel: "llama3.2",
    anthropicApiKey: "sk-ant-test",
    anthropicModel: "claude-opus-4-7",
    cloudFallbackEnabled: true,
    confidenceThreshold: 0.7,
    ...overrides,
  };
}

function makeResponse(confidences: number[]): LLMResponse {
  return {
    mappings: confidences.map((c, i) => ({
      fieldId: i,
      actionType: "fill" as const,
      profileKey: "firstName",
      suggestedKey: null,
      promptText: null,
      reason: null,
      confidence: c,
    })),
  };
}

describe("callHybrid", () => {
  it("returns source 'local' when all confidences meet threshold", async () => {
    const local = vi.fn().mockResolvedValue(makeResponse([0.9, 0.85]));
    const cloud = vi.fn();

    const result = await callHybrid(profile, fields, makeOpts(), {
      _callLocal: local,
      _callCloud: cloud,
    });

    expect(result.source).toBe("local");
    expect(local).toHaveBeenCalledTimes(1);
    expect(cloud).not.toHaveBeenCalled();
  });

  it("escalates to cloud when any confidence is below threshold and fallback is enabled", async () => {
    const local = vi.fn().mockResolvedValue(makeResponse([0.9, 0.5]));
    const cloudResponse = makeResponse([0.95, 0.92]);
    const cloud = vi.fn().mockResolvedValue(cloudResponse);

    const result = await callHybrid(profile, fields, makeOpts(), {
      _callLocal: local,
      _callCloud: cloud,
    });

    expect(result.source).toBe("cloud");
    expect(result.response).toEqual(cloudResponse);
    expect(cloud).toHaveBeenCalledTimes(1);
  });

  it("does not escalate when fallback is disabled even if confidence is low", async () => {
    const localResponse = makeResponse([0.4]);
    const local = vi.fn().mockResolvedValue(localResponse);
    const cloud = vi.fn();

    const result = await callHybrid(
      profile,
      fields,
      makeOpts({ cloudFallbackEnabled: false }),
      { _callLocal: local, _callCloud: cloud }
    );

    expect(result.source).toBe("local");
    expect(result.response).toEqual(localResponse);
    expect(cloud).not.toHaveBeenCalled();
  });

  it("does not escalate when apiKey is empty even if fallback is enabled", async () => {
    const localResponse = makeResponse([0.3]);
    const local = vi.fn().mockResolvedValue(localResponse);
    const cloud = vi.fn();

    const result = await callHybrid(
      profile,
      fields,
      makeOpts({ anthropicApiKey: "" }),
      { _callLocal: local, _callCloud: cloud }
    );

    expect(result.source).toBe("local");
    expect(cloud).not.toHaveBeenCalled();
  });

  it("falls back to cloud when local throws and fallback is enabled", async () => {
    const local = vi.fn().mockRejectedValue(new Error("ollama not running"));
    const cloudResponse = makeResponse([0.95]);
    const cloud = vi.fn().mockResolvedValue(cloudResponse);

    const result = await callHybrid(profile, fields, makeOpts(), {
      _callLocal: local,
      _callCloud: cloud,
    });

    expect(result.source).toBe("cloud");
    expect(result.response).toEqual(cloudResponse);
    expect(result.localError).toContain("ollama not running");
  });

  it("rethrows when local throws and fallback is disabled", async () => {
    const local = vi.fn().mockRejectedValue(new Error("ollama not running"));
    const cloud = vi.fn();

    await expect(
      callHybrid(profile, fields, makeOpts({ cloudFallbackEnabled: false }), {
        _callLocal: local,
        _callCloud: cloud,
      })
    ).rejects.toThrow("ollama not running");
    expect(cloud).not.toHaveBeenCalled();
  });

  it("rethrows when local throws and apiKey is empty", async () => {
    const local = vi.fn().mockRejectedValue(new Error("ollama down"));
    const cloud = vi.fn();

    await expect(
      callHybrid(profile, fields, makeOpts({ anthropicApiKey: "" }), {
        _callLocal: local,
        _callCloud: cloud,
      })
    ).rejects.toThrow("ollama down");
    expect(cloud).not.toHaveBeenCalled();
  });

  it("throws with both error messages when both local and cloud fail", async () => {
    const local = vi.fn().mockRejectedValue(new Error("ollama down"));
    const cloud = vi.fn().mockRejectedValue(new Error("anthropic 503"));

    await expect(
      callHybrid(profile, fields, makeOpts(), {
        _callLocal: local,
        _callCloud: cloud,
      })
    ).rejects.toThrow(/ollama down.*anthropic 503/);
  });

  it("returns local result when cloud fallback errors after low-confidence local success", async () => {
    const localResponse = makeResponse([0.3]);
    const local = vi.fn().mockResolvedValue(localResponse);
    const cloud = vi.fn().mockRejectedValue(new Error("anthropic 503"));

    const result = await callHybrid(profile, fields, makeOpts(), {
      _callLocal: local,
      _callCloud: cloud,
    });

    expect(result.source).toBe("local");
    expect(result.response).toEqual(localResponse);
  });

  it("forwards the AbortSignal to both local and cloud calls", async () => {
    const external = new AbortController();
    const local = vi.fn().mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" })
    );
    const cloud = vi.fn().mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" })
    );

    await expect(
      callHybrid(
        profile,
        fields,
        makeOpts({ signal: external.signal }),
        { _callLocal: local, _callCloud: cloud }
      )
    ).rejects.toThrow();

    expect(local).toHaveBeenCalledWith(
      profile,
      fields,
      expect.objectContaining({ signal: external.signal })
    );
  });
});
