# Hybrid mapping + streaming + rescan — Implementation Plan

> **REQUIRED SUB-SKILL:** `superpowers:subagent-driven-development`. TDD per task.

**Goal:** Cut mapping latency on big forms via (a) deterministic autocomplete-attr rule pass, (b) parallel chunked LLM for the rest, (c) chunk results stream to the chat as they arrive. Plus a rescan button + full-name composite.

**Spec:** [docs/superpowers/specs/2026-05-16-hybrid-mapping-design.md](../specs/2026-05-16-hybrid-mapping-design.md)

---

## Task 1: ScannedField gains autocomplete; scanner exposes it

**Files:**
- Modify: `src/shared/messages.ts`
- Modify: `src/content/form-scanner.ts`
- Modify: `src/content/form-scanner.test.ts`

- [ ] **Step 1: Write failing test**

Add to `src/content/form-scanner.test.ts`:

```ts
it("includes the autocomplete attribute when present", () => {
  document.body.innerHTML = `
    <form>
      <input id="fn" autocomplete="given-name" />
      <input id="em" autocomplete="email" type="email" />
      <input id="nope" />
    </form>
  `;
  const fields = scanFields(document);
  expect(fields[0]?.autocomplete).toBe("given-name");
  expect(fields[1]?.autocomplete).toBe("email");
  expect(fields[2]?.autocomplete).toBeUndefined();
});

it("normalizes autocomplete attribute (trims, lowercases tokens)", () => {
  document.body.innerHTML = `
    <input id="fn" autocomplete="  Given-Name  " />
  `;
  const fields = scanFields(document);
  expect(fields[0]?.autocomplete).toBe("given-name");
});
```

- [ ] **Step 2: Run, verify failure**

```
npm run test -- src/content/form-scanner.test.ts
```

- [ ] **Step 3: Update messages.ts**

In `src/shared/messages.ts`:

```ts
export interface ScannedField {
  id: number;
  selector: string;
  label: string;
  placeholder: string | null;
  type: string;
  required: boolean;
  options?: string[];
  autocomplete?: string;
}
```

- [ ] **Step 4: Update scanner**

In `src/content/form-scanner.ts`, where each field record is built, add:

```ts
const ac = element.getAttribute("autocomplete");
const autocomplete = ac ? ac.trim().toLowerCase() : undefined;
// ... include in returned field only if autocomplete is non-empty
```

Then on the field object: `...(autocomplete ? { autocomplete } : {})`.

- [ ] **Step 5: Run tests + typecheck**

```
npm run test
npm run typecheck
```

Expected: ≥234 tests (232 + 2 new), all pass.

- [ ] **Step 6: Commit**

```bash
git add src/shared/messages.ts src/content/form-scanner.ts src/content/form-scanner.test.ts
git commit -m "feat(scanner): expose autocomplete attribute on ScannedField"
```

---

## Task 2: rule-mapper.ts module

**Files:**
- Create: `src/background/rule-mapper.ts`
- Create: `src/background/rule-mapper.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/background/rule-mapper.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ruleMap } from "./rule-mapper";
import type { Profile } from "@/shared/profile";
import type { ScannedField } from "@/shared/messages";

function field(id: number, autocomplete?: string, label = ""): ScannedField {
  return {
    id,
    selector: `#f${id}`,
    label,
    placeholder: null,
    type: "text",
    required: false,
    ...(autocomplete ? { autocomplete } : {}),
  };
}

const profile: Profile = {
  firstName: "Patrick",
  lastName: "Adrianus",
  email: "p@x.com",
  custom: {},
};

