import { describe, it, expect, beforeEach } from "vitest";
import { scanFields } from "./form-scanner";

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

describe("scanFields", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("extracts labels from <label for=elementId> for a well-labeled form", () => {
    setBody(`
      <form>
        <label for="fn">First name</label>
        <input id="fn" name="firstName" type="text" />
        <label for="em">Email address</label>
        <input id="em" name="email" type="email" />
        <label for="ph">Phone</label>
        <input id="ph" name="phone" type="tel" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields).toHaveLength(3);
    expect(fields[0]?.label).toBe("First name");
    expect(fields[1]?.label).toBe("Email address");
    expect(fields[2]?.label).toBe("Phone");
  });

  it("extracts labels from an ancestor <label>", () => {
    setBody(`
      <form>
        <label>Email <input type="email" name="email" /></label>
      </form>
    `);
    const fields = scanFields(document);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.label).toBe("Email");
  });

  it("falls back to aria-label", () => {
    setBody(`
      <form>
        <input type="tel" aria-label="Phone number" name="phone" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields[0]?.label).toBe("Phone number");
  });

  it("resolves aria-labelledby IDs into a joined label", () => {
    setBody(`
      <form>
        <span id="lbl-a">Date</span>
        <span id="lbl-b">of birth</span>
        <input type="text" name="dob" aria-labelledby="lbl-a lbl-b" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields[0]?.label).toBe("Date of birth");
  });

  it("falls back to placeholder and reports it separately too", () => {
    setBody(`
      <form>
        <input type="email" name="email" placeholder="Email" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields[0]?.label).toBe("Email");
    expect(fields[0]?.placeholder).toBe("Email");
  });

  it("extracts labels from the preceding table cell in the same row", () => {
    setBody(`
      <form>
        <table>
          <tr>
            <td>First Name</td>
            <td><input type="text" name="first" /></td>
          </tr>
          <tr>
            <td>Credit Card Number</td>
            <td><input type="text" name="cc" /></td>
          </tr>
        </table>
      </form>
    `);
    const fields = scanFields(document);
    expect(fields[0]?.label).toBe("First Name");
    expect(fields[1]?.label).toBe("Credit Card Number");
  });

  it("keeps the visible label even when the HTML name is misleading", () => {
    setBody(`
      <form>
        <label for="city">City</label>
        <input id="city" name="address-line1" autocomplete="address-line1" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields[0]?.label).toBe("City");
    expect(fields[0]?.autocomplete).toBe("address-line1");
  });

  it("chooses the nearest explicit label when several labels point at the same bad id", () => {
    setBody(`
      <form>
        <label for="address-line1">Street address</label>
        <input id="street" name="street" />
        <label for="address-line1">City</label>
        <input id="address-line1" name="address-line1" autocomplete="address-line1" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields[1]?.selector).toBe("#address-line1");
    expect(fields[1]?.label).toBe("City");
    expect(fields[1]?.autocomplete).toBe("address-line1");
  });

  it("uses nearby left-of-field text when markup does not connect the label", () => {
    setBody(`
      <form>
        <div id="title-label">Title</div><input id="title" />
        <div id="city-label">City</div><input id="city" name="address-line1" autocomplete="address-line1" />
      </form>
    `);
    setRect("#title-label", { left: 100, top: 20, width: 70, height: 20 });
    setRect("#title", { left: 220, top: 15, width: 180, height: 32 });
    setRect("#city-label", { left: 100, top: 70, width: 70, height: 20 });
    setRect("#city", { left: 220, top: 65, width: 180, height: 32 });

    const fields = scanFields(document);
    expect(fields[0]?.label).toBe("Title");
    expect(fields[1]?.label).toBe("City");
    expect(fields[1]?.autocomplete).toBe("address-line1");
  });

  it("does not use previous form controls or select option text as labels", () => {
    setBody(`
      <form>
        <select id="month">
          <option>Month</option>
          <option>Jan</option>
          <option>Feb</option>
        </select>
        <select id="day">
          <option>Day</option>
          <option>01</option>
          <option>02</option>
        </select>
      </form>
    `);

    const fields = scanFields(document);
    expect(fields[0]?.label).toBe("");
    expect(fields[1]?.label).toBe("");
  });

  it("returns empty-string label when nothing identifies the field", () => {
    setBody(`
      <form>
        <input type="text" name="mystery" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields[0]?.label).toBe("");
  });

  it("excludes hidden inputs (type=hidden, display:none, visibility:hidden, aria-hidden, zero-size)", () => {
    setBody(`
      <form>
        <input type="hidden" name="csrf" value="abc" />
        <input type="text" name="a" style="display:none" />
        <input type="text" name="b" style="visibility:hidden" />
        <input type="text" name="c" aria-hidden="true" />
        <input type="text" name="visible" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.selector).toBe('[name="visible"]');
  });

  it("excludes disabled and readonly inputs", () => {
    setBody(`
      <form>
        <input type="text" name="a" disabled />
        <input type="text" name="b" readonly />
        <input type="text" name="c" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.selector).toBe('[name="c"]');
  });

  it("excludes buttons (submit, reset, button, <button>)", () => {
    setBody(`
      <form>
        <input type="submit" value="Submit" />
        <input type="reset" value="Reset" />
        <input type="button" value="Click" />
        <button type="submit">Go</button>
        <input type="text" name="real" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.selector).toBe('[name="real"]');
  });

  it("captures <select> with its option text values", () => {
    setBody(`
      <form>
        <label for="state">State</label>
        <select id="state" name="state">
          <option value="">-- pick --</option>
          <option value="vic">Victoria</option>
          <option value="nsw">New South Wales</option>
        </select>
      </form>
    `);
    const fields = scanFields(document);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.type).toBe("select");
    expect(fields[0]?.options).toEqual(["-- pick --", "Victoria", "New South Wales"]);
  });

  it("groups radios with the same name into a single field with options from values", () => {
    setBody(`
      <form>
        <label>Subscribe?</label>
        <label><input type="radio" name="sub" value="yes" /> Yes</label>
        <label><input type="radio" name="sub" value="no" /> No</label>
      </form>
    `);
    const fields = scanFields(document);
    const radioFields = fields.filter((f) => f.type === "radio");
    expect(radioFields).toHaveLength(1);
    expect(radioFields[0]?.options).toEqual(["yes", "no"]);
  });

  it("treats a single checkbox as a single field with type=checkbox", () => {
    setBody(`
      <form>
        <label for="tos">I agree to the terms</label>
        <input type="checkbox" id="tos" name="tos" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.type).toBe("checkbox");
    expect(fields[0]?.label).toBe("I agree to the terms");
  });

  it("captures <textarea> as type=textarea", () => {
    setBody(`
      <form>
        <label for="bio">About you</label>
        <textarea id="bio" name="bio"></textarea>
      </form>
    `);
    const fields = scanFields(document);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.type).toBe("textarea");
    expect(fields[0]?.label).toBe("About you");
  });

  it("propagates the required attribute (and aria-required)", () => {
    setBody(`
      <form>
        <input type="text" name="a" required />
        <input type="text" name="b" aria-required="true" />
        <input type="text" name="c" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields[0]?.required).toBe(true);
    expect(fields[1]?.required).toBe(true);
    expect(fields[2]?.required).toBe(false);
  });

  it("assigns stable IDs in scan order starting from 0", () => {
    setBody(`
      <form>
        <input type="text" name="a" />
        <input type="text" name="b" />
        <input type="text" name="c" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields.map((f) => f.id)).toEqual([0, 1, 2]);
  });

  it("prefers #id, then [name], then nth-of-type fallback for selector", () => {
    setBody(`
      <form>
        <input id="theId" type="text" />
        <input name="uniqueName" type="text" />
        <input name="dup" type="text" />
        <input name="dup" type="text" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields[0]?.selector).toBe("#theId");
    expect(fields[1]?.selector).toBe('[name="uniqueName"]');
    expect(fields[2]?.selector).not.toBe('[name="dup"]');
    expect(fields[3]?.selector).not.toBe('[name="dup"]');
    for (const f of fields) {
      expect(document.querySelector(f.selector)).not.toBeNull();
    }
  });

  it("uses data-testid when id is absent and name is not unique", () => {
    setBody(`
      <form>
        <input name="dup" type="text" data-testid="primary-input" />
        <input name="dup" type="text" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields[0]?.selector).toBe('[data-testid="primary-input"]');
  });

  it("skips inputs inside a <template>", () => {
    setBody(`
      <form>
        <input type="text" name="visible" />
        <template>
          <input type="text" name="templated" />
        </template>
      </form>
    `);
    const fields = scanFields(document);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.selector).toBe('[name="visible"]');
  });

  it("includes inputs with no type attribute as text-like", () => {
    setBody(`
      <form>
        <input name="implicit" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.type).toBe("text");
  });

  it("excludes file inputs", () => {
    setBody(`
      <form>
        <input type="file" name="resume" />
        <input type="text" name="ok" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.selector).toBe('[name="ok"]');
  });

  it("placeholder is null when the input has no placeholder attribute", () => {
    setBody(`
      <form>
        <label for="x">X</label>
        <input id="x" type="text" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields[0]?.placeholder).toBeNull();
  });

  it("escapes special characters in ID selector for consistency", () => {
    setBody(`
      <form>
        <input id="field-with-dash" type="text" name="test" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields[0]?.selector).toBe("#field-with-dash");
    const el = document.querySelector(fields[0]?.selector ?? "");
    expect(el).not.toBeNull();
  });

  it("escapes double quotes in name attribute selector", () => {
    setBody(`
      <form>
        <input name='foo"bar' type="text" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields).toHaveLength(1);
    const el = document.querySelector(fields[0]?.selector ?? "");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("name")).toBe('foo"bar');
  });

  it("escapes double quotes in data-testid attribute selector", () => {
    setBody(`
      <form>
        <input type="text" name="dup" data-testid='test"id' />
        <input type="text" name="dup" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields).toHaveLength(2);
    const el = document.querySelector(fields[0]?.selector ?? "");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("data-testid")).toBe('test"id');
  });

  it("escapes backslashes in attribute selectors", () => {
    setBody(`
      <form>
        <input name='foo\\bar' type="text" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields).toHaveLength(1);
    const el = document.querySelector(fields[0]?.selector ?? "");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("name")).toBe('foo\\bar');
  });

  it("includes the autocomplete attribute when present", () => {
    setBody(`
      <form>
        <input id="fn" autocomplete="given-name" />
        <input id="em" autocomplete="email" type="email" />
        <input id="nope" />
      </form>
    `);
    const fields = scanFields(document);
    expect(fields[0]?.autocomplete).toBe("given-name");
    expect(fields[1]?.autocomplete).toBe("email");
    expect(fields[2]?.autocomplete).toBeUndefined();
  });

  it("normalizes autocomplete attribute (trims, lowercases tokens)", () => {
    setBody(`
      <input id="fn" autocomplete="  Given-Name  " />
    `);
    const fields = scanFields(document);
    expect(fields[0]?.autocomplete).toBe("given-name");
  });

  describe("rich-text editor auxiliary inputs", () => {
    it("skips inputs inside CKEditor wrappers", () => {
      setBody(`
        <form>
          <input id="email" type="email" />
          <div class="cke_editable">
            <input class="cke_clipboard" />
            <textarea class="cke_textarea_inline"></textarea>
          </div>
        </form>
      `);
      const fields = scanFields(document);
      expect(fields.map((f) => f.selector)).toEqual(["#email"]);
    });

    it("skips inputs inside Quill containers", () => {
      setBody(`
        <form>
          <input id="email" type="email" />
          <div class="ql-container">
            <textarea class="ql-clipboard"></textarea>
          </div>
        </form>
      `);
      const fields = scanFields(document);
      expect(fields.map((f) => f.selector)).toEqual(["#email"]);
    });

    it("skips Summernote, TinyMCE, and Trumbowyg auxiliary inputs", () => {
      setBody(`
        <form>
          <input id="email" type="email" />
          <div class="note-editor"><textarea class="note-codable"></textarea></div>
          <div class="tox-tinymce"><input class="tox-some-input" /></div>
          <div class="trumbowyg-box"><textarea class="trumbowyg-textarea"></textarea></div>
        </form>
      `);
      const fields = scanFields(document);
      expect(fields.map((f) => f.selector)).toEqual(["#email"]);
    });

    it("skips inputs inside contenteditable=true wrappers", () => {
      setBody(`
        <form>
          <input id="email" type="email" />
          <div contenteditable="true">
            <textarea name="rte-clipboard"></textarea>
          </div>
        </form>
      `);
      const fields = scanFields(document);
      expect(fields.map((f) => f.selector)).toEqual(["#email"]);
    });

    it("skips inputs whose own class starts with cke_/ql-/mce_/tox-/etc", () => {
      setBody(`
        <form>
          <input id="email" type="email" />
          <input class="cke_input" />
          <input class="ql-something" />
          <input class="mce_thing" />
          <input class="tox-edit" />
        </form>
      `);
      const fields = scanFields(document);
      expect(fields.map((f) => f.selector)).toEqual(["#email"]);
    });
  });
});
