import { Check, Loader2, AlertCircle, FileX2 } from "lucide-react";
import { StatusBar } from "./StatusBar";
import { WillFillSection } from "./WillFillSection";
import { NeedsInputSection } from "./NeedsInputSection";
import { SkippedSection } from "./SkippedSection";
import { Footer } from "./Footer";
import { useAwtoFlow } from "./useAwtoFlow";

export function Popup() {
  const { state, status, setOverrideValue, setMissingValue, fill, retry, cancel } =
    useAwtoFlow();

  return (
    <div className="awto-popup">
      <StatusBar status={status} />
      <main className="awto-main">
        {(status === "scanning" || status === "mapping") && (
          <div className="awto-center" role="status" aria-live="polite">
            <Loader2
              size={24}
              className="awto-spin"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <p className="awto-center__text">
              {status === "scanning" ? "Scanning form…" : "Mapping fields…"}
            </p>
          </div>
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
          <div className="awto-center awto-center--success" role="status" aria-live="polite">
            <div className="awto-done__icon">
              <Check size={28} strokeWidth={2} aria-hidden="true" />
            </div>
            <p className="awto-center__text awto-center__text--strong">
              Filled {state.filledCount} field{state.filledCount === 1 ? "" : "s"}
            </p>
          </div>
        )}

        {(status === "ready" || status === "filling") && (
          <>
            <WillFillSection
              rows={state.fillRows}
              onOverride={setOverrideValue}
            />
            <NeedsInputSection
              rows={state.missingRows}
              onChange={setMissingValue}
            />
            <SkippedSection rows={state.skippedRows} />
          </>
        )}
      </main>
      {(status === "ready" || status === "filling") && (
        <Footer
          filling={status === "filling"}
          fillDisabled={state.fillRows.length === 0 && state.missingRows.every((r) => r.userValue.trim() === "")}
          fillCount={
            state.fillRows.filter((r) => r.resolvedValue !== "").length +
            state.missingRows.filter((r) => r.userValue.trim() !== "").length
          }
          onCancel={cancel}
          onFill={() => void fill()}
        />
      )}
    </div>
  );
}
