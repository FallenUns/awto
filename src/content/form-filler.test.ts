import { describe, it, expect, beforeEach, vi } from "vitest";
import { fillFields, fillAriaWidget } from "./form-filler";

function setBody(html: string): void {
  document.body.innerHTML = html;
}

function setRect(
  selector: string,
  rect: { left: number; top: number; width: number; height: number }
): void {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) throw new Error(`Missing element ${selector}`);
  const full = {
    x: rect.left,
    y: rect.top,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => ({}),
  } as DOMRect;
  el.getBoundingClientRect = () => full;
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

  it("refuses to put street address into a field visibly labelled City", () => {
    setBody(`
      <form>
        <label for="city">City</label>
        <input id="city" name="address-line1" />
      </form>
    `);

    const result = fillFields(document, [
      {
        selector: "#city",
        value: "327 La Trobe Street",
        label: "Street address",
        profileKey: "addressLine1",
      },
    ]);

    expect(result.filled).toBe(0);
    expect(result.failed).toEqual([
      { selector: "#city", reason: "label mismatch" },
    ]);
    expect((document.querySelector("#city") as HTMLInputElement).value).toBe("");
  });

  it("uses the nearest duplicate explicit label before deciding whether a fill is safe", () => {
    setBody(`
      <form>
        <label for="address-line1">Street address</label>
        <input id="street" />
        <label for="address-line1">City</label>
        <input id="address-line1" name="address-line1" />
      </form>
    `);

    const result = fillFields(document, [
      {
        selector: "#address-line1",
        value: "327 La Trobe Street",
        label: "Street address",
        profileKey: "addressLine1",
      },
    ]);

    expect(result.filled).toBe(0);
    expect(result.failed).toEqual([
      { selector: "#address-line1", reason: "label mismatch" },
    ]);
    expect(
      (document.querySelector("#address-line1") as HTMLInputElement).value
    ).toBe("");
  });

  it("allows city value into a visually labelled City field despite misleading HTML", () => {
    setBody(`
      <form>
        <div id="city-label">City</div>
        <input id="city" name="address-line1" />
      </form>
    `);
    setRect("#city-label", { left: 100, top: 20, width: 60, height: 20 });
    setRect("#city", { left: 220, top: 15, width: 180, height: 32 });

    const result = fillFields(document, [
      {
        selector: "#city",
        value: "Melbourne",
        label: "City",
        profileKey: "city",
      },
    ]);

    expect(result.filled).toBe(1);
    expect(result.failed).toEqual([]);
    expect((document.querySelector("#city") as HTMLInputElement).value).toBe(
      "Melbourne"
    );
  });
});

describe("fillFields select fuzzy match", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("falls back to substring match when exact match fails", () => {
    setBody(`
      <select id="state">
        <option value="vic">Victoria</option>
        <option value="nsw">New South Wales</option>
        <option value="qld">Queensland</option>
      </select>
    `);
    const result = fillFields(document, [{ selector: "#state", value: "vic" }]);
    expect(result.filled).toBe(1);
    expect(result.failed).toEqual([]);

    // Fuzzy substring: "Vic" should match "Victoria" via text substring
    setBody(`
      <select id="state2">
        <option value="1">Victoria</option>
        <option value="2">New South Wales</option>
      </select>
    `);
    const r2 = fillFields(document, [{ selector: "#state2", value: "Vic" }]);
    expect(r2.filled).toBe(1);
    expect((document.querySelector("#state2") as HTMLSelectElement).value).toBe("1");
  });

  it("falls back to Levenshtein match for typos", () => {
    setBody(`
      <select id="country">
        <option value="au">Australia</option>
        <option value="nz">New Zealand</option>
      </select>
    `);
    // Typo: "Austraila" -> Levenshtein 2 from "Australia"
    const result = fillFields(document, [
      { selector: "#country", value: "Austraila" },
    ]);
    expect(result.filled).toBe(1);
    expect((document.querySelector("#country") as HTMLSelectElement).value).toBe("au");
  });

  it("still fails when no fuzzy match is close enough", () => {
    setBody(`
      <select id="planet">
        <option value="e">Earth</option>
        <option value="v">Venus</option>
      </select>
    `);
    const result = fillFields(document, [{ selector: "#planet", value: "Mars" }]);
    expect(result.filled).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.reason).toBe("no matching option");
  });

  it("prefers exact match over fuzzy", () => {
    setBody(`
      <select id="x">
        <option value="a">Australia</option>
        <option value="b">Austria</option>
      </select>
    `);
    const result = fillFields(document, [{ selector: "#x", value: "Austria" }]);
    expect(result.filled).toBe(1);
    expect((document.querySelector("#x") as HTMLSelectElement).value).toBe("b");
  });

  it("matches numeric month values to month names", () => {
    setBody(`
      <select id="month">
        <option value="">Month</option>
        <option value="Jan">Jan</option>
        <option value="Feb">Feb</option>
      </select>
    `);
    const result = fillFields(document, [{ selector: "#month", value: "01" }]);
    expect(result.filled).toBe(1);
    expect((document.querySelector("#month") as HTMLSelectElement).value).toBe("Jan");
  });

  it("matches month names to numeric option values", () => {
    setBody(`
      <select id="month">
        <option value="">Month</option>
        <option value="01">January</option>
        <option value="02">February</option>
      </select>
    `);
    const result = fillFields(document, [{ selector: "#month", value: "Jan" }]);
    expect(result.filled).toBe(1);
    expect((document.querySelector("#month") as HTMLSelectElement).value).toBe("01");
  });
});

describe("fillAriaWidget — textbox", () => {
  it("writes textContent and dispatches an input event", async () => {
    document.body.innerHTML = `<div id="t" role="textbox" contenteditable="true"></div>`;
    const el = document.getElementById("t") as HTMLElement;
    const events: string[] = [];
    el.addEventListener("input", (e) =>
      events.push(`input:${(e as InputEvent).inputType ?? ""}`)
    );

    const result = await fillAriaWidget(el, "Patrick");

    expect(result).toMatchObject({ filled: true });
    expect(el.textContent).toBe("Patrick");
    expect(events).toEqual(["input:insertText"]);
  });
});
