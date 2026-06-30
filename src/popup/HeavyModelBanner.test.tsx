import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeavyModelBanner } from "./HeavyModelBanner";

describe("HeavyModelBanner", () => {
  it("warns when the selected model exceeds device RAM", () => {
    render(<HeavyModelBanner model="gemma3:27b" deviceMemoryGB={8} />);
    expect(screen.getByRole("note").textContent).toMatch(/may be slow|may fail|hardware/i);
    expect(screen.getByRole("link").getAttribute("href")).toContain("TROUBLESHOOTING.md");
  });
  it("renders nothing for a light model", () => {
    const { container } = render(<HeavyModelBanner model="llama3.2:3b" deviceMemoryGB={8} />);
    expect(container.firstChild).toBeNull();
  });
  it("renders nothing when device memory is unknown", () => {
    const { container } = render(<HeavyModelBanner model="gemma3:27b" deviceMemoryGB={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
