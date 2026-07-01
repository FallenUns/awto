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

const { handleMessage, registerPortHandler, dedupeFillsByProfileKey } = await import(
  "./service-worker"
);

const profile: Profile = { firstName: "Patrick", custom: { favouriteColour: "red" } };
const fields: ScannedField[] = [
  {
    id: 0,
    selector: "#unknown",
    label: "Favourite colour",
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
  cloudProvider: "anthropic",
  cloudApiKeys: {},
  cloudModels: {},
  cloudBaseUrl: "",
  cloudFallbackEnabled: true,
  enableAriaForms: true,
  confidenceThreshold: 0.7,
};

function makeHybridResult(): HybridResult {
  return {
    response: {
      mappings: [
        {
          fieldId: 0,
          actionType: "fill",
          profileKey: "favouriteColour",
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
  it("returns mapFieldsComplete on mapFields happy path", async () => {
    const hybridResult = makeHybridResult();
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn().mockResolvedValue(hybridResult);

    const message: AwtoMessage = { type: "mapFields", fields, profile };
    const response = await handleMessage(message, {
      _loadLLMSettings: loadLLMSettings,
      _callHybrid: callHybrid,
    });

    expect(response).toEqual({
      type: "mapFieldsComplete",
      mappings: hybridResult.response.mappings,
      source: "local",
    });
    expect(loadLLMSettings).toHaveBeenCalledTimes(1);
    expect(callHybrid).toHaveBeenCalledWith(
      profile,
      fields,
      expect.objectContaining({ ollamaUrl: defaultSettings.ollamaUrl })
    );
  });

  it("routes autocomplete-tagged fields through rule-mapper and skips hybrid for them", async () => {
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn().mockResolvedValue({
      response: { mappings: [] },
      source: "local",
    });

    const taggedFields: ScannedField[] = [
      {
        id: 0,
        selector: "#a",
        label: "First name",
        placeholder: null,
        type: "text",
        required: false,
        autocomplete: "given-name",
      },
      {
        id: 1,
        selector: "#b",
        label: "Mystery",
        placeholder: null,
        type: "text",
        required: false,
      },
    ];
    const profileWithName = { firstName: "Patrick", custom: {} };

    await handleMessage(
      { type: "mapFields", fields: taggedFields, profile: profileWithName },
      { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid }
    );

    expect(callHybrid).toHaveBeenCalledTimes(1);
    expect(callHybrid.mock.calls[0]?.[1]).toEqual([taggedFields[1]]);
  });

  it("maps IAG-style preferred first name and single address line from saved settings", async () => {
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn();
    const iagFields: ScannedField[] = [
      {
        id: 0,
        selector: "#preferredName",
        label: "Legal First Name",
        placeholder: null,
        type: "text",
        required: true,
        autocomplete: "off",
      },
      {
        id: 1,
        selector: "#firstName",
        label: "Preferred First Name",
        placeholder: null,
        type: "text",
        required: true,
        autocomplete: "given-name",
      },
      {
        id: 2,
        selector: "#address",
        label: "Address Line 1",
        placeholder: null,
        type: "text",
        required: true,
        autocomplete: "street-address",
      },
    ];
    const savedProfile: Profile = {
      firstName: "Patrick",
      preferredName: "Pat",
      unitNumber: "206",
      addressLine1: "327 La Trobe St",
      custom: {},
    };

    const response = await handleMessage(
      { type: "mapFields", fields: iagFields, profile: savedProfile },
      { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid }
    );

    expect(response.type).toBe("mapFieldsComplete");
    expect(callHybrid).not.toHaveBeenCalled();
    expect(loadLLMSettings).not.toHaveBeenCalled();
    if (response.type === "mapFieldsComplete") {
      expect(response.mappings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fieldId: 0,
            actionType: "fill",
            profileKey: "firstName",
          }),
          expect.objectContaining({
            fieldId: 1,
            actionType: "fill",
            profileKey: "preferredName",
          }),
          expect.objectContaining({
            fieldId: 2,
            actionType: "fill",
            profileKey: "addressLine1WithUnit",
          }),
        ])
      );
    }
  });

  it("sanitizes rule-mapper fills against trivia questions — Star Wars quiz regression", async () => {
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn().mockResolvedValue({
      response: { mappings: [] },
      source: "local",
    });

    const triviaFields: ScannedField[] = [
      {
        id: 0,
        selector: "#q1",
        label: "What was Luke Skywalker's original last name? 1 point",
        placeholder: null,
        type: "text",
        required: true,
      },
    ];
    const profileWithLastName = {
      firstName: "Patrick",
      lastName: "Adrianus",
      custom: {},
    };

    const response = await handleMessage(
      { type: "mapFields", fields: triviaFields, profile: profileWithLastName },
      { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid }
    );

    expect(response.type).toBe("mapFieldsComplete");
    if (response.type === "mapFieldsComplete") {
      const trivia = response.mappings.find((m) => m.fieldId === 0);
      expect(trivia).toMatchObject({
        actionType: "skip",
        reason: expect.stringMatching(/question about someone else/i),
      });
    }
  });

  it("does not call the LLM for a fully-recognized RoboForm-style page", async () => {
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn();
    const roboFields: ScannedField[] = [
      { id: 0, selector: "#title", label: "Title", placeholder: null, type: "text", required: false },
      { id: 1, selector: "#first", label: "First Name", placeholder: null, type: "text", required: false },
      { id: 2, selector: "#middle-initial", label: "Middle Initial", placeholder: null, type: "text", required: false },
      { id: 3, selector: "#last", label: "Last Name", placeholder: null, type: "text", required: false },
      { id: 4, selector: "#full", label: "Full Name", placeholder: null, type: "text", required: false },
      { id: 5, selector: "#city", label: "City", placeholder: null, type: "text", required: false },
      { id: 6, selector: "#sex", label: "Sex", placeholder: null, type: "text", required: false },
      { id: 7, selector: "#cc", label: "Credit Card Number", placeholder: null, type: "text", required: false },
      { id: 8, selector: "#dob-month", label: "Month", placeholder: null, type: "select", required: false, options: ["Month", "Jan"] },
      { id: 9, selector: "#age", label: "Age", placeholder: null, type: "text", required: false },
    ];
    const richProfile: Profile = {
      title: "Mr",
      firstName: "Patrick",
      lastName: "Adrianus",
      city: "Melbourne",
      gender: "Male",
      dateOfBirth: "2000-01-01",
      custom: {},
    };

    const response = await handleMessage(
      { type: "mapFields", fields: roboFields, profile: richProfile },
      { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid }
    );

    expect(response.type).toBe("mapFieldsComplete");
    expect(callHybrid).not.toHaveBeenCalled();
    expect(loadLLMSettings).not.toHaveBeenCalled();
    if (response.type === "mapFieldsComplete") {
      expect(response.mappings).toHaveLength(roboFields.length);
      expect(response.mappings.find((m) => m.fieldId === 6)).toMatchObject({
        actionType: "fill",
        profileKey: "gender",
      });
      expect(response.mappings.find((m) => m.fieldId === 7)).toMatchObject({
        actionType: "skip",
      });
      expect(response.mappings.find((m) => m.fieldId === 9)).toMatchObject({
        actionType: "fill",
        profileKey: "age",
      });
    }
  });

  it("does not allow the LLM to map delivery time to dateOfBirth", async () => {
    const deliveryFields: ScannedField[] = [
      {
        id: 0,
        selector: "#delivery-time",
        label: "Preferred delivery time",
        placeholder: null,
        type: "text",
        required: false,
      },
    ];
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn().mockResolvedValue({
      response: {
        mappings: [
          {
            fieldId: 0,
            actionType: "fill",
            profileKey: "dateOfBirth",
            suggestedKey: null,
            promptText: null,
            reason: null,
            confidence: 0.9,
          },
        ],
      },
      source: "local",
    } satisfies HybridResult);

    const response = await handleMessage(
      {
        type: "mapFields",
        fields: deliveryFields,
        profile: { dateOfBirth: "2000-01-01", custom: {} },
      },
      { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid }
    );

    expect(response).toMatchObject({
      type: "mapFieldsComplete",
      mappings: [
        {
          fieldId: 0,
          actionType: "missing",
          suggestedKey: "preferredDeliveryTime",
          promptText: "What's your preferred delivery time?",
        },
      ],
    });
  });

  it("bypassCache: true skips the cache lookup and re-runs hybrid", async () => {
    const hybridResult = makeHybridResult();
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn().mockResolvedValue(hybridResult);

    const { setCached, cacheKey, _clearCache } = await import("./result-cache");
    _clearCache();
    setCached(cacheKey(99, fields), { mappings: [], source: "cloud" });

    await handleMessage(
      { type: "mapFields", fields, profile, tabId: 99, bypassCache: true },
      { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid }
    );

    expect(callHybrid).toHaveBeenCalled();
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

describe("consent handling", () => {
  const consentFields: ScannedField[] = [
    { id: 0, selector: "#name", label: "First name", placeholder: null, type: "text", required: false, autocomplete: "given-name" },
    { id: 1, selector: "#promo", label: "Send me emails with helpful tips", placeholder: null, type: "checkbox", required: false },
    { id: 2, selector: "#terms", label: "I agree to the Terms of Service and Privacy Policy", placeholder: null, type: "checkbox", required: true },
  ];

  function portSpy(): { port: chrome.runtime.Port; posted: AwtoMessage[] } {
    const posted: AwtoMessage[] = [];
    const port = { postMessage: (m: AwtoMessage) => posted.push(m) } as unknown as chrome.runtime.Port;
    return { port, posted };
  }

  it("posts mapFieldsConsent and excludes consent checkboxes from the LLM", async () => {
    const { port, posted } = portSpy();
    const callHybrid = vi.fn().mockResolvedValue({ response: { mappings: [] }, source: "local" });

    await handleMessage(
      { type: "mapFields", fields: consentFields, profile: { firstName: "Patrick", custom: {} } },
      {
        _loadLLMSettings: vi.fn().mockResolvedValue(defaultSettings),
        _callHybrid: callHybrid,
        _getMarketingConsent: vi.fn().mockResolvedValue("optIn"),
        _port: port,
      }
    );

    const consentMsg = posted.find((m) => m.type === "mapFieldsConsent");
    expect(consentMsg).toBeDefined();
    if (consentMsg?.type === "mapFieldsConsent") {
      expect(consentMsg.consent.map((c) => c.fieldId)).toEqual([1, 2]);
      expect(consentMsg.consent[0]).toMatchObject({ consentType: "marketing", proposedChecked: true });
      expect(consentMsg.consent[1]).toMatchObject({ consentType: "legal", proposedChecked: false });
    }
    for (const call of callHybrid.mock.calls) {
      const ids = (call[1] as ScannedField[]).map((f) => f.id);
      expect(ids).not.toContain(1);
      expect(ids).not.toContain(2);
    }
  });

  it("backfills a skip for a non-consent field the LLM omits", async () => {
    const callHybrid = vi.fn().mockResolvedValue({ response: { mappings: [] }, source: "local" });
    const response = await handleMessage(
      {
        type: "mapFields",
        fields: [{ id: 0, selector: "#mystery", label: "Mystery field", placeholder: null, type: "text", required: false }],
        profile: { custom: {} },
      },
      { _loadLLMSettings: vi.fn().mockResolvedValue(defaultSettings), _callHybrid: callHybrid }
    );
    expect(response.type).toBe("mapFieldsComplete");
    if (response.type === "mapFieldsComplete") {
      expect(response.mappings).toEqual([
        { fieldId: 0, actionType: "skip", profileKey: null, suggestedKey: null, promptText: null, reason: "No matching profile field", confidence: 1 },
      ]);
    }
  });

  it("posts fresh consent on a cache hit", async () => {
    const { setCached, cacheKey, _clearCache } = await import("./result-cache");
    _clearCache();
    setCached(cacheKey(77, consentFields), { mappings: [], source: "cloud" });
    const { port, posted } = portSpy();

    const response = await handleMessage(
      { type: "mapFields", fields: consentFields, profile: { custom: {} }, tabId: 77 },
      { _getMarketingConsent: vi.fn().mockResolvedValue("optOut"), _port: port, _callHybrid: vi.fn() }
    );

    expect(response.type).toBe("mapFieldsResult");
    const consentMsg = posted.find((m) => m.type === "mapFieldsConsent");
    expect(consentMsg).toBeDefined();
    if (consentMsg?.type === "mapFieldsConsent") {
      expect(consentMsg.consent[0]).toMatchObject({ consentType: "marketing", proposedChecked: false });
    }
  });
});

describe("dedupeFillsByProfileKey", () => {
  const baseFill = (fieldId: number, profileKey: string) => ({
    fieldId,
    actionType: "fill" as const,
    profileKey,
    suggestedKey: null,
    promptText: null,
    reason: null,
    confidence: 1,
  });

  it("keeps the first fill for a given profile key and downgrades later duplicates to missing", () => {
    const result = dedupeFillsByProfileKey([
      baseFill(0, "phone"),
      baseFill(1, "phone"),
      baseFill(2, "phone"),
    ]);
    expect(result[0]).toMatchObject({ actionType: "fill", fieldId: 0 });
    expect(result[1]).toMatchObject({
      actionType: "missing",
      fieldId: 1,
      suggestedKey: "phone",
    });
    expect(result[2]).toMatchObject({
      actionType: "missing",
      fieldId: 2,
      suggestedKey: "phone",
    });
  });

  it("passes through fills with distinct profile keys", () => {
    const result = dedupeFillsByProfileKey([
      baseFill(0, "phone"),
      baseFill(1, "mobilePhone"),
      baseFill(2, "email"),
    ]);
    expect(result.every((m) => m.actionType === "fill")).toBe(true);
  });

  it("leaves missing/skip rows alone", () => {
    const input = [
      {
        fieldId: 0,
        actionType: "missing" as const,
        profileKey: null,
        suggestedKey: "userId",
        promptText: "What's your user ID?",
        reason: null,
        confidence: 1,
      },
      {
        fieldId: 1,
        actionType: "skip" as const,
        profileKey: null,
        suggestedKey: null,
        promptText: null,
        reason: "Sensitive credential — fill manually",
        confidence: 1,
      },
    ];
    expect(dedupeFillsByProfileKey(input)).toEqual(input);
  });
});
