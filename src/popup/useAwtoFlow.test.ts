import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { AwtoMessage, ScannedField } from "@/shared/messages";
import type { FieldMapping } from "@/shared/mapping";
import type { Profile } from "@/shared/profile";

(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    onMessage: { addListener: vi.fn() },
    lastError: undefined,
    connect: vi.fn(),
  },
  tabs: { query: vi.fn(), sendMessage: vi.fn() },
  storage: { local: { get: vi.fn(), set: vi.fn() } },
};

const { useAwtoFlow } = await import("./useAwtoFlow");

const fields: ScannedField[] = [
  {
    id: 0,
    selector: "#fname",
    label: "First name",
    placeholder: null,
    type: "text",
    required: true,
  },
  {
    id: 1,
    selector: "#favcolor",
    label: "Favourite colour",
    placeholder: null,
    type: "text",
    required: false,
  },
  {
    id: 2,
    selector: "#ssn",
    label: "SSN",
    placeholder: null,
    type: "text",
    required: false,
  },
];

const mappings: FieldMapping[] = [
  {
    fieldId: 0,
    actionType: "fill",
    profileKey: "firstName",
    suggestedKey: null,
    promptText: null,
    reason: null,
    confidence: 0.97,
  },
  {
    fieldId: 1,
    actionType: "missing",
    profileKey: null,
    suggestedKey: "favouriteColour",
    promptText: "What's your favourite colour?",
    reason: null,
    confidence: 0.9,
  },
  {
    fieldId: 2,
    actionType: "skip",
    profileKey: null,
    suggestedKey: null,
    promptText: null,
    reason: "Sensitive identifier",
    confidence: 0.5,
  },
];

const baseProfile: Profile = { firstName: "Patrick", custom: {} };

interface FakePort {
  name: string;
  onMessage: { addListener: (fn: (msg: AwtoMessage) => void) => void };
  onDisconnect: { addListener: (fn: () => void) => void };
  postMessage: (msg: AwtoMessage) => void;
  disconnect: () => void;
}

interface PortHandle {
  port: FakePort;
  messageListeners: Array<(msg: AwtoMessage) => void>;
  disconnectListeners: Array<() => void>;
  posted: AwtoMessage[];
  disconnected: { value: boolean };
  /** Auto-reply to mapFields with a mapFieldsResult. */
  autoReply: (reply: AwtoMessage) => void;
}

function makePort(): PortHandle {
  const messageListeners: Array<(msg: AwtoMessage) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const posted: AwtoMessage[] = [];
  const disconnected = { value: false };
  const port: FakePort = {
    name: "awto-chat",
    onMessage: {
      addListener: (fn) => {
        messageListeners.push(fn);
      },
    },
    onDisconnect: {
      addListener: (fn) => {
        disconnectListeners.push(fn);
      },
    },
    postMessage: (msg) => {
      posted.push(msg);
    },
    disconnect: () => {
      disconnected.value = true;
      for (const fn of disconnectListeners) fn();
    },
  };
  return {
    port,
    messageListeners,
    disconnectListeners,
    posted,
    disconnected,
    autoReply: (reply) => {
      for (const fn of messageListeners) fn(reply);
    },
  };
}

interface DepBag {
  queryActiveTab: ReturnType<typeof vi.fn>;
  sendToTab: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  loadProfile: ReturnType<typeof vi.fn>;
  saveProfile: ReturnType<typeof vi.fn>;
  closePopup: ReturnType<typeof vi.fn>;
  portHandle: PortHandle;
  /** Reply that the port should send back on mapFields. */
  mapReply: AwtoMessage;
}

