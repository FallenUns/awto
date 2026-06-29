# Context-aware detection (URL + form signals) + LLM page context

**Date:** 2026-06-30
**Status:** Approved
**Related code:** `src/shared/page-context.ts` (new), `src/content/detector.ts`, `src/content/index.ts`, `src/shared/messages.ts`, `src/background/llm/prompt.ts`, `src/background/service-worker.ts`, `scripts/detection-sweep.mjs`

## Context

Two reported gaps after the word-boundary detector fix (decision #16):

1. **Login forms are not detected.** A login is typically an email/username field plus a password. The scanner surfaces the password field (as `type: "password"`), but the detector never counts it, and the email field alone is one `contact`-category field — below the existing "≥2 personal fields" gate. So the pill never appears on sign-in pages. The same threshold suppresses early-stage signup/application forms that have only one personal field filled in so far.

2. **The detector and the LLM are context-blind.** The detector reads only `window.location.protocol` (to skip `chrome://` etc.). The LLM prompt receives a bare field list with no indication of whether the page is a login, a job application, or a checkout. The user wants Awto "fully aware of what the context is" — using the URL (e.g. `/login`, `/signup`, `/apply`, `/careers`) and on-page form signals — both to decide whether to fire and to map fields better.

User decisions (brainstorm, 2026-06-30):

| Question | Decision |
|---|---|
| Trigger scope | **Login + signup + application/HR.** The pill should appear on auth/registration/application/checkout/profile contexts, gated by context signals to stay precise. On a login it offers to fill email/username only — passwords are never stored or filled. |
| URL weight | **Lower the bar when the URL matches.** A matching URL path (or a password field present) lets a sparser form — even a single personal field, like a login email — trigger. |

## Decisions

| Question | Decision |
|---|---|
| Where context lives | **New pure module `src/shared/page-context.ts`** exporting `assessPageContext(location, fields) → PageContext`. Pure and unit-testable; reused by the detector (content) and threaded to the LLM prompt. |
| `formKind` classification | Lowercase `hostname + pathname + search`; match URL **path segments / word boundaries** (not raw substring, to avoid e.g. "blogin") against keyword sets. Categories + precedence: `register` > `application` > `checkout` > `profile` > `auth` > `null`. |
| `auth` keywords | login, log-in, signin, sign-in, logon, auth, authenticate |
| `register` keywords | signup, sign-up, register, registration, join, create-account, createaccount, new-account, get-started |
| `application` keywords | apply, application, careers, career, jobs, job, onboarding, recruit, hr |
| `checkout` keywords | checkout, billing, payment, /order, purchase |
| `profile` keywords | account, profile, settings, my-details, my-account |
| `hasPassword` | `fields.some(f => f.type === "password")`. The scanner already emits password fields, so no new DOM query — and **password fields remain non-counted and are never filled.** |
| `hasFormContext` | `formKind !== null || hasPassword`. |
| Detector gate | Additive change in `evaluateFields`: (1) if `personalCount === 0` → return 0 (nothing fillable, never fire — this guards against URL-only false positives); (2) if `hasFormContext && personalCount >= 1` → return `fields.length`; (3) else the **existing** rule unchanged: `personalCount >= 2 && (hasStrong || categories.size >= 3)`. Every page that fires today still fires. |
| Newsletter safety | An email-only subscribe box on a non-auth page has no password and no matching URL → `hasFormContext` is false → falls to the existing rule → stays at 0. Preserved. |
| LLM context payload | Content script computes `assessPageContext` and includes `pageContext: { url, title, formKind }` in the `mapFields` message. `url` is **host + pathname only** (no query string — privacy). |
| Prompt enrichment | `prompt.ts` prepends one context line + a per-`formKind` hint (login → fill email/identity only; application/HR → expect name, contact, work fields; checkout → name + address + email). No `formKind` → no line (unchanged behavior). |
| Regression gate | The 31-site live sweep (`scripts/detection-sweep.mjs`) must still show **0 false positives**; add login/signup URLs to the `form`-tagged set and confirm they now fire. |
| Explicitly out of scope | Ollama schema-validation recovery (separate follow-up); filling passwords (never); username-only logins where there is no storable value to fill (no personal field → no trigger, acceptable). |

## Architecture

```
window.location ─┐
                 ├─► assessPageContext(location, fields) ─► PageContext { formKind, hasPassword, hasFormContext }
scanFields() ────┘                                              │
                                                                ├─► detector.evaluateFields()  (gate: fire / don't)
                                                                └─► mapFields msg.pageContext ─► prompt.ts (context line)
```

### Data flow

1. **Detector (content):** on each debounced scan, `evaluateFields(fields)` calls `assessPageContext(window.location, fields)` and applies the gate above. Pill shows/hides as today.
2. **Fill flow (content → service worker):** when the user opens the popup and a `mapFields` runs, the content script attaches `pageContext { url: host+path, title, formKind }`. The service worker passes it to `buildPrompt`, which renders the context line. The LLM response schema (decision #9) is unchanged.

### `PageContext` shape

```ts
export type FormKind =
  | "auth" | "register" | "application" | "checkout" | "profile";

export interface PageContext {
  formKind: FormKind | null;
  hasPassword: boolean;
  hasFormContext: boolean;
}
```

The `mapFields` message carries a lighter, serialisable subset for the prompt:

```ts
interface PromptPageContext {
  url: string;        // host + pathname, no query
  title: string;
  formKind: FormKind | null;
}
```

## Testing

- **`src/shared/page-context.test.ts` (new):** URL-classification table (one case per keyword set + precedence: a `/careers/signup` resolves to `register` over `application`), word-boundary safety (`/weblogin-help` must not classify as `auth` only via substring — segment match), `hasPassword` from fields, `hasFormContext` composition.
- **`src/content/detector.test.ts`:** login (email `type` + password `type`, auth URL) → fires; `/signup` URL + single name field → fires; URL match but `personalCount === 0` (e.g. `/login` page showing only a search box) → still 0; all existing cases unchanged (signup name+email+password still 3; email-only subscribe still 0; IKEA storage radios still 0).
- **`src/background/llm/prompt.test.ts`:** context line renders per `formKind`; absent `pageContext` → prompt unchanged from baseline.
- **Live regression:** `node scripts/detection-sweep.mjs` — 0 false positives on the `zero` set; add `…/login` and `…/signup` URLs to the `form` set and confirm they trigger.

## Acceptance

- Login pages (email + password) surface the pill; only email/identity is offered, never the password.
- Signup / application / checkout / profile pages surface the pill once ≥1 personal field is present.
- No new false positives on the 31-site sweep.
- The LLM prompt names the page context and form kind.
- Detection remains "skip-or-ask over wrong-fill": a URL match alone (no personal field) never fires.
