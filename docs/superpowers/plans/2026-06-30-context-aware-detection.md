# Context-Aware Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Awto detect login / signup / application forms by combining on-page personal-field signals with URL and password-field context, and feed that context to the LLM prompt.

**Architecture:** A new pure module `src/shared/page-context.ts` classifies the page (URL `formKind` + `hasPassword`). The content detector uses it to lower its firing threshold when form context is present (additive — the existing rule is untouched). The same context is threaded through the `scanForm`→`mapFields` messages into `buildUserPrompt` as a one-line hint.

**Tech Stack:** TypeScript, Vitest + happy-dom, Chrome MV3 messaging, esbuild (probe bundle), Puppeteer (live sweep, dev-only).

## Global Constraints

- TDD: failing test first, watch it fail, minimal code, watch it pass, commit.
- No emojis as icons; comment only non-obvious WHY.
- Passwords are NEVER counted as fillable and NEVER filled — `hasPassword` is a *signal* only.
- Detector change must be **additive**: every page that fires today must still fire (the existing `personalCount >= 2 && (hasStrong || categories.size >= 3)` rule stays intact).
- URL match alone never fires: `personalCount === 0` always returns 0.
- Privacy: the LLM receives host + pathname only — never the query string.
- `FormKind` precedence (highest first): `register` > `application` > `checkout` > `auth` > `profile` (auth outranks profile so `/account/sign-in` classifies as a login).

---

### Task 1: `page-context` module

**Files:**
- Create: `src/shared/page-context.ts`
- Test: `src/shared/page-context.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  ```ts
  export type FormKind = "auth" | "register" | "application" | "checkout" | "profile";
  export interface PageContext { formKind: FormKind | null; hasPassword: boolean; hasFormContext: boolean; }
  export interface PromptPageContext { url: string; title: string; formKind: FormKind | null; }
  export function assessPageContext(
    location: { hostname: string; pathname: string; search: string },
    fields: { type: string }[]
  ): PageContext;
  export function buildPromptPageContext(
    location: { hostname: string; pathname: string },
    title: string,
    ctx: PageContext
  ): PromptPageContext;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/shared/page-context.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assessPageContext, buildPromptPageContext } from "./page-context";

const loc = (pathname: string, search = "", hostname = "example.com") => ({ hostname, pathname, search });

describe("assessPageContext — formKind from URL", () => {
  const cases: [string, string, string | null][] = [
    ["/login", "", "auth"],
    ["/account/sign-in", "", "auth"],
    ["/users/signup", "", "register"],
    ["/register", "", "register"],
    ["/careers/apply", "", "application"],
    ["/jobs/12345", "", "application"],
    ["/checkout/billing", "", "checkout"],
    ["/account/profile", "", "profile"],
    ["/", "", null],
    ["/cat/sofa-beds-10663", "", null],
    ["/weblogin-helper", "", null], // 'login' not on a word boundary
  ];
  for (const [path, search, expected] of cases) {
    it(`classifies ${path} as ${expected}`, () => {
      expect(assessPageContext(loc(path, search), []).formKind).toBe(expected);
    });
  }

  it("applies precedence register > application", () => {
    expect(assessPageContext(loc("/careers/signup"), []).formKind).toBe("register");
  });

  it("reads keywords from the query string too", () => {
    expect(assessPageContext(loc("/", "?flow=signup"), []).formKind).toBe("register");
  });
});

describe("assessPageContext — form signals", () => {
  it("detects a password field", () => {
    const ctx = assessPageContext(loc("/"), [{ type: "email" }, { type: "password" }]);
    expect(ctx.hasPassword).toBe(true);
    expect(ctx.hasFormContext).toBe(true);
  });

  it("hasFormContext is false on a plain page with no password and no URL match", () => {
    const ctx = assessPageContext(loc("/articles/123"), [{ type: "text" }]);
    expect(ctx.hasPassword).toBe(false);
    expect(ctx.formKind).toBeNull();
    expect(ctx.hasFormContext).toBe(false);
  });

  it("hasFormContext is true when only the URL matches", () => {
    expect(assessPageContext(loc("/login"), [{ type: "email" }]).hasFormContext).toBe(true);
  });
});

