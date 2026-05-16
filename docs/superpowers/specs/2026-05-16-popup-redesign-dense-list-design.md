# Popup UI redesign — dense list with shimmer + sticky action bar

**Date:** 2026-05-16
**Status:** Approved
**Related code:** `src/popup/*`

## Context

The current chat-style popup feels too verbose for what is actually a utility action:

- Greeting bubble + status bubble + missings-prompt bubble + closer bubble = 4 chunks of vertical real estate before the user sees their data
- Loading state shows one centered "Thinking…" bubble in a huge empty void
- Bubble avatars, typing dots, and "Hi! I had a look at this form" copy add no information

Replace with a **dense list** patterned after 1Password's autofill review: one compact row per field with a status icon, label, and value/input. Sticky bottom Fill button. Status summary in the header. Field rows appear instantly with shimmer values that resolve as LLM chunks land.

## Decisions

| Question | Decision |
|---|---|
| Interaction pattern | Dense list with status icons (1Password-style) |
| Loading visualization | Field rows appear immediately with shimmer values; resolve as chunks arrive |
| Action bar placement | Sticky bottom (Fill primary right, Cancel ghost left) |
| Theme + tokens | Keep existing slate-dark + green from DESIGN_SYSTEM.md |
| Density target | 5–8 rows visible without scroll in a 400×600 popup |

## Architecture

### Layout (all states)

```
┌──────────────────────────────────────────────┐  40px header
│ [A]Awto  6 ready · 3 ask · 1 skip      [↻]  │
├──────────────────────────────────────────────┤
│ ✓  First name          Patrick               │
│ ✓  Last name           Adrianus              │  ~44px rows
│ ✓  Email               p@x.com               │
│ ?  Middle name         [_________]           │
│ ?  Phone               [_________]           │
│ ✓  Postcode            3000                  │
│ —  CAPTCHA             (skipped: not safe)   │
│                                              │
├──────────────────────────────────────────────┤  56px footer
│ Cancel                       Fill 6 fields   │
└──────────────────────────────────────────────┘
```

### Components

#### `Header.tsx` (new — replaces StatusBar)

- 40px tall, `border-bottom: 1px solid var(--color-border)`
- Left: 20px green-filled "A" avatar circle, "Awto" 13px medium
- Center/inline-right: status pill — content depends on status:
  - `scanning` → `Reading the form…`
  - `mapping` → `Mapping 3/6` (or `Mapping…` if chunks not tracked yet)
  - `ready` → `6 ready · 3 ask · 1 skip` (omit zero-count segments)
  - `filling` → `Filling…`
  - `done` → `Filled 6` (auto-hides after 1.5s if popup stays open)
  - `error` → `Error`
  - `no-form` → `No form here`
- Right: `RefreshCw` rescan button (28×28 hit, 14px icon). Visible in `ready` / `error` / `done`. Hidden during `scanning` / `mapping` / `filling`.

#### `FieldRow.tsx` (new — the heart of the redesign)

Props: `row: FieldRow & {kind: "fill" | "missing" | "skip" | "loading"}`, `onChangeValue?: (value: string) => void`.

