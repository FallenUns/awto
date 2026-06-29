# Ollama model catalog, in-app download/delete, and troubleshooting docs

**Date:** 2026-06-30
**Status:** Approved
**Related code:** `src/options/model-catalog.ts` (new), `src/options/ollama-manage.ts` (new), `src/options/ModelCatalog.tsx` (new), `src/options/LLMTab.tsx`, `src/options/useOptionsState.ts`, `src/options/styles.css`, `src/shared/storage.ts`, `src/popup/Popup.tsx` (or its banner area), `docs/TROUBLESHOOTING.md` (new), `README.md`

## Context

Awto's local model defaults to `llama3.2:3b`. Decision #18 fixed the malformed-output crash, but the 3B model is genuinely weak at structured output on complex forms. The user wants a richer model picker in Options:

- A **curated catalog** of current Ollama models, split into **recommended** vs **heavy / hardware-dependent** tiers, with a clear disclaimer that heavy models may not work on under-spec machines.
- Ability to **download (pull)** a model from the catalog with live progress, and **delete** installed models — all from the app.
- Keep a **custom model** free-text entry for anything not in the catalog.
- A **troubleshooting doc** linked from the app (and hosted on GitHub) with step-by-step debugging.

Current `LLMTab.tsx` already auto-runs `testOllama` on mount and renders a `<select>` of installed models (`/api/tags`) plus a "Custom…" free-text. This feature replaces that single field with a richer catalog component and adds pull/delete.

## Decisions

| Question | Decision |
|---|---|
| Catalog source | **Static, bundled list** in `model-catalog.ts`. Ollama has no API to enumerate its library, so the catalog is curated and version-controlled, merged at runtime with `/api/tags` (installed) and `navigator.deviceMemory` (RAM hint). |
| Which models | General-purpose **instruct/chat** models only. Reasoning models (deepseek-r1, qwen-QwQ) are **excluded** — their `<think>` output breaks structured JSON. Grounded in ollama.com/library (verified 2026-06-30). Light: `llama3.2:3b`, `gemma3:4b`, `qwen2.5:3b`. Balanced: `qwen2.5:7b` (★ recommended — strongest structured-output at this size), `llama3.1:8b`, `mistral:7b`. Heavy: `phi4:14b`, `qwen2.5:14b`, `gemma3:27b`, `qwen2.5:32b`. |
| Default model | **Keep `llama3.2:3b`** as the packaged default (light, matches the README pull step, never a broken first run). The catalog marks `qwen2.5:7b` as ★ Recommended and makes upgrading one click. No change to `DEFAULT_LLM_SETTINGS.ollamaModel`. |
| Manage actions | **Download + Delete.** Pull with live progress; delete an installed model behind a typed-free confirm (destructive-action convention). |
| Where pull/delete run | **From the Options page directly** (not the service worker). A pull takes minutes and MV3 service workers terminate when idle (~30s), which would kill it. The Options page stays alive while open and fetches `localhost:11434` directly (host permission already present; same `chrome-extension://` origin already allow-listed via `OLLAMA_ORIGINS`). |
| Hardware guidance | **Static tier per model + soft RAM hint.** `navigator.deviceMemory` (Chrome, approximate, capped at 8 GB) flags models whose `ramGB` exceeds the estimate with an amber warning. A persistent disclaimer sits on the Heavy group. We cannot read true RAM/GPU, so models are never *blocked* — only warned. |
| Disclaimers — two surfaces | (1) **Settings**: per-model amber flag + a Heavy-group disclaimer banner. (2) **App window (popup)**: a one-line amber banner when the *currently selected* model is flagged heavy-for-device, shown where the user actually fills forms. |
| Troubleshooting docs | New `docs/TROUBLESHOOTING.md` with step-by-step sections. Linked from the Options card footer and from popup/LLM error states to the **GitHub-hosted** copy (`https://github.com/FallenUns/awto/blob/main/docs/TROUBLESHOOTING.md`). |
| Custom URL caveat | Pull/delete target `settings.ollamaUrl`. Only `http://localhost:11434/*` is in `host_permissions`, so a custom non-localhost URL may be blocked for direct page fetch — surfaced as an actionable error. Out of scope to request extra host permissions in v1. |
| Full UI redesign | **Out of scope.** The user wants a later full visual redesign; this feature ships the catalog with the current design system and a structure that a redesign can restyle. |

## Architecture

```
                ┌── model-catalog.ts (static data + helpers)
                │      CATALOG[], tierOf(), fitsHardware(model, deviceMemory)
ModelCatalog.tsx ┼── /api/tags (installed)  ── via existing testOllama / listModels
   (Options)     │── navigator.deviceMemory (RAM hint)
                └── ollama-manage.ts ── pullModel() / deleteModel()  (direct fetch, streaming)
                                          │
Popup banner ←── selected model + deviceMemory (heavy-for-device warning)
```

### Units

