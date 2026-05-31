import type { FillValue } from "@/shared/messages";
import { readComboboxValue } from "./combobox";

export interface FillResult {
  filled: number;
  failed: Array<{ selector: string; reason: string }>;
}

export async function fillFields(
  root: Document | HTMLElement,
  values: FillValue[]
): Promise<FillResult> {
  let filled = 0;
  const failed: Array<{ selector: string; reason: string }> = [];

  for (const { selector, value, profileKey } of values) {
    const el = root.querySelector(selector);
    if (!el) {
      failed.push({ selector, reason: "selector not found" });
      continue;
    }
    if (isSemanticallyUnsafeFill(el, profileKey)) {
      failed.push({ selector, reason: "label mismatch" });
      continue;
    }

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
        failed.push({
          selector,
          reason: ariaResult.reason ?? "ARIA fill failed",
        });
      }
      continue;
    }

    if (el instanceof HTMLInputElement && el.type === "checkbox") {
      el.checked = value === "true";
      el.dispatchEvent(new Event("change", { bubbles: true }));
      filled++;
      continue;
    }

    if (el instanceof HTMLInputElement && el.type === "radio") {
      const ownerDoc = el.ownerDocument;
      const group = ownerDoc.querySelectorAll<HTMLInputElement>(
        `input[type="radio"][name="${cssEscape(el.name)}"]`
      );
      const match = Array.from(group).find((r) => r.value === value);
      if (!match) {
        if (el.value === value) {
          el.checked = true;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          filled++;
          continue;
        }
        failed.push({ selector, reason: "no matching option" });
        continue;
      }
      match.checked = true;
      match.dispatchEvent(new Event("change", { bubbles: true }));
      filled++;
      continue;
    }

    if (el instanceof HTMLSelectElement) {
      const target = value.trim().toLowerCase();

      // 1. Exact match (case-insensitive trim) on value or text
      let matched = Array.from(el.options).find(
        (o) =>
          o.value.trim().toLowerCase() === target ||
          (o.textContent ?? "").trim().toLowerCase() === target
      );

      if (!matched) {
        matched = monthOptionMatch(el, target);
      }

      // 2. Substring match (both directions), if target is non-trivial
      if (!matched && target.length >= 2) {
        matched = Array.from(el.options).find((o) => {
          const text = (o.textContent ?? "").trim().toLowerCase();
          return text.length >= 2 && (text.includes(target) || target.includes(text));
        });
      }

      // 3. Levenshtein distance ≤ 2 on textContent
      if (!matched && target.length >= 2) {
        let bestDist = 3;
        let bestOption: HTMLOptionElement | null = null;
        for (const o of Array.from(el.options)) {
          const text = (o.textContent ?? "").trim().toLowerCase();
          if (!text) continue;
          const dist = levenshtein(target, text);
          if (dist < bestDist) {
            bestDist = dist;
            bestOption = o;
          }
        }
        if (bestOption) matched = bestOption;
      }

      if (!matched) {
        failed.push({ selector, reason: "no matching option" });
        continue;
      }

      el.value = matched.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      filled++;
      continue;
    }

    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement
    ) {
      setNativeValue(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      filled++;
      continue;
    }

    failed.push({ selector, reason: "unsupported element" });
  }

  return { filled, failed };
}

