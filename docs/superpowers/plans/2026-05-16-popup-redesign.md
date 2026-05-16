# Popup redesign — Implementation Plan

> **REQUIRED SUB-SKILL:** `superpowers:subagent-driven-development`. TDD per task.

**Goal:** Replace chat-style popup with a dense list + shimmer loading + sticky action bar. No service-worker changes; popup-only rewrite.

**Spec:** [docs/superpowers/specs/2026-05-16-popup-redesign-dense-list-design.md](../specs/2026-05-16-popup-redesign-dense-list-design.md)

---

## File plan

| Path | Status | Responsibility |
|---|---|---|
| `src/popup/Header.tsx` | **create** | 40px header with avatar + status pill + rescan |
| `src/popup/FieldRow.tsx` | **create** | One row: status icon + label + value/input |
| `src/popup/ActionBar.tsx` | **create** | Sticky bottom: Cancel + Fill |
| `src/popup/Popup.tsx` | rewrite | Coordinates state → renders Header + rows + ActionBar |
| `src/popup/useAwtoFlow.ts` | small extension | Add `loadingFields` so mapping state can render shimmer rows |
| `src/popup/types.ts` | small extension | Add `loadingFields: ScannedField[]` to FlowState |
| `src/popup/styles.css` | major edit | Drop chat/bubble rules; add shimmer + dense-row + new component rules |
| `src/popup/StatusBar.tsx` | delete (after Header replaces it) |
| `src/popup/Footer.tsx` | delete (after ActionBar replaces it) |
| `src/popup/Popup.test.tsx` | rewrite | Tests for new states |
| `src/popup/FieldRow.test.tsx` | **create** | Tests per row kind |

---

## Task 1: types + useAwtoFlow loadingFields

**Files:**
- Modify: `src/popup/types.ts`
- Modify: `src/popup/useAwtoFlow.ts`
- Modify: `src/popup/useAwtoFlow.test.ts`

### Steps

- [ ] **Step 1: Add `loadingFields: ScannedField[]` to FlowState**

In `src/popup/types.ts`, add the field. Update `INITIAL_FLOW_STATE` (or wherever the empty state is initialised) to include `loadingFields: []`.

- [ ] **Step 2: Populate loadingFields when scanForm returns**

In `src/popup/useAwtoFlow.ts`, find where `scanFormResult` is received. After getting `fields`, also set `state.loadingFields = fields`. Reset to `[]` on rescan / done.

- [ ] **Step 3: Add test**

```ts
it("populates loadingFields when scanForm returns fields", async () => {
  // mount hook
  // assert state.loadingFields has the scanned fields after scan
  // assert state.loadingFields is cleared after mapFieldsComplete
});
```

- [ ] **Step 4: Run + commit**

```
npm run test
npm run typecheck
git add src/popup/types.ts src/popup/useAwtoFlow.ts src/popup/useAwtoFlow.test.ts
git commit -m "feat(popup): track loadingFields so shimmer rows can render pre-LLM"
```

---

## Task 2: `<FieldRow>` component

**Files:**
- Create: `src/popup/FieldRow.tsx`
- Create: `src/popup/FieldRow.test.tsx`

### Steps

- [ ] **Step 1: Failing tests**

`src/popup/FieldRow.test.tsx`:

