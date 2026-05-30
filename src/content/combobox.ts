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
