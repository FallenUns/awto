import type { ScannedField } from "@/shared/messages";
import { scanFields } from "./form-scanner";

const INITIAL_DELAY_MS = 250;
const MUTATION_DEBOUNCE_MS = 500;
const SKIP_PROTOCOLS = ["chrome:", "chrome-extension:", "about:", "view-source:"];

const PERSONAL_KEYWORDS = [
  "first name", "last name", "given name", "family name", "surname",
  "full name", "middle name", "preferred name", "nickname", "title",
  "email", "e-mail", "phone", "telephone", "mobile", "cell", "tel",
  "address", "street", "city", "suburb", "town", "state", "province",
  "postcode", "zip", "postal", "country",
  "birth", "dob", "date of birth", "age", "gender", "pronoun",
  "nationality", "citizen", "visa", "work right",
  "employer", "company", "occupation", "job title", "linkedin",
  "github", "website", "portfolio",
  "tax file", "tfn", "medicare", "driver license", "driver licence",
  "passport", "license number",
  "subscribe", "sign up", "signup", "register", "newsletter",
];

const SEARCH_KEYWORDS = [
  "search", "query", "find ", " find", "lookup", "filter",
];

function looksPersonal(field: ScannedField): boolean {
  const haystack = [field.label, field.placeholder ?? ""]
    .join(" ")
    .toLowerCase();

  if (SEARCH_KEYWORDS.some((k) => haystack.includes(k))) return false;

  return PERSONAL_KEYWORDS.some((k) => haystack.includes(k));
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
      const personalCount = fields.filter(looksPersonal).length;
      const count = personalCount >= 1 && fields.length >= 2 ? fields.length : 0;
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
