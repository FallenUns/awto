# Spec B — Profile dropdowns + closest-match confidence indicator

**Date:** 2026-05-16
**Status:** Approved
**Related code:** `src/options/ProfileTab.tsx`, `src/popup/Popup.tsx`, `src/background/llm/prompt.ts` (Section 2 already shipped in F1)

## Context

Two related quality-of-life improvements:

1. **Profile dropdowns** — title, pronouns, and country today are free-text inputs. Easy to typo, easy for the LLM to drift between values. Turn them into `<select>` with an "Other (specify)..." escape for custom values.
2. **Chat confidence indicator** — the old pre-chat-rewrite UI showed an amber dot for confidence < 0.85 mappings. The chat UI rewrite (commit `46b12df`) dropped it. Bring it back, scoped to the new bubble layout. Plus a tooltip explaining "Low confidence — verify this value".

Section 2 of this spec (LLM prompt nudge to lower confidence on fuzzy match) **already shipped in F1** (commit `1f45f2a`).

## Decisions

| Question | Decision |
|---|---|
| Which fields get dropdowns | title + pronouns + country |
| Profile schema change | None — values stored as strings, dropdown only constrains the editor UI |
| Country list source | Hardcoded ISO 3166-1 list (~250 entries) in `src/options/countries.ts`; AU/NZ/UK/US/CA pinned to top |
| "Other..." escape | Sentinel option reveals a text input below the select |
| Confidence threshold | 0.85 — matches the old pre-rewrite logic |
| Indicator style | Amber filled circle (`#F59E0B`, 6px), title attribute for tooltip, aria-label for screen readers |

## Architecture

### Section 1 — Profile dropdowns

**New file `src/options/countries.ts`:**

```ts
export const COUNTRIES = [
  "Australia",          // pinned
  "New Zealand",        // pinned
  "United Kingdom",     // pinned
  "United States",      // pinned
  "Canada",             // pinned
  "Afghanistan",
  "Albania",
  // ...ISO 3166-1 alpha-2 country names alphabetically, with the 5 pinned ones removed from the alpha section
  "Zimbabwe",
] as const;

export const TITLES = ["Mr", "Mrs", "Ms", "Mx", "Dr", "Prof"] as const;
export const PRONOUNS = ["he/him", "she/her", "they/them"] as const;
```

A small list of `~5 pinned + ~245 alphabetical` countries is fine to hardcode.

**Modified `src/options/ProfileTab.tsx`:**

Detect title / pronouns / country specially in the field renderer. Replace the default `<input type="text">` with a `<select>` for these three keys. Selecting the sentinel `"__custom__"` reveals a text input below.

Render logic:

```tsx
const ENUM_FIELDS: Partial<Record<BuiltInKey, readonly string[]>> = {
  title: TITLES,
  pronouns: PRONOUNS,
  country: COUNTRIES,
};

function isEnumField(key: BuiltInKey): boolean {
  return key in ENUM_FIELDS;
}

// Inside the render loop, for an enum field:
const options = ENUM_FIELDS[field.key];
const isCustom = value !== "" && !options.includes(value);
const selectedValue = isCustom ? "__custom__" : value;

<select value={selectedValue} onChange={...}>
  <option value="">Choose…</option>
  {options.map((o) => (<option key={o} value={o}>{o}</option>))}
  <option value="__custom__">Other…</option>
</select>
{isCustom && (
  <input
    type="text"
    value={value}
    onChange={(e) => onUpdate(field.key, e.target.value)}
    aria-label={`Custom ${field.label}`}
  />
)}
```

The user can pick any standard option from the dropdown or type a custom value via the "Other…" sentinel. Saved profile value is whatever string lands in `profile[key]`.

**Tests:** add cases to `ProfileTab.test.tsx` (or smoke-test in `Options.test.tsx`) covering:
- Default render shows a `<select>` for title (not an `<input>`)
- Selecting an option calls onUpdate with that string
- Selecting "Other…" reveals a text input
- A non-standard preset value (e.g. `profile.title === "Reverend"`) renders the select with `__custom__` selected and the text input visible with the value

### Section 3 — Confidence indicator in chat

**Modified `src/popup/Popup.tsx`:**

In the will-fill list, when `row.confidence < 0.85`, render an amber dot before the label:

```tsx
<li key={row.fieldId} className="awto-fill-list__item">
  <span className="awto-fill-list__label">
    {row.confidence < 0.85 && (
      <span
        className="awto-confidence-dot"
        title="Low confidence — verify this value"
        aria-label="Low confidence"
      />
    )}
    {row.label}
  </span>
  <span className="awto-fill-list__value">…</span>
</li>
```

**New CSS rule in `src/popup/styles.css`:**

```css
.awto-confidence-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #F59E0B;
  margin-right: 6px;
  vertical-align: middle;
}
```

**Test:** in `Popup.test.tsx`, mount the popup with a mocked ready state containing one row at confidence 0.6 and one at 0.9. Assert the amber-dot element appears once.

## Acceptance

- [ ] Title / pronouns / country render as `<select>` in the profile editor
- [ ] "Other…" reveals a text input that writes to the same profile field
- [ ] Existing custom values (non-preset) load as "Other…" + text input populated
- [ ] Will-fill rows with `confidence < 0.85` show an amber dot with tooltip
- [ ] `npm run typecheck && npm run test && npm run build` green
- [ ] Total tests grow by ~5 (3 dropdown + 1 confidence + 1 country list smoke)

## Out of scope

- State dropdown (AU has 8 but conditional-on-country adds complexity)
- Country code (not just country name) for international forms
- A "verify because…" explanation tooltip with the LLM's stated reason (would need schema change)
- Removing the amber-dot threshold knob (kept at 0.85 hardcoded)