- **`src/options/model-catalog.ts`** (pure, testable)
  ```ts
  export type ModelTier = "light" | "balanced" | "heavy";
  export interface CatalogModel {
    id: string;          // pull id, e.g. "qwen2.5:7b"
    displayName: string; // "Qwen 2.5 7B"
    params: string;      // "7B"
    downloadGB: number;  // approx, for display
    ramGB: number;       // recommended RAM, drives the soft hint
    tier: ModelTier;
    recommended: boolean;
    blurb: string;
  }
  export const MODEL_CATALOG: CatalogModel[];
  export function findCatalogModel(id: string): CatalogModel | undefined;
  export function isHeavyForDevice(model: CatalogModel, deviceMemoryGB: number | undefined): boolean;
  // true when deviceMemoryGB is known and model.ramGB > deviceMemoryGB
  ```

- **`src/options/ollama-manage.ts`** (page-context fetch; testable with a mocked streaming `fetch`)
  ```ts
  export interface PullProgress { status: string; completedBytes?: number; totalBytes?: number; percent?: number; }
  export async function pullModel(
    ollamaUrl: string, model: string,
    opts: { onProgress: (p: PullProgress) => void; signal?: AbortSignal }
  ): Promise<void>;   // POST /api/pull {stream:true}, parse NDJSON lines, map 403 -> OLLAMA_ORIGINS help
  export async function deleteModel(ollamaUrl: string, model: string): Promise<void>; // DELETE /api/delete
  ```
  NDJSON parsing: read `response.body.getReader()`, split on `\n`, `JSON.parse` each non-empty line, compute `percent = completed/total*100` when both present. Resolve on stream end; reject on a line with an `error` field or a non-OK status.

- **`src/options/ModelCatalog.tsx`** — the card. Props: `{ settings, installedModels, onSelectModel, ollamaUrl, onModelsChanged }`. Owns local pull/delete state (per-model `idle | downloading{percent} | deleting | error`). Renders: device-RAM chip, Recommended group, Heavy group (with disclaimer), per-model row (badges, size, RAM, install state, Download/Cancel/Delete/select), custom input, troubleshooting link. Replaces the model-name field block currently in `LLMTab.tsx`.

- **Popup banner** — in `Popup.tsx` (or its header area): when `findCatalogModel(settings.ollamaModel)` is heavy-for-device, render a one-line amber banner linking to the troubleshooting doc. Reads `navigator.deviceMemory` and the stored model; no new message types.

### Data flow

1. On mount, `ModelCatalog` gets installed models from the existing `testOllama` round-trip (already wired in `LLMTab`). It reads `navigator.deviceMemory` once.
2. **Select**: clicking an installed model calls `onUpdate({ ollamaModel: id })` (existing settings path). Selecting a not-installed model first requires a download.
3. **Download**: `pullModel(ollamaUrl, id, {onProgress, signal})` streams progress into row state. On success → refresh installed list (re-run `testOllama`) → auto-select the model. AbortController wired to a Cancel button.
4. **Delete**: confirm → `deleteModel` → refresh installed list. If the deleted model was selected, fall back selection to `llama3.2:3b` (or the first installed).

### Error handling

- 403 on pull/delete → reuse `OLLAMA_ORIGINS_HELP` text (extract a shared copy so both `local.ts` and `ollama-manage.ts` use it).
- Unreachable / network error → inline row error + a "Troubleshooting guide" link.
- Pull line with `error` field (e.g. "model not found") → inline error.
- Custom non-localhost URL fetch blocked → message naming the host-permission limitation.

## Testing

- **`model-catalog.test.ts`**: catalog integrity (every entry has all fields; recommended is exactly one; ids unique); `isHeavyForDevice` truth table (unknown memory → false; ramGB ≤ device → false; ramGB > device → true); `findCatalogModel`.
- **`ollama-manage.test.ts`**: `pullModel` parses a chunked NDJSON stream (mock `fetch` returning a `ReadableStream`), reports increasing percent, resolves on completion; maps 403 → OLLAMA_ORIGINS help; rejects on an `error` line; `signal` abort stops reading. `deleteModel` issues DELETE and throws on non-OK.
- **`ModelCatalog.test.tsx`**: renders Recommended + Heavy groups; a not-installed model shows Download; clicking Download invokes the injected pull fn and renders progress; an installed model shows In-use/Delete; heavy-for-device model shows the amber warning; custom input updates the model; troubleshooting link points at the GitHub URL.
- **Popup banner test**: heavy-for-device selected model renders the banner; light model does not.
- Full suite + `tsc` + build remain green.

## Acceptance

- Options shows a grouped catalog; recommended models are visually distinct from heavy ones.
- A model can be downloaded from the app with a live progress bar and canceled mid-pull.
- An installed model can be deleted behind a confirm.
- A custom model id can still be entered and used.
- Heavy-for-device models are warned (settings + popup), never blocked.
- `docs/TROUBLESHOOTING.md` exists and is linked from the app to its GitHub URL.
- Default packaged model stays `llama3.2:3b`; no broken first run.