```ts
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FieldRow } from "./FieldRow";

describe("FieldRow", () => {
  it("renders a fill row with status check icon and the resolved value", () => {
    render(
      <FieldRow
        kind="fill"
        fieldId={0}
        label="First name"
        value="Patrick"
        confidence={0.95}
      />
    );
    expect(screen.getByText("First name")).toBeTruthy();
    expect(screen.getByText("Patrick")).toBeTruthy();
    expect(document.querySelector(".awto-fieldrow--fill")).toBeTruthy();
  });

  it("renders a missing row with an input bound to onChangeValue", () => {
    const onChange = vi.fn();
    render(
      <FieldRow
        kind="missing"
        fieldId={1}
        label="Phone"
        value=""
        promptText="What's your phone?"
        onChangeValue={onChange}
      />
    );
    const input = screen.getByPlaceholderText(/phone/i);
    fireEvent.change(input, { target: { value: "0400" } });
    expect(onChange).toHaveBeenCalledWith("0400");
  });

  it("renders a skip row with reason in muted text", () => {
    render(
      <FieldRow
        kind="skip"
        fieldId={2}
        label="CAPTCHA"
        reason="Not safe to autofill"
      />
    );
    expect(screen.getByText(/not safe to autofill/i)).toBeTruthy();
  });

  it("renders a loading row with shimmer placeholder", () => {
    render(<FieldRow kind="loading" fieldId={3} label="Loading…" />);
    expect(document.querySelector(".awto-shimmer")).toBeTruthy();
  });

  it("shows the amber confidence dot when confidence < 0.85", () => {
    render(
      <FieldRow
        kind="fill"
        fieldId={0}
        label="Title"
        value="Mr"
        confidence={0.6}
      />
    );
    expect(document.querySelector(".awto-confidence-dot")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, verify fail**

`npm run test -- src/popup/FieldRow.test.tsx`

- [ ] **Step 3: Implement `FieldRow.tsx`**

```tsx
import { Check, HelpCircle, Minus, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export type FieldRowKind = "fill" | "missing" | "skip" | "loading";

interface FieldRowProps {
  kind: FieldRowKind;
  fieldId: number;
  label: string;
  value?: string;
  promptText?: string;
  reason?: string;
  confidence?: number;
  onChangeValue?: (value: string) => void;
}

export function FieldRow({
  kind,
  fieldId,
  label,
  value = "",
  promptText,
  reason,
  confidence,
  onChangeValue,
}: FieldRowProps) {
  const inputId = `field-${fieldId}`;
  const lowConfidence = kind === "fill" && confidence !== undefined && confidence < 0.85;

  return (
    <div className={`awto-fieldrow awto-fieldrow--${kind}`}>
      <span className="awto-fieldrow__icon" aria-hidden="true">
        {iconFor(kind)}
      </span>
      <label htmlFor={inputId} className="awto-fieldrow__label">
        {lowConfidence && (
          <span
            className="awto-confidence-dot"
            title="Low confidence — verify this value"
            aria-label="Low confidence"
          />
        )}
        {label}
      </label>
      <div className="awto-fieldrow__value">{renderValue(kind, value, promptText, reason, inputId, onChangeValue)}</div>
    </div>
  );
}

function iconFor(kind: FieldRowKind): ReactNode {
  if (kind === "fill") {
    return <Check size={16} strokeWidth={2} className="awto-fieldrow__icon--fill" />;
  }
  if (kind === "missing") {
    return <HelpCircle size={16} strokeWidth={1.5} className="awto-fieldrow__icon--missing" />;
  }
  if (kind === "skip") {
    return <Minus size={16} strokeWidth={1.5} className="awto-fieldrow__icon--skip" />;
  }
  return <Loader2 size={16} strokeWidth={1.5} className="awto-fieldrow__icon--loading awto-spin" />;
}

function renderValue(
  kind: FieldRowKind,
  value: string,
  promptText: string | undefined,
  reason: string | undefined,
  inputId: string,
  onChangeValue: ((value: string) => void) | undefined
): ReactNode {
  if (kind === "loading") {
    return <div className="awto-shimmer" />;
  }
  if (kind === "skip") {
    return <span className="awto-fieldrow__skip-reason">{reason ?? "skipped"}</span>;
  }
  if (kind === "missing") {
    return (
      <input
        id={inputId}
        type="text"
        className="awto-fieldrow__input"
        value={value}
        onChange={(e) => onChangeValue?.(e.target.value)}
        placeholder={promptText ?? "Type a value…"}
        aria-label={promptText}
      />
    );
  }
  // fill
  return value ? (
    <span className="awto-fieldrow__value-text">{value}</span>
  ) : (
    <span className="awto-fieldrow__value-text awto-muted">empty</span>
  );
}
```

- [ ] **Step 4: Run + commit**

```
npm run test
npm run typecheck
git add src/popup/FieldRow.tsx src/popup/FieldRow.test.tsx
git commit -m "feat(popup): FieldRow component (fill/missing/skip/loading)"
```

---

## Task 3: `<Header>` + `<ActionBar>` components

**Files:**
- Create: `src/popup/Header.tsx`
- Create: `src/popup/ActionBar.tsx`

### Steps

- [ ] **Step 1: Header.tsx**

```tsx
import { RefreshCw } from "lucide-react";
import type { FlowStatus } from "./types";

interface HeaderProps {
  status: FlowStatus;
  readyCount?: number;
  missingCount?: number;
  skipCount?: number;
  chunksDone?: number;
  chunksTotal?: number;
  filledCount?: number;
  onRescan?: () => void;
}

export function Header({
  status,
  readyCount = 0,
  missingCount = 0,
  skipCount = 0,
  chunksDone,
  chunksTotal,
  filledCount,
  onRescan,
}: HeaderProps) {
  return (
    <header className="awto-header">
      <div className="awto-header__brand">
        <span className="awto-header__avatar" aria-hidden="true">A</span>
        <span className="awto-header__name">Awto</span>
      </div>
      <span className="awto-header__pill">{pillFor(status, { readyCount, missingCount, skipCount, chunksDone, chunksTotal, filledCount })}</span>
      {onRescan && (status === "ready" || status === "error" || status === "done") && (
        <button
          type="button"
          className="awto-header__rescan"
          onClick={onRescan}
          aria-label="Rescan this form"
          title="Rescan this form"
        >
          <RefreshCw size={14} strokeWidth={1.5} />
        </button>
      )}
    </header>
  );
}

function pillFor(status: FlowStatus, counts: { readyCount: number; missingCount: number; skipCount: number; chunksDone?: number; chunksTotal?: number; filledCount?: number }): string {
  if (status === "scanning") return "Reading the form…";
  if (status === "mapping") {
    if (counts.chunksTotal && counts.chunksDone !== undefined) return `Mapping ${counts.chunksDone}/${counts.chunksTotal}`;
    return "Mapping…";
  }
  if (status === "ready") {
    const parts: string[] = [];
    if (counts.readyCount > 0) parts.push(`${counts.readyCount} ready`);
    if (counts.missingCount > 0) parts.push(`${counts.missingCount} ask`);
    if (counts.skipCount > 0) parts.push(`${counts.skipCount} skip`);
    return parts.length > 0 ? parts.join(" · ") : "Nothing to fill";
  }
  if (status === "filling") return "Filling…";
  if (status === "done") return counts.filledCount !== undefined ? `Filled ${counts.filledCount}` : "Done";
  if (status === "error") return "Error";
  if (status === "no-form") return "No form here";
  return "";
}
```

- [ ] **Step 2: ActionBar.tsx**

```tsx
import { Loader2 } from "lucide-react";

interface ActionBarProps {
  filling: boolean;
  fillDisabled: boolean;
  fillCount: number;
  onCancel: () => void;
  onFill: () => void;
}

export function ActionBar({ filling, fillDisabled, fillCount, onCancel, onFill }: ActionBarProps) {
  return (
    <footer className="awto-actionbar">
      <button
        type="button"
        className="awto-actionbar__cancel"
        onClick={onCancel}
        disabled={filling}
      >
        Cancel
      </button>
      <button
        type="button"
        className="awto-actionbar__fill"
        onClick={onFill}
        disabled={fillDisabled || filling}
      >
        {filling ? (
          <>
            <Loader2 size={16} strokeWidth={2} className="awto-spin" aria-hidden="true" />
            <span>Filling…</span>
          </>
        ) : (
          <span>Fill {fillCount} field{fillCount === 1 ? "" : "s"}</span>
        )}
      </button>
    </footer>
  );
}
```

- [ ] **Step 3: Add smoke tests for both**

In `src/popup/Header.test.tsx` and `src/popup/ActionBar.test.tsx`, verify:
- Header renders status pill text per status
- Header shows rescan button only in ready/error/done
- ActionBar Fill button disabled when fillDisabled or filling
- ActionBar shows "Filling…" with spinner during filling

- [ ] **Step 4: Run + commit**

```
npm run test
npm run typecheck
git add src/popup/Header.tsx src/popup/Header.test.tsx src/popup/ActionBar.tsx src/popup/ActionBar.test.tsx
git commit -m "feat(popup): Header + ActionBar components (replaces StatusBar/Footer)"
```

---

## Task 4: Rewrite Popup.tsx + styles + delete old components

**Files:**
- Rewrite: `src/popup/Popup.tsx`
- Major edit: `src/popup/styles.css`
- Delete: `src/popup/StatusBar.tsx`, `src/popup/Footer.tsx`
- Update: `src/popup/Popup.test.tsx`

### Steps

- [ ] **Step 1: Rewrite Popup.tsx**

```tsx
import { useEffect, useRef } from "react";
import { Check, AlertCircle, FileX2 } from "lucide-react";
import { Header } from "./Header";
import { FieldRow } from "./FieldRow";
import { ActionBar } from "./ActionBar";
import { useAwtoFlow } from "./useAwtoFlow";
import type { FieldRowKind } from "./FieldRow";

export function Popup() {
  const { state, status, setMissingValue, fill, retry, cancel, rescan } = useAwtoFlow();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [status]);

  const fillCount = state.fillRows.length;
  const missingCount = state.missingRows.length;
  const skipCount = state.skippedRows.length;
  const answeredMissing = state.missingRows.filter((r) => r.userValue.trim() !== "").length;
  const totalToFill = fillCount + answeredMissing;
  const fillDisabled =
    fillCount === 0 && state.missingRows.every((r) => r.userValue.trim() === "");

  return (
    <div className="awto-popup">
      <Header
        status={status}
        readyCount={fillCount}
        missingCount={missingCount}
        skipCount={skipCount}
        chunksDone={state.chunksCompleted}
        filledCount={state.filledCount}
        onRescan={rescan}
      />

      <main className="awto-list" ref={listRef}>
        {status === "scanning" && (
          <FieldRow kind="loading" fieldId={-1} label="Scanning the form…" />
        )}

        {status === "mapping" &&
          state.loadingFields.map((f) => (
            <FieldRow key={f.id} kind="loading" fieldId={f.id} label={f.label || `Field ${f.id}`} />
          ))}

        {(status === "ready" || status === "filling") && (
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

        {status === "no-form" && (
          <div className="awto-center" role="status">
            <FileX2 size={32} strokeWidth={1.5} aria-hidden="true" />
            <p className="awto-center__text awto-center__text--strong">No form on this page</p>
            <p className="awto-center__text awto-muted">
              Awto activates when there's something to fill.
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="awto-error" role="alert">
            <div className="awto-error__icon">
              <AlertCircle size={20} strokeWidth={1.5} aria-hidden="true" />
            </div>
            <p className="awto-error__title">Something went wrong</p>
            <p className="awto-error__message">{state.error ?? "Unknown error"}</p>
            <button type="button" className="awto-btn awto-btn--secondary" onClick={retry}>
              Try again
            </button>
          </div>
        )}

        {status === "done" && (
          <div className="awto-center awto-center--success" role="status" aria-live="polite">
            <div className="awto-done__icon">
              <Check size={28} strokeWidth={2} aria-hidden="true" />
            </div>
            <p className="awto-center__text awto-center__text--strong">
              Filled {state.filledCount} field{state.filledCount === 1 ? "" : "s"}
            </p>
            {state.failedFills.length > 0 && (
              <p className="awto-center__text awto-muted awto-done__failed">
                Couldn't fill {state.failedFills.length}:{" "}
                {state.failedFills.map((f) => f.label).join(", ")}
              </p>
            )}
          </div>
        )}
      </main>

      {(status === "ready" || status === "filling") && (
        <ActionBar
          filling={status === "filling"}
          fillDisabled={fillDisabled}
          fillCount={totalToFill}
          onCancel={cancel}
          onFill={() => void fill()}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Major styles.css edit**

Remove rules under these selectors entirely (no longer used):
- `.awto-statusbar*`, `.awto-bubble*`, `.awto-chat*`, `.awto-typing*`, `.awto-fill-list*`, `.awto-qa*`, `.awto-footer` (replaced by `.awto-actionbar`)

Add new rules:

```css
.awto-popup {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.awto-header {
  height: 40px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background);
}

.awto-header__brand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.awto-header__avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--color-accent);
  color: var(--color-background);
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.awto-header__name {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: -0.01em;
}

.awto-header__pill {
  flex: 1;
  font-size: 11px;
  color: var(--color-foreground);
  opacity: 0.7;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.awto-header__rescan {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  border: 0;
  background: transparent;
  color: var(--color-foreground);
  opacity: 0.65;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: opacity 150ms ease-out, background 150ms ease-out;
}

.awto-header__rescan:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.05);
}

.awto-header__rescan:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.awto-list {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.awto-fieldrow {
  display: grid;
  grid-template-columns: 20px 1fr minmax(0, 1.4fr);
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: background 150ms ease-out;
}

.awto-fieldrow:hover {
  background: rgba(255, 255, 255, 0.03);
}

.awto-fieldrow__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
}

.awto-fieldrow__icon--fill { color: var(--color-accent); }
.awto-fieldrow__icon--missing { color: #F59E0B; }
.awto-fieldrow__icon--skip { color: var(--color-foreground); opacity: 0.4; }
.awto-fieldrow__icon--loading { color: var(--color-foreground); opacity: 0.5; }

.awto-fieldrow__label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-foreground);
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
}

.awto-fieldrow__value {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
}

.awto-fieldrow__value-text {
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  word-break: break-word;
  max-width: 100%;
}

.awto-fieldrow__input {
  width: 100%;
  font-size: 13px;
  background: var(--color-muted);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 6px 8px;
  color: var(--color-foreground);
  min-height: 32px;
  transition: border-color 150ms ease-out;
}

.awto-fieldrow__input:focus {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
  border-color: var(--color-accent);
}

.awto-fieldrow__skip-reason {
  font-size: 11px;
  font-style: italic;
  color: var(--color-foreground);
  opacity: 0.55;
  text-align: right;
}

.awto-shimmer {
  display: inline-block;
  width: 60%;
  height: 14px;
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

.awto-actionbar {
  height: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  border-top: 1px solid var(--color-border);
  background: var(--color-background);
}

.awto-actionbar__cancel {
  height: 44px;
  padding: 0 12px;
  border: 0;
  background: transparent;
  color: var(--color-foreground);
  opacity: 0.7;
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--radius-control);
  transition: opacity 150ms ease-out, background 150ms ease-out;
}

.awto-actionbar__cancel:hover:not(:disabled) {
  opacity: 1;
  background: rgba(255, 255, 255, 0.04);
}

.awto-actionbar__cancel:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.awto-actionbar__fill {
  flex: 1;
  height: 44px;
  border: 0;
  border-radius: var(--radius-control);
  background: var(--color-accent);
  color: var(--color-background);
  font-size: 14px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  cursor: pointer;
  transition: background 150ms ease-out, transform 100ms ease-out, opacity 150ms ease-out;
}

.awto-actionbar__fill:hover:not(:disabled) {
  background: #16a34a;
}

.awto-actionbar__fill:active:not(:disabled) {
  transform: scale(0.97);
}

.awto-actionbar__fill:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
  .awto-shimmer,
  .awto-spin {
    animation: none;
  }
  .awto-fieldrow,
  .awto-header__rescan,
  .awto-actionbar__cancel,
  .awto-actionbar__fill {
    transition: none;
  }
  .awto-actionbar__fill:active {
    transform: none;
  }
}
```

Make sure existing keyframes `.awto-spin` and rule are still there (used by Loader2 in ActionBar). They should be — keep them.

Keep existing `.awto-center*`, `.awto-error*`, `.awto-done*`, `.awto-muted`, `.awto-confidence-dot`, `.awto-btn*` rules as the done/error/no-form states still use them.

- [ ] **Step 3: Delete StatusBar.tsx + Footer.tsx**

```bash
rm src/popup/StatusBar.tsx src/popup/Footer.tsx
```

If any test file imports these, update or remove.

- [ ] **Step 4: Update Popup.test.tsx**

Replace existing chat-based assertions with new dense-list assertions:
- `mapping` state renders one `.awto-fieldrow--loading` per scanned field
- `ready` state renders fill rows + missing rows + skip rows
- ActionBar is present in `ready` state and shows correct fill count
- Header shows status pill with correct counts

Existing `Popup.test.tsx` smoke test for `no-form` should still pass.

- [ ] **Step 5: Run + typecheck + build**

```
npm run test
npm run typecheck
npm run build
```

Expected: all pass. Test count grows by ~10 (FieldRow 5 + Header 2 + ActionBar 2 + Popup updates).

- [ ] **Step 6: Commit**

```bash
git add src/popup/Popup.tsx src/popup/Popup.test.tsx src/popup/styles.css
git rm src/popup/StatusBar.tsx src/popup/Footer.tsx
git commit -m "feat(popup): dense list redesign — kill chat bubbles, shimmer rows + sticky action bar"
```

---

## Acceptance

- [ ] No bubble/chat affordances anywhere in popup UI
- [ ] Header shows compact status pill: `6 ready · 3 ask · 1 skip` in ready, `Mapping 3/6` while loading
- [ ] Mapping state renders shimmer rows immediately (one per scanned field)
- [ ] Each chunk resolves rows in place without layout shift
- [ ] Sticky bottom Cancel + Fill always visible in ready/filling
- [ ] Rescan icon in header (ready/error/done only)
- [ ] Confidence dot still appears on low-confidence rows
- [ ] All previously passing popup tests pass after rewrite
- [ ] `npm run typecheck && npm run test && npm run build` green
