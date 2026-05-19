import type { ScannedField } from "@/shared/messages";
import { isAriaScanEnabled } from "./aria-settings";

const TEXT_LIKE_TYPES = new Set([
  "text",
  "email",
  "tel",
  "number",
  "url",
  "password",
  "date",
  "month",
  "week",
  "time",
  "datetime-local",
  "search",
]);

const EXCLUDED_TYPES = new Set([
  "hidden",
  "submit",
  "reset",
  "button",
  "image",
  "file",
]);

type Fillable =
  | HTMLInputElement
  | HTMLSelectElement
  | HTMLTextAreaElement;

interface AriaQuery {
  selector: string;
  type: string;
  collectOptions?: (el: HTMLElement) => string[];
  skipIfInside?: string;
}

function collectRoleOptions(el: HTMLElement, role: string): string[] {
  return Array.from(el.querySelectorAll<HTMLElement>(`[role="${role}"]`))
    .map((o) => (o.textContent ?? "").trim())
    .filter((t) => t.length > 0);
}

const ARIA_QUERIES: AriaQuery[] = [
  {
    selector: '[role="radiogroup"]',
    type: "radio",
    collectOptions: (el) => collectRoleOptions(el, "radio"),
  },
  { selector: '[role="checkbox"]', type: "checkbox" },
  { selector: '[role="textbox"][contenteditable="true"]', type: "text" },
  {
    selector: '[role="combobox"]',
    type: "select",
    collectOptions: (el) => collectRoleOptions(el, "option"),
  },
  {
    selector: '[role="listbox"]',
    type: "select",
    collectOptions: (el) => collectRoleOptions(el, "option"),
    skipIfInside: '[role="combobox"]',
  },
];

