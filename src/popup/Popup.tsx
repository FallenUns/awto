import { useEffect, useState } from "react";
import { Check, Loader2, AlertCircle, FileX2, Braces, List } from "lucide-react";
import { StatusBar } from "./StatusBar";
import { WillFillSection } from "./WillFillSection";
import { NeedsInputSection } from "./NeedsInputSection";
import { SkippedSection } from "./SkippedSection";
import { Footer } from "./Footer";
import { useAwtoFlow } from "./useAwtoFlow";

const VIEW_STORAGE_KEY = "awto:popupView";
type PopupView = "raw" | "friendly";

function loadView(): PopupView {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === "friendly" ? "friendly" : "raw";
  } catch {
    return "raw";
  }
}

export function Popup() {
  const { state, status, setOverrideValue, setMissingValue, fill, retry, cancel } =
    useAwtoFlow();
  const [view, setView] = useState<PopupView>(loadView);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // ignore quota / disabled storage
    }
  }, [view]);

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
            <div className="awto-view-toggle" role="group" aria-label="View mode">
              <button
                type="button"
                className={`awto-view-toggle__btn ${view === "raw" ? "is-active" : ""}`}
                onClick={() => setView("raw")}
                aria-pressed={view === "raw"}
              >
                <Braces size={14} strokeWidth={1.5} aria-hidden="true" />
                <span>Raw output</span>
              </button>
              <button
                type="button"
                className={`awto-view-toggle__btn ${view === "friendly" ? "is-active" : ""}`}
                onClick={() => setView("friendly")}
                aria-pressed={view === "friendly"}
              >
                <List size={14} strokeWidth={1.5} aria-hidden="true" />
                <span>Friendly</span>
              </button>
            </div>

            {view === "raw" ? (
              <pre className="awto-raw" aria-label="Raw LLM output">
                {JSON.stringify(
                  {
                    fields: state.fields,
                    mappings: state.mappings,
                  },
                  null,
                  2
                )}
              </pre>
            ) : (
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
