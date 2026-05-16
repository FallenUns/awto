import { useCallback, useEffect, useRef, useState } from "react";
import type { AwtoMessage, ScannedField } from "@/shared/messages";
import {
  isFillMapping,
  isMissingMapping,
  isSkipMapping,
  type FieldMapping,
} from "@/shared/mapping";
import {
  EMPTY_PROFILE,
  getProfileValue,
  setProfileValue,
  type Profile,
} from "@/shared/profile";
import { loadProfile, saveProfile } from "@/shared/storage";
import type {
  FillRow,
  FlowState,
  FlowStatus,
  MissingRow,
  SkippedRow,
} from "./types";

export interface UseAwtoFlowDeps {
  _queryActiveTab?: () => Promise<{ id?: number } | undefined>;
  _sendToTab?: (tabId: number, message: AwtoMessage) => Promise<AwtoMessage>;
  _connect?: typeof chrome.runtime.connect;
  _loadProfile?: () => Promise<Profile>;
  _saveProfile?: (profile: Profile) => Promise<void>;
  _closePopup?: () => void;
}

const INITIAL_STATE: FlowState = {
  status: "scanning",
  error: null,
  fields: [],
  mappings: [],
  fillRows: [],
  missingRows: [],
  skippedRows: [],
  filledCount: 0,
};

function defaultQueryActiveTab(): Promise<{ id?: number } | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]);
    });
  });
}

function defaultSendToTab(
  tabId: number,
  message: AwtoMessage
): Promise<AwtoMessage> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: AwtoMessage) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message ?? "Tab message failed"));
        return;
      }
      resolve(response);
    });
  });
}

function defaultClosePopup(): void {
  window.close();
}

function buildRows(
  fields: ScannedField[],
  mappings: FieldMapping[],
  profile: Profile
): { fillRows: FillRow[]; missingRows: MissingRow[]; skippedRows: SkippedRow[] } {
  const fieldsById = new Map<number, ScannedField>();
  for (const field of fields) fieldsById.set(field.id, field);

  const fillRows: FillRow[] = [];
  const missingRows: MissingRow[] = [];
  const skippedRows: SkippedRow[] = [];

  for (const mapping of mappings) {
    const field = fieldsById.get(mapping.fieldId);
    if (!field) continue;
    if (isFillMapping(mapping)) {
      const value = getProfileValue(profile, mapping.profileKey) ?? "";
      fillRows.push({
        fieldId: mapping.fieldId,
        selector: field.selector,
        label: field.label,
        profileKey: mapping.profileKey,
        resolvedValue: value,
        confidence: mapping.confidence,
      });
    } else if (isMissingMapping(mapping)) {
      missingRows.push({
        fieldId: mapping.fieldId,
        selector: field.selector,
        label: field.label,
        suggestedKey: mapping.suggestedKey,
        promptText: mapping.promptText,
        userValue: "",
      });
    } else if (isSkipMapping(mapping)) {
      skippedRows.push({
        fieldId: mapping.fieldId,
        label: field.label,
        reason: mapping.reason,
      });
    }
  }

  return { fillRows, missingRows, skippedRows };
}

export interface UseAwtoFlowResult {
  state: FlowState;
  status: FlowStatus;
  setOverrideValue: (fieldId: number, value: string) => void;
  setMissingValue: (fieldId: number, value: string) => void;
  fill: () => Promise<void>;
  retry: () => void;
  cancel: () => void;
}

