import type { ScannedField } from "@/shared/messages";

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

    const field: ScannedField = {
      id: nextId++,
      selector: buildSelector(el, ownerDoc),
      label: extractLabel(el, ownerDoc),
      placeholder: placeholder && placeholder.length > 0 ? placeholder : null,
      type,
      required: isRequired(el),
    };

    if (el instanceof HTMLSelectElement) {
      field.options = Array.from(el.options).map((o) =>
        (o.textContent ?? "").trim()
      );
    }

    fields.push(field);
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
  if (isHidden(el)) return false;
  return true;
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
    return `#${id}`;
  }
  const name = el.getAttribute("name");
  if (name) {
    const matches = doc.querySelectorAll(`[name="${cssEscape(name)}"]`);
    if (matches.length === 1) {
      return `[name="${name}"]`;
    }
  }
  const testId = el.getAttribute("data-testid");
  if (testId) {
    const matches = doc.querySelectorAll(`[data-testid="${cssEscape(testId)}"]`);
    if (matches.length === 1) {
      return `[data-testid="${testId}"]`;
    }
  }
  return buildNthSelector(el);
}

function isSimpleId(id: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(id);
}

function cssEscape(value: string): string {
  if (typeof (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS
    ?.escape === "function") {
    return (globalThis as unknown as { CSS: { escape: (v: string) => string } })
      .CSS.escape(value);
  }
  return value.replace(/(["\\])/g, "\\$1");
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
    const lbl = doc.querySelector(`label[for="${cssEscape(el.id)}"]`);
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
  const sibling = nearestPrecedingText(el);
  if (sibling) return sibling;
  return "";
}

function nearestPrecedingText(el: HTMLElement): string {
  let prev = el.previousElementSibling;
  while (prev) {
    const text = prev.textContent?.trim();
    if (text) return text;
    prev = prev.previousElementSibling;
  }
  return "";
}
