# Floating Widget + Cancellation + Queue Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a content-script-injected floating widget that proactively surfaces Awto on pages with forms, and switch the popup ↔ service worker transport to a port so dismissing the popup cancels the in-flight LLM call and a fresh click supersedes the previous request.

**Architecture:** Thread an `AbortSignal` through `local.ts` → `cloud.ts` → `hybrid.ts` → `handleMessage`. Service worker registers a `chrome.runtime.onConnect` handler keyed on port; each port has one in-flight `AbortController` that is aborted on `onDisconnect` or superseded by a new message. Content script runs a debounced form detector (initial pass + `MutationObserver`) and mounts a shadow-DOM pill that asks the service worker to call `chrome.action.openPopup()` on click.

**Tech Stack:** TypeScript, React, Vite + @crxjs/vite-plugin, Zod, Vitest + happy-dom, Lucide React, Chrome MV3 APIs (`runtime.connect`, `action.openPopup`, `MutationObserver`, `AbortSignal.any`).

**Spec:** [docs/superpowers/specs/2026-05-16-floating-widget-and-cancellation-design.md](../specs/2026-05-16-floating-widget-and-cancellation-design.md)

---

## File Plan

| Path | Status | Responsibility |
|---|---|---|
| `src/background/llm/local.ts` | modify | Accept external `AbortSignal`; compose with timeout via `AbortSignal.any` |
| `src/background/llm/local.test.ts` | modify | Cover external abort vs timeout abort paths |
| `src/background/llm/cloud.ts` | modify | Pass `signal` to Anthropic SDK |
| `src/background/llm/cloud.test.ts` | modify | Cover external abort |
| `src/background/llm/hybrid.ts` | modify | Forward `signal` to local/cloud |
| `src/background/llm/hybrid.test.ts` | modify | Verify signal forwarding |
| `src/background/service-worker.ts` | modify | New `onConnect` handler, in-flight map, supersede + disconnect aborts; `openPopup` handler |
| `src/background/service-worker.test.ts` | modify | Port lifecycle tests; openPopup handler |
| `src/shared/messages.ts` | modify | Add `openPopup` / `openPopupResult` types |
| `src/popup/useAwtoFlow.ts` | modify | Switch from one-shot `sendMessage` to port-based round-trip for `mapFields` |
| `src/popup/useAwtoFlow.test.ts` | modify | Cover port-based path |
| `src/content/detector.ts` | **create** | `startDetector(onChange)` — debounced scan + MutationObserver |
| `src/content/detector.test.ts` | **create** | Initial scan, debounce, mutation triggers |
| `src/content/widget.ts` | **create** | `mountWidget(onClick): WidgetHandle` — shadow-DOM pill |
| `src/content/widget.test.ts` | **create** | Mount, count badge, dismiss, hide-after-fill |
| `src/content/widget.css` | **create** | Pill styles (inlined into shadow DOM via Vite `?inline`) |
| `src/content/index.ts` | modify | Wire detector + widget; route pill click to `openPopup` |
| `CLAUDE.md` | modify | Decision log entry for the new flow |

---

## Task 1: Add AbortSignal to LocalCallOpts and compose with timeout

**Files:**
- Modify: `src/background/llm/local.ts`
- Modify: `src/background/llm/local.test.ts`

- [ ] **Step 1: Write failing test for external abort path**

Append to `src/background/llm/local.test.ts`:

```ts
it("rethrows AbortError when external signal aborts (not LocalLLMError)", async () => {
  const external = new AbortController();
  const fetchSpy = vi.fn(
    (_url, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })
  );
  vi.stubGlobal("fetch", fetchSpy);

  const promise = callLocal(
    { firstName: "P", custom: {} },
    [{ id: 0, selector: "#x", label: "x", placeholder: null, type: "text", required: false }],
    {
      ollamaUrl: "http://localhost:11434",
      ollamaModel: "llama3.2",
      timeoutMs: 60000,
      signal: external.signal,
    }
  );

  external.abort();

  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchSpy).toHaveBeenCalled();
});

it("throws LocalLLMError when timeout signal fires", async () => {
  const fetchSpy = vi.fn(
    (_url, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })
  );
  vi.stubGlobal("fetch", fetchSpy);

  await expect(
    callLocal(
      { firstName: "P", custom: {} },
      [{ id: 0, selector: "#x", label: "x", placeholder: null, type: "text", required: false }],
      {
        ollamaUrl: "http://localhost:11434",
        ollamaModel: "llama3.2",
        timeoutMs: 30,
      }
    )
  ).rejects.toMatchObject({
    name: "LocalLLMError",
    message: expect.stringContaining("timed out after 30ms"),
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- src/background/llm/local.test.ts`

