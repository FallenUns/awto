# Tohodo stress-test fixes — pipeline separation

**Date:** 2026-05-17
**Status:** Approved
**Related code:** `src/content/form-scanner.ts`, `src/background/rule-mapper.ts`, `src/background/field-prefilter.ts`

## Context

Manual stress test on Tohodo's autofill practice page surfaced five distinct issues that all stem from the same root: the parser layer (scanner + rule-mapper) is doing less than it should, so weird fields fall through to the LLM (or worse, to a generic "What's your X?" prompt) when the parser had enough information to do better.

The user's brief: *"Separate the LLM pipeline. If the field is the same as one the user already inputted — like DOB split into dd/mm/yy — prioritise that first. The parser should catch it. And some fields aren't captured well — radios, checkboxes, weird 'Field 30' rows."*

The five issues observed:

| # | Symptom | Root cause |
|---|---|---|
| 1 | Three duplicate "Birthday:" shimmer rows | Three `<select>`s share one `<label for="bd-month">Birthday:</label>`. The day/year selects inherit it via visual fallback. The DOB-part rule looks at `field.label` and never inspects the `name` attribute when the label is non-empty. |
| 2 | "Field 30 / 31 / 32 / 33 / 40" rows | Rich-text editors (CKEditor, Quill, etc.) inject auxiliary `<input>` / `<textarea>` elements with no usable label. Scanner picks them up; popup shows them as labelless rows. |
| 3 | Every radio shown as "Radio button — pick manually"; every checkbox as "Checkbox — fill manually" | `field-prefilter.ts` hard-skips all radios and checkboxes (unless profile has a consent-like custom key). Even radios with clear profile matches (gender → "Female") get skipped. |
| 4 | "What's your To what URL should this link go??" | `makeMissing` always wraps the label in `What's your ${label}?` — produces double questions when the label is already a question. |
| 5 | "What's your user ID?" for Login/Username/Account fields | Same as #4 — phrasing is mechanical, ignores label shape. Tolerable once #4 is fixed; no separate change needed. |

## Decisions

| Question | Decision |
|---|---|
| RTE detection | Scanner skips inputs inside known RTE wrappers (CKEditor, Quill, Summernote, TinyMCE, Trumbowyg, etc.) AND inputs whose own classes/ids match RTE auxiliary patterns. Drop them entirely — don't surface them as skipped rows either. They're not user-fillable form fields. |
| DOB-group detection | In `dateOfBirthPartKey`, also examine the field's `name` and `id` (via `selectorHint`) even when a visible label exists. If label is generic ("Birthday") AND name/id is "month"/"day"/"year", classify by name/id. Options-content classification (existing) remains as a third signal. |
| Radio/checkbox prefilter | Remove the blanket skip. Let radios and checkboxes flow through rule-mapper → LLM. Rule-mapper handles gender/pronouns/work-rights/nationality patterns for radios. LLM handles the rest with its existing per-type rules ("only fill if profile has clear boolean/match, else skip"). |
| Question-form prompt phrasing | `makeMissing` detects labels that end with `?` or start with a wh-word/auxiliary ("what/where/when/why/how/is/are/do/does/did/can/could/should/would/will/tell/describe"). If so, use the label verbatim as the prompt. Otherwise the existing template. |
| LLM prompt changes | None. The existing per-type rules already say "skip if no match". |
| Service-worker pipeline | Unchanged. Rule mapper → prefilter → LLM order stays. |

## Architecture

### 1. Scanner skips RTE-auxiliary inputs

`form-scanner.ts` gains an `isRichTextAuxiliary(el)` check inside `isEligible`. Returns true (→ skip) if:
- The element OR any ancestor matches one of these selectors:
  - `.ck-editor`, `.ck`, `.cke_editable`, `.cke_wysiwyg_div`
  - `.ql-editor`, `.ql-container`
  - `.note-editor`, `.note-editable`
  - `.tox-edit-area`, `.tox-tinymce`
  - `.fr-element`, `.fr-wrapper`, `.fr-box`
  - `.trumbowyg-editor`, `.trumbowyg-box`
  - `.summernote`, `.mce-edit-area`
  - `.cm-editor` (CodeMirror)
  - `[contenteditable="true"]` (likely-RTE container)
- OR the element's own id/class starts with one of: `cke_`, `ql-`, `mce_`, `tox-`, `summernote-`, `trumbowyg-`

These inputs are auxiliary plumbing — clipboard sinks, hidden state stores — never visible form fields the user wants Awto to fill.

### 2. DOB-group detection via name/id

`rule-mapper.ts`'s `dateOfBirthPartKey` currently only inspects `signal` (label + placeholder). Change: also inspect `selectorHint(field.selector)` (which exposes the `name` / `id` / `data-testid`). When the visible signal is generic ("birthday") but the selector hint is `"month"` / `"day"` / `"year"`, classify by the selector hint.

Order of precedence inside `dateOfBirthPartKey`:

1. **Explicit name/id match** — selector hint exactly equals `month`/`day`/`year` (or contains `bd-month`, `dob-day`, etc.) → classify directly.
2. **Label match** — existing `^month$/^day$/^year$` against the visible signal.
3. **Options content** — existing month-name / 4-digit-year detection.

Triggering condition for entering `dateOfBirthPartKey` also loosens: currently requires `/\b(date\s*of\s*birth|birth\s*date|dob|month|day|year)\b/` in the visible signal. Extend to also check the selector hint, so a `<select name="day">` under a generic "Birthday:" label still enters the function.

### 3. Prefilter becomes minimal

