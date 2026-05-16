import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Profile } from "@/shared/profile";
import type { ScannedField, AwtoMessage } from "@/shared/messages";
import type { LLMSettings } from "@/shared/storage";
import type { HybridResult } from "./llm/hybrid";
import { _clearCache, setCached, cacheKey, getCached } from "./result-cache";

(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    onMessage: { addListener: vi.fn() },
  },
};

const { handleMessage, registerPortHandler } = await import("./service-worker");

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
  ollamaTimeoutMs: 90000,
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

  it("returns testOllamaResult with models and modelInstalled=true when model is installed", async () => {
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const pingOllama = vi.fn().mockResolvedValue({ ok: true });
    const listOllamaModels = vi
      .fn()
      .mockResolvedValue({ ok: true, models: ["llama3.2:latest", "qwen2.5"] });

    const message: AwtoMessage = { type: "testOllama" };
    const response = await handleMessage(message, {
      _loadLLMSettings: loadLLMSettings,
      _pingOllama: pingOllama,
      _listOllamaModels: listOllamaModels,
    });

    expect(response).toEqual({
      type: "testOllamaResult",
      ok: true,
      models: ["llama3.2:latest", "qwen2.5"],
      modelInstalled: true,
    });
    expect(pingOllama).toHaveBeenCalledWith(defaultSettings.ollamaUrl);
    expect(listOllamaModels).toHaveBeenCalledWith(defaultSettings.ollamaUrl);
  });

  it("returns modelInstalled=false when configured model is not installed", async () => {
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const pingOllama = vi.fn().mockResolvedValue({ ok: true });
    const listOllamaModels = vi
      .fn()
      .mockResolvedValue({ ok: true, models: ["qwen2.5", "mistral"] });

    const response = await handleMessage(
      { type: "testOllama" },
      {
        _loadLLMSettings: loadLLMSettings,
        _pingOllama: pingOllama,
        _listOllamaModels: listOllamaModels,
      }
    );

    expect(response).toEqual({
      type: "testOllamaResult",
      ok: true,
      models: ["qwen2.5", "mistral"],
      modelInstalled: false,
    });
  });

  it("returns ok=true with error when listOllamaModels fails after successful ping", async () => {
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const pingOllama = vi.fn().mockResolvedValue({ ok: true });
    const listOllamaModels = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "HTTP 500" });

    const response = await handleMessage(
      { type: "testOllama" },
      {
        _loadLLMSettings: loadLLMSettings,
        _pingOllama: pingOllama,
        _listOllamaModels: listOllamaModels,
      }
    );

    expect(response).toEqual({
      type: "testOllamaResult",
      ok: true,
      error: "HTTP 500",
    });
  });

  it("returns testOllamaResult ok=false with error on ping failure (skips listOllamaModels)", async () => {
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const pingOllama = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "Connection refused" });
    const listOllamaModels = vi.fn();

    const response = await handleMessage(
      { type: "testOllama" },
      {
        _loadLLMSettings: loadLLMSettings,
        _pingOllama: pingOllama,
        _listOllamaModels: listOllamaModels,
      }
    );

    expect(response).toEqual({
      type: "testOllamaResult",
      ok: false,
      error: "Connection refused",
    });
    expect(listOllamaModels).not.toHaveBeenCalled();
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

  it("passes signal through to callHybrid on mapFields", async () => {
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn().mockResolvedValue({
      response: { mappings: [] },
      source: "local",
    });
    const external = new AbortController();

    await handleMessage(
      { type: "mapFields", fields, profile: { custom: {} } },
      { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid, signal: external.signal }
    );

    expect(callHybrid).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ signal: external.signal })
    );
  });

  it("does not log console.error when mapFields is aborted", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn().mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" })
    );

    const response = await handleMessage(
      { type: "mapFields", fields, profile: { custom: {} } },
      { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid }
    );

    expect(response.type).toBe("mapFieldsError");
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("handleMessage with result cache", () => {
  beforeEach(() => {
    _clearCache();
  });

  it("returns cached result and skips hybrid on cache hit", async () => {
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn();
    const key = cacheKey(42, fields);
    setCached(key, {
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
      source: "cloud",
    });

    const response = await handleMessage(
      { type: "mapFields", fields, profile, tabId: 42 },
      { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid }
    );

    expect(response).toEqual({
      type: "mapFieldsResult",
      mappings: expect.any(Array),
      source: "cloud",
    });
    expect(callHybrid).not.toHaveBeenCalled();
    expect(loadLLMSettings).not.toHaveBeenCalled();
  });

  it("caches successful result for future hits", async () => {
    const hybridResult = makeHybridResult();
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn().mockResolvedValue(hybridResult);

    await handleMessage(
      { type: "mapFields", fields, profile, tabId: 7 },
      { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid }
    );

    const stored = getCached(cacheKey(7, fields));
    expect(stored).not.toBeNull();
    expect(stored?.mappings).toEqual(hybridResult.response.mappings);
    expect(stored?.source).toBe("local");
  });

  it("does not cache when callHybrid throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn().mockRejectedValue(new Error("boom"));

    await handleMessage(
      { type: "mapFields", fields, profile, tabId: 8 },
      { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid }
    );

    expect(getCached(cacheKey(8, fields))).toBeNull();
    consoleError.mockRestore();
  });

  it("does not cache when call is aborted", async () => {
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn().mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" })
    );

    await handleMessage(
      { type: "mapFields", fields, profile, tabId: 9 },
      { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid }
    );

    expect(getCached(cacheKey(9, fields))).toBeNull();
  });

  it("falls through to hybrid when no tabId is provided", async () => {
    const hybridResult = makeHybridResult();
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn().mockResolvedValue(hybridResult);

    await handleMessage(
      { type: "mapFields", fields, profile },
      { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid }
    );

    expect(callHybrid).toHaveBeenCalledTimes(1);
  });

  it("prefers message.tabId over deps.tabId", async () => {
    const hybridResult = makeHybridResult();
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn().mockResolvedValue(hybridResult);

    await handleMessage(
      { type: "mapFields", fields, profile, tabId: 99 },
      {
        _loadLLMSettings: loadLLMSettings,
        _callHybrid: callHybrid,
        tabId: 42,
      }
    );

    const stored = getCached(cacheKey(99, fields));
    expect(stored).not.toBeNull();
    expect(getCached(cacheKey(42, fields))).toBeNull();
  });

  it("falls back to deps.tabId when message.tabId is undefined", async () => {
    const hybridResult = makeHybridResult();
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn().mockResolvedValue(hybridResult);

    await handleMessage(
      { type: "mapFields", fields, profile },
      {
        _loadLLMSettings: loadLLMSettings,
        _callHybrid: callHybrid,
        tabId: 55,
      }
    );

    const stored = getCached(cacheKey(55, fields));
    expect(stored).not.toBeNull();
  });
});

