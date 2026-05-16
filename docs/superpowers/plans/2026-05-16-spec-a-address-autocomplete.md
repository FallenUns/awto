# Spec A — Implementation Plan

> **REQUIRED SUB-SKILL:** `superpowers:subagent-driven-development`. TDD per task.

**Goal:** Address autocomplete via Nominatim in the profile editor — type 3+ chars, pick a suggestion, six fields fill at once.

**Spec:** [docs/superpowers/specs/2026-05-16-spec-a-address-autocomplete-design.md](../specs/2026-05-16-spec-a-address-autocomplete-design.md)

---

## Task 1: `geocoder.ts` Nominatim client

**Files:**
- Create: `src/options/geocoder.ts`
- Create: `src/options/geocoder.test.ts`
- Modify: `manifest.json` — add host permission

### Step 1: Write failing tests

Create `src/options/geocoder.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchAddresses } from "./geocoder";

describe("searchAddresses", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns [] on empty query", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await searchAddresses("")).toEqual([]);
    expect(await searchAddresses("   ")).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps Nominatim response to AddressResult", async () => {
    const sample = [
      {
        display_name: "206 La Trobe Street, Melbourne, VIC 3000, Australia",
        address: {
          house_number: "206",
          road: "La Trobe Street",
          suburb: "Melbourne",
          city: "Melbourne",
          state: "Victoria",
          postcode: "3000",
          country: "Australia",
        },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(sample) })
    );

    const results = await searchAddresses("206 la trobe");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      addressLine1: "206 La Trobe Street",
      suburb: "Melbourne",
      city: "Melbourne",
      state: "Victoria",
      postcode: "3000",
      country: "Australia",
    });
  });

  it("returns [] on non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 })
    );
    expect(await searchAddresses("anywhere")).toEqual([]);
  });

  it("returns [] on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await searchAddresses("anywhere")).toEqual([]);
  });

  it("rethrows AbortError when signal aborts", async () => {
    const fetchSpy = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const ctl = new AbortController();
    const promise = searchAddresses("anywhere", { signal: ctl.signal });
    ctl.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("falls back to neighbourhood / town / village when suburb / city are absent", async () => {
    const sample = [
      {
        display_name: "Sample, NSW",
        address: {
          road: "Main St",
          neighbourhood: "Old Town",
          town: "Bathurst",
          state: "New South Wales",
          country: "Australia",
        },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(sample) })
    );

    const [r] = await searchAddresses("main");
    expect(r?.suburb).toBe("Old Town");
    expect(r?.city).toBe("Bathurst");
  });
});
```

### Step 2: Run, verify failure

```
npm run test -- src/options/geocoder.test.ts
```

Expected: fail — file does not exist.

### Step 3: Implement geocoder.ts

Create `src/options/geocoder.ts`:

