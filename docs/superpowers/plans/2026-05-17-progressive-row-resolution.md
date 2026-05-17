# Progressive row resolution — Implementation Plan

> **For agentic workers:** small single-file refactor. TDD per step.

**Goal:** During `mapping`, render rule-resolved rows immediately as ✓ in form order while LLM-pending rows shimmer alongside. No service-worker / prompt / hook changes — purely a Popup.tsx render refactor.

**Spec:** [docs/superpowers/specs/2026-05-17-progressive-row-resolution-design.md](../specs/2026-05-17-progressive-row-resolution-design.md)

---

## Task 1: Refactor Popup.tsx to merge resolved + shimmer rows

**Files:**
- Modify: `src/popup/Popup.tsx`
- Modify: `src/popup/Popup.test.tsx`

### Step 1: Write failing tests

Append to `src/popup/Popup.test.tsx`. Add a `vi.mock("./useAwtoFlow", ...)` pattern (similar to the existing confidence-dot test):

```ts
import type { FlowState, FlowStatus } from "./types";

function mockFlow(overrides: { status: FlowStatus; state: Partial<FlowState> }) {
  vi.doMock("./useAwtoFlow", () => ({
    useAwtoFlow: () => ({
      status: overrides.status,
      state: {
        error: null,
        fields: [],
        mappings: [],
        fillRows: [],
        missingRows: [],
        skippedRows: [],
        filledCount: 0,
        failedFills: [],
        chunksCompleted: 0,
        loadingFields: [],
        ...overrides.state,
      } as FlowState,
      setMissingValue: vi.fn(),
      fill: vi.fn(),
      retry: vi.fn(),
      cancel: vi.fn(),
      rescan: vi.fn(),
    }),
  }));
}

describe("Popup progressive row resolution", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("renders resolved fill rows in their fieldId slot during mapping; remaining rows shimmer", async () => {
    mockFlow({
      status: "mapping",
      state: {
        loadingFields: [
          { id: 0, selector: "#a", label: "First name", placeholder: null, type: "text", required: false },
          { id: 1, selector: "#b", label: "Email", placeholder: null, type: "email", required: false },
          { id: 2, selector: "#c", label: "Mystery", placeholder: null, type: "text", required: false },
        ],
        fillRows: [
          { fieldId: 0, selector: "#a", label: "First name", profileKey: "firstName", resolvedValue: "Patrick", confidence: 1 },
          { fieldId: 1, selector: "#b", label: "Email", profileKey: "email", resolvedValue: "p@x.com", confidence: 1 },
        ],
      },
    });
    const { Popup } = await import("./Popup");
    const { render, screen } = await import("@testing-library/react");
    render(<Popup />);
    expect(screen.getByText("Patrick")).toBeTruthy();
    expect(screen.getByText("p@x.com")).toBeTruthy();
    // The third (Mystery) row should still be shimmer
    expect(document.querySelectorAll(".awto-shimmer")).toHaveLength(1);
    // 3 total field rows
    expect(document.querySelectorAll(".awto-fieldrow")).toHaveLength(3);
  });

  it("renders ActionBar with Fill disabled during mapping", async () => {
    mockFlow({
      status: "mapping",
      state: {
        loadingFields: [
          { id: 0, selector: "#a", label: "First name", placeholder: null, type: "text", required: false },
        ],
        fillRows: [
          { fieldId: 0, selector: "#a", label: "First name", profileKey: "firstName", resolvedValue: "Patrick", confidence: 1 },
        ],
      },
    });
    const { Popup } = await import("./Popup");
    const { render, screen } = await import("@testing-library/react");
    render(<Popup />);
    const fillBtn = screen.getByRole("button", { name: /mapping|fill/i });
    expect((fillBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("ActionBar Fill is enabled in ready state when there's at least one fillable row", async () => {
    mockFlow({
      status: "ready",
      state: {
        loadingFields: [
          { id: 0, selector: "#a", label: "First name", placeholder: null, type: "text", required: false },
        ],
        fillRows: [
          { fieldId: 0, selector: "#a", label: "First name", profileKey: "firstName", resolvedValue: "Patrick", confidence: 1 },
        ],
      },
    });
    const { Popup } = await import("./Popup");
    const { render, screen } = await import("@testing-library/react");
    render(<Popup />);
    const fillBtn = screen.getByRole("button", { name: /fill 1 field/i });
    expect((fillBtn as HTMLButtonElement).disabled).toBe(false);
  });
});
```

### Step 2: Run tests, verify failure

```
npm run test -- src/popup/Popup.test.tsx
```

Expected: 3 new tests fail because:
- mapping state currently shows only shimmer rows (no fill rendering)
- ActionBar is hidden during mapping (current code only renders in ready/filling)

### Step 3: Refactor Popup.tsx

In `src/popup/Popup.tsx`, replace the existing render branches for `mapping`, `ready`, `filling` with a single unified path:

