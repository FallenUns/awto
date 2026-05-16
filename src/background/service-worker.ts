import type { AwtoMessage } from "@/shared/messages";
import type { FieldMapping } from "@/shared/mapping";
import { loadLLMSettings, type LLMSettings } from "@/shared/storage";
import { callHybrid } from "./llm/hybrid";
import { pingOllama, listOllamaModels } from "./llm/local";
import { prefilter } from "./field-prefilter";
import { ruleMap } from "./rule-mapper";
import { chunkArray, runWithConcurrency } from "./concurrency";
import { cacheKey, getCached, setCached, invalidateTab } from "./result-cache";
import { sanitizeMappings } from "./mapping-safety";

export type LoadLLMSettingsFn = () => Promise<LLMSettings>;
export type CallHybridFn = typeof callHybrid;
export type PingOllamaFn = typeof pingOllama;
export type ListOllamaModelsFn = typeof listOllamaModels;

const CHUNK_SIZE = 10;
const MAX_CONCURRENCY = 4;

export interface HandleMessageDeps {
  _loadLLMSettings?: LoadLLMSettingsFn;
  _callHybrid?: CallHybridFn;
  _pingOllama?: PingOllamaFn;
  _listOllamaModels?: ListOllamaModelsFn;
  signal?: AbortSignal;
  tabId?: number;
  _port?: chrome.runtime.Port | null;
}

function errorToMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function handleMessage(
  message: AwtoMessage,
  deps: HandleMessageDeps = {}
): Promise<AwtoMessage> {
  const loadSettings = deps._loadLLMSettings ?? loadLLMSettings;
  const hybrid = deps._callHybrid ?? callHybrid;
  const ping = deps._pingOllama ?? pingOllama;
  const listModels = deps._listOllamaModels ?? listOllamaModels;

  switch (message.type) {
    case "mapFields": {
      const tabId = message.tabId ?? deps.tabId;

      // Cache lookup (skipped when bypassCache=true)
      if (tabId !== undefined && !message.bypassCache) {
        const key = cacheKey(tabId, message.fields);
        const cached = getCached(key);
        if (cached) {
          return {
            type: "mapFieldsResult",
            mappings: cached.mappings,
            source: cached.source,
          };
        }
      }

      // Rule layer (autocomplete-tagged fields resolved deterministically)
      const { ruleMappings, remaining } = ruleMap(message.fields, message.profile);

      // Existing prefilter on the remaining set (checkboxes/radios → skip)
      const { toLLM, skipped: preSkipped } = prefilter(remaining, message.profile);

      // Stream initial deterministic mappings to the popup if there's a port
      if (deps._port && ruleMappings.length + preSkipped.length > 0) {
        const initial = [...ruleMappings, ...preSkipped].sort(
          (a, b) => a.fieldId - b.fieldId
        );
        deps._port.postMessage({
          type: "mapFieldsProgress",
          mappings: initial,
        });
      }

      const llmMappings: FieldMapping[] = [];
      const sources = new Set<"local" | "cloud" | "mixed">();

      try {
        if (toLLM.length > 0) {
          const settings = await loadSettings();
          const chunks = chunkArray(toLLM, CHUNK_SIZE);
          await runWithConcurrency(chunks, MAX_CONCURRENCY, async (chunk) => {
            const result = await hybrid(
              message.profile,
              chunk,
              { ...settings, signal: deps.signal }
            );
            const sanitized = sanitizeMappings(chunk, result.response.mappings);
            llmMappings.push(...sanitized);
            sources.add(result.source);
            if (deps._port) {
              deps._port.postMessage({
                type: "mapFieldsProgress",
                mappings: sanitized,
              });
            }
          });
        }
      } catch (err) {
        const errorMessage = errorToMessage(err);
        if (err instanceof Error && err.name === "AbortError") {
          return { type: "mapFieldsError", error: errorMessage };
        }
        console.error("Awto: mapFields failed:", errorMessage);
        return { type: "mapFieldsError", error: errorMessage };
      }

      const allMappings: FieldMapping[] = [
        ...ruleMappings,
        ...preSkipped,
        ...llmMappings,
      ].sort((a, b) => a.fieldId - b.fieldId);

      const source: "local" | "cloud" | "mixed" =
        sources.size > 1
          ? "mixed"
          : (sources.values().next().value ?? "local");

      if (tabId !== undefined) {
        setCached(cacheKey(tabId, message.fields), {
          mappings: allMappings,
          source,
        });
      }

      return {
        type: "mapFieldsComplete",
        mappings: allMappings,
        source,
      };
    }
    case "testOllama": {
      try {
        const settings = await loadSettings();
        const pingResult = await ping(settings.ollamaUrl);
        if (!pingResult.ok) {
          return {
            type: "testOllamaResult",
            ok: false,
            error: pingResult.error,
          };
        }
        const tags = await listModels(settings.ollamaUrl);
        if (!tags.ok) {
          return {
            type: "testOllamaResult",
            ok: true,
            error: tags.error,
          };
        }
        const models = tags.models ?? [];
        const modelInstalled = models.some(
          (m) => m === settings.ollamaModel || m.startsWith(`${settings.ollamaModel}:`)
        );
        return {
          type: "testOllamaResult",
          ok: true,
          models,
          modelInstalled,
        };
      } catch (err) {
        return {
          type: "testOllamaResult",
          ok: false,
          error: errorToMessage(err),
        };
      }
    }
    case "openPopup": {
      try {
        await chrome.action.openPopup();
        return { type: "openPopupResult", ok: true };
      } catch (err) {
        return { type: "openPopupResult", ok: false, error: errorToMessage(err) };
      }
    }
    default: {
      const unknownType = (message as { type: string }).type;
      console.warn("Awto: unknown message type", unknownType);
      return {
        type: "mapFieldsError",
        error: `Unknown message type: ${unknownType}`,
      };
    }
  }
}

chrome.runtime.onMessage.addListener((message: AwtoMessage, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => {
      sendResponse({ type: "mapFieldsError", error: errorToMessage(err) });
    });
  return true;
});

export function registerPortHandler(
  port: chrome.runtime.Port,
  tabId: number | undefined,
  baseDeps: HandleMessageDeps = {}
) {
  let controller: AbortController | null = null;

  port.onMessage.addListener(async (message: AwtoMessage) => {
    controller?.abort("superseded");
    const next = new AbortController();
    controller = next;

    try {
      const reply = await handleMessage(message, {
        ...baseDeps,
        tabId,
        signal: next.signal,
        _port: port,
      });
      if (!next.signal.aborted) port.postMessage(reply);
    } catch (err) {
      if (next.signal.aborted) return;
      port.postMessage({
        type: "mapFieldsError",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (controller === next) controller = null;
    }
  });

  port.onDisconnect.addListener(() => {
    controller?.abort("popup-closed");
    controller = null;
  });
}

chrome.runtime.onConnect?.addListener((port) => {
  if (port.name !== "awto-chat") return;
  const tabId = port.sender?.tab?.id;
  registerPortHandler(port, tabId);
});

chrome.runtime.onInstalled?.addListener((details) => {
  if (details.reason === "install") {
    void chrome.runtime.openOptionsPage();
  }
});

chrome.tabs?.onRemoved?.addListener((tabId) => {
  invalidateTab(tabId);
});
