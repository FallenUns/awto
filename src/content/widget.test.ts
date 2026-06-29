import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountWidget } from "./widget";

describe("mountWidget", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts a host element with a shadow root", () => {
    mountWidget(() => {});
    const host = document.getElementById("awto-widget-root");
    expect(host).not.toBeNull();
  });

  it("renders no pill until setCount(>=2) is called", () => {
    const handle = mountWidget(() => {});
    const host = document.getElementById("awto-widget-root")!;
    const shadow = (host as HTMLElement & { __testShadow?: ShadowRoot }).__testShadow!;
    expect(shadow.querySelector(".pill")).toBeNull();
    handle.destroy();
  });

  it("setCount shows badge with count", () => {
    const handle = mountWidget(() => {});
    handle.setCount(5);
    const host = document.getElementById("awto-widget-root")!;
    const shadow = (host as HTMLElement & { __testShadow?: ShadowRoot }).__testShadow!;
    expect(shadow.querySelector(".badge")?.textContent).toBe("5");
    handle.destroy();
  });

  it("setHidden('dismissed') removes the pill from the shadow root", () => {
    const handle = mountWidget(() => {});
    handle.setCount(3);
    handle.setHidden("dismissed");
    const host = document.getElementById("awto-widget-root")!;
    const shadow = (host as HTMLElement & { __testShadow?: ShadowRoot }).__testShadow!;
    expect(shadow.querySelector(".pill")).toBeNull();
    handle.destroy();
  });

  it("fires onClick when the pill is clicked", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const handle = mountWidget(onClick);
    handle.setCount(2);
    const host = document.getElementById("awto-widget-root")!;
    const shadow = (host as HTMLElement & { __testShadow?: ShadowRoot }).__testShadow!;
    (shadow.querySelector(".pill") as HTMLElement).click();
    vi.advanceTimersByTime(250);
    expect(onClick).toHaveBeenCalled();
    handle.destroy();
    vi.useRealTimers();
  });

  it("double-click does not fire onClick and clears the dragged position", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const handle = mountWidget(onClick);
    handle.setCount(2);
    const host = document.getElementById("awto-widget-root")!;
    host.style.left = "10px";
    host.style.top = "10px";
    const shadow = (host as HTMLElement & { __testShadow?: ShadowRoot }).__testShadow!;
    const pill = shadow.querySelector(".pill") as HTMLElement;
    pill.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    pill.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    vi.advanceTimersByTime(250);
    expect(onClick).not.toHaveBeenCalled();
    expect(host.style.left).toBe("");
    expect(host.style.top).toBe("");
    handle.destroy();
    vi.useRealTimers();
  });
});
