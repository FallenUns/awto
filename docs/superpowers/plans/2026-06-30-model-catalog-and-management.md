# Ollama Model Catalog & Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain Ollama model field in Options with a curated, tiered catalog that can download (pull) and delete models in-app, warn about hardware fit, and link a troubleshooting doc.

**Architecture:** A pure `model-catalog.ts` (static data + helpers) drives a new `ModelCatalog.tsx` card; pull/delete stream from the Options page via `ollama-manage.ts` (not the MV3 worker). A popup banner and a `TROUBLESHOOTING.md` round it out.

**Tech Stack:** TypeScript, React, Vitest + happy-dom + @testing-library/react, Ollama HTTP API (`/api/pull`, `/api/delete`, `/api/tags`), `navigator.deviceMemory`.

## Global Constraints

- TDD: failing test first, watch it fail, minimal code, watch it pass, commit.
- No emojis as icons — Lucide SVGs only. Comment only non-obvious WHY. Touch targets ≥ 44px.
- Pull/delete run **from the Options page** (direct `fetch` to `settings.ollamaUrl`), never the service worker.
- Heavy models are **warned, never blocked**. `navigator.deviceMemory` is approximate (Chrome, capped at 8) and may be `undefined` → unknown means no warning.
- Packaged default model stays `llama3.2:3b` — do NOT change `DEFAULT_LLM_SETTINGS.ollamaModel`.
- Exactly one catalog model has `recommended: true` (`qwen2.5:7b`).
- Reasoning models (deepseek-r1, QwQ) are excluded from the catalog.
- Troubleshooting link target: `https://github.com/FallenUns/awto/blob/main/docs/TROUBLESHOOTING.md`.
- Destructive actions (delete) require an explicit confirm.

---

### Task 1: Model catalog data + helpers

**Files:**
- Create: `src/options/model-catalog.ts`
- Test: `src/options/model-catalog.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ModelTier = "light" | "balanced" | "heavy";
  export interface CatalogModel {
    id: string; displayName: string; params: string;
    downloadGB: number; ramGB: number; tier: ModelTier;
    recommended: boolean; blurb: string;
  }
  export const MODEL_CATALOG: CatalogModel[];
  export function findCatalogModel(id: string): CatalogModel | undefined;
  export function isHeavyForDevice(model: CatalogModel, deviceMemoryGB: number | undefined): boolean;
  export const TROUBLESHOOTING_URL: string;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/options/model-catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  MODEL_CATALOG, findCatalogModel, isHeavyForDevice, TROUBLESHOOTING_URL,
} from "./model-catalog";

describe("MODEL_CATALOG integrity", () => {
  it("has unique ids and all required fields", () => {
    const ids = new Set<string>();
    for (const m of MODEL_CATALOG) {
      expect(m.id).toMatch(/^[a-z0-9.:_-]+$/i);
      expect(ids.has(m.id)).toBe(false);
      ids.add(m.id);
      expect(m.displayName.length).toBeGreaterThan(0);
      expect(m.params.length).toBeGreaterThan(0);
      expect(m.downloadGB).toBeGreaterThan(0);
      expect(m.ramGB).toBeGreaterThan(0);
      expect(["light", "balanced", "heavy"]).toContain(m.tier);
      expect(m.blurb.length).toBeGreaterThan(0);
    }
  });

  it("marks exactly one model as recommended", () => {
    expect(MODEL_CATALOG.filter((m) => m.recommended)).toHaveLength(1);
    expect(MODEL_CATALOG.find((m) => m.recommended)?.id).toBe("qwen2.5:7b");
  });

  it("includes the packaged default and excludes reasoning models", () => {
    expect(findCatalogModel("llama3.2:3b")).toBeDefined();
    expect(MODEL_CATALOG.some((m) => /deepseek-r1|qwq/i.test(m.id))).toBe(false);
  });
});

describe("isHeavyForDevice", () => {
  const heavy = { id: "x", displayName: "X", params: "27B", downloadGB: 17, ramGB: 32, tier: "heavy", recommended: false, blurb: "b" } as const;
  const light = { id: "y", displayName: "Y", params: "3B", downloadGB: 2, ramGB: 8, tier: "light", recommended: false, blurb: "b" } as const;
  it("is false when device memory is unknown", () => {
    expect(isHeavyForDevice(heavy, undefined)).toBe(false);
  });
  it("is true when the model needs more RAM than the device reports", () => {
    expect(isHeavyForDevice(heavy, 8)).toBe(true);
  });
  it("is false when the model fits", () => {
    expect(isHeavyForDevice(light, 8)).toBe(false);
  });
});

describe("TROUBLESHOOTING_URL", () => {
  it("points at the GitHub troubleshooting doc", () => {
    expect(TROUBLESHOOTING_URL).toBe(
      "https://github.com/FallenUns/awto/blob/main/docs/TROUBLESHOOTING.md"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/options/model-catalog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/options/model-catalog.ts`:

