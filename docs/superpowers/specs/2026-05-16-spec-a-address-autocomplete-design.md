# Spec A — Address autocomplete in profile editor

**Date:** 2026-05-16
**Status:** Approved
**Related code:** `src/options/ProfileTab.tsx`, `src/options/geocoder.ts` (new), `src/options/AddressAutocomplete.tsx` (new), `manifest.json`

## Context

Today the profile editor's address fields (line1, line2, suburb, city, state, postcode, country) are independent free-text inputs. Annoying to fill: user types each field separately, no validation, no spell-check. Single typo in postcode silently breaks form-fill.

Fix: type a few characters of your address into the line1 field, get a dropdown of suggestions from OpenStreetMap, pick one, and watch the rest of the fields auto-populate. One pick, six fields filled.

## Decisions

| Question | Decision |
|---|---|
| Geocoder | Nominatim (OpenStreetMap) — free, no API key, decent quality for AU/major countries |
| Trigger | Profile editor only — form-fill keeps using the resulting profile values as today |
| Min query length | 3 characters |
| Debounce | 500ms (respects Nominatim's 1 req/sec rate limit + reduces keystroke noise) |
| Cancellation | AbortController per request — new keystroke cancels previous |
| Result count | Up to 5 |
| Privacy footer | Yes — disclose that queries go to nominatim.openstreetmap.org |

## Architecture

### Section 1 — Nominatim client

**File `src/options/geocoder.ts` (new):**

```ts
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

export async function searchAddresses(
  query: string,
  opts: { signal?: AbortSignal; limit?: number } = {}
): Promise<AddressResult[]>;
```

Endpoint: `https://nominatim.openstreetmap.org/search?q=<encoded>&format=json&addressdetails=1&limit=<n>`.

Behavior:
- Returns `[]` on empty/whitespace query
- Returns `[]` on HTTP error or network failure (does not throw)
- Honors `opts.signal` — rethrows `AbortError` so callers can distinguish cancellation from data results

Mapping from Nominatim response to `AddressResult`:
- `addressLine1`: `house_number ? house_number + " " + road : road` (fallback to empty)
- `suburb`: `address.suburb ?? address.neighbourhood ?? ""`
- `city`: `address.city ?? address.town ?? address.village ?? ""`
- `state`: `address.state ?? address.province ?? ""`
- `postcode`: `address.postcode ?? ""`
- `country`: `address.country ?? ""`
- `displayName`: response `display_name`
- `raw`: full response item (debugging)

**Manifest change:** add `https://nominatim.openstreetmap.org/*` to `host_permissions`.

### Section 2 — `<AddressAutocomplete>` component

**File `src/options/AddressAutocomplete.tsx` (new):**

Props:

```ts
interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (result: AddressResult) => void;
  id?: string;
  // DI for testing
  _search?: typeof searchAddresses;
}
```

UX:
- Wraps an `<input type="text">` styled like the existing `.awto-input`
- On change: calls `onChange(value)` immediately (parent controls the value); also schedules a debounced fetch (500ms)
- Fetch fires only when `value.trim().length >= 3`
- Each fetch uses a fresh `AbortController`; previous in-flight aborts on new keystroke
- Results dropdown appears below the input, max 5 items showing `displayName`
- Keyboard nav: ArrowDown/ArrowUp move the highlight, Enter selects, Esc closes
- Click on a result selects it
- On select: calls `onSelect(result)`, closes the dropdown
- Loading indicator: small `Loader2` spinner inside the input, right side, only while fetching
- Component cleans up the AbortController on unmount

Accessibility:
- `role="combobox"`, `aria-expanded` on the input
- `aria-autocomplete="list"`, `aria-controls` linking to the listbox id
- Listbox has `role="listbox"`; each result `role="option"` with `aria-selected`
- `aria-activedescendant` on the input pointing at the highlighted option

### Section 3 — ProfileTab integration + privacy note

**Modify `src/options/ProfileTab.tsx`:**

In the address section, replace the addressLine1 row with `<AddressAutocomplete>`. Wire `onSelect` to update all six address fields:

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

Empty Nominatim fields are skipped (don't clobber existing user-typed values).

**Privacy footer** below the Address card:

> Address suggestions powered by OpenStreetMap. Each typed query goes to `nominatim.openstreetmap.org`. No account, no login.

Styled with the existing `.awto-card__footer-note` class.

## Testing strategy

`src/options/geocoder.test.ts` (new):
- Empty query → returns []
- Mock fetch with a realistic Nominatim response → returns mapped AddressResult[]
- Mock fetch with 500 status → returns [] (no throw)
- Mock fetch rejection → returns [] (no throw)
- AbortSignal pre-aborted → fetch is not awaited (or aborts immediately) → rethrows AbortError

`src/options/AddressAutocomplete.test.tsx` (new):
- Typing < 3 chars does not call _search
- Typing ≥ 3 chars then advancing 500ms calls _search once
- Typing twice fast then advancing only fires _search once (debounce)
- Returned results render in the dropdown
- ArrowDown + Enter selects the first result; onSelect called with the correct AddressResult
- Click on a result fires onSelect

## Acceptance

- [ ] Address line 1 in profile editor shows a typeahead dropdown
- [ ] Picking a suggestion fills six fields at once
- [ ] Manual edit of any post-pick field still works
- [ ] Privacy footer visible in the Address card
- [ ] Manifest declares the Nominatim host permission
- [ ] `npm run typecheck && npm run test && npm run build` green
- [ ] Total tests grow by ~10 (5 geocoder + 5 component)

## Out of scope

- Live form-fill autocomplete on the page (only profile editor)
- API key configuration
- User-Agent header (forbidden in browser fetch; we accept Nominatim's anonymous treatment)
- Address validation (presence-only, no postcode-vs-state cross-check)
- International field nuances beyond suburb/city/state/postcode/country