function makeMockPort(name = "awto-chat"): {
  port: chrome.runtime.Port;
  fireMessage: (msg: AwtoMessage) => void;
  fireDisconnect: () => void;
  posted: AwtoMessage[];
} {
  const messageListeners: Array<(msg: AwtoMessage) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const posted: AwtoMessage[] = [];
  const port = {
    name,
    onMessage: { addListener: (fn: (msg: AwtoMessage) => void) => messageListeners.push(fn) },
    onDisconnect: { addListener: (fn: () => void) => disconnectListeners.push(fn) },
    postMessage: (msg: AwtoMessage) => posted.push(msg),
    disconnect: () => disconnectListeners.forEach((fn) => fn()),
  } as unknown as chrome.runtime.Port;
  return {
    port,
    fireMessage: (msg) => messageListeners.forEach((fn) => fn(msg)),
    fireDisconnect: () => disconnectListeners.forEach((fn) => fn()),
    posted,
  };
}

it("supersedes the previous request when a new message arrives on the same port", async () => {
  const callHybrid = vi
    .fn()
    .mockImplementation(
      (_profile, _fields, opts: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          opts.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
          )
        )
    );
  const { port, fireMessage, posted } = makeMockPort();

  registerPortHandler(port, undefined, {
    _loadLLMSettings: vi.fn().mockResolvedValue(defaultSettings),
    _callHybrid: callHybrid,
  });

  fireMessage({ type: "mapFields", fields, profile: { custom: {} } });
  await Promise.resolve();
  fireMessage({ type: "mapFields", fields, profile: { custom: {} } });

  await new Promise((r) => setTimeout(r, 20));
  expect(callHybrid).toHaveBeenCalledTimes(2);
  expect(callHybrid.mock.calls[0]?.[2].signal.aborted).toBe(true);
  expect(posted).toEqual([]); // first call's superseded reply is suppressed; second is still pending
});

it("aborts the in-flight controller on port disconnect", async () => {
  const callHybrid = vi
    .fn()
    .mockImplementation(
      (_profile, _fields, opts: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          opts.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
          )
        )
    );
  const { port, fireMessage, fireDisconnect } = makeMockPort();

  registerPortHandler(port, undefined, {
    _loadLLMSettings: vi.fn().mockResolvedValue(defaultSettings),
    _callHybrid: callHybrid,
  });

  fireMessage({ type: "mapFields", fields, profile: { custom: {} } });
  await Promise.resolve();
  fireDisconnect();
  await new Promise((r) => setTimeout(r, 20));

  expect(callHybrid.mock.calls[0]?.[2].signal.aborted).toBe(true);
});

it("calls chrome.action.openPopup on openPopup message", async () => {
  const openPopup = vi.fn().mockResolvedValue(undefined);
  (globalThis as unknown as { chrome: typeof chrome }).chrome = {
    ...(globalThis as unknown as { chrome: typeof chrome }).chrome,
    action: { openPopup } as unknown as typeof chrome.action,
  };

  const reply = await handleMessage({ type: "openPopup" });

  expect(openPopup).toHaveBeenCalled();
  expect(reply).toEqual({ type: "openPopupResult", ok: true });
});

it("returns openPopupResult ok=false when chrome.action.openPopup rejects", async () => {
  const openPopup = vi.fn().mockRejectedValue(new Error("no active tab"));
  (globalThis as unknown as { chrome: typeof chrome }).chrome = {
    ...(globalThis as unknown as { chrome: typeof chrome }).chrome,
    action: { openPopup } as unknown as typeof chrome.action,
  };

  const reply = await handleMessage({ type: "openPopup" });
  expect(reply).toEqual({ type: "openPopupResult", ok: false, error: "no active tab" });
});
