import type { AwtoMessage } from "@/shared/messages";
import { loadLLMSettings, type LLMSettings } from "@/shared/storage";
import { callHybrid, type HybridResult } from "./llm/hybrid";
import { pingOllama, listOllamaModels } from "./llm/local";

export type LoadLLMSettingsFn = () => Promise<LLMSettings>;
export type CallHybridFn = typeof callHybrid;
export type PingOllamaFn = typeof pingOllama;
export type ListOllamaModelsFn = typeof listOllamaModels;

export interface HandleMessageDeps {
  _loadLLMSettings?: LoadLLMSettingsFn;
  _callHybrid?: CallHybridFn;
  _pingOllama?: PingOllamaFn;
  _listOllamaModels?: ListOllamaModelsFn;
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
      try {
        const settings = await loadSettings();
        const result: HybridResult = await hybrid(
          message.profile,
          message.fields,
          settings
        );
        return {
          type: "mapFieldsResult",
          mappings: result.response.mappings,
          source: result.source,
        };
      } catch (err) {
        const errorMessage = errorToMessage(err);
        console.error("Awto: mapFields failed:", errorMessage);
        return { type: "mapFieldsError", error: errorMessage };
      }
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

chrome.runtime.onInstalled?.addListener((details) => {
  if (details.reason === "install") {
    void chrome.runtime.openOptionsPage();
  }
});
