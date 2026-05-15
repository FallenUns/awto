export interface FillResult {
  filled: number;
  failed: Array<{ selector: string; reason: string }>;
}

export function fillFields(
  root: Document | HTMLElement,
  values: Array<{ selector: string; value: string }>
): FillResult {
  let filled = 0;
  const failed: Array<{ selector: string; reason: string }> = [];

  for (const { selector, value } of values) {
    const el = root.querySelector(selector);
    if (!el) {
      failed.push({ selector, reason: "selector not found" });
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
      const matchedOption = Array.from(el.options).find(
        (o) =>
          o.value.trim().toLowerCase() === target ||
          (o.textContent ?? "").trim().toLowerCase() === target
      );
      if (!matchedOption) {
        failed.push({ selector, reason: "no matching option" });
        continue;
      }
      el.value = matchedOption.value;
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
