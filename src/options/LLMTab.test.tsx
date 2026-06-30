import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { LLMTab } from "./LLMTab";
import { DEFAULT_LLM_SETTINGS, type LLMSettings } from "@/shared/storage";

async function renderLLMTab(overrides: Partial<LLMSettings> = {}) {
  const settings: LLMSettings = { ...DEFAULT_LLM_SETTINGS, ...overrides };
  const onUpdate = vi.fn();
  const onTestOllama = vi.fn().mockResolvedValue({ ok: true, models: [] });

  await act(async () => {
    render(
      <LLMTab
        settings={settings}
        saveStatus="idle"
        onUpdate={onUpdate}
        onTestOllama={onTestOllama}
      />
    );
  });

  return { onUpdate, onTestOllama };
}

it("renders the model catalog with the recommended model", async () => {
  const onUpdate = vi.fn();
  const onTestOllama = vi.fn().mockResolvedValue({ ok: true, models: ["llama3.2:3b"] });
  render(
    <LLMTab
      settings={{ ...DEFAULT_LLM_SETTINGS }}
      saveStatus="idle"
      onUpdate={onUpdate}
      onTestOllama={onTestOllama}
    />
  );
  expect(await screen.findByText("Qwen 2.5 7B")).toBeTruthy();
});

describe("LLMTab — ARIA forms toggle", () => {
  it("renders the 'Fill custom-widget forms' toggle reflecting current setting", async () => {
    await renderLLMTab({ enableAriaForms: true });
    const toggle = screen.getByLabelText(
      /fill custom-widget forms/i
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it("renders the toggle as unchecked when disabled", async () => {
    await renderLLMTab({ enableAriaForms: false });
    const toggle = screen.getByLabelText(
      /fill custom-widget forms/i
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it("clicking the toggle calls onUpdate with the new value", async () => {
    const { onUpdate } = await renderLLMTab({ enableAriaForms: true });
    const toggle = screen.getByLabelText(
      /fill custom-widget forms/i
    ) as HTMLInputElement;
    fireEvent.click(toggle);
    expect(onUpdate).toHaveBeenCalledWith({ enableAriaForms: false });
  });
});
