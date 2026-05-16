import { useEffect, useRef } from "react";
import { Check, AlertCircle, FileX2, Sparkles, BookmarkPlus } from "lucide-react";
import { StatusBar } from "./StatusBar";
import { Footer } from "./Footer";
import { useAwtoFlow } from "./useAwtoFlow";

export function Popup() {
  const { state, status, setMissingValue, fill, retry, cancel } = useAwtoFlow();
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [state.missingRows, status]);

  const fillCount = state.fillRows.length;
  const missingCount = state.missingRows.length;
  const skippedCount = state.skippedRows.length;
  const answeredMissing = state.missingRows.filter(
    (r) => r.userValue.trim() !== ""
  ).length;

  const fillDisabled =
    fillCount === 0 && state.missingRows.every((r) => r.userValue.trim() === "");
  const totalToFill = fillCount + answeredMissing;

  return (
    <div className="awto-popup">
      <StatusBar status={status} />

      <main className="awto-main" ref={feedRef}>
        {(status === "scanning" || status === "mapping") && (
          <div className="awto-chat" role="status" aria-live="polite">
            <Bubble role="assistant">
              <span className="awto-typing" aria-label="Awto is thinking">
                <span className="awto-typing__dot" />
                <span className="awto-typing__dot" />
                <span className="awto-typing__dot" />
              </span>
              <span className="awto-bubble__text awto-muted">
                {status === "scanning"
                  ? "Reading the form…"
                  : "Working out what to fill…"}
              </span>
            </Bubble>
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
            {state.failedFills.length > 0 && (
              <p className="awto-center__text awto-muted awto-done__failed">
                Couldn't fill {state.failedFills.length} field
                {state.failedFills.length === 1 ? "" : "s"}:{" "}
                {state.failedFills.map((f) => f.label).join(", ")}
              </p>
            )}
          </div>
        )}

        {(status === "ready" || status === "filling") && (
          <div className="awto-chat" aria-live="polite">
            <Bubble role="assistant">
              <span className="awto-bubble__text">
                <Sparkles size={14} strokeWidth={1.5} className="awto-bubble__icon" aria-hidden="true" />
                Hi! I had a look at this form.
              </span>
            </Bubble>

            {fillCount > 0 && (
              <Bubble role="assistant">
                <span className="awto-bubble__text">
                  I can fill <strong>{fillCount}</strong> field{fillCount === 1 ? "" : "s"} from your profile:
                </span>
                <ul className="awto-fill-list">
                  {state.fillRows.map((row) => (
                    <li key={row.fieldId} className="awto-fill-list__item">
                      <span className="awto-fill-list__label">{row.label}</span>
                      <span className="awto-fill-list__value">
                        {row.resolvedValue || <em className="awto-muted">empty</em>}
                      </span>
                    </li>
                  ))}
                </ul>
              </Bubble>
            )}

            {fillCount === 0 && missingCount === 0 && (
              <Bubble role="assistant">
                <span className="awto-bubble__text">
                  Nothing I can fill automatically here.
                </span>
              </Bubble>
            )}

            {missingCount > 0 && (
              <>
                <Bubble role="assistant">
                  <span className="awto-bubble__text">
                    {fillCount > 0 ? "But I'm missing " : "I need "}
                    <strong>{missingCount}</strong> thing{missingCount === 1 ? "" : "s"}.
                    Want to fill them?
                  </span>
                  <span className="awto-bubble__hint">
                    <BookmarkPlus size={12} strokeWidth={1.5} aria-hidden="true" />
                    I'll save your answers to your profile for next time.
                  </span>
                </Bubble>

                {state.missingRows.map((row) => {
                  const inputId = `missing-${row.fieldId}`;
                  const helperId = `missing-${row.fieldId}-helper`;
                  const answered = row.userValue.trim() !== "";
                  return (
                    <div key={row.fieldId} className="awto-qa">
                      <Bubble role="assistant" compact>
                        <span className="awto-bubble__text awto-bubble__text--question">
                          {row.promptText || `What's your ${row.label}?`}
                        </span>
                      </Bubble>
                      <div className="awto-qa__input">
                        <label htmlFor={inputId} className="awto-qa__label">
                          {row.label}
                        </label>
                        <input
                          id={inputId}
                          type="text"
                          className="awto-input"
                          value={row.userValue}
                          onChange={(e) =>
                            setMissingValue(row.fieldId, e.target.value)
                          }
                          aria-describedby={helperId}
                        />
                        <p
                          id={helperId}
                          className={`awto-qa__helper ${answered ? "is-answered" : ""}`}
                          aria-live="polite"
                        >
                          {answered ? (
                            <>
                              <Check size={12} strokeWidth={2} aria-hidden="true" />
                              Saved to your profile as "{row.suggestedKey}"
                            </>
                          ) : (
                            <span className="awto-muted">
                              Will be saved as "{row.suggestedKey}"
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {skippedCount > 0 && (
              <Bubble role="system">
                <span className="awto-bubble__text awto-muted">
                  Skipped {skippedCount} field{skippedCount === 1 ? "" : "s"} I couldn't map.
                </span>
              </Bubble>
            )}

            {(fillCount > 0 || missingCount > 0) && (
              <Bubble role="assistant">
                <span className="awto-bubble__text">
                  {missingCount > 0 && answeredMissing < missingCount
                    ? `Fill in the ${missingCount - answeredMissing} above, then tap Fill.`
                    : `Ready when you are — tap Fill to drop ${totalToFill} value${totalToFill === 1 ? "" : "s"} into the form.`}
                </span>
              </Bubble>
            )}
          </div>
        )}
      </main>

      {(status === "ready" || status === "filling") && (
        <Footer
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

interface BubbleProps {
  role: "assistant" | "user" | "system";
  compact?: boolean;
  children: React.ReactNode;
}

function Bubble({ role, compact, children }: BubbleProps) {
  return (
    <div className={`awto-bubble awto-bubble--${role} ${compact ? "is-compact" : ""}`}>
      {role === "assistant" && (
        <div className="awto-bubble__avatar" aria-hidden="true">A</div>
      )}
      <div className="awto-bubble__body">{children}</div>
    </div>
  );
}
