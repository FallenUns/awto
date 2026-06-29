import type { AwtoMessage } from "@/shared/messages";
import type { FieldMapping } from "@/shared/mapping";
import { loadLLMSettings, getMarketingConsent, type LLMSettings } from "@/shared/storage";
import { buildConsentDecisions } from "./consent-classifier";
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
  _getMarketingConsent?: () => Promise<"optIn" | "optOut">;
}

function errorToMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function dedupeFillsByProfileKey(
  mappings: FieldMapping[]
): FieldMapping[] {
  const claimed = new Set<string>();
  return mappings.map((m) => {
    if (m.actionType !== "fill" || !m.profileKey) return m;
    if (!claimed.has(m.profileKey)) {
      claimed.add(m.profileKey);
      return m;
    }
    return {
      fieldId: m.fieldId,
      actionType: "missing",
      profileKey: null,
      suggestedKey: m.profileKey,
      promptText: `Same as another field — type a different value if you have one`,
      reason: null,
      confidence: 1,
    };
  });
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
      const getMktConsent = deps._getMarketingConsent ?? getMarketingConsent;

      const marketingPref = await getMktConsent();
      const { consent, consentIds } = buildConsentDecisions(
        message.fields,
        marketingPref
      );
      if (deps._port && consent.length > 0) {
        deps._port.postMessage({ type: "mapFieldsConsent", consent });
      }
      const llmFields = message.fields.filter((f) => !consentIds.has(f.id));

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
      const { ruleMappings: rawRuleMappings, remaining } = ruleMap(
        llmFields,
        message.profile
      );

      // Run the same safety guard on rule-mapper fills as we do on LLM fills.
      // The rule layer's LABEL_RULES can match "last name" inside quiz/trivia
      // questions like "What was Luke Skywalker's original last name?" — the
      // sanitizer's quiz detector + REQUIRE_LABEL_MATCH guard catches those.
      const ruleMappings = sanitizeMappings(llmFields, rawRuleMappings);

      // Existing prefilter on the remaining set (checkboxes/radios → skip)
      const { toLLM, skipped: preSkipped } = prefilter(remaining, message.profile);

      // Keys that the parser has already claimed — hint to the LLM not to reuse.
      const claimedKeys = Array.from(
        new Set(
          ruleMappings
            .filter((m) => m.actionType === "fill" && m.profileKey)
            .map((m) => m.profileKey as string)
        )
      );

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
              { ...settings, signal: deps.signal, claimedKeys, pageContext: message.pageContext }
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

      const collected: FieldMapping[] = [
        ...ruleMappings,
        ...preSkipped,
        ...llmMappings,
      ];
      const mappedIds = new Set(collected.map((m) => m.fieldId));
      for (const f of llmFields) {
        if (!mappedIds.has(f.id)) {
          collected.push({
            fieldId: f.id,
            actionType: "skip",
            profileKey: null,
            suggestedKey: null,
            promptText: null,
            reason: "No matching profile field",
            confidence: 1,
          });
        }
      }
      const allMappings: FieldMapping[] = dedupeFillsByProfileKey(
        collected.sort((a, b) => a.fieldId - b.fieldId)
      );

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