describe("buildPromptPageContext", () => {
  it("joins host + pathname and drops the query string", () => {
    const ctx = assessPageContext(loc("/signin"), [{ type: "password" }]);
    const p = buildPromptPageContext({ hostname: "acme.com", pathname: "/signin" }, "Sign in — Acme", ctx);
    expect(p).toEqual({ url: "acme.com/signin", title: "Sign in — Acme", formKind: "auth" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/page-context.test.ts`
Expected: FAIL — `assessPageContext is not a function` (module missing).

- [ ] **Step 3: Write minimal implementation**

Create `src/shared/page-context.ts`:

```ts
export type FormKind = "auth" | "register" | "application" | "checkout" | "profile";

export interface PageContext {
  formKind: FormKind | null;
  hasPassword: boolean;
  hasFormContext: boolean;
}

export interface PromptPageContext {
  url: string;
  title: string;
  formKind: FormKind | null;
}

const KEYWORDS: Record<FormKind, string[]> = {
  register: ["signup", "sign-up", "register", "registration", "join", "create-account", "createaccount", "new-account", "get-started"],
  application: ["apply", "application", "careers", "career", "jobs", "job", "onboarding", "recruit", "hr"],
  checkout: ["checkout", "billing", "payment", "order", "purchase"],
  profile: ["account", "profile", "settings", "my-details", "my-account"],
  auth: ["login", "log-in", "signin", "sign-in", "logon", "auth", "authenticate"],
};

const PRECEDENCE: FormKind[] = ["register", "application", "checkout", "auth", "profile"];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compile(keywords: string[]): RegExp {
  return new RegExp(`(?<![a-z0-9])(?:${keywords.map(escapeRegExp).join("|")})(?![a-z0-9])`, "i");
}

const RES: Record<FormKind, RegExp> = {
  register: compile(KEYWORDS.register),
  application: compile(KEYWORDS.application),
  checkout: compile(KEYWORDS.checkout),
  profile: compile(KEYWORDS.profile),
  auth: compile(KEYWORDS.auth),
};

function classifyUrl(location: { hostname: string; pathname: string; search: string }): FormKind | null {
  const haystack = `${location.hostname}${location.pathname}${location.search}`.toLowerCase();
  for (const kind of PRECEDENCE) {
    if (RES[kind].test(haystack)) return kind;
  }
  return null;
}

export function assessPageContext(
  location: { hostname: string; pathname: string; search: string },
  fields: { type: string }[]
): PageContext {
  const formKind = classifyUrl(location);
  const hasPassword = fields.some((f) => f.type === "password");
  return { formKind, hasPassword, hasFormContext: formKind !== null || hasPassword };
}

export function buildPromptPageContext(
  location: { hostname: string; pathname: string },
  title: string,
  ctx: PageContext
): PromptPageContext {
  return { url: `${location.hostname}${location.pathname}`, title, formKind: ctx.formKind };
}
```

Note: the `(?<![a-z0-9])…(?![a-z0-9])` lookarounds give a word-boundary match that treats `-` and `/` as boundaries (so `/sign-in` matches `signin`? no — `sign-in` matches the `sign-in` keyword; `signin` matches the `signin` keyword; both are listed). `weblogin` does NOT match `login` because `n`…wait: validate in Step 4 — the `g` before `login` in `weblogin` is `[a-z0-9]`, so the lookbehind fails. Correct.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/page-context.test.ts`
Expected: PASS (all cases). If `/weblogin-helper` wrongly classifies as `auth`, the lookbehind is the fix — confirm it is `(?<![a-z0-9])`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/page-context.ts src/shared/page-context.test.ts
git commit -m "feat(page-context): classify form pages by URL + password signal"
```

---

### Task 2: Detector uses page context to lower the threshold

**Files:**
- Modify: `src/content/detector.ts` (`evaluateFields`, `diagnose`)
- Test: `src/content/detector.test.ts`

**Interfaces:**
- Consumes: `assessPageContext` from `@/shared/page-context`; `window.location`.
- Produces: unchanged public API (`startDetector`, `diagnose`); gate behavior extended.

- [ ] **Step 1: Write the failing tests**

Add to `src/content/detector.test.ts` inside the `describe("startDetector", …)` block. Use the existing `window.location` override pattern (see the `chrome-extension` test):

```ts
  it("fires on a login form (email + password) on an auth URL", () => {
    const original = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      value: { protocol: "https:", hostname: "accounts.example.com", pathname: "/signin", search: "" },
      writable: true, configurable: true,
    });
    document.body.innerHTML = `
      <form>
        <label>Email <input type="email" name="email" /></label>
        <label>Password <input type="password" name="pw" /></label>
      </form>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(2);
    if (original) Object.defineProperty(window, "location", original);
  });

  it("fires on a /signup URL with a single name field", () => {
    const original = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      value: { protocol: "https:", hostname: "example.com", pathname: "/signup", search: "" },
      writable: true, configurable: true,
    });
    document.body.innerHTML = `<form><label>First name <input type="text" name="fn" /></label></form>`;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(1);
    if (original) Object.defineProperty(window, "location", original);
  });

  it("does NOT fire on an auth URL with no fillable personal field (search box only)", () => {
    const original = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      value: { protocol: "https:", hostname: "example.com", pathname: "/login", search: "" },
      writable: true, configurable: true,
    });
    document.body.innerHTML = `<input type="search" name="q" aria-label="Search" />`;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(0);
    if (original) Object.defineProperty(window, "location", original);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/content/detector.test.ts -t "login form"`
Expected: FAIL — login currently yields 0 (email-only is below the ≥2 gate), so `toHaveBeenCalledWith(2)` fails.

- [ ] **Step 3: Implement the gate change**

In `src/content/detector.ts`, add the import near the top:

```ts
import { assessPageContext } from "@/shared/page-context";
```

Replace the body of `evaluateFields` (the final gate block) so it reads:

```ts
function evaluateFields(fields: ScannedField[]): number {
  const personalFields = fields.filter((f) => isCountedType(f.type));
  const categories = new Set<Category>();
  let personalCount = 0;
  for (const field of personalFields) {
    if (isInExcludedContainer(field.selector)) continue;
    const cat = categoryFor(field);
    if (cat) {
      categories.add(cat);
      personalCount += 1;
    }
  }

  if (personalCount === 0) return 0;

  const { hasFormContext } = assessPageContext(window.location, fields);
  if (hasFormContext && personalCount >= 1) return fields.length;

  if (personalCount < 2) return 0;
  const hasStrong = Array.from(categories).some((c) => STRONG_CATEGORIES.has(c));
  if (hasStrong) return fields.length;
  if (categories.size >= 3) return fields.length;
  return 0;
}
```

- [ ] **Step 4: Run the full detector suite**

Run: `npx vitest run src/content/detector.test.ts`
Expected: PASS — the 3 new tests pass and all existing tests still pass (signup name+email+password still 3 via the password-driven `hasFormContext` path; email-only subscribe still 0 — happy-dom default location has no auth keyword and there is no password; IKEA storage radios still 0 — `personalCount === 0`).

- [ ] **Step 5: Commit**

```bash
git add src/content/detector.ts src/content/detector.test.ts
git commit -m "feat(detector): fire on login/signup/application via page context"
```

---

### Task 3: LLM prompt renders the page context

**Files:**
- Modify: `src/background/llm/prompt.ts` (`buildUserPrompt`)
- Test: `src/background/llm/prompt.test.ts`

**Interfaces:**
- Consumes: `PromptPageContext` from `@/shared/page-context`.
- Produces: `buildUserPrompt(profile, fields, claimedKeys?, pageContext?)` — new optional 4th param; when omitted the output is byte-for-byte the current output.

- [ ] **Step 1: Write the failing tests**

Add to `src/background/llm/prompt.test.ts`:

```ts
import type { PromptPageContext } from "@/shared/page-context";

describe("buildUserPrompt pageContext hint", () => {
  const fields = [
    { id: 0, selector: "#e", label: "Email", placeholder: null, type: "email", required: true },
  ];

  it("renders a context line naming the URL and form kind", () => {
    const ctx: PromptPageContext = { url: "acme.com/signin", title: "Sign in — Acme", formKind: "auth" };
    const out = buildUserPrompt({} as never, fields as never, undefined, ctx);
    expect(out).toContain("Page context");
    expect(out).toContain("acme.com/signin");
    expect(out).toContain("login"); // auth → login hint
  });

  it("omits the context line when pageContext is undefined", () => {
    const out = buildUserPrompt({} as never, fields as never, undefined, undefined);
    expect(out).not.toContain("Page context");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/background/llm/prompt.test.ts -t "pageContext hint"`
Expected: FAIL — `buildUserPrompt` ignores the 4th arg, so "Page context" is absent.

- [ ] **Step 3: Implement the context line**

In `src/background/llm/prompt.ts`, add the import:

```ts
import type { PromptPageContext, FormKind } from "@/shared/page-context";
```

Add this helper above `buildUserPrompt`:

```ts
const FORM_KIND_HINT: Record<FormKind, string> = {
  auth: "This is a login form — fill only the user's email/identity fields; never a password.",
  register: "This is a signup form — expect name, email, phone, maybe date of birth.",
  application: "This is a job/HR application — expect name, contact details, address, and work-history fields.",
  checkout: "This is a checkout form — expect name, full address, email, and phone.",
  profile: "This is a profile/account form — fill known personal details.",
};

function pageContextSection(ctx: PromptPageContext | undefined): string {
  if (!ctx) return "";
  const kind = ctx.formKind ? `${ctx.formKind} form` : "form";
  const hint = ctx.formKind ? ` ${FORM_KIND_HINT[ctx.formKind]}` : "";
  return `Page context: a ${kind} at ${ctx.url} ("${ctx.title}").${hint}\n\n`;
}
```

Change the signature and the return statement of `buildUserPrompt`:

```ts
export function buildUserPrompt(
  profile: Profile,
  fields: ScannedField[],
  claimedKeys?: string[],
  pageContext?: PromptPageContext
): string {
  // …unchanged body…
  return `${pageContextSection(pageContext)}${profileSection}\n\n${fieldSection}${claimedSection}\n\nReturn a single JSON object with a "mappings" array — one entry per field — strictly matching the provided JSON schema.`;
}
```

- [ ] **Step 4: Run the prompt suite**

Run: `npx vitest run src/background/llm/prompt.test.ts`
Expected: PASS — new tests pass; existing `claimedKeys` and other prompt tests unchanged (4th param defaults to undefined → no context line).

- [ ] **Step 5: Commit**

```bash
git add src/background/llm/prompt.ts src/background/llm/prompt.test.ts
git commit -m "feat(prompt): render page-context hint in the user prompt"
```

---

### Task 4: Thread page context from content → popup → service worker → prompt

**Files:**
- Modify: `src/shared/messages.ts` (add `pageContext` to `scanFormResult` and `mapFields`)
- Modify: `src/content/index.ts` (compute + attach on `scanForm`)
- Modify: `src/popup/useAwtoFlow.ts` (forward into `mapFields`)
- Modify: `src/background/llm/local.ts`, `cloud.ts`, `hybrid.ts` (carry `pageContext` in opts)
- Modify: `src/background/service-worker.ts` (`mapFields` handler passes `msg.pageContext` into the LLM call)
- Test: `src/popup/useAwtoFlow.test.ts` (assert `mapFields` carries `pageContext`)

**Interfaces:**
- Consumes: `assessPageContext`, `buildPromptPageContext`, `PromptPageContext` (Task 1); `buildUserPrompt(..., pageContext)` (Task 3).
- Produces: `mapFields` message gains `pageContext?: PromptPageContext`; LLM opts (`LocalCallOpts`, cloud opts, hybrid opts) gain `pageContext?: PromptPageContext`.

- [ ] **Step 1: Write the failing test**

In `src/popup/useAwtoFlow.test.ts`, the harness replies to `scanForm` with `scanFormResult` (search for `type: "scanFormResult"`). Update that reply to include a `pageContext`, then assert it is forwarded. Add near the existing "posts mapFields" test:

```ts
  it("forwards pageContext from scanFormResult into the mapFields message", async () => {
    // harness scanForm reply must include: pageContext: { url: "acme.com/signin", title: "Sign in", formKind: "auth" }
    await renderFlow();
    await waitFor(() =>
      deps.portHandle.posted.some((m) => m.type === "mapFields")
    );
    const map = deps.portHandle.posted.find((m) => m.type === "mapFields") as
      Extract<AwtoMessage, { type: "mapFields" }>;
    expect(map.pageContext).toEqual({ url: "acme.com/signin", title: "Sign in", formKind: "auth" });
  });
```

Update the `scanForm` auto-reply in the test harness (where it returns `{ type: "scanFormResult", fields }`) to also include `pageContext: { url: "acme.com/signin", title: "Sign in", formKind: "auth" }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/popup/useAwtoFlow.test.ts -t "forwards pageContext"`
Expected: FAIL — `map.pageContext` is `undefined` (not yet forwarded).

- [ ] **Step 3: Implement the threading**

(a) `src/shared/messages.ts` — add the import and the optional fields:

```ts
import type { PromptPageContext } from "./page-context";
```
In the `scanFormResult` variant: `| { type: "scanFormResult"; fields: ScannedField[]; pageContext?: PromptPageContext }`
In the `mapFields` variant, add `pageContext?: PromptPageContext;`.

(b) `src/content/index.ts` — compute and attach on scan:

```ts
import { assessPageContext, buildPromptPageContext } from "@/shared/page-context";
// …
const fields = scanFields(document);
const ctx = assessPageContext(window.location, fields);
const pageContext = buildPromptPageContext(window.location, document.title, ctx);
sendResponse({ type: "scanFormResult", fields, pageContext });
```

(c) `src/popup/useAwtoFlow.ts` — at the two `type: "mapFields"` sends (around lines 328 and 513), include `pageContext: scanReply.pageContext` (carry the value captured from the `scanFormResult`; store it alongside `fields` when the scan reply is handled near line 295).

(d) LLM opts — in `LocalCallOpts` (`local.ts`), the cloud opts interface (`cloud.ts`), and the hybrid opts interface (`hybrid.ts`) add `pageContext?: PromptPageContext;` (import the type). Pass it to `buildUserPrompt(profile, fields, opts.claimedKeys, opts.pageContext)` in both `local.ts:51` and `cloud.ts:53`, and forward `pageContext: opts.pageContext` in `hybrid.ts` where it already forwards `claimedKeys` (lines 64 and 70).

(e) `src/background/service-worker.ts` — in the `mapFields` handler (line 68), pass `pageContext: msg.pageContext` into the options object handed to the hybrid/local/cloud call (alongside the existing `claimedKeys`).

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/popup/useAwtoFlow.test.ts && npx tsc --noEmit`
Expected: PASS — the forward test passes, all existing popup/service-worker tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/messages.ts src/content/index.ts src/popup/useAwtoFlow.ts src/background/llm/local.ts src/background/llm/cloud.ts src/background/llm/hybrid.ts src/background/service-worker.ts src/popup/useAwtoFlow.test.ts
git commit -m "feat: thread page context from scan through to the LLM prompt"
```

---

### Task 5: Full verification + live sweep regression

**Files:**
- Modify: `scripts/detection-sweep.mjs` (add login/signup URLs to the `form` set)
- Modify: `CLAUDE.md` (decision log entry)

- [ ] **Step 1: Whole suite + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all tests PASS, no type errors, build succeeds.

- [ ] **Step 2: Add login/signup cases to the sweep**

In `scripts/detection-sweep.mjs` `SITES`, add (tagged `form`):

```js
  ["https://github.com/login", "form"],
  ["https://accounts.google.com/signin", "form"],
  ["https://www.dropbox.com/login", "form"],
```

- [ ] **Step 3: Run the live sweep**

Run (Puppeteer already installed from the prior harness work; otherwise `npm i -D puppeteer && npx puppeteer browsers install chrome`):
`node scripts/detection-sweep.mjs`

Expected: SUMMARY shows **false positives: 0** on the `zero` set, and the new `…/login` and `…/signin` rows report `count > 0` (triggered). If any `zero` site now reports a false positive, inspect its printed `triggered` labels before proceeding — do not accept a regression.

- [ ] **Step 4: Update the decision log**

Add decision #17 to `CLAUDE.md` summarising: page-context module, additive detector gate (URL/password lowers the threshold; `personalCount === 0` never fires), LLM prompt context line, and the sweep result.

- [ ] **Step 5: Commit**

```bash
git add scripts/detection-sweep.mjs CLAUDE.md
git commit -m "test(sweep): cover login/signup URLs; docs: decision #17 context-aware detection"
```

---

## Self-Review

- **Spec coverage:** page-context module (T1) ✓; detector gate additive + `personalCount===0` guard (T2) ✓; URL `formKind` keyword sets + precedence (T1) ✓; `hasPassword` from existing scanned fields, never filled (T1/T2) ✓; LLM context line + per-kind hint (T3) ✓; host+path-only privacy (T1 `buildPromptPageContext`, T4 content) ✓; message threading (T4) ✓; live-sweep regression + 0 false positives (T5) ✓; tests for all units (T1–T4) ✓.
- **Placeholder scan:** none — every code step shows full code.
- **Type consistency:** `assessPageContext(location, fields)`, `buildPromptPageContext(location, title, ctx)`, `PromptPageContext { url, title, formKind }`, `buildUserPrompt(profile, fields, claimedKeys?, pageContext?)`, opts `pageContext?` — names consistent across T1, T3, T4.