```ts
export type ModelTier = "light" | "balanced" | "heavy";

export interface CatalogModel {
  id: string;
  displayName: string;
  params: string;
  downloadGB: number;
  ramGB: number;
  tier: ModelTier;
  recommended: boolean;
  blurb: string;
}

// Curated general-purpose instruct/chat models (reasoning models excluded —
// their <think> output breaks structured JSON). Sizes are approximate, for
// display only. Verified against ollama.com/library 2026-06-30.
export const MODEL_CATALOG: CatalogModel[] = [
  { id: "llama3.2:3b", displayName: "Llama 3.2 3B", params: "3B", downloadGB: 2.0, ramGB: 8, tier: "light", recommended: false, blurb: "Light and fast. Runs on almost any machine." },
  { id: "qwen2.5:3b", displayName: "Qwen 2.5 3B", params: "3B", downloadGB: 1.9, ramGB: 8, tier: "light", recommended: false, blurb: "Compact, strong at following instructions." },
  { id: "gemma3:4b", displayName: "Gemma 3 4B", params: "4B", downloadGB: 3.3, ramGB: 8, tier: "light", recommended: false, blurb: "Google's small model. Good general quality." },
  { id: "qwen2.5:7b", displayName: "Qwen 2.5 7B", params: "7B", downloadGB: 4.7, ramGB: 16, tier: "balanced", recommended: true, blurb: "Best balance of quality and structured-output reliability." },
  { id: "llama3.1:8b", displayName: "Llama 3.1 8B", params: "8B", downloadGB: 4.9, ramGB: 16, tier: "balanced", recommended: false, blurb: "Popular, well-rounded mid-size model." },
  { id: "mistral:7b", displayName: "Mistral 7B", params: "7B", downloadGB: 4.1, ramGB: 16, tier: "balanced", recommended: false, blurb: "Fast 7B with solid instruction following." },
  { id: "phi4:14b", displayName: "Phi-4 14B", params: "14B", downloadGB: 9.1, ramGB: 24, tier: "heavy", recommended: false, blurb: "Microsoft's strong 14B. Needs a capable machine." },
  { id: "qwen2.5:14b", displayName: "Qwen 2.5 14B", params: "14B", downloadGB: 9.0, ramGB: 24, tier: "heavy", recommended: false, blurb: "Higher quality at the cost of speed and RAM." },
  { id: "gemma3:27b", displayName: "Gemma 3 27B", params: "27B", downloadGB: 17, ramGB: 32, tier: "heavy", recommended: false, blurb: "Large. Needs a strong GPU or 32 GB+ RAM." },
  { id: "qwen2.5:32b", displayName: "Qwen 2.5 32B", params: "32B", downloadGB: 20, ramGB: 32, tier: "heavy", recommended: false, blurb: "Top local quality. Heavy hardware required." },
];

export function findCatalogModel(id: string): CatalogModel | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

export function isHeavyForDevice(
  model: CatalogModel,
  deviceMemoryGB: number | undefined
): boolean {
  if (typeof deviceMemoryGB !== "number") return false;
  return model.ramGB > deviceMemoryGB;
}

export const TROUBLESHOOTING_URL =
  "https://github.com/FallenUns/awto/blob/main/docs/TROUBLESHOOTING.md";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/options/model-catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/options/model-catalog.ts src/options/model-catalog.test.ts
git commit -m "feat(options): curated Ollama model catalog + hardware-fit helpers"
```

---

### Task 2: Pull / delete client (streaming, page-context)

**Files:**
- Create: `src/shared/ollama-errors.ts`
- Modify: `src/background/llm/local.ts` (import + re-export `OLLAMA_ORIGINS_HELP` from the new module)
- Create: `src/options/ollama-manage.ts`
- Test: `src/options/ollama-manage.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/shared/ollama-errors.ts
  export const OLLAMA_ORIGINS_HELP: string;
  // src/options/ollama-manage.ts
  export interface PullProgress { status: string; completedBytes?: number; totalBytes?: number; percent?: number; }
  export function pullModel(ollamaUrl: string, model: string, opts: { onProgress: (p: PullProgress) => void; signal?: AbortSignal }): Promise<void>;
  export function deleteModel(ollamaUrl: string, model: string): Promise<void>;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/options/ollama-manage.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { pullModel, deleteModel, type PullProgress } from "./ollama-manage";

afterEach(() => vi.unstubAllGlobals());

function streamResponse(lines: string[], ok = true, status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const l of lines) controller.enqueue(enc.encode(l));
      controller.close();
    },
  });
  return { ok, status, body } as unknown as Response;
}

describe("pullModel", () => {
  it("parses NDJSON progress lines and reports increasing percent", async () => {
    const f = vi.fn().mockResolvedValue(
      streamResponse([
        '{"status":"pulling manifest"}\n',
        '{"status":"downloading","total":1000,"completed":250}\n',
        '{"status":"downloading","total":1000,"completed":1000}\n{"status":"success"}\n',
      ])
    );
    vi.stubGlobal("fetch", f);
    const seen: PullProgress[] = [];
    await pullModel("http://localhost:11434", "qwen2.5:7b", {
      onProgress: (p) => seen.push(p),
    });
    expect(f.mock.calls[0][0]).toBe("http://localhost:11434/api/pull");
    const pct = seen.map((s) => s.percent).filter((p): p is number => p !== undefined);
    expect(pct).toEqual([25, 100]);
    expect(seen.at(-1)?.status).toBe("success");
  });

  it("rejects with the OLLAMA_ORIGINS help on a 403", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse([], false, 403)));
    await expect(
      pullModel("http://localhost:11434", "m", { onProgress: () => {} })
    ).rejects.toThrow(/OLLAMA_ORIGINS.*chrome-extension/s);
  });

  it("rejects when a progress line carries an error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      streamResponse(['{"error":"model not found"}\n'])
    ));
    await expect(
      pullModel("http://localhost:11434", "nope", { onProgress: () => {} })
    ).rejects.toThrow(/model not found/);
  });
});

describe("deleteModel", () => {
  it("issues a DELETE to /api/delete with the model name", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal("fetch", f);
    await deleteModel("http://localhost:11434/", "llama3.2:3b");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/delete");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body as string)).toEqual({ model: "llama3.2:3b" });
  });

  it("throws on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));
    await expect(deleteModel("http://localhost:11434", "m")).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/options/ollama-manage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/shared/ollama-errors.ts`:

```ts
// Ollama rejects non-allow-listed origins with HTTP 403. Chrome attaches a
// "chrome-extension://<id>" Origin, so surface the actionable OLLAMA_ORIGINS fix.
export const OLLAMA_ORIGINS_HELP =
  'Ollama refused the request (HTTP 403). Ollama only serves allow-listed origins, ' +
  'and Chrome sends a "chrome-extension://…" origin that is blocked by default. ' +
  'Add it to OLLAMA_ORIGINS and restart Ollama. macOS app: run ' +
  'launchctl setenv OLLAMA_ORIGINS "chrome-extension://*" then relaunch Ollama. ' +
  'CLI: OLLAMA_ORIGINS="chrome-extension://*" ollama serve';
```

In `src/background/llm/local.ts`, replace the inline `OLLAMA_ORIGINS_HELP` declaration with a re-export (keep the named export so existing imports and tests still resolve):

```ts
export { OLLAMA_ORIGINS_HELP } from "@/shared/ollama-errors";
```
(Remove the old `export const OLLAMA_ORIGINS_HELP = …` block in that file.)

Create `src/options/ollama-manage.ts`:

```ts
import { OLLAMA_ORIGINS_HELP } from "@/shared/ollama-errors";

export interface PullProgress {
  status: string;
  completedBytes?: number;
  totalBytes?: number;
  percent?: number;
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${trimmed}${path}`;
}

export async function pullModel(
  ollamaUrl: string,
  model: string,
  opts: { onProgress: (p: PullProgress) => void; signal?: AbortSignal }
): Promise<void> {
  const res = await fetch(joinUrl(ollamaUrl, "/api/pull"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: true }),
    signal: opts.signal,
  });
  if (!res.ok) {
    if (res.status === 403) throw new Error(OLLAMA_ORIGINS_HELP);
    throw new Error(`Ollama returned HTTP ${res.status} while pulling ${model}`);
  }
  if (!res.body) throw new Error("Ollama pull returned an empty response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const obj = JSON.parse(line) as {
        status?: string; error?: string; total?: number; completed?: number;
      };
      if (obj.error) throw new Error(obj.error);
      const total = obj.total;
      const completed = obj.completed;
      const percent =
        typeof total === "number" && total > 0 && typeof completed === "number"
          ? (completed / total) * 100
          : undefined;
      opts.onProgress({
        status: obj.status ?? "",
        completedBytes: completed,
        totalBytes: total,
        percent,
      });
    }
  }
}

