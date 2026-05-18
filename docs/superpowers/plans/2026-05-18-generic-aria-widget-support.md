# Generic ARIA widget support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Awto's scanner and filler to recognise and write to ARIA-based custom form widgets (Google Forms, Microsoft Forms, Typeform, etc.) using only the standard ARIA spec — no provider-specific code.

**Architecture:** A second scanner pass picks up `[role="textbox"][contenteditable]`, `[role="radiogroup"]`, `[role="checkbox"]`, `[role="combobox"]`, `[role="listbox"]` and emits them as `ScannedField`s using the existing native types (text/radio/checkbox/select) so the entire downstream pipeline needs zero changes. The filler grows a dispatch branch that uses `click()` for radios/checkboxes/options and `textContent` + synthetic `input` event for contenteditable textboxes. A single defensive settings toggle (`enableAriaForms`, default ON) lets the user disable the ARIA pass if a specific site misbehaves.

**Tech Stack:** TypeScript, Vitest + happy-dom, React (for the options toggle), chrome.storage.local.

**Spec:** [docs/superpowers/specs/2026-05-18-generic-aria-widget-support-design.md](../specs/2026-05-18-generic-aria-widget-support-design.md)

---

## File Structure

| File | Responsibility | Change type |
|---|---|---|
| `src/shared/storage.ts` | Adds `enableAriaForms: boolean` to `LLMSettings`, defaults true | Modify |
| `src/shared/storage.test.ts` | Test the new field defaults and round-trips | Modify |
| `src/content/form-scanner.ts` | Adds ARIA second pass with role-based queries, de-dupes against native pass | Modify |
| `src/content/form-scanner.test.ts` | Fixtures for each ARIA role + de-dupe + read-only/disabled | Modify |
| `src/content/aria-settings.ts` | Module-level cache of `enableAriaForms` for the content script, refreshed via storage.onChanged | Create |
| `src/content/aria-settings.test.ts` | Tests the cache + change listener | Create |
| `src/content/form-filler.ts` | Adds `fillAriaWidget` dispatcher + four role-specific helpers; makes filler async-friendly | Modify |
| `src/content/form-filler.test.ts` | Tests for textbox / radiogroup / checkbox / listbox fill paths | Modify |
| `src/options/LLMTab.tsx` | Adds "Fill custom-widget forms" toggle | Modify |
| `src/options/LLMTab.test.tsx` (if exists, else `useOptionsState.test.ts`) | Toggle persists + UI present | Modify |

The scanner change adds ~80 lines; the filler adds ~100. Splitting either into a separate file would just add ceremony — both keep the second-pass logic right next to the first pass, which is easier to keep coherent.

---

## Task 1: Settings field — `enableAriaForms` default ON

**Files:**
- Modify: `src/shared/storage.ts`
- Modify: `src/shared/storage.test.ts`

- [ ] **Step 1: Read current `LLMSettings` shape**

Run: `grep -n "interface LLMSettings\|export const DEFAULT" src/shared/storage.ts`

You should see an `LLMSettings` interface and a `DEFAULT_LLM_SETTINGS` (or similar) constant. Read the surrounding lines so the new field slots in cleanly.

- [ ] **Step 2: Write failing test**

Append to `src/shared/storage.test.ts`:

```ts
describe("LLMSettings.enableAriaForms", () => {
  it("defaults to true when missing from storage", async () => {
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const settings = await loadLLMSettings();
    expect(settings.enableAriaForms).toBe(true);
  });

  it("round-trips a false value", async () => {
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      llmSettings: { enableAriaForms: false },
    });
    const settings = await loadLLMSettings();
    expect(settings.enableAriaForms).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `npm run test -- storage.test.ts`
Expected: 2 new tests fail with "expected undefined to be true".

- [ ] **Step 4: Add the field**

In `src/shared/storage.ts`:

1. Add to the `LLMSettings` interface: `enableAriaForms: boolean;`
2. Add to whatever default-builder function `loadLLMSettings` uses (look for the existing `cloudFallbackEnabled` default — slot in next to it): `enableAriaForms: stored.enableAriaForms ?? true,`

- [ ] **Step 5: Re-run tests**

Run: `npm run test -- storage.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/shared/storage.ts src/shared/storage.test.ts
git commit -m "feat(storage): add enableAriaForms setting, default true"
```

---

## Task 2: Content-script settings cache

**Files:**
- Create: `src/content/aria-settings.ts`
- Create: `src/content/aria-settings.test.ts`

The scanner is synchronous and runs on every mutation. We can't `await chrome.storage.local.get()` per scan. Build a module that hydrates once on import and updates via `chrome.storage.onChanged`.

- [ ] **Step 1: Write failing tests**

Create `src/content/aria-settings.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

