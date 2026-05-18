# Generic ARIA widget support

**Date:** 2026-05-18
**Status:** Approved
**Related code:** `src/content/form-scanner.ts`, `src/content/form-filler.ts`, `src/shared/storage.ts`, `src/options/LLMTab.tsx`

## Context

Today's scanner queries only native HTML form controls (`<input>`, `<select>`, `<textarea>`). Modern form platforms render fully custom ARIA-based widgets:

- **Google Forms** — uses `<div role="radiogroup">` with `<div role="radio">` children, `<div role="listbox">` with `<div role="option">`, `<div role="textbox" contenteditable>` for short answers. No native inputs except a read-only email at the top.
- **Microsoft Forms** — same pattern with different class names.
- **Typeform** — single-question-at-a-time, `role="textbox"`/`role="radiogroup"`.
- **SurveyMonkey** — mixed; comboboxes typically ARIA.
- **Notion, Airtable embeds, Webflow forms** — ARIA-first.

Result: Awto reports "No form on this page" for legitimate forms it could otherwise help with. Patrick reported this on a Google Forms survey (`Survei Tingkat Kesadaran Keamanan Wi-Fi Publik`) with Age/Education questions that match his profile perfectly but aren't visible to the scanner.

## Decisions

| Question | Decision |
|---|---|
| Provider scope | Generic ARIA — implement the standard ARIA spec only. No Google-specific or MS-specific code paths. |
| Phase strategy | Scanner + filler ship together. Shipping scanner alone would surface "we can fill this" then silently fail — worse UX than today. |
| Detector changes | None. The category-based filter handles the personal-signal gate. ARIA widgets just become more scanned fields. |
| Defensive flag | Yes — `enableAriaForms` boolean in storage, default ON, exposed in the options page. Single off-switch if a provider breaks. |
| Fill commit mechanism | Generic `click()` for radios/checkboxes/options; `textContent` + `input` event for contenteditable textboxes. Bubbling clicks reach React/Vue listeners and the framework state-management code that ARIA libraries register. No keyboard simulation in v1. |
| Selector strategy for ARIA widgets | `id` → `data-params` → `[aria-labelledby="X"]` → `nth-of-type` path. The aria-labelledby anchor is the most stable because the label has a stable id even when the widget itself doesn't. |
| Iframe scanning | Out of scope. Typeform's iframe embed is deferred. |
| File-upload widgets | Still skipped (existing behaviour). |

## Architecture

### 1. Scanner — second pass for ARIA widgets

`scanFields` today does one query for `input, select, textarea`. Add a second pass after the native pass:

```ts
const ARIA_QUERIES = [
  { selector: '[role="textbox"][contenteditable="true"]', type: "text" },
  { selector: '[role="radiogroup"]', type: "radio" },
  { selector: '[role="checkbox"]', type: "checkbox" },
  { selector: '[role="combobox"]', type: "select" },
  { selector: '[role="listbox"]:not([role="combobox"] *)', type: "select" },
];
```

For each ARIA widget:

1. `isEligible`: not hidden, not inside a template, not inside an excluded RTE wrapper, not inside the existing native fields' subtree (de-dupe — if `<div role="radio"><input type="radio"></div>` we already picked up the native one).
2. `extractLabel`: existing helper already covers `aria-labelledby` → `aria-label` → preceding text. ARIA widgets just need `aria-labelledby` checked **before** the surrounding-text fallbacks.
3. `buildSelector`: ARIA branch — try `id`, then `[data-params="..."]` if present, then `[aria-labelledby="X"]`, then a path-from-`<main>` fallback.
4. `options`: for radiogroup, collect text content of all `[role="radio"]` descendants. For combobox/listbox, collect `[role="option"]` text. For checkbox/textbox, no options.

The emitted `ScannedField` uses existing type values (`text`/`radio`/`checkbox`/`select`) so the entire downstream pipeline (rule-mapper, prefilter, LLM prompt, mapping-safety, form-filler dispatcher) needs zero changes for routing — only the filler's *execution* path branches on whether the target is native or ARIA.

### 2. Filler — `fillAriaWidget` dispatch

`form-filler.ts` today resolves the target with `document.querySelector(selector)` and writes via:
- `input/textarea/select`: `el.value = X` + dispatch `input` + `change`
- Checkbox/radio inputs: `el.checked = true` + dispatch `change`

Add a detection step: if the resolved element is NOT an `HTMLInputElement` / `HTMLSelectElement` / `HTMLTextAreaElement` but has a `role` attribute, route to a new `fillAriaWidget(el, value)` helper:

```ts
function fillAriaWidget(el: HTMLElement, value: string): { filled: boolean; reason?: string } {
  const role = el.getAttribute("role");
  if (role === "textbox") return fillAriaTextbox(el, value);
  if (role === "radiogroup") return fillAriaRadioGroup(el, value);
  if (role === "checkbox") return fillAriaCheckbox(el, value);
  if (role === "combobox" || role === "listbox") return fillAriaListbox(el, value);
  return { filled: false, reason: "unsupported aria role" };
}
```

**`fillAriaTextbox`** — contenteditable div:
```ts
el.focus();
el.textContent = value;
el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
el.blur();
return { filled: true };
```

**`fillAriaRadioGroup`** — find matching child:
```ts
const radios = Array.from(el.querySelectorAll<HTMLElement>('[role="radio"]'));
const match = radios.find(r => fuzzyMatchOption(value, r.textContent?.trim() ?? ""));
if (!match) return { filled: false, reason: "no matching option" };
match.click();
return { filled: true };
```
Re-uses the existing `fuzzyMatchOption` (exact → substring → Levenshtein ≤ 2).

