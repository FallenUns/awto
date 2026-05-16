import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProfileTab } from "./ProfileTab";
import { EMPTY_PROFILE, type Profile } from "@/shared/profile";
import { TITLES } from "./countries";

function renderProfileTab(profileOverrides: Partial<Profile> = {}) {
  const profile: Profile = { ...EMPTY_PROFILE, ...profileOverrides };
  const onUpdate = vi.fn();
  const onClear = vi.fn();
  const onAddCustom = vi.fn().mockReturnValue({ ok: true });
  const onUpdateCustom = vi.fn();
  const onRemoveCustom = vi.fn();
  const onReplaceProfile = vi.fn();

  render(
    <ProfileTab
      profile={profile}
      saveStatus="idle"
      onUpdate={onUpdate}
      onClear={onClear}
      onAddCustom={onAddCustom}
      onUpdateCustom={onUpdateCustom}
      onRemoveCustom={onRemoveCustom}
      onReplaceProfile={onReplaceProfile}
    />
  );

  return { onUpdate, onClear };
}

describe("ProfileTab — enum dropdowns", () => {
  it("renders Title as a <select> with the 6 honorifics + Other…", () => {
    renderProfileTab();
    const select = screen.getByLabelText("Title") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    for (const t of TITLES) {
      expect(
        Array.from(select.options).some((o) => o.value === t)
      ).toBe(true);
    }
    expect(
      Array.from(select.options).some((o) => o.textContent?.includes("Other"))
    ).toBe(true);
  });

  it("selecting a preset option calls onUpdate with that value", () => {
    const { onUpdate } = renderProfileTab();
    const select = screen.getByLabelText("Title") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "Dr" } });
    expect(onUpdate).toHaveBeenCalledWith("title", "Dr");
  });

  it("selecting Other… reveals a custom text input", () => {
    const { onUpdate, ...rest } = renderProfileTab();
    void rest;
    const select = screen.getByLabelText("Title") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "__custom__" } });
    expect(onUpdate).toHaveBeenCalledWith("title", " ");
  });

  it("loads a non-preset value as Other… with text input populated", () => {
    renderProfileTab({ title: "Reverend" });
    const select = screen.getByLabelText("Title") as HTMLSelectElement;
    expect(select.value).toBe("__custom__");
    const custom = screen.getByLabelText("Custom Title") as HTMLInputElement;
    expect(custom.value).toBe("Reverend");
  });
});