type StorageChangeListener = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  area: string
) => void;

let changeListeners: StorageChangeListener[] = [];

beforeEach(() => {
  changeListeners = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({ llmSettings: { enableAriaForms: true } }),
      },
      onChanged: {
        addListener: vi.fn((fn: StorageChangeListener) => {
          changeListeners.push(fn);
        }),
      },
    },
  };
  vi.resetModules();
});

describe("aria-settings", () => {
  it("defaults to true before hydration completes", async () => {
    const { isAriaScanEnabled } = await import("./aria-settings");
    expect(isAriaScanEnabled()).toBe(true);
  });

  it("reflects stored false value once hydration resolves", async () => {
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      llmSettings: { enableAriaForms: false },
    });
    const { isAriaScanEnabled, hydrateAriaSettings } = await import("./aria-settings");
    await hydrateAriaSettings();
    expect(isAriaScanEnabled()).toBe(false);
  });

  it("updates when chrome.storage.onChanged fires with a new value", async () => {
    const { isAriaScanEnabled, hydrateAriaSettings } = await import("./aria-settings");
    await hydrateAriaSettings();
    expect(isAriaScanEnabled()).toBe(true);

    for (const fn of changeListeners) {
      fn({ llmSettings: { newValue: { enableAriaForms: false } } }, "local");
    }
    expect(isAriaScanEnabled()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- aria-settings.test.ts`
Expected: failure — module doesn't exist yet.

- [ ] **Step 3: Implement the module**

Create `src/content/aria-settings.ts`:

```ts
let enabled = true;

export function isAriaScanEnabled(): boolean {
  return enabled;
}

export async function hydrateAriaSettings(): Promise<void> {
  try {
    const stored = (await chrome.storage.local.get("llmSettings")) as {
      llmSettings?: { enableAriaForms?: boolean };
    };
    if (typeof stored.llmSettings?.enableAriaForms === "boolean") {
      enabled = stored.llmSettings.enableAriaForms;
    }
  } catch {
    // keep default
  }
}

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== "local") return;
  const next = (changes.llmSettings?.newValue ?? {}) as {
    enableAriaForms?: boolean;
  };
  if (typeof next.enableAriaForms === "boolean") {
    enabled = next.enableAriaForms;
  }
});
```

- [ ] **Step 4: Re-run tests**

Run: `npm run test -- aria-settings.test.ts`
Expected: all pass.

- [ ] **Step 5: Wire `hydrateAriaSettings` into the content-script entry**

In `src/content/index.ts`, near the top of whatever bootstraps the script:

```ts
import { hydrateAriaSettings } from "./aria-settings";