Renders one row:
- Container: `display: grid; grid-template-columns: 20px 1fr minmax(0, 1.5fr); align-items: center; gap: 12px; min-height: 44px; padding: 8px 12px; border-bottom: 1px solid var(--color-border-subtle);`
- Status icon (20px column):
  - `fill` → Lucide `Check` green
  - `missing` → Lucide `HelpCircle` amber (#F59E0B)
  - `skip` → Lucide `Minus` muted
  - `loading` → small `Loader2` spinning
- Label (col 2): 13px medium, 1-line truncate via `text-overflow: ellipsis; overflow: hidden; white-space: nowrap;`. Confidence < 0.85 adds a small `.awto-confidence-dot` before the label (existing affordance).
- Value column (col 3):
  - `fill`: 14px tabular text. Click → switches to editable inline input (focus + select-all on enter).
  - `missing`: full-width `<input>` styled like `.awto-input` but compact (32px tall).
  - `skip`: 12px muted italic — `(reason)` text.
  - `loading`: `<div className="awto-shimmer">` 32×16 rounded box.

Row hover (only when not editing): `background: rgba(255,255,255,0.03)`.

#### `Shimmer` (CSS only)

```css
.awto-shimmer {
  display: inline-block;
  height: 16px;
  border-radius: 4px;
  background: linear-gradient(
    90deg,
    var(--color-muted) 0%,
    var(--color-border) 50%,
    var(--color-muted) 100%
  );
  background-size: 200% 100%;
  animation: awto-shimmer 1.2s ease-in-out infinite;
}
@keyframes awto-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .awto-shimmer { animation: none; }
}
```

#### `ActionBar.tsx` (new — replaces Footer)

56px sticky bottom. `border-top: 1px solid var(--color-border); background: var(--color-background); padding: 0 12px; display: flex; align-items: center; gap: 12px;`

- Left: `Cancel` ghost button (44×44 hit, 13px, muted text)
- Right: `Fill N fields` primary button (44px tall, green accent, takes remaining width)
- Disabled when:
  - Any required missing row has empty value, OR
  - No fillable rows AND all missing rows empty
- Disabled tooltip: `Fill in N more fields first`
- During `filling`: `Filler2` spinner + "Filling…" label, button disabled

#### `Popup.tsx` (rewrite — coordinator only)

State flow:
1. `scanning` → Header + 1 row "Looking…" shimmer + disabled ActionBar (greyed Fill button)
2. `mapping` → Header (with "Mapping X/Y") + every scanned field rendered as a `FieldRow` with `kind: "loading"`. Rows resolve into `fill` / `missing` / `skip` as `mapFieldsProgress` chunks arrive. No layout shift — only the row's content cell changes.
3. `ready` → All rows resolved, ActionBar enabled
4. `filling` → Rows lock, ActionBar shows "Filling…"
5. `done` → Centered ✓ + "Filled X fields" + failed list, auto-close 1.5s
6. `error` → Centered alert card with `Try again`
7. `no-form` → Centered FileX2 + "No form on this page"

States 5/6/7 are simple centered layouts (similar to today's done/error/no-form blocks); no field rows shown.

#### `useAwtoFlow.ts` (small extension)

Add `loadingRows: ScannedField[]` to `FlowState`. Populated when `scanFormResult` arrives so `mapping` state can render all rows as shimmer immediately. As `mapFieldsProgress` lands, those rows convert to fill/missing/skip rows in the existing arrays.

### What goes away

- `StatusBar.tsx` → replaced by `Header.tsx`
- `Footer.tsx` → replaced by `ActionBar.tsx`
- Inline `Bubble` component in Popup.tsx → gone
- `Sparkles`, `BookmarkPlus` icons in Popup → gone
- All `.awto-bubble*`, `.awto-chat`, `.awto-typing*`, `.awto-fill-list*`, `.awto-qa*` CSS rules → gone
- The "Hi! I had a look at this form" greeting → gone
- The 3-dot pulsing typing indicator → replaced by shimmer rows

### What stays

- 400×600 popup, slate-dark theme, Inter font, Lucide icons
- All existing message contracts (no service-worker changes)
- Spec C cache, Spec A autocomplete, F1-F5 bug fixes, hybrid mapping
- `useAwtoFlow`'s scan → map → fill flow
- Rescan button (just moves to the Header instead of StatusBar's right corner)
- Failed-fills surfacing in done state
- Confidence dot for `<0.85`

## Testing

Update existing popup tests + add:
- `FieldRow.test.tsx` (new): renders fill row with value, missing row with input, skip row with reason, loading row with shimmer
- `Popup.test.tsx` (extend): mapping state renders one shimmer row per scanned field; ready state renders dense list; action bar disabled when missings empty
- `Header.test.tsx` (new) or in Popup: status pill text per status

## Acceptance

- [ ] Loading state shows shimmer rows for every scanned field (no empty void)
- [ ] Each chunk landing converts shimmer rows to resolved rows without layout shift
- [ ] Header status pill summarizes counts in `ready` state
- [ ] Rescan button visible in header for `ready` / `error` / `done`
- [ ] Sticky bottom action bar always visible during `ready` / `filling`
- [ ] All previously passing tests pass; new tests cover FieldRow + dense list rendering
- [ ] `npm run typecheck && npm run test && npm run build` green

## Out of scope

- Light mode (deferred until v2)
- Drag-to-reorder rows
- Per-row "skip" or "use cloud only" toggles
- Saved sections / groups / per-domain layouts
