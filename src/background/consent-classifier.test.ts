import { describe, it, expect } from "vitest";
import { classifyConsent, buildConsentDecisions } from "./consent-classifier";
import type { ScannedField } from "@/shared/messages";

function checkbox(
  id: number,
  label: string,
  extra: Partial<ScannedField> = {}
): ScannedField {
  return {
    id,
    selector: `#c${id}`,
    label,
    placeholder: null,
    type: "checkbox",
    required: false,
    ...extra,
  };
}

describe("classifyConsent", () => {
  it("classifies marketing labels", () => {
    expect(classifyConsent(checkbox(0, "Send me emails with helpful tips"))).toBe(
      "marketing"
    );
  });

  it("classifies legal labels", () => {
    expect(
      classifyConsent(
        checkbox(0, "Yes, I understand and agree to the Terms of Service and Privacy Policy")
      )
    ).toBe("legal");
  });

  it("returns null for a non-consent checkbox", () => {
    expect(classifyConsent(checkbox(0, "Remember me"))).toBeNull();
  });

  it("returns null for non-checkbox fields", () => {
    expect(
      classifyConsent({
        id: 0,
        selector: "#x",
        label: "I agree",
        placeholder: null,
        type: "text",
        required: false,
      })
    ).toBeNull();
  });

  it("prefers legal when a label matches both families", () => {
    expect(
      classifyConsent(checkbox(0, "I agree to receive marketing emails per the Privacy Policy"))
    ).toBe("legal");
  });
});

describe("buildConsentDecisions", () => {
  it("proposes marketing checked (optIn) and legal unchecked", () => {
    const { consent, consentIds } = buildConsentDecisions(
      [
        checkbox(0, "Send me promotional emails"),
        checkbox(1, "I agree to the Terms of Service"),
      ],
      "optIn"
    );
    expect(consent).toEqual([
      {
        fieldId: 0,
        selector: "#c0",
        label: "Send me promotional emails",
        consentType: "marketing",
        proposedChecked: true,
      },
      {
        fieldId: 1,
        selector: "#c1",
        label: "I agree to the Terms of Service",
        consentType: "legal",
        proposedChecked: false,
      },
    ]);
    expect([...consentIds]).toEqual([0, 1]);
  });

  it("proposes marketing unchecked when preference is optOut", () => {
    const { consent } = buildConsentDecisions(
      [checkbox(0, "Subscribe to our newsletter")],
      "optOut"
    );
    expect(consent[0]?.proposedChecked).toBe(false);
  });

  it("carries links through to the decision", () => {
    const { consent } = buildConsentDecisions(
      [checkbox(0, "I agree to the Terms", { links: [{ text: "Terms", href: "https://x/terms" }] })],
      "optIn"
    );
    expect(consent[0]?.links).toEqual([{ text: "Terms", href: "https://x/terms" }]);
  });

  it("ignores non-consent checkboxes", () => {
    const { consent, consentIds } = buildConsentDecisions(
      [checkbox(0, "Remember me")],
      "optIn"
    );
    expect(consent).toEqual([]);
    expect(consentIds.size).toBe(0);
  });
});
