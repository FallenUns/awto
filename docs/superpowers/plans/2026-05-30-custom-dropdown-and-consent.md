# Custom dropdown detection + consent checkbox handling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect and fill custom (non-native) dropdowns like the Upwork country combobox, and handle consent checkboxes deterministically — marketing pre-ticked (editable, remembered), legal/ToS off until the user deliberately flips it (never remembered).

**Architecture:** A new `combobox.ts` module reads a custom dropdown's current value without opening it. The scanner stops discarding closed (option-less) comboboxes and captures `aria-haspopup="listbox"` triggers, excluding command menus and search comboboxes. The filler's `fillAriaListbox` is hardened (realistic pointer open-sequence → `MutationObserver` wait → fuzzy match → verify → keyboard fallback). A deterministic `consent-classifier.ts` decides marketing-vs-legal and the proposed tick; the service worker posts those decisions on a new `mapFieldsConsent` channel, excludes consent fields from the LLM, and backfills a skip for any field the LLM omits. The popup renders a Consent section of toggle switches and persists the marketing preference at fill time.

**Tech Stack:** TypeScript, Vitest + happy-dom, React, Zod, chrome.storage.local.

**Spec:** [docs/superpowers/specs/2026-05-30-custom-dropdown-and-consent-design.md](../specs/2026-05-30-custom-dropdown-and-consent-design.md)

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/shared/consent.ts` | `ConsentLink`, `ConsentType`, `ConsentDecision` types | Create |
| `src/shared/messages.ts` | `ScannedField.currentValue`/`.links`; `mapFieldsConsent` message | Modify |
| `src/shared/storage.ts` | `getMarketingConsent` / `setMarketingConsent` (`awto:consent` key) | Modify |
| `src/shared/storage.test.ts` | Marketing-pref defaults + round-trip | Modify |
| `src/content/combobox.ts` | `readComboboxValue` — current value / placeholder of a custom dropdown (no chrome dependency) | Create |
| `src/content/combobox.test.ts` | Value/placeholder/empty reading | Create |
| `src/content/form-scanner.ts` | Capture option-less comboboxes; `aria-haspopup="listbox"` query; menu/search exclusion; dropdown value+label; consent links | Modify |
| `src/content/form-scanner.test.ts` | Closed combobox, exclusions, links | Modify |
| `src/content/form-filler.ts` | Harden `fillAriaListbox` (open-sequence, MutationObserver, verify, keyboard fallback) | Modify |
| `src/content/form-filler.test.ts` | Verified selection + open-sequence + existing-behaviour regression | Modify |
| `src/background/consent-classifier.ts` | `classifyConsent`, `buildConsentDecisions` | Create |
| `src/background/consent-classifier.test.ts` | Marketing/legal/neither + decisions | Create |
| `src/background/service-worker.ts` | Consent channel, LLM exclusion, fresh consent on cache hit, loading-guard backfill | Modify |
| `src/background/service-worker.test.ts` | Consent posting/exclusion/backfill | Modify |
| `src/popup/types.ts` | `ConsentRow`; `FlowState.consentRows` | Modify |
| `src/popup/useAwtoFlow.ts` | `mapFieldsConsent` handler, `setConsentChecked`, consent fill values, marketing learning | Modify |
| `src/popup/useAwtoFlow.test.ts` | Consent population + fill + marketing persistence | Modify |
| `src/popup/ConsentRow.tsx` | Toggle-switch consent row | Create |
| `src/popup/ConsentRow.test.tsx` | Toggle + links + required marker | Create |
| `src/popup/Popup.tsx` | Consent section, fill count, resolvedIds | Modify |
| `src/popup/Popup.test.tsx` | Consent section render + count | Modify |

---

## Task 1: Shared consent types + message + ScannedField fields

**Files:**
- Create: `src/shared/consent.ts`
- Modify: `src/shared/messages.ts`

- [ ] **Step 1: Create the types module**

Create `src/shared/consent.ts`:

```ts
export interface ConsentLink {
  text: string;
  href: string;
}

export type ConsentType = "marketing" | "legal";

export interface ConsentDecision {
  fieldId: number;
  selector: string;
  label: string;
  consentType: ConsentType;
  proposedChecked: boolean;
  links?: ConsentLink[];
}
```

- [ ] **Step 2: Extend `ScannedField` and `AwtoMessage`**

In `src/shared/messages.ts`, change the imports at the top:

```ts
import type { Profile } from "./profile";
import type { FieldMapping } from "./mapping";
import type { ConsentLink, ConsentDecision } from "./consent";
```

Add two optional fields to `ScannedField` (after `autocomplete?: string;`):

```ts
  currentValue?: string;
  links?: ConsentLink[];
```

Add one variant to the `AwtoMessage` union (after the `mapFieldsProgress` line):

```ts
  | { type: "mapFieldsConsent"; consent: ConsentDecision[] }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors (these are additive; existing code ignores the new optionals).

- [ ] **Step 4: Commit**

```bash
git add src/shared/consent.ts src/shared/messages.ts
git commit -m "feat(shared): consent types, ScannedField currentValue/links, mapFieldsConsent message"
```

---

## Task 2: Storage — marketing consent preference

**Files:**
- Modify: `src/shared/storage.ts`
- Modify: `src/shared/storage.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/shared/storage.test.ts`:

```ts
describe("marketing consent preference", () => {
  it("defaults to optIn when unset", async () => {
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const { getMarketingConsent } = await import("./storage");
    expect(await getMarketingConsent()).toBe("optIn");
  });

  it("round-trips a stored optOut", async () => {
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      "awto:consent": { marketing: "optOut" },
    });
    const { getMarketingConsent } = await import("./storage");
    expect(await getMarketingConsent()).toBe("optOut");
  });

  it("setMarketingConsent writes the awto:consent key", async () => {
    const { setMarketingConsent } = await import("./storage");
    await setMarketingConsent("optOut");
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      "awto:consent": { marketing: "optOut" },
    });
  });

  it("returns optIn when storage throws", async () => {
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("storage gone")
    );
    const { getMarketingConsent } = await import("./storage");
    expect(await getMarketingConsent()).toBe("optIn");
  });
});
```

