# Form-fill correctness + speed bugfix

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. TDD per fix.

**Goal:** Make form-filling reliable on common form types (checkboxes/radios/selects/time/date) and surface failures honestly to the user.

**Architecture:** Strengthen the LLM prompt with per-type rules and label synonyms; teach the form-filler fuzzy `<select>` matching; surface partial-fill failures in the chat; pre-filter unfillable types client-side to cut prompt size and prevent bad LLM outputs.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

**Reported bugs** (from manual test on Identity + Pizza forms):
1. Same value (`"address test"`) duplicated into Street + City
2. Phone missing from Identity form despite being in profile
3. State `<select>` not selected (LLM gave abbreviation, form has full name)
4. Country `<select>` same
5. Pizza checkboxes mapped to text values (`Bacon → "Pname"`)
6. `type="time"` field given a date value (`"2000-01-01"`)
7. Chat says "Fill 6 fields" but only 3 actually fill
8. 40+ field forms slow

## Fixes

| Fix | Root cause | Files | TDD per fix |
|---|---|---|---|
| **F1** prompt rewrite | Prompt has no input-type guidance | `prompt.ts`, `prompt.test.ts` | yes |
| **F2** fuzzy select match | Select matcher is exact-only | `form-filler.ts`, `form-filler.test.ts` | yes |
| **F3** surface fill failures | `fillFormResult.failed` ignored | `useAwtoFlow.ts`, `Popup.tsx`, `useAwtoFlow.test.ts` | yes |
| **F4** pre-filter | All fields go to LLM regardless of type | new `field-prefilter.ts`, `service-worker.ts`, tests | yes |

Each fix lands as its own commit. Combined review after each. Final cross-fix verification at the end.

---

## F1 — Rewrite SYSTEM_PROMPT (+ optional user-prompt enrichment)

**Contract:** the prompt now explicitly tells the LLM:
- `checkbox` → value must be `"true"` or `"false"`. If you can't infer a boolean answer from the profile, skip.
- `radio` → value must be one of the radio group's options copied verbatim. If no option matches a profile value, skip.
- `select` → value MUST be copied verbatim from the `options` list. Do not paraphrase ("VIC" is wrong if options are ["Victoria", ...]).
- `time` → HH:MM (24-hour). If profile has no time, skip.
- `date` → YYYY-MM-DD.
- `tel` / phone-labeled text → use `profile.phone` or `profile.mobilePhone`. Common label synonyms: "Phone", "Phone number", "Telephone", "Mobile", "Cell", "Tel".
- Email-labeled text with `type="email"` → `profile.email`.
- Don't put the same value into two semantically different fields (e.g. street and city should not be identical).
- Reduce confidence to 0.6–0.8 when forced to fuzzy-match an enum.

**Tests** (`prompt.test.ts`): the system prompt mentions the substrings `"checkbox"`, `"radio"`, `"options list"` (or similar), `"HH:MM"`, `"YYYY-MM-DD"`, `"Phone number"`, and "different fields" guidance. Snapshot-style assertions are fine.

---

## F2 — Form-filler fuzzy select match

**Contract:** in `form-filler.ts`'s select branch, try in order:
1. Exact case-insensitive match on `option.value` or `option.textContent`
2. Case-insensitive **substring** match in either direction (`"VIC"` ⊂ `"Victoria"` OR `"Australia"` ⊂ `"Australia, AU"`)
3. **Levenshtein distance ≤ 2** on `option.textContent` (catches typos and one-letter swaps)
4. If still no match → `failed.push({selector, reason: "no matching option"})`

The Levenshtein distance helper is a small in-file pure function (~25 lines). No dependency.

**Tests** (`form-filler.test.ts`): cover
- LLM says `"VIC"`, options are `["Victoria", "New South Wales", "Queensland"]` → matches `"Victoria"`
- LLM says `"Austraila"` (typo), options include `"Australia"` → matches via Levenshtein
- LLM says `"Mars"`, options are `["Earth", "Venus"]` → no match, reason `"no matching option"`

---

## F3 — Surface fillFormResult.failed in the chat

**Contract:** after `fillForm` returns `{filled, failed}`, useAwtoFlow:
- Updates flow state from `filling` → `done` with `filledCount: filled` AND `failedFills: failed` (new field).
- Popup `done` view renders `Filled X field(s)` + if `failed.length > 0`, a follow-up line `"Couldn't fill Y: <label1>, <label2>, ..."` in muted text.

Map `failed[].selector` back to the original field label via `state.fields` so the message is human-readable.

**Tests** (`useAwtoFlow.test.ts`): existing fill test asserts `filledCount`; add a case where fillForm returns 1 failed entry and verify `failedFills` is populated. Smoke test on Popup that the "Couldn't fill" line renders.

---

## F4 — Pre-filter unfillable types client-side

**Contract:** new module `src/background/field-prefilter.ts` with:

```ts
export interface PrefilterResult {
  toLLM: ScannedField[];
  skipped: FieldMapping[];   // synthetic "skip" entries for the chat
}

export function prefilter(fields: ScannedField[], profile: Profile): PrefilterResult;
```

Rules:
- `type === "checkbox"` AND no profile field looks like a yes/no answer (heuristic: no profile key/value contains "agree", "consent", "subscribe", "newsletter") → skip with reason `"Checkbox — fill manually"`.
- `type === "radio"` → always skip with reason `"Pick manually"`. Radios are stylistic choices (size, qty) that profile data rarely covers.
- Otherwise → forward to LLM.

Service worker `mapFields` handler:
1. Pre-filter the incoming `message.fields`.
2. Call hybrid only with `toLLM`.
3. Merge LLM result mappings with synthesized skip mappings (sorted by `fieldId`).
4. Cache the merged result as today.

**Tests** (`field-prefilter.test.ts`): checkbox without profile-consent key → skip; checkbox with profile `"agreeTos": "true"` → forward; radio → always skip; text → forward.

**Integration test** in `service-worker.test.ts`: mapFields with mixed fields → only non-skipped go to hybrid; merged result has all fields.

---

## Acceptance

- All previously passing tests pass after each fix
- New tests pass per F1/F2/F3/F4
- `npm run typecheck && npm run test && npm run build` green
- Manual recheck: pizza form's Bacon/Extra Cheese no longer show as "Will fill", time field skipped; Identity form's State/Country fill via fuzzy match; chat shows honest fill count + any failures