describe("ruleMap", () => {
  it("fills given-name from profile.firstName", () => {
    const { ruleMappings, remaining } = ruleMap([field(0, "given-name")], profile);
    expect(ruleMappings).toHaveLength(1);
    expect(ruleMappings[0]).toMatchObject({
      fieldId: 0, actionType: "fill", profileKey: "firstName", confidence: 1,
    });
    expect(remaining).toEqual([]);
  });

  it("fills family-name from profile.lastName", () => {
    const { ruleMappings } = ruleMap([field(0, "family-name")], profile);
    expect(ruleMappings[0]?.profileKey).toBe("lastName");
  });

  it("fills email from profile.email", () => {
    const { ruleMappings } = ruleMap([field(0, "email")], profile);
    expect(ruleMappings[0]?.profileKey).toBe("email");
  });

  it("marks missing when profile lacks the key", () => {
    const { ruleMappings } = ruleMap([field(0, "tel")], profile);
    expect(ruleMappings[0]).toMatchObject({
      fieldId: 0, actionType: "missing", suggestedKey: "phone",
    });
  });

  it("skips sensitive autocomplete tokens (cc-number, current-password)", () => {
    const fields = [field(0, "cc-number"), field(1, "current-password")];
    const { ruleMappings } = ruleMap(fields, profile);
    expect(ruleMappings).toHaveLength(2);
    expect(ruleMappings[0]).toMatchObject({ actionType: "skip" });
    expect(ruleMappings[0]?.reason).toMatch(/sensitive/i);
    expect(ruleMappings[1]).toMatchObject({ actionType: "skip" });
  });

  it("carries forward fields without autocomplete", () => {
    const f = field(0, undefined, "Mystery field");
    const { ruleMappings, remaining } = ruleMap([f], profile);
    expect(ruleMappings).toEqual([]);
    expect(remaining).toEqual([f]);
  });

  it("composes fullName when given autocomplete=name and both names exist", () => {
    const { ruleMappings } = ruleMap([field(0, "name")], profile);
    expect(ruleMappings[0]).toMatchObject({
      actionType: "fill", profileKey: "fullName",
    });
  });

  it("marks autocomplete=name as missing when only firstName exists", () => {
    const partial: Profile = { firstName: "Patrick", custom: {} };
    const { ruleMappings } = ruleMap([field(0, "name")], partial);
    expect(ruleMappings[0]).toMatchObject({
      actionType: "missing", suggestedKey: "fullName",
    });
  });

  it("ignores unknown autocomplete tokens (carries to remaining)", () => {
    const f = field(0, "wibble");
    const { remaining } = ruleMap([f], profile);
    expect(remaining).toEqual([f]);
  });
});
```

- [ ] **Step 2: Run, verify failure**

```
npm run test -- src/background/rule-mapper.test.ts
```

- [ ] **Step 3: Implement rule-mapper.ts**

Create `src/background/rule-mapper.ts`:

```ts
import type { FieldMapping } from "@/shared/mapping";
import { getProfileValue, type Profile } from "@/shared/profile";
import type { ScannedField } from "@/shared/messages";

const TOKEN_TO_KEY: Record<string, string | null> = {
  "name": "fullName",
  "given-name": "firstName",
  "additional-name": "middleName",
  "family-name": "lastName",
  "honorific-prefix": "title",
  "nickname": "preferredName",
  "email": "email",
  "tel": "phone",
  "tel-national": "phone",
  "mobile": "mobilePhone",
  "street-address": "addressLine1",
  "address-line1": "addressLine1",
  "address-line2": "addressLine2",
  "address-level1": "state",
  "address-level2": "city",
  "postal-code": "postcode",
  "country": "country",
  "country-name": "country",
  "bday": "dateOfBirth",
  "organization": "currentEmployer",
  "organization-title": "jobTitle",
  "url": "website",
  "cc-name": null,
  "cc-number": null,
  "cc-csc": null,
  "cc-exp": null,
  "cc-exp-month": null,
  "cc-exp-year": null,
  "current-password": null,
  "new-password": null,
  "one-time-code": null,
};

export interface RuleMapResult {
  ruleMappings: FieldMapping[];
  remaining: ScannedField[];
}

