import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConsentRow } from "./ConsentRow";

const popupStyles = readFileSync(join(process.cwd(), "src/popup/styles.css"), "utf8");

function declarationsFor(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    popupStyles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "s"))?.[1] ??
    ""
  );
}

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

  it("keeps long consent rows from shrinking inside the scrollable popup list", () => {
    render(
      <div className="awto-list" style={{ height: "120px" }}>
        <ConsentRow
          fieldId={2}
          label="I consent to the receipt of electronic communication via text message, WhatsApp, or email from IAG and other entities within IAG network regarding my application."
          consentType="marketing"
          checked={false}
          onToggle={vi.fn()}
        />
        <ConsentRow
          fieldId={3}
          label="Yes, I am confirming I have read and accept IAG network, including employment, job enquiry, and privacy material regarding employment opportunities."
          consentType="legal"
          checked={false}
          onToggle={vi.fn()}
        />
      </div>
    );

    const firstRow = document.querySelector(".awto-consent-row");
    const firstText = document.querySelector(".awto-consent-row__text");
    const rowDeclarations = declarationsFor(".awto-consent-row");
    const textDeclarations = declarationsFor(".awto-consent-row__text");

    expect(firstRow).toBeTruthy();
    expect(firstText).toBeTruthy();
    expect(rowDeclarations).toMatch(/flex-shrink:\s*0/);
    expect(textDeclarations).toMatch(/flex:\s*1 1 auto/);
    expect(textDeclarations).toMatch(/min-width:\s*0/);
  });
});
