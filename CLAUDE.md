# Awto — Project Memory & Decisions

> Single source of truth for this codebase. Read first in every new session. Updated by Claude as decisions are made.

## What Awto Is

**Awto** is a Chrome extension (Manifest V3) that uses an LLM to intelligently autofill repetitive personal-detail forms across the web. The user (Patrick, based in Melbourne, Australia) is tired of typing the same name / email / phone / address / DOB into job applications, signup forms, and government portals. Existing autofill (Chrome built-in, 1Password) handles ~70% of standard forms but breaks on non-standard labels, multi-step forms, and fields the user hasn't pre-mapped.

The goal is **smarter autofill**, not a full autonomous form-filling agent. Specifically:

- Maps the user's stored profile to whatever form is on the page using semantic understanding (not just field-name matching).
- Asks for missing fields **once** and remembers them.
- Always shows a confirmation step before filling — the user is the final verifier.
- Privacy-first: local Ollama model by default, Anthropic Claude as fallback when local is uncertain.

## Decision Log

Every architectural decision made for this project, in order. Update when new decisions are made — don't rewrite history.

### 1. Problem framing
- **2026-05-15**: Patrick saw a tedious "Data Entry & Administration" job posting and forwarded a 5,000-word architectural blueprint (multi-agent / GraphRAG / Markov-chain verification / hardware keystore). After review, the blueprint was rejected as overengineered for the actual need.
- **Decision**: Build the simplest thing that solves Patrick's real problem: "personal details… cause sometimes it is very repetitive."

### 2. Product scope
- **In scope (v1)**: profile storage, LLM-assisted form-field mapping, confirmation UI, missing-field capture, learning new fields.
- **Out of scope (v1)**: form *submission* (user clicks submit themselves), multi-page form state, autonomous external research, profile encryption, Firefox/Safari ports, mobile.

### 3. Distribution model
- **Decision**: Chrome browser extension (not web app, not desktop app, not native mobile).
- **Rationale**: Patrick fills forms most on desktop browser. Extensions are the right surface for in-page DOM manipulation.

### 4. Browser target for v1
- **Decision**: Chrome only.
- **Rationale**: Simplest path. Manifest V3 is mandatory for Chrome Web Store submissions as of 2026. Firefox/Safari deferred to v2.

### 5. LLM strategy
- **Decision**: **Hybrid** — Ollama (local) by default, Anthropic Claude API as fallback when the local model returns low-confidence or malformed output.
- **Rationale**: Maximises privacy (most form-fills never leave the device) while preserving reliability for hard cases. User pays for cloud only on tricky forms.
- **Local model default**: `llama3.2` (3B). Configurable in options.
- **Cloud model**: `claude-opus-4-7` for hard cases (current latest Opus as of 2026-05). Configurable.
- **Confidence threshold for fallback**: 0.7. If any mapped field has confidence < 0.7, retry the full call on cloud.

### 6. Tech stack
| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript** | Type safety across content/background/popup boundaries |
| UI framework | **React** | Standard, well-supported in extension popups |
| Build tool | **Vite + @crxjs/vite-plugin** | Best-in-class MV3 support, HMR for popup/options |
| Schema validation | **Zod** | TypeScript-native; `zodToJsonSchema()` feeds both Ollama `format` param and Anthropic tool `input_schema` |
| Local LLM client | **`ollama` JS library** | Native `format` param support for JSON schema |
| Cloud LLM client | **`@anthropic-ai/sdk`** with `dangerouslyAllowBrowser: true` | Anthropic CORS-enabled their API for direct browser use in 2024 |
| State / storage | **`chrome.storage.local`** | No DB or backend; persisted across sessions |

No backend server, no database, no analytics, no telemetry.

### 7. Profile storage
- **Decision**: Flat JSON in `chrome.storage.local`. Plain text in v1.
- **Future (v2)**: Optional passphrase encryption via Web Crypto API. Not in v1 to avoid the password-recovery UX burden up front.