void hydrateAriaSettings();
```

The void-call is fire-and-forget. The default (true) applies until the promise resolves, then the actual setting takes over. Since hydration happens within ~10ms of content-script start, the first scan after `INITIAL_DELAY_MS = 250` is already using the correct value.

- [ ] **Step 6: Commit**

```bash
git add src/content/aria-settings.ts src/content/aria-settings.test.ts src/content/index.ts
git commit -m "feat(content): module-level cache for enableAriaForms setting"
```

---

## Task 3: Scanner ARIA pass — radiogroup

**Files:**
- Modify: `src/content/form-scanner.ts`
- Modify: `src/content/form-scanner.test.ts`

Start with the most common Google Forms widget: the radiogroup.

- [ ] **Step 1: Write failing test**

Append to `src/content/form-scanner.test.ts`:

```ts
describe("ARIA radiogroup", () => {
  it("scans a Google Forms-style radiogroup with aria-labelledby", () => {
    document.body.innerHTML = `
      <main>
        <div id="lbl-age" role="heading">Usia *</div>
        <div role="radiogroup" aria-labelledby="lbl-age" data-params="%.@.[1234567890,&quot;Usia&quot;]">
          <div role="radio" data-value="<17">&lt;17</div>
          <div role="radio" data-value="17-21">17-21</div>
          <div role="radio" data-value="22-30">22-30</div>
        </div>
      </main>
    `;
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      label: "Usia *",
      type: "radio",
      options: ["<17", "17-21", "22-30"],
    });
  });

  it("uses an aria-labelledby selector when no id is present on the widget", () => {
    document.body.innerHTML = `
      <div id="lbl-pendidikan">Pendidikan</div>
      <div role="radiogroup" aria-labelledby="lbl-pendidikan">
        <div role="radio">SMA/SMK</div>
        <div role="radio">Diploma</div>
      </div>
    `;
    const fields = scanFields();
    expect(fields[0]?.selector).toBe('[aria-labelledby="lbl-pendidikan"]');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- form-scanner.test.ts`
Expected: the two new tests fail (`fields` is empty).

- [ ] **Step 3: Add the ARIA pass**

In `src/content/form-scanner.ts`:

1. Add an import: `import { isAriaScanEnabled } from "./aria-settings";`

2. At the end of `scanFields`, before the `return`, add an ARIA pass:

```ts
if (isAriaScanEnabled()) {
  const nativeElements = new Set<Element>(
    candidates.filter((c) => isEligible(c))
  );
  const radiogroups = Array.from(
    root.querySelectorAll<HTMLElement>('[role="radiogroup"]')
  );
  for (const group of radiogroups) {
    if (containsAny(group, nativeElements)) continue;
    if (isHidden(group)) continue;
    if (group.getAttribute("aria-disabled") === "true") continue;
    const options = Array.from(
      group.querySelectorAll<HTMLElement>('[role="radio"]')
    )
      .map((r) => (r.textContent ?? "").trim())
      .filter((t) => t.length > 0);
    if (options.length === 0) continue;
    fields.push({
      id: nextId++,
      selector: buildAriaSelector(group, ownerDoc),
      label: extractAriaLabel(group, ownerDoc),
      placeholder: null,
      type: "radio",
      required: group.getAttribute("aria-required") === "true",
      options,
    });
  }
}
```

3. Add the helpers at the bottom of the file:

```ts
function containsAny(parent: Element, candidates: Set<Element>): boolean {
  for (const c of candidates) {
    if (parent.contains(c)) return true;
  }
  return false;
}

function buildAriaSelector(el: HTMLElement, doc: Document): string {
  const id = el.id;
  if (id && isSimpleId(id) && doc.querySelectorAll(`#${cssEscape(id)}`).length === 1) {
    return `#${cssEscape(id)}`;
  }
  const dataParams = el.getAttribute("data-params");
  if (dataParams) {
    const escaped = dataParams.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const sel = `[data-params="${escaped}"]`;
    if (doc.querySelectorAll(sel).length === 1) return sel;
  }
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const sel = `[aria-labelledby="${cssEscape(labelledBy)}"]`;
    if (doc.querySelectorAll(sel).length === 1) return sel;
  }
  return buildNthSelector(el);
}

function extractAriaLabel(el: HTMLElement, doc: Document): string {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/).filter(Boolean);
    const text = ids
      .map((id) => doc.getElementById(id)?.textContent?.trim() ?? "")
      .filter((s) => s.length > 0)
      .join(" ")
      .trim();
    if (text) return text;
  }
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
  return nearestPrecedingText(el);
}
```

- [ ] **Step 4: Re-run tests**

Run: `npm run test -- form-scanner.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/content/form-scanner.ts src/content/form-scanner.test.ts
git commit -m "feat(scanner): ARIA radiogroup pass with aria-labelledby selectors"
```

---

## Task 4: Scanner ARIA pass — checkbox, textbox, combobox/listbox

**Files:**
- Modify: `src/content/form-scanner.ts`
- Modify: `src/content/form-scanner.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/content/form-scanner.test.ts`:

```ts
describe("ARIA checkbox", () => {
  it("scans a standalone ARIA checkbox", () => {
    document.body.innerHTML = `
      <div id="lbl">I agree to the terms</div>
      <div role="checkbox" aria-labelledby="lbl" aria-checked="false"></div>
    `;
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      label: "I agree to the terms",
      type: "checkbox",
    });
  });
});

