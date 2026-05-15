import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { SkippedRow } from "./types";

interface SkippedSectionProps {
  rows: SkippedRow[];
}

export function SkippedSection({ rows }: SkippedSectionProps) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;
  const count = rows.length;

  return (
    <section className="awto-section">
      <button
        type="button"
        className="awto-section__header"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
        )}
        <span className="awto-section__title">
          {count} skipped
        </span>
      </button>
      {expanded && (
        <div className="awto-section__body">
          <ul className="awto-skippedrows" role="list">
            {rows.map((row) => (
              <li key={row.fieldId} className="awto-skippedrow">
                <span className="awto-skippedrow__label">{row.label}</span>
                <span className="awto-skippedrow__reason">— {row.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
