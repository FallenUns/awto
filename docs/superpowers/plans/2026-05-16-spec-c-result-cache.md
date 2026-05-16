# Spec C — Result Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache successful mapFields results in the service worker keyed by tabId + form signature. Skip the LLM on reopen if cache hit.

**Architecture:** A small `result-cache.ts` module owning a `Map<string, CachedEntry>`. `registerPortHandler` and `handleMessage` pull tabId from `port.sender.tab.id`, consult the cache before calling hybrid, write back on success. `chrome.tabs.onRemoved` invalidates per-tab.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-16-spec-c-result-cache-design.md](../specs/2026-05-16-spec-c-result-cache-design.md)

---

## File Plan

| Path | Status | Responsibility |
|---|---|---|
| `src/background/result-cache.ts` | **create** | Map storage, `cacheKey`, `getCached`, `setCached`, `invalidateTab`, `_clearCache` test helper |
| `src/background/result-cache.test.ts` | **create** | Unit tests for cache helpers |
| `src/background/service-worker.ts` | modify | Pull tabId from port.sender; pass through to handleMessage; consult cache in mapFields; cache on success; tabs.onRemoved listener |
| `src/background/service-worker.test.ts` | modify | New cases for cache hit / miss / abort-doesn't-cache / signature-change-misses |

---

## Task 1: Create `result-cache.ts` with TDD

**Files:**
- Create: `src/background/result-cache.ts`
- Create: `src/background/result-cache.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/background/result-cache.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { ScannedField } from "@/shared/messages";
import { cacheKey, getCached, setCached, invalidateTab, _clearCache } from "./result-cache";

const fieldsA: ScannedField[] = [
  { id: 0, selector: "#a", label: "First name", placeholder: null, type: "text", required: false },
  { id: 1, selector: "#b", label: "Email", placeholder: "you@x.com", type: "email", required: true },
];

const fieldsB: ScannedField[] = [
  { id: 0, selector: "#a", label: "Email", placeholder: "you@x.com", type: "email", required: true },
];

beforeEach(() => {
  _clearCache();
});

describe("cacheKey", () => {
  it("returns the same key for identical fields in the same tab", () => {
    expect(cacheKey(1, fieldsA)).toBe(cacheKey(1, fieldsA));
  });

  it("differs when fields differ", () => {
    expect(cacheKey(1, fieldsA)).not.toBe(cacheKey(1, fieldsB));
  });

  it("differs when tabId differs", () => {
    expect(cacheKey(1, fieldsA)).not.toBe(cacheKey(2, fieldsA));
  });

  it("differs when a label changes", () => {
    const changed: ScannedField[] = [
      { ...fieldsA[0]!, label: "Given name" },
      fieldsA[1]!,
    ];
    expect(cacheKey(1, fieldsA)).not.toBe(cacheKey(1, changed));
  });
});

describe("getCached / setCached", () => {
  it("returns null when no entry is set", () => {
    expect(getCached("missing")).toBeNull();
  });

  it("returns the stored entry when set", () => {
    const key = cacheKey(1, fieldsA);
    setCached(key, {
      mappings: [
        {
          fieldId: 0,
          actionType: "fill",
          profileKey: "firstName",
          suggestedKey: null,
          promptText: null,
          reason: null,
          confidence: 0.9,
        },
      ],
      source: "local",
    });
    const entry = getCached(key);
    expect(entry).not.toBeNull();
    expect(entry?.source).toBe("local");
    expect(entry?.mappings).toHaveLength(1);
    expect(entry?.cachedAt).toBeTypeOf("number");
  });
});

describe("invalidateTab", () => {
  it("removes only the targeted tab's entries", () => {
    const key1 = cacheKey(1, fieldsA);
    const key2 = cacheKey(2, fieldsA);
    setCached(key1, { mappings: [], source: "local" });
    setCached(key2, { mappings: [], source: "local" });

    invalidateTab(1);

    expect(getCached(key1)).toBeNull();
    expect(getCached(key2)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```
