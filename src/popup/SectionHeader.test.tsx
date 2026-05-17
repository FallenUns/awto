import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SectionHeader } from "./SectionHeader";

describe("SectionHeader", () => {
  it("renders label and count", () => {
    render(<SectionHeader label="Will fill" count={3} tone="neutral" />);
    expect(screen.getByText("Will fill")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("returns null when count is zero", () => {
    const { container } = render(
      <SectionHeader label="Skipped" count={0} tone="muted" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a non-button div when not collapsible", () => {
    const { container } = render(
      <SectionHeader label="Will fill" count={2} tone="neutral" />
    );
    const headerEl = container.firstChild as HTMLElement;
    expect(headerEl.tagName.toLowerCase()).toBe("div");
  });

  it("renders a button + chevron when collapsible", () => {
    render(
      <SectionHeader
        label="Skipped"
        count={2}
        tone="muted"
        collapsible
        collapsed
      />
    );
    expect(screen.getByRole("button", { name: /skipped/i })).toBeTruthy();
  });

  it("invokes onToggle when the collapsible header is clicked", () => {
    const onToggle = vi.fn();
    render(
      <SectionHeader
        label="Skipped"
        count={2}
        tone="muted"
        collapsible
        collapsed
        onToggle={onToggle}
      />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("sets aria-expanded based on collapsed state", () => {
    const { rerender } = render(
      <SectionHeader
        label="Skipped"
        count={2}
        tone="muted"
        collapsible
        collapsed={true}
      />
    );
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
    rerender(
      <SectionHeader
        label="Skipped"
        count={2}
        tone="muted"
        collapsible
        collapsed={false}
      />
    );
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
  });

  it("applies tone class", () => {
    const { container } = render(
      <SectionHeader label="Review" count={1} tone="amber" />
    );
    expect(
      (container.firstChild as HTMLElement).classList.contains(
        "awto-section-header--amber"
      )
    ).toBe(true);
  });
});
