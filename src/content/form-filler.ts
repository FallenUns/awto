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

      // 1. Exact match (case-insensitive trim) on value or text
      let matched = Array.from(el.options).find(
        (o) =>
          o.value.trim().toLowerCase() === target ||
          (o.textContent ?? "").trim().toLowerCase() === target
      );

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
