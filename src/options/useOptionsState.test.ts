import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { AwtoMessage } from "@/shared/messages";
import type { Profile } from "@/shared/profile";
import { DEFAULT_LLM_SETTINGS, type LLMSettings } from "@/shared/storage";

(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { onMessage: { addListener: vi.fn() }, lastError: undefined },
  storage: { local: { get: vi.fn(), set: vi.fn() } },
};

const { useOptionsState } = await import("./useOptionsState");

const baseProfile: Profile = {
  firstName: "Patrick",
  email: "patrick@example.com",
  custom: { linkedin: "linkedin.com/in/patrick" },
};

interface DepBag {
  loadProfile: ReturnType<typeof vi.fn>;
  saveProfile: ReturnType<typeof vi.fn>;
  loadLLMSettings: ReturnType<typeof vi.fn>;
  saveLLMSettings: ReturnType<typeof vi.fn>;
  sendToRuntime: ReturnType<typeof vi.fn>;
}

function makeDeps(overrides: Partial<DepBag> = {}): DepBag {
  return {
    loadProfile:
      overrides.loadProfile ?? vi.fn().mockResolvedValue(baseProfile),
    saveProfile: overrides.saveProfile ?? vi.fn().mockResolvedValue(undefined),
    loadLLMSettings:
      overrides.loadLLMSettings ??
      vi.fn().mockResolvedValue(DEFAULT_LLM_SETTINGS),
    saveLLMSettings:
      overrides.saveLLMSettings ?? vi.fn().mockResolvedValue(undefined),
    sendToRuntime:
      overrides.sendToRuntime ??
      vi.fn().mockResolvedValue({
        type: "testOllamaResult",
        ok: true,
      } satisfies AwtoMessage),
  };
}

function renderOptions(deps: DepBag, debounceMs = 10) {
  return renderHook(() =>
    useOptionsState({
      _loadProfile: deps.loadProfile,
      _saveProfile: deps.saveProfile,
      _loadLLMSettings: deps.loadLLMSettings,
      _saveLLMSettings: deps.saveLLMSettings,
      _sendToRuntime: deps.sendToRuntime,
      _debounceMs: debounceMs,
    })
  );
}

describe("useOptionsState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads profile and LLM settings on mount", async () => {
    const customSettings: LLMSettings = {
      ...DEFAULT_LLM_SETTINGS,
      anthropicApiKey: "sk-test",
      cloudFallbackEnabled: false,
    };
    const deps = makeDeps({
      loadLLMSettings: vi.fn().mockResolvedValue(customSettings),
    });
    const { result } = renderOptions(deps);

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    expect(result.current.profile).toEqual(baseProfile);
    expect(result.current.llmSettings).toEqual(customSettings);
    expect(deps.loadProfile).toHaveBeenCalledTimes(1);
    expect(deps.loadLLMSettings).toHaveBeenCalledTimes(1);
  });

  it("updateProfile mutates state and triggers debounced save", async () => {
    const deps = makeDeps();
    const { result } = renderOptions(deps, 20);

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    act(() => {
      result.current.updateProfile("firstName", "Pat");
    });

    expect(result.current.profile.firstName).toBe("Pat");
    expect(deps.saveProfile).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(deps.saveProfile).toHaveBeenCalledTimes(1);
    });
    const saved = deps.saveProfile.mock.calls[0]?.[0] as Profile;
    expect(saved.firstName).toBe("Pat");
  });

  it("addCustomField adds to custom and triggers save", async () => {
    const deps = makeDeps();
    const { result } = renderOptions(deps);

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    let outcome: { ok: boolean } = { ok: false };
    act(() => {
      outcome = result.current.addCustomField("github", "github.com/patrick");
    });
    expect(outcome.ok).toBe(true);
    expect(result.current.profile.custom.github).toBe("github.com/patrick");

    await waitFor(() => {
      expect(deps.saveProfile).toHaveBeenCalled();
    });
  });

  it("addCustomField rejects empty key", async () => {
    const deps = makeDeps();
    const { result } = renderOptions(deps);

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    let outcome: { ok: true } | { ok: false; error: string } = { ok: true };
    act(() => {
      outcome = result.current.addCustomField("   ", "value");
    });
    expect(outcome).toEqual({ ok: false, error: expect.stringMatching(/empty/i) });
    expect(deps.saveProfile).not.toHaveBeenCalled();
  });

  it("addCustomField rejects built-in key name", async () => {
    const deps = makeDeps();
    const { result } = renderOptions(deps);

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    let outcome: { ok: true } | { ok: false; error: string } = { ok: true };
    act(() => {
      outcome = result.current.addCustomField("firstName", "Pat");
    });
    expect(outcome).toEqual({
      ok: false,
      error: expect.stringMatching(/built-in/i),
    });
  });

  it("removeCustomField removes the key", async () => {
    const deps = makeDeps();
    const { result } = renderOptions(deps);

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    expect(result.current.profile.custom.linkedin).toBeDefined();

    act(() => {
      result.current.removeCustomField("linkedin");
    });

    expect(result.current.profile.custom.linkedin).toBeUndefined();

    await waitFor(() => {
      expect(deps.saveProfile).toHaveBeenCalled();
    });
    const saved = deps.saveProfile.mock.calls.at(-1)?.[0] as Profile;
    expect(saved.custom.linkedin).toBeUndefined();
  });

  it("updateLLMSettings merges partial and saves", async () => {
    const deps = makeDeps();
    const { result } = renderOptions(deps);

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    act(() => {
      result.current.updateLLMSettings({ anthropicApiKey: "sk-new" });
    });

    expect(result.current.llmSettings.anthropicApiKey).toBe("sk-new");
    expect(result.current.llmSettings.ollamaUrl).toBe(
      DEFAULT_LLM_SETTINGS.ollamaUrl
    );

    await waitFor(() => {
      expect(deps.saveLLMSettings).toHaveBeenCalled();
    });
    const saved = deps.saveLLMSettings.mock.calls.at(-1)?.[0] as LLMSettings;
    expect(saved.anthropicApiKey).toBe("sk-new");
    expect(saved.ollamaUrl).toBe(DEFAULT_LLM_SETTINGS.ollamaUrl);
  });

  it("testOllamaConnection sends testOllama message and returns the result", async () => {
    const deps = makeDeps({
      sendToRuntime: vi.fn().mockResolvedValue({
        type: "testOllamaResult",
        ok: false,
        error: "Connection refused",
      } satisfies AwtoMessage),
    });
    const { result } = renderOptions(deps);

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    let outcome: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      outcome = await result.current.testOllamaConnection();
    });

    expect(deps.sendToRuntime).toHaveBeenCalledWith({ type: "testOllama" });
    expect(outcome).toEqual({ ok: false, error: "Connection refused" });
  });
});
