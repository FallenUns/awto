import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_PROFILE,
  isBuiltInKey,
  type BuiltInKey,
  type Profile,
} from "@/shared/profile";
import {
  DEFAULT_LLM_SETTINGS,
  loadLLMSettings,
  loadProfile,
  saveLLMSettings,
  saveProfile,
  type LLMSettings,
} from "@/shared/storage";
import type { AwtoMessage } from "@/shared/messages";

export interface UseOptionsStateDeps {
  _loadProfile?: () => Promise<Profile>;
  _saveProfile?: (profile: Profile) => Promise<void>;
  _loadLLMSettings?: () => Promise<LLMSettings>;
  _saveLLMSettings?: (settings: LLMSettings) => Promise<void>;
  _sendToRuntime?: (message: AwtoMessage) => Promise<AwtoMessage>;
  _debounceMs?: number;
}

export type SaveStatus = "idle" | "saving" | "saved";

export interface UseOptionsStateResult {
  profile: Profile;
  llmSettings: LLMSettings;
  loaded: boolean;
  profileSaveStatus: SaveStatus;
  llmSaveStatus: SaveStatus;
  updateProfile: (key: BuiltInKey, value: string) => void;
  clearProfileField: (key: BuiltInKey) => void;
  addCustomField: (key: string, value: string) => { ok: true } | { ok: false; error: string };
  updateCustomField: (key: string, value: string) => void;
  removeCustomField: (key: string) => void;
  replaceProfile: (next: Profile) => void;
  updateLLMSettings: (partial: Partial<LLMSettings>) => void;
  testOllamaConnection: () => Promise<TestOllamaConnectionResult>;
}

export interface TestOllamaConnectionResult {
  ok: boolean;
  error?: string;
  models?: string[];
  modelInstalled?: boolean;
}

function defaultSendToRuntime(message: AwtoMessage): Promise<AwtoMessage> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: AwtoMessage) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message ?? "Runtime message failed"));
        return;
      }
      resolve(response);
    });
  });
}