Expected: 2 new tests fail (`signal` not on `LocalCallOpts`; existing "throws LocalLLMError on timeout" may also fail until refactor).

- [ ] **Step 3: Add `signal` to `LocalCallOpts` and compose abort sources**

In `src/background/llm/local.ts`:

```ts
export interface LocalCallOpts {
  ollamaUrl: string;
  ollamaModel: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}
```

In the body of `callLocal`, replace the current single-controller block with:

```ts
const timeoutMs = opts.timeoutMs ?? 90000;
const timeoutController = new AbortController();
const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

const composedSignal: AbortSignal = opts.signal
  ? AbortSignal.any([opts.signal, timeoutController.signal])
  : timeoutController.signal;

try {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: composedSignal,
  });
  // ...existing happy path unchanged...
} catch (err) {
  if (err instanceof Error && err.name === "AbortError") {
    if (opts.signal?.aborted) throw err;
    if (timeoutController.signal.aborted) {
      throw new LocalLLMError(
        `Ollama call timed out after ${timeoutMs}ms`,
        err
      );
    }
  }
  throw err;
} finally {
  clearTimeout(timer);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test -- src/background/llm/local.test.ts`

Expected: all `local.test.ts` cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/background/llm/local.ts src/background/llm/local.test.ts
git commit -m "feat(llm/local): accept external AbortSignal; compose with timeout"
```

---

## Task 2: Add AbortSignal to CloudCallOpts

**Files:**
- Modify: `src/background/llm/cloud.ts`
- Modify: `src/background/llm/cloud.test.ts`

- [ ] **Step 1: Write failing test**

Append to `src/background/llm/cloud.test.ts`:

```ts
it("rethrows when external signal aborts the cloud call", async () => {
  const external = new AbortController();
  const createMock = vi.fn(
    (_args, _opts) =>
      new Promise((_resolve, reject) => {
        _opts?.signal?.addEventListener?.("abort", () => {
          const err = new Error("Request aborted");
          err.name = "AbortError";
          reject(err);
        });
      })
  );
  (Anthropic as unknown as Mock).mockImplementation(() => ({
    messages: { create: createMock },
  }));

  const promise = callCloud(
    { firstName: "P", custom: {} },
    [{ id: 0, selector: "#x", label: "x", placeholder: null, type: "text", required: false }],
    {
      anthropicApiKey: "sk-ant-test",
      anthropicModel: "claude-opus-4-7",
      signal: external.signal,
    }
  );

  external.abort();
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- src/background/llm/cloud.test.ts`

Expected: fail (`signal` not in `CloudCallOpts`).

- [ ] **Step 3: Add `signal` and pass to SDK**

In `src/background/llm/cloud.ts`:

```ts
export interface CloudCallOpts {
  anthropicApiKey: string;
  anthropicModel: string;
  signal?: AbortSignal;
}
```

In `callCloud`, change the SDK call:

```ts
const response = await client.messages.create(
  {
    model: opts.anthropicModel,
    max_tokens: 4096,
    tools: [
      {
        name: TOOL_NAME,
        description: "Submit the field mapping result.",
        input_schema: getOutputJsonSchema(),
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(profile, fields) }],
  },
  opts.signal ? { signal: opts.signal } : undefined
);
```

In the `catch` block of `callCloud`, before generic error wrapping, add:

```ts
if (err instanceof Error && err.name === "AbortError") throw err;
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test -- src/background/llm/cloud.test.ts`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/background/llm/cloud.ts src/background/llm/cloud.test.ts
git commit -m "feat(llm/cloud): accept AbortSignal; pass to Anthropic SDK"
```

---

## Task 3: Add AbortSignal to HybridCallOpts and forward

**Files:**
- Modify: `src/background/llm/hybrid.ts`
- Modify: `src/background/llm/hybrid.test.ts`

- [ ] **Step 1: Write failing test**

Append to `src/background/llm/hybrid.test.ts`:

```ts
it("forwards the AbortSignal to both local and cloud calls", async () => {
  const external = new AbortController();
  const local = vi.fn().mockRejectedValue(
    Object.assign(new Error("aborted"), { name: "AbortError" })
  );
  const cloud = vi.fn().mockRejectedValue(
    Object.assign(new Error("aborted"), { name: "AbortError" })
  );

  await expect(
    callHybrid(
      profile,
      fields,
      makeOpts({ signal: external.signal }),
      { _callLocal: local, _callCloud: cloud }
    )
  ).rejects.toThrow();

  expect(local).toHaveBeenCalledWith(
    profile,
    fields,
    expect.objectContaining({ signal: external.signal })
  );
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- src/background/llm/hybrid.test.ts`

Expected: fail (`signal` not on `HybridCallOpts`).

- [ ] **Step 3: Update HybridCallOpts and pass-through**

In `src/background/llm/hybrid.ts`:

```ts
export interface HybridCallOpts {
  ollamaUrl: string;
  ollamaModel: string;
  ollamaTimeoutMs?: number;
  anthropicApiKey: string;
  anthropicModel: string;
  cloudFallbackEnabled: boolean;
  confidenceThreshold: number;
  signal?: AbortSignal;
}
```

In the body of `callHybrid`, change the opts builders:

```ts
const localOpts: LocalCallOpts = {
  ollamaUrl: opts.ollamaUrl,
  ollamaModel: opts.ollamaModel,
  timeoutMs: opts.ollamaTimeoutMs,
  signal: opts.signal,
};
const cloudOpts: CloudCallOpts = {
  anthropicApiKey: opts.anthropicApiKey,
  anthropicModel: opts.anthropicModel,
  signal: opts.signal,
};
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test -- src/background/llm/hybrid.test.ts`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/background/llm/hybrid.ts src/background/llm/hybrid.test.ts
git commit -m "feat(llm/hybrid): forward AbortSignal to local + cloud"
```

---

## Task 4: Thread signal through handleMessage

**Files:**
- Modify: `src/background/service-worker.ts`
- Modify: `src/background/service-worker.test.ts`

- [ ] **Step 1: Write failing test**

Append to `src/background/service-worker.test.ts`:

```ts
it("passes signal through to callHybrid on mapFields", async () => {
  const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
  const callHybrid = vi.fn().mockResolvedValue({
    response: { mappings: [] },
    source: "local",
  });
  const external = new AbortController();

  await handleMessage(
    { type: "mapFields", fields: [], profile: { custom: {} } },
    { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid, signal: external.signal }
  );

  expect(callHybrid).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({ signal: external.signal })
  );
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- src/background/service-worker.test.ts`

Expected: fail (`signal` not on `HandleMessageDeps` or `callHybrid` not receiving signal).

- [ ] **Step 3: Update signature and pass-through**

In `src/background/service-worker.ts`, extend `HandleMessageDeps`:

```ts
export interface HandleMessageDeps {
  _loadLLMSettings?: LoadLLMSettingsFn;
  _callHybrid?: CallHybridFn;
  _pingOllama?: PingOllamaFn;
  _listOllamaModels?: ListOllamaModelsFn;
  signal?: AbortSignal;
}
```

In the `case "mapFields"` block, add `signal` to the opts:

```ts
const result: HybridResult = await hybrid(
  message.profile,
  message.fields,
  { ...settings, signal: deps.signal }
);
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm run test -- src/background/service-worker.test.ts`

Expected: all 9 cases pass (8 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add src/background/service-worker.ts src/background/service-worker.test.ts
git commit -m "feat(service-worker): thread AbortSignal into handleMessage"
```

---

## Task 5: Add port-based onConnect handler with supersede + disconnect aborts

**Files:**
- Modify: `src/background/service-worker.ts`
- Modify: `src/background/service-worker.test.ts`

- [ ] **Step 1: Write failing test for port lifecycle**

Append to `src/background/service-worker.test.ts`:

```ts
import { registerPortHandler } from "./service-worker";

function makeMockPort(name = "awto-chat"): {
  port: chrome.runtime.Port;
  fireMessage: (msg: AwtoMessage) => void;
  fireDisconnect: () => void;
  posted: AwtoMessage[];
} {
  const messageListeners: Array<(msg: AwtoMessage) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const posted: AwtoMessage[] = [];
  const port = {
    name,
    onMessage: { addListener: (fn: any) => messageListeners.push(fn) },
    onDisconnect: { addListener: (fn: any) => disconnectListeners.push(fn) },
    postMessage: (msg: AwtoMessage) => posted.push(msg),
    disconnect: () => disconnectListeners.forEach((fn) => fn()),
  } as unknown as chrome.runtime.Port;
  return {
    port,
    fireMessage: (msg) => messageListeners.forEach((fn) => fn(msg)),
    fireDisconnect: () => disconnectListeners.forEach((fn) => fn()),
    posted,
  };
}

it("supersedes the previous request when a new message arrives on the same port", async () => {
  const callHybrid = vi
    .fn()
    .mockImplementation(
      (_profile, _fields, opts) =>
        new Promise((_resolve, reject) =>
          opts.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
          )
        )
    );
  const { port, fireMessage, posted } = makeMockPort();

  registerPortHandler(port, {
    _loadLLMSettings: vi.fn().mockResolvedValue(defaultSettings),
    _callHybrid: callHybrid,
  });

  fireMessage({ type: "mapFields", fields: [], profile: { custom: {} } });
  await Promise.resolve();
  fireMessage({ type: "mapFields", fields: [], profile: { custom: {} } });

  await new Promise((r) => setTimeout(r, 10));
  expect(callHybrid).toHaveBeenCalledTimes(2);
  expect(callHybrid.mock.calls[0]?.[2].signal.aborted).toBe(true);
  expect(posted).toEqual([]); // first call's superseded reply is suppressed
});

it("aborts the in-flight controller on port disconnect", async () => {
  const callHybrid = vi
    .fn()
    .mockImplementation(
      (_profile, _fields, opts) =>
        new Promise((_resolve, reject) =>
          opts.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
          )
        )
    );
  const { port, fireMessage, fireDisconnect } = makeMockPort();

  registerPortHandler(port, {
    _loadLLMSettings: vi.fn().mockResolvedValue(defaultSettings),
    _callHybrid: callHybrid,
  });

  fireMessage({ type: "mapFields", fields: [], profile: { custom: {} } });
  await Promise.resolve();
  fireDisconnect();
  await new Promise((r) => setTimeout(r, 10));

  expect(callHybrid.mock.calls[0]?.[2].signal.aborted).toBe(true);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- src/background/service-worker.test.ts`

Expected: fail (`registerPortHandler` not exported).

- [ ] **Step 3: Add `registerPortHandler` and wire `onConnect`**

In `src/background/service-worker.ts`, add near the bottom (before the `chrome.runtime.onInstalled` block):

```ts
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
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test -- src/background/service-worker.test.ts`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/background/service-worker.ts src/background/service-worker.test.ts
git commit -m "feat(service-worker): port handler with supersede + disconnect aborts"
```

---

## Task 6: Add openPopup message and handler

**Files:**
- Modify: `src/shared/messages.ts`
- Modify: `src/background/service-worker.ts`
- Modify: `src/background/service-worker.test.ts`

- [ ] **Step 1: Write failing test**

Append to `src/background/service-worker.test.ts`:

```ts
it("calls chrome.action.openPopup on openPopup message", async () => {
  const openPopup = vi.fn().mockResolvedValue(undefined);
  (globalThis as unknown as { chrome: typeof chrome }).chrome = {
    ...(globalThis as unknown as { chrome: typeof chrome }).chrome,
    action: { openPopup } as unknown as chrome.action.ActionStatic,
  };

  const reply = await handleMessage({ type: "openPopup" });

  expect(openPopup).toHaveBeenCalled();
  expect(reply).toEqual({ type: "openPopupResult", ok: true });
});

it("returns openPopupResult ok=false when chrome.action.openPopup rejects", async () => {
  const openPopup = vi.fn().mockRejectedValue(new Error("no active tab"));
  (globalThis as unknown as { chrome: typeof chrome }).chrome = {
    ...(globalThis as unknown as { chrome: typeof chrome }).chrome,
    action: { openPopup } as unknown as chrome.action.ActionStatic,
  };

  const reply = await handleMessage({ type: "openPopup" });
  expect(reply).toEqual({ type: "openPopupResult", ok: false, error: "no active tab" });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- src/background/service-worker.test.ts`

Expected: fail (`openPopup` not in `AwtoMessage` union).

- [ ] **Step 3: Extend `messages.ts`**

In `src/shared/messages.ts`, add to the `AwtoMessage` union:

```ts
| { type: "openPopup" }
| { type: "openPopupResult"; ok: boolean; error?: string }
```

- [ ] **Step 4: Add handler in service worker**

In `src/background/service-worker.ts`, inside the `handleMessage` switch:

```ts
case "openPopup": {
  try {
    await chrome.action.openPopup();
    return { type: "openPopupResult", ok: true };
  } catch (err) {
    return { type: "openPopupResult", ok: false, error: errorToMessage(err) };
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm run test -- src/background/service-worker.test.ts`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/shared/messages.ts src/background/service-worker.ts src/background/service-worker.test.ts
git commit -m "feat: openPopup message + chrome.action.openPopup handler"
```

---

## Task 7: Switch useAwtoFlow to port-based mapFields

**Files:**
- Modify: `src/popup/useAwtoFlow.ts`
- Modify: `src/popup/useAwtoFlow.test.ts`

- [ ] **Step 1: Write failing test for port wiring**

Replace the existing `mapFields` test in `src/popup/useAwtoFlow.test.ts` and add a new disconnect-on-unmount test:

```ts
it("connects to background via port and posts mapFields on scanForm result", async () => {
  const messageListeners: Array<(msg: AwtoMessage) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const posted: AwtoMessage[] = [];
  const port = {
    name: "awto-chat",
    onMessage: { addListener: (fn: (msg: AwtoMessage) => void) => messageListeners.push(fn) },
    onDisconnect: { addListener: (fn: () => void) => disconnectListeners.push(fn) },
    postMessage: (m: AwtoMessage) => posted.push(m),
    disconnect: () => disconnectListeners.forEach((fn) => fn()),
  };
  const connect = vi.fn(() => port);
  const sendToTab = vi.fn().mockResolvedValue({
    type: "scanFormResult",
    fields: [{ id: 0, selector: "#x", label: "x", placeholder: null, type: "text", required: false }],
  });

  renderHook(() =>
    useAwtoFlow({
      _connect: connect as unknown as typeof chrome.runtime.connect,
      _sendToTab,
      _loadProfile: () => Promise.resolve({ custom: {} }),
      _getActiveTabId: () => Promise.resolve(123),
    })
  );

  await waitFor(() =>
    expect(posted.some((m) => m.type === "mapFields")).toBe(true)
  );
  expect(connect).toHaveBeenCalledWith({ name: "awto-chat" });
});

it("disconnects the port on unmount", async () => {
  let disconnected = false;
  const port = {
    name: "awto-chat",
    onMessage: { addListener: () => {} },
    onDisconnect: { addListener: () => {} },
    postMessage: () => {},
    disconnect: () => {
      disconnected = true;
    },
  };
  const { unmount } = renderHook(() =>
    useAwtoFlow({
      _connect: vi.fn(() => port) as unknown as typeof chrome.runtime.connect,
      _sendToTab: vi.fn().mockResolvedValue({ type: "scanFormResult", fields: [] }),
      _loadProfile: () => Promise.resolve({ custom: {} }),
      _getActiveTabId: () => Promise.resolve(1),
    })
  );

  unmount();
  expect(disconnected).toBe(true);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- src/popup/useAwtoFlow.test.ts`

Expected: fail (`_connect` not in `UseAwtoFlowDeps`).

- [ ] **Step 3: Refactor hook to use a port for mapFields**

The existing `UseAwtoFlowDeps` already contains DI hooks for tab messaging, runtime messaging, profile load/save, and active-tab lookup (under names like `_sendToTab`, `_sendToRuntime`, etc.). Keep the existing entries unchanged and **add** `_connect`:

```ts
export interface UseAwtoFlowDeps {
  // ...existing entries unchanged...
  _connect?: typeof chrome.runtime.connect;
}
```

Remove the prior `mapFields` round-trip that used `_sendToRuntime` (or whatever the existing name is) and the corresponding reply handling. Replace with the port-based flow below.

Replace the `sendToRuntime`-based map-fields branch with:

```ts
const portRef = useRef<chrome.runtime.Port | null>(null);

useEffect(() => {
  const connectFn = deps._connect ?? chrome.runtime.connect;
  const port = connectFn({ name: "awto-chat" });
  portRef.current = port;

  port.onMessage.addListener((reply: AwtoMessage) => {
    if (reply.type === "mapFieldsResult") {
      setState((s) => deriveReadyState(s, reply.mappings));
      setStatus("ready");
    } else if (reply.type === "mapFieldsError") {
      setState((s) => ({ ...s, error: reply.error }));
      setStatus("error");
    }
  });

  port.onDisconnect.addListener(() => {
    portRef.current = null;
  });

  return () => {
    try {
      port.disconnect();
    } catch {
      // already disconnected
    }
    portRef.current = null;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

// inside the scanForm/mapFields sequence, replace sendToRuntime call with:
portRef.current?.postMessage({ type: "mapFields", fields, profile });
```

Keep all other behaviour. `testOllamaConnection` continues to use one-shot `sendMessage` (it lives in `useOptionsState`, untouched).

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test -- src/popup/useAwtoFlow.test.ts`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/popup/useAwtoFlow.ts src/popup/useAwtoFlow.test.ts
git commit -m "feat(popup): port-based mapFields; disconnect on unmount = cancel"
```

---

## Task 8: Create detector.ts with debounced scan + MutationObserver

**Files:**
- Create: `src/content/detector.ts`
- Create: `src/content/detector.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/content/detector.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { startDetector } from "./detector";

describe("startDetector", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });

  it("reports 0 on a page with no inputs after initial debounce", () => {
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("reports field count on a page with inputs", () => {
    document.body.innerHTML = `
      <form>
        <label>Name <input name="name" /></label>
        <label>Email <input type="email" name="email" /></label>
      </form>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("re-reports after a mutation that adds inputs (debounced)", async () => {
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenLastCalledWith(0);

    const input = document.createElement("input");
    input.name = "x";
    document.body.appendChild(input);

    vi.advanceTimersByTime(600);
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("no-ops on chrome-extension:// pages", () => {
    const original = window.location.href;
    Object.defineProperty(window, "location", {
      value: { href: "chrome-extension://abc/x.html", protocol: "chrome-extension:" },
      writable: true,
    });
    const onChange = vi.fn();
    const stop = startDetector(onChange);
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
    stop();
    Object.defineProperty(window, "location", { value: { href: original }, writable: true });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- src/content/detector.test.ts`

Expected: fail (file does not exist).

- [ ] **Step 3: Implement detector**

Create `src/content/detector.ts`:

```ts
import { scanFields } from "./form-scanner";

const INITIAL_DELAY_MS = 250;
const MUTATION_DEBOUNCE_MS = 500;
const SKIP_PROTOCOLS = ["chrome:", "chrome-extension:", "about:", "view-source:"];

export function startDetector(onChange: (count: number) => void): () => void {
  if (SKIP_PROTOCOLS.includes(window.location.protocol)) {
    return () => {};
  }

  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let mutationTimer: ReturnType<typeof setTimeout> | null = null;
  let observer: MutationObserver | null = null;
  let lastCount = -1;

  const evaluate = () => {
    try {
      const count = scanFields(document).length;
      if (count !== lastCount) {
        lastCount = count;
        onChange(count);
      }
    } catch {
      // scan failures (e.g. detached document) are ignored
    }
  };

  initialTimer = setTimeout(evaluate, INITIAL_DELAY_MS);

  observer = new MutationObserver(() => {
    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = setTimeout(evaluate, MUTATION_DEBOUNCE_MS);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    if (initialTimer) clearTimeout(initialTimer);
    if (mutationTimer) clearTimeout(mutationTimer);
    observer?.disconnect();
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test -- src/content/detector.test.ts`

Expected: 4 cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/content/detector.ts src/content/detector.test.ts
git commit -m "feat(content): form detector with debounced initial scan + MutationObserver"
```

---

## Task 9: Create widget.ts (shadow-DOM pill)

**Files:**
- Create: `src/content/widget.css`
- Create: `src/content/widget.ts`
- Create: `src/content/widget.test.ts`

- [ ] **Step 1: Write widget styles**

Create `src/content/widget.css`:

```css
:host {
  all: initial;
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 2147483647;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

.pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #0F172A;
  border: 1px solid #475569;
  color: #F8FAFC;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transition: transform 150ms ease-out;
}

.pill:hover { transform: scale(1.05); }
.pill:focus-visible { outline: 2px solid #22C55E; outline-offset: 2px; }

.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #22C55E;
  color: #0F172A;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
}

.badge {
  position: absolute;
  bottom: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: #22C55E;
  color: #0F172A;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #0F172A;
}

.close {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #1E293B;
  color: #F8FAFC;
  border: 1px solid #475569;
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
}

.pill:hover .close,
.pill:focus-within .close { display: flex; }

.fade-in { animation: fade-in 200ms ease-out; }

@keyframes fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .fade-in { animation: none; }
  .pill { transition: none; }
}
```

- [ ] **Step 2: Write failing widget test**

Create `src/content/widget.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountWidget } from "./widget";

describe("mountWidget", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts a host element with a closed shadow root", () => {
    mountWidget(() => {});
    const host = document.getElementById("awto-widget-root");
    expect(host).not.toBeNull();
    expect(host?.shadowRoot).toBeNull();
  });

  it("renders the pill, no badge by default", () => {
    const handle = mountWidget(() => {});
    const host = document.getElementById("awto-widget-root")!;
    const pill = (host as HTMLElement & { __testShadow?: ShadowRoot }).__testShadow?.querySelector(".pill");
    expect(pill).toBeTruthy();
    expect(pill?.querySelector(".badge")).toBeNull();
    handle.destroy();
  });

  it("setCount shows badge with count", () => {
    const handle = mountWidget(() => {});
    handle.setCount(5);
    const host = document.getElementById("awto-widget-root")!;
    const shadow = (host as HTMLElement & { __testShadow?: ShadowRoot }).__testShadow!;
    expect(shadow.querySelector(".badge")?.textContent).toBe("5");
    handle.destroy();
  });

  it("setHidden('dismissed') removes the pill from the shadow root", () => {
    const handle = mountWidget(() => {});
    handle.setCount(3);
    handle.setHidden("dismissed");
    const host = document.getElementById("awto-widget-root")!;
    const shadow = (host as HTMLElement & { __testShadow?: ShadowRoot }).__testShadow!;
    expect(shadow.querySelector(".pill")).toBeNull();
    handle.destroy();
  });

  it("fires onClick when the pill is clicked", () => {
    const onClick = vi.fn();
    const handle = mountWidget(onClick);
    handle.setCount(2);
    const host = document.getElementById("awto-widget-root")!;
    const shadow = (host as HTMLElement & { __testShadow?: ShadowRoot }).__testShadow!;
    (shadow.querySelector(".pill") as HTMLElement).click();
    expect(onClick).toHaveBeenCalled();
    handle.destroy();
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `npm run test -- src/content/widget.test.ts`

Expected: fail (file does not exist).

- [ ] **Step 4: Implement widget**

Create `src/content/widget.ts`:

```ts
import styles from "./widget.css?inline";

export type WidgetHiddenReason = "dismissed" | "filled" | "no-fields" | null;

export interface WidgetHandle {
  setCount(n: number): void;
  setHidden(reason: WidgetHiddenReason): void;
  destroy(): void;
}

export function mountWidget(onClick: () => void): WidgetHandle {
  let host = document.getElementById("awto-widget-root");
  if (host) host.remove();
  host = document.createElement("div");
  host.id = "awto-widget-root";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "closed" });
  // expose for tests only
  (host as HTMLElement & { __testShadow?: ShadowRoot }).__testShadow = shadow;

  const style = document.createElement("style");
  style.textContent = styles;
  shadow.appendChild(style);

  const container = document.createElement("div");
  shadow.appendChild(container);

  let currentCount = 0;
  let dismissed = false;
  let filled = false;

  function render() {
    if (dismissed || filled || currentCount < 2) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML = `
      <button class="pill fade-in" aria-label="Open Awto (${currentCount} field${currentCount === 1 ? "" : "s"} detected)">
        <span class="avatar">A</span>
        <span class="badge">${currentCount}</span>
        <span class="close" role="button" aria-label="Dismiss" tabindex="0">×</span>
      </button>
    `;
    const pill = container.querySelector(".pill") as HTMLButtonElement;
    const close = container.querySelector(".close") as HTMLElement;
    pill.addEventListener("click", (e) => {
      if (e.target === close || close.contains(e.target as Node)) return;
      onClick();
    });
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      dismissed = true;
      render();
    });
    pill.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        dismissed = true;
        render();
      }
    });
  }

  return {
    setCount(n) {
      currentCount = n;
      render();
    },
    setHidden(reason) {
      if (reason === "dismissed") dismissed = true;
      if (reason === "filled") filled = true;
      if (reason === null) {
        dismissed = false;
        filled = false;
      }
      render();
    },
    destroy() {
      host?.remove();
    },
  };
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm run test -- src/content/widget.test.ts`

Expected: 5 cases pass.

- [ ] **Step 6: Commit**

```bash
git add src/content/widget.ts src/content/widget.test.ts src/content/widget.css
git commit -m "feat(content): shadow-DOM floating widget with dismissible pill"
```

---

## Task 10: Wire detector + widget in content/index.ts

**Files:**
- Modify: `src/content/index.ts`

- [ ] **Step 1: Read existing content/index.ts**

Run: `cat src/content/index.ts` to confirm current contents (it currently registers the `chrome.runtime.onMessage` listener for `scanForm` / `fillForm`).

- [ ] **Step 2: Add detector + widget wiring**

Replace `src/content/index.ts` with:

```ts
import type { AwtoMessage } from "@/shared/messages";
import { scanFields } from "./form-scanner";
import { fillFields } from "./form-filler";
import { startDetector } from "./detector";
import { mountWidget } from "./widget";

chrome.runtime.onMessage.addListener(
  (message: AwtoMessage, _sender, sendResponse) => {
    if (message.type === "scanForm") {
      sendResponse({ type: "scanFormResult", fields: scanFields(document) });
    } else if (message.type === "fillForm") {
      const result = fillFields(document, message.values);
      sendResponse({ type: "fillFormResult", ...result });
      widget.setHidden("filled");
    }
    return true;
  }
);

const widget = mountWidget(async () => {
  const reply = (await chrome.runtime.sendMessage({
    type: "openPopup",
  })) as AwtoMessage;
  if (reply.type !== "openPopupResult" || !reply.ok) {
    console.warn("Awto: openPopup unavailable.", reply);
  }
});

startDetector((count) => {
  if (count >= 2) widget.setCount(count);
  else widget.setHidden("no-fields");
});
```

- [ ] **Step 3: Run full test suite + typecheck + build**

Run: `npm run typecheck && npm run test && npm run build`

Expected: typecheck clean, all tests pass, `dist/` rebuilt.

- [ ] **Step 4: Commit**

```bash
git add src/content/index.ts
git commit -m "feat(content): wire detector + widget; widget retires after fill"
```

---

## Task 11: Manual verification + docs update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Reload extension and run manual test plan**

Steps to execute (no commands, just verify in Chrome):

1. `chrome://extensions` → Awto → reload icon
2. Visit `https://httpbin.org/forms/post` (has 6 fillable fields)
3. Verify the pill appears bottom-right with badge `6`
4. Click pill → toolbar popup opens, chat begins
5. While "Thinking…" — close the popup → reopen → chat should restart from "Reading the form…" (no zombie request)
6. Click pill twice fast → only the second call lands
7. Click `×` on the pill → pill hides; reload page → pill reappears
8. Click pill → fill the form successfully → pill disappears (retired for this page load)

Record each step pass/fail in a scratch file.

- [ ] **Step 2: Update CLAUDE.md with the new architecture entry**

Append to the Decision Log in `CLAUDE.md`:

```markdown
### 12. Floating widget + port-based cancellation
- **2026-05-16**: Spec [docs/superpowers/specs/2026-05-16-floating-widget-and-cancellation-design.md](docs/superpowers/specs/2026-05-16-floating-widget-and-cancellation-design.md).
- Content script proactively detects forms (initial 250ms debounced scan + MutationObserver 500ms debounce) and shows a shadow-DOM pill bottom-right when ≥2 fields are detected.
- Pill click → service worker calls `chrome.action.openPopup()` → toolbar chat opens.
- Popup ↔ service worker uses `chrome.runtime.connect({name: "awto-chat"})`. Disconnect aborts in-flight LLM call. New message on same port aborts the previous controller (supersede). No request queueing.
- AbortSignal threaded local.ts → cloud.ts → hybrid.ts → handleMessage; `AbortSignal.any` composes external cancellation with the existing local-call timeout.
- Widget retires for the current page load after a successful fill. Dismiss is per page-load (cleared on reload).
- testOllama in the options page continues to use one-shot `chrome.runtime.sendMessage` (no cancellation needed for a 3s ping).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: log floating-widget + port-cancellation architecture decision"
```

---

## Acceptance Checklist (verify before declaring complete)

- [ ] Widget appears on a page with ≥2 fillable fields
- [ ] Widget never appears on chrome://, chrome-extension://, about:, view-source: URLs
- [ ] `×` on the pill hides it for the page load; reload restores it
- [ ] Pill click opens the toolbar popup (chat appears)
- [ ] Closing the popup mid-"Thinking…" cancels the in-flight LLM call (verify via DevTools network panel: fetch shows as "cancelled")
- [ ] Double-clicking the pill aborts the first request; only the latest call completes
- [ ] Successfully filling a form retires the widget for that page load
- [ ] All previously passing tests still pass
- [ ] New tests added: detector (≥4), widget (≥5), service-worker port (≥2), useAwtoFlow port (≥2)
- [ ] Total test count ≥165 (was 156)
- [ ] `npm run typecheck && npm run test && npm run build` all green
