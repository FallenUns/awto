import { describe, it, expect, beforeEach, vi } from "vitest";
import { fillFields } from "./form-filler";

function setBody(html: string): void {
  document.body.innerHTML = html;
}

describe("fillFields", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("fills a text input and dispatches input + change events", () => {
    setBody(`<input id="name" type="text" />`);
    const input = document.querySelector("#name") as HTMLInputElement;
    const inputEvents: string[] = [];
    input.addEventListener("input", () => inputEvents.push("input"));
    input.addEventListener("change", () => inputEvents.push("change"));
    const result = fillFields(document, [{ selector: "#name", value: "Patrick" }]);
    expect(input.value).toBe("Patrick");
    expect(inputEvents).toEqual(["input", "change"]);
    expect(result.filled).toBe(1);
    expect(result.failed).toEqual([]);
  });

  it("fills an email input and dispatches input + change", () => {
    setBody(`<input id="email" type="email" />`);
    const input = document.querySelector("#email") as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));
    const result = fillFields(document, [
      { selector: "#email", value: "p@example.com" },
    ]);
    expect(input.value).toBe("p@example.com");
    expect(events).toEqual(["input", "change"]);
    expect(result.filled).toBe(1);
  });

  it("fills a textarea and dispatches input + change", () => {
    setBody(`<textarea id="bio"></textarea>`);
    const textarea = document.querySelector("#bio") as HTMLTextAreaElement;
    const events: string[] = [];
    textarea.addEventListener("input", () => events.push("input"));
    textarea.addEventListener("change", () => events.push("change"));
    const result = fillFields(document, [
      { selector: "#bio", value: "Hi there" },
    ]);
    expect(textarea.value).toBe("Hi there");
    expect(events).toEqual(["input", "change"]);
    expect(result.filled).toBe(1);
  });

  it("uses the React/Vue value-setter trick on inputs", () => {
    setBody(`<input id="name" type="text" />`);
    const input = document.querySelector("#name") as HTMLInputElement;
    const setterSpy = vi.fn();
    const proto = HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    const realSetter = descriptor?.set;
    Object.defineProperty(proto, "value", {
      ...descriptor,
      set(v: string) {
        setterSpy(v);
        realSetter?.call(this, v);
      },
    });
    try {
      fillFields(document, [{ selector: "#name", value: "Hello" }]);
      expect(setterSpy).toHaveBeenCalledWith("Hello");
    } finally {
      Object.defineProperty(proto, "value", descriptor!);
    }
  });

  it("sets a <select> by exact value match", () => {
    setBody(`
      <select id="state">
        <option value="vic">Victoria</option>
        <option value="nsw">New South Wales</option>
      </select>
    `);
    const select = document.querySelector("#state") as HTMLSelectElement;
    let changeCount = 0;
    select.addEventListener("change", () => changeCount++);
    const result = fillFields(document, [{ selector: "#state", value: "vic" }]);
    expect(select.value).toBe("vic");
    expect(changeCount).toBe(1);
    expect(result.filled).toBe(1);
  });

  it("sets a <select> by case-insensitive visible text match", () => {
    setBody(`
      <select id="state">
        <option value="vic">Victoria</option>
        <option value="nsw">New South Wales</option>
      </select>
    `);
    const select = document.querySelector("#state") as HTMLSelectElement;
    const result = fillFields(document, [
      { selector: "#state", value: "  victoria  " },
    ]);
    expect(select.value).toBe("vic");
    expect(result.filled).toBe(1);
  });

  it("fails with 'no matching option' when the select has no match", () => {
    setBody(`
      <select id="state">
        <option value="vic">Victoria</option>
      </select>
    `);
    const result = fillFields(document, [
      { selector: "#state", value: "Tasmania" },
    ]);
    expect(result.filled).toBe(0);
    expect(result.failed).toEqual([
      { selector: "#state", reason: "no matching option" },
    ]);
  });

  it("checks a checkbox when value is 'true' and unchecks when 'false'", () => {
    setBody(`<input id="tos" type="checkbox" />`);
    const cb = document.querySelector("#tos") as HTMLInputElement;
    let changeCount = 0;
    cb.addEventListener("change", () => changeCount++);
    fillFields(document, [{ selector: "#tos", value: "true" }]);
    expect(cb.checked).toBe(true);
    fillFields(document, [{ selector: "#tos", value: "false" }]);
    expect(cb.checked).toBe(false);
    expect(changeCount).toBe(2);
  });

  it("selects a radio in a group by value", () => {
    setBody(`
      <input type="radio" name="sub" value="yes" id="ry" />
      <input type="radio" name="sub" value="no" id="rn" />
    `);
    const yes = document.querySelector("#ry") as HTMLInputElement;
    const no = document.querySelector("#rn") as HTMLInputElement;
    let changeCount = 0;
    yes.addEventListener("change", () => changeCount++);
    const result = fillFields(document, [{ selector: "#ry", value: "yes" }]);
    expect(yes.checked).toBe(true);
    expect(no.checked).toBe(false);
    expect(changeCount).toBe(1);
    expect(result.filled).toBe(1);
  });

  it("returns 'selector not found' for an unresolvable selector", () => {
    setBody(`<input id="x" type="text" />`);
    const result = fillFields(document, [
      { selector: "#does-not-exist", value: "x" },
    ]);
    expect(result.filled).toBe(0);
    expect(result.failed).toEqual([
      { selector: "#does-not-exist", reason: "selector not found" },
    ]);
  });

  it("returns the correct filled count for a mixed batch", () => {
    setBody(`
      <input id="a" type="text" />
      <select id="s">
        <option value="x">X</option>
      </select>
    `);
    const result = fillFields(document, [
      { selector: "#a", value: "hello" },
      { selector: "#missing", value: "nope" },
      { selector: "#s", value: "not-an-option" },
    ]);
    expect(result.filled).toBe(1);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0]).toEqual({
      selector: "#missing",
      reason: "selector not found",
    });
    expect(result.failed[1]).toEqual({
      selector: "#s",
      reason: "no matching option",
    });
  });
});
