# Plan: "Awto" — Smart Personal-Detail Autofill (Chrome Extension)

## Context

Filling out the same personal details (name, email, phone, address, DOB, etc.) over and over on web forms is repetitive and error-prone. Built-in browser autofill and password managers handle ~70% of standard forms but break on:

- Non-standard field labels ("given name" vs "first name" vs "fname")
- Multi-step forms
- Forms that ask for derived/conditional info
- Fields the user hasn't pre-mapped

**Goal:** a Chrome extension that uses an LLM to intelligently map a user's stored profile to whatever form is on the page, asks the user for missing fields once and remembers them, and always shows a confirmation step before filling. Privacy-first: local Ollama model by default, Anthropic Claude as fallback when the local model is uncertain.

**Out of scope for v1:** form submission (extension fills, user submits), multi-page workflow memory, autonomous research (asking external sources for missing info), encryption of stored profile, Firefox/Safari ports.

## Architecture (one paragraph)

A Manifest V3 Chrome extension with three runtime contexts: a **content script** that scans the active form's fields and writes values back into the DOM; a **background service worker** that handles LLM calls (local Ollama first, Anthropic Claude fallback); and a **popup UI** for confirmation + a missing-field form. The user's profile and API key live in `chrome.storage.local`. The LLM is constrained via structured outputs (Ollama JSON schema mode / Anthropic tool use) — it returns a strict `{fieldId, profileKey | "missing", confidence}` mapping, validated by Zod before any DOM write. The popup is the verification step: nothing fills without the user clicking confirm.

## Tech stack

- **TypeScript** + **React** (popup and options page UI)
- **Vite** + `@crxjs/vite-plugin` (build)
- **Zod** (schema validation — same role Pydantic plays in the Python world)
- **Anthropic SDK** (`@anthropic-ai/sdk`) — tool use for strict JSON output
- **Ollama** (user-installed) — default local LLM via `http://localhost:11434/api/chat`
- No state library, no backend server, no DB

## File structure

```
awto/
├── manifest.json
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── background/
│   │   ├── service-worker.ts         # message router + LLM orchestrator
│   │   └── llm/
│   │       ├── local.ts              # Ollama client
│   │       ├── cloud.ts              # Anthropic client
│   │       ├── hybrid.ts             # local → cloud fallback logic
│   │       └── prompt.ts             # prompt + JSON schema for field mapping
│   ├── content/
│   │   ├── index.ts                  # entry, listens for "scan"/"fill" messages
│   │   ├── form-scanner.ts           # finds fields + extracts labels
│   │   └── form-filler.ts            # writes values, dispatches input/change events
│   ├── popup/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── Popup.tsx                 # confirmation UI + missing-field form
│   ├── options/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── Options.tsx               # profile editor + API key + Ollama settings
│   └── shared/
│       ├── profile.ts                # Zod schema for the profile
│       ├── mapping.ts                # Zod schema for LLM field-mapping output
│       ├── storage.ts                # typed chrome.storage wrapper
│       └── messages.ts               # typed message types between contexts
└── README.md
```

## Key components

### 1. Profile schema (`src/shared/profile.ts`)
Flat JSON, user-extensible. Seeded with common Australian fields:
```ts
{
  firstName, lastName, preferredName, email, phone, dateOfBirth,
  addressLine1, addressLine2, suburb, state, postcode, country,
  nationality, workRights, // ...
  custom: { [key: string]: string }  // anything the LLM learns later
}
```

### 2. Form scanner (`src/content/form-scanner.ts`)
For each visible, non-disabled `<input>` / `<select>` / `<textarea>` inside the active form, extract:
- `selector` (stable: id > name > data-* > nth-of-type fallback)
- `label` (from `<label for=>`, ancestor `<label>`, `aria-label`, `aria-labelledby`, or nearest preceding text node)
- `placeholder`, `type`, `required`, options (for `<select>`)
- skip submit/reset/button/hidden types

