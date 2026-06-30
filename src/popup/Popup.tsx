import { useEffect, useMemo, useRef, useState } from "react";
import { Check, AlertCircle, FileX2 } from "lucide-react";
import { Header } from "./Header";
import { FieldRow } from "./FieldRow";
import { ActionBar } from "./ActionBar";
import { SectionHeader } from "./SectionHeader";
import { ConsentRow } from "./ConsentRow";
import { useAwtoFlow } from "./useAwtoFlow";
import { HeavyModelBanner } from "./HeavyModelBanner";
import { loadLLMSettings } from "@/shared/storage";
import type { FillRow } from "./types";

const REVIEW_THRESHOLD = 0.85;

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
    case "label mismatch":
      return "The page label did not match the mapped profile field, so Awto left it for you to fill manually.";
    default:
      return reason;
  }
}

export function Popup() {
  const { state, status, setMissingValue, setConsentChecked, fill, retry, cancel, rescan } =
    useAwtoFlow();
  const listRef = useRef<HTMLDivElement>(null);
  const [promoted, setPromoted] = useState<Set<number>>(new Set());
  const [skippedCollapsed, setSkippedCollapsed] = useState(true);
  const [ollamaModel, setOllamaModel] = useState("");

  useEffect(() => {
    void loadLLMSettings().then((s) => setOllamaModel(s.ollamaModel));
  }, []);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [status]);

  const isMappingOrReady =
    status === "mapping" || status === "ready" || status === "filling";

  const { willFill, review } = useMemo(() => {
    const willFill: FillRow[] = [];
    const review: FillRow[] = [];
    for (const row of state.fillRows) {
      if (row.confidence >= REVIEW_THRESHOLD || promoted.has(row.fieldId)) {
        willFill.push(row);
      } else {
        review.push(row);
      }
    }
    return { willFill, review };
  }, [state.fillRows, promoted]);

  const answeredMissing = state.missingRows.filter(
    (r) => r.userValue.trim() !== ""
  ).length;
  const checkedConsentCount = state.consentRows.filter((r) => r.checked).length;
  const totalToFill = willFill.length + answeredMissing + checkedConsentCount;
  const missingCount = state.missingRows.length;
  const skipCount = state.skippedRows.length;
  const fillDisabled = totalToFill === 0;

  const resolvedIds = useMemo(() => {
    const ids = new Set<number>();
    for (const r of state.fillRows) ids.add(r.fieldId);
    for (const r of state.missingRows) ids.add(r.fieldId);
    for (const r of state.skippedRows) ids.add(r.fieldId);
    for (const r of state.consentRows) ids.add(r.fieldId);
    return ids;
  }, [state.fillRows, state.missingRows, state.skippedRows, state.consentRows]);

  const pendingFields = state.loadingFields.filter(
    (f) => !resolvedIds.has(f.id)
  );

  return (
    <div className="awto-popup">
      <HeavyModelBanner
        model={ollamaModel}
        deviceMemoryGB={(navigator as Navigator & { deviceMemory?: number }).deviceMemory}
      />
      <Header
        status={status}
        readyCount={willFill.length}
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

        {isMappingOrReady && (
          <>
            {willFill.length > 0 && (
              <>
                <SectionHeader
                  label="Will fill"
                  count={willFill.length}
                  tone="neutral"
                />
                {willFill.map((r) => (
                  <FieldRow
                    key={`fill-${r.fieldId}`}
                    kind="fill"
                    fieldId={r.fieldId}
                    label={r.label}
                    value={r.resolvedValue}
                    confidence={r.confidence}
                  />
                ))}
              </>
            )}

            {review.length > 0 && (
              <>
                <SectionHeader
                  label="Review before filling"
                  count={review.length}
                  tone="amber"
                />
                {review.map((r) => (
                  <FieldRow
                    key={`review-${r.fieldId}`}
                    kind="fill"
                    fieldId={r.fieldId}
                    label={r.label}
                    value={r.resolvedValue}
                    confidence={r.confidence}
                    reviewable
                    onUse={() =>
                      setPromoted((prev) => {
                        const next = new Set(prev);
                        next.add(r.fieldId);
                        return next;
                      })
                    }
                  />
                ))}
              </>
            )}

            {missingCount > 0 && (
              <>
                <SectionHeader
                  label="Needs your input"
                  count={missingCount}
                  tone="amber"
                />
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
              </>
            )}

            {state.consentRows.length > 0 && (
              <>
                <SectionHeader
                  label="Consent"
                  count={state.consentRows.length}
                  tone="neutral"
                />
                {state.consentRows.map((r) => (
                  <ConsentRow
                    key={`consent-${r.fieldId}`}
                    fieldId={r.fieldId}
                    label={r.label}
                    consentType={r.consentType}
                    checked={r.checked}
                    links={r.links}
                    onToggle={(c) => setConsentChecked(r.fieldId, c)}
                  />
                ))}
              </>
            )}

            {pendingFields.length > 0 &&
              pendingFields.map((f) => (
                <FieldRow
                  key={`loading-${f.id}`}
                  kind="loading"
                  fieldId={f.id}
                  label={f.label || `Field ${f.id}`}
                />
              ))}

            {skipCount > 0 && (
              <>
                <SectionHeader
                  label="Skipped"
                  count={skipCount}
                  tone="muted"
                  collapsible
                  collapsed={skippedCollapsed}
                  onToggle={() => setSkippedCollapsed((v) => !v)}
                />
                {!skippedCollapsed &&
                  state.skippedRows.map((r) => (
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

      {isMappingOrReady && (
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
