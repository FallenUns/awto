import { describe, it, expect, vi, beforeEach } from "vitest";
import { startDetector } from "./detector";

describe("startDetector", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });

  it("reports 0 on a page with no inputs after initial debounce", () => {
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("reports field count on a page with inputs", () => {
    document.body.innerHTML = `
      <form>
        <label>Name <input name="name" /></label>
        <label>Email <input type="email" name="email" /></label>
      </form>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("re-reports after a mutation that adds inputs (debounced)", async () => {
    vi.useRealTimers();
    const onChange = vi.fn();
    startDetector(onChange);

    // Wait for initial scan
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(onChange).toHaveBeenLastCalledWith(0);

    const input = document.createElement("input");
    input.name = "x";
    document.body.appendChild(input);

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("no-ops on chrome-extension:// pages", () => {
    const original = window.location.href;
    Object.defineProperty(window, "location", {
      value: { href: "chrome-extension://abc/x.html", protocol: "chrome-extension:" },
      writable: true,
    });
    const onChange = vi.fn();
    const stop = startDetector(onChange);
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
    stop();
    Object.defineProperty(window, "location", { value: { href: original }, writable: true });
  });
});
