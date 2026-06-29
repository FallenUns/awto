import styles from "./widget.css?inline";

export type WidgetHiddenReason = "dismissed" | "filled" | "no-fields" | null;

export interface WidgetHandle {
  setCount(n: number): void;
  setHidden(reason: WidgetHiddenReason): void;
  destroy(): void;
}

const POSITION_KEY = "awto:widgetPosition";

function hasStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome.storage?.local;
}

async function loadPosition(): Promise<{ left: number; top: number } | null> {
  if (!hasStorage()) return null;
  try {
    const result = await chrome.storage.local.get(POSITION_KEY);
    const raw = (result as Record<string, unknown>)[POSITION_KEY];
    if (
      raw &&
      typeof (raw as { left?: unknown }).left === "number" &&
      typeof (raw as { top?: unknown }).top === "number"
    ) {
      return raw as { left: number; top: number };
    }
  } catch {
    /* storage unavailable */
  }
  return null;
}

function savePosition(left: number, top: number): void {
  if (!hasStorage()) return;
  void chrome.storage.local.set({ [POSITION_KEY]: { left, top } });
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
  let lastLeft = 0;
  let lastTop = 0;
  let savedPosition: { left: number; top: number } | null = null;

  const DRAG_THRESHOLD = 4;

  function applyPosition() {
    if (!savedPosition || !host) return;
    const w = host.offsetWidth || 48;
    const h = host.offsetHeight || 48;
    const left = Math.min(Math.max(savedPosition.left, 0), window.innerWidth - w);
    const top = Math.min(Math.max(savedPosition.top, 0), window.innerHeight - h);
    lastLeft = left;
    lastTop = top;
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
  }

  void loadPosition().then((pos) => {
    savedPosition = pos;
    applyPosition();
  });

  function makeDraggable(pill: HTMLElement) {
    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let offsetX = 0;
    let offsetY = 0;
    let moved = false;

    pill.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const rect = host!.getBoundingClientRect();
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      moved = false;
      pill.setPointerCapture(e.pointerId);
    });

    pill.addEventListener("pointermove", (e) => {
      if (pointerId !== e.pointerId) return;
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
      moved = true;
      pill.classList.add("dragging");
      const w = host!.offsetWidth || 48;
      const h = host!.offsetHeight || 48;
      const left = Math.min(Math.max(e.clientX - offsetX, 0), window.innerWidth - w);
      const top = Math.min(Math.max(e.clientY - offsetY, 0), window.innerHeight - h);
      lastLeft = left;
      lastTop = top;
      host!.style.left = `${left}px`;
      host!.style.top = `${top}px`;
      host!.style.right = "auto";
      host!.style.bottom = "auto";
    });

    function end(e: PointerEvent) {
      if (pointerId !== e.pointerId) return;
      pill.releasePointerCapture(e.pointerId);
      pointerId = null;
      pill.classList.remove("dragging");
      if (moved) {
        suppressClick = true;
        savePosition(lastLeft, lastTop);
      }
    }
    pill.addEventListener("pointerup", end);
    pill.addEventListener("pointercancel", end);
  }

  let suppressClick = false;

  function resetPosition() {
    savedPosition = null;
    if (hasStorage()) void chrome.storage.local.remove(POSITION_KEY);
    if (host) {
      host.style.left = "";
      host.style.top = "";
      host.style.right = "";
      host.style.bottom = "";
    }
  }

  const CLICK_DELAY = 200;

  function render() {
    if (dismissed || filled || currentCount < 2) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML = `
      <button class="pill fade-in" title="Drag to move · double-click to reset position" aria-label="Open Awto (${currentCount} field${currentCount === 1 ? "" : "s"} detected). Drag to move, double-click to reset position.">
        <span class="avatar">A</span>
        <span class="badge">${currentCount}</span>
        <span class="close" role="button" aria-label="Dismiss" tabindex="0">×</span>
      </button>
    `;
    const pill = container.querySelector(".pill") as HTMLButtonElement;
    const close = container.querySelector(".close") as HTMLElement;
    let clickTimer: ReturnType<typeof setTimeout> | null = null;
    pill.addEventListener("click", (e) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      if (e.target === close || close.contains(e.target as Node)) return;
      if (clickTimer !== null) return;
      clickTimer = setTimeout(() => {
        clickTimer = null;
        onClick();
      }, CLICK_DELAY);
    });
    pill.addEventListener("dblclick", () => {
      if (clickTimer !== null) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      resetPosition();
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
    makeDraggable(pill);
    applyPosition();
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
