# Progressive row resolution during mapping

**Date:** 2026-05-17
**Status:** Approved
**Related code:** `src/popup/Popup.tsx`, `src/popup/Popup.test.tsx`

## Context

After the recent dense-list redesign + hybrid mapping pipeline, the popup's `mapping` state shows shimmer rows for every scanned field. Rule-mapped resolutions (autocomplete + label patterns) arrive via `mapFieldsProgress` within ~50ms and accumulate in `state.fillRows` / `missingRows` / `skippedRows`, but they're not rendered until the popup transitions to `ready` (which only happens after the final LLM chunk completes).

Result: user sees an all-shimmer screen for the full duration of LLM chunks even when 60–80% of fields were already resolved instantly by the parser.

**Fix:** during `mapping`, render each `loadingField` as either a resolved row (if a mapping for that `fieldId` exists in state) or a shimmer row (if not). Form order preserved (row 3 stays row 3). No service-worker or prompt changes — purely a render refactor in `Popup.tsx`.

## Decisions

| Question | Decision |
|---|---|
| Row ordering | Form order (loadingFields order) — resolved rows appear in their original slot |
| Mix vs group | Mix — resolved and shimmer rows interleave by form position |
| ActionBar during mapping | Visible, Fill button DISABLED until status reaches `ready` |
| LLM prompt changes | None (rejected — would break "confirm email" retype fields) |
| Service worker changes | None |

## Architecture

`Popup.tsx`'s render branches for `mapping` / `ready` / `filling` collapse into a single path that iterates `state.loadingFields` and resolves each entry via a small lookup into the three row arrays.

```ts
function rowFor(fieldId: number, state: FlowState): {
  kind: "fill" | "missing" | "skip" | "loading";
  data: FillRow | MissingRow | SkippedRow | null;
}
```

Returns the matching resolved row if any exists, else `{kind: "loading", data: null}`.

`ActionBar`:
- Visible during `mapping`, `ready`, `filling`
- `fillDisabled = status !== "ready" || (fillCount === 0 && missingRows.every empty)`
- During `mapping`: Fill button shows "Mapping…" instead of "Fill X fields" and is disabled
- Cancel remains enabled throughout

`scanning` state stays as today (single "Scanning the form…" shimmer row).

`no-form` / `error` / `done` states unchanged.

## Components

**No new components.** `Popup.tsx` is refactored to consolidate three render branches into one. A small inline helper (`rowFor`) does the per-field lookup.

`FieldRow.tsx`, `Header.tsx`, `ActionBar.tsx`, `useAwtoFlow.ts` — all unchanged.

## Edge cases

- **Cache hit** (`mapFieldsResult` arrives instantly): `loadingFields` is cleared and `status` jumps straight to `ready`. The unified render path still works because all rows resolve immediately.
- **scanFormResult with empty fields**: `loadingFields = []`, status transitions to `no-form`. Already handled.
- **Rescan**: `loadingFields` is repopulated; existing fillRows/missingRows/skippedRows are cleared. Mapping state shows all shimmer again until chunks resolve.
- **Confidence < 0.85 on a rule mapping**: rule layer always uses confidence 1.0, so this only applies to LLM rows — existing amber-dot affordance still works.
- **Missing rows with empty value during mapping**: rendered as `?` row with empty input. User can start typing before LLM finishes.

## Testing

Update `Popup.test.tsx`:
- Add: during `mapping`, given `loadingFields` of 5 + 2 rows already in `fillRows`, popup renders 2 fill rows in their fieldId slots + 3 shimmer rows.
- Add: ActionBar Fill disabled during `mapping`, enabled in `ready`.
- Keep the existing smoke test (no-form state).

## Acceptance

- [ ] During `mapping`, rule-resolved rows show as ✓ in form order
- [ ] LLM-pending rows shimmer alongside in their natural positions
- [ ] As each chunk lands, shimmer rows resolve in-place (no reorder)
- [ ] ActionBar visible during `mapping`; Fill button disabled until `ready`
- [ ] Retype fields (Confirm email, Re-type password) still get the same value — no prompt regression
- [ ] All previously passing tests pass; +2 new render tests
- [ ] `npm run typecheck && npm run test && npm run build` green

## Out of scope

- LLM prompt awareness of claimed keys (rejected per "confirm email" retype concern)
- Allowing Fill before mapping completes (partial fill)
- Row reordering / grouping by status
- Cancel-and-fill-resolved (just fill the parser-resolved rows without waiting for LLM)
