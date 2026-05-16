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
