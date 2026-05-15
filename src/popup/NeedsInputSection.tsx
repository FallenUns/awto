import type { MissingRow } from "./types";

interface NeedsInputSectionProps {
  rows: MissingRow[];
  onChange: (fieldId: number, value: string) => void;
}

export function NeedsInputSection({ rows, onChange }: NeedsInputSectionProps) {
  if (rows.length === 0) return null;
  const count = rows.length;

  return (
    <section className="awto-section awto-section--accent" aria-live="polite">
      <div className="awto-section__header awto-section__header--static">
        <span className="awto-section__title awto-section__title--accent">
          Tell us {count} thing{count === 1 ? "" : "s"}
        </span>
      </div>
      <div className="awto-section__body">
        <ul className="awto-missingrows" role="list">
          {rows.map((row) => {
            const inputId = `awto-missing-${row.fieldId}`;
            const helperId = `awto-missing-helper-${row.fieldId}`;
            const labelMatchesPrompt = row.label.trim() === row.promptText.trim();
            return (
              <li key={row.fieldId} className="awto-missingrow">
                <label htmlFor={inputId} className="awto-missingrow__label">
                  {labelMatchesPrompt ? row.label : row.promptText}
                </label>
                <input
                  id={inputId}
                  type="text"
                  className="awto-input"
                  value={row.userValue}
                  onChange={(e) => onChange(row.fieldId, e.target.value)}
                  aria-describedby={!labelMatchesPrompt ? helperId : undefined}
                />
                {!labelMatchesPrompt && (
                  <p id={helperId} className="awto-helper">
                    Maps to field: {row.label}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