function resolveValue(profile: Profile, key: string): string | undefined {
  if (key === "fullName") {
    const first = profile.firstName?.trim();
    const last = profile.lastName?.trim();
    if (first && last) return `${first} ${last}`;
    return undefined;
  }
  return getProfileValue(profile, key);
}

function makeSkip(fieldId: number, reason: string): FieldMapping {
  return {
    fieldId,
    actionType: "skip",
    profileKey: null,
    suggestedKey: null,
    promptText: null,
    reason,
    confidence: 1,
  };
}

function makeFill(fieldId: number, key: string): FieldMapping {
  return {
    fieldId,
    actionType: "fill",
    profileKey: key,
    suggestedKey: null,
    promptText: null,
    reason: null,
    confidence: 1,
  };
}

function makeMissing(fieldId: number, key: string, label: string): FieldMapping {
  const friendly = label || key;
  return {
    fieldId,
    actionType: "missing",
    profileKey: null,
    suggestedKey: key,
    promptText: `What's your ${friendly}?`,
    reason: null,
    confidence: 1,
  };
}

export function ruleMap(
  fields: ScannedField[],
  profile: Profile
): RuleMapResult {
  const ruleMappings: FieldMapping[] = [];
  const remaining: ScannedField[] = [];

  for (const field of fields) {
    const token = field.autocomplete;
    if (!token) {
      remaining.push(field);
      continue;
    }

    if (!(token in TOKEN_TO_KEY)) {
      remaining.push(field);
      continue;
    }

    const key = TOKEN_TO_KEY[token];
    if (key === null) {
      ruleMappings.push(makeSkip(field.id, "Sensitive field — won't autofill"));
      continue;
    }

    const value = resolveValue(profile, key);
    if (value !== undefined && value !== "") {
      ruleMappings.push(makeFill(field.id, key));
    } else {
      ruleMappings.push(makeMissing(field.id, key, field.label));
    }
  }

  return { ruleMappings, remaining };
}
```

- [ ] **Step 4: Run tests + typecheck**

```
npm run test
npm run typecheck
```

Expected: 9 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/background/rule-mapper.ts src/background/rule-mapper.test.ts
git commit -m "feat(background): rule-mapper for autocomplete-tagged fields"
```

---

## Task 3: concurrency.ts (chunkArray + runWithConcurrency)

**Files:**
- Create: `src/background/concurrency.ts`
- Create: `src/background/concurrency.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/background/concurrency.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { chunkArray, runWithConcurrency } from "./concurrency";

describe("chunkArray", () => {
  it("splits an array into groups of the given size", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("returns an empty array for empty input", () => {
    expect(chunkArray([], 3)).toEqual([]);
  });
  it("yields a single chunk when n exceeds length", () => {
    expect(chunkArray([1, 2], 10)).toEqual([[1, 2]]);
  });
  it("rejects non-positive chunk size", () => {
    expect(() => chunkArray([1, 2], 0)).toThrow();
  });
});

describe("runWithConcurrency", () => {
  it("runs all items respecting the concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = [1, 2, 3, 4, 5, 6];
    const results: number[] = [];
    await runWithConcurrency(items, 2, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      results.push(n * 2);
      inFlight--;
    });
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(results.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it("propagates errors from individual tasks", async () => {
    await expect(
      runWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });
});
```

- [ ] **Step 2: Run, verify failure**

```
npm run test -- src/background/concurrency.test.ts
```

- [ ] **Step 3: Implement**

Create `src/background/concurrency.ts`:

```ts
export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk size must be positive");
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (limit <= 0) throw new Error("concurrency limit must be positive");
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let firstError: unknown = null;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length || firstError) return;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (err) {
        if (!firstError) firstError = err;
        return;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  if (firstError) throw firstError;
  return results;
}
```

- [ ] **Step 4: Run + commit**

```
npm run test
npm run typecheck
git add src/background/concurrency.ts src/background/concurrency.test.ts
git commit -m "feat(background): chunkArray + runWithConcurrency helpers"
```

