import type { AwtoMessage } from "@/shared/messages";
import { loadLLMSettings, type LLMSettings } from "@/shared/storage";
import { callHybrid, type HybridResult } from "./llm/hybrid";
import { pingOllama } from "./llm/local";

export type LoadLLMSettingsFn = () => Promise<LLMSettings>;
export type CallHybridFn = typeof callHybrid;
export type PingOllamaFn = typeof pingOllama;

export interface HandleMessageDeps {
  _loadLLMSettings?: LoadLLMSettingsFn;
  _callHybrid?: CallHybridFn;
  _pingOllama?: PingOllamaFn;
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
        const result = await ping(settings.ollamaUrl);
        return {
          type: "testOllamaResult",
          ok: result.ok,
          error: result.error,
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