```ts
const ENDPOINT = "https://nominatim.openstreetmap.org/search";

export interface AddressResult {
  displayName: string;
  addressLine1: string;
  suburb: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  raw: unknown;
}

interface NominatimItem {
  display_name?: unknown;
  address?: Record<string, unknown>;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function joinLine1(addr: Record<string, unknown>): string {
  const house = asString(addr.house_number);
  const road = asString(addr.road) || asString(addr.pedestrian) || asString(addr.footway);
  if (house && road) return `${house} ${road}`.trim();
  return road || house;
}

function mapItem(item: NominatimItem): AddressResult {
  const addr = item.address ?? {};
  return {
    displayName: asString(item.display_name),
    addressLine1: joinLine1(addr),
    suburb: asString(addr.suburb) || asString(addr.neighbourhood),
    city: asString(addr.city) || asString(addr.town) || asString(addr.village),
    state: asString(addr.state) || asString(addr.province),
    postcode: asString(addr.postcode),
    country: asString(addr.country),
    raw: item,
  };
}

export async function searchAddresses(
  query: string,
  opts: { signal?: AbortSignal; limit?: number } = {}
): Promise<AddressResult[]> {
  const q = query.trim();
  if (!q) return [];
  const limit = opts.limit ?? 5;
  const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=${limit}`;

  try {
    const res = await fetch(url, { signal: opts.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as NominatimItem[];
    if (!Array.isArray(data)) return [];
    return data.map(mapItem);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return [];
  }
}
```

### Step 4: Modify manifest.json

Find `host_permissions` and add the Nominatim entry:

```json
"host_permissions": [
  "http://localhost:11434/*",
  "https://api.anthropic.com/*",
  "https://nominatim.openstreetmap.org/*"
]
```

### Step 5: Run tests, typecheck, build

```
npm run test
npm run typecheck
npm run build
```

Expected: typecheck clean, all tests pass (≥227 total), build OK.

### Step 6: Commit

```bash
git add src/options/geocoder.ts src/options/geocoder.test.ts manifest.json
git commit -m "feat(options): Nominatim geocoder client for address autocomplete"
```

---

## Task 2: `<AddressAutocomplete>` component

**Files:**
- Create: `src/options/AddressAutocomplete.tsx`
- Create: `src/options/AddressAutocomplete.test.tsx`
- Modify: `src/options/styles.css` — dropdown styles

### Step 1: Write failing tests

Create `src/options/AddressAutocomplete.test.tsx`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AddressAutocomplete } from "./AddressAutocomplete";
import type { AddressResult } from "./geocoder";

const sampleResult: AddressResult = {
  displayName: "206 La Trobe Street, Melbourne, VIC 3000, Australia",
  addressLine1: "206 La Trobe Street",
  suburb: "Melbourne",
  city: "Melbourne",
  state: "Victoria",
  postcode: "3000",
  country: "Australia",
  raw: {},
};

describe("AddressAutocomplete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("does not call _search for queries under 3 chars", () => {
    const search = vi.fn();
    render(
      <AddressAutocomplete
        value=""
        onChange={() => {}}
        onSelect={() => {}}
        _search={search}
      />
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "ab" } });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(search).not.toHaveBeenCalled();
  });

  it("debounces and calls _search once per typing burst", () => {
    const search = vi.fn().mockResolvedValue([]);
    render(
      <AddressAutocomplete
        value=""
        onChange={() => {}}
        onSelect={() => {}}
        _search={search}
      />
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "206 L" } });
    fireEvent.change(input, { target: { value: "206 La" } });
    fireEvent.change(input, { target: { value: "206 La T" } });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("206 La T", expect.objectContaining({ signal: expect.anything() }));
  });

  it("renders results in the dropdown and selects on click", async () => {
    const search = vi.fn().mockResolvedValue([sampleResult]);
    const onSelect = vi.fn();
    render(
      <AddressAutocomplete
        value=""
        onChange={() => {}}
        onSelect={onSelect}
        _search={search}
      />
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "206 la" } });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    const option = await screen.findByRole("option", { name: /206 La Trobe Street/i });
    fireEvent.click(option);
    expect(onSelect).toHaveBeenCalledWith(sampleResult);
  });

  it("ArrowDown highlights first option, Enter selects it", async () => {
    const search = vi.fn().mockResolvedValue([sampleResult]);
    const onSelect = vi.fn();
    render(
      <AddressAutocomplete
        value=""
        onChange={() => {}}
        onSelect={onSelect}
        _search={search}
      />
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "206 la" } });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(sampleResult);
  });

  it("Escape closes the dropdown", async () => {
    const search = vi.fn().mockResolvedValue([sampleResult]);
    render(
      <AddressAutocomplete
        value=""
        onChange={() => {}}
        onSelect={() => {}}
        _search={search}
      />
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "206 la" } });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(await screen.findByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
```

### Step 2: Run, verify failure

```
npm run test -- src/options/AddressAutocomplete.test.tsx
```

Expected: fail.

### Step 3: Implement AddressAutocomplete.tsx

```tsx
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { searchAddresses, type AddressResult } from "./geocoder";

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (result: AddressResult) => void;
  id?: string;
  _search?: typeof searchAddresses;
}

const DEBOUNCE_MS = 500;
const MIN_QUERY = 3;

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  id,
  _search = searchAddresses,
}: AddressAutocompleteProps) {
  const [results, setResults] = useState<AddressResult[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listboxId = id ? `${id}-listbox` : "address-autocomplete-listbox";

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
  }, []);

  function handleChange(next: string) {
    onChange(next);
    setHighlight(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();

    if (next.trim().length < MIN_QUERY) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const ctl = new AbortController();
      abortRef.current = ctl;
      setLoading(true);
      void _search(next, { signal: ctl.signal })
        .then((r) => {
          if (ctl.signal.aborted) return;
          setResults(r);
          setOpen(r.length > 0);
          setLoading(false);
        })
        .catch((err) => {
          if (err instanceof Error && err.name === "AbortError") return;
          setLoading(false);
        });
    }, DEBOUNCE_MS);
  }

  function selectAt(index: number) {
    const r = results[index];
    if (!r) return;
    onSelect(r);
    setOpen(false);
    setResults([]);
    setHighlight(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length === 0) return;
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (open && highlight >= 0) {
        e.preventDefault();
        selectAt(highlight);
      } else if (open && results.length > 0) {
        e.preventDefault();
        selectAt(0);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="awto-address-autocomplete">
      <div className="awto-address-autocomplete__input-wrap">
        <input
          id={id}
          type="text"
          className="awto-input"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={
            highlight >= 0 ? `${listboxId}-${highlight}` : undefined
          }
          autoComplete="off"
        />
        {loading && (
          <Loader2
            size={16}
            strokeWidth={1.5}
            className="awto-address-autocomplete__spinner awto-spin"
            aria-hidden="true"
          />
        )}
      </div>
      {open && results.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="awto-address-autocomplete__list"
        >
          {results.map((r, i) => (
            <li
              id={`${listboxId}-${i}`}
              key={`${r.displayName}-${i}`}
              role="option"
              aria-selected={i === highlight}
              className={`awto-address-autocomplete__item ${i === highlight ? "is-highlighted" : ""}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                // mousedown fires before blur so we keep focus on the input
                e.preventDefault();
                selectAt(i);
              }}
            >
              {r.displayName}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