describe("ARIA textbox (contenteditable)", () => {
  it("scans role=textbox contenteditable as text input", () => {
    document.body.innerHTML = `
      <div id="lbl-short">Your answer</div>
      <div role="textbox" contenteditable="true" aria-labelledby="lbl-short"></div>
    `;
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      label: "Your answer",
      type: "text",
    });
  });

  it("ignores role=textbox WITHOUT contenteditable", () => {
    document.body.innerHTML = `
      <div role="textbox">Read only</div>
    `;
    expect(scanFields()).toEqual([]);
  });
});

describe("ARIA combobox / listbox", () => {
  it("scans a combobox with role=option children as a select", () => {
    document.body.innerHTML = `
      <div id="lbl-state">State</div>
      <div role="combobox" aria-labelledby="lbl-state">
        <div role="option">Victoria</div>
        <div role="option">New South Wales</div>
        <div role="option">Queensland</div>
      </div>
    `;
    const fields = scanFields();
    expect(fields[0]).toMatchObject({
      type: "select",
      options: ["Victoria", "New South Wales", "Queensland"],
    });
  });

  it("scans a top-level listbox", () => {
    document.body.innerHTML = `
      <div id="lbl-country">Country</div>
      <div role="listbox" aria-labelledby="lbl-country">
        <div role="option">Australia</div>
        <div role="option">New Zealand</div>
      </div>
    `;
    const fields = scanFields();
    expect(fields[0]).toMatchObject({
      type: "select",
      options: ["Australia", "New Zealand"],
    });
  });

  it("does not double-count a listbox that lives inside a combobox", () => {
    document.body.innerHTML = `
      <div role="combobox" aria-label="Pick one">
        <div role="listbox">
          <div role="option">A</div>
          <div role="option">B</div>
        </div>
      </div>
    `;
    expect(scanFields()).toHaveLength(1);
  });
});

describe("ARIA de-dupe with native pass", () => {
  it("does not double-count a native input wrapped in a role=textbox", () => {
    document.body.innerHTML = `
      <div role="textbox" contenteditable="true">
        <input type="text" name="x" />
      </div>
    `;
    const fields = scanFields();
    expect(fields).toHaveLength(1);
  });
});

