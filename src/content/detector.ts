import { scanFields } from "./form-scanner";

const INITIAL_DELAY_MS = 250;
const MUTATION_DEBOUNCE_MS = 500;
const SKIP_PROTOCOLS = ["chrome:", "chrome-extension:", "about:", "view-source:"];

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
      const count = scanFields(document).length;
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
