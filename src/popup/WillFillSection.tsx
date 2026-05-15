import { useState } from "react";
import { ChevronDown, ChevronRight, Circle } from "lucide-react";
import type { FillRow } from "./types";

interface WillFillSectionProps {
  rows: FillRow[];
  onOverride: (fieldId: number, value: string) => void;
}

const CONFIDENCE_THRESHOLD = 0.85;

export function WillFillSection({ rows, onOverride }: WillFillSectionProps) {
  const [expanded, setExpanded] = useState(true);
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
          Will fill {count} field{count === 1 ? "" : "s"}
        </span>
      </button>
      {expanded && (
        <div className="awto-section__body">
          {rows.length === 0 ? (
            <p className="awto-muted">Nothing to fill.</p>
          ) : (
            <ul className="awto-fillrows" role="list">
              {rows.map((row) => {
                const lowConf = row.confidence < CONFIDENCE_THRESHOLD;
                const inputId = `awto-fill-${row.fieldId}`;
                return (
                  <li key={row.fieldId} className="awto-fillrow">
                    <label
                      htmlFor={inputId}
                      className="awto-fillrow__label"
                    >
                      {lowConf && (
                        <Circle
                          size={6}
                          fill="#F59E0B"
                          color="#F59E0B"
                          strokeWidth={0}
                          aria-label="Low confidence"
                          className="awto-fillrow__warn"
                        />
                      )}
                      <span>{row.label}</span>
                    </label>
                    <input
                      id={inputId}
                      type="text"
                      className="awto-input"
                      value={row.resolvedValue}
                      onChange={(e) => onOverride(row.fieldId, e.target.value)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