describe("ARIA respects disabled flag", () => {
  it("skips when settings disable ARIA scanning", async () => {
    // Set chrome.storage to disable ARIA, re-import module so cache picks it up.
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      llmSettings: { enableAriaForms: false },
    });
    vi.resetModules();
    const { hydrateAriaSettings } = await import("./aria-settings");
    await hydrateAriaSettings();
    const { scanFields: scan } = await import("./form-scanner");

    document.body.innerHTML = `
      <div role="radiogroup" aria-label="X">
        <div role="radio">A</div>
        <div role="radio">B</div>
      </div>
    `;
    expect(scan()).toEqual([]);
  });
});
```

The disabled-flag test needs the `chrome.storage.local.get` mock and the resetModules trick. If the existing test file doesn't already set up a `chrome` global, add this at the top of the file:

```ts
beforeEach(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({ llmSettings: { enableAriaForms: true } }),
      },
      onChanged: { addListener: vi.fn() },
    },
  };
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- form-scanner.test.ts`
Expected: the new tests fail (no checkbox/textbox/combobox queries yet).

- [ ] **Step 3: Extend the ARIA pass**

In `src/content/form-scanner.ts`, replace the radiogroup-only block from Task 3 with this expanded version (keep the helpers from Task 3 unchanged):

```ts
if (isAriaScanEnabled()) {
  const nativeElements = new Set<Element>(
    candidates.filter((c) => isEligible(c))
  );

  const queries: Array<{ selector: string; type: string; collectOptions?: (el: HTMLElement) => string[] }> = [
    {
      selector: '[role="radiogroup"]',
      type: "radio",
      collectOptions: (el) =>
        Array.from(el.querySelectorAll<HTMLElement>('[role="radio"]'))
          .map((r) => (r.textContent ?? "").trim())
          .filter((t) => t.length > 0),
    },
    { selector: '[role="checkbox"]', type: "checkbox" },
    { selector: '[role="textbox"][contenteditable="true"]', type: "text" },
    {
      selector: '[role="combobox"]',
      type: "select",
      collectOptions: (el) =>
        Array.from(el.querySelectorAll<HTMLElement>('[role="option"]'))
          .map((o) => (o.textContent ?? "").trim())
          .filter((t) => t.length > 0),
    },
    {
      selector: '[role="listbox"]',
      type: "select",
      collectOptions: (el) =>
        Array.from(el.querySelectorAll<HTMLElement>('[role="option"]'))
          .map((o) => (o.textContent ?? "").trim())
          .filter((t) => t.length > 0),
    },
  ];

  const claimed = new Set<Element>();
  for (const q of queries) {
    const els = Array.from(root.querySelectorAll<HTMLElement>(q.selector));
    for (const el of els) {
      if (claimed.has(el)) continue;
      if (containsAny(el, nativeElements)) continue;
      if (isHidden(el)) continue;
      if (el.getAttribute("aria-disabled") === "true") continue;

      // listbox-inside-combobox: skip the inner listbox
      if (q.type === "select" && q.selector === '[role="listbox"]' && el.closest('[role="combobox"]')) {
        continue;
      }

      const options = q.collectOptions?.(el);
      if (q.collectOptions && (!options || options.length === 0)) continue;

      fields.push({
        id: nextId++,
        selector: buildAriaSelector(el, ownerDoc),
        label: extractAriaLabel(el, ownerDoc),
        placeholder: null,
        type: q.type,
        required: el.getAttribute("aria-required") === "true",
        ...(options ? { options } : {}),
      });
      claimed.add(el);
    }
  }
}
```

- [ ] **Step 4: Re-run tests**

Run: `npm run test -- form-scanner.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/content/form-scanner.ts src/content/form-scanner.test.ts
git commit -m "feat(scanner): ARIA checkbox/textbox/combobox/listbox passes"
```

---

## Task 5: Filler — `fillAriaTextbox` for contenteditable

**Files:**
- Modify: `src/content/form-filler.ts`
- Modify: `src/content/form-filler.test.ts`

Start with the simplest of the four filler paths.

- [ ] **Step 1: Read the existing filler entry point**

Run: `grep -n "export.*fillForm\|export.*fillField\|resolveTarget" src/content/form-filler.ts`

Identify where a single field's value gets written. We'll add a branch there for ARIA targets.

- [ ] **Step 2: Write failing test**

Append to `src/content/form-filler.test.ts`:

```ts
import { fillAriaWidget } from "./form-filler";

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
```

(Use `await` form below if your test runner needs it — adjust to match the existing test style in the file.)

- [ ] **Step 3: Run test to verify failure**

Run: `npm run test -- form-filler.test.ts`
Expected: failure — `fillAriaWidget` not exported.

- [ ] **Step 4: Implement**

In `src/content/form-filler.ts`, add the exported entry point and the textbox helper:

```ts
export async function fillAriaWidget(
  el: HTMLElement,
  value: string
): Promise<{ filled: boolean; reason?: string }> {
  const role = el.getAttribute("role");
  if (role === "textbox") return fillAriaTextbox(el, value);
  return { filled: false, reason: "unsupported aria role" };
}

