import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConsentRow } from "./ConsentRow";

describe("ConsentRow", () => {
  it("renders a checked marketing toggle and fires onToggle when flipped off", () => {
    const onToggle = vi.fn();
    render(
      <ConsentRow
        fieldId={0}
        label="Send me emails"
        consentType="marketing"
        checked={true}
        onToggle={onToggle}
      />
    );
    const toggle = screen.getByRole("switch") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("marks legal rows required and renders policy links", () => {
    render(
      <ConsentRow
        fieldId={1}
        label="I agree to the Terms"
        consentType="legal"
        checked={false}
        links={[{ text: "Privacy Policy", href: "https://x/privacy" }]}
        onToggle={vi.fn()}
      />
    );
    expect(screen.getByText(/required/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Privacy Policy" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://x/privacy");
  });
});
