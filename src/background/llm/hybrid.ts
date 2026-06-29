import type { LLMResponse } from "@/shared/mapping";
import type { Profile } from "@/shared/profile";
import type { ScannedField } from "@/shared/messages";
import { callLocal, type LocalCallOpts } from "./local";
import { callCloud, type CloudCallOpts } from "./cloud";
import type { PromptPageContext } from "@/shared/page-context";

export interface HybridCallOpts {
  ollamaUrl: string;
  ollamaModel: string;
  ollamaTimeoutMs?: number;
  anthropicApiKey: string;
  anthropicModel: string;
  cloudFallbackEnabled: boolean;
  confidenceThreshold: number;
  signal?: AbortSignal;
  claimedKeys?: string[];
  pageContext?: PromptPageContext;
}

export interface HybridResult {
  response: LLMResponse;
  source: "local" | "cloud" | "mixed";
  localError?: string;
}

export type CallLocalFn = (
  profile: Profile,
  fields: ScannedField[],
  opts: LocalCallOpts
) => Promise<LLMResponse>;

export type CallCloudFn = (
  profile: Profile,
  fields: ScannedField[],
  opts: CloudCallOpts
) => Promise<LLMResponse>;

export interface HybridDeps {
  _callLocal?: CallLocalFn;
  _callCloud?: CallCloudFn;
}

function allConfident(response: LLMResponse, threshold: number): boolean {
  return response.mappings.every((m) => m.confidence >= threshold);
}

function canEscalateToCloud(opts: HybridCallOpts): boolean {
  return opts.cloudFallbackEnabled && opts.anthropicApiKey.length > 0;
}

export async function callHybrid(
  profile: Profile,
  fields: ScannedField[],
  opts: HybridCallOpts,
  deps: HybridDeps = {}
): Promise<HybridResult> {
  const local = deps._callLocal ?? callLocal;
  const cloud = deps._callCloud ?? callCloud;

  const localOpts: LocalCallOpts = {
    ollamaUrl: opts.ollamaUrl,
    ollamaModel: opts.ollamaModel,
    timeoutMs: opts.ollamaTimeoutMs,
    signal: opts.signal,
    claimedKeys: opts.claimedKeys,
    pageContext: opts.pageContext,
  };
  const cloudOpts: CloudCallOpts = {
    anthropicApiKey: opts.anthropicApiKey,
    anthropicModel: opts.anthropicModel,
    signal: opts.signal,
    claimedKeys: opts.claimedKeys,
    pageContext: opts.pageContext,
  };

  let localResponse: LLMResponse | null = null;
  let localError: Error | null = null;

  try {
    localResponse = await local(profile, fields, localOpts);
  } catch (err) {
    localError = err instanceof Error ? err : new Error(String(err));
  }

  // If the external signal was already aborted, rethrow immediately instead of escalating to cloud
  if (opts.signal?.aborted) {
    throw localError ?? new Error("Aborted");
  }

  if (localResponse) {
    if (allConfident(localResponse, opts.confidenceThreshold)) {
      return { response: localResponse, source: "local" };
    }
    if (canEscalateToCloud(opts)) {
      try {
        const cloudResponse = await cloud(profile, fields, cloudOpts);
        return { response: cloudResponse, source: "cloud" };
      } catch {
        return { response: localResponse, source: "local" };
      }
    }
    return { response: localResponse, source: "local" };
  }

  if (canEscalateToCloud(opts)) {
    try {
      const cloudResponse = await cloud(profile, fields, cloudOpts);
      return {
        response: cloudResponse,
        source: "cloud",
        localError: localError?.message,
      };
    } catch (cloudErr) {
      const cloudMessage =
        cloudErr instanceof Error ? cloudErr.message : String(cloudErr);
      throw new Error(
        `Both local and cloud LLM calls failed. local: ${localError?.message ?? "unknown"}; cloud: ${cloudMessage}`
      );
    }
  }

  throw localError ?? new Error("Local LLM call failed");
}