export async function deleteModel(ollamaUrl: string, model: string): Promise<void> {
  const res = await fetch(joinUrl(ollamaUrl, "/api/delete"), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  if (!res.ok) {
    if (res.status === 403) throw new Error(OLLAMA_ORIGINS_HELP);
    throw new Error(`Ollama returned HTTP ${res.status} while deleting ${model}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/options/ollama-manage.test.ts src/background/llm/local.test.ts`
Expected: PASS — pull/delete tests pass and the existing local.ts 403 test (`/OLLAMA_ORIGINS.*chrome-extension/`) still passes via the re-export.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ollama-errors.ts src/background/llm/local.ts src/options/ollama-manage.ts src/options/ollama-manage.test.ts
git commit -m "feat(options): streaming pullModel + deleteModel client (page-context)"
```

---

### Task 3: ModelCatalog component

**Files:**
- Create: `src/options/ModelCatalog.tsx`
- Test: `src/options/ModelCatalog.test.tsx`
- Modify: `src/options/styles.css` (append catalog styles)

**Interfaces:**
- Consumes: `MODEL_CATALOG`, `findCatalogModel`, `isHeavyForDevice`, `TROUBLESHOOTING_URL` (Task 1); `pullModel`, `deleteModel`, `PullProgress` (Task 2).
- Produces:
  ```ts
  export interface ModelCatalogProps {
    selectedModel: string;
    installedModels: string[] | null;
    ollamaUrl: string;
    onSelectModel: (id: string) => void;
    onModelsChanged: () => void;
    deps?: {
      _pullModel?: typeof import("./ollama-manage").pullModel;
      _deleteModel?: typeof import("./ollama-manage").deleteModel;
      _deviceMemoryGB?: number;
      _confirm?: (msg: string) => boolean;
    };
  }
  export function ModelCatalog(props: ModelCatalogProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/options/ModelCatalog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ModelCatalog } from "./ModelCatalog";
import { TROUBLESHOOTING_URL } from "./model-catalog";

function setup(overrides: Partial<React.ComponentProps<typeof ModelCatalog>> = {}) {
  const onSelectModel = vi.fn();
  const onModelsChanged = vi.fn();
  const pull = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn().mockResolvedValue(undefined);
  render(
    <ModelCatalog
      selectedModel="llama3.2:3b"
      installedModels={["llama3.2:3b"]}
      ollamaUrl="http://localhost:11434"
      onSelectModel={onSelectModel}
      onModelsChanged={onModelsChanged}
      deps={{ _pullModel: pull, _deleteModel: del, _deviceMemoryGB: 8, _confirm: () => true }}
      {...overrides}
    />
  );
  return { onSelectModel, onModelsChanged, pull, del };
}

describe("ModelCatalog", () => {
  it("renders recommended and heavy groups", () => {
    setup();
    expect(screen.getByText(/Recommended/i)).toBeTruthy();
    expect(screen.getByText(/Heavy/i)).toBeTruthy();
    expect(screen.getByText("Qwen 2.5 7B")).toBeTruthy();
  });

  it("downloads a not-installed model when Download is clicked", async () => {
    const { pull, onModelsChanged } = setup();
    const row = screen.getByText("Qwen 2.5 7B").closest("[data-model]") as HTMLElement;
    fireEvent.click(row.querySelector("[data-action='download']")!);
    await waitFor(() => expect(pull).toHaveBeenCalledWith(
      "http://localhost:11434", "qwen2.5:7b", expect.anything()
    ));
    await waitFor(() => expect(onModelsChanged).toHaveBeenCalled());
  });

  it("selects an installed model and shows a delete control", () => {
    const { onSelectModel, del } = setup();
    const row = screen.getByText("Llama 3.2 3B").closest("[data-model]") as HTMLElement;
    fireEvent.click(row.querySelector("[data-action='delete']")!);
    expect(del).toHaveBeenCalledWith("http://localhost:11434", "llama3.2:3b");
  });

  it("warns when a model needs more RAM than the device reports", () => {
    setup();
    const row = screen.getByText("Gemma 3 27B").closest("[data-model]") as HTMLElement;
    expect(row.textContent).toMatch(/above your|too large|may be slow|may run/i);
  });

  it("uses a custom model id", () => {
    const { onSelectModel } = setup();
    fireEvent.change(screen.getByPlaceholderText(/custom model/i), { target: { value: "mistral-nemo:12b" } });
    fireEvent.click(screen.getByRole("button", { name: /use/i }));
    expect(onSelectModel).toHaveBeenCalledWith("mistral-nemo:12b");
  });

  it("links the troubleshooting guide to GitHub", () => {
    setup();
    const link = screen.getByRole("link", { name: /troubleshoot/i }) as HTMLAnchorElement;
    expect(link.href).toBe(TROUBLESHOOTING_URL);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/options/ModelCatalog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/options/ModelCatalog.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Download, Trash2, Check, Loader2, TriangleAlert, HelpCircle } from "lucide-react";
import {
  MODEL_CATALOG, findCatalogModel, isHeavyForDevice, TROUBLESHOOTING_URL,
  type CatalogModel,
} from "./model-catalog";
import {
  pullModel as defaultPull, deleteModel as defaultDelete, type PullProgress,
} from "./ollama-manage";

export interface ModelCatalogProps {
  selectedModel: string;
  installedModels: string[] | null;
  ollamaUrl: string;
  onSelectModel: (id: string) => void;
  onModelsChanged: () => void;
  deps?: {
    _pullModel?: typeof defaultPull;
    _deleteModel?: typeof defaultDelete;
    _deviceMemoryGB?: number;
    _confirm?: (msg: string) => boolean;
  };
}

type RowState =
  | { kind: "idle" }
  | { kind: "downloading"; percent?: number; status: string; controller: AbortController }
  | { kind: "deleting" }
  | { kind: "error"; message: string };

function readDeviceMemory(deps: ModelCatalogProps["deps"]): number | undefined {
  if (deps?._deviceMemoryGB !== undefined) return deps._deviceMemoryGB;
  const nav = navigator as Navigator & { deviceMemory?: number };
  return typeof nav.deviceMemory === "number" ? nav.deviceMemory : undefined;
}

export function ModelCatalog({
  selectedModel, installedModels, ollamaUrl, onSelectModel, onModelsChanged, deps,
}: ModelCatalogProps) {
  const pull = deps?._pullModel ?? defaultPull;
  const del = deps?._deleteModel ?? defaultDelete;
  const confirmFn = deps?._confirm ?? ((m: string) => window.confirm(m));
  const deviceMemoryGB = readDeviceMemory(deps);

  const [rows, setRows] = useState<Record<string, RowState>>({});
  const installed = useMemo(() => new Set(installedModels ?? []), [installedModels]);

  const recommended = MODEL_CATALOG.filter((m) => m.tier !== "heavy");
  const heavy = MODEL_CATALOG.filter((m) => m.tier === "heavy");

  function setRow(id: string, s: RowState) {
    setRows((prev) => ({ ...prev, [id]: s }));
  }

  async function handleDownload(model: CatalogModel) {
    const controller = new AbortController();
    setRow(model.id, { kind: "downloading", status: "starting…", controller });
    try {
      await pull(ollamaUrl, model.id, {
        signal: controller.signal,
        onProgress: (p: PullProgress) =>
          setRow(model.id, { kind: "downloading", percent: p.percent, status: p.status, controller }),
      });
      setRow(model.id, { kind: "idle" });
      onModelsChanged();
      onSelectModel(model.id);
    } catch (err) {
      if (controller.signal.aborted) {
        setRow(model.id, { kind: "idle" });
        return;
      }
      setRow(model.id, { kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleDelete(model: CatalogModel) {
    if (!confirmFn(`Delete ${model.displayName} from Ollama? This frees ~${model.downloadGB} GB of disk.`)) return;
    setRow(model.id, { kind: "deleting" });
    try {
      await del(ollamaUrl, model.id);
      setRow(model.id, { kind: "idle" });
      onModelsChanged();
    } catch (err) {
      setRow(model.id, { kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  function renderRow(model: CatalogModel) {
    const state = rows[model.id] ?? { kind: "idle" };
    const isInstalled = installed.has(model.id);
    const isSelected = selectedModel === model.id;
    const tooHeavy = isHeavyForDevice(model, deviceMemoryGB);

    return (
      <div
        key={model.id}
        data-model={model.id}
        className={`awto-model-row${isSelected ? " awto-model-row--selected" : ""}`}
      >
        <button
          type="button"
          className="awto-model-row__select"
          disabled={!isInstalled}
          aria-pressed={isSelected}
          onClick={() => isInstalled && onSelectModel(model.id)}
          title={isInstalled ? "Use this model" : "Download to use"}
        >
          <span className={`awto-radio${isSelected ? " awto-radio--on" : ""}`} aria-hidden="true" />
        </button>

        <div className="awto-model-row__main">
          <div className="awto-model-row__name">
            {model.displayName}
            {model.recommended && <span className="awto-badge awto-badge--rec">★ Recommended</span>}
            <span className={`awto-badge awto-badge--tier-${model.tier}`}>{model.tier}</span>
          </div>
          {state.kind === "downloading" ? (
            <div className="awto-prog">
              <div className="awto-prog__bar">
                <div className="awto-prog__fill" style={{ width: `${Math.round(state.percent ?? 0)}%` }} />
              </div>
              <div className="awto-prog__txt">
                <span>{state.status}</span>
                <span>{state.percent !== undefined ? `${Math.round(state.percent)}%` : ""}</span>
              </div>
            </div>
          ) : (
            <div className="awto-model-row__meta">
              <span>{model.params}</span>
              <span>{model.downloadGB} GB download</span>
              <span className={tooHeavy ? "awto-meta-warn" : ""}>
                ~{model.ramGB} GB RAM{tooHeavy ? " — above your device estimate, may be slow or fail" : ""}
              </span>
            </div>
          )}
          {state.kind === "error" && (
            <p className="awto-model-row__error">
              {state.message} · <a href={TROUBLESHOOTING_URL} target="_blank" rel="noreferrer">Troubleshoot</a>
            </p>
          )}
        </div>

        <div className="awto-model-row__actions">
          {state.kind === "downloading" ? (
            <button type="button" className="awto-btn awto-btn--secondary" onClick={() => state.controller.abort()}>
              Cancel
            </button>
          ) : isInstalled ? (
            <>
              {isSelected ? (
                <span className="awto-installed"><Check size={15} strokeWidth={2.4} aria-hidden="true" /> In use</span>
              ) : (
                <span className="awto-installed awto-installed--muted"><Check size={15} strokeWidth={2} aria-hidden="true" /> Installed</span>
              )}
              <button
                type="button" className="awto-iconbtn" data-action="delete"
                aria-label={`Delete ${model.displayName}`}
                disabled={state.kind === "deleting"}
                onClick={() => void handleDelete(model)}
              >
                {state.kind === "deleting"
                  ? <Loader2 size={16} className="awto-spin" strokeWidth={1.5} aria-hidden="true" />
                  : <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />}
              </button>
            </>
          ) : (
            <button
              type="button" className="awto-btn awto-btn--primary" data-action="download"
              onClick={() => void handleDownload(model)}
            >
              <Download size={15} strokeWidth={2} aria-hidden="true" /> Download
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="awto-catalog">
      {deviceMemoryGB !== undefined && (
        <div className="awto-hwchip">
          Your device reports ~{deviceMemoryGB} GB RAM (Chrome estimate). Heavier models may be slow.
        </div>
      )}

      <div className="awto-group-hdr">Recommended<span className="awto-group-line" /></div>
      {recommended.map(renderRow)}

      <div className="awto-group-hdr">Heavy — needs strong hardware<span className="awto-group-line" /></div>
      <div className="awto-disclaimer" role="note">
        <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />
        <span>These need a strong GPU or 24 GB+ RAM. Awto can't verify your hardware — they may run very slowly or fail. You can still try them.</span>
      </div>
      {heavy.map(renderRow)}

      <div className="awto-custom">
        <label className="awto-label" htmlFor="custom-model">Use a custom model</label>
        <div className="awto-custom__row">
          <input
            id="custom-model" className="awto-input" placeholder="custom model id, e.g. mistral-nemo:12b"
            defaultValue={findCatalogModel(selectedModel) ? "" : selectedModel}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = (e.target as HTMLInputElement).value.trim();
                if (v) onSelectModel(v);
              }
            }}
            id-data="custom-input"
          />
          <button
            type="button" className="awto-btn awto-btn--secondary"
            onClick={() => {
              const el = document.getElementById("custom-model") as HTMLInputElement | null;
              const v = el?.value.trim();
              if (v) onSelectModel(v);
            }}
          >
            Use
          </button>
        </div>
      </div>

      <p className="awto-catalog__foot">
        <HelpCircle size={15} strokeWidth={2} aria-hidden="true" />
        Model won't load or fills wrong?{" "}
        <a href={TROUBLESHOOTING_URL} target="_blank" rel="noreferrer">Troubleshooting guide →</a>
      </p>
    </div>
  );
}
```

Remove the stray `id-data="custom-input"` attribute before saving — it is not valid; the input already has `id="custom-model"`. (Self-check: the placeholder text contains "custom model", matching the test's `getByPlaceholderText(/custom model/i)`.)

Append to `src/options/styles.css` (match existing token usage — slate surfaces, `#22C55E` accent, `#F59E0B` amber):

```css
.awto-catalog { display: flex; flex-direction: column; }
.awto-hwchip { align-self: flex-start; background: #172033; border: 1px solid #334155; border-radius: 999px; padding: 7px 13px; font-size: 12.5px; color: #94A3B8; margin-bottom: 6px; }
.awto-group-hdr { display: flex; align-items: center; gap: 9px; margin: 18px 0 10px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #94A3B8; font-weight: 600; }
.awto-group-line { flex: 1; height: 1px; background: #334155; }
.awto-disclaimer { display: flex; gap: 9px; align-items: flex-start; background: rgba(245,158,11,.12); border: 1px solid rgba(245,158,11,.35); border-radius: 10px; padding: 10px 13px; font-size: 12.5px; color: #FCD9A0; margin-bottom: 12px; }
.awto-model-row { display: flex; align-items: center; gap: 14px; background: #172033; border: 1px solid #334155; border-radius: 12px; padding: 13px 15px; margin-bottom: 10px; }
.awto-model-row--selected { border-color: #22C55E; box-shadow: inset 0 0 0 1px #22C55E; }
.awto-model-row__select { background: none; border: none; padding: 0; cursor: pointer; min-width: 44px; min-height: 44px; display: grid; place-items: center; }
.awto-model-row__select:disabled { cursor: not-allowed; }
.awto-radio { width: 18px; height: 18px; border-radius: 50%; border: 2px solid #475569; display: grid; place-items: center; }
.awto-radio--on { border-color: #22C55E; }
.awto-radio--on::after { content: ""; width: 9px; height: 9px; border-radius: 50%; background: #22C55E; }
.awto-model-row__main { flex: 1; min-width: 0; }
.awto-model-row__name { display: flex; align-items: center; gap: 9px; font-weight: 600; font-size: 14.5px; flex-wrap: wrap; }
.awto-model-row__meta { color: #94A3B8; font-size: 12px; margin-top: 3px; display: flex; gap: 10px; flex-wrap: wrap; }
.awto-meta-warn { color: #F59E0B; }
.awto-model-row__error { color: #FCA5A5; font-size: 12px; margin: 6px 0 0; }
.awto-model-row__actions { display: flex; align-items: center; gap: 8px; }
.awto-badge--rec { background: rgba(34,197,94,.14); color: #22C55E; border: 1px solid rgba(34,197,94,.4); }
.awto-badge--tier-light { background: rgba(148,163,184,.14); color: #94A3B8; border: 1px solid #334155; }
.awto-badge--tier-balanced { background: rgba(96,165,250,.14); color: #93C5FD; border: 1px solid rgba(96,165,250,.4); }
.awto-badge--tier-heavy { background: rgba(245,158,11,.12); color: #F59E0B; border: 1px solid rgba(245,158,11,.4); }
.awto-installed { display: inline-flex; align-items: center; gap: 6px; color: #22C55E; font-size: 12.5px; font-weight: 600; }
.awto-installed--muted { color: #94A3B8; }
.awto-iconbtn { min-width: 44px; min-height: 44px; border-radius: 9px; border: 1px solid #334155; background: transparent; color: #94A3B8; cursor: pointer; display: grid; place-items: center; }
.awto-iconbtn:hover { color: #EF4444; border-color: #EF4444; }
.awto-prog { margin-top: 4px; }
.awto-prog__bar { height: 7px; border-radius: 99px; background: rgba(255,255,255,.08); overflow: hidden; }
.awto-prog__fill { height: 100%; background: #22C55E; border-radius: 99px; transition: width .2s ease; }
.awto-prog__txt { display: flex; justify-content: space-between; font-size: 11.5px; color: #94A3B8; margin-top: 6px; }
.awto-custom { margin-top: 14px; padding-top: 14px; border-top: 1px solid #334155; }
.awto-custom__row { display: flex; gap: 9px; }
.awto-catalog__foot { margin-top: 16px; display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: #94A3B8; }
.awto-catalog__foot a { color: #22C55E; text-decoration: none; font-weight: 600; }
.awto-catalog__foot a:hover { text-decoration: underline; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/options/ModelCatalog.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/options/ModelCatalog.tsx src/options/ModelCatalog.test.tsx src/options/styles.css
git commit -m "feat(options): ModelCatalog card with download/delete, tiers, hardware hints"
```

---

### Task 4: Wire ModelCatalog into LLMTab

**Files:**
- Modify: `src/options/LLMTab.tsx` (replace the "Model name" field block with `<ModelCatalog>`)
- Modify: `src/options/LLMTab.test.tsx` (keep existing tests green; adjust any that assert the old model `<select>`)

**Interfaces:**
- Consumes: `ModelCatalog` (Task 3).

- [ ] **Step 1: Write the failing test**

Add to `src/options/LLMTab.test.tsx`:

```tsx
it("renders the model catalog with the recommended model", async () => {
  const onUpdate = vi.fn();
  const onTestOllama = vi.fn().mockResolvedValue({ ok: true, models: ["llama3.2:3b"] });
  render(
    <LLMTab
      settings={{ ...DEFAULT_LLM_SETTINGS }}
      saveStatus="idle"
      onUpdate={onUpdate}
      onTestOllama={onTestOllama}
    />
  );
  expect(await screen.findByText("Qwen 2.5 7B")).toBeTruthy();
});
```
(Import `DEFAULT_LLM_SETTINGS` from `@/shared/storage` at the top of the test file if not already present.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/options/LLMTab.test.tsx -t "model catalog"`
Expected: FAIL — "Qwen 2.5 7B" not rendered (old plain field).

- [ ] **Step 3: Implement the wiring**

In `src/options/LLMTab.tsx`:
1. Add import: `import { ModelCatalog } from "./ModelCatalog";`
2. Replace the entire `<div className="awto-field">` block that renders the "Model name" label + the installed-models `<select>`/custom input + its helper `<p>` (the block spanning the `htmlFor="ollama-model"` field) with:

```tsx
        <div className="awto-field">
          <label className="awto-label">Model</label>
          <ModelCatalog
            selectedModel={settings.ollamaModel}
            installedModels={installedModels}
            ollamaUrl={settings.ollamaUrl}
            onSelectModel={(id) => onUpdate({ ollamaModel: id })}
            onModelsChanged={() => void handleTest()}
          />
        </div>
```

This reuses the existing `installedModels` state and `handleTest()` (which refreshes installed models via `onTestOllama`). Remove the now-unused `CUSTOM_MODEL_SENTINEL`, `customMode`, `showCustomInput`, `currentModelInList`, `modelOptions`, and `handleModelSelect` if they become unreferenced after the swap (let `tsc` guide you).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/options/LLMTab.test.tsx && npx tsc --noEmit`
Expected: PASS — new test + existing LLMTab tests green; no unused-symbol type errors.

- [ ] **Step 5: Commit**

```bash
git add src/options/LLMTab.tsx src/options/LLMTab.test.tsx
git commit -m "feat(options): use ModelCatalog in the LLM settings tab"
```

---

### Task 5: Popup heavy-for-device banner

**Files:**
- Modify: `src/popup/Popup.tsx` (render a banner when the selected model is heavy-for-device)
- Test: `src/popup/Popup.test.tsx` (add a focused test; create the file only if none exists — otherwise add to it)

**Interfaces:**
- Consumes: `findCatalogModel`, `isHeavyForDevice`, `TROUBLESHOOTING_URL` (Task 1).

- [ ] **Step 1: Write the failing test**

Add a test that mounts the banner logic. Because `Popup` loads settings asynchronously, extract a tiny pure presentational component to keep the test simple. Create `src/popup/HeavyModelBanner.tsx` test first — add to a new `src/popup/HeavyModelBanner.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeavyModelBanner } from "./HeavyModelBanner";

describe("HeavyModelBanner", () => {
  it("warns when the selected model exceeds device RAM", () => {
    render(<HeavyModelBanner model="gemma3:27b" deviceMemoryGB={8} />);
    expect(screen.getByRole("note").textContent).toMatch(/may be slow|may fail|hardware/i);
    expect(screen.getByRole("link").getAttribute("href")).toContain("TROUBLESHOOTING.md");
  });
  it("renders nothing for a light model", () => {
    const { container } = render(<HeavyModelBanner model="llama3.2:3b" deviceMemoryGB={8} />);
    expect(container.firstChild).toBeNull();
  });
  it("renders nothing when device memory is unknown", () => {
    const { container } = render(<HeavyModelBanner model="gemma3:27b" deviceMemoryGB={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/popup/HeavyModelBanner.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/popup/HeavyModelBanner.tsx`:

```tsx
import { TriangleAlert } from "lucide-react";
import { findCatalogModel, isHeavyForDevice, TROUBLESHOOTING_URL } from "@/options/model-catalog";

export function HeavyModelBanner({
  model, deviceMemoryGB,
}: { model: string; deviceMemoryGB: number | undefined }) {
  const entry = findCatalogModel(model);
  if (!entry || !isHeavyForDevice(entry, deviceMemoryGB)) return null;
  return (
    <div className="awto-heavy-banner" role="note">
      <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
      <span>
        {entry.displayName} may be slow or fail on this device.{" "}
        <a href={TROUBLESHOOTING_URL} target="_blank" rel="noreferrer">Help</a>
      </span>
    </div>
  );
}
```

Append to `src/popup/` styles (the popup stylesheet — same file the popup imports; if popup uses `src/options/styles.css` shared tokens, add there):

```css
.awto-heavy-banner { display: flex; align-items: center; gap: 7px; background: rgba(245,158,11,.12); border-bottom: 1px solid rgba(245,158,11,.3); color: #FCD9A0; font-size: 12px; padding: 7px 12px; }
.awto-heavy-banner a { color: #F59E0B; font-weight: 600; }
```

Then render it in `src/popup/Popup.tsx` just inside the top of the returned `<div className="awto-popup">`, reading the loaded settings model and `navigator.deviceMemory`:

```tsx
        <HeavyModelBanner
          model={settings?.ollamaModel ?? ""}
          deviceMemoryGB={(navigator as Navigator & { deviceMemory?: number }).deviceMemory}
        />
```
(Import `HeavyModelBanner` at the top. Use whatever the existing settings variable is named in `Popup.tsx`; if settings are not yet loaded, `model=""` → `findCatalogModel("")` is undefined → banner renders nothing.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/popup/HeavyModelBanner.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/popup/HeavyModelBanner.tsx src/popup/HeavyModelBanner.test.tsx src/popup/Popup.tsx src/options/styles.css
git commit -m "feat(popup): warn when the selected model is heavy for this device"
```

---

### Task 6: Troubleshooting doc + links

**Files:**
- Create: `docs/TROUBLESHOOTING.md`
- Modify: `README.md` (add a Troubleshooting link near the Ollama setup section)

- [ ] **Step 1: Create the troubleshooting doc**

Create `docs/TROUBLESHOOTING.md`:

```markdown
# Troubleshooting Awto

Step-by-step fixes for the most common local-model problems. If none of these
help, open an issue: https://github.com/FallenUns/awto/issues

## 1. "Ollama refused the request (HTTP 403)"

Ollama only answers allow-listed origins; Chrome sends a `chrome-extension://…`
origin that is blocked by default.

1. Set the origin and restart Ollama:
   - macOS app: `launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"` then fully quit and reopen Ollama.
   - CLI: `OLLAMA_ORIGINS="chrome-extension://*" ollama serve`
2. Still 403 after setting it? The running server predates the variable. Fully
   stop it and relaunch — see the "persistent 403" steps in the README.
3. Verify: `curl -H "Origin: chrome-extension://test" http://localhost:11434/api/tags`
   must return `200`, not `403`.

## 2. "model … not installed" / blank model list

1. Open Awto Options → Local model. Pick a model and click **Download**, or run
   `ollama pull qwen2.5:7b` in a terminal.
2. Click **Test connection** — it lists installed models from `/api/tags`.

## 3. Download (pull) fails or stalls

1. Confirm Ollama is running: `curl http://localhost:11434/api/version`.
2. Check free disk space — models are 2–20 GB.
3. A custom server URL other than `http://localhost:11434` may be blocked by the
   extension's host permissions; use the default local server.

## 4. Fills are wrong, empty, or you see a "format" error

1. Small models (3B) struggle on complex forms. Switch to the **Recommended**
   model (`qwen2.5:7b`) in Options and download it.
2. Add an Anthropic API key (Options → Cloud) so Awto can fall back on hard forms.
3. Awto always shows a confirmation step — review values before filling.

## 5. The model is very slow or the machine freezes

A model larger than your RAM/GPU will swap and crawl. Awto warns when a model
looks too heavy for your device, but cannot block it. Pick a lighter tier.

## 6. Collecting debug info for an issue

- Awto version (Options → About), Ollama version (`ollama --version`), OS, RAM.
- The exact error text shown in the popup.
- `ollama list` output (which models are installed).
```

- [ ] **Step 2: Link it from the README**

In `README.md`, add near the Ollama setup section:

```markdown
> Having trouble? See **[Troubleshooting](docs/TROUBLESHOOTING.md)** for step-by-step fixes (403/CORS, model downloads, wrong fills, slow models).
```

- [ ] **Step 3: Verify links resolve**

Run: `test -f docs/TROUBLESHOOTING.md && grep -q "TROUBLESHOOTING.md" README.md && echo OK`
Expected: `OK`. (The in-app links to the GitHub URL were added in Tasks 3 and 5; they point at `main`, which is correct once merged.)

- [ ] **Step 4: Commit**

```bash
git add docs/TROUBLESHOOTING.md README.md
git commit -m "docs: add TROUBLESHOOTING.md and link it from the README"
```

---

### Task 7: Full verification

- [ ] **Step 1: Whole suite + types + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all tests pass, no type errors, build succeeds.

- [ ] **Step 2: Update the decision log**

Add decision #19 to `CLAUDE.md` summarising: curated tiered catalog, in-app pull/delete from the Options page (not the SW), `navigator.deviceMemory` soft hint + disclaimers on two surfaces, default kept at `llama3.2:3b`, and `docs/TROUBLESHOOTING.md`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: decision #19 model catalog + management"
```

---

## Self-Review

- **Spec coverage:** catalog data + tiers + recommended (T1) ✓; hardware-fit helper (T1) ✓; pull/delete streaming from page (T2) ✓; OLLAMA_ORIGINS extracted + reused (T2) ✓; catalog UI with download/cancel/delete/custom/disclaimer (T3) ✓; device-RAM hint (T3/T5) ✓; wired into LLMTab (T4) ✓; popup heavy banner — second disclaimer surface (T5) ✓; TROUBLESHOOTING.md + GitHub links (T1 URL, T3/T5 links, T6 doc+README) ✓; default unchanged (Global Constraints) ✓; build/verify (T7) ✓.
- **Placeholder scan:** none — full code in every code step. (T3 notes the one stray attribute to delete; T4 says "let tsc guide you" for removing now-dead symbols, which is concrete.)
- **Type consistency:** `CatalogModel`, `isHeavyForDevice(model, deviceMemoryGB)`, `pullModel(url, model, {onProgress, signal})`, `deleteModel(url, model)`, `ModelCatalogProps`, `PullProgress` — consistent across T1–T5. `OLLAMA_ORIGINS_HELP` re-exported from `local.ts` so existing imports/tests resolve (T2).
