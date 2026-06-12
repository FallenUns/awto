import { describe, it, expect, beforeEach, vi } from "vitest";
import { fillFields, fillAriaWidget, matchAriaOption } from "./form-filler";

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

  it("fills a text input and dispatches input + change events", async () => {
    setBody(`<input id="name" type="text" />`);
    const input = document.querySelector("#name") as HTMLInputElement;
    const inputEvents: string[] = [];
    input.addEventListener("input", () => inputEvents.push("input"));
    input.addEventListener("change", () => inputEvents.push("change"));
    const result = await fillFields(document, [{ selector: "#name", value: "Patrick" }]);
    expect(input.value).toBe("Patrick");
    expect(inputEvents).toEqual(["input", "change"]);
    expect(result.filled).toBe(1);
    expect(result.failed).toEqual([]);
  });

  it("formats ISO date values to the text input's displayed date format", async () => {
    setBody(`
      <form>
        <label for="dob">What's your date of birth?</label>
        <input id="dob" type="text" />
        <div>DD/MM/YYYY</div>
      </form>
    `);

    const input = document.querySelector("#dob") as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));

    const result = await fillFields(document, [
      {
        selector: "#dob",
        value: "2004-06-23",
        label: "What's your date of birth?",
        profileKey: "dateOfBirth",
      },
    ]);

    expect(input.value).toBe("23/06/2004");
    expect(events).toEqual(["input", "change"]);
    expect(result.filled).toBe(1);
    expect(result.failed).toEqual([]);
  });

  it("fills an email input and dispatches input + change", async () => {
    setBody(`<input id="email" type="email" />`);
    const input = document.querySelector("#email") as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));
    const result = await fillFields(document, [
      { selector: "#email", value: "p@example.com" },
    ]);
    expect(input.value).toBe("p@example.com");
    expect(events).toEqual(["input", "change"]);
    expect(result.filled).toBe(1);
  });

  it("fills a textarea and dispatches input + change", async () => {
    setBody(`<textarea id="bio"></textarea>`);
    const textarea = document.querySelector("#bio") as HTMLTextAreaElement;
    const events: string[] = [];
    textarea.addEventListener("input", () => events.push("input"));
    textarea.addEventListener("change", () => events.push("change"));
    const result = await fillFields(document, [
      { selector: "#bio", value: "Hi there" },
    ]);
    expect(textarea.value).toBe("Hi there");
    expect(events).toEqual(["input", "change"]);
    expect(result.filled).toBe(1);
  });

  it("uses the React/Vue value-setter trick on inputs", async () => {
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
      await fillFields(document, [{ selector: "#name", value: "Hello" }]);
      expect(setterSpy).toHaveBeenCalledWith("Hello");
    } finally {
      Object.defineProperty(proto, "value", descriptor!);
    }
  });

  it("sets a <select> by exact value match", async () => {
    setBody(`
      <select id="state">
        <option value="vic">Victoria</option>
        <option value="nsw">New South Wales</option>
      </select>
    `);
    const select = document.querySelector("#state") as HTMLSelectElement;
    let changeCount = 0;
    select.addEventListener("change", () => changeCount++);
    const result = await fillFields(document, [{ selector: "#state", value: "vic" }]);
    expect(select.value).toBe("vic");
    expect(changeCount).toBe(1);
    expect(result.filled).toBe(1);
  });

  it("sets a <select> by case-insensitive visible text match", async () => {
    setBody(`
      <select id="state">
        <option value="vic">Victoria</option>
        <option value="nsw">New South Wales</option>
      </select>
    `);
    const select = document.querySelector("#state") as HTMLSelectElement;
    const result = await fillFields(document, [
      { selector: "#state", value: "  victoria  " },
    ]);
    expect(select.value).toBe("vic");
    expect(result.filled).toBe(1);
  });

  it("fails with 'no matching option' when the select has no match", async () => {
    setBody(`
      <select id="state">
        <option value="vic">Victoria</option>
      </select>
    `);
    const result = await fillFields(document, [
      { selector: "#state", value: "Tasmania" },
    ]);
    expect(result.filled).toBe(0);
    expect(result.failed).toEqual([
      { selector: "#state", reason: "no matching option" },
    ]);
  });

  it("checks a checkbox when value is 'true' and unchecks when 'false'", async () => {
    setBody(`<input id="tos" type="checkbox" />`);
    const cb = document.querySelector("#tos") as HTMLInputElement;
    let changeCount = 0;
    cb.addEventListener("change", () => changeCount++);
    await fillFields(document, [{ selector: "#tos", value: "true" }]);
    expect(cb.checked).toBe(true);
    await fillFields(document, [{ selector: "#tos", value: "false" }]);
    expect(cb.checked).toBe(false);
    expect(changeCount).toBe(2);
  });

  it("selects a radio in a group by value", async () => {
    setBody(`
      <input type="radio" name="sub" value="yes" id="ry" />
      <input type="radio" name="sub" value="no" id="rn" />
    `);
    const yes = document.querySelector("#ry") as HTMLInputElement;
    const no = document.querySelector("#rn") as HTMLInputElement;
    let changeCount = 0;
    yes.addEventListener("change", () => changeCount++);
    const result = await fillFields(document, [{ selector: "#ry", value: "yes" }]);
    expect(yes.checked).toBe(true);
    expect(no.checked).toBe(false);
    expect(changeCount).toBe(1);
    expect(result.filled).toBe(1);
  });

  it("returns 'selector not found' for an unresolvable selector", async () => {
    setBody(`<input id="x" type="text" />`);
    const result = await fillFields(document, [
      { selector: "#does-not-exist", value: "x" },
    ]);
    expect(result.filled).toBe(0);
    expect(result.failed).toEqual([
      { selector: "#does-not-exist", reason: "selector not found" },
    ]);
  });

  it("returns the correct filled count for a mixed batch", async () => {
    setBody(`
      <input id="a" type="text" />
      <select id="s">
        <option value="x">X</option>
      </select>
    `);
    const result = await fillFields(document, [
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

  it("refuses to put street address into a field visibly labelled City", async () => {
    setBody(`
      <form>
        <label for="city">City</label>
        <input id="city" name="address-line1" />
      </form>
    `);

    const result = await fillFields(document, [
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

  it("uses the nearest duplicate explicit label before deciding whether a fill is safe", async () => {
    setBody(`
      <form>
        <label for="address-line1">Street address</label>
        <input id="street" />
        <label for="address-line1">City</label>
        <input id="address-line1" name="address-line1" />
      </form>
    `);

    const result = await fillFields(document, [
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

  it("allows city value into a visually labelled City field despite misleading HTML", async () => {
    setBody(`
      <form>
        <div id="city-label">City</div>
        <input id="city" name="address-line1" />
      </form>
    `);
    setRect("#city-label", { left: 100, top: 20, width: 60, height: 20 });
    setRect("#city", { left: 220, top: 15, width: 180, height: 32 });

    const result = await fillFields(document, [
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

  it("falls back to substring match when exact match fails", async () => {
    setBody(`
      <select id="state">
        <option value="vic">Victoria</option>
        <option value="nsw">New South Wales</option>
        <option value="qld">Queensland</option>
      </select>
    `);
    const result = await fillFields(document, [{ selector: "#state", value: "vic" }]);
    expect(result.filled).toBe(1);
    expect(result.failed).toEqual([]);

    // Fuzzy substring: "Vic" should match "Victoria" via text substring
    setBody(`
      <select id="state2">
        <option value="1">Victoria</option>
        <option value="2">New South Wales</option>
      </select>
    `);
    const r2 = await fillFields(document, [{ selector: "#state2", value: "Vic" }]);
    expect(r2.filled).toBe(1);
    expect((document.querySelector("#state2") as HTMLSelectElement).value).toBe("1");
  });

  it("falls back to Levenshtein match for typos", async () => {
    setBody(`
      <select id="country">
        <option value="au">Australia</option>
        <option value="nz">New Zealand</option>
      </select>
    `);
    // Typo: "Austraila" -> Levenshtein 2 from "Australia"
    const result = await fillFields(document, [
      { selector: "#country", value: "Austraila" },
    ]);
    expect(result.filled).toBe(1);
    expect((document.querySelector("#country") as HTMLSelectElement).value).toBe("au");
  });

  it("still fails when no fuzzy match is close enough", async () => {
    setBody(`
      <select id="planet">
        <option value="e">Earth</option>
        <option value="v">Venus</option>
      </select>
    `);
    const result = await fillFields(document, [{ selector: "#planet", value: "Mars" }]);
    expect(result.filled).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.reason).toBe("no matching option");
  });

  it("prefers exact match over fuzzy", async () => {
    setBody(`
      <select id="x">
        <option value="a">Australia</option>
        <option value="b">Austria</option>
      </select>
    `);
    const result = await fillFields(document, [{ selector: "#x", value: "Austria" }]);
    expect(result.filled).toBe(1);
    expect((document.querySelector("#x") as HTMLSelectElement).value).toBe("b");
  });

  it("matches numeric month values to month names", async () => {
    setBody(`
      <select id="month">
        <option value="">Month</option>
        <option value="Jan">Jan</option>
        <option value="Feb">Feb</option>
      </select>
    `);
    const result = await fillFields(document, [{ selector: "#month", value: "01" }]);
    expect(result.filled).toBe(1);
    expect((document.querySelector("#month") as HTMLSelectElement).value).toBe("Jan");
  });

  it("matches month names to numeric option values", async () => {
    setBody(`
      <select id="month">
        <option value="">Month</option>
        <option value="01">January</option>
        <option value="02">February</option>
      </select>
    `);
    const result = await fillFields(document, [{ selector: "#month", value: "Jan" }]);
    expect(result.filled).toBe(1);
    expect((document.querySelector("#month") as HTMLSelectElement).value).toBe("01");
  });
});

describe("fillFields — ARIA dispatch", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("routes an ARIA radiogroup target through fillAriaWidget", async () => {
    document.body.innerHTML = `
      <div id="g" role="radiogroup">
        <div role="radio">A</div>
        <div role="radio">B</div>
      </div>
    `;
    let clicked = "";
    document.querySelectorAll<HTMLElement>('[role="radio"]').forEach((r) => {
      r.addEventListener("click", () => {
        clicked = r.textContent ?? "";
      });
    });
    const result = await fillFields(document, [
      { selector: "#g", value: "B", label: "Pick", profileKey: "x" },
    ]);
    expect(result.filled).toBe(1);
    expect(clicked).toBe("B");
  });

  it("surfaces ARIA fill failures in the failed array", async () => {
    document.body.innerHTML = `
      <div id="g" role="radiogroup">
        <div role="radio">A</div>
      </div>
    `;
    const result = await fillFields(document, [
      { selector: "#g", value: "Z", label: "Pick", profileKey: "x" },
    ]);
    expect(result.filled).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({
      selector: "#g",
      reason: "no matching option",
    });
  });

  it("routes an ARIA textbox target through fillAriaWidget", async () => {
    document.body.innerHTML = `<div id="t" role="textbox" contenteditable="true"></div>`;
    const el = document.getElementById("t") as HTMLElement;
    const result = await fillFields(document, [
      { selector: "#t", value: "Patrick" },
    ]);
    expect(result.filled).toBe(1);
    expect(el.textContent).toBe("Patrick");
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

describe("fillAriaWidget — radiogroup", () => {
  it("clicks the radio whose textContent matches the value", async () => {
    document.body.innerHTML = `
      <div id="g" role="radiogroup">
        <div role="radio" data-x="a">Male</div>
        <div role="radio" data-x="b">Female</div>
        <div role="radio" data-x="c">Other</div>
      </div>
    `;
    const group = document.getElementById("g") as HTMLElement;
    const target = group.querySelectorAll<HTMLElement>('[role="radio"]')[1];
    const clicks: string[] = [];
    target?.addEventListener("click", () => clicks.push("clicked"));

    const result = await fillAriaWidget(group, "Female");

    expect(result).toMatchObject({ filled: true });
    expect(clicks).toEqual(["clicked"]);
  });

  it("returns no matching option when nothing matches", async () => {
    document.body.innerHTML = `
      <div id="g" role="radiogroup">
        <div role="radio">Male</div>
      </div>
    `;
    const result = await fillAriaWidget(
      document.getElementById("g") as HTMLElement,
      "Other"
    );
    expect(result).toMatchObject({ filled: false, reason: "no matching option" });
  });
});

describe("fillAriaWidget — checkbox", () => {
  it("clicks when state needs to change (false → true)", async () => {
    document.body.innerHTML = `<div id="c" role="checkbox" aria-checked="false"></div>`;
    const el = document.getElementById("c") as HTMLElement;
    let clicks = 0;
    el.addEventListener("click", () => clicks++);

    const result = await fillAriaWidget(el, "true");

    expect(result).toMatchObject({ filled: true });
    expect(clicks).toBe(1);
  });

  it("is idempotent when state already matches", async () => {
    document.body.innerHTML = `<div id="c" role="checkbox" aria-checked="true"></div>`;
    const el = document.getElementById("c") as HTMLElement;
    let clicks = 0;
    el.addEventListener("click", () => clicks++);

    const result = await fillAriaWidget(el, "true");

    expect(result).toMatchObject({ filled: true });
    expect(clicks).toBe(0);
  });
});

describe("fillAriaWidget — unsupported role", () => {
  it("returns unsupported aria role for an unknown role", async () => {
    document.body.innerHTML = `<div id="x" role="foo"></div>`;
    const result = await fillAriaWidget(
      document.getElementById("x") as HTMLElement,
      "anything"
    );
    expect(result).toMatchObject({
      filled: false,
      reason: "unsupported aria role",
    });
  });
});

describe("matchAriaOption", () => {
  it("does not match Female to Male (substring hazard)", () => {
    expect(matchAriaOption("Female", "Male")).toBe(false);
  });

  it("matches Yes to Yesterday (legitimate prefix match)", () => {
    expect(matchAriaOption("Yes", "Yesterday")).toBe(true);
  });

  it("matches VIC to Victoria (3-char prefix match)", () => {
    expect(matchAriaOption("VIC", "Victoria")).toBe(true);
  });

  it("matches Victoria to VIC (3-char prefix match, reversed args)", () => {
    expect(matchAriaOption("Victoria", "VIC")).toBe(true);
  });

  it("does not match au to Australia (under 3-char threshold)", () => {
    expect(matchAriaOption("au", "Australia")).toBe(false);
  });
});

describe("fillAriaWidget — combobox with portal options", () => {
  it("clicks the combobox, waits a frame, then clicks the matching option in the document", async () => {
    document.body.innerHTML = `
      <div id="c" role="combobox" aria-expanded="false"></div>
      <div id="popup" style="display:none">
        <div role="option">Victoria</div>
        <div role="option">New South Wales</div>
      </div>
    `;
    const combobox = document.getElementById("c") as HTMLElement;
    const popup = document.getElementById("popup") as HTMLElement;
    combobox.addEventListener("click", () => {
      popup.style.display = "block";
      combobox.setAttribute("aria-expanded", "true");
    });
    let optionClicked = "";
    popup.querySelectorAll<HTMLElement>('[role="option"]').forEach((o) => {
      o.addEventListener("click", () => {
        optionClicked = o.textContent ?? "";
      });
    });

    const result = await fillAriaWidget(combobox, "Victoria");

    expect(result).toMatchObject({ filled: true });
    expect(optionClicked).toBe("Victoria");
  });

  it("returns no matching option when no option matches after opening", async () => {
    document.body.innerHTML = `
      <div id="c" role="combobox"></div>
      <div role="option">Australia</div>
    `;
    const result = await fillAriaWidget(
      document.getElementById("c") as HTMLElement,
      "Mars"
    );
    expect(result).toMatchObject({ filled: false, reason: "no matching option" });
  });

  it("also handles top-level role=listbox", async () => {
    document.body.innerHTML = `
      <div id="l" role="listbox">
        <div role="option">Yes</div>
        <div role="option">No</div>
      </div>
    `;
    let clicked = "";
    document.querySelectorAll<HTMLElement>('[role="option"]').forEach((o) => {
      o.addEventListener("click", () => {
        clicked = o.textContent ?? "";
      });
    });
    const result = await fillAriaWidget(
      document.getElementById("l") as HTMLElement,
      "No"
    );
    expect(result).toMatchObject({ filled: true });
    expect(clicked).toBe("No");
  });

  it("scopes options to aria-controls target so cross-listbox pollution is avoided", async () => {
    document.body.innerHTML = `
      <div id="c1" role="combobox" aria-controls="popup1"></div>
      <div id="popup1"><div role="option">Australia</div></div>
      <div id="c2" role="combobox" aria-controls="popup2"></div>
      <div id="popup2"><div role="option">Indonesia</div></div>
    `;
    const c1 = document.getElementById("c1") as HTMLElement;
    let clickedIn1 = "";
    let clickedIn2 = "";
    document
      .querySelectorAll<HTMLElement>("#popup1 [role='option']")
      .forEach((o) =>
        o.addEventListener("click", () => {
          clickedIn1 = o.textContent ?? "";
        })
      );
    document
      .querySelectorAll<HTMLElement>("#popup2 [role='option']")
      .forEach((o) =>
        o.addEventListener("click", () => {
          clickedIn2 = o.textContent ?? "";
        })
      );

    const result = await fillAriaWidget(c1, "Indonesia");

    expect(result).toMatchObject({
      filled: false,
      reason: "no matching option",
    });
    expect(clickedIn1).toBe("");
    expect(clickedIn2).toBe("");
  });
});

describe("fillAriaListbox — hardened", () => {
  it("confirms success when the toggle label updates to the chosen value", async () => {
    document.body.innerHTML = `
      <div id="c" role="combobox" aria-controls="m">
        <span class="air3-dropdown-toggle-label">Select a Country</span>
      </div>
      <div id="m">
        <div role="option">Australia</div>
        <div role="option">Austria</div>
      </div>
    `;
    const combobox = document.getElementById("c") as HTMLElement;
    const label = combobox.querySelector(".air3-dropdown-toggle-label") as HTMLElement;
    document.querySelectorAll<HTMLElement>('#m [role="option"]').forEach((o) => {
      o.addEventListener("click", () => {
        label.textContent = o.textContent;
      });
    });

    const result = await fillAriaWidget(combobox, "Australia");

    expect(result).toMatchObject({ filled: true });
    expect(label.textContent).toBe("Australia");
  });

  it("opens via a pointer/mouse sequence, not just .click()", async () => {
    document.body.innerHTML = `
      <div id="c" role="combobox" aria-controls="m"><span class="lbl">x</span></div>
      <div id="m"><div role="option">Australia</div></div>
    `;
    const combobox = document.getElementById("c") as HTMLElement;
    const seen: string[] = [];
    for (const t of ["pointerdown", "mousedown", "click"]) {
      combobox.addEventListener(t, () => seen.push(t));
    }

    await fillAriaWidget(combobox, "Australia");

    expect(seen).toContain("pointerdown");
    expect(seen).toContain("mousedown");
    expect(seen).toContain("click");
  });
});
