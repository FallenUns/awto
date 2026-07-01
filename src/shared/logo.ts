export type AwtoLogoVariant = "tile" | "mono";

export const AWTO_ACCENT = "#4ade80";
export const AWTO_MARK_ON_TILE = "#08221a";
export const AWTO_DARK_SURFACE = "#0a0a0c";

export interface AwtoLogoOptions {
  size?: number;
  variant?: AwtoLogoVariant;
  surface?: string;
  title?: string;
}

// The mark is an abstract "A" built from a crossed pencil (+26°) and pen (−26°)
// sharing a pivot, resting on a short "field line" crossbar. Geometry lives in a
// 100×100 design space; see the brand handoff. Slit is drawn last so it reads as a
// cut in the pen nib, coloured to match whatever surface sits behind it.
function markBody(markColor: string, slitColor: string): string {
  return (
    `<g fill="${markColor}">` +
    `<g transform="rotate(26 50 25.75)">` +
    `<rect x="45.5" y="13" width="9" height="62" rx="4.5"/>` +
    `<polygon points="45.5,73 54.5,73 50,91"/>` +
    `</g>` +
    `<g transform="rotate(-26 50 25.75)">` +
    `<rect x="45.5" y="13" width="9" height="58" rx="4.5"/>` +
    `<polygon points="45.5,69 54.5,69 50,91"/>` +
    `</g>` +
    `<rect x="35" y="53" width="30" height="7" rx="3.5"/>` +
    `</g>` +
    `<rect x="49.2" y="73" width="1.6" height="12" fill="${slitColor}" transform="rotate(-26 50 25.75)"/>`
  );
}

export function buildAwtoLogoSvg(opts: AwtoLogoOptions = {}): string {
  const { size = 100, variant = "tile", surface, title } = opts;
  const markColor = variant === "tile" ? AWTO_MARK_ON_TILE : AWTO_ACCENT;
  const slitColor = variant === "tile" ? AWTO_ACCENT : surface ?? AWTO_DARK_SURFACE;
  const tile =
    variant === "tile" ? `<rect width="100" height="100" rx="22.7" fill="${AWTO_ACCENT}"/>` : "";
  const a11y = title
    ? `role="img" aria-label="${title}"`
    : `role="presentation" aria-hidden="true"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 100 100" ${a11y}>` +
    tile +
    markBody(markColor, slitColor) +
    `</svg>`
  );
}