---

## Task 4: fullName composite in the prompt

**Files:**
- Modify: `src/background/llm/prompt.ts`
- Modify: `src/background/llm/prompt.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/background/llm/prompt.test.ts`:

```ts
it("buildUserPrompt injects a fullName composite when both names exist", () => {
  const profile = { firstName: "Patrick", lastName: "Adrianus", custom: {} };
  const prompt = buildUserPrompt(profile as any, []);
  expect(prompt).toContain("fullName: Patrick Adrianus");
});

it("buildUserPrompt does NOT inject fullName when only firstName exists", () => {
  const profile = { firstName: "Patrick", custom: {} };
  const prompt = buildUserPrompt(profile as any, []);
  expect(prompt).not.toMatch(/^- fullName:/m);
});

it("SYSTEM_PROMPT instructs to use fullName for single name-style fields", () => {
  expect(SYSTEM_PROMPT.toLowerCase()).toMatch(/customer name|full name|single name-style/);
  expect(SYSTEM_PROMPT).toContain("fullName");
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

In `src/background/llm/prompt.ts`:

Inside `buildUserPrompt`, after building `profileLines`, inject the composite when applicable:

```ts
const first = profile.firstName?.trim();
const last = profile.lastName?.trim();
if (first && last) {
  profileLines.push(`- fullName: ${first} ${last}    (computed; use for single name-style form fields)`);
}
```

In `SYSTEM_PROMPT`, append a rule paragraph:

```
When the form has a single name-style field labeled "Name", "Full name", "Customer name", "Your name", or similar, map to "fullName" (the firstName + lastName composite) — do NOT use firstName alone.
```

- [ ] **Step 4: Run + commit**

```
npm run test
git add src/background/llm/prompt.ts src/background/llm/prompt.test.ts
git commit -m "feat(llm/prompt): inject fullName composite + rule for single-name fields"
```

---

## Task 5: Service-worker orchestration with chunked streaming

**Files:**
- Modify: `src/background/service-worker.ts`
- Modify: `src/background/service-worker.test.ts`
- Modify: `src/shared/messages.ts`

- [ ] **Step 1: Extend messages.ts**

```ts
// mapFields gains bypassCache
| {
    type: "mapFields";
    fields: ScannedField[];
    profile: Profile;
    tabId?: number;
    bypassCache?: boolean;
  }
// NEW streaming messages
| { type: "mapFieldsProgress"; mappings: FieldMapping[] }
| {
    type: "mapFieldsComplete";
    mappings: FieldMapping[];
    source: "local" | "cloud" | "mixed";
  }
```

- [ ] **Step 2: Write failing service-worker tests**

Add to `src/background/service-worker.test.ts`:

```ts
it("routes autocomplete-tagged fields through rule-mapper and skips hybrid for them", async () => {
  const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
  const callHybrid = vi.fn().mockResolvedValue({
    response: { mappings: [] },
    source: "local",
  });

  const fields: ScannedField[] = [
    {
      id: 0, selector: "#a", label: "First name", placeholder: null,
      type: "text", required: false, autocomplete: "given-name",
    },
    {
      id: 1, selector: "#b", label: "Mystery", placeholder: null,
      type: "text", required: false,
    },
  ];
  const profile: Profile = { firstName: "Patrick", custom: {} };

  await handleMessage(
    { type: "mapFields", fields, profile, tabId: 1 },
    { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid }
  );

  // hybrid called with only the non-autocomplete field
  expect(callHybrid).toHaveBeenCalledTimes(1);
  expect(callHybrid.mock.calls[0]?.[1]).toEqual([fields[1]]);
});