export function scanFields(
  root: Document | HTMLElement = document
): ScannedField[] {
  const ownerDoc =
    root instanceof Document ? root : (root.ownerDocument ?? document);
  const candidates = Array.from(
    root.querySelectorAll<Fillable>("input, select, textarea")
  );

  const fields: ScannedField[] = [];
  const seenRadioGroups = new Set<string>();
  let nextId = 0;

  for (const el of candidates) {
    if (!isEligible(el)) continue;

    if (el instanceof HTMLInputElement && el.type === "radio") {
      const groupKey = `${el.name}`;
      if (!el.name || seenRadioGroups.has(groupKey)) continue;
      seenRadioGroups.add(groupKey);
      const group = Array.from(
        ownerDoc.querySelectorAll<HTMLInputElement>(
          `input[type="radio"][name="${cssEscape(el.name)}"]`
        )
      ).filter((r) => isEligible(r));
      if (group.length === 0) continue;
      const options = Array.from(new Set(group.map((r) => r.value)));
      fields.push({
        id: nextId++,
        selector: buildSelector(el, ownerDoc),
        label: extractLabel(el, ownerDoc),
        placeholder: null,
        type: "radio",
        required: group.some(isRequired),
        options,
      });
      continue;
    }

    const type = elementType(el);
    const placeholder =
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? el.getAttribute("placeholder")
        : null;

    const ac = el.getAttribute("autocomplete");
    const autocomplete = ac ? ac.trim().toLowerCase() : undefined;

    const field: ScannedField = {
      id: nextId++,
      selector: buildSelector(el, ownerDoc),
      label: extractLabel(el, ownerDoc),
      placeholder: placeholder && placeholder.length > 0 ? placeholder : null,
      type,
      required: isRequired(el),
      ...(autocomplete ? { autocomplete } : {}),
    };

    if (el instanceof HTMLSelectElement) {
      field.options = Array.from(el.options).map((o) =>
        (o.textContent ?? "").trim()
      );
    }

    fields.push(field);
  }

  if (isAriaScanEnabled()) {
    const nativeElements = new Set<Element>(
      candidates.filter((c) => isEligible(c))
    );

    const claimed = new Set<Element>();
    for (const q of ARIA_QUERIES) {
      const els = Array.from(root.querySelectorAll<HTMLElement>(q.selector));
      for (const el of els) {
        if (claimed.has(el)) continue;
        if (containsAny(el, nativeElements)) continue;
        if (isHidden(el)) continue;
        if (el.getAttribute("aria-disabled") === "true") continue;
        if (q.skipIfInside && el.closest(q.skipIfInside)) continue;

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

  return fields;
}

function isEligible(el: Fillable): boolean {
  if (el.disabled) return false;
  if ("readOnly" in el && el.readOnly) return false;
  if (isInsideTemplate(el)) return false;
  if (el instanceof HTMLInputElement) {
    const t = (el.getAttribute("type") ?? "text").toLowerCase();
    if (EXCLUDED_TYPES.has(t)) return false;
  }
  if (el instanceof HTMLButtonElement) return false;
  if (isInsideRichTextEditor(el)) return false;
  if (isHidden(el)) return false;
  return true;
}

const RTE_ANCESTOR_SELECTOR = [
  ".ck-editor",
  ".cke_editable",
  ".cke_wysiwyg_div",
  ".ql-container",
  ".ql-editor",
  ".note-editor",
  ".note-editable",
  ".tox-tinymce",
  ".tox-edit-area",
  ".fr-wrapper",
  ".fr-box",
  ".fr-element",
  ".trumbowyg-box",
  ".trumbowyg-editor",
  ".summernote",
  ".mce-edit-area",
  ".mce-tinymce",
  ".cm-editor",
  '[contenteditable="true"]',
].join(",");

const RTE_OWN_PREFIXES = [
  "cke_",
  "ql-",
  "mce_",
  "tox-",
  "summernote-",
  "trumbowyg-",
  "fr-",
];

function isInsideRichTextEditor(el: HTMLElement): boolean {
  if (el.closest(RTE_ANCESTOR_SELECTOR)) return true;
  const classAttr = el.getAttribute("class") ?? "";
  const classes = classAttr.split(/\s+/).filter(Boolean);
  if (classes.some((c) => RTE_OWN_PREFIXES.some((p) => c.startsWith(p)))) {
    return true;
  }
  const id = el.id ?? "";
  if (id && RTE_OWN_PREFIXES.some((p) => id.startsWith(p))) return true;
  return false;
}

function isHidden(el: HTMLElement): boolean {
  let cur: HTMLElement | null = el;
  while (cur) {
    if (cur.getAttribute("aria-hidden") === "true") return true;
    const style = cur.style;
    if (style && (style.display === "none" || style.visibility === "hidden")) {
      return true;
    }
    cur = cur.parentElement;
  }
  return false;
}

function isInsideTemplate(el: HTMLElement): boolean {
  let cur: Node | null = el;
  while (cur) {
    if (cur instanceof HTMLTemplateElement) return true;
    cur = cur.parentNode;
  }
  return false;
}

function isRequired(el: Fillable): boolean {
  if ("required" in el && el.required) return true;
  if (el.getAttribute("aria-required") === "true") return true;
  return false;
}

function elementType(el: Fillable): string {
  if (el instanceof HTMLSelectElement) return "select";
  if (el instanceof HTMLTextAreaElement) return "textarea";
  const t = (el.getAttribute("type") ?? "text").toLowerCase();
  if (TEXT_LIKE_TYPES.has(t)) return t;
  if (t === "checkbox" || t === "radio") return t;
  return t;
}

function buildSelector(el: Fillable, doc: Document): string {
  const id = el.id;
  if (id && isSimpleId(id) && doc.querySelectorAll(`#${cssEscape(id)}`).length === 1) {
    return `#${cssEscape(id)}`;
  }
  const name = el.getAttribute("name");
  if (name) {
    const escaped = cssEscape(name);
    const matches = doc.querySelectorAll(`[name="${escaped}"]`);
    if (matches.length === 1) {
      return `[name="${escaped}"]`;
    }
  }
  const testId = el.getAttribute("data-testid");
  if (testId) {
    const escaped = cssEscape(testId);
    const matches = doc.querySelectorAll(`[data-testid="${escaped}"]`);
    if (matches.length === 1) {
      return `[data-testid="${escaped}"]`;
    }
  }
  return buildNthSelector(el);
}

function isSimpleId(id: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(id);
}

function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (c) => {
    const code = c.charCodeAt(0);
    return code >= 0x80 ? c : `\\${code.toString(16)} `;
  });
}

function buildNthSelector(el: HTMLElement): string {
  const parts: string[] = [];
  let cur: HTMLElement | null = el;
  while (cur && cur.parentElement) {
    const tag = cur.tagName.toLowerCase();
    const siblings = Array.from(cur.parentElement.children).filter(
      (c) => c.tagName === cur!.tagName
    );
    const index = siblings.indexOf(cur) + 1;
    parts.unshift(`${tag}:nth-of-type(${index})`);
    if (
      cur.parentElement instanceof HTMLFormElement ||
      cur.parentElement === cur.ownerDocument.body
    ) {
      const anchor = cur.parentElement;
      if (anchor instanceof HTMLFormElement && anchor.id) {
        parts.unshift(`#${anchor.id}`);
      } else {
        parts.unshift(anchor.tagName.toLowerCase());
      }
      break;
    }
    cur = cur.parentElement;
  }
  return parts.join(" > ");
}

function extractLabel(el: Fillable, doc: Document): string {
  if (el.id) {
    const lbl = nearestExplicitLabel(el, doc);
    const text = lbl?.textContent?.trim();
    if (text) return text;
  }
  const ancestorLabel = el.closest("label");
  if (ancestorLabel) {
    const cloned = ancestorLabel.cloneNode(true) as HTMLElement;
    cloned
      .querySelectorAll("input, select, textarea, button")
      .forEach((n) => n.remove());
    const text = cloned.textContent?.trim();
    if (text) return text;
  }
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/).filter(Boolean);
    const parts = ids
      .map((id) => doc.getElementById(id)?.textContent?.trim() ?? "")
      .filter((s) => s.length > 0);
    const joined = parts.join(" ").trim();
    if (joined) return joined;
  }
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
  const placeholder = el.getAttribute("placeholder");
  if (placeholder && placeholder.trim()) return placeholder.trim();
  const tableLabel = nearestTableHeaderText(el);
  if (tableLabel) return tableLabel;
  const visualLabel = nearestVisualLabelText(el, doc);
  if (visualLabel) return visualLabel;
  const sibling = nearestPrecedingText(el);
  if (sibling) return sibling;
  return "";
}

