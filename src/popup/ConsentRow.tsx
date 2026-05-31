import type { ConsentLink } from "@/shared/consent";

interface ConsentRowProps {
  fieldId: number;
  label: string;
  consentType: "marketing" | "legal";
  checked: boolean;
  links?: ConsentLink[];
  onToggle: (checked: boolean) => void;
}

export function ConsentRow({
  fieldId,
  label,
  consentType,
  checked,
  links,
  onToggle,
}: ConsentRowProps) {
  const inputId = `consent-${fieldId}`;
  return (
    <div className={`awto-consent-row awto-consent-row--${consentType}`}>
      <div className="awto-consent-row__text">
        <label htmlFor={inputId} className="awto-consent-row__label">
          {label}
          {consentType === "legal" && (
            <span className="awto-consent-row__required"> · required</span>
          )}
        </label>
        {links && links.length > 0 && (
          <div className="awto-consent-row__links">
            {links.map((l, i) => (
              <a
                key={i}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="awto-consent-row__link"
              >
                {l.text}
              </a>
            ))}
          </div>
        )}
      </div>
      <input
        id={inputId}
        type="checkbox"
        role="switch"
        className="awto-consent-row__toggle"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        aria-label={label}
      />
    </div>
  );
}