### 8. Form filling flow
1. User clicks Awto's toolbar icon on a page with a form.
2. Content script scans visible form fields → produces `[{id, selector, label, placeholder, type, options}]`.
3. Background service worker calls LLM (local first, cloud fallback) with profile + field list → strict Zod-validated mapping.
4. Popup shows three sections: **Will fill** (editable), **Needs your input** (missing fields with inline form), **Skipped** (LLM declined, collapsed by default).
5. User clicks **Fill** → content script writes values to the DOM, dispatches `input` + `change` events (so React/Vue forms register the update), saves any newly-provided fields back to profile.
6. User clicks Submit on the page themselves (we don't auto-submit).

### 9. LLM output schema
**Critical gotcha discovered in research**: Anthropic's tool `input_schema` does **not** support `oneOf` / `allOf` / `anyOf` at the **top level** ([source](https://github.com/anthropics/claude-code/issues/3383)). They are allowed inside nested properties.

So the original plan's `z.discriminatedUnion` (which compiles to a top-level `anyOf`) needs to live inside a property. **Final shape**:

```ts
const FieldMapping = z.object({
  fieldId: z.number(),
  actionType: z.enum(["fill", "missing", "skip"]),
  profileKey: z.string().nullable(),      // present when actionType === "fill"
  suggestedKey: z.string().nullable(),    // present when actionType === "missing"
  promptText: z.string().nullable(),      // present when actionType === "missing"
  reason: z.string().nullable(),          // present when actionType === "skip"
  confidence: z.number().min(0).max(1),
});

const LLMResponse = z.object({
  mappings: z.array(FieldMapping),
});
```

The discriminator is the `actionType` string. Post-validation, we narrow with a TS type guard.

### 10. UI design system
Generated by `/ui-ux-pro-max` skill on 2026-05-15. Full output persisted in `DESIGN_SYSTEM.md`. Headline:

- **Pattern**: Minimal Single Column. One primary CTA per screen. Lots of whitespace.
- **Style**: Micro-interactions — subtle 50-100ms hovers, gesture-friendly, tactile feedback.
- **Theme**: Dark-first (slate-900 background), light supported. Code-dark feel.
- **Color tokens**:
  - Primary: `#1E293B` (slate-800)
  - Accent / CTA: `#22C55E` (green-500)
  - Background: `#0F172A` (slate-900)
  - Foreground: `#F8FAFC` (slate-50)
  - Destructive: `#EF4444` (red-500)
  - Border: `#475569` (slate-600)
- **Typography**: Inter (300/400/500/600/700)
- **Icons**: Lucide (SVG, never emoji)
- **Animation timing**: 150–300ms for micro-interactions, ease-out for entering, exit faster than enter
- **Touch targets**: ≥44×44px even on desktop (Patrick may use a touchscreen Mac)
- **Contrast**: ≥4.5:1 body, ≥7:1 buttons

### 11. Verification target
- **Acceptance**: ≥85% correct fill rate across a manual test set with **zero incorrect fills**. "Skip-or-ask" is always safer than "wrong-fill" — wrong values on a tax/insurance/government form can be irreversible.
- **Manual test set**: Seek-style job application, MyGov-style form, Substack signup, demo Shopify checkout, an intentionally awkwardly-labeled form.

## Critical Gotchas (discovered in research)

These are non-obvious traps. Don't re-learn them.

1. **MV3 service workers terminate when idle.** Do not store state in module-level variables in the background worker — always rehydrate from `chrome.storage`. ([source](https://developer.chrome.com/docs/extensions/mv3/migrating_to_service_workers/))
2. **Anthropic API input_schema rejects top-level `oneOf`/`anyOf`/`allOf`.** Wrap unions inside a property. See decision #9. ([source](https://github.com/anthropics/claude-code/issues/3383))
3. **No SSE/streaming response interception in MV3 background workers** for third-party requests. Our LLM calls are non-streaming JSON, so this doesn't bite us — but don't accidentally add streaming. ([source](https://dev.to/wilow445/how-to-intercept-server-sent-events-in-chrome-extensions-mv3-guide-23kb))
4. **Anthropic CORS via `dangerouslyAllowBrowser: true`.** Anthropic enabled CORS in Aug 2024 specifically to support client-side use. Required header: `anthropic-dangerous-direct-browser-access: true` (the SDK sets this automatically when the flag is on). The user's API key sits in `chrome.storage.local` — acceptable for v1 since it's their own machine and their own key. ([source](https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access/))
5. **Ollama Cloud does NOT support structured outputs** as of 2026. Only local Ollama. Our default path is local, so this is fine — but if anyone considers swapping to Ollama Cloud later, structured output breaks. ([source](https://docs.ollama.com/capabilities/structured-outputs))
6. **For React/Vue forms, setting `input.value` directly does not trigger the framework's listeners.** Must dispatch both `input` and `change` events (and for some libraries, use the native `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)` trick to bypass React's value tracker).
7. **`always_return_true_async_listeners`**: in `chrome.runtime.onMessage` listeners, return `true` if `sendResponse` is called asynchronously, otherwise the channel closes and the popup hangs.

## File Layout

```
awto/
├── manifest.json
├── package.json
├── tsconfig.json
├── vite.config.ts
├── CLAUDE.md                   # this file
├── DESIGN_SYSTEM.md            # ui-ux-pro-max output
├── PLAN.md                     # full implementation plan
├── src/
│   ├── background/
│   │   ├── service-worker.ts   # message router + LLM orchestrator
│   │   └── llm/
│   │       ├── local.ts        # Ollama client
│   │       ├── cloud.ts        # Anthropic client
│   │       ├── hybrid.ts       # local → cloud fallback strategy
│   │       └── prompt.ts       # prompt template + JSON schema
│   ├── content/
│   │   ├── index.ts            # entry, listens for scan/fill messages
│   │   ├── form-scanner.ts     # finds fields, extracts labels
│   │   └── form-filler.ts      # writes values, fires correct events
│   ├── popup/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── Popup.tsx           # confirmation UI
│   ├── options/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── Options.tsx         # profile editor + LLM settings
│   └── shared/
│       ├── profile.ts          # Zod schema for the profile
│       ├── mapping.ts          # Zod schema for LLM output
│       ├── storage.ts          # typed chrome.storage wrapper
│       └── messages.ts         # typed messages between contexts
└── README.md
```

## Build & Dev

```bash
npm install
npm run dev      # Vite HMR for popup/options/content
npm run build    # → dist/
# Chrome: chrome://extensions → "Load unpacked" → select dist/
```

## What We Explicitly Are NOT Building (vs the blueprint)

| Rejected | Why |
|---|---|
| Multi-agent orchestration (LangGraph, agent swarms) | One LLM call per form is enough. Multi-agent has its place; this isn't it. |
| GraphRAG / Kuzu | The profile is a flat object; no relational traversal needed. |
| Computer vision (Skyvern-style) | DOM parsing handles 99% of forms. Vision adds 5-15s latency for no real-world gain here. |
| Chain of Verification / evaluator-refiner loops | The human confirmation step is the verifier. |
| DOM read-back verification | User sees the filled form before submitting; that's the read-back. |
| Hardware keystore (Keychain / Android Keystore) | `chrome.storage.local` is acceptable for v1. The API key is the user's own. |
| Autonomous external research for missing fields | We ask the user instead. Cheaper, safer, more accurate. |
| Form submission automation | User submits. Reduces blast radius of mistakes by ~100x. |

## Conventions

- **No emojis as icons.** Lucide SVGs only.
- **No comments explaining WHAT the code does** — well-named identifiers suffice. Only comment WHY when non-obvious.
- **No backwards-compatibility shims** — we control the whole codebase.
- **Touch targets ≥44px** on every interactive element.
- **Confirm before destructive actions** — clearing the profile, deleting an API key, etc.
- **Never log the profile or API key to console.** Even in dev.

## Open Questions / Decisions Deferred

- Whether to support multiple personas (work / personal). Deferred to v2 — see if v1 usage actually demands it.
- Whether to encrypt the profile with a passphrase. Deferred to v2.
- Firefox port. Deferred to v2.
- Whether to add a keyboard shortcut. Deferred — see if toolbar click is enough friction.

## Sources Consulted (2026-05-15)

- [Ollama Structured Outputs docs](https://docs.ollama.com/capabilities/structured-outputs)
- [Anthropic CORS / dangerouslyAllowBrowser announcement (Simon Willison)](https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access/)
- [Chrome MV3 service worker migration guide](https://developer.chrome.com/docs/extensions/mv3/migrating_to_service_workers/)
- [How to intercept SSE in MV3 extensions](https://dev.to/wilow445/how-to-intercept-server-sent-events-in-chrome-extensions-mv3-guide-23kb)
- [Best practices for rendering streamed LLM responses (Chrome devrel)](https://developer.chrome.com/docs/ai/render-llm-responses)
- [@crxjs/vite-plugin (npm)](https://www.npmjs.com/package/@crxjs/vite-plugin)
- [Anthropic input_schema oneOf/anyOf limitation](https://github.com/anthropics/claude-code/issues/3383)
- [Claude for Chrome Extension Internals gist (sshh12)](https://gist.github.com/sshh12/e352c053627ccbe1636781f73d6d715b)
