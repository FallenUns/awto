# Floating Widget + Cancellation + Queue Fix

**Date:** 2026-05-16
**Status:** Approved (sections 1-3)
**Spec owner:** Patrick
**Related code:** `src/content/`, `src/background/service-worker.ts`, `src/background/llm/`, `src/popup/useAwtoFlow.ts`, `src/shared/messages.ts`

## Context

Today Awto only activates when the user clicks the toolbar icon. That click triggers a `scanForm` round-trip and a `mapFields` LLM call. Three problems with this:

1. **Discoverability:** the user has to remember Awto exists. They don't always see the icon. On a form they're filling, they may not think "let me click that thing".
2. **Cancellation:** if the user closes the popup while the LLM call is in flight, the call keeps running. Compute + tokens wasted.
3. **Queueing:** clicking the icon again before the first call finishes queues the second behind it. Slow popup, frustrating.

This spec adds: an in-page floating widget that proactively surfaces Awto when a form is detected, plus a port-based cancellation + supersede mechanism so the in-flight LLM call dies cleanly the moment the popup closes or another request supersedes it.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Detect surface | Floating widget on page (bottom-right pill) |
| Dismissal memory | Just this page load — gone after reload |
| On dismiss while thinking | Cancel the in-flight Ollama / Anthropic fetch immediately |
| On double-click / re-open | Cancel the previous request, start fresh |

## Architecture

### Component map

```
[Page DOM]
    └── <div id="awto-widget-root"> (injected by content script)
            └── #shadow-root (closed)
                 ├── <style>…scoped…</style>
                 └── <button class="awto-pill"> … </button>

[Content script]                    [Service worker]                    [Toolbar popup]
─────────────────                   ─────────────────                   ──────────────
 detector.ts            ─────▶ openPopup msg ─────▶ chrome.action.openPopup()
 widget.ts                                                                  │
 (pill UI, shadow DOM)                                                      ▼
                                              ┌── port "awto-chat" ◀── useAwtoFlow.ts
                                              │                            │ chat UI
                                              ▼                            │
                                       AbortController                     │
                                              │                            │
                                              ▼                            ▼
                                         callHybrid ────▶ Ollama / Anthropic
                                         (signal threaded through)
```

### Section 1 — Floating widget

**File: `src/content/detector.ts` (new)**

- Exports `startDetector(onChange: (count: number) => void): () => void`. Returns a cleanup.
- On call: schedules an initial scan 250 ms after invocation (debounced).
- Sets up a `MutationObserver` on `document.body` with `{childList: true, subtree: true}` and a 500 ms debounce wrapper.
- Each scan calls `scanFields(document)` from `form-scanner.ts` and reports the count to `onChange`.
- Filters: never reports on `chrome:`, `chrome-extension:`, `view-source:`, `about:` URLs (returns no-op cleanup).

**File: `src/content/widget.ts` (new)**

- Exports `mountWidget(onClick: () => void): WidgetHandle`.
- `WidgetHandle = { setCount(n: number): void; setHidden(reason: "dismissed" | "filled" | "no-fields" | null): void; destroy(): void }`.
- On mount: appends `<div id="awto-widget-root">` to `document.body`, attaches a closed shadow root, injects scoped CSS (inlined via Vite `?inline` import) and the pill markup.
- Pill: 48 × 48 px, dark slate background, green "A" avatar, top-right `×` (44×44 hit area, visible on hover/focus). Badge in the bottom-right of the pill showing field count.
- Position: `fixed; bottom: 24px; right: 24px; z-index: 2147483647`.
- On pill click: calls `onClick`.
- On `×` click or `Escape` while focused: calls `setHidden("dismissed")` and stays hidden for this page load (in-memory flag).
- `setHidden("filled")` retires the widget after a successful fill until next reload.
- Respects `prefers-reduced-motion`: skips the 200 ms fade-in.

**File: `src/content/index.ts` (existing — extended)**

