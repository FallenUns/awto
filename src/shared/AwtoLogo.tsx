import { buildAwtoLogoSvg, type AwtoLogoVariant } from "./logo";

interface AwtoLogoProps {
  size?: number;
  variant?: AwtoLogoVariant;
  surface?: string;
  title?: string;
  className?: string;
}

export function AwtoLogo({ size = 24, variant = "tile", surface, title, className }: AwtoLogoProps) {
  return (
    <span
      className={className}
      style={{ display: "inline-flex", width: size, height: size, lineHeight: 0, flex: "none" }}
      dangerouslySetInnerHTML={{ __html: buildAwtoLogoSvg({ size, variant, surface, title }) }}
    />
  );
}
