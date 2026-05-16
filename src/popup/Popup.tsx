import { useEffect, useRef } from "react";
import { Check, AlertCircle, FileX2 } from "lucide-react";
import { Header } from "./Header";
import { FieldRow } from "./FieldRow";
import { ActionBar } from "./ActionBar";
import { useAwtoFlow } from "./useAwtoFlow";

export function formatFailureReason(reason: string): string {
  switch (reason) {
    case "no matching option":
      return "The form's dropdown did not have a matching option.";
    case "selector not found":
      return "The field was no longer on the page when we tried to fill it.";
    case "invalid selector":
      return "The field's selector could not be parsed.";
    case "unsupported element":
      return "The field type isn't something we can fill automatically.";
    default:
      return reason;
  }
}

export function Popup() {
  const { state, status, setMissingValue, fill, retry, cancel, rescan } =
    useAwtoFlow();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [status]);

  const fillCount = state.fillRows.length;
  const missingCount = state.missingRows.length;
  const skipCount = state.skippedRows.length;
  const answeredMissing = state.missingRows.filter(
    (r) => r.userValue.trim() !== ""
  ).length;
  const totalToFill = fillCount + answeredMissing;
  const fillDisabled =
    fillCount === 0 &&
    state.missingRows.every((r) => r.userValue.trim() === "");

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
            <FieldRow
              key={f.id}
              kind="loading"
              fieldId={f.id}
              label={f.label || `Field ${f.id}`}
            />
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
            <p className="awto-center__text awto-center__text--strong">
              No form on this page
            </p>
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
            <p className="awto-error__message">
              {state.error ?? "Unknown error"}
            </p>
            <button
              type="button"
              className="awto-btn awto-btn--secondary"
              onClick={retry}
            >
              Try again
            </button>
          </div>
        )}

        {status === "done" && (
          <div
            className="awto-center awto-center--success"
            role="status"
            aria-live="polite"
          >
            <div className="awto-done__icon">
              <Check size={28} strokeWidth={2} aria-hidden="true" />
            </div>
            <p className="awto-center__text awto-center__text--strong">
              Filled {state.filledCount} field
              {state.filledCount === 1 ? "" : "s"}
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