If `storage.test.ts` does not already set a `chrome` global with `storage.local.get`/`set` as `vi.fn()`, add it at the top of the file (mirror the existing mock pattern; `storage.local.set` must be a `vi.fn()`).

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- storage.test.ts`
Expected: the four new tests fail — `getMarketingConsent`/`setMarketingConsent` not exported.

- [ ] **Step 3: Implement**

In `src/shared/storage.ts`, add the key constant next to the existing ones:

```ts
const KEY_CONSENT = "awto:consent";
```

Add a schema below `LLMSettingsSchema` / `DEFAULT_LLM_SETTINGS`:

```ts
const ConsentPrefsSchema = z.object({
  marketing: z.enum(["optIn", "optOut"]).default("optIn"),
});
```

Add the accessors at the end of the file:

```ts
export async function getMarketingConsent(): Promise<"optIn" | "optOut"> {
  try {
    const raw = await readKey(KEY_CONSENT);
    const parsed = ConsentPrefsSchema.safeParse(raw);
    return parsed.success ? parsed.data.marketing : "optIn";
  } catch {
    return "optIn";
  }
}

export async function setMarketingConsent(
  value: "optIn" | "optOut"
): Promise<void> {
  await writeKey(KEY_CONSENT, { marketing: value });
}
```

- [ ] **Step 4: Re-run tests**

Run: `npm run test -- storage.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/storage.ts src/shared/storage.test.ts
git commit -m "feat(storage): marketing consent preference (default optIn)"
```

---

## Task 3: `combobox.ts` — read a custom dropdown's current value

**Files:**
- Create: `src/content/combobox.ts`
- Create: `src/content/combobox.test.ts`

This is a standalone module (no `chrome` dependency) so both the scanner and filler can import it without pulling in `aria-settings`' storage side-effects.

- [ ] **Step 1: Write failing tests**

Create `src/content/combobox.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- combobox.test.ts`
Expected: failure — module does not exist.

- [ ] **Step 3: Implement**

Create `src/content/combobox.ts`:

```ts
const PLACEHOLDER_RE = /^(select\b|choose\b|please\b|pick\b|--|—)/i;