function fillAriaTextbox(
  el: HTMLElement,
  value: string
): { filled: boolean } {
  el.focus();
  el.textContent = value;
  el.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: value,
    })
  );
  el.blur();
  return { filled: true };
}
```

- [ ] **Step 5: Re-run tests**

Run: `npm run test -- form-filler.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/content/form-filler.ts src/content/form-filler.test.ts
git commit -m "feat(filler): fillAriaWidget entry + fillAriaTextbox helper"
```

---

## Task 6: Filler — radiogroup and checkbox

**Files:**
- Modify: `src/content/form-filler.ts`
- Modify: `src/content/form-filler.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
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
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- form-filler.test.ts`
Expected: the radiogroup and checkbox tests fail with `unsupported aria role`.

- [ ] **Step 3: Implement**

In `src/content/form-filler.ts`, extend `fillAriaWidget` and add the helpers. Re-use the existing `fuzzyMatchOption` (it should already exist — `grep` it; if not, do exact + lowercased substring fallback inline):

```ts
export async function fillAriaWidget(
  el: HTMLElement,
  value: string
): Promise<{ filled: boolean; reason?: string }> {
  const role = el.getAttribute("role");
  if (role === "textbox") return fillAriaTextbox(el, value);
  if (role === "radiogroup") return fillAriaRadioGroup(el, value);
  if (role === "checkbox") return fillAriaCheckbox(el, value);
  return { filled: false, reason: "unsupported aria role" };
}

function fillAriaRadioGroup(
  group: HTMLElement,
  value: string
): { filled: boolean; reason?: string } {
  const radios = Array.from(
    group.querySelectorAll<HTMLElement>('[role="radio"]')
  );
  const match = radios.find((r) =>
    matchOption(value, (r.textContent ?? "").trim())
  );
  if (!match) return { filled: false, reason: "no matching option" };
  match.click();
  return { filled: true };
}

function fillAriaCheckbox(
  el: HTMLElement,
  value: string
): { filled: boolean } {
  const current = el.getAttribute("aria-checked") === "true";
  const want = value.trim().toLowerCase() === "true";
  if (current !== want) el.click();
  return { filled: true };
}

function matchOption(needle: string, haystack: string): boolean {
  const n = needle.trim().toLowerCase();
  const h = haystack.trim().toLowerCase();
  if (!n || !h) return false;
  if (n === h) return true;
  if (h.includes(n) || n.includes(h)) return true;
  return false;
}
```

If the existing `form-filler.ts` already has a `fuzzyMatchOption` exported, use that instead of declaring `matchOption` locally:

```ts
import { fuzzyMatchOption } from "./form-filler";  // or wherever it lives
// ...
const match = radios.find((r) => fuzzyMatchOption(value, r.textContent?.trim() ?? ""));
```

- [ ] **Step 4: Re-run tests**

Run: `npm run test -- form-filler.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/content/form-filler.ts src/content/form-filler.test.ts
git commit -m "feat(filler): ARIA radiogroup and checkbox fillers"
```

---

## Task 7: Filler — combobox / listbox with portal-rendered options

**Files:**
- Modify: `src/content/form-filler.ts`
- Modify: `src/content/form-filler.test.ts`

This is the trickiest case — options often render in a popup after the combobox is clicked.

- [ ] **Step 1: Write failing tests**

Append:

```ts
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
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- form-filler.test.ts`
Expected: the three new tests fail.

- [ ] **Step 3: Implement**

Extend `fillAriaWidget`:

```ts
export async function fillAriaWidget(
  el: HTMLElement,
  value: string
): Promise<{ filled: boolean; reason?: string }> {
  const role = el.getAttribute("role");
  if (role === "textbox") return fillAriaTextbox(el, value);
  if (role === "radiogroup") return fillAriaRadioGroup(el, value);
  if (role === "checkbox") return fillAriaCheckbox(el, value);
  if (role === "combobox" || role === "listbox") return fillAriaListbox(el, value);
  return { filled: false, reason: "unsupported aria role" };
}

