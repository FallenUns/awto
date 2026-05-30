import { describe, it, expect } from "vitest";
import { readComboboxValue } from "./combobox";

function combobox(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.querySelector('[role="combobox"]') as HTMLElement;
}

describe("readComboboxValue", () => {
  it("reads the toggle label as the current value", () => {
    const el = combobox(`
      <div role="combobox" aria-controls="m">
        <span class="air3-dropdown-toggle-label">Australia</span>
      </div>
      <div id="m"></div>
    `);
    expect(readComboboxValue(el)).toEqual({ value: "Australia", placeholder: null });
  });

  it("treats 'Select a Country' as a placeholder, not a value", () => {
    const el = combobox(`
      <div role="combobox" aria-controls="m">
        <span class="air3-dropdown-toggle-label">Select a Country</span>
      </div>
      <div id="m"></div>
    `);
    expect(readComboboxValue(el)).toEqual({ value: null, placeholder: "Select a Country" });
  });

  it("reads aria-activedescendant target text first", () => {
    const el = combobox(`
      <div role="combobox" aria-activedescendant="opt2"><span class="label">x</span></div>
      <ul id="m"><li id="opt1">Austria</li><li id="opt2">Australia</li></ul>
    `);
    expect(readComboboxValue(el).value).toBe("Australia");
  });

  it("reads the aria-selected option from the aria-controls target", () => {
    const el = combobox(`
      <div role="combobox" aria-controls="m"></div>
      <ul id="m">
        <li role="option">Austria</li>
        <li role="option" aria-selected="true">Australia</li>
      </ul>
    `);
    expect(readComboboxValue(el).value).toBe("Australia");
  });

  it("returns nulls for an empty combobox", () => {
    const el = combobox(`<div role="combobox"></div>`);
    expect(readComboboxValue(el)).toEqual({ value: null, placeholder: null });
  });
});
