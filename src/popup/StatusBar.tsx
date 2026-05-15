import { Check, Loader2, AlertCircle } from "lucide-react";
import type { FlowStatus } from "./types";

interface StatusBarProps {
  status: FlowStatus;
}

function statusLabel(status: FlowStatus): string {
  switch (status) {
    case "scanning":
      return "Scanning";
    case "mapping":
      return "Thinking";
    case "ready":
      return "Ready";
    case "filling":
      return "Filling";
    case "done":
      return "Done";
    case "error":
      return "Error";
    case "no-form":
      return "Idle";
  }
}

function statusDotColor(status: FlowStatus): string {
  if (status === "error") return "var(--color-destructive)";
  if (status === "ready" || status === "done") return "var(--color-accent)";
  return "var(--color-border)";
}

export function StatusBar({ status }: StatusBarProps) {
  const showSpinner = status === "scanning" || status === "mapping" || status === "filling";
  const showCheck = status === "ready" || status === "done";
  const showError = status === "error";

  return (
    <header className="awto-statusbar" role="banner">
      <span className="awto-statusbar__brand">Awto</span>
      <span className="awto-statusbar__status" aria-live="polite">
        <span
          className="awto-statusbar__dot"
          style={{ background: statusDotColor(status) }}
          aria-hidden="true"
        />
        {showSpinner && (
          <Loader2
            size={12}
            className="awto-spin"
            aria-hidden="true"
            strokeWidth={1.5}
          />
        )}
        {showCheck && (
          <Check size={12} aria-hidden="true" strokeWidth={1.5} />
        )}
        {showError && (
          <AlertCircle size={12} aria-hidden="true" strokeWidth={1.5} />
        )}
        <span className="awto-statusbar__label">{statusLabel(status)}</span>
      </span>
    </header>
  );
}