async function fillAriaListbox(
  el: HTMLElement,
  value: string
): Promise<{ filled: boolean; reason?: string }> {
  el.click();
  await waitFrame();
  const options = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"]')
  ).filter((o) => !isHidden(o));
  const match = options.find((o) =>
    matchOption(value, (o.textContent ?? "").trim())
  );
  if (!match) {
    el.click(); // close
    return { filled: false, reason: "no matching option" };
  }
  match.click();
  return { filled: true };
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

function isHidden(el: HTMLElement): boolean {
  const style = el.style;
  if (style && (style.display === "none" || style.visibility === "hidden")) {
    return true;
  }
  return false;
}
```

If `isHidden` already exists in `form-filler.ts` reuse it — otherwise add the local copy above.

- [ ] **Step 4: Re-run tests**

Run: `npm run test -- form-filler.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/content/form-filler.ts src/content/form-filler.test.ts
git commit -m "feat(filler): ARIA combobox/listbox with portal-rendered options"
```

---

## Task 8: Filler dispatch — route ARIA targets to `fillAriaWidget`

**Files:**
- Modify: `src/content/form-filler.ts`
- Modify: `src/content/form-filler.test.ts`

The four helpers exist. Wire them into the existing `fillForm` (or whatever the outer entry point is called) so an ARIA selector resolves to `fillAriaWidget` instead of `el.value = X`.

- [ ] **Step 1: Locate the existing fill site**

Run: `grep -n "querySelector\|el\\.value\\s*=\\|dispatchEvent" src/content/form-filler.ts | head -30`

Identify the function that handles a single field. Note where the resolved element is type-checked.

- [ ] **Step 2: Write failing test**

```ts
describe("fillForm — ARIA dispatch", () => {
  it("routes an ARIA radiogroup target through fillAriaWidget", async () => {
    document.body.innerHTML = `
      <div id="g" role="radiogroup">
        <div role="radio">A</div>
        <div role="radio">B</div>
      </div>
    `;
    let clicked = "";
    document.querySelectorAll<HTMLElement>('[role="radio"]').forEach((r) => {
      r.addEventListener("click", () => { clicked = r.textContent ?? ""; });
    });
    const result = await fillForm([{ selector: "#g", value: "B", label: "Pick", profileKey: "x" }]);
    expect(result.filled).toBe(1);
    expect(clicked).toBe("B");
  });
});
```

(Adapt `fillForm`'s call shape to whatever it actually takes — the test fixture above is illustrative; match the existing signature.)

- [ ] **Step 3: Run test to verify failure**

Run: `npm run test -- form-filler.test.ts`
Expected: failure — currently `fillForm` tries `el.value = "B"` which silently no-ops on a div.

- [ ] **Step 4: Add the ARIA branch**

In the existing single-field handler inside `fillForm`, before the native-input switch statement, add:

```ts
if (
  !(el instanceof HTMLInputElement) &&
  !(el instanceof HTMLSelectElement) &&
  !(el instanceof HTMLTextAreaElement) &&
  el instanceof HTMLElement &&
  el.hasAttribute("role")
) {
  const ariaResult = await fillAriaWidget(el, value);
  if (ariaResult.filled) {
    filled++;
  } else {
    failed.push({ selector, reason: ariaResult.reason ?? "ARIA fill failed" });
  }
  continue;
}
```

If the existing function isn't async, change its signature to `async` and update callers (they already await the message reply, so the change is contained).

- [ ] **Step 5: Re-run tests**

Run: `npm run test -- form-filler.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/content/form-filler.ts src/content/form-filler.test.ts
git commit -m "feat(filler): dispatch ARIA targets through fillAriaWidget"
```

---

## Task 9: Options page — settings toggle

**Files:**
- Modify: `src/options/LLMTab.tsx`
- Modify: `src/options/LLMTab.test.tsx` if it exists; otherwise extend `useOptionsState.test.ts`

- [ ] **Step 1: Find where existing toggles live in `LLMTab.tsx`**

Run: `grep -n "cloudFallbackEnabled\|checkbox\|Toggle" src/options/LLMTab.tsx`

Note the pattern for the existing "Cloud fallback enabled" toggle so the new one matches.

- [ ] **Step 2: Write failing test**

Add (using existing test patterns — adapt to whatever testing library Options is using):

```tsx
it("renders the 'Fill custom-widget forms' toggle and persists changes", async () => {
  const onUpdate = vi.fn();
  render(
    <LLMTab
      settings={{ ...defaultSettings, enableAriaForms: true }}
      onUpdate={onUpdate}
      installedModels={[]}
      ollamaHealthy={true}
    />
  );
  const toggle = screen.getByLabelText(/fill custom-widget forms/i) as HTMLInputElement;
  expect(toggle.checked).toBe(true);
  fireEvent.click(toggle);
  expect(onUpdate).toHaveBeenCalledWith({ enableAriaForms: false });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `npm run test -- LLMTab`
Expected: toggle not found.

- [ ] **Step 4: Add the toggle**

In `src/options/LLMTab.tsx`, near the existing `cloudFallbackEnabled` checkbox (matching the same markup pattern), add:

```tsx
<label className="awto-toggle-row">
  <input
    type="checkbox"
    checked={settings.enableAriaForms}
    onChange={(e) => onUpdate({ enableAriaForms: e.target.checked })}
  />
  <span>
    <strong>Fill custom-widget forms</strong>
    <p className="awto-muted awto-toggle-row__hint">
      Adds support for Google Forms, Microsoft Forms, and other forms that
      use ARIA widgets instead of native inputs. Turn off if a site fills
      incorrectly.
    </p>
  </span>
</label>
```

If `useOptionsState` has a default-settings constant, make sure `enableAriaForms: true` is in it so fresh installs see the toggle in the ON state.

- [ ] **Step 5: Re-run tests**

Run: `npm run test -- LLMTab`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/options/LLMTab.tsx src/options/LLMTab.test.tsx
git commit -m "feat(options): toggle to enable/disable ARIA widget filling"
```

---

## Task 10: Full verification + commit checkpoint

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `npm run test`
Expected: all green. Should be 400 (previous baseline) + the new tests from Tasks 1–9 (estimate ~25 new), so ~425.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: clean build, no warnings.

- [ ] **Step 4: Visual manual sanity**

Load the unpacked extension in Chrome (`chrome://extensions` → reload Awto). Open:

1. **Google Forms personal survey** (use the URL from Patrick's screenshot or any survey with name/age/gender questions). Expected: popup appears, lists fields, fills correctly when clicked.
2. **GitHub repo page** (`github.com/{any}/{repo}`). Expected: no popup (regression check from the detector tightening earlier today).
3. **Native form** (e.g. a normal signup form). Expected: works as before, no regression.

- [ ] **Step 5: Final commit if any fixes needed**

If manual testing surfaced issues, fix and commit. Otherwise no extra commit needed — the per-task commits already cover everything.

---

## Acceptance Criteria

- [x] Spec coverage: each section of the spec maps to one or more tasks above.
- [ ] `npm run typecheck && npm run test && npm run build` green.
- [ ] Manual Google Forms verification passes: popup detects, lists rows, fills correctly.
- [ ] Settings toggle (Task 9) disables the ARIA pass; verified by reloading the extension with the toggle off and confirming Google Forms pages return "No form on this page".
- [ ] No regression on the GitHub repo page (still no popup) and on native HTML forms (still works).

## Out of scope (deferred)

- Provider-specific commit hacks (Google's pointerdown/pointerup sequence, MS's hidden state writes) — only if Task 10 manual verification reveals reliability gaps.
- Typeform's Enter-to-advance flow.
- Iframe scanning (Typeform embeds).
- Slider/range/colour widget ARIA equivalents.
- "Other..." option auto-handling.