### Step 4: Add CSS rules

Append to `src/options/styles.css`:

```css
.awto-address-autocomplete {
  position: relative;
}

.awto-address-autocomplete__input-wrap {
  position: relative;
}

.awto-address-autocomplete__spinner {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-accent);
}

.awto-address-autocomplete__list {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  z-index: 10;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  max-height: 280px;
  overflow-y: auto;
}

.awto-address-autocomplete__item {
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
  color: var(--color-foreground);
}

.awto-address-autocomplete__item.is-highlighted,
.awto-address-autocomplete__item:hover {
  background: var(--color-muted);
}

.awto-spin {
  animation: awto-spin 1s linear infinite;
}

@keyframes awto-spin {
  from { transform: translateY(-50%) rotate(0deg); }
  to   { transform: translateY(-50%) rotate(360deg); }
}
```

Make sure the `.awto-spin` keyframes don't conflict with the popup's version — they use the same name but in different stylesheets. If conflict, rename the options-side keyframes to `awto-address-spin`.

### Step 5: Run tests, typecheck, build

```
npm run test
npm run typecheck
npm run build
```

Expected: typecheck clean, all tests pass (≥232 total), build OK.

### Step 6: Commit

```bash
git add src/options/AddressAutocomplete.tsx src/options/AddressAutocomplete.test.tsx src/options/styles.css
git commit -m "feat(options): AddressAutocomplete component (debounced Nominatim typeahead)"
```

---

## Task 3: Wire AddressAutocomplete into ProfileTab + privacy footer

**Files:**
- Modify: `src/options/ProfileTab.tsx`

### Step 1: Read existing ProfileTab structure

The address section is in `SECTIONS` at id `"address"`. Each field today renders generically via the field-grid loop. We need to special-case `addressLine1` to use `<AddressAutocomplete>`.

### Step 2: Implement

Import at the top:

```ts
import { AddressAutocomplete } from "./AddressAutocomplete";
import type { AddressResult } from "./geocoder";
```

Inside the `ProfileTab` component, define:

```ts
function handleAddressSelect(a: AddressResult) {
  onUpdate("addressLine1", a.addressLine1);
  if (a.suburb) onUpdate("suburb", a.suburb);
  if (a.city) onUpdate("city", a.city);
  if (a.state) onUpdate("state", a.state);
  if (a.postcode) onUpdate("postcode", a.postcode);
  if (a.country) onUpdate("country", a.country);
}
```

In the field-rendering loop, add a special branch BEFORE the ENUM_FIELDS branch:

```tsx
if (field.key === "addressLine1") {
  return (
    <div key={field.key} className="awto-field">
      <label className="awto-label" htmlFor={id}>{field.label}</label>
      <AddressAutocomplete
        id={id}
        value={value}
        onChange={(v) => onUpdate("addressLine1", v)}
        onSelect={handleAddressSelect}
      />
      {field.helper && <p className="awto-helper--inline">{field.helper}</p>}
    </div>
  );
}
```

At the end of the Address section's rendering (after the field-grid loop), add the privacy footer:

```tsx
{section.id === "address" && (
  <p className="awto-card__footer-note">
    Address suggestions powered by OpenStreetMap. Each typed query goes to <code>nominatim.openstreetmap.org</code>. No account, no login.
  </p>
)}
```

### Step 3: Run tests, typecheck, build

```
npm run test
npm run typecheck
npm run build
```

Expected: all pass. Existing tests untouched. Total stays around 232.

### Step 4: Commit

```bash
git add src/options/ProfileTab.tsx
git commit -m "feat(options): wire AddressAutocomplete into ProfileTab; OSM privacy note"
```

---

## Acceptance

- [ ] Type 3+ chars in the addressLine1 field → dropdown appears after 500ms
- [ ] Picking a suggestion fills addressLine1 plus suburb, city, state, postcode, country (if Nominatim returned each)
- [ ] Manual edit of any field still works
- [ ] Privacy footer shown in the Address card
- [ ] Manifest declares the Nominatim host permission
- [ ] All previously passing tests pass
- [ ] ~10 new tests added (5 geocoder + 5 component)
- [ ] `npm run typecheck && npm run test && npm run build` green