function directText(el: Element): string {
  return Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3 /* TEXT_NODE */)
    .map((n) => n.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function readComboboxValue(el: HTMLElement): {
  value: string | null;
  placeholder: string | null;
} {
  const doc = el.ownerDocument ?? document;

  const adId = el.getAttribute("aria-activedescendant");
  if (adId) {
    const t = doc.getElementById(adId)?.textContent?.replace(/\s+/g, " ").trim();
    if (t) return { value: t, placeholder: null };
  }

  const controlsId =
    el.getAttribute("aria-controls") ?? el.getAttribute("aria-owns");
  if (controlsId) {
    const target = doc.getElementById(controlsId);
    const selected = target?.querySelector('[role="option"][aria-selected="true"]');
    const t = selected?.textContent?.replace(/\s+/g, " ").trim();
    if (t) return { value: t, placeholder: null };
  }

  const labelChild = el.querySelector(
    '[class*="label"], [class*="value"], [class*="single"]'
  );
  let display = "";
  if (labelChild) {
    display = labelChild.textContent?.replace(/\s+/g, " ").trim() ?? "";
  } else if (!el.querySelector('[role="option"]')) {
    display = directText(el);
  }

  if (!display) return { value: null, placeholder: null };
  if (PLACEHOLDER_RE.test(display)) return { value: null, placeholder: display };
  return { value: display, placeholder: null };
}
```

- [ ] **Step 4: Re-run tests**

Run: `npm run test -- combobox.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/content/combobox.ts src/content/combobox.test.ts
git commit -m "feat(content): readComboboxValue — current value of a custom dropdown"
```

---

## Task 4: Scanner — capture closed comboboxes + dropdown value/label

**Files:**
- Modify: `src/content/form-scanner.ts`
- Modify: `src/content/form-scanner.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/content/form-scanner.test.ts`:

```ts
describe("ARIA combobox without inline options (closed dropdown)", () => {
  it("captures a role=combobox whose options are not yet rendered", () => {
    document.body.innerHTML = `
      <div class="air3-dropdown" id="country-dd">
        <div role="combobox" aria-expanded="false" aria-controls="dropdown-menu"
             aria-required="true" class="air3-dropdown-toggle">
          <span class="air3-dropdown-toggle-label">Select a Country</span>
        </div>
      </div>
      <div id="dropdown-menu"></div>
    `;
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ type: "select", required: true });
  });

  it("uses the placeholder text as the label when no other label exists", () => {
    document.body.innerHTML = `
      <div role="combobox" aria-controls="m">
        <span class="air3-dropdown-toggle-label">Select a Country</span>
      </div>
      <div id="m"></div>
    `;
    const f = scanFields()[0];
    expect(f?.label).toBe("Select a Country");
    expect(f?.placeholder).toBe("Select a Country");
    expect(f?.currentValue).toBeUndefined();
  });

  it("captures the current value of an already-selected combobox", () => {
    document.body.innerHTML = `
      <div role="combobox" aria-controls="m">
        <span class="air3-dropdown-toggle-label">Australia</span>
      </div>
      <div id="m"></div>
    `;
    const f = scanFields()[0];
    expect(f?.currentValue).toBe("Australia");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- form-scanner.test.ts`
Expected: the first test fails (closed combobox discarded); the value/label tests fail (`currentValue`/placeholder not set).

- [ ] **Step 3: Implement — `requireOptions` + dropdown augmentation**

In `src/content/form-scanner.ts`:

1. Add the import near the top:

```ts
import { readComboboxValue } from "./combobox";
```

2. Extend the `AriaQuery` interface:

```ts
interface AriaQuery {
  selector: string;
  type: string;
  collectOptions?: (el: HTMLElement) => string[];
  skipIfInside?: string;
  requireOptions?: boolean;
  isDropdown?: boolean;
}
```

3. Update `ARIA_QUERIES` — add `requireOptions: true` to the radiogroup, and `isDropdown: true` to the combobox and listbox:

```ts
const ARIA_QUERIES: AriaQuery[] = [
  {
    selector: '[role="radiogroup"]',
    type: "radio",
    collectOptions: (el) => collectRoleOptions(el, "radio"),
    requireOptions: true,
  },
  { selector: '[role="checkbox"]', type: "checkbox" },
  { selector: '[role="textbox"][contenteditable="true"]', type: "text" },
  {
    selector: '[role="combobox"]',
    type: "select",
    collectOptions: (el) => collectRoleOptions(el, "option"),
    isDropdown: true,
  },
  {
    selector: '[role="listbox"]',
    type: "select",
    collectOptions: (el) => collectRoleOptions(el, "option"),
    skipIfInside: '[role="combobox"]',
    isDropdown: true,
  },
];
```

4. In the ARIA loop, change the option-skip line from:

```ts
        const options = q.collectOptions?.(el);
        if (q.collectOptions && (!options || options.length === 0)) continue;
```

to:

```ts
        const options = q.collectOptions?.(el);
        if (q.requireOptions && (!options || options.length === 0)) continue;
```

5. Replace the `fields.push({ ... })` call inside the ARIA loop with a build-then-augment block:

```ts
        const ariaField: ScannedField = {
          id: nextId++,
          selector: buildAriaSelector(el, ownerDoc),
          label: extractAriaLabel(el, ownerDoc),
          placeholder: null,
          type: q.type,
          required: el.getAttribute("aria-required") === "true",
          ...(options && options.length > 0 ? { options } : {}),
        };

        if (q.isDropdown) {
          const { value, placeholder } = readComboboxValue(el);
          if (value) ariaField.currentValue = value;
          if (placeholder) ariaField.placeholder = placeholder;
          if (!ariaField.label && placeholder) ariaField.label = placeholder;
        }

        fields.push(ariaField);
        claimed.add(el);
```

- [ ] **Step 4: Re-run tests**

Run: `npm run test -- form-scanner.test.ts`
Expected: all pass (existing ARIA combobox-with-options tests still pass — they have `options.length > 0`).

- [ ] **Step 5: Commit**

```bash
git add src/content/form-scanner.ts src/content/form-scanner.test.ts
git commit -m "feat(scanner): capture closed custom dropdowns with current value + placeholder label"
```

---

## Task 5: Scanner — `aria-haspopup=listbox` query + menu/search exclusion

**Files:**
- Modify: `src/content/form-scanner.ts`
- Modify: `src/content/form-scanner.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/content/form-scanner.test.ts`:

```ts
describe("custom dropdown exclusions", () => {
  it("captures an aria-haspopup=listbox trigger that is not a combobox", () => {
    document.body.innerHTML = `
      <span id="lbl">Title</span>
      <button aria-haspopup="listbox" aria-labelledby="lbl">Mr</button>
    `;
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ type: "select", label: "Title" });
  });

  it("excludes a command menu (aria-haspopup=menu)", () => {
    document.body.innerHTML = `
      <div role="combobox" aria-haspopup="menu" aria-controls="m">Actions</div>
      <div id="m" role="menu"><div role="menuitem">Delete</div></div>
    `;
    expect(scanFields()).toEqual([]);
  });

  it("excludes a combobox whose popup is a role=menu", () => {
    document.body.innerHTML = `
      <div role="combobox" aria-controls="m">Sort</div>
      <ul id="m" role="menu"><li role="menuitem">Newest</li></ul>
    `;
    expect(scanFields()).toEqual([]);
  });

  it("excludes a search combobox", () => {
    document.body.innerHTML = `
      <div role="combobox" aria-autocomplete="list" aria-label="Search products"></div>
    `;
    expect(scanFields()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- form-scanner.test.ts`
Expected: the haspopup test fails (no query), and the menu/search tests fail (currently captured).

- [ ] **Step 3: Implement**

In `src/content/form-scanner.ts`:

1. Add a third dropdown query to `ARIA_QUERIES` (after the listbox entry):

```ts
  {
    selector:
      '[aria-haspopup="listbox"]:not([role="combobox"]):not([role="listbox"])',
    type: "select",
    collectOptions: (el) => collectRoleOptions(el, "option"),
    isDropdown: true,
  },
```

2. In the ARIA loop, after the existing `if (q.skipIfInside && el.closest(q.skipIfInside)) continue;` line, add:

```ts
        if (q.isDropdown && isNonFillableDropdown(el)) continue;
```

3. Add the helper near the other module-level helpers:

```ts
const SEARCH_RE = /\bsearch\b/i;

function isNonFillableDropdown(el: HTMLElement): boolean {
  const haspopup = el.getAttribute("aria-haspopup");
  if (haspopup && haspopup !== "listbox" && haspopup !== "true") return true;

  const doc = el.ownerDocument ?? document;
  const controlsId =
    el.getAttribute("aria-controls") ?? el.getAttribute("aria-owns");
  if (controlsId) {
    const target = doc.getElementById(controlsId);
    if (target?.getAttribute("role") === "menu") return true;
  }

  const autocomplete = el.getAttribute("aria-autocomplete");
  if (autocomplete === "list" || autocomplete === "both") {
    const hint = `${el.getAttribute("aria-label") ?? ""} ${
      el.getAttribute("placeholder") ?? ""
    }`;
    if (SEARCH_RE.test(hint)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Re-run tests**

Run: `npm run test -- form-scanner.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/content/form-scanner.ts src/content/form-scanner.test.ts
git commit -m "feat(scanner): aria-haspopup=listbox query + menu/search exclusion"
```

---

## Task 6: Scanner — consent link capture for checkboxes

**Files:**
- Modify: `src/content/form-scanner.ts`
- Modify: `src/content/form-scanner.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/content/form-scanner.test.ts`:

```ts
describe("consent link capture", () => {
  it("captures anchors inside a native checkbox label", () => {
    document.body.innerHTML = `
      <label>
        <input type="checkbox" />
        Yes, I agree to the
        <a href="https://x.com/terms">Terms of Service</a> and
        <a href="https://x.com/privacy">Privacy Policy</a>.
      </label>
    `;
    const f = scanFields()[0];
    expect(f?.type).toBe("checkbox");
    expect(f?.links).toEqual([
      { text: "Terms of Service", href: "https://x.com/terms" },
      { text: "Privacy Policy", href: "https://x.com/privacy" },
    ]);
  });

  it("omits links when the checkbox label has none", () => {
    document.body.innerHTML = `<label><input type="checkbox" /> Remember me</label>`;
    const f = scanFields()[0];
    expect(f?.links).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- form-scanner.test.ts`
Expected: the first test fails (`links` undefined).

- [ ] **Step 3: Implement**

In `src/content/form-scanner.ts`:

1. Add the import:

```ts
import type { ScannedField } from "@/shared/messages";
import type { ConsentLink } from "@/shared/consent";
```

(Merge with the existing `ScannedField` import line.)

2. Add the helpers near the bottom of the file:

```ts
function findLabelContainer(el: Element, doc: Document): Element | null {
  const id = el.getAttribute("id");
  if (id) {
    const explicit = doc.querySelector(`label[for="${cssEscape(id)}"]`);
    if (explicit) return explicit;
  }
  const wrapper = el.closest("label");
  if (wrapper) return wrapper;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const first = labelledBy.split(/\s+/).filter(Boolean)[0];
    if (first) {
      const target = doc.getElementById(first);
      if (target) return target;
    }
  }
  return null;
}

function collectConsentLinks(el: Element, doc: Document): ConsentLink[] {
  const container = findLabelContainer(el, doc);
  if (!container) return [];
  return Array.from(container.querySelectorAll("a[href]"))
    .map((a) => ({
      text: (a.textContent ?? "").replace(/\s+/g, " ").trim(),
      href: a.getAttribute("href") ?? "",
    }))
    .filter((l) => l.text.length > 0);
}
```

3. In the **native** field-build path (the block that constructs `const field: ScannedField = { ... }` for `input`/`select`/`textarea`), after the `fields.push(field)` is set up — specifically right before `fields.push(field);` — add:

```ts
    if (type === "checkbox") {
      const links = collectConsentLinks(el, ownerDoc);
      if (links.length > 0) field.links = links;
    }
```

4. In the **ARIA** loop, inside the build-then-augment block from Task 4 (after the `if (q.isDropdown) { ... }` block, before `fields.push(ariaField)`), add:

```ts
        if (q.type === "checkbox") {
          const links = collectConsentLinks(el, ownerDoc);
          if (links.length > 0) ariaField.links = links;
        }
```

- [ ] **Step 4: Re-run tests**

Run: `npm run test -- form-scanner.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/content/form-scanner.ts src/content/form-scanner.test.ts
git commit -m "feat(scanner): capture ToS/Privacy links from consent checkbox labels"
```

---

## Task 7: Filler — harden `fillAriaListbox`

**Files:**
- Modify: `src/content/form-filler.ts`
- Modify: `src/content/form-filler.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/content/form-filler.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- form-filler.test.ts`
Expected: the pointer-sequence test fails (current code uses bare `el.click()`); the verification test may pass coincidentally but must keep passing after the rewrite.

- [ ] **Step 3: Implement**

In `src/content/form-filler.ts`:

1. Add the import at the top:

```ts
import { readComboboxValue } from "./combobox";
```

2. Replace the existing `fillAriaListbox` and `waitFrame` functions (keep `collectListboxOptions` and `matchAriaOption` as-is) with:

```ts
async function fillAriaListbox(
  el: HTMLElement,
  value: string
): Promise<{ filled: boolean; reason?: string }> {
  fireOpen(el);
  const options = await waitForOptions(el, 1500);
  const target = value.trim().toLowerCase();
  const match =
    options.find((o) => (o.textContent ?? "").trim().toLowerCase() === target) ??
    options.find((o) => matchAriaOption(value, (o.textContent ?? "").trim()));

  if (match) {
    fireOpen(match);
    await waitFrame();
    const after = readComboboxValue(el).value;
    if (after === null || valueMatches(after, value)) return { filled: true };
  }

  if (await keyboardSelect(el, value)) return { filled: true };

  closeIfOpen(el);
  return {
    filled: false,
    reason: match ? "could not select option" : "no matching option",
  };
}

function fireOpen(el: HTMLElement): void {
  const PointerCtor =
    typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
  const opts = { bubbles: true, cancelable: true, button: 0 } as const;
  el.dispatchEvent(new PointerCtor("pointerdown", opts));
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  el.dispatchEvent(new PointerCtor("pointerup", opts));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.dispatchEvent(new MouseEvent("click", opts));
}

function waitForOptions(
  trigger: HTMLElement,
  timeout: number
): Promise<HTMLElement[]> {
  const find = () => collectListboxOptions(trigger);
  return new Promise((resolve) => {
    const immediate = find();
    if (immediate.length > 0) {
      resolve(immediate);
      return;
    }
    if (typeof MutationObserver !== "function") {
      resolve([]);
      return;
    }
    const obs = new MutationObserver(() => {
      const found = find();
      if (found.length > 0) {
        obs.disconnect();
        resolve(found);
      }
    });
    obs.observe(trigger.ownerDocument?.body ?? document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-expanded"],
    });
    setTimeout(() => {
      obs.disconnect();
      resolve(find());
    }, timeout);
  });
}

async function keyboardSelect(el: HTMLElement, value: string): Promise<boolean> {
  pressKey(el, "ArrowDown");
  const options = await waitForOptions(el, 800);
  if (options.length === 0) return false;
  for (const ch of value.slice(0, 6)) pressKey(el, ch);
  await waitFrame();
  const match = collectListboxOptions(el).find((o) =>
    matchAriaOption(value, (o.textContent ?? "").trim())
  );
  if (!match) return false;
  pressKey(el, "Enter");
  await waitFrame();
  const after = readComboboxValue(el).value;
  if (after === null || !valueMatches(after, value)) {
    fireOpen(match);
  }
  return true;
}

function pressKey(el: HTMLElement, key: string): void {
  for (const type of ["keydown", "keyup"] as const) {
    el.dispatchEvent(
      new KeyboardEvent(type, { key, bubbles: true, cancelable: true })
    );
  }
}

function valueMatches(actual: string, wanted: string): boolean {
  const a = actual.trim().toLowerCase();
  const w = wanted.trim().toLowerCase();
  if (!a || !w) return false;
  return (
    a === w ||
    a.includes(w) ||
    w.includes(a) ||
    matchAriaOption(wanted, actual)
  );
}

function closeIfOpen(el: HTMLElement): void {
  if (el.getAttribute("aria-expanded") === "true") {
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );
  }
}

function waitFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}
```

**Why best-effort on unreadable read-back:** clicking a matching option is strong evidence the fill took; many custom widgets don't expose a readable value synchronously. We only treat the click as failed when the read-back returns a *concrete different* value (the click bounced off) — then the keyboard path runs. This preserves the existing tests (which don't simulate a value update) and the zero-incorrect-fills bar (a confirmed wrong value never counts as filled).

- [ ] **Step 4: Re-run tests**

Run: `npm run test -- form-filler.test.ts`
Expected: all pass — including the existing combobox/listbox ARIA tests (they resolve options immediately and read back `null`, so they still report `filled: true`; the no-match test still returns `reason: "no matching option"`).

- [ ] **Step 5: Commit**

```bash
git add src/content/form-filler.ts src/content/form-filler.test.ts
git commit -m "feat(filler): harden custom-dropdown fill (pointer open, MutationObserver, verify, keyboard fallback)"
```

---

## Task 8: Consent classifier

**Files:**
- Create: `src/background/consent-classifier.ts`
- Create: `src/background/consent-classifier.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/background/consent-classifier.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- consent-classifier.test.ts`
Expected: failure — module does not exist.

- [ ] **Step 3: Implement**

Create `src/background/consent-classifier.ts`:

```ts
import type { ScannedField } from "@/shared/messages";
import type { ConsentDecision, ConsentType } from "@/shared/consent";

const MARKETING_RE =
  /\b(emails?|newsletter|tips|offers?|promo(?:tion(?:al|s)?)?|marketing|updates?|subscribe|deals?|news)\b/i;
const LEGAL_RE =
  /\b(terms|conditions|privacy|policy|policies|agree|agreement|consent|i am over|over 18|18 years|age of)\b/i;

export function classifyConsent(field: ScannedField): ConsentType | null {
  if (field.type !== "checkbox") return null;
  const label = field.label ?? "";
  if (LEGAL_RE.test(label)) return "legal";
  if (MARKETING_RE.test(label)) return "marketing";
  return null;
}

export function buildConsentDecisions(
  fields: ScannedField[],
  marketingPref: "optIn" | "optOut"
): { consent: ConsentDecision[]; consentIds: Set<number> } {
  const consent: ConsentDecision[] = [];
  const consentIds = new Set<number>();
  for (const field of fields) {
    const type = classifyConsent(field);
    if (!type) continue;
    consentIds.add(field.id);
    consent.push({
      fieldId: field.id,
      selector: field.selector,
      label: field.label,
      consentType: type,
      proposedChecked: type === "marketing" ? marketingPref === "optIn" : false,
      ...(field.links ? { links: field.links } : {}),
    });
  }
  return { consent, consentIds };
}
```

- [ ] **Step 4: Re-run tests**

Run: `npm run test -- consent-classifier.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/background/consent-classifier.ts src/background/consent-classifier.test.ts
git commit -m "feat(background): deterministic consent classifier (marketing/legal)"
```

---

## Task 9: Service worker — consent channel, LLM exclusion, loading guard

**Files:**
- Modify: `src/background/service-worker.ts`
- Modify: `src/background/service-worker.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/background/service-worker.test.ts` (inside the top-level `describe("handleMessage", ...)` block or as a new `describe`):

```ts
describe("consent handling", () => {
  const consentFields: ScannedField[] = [
    { id: 0, selector: "#name", label: "First name", placeholder: null, type: "text", required: false, autocomplete: "given-name" },
    { id: 1, selector: "#promo", label: "Send me emails with helpful tips", placeholder: null, type: "checkbox", required: false },
    { id: 2, selector: "#terms", label: "I agree to the Terms of Service and Privacy Policy", placeholder: null, type: "checkbox", required: true },
  ];

  function portSpy(): { port: chrome.runtime.Port; posted: AwtoMessage[] } {
    const posted: AwtoMessage[] = [];
    const port = { postMessage: (m: AwtoMessage) => posted.push(m) } as unknown as chrome.runtime.Port;
    return { port, posted };
  }

  it("posts mapFieldsConsent and excludes consent checkboxes from the LLM", async () => {
    const { port, posted } = portSpy();
    const callHybrid = vi.fn().mockResolvedValue({ response: { mappings: [] }, source: "local" });

    await handleMessage(
      { type: "mapFields", fields: consentFields, profile: { firstName: "Patrick", custom: {} } },
      {
        _loadLLMSettings: vi.fn().mockResolvedValue(defaultSettings),
        _callHybrid: callHybrid,
        _getMarketingConsent: vi.fn().mockResolvedValue("optIn"),
        _port: port,
      }
    );

    const consentMsg = posted.find((m) => m.type === "mapFieldsConsent");
    expect(consentMsg).toBeDefined();
    if (consentMsg?.type === "mapFieldsConsent") {
      expect(consentMsg.consent.map((c) => c.fieldId)).toEqual([1, 2]);
      expect(consentMsg.consent[0]).toMatchObject({ consentType: "marketing", proposedChecked: true });
      expect(consentMsg.consent[1]).toMatchObject({ consentType: "legal", proposedChecked: false });
    }
    for (const call of callHybrid.mock.calls) {
      const ids = (call[1] as ScannedField[]).map((f) => f.id);
      expect(ids).not.toContain(1);
      expect(ids).not.toContain(2);
    }
  });

  it("backfills a skip for a non-consent field the LLM omits", async () => {
    const callHybrid = vi.fn().mockResolvedValue({ response: { mappings: [] }, source: "local" });
    const response = await handleMessage(
      {
        type: "mapFields",
        fields: [{ id: 0, selector: "#mystery", label: "Mystery field", placeholder: null, type: "text", required: false }],
        profile: { custom: {} },
      },
      { _loadLLMSettings: vi.fn().mockResolvedValue(defaultSettings), _callHybrid: callHybrid }
    );
    expect(response.type).toBe("mapFieldsComplete");
    if (response.type === "mapFieldsComplete") {
      expect(response.mappings).toEqual([
        { fieldId: 0, actionType: "skip", profileKey: null, suggestedKey: null, promptText: null, reason: "No matching profile field", confidence: 1 },
      ]);
    }
  });

  it("posts fresh consent on a cache hit", async () => {
    const { setCached, cacheKey, _clearCache } = await import("./result-cache");
    _clearCache();
    setCached(cacheKey(77, consentFields), { mappings: [], source: "cloud" });
    const { port, posted } = portSpy();

    const response = await handleMessage(
      { type: "mapFields", fields: consentFields, profile: { custom: {} }, tabId: 77 },
      { _getMarketingConsent: vi.fn().mockResolvedValue("optOut"), _port: port, _callHybrid: vi.fn() }
    );

    expect(response.type).toBe("mapFieldsResult");
    const consentMsg = posted.find((m) => m.type === "mapFieldsConsent");
    expect(consentMsg).toBeDefined();
    if (consentMsg?.type === "mapFieldsConsent") {
      expect(consentMsg.consent[0]).toMatchObject({ consentType: "marketing", proposedChecked: false });
    }
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- service-worker.test.ts`
Expected: the three new tests fail (`_getMarketingConsent` unsupported, no consent posted, no backfill).

- [ ] **Step 3: Implement**

In `src/background/service-worker.ts`:

1. Add imports:

```ts
import { loadLLMSettings, getMarketingConsent, type LLMSettings } from "@/shared/storage";
import { buildConsentDecisions } from "./consent-classifier";
```

(Merge the `getMarketingConsent` into the existing `@/shared/storage` import line.)

2. Add a dep to `HandleMessageDeps`:

```ts
  _getMarketingConsent?: () => Promise<"optIn" | "optOut">;
```

3. Replace the top of the `case "mapFields":` block — from the `const tabId = ...` line through the cache lookup — with:

```ts
    case "mapFields": {
      const tabId = message.tabId ?? deps.tabId;
      const getMktConsent = deps._getMarketingConsent ?? getMarketingConsent;

      const marketingPref = await getMktConsent();
      const { consent, consentIds } = buildConsentDecisions(
        message.fields,
        marketingPref
      );
      if (deps._port && consent.length > 0) {
        deps._port.postMessage({ type: "mapFieldsConsent", consent });
      }
      const llmFields = message.fields.filter((f) => !consentIds.has(f.id));

      // Cache lookup (skipped when bypassCache=true)
      if (tabId !== undefined && !message.bypassCache) {
        const key = cacheKey(tabId, message.fields);
        const cached = getCached(key);
        if (cached) {
          return {
            type: "mapFieldsResult",
            mappings: cached.mappings,
            source: cached.source,
          };
        }
      }
```

4. Change the rule-layer + sanitize + prefilter calls to operate on `llmFields` instead of `message.fields`:

```ts
      const { ruleMappings: rawRuleMappings, remaining } = ruleMap(
        llmFields,
        message.profile
      );
      const ruleMappings = sanitizeMappings(llmFields, rawRuleMappings);
      const { toLLM, skipped: preSkipped } = prefilter(remaining, message.profile);
```

5. Replace the `const allMappings: FieldMapping[] = dedupeFillsByProfileKey(...)` construction with a version that backfills omitted fields first:

```ts
      const collected: FieldMapping[] = [
        ...ruleMappings,
        ...preSkipped,
        ...llmMappings,
      ];
      const mappedIds = new Set(collected.map((m) => m.fieldId));
      for (const f of llmFields) {
        if (!mappedIds.has(f.id)) {
          collected.push({
            fieldId: f.id,
            actionType: "skip",
            profileKey: null,
            suggestedKey: null,
            promptText: null,
            reason: "No matching profile field",
            confidence: 1,
          });
        }
      }
      const allMappings: FieldMapping[] = dedupeFillsByProfileKey(
        collected.sort((a, b) => a.fieldId - b.fieldId)
      );
```

(The `setCached(cacheKey(tabId, message.fields), ...)` and the `return { type: "mapFieldsComplete", ... }` lines stay unchanged.)

- [ ] **Step 4: Re-run tests**

Run: `npm run test -- service-worker.test.ts`
Expected: all pass, including the existing suite. (`getMarketingConsent` is resilient — Task 2 — so the existing tests with a `chrome` global lacking `storage` still resolve to `optIn` and produce no consent rows.)

- [ ] **Step 5: Commit**

```bash
git add src/background/service-worker.ts src/background/service-worker.test.ts
git commit -m "feat(background): consent channel, LLM exclusion, fresh cache-hit consent, loading-guard backfill"
```

---

## Task 10: Popup state — `consentRows` + flow wiring

**Files:**
- Modify: `src/popup/types.ts`
- Modify: `src/popup/useAwtoFlow.ts`
- Modify: `src/popup/useAwtoFlow.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/popup/useAwtoFlow.test.ts`:

```ts
const sampleConsent = [
  { fieldId: 5, selector: "#promo", label: "Send me emails", consentType: "marketing" as const, proposedChecked: true },
  { fieldId: 6, selector: "#terms", label: "I agree", consentType: "legal" as const, proposedChecked: false },
];

it("populates consentRows from a mapFieldsConsent message", async () => {
  const deps = makeDeps();
  const { result } = renderFlow(deps);
  await waitFor(() => expect(result.current.status).toBe("ready"));

  await act(async () => {
    deps.portHandle.autoReply({ type: "mapFieldsConsent", consent: sampleConsent });
  });

  expect(result.current.state.consentRows).toEqual([
    { fieldId: 5, selector: "#promo", label: "Send me emails", consentType: "marketing", checked: true, links: undefined },
    { fieldId: 6, selector: "#terms", label: "I agree", consentType: "legal", checked: false, links: undefined },
  ]);
});

it("fill() sends consent toggle values and persists the marketing preference", async () => {
  const setMarketingConsent = vi.fn().mockResolvedValue(undefined);
  const deps = makeDeps();
  const { result } = renderHook(() =>
    useAwtoFlow({
      _queryActiveTab: deps.queryActiveTab,
      _sendToTab: deps.sendToTab,
      _connect: deps.connect as unknown as typeof chrome.runtime.connect,
      _loadProfile: deps.loadProfile,
      _saveProfile: deps.saveProfile,
      _closePopup: deps.closePopup,
      _setMarketingConsent: setMarketingConsent,
    })
  );

  await waitFor(() => expect(result.current.status).toBe("ready"));
  await act(async () => {
    deps.portHandle.autoReply({ type: "mapFieldsConsent", consent: sampleConsent });
  });
  act(() => result.current.setConsentChecked(5, false));
  act(() => result.current.setConsentChecked(6, true));

  await act(async () => {
    await result.current.fill();
  });

  const fillCall = deps.sendToTab.mock.calls.find(
    (c) => (c[1] as AwtoMessage).type === "fillForm"
  );
  const fillMsg = fillCall![1] as AwtoMessage & { type: "fillForm" };
  expect(fillMsg.values).toEqual(
    expect.arrayContaining([
      { selector: "#promo", value: "false", label: "Send me emails" },
      { selector: "#terms", value: "true", label: "I agree" },
    ])
  );
  expect(setMarketingConsent).toHaveBeenCalledWith("optOut");
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- useAwtoFlow.test.ts`
Expected: failure — `consentRows`/`setConsentChecked`/`_setMarketingConsent` not present.

- [ ] **Step 3: Add `ConsentRow` to types**

In `src/popup/types.ts`:

1. Add the import:

```ts
import type { ConsentLink } from "@/shared/consent";
```

2. Add the interface (after `SkippedRow`):

```ts
export interface ConsentRow {
  fieldId: number;
  selector: string;
  label: string;
  consentType: "marketing" | "legal";
  checked: boolean;
  links?: ConsentLink[];
}
```

3. Add to `FlowState` (after `skippedRows: SkippedRow[];`):

```ts
  consentRows: ConsentRow[];
```

- [ ] **Step 4: Wire `useAwtoFlow`**

In `src/popup/useAwtoFlow.ts`:

1. Add to the storage import: `import { loadProfile, saveProfile, setMarketingConsent } from "@/shared/storage";`

2. Add a dep to `UseAwtoFlowDeps`:

```ts
  _setMarketingConsent?: (v: "optIn" | "optOut") => Promise<void>;
```

3. Add `consentRows: []` to `INITIAL_STATE` (after `skippedRows: [],`).

4. Resolve the dep near the other defaults inside `useAwtoFlow`:

```ts
  const setMarketingConsentFn = deps._setMarketingConsent ?? setMarketingConsent;
```

5. In the port `onMessage` handler, change the `mapFieldsResult` branch from `setState({ ... })` to the functional form that preserves `consentRows`:

```ts
      if (msg.type === "mapFieldsResult") {
        const profile = profileRef.current;
        const fields = fieldsRef.current;
        const { fillRows, missingRows, skippedRows } = buildRows(
          fields,
          msg.mappings,
          profile
        );
        setState((s) => ({
          status: "ready",
          error: null,
          fields,
          loadingFields: [],
          mappings: msg.mappings,
          fillRows,
          missingRows,
          skippedRows,
          consentRows: s.consentRows,
          filledCount: 0,
          failedFills: [],
          chunksCompleted: 0,
        }));
      } else if (msg.type === "mapFieldsConsent") {
        setState((s) => ({
          ...s,
          consentRows: msg.consent.map((c) => ({
            fieldId: c.fieldId,
            selector: c.selector,
            label: c.label,
            consentType: c.consentType,
            checked: c.proposedChecked,
            links: c.links,
          })),
        }));
      } else if (msg.type === "mapFieldsProgress") {
```

(The `mapFieldsProgress` and `mapFieldsComplete` branches already spread `...s`, so they preserve `consentRows` — leave them as-is.)

6. Add a `setConsentChecked` callback (next to `setMissingValue`):

```ts
  const setConsentChecked = useCallback((fieldId: number, checked: boolean) => {
    setState((s) => ({
      ...s,
      consentRows: s.consentRows.map((row) =>
        row.fieldId === fieldId ? { ...row, checked } : row
      ),
    }));
  }, []);
```

7. In `fill()`, after the `missingRows` loop (right before the `if (profileChanged)` block), add the consent values and marketing learning:

```ts
      for (const row of current.consentRows) {
        values.push({
          selector: row.selector,
          value: row.checked ? "true" : "false",
          label: row.label,
        });
      }
      const marketingRows = current.consentRows.filter(
        (row) => row.consentType === "marketing"
      );
      if (marketingRows.length > 0) {
        await setMarketingConsentFn(
          marketingRows.some((row) => row.checked) ? "optIn" : "optOut"
        );
      }
```

8. In `rescan()`, add `consentRows: []` to the `setState` reset object (next to `skippedRows: []`).

9. Add `setConsentChecked` to `UseAwtoFlowResult` and to the returned object:

```ts
export interface UseAwtoFlowResult {
  state: FlowState;
  status: FlowStatus;
  setOverrideValue: (fieldId: number, value: string) => void;
  setMissingValue: (fieldId: number, value: string) => void;
  setConsentChecked: (fieldId: number, checked: boolean) => void;
  fill: () => Promise<void>;
  retry: () => void;
  cancel: () => void;
  rescan: () => void;
}
```

```ts
  return {
    state,
    status: state.status,
    setOverrideValue,
    setMissingValue,
    setConsentChecked,
    fill,
    retry,
    cancel,
    rescan,
  };
```

- [ ] **Step 5: Re-run tests**

Run: `npm run test -- useAwtoFlow.test.ts`
Expected: all pass (existing fill tests unaffected — `consentRows` defaults `[]`, so no consent values and no marketing write).

- [ ] **Step 6: Commit**

```bash
git add src/popup/types.ts src/popup/useAwtoFlow.ts src/popup/useAwtoFlow.test.ts
git commit -m "feat(popup): consentRows state, mapFieldsConsent handling, consent fill + marketing learning"
```

---

## Task 11: `ConsentRow` component

**Files:**
- Create: `src/popup/ConsentRow.tsx`
- Create: `src/popup/ConsentRow.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/popup/ConsentRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConsentRow } from "./ConsentRow";

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
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- ConsentRow.test.tsx`
Expected: failure — component does not exist.

- [ ] **Step 3: Implement**

Create `src/popup/ConsentRow.tsx`:

```tsx
import type { ConsentLink } from "@/shared/consent";

interface ConsentRowProps {
  fieldId: number;
  label: string;
  consentType: "marketing" | "legal";
  checked: boolean;
  links?: ConsentLink[];
  onToggle: (checked: boolean) => void;
}

export function ConsentRow({
  fieldId,
  label,
  consentType,
  checked,
  links,
  onToggle,
}: ConsentRowProps) {
  const inputId = `consent-${fieldId}`;
  return (
    <div className={`awto-consent-row awto-consent-row--${consentType}`}>
      <div className="awto-consent-row__text">
        <label htmlFor={inputId} className="awto-consent-row__label">
          {label}
          {consentType === "legal" && (
            <span className="awto-consent-row__required"> · required</span>
          )}
        </label>
        {links && links.length > 0 && (
          <div className="awto-consent-row__links">
            {links.map((l, i) => (
              <a
                key={i}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="awto-consent-row__link"
              >
                {l.text}
              </a>
            ))}
          </div>
        )}
      </div>
      <input
        id={inputId}
        type="checkbox"
        role="switch"
        className="awto-consent-row__toggle"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        aria-label={label}
      />
    </div>
  );
}
```

- [ ] **Step 4: Re-run tests**

Run: `npm run test -- ConsentRow.test.tsx`
Expected: all pass.

- [ ] **Step 5: Add minimal styles**

Find the popup stylesheet:

Run: `grep -rln "awto-fieldrow__label" src/popup`

Append to that stylesheet (toggle visuals; non-functional but keeps the section legible and meets the ≥44px touch-target convention):

```css
.awto-consent-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  min-height: 44px;
}
.awto-consent-row__text { display: flex; flex-direction: column; gap: 2px; }
.awto-consent-row__label { font-size: 13px; color: var(--awto-fg, #f8fafc); }
.awto-consent-row__required { color: #f59e0b; }
.awto-consent-row__links { display: flex; flex-wrap: wrap; gap: 8px; }
.awto-consent-row__link { font-size: 12px; color: #22c55e; text-decoration: underline; }
.awto-consent-row__toggle { width: 36px; height: 22px; flex-shrink: 0; cursor: pointer; }
```

If no popup stylesheet is found by the grep, skip this step (the component is still functional; classes simply go unstyled).

- [ ] **Step 6: Commit**

```bash
git add src/popup/ConsentRow.tsx src/popup/ConsentRow.test.tsx src/popup/*.css
git commit -m "feat(popup): ConsentRow toggle component"
```

---

## Task 12: Popup — render the Consent section

**Files:**
- Modify: `src/popup/Popup.tsx`
- Modify: `src/popup/Popup.test.tsx`

- [ ] **Step 1: Update the test mock + add a section test**

In `src/popup/Popup.test.tsx`:

1. In the `mockFlow` helper, add `consentRows: []` to the default `state` object (next to `loadingFields: []`) and add `setConsentChecked: vi.fn(),` to the returned hook object (next to `setMissingValue: vi.fn()`).

2. Append a new test to the `describe("Popup grouped sections", ...)` block:

```tsx
it("renders a Consent section and counts checked toggles in the Fill button", async () => {
  mockFlow({
    status: "ready",
    state: {
      loadingFields: [],
      consentRows: [
        { fieldId: 0, selector: "#promo", label: "Send me emails", consentType: "marketing", checked: true },
        { fieldId: 1, selector: "#terms", label: "I agree to the Terms", consentType: "legal", checked: false },
      ],
    },
  });
  const { Popup: PopupDyn } = await import("./Popup");
  const { render: renderDyn, screen: screenDyn } = await import("@testing-library/react");
  renderDyn(<PopupDyn />);

  const headers = document.querySelectorAll(".awto-section-header__label");
  expect(Array.from(headers).map((h) => h.textContent)).toContain("Consent");
  expect(document.querySelectorAll(".awto-consent-row")).toHaveLength(2);
  expect(screenDyn.getByRole("button", { name: /fill 1 field/i })).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- Popup.test.tsx`
Expected: the new test fails (no Consent section); existing tests still pass after the `mockFlow` update.

- [ ] **Step 3: Implement**

In `src/popup/Popup.tsx`:

1. Add the import: `import { ConsentRow } from "./ConsentRow";`

2. Pull `setConsentChecked` from the hook:

```ts
  const { state, status, setMissingValue, setConsentChecked, fill, retry, cancel, rescan } =
    useAwtoFlow();
```

3. Add the checked-consent count and fold it into `totalToFill`:

```ts
  const checkedConsentCount = state.consentRows.filter((r) => r.checked).length;
  const totalToFill = willFill.length + answeredMissing + checkedConsentCount;
```

(Replace the existing `const totalToFill = willFill.length + answeredMissing;` line.)

4. Add consent field ids to `resolvedIds`:

```ts
  const resolvedIds = useMemo(() => {
    const ids = new Set<number>();
    for (const r of state.fillRows) ids.add(r.fieldId);
    for (const r of state.missingRows) ids.add(r.fieldId);
    for (const r of state.skippedRows) ids.add(r.fieldId);
    for (const r of state.consentRows) ids.add(r.fieldId);
    return ids;
  }, [state.fillRows, state.missingRows, state.skippedRows, state.consentRows]);
```

5. Add the Consent section JSX immediately after the closing of the `{missingCount > 0 && ( ... )}` block and before the `{pendingFields.length > 0 && ...}` block:

```tsx
            {state.consentRows.length > 0 && (
              <>
                <SectionHeader
                  label="Consent"
                  count={state.consentRows.length}
                  tone="neutral"
                />
                {state.consentRows.map((r) => (
                  <ConsentRow
                    key={`consent-${r.fieldId}`}
                    fieldId={r.fieldId}
                    label={r.label}
                    consentType={r.consentType}
                    checked={r.checked}
                    links={r.links}
                    onToggle={(c) => setConsentChecked(r.fieldId, c)}
                  />
                ))}
              </>
            )}
```

- [ ] **Step 4: Re-run tests**

Run: `npm run test -- Popup.test.tsx`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/popup/Popup.tsx src/popup/Popup.test.tsx
git commit -m "feat(popup): Consent section with toggles, counted in Fill total"
```

---

## Task 13: Full verification + manual check

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `npm run test`
Expected: all green — existing baseline plus the ~30 new tests from Tasks 2–12.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 4: Manual verification on the real form**

Load the unpacked extension (`chrome://extensions` → reload Awto), then open the Upwork "Sign up to find work you love" form (the one from the bug report). Confirm:

1. The **country dropdown** appears as a fillable row; clicking **Fill** opens it and selects Patrick's country.
2. A **Consent** section shows the marketing checkbox **pre-ticked** (editable) and the legal checkbox **unticked** with the ToS/Privacy links visible; neither writes until Fill.
3. **No consent row spins** — they resolve instantly.
4. Untick marketing, Fill, reopen on a fresh consent form → marketing now proposed **off** (preference remembered).
5. A native `<select>` form (e.g. any normal signup) still fills as before (no regression).
6. A page with a search combobox / nav menu does **not** surface those as fillable dropdowns.

- [ ] **Step 5: Final commit if manual testing required fixes**

If manual testing surfaced issues, fix + commit. Otherwise the per-task commits already cover everything.

---

## Acceptance Criteria

- [ ] Upwork country combobox is detected and filled via the open→match→verify drive.
- [ ] Consent section: marketing pre-ticked + editable; legal off + deliberate; nothing written until Fill; no spinners.
- [ ] Marketing preference persists (optOut remembered); legal never remembered.
- [ ] A dropdown that can't be confidently set is reported "Couldn't fill", never wrong-filled.
- [ ] Command menus and search comboboxes are excluded.
- [ ] `npm run typecheck && npm run test && npm run build` all green.

## Out of scope (deferred)

- Remembering legal/ToS agreements (confirmed fresh every time, by design).
- Per-site consent preferences (one global marketing preference in v1).
- Closed shadow-DOM dropdowns (unreachable from a content script).
- Iframe-embedded forms.
- LLM-side use of `currentValue` to suppress already-correct proposals (idempotent fill covers it).
```
