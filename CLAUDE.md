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

### 12. Floating widget + port-based cancellation
- **2026-05-16**: Spec [docs/superpowers/specs/2026-05-16-floating-widget-and-cancellation-design.md](docs/superpowers/specs/2026-05-16-floating-widget-and-cancellation-design.md) + plan [docs/superpowers/plans/2026-05-16-floating-widget-and-cancellation.md](docs/superpowers/plans/2026-05-16-floating-widget-and-cancellation.md).
- Content script proactively detects forms via initial 250ms debounced scan + MutationObserver (500ms debounce). When ≥2 fields are present, a shadow-DOM pill appears bottom-right.
- Pill click → service worker calls `chrome.action.openPopup()` → toolbar chat opens with the existing chat UI.
- Popup ↔ service worker uses `chrome.runtime.connect({name: "awto-chat"})`. Disconnect aborts the in-flight LLM call. A new message on the same port aborts the previous controller (supersede). No request queueing.
- AbortSignal threaded through local → cloud → hybrid → handleMessage; `AbortSignal.any` (with a polyfill) composes external cancellation with the existing local-call timeout.
- Widget retires for the current page load after a successful fill. Dismiss is per page-load (cleared on reload). Skipped on `chrome://`, `chrome-extension://`, `about:`, `view-source:` URLs.
- testOllama in the options page continues to use one-shot `chrome.runtime.sendMessage` (no cancellation needed for a 3s ping).

### 13. Result cache + form-fill correctness pass
- **2026-05-16**: Two related quality passes after manual testing.
- Spec C (result cache): [spec](docs/superpowers/specs/2026-05-16-spec-c-result-cache-design.md) / [plan](docs/superpowers/plans/2026-05-16-spec-c-result-cache.md). In-memory `Map<tabId+formSignature, CachedEntry>` in the service worker. Successful mapFields results cached; reopen popup on same form → instant. Aborted/failed calls skip the write. `chrome.tabs.onRemoved` invalidates per-tab. Popup carries `tabId` in the mapFields payload (popup ports have no `sender.tab.id`).
- Bug squash F1-F5: [plan](docs/superpowers/plans/2026-05-16-form-fill-correctness-bugfix.md). Five fixes from real manual-test bugs:
  - F1 prompt rewrite — per-type rules (checkbox/radio/select/time/date/email/tel), label synonyms (Phone/Telephone/Mobile/Cell), explicit warning against duplicating one value across two semantically different fields, lower-confidence-on-fuzzy-match guidance.
  - F2 fuzzy `<select>` match in form-filler — exact → substring → Levenshtein ≤2 fallback. Catches "VIC" → "Victoria", "Austraila" typos.
  - F3 surface fillFormResult.failed in the chat — "Filled X fields, Couldn't fill Y: ..." instead of misleading optimistic count.
  - F4 pre-filter checkboxes/radios before LLM call — radios always skipped; checkboxes skipped unless profile has a consent-like custom key. Reduces prompt size + prevents bogus text mapped into checkboxes.
  - F5 detector requires personal-data signal — page must have at least one field with a personal-data keyword (name/email/phone/address/etc) AND not be a search input. Kills the YouTube false positive.

### 14. Profile dropdowns + confidence indicator (Spec B)
- **2026-05-16**: [spec](docs/superpowers/specs/2026-05-16-spec-b-dropdowns-and-confidence-design.md) / [plan](docs/superpowers/plans/2026-05-16-spec-b-dropdowns-and-confidence.md).
- Profile editor: title (Mr/Mrs/Ms/Mx/Dr/Prof), pronouns (he/him, she/her, they/them), and country (full ISO list with AU/NZ/UK/US/CA pinned at top) render as `<select>` with an "Other..." sentinel that reveals a free-text input. No profile schema change — values still stored as strings.
- Chat: will-fill rows with `confidence < 0.85` show a small amber dot (`#F59E0B`, 6px) before the label, with title attribute "Low confidence — verify this value". Matches the old pre-chat-rewrite UI affordance.
- The LLM-side prompt nudge ("lower confidence to 0.6–0.8 on fuzzy match") landed earlier in F1, so the dot has meaningful traffic.

