# Hybrid rule + LLM mapping with parallel batching + rescan

**Date:** 2026-05-16
**Status:** Approved
**Related code:** `src/shared/messages.ts`, `src/content/form-scanner.ts`, `src/background/*`, `src/popup/*`

## Context

Three pains from manual testing:
1. **Slow on big forms.** 40+ fields → ~30s LLM call → "Thinking…" feels endless.
2. **Wrong mapping for ambiguous single-name fields.** Pizza form's "Customer name" got "FName" only; user expected full name.
3. **No way to rescan.** If a mapping is wrong or the form changed, user must reload the page.

Fix with three coordinated changes:
- **Rule-based fast path** for fields with explicit HTML `autocomplete` attribute — no LLM call needed.
- **Parallel chunked LLM** for the rest; results stream to the chat as chunks complete.
- **Rescan button** in the chat header; bypasses the result cache.
- Plus: **full-name composite** virtual profile key + prompt rule for single name-style fields.

## Decisions

| Question | Decision |
|---|---|
| Rule layer aggression | Autocomplete attribute only (high precision) |
| Streaming UX | Chunks land live in the will-fill list as they complete |
| Chunk size | 10 fields |
| Max parallel chunks | 4 (cap for local Ollama; cloud handles more but we don't need to) |
| Cancellation | All chunks share one AbortSignal; port disconnect aborts everything |
| Rescan placement | Header bar of the chat, Lucide `RefreshCw` icon |
| Full-name | Virtual `fullName` key injected into prompt context (firstName + " " + lastName), plus a prompt rule |

## Architecture

```
mapFields message arrives at service worker
  │
  ├─▶ rule-mapper.ts (autocomplete-token table)
  │     ├─ Sensitive tokens (cc-*, *-password) → skip
  │     ├─ Known tokens with profile value → fill (confidence 1.0)
  │     ├─ Known tokens missing in profile → missing
  │     └─ No autocomplete → carry forward
  │
  ├─▶ field-prefilter.ts (existing F4)
  │     └─ Checkboxes/radios without consent-key → skip
  │
  ├─▶ chunk remaining into groups of 10
  │     └─ Promise.allSettled with concurrency cap of 4
  │            │
  │            ├─▶ each chunk calls callHybrid(profile, chunk, ...)
  │            └─▶ on resolve, port.postMessage({type: "mapFieldsProgress", mappings: <chunk>})
  │
  ├─▶ merge: rule + prefilter + all chunks, sorted by fieldId
  ├─▶ cache the merged result
  └─▶ port.postMessage({type: "mapFieldsComplete", mappings, source})
```

## Components

### 1. ScannedField gains autocomplete

`src/shared/messages.ts`:

```ts
export interface ScannedField {
  id: number;
  selector: string;
  label: string;
  placeholder: string | null;
  type: string;
  required: boolean;
  options?: string[];
  autocomplete?: string;   // NEW — the raw HTML attribute
}
```

`src/content/form-scanner.ts`: read `element.getAttribute("autocomplete")` (or `element.autocomplete` for inputs/selects/textareas) and include it in the output. Empty / missing → omit.

### 2. New module `src/background/rule-mapper.ts`

```ts
import type { FieldMapping } from "@/shared/mapping";
import type { Profile } from "@/shared/profile";
import { getProfileValue } from "@/shared/profile";
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
  // Sensitive — never autofill (null means explicit skip)
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
  ruleMappings: FieldMapping[];   // resolved fields with confidence 1.0
  remaining: ScannedField[];      // forward to LLM
}

export function ruleMap(fields: ScannedField[], profile: Profile): RuleMapResult;
```

Logic per field:
- No `autocomplete` attr → push to `remaining`
- Token = null (sensitive) → emit `skip` mapping with reason "Sensitive field — won't autofill"
- Token maps to profile key with value → emit `fill` (confidence 1.0)
- Token maps to profile key but value empty → emit `missing` with suggestedKey + a default promptText (e.g. `What's your <label>?`)

The `fullName` virtual key resolves via a small helper that composes `firstName + " " + lastName` when both exist; otherwise treated as empty/missing.

### 3. Full-name composite in the prompt

`src/background/llm/prompt.ts`:

`buildUserPrompt` enriches the profile section with `fullName` when both names exist:

```
Available profile keys (with values):
- firstName: Patrick
- lastName: Adrianus
- fullName: Patrick Adrianus    (computed; use for single name-style form fields)
- email: ...
```

Plus add a rule to `SYSTEM_PROMPT`:

> When the form has a single name-style field labeled "Name", "Full name", "Customer name", "Your name", etc., map to `fullName` (the firstName + lastName composite). Do not use `firstName` alone for these.

### 4. Service-worker orchestration

`src/background/service-worker.ts` `mapFields` case becomes:

```ts
case "mapFields": {
  const tabId = message.tabId ?? deps.tabId;

  // 1. Cache lookup (unchanged from Spec C)
  if (tabId !== undefined && !message.bypassCache) {
    const key = cacheKey(tabId, message.fields);
    const cached = getCached(key);
    if (cached) return {type: "mapFieldsResult", mappings: cached.mappings, source: cached.source};
  }

  // 2. Rule layer (NEW)
  const { ruleMappings, remaining } = ruleMap(message.fields, message.profile);

  // 3. Existing prefilter on `remaining`
  const { toLLM, skipped: prefilterSkipped } = prefilter(remaining, message.profile);

  // 4. Stream rule + prefilter results immediately if there are any
  if (deps.port && (ruleMappings.length > 0 || prefilterSkipped.length > 0)) {
    const initial = [...ruleMappings, ...prefilterSkipped].sort((a, b) => a.fieldId - b.fieldId);
    deps.port.postMessage({type: "mapFieldsProgress", mappings: initial});
  }

  // 5. Chunked parallel LLM
  let llmMappings: FieldMapping[] = [];
  let source: "local" | "cloud" | "mixed" = "local";
  if (toLLM.length > 0) {
    const settings = await loadSettings();
    const chunks = chunkArray(toLLM, 10);
    const sources = new Set<"local"|"cloud"|"mixed">();

    await runWithConcurrency(chunks, 4, async (chunk) => {
      const result = await hybrid(message.profile, chunk, {...settings, signal: deps.signal});
      llmMappings.push(...result.response.mappings);
      sources.add(result.source);
      if (deps.port) {
        deps.port.postMessage({
          type: "mapFieldsProgress",
          mappings: result.response.mappings,
        });
      }
    });

    source = sources.size > 1 ? "mixed" : (sources.values().next().value ?? "local");
  }

  // 6. Merge + cache
  const allMappings = [...ruleMappings, ...prefilterSkipped, ...llmMappings]
    .sort((a, b) => a.fieldId - b.fieldId);

  if (tabId !== undefined) {
    setCached(cacheKey(tabId, message.fields), {mappings: allMappings, source});
  }

  return {type: "mapFieldsComplete", mappings: allMappings, source};
}
```

`registerPortHandler` passes `port` into `deps` so the handler can post progress messages mid-execution. Final `mapFieldsComplete` becomes the value of the port reply.

`chunkArray(arr, n)` and `runWithConcurrency(items, limit, fn)` are small helpers in `src/background/concurrency.ts`.

### 5. Message contract changes

`src/shared/messages.ts`:

```ts
// mapFields gains an optional bypassCache flag
| {
    type: "mapFields";
    fields: ScannedField[];
    profile: Profile;
    tabId?: number;
    bypassCache?: boolean;
  }
// NEW progress message
| { type: "mapFieldsProgress"; mappings: FieldMapping[] }
// NEW final message (replaces the existing mapFieldsResult for the streamed path)
| {
    type: "mapFieldsComplete";
    mappings: FieldMapping[];
    source: "local" | "cloud" | "mixed";
  }
```

`mapFieldsResult` stays — used for the cache-hit fast path (no streaming needed; one-shot reply).

### 6. Popup streaming + rescan

`src/popup/useAwtoFlow.ts`:
- Handle `mapFieldsProgress`: append to `state.fillRows` / `missingRows` / `skippedRows` (computed from the chunk's mappings).
- Handle `mapFieldsComplete`: same as the existing `mapFieldsResult` handler (status → ready, store source).
- Handle `mapFieldsResult` (cache-hit path): unchanged.
- Add `rescan()` method that posts `mapFields` with `bypassCache: true`. Resets state and re-enters `mapping`.

`src/popup/Popup.tsx`:
- Header bar gains a `RefreshCw` button (right side, next to status indicator). Visible only in `ready` / `error` / `done` states. Click → `rescan()`.
- "Thinking…" copy gains a progress counter: `Working out what to fill… (X done)` — counts chunks completed. Stays as live text via `aria-live="polite"`.
- Will-fill rows render as they arrive — no UI change needed beyond consuming the state.

## Testing strategy

`src/background/rule-mapper.test.ts`:
- autocomplete="given-name" + profile.firstName="Pat" → fill mapping
- autocomplete="given-name" + missing profile → missing mapping
- autocomplete="cc-number" → skip with sensitive reason
- autocomplete absent → field carried to remaining
- autocomplete="name" + both names present → fill with fullName "Patrick Adrianus"
- autocomplete="name" + only firstName → missing (composite incomplete)

`src/background/concurrency.test.ts`:
- chunkArray splits correctly
- runWithConcurrency respects the limit
- runWithConcurrency surfaces errors

`src/background/service-worker.test.ts`:
- mapFields with autocomplete-tagged fields: callHybrid called with only the non-tagged subset
- mapFields with bypassCache: true: skips cache lookup, calls hybrid, writes cache
- mapFields with mixed chunks: port receives multiple mapFieldsProgress messages and one mapFieldsComplete
- Existing cache hit short-circuit still works

`src/popup/useAwtoFlow.test.ts`:
- Receives mapFieldsProgress chunks: fillRows accumulate
- Receives mapFieldsComplete: status transitions to ready
- rescan() posts mapFields with bypassCache: true

`src/popup/Popup.test.tsx`:
- Rescan button renders in ready state, not in mapping state
- Clicking rescan triggers state reset

## Acceptance

- [ ] Forms with autocomplete attrs see ≥40% of fields resolved without LLM calls
- [ ] LLM-side fields chunk into groups of 10, max 4 in parallel
- [ ] Will-fill list rows appear progressively as chunks complete
- [ ] Single name-style field ("Customer name") maps to "Patrick Adrianus" not "Patrick"
- [ ] Rescan button visible in chat header; click triggers fresh LLM run, bypassing cache
- [ ] All existing tests still pass; new tests cover rule-mapper, concurrency, streaming, rescan
- [ ] `npm run typecheck && npm run test && npm run build` green

## Out of scope

- Label-synonym rule layer (level 2 from brainstorm — defer)
- Ollama response streaming (per-token) — only chunk-level streaming
- Smart per-section field grouping for chunks (just sequential slicing)
- Multi-step wizard form awareness
- Configurable chunk size / parallelism in options UI
