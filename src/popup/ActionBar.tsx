import { Loader2 } from "lucide-react";

interface ActionBarProps {
  filling: boolean;
  fillDisabled: boolean;
  fillCount: number;
  onCancel: () => void;
  onFill: () => void;
}

export function ActionBar({ filling, fillDisabled, fillCount, onCancel, onFill }: ActionBarProps) {
  return (
    <footer className="awto-actionbar">
      <button
        type="button"
        className="awto-actionbar__cancel"
        onClick={onCancel}
        disabled={filling}
      >
        Cancel
      </button>
      <button
        type="button"
        className="awto-actionbar__fill"
        onClick={onFill}
        disabled={fillDisabled || filling}
      >
        {filling ? (
          <>
            <Loader2 size={16} strokeWidth={2} className="awto-spin" aria-hidden="true" />
            <span>Filling…</span>
          </>
        ) : (
          <span>Fill {fillCount} field{fillCount === 1 ? "" : "s"}</span>
        )}
      </button>
    </footer>
  );
}
