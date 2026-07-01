import { describe, it, expect } from "vitest";
import {
  buildAwtoLogoSvg,
  AWTO_ACCENT,
  AWTO_MARK_ON_TILE,
  AWTO_DARK_SURFACE,
} from "./logo";

describe("buildAwtoLogoSvg", () => {
  it("renders a 100x100 viewBox scaled to the requested size", () => {
    const svg = buildAwtoLogoSvg({ size: 48 });
    expect(svg).toContain('viewBox="0 0 100 100"');
    expect(svg).toContain('width="48"');
    expect(svg).toContain('height="48"');
  });

  it("draws the crossed pencil and pen at ±26° about the shared pivot", () => {
    const svg = buildAwtoLogoSvg();
    expect(svg).toContain("rotate(26 50 25.75)");
    expect(svg).toContain("rotate(-26 50 25.75)");
    expect(svg).toContain('<rect x="35" y="53" width="30" height="7" rx="3.5"/>');
  });

  it("tile variant: green tile, mark knocked out, slit matches the tile", () => {
    const svg = buildAwtoLogoSvg({ variant: "tile" });
    expect(svg).toContain(`<rect width="100" height="100" rx="22.7" fill="${AWTO_ACCENT}"/>`);
    expect(svg).toContain(`<g fill="${AWTO_MARK_ON_TILE}">`);
    expect(svg).toContain(`fill="${AWTO_ACCENT}" transform="rotate(-26 50 25.75)"`);
  });

  it("mono variant: no tile, green mark, slit defaults to the dark surface", () => {
    const svg = buildAwtoLogoSvg({ variant: "mono" });
    expect(svg).not.toContain('rx="22.7"');
    expect(svg).toContain(`<g fill="${AWTO_ACCENT}">`);
    expect(svg).toContain(`fill="${AWTO_DARK_SURFACE}" transform="rotate(-26 50 25.75)"`);
  });

  it("mono variant: slit takes an explicit surface colour when given", () => {
    const svg = buildAwtoLogoSvg({ variant: "mono", surface: "#111113" });
    expect(svg).toContain('fill="#111113" transform="rotate(-26 50 25.75)"');
  });

  it("is decorative by default and labelled when a title is supplied", () => {
    expect(buildAwtoLogoSvg()).toContain('aria-hidden="true"');
    expect(buildAwtoLogoSvg({ title: "Awto" })).toContain('aria-label="Awto"');
  });
});