### 15. Address autocomplete (Spec A)
- **2026-05-16**: [spec](docs/superpowers/specs/2026-05-16-spec-a-address-autocomplete-design.md) / [plan](docs/superpowers/plans/2026-05-16-spec-a-address-autocomplete.md).
- Profile editor addressLine1 field gains typeahead via Nominatim (OpenStreetMap). Type ≥3 chars, debounced 500ms → up to 5 suggestions → pick one → addressLine1 + suburb + city + state + postcode + country all populate at once.
- New module `src/options/geocoder.ts` with `searchAddresses(query, {signal})`. AbortController per request — typing fast cancels in-flight.
- New component `src/options/AddressAutocomplete.tsx` — keyboard nav (arrows + enter + escape), loading spinner, `role="combobox"` + `role="listbox"` + `aria-activedescendant` for a11y.
- Manifest gains `https://nominatim.openstreetmap.org/*` host permission.
- Privacy footer in the Address card: "Address suggestions powered by OpenStreetMap. Each typed query goes to nominatim.openstreetmap.org. No account, no login."
- Form-fill flow unchanged — autocomplete only fires in the profile editor.

### 16. Detector keyword word-boundaries + live stress-test harness
- **2026-06-30**: Two related detector-robustness passes.
- **Bug**: `categoryFor` matched personal-data keywords as raw substrings, so `"age"` matched "stor**age**". IKEA product-listing pages — every sofa-bed variant radio labelled "…with storage" — tripped the strong `personal` category and surfaced the pill on a pure shopping page. (`"city"`→"electricity", `"tel"`→"hotel" were latent too.) Fix: compile each keyword list to a `\b`-anchored regex; match on word boundaries. Verified on the live IKEA DOM (7 false hits → 0).
- **Harness**: added `diagnose()` export to [src/content/detector.ts](src/content/detector.ts) (`{count, triggered[]}`) and a repeatable live stress-test under [scripts/](scripts/README.md): `detect-probe.entry.ts` bundles the real detector to `window.__awtoDiagnose()`; `detection-sweep.mjs` drives headless Chrome (Puppeteer) across ~30 popular sites, tagging each `zero` (must not fire) or `form` (should fire). Puppeteer is **not** a project dep (≈150 MB Chromium) — install on demand per the scripts README. Injection uses `page.evaluate` (Chrome `Runtime.evaluate`), which bypasses page CSP; a `fetch`-from-page approach does **not** (CSP `connect-src` blocks localhost).
- **Result (31 sites, 0 errors): 0 genuine false positives, 0 genuine misses.** Note: some logged-out homepages (e.g. pinterest.com) are themselves signup walls and correctly fire; email-only progressive step-1 signups (e.g. signup.live.com) correctly do not.

### 17. Context-aware detection (URL + form signals) + LLM page context
- **2026-06-30**: Spec [docs/superpowers/specs/2026-06-30-context-aware-detection-design.md](docs/superpowers/specs/2026-06-30-context-aware-detection-design.md) / plan [docs/superpowers/plans/2026-06-30-context-aware-detection.md](docs/superpowers/plans/2026-06-30-context-aware-detection.md). Built via subagent-driven TDD.
- **Gap**: login forms (email + password) never surfaced the pill — the password field is not counted, so the lone email field was below the "≥2 personal fields" gate. The detector and LLM were also context-blind (only `location.protocol` read; the prompt got a bare field list).
- **New module** [src/shared/page-context.ts](src/shared/page-context.ts): `assessPageContext(location, fields)` classifies the URL into a `FormKind` (`auth`/`register`/`application`/`checkout`/`profile`, word-boundary matched, precedence register > application > checkout > **auth > profile** so `/account/sign-in` is a login) and reads `hasPassword` from already-scanned fields (passwords stay non-counted and never filled — a signal only). `hasFormContext = formKind !== null || hasPassword`.
- **Detector gate** (additive): `personalCount === 0` → never fire; else `hasFormContext && personalCount >= 1` → fire; else the original `personalCount >= 2 && (hasStrong || cats >= 3)` rule, untouched. A URL match alone never fires.
- **LLM context**: content computes `buildPromptPageContext` (host + pathname only — no query string) and threads `pageContext {url, title, formKind}` through `scanFormResult` → `mapFields` → service-worker → hybrid → local+cloud → `buildUserPrompt`, which renders a one-line "Page context" hint + per-`formKind` guidance.
- **Result**: live sweep — 7/7 form pages fire including 3 logins (github/login, accounts.google/signin, dropbox/login); 0 genuine false positives. quora.com dropped from the `zero` set: its logged-out homepage is an email+password sign-in wall (correct to fire) and is Cloudflare-gated (flaky). 544 unit tests pass.

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