function nearestExplicitLabel(el: HTMLElement, doc: Document): HTMLLabelElement | null {
  const id = el.id;
  if (!id) return null;
  const labels = Array.from(
    doc.querySelectorAll<HTMLLabelElement>(`label[for="${cssEscape(id)}"]`)
  ).filter((label) => !isHidden(label));
  if (labels.length <= 1) return labels[0] ?? null;

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

  const preceding = labels
    .filter((label) => label.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
    .at(-1);
  return preceding ?? labels[0] ?? null;
}

function nearestTableHeaderText(el: HTMLElement): string {
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

function nearestPrecedingText(el: HTMLElement): string {
  let prev = el.previousElementSibling;
  while (prev) {
    if (prev.querySelector("input, select, textarea, button")) {
      prev = prev.previousElementSibling;
      continue;
    }
    if (isFillableElement(prev)) {
      prev = prev.previousElementSibling;
      continue;
    }
    const text = directText(prev);
    if (text) return text;
    prev = prev.previousElementSibling;
  }
  return "";
}

function nearestVisualLabelText(el: HTMLElement, doc: Document): string {
  const target = el.getBoundingClientRect();
  if (!hasUsableRect(target)) return "";

  const candidates = Array.from(doc.body?.querySelectorAll<HTMLElement>("*") ?? []);
  let best: { text: string; score: number } | null = null;

  for (const candidate of candidates) {
    if (candidate === el || candidate.contains(el)) continue;
    if (isFillableElement(candidate)) continue;
    if (candidate.querySelector("input, select, textarea, button")) continue;
    if (candidate.closest("script, style, noscript")) continue;
    if (isHidden(candidate)) continue;

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

  const horizontalOverlap =
    Math.min(label.right, target.right) - Math.max(label.left, target.left);
  const minOverlap = Math.min(target.width, label.width) * 0.35;
  const verticalGap = target.top - label.bottom;
  if (verticalGap >= -4 && verticalGap <= 48 && horizontalOverlap >= minOverlap) {
    return 1000 + verticalGap * 5 + Math.abs(label.left - target.left);
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
    if (matchesOne(doc, sel)) return sel;
  }
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const sel = `[aria-labelledby="${cssEscape(labelledBy)}"]`;
    if (matchesOne(doc, sel)) return sel;
  }
  return buildNthSelector(el);
}

function matchesOne(doc: Document, selector: string): boolean {
  try {
    return doc.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
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
