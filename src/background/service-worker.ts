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
  signal?: AbortSignal;
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
          { ...settings, signal: deps.signal }
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

export function registerPortHandler(
  port: chrome.runtime.Port,
  baseDeps: HandleMessageDeps = {}
) {
  let controller: AbortController | null = null;

  port.onMessage.addListener(async (message: AwtoMessage) => {
    controller?.abort("superseded");
    const next = new AbortController();
    controller = next;

    try {
      const reply = await handleMessage(message, { ...baseDeps, signal: next.signal });
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
  registerPortHandler(port);
});

chrome.runtime.onInstalled?.addListener((details) => {
  if (details.reason === "install") {
    void chrome.runtime.openOptionsPage();
  }
});