**`fillAriaCheckbox`** — toggle if needed:
```ts
const current = el.getAttribute("aria-checked") === "true";
const want = value.toLowerCase() === "true";
if (current !== want) el.click();
return { filled: true };
```

**`fillAriaListbox`** — open + wait one frame + click. This helper is **async** because options frequently render in a portal/popup after a microtask or animation frame.

```ts
async function fillAriaListbox(el, value) {
  el.click();                                                  // open
  await new Promise(r => requestAnimationFrame(() => r(null))); // wait for portal render
  const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
  const match = options.find(o => fuzzyMatchOption(value, o.textContent?.trim() ?? ""));
  if (!match) { el.click(); return { filled: false, reason: "no matching option" }; }
  match.click();
  return { filled: true };
}
```

Because of this, `fillAriaWidget` and the existing `fillForm` outer loop become async. `fillForm` already returns a Promise via `chrome.runtime` messaging, so this is a contained change.

### 3. Detector — no code changes

The detector already counts fields returned by the scanner. With ARIA widgets included, Google Forms surveys with Age/Education radios will trigger the personal-category gate normally.

### 4. Settings toggle

`src/shared/storage.ts` `LLMSettings` interface gains:
```ts
enableAriaForms: boolean;  // default true
```

`src/options/LLMTab.tsx` gets a new toggle in the existing settings section:
```
[✓] Fill custom-widget forms (Google Forms, Microsoft Forms, etc.)
    Off-switch if a specific site fills incorrectly.
```

Scanner consults the setting via the existing storage flow (popup → service-worker passes settings through). For the content-script-side detector + scanner, settings are read at scan time via `chrome.storage.local.get`. Cached in module-level state with a `chrome.storage.onChanged` listener to invalidate.

### 5. Pipeline integration

| Layer | Change |
|---|---|
| `form-scanner.ts` | +ARIA second pass, +`aria-labelledby` preferred for ARIA labels, +ARIA selector branch |
| `form-filler.ts` | +`fillAriaWidget` dispatch + 4 role-specific helpers |
| `detector.ts` | None |
| `rule-mapper.ts` | None |
| `mapping-safety.ts` | None |
| `llm/prompt.ts` | None |
| `popup/*` | None |
| `storage.ts` | +`enableAriaForms` setting |
| `options/LLMTab.tsx` | +toggle UI |

## Edge cases

- **Read-only / disabled ARIA widget**: check `aria-disabled="true"` and `aria-readonly="true"` in `isEligible`. Skip.
- **Google's "Other..." option in a radiogroup**: matches by text content. If profile value doesn't match any option but matches "Other", we don't auto-fill — emit `missing` so user types it. (Phase 2 enhancement.)
- **Conditional questions revealed after answering**: `MutationObserver` already debounces re-scans. New ARIA widgets that appear get picked up on the next scan tick.
- **Combobox where options are in a portal not yet rendered**: `click()` to open, then wait one tick (await `Promise.resolve()`). If still no options found, return `{ filled: false, reason: "options did not render" }`.
- **Native input wrapped in ARIA**: scanner picks up the native one first. The ARIA pass de-dupes by checking `ariaWidget.contains(nativeFieldElement)` against the set of elements already collected by the native pass — if any native field is a descendant of this ARIA widget, skip the ARIA widget.
- **`<input>` with `role="combobox"`** (autocomplete pattern): native pass picks it up as input; ARIA pass skips because the native one is already in the result. Filler tries native first, succeeds.
- **`role="textbox"` without `contenteditable`**: not actually editable. Selector requires `[contenteditable="true"]`.
- **Settings toggle OFF**: scanner runs only the native pass. Existing behaviour preserved exactly.

## Testing

**Scanner** (`form-scanner.test.ts`):
- Google Forms radiogroup fixture: extracts label, options, correct selector via `aria-labelledby`.
- ARIA combobox with portal-rendered options: scanner picks up the combobox (options resolved at scan time from the existing markup).
- Native input wrapped in ARIA: de-duped, not double-counted.
- Read-only ARIA widget: skipped.
- Mixed native + ARIA form: both passes return correct fields.

**Filler** (`form-filler.test.ts`):
- `fillAriaTextbox` writes `textContent` and dispatches `input` event with correct `inputType`.
- `fillAriaRadioGroup` clicks the matching `[role="radio"]` child; reports `filled: false, reason: "no matching option"` when none matches.
- `fillAriaCheckbox` only clicks when state needs to change (idempotent if already correct).
- `fillAriaListbox` clicks combobox, then clicks matching option from document scope.

**Detector**: existing tests still pass with the new scanner output (regression).

**Manual verification** (post-merge):
- Google Forms personal survey (Age, Education, Email, Gender) — popup shows, fills correctly.
- Microsoft Forms test page (if reachable).
- Typeform short-question survey.
- GitHub repo page — still 0 (no regression).

## Acceptance

- [ ] Visit a Google Forms survey with personal demographic questions → popup shows, lists rows
- [ ] Fill button writes values into Google Forms radios + comboboxes; form ready to submit with correct data
- [ ] Microsoft Forms with similar shape works likewise (best-effort, manual verification)
- [ ] Detector still rejects GitHub repo pages (no regression)
- [ ] Settings toggle disables the ARIA pass (verified: scanner reverts to native-only behaviour)
- [ ] All existing 400 tests pass; +tests for scanner and filler ARIA paths
- [ ] `npm run typecheck && npm run test && npm run build` green

## Out of scope (deferred to follow-ups)

- Provider-specific commit hacks (Google's pointerdown/pointerup sequence, MS's hidden state writes) — add only if a specific provider proves unreliable in manual testing.
- Typeform's Enter-to-advance flow.
- Iframe scanning (Typeform embed).
- Slider / range / colour widget ARIA equivalents.
- "Other..." option auto-handling.