it("bypassCache: true skips the cache lookup", async () => {
  const loadLLMSettings = vi.fn().mockResolvedValue(defaultSettings);
  const callHybrid = vi.fn().mockResolvedValue(makeHybridResult());
  // Pre-populate cache
  const key = cacheKey(7, fields);
  setCached(key, { mappings: [], source: "cloud" });

  await handleMessage(
    { type: "mapFields", fields, profile, tabId: 7, bypassCache: true },
    { _loadLLMSettings: loadLLMSettings, _callHybrid: callHybrid }
  );

  expect(callHybrid).toHaveBeenCalled();   // would have been skipped if cache was consulted
});
```

- [ ] **Step 3: Implement orchestration**

In `src/background/service-worker.ts`:

```ts
import { ruleMap } from "./rule-mapper";
import { chunkArray, runWithConcurrency } from "./concurrency";

const CHUNK_SIZE = 10;
const MAX_CONCURRENCY = 4;
```

Extend `HandleMessageDeps` with `_port?: chrome.runtime.Port | null` (for posting progress messages mid-run).

Rewrite the `case "mapFields"` body:

```ts
case "mapFields": {
  const tabId = message.tabId ?? deps.tabId;

  // Cache lookup
  if (tabId !== undefined && !message.bypassCache) {
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

  // Rule layer
  const { ruleMappings, remaining } = ruleMap(message.fields, message.profile);

  // Existing prefilter
  const { toLLM, skipped: prefilterSkipped } = prefilter(remaining, message.profile);

  // Stream initial deterministic mappings if any
  if (deps._port && (ruleMappings.length > 0 || prefilterSkipped.length > 0)) {
    const initial = [...ruleMappings, ...prefilterSkipped].sort(
      (a, b) => a.fieldId - b.fieldId
    );
    deps._port.postMessage({
      type: "mapFieldsProgress",
      mappings: initial,
    });
  }

  // Parallel chunked LLM
  const llmMappings: FieldMapping[] = [];
  const sources = new Set<"local" | "cloud" | "mixed">();
  let llmError: Error | null = null;

  if (toLLM.length > 0) {
    try {
      const settings = await loadSettings();
      const chunks = chunkArray(toLLM, CHUNK_SIZE);
      await runWithConcurrency(chunks, MAX_CONCURRENCY, async (chunk) => {
        const result = await hybrid(
          message.profile,
          chunk,
          { ...settings, signal: deps.signal }
        );
        llmMappings.push(...result.response.mappings);
        sources.add(result.source);
        if (deps._port) {
          deps._port.postMessage({
            type: "mapFieldsProgress",
            mappings: result.response.mappings,
          });
        }
      });
    } catch (err) {
      llmError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (llmError) {
    if (llmError.name === "AbortError") {
      return { type: "mapFieldsError", error: llmError.message };
    }
    console.error("Awto: mapFields chunk failed:", llmError.message);
    return { type: "mapFieldsError", error: llmError.message };
  }

  const allMappings = [...ruleMappings, ...prefilterSkipped, ...llmMappings].sort(
    (a, b) => a.fieldId - b.fieldId
  );
  const source: "local" | "cloud" | "mixed" =
    sources.size > 1 ? "mixed" : (sources.values().next().value ?? "local");

  if (tabId !== undefined) {
    setCached(cacheKey(tabId, message.fields), {
      mappings: allMappings,
      source,
    });
  }

  return {
    type: "mapFieldsComplete",
    mappings: allMappings,
    source,
  };
}
```

`registerPortHandler` passes the port to `handleMessage` via deps. Inside `port.onMessage`:

```ts
const reply = await handleMessage(message, {
  ...baseDeps,
  tabId,
  signal: next.signal,
  _port: port,
});
```

- [ ] **Step 4: Run + commit**

```
npm run test
npm run typecheck
git add src/shared/messages.ts src/background/service-worker.ts src/background/service-worker.test.ts
git commit -m "feat(service-worker): rule-layer + chunked parallel LLM with streamed progress"
```

---

## Task 6: Popup streaming + rescan

**Files:**
- Modify: `src/popup/useAwtoFlow.ts`
- Modify: `src/popup/useAwtoFlow.test.ts`
- Modify: `src/popup/Popup.tsx`
- Modify: `src/popup/styles.css`

- [ ] **Step 1: Add rescan + streaming handlers to useAwtoFlow**

In `src/popup/useAwtoFlow.ts`:

- Expose `rescan: () => void` from the hook.
- Add handling for `mapFieldsProgress`: append the partial mappings to the appropriate row lists, do NOT change `status` (stays `mapping`).
- Add handling for `mapFieldsComplete`: same shape as the existing `mapFieldsResult` happy path (status → `ready`).
- `rescan` posts `mapFields` again with `bypassCache: true`, resets status to `mapping`, clears row state.

```ts
const rescan = useCallback(() => {
  const port = portRef.current;
  const tabId = tabIdRef.current;
  const fields = fieldsRef.current;
  const profile = profileRef.current;
  if (!port || tabId === undefined || !fields) return;
  setState((s) => ({
    ...s,
    fillRows: [], missingRows: [], skippedRows: [],
    mappings: [],
  }));
  setStatus("mapping");
  port.postMessage({
    type: "mapFields",
    fields,
    profile,
    tabId,
    bypassCache: true,
  });
}, []);
```

Return `rescan` from the hook.

For progress accumulation, factor out a helper that converts a `FieldMapping[]` slice into `{fillRows, missingRows, skippedRows}` row objects. Use the existing logic — refactor if needed.

- [ ] **Step 2: Add tests**

```ts
it("appends rows as mapFieldsProgress chunks arrive", async () => {
  // mount hook, port replies with two progress messages and then complete
  // assert fillRows accumulate
});

it("rescan() posts mapFields with bypassCache: true", async () => {
  // mount, wait for ready state
  // call result.current.rescan()
  // assert port.posted has another mapFields with bypassCache: true
});
```

- [ ] **Step 3: Add rescan button + progress copy in Popup.tsx**

```tsx
import { RefreshCw } from "lucide-react";
// ...
const { rescan, ... } = useAwtoFlow();

// In StatusBar or inline in header, add (only for ready / error / done):
{(status === "ready" || status === "error" || status === "done") && (
  <button
    type="button"
    className="awto-iconbtn"
    onClick={rescan}
    aria-label="Rescan this form"
    title="Rescan this form"
  >
    <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
  </button>
)}
```

In the `mapping` state bubble, append a chunks-done counter if `chunksCompleted > 0`:

```tsx
{state.chunksCompleted > 0 && ` (${state.chunksCompleted} done)`}
```

Note: `chunksCompleted` needs to live in `FlowState`. Add to `src/popup/types.ts`.

- [ ] **Step 4: Add CSS for the header button if needed**

Reuse `.awto-iconbtn` from options styles (popup styles already share many tokens; if `.awto-iconbtn` is options-only, add a similar rule to popup/styles.css).

- [ ] **Step 5: Run + commit**

```
npm run test
npm run typecheck
npm run build
git add src/popup/useAwtoFlow.ts src/popup/useAwtoFlow.test.ts src/popup/Popup.tsx src/popup/styles.css src/popup/types.ts
git commit -m "feat(popup): streaming chunked progress + rescan button"
```

---

## Acceptance

- [ ] Forms with autocomplete attrs see ≥40% of fields resolved without LLM calls
- [ ] LLM fields chunk into groups of 10, max 4 in parallel
- [ ] Will-fill rows appear progressively in the chat (visible in slow-network DevTools throttle)
- [ ] Rescan button visible in chat header; click triggers fresh LLM run, bypassing cache
- [ ] Single name-style field ("Customer name") maps to "Patrick Adrianus" not just "Patrick"
- [ ] All previously passing tests still pass
- [ ] Total tests grow by ~20 (autocomplete scanner +2, rule-mapper +9, concurrency +5, prompt +3, service-worker +2, popup +2)
- [ ] `npm run typecheck && npm run test && npm run build` green