```tsx
const isMappingOrReady =
  status === "mapping" || status === "ready" || status === "filling";

// inside <main>:
{status === "scanning" && (
  <FieldRow kind="loading" fieldId={-1} label="Scanning the form…" />
)}

{isMappingOrReady && state.loadingFields.length > 0 &&
  state.loadingFields.map((f) => {
    const fill = state.fillRows.find((r) => r.fieldId === f.id);
    if (fill) {
      return (
        <FieldRow
          key={`fill-${f.id}`}
          kind="fill"
          fieldId={f.id}
          label={fill.label}
          value={fill.resolvedValue}
          confidence={fill.confidence}
        />
      );
    }
    const missing = state.missingRows.find((r) => r.fieldId === f.id);
    if (missing) {
      return (
        <FieldRow
          key={`missing-${f.id}`}
          kind="missing"
          fieldId={f.id}
          label={missing.label}
          value={missing.userValue}
          promptText={missing.promptText}
          onChangeValue={(v) => setMissingValue(f.id, v)}
        />
      );
    }
    const skip = state.skippedRows.find((r) => r.fieldId === f.id);
    if (skip) {
      return (
        <FieldRow
          key={`skip-${f.id}`}
          kind="skip"
          fieldId={f.id}
          label={skip.label}
          reason={skip.reason}
        />
      );
    }
    return (
      <FieldRow
        key={`loading-${f.id}`}
        kind="loading"
        fieldId={f.id}
        label={f.label || `Field ${f.id}`}
      />
    );
  })}

{/* Fallback when loadingFields is empty (cache hit fast path): render flat lists */}
{isMappingOrReady && state.loadingFields.length === 0 && (
  <>
    {state.fillRows.map((r) => (
      <FieldRow
        key={`fill-${r.fieldId}`}
        kind="fill"
        fieldId={r.fieldId}
        label={r.label}
        value={r.resolvedValue}
        confidence={r.confidence}
      />
    ))}
    {state.missingRows.map((r) => (
      <FieldRow
        key={`missing-${r.fieldId}`}
        kind="missing"
        fieldId={r.fieldId}
        label={r.label}
        value={r.userValue}
        promptText={r.promptText}
        onChangeValue={(v) => setMissingValue(r.fieldId, v)}
      />
    ))}
    {state.skippedRows.map((r) => (
      <FieldRow
        key={`skip-${r.fieldId}`}
        kind="skip"
        fieldId={r.fieldId}
        label={r.label}
        reason={r.reason}
      />
    ))}
  </>
)}
```

Update the ActionBar gate:

```tsx
{isMappingOrReady && (
  <ActionBar
    filling={status === "filling"}
    fillDisabled={status !== "ready" || fillDisabled}
    fillCount={totalToFill}
    onCancel={cancel}
    onFill={() => void fill()}
  />
)}
```

And update the ActionBar component (if needed) to show "Mapping…" label when `fillDisabled` is true AND not `filling` — actually simpler: when `status === "mapping"` we want the button to say "Mapping…" instead of "Fill 0 fields". One approach: add an optional `label` prop to ActionBar. Cleaner: derive a label in Popup and pass via a new prop, OR keep "Fill N fields" but disabled.

For minimal change: just leave the existing "Fill N fields" copy; it'll say "Fill 0 fields" when disabled which is acceptable. If the test expects "/mapping|fill/i" match it'll find either. Take the simpler path.

If preserving the "Mapping…" copy is preferred, add a `mapping?: boolean` prop to ActionBar; when true, show "Mapping…" with spinner + disabled. Adjust `ActionBar.test.tsx` accordingly.

Pick the cleaner path during implementation — both satisfy the tests above (since the test uses `/mapping|fill/i` regex).

### Step 4: Run tests + typecheck + build

```
npm run test
npm run typecheck
npm run build
```

Expected: all pass. Test count grows by 3.

### Step 5: Commit

```bash
git add src/popup/Popup.tsx src/popup/Popup.test.tsx
# also include ActionBar.tsx + test if you added the mapping prop
git commit -m "feat(popup): progressive row resolution — rule rows show as ✓ during mapping

During mapping state, render each loadingField as either a resolved row
(if a fill/missing/skip mapping exists for that fieldId) or a shimmer
row. Form order preserved. ActionBar visible throughout but Fill is
disabled until status reaches ready.

The user sees rule-resolved rows turn green within ~50ms of opening
the popup instead of waiting for the LLM chunks to all complete.

No service-worker or prompt changes — purely a render refactor."
```

---

## Acceptance

- [ ] During `mapping`, resolved rows render in their fieldId slot in form order
- [ ] LLM-pending rows render as shimmer in the same list, interleaved by position
- [ ] ActionBar visible during `mapping` with Fill disabled
- [ ] ActionBar Fill enabled in `ready` when at least one fillable row exists
- [ ] Cache-hit fast path still works (loadingFields empty → flat render fallback)
- [ ] All previously passing tests pass; +3 new render tests
- [ ] `npm run typecheck && npm run test && npm run build` green
