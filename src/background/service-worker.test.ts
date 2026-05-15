import { describe, it, expect, vi } from "vitest";
import type { Profile } from "@/shared/profile";
import type { ScannedField, AwtoMessage } from "@/shared/messages";
import type { LLMSettings } from "@/shared/storage";
import type { HybridResult } from "./llm/hybrid";

(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    onMessage: { addListener: vi.fn() },
  },
};

const { handleMessage } = await import("./service-worker");

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

const defaultSettings: LLMSettings = {
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
  anthropicApiKey: "",
  anthropicModel: "claude-opus-4-7",
  cloudFallbackEnabled: true,
  confidenceThreshold: 0.7,
};

function makeHybridResult(): HybridResult {
  return {
    response: {
      mappings: [
        {
          fieldId: 0,
          actionType: "fill",
          profileKey: "firstName",
          suggestedKey: null,
          promptText: null,
          reason: null,
          confidence: 0.95,
        },
      ],
    },
    source: "local",
  };
}

describe("handleMessage", () => {
  it("returns mapFieldsResult on mapFields happy path", async () => {
    const hybridResult = makeHybridResult();
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn().mockResolvedValue(hybridResult);

    const message: AwtoMessage = { type: "mapFields", fields, profile };
    const response = await handleMessage(message, {
      _loadLLMSettings: loadLLMSettings,
      _callHybrid: callHybrid,
    });

    expect(response).toEqual({
      type: "mapFieldsResult",
      mappings: hybridResult.response.mappings,
      source: "local",
    });
    expect(loadLLMSettings).toHaveBeenCalledTimes(1);
    expect(callHybrid).toHaveBeenCalledWith(profile, fields, defaultSettings);
  });

  it("returns mapFieldsError when callHybrid throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi
      .fn()
      .mockRejectedValue(new Error("both providers down"));

    const message: AwtoMessage = { type: "mapFields", fields, profile };
    const response = await handleMessage(message, {
      _loadLLMSettings: loadLLMSettings,
      _callHybrid: callHybrid,
    });

    expect(response).toEqual({
      type: "mapFieldsError",
      error: "both providers down",
    });
    consoleError.mockRestore();
  });

  it("returns mapFieldsError when loadLLMSettings throws for mapFields", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const loadLLMSettings = vi
      .fn()
      .mockRejectedValue(new Error("storage corrupted"));
    const callHybrid = vi.fn();

    const message: AwtoMessage = { type: "mapFields", fields, profile };
    const response = await handleMessage(message, {
      _loadLLMSettings: loadLLMSettings,
      _callHybrid: callHybrid,
    });

    expect(response).toEqual({
      type: "mapFieldsError",
      error: "storage corrupted",
    });
    expect(callHybrid).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("returns testOllamaResult ok=true on testOllama success", async () => {
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const pingOllama = vi.fn().mockResolvedValue({ ok: true });

    const message: AwtoMessage = { type: "testOllama" };
    const response = await handleMessage(message, {
      _loadLLMSettings: loadLLMSettings,
      _pingOllama: pingOllama,
    });

    expect(response).toEqual({
      type: "testOllamaResult",
      ok: true,
      error: undefined,
    });
    expect(pingOllama).toHaveBeenCalledWith(defaultSettings.ollamaUrl);
  });

  it("returns testOllamaResult ok=false with error on testOllama failure", async () => {
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const pingOllama = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "Connection refused" });

    const message: AwtoMessage = { type: "testOllama" };
    const response = await handleMessage(message, {
      _loadLLMSettings: loadLLMSettings,
      _pingOllama: pingOllama,
    });

    expect(response).toEqual({
      type: "testOllamaResult",
      ok: false,
      error: "Connection refused",
    });
  });

  it("returns testOllamaResult ok=false when pingOllama throws", async () => {
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const pingOllama = vi.fn().mockRejectedValue(new Error("network gone"));

    const message: AwtoMessage = { type: "testOllama" };
    const response = await handleMessage(message, {
      _loadLLMSettings: loadLLMSettings,
      _pingOllama: pingOllama,
    });

    expect(response).toEqual({
      type: "testOllamaResult",
      ok: false,
      error: "network gone",
    });
  });

  it("returns mapFieldsError for unknown message type and warns", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const message = { type: "bogusType" } as unknown as AwtoMessage;
    const response = await handleMessage(message);

    expect(response).toEqual({
      type: "mapFieldsError",
      error: "Unknown message type: bogusType",
    });
    expect(consoleWarn).toHaveBeenCalledWith(
      "Awto: unknown message type",
      "bogusType"
    );
    consoleWarn.mockRestore();
  });

  it("calls loadLLMSettings inside handler each call (no module cache)", async () => {
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn().mockResolvedValue(makeHybridResult());

    const message: AwtoMessage = { type: "mapFields", fields, profile };
    await handleMessage(message, {
      _loadLLMSettings: loadLLMSettings,
      _callHybrid: callHybrid,
    });
    await handleMessage(message, {
      _loadLLMSettings: loadLLMSettings,
      _callHybrid: callHybrid,
    });

    expect(loadLLMSettings).toHaveBeenCalledTimes(2);
  });
});
