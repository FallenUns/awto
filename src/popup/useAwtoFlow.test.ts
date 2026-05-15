import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { AwtoMessage, ScannedField } from "@/shared/messages";
import type { FieldMapping } from "@/shared/mapping";
import type { Profile } from "@/shared/profile";

(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { onMessage: { addListener: vi.fn() }, lastError: undefined },
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

interface DepBag {
  queryActiveTab: ReturnType<typeof vi.fn>;
  sendToTab: ReturnType<typeof vi.fn>;
  sendToRuntime: ReturnType<typeof vi.fn>;
  loadProfile: ReturnType<typeof vi.fn>;
  saveProfile: ReturnType<typeof vi.fn>;
  closePopup: ReturnType<typeof vi.fn>;
}

function makeDeps(overrides: Partial<DepBag> = {}): DepBag {
  return {
    queryActiveTab: overrides.queryActiveTab ?? vi.fn().mockResolvedValue({ id: 42 }),
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
    sendToRuntime:
      overrides.sendToRuntime ??
      vi.fn().mockImplementation(async (msg: AwtoMessage) => {
        if (msg.type === "mapFields") {
          return {
            type: "mapFieldsResult",
            mappings,
            source: "local",
          } satisfies AwtoMessage;
        }
        throw new Error(`unexpected runtime message: ${msg.type}`);
      }),
    loadProfile: overrides.loadProfile ?? vi.fn().mockResolvedValue(baseProfile),
    saveProfile: overrides.saveProfile ?? vi.fn().mockResolvedValue(undefined),
    closePopup: overrides.closePopup ?? vi.fn(),
  };
}

function renderFlow(deps: DepBag) {
  return renderHook(() =>
    useAwtoFlow({
      _queryActiveTab: deps.queryActiveTab,
      _sendToTab: deps.sendToTab,
      _sendToRuntime: deps.sendToRuntime,
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
    expect(deps.sendToRuntime).not.toHaveBeenCalled();
  });

  it("sends mapFields to background when scanForm returns fields", async () => {
    const deps = makeDeps();
    renderFlow(deps);

    await waitFor(() => {
      expect(deps.sendToRuntime).toHaveBeenCalledTimes(1);
    });
    expect(deps.sendToRuntime).toHaveBeenCalledWith({
      type: "mapFields",
      fields,
      profile: baseProfile,
    });
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

  it("transitions to error with message when mapFields returns mapFieldsError", async () => {
    const deps = makeDeps({
      sendToRuntime: vi.fn().mockResolvedValue({
        type: "mapFieldsError",
        error: "Local model offline",
      } satisfies AwtoMessage),
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
});
