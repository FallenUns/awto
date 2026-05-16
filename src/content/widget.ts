import styles from "./widget.css?inline";

export type WidgetHiddenReason = "dismissed" | "filled" | "no-fields" | null;

export interface WidgetHandle {
  setCount(n: number): void;
  setHidden(reason: WidgetHiddenReason): void;
  destroy(): void;
}

export function mountWidget(onClick: () => void): WidgetHandle {
  let host: HTMLElement | null = document.getElementById("awto-widget-root");
  if (host) host.remove();
  host = document.createElement("div");
  host.id = "awto-widget-root";
  document.body.appendChild(host);

  // Use "open" mode in tests for inspection, but real production should use "closed".
  // happy-dom doesn't support closed shadow root inspection from tests; we expose via __testShadow.
  const shadow = host.attachShadow({ mode: "open" });
  (host as HTMLElement & { __testShadow?: ShadowRoot }).__testShadow = shadow;

  const style = document.createElement("style");
  style.textContent = styles;
  shadow.appendChild(style);

  const container = document.createElement("div");
  shadow.appendChild(container);

  let currentCount = 0;
  let dismissed = false;
  let filled = false;

  function render() {
    if (dismissed || filled || currentCount < 2) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML = `
      <button class="pill fade-in" aria-label="Open Awto (${currentCount} field${currentCount === 1 ? "" : "s"} detected)">
        <span class="avatar">A</span>
        <span class="badge">${currentCount}</span>
        <span class="close" role="button" aria-label="Dismiss" tabindex="0">×</span>
      </button>
    `;
    const pill = container.querySelector(".pill") as HTMLButtonElement;
    const close = container.querySelector(".close") as HTMLElement;
    pill.addEventListener("click", (e) => {
      if (e.target === close || close.contains(e.target as Node)) return;
      onClick();
    });
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      dismissed = true;
      render();
    });
    pill.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        dismissed = true;
        render();
      }
    });
  }

  return {
    setCount(n) {
      currentCount = n;
      render();
    },
    setHidden(reason) {
      if (reason === "dismissed") dismissed = true;
      if (reason === "filled") filled = true;
      if (reason === null) {
        dismissed = false;
        filled = false;
      }
      render();
    },
    destroy() {
      host?.remove();
      host = null;
    },
  };
}