```ts
const widget = mountWidget(async () => {
  const reply = await chrome.runtime.sendMessage({ type: "openPopup" });
  // if !reply.ok, widget shows a "Click the Awto icon in your toolbar" hint for 3s
});

const stop = startDetector((count) => {
  if (count >= 2) widget.setCount(count);
  else widget.setHidden("no-fields");
});

// Existing message-listener for scanForm / fillForm remains unchanged.
```

**Heuristics for "show the widget":**
- `count >= 2` (skip lone search boxes / single-input newsletter signups)
- Not dismissed this page load
- Not retired after a successful fill this page load

### Section 2 — Cancellation + queue fix via port

**File: `src/shared/messages.ts` (extended)**

```ts
| { type: "openPopup" }
| { type: "openPopupResult"; ok: boolean; error?: string }
```

The existing `mapFields` / `mapFieldsResult` / `testOllama` / `testOllamaResult` shapes are unchanged. Only the **transport** changes: popup → service worker is now via a port for `mapFields`. Options page still uses one-shot `sendMessage` for `testOllama` (no cancellation needed there).

**File: `src/background/service-worker.ts` (extended)**

```ts
const inFlight = new Map<chrome.runtime.Port, AbortController>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "awto-chat") return;

  port.onMessage.addListener(async (message: AwtoMessage) => {
    inFlight.get(port)?.abort("superseded");
    const controller = new AbortController();
    inFlight.set(port, controller);

    try {
      const reply = await handleMessage(message, { signal: controller.signal });
      if (!controller.signal.aborted) port.postMessage(reply);
    } finally {
      if (inFlight.get(port) === controller) inFlight.delete(port);
    }
  });

  port.onDisconnect.addListener(() => {
    inFlight.get(port)?.abort("popup-closed");
    inFlight.delete(port);
  });
});
```

`handleMessage` gains an optional `signal: AbortSignal` parameter, threaded through:

```
handleMessage(msg, {signal})
  → callHybrid(profile, fields, settings, deps, signal)
      → callLocal(profile, fields, {...opts, signal})
      → callCloud(profile, fields, {...opts, signal})
```

**File: `src/background/llm/local.ts` (extended)**

`LocalCallOpts` gains `signal?: AbortSignal`. The existing 90s timeout controller stays; combine via `AbortSignal.any([opts.signal, timeoutController.signal])` (available in Chrome 122+, MV3 service workers).

```ts
const composedSignal = opts.signal
  ? AbortSignal.any([opts.signal, timeoutController.signal])
  : timeoutController.signal;

const res = await fetch(url, { ..., signal: composedSignal });
```

On `AbortError` from fetch, inspect the individual signals (not the composed one) to decide which path:

```ts
} catch (err) {
  if (err instanceof Error && err.name === "AbortError") {
    if (opts.signal?.aborted) {
      throw err;  // external cancel — propagate, service worker swallows it
    }
    if (timeoutController.signal.aborted) {
      throw new LocalLLMError(`Ollama call timed out after ${timeoutMs}ms`, err);
    }
  }
  throw err;
}
```

**File: `src/background/llm/cloud.ts` (extended)**

`CloudCallOpts` gains `signal?: AbortSignal`. Pass to the Anthropic SDK via the request options bag: `client.messages.create({...}, { signal })`.

**File: `src/popup/useAwtoFlow.ts` (changed)**

Replaces one-shot `chrome.runtime.sendMessage({type: "mapFields", …})` with a port:

```ts
useEffect(() => {
  const port = chrome.runtime.connect({ name: "awto-chat" });
  port.onMessage.addListener((reply: AwtoMessage) => {
    // existing handlers for mapFieldsResult / mapFieldsError
  });
  port.postMessage({ type: "mapFields", fields, profile });
  return () => port.disconnect();   // unmount = cancel
}, [/* deps */]);
```

The existing `defaultSendToRuntime` (still used by options page for `testOllama`) keeps working — it's a parallel path.

### Section 3 — Detection trigger

Already described above. Summary of the contract between detector and widget:

```
fields count    widget state             reason
─────────────   ──────────────────────   ───────────────────────────────
0               hidden                   no-fields
1               hidden                   below minimum
≥ 2             visible (with badge)     active
any → dismissed hidden                   user clicked ×
any → filled    hidden                   one successful fill this load
```

## Error handling

| Failure | Response |
|---|---|
| `chrome.action.openPopup()` rejects | Widget shows "Click the Awto icon in your toolbar →" hint for 3 seconds |
| Port disconnects mid-request | Service worker aborts controller; popup unmounts naturally |
| Service worker terminated mid-request | Fetch dies with worker; next port.connect spins up a fresh one |
| AbortError surfaces in callLocal | Distinguish external vs timeout abort by checking which signal aborted |
| MutationObserver fires constantly on a misbehaving SPA | 500 ms debounce caps work; `scanFields` already efficient |

## Testing strategy

**Existing 156 tests should pass unchanged** except for `service-worker.test.ts` and `useAwtoFlow.test.ts` which need updates for the new shapes.

**New unit tests:**

- `src/content/detector.test.ts` — fixture HTML with 0, 1, 2, N inputs; verify `onChange` called with correct counts; mutation observer adds a field, count updates after debounce.
- `src/content/widget.test.ts` — mount widget, verify shadow root exists, pill renders, click handler fires, `×` hides, count badge updates, `setHidden("filled")` keeps it hidden.
- `src/background/service-worker.test.ts` — add cases for port-based flow: `onConnect` registers handler, `onDisconnect` aborts in-flight controller, new message supersedes old controller.
- `src/background/llm/local.test.ts` — test external `AbortSignal` cancels the fetch; verify `AbortSignal.any()` composition still respects timeout.

**Manual test plan:**

1. Visit a page with a form → widget appears bottom-right with field count.
2. Click `×` → widget hides; reload page → widget reappears.
3. Click the pill → toolbar popup opens with chat.
4. While "Thinking…", close the popup → service worker log should show "abort: popup-closed". No completed `mapFieldsResult` in the chat next open.
5. Click the pill twice quickly → only the most recent run completes.
6. Successfully fill a form → widget retires for this page load.

## Out of scope (deferred to follow-up specs)

These will get their own brainstorm + spec + plan cycles:

- **A. Address autocomplete in profile editor** — Nominatim / Google Places / Mapbox; profile editor UX.
- **B. Title (and similar enum) as dropdown + closest-match indicator** — title dropdown in profile, low-confidence amber dot back in the chat for fuzzy-mapped fields.
- **C. Memory of past fills** — per-site cache of `(field signature → profileKey)` mappings, possible LLM short-circuit, cache invalidation.

Also out of scope for this spec:

- Cross-origin iframe forms
- Page-level shadow-DOM forms
- File uploads / contentEditable handling

## Implementation order (rough)

1. Thread `signal` through `local.ts`, `cloud.ts`, `hybrid.ts`. Update fixtures. Confirm existing tests still pass.
2. Add `onConnect` handler + `Map<port, controller>` in service worker. Update `handleMessage` signature.
3. Switch `useAwtoFlow` from `sendMessage` to `connect`. Update tests.
4. Build `detector.ts` (with mutation observer + debounce). Add tests.
5. Build `widget.ts` (shadow DOM + pill). Add tests.
6. Wire detector + widget in `content/index.ts`. Add `openPopup` message + service-worker handler.
7. Manual test pass through the six steps above. Update docs.

## Acceptance

- Widget appears on pages with ≥2 fillable fields; never on chrome:// / about:.
- Widget is dismissible; stays dismissed for the page load.
- Clicking the pill opens the toolbar popup with the existing chat UI.
- Dismissing the toolbar popup mid-thinking aborts the LLM call (verified by network panel: fetch shows as cancelled).
- Clicking the pill twice quickly doesn't queue — only the latest call lands.
- 156 existing tests pass after refactor; new tests cover detector + widget + cancellation.
