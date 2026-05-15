import { Loader2 } from "lucide-react";

interface FooterProps {
  filling: boolean;
  fillDisabled: boolean;
  fillCount: number;
  onCancel: () => void;
  onFill: () => void;
}

export function Footer({
  filling,
  fillDisabled,
  fillCount,
  onCancel,
  onFill,
}: FooterProps) {
  return (
    <footer className="awto-footer">
      <button
        type="button"
        className="awto-btn awto-btn--ghost"
        onClick={onCancel}
        disabled={filling}
      >
        Cancel
      </button>
      <button
        type="button"
        className="awto-btn awto-btn--primary"
        onClick={onFill}
        disabled={fillDisabled || filling}
      >
        {filling ? (
          <>
            <Loader2
              size={16}
              className="awto-spin"
              aria-hidden="true"
              strokeWidth={1.5}
            />
            <span>Filling…</span>
          </>
        ) : (
          <span>Fill {fillCount} field{fillCount === 1 ? "" : "s"}</span>
        )}
      </button>
    </footer>
  );
}