export async function fillAriaWidget(
  el: HTMLElement,
  value: string
): Promise<{ filled: boolean; reason?: string }> {
  const role = el.getAttribute("role");
  switch (role) {
    case "textbox":
      return fillAriaTextbox(el, value);
    case "radiogroup":
      return fillAriaRadioGroup(el, value);
    case "checkbox":
      return fillAriaCheckbox(el, value);
    case "combobox":
    case "listbox":
      return fillAriaListbox(el, value);
    default:
      return { filled: false, reason: "unsupported aria role" };
  }
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

function fillAriaRadioGroup(
  group: HTMLElement,
  value: string
): { filled: boolean; reason?: string } {
  const radios = Array.from(
    group.querySelectorAll<HTMLElement>('[role="radio"]')
  );
  const exact = radios.find(
    (r) =>
      (r.textContent ?? "").trim().toLowerCase() ===
      value.trim().toLowerCase()
  );
  const match =
    exact ??
    radios.find((r) =>
      matchAriaOption(value, (r.textContent ?? "").trim())
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
  if (after !== null && valueMatches(after, value)) return true;
  // Enter didn't visibly take — try a direct click, then re-verify. A concrete
  // mismatch after both attempts is reported as a failure, never a wrong-fill.
  fireOpen(match);
  await waitFrame();
  const confirmed = readComboboxValue(el).value;
  return confirmed === null || valueMatches(confirmed, value);
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

function collectListboxOptions(trigger: HTMLElement): HTMLElement[] {
  const ariaTargetId =
    trigger.getAttribute("aria-controls") ?? trigger.getAttribute("aria-owns");
  if (ariaTargetId) {
    const target = document.getElementById(ariaTargetId);
    if (target) {
      return Array.from(
        target.querySelectorAll<HTMLElement>('[role="option"]')
      );
    }
  }
  const ownContent = Array.from(
    trigger.querySelectorAll<HTMLElement>('[role="option"]')
  );
  if (ownContent.length > 0) return ownContent;
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"]')
  );
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

export function matchAriaOption(needle: string, haystack: string): boolean {
  const n = needle.trim().toLowerCase();
  const h = haystack.trim().toLowerCase();
  if (!n || !h) return false;
  if (n === h) return true;
  const shorter = n.length <= h.length ? n : h;
  const longer = n.length <= h.length ? h : n;
  if (shorter.length < 3) return false;
  return longer.startsWith(shorter);
}

function isSemanticallyUnsafeFill(
  el: Element,
  profileKey: string | undefined
): boolean {
  if (!profileKey) return false;
  const label = liveLabel(el);
  if (!label) return false;
  if (/\bcity\b/.test(label)) {
    return !["city", "suburb"].includes(profileKey);
  }
  if (/\bstreet\s*address\b|\baddress\s*line\s*1\b/.test(label)) {
    return !["addressLine1", "addressLine1WithUnit"].includes(profileKey);
  }
  if (/\baddress\s*line\s*2\b|\bunit\b|\bapt\b|\bapartment\b|\bsuite\b/.test(label)) {
    return !["addressLine2", "unitNumber"].includes(profileKey);
  }
  if (/\bstate\b|\bprovince\b|\bregion\b/.test(label)) {
    return profileKey !== "state";
  }
  if (/\bcountry\b/.test(label)) {
    return profileKey !== "country";
  }
  if (/\bzip\b|\bpost\s*code\b|\bpostcode\b|\bpostal\s*code\b/.test(label)) {
    return profileKey !== "postcode";
  }
  return false;
}

function liveLabel(el: Element): string {
  const ownerDoc = el.ownerDocument;
  const id = el.getAttribute("id");
  if (id) {
    const explicit = nearestExplicitLabel(el, ownerDoc);
    const text = explicit?.textContent?.trim();
    if (text) return normalizeLabel(text);
  }

  const wrapper = el.closest("label");
  if (wrapper) {
    const clone = wrapper.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("input, select, textarea, button").forEach((n) => n.remove());
    const text = clone.textContent?.trim();
    if (text) return normalizeLabel(text);
  }

  const tableLabel = nearestTableHeaderText(el);
  if (tableLabel) return normalizeLabel(tableLabel);

  const visual = nearestVisualLabelText(el);
  if (visual) return normalizeLabel(visual);

  const sibling = nearestPrecedingText(el);
  return normalizeLabel(sibling);
}

function nearestExplicitLabel(el: Element, doc: Document): HTMLLabelElement | null {
  const id = el.getAttribute("id");
  if (!id) return null;
  const labels = Array.from(
    doc.querySelectorAll<HTMLLabelElement>(`label[for="${cssEscape(id)}"]`)
  );
  if (labels.length <= 1) return labels[0] ?? null;

  if (el instanceof HTMLElement) {
    const target = el.getBoundingClientRect();
    if (hasUsableRect(target)) {
      let best: { label: HTMLLabelElement; score: number } | null = null;
      for (const label of labels) {
        const rect = label.getBoundingClientRect();
        if (!hasUsableRect(rect)) continue;
        const score = explicitLabelScore(rect, target);
        if (score === null) continue;
        if (!best || score < best.score) best = { label, score };
      }
      if (best) return best.label;
    }
  }

  const preceding = labels
    .filter((label) => label.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
    .at(-1);
  return preceding ?? labels[0] ?? null;
}

function normalizeLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_./:[\]"'=#>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function nearestTableHeaderText(el: Element): string {
  const cell = el.closest("td, th");
  const row = cell?.parentElement;
  if (!cell || !row) return "";
  const cells = Array.from(row.children);
  const index = cells.indexOf(cell);
  for (let i = index - 1; i >= 0; i--) {
    const candidate = cells[i] as HTMLElement | undefined;
    const text = candidate?.textContent?.trim();
    if (text) return text;
  }
  return "";
}

function nearestPrecedingText(el: Element): string {
  let prev = el.previousElementSibling;
  while (prev) {
    if (prev.querySelector("input, select, textarea, button") || isFillableElement(prev)) {
      prev = prev.previousElementSibling;
      continue;
    }
    const text = directText(prev);
    if (text) return text;
    prev = prev.previousElementSibling;
  }
  return "";
}

function nearestVisualLabelText(el: Element): string {
  if (!(el instanceof HTMLElement)) return "";
  const target = el.getBoundingClientRect();
  if (!hasUsableRect(target)) return "";
  const candidates = Array.from(el.ownerDocument.body?.querySelectorAll<HTMLElement>("*") ?? []);
  let best: { text: string; score: number } | null = null;

  for (const candidate of candidates) {
    if (candidate === el || candidate.contains(el)) continue;
    if (isFillableElement(candidate)) continue;
    if (candidate.querySelector("input, select, textarea, button")) continue;
    if (candidate.closest("script, style, noscript")) continue;
    const text = directText(candidate);
    if (!text || text.length > 80) continue;
    const rect = candidate.getBoundingClientRect();
    if (!hasUsableRect(rect)) continue;
    const score = visualLabelScore(rect, target);
    if (score === null) continue;
    if (!best || score < best.score) best = { text, score };
  }

  return best?.text ?? "";
}

function visualLabelScore(label: DOMRect, target: DOMRect): number | null {
  const targetCenterY = target.top + target.height / 2;
  const labelCenterY = label.top + label.height / 2;
  const verticalDelta = Math.abs(labelCenterY - targetCenterY);
  const maxSameRowDelta = Math.max(18, target.height * 0.9);
  if (verticalDelta <= maxSameRowDelta && label.right <= target.left + 8) {
    const horizontalGap = Math.max(0, target.left - label.right);
    if (horizontalGap <= 360) return horizontalGap + verticalDelta * 3;
  }
  return null;
}

function explicitLabelScore(label: DOMRect, target: DOMRect): number | null {
  const sameRow = visualLabelScore(label, target);
  if (sameRow !== null) return sameRow;

  const targetCenterX = target.left + target.width / 2;
  const labelCenterX = label.left + label.width / 2;
  const horizontalDelta = Math.abs(labelCenterX - targetCenterX);
  const verticalGap = target.top - label.bottom;
  if (verticalGap >= -4 && verticalGap <= 80) {
    return 1000 + verticalGap * 5 + horizontalDelta;
  }
  return null;
}

function directText(el: Element): string {
  return Array.from(el.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isFillableElement(el: Element): boolean {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLButtonElement
  );
}

function hasUsableRect(rect: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0;
}

function monthOptionMatch(
  el: HTMLSelectElement,
  target: string
): HTMLOptionElement | undefined {
  const month = MONTH_ALIASES[target];
  if (!month) return undefined;
  return Array.from(el.options).find((o) => {
    const value = normalizeMonthToken(o.value);
    const text = normalizeMonthToken(o.textContent ?? "");
    return value === month || text === month;
  });
}

function normalizeMonthToken(value: string): string {
  const normalized = value.trim().toLowerCase();
  return MONTH_ALIASES[normalized] ?? normalized;
}

const MONTH_ALIASES: Record<string, string> = {
  "1": "01",
  "01": "01",
  jan: "01",
  january: "01",
  "2": "02",
  "02": "02",
  feb: "02",
  february: "02",
  "3": "03",
  "03": "03",
  mar: "03",
  march: "03",
  "4": "04",
  "04": "04",
  apr: "04",
  april: "04",
  "5": "05",
  "05": "05",
  may: "05",
  "6": "06",
  "06": "06",
  jun: "06",
  june: "06",
  "7": "07",
  "07": "07",
  jul: "07",
  july: "07",
  "8": "08",
  "08": "08",
  aug: "08",
  august: "08",
  "9": "09",
  "09": "09",
  sep: "09",
  sept: "09",
  september: "09",
  "10": "10",
  oct: "10",
  october: "10",
  "11": "11",
  nov: "11",
  november: "11",
  "12": "12",
  dec: "12",
  december: "12",
};

function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
}

function cssEscape(value: string): string {
  if (
    typeof (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS
      ?.escape === "function"
  ) {
    return (
      globalThis as unknown as { CSS: { escape: (v: string) => string } }
    ).CSS.escape(value);
  }
  return value.replace(/(["\\])/g, "\\$1");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j] ?? 0;
  }
  return prev[b.length] ?? 0;
}