function makeDeps(
  overrides: Partial<
    Omit<DepBag, "connect" | "portHandle"> & {
      portHandle?: PortHandle;
      mapReply?: AwtoMessage;
    }
  > = {}
): DepBag {
  const portHandle = overrides.portHandle ?? makePort();
  const mapReply: AwtoMessage =
    overrides.mapReply ??
    ({
      type: "mapFieldsResult",
      mappings,
      source: "local",
    } satisfies AwtoMessage);

  // Auto-respond to any mapFields postMessage via the port's message listeners.
  const originalPost = portHandle.port.postMessage;
  portHandle.port.postMessage = (msg: AwtoMessage) => {
    originalPost(msg);
    if (msg.type === "mapFields") {
      // Defer so the effect that registers the message listener has run.
      queueMicrotask(() => portHandle.autoReply(mapReply));
    }
  };

  return {
    queryActiveTab:
      overrides.queryActiveTab ?? vi.fn().mockResolvedValue({ id: 42 }),
    sendToTab:
      overrides.sendToTab ??
      vi.fn().mockImplementation(async (_tabId: number, msg: AwtoMessage) => {
        if (msg.type === "scanForm") {
          return { type: "scanFormResult", fields } satisfies AwtoMessage;
        }
        if (msg.type === "fillForm") {
          return {
            type: "fillFormResult",
            filled: msg.values.length,
            failed: [],
          } satisfies AwtoMessage;
        }
        throw new Error(`unexpected tab message: ${msg.type}`);
      }),
    connect: vi.fn(() => portHandle.port),
    loadProfile: overrides.loadProfile ?? vi.fn().mockResolvedValue(baseProfile),
    saveProfile: overrides.saveProfile ?? vi.fn().mockResolvedValue(undefined),
    closePopup: overrides.closePopup ?? vi.fn(),
    portHandle,
    mapReply,
  };
}

function renderFlow(deps: DepBag) {
  return renderHook(() =>
    useAwtoFlow({
      _queryActiveTab: deps.queryActiveTab,
      _sendToTab: deps.sendToTab,
      _connect: deps.connect as unknown as typeof chrome.runtime.connect,
      _loadProfile: deps.loadProfile,
      _saveProfile: deps.saveProfile,
      _closePopup: deps.closePopup,
    })
  );
}