Output: `Array<{id, selector, label, placeholder, type, options?}>`

### 3. LLM mapping (`src/background/llm/`)
**Prompt input:** the user's profile (keys + masked values to avoid exposing more than needed — actually full values are fine since this is the user's own data flowing to their own configured LLM) + the field list.

**Strict output schema (Zod):**
```ts
z.array(z.object({
  fieldId: z.number(),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("fill"), profileKey: z.string(), confidence: z.number() }),
    z.object({ type: z.literal("missing"), suggestedKey: z.string(), promptText: z.string() }),
    z.object({ type: z.literal("skip"), reason: z.string() })
  ])
}))
```

**Hybrid strategy (`hybrid.ts`):**
1. Try Ollama with JSON-schema-constrained output.
2. Validate with Zod. If parse fails OR any `confidence < 0.7`, retry the whole call (or just the uncertain fields) on Anthropic.
3. If cloud also fails / no API key configured, return what we have and mark the uncertain ones as `missing` so the user resolves them.

### 4. Popup confirmation UI (`src/popup/Popup.tsx`)
Three sections:
- **Will fill:** table of `field label → value` with inline edit
- **Needs your input:** any `missing` fields with a text input each
- **Skipped:** collapsed list of fields the LLM chose not to touch, with reasons

Buttons: **Fill** (commits to DOM + saves any new fields to profile), **Cancel**.

### 5. Form filler (`src/content/form-filler.ts`)
For each confirmed field:
- text/email/tel/number: set `.value`, dispatch `input` + `change` events (so React/Vue forms register the update)
- `<select>`: match option by value or visible text, set, dispatch `change`
- checkbox/radio: set `.checked`, dispatch `change`

### 6. Options page (`src/options/Options.tsx`)
- Profile editor: friendly form view + raw JSON view
- LLM settings: Ollama URL + model name (default `llama3.2`), Anthropic API key, fallback toggle
- Ollama health check button ("Test connection")

## Verification plan (how to know it works)

1. **Local fixtures:** unit tests for `form-scanner` with HTML fixtures of varying complexity (well-labeled, ambiguous labels, deeply nested, React-style forms). Run with `vitest`.
2. **LLM mapping tests:** snapshot tests for prompt → expected mapping on a fixed set of field lists. Run against both Ollama and Claude.
3. **Real-world manual test set** — load the unpacked extension in Chrome and try:
   - A Seek/LinkedIn-style job application form
   - A government-style form (e.g. ATO contact form, MyGov demo)
   - A signup form with custom field names (e.g. Substack, GitHub)
   - A multi-step checkout form (e.g. demo Shopify store)
   - A form with weird labels ("Tell us how to reach you")
   For each: record (a) % of fields correctly mapped without intervention, (b) % requiring user-provided missing values, (c) any DOM-write failures.
4. **Acceptance:** ≥85% correct fill rate across the manual set with hybrid mode, with no incorrect fills (skip-or-ask is always safer than wrong-fill).

## Build & run

```
npm install
npm run dev          # vite dev with HMR for popup/options
npm run build        # production build → dist/
# Then in Chrome: chrome://extensions → "Load unpacked" → select dist/
```

## What we are explicitly NOT building (from the architectural doc)

- ❌ Multi-agent orchestration (LangGraph, agent swarms) — one LLM call per form is enough
- ❌ GraphRAG / Kuzu — the profile is a flat object; no relational traversal needed
- ❌ Computer vision (Skyvern-style) — DOM parsing handles 99% of forms
- ❌ Chain of Verification, evaluator-refiner loops — the human confirmation is the verifier
- ❌ DOM read-back verification — for v1, trust the write; user sees the filled form before submitting anyway
- ❌ Hardware keystore (Keychain/Android Keystore) — `chrome.storage.local` is acceptable for v1
- ❌ Autonomous web research for missing fields — we just ask the user

These are deferred to v2+ if real usage shows they're needed.
