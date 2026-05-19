import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LLMTab } from "./LLMTab";
import { DEFAULT_LLM_SETTINGS, type LLMSettings } from "@/shared/storage";

function renderLLMTab(overrides: Partial<LLMSettings> = {}) {
  const settings: LLMSettings = { ...DEFAULT_LLM_SETTINGS, ...overrides };
  const onUpdate = vi.fn();
  const onTestOllama = vi.fn().mockResolvedValue({ ok: true, models: [] });

  render(
    <LLMTab
      settings={settings}
      saveStatus="idle"
      onUpdate={onUpdate}
      onTestOllama={onTestOllama}
    />
  );

  return { onUpdate, onTestOllama };
}

describe("LLMTab — ARIA forms toggle", () => {
  it("renders the 'Fill custom-widget forms' toggle reflecting current setting", () => {
    renderLLMTab({ enableAriaForms: true });
    const toggle = screen.getByLabelText(
      /fill custom-widget forms/i
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it("renders the toggle as unchecked when disabled", () => {
    renderLLMTab({ enableAriaForms: false });
    const toggle = screen.getByLabelText(
      /fill custom-widget forms/i
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it("clicking the toggle calls onUpdate with the new value", () => {
    const { onUpdate } = renderLLMTab({ enableAriaForms: true });
    const toggle = screen.getByLabelText(
      /fill custom-widget forms/i
    ) as HTMLInputElement;
    fireEvent.click(toggle);
    expect(onUpdate).toHaveBeenCalledWith({ enableAriaForms: false });
  });
});