describe("useAwtoFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends scanForm to active tab's content script on mount", async () => {
    const deps = makeDeps();
    renderFlow(deps);

    await waitFor(() => {
      expect(deps.sendToTab).toHaveBeenCalledWith(42, { type: "scanForm" });
    });
  });

  it("transitions to no-form when scanForm reply has zero fields", async () => {
    const deps = makeDeps({
      sendToTab: vi.fn().mockResolvedValue({
        type: "scanFormResult",
        fields: [],
      } satisfies AwtoMessage),
    });
    const { result } = renderFlow(deps);

    await waitFor(() => {
      expect(result.current.status).toBe("no-form");
    });
    expect(
      deps.portHandle.posted.some((m) => m.type === "mapFields")
    ).toBe(false);
  });

  it("connects to background via port and posts mapFields on scanForm result", async () => {
    const deps = makeDeps();
    renderFlow(deps);

    await waitFor(() => {
      expect(
        deps.portHandle.posted.some((m) => m.type === "mapFields")
      ).toBe(true);
    });
    expect(deps.connect).toHaveBeenCalledWith({ name: "awto-chat" });
    const mapMsg = deps.portHandle.posted.find(
      (m) => m.type === "mapFields"
    ) as Extract<AwtoMessage, { type: "mapFields" }>;
    expect(mapMsg.fields).toEqual(fields);
    expect(mapMsg.profile).toEqual(baseProfile);
    expect(mapMsg.tabId).toBe(42);
  });

  it("transitions to ready with categorised rows on mapFields success", async () => {
    const deps = makeDeps();
    const { result } = renderFlow(deps);

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.state.fillRows).toHaveLength(1);
    expect(result.current.state.fillRows[0]).toMatchObject({
      fieldId: 0,
      selector: "#fname",
      profileKey: "firstName",
      resolvedValue: "Patrick",
    });
    expect(result.current.state.missingRows).toHaveLength(1);
    expect(result.current.state.missingRows[0]).toMatchObject({
      fieldId: 1,
      suggestedKey: "favouriteColour",
      promptText: "What's your favourite colour?",
    });
    expect(result.current.state.skippedRows).toHaveLength(1);
    expect(result.current.state.skippedRows[0]).toMatchObject({
      fieldId: 2,
      reason: "Sensitive identifier",
    });
  });

  it("transitions to error with message when port replies with mapFieldsError", async () => {
    const deps = makeDeps({
      mapReply: {
        type: "mapFieldsError",
        error: "Local model offline",
      } satisfies AwtoMessage,
    });
    const { result } = renderFlow(deps);

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.state.error).toBe("Local model offline");
  });

  it("fill() sends fillForm with values from fillRows + missingRows and saves new profile fields", async () => {
    const deps = makeDeps();
    const { result } = renderFlow(deps);

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    act(() => {
      result.current.setMissingValue(1, "indigo");
    });

    await act(async () => {
      await result.current.fill();
    });

    expect(deps.saveProfile).toHaveBeenCalledTimes(1);
    const savedProfile = deps.saveProfile.mock.calls[0]?.[0] as Profile;
    expect(savedProfile.custom).toEqual({ favouriteColour: "indigo" });
    expect(savedProfile.firstName).toBe("Patrick");

    const fillCall = deps.sendToTab.mock.calls.find(
      (call) => (call[1] as AwtoMessage).type === "fillForm"
    );
    expect(fillCall).toBeDefined();
    const fillMsg = fillCall![1] as AwtoMessage & { type: "fillForm" };
    expect(fillMsg.values).toEqual([
      { selector: "#fname", value: "Patrick" },
      { selector: "#favcolor", value: "indigo" },
    ]);
    expect(result.current.status).toBe("done");
    expect(result.current.state.filledCount).toBe(2);
  });

  it("setOverrideValue updates the value the Fill flow will send", async () => {
    const deps = makeDeps();
    const { result } = renderFlow(deps);

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    act(() => {
      result.current.setOverrideValue(0, "Pat");
    });

    expect(result.current.state.fillRows[0]?.resolvedValue).toBe("Pat");

    await act(async () => {
      await result.current.fill();
    });

    const fillCall = deps.sendToTab.mock.calls.find(
      (call) => (call[1] as AwtoMessage).type === "fillForm"
    );
    const fillMsg = fillCall![1] as AwtoMessage & { type: "fillForm" };
    expect(fillMsg.values).toEqual([{ selector: "#fname", value: "Pat" }]);
  });

  it("resolves computed fullName mappings into a fillable value", async () => {
    const deps = makeDeps({
      loadProfile: vi.fn().mockResolvedValue({
        firstName: "Patrick",
        lastName: "Adrianus",
        custom: {},
      } satisfies Profile),
      mapReply: {
        type: "mapFieldsResult",
        source: "local",
        mappings: [
          {
            fieldId: 0,
            actionType: "fill",
            profileKey: "fullName",
            suggestedKey: null,
            promptText: null,
            reason: null,
            confidence: 1,
          },
        ],
      } satisfies AwtoMessage,
    });
    const { result } = renderFlow(deps);

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    expect(result.current.state.fillRows[0]?.resolvedValue).toBe(
      "Patrick Adrianus"
    );
  });

  it("transitions to error when no active tab is found", async () => {
    const deps = makeDeps({
      queryActiveTab: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderFlow(deps);

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.state.error).toMatch(/no active tab/i);
  });

  it("does not save profile when no missing values were provided", async () => {
    const deps = makeDeps();
    const { result } = renderFlow(deps);

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    await act(async () => {
      await result.current.fill();
    });

    expect(deps.saveProfile).not.toHaveBeenCalled();
    expect(result.current.status).toBe("done");
  });

  it("populates failedFills when fillForm returns failed entries", async () => {
    const deps = makeDeps({
      sendToTab: vi
        .fn()
        .mockImplementation(async (_tabId: number, msg: AwtoMessage) => {
          if (msg.type === "scanForm") {
            return { type: "scanFormResult", fields } satisfies AwtoMessage;
          }
          if (msg.type === "fillForm") {
            return {
              type: "fillFormResult",
              filled: 0,
              failed: [
                { selector: "#fname", reason: "no matching option" },
              ],
            } satisfies AwtoMessage;
          }
          throw new Error(`unexpected tab message: ${msg.type}`);
        }),
    });
    const { result } = renderFlow(deps);

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    await act(async () => {
      await result.current.fill();
    });

    await waitFor(() => {
      expect(result.current.status).toBe("done");
    });
    expect(result.current.state.filledCount).toBe(0);
    expect(result.current.state.failedFills).toEqual([
      { fieldId: 0, label: "First name", reason: "no matching option" },
    ]);
    vi.useFakeTimers();
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(deps.closePopup).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("appends rows as mapFieldsProgress chunks arrive and finalizes on complete", async () => {
    const portHandle = makePort();
    // Suppress the auto-reply: pass an explicit reply that we'll override below.
    // We want to drive the port manually.
    const queryActiveTab = vi.fn().mockResolvedValue({ id: 42 });
    const sendToTab = vi
      .fn()
      .mockImplementation(async (_tabId: number, msg: AwtoMessage) => {
        if (msg.type === "scanForm") {
          return { type: "scanFormResult", fields } satisfies AwtoMessage;
        }
        throw new Error(`unexpected tab message: ${msg.type}`);
      });
    const loadProfileMock = vi.fn().mockResolvedValue(baseProfile);
    const saveProfileMock = vi.fn().mockResolvedValue(undefined);
    const closePopup = vi.fn();

    const { result } = renderHook(() =>
      useAwtoFlow({
        _connect: (() => portHandle.port) as unknown as typeof chrome.runtime.connect,
        _sendToTab: sendToTab,
        _queryActiveTab: queryActiveTab,
        _loadProfile: loadProfileMock,
        _saveProfile: saveProfileMock,
        _closePopup: closePopup,
      })
    );

    // Wait until the hook has posted mapFields.
    await waitFor(() => {
      expect(
        portHandle.posted.some((m) => m.type === "mapFields")
      ).toBe(true);
    });

    // Status should still be "mapping" since we haven't replied yet.
    expect(result.current.status).toBe("mapping");

    // Fire first progress chunk: fill row only.
    await act(async () => {
      portHandle.autoReply({
        type: "mapFieldsProgress",
        mappings: [mappings[0]!],
      });
    });

    expect(result.current.status).toBe("mapping");
    expect(result.current.state.fillRows).toHaveLength(1);
    expect(result.current.state.chunksCompleted).toBe(1);

    // Fire second progress chunk: missing row.
    await act(async () => {
      portHandle.autoReply({
        type: "mapFieldsProgress",
        mappings: [mappings[1]!],
      });
    });

    expect(result.current.status).toBe("mapping");
    expect(result.current.state.fillRows).toHaveLength(1);
    expect(result.current.state.missingRows).toHaveLength(1);
    expect(result.current.state.chunksCompleted).toBe(2);

    // Fire complete with final aggregated set.
    await act(async () => {
      portHandle.autoReply({
        type: "mapFieldsComplete",
        mappings,
        source: "local",
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.state.fillRows).toHaveLength(1);
    expect(result.current.state.missingRows).toHaveLength(1);
    expect(result.current.state.skippedRows).toHaveLength(1);
  });

  it("rescan() posts mapFields with bypassCache: true", async () => {
    const deps = makeDeps();
    const { result } = renderFlow(deps);

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    // Sanity: first mapFields call has no bypassCache.
    const firstMap = deps.portHandle.posted.find(
      (m) => m.type === "mapFields"
    ) as Extract<AwtoMessage, { type: "mapFields" }>;
    expect(firstMap.bypassCache).toBeUndefined();

    await act(async () => {
      result.current.rescan();
      // Flush the auto-reply microtask queued by the test harness on
      // post so that the resulting state updates land inside act().
      await Promise.resolve();
    });

    // The rescan call should post a second mapFields with bypassCache.
    const mapCalls = deps.portHandle.posted.filter(
      (m) => m.type === "mapFields"
    ) as Array<Extract<AwtoMessage, { type: "mapFields" }>>;
    expect(mapCalls).toHaveLength(2);
    expect(mapCalls[1]?.bypassCache).toBe(true);
    expect(mapCalls[1]?.tabId).toBe(42);
    expect(mapCalls[1]?.fields).toEqual(fields);
  });

  it("disconnects the port on unmount", async () => {
    let disconnected = false;
    const port = {
      name: "awto-chat",
      onMessage: { addListener: () => {} },
      onDisconnect: { addListener: () => {} },
      postMessage: () => {},
      disconnect: () => {
        disconnected = true;
      },
    };
    const connect = (() => port) as unknown as typeof chrome.runtime.connect;
    // Hoist deps out of the renderHook callback so their identities are
    // stable across re-renders; otherwise the run-effect's dep list churns
    // every render and triggers an infinite loop.
    const sendToTab = vi
      .fn()
      .mockResolvedValue({ type: "scanFormResult", fields: [] });
    const queryActiveTab = vi.fn().mockResolvedValue({ id: 1 });
    const loadProfileMock = vi.fn().mockResolvedValue({ custom: {} });
    const saveProfileMock = vi.fn().mockResolvedValue(undefined);
    const closePopup = vi.fn();
    const { result, unmount } = renderHook(() =>
      useAwtoFlow({
        _connect: connect,
        _sendToTab: sendToTab,
        _queryActiveTab: queryActiveTab,
        _loadProfile: loadProfileMock,
        _saveProfile: saveProfileMock,
        _closePopup: closePopup,
      })
    );

    // Let effects mount and the scan step settle before unmount.
    await waitFor(() => {
      expect(result.current.status).toBe("no-form");
    });

    unmount();
    expect(disconnected).toBe(true);
  });
});
