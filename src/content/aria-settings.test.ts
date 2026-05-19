import { describe, it, expect, vi, beforeEach } from "vitest";

type StorageChangeListener = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  area: string
) => void;

let changeListeners: StorageChangeListener[] = [];

beforeEach(() => {
  changeListeners = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({ "awto:llm": { enableAriaForms: true } }),
      },
      onChanged: {
        addListener: vi.fn((fn: StorageChangeListener) => {
          changeListeners.push(fn);
        }),
      },
    },
  };
  vi.resetModules();
});

describe("aria-settings", () => {
  it("defaults to true before hydration completes", async () => {
    const { isAriaScanEnabled } = await import("./aria-settings");
    expect(isAriaScanEnabled()).toBe(true);
  });

  it("reflects stored false value once hydration resolves", async () => {
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      "awto:llm": { enableAriaForms: false },
    });
    const { isAriaScanEnabled, hydrateAriaSettings } = await import("./aria-settings");
    await hydrateAriaSettings();
    expect(isAriaScanEnabled()).toBe(false);
  });

  it("updates when chrome.storage.onChanged fires with a new value", async () => {
    const { isAriaScanEnabled, hydrateAriaSettings } = await import("./aria-settings");
    await hydrateAriaSettings();
    expect(isAriaScanEnabled()).toBe(true);

    for (const fn of changeListeners) {
      fn({ "awto:llm": { newValue: { enableAriaForms: false } } }, "local");
    }
    expect(isAriaScanEnabled()).toBe(false);
  });
});
