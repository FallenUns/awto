const STORAGE_KEY = "awto:llm";

let enabled = true;

export function isAriaScanEnabled(): boolean {
  return enabled;
}

export async function hydrateAriaSettings(): Promise<void> {
  try {
    const stored = (await chrome.storage.local.get(STORAGE_KEY)) as {
      [STORAGE_KEY]?: { enableAriaForms?: boolean };
    };
    const settings = stored[STORAGE_KEY];
    if (typeof settings?.enableAriaForms === "boolean") {
      enabled = settings.enableAriaForms;
    }
  } catch {
    // keep default
  }
}

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== "local") return;
  const next = (changes[STORAGE_KEY]?.newValue ?? {}) as {
    enableAriaForms?: boolean;
  };
  if (typeof next.enableAriaForms === "boolean") {
    enabled = next.enableAriaForms;
  }
});
