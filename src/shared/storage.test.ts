import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadProfile,
  saveProfile,
  loadLLMSettings,
  saveLLMSettings,
  DEFAULT_LLM_SETTINGS,
} from "./storage";
import { EMPTY_PROFILE, ProfileSchema } from "./profile";

type StorageMock = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
};

function installChromeMock(): StorageMock {
  const local: StorageMock = {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue(undefined),
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local },
  };
  return local;
}

describe("loadProfile", () => {
  let local: StorageMock;

  beforeEach(() => {
    local = installChromeMock();
  });

  it("returns EMPTY_PROFILE when storage is empty", async () => {
    local.get.mockResolvedValue({});
    const profile = await loadProfile();
    expect(profile).toEqual(EMPTY_PROFILE);
  });

  it("returns EMPTY_PROFILE when chrome.storage returns undefined for the key", async () => {
    local.get.mockResolvedValue({ "awto:profile": undefined });
    const profile = await loadProfile();
    expect(profile).toEqual(EMPTY_PROFILE);
  });

  it("returns the parsed profile when stored data is valid", async () => {
    local.get.mockResolvedValue({
      "awto:profile": {
        firstName: "Patrick",
        email: "patrick@example.com",
        custom: {},
      },
    });
    const profile = await loadProfile();
    expect(profile.firstName).toBe("Patrick");
    expect(profile.email).toBe("patrick@example.com");
  });

  it("falls back to EMPTY_PROFILE when stored data is malformed", async () => {
    local.get.mockResolvedValue({
      "awto:profile": { email: "not-an-email" },
    });
    const profile = await loadProfile();
    expect(profile).toEqual(EMPTY_PROFILE);
  });

  it("falls back to EMPTY_PROFILE when stored data is the wrong type", async () => {
    local.get.mockResolvedValue({ "awto:profile": "totally-not-a-profile" });
    const profile = await loadProfile();
    expect(profile).toEqual(EMPTY_PROFILE);
  });

  it("reads from chrome.storage.local with the correct key", async () => {
    local.get.mockResolvedValue({});
    await loadProfile();
    expect(local.get).toHaveBeenCalledWith("awto:profile");
  });
});

describe("saveProfile", () => {
  let local: StorageMock;

  beforeEach(() => {
    local = installChromeMock();
  });

  it("writes the profile under the keyed entry", async () => {
    const profile = ProfileSchema.parse({ firstName: "Patrick" });
    await saveProfile(profile);
    expect(local.set).toHaveBeenCalledWith({ "awto:profile": profile });
  });

  it("does not log the profile to console", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const profile = ProfileSchema.parse({ firstName: "Patrick" });
    await saveProfile(profile);
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("loadLLMSettings", () => {
  let local: StorageMock;

  beforeEach(() => {
    local = installChromeMock();
  });

  it("returns DEFAULT_LLM_SETTINGS when storage is empty", async () => {
    local.get.mockResolvedValue({});
    const settings = await loadLLMSettings();
    expect(settings).toEqual(DEFAULT_LLM_SETTINGS);
  });

  it("returns parsed settings when stored data is valid", async () => {
    local.get.mockResolvedValue({
      "awto:llm": {
        ollamaUrl: "http://localhost:11434",
        ollamaModel: "llama3.2",
        anthropicApiKey: "sk-test",
        anthropicModel: "claude-opus-4-7",
        cloudFallbackEnabled: false,
        confidenceThreshold: 0.5,
      },
    });
    const settings = await loadLLMSettings();
    expect(settings.anthropicApiKey).toBe("sk-test");
    expect(settings.cloudFallbackEnabled).toBe(false);
    expect(settings.confidenceThreshold).toBe(0.5);
  });

  it("falls back to DEFAULT_LLM_SETTINGS on malformed data", async () => {
    local.get.mockResolvedValue({
      "awto:llm": { confidenceThreshold: 5 },
    });
    const settings = await loadLLMSettings();
    expect(settings).toEqual(DEFAULT_LLM_SETTINGS);
  });

  it("reads from chrome.storage.local with the correct key", async () => {
    local.get.mockResolvedValue({});
    await loadLLMSettings();
    expect(local.get).toHaveBeenCalledWith("awto:llm");
  });
});

describe("saveLLMSettings", () => {
  let local: StorageMock;

  beforeEach(() => {
    local = installChromeMock();
  });

  it("writes the settings under the keyed entry", async () => {
    await saveLLMSettings(DEFAULT_LLM_SETTINGS);
    expect(local.set).toHaveBeenCalledWith({
      "awto:llm": DEFAULT_LLM_SETTINGS,
    });
  });

  it("does not log the settings to console", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await saveLLMSettings(DEFAULT_LLM_SETTINGS);
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