npm run test -- src/background/result-cache.test.ts
```

Expected: fail because file does not exist.

- [ ] **Step 3: Implement `result-cache.ts`**

Create `src/background/result-cache.ts`:

```ts
import type { FieldMapping } from "@/shared/mapping";
import type { ScannedField } from "@/shared/messages";

export interface CachedEntry {
  mappings: FieldMapping[];
  source: "local" | "cloud" | "mixed";
  cachedAt: number;
}

const cache = new Map<string, CachedEntry>();

export function cacheKey(tabId: number, fields: ScannedField[]): string {
  const signature = fields
    .map((f) => `${f.label}|${f.placeholder ?? ""}|${f.type}`)
    .join("§");
  return `${tabId}:${signature}`;
}

export function getCached(key: string): CachedEntry | null {
  return cache.get(key) ?? null;
}

export function setCached(
  key: string,
  entry: Omit<CachedEntry, "cachedAt">
): void {
  cache.set(key, { ...entry, cachedAt: Date.now() });
}

export function invalidateTab(tabId: number): void {
  const prefix = `${tabId}:`;
  for (const k of Array.from(cache.keys())) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

export function _clearCache(): void {
  cache.clear();
}
```

- [ ] **Step 4: Run tests to verify pass**

```
npm run test -- src/background/result-cache.test.ts
```

Expected: all pass.

- [ ] **Step 5: Full verify**

```
npm run typecheck
npm run test
```

Expected: typecheck clean. ≥182 tests pass (176 + 6 new).

- [ ] **Step 6: Commit**

```bash
git add src/background/result-cache.ts src/background/result-cache.test.ts
git commit -m "feat(background): result cache module with tab-scoped keys"
```

---

## Task 2: Wire cache into service worker

**Files:**
- Modify: `src/background/service-worker.ts`
- Modify: `src/background/service-worker.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/background/service-worker.test.ts`. Add import:

```ts
import { _clearCache, setCached, cacheKey, getCached } from "./result-cache";
```

Add tests:

```ts
describe("handleMessage with result cache", () => {
  beforeEach(() => {
    _clearCache();
  });

  it("returns cached result and skips hybrid on cache hit", async () => {
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn();
    const key = cacheKey(42, fields);
    setCached(key, {
      mappings: [
        {
          fieldId: 0,
          actionType: "fill",
          profileKey: "firstName",
          suggestedKey: null,
          promptText: null,
          reason: null,
          confidence: 0.95,
        },
      ],
      source: "cloud",
    });

    const response = await handleMessage(
      { type: "mapFields", fields, profile },
      { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid, tabId: 42 }
    );

    expect(response).toEqual({
      type: "mapFieldsResult",
      mappings: expect.any(Array),
      source: "cloud",
    });
    expect(callHybrid).not.toHaveBeenCalled();
    expect(loadLLMSettings).not.toHaveBeenCalled();
  });

  it("caches successful result for future hits", async () => {
    const hybridResult = makeHybridResult();
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn().mockResolvedValue(hybridResult);

    await handleMessage(
      { type: "mapFields", fields, profile },
      { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid, tabId: 7 }
    );

    const stored = getCached(cacheKey(7, fields));
    expect(stored).not.toBeNull();
    expect(stored?.mappings).toEqual(hybridResult.response.mappings);
    expect(stored?.source).toBe("local");
  });

  it("does not cache when callHybrid throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn().mockRejectedValue(new Error("boom"));

    await handleMessage(
      { type: "mapFields", fields, profile },
      { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid, tabId: 8 }
    );

    expect(getCached(cacheKey(8, fields))).toBeNull();
    consoleError.mockRestore();
  });

  it("does not cache when call is aborted", async () => {
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn().mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" })
    );

    await handleMessage(
      { type: "mapFields", fields, profile },
      { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid, tabId: 9 }
    );

    expect(getCached(cacheKey(9, fields))).toBeNull();
  });

  it("falls through to hybrid when no tabId is provided", async () => {
    const hybridResult = makeHybridResult();
    const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
    const callHybrid = vi.fn().mockResolvedValue(hybridResult);

    await handleMessage(
      { type: "mapFields", fields, profile },
      { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid }
    );

    expect(callHybrid).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```
npm run test -- src/background/service-worker.test.ts
```

Expected: fail (`tabId` not on `HandleMessageDeps`, no cache integration).

- [ ] **Step 3: Wire cache into service-worker.ts**

In `src/background/service-worker.ts`:

Add import:

```ts
import { cacheKey, getCached, setCached, invalidateTab } from "./result-cache";
```

Extend `HandleMessageDeps`:

```ts
export interface HandleMessageDeps {
  _loadLLMSettings?: LoadLLMSettingsFn;
  _callHybrid?: CallHybridFn;
  _pingOllama?: PingOllamaFn;
  _listOllamaModels?: ListOllamaModelsFn;
  signal?: AbortSignal;
  tabId?: number;
}
```

Modify the `case "mapFields"` block. Replace the existing body with:

```ts
case "mapFields": {
  const tabId = deps.tabId;
  if (tabId !== undefined) {
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

  try {
    const settings = await loadSettings();
    const result: HybridResult = await hybrid(
      message.profile,
      message.fields,
      { ...settings, signal: deps.signal }
    );
    if (tabId !== undefined) {
      setCached(cacheKey(tabId, message.fields), {
        mappings: result.response.mappings,
        source: result.source,
      });
    }
    return {
      type: "mapFieldsResult",
      mappings: result.response.mappings,
      source: result.source,
    };
  } catch (err) {
    const errorMessage = errorToMessage(err);
    if (err instanceof Error && err.name === "AbortError") {
      return { type: "mapFieldsError", error: errorMessage };
    }
    console.error("Awto: mapFields failed:", errorMessage);
    return { type: "mapFieldsError", error: errorMessage };
  }
}
```

Update `registerPortHandler` signature to accept `tabId`:

```ts
export function registerPortHandler(
  port: chrome.runtime.Port,
  tabId: number | undefined,
  baseDeps: HandleMessageDeps = {}
) {
  // ...existing body, but pass tabId in deps when calling handleMessage:
  const reply = await handleMessage(message, { ...baseDeps, tabId, signal: next.signal });
  // ...
}
```

Update the `chrome.runtime.onConnect` registration:

```ts
chrome.runtime.onConnect?.addListener((port) => {
  if (port.name !== "awto-chat") return;
  const tabId = port.sender?.tab?.id;
  registerPortHandler(port, tabId);
});
```

Add tab-close cleanup at module top level (after the `onInstalled` block):

```ts
chrome.tabs?.onRemoved?.addListener((tabId) => {
  invalidateTab(tabId);
});
```

- [ ] **Step 4: Update existing supersede/disconnect tests for the new `registerPortHandler` signature**

The two existing port-lifecycle tests pass `registerPortHandler(port, { ...deps })`. They need to become `registerPortHandler(port, undefined, { ...deps })`. Update them. Leave the test assertions intact.

- [ ] **Step 5: Run all tests to verify pass**

```
npm run test
```

Expected: ≥187 tests pass (176 + 6 cache module + 5 cache integration).

- [ ] **Step 6: Full verify**

```
npm run typecheck
npm run build
```

Expected: typecheck clean. Build OK.

- [ ] **Step 7: Commit**

```bash
git add src/background/service-worker.ts src/background/service-worker.test.ts
git commit -m "feat(service-worker): cache mapFields results per tab; invalidate on tab close"
```

---

## Acceptance Checklist

- [ ] Result cache module exports `cacheKey`, `getCached`, `setCached`, `invalidateTab`, `_clearCache`
- [ ] `handleMessage` checks cache before calling hybrid; returns cached result on hit
- [ ] Successful hybrid call writes to cache
- [ ] Aborted / failed calls do NOT write to cache
- [ ] `tabId` is plumbed from `port.sender.tab.id` through `registerPortHandler` into `handleMessage`
- [ ] `chrome.tabs.onRemoved` invalidates the closed tab's entries
- [ ] Existing service-worker tests still pass after the `registerPortHandler` signature change
- [ ] All previously passing tests remain green
- [ ] Total test count grows by 11 (6 cache module + 5 integration)
