import { ChevronRight } from "lucide-react";

export type SectionTone = "neutral" | "amber" | "muted";

interface SectionHeaderProps {
  label: string;
  count: number;
  tone: SectionTone;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}

export function SectionHeader({
  label,
  count,
  tone,
  collapsible = false,
  collapsed = false,
  onToggle,
}: SectionHeaderProps) {
  if (count === 0) return null;

  const className = `awto-section-header awto-section-header--${tone}`;

  if (collapsible) {
    return (
      <button
        type="button"
        className={className}
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        <ChevronRight
          size={14}
          strokeWidth={2}
          className={`awto-section-header__chevron ${
            collapsed ? "" : "awto-section-header__chevron--open"
          }`}
          aria-hidden="true"
        />
        <span className="awto-section-header__label">{label}</span>
        <span className="awto-section-header__count">{count}</span>
      </button>
    );
  }

  return (
    <div className={className}>
      <span className="awto-section-header__label">{label}</span>
      <span className="awto-section-header__count">{count}</span>
    </div>
  );
}
