import type { ScannedField } from "@/shared/messages";
import { scanFields } from "./form-scanner";

const INITIAL_DELAY_MS = 250;
const MUTATION_DEBOUNCE_MS = 500;
const SKIP_PROTOCOLS = ["chrome:", "chrome-extension:", "about:", "view-source:"];

type Category = "name" | "address" | "contact" | "personal" | "legal" | "work" | "web";

const STRONG_CATEGORIES = new Set<Category>(["name", "address", "personal"]);

const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  name: [
    "first name", "last name", "given name", "family name", "surname",
    "full name", "middle name", "preferred name", "nickname",
  ],
  contact: [
    "email", "e-mail", "phone", "telephone", "mobile", "cell phone", " tel ",
  ],
  address: [
    "street", "city", "town", "state ", "province", "country",
    "address line", "street address", "address1", "address 1",
    "suburb", "postcode", "zip code", "postal code",
  ],
  personal: [
    "date of birth", "birth date", "dob", "birthday", "age", "gender", "pronoun",
  ],
  legal: [
    "nationality", "citizen", "visa", "work right",
    "tax file", "tfn", "medicare", "driver license", "driver licence",
    "passport", "license number",
  ],
  work: [
    "employer", "occupation", "job title", "linkedin",
  ],
  web: [
    "github", "portfolio",
  ],
};

const SEARCH_KEYWORDS = [
  "search", "query", "find ", " find", "lookup", "filter",
  "go to file", "jump to",
];

const COUNTED_TYPES = new Set([
  "text", "email", "tel", "number", "url", "textarea", "select",
  "radio", "checkbox",
  "date", "month", "week", "time", "datetime-local",
]);

const EXCLUDED_CONTAINER_TAGS = ["NAV", "HEADER", "FOOTER", "ASIDE"];

const EXCLUDED_ARIA_ROLES = new Set([
  "banner",
  "contentinfo",
  "complementary",
  "navigation",
]);

function isCountedType(type: string): boolean {
  return COUNTED_TYPES.has(type.toLowerCase());
}

function isInExcludedContainer(selector: string): boolean {
  try {
    const el = document.querySelector(selector);
    if (!el) return false;
    let cur: Element | null = el.parentElement;
    while (cur) {
      if (EXCLUDED_CONTAINER_TAGS.includes(cur.tagName)) return true;
      const role = cur.getAttribute("role");
      if (role && EXCLUDED_ARIA_ROLES.has(role)) return true;
      cur = cur.parentElement;
    }
    return false;
  } catch {
    return false;
  }
}

function categoryFor(field: ScannedField): Category | null {
  const haystack = ` ${field.label.toLowerCase()} ${(field.placeholder ?? "").toLowerCase()} `;
  if (SEARCH_KEYWORDS.some((k) => haystack.includes(k))) return null;
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS) as [Category, string[]][]) {
    if (keywords.some((k) => haystack.includes(k))) return cat;
  }
  return null;
}

function evaluateFields(fields: ScannedField[]): number {
  const personalFields = fields.filter((f) => isCountedType(f.type));
  const categories = new Set<Category>();
  let personalCount = 0;
  for (const field of personalFields) {
    if (isInExcludedContainer(field.selector)) continue;
    const cat = categoryFor(field);
    if (cat) {
      categories.add(cat);
      personalCount += 1;
    }
  }

  if (personalCount < 2) return 0;

  const hasStrong = Array.from(categories).some((c) => STRONG_CATEGORIES.has(c));
  if (hasStrong) return fields.length;
  if (categories.size >= 3) return fields.length;
  return 0;
}

export function startDetector(onChange: (count: number) => void): () => void {
  if (SKIP_PROTOCOLS.includes(window.location.protocol)) {
    return () => {};
  }

  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let mutationTimer: ReturnType<typeof setTimeout> | null = null;
  let observer: MutationObserver | null = null;
  let lastCount = -1;

  const evaluate = () => {
    try {
      const fields = scanFields(document);
      const count = evaluateFields(fields);
      if (count !== lastCount) {
        lastCount = count;
        onChange(count);
      }
    } catch {
      // scan failures (e.g. detached document) are ignored
    }
  };

  initialTimer = setTimeout(evaluate, INITIAL_DELAY_MS);

  observer = new MutationObserver(() => {
    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = setTimeout(evaluate, MUTATION_DEBOUNCE_MS);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    if (initialTimer) clearTimeout(initialTimer);
    if (mutationTimer) clearTimeout(mutationTimer);
    observer?.disconnect();
  };
}
