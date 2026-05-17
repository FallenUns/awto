# Grouped popup + LLM safety hardening

**Date:** 2026-05-17
**Status:** Approved
**Related code:** `src/popup/Popup.tsx`, `src/popup/SectionHeader.tsx` (new), `src/popup/styles.css`, `src/background/mapping-safety.ts`, `src/background/llm/prompt.ts`, `src/background/service-worker.ts`

## Context

Tohodo retest screenshot showed:

- Account ← `0421806625` (the user's phone number).
- Account # ← `206` (hallucinated).
- Color picker ← `"he/him"`.
- Search ← `"he/him"`.
- Quality / Fruit / Green checkbox / Filter ← `"Patrick A"`.
- Female radio ← `"he/him"`.
- "What's your date:?" / "What's your time:?" — labels ending in `:` followed by `?`.

Two problems, coupled:

1. **Wrong fills.** The LLM is treating non-personal fields as "use any string from the profile". The existing per-type prompt rules say "skip if uncertain" but the LLM ignores them on edge cases. Post-validation in `mapping-safety.ts` covers a small set of cases (dateOfBirth into delivery time) but doesn't guard against names going into Color picker / Search / Quality / Fruit / generic checkboxes.

2. **UI ordering hides the good fills.** Rows render in form order with shimmer interleaved. Correct fills are scrolled past while the eye lands on bogus values like "Color picker: he/him". User can't trust the confirmation step because everything looks the same — same green-tick treatment for a parser-confirmed `firstName` fill as for an LLM-hallucinated `Color picker ← he/him`.

The user's brief: *"show the confirmed one first and fill it, and the user will check the one that the LLM thinks."* They want grouping by trust level, AND they want the LLM to stop inventing fills.

These ship together. Grouping into a "Will fill" section is misleading without (1), because a wrong LLM fill with confidence 0.9 currently looks identical to a rule-mapper fill with confidence 1.0.

## Decisions

| Question | Decision |
|---|---|
| Grouping vs form order | Group by trust level. Form order is lost once the popup is open and the user is scanning values, not field positions. |
| Section count | Four: Will fill / Review before filling / Needs your input / Skipped (collapsed). |
| Confidence threshold for "Will fill" vs "Review" | `≥ 0.85`. Matches the existing amber-dot threshold from Spec B. Parser fills are always 1.0 so they always land in Will fill. |
| ActionBar Fill behaviour | Fills Will-fill rows + answered missing rows. Does NOT fill Review rows automatically — user must "Use" each first. |
| Per-row Use/Skip on Review | Yes — tappable chip on each Review row. Default unselected. "Use" promotes the row to Will fill (visually moves it). |
| Skip section default | Collapsed. Discloses on click. |
| LLM safety layer | Three-pronged: stronger prompt + post-validation deny-list + claimed-key dedupe hint to the LLM. |
| Profile schema changes | None. Profile already has gender/pronouns/etc. |
| Streaming UX | Unchanged — chunks still arrive and rows still pop into their section. Sections reflow as new rows arrive (`useMemo` on `[fillRows, missingRows, skippedRows]`). |

## Architecture

### 1. Section grouping in `Popup.tsx`

Today `Popup.tsx` iterates `loadingFields` and resolves each to fill/missing/skip/loading. Refactor to:

```tsx
const sections = useMemo(() => partitionRows(state), [state.fillRows, state.missingRows, state.skippedRows]);

// sections = {
//   willFill: FillRow[],     // confidence >= 0.85 + user-confirmed Review rows
//   review: FillRow[],       // confidence < 0.85, not yet user-confirmed
//   missing: MissingRow[],
//   skipped: SkippedRow[],
//   loading: ScannedField[], // fields not yet resolved (still shimmer-worthy)
// }
```

User-confirmation state for Review rows lives in popup-local state (`useState<Set<number>>` keyed by fieldId). Not persisted across popup close; if the popup reopens cache-hit, the user re-confirms.

Render order:

1. **Loading shimmer** (if any pending) — small "still mapping…" line.
2. **Will fill (N)** — section header, then FieldRows.
3. **Review before filling (N)** — orange section header. Each row has Use/Skip chip.
4. **Needs your input (N)** — section header, then FieldRows with inputs.
5. **Skipped (N)** — collapsed disclosure.

When `loadingFields.length === 0` and all four other sections are empty, we're in the cache-hit empty-form case — render nothing (existing no-form/done paths still apply elsewhere).

### 2. `SectionHeader` component (new)

```tsx
interface SectionHeaderProps {
  label: string;        // "Will fill"
  count: number;        // 5
  tone: "neutral" | "amber" | "muted";  // visual treatment
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}
```

44pt height. Tone maps to a small coloured left bar (4px) + label colour. Collapsible variant adds a disclosure chevron.

### 3. ActionBar behaviour

- Fill count = `willFill.length + answeredMissing.length` (Review rows excluded unless promoted).
- Fill button label remains "Fill N fields".
- Disabled when count is 0 OR status is not `ready`.

### 4. LLM safety hardening

**A. SYSTEM_PROMPT additions** in `src/background/llm/prompt.ts`:

```
Hard "never" rules — these override everything else:

- NEVER put a person's name (firstName, lastName, fullName, preferredName, middleName) into a field whose label does NOT contain a name-related word (name, applicant, passenger, customer, contact, given, family, surname). If the label is "Color picker", "Search", "Quality", "Fruit", "Filter", "Quantity", or similar generic non-personal terms — SKIP.

- NEVER put pronouns into a field whose label does not mention pronouns. If the label is "Color picker" or "Search" or "Female" radio — SKIP.

- NEVER put a phone number into a field whose label is "Account", "Account #", "Account Number", "Card", "ID", "Code", or similar non-phone label. Phones go only into phone-labelled fields.

- NEVER fill a color picker, slider, search input, file upload, or canvas. SKIP these with confidence 1.0.

- For checkboxes that represent a colour choice (Red/Green/Blue), a food choice (Pizza/Burger), or other user-preference toggles: SKIP. Only fill consent/agreement checkboxes.

- For radio groups: only fill if the profile has a value that EXACTLY matches one of the radio's options (case-insensitive). Otherwise SKIP. "he/him" is not a valid value for a "Female" radio option.

- If you don't have a high-confidence match (≥0.85), prefer SKIP over fill. Wrong fills are worse than empty fields.
```

**B. Claimed-key hint** (new prompt input):

```
Keys already claimed by parser-resolved fields on this form: [firstName, lastName, email, phone]
Avoid reusing these unless the new field clearly asks for the same data
(e.g. two email fields both legitimately get email).
```

Service-worker computes the claimed-key list from `ruleMappings` and threads it into `buildUserPrompt(profile, fields, claimedKeys)`.

**C. `mapping-safety.ts` deny-list guard**:

Extend `decide()` so that for a fixed set of "name-like" / "pronoun-like" / "phone-like" profile keys, the function REQUIRES a label-pattern match. If the field's label doesn't match any rule that explicitly allows that profile key, downgrade to skip.

```ts
const REQUIRE_LABEL_MATCH: Record<string, string[]> = {
  firstName: ["firstName", "fullName"],     // must match a rule whose allow includes one of these
  lastName: ["lastName", "fullName"],
  middleName: ["middleName"],
  preferredName: ["preferredName", "fullName"],
  fullName: ["fullName"],
  pronouns: ["pronouns"],
  gender: ["gender"],
  phone: ["phone", "mobilePhone"],
  mobilePhone: ["phone", "mobilePhone"],
};
```

Logic: if `profileKey` is in REQUIRE_LABEL_MATCH and NO rule's `allow` list intersected with REQUIRE_LABEL_MATCH[profileKey] was triggered → skip with reason "Profile value doesn't fit this field — skipped".

Also: add label-pattern rules to INTENT_RULES for `pronouns` (currently missing) so legitimate pronoun fields still pass.

**D. `phrasePrompt` on LLM-generated text**:

In `service-worker.ts`, after `sanitizeMappings`, iterate any `missing` mappings whose `promptText` ends with `:?` or starts with `What's your ... :?` and replace via `phrasePrompt(label, suggestedKey)`. The label comes from the matching `ScannedField`.

Cleanest: have `sanitizeMappings` itself call `phrasePrompt` when it constructs a missing mapping AND when it passes an existing missing mapping through. Then service-worker doesn't need a second pass.

Wait — `sanitizeMappings` is called per chunk. LLM-generated promptText flows through it on the fill→missing downgrade path already (via `promptText(field, key)` helper). The leak is: when LLM produces actionType:"missing" directly with a bad promptText, `sanitizeMappings` doesn't touch it.

Fix: in `sanitizeMappings`, for any mapping with `actionType: "missing"`, run its `promptText` through `phrasePrompt(field.label, suggestedKey)` if the existing text looks malformed (contains `:?` or contains "What's your ... :"). Otherwise keep.

### 5. CSS

New section header style (`.awto-section-header`). 4px left border, tone-coloured. 12px vertical padding. 13px label, tabular count badge.

Collapsed skipped section uses a chevron that rotates 90deg when expanded.

## Components

- `Popup.tsx` — refactored render, partitions rows into sections, holds user-promoted Review set state.
- `SectionHeader.tsx` — new, 30 lines.
- `FieldRow.tsx` — new optional prop `actions?: React.ReactNode` to render Use/Skip chip on Review rows. Or simpler: a `reviewable?: boolean` prop and an `onPromote` callback.
- `mapping-safety.ts` — extended INTENT_RULES + new REQUIRE_LABEL_MATCH guard + promptText normalisation.
- `llm/prompt.ts` — SYSTEM_PROMPT additions + `buildUserPrompt` accepts optional `claimedKeys`.
- `service-worker.ts` — compute claimedKeys from ruleMappings, pass to hybrid call (which passes to buildUserPrompt).
- `Popup.test.tsx` — tests for grouping order + Review promotion.
- `mapping-safety.test.ts` — tests for name/pronoun/phone guards + promptText normalisation.
- `popup/styles.css` — section header + collapsed disclosure styles.

## Edge cases

- **Cache hit**: `loadingFields` empty, all rows arrive at once → render groups directly.
- **All confirmed**: no Review section header shown (count = 0 sections collapse to nothing).
- **All Review**: Will fill section shows "0" — render as empty section or hide. **Hide** sections with count 0.
- **Streaming**: as chunks arrive, rows move from loading shimmer into the appropriate section. Section reflow is fine — no per-row animation required for v1.
- **Review row promoted then chunk re-arrives**: cache hit on same popup-open returns same set, user's promoted set survives (popup-local state).

## Testing

`mapping-safety.test.ts`:
- `firstName` → "Color picker" → skip.
- `pronouns` → "Search" → skip.
- `phone` → "Account" → skip.
- `firstName` → "First name" → allow (existing pass case).
- `pronouns` → "Pronouns" → allow (new rule).
- LLM-generated missing with promptText "What's your date:?" → normalised to "What's your Date?".

`Popup.test.tsx`:
- Three fills with confidence 1.0 + one fill with confidence 0.7 → renders "Will fill (3)" then "Review before filling (1)".
- Promote a Review row → it appears under Will fill, ActionBar count increases by 1.
- Skipped section collapsed by default → clicking expands.

## Acceptance

- [ ] Popup shows Will fill section first, then Review, then Needs input, then Skipped (collapsed).
- [ ] LLM-suggested fill with confidence < 0.85 lands in Review, not Will fill.
- [ ] Review rows have Use / Skip chips; Use promotes into Will fill and increments ActionBar count.
- [ ] Skipped section is collapsed by default.
- [ ] firstName/lastName/fullName/pronouns/phone fills to non-matching fields get downgraded to skip via mapping-safety.
- [ ] LLM-generated promptText with trailing `:?` gets normalised through `phrasePrompt`.
- [ ] Claimed-key hint is included in LLM prompt when ≥1 rule mapping exists.
- [ ] All existing tests pass; +tests for new guards and grouping.
- [ ] `npm run typecheck && npm run test && npm run build` green.

## Out of scope

- Form-fill execution for month-name selects (separate follow-up).
- Per-row inline editing of fill values.
- Profile additions for "userId" etc.
- Animating row movement between sections.