## Security Advisories — Accepted Residual

After dependency upgrades on 2026-05-16, `npm audit` reports **2 high-severity advisories** that are explicitly accepted:

- **rollup `<2.80.0`** — Arbitrary File Write via Path Traversal ([GHSA-mw96-cpmx-2vgc](https://github.com/advisories/GHSA-mw96-cpmx-2vgc)). Pinned at `2.79.2` by `@crxjs/vite-plugin@2.4.0` (exact version pin, not a range). The advisory's actual exploit scenario is **Rollup 4**, retroactively applied to all 2.x. Rollup 2 is unmaintained.

**Why accepted:**
1. It's a **devDependency** — never ships in `dist/`. The bundled extension does not include rollup.
2. The vulnerability requires feeding malicious input through the bundler. For a local developer build of your own source, the practical attack surface is zero.
3. Forcing the audit fix downgrades `@crxjs/vite-plugin` from `2.4.0` (stable) to `1.0.14` (major regression of build tooling).
4. Overriding rollup to 4.x would break `@crxjs/vite-plugin` because it depends on rollup 2.x APIs.

**Resolution path:** wait for `@crxjs/vite-plugin` to release a version that uses a maintained rollup (3.x or 4.x). Check periodically.

Vulnerabilities fixed in the same upgrade pass:
- happy-dom 15 → 20.9.0 (critical RCE — GHSA-37j7-fg3j-429f, GHSA-w4gp-fjgq-3q4g, GHSA-6q6h-j7hj-3r64)
- vite 5 → 6.4.2 (moderate path traversal — GHSA-4w7w-66w2-5vf9)
- vitest 2 → 3.2.4 (transitively eliminated bundled vite 5)
- esbuild → ^0.25 via `overrides` (moderate dev-server SSRF — GHSA-67mh-4wv8-2f99)
- @crxjs/vite-plugin 2.0.0-beta.28 → 2.4.0 (stable)

Side fix during upgrade: `cssEscape` in [src/content/form-scanner.ts](src/content/form-scanner.ts) switched from JS-style `\"` escape to CSS spec hex-code escape (`\22 `). happy-dom 20 strictly enforces the CSS spec and rejected the JS-style form.

## Sources Consulted (2026-05-15)

- [Ollama Structured Outputs docs](https://docs.ollama.com/capabilities/structured-outputs)
- [Anthropic CORS / dangerouslyAllowBrowser announcement (Simon Willison)](https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access/)
- [Chrome MV3 service worker migration guide](https://developer.chrome.com/docs/extensions/mv3/migrating_to_service_workers/)
- [How to intercept SSE in MV3 extensions](https://dev.to/wilow445/how-to-intercept-server-sent-events-in-chrome-extensions-mv3-guide-23kb)
- [Best practices for rendering streamed LLM responses (Chrome devrel)](https://developer.chrome.com/docs/ai/render-llm-responses)
- [@crxjs/vite-plugin (npm)](https://www.npmjs.com/package/@crxjs/vite-plugin)
- [Anthropic input_schema oneOf/anyOf limitation](https://github.com/anthropics/claude-code/issues/3383)
- [Claude for Chrome Extension Internals gist (sshh12)](https://gist.github.com/sshh12/e352c053627ccbe1636781f73d6d715b)