export function useAwtoFlow(deps: UseAwtoFlowDeps = {}): UseAwtoFlowResult {
  const queryActiveTab = deps._queryActiveTab ?? defaultQueryActiveTab;
  const sendToTab = deps._sendToTab ?? defaultSendToTab;
  const connectFn: typeof chrome.runtime.connect =
    deps._connect ?? chrome.runtime.connect.bind(chrome.runtime);
  const loadProfileFn = deps._loadProfile ?? loadProfile;
  const saveProfileFn = deps._saveProfile ?? saveProfile;
  const closePopup = deps._closePopup ?? defaultClosePopup;

  const [state, setState] = useState<FlowState>(INITIAL_STATE);
  const [runId, setRunId] = useState(0);
  const profileRef = useRef<Profile>(EMPTY_PROFILE);
  const tabIdRef = useRef<number | null>(null);
  const stateRef = useRef<FlowState>(INITIAL_STATE);
  const fieldsRef = useRef<ScannedField[]>([]);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Establish the background port once. Messages from the port drive the
  // map step's state transitions (mapFieldsResult / mapFieldsError).
  useEffect(() => {
    const port = connectFn({ name: "awto-chat" });
    portRef.current = port;

    const onMessage = (msg: AwtoMessage) => {
      if (msg.type === "mapFieldsResult") {
        const profile = profileRef.current;
        const fields = fieldsRef.current;
        const { fillRows, missingRows, skippedRows } = buildRows(
          fields,
          msg.mappings,
          profile
        );
        setState({
          status: "ready",
          error: null,
          fields,
          mappings: msg.mappings,
          fillRows,
          missingRows,
          skippedRows,
          filledCount: 0,
        });
      } else if (msg.type === "mapFieldsError") {
        setState((s) => ({
          ...s,
          status: "error",
          error: msg.error,
        }));
      }
    };

    const onDisconnect = () => {
      portRef.current = null;
    };

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);

    return () => {
      try {
        port.disconnect();
      } catch {
        // ignore
      }
      portRef.current = null;
    };
    // connectFn is stable for the lifetime of the hook (DI from deps); we
    // intentionally only run this once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setState({ ...INITIAL_STATE, status: "scanning" });

      try {
        const tab = await queryActiveTab();
        if (cancelled) return;
        if (!tab || tab.id === undefined) {
          setState((s) => ({
            ...s,
            status: "error",
            error: "No active tab found.",
          }));
          return;
        }
        tabIdRef.current = tab.id;

        const scanReply = await sendToTab(tab.id, { type: "scanForm" });
        if (cancelled) return;
        if (scanReply.type !== "scanFormResult") {
          setState((s) => ({
            ...s,
            status: "error",
            error: "Unexpected reply from content script.",
          }));
          return;
        }
        const fields = scanReply.fields;
        if (fields.length === 0) {
          setState((s) => ({ ...s, status: "no-form", fields: [] }));
          return;
        }

        setState((s) => ({ ...s, status: "mapping", fields }));
        fieldsRef.current = fields;

        const profile = await loadProfileFn();
        if (cancelled) return;
        profileRef.current = profile;

        const port = portRef.current;
        if (!port) {
          setState((s) => ({
            ...s,
            status: "error",
            error: "Background channel unavailable.",
          }));
          return;
        }
        port.postMessage({
          type: "mapFields",
          fields,
          profile,
          tabId: tab.id,
        });
        // The reply arrives via the port.onMessage listener registered in
        // the connect-effect above.
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [runId, queryActiveTab, sendToTab, loadProfileFn]);

  const setOverrideValue = useCallback((fieldId: number, value: string) => {
    setState((s) => ({
      ...s,
      fillRows: s.fillRows.map((row) =>
        row.fieldId === fieldId ? { ...row, resolvedValue: value } : row
      ),
    }));
  }, []);

  const setMissingValue = useCallback((fieldId: number, value: string) => {
    setState((s) => ({
      ...s,
      missingRows: s.missingRows.map((row) =>
        row.fieldId === fieldId ? { ...row, userValue: value } : row
      ),
    }));
  }, []);

  const fill = useCallback(async () => {
    const tabId = tabIdRef.current;
    if (tabId === null) return;

    setState((s) => ({ ...s, status: "filling", error: null }));

    try {
      const current = stateRef.current;
      const values: Array<{ selector: string; value: string }> = [];

      for (const row of current.fillRows) {
        if (row.resolvedValue !== "") {
          values.push({ selector: row.selector, value: row.resolvedValue });
        }
      }

      let nextProfile = profileRef.current;
      let profileChanged = false;
      for (const row of current.missingRows) {
        const trimmed = row.userValue.trim();
        if (trimmed === "") continue;
        values.push({ selector: row.selector, value: trimmed });
        nextProfile = setProfileValue(nextProfile, row.suggestedKey, trimmed);
        profileChanged = true;
      }

      if (profileChanged) {
        await saveProfileFn(nextProfile);
        profileRef.current = nextProfile;
      }

      const reply = await sendToTab(tabId, { type: "fillForm", values });
      if (reply.type === "fillFormResult") {
        setState((s) => ({
          ...s,
          status: "done",
          filledCount: reply.filled,
        }));
      } else {
        setState((s) => ({
          ...s,
          status: "error",
          error: "Unexpected reply from content script during fill.",
        }));
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [sendToTab, saveProfileFn]);

  useEffect(() => {
    if (state.status !== "done") return;
    const timer = setTimeout(() => {
      closePopup();
    }, 1500);
    return () => clearTimeout(timer);
  }, [state.status, closePopup]);

  const retry = useCallback(() => {
    setRunId((n) => n + 1);
  }, []);

  const cancel = useCallback(() => {
    closePopup();
  }, [closePopup]);

  return {
    state,
    status: state.status,
    setOverrideValue,
    setMissingValue,
    fill,
    retry,
    cancel,
  };
}