export function useOptionsState(
  deps: UseOptionsStateDeps = {}
): UseOptionsStateResult {
  const loadProfileFn = deps._loadProfile ?? loadProfile;
  const saveProfileFn = deps._saveProfile ?? saveProfile;
  const loadLLMFn = deps._loadLLMSettings ?? loadLLMSettings;
  const saveLLMFn = deps._saveLLMSettings ?? saveLLMSettings;
  const sendToRuntime = deps._sendToRuntime ?? defaultSendToRuntime;
  const debounceMs = deps._debounceMs ?? 500;

  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [llmSettings, setLLMSettings] = useState<LLMSettings>(DEFAULT_LLM_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [profileSaveStatus, setProfileSaveStatus] = useState<SaveStatus>("idle");
  const [llmSaveStatus, setLLMSaveStatus] = useState<SaveStatus>("idle");
  const profileRef = useRef<Profile>(EMPTY_PROFILE);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  const profileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const llmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const llmFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (profileTimer.current) clearTimeout(profileTimer.current);
      if (llmTimer.current) clearTimeout(llmTimer.current);
      if (savedFadeTimer.current) clearTimeout(savedFadeTimer.current);
      if (llmFadeTimer.current) clearTimeout(llmFadeTimer.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      const [p, s] = await Promise.all([loadProfileFn(), loadLLMFn()]);
      if (cancelled) return;
      setProfile(p);
      setLLMSettings(s);
      setLoaded(true);
    }
    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [loadProfileFn, loadLLMFn]);

  const scheduleProfileSave = useCallback(
    (next: Profile) => {
      if (profileTimer.current) clearTimeout(profileTimer.current);
      setProfileSaveStatus("saving");
      profileTimer.current = setTimeout(() => {
        void (async () => {
          try {
            await saveProfileFn(next);
            if (!mountedRef.current) return;
            setProfileSaveStatus("saved");
            if (savedFadeTimer.current) clearTimeout(savedFadeTimer.current);
            savedFadeTimer.current = setTimeout(() => {
              if (!mountedRef.current) return;
              setProfileSaveStatus("idle");
            }, 1000);
          } catch {
            if (!mountedRef.current) return;
            setProfileSaveStatus("idle");
          }
        })();
      }, debounceMs);
    },
    [saveProfileFn, debounceMs]
  );

  const scheduleLLMSave = useCallback(
    (next: LLMSettings) => {
      if (llmTimer.current) clearTimeout(llmTimer.current);
      setLLMSaveStatus("saving");
      llmTimer.current = setTimeout(() => {
        void (async () => {
          try {
            await saveLLMFn(next);
            if (!mountedRef.current) return;
            setLLMSaveStatus("saved");
            if (llmFadeTimer.current) clearTimeout(llmFadeTimer.current);
            llmFadeTimer.current = setTimeout(() => {
              if (!mountedRef.current) return;
              setLLMSaveStatus("idle");
            }, 1000);
          } catch {
            if (!mountedRef.current) return;
            setLLMSaveStatus("idle");
          }
        })();
      }, debounceMs);
    },
    [saveLLMFn, debounceMs]
  );

  const updateProfile = useCallback(
    (key: BuiltInKey, value: string) => {
      setProfile((prev) => {
        const next = { ...prev, [key]: value };
        scheduleProfileSave(next);
        return next;
      });
    },
    [scheduleProfileSave]
  );

  const clearProfileField = useCallback(
    (key: BuiltInKey) => {
      setProfile((prev) => {
        const next = { ...prev, [key]: undefined };
        scheduleProfileSave(next);
        return next;
      });
    },
    [scheduleProfileSave]
  );

  const addCustomField = useCallback(
    (key: string, value: string): { ok: true } | { ok: false; error: string } => {
      const trimmed = key.trim();
      if (trimmed === "") {
        return { ok: false, error: "Key cannot be empty." };
      }
      if (isBuiltInKey(trimmed)) {
        return {
          ok: false,
          error: `"${trimmed}" is a built-in field name. Pick a different key.`,
        };
      }
      const current = profileRef.current;
      if (Object.prototype.hasOwnProperty.call(current.custom, trimmed)) {
        return { ok: false, error: `"${trimmed}" already exists.` };
      }
      const next: Profile = {
        ...current,
        custom: { ...current.custom, [trimmed]: value },
      };
      profileRef.current = next;
      setProfile(next);
      scheduleProfileSave(next);
      return { ok: true };
    },
    [scheduleProfileSave]
  );

  const updateCustomField = useCallback(
    (key: string, value: string) => {
      setProfile((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev.custom, key)) return prev;
        const next: Profile = {
          ...prev,
          custom: { ...prev.custom, [key]: value },
        };
        scheduleProfileSave(next);
        return next;
      });
    },
    [scheduleProfileSave]
  );

  const removeCustomField = useCallback(
    (key: string) => {
      setProfile((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev.custom, key)) return prev;
        const nextCustom = { ...prev.custom };
        delete nextCustom[key];
        const next: Profile = { ...prev, custom: nextCustom };
        scheduleProfileSave(next);
        return next;
      });
    },
    [scheduleProfileSave]
  );

  const replaceProfile = useCallback(
    (next: Profile) => {
      setProfile(next);
      scheduleProfileSave(next);
    },
    [scheduleProfileSave]
  );

  const updateLLMSettings = useCallback(
    (partial: Partial<LLMSettings>) => {
      setLLMSettings((prev) => {
        const next = { ...prev, ...partial };
        scheduleLLMSave(next);
        return next;
      });
    },
    [scheduleLLMSave]
  );

  const testOllamaConnection = useCallback(async (): Promise<TestOllamaConnectionResult> => {
    const reply = await sendToRuntime({ type: "testOllama" });
    if (reply.type === "testOllamaResult") {
      return {
        ok: reply.ok,
        error: reply.error,
        models: reply.models,
        modelInstalled: reply.modelInstalled,
      };
    }
    return { ok: false, error: "Unexpected reply from background." };
  }, [sendToRuntime]);

  return {
    profile,
    llmSettings,
    loaded,
    profileSaveStatus,
    llmSaveStatus,
    updateProfile,
    clearProfileField,
    addCustomField,
    updateCustomField,
    removeCustomField,
    replaceProfile,
    updateLLMSettings,
    testOllamaConnection,
  };
}