`field-prefilter.ts` no longer skips radios or checkboxes. The function becomes a near-passthrough; we keep it as a hook for future filters but it does nothing for the current set.

Rule-mapper picks up radios/checkboxes via existing gender/pronouns/work-rights patterns. For radios, when the rule matches a known key and the profile value matches one of the radio's `options`, emit a fill. When the rule matches but no option matches, emit a missing. When no rule matches, fall through to LLM (which the existing per-type rules constrain conservatively).

The rule-mapper today only sets `actionType: "fill"` based on profile having a value — it doesn't verify that the value matches one of the radio's options. That's fine for text inputs but unsafe for radios/selects. Add a guard: for radios and selects, before emitting `fill`, verify the resolved profile value matches one of the field's `options` (case-insensitive, trimmed). If not, fall through to LLM rather than emitting a wrong fill.

### 4. Question-form prompt phrasing

`makeMissing` in `rule-mapper.ts` already accepts an optional `promptText`. When the caller doesn't supply one, the default is `What's your ${friendly}?`. Change the default to call a helper:

```ts
function phrasePrompt(label: string, fallbackKey: string): string {
  const trimmed = label.trim();
  if (!trimmed) return `What's your ${fallbackKey}?`;
  if (trimmed.endsWith("?")) return trimmed;
  if (looksLikeQuestion(trimmed)) {
    return trimmed.endsWith(".") ? trimmed.replace(/\.$/, "?") : `${trimmed}?`;
  }
  const stripped = trimmed.replace(/[:.]$/, "");
  return `What's your ${stripped}?`;
}

function looksLikeQuestion(text: string): boolean {
  return /^(what|where|when|why|how|who|which|is|are|do|does|did|can|could|should|would|will|tell|describe)\b/i.test(text);
}
```

This kills the "What's your To what URL should this link go??" pattern. Labels like "Tell us about yourself" become "Tell us about yourself?".

The same helper applies to LLM-generated `promptText` post-validation — if the LLM produces `"What's your ${label}?"` for a question-form label, post-process via `phrasePrompt`. This is a service-worker concern but the helper lives in rule-mapper and is exported.

### 5. Out of scope (deferred)

- LLM prompt rewording. Existing rules are correct for the per-type behaviour we want.
- Profile schema additions (e.g. add a `userId` standard key). The user's profile is theirs to extend via the options page.
- Multi-form scoping (currently scanner globs all inputs on the page). Separate concern.
- Iframe traversal for RTEs. We skip rather than recurse — matches the "don't fill what we can't verify" principle.

## Edge cases

- **Single DOB date input (`<input type="date">`)**: existing `bday` autocomplete + `dateOfBirth` label rule still wins. The new selector-hint check is additional, not replacing.
- **Custom `name="dob_month"`**: selectorHint normalizes to `"dob month"` — `month` substring match handles it.
- **`<label for="bd-month">Birthday:</label>` on the first select only**: with the new logic, the first select sees label "Birthday" + name "month" → classified as `dateOfBirthMonth`. The second/third selects have no explicit label-for, fall back to visual/preceding text, also pick up "Birthday" — but their selectorHint is "day"/"year", so they classify correctly too.
- **CKEditor inside a `<form>`**: scanner skips all of `cke_*` auxiliary inputs; the user's actual editable region is contenteditable, not an `<input>`, so it was never picked up anyway. Net: zero false rows for that editor.
- **Radio group with options that don't match profile**: rule-mapper sees gender match, profile value "male", options `["Female", "Other"]` — no match → falls through to LLM. LLM follows its "skip if no match" rule.
- **Question label ending with two question marks**: `phrasePrompt` returns it as-is; downstream is fine with that.

## Testing

`form-scanner.test.ts`: 
- Skip auxiliary inputs from CKEditor (`<div class="ck-editor"><input class="cke_clipboard" /></div>`) and Quill (`<div class="ql-container"><textarea class="ql-clipboard" /></div>`). Expect they're not returned.
- contenteditable div is not scanned (already true, but cover explicitly).

`rule-mapper.test.ts`:
- Split DOB group: three selects named `month`/`day`/`year`, all with visible label "Birthday", profile has `dateOfBirth: "1990-04-15"` → classify as `dateOfBirthMonth/Day/Year` and fill respectively.
- Gender radio: label "Gender", options `["Male", "Female", "Other"]`, profile.gender "Female" → fill.
- Gender radio with no profile match: profile.gender "Male", options `["Female", "Other"]` → missing (not fill).
- Question-form label: `<input>` label "Tell us about yourself" with no rule match → missing prompt is "Tell us about yourself?".
- Question-form label ending in `?`: label "What's your favourite colour?" → prompt is the label verbatim.

`field-prefilter.test.ts`:
- Radios are no longer pre-skipped (they pass through to `toLLM`).
- Checkboxes are no longer pre-skipped.
- Keep the function existing but with the new minimal behaviour.

## Acceptance

- [ ] Tohodo birthday section shows one filled "Birthday: April / 15 / 1990" or three separate filled rows (month/day/year), not three shimmers all labeled "Birthday".
- [ ] Tohodo RTE rows ("Field 30/31/32/33/40") disappear from the popup entirely.
- [ ] Tohodo "Female" radio fills from profile.gender (when set).
- [ ] Tohodo "To what URL should this link go?" missing row prompts with that exact text, not "What's your To what URL should this link go??".
- [ ] Existing 347 tests still pass; +6 to +10 new tests.
- [ ] `npm run typecheck && npm run test && npm run build` green.
