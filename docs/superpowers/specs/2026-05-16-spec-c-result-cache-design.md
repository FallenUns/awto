# Spec C — Mapping Result Cache

**Date:** 2026-05-16
**Status:** Approved
**Spec owner:** Patrick
**Related code:** `src/background/service-worker.ts`, `src/shared/messages.ts`, `src/background/llm/*`

## Context

Today every popup open posts `mapFields`, which fires a fresh LLM call. If the user dismisses the popup and reopens — within the same tab, same form, seconds later — the LLM thinks again from scratch. Wasteful and slow.

Fix: an in-memory service-worker cache of `mapFields` results, keyed by `tabId + form-signature`. On cache hit, return the prior result immediately, skipping the LLM. Cache is per-tab, lasts as long as the service worker lives. Lost on worker termination — acceptable, that's the same as today's "fresh think every time".

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Cache lifetime | Just this tab + session (in-memory; no persistence) |
| Cache key | Tab + form-signature hash |
| Cache typed missing-field drafts | No (sensitive data + complexity) |
| Manual re-scan button | No (defer to v2; form-signature change auto-invalidates) |
| Eviction | On tab close via `chrome.tabs.onRemoved` |

## Architecture

```
[Popup] ─── mapFields ───▶ [registerPortHandler(port, tabId)]
                                    │
                                    ▼
                            cacheKey(tabId, fields)
                                    │
                            ┌──── cache hit? ────┐
                            │ YES                │ NO
                            ▼                    ▼
                  return cached result    callHybrid → cache → return
```

## Components

### `src/background/result-cache.ts` (new)

```ts
import type { FieldMapping, LLMResponse } from "@/shared/mapping";
import type { ScannedField } from "@/shared/messages";

export interface CachedEntry {
  mappings: FieldMapping[];
  source: "local" | "cloud" | "mixed";
  cachedAt: number;
}

const cache = new Map<string, CachedEntry>();

export function cacheKey(tabId: number, fields: ScannedField[]): string {
  const signature = fields.map((f) => `${f.label}|${f.placeholder ?? ""}|${f.type}`).join("§");
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
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

// Testing affordance — clear all entries between tests.
export function _clearCache(): void {
  cache.clear();
}
```

Field-signature hash: `label|placeholder|type` joined by `§` separator across fields, in scan order. Stable when the same form is re-scanned, changes when any field's label/placeholder/type changes or when fields are added/removed.

### `src/background/service-worker.ts` (modified)

`registerPortHandler` gains a `tabId` parameter. The `onConnect` listener pulls `port.sender?.tab?.id` and passes it down. `HandleMessageDeps` gains optional `tabId?: number`.

In the `mapFields` case:

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
    // unchanged abort + log path
  }
}
```

Failed calls (LLM error, abort, etc.) are NOT cached — only successful ones.

Tab-close cleanup at module top level (alongside `chrome.runtime.onInstalled?.addListener`):

```ts
chrome.tabs?.onRemoved?.addListener((tabId) => {
  invalidateTab(tabId);
});
```

Optional chain so tests without `chrome.tabs` don't crash.

### `src/popup/useAwtoFlow.ts` (no changes)

The popup is oblivious — it just posts `mapFields` and receives `mapFieldsResult` faster. State transitions: still goes through `mapping` → `ready`, but `mapping` resolves on the same microtask if cached.

### `src/shared/messages.ts` (no changes)

Wire format unchanged.

## Behavior table

| Event | Cache behavior |
|---|---|
| First popup open on a form | Miss → call LLM → cache result → return |
| Reopen popup on same form (no field change) | Hit → return cached result, skip LLM |
| Form fields change (multi-step wizard step 1 → step 2) | Different signature → miss → call LLM → cache new |
| User cancels (port disconnect mid-thinking) | No cache write (only on success) |
| LLM error | No cache write |
| Tab closed | All entries for that tabId evicted |
| Service worker terminated | Entire cache cleared on next worker spawn |
| Same form, different tabs | Different keys → independent cache entries |
| Page reload (same URL, same tab) | Service worker NOT terminated → cache survives. Form may re-render but if signature is identical, served from cache. Acceptable. |

## Testing strategy

`src/background/result-cache.test.ts` (new):
1. `cacheKey` is stable for the same fields, changes on label change
2. `cacheKey` distinguishes tabs
3. `getCached` returns null when missing
4. `setCached` + `getCached` round-trips
5. `invalidateTab` removes only that tab's entries

`src/background/service-worker.test.ts` (extended):
1. mapFields with cache hit returns without calling hybrid
2. mapFields with cache miss calls hybrid and writes cache
3. Successful call caches; aborted call does not
4. Different field signatures bypass cache

## Acceptance

- [ ] Open popup on a form → close → reopen within ~5 seconds → result appears instantly without "Thinking…"
- [ ] Navigate same tab to a different form → reopen → fresh think (cache miss because signature differs)
- [ ] Close the tab → reopen Awto on a different tab on the same site → fresh think (different tabId)
- [ ] Cancel mid-think → reopen → fresh think (no entry was cached)
- [ ] All 176 existing tests pass + new cache tests
- [ ] `npm run typecheck && npm run test && npm run build` green

## Out of scope

- Persistence across browser restarts (`chrome.storage.session` or `.local`)
- Cross-tab cache sharing (URL-keyed)
- Caching user-typed missing-field drafts
- "Refresh" button in popup
- TTL eviction (the only eviction triggers are tab close and worker termination)
