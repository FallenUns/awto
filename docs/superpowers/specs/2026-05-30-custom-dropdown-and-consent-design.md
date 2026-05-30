# Custom dropdown detection + consent checkbox handling

**Date:** 2026-05-30
**Status:** Approved
**Related code:** `src/content/form-scanner.ts`, `src/content/form-filler.ts`, `src/background/service-worker.ts`, `src/background/consent-classifier.ts` (new), `src/shared/messages.ts`, `src/shared/consent.ts` (new), `src/shared/storage.ts`, `src/popup/types.ts`, `src/popup/useAwtoFlow.ts`, `src/popup/Popup.tsx`, `src/popup/ConsentRow.tsx` (new)

## Context

Reported on the Upwork "Sign up to find work you love" form. Two distinct gaps:

1. **The country field is never offered.** It is not a native `<select>` — it is a custom Vue widget:
   ```html
   <div role="combobox" aria-expanded="false" aria-controls="dropdown-menu" aria-required="true"
        class="air3-dropdown-toggle is-selected">
     <span class="air3-dropdown-toggle-label ellipsis">Australia</span>
   </div>
   ```
   The scanner already queries `[role="combobox"]` ([form-scanner.ts:56-60](../../../src/content/form-scanner.ts)) but **drops it** because the option list (`#dropdown-menu`) is not rendered until the dropdown is opened, so `collectRoleOptions` returns `[]` and this line discards it:
   ```ts
   if (q.collectOptions && (!options || options.length === 0)) continue;
   ```
   The filler **already** knows how to open + select these via `fillAriaListbox` / `collectListboxOptions` ([form-filler.ts:209-252](../../../src/content/form-filler.ts)). So the country case is a *detection* gap, plus filler hardening.

2. **Consent checkboxes sit spinning.** Two real `<input type="checkbox" class="sr-only">` boxes — a marketing opt-in ("Send me emails with helpful tips…") and a legal agreement ("Yes, I understand and agree to the Terms of Service… Privacy Policy") — are scanned (sr-only is not `display:none`, so `isHidden` passes them) but their LLM mapping never resolves, leaving them stuck in the `loading` row state ([FieldRow.tsx:80,91](../../../src/popup/FieldRow.tsx)). Patrick wants consent handled deliberately: marketing pre-ticked (but editable), legal off until he flips it, nothing written until he clicks Fill.

## Decisions

| Question | Decision |
|---|---|
| Consent tick proposal | **Pre-tick marketing only.** Marketing opt-ins proposed ON (editable); legal/ToS/Privacy proposed OFF and require a deliberate flip. |
| Consent memory | **Remember marketing only.** One stored `marketingConsent` preference (`optIn`/`optOut`, default `optIn`), updated when Patrick toggles a marketing box at Fill time. Legal agreements are never remembered — confirmed fresh on every form. |
| Consent decisioning | **Deterministic classifier, not the LLM.** Consent is safety-critical; a rule-based classifier decides marketing/legal and the proposed state. No LLM call, no tokens, fully unit-testable. This also removes the stuck-`loading` failure mode for these rows. |
| Dropdown reach | **Any custom dropdown.** Capture `role="combobox"`, `role="listbox"`, and `[aria-haspopup="listbox"]`. **Excluded:** command menus (`aria-haspopup="menu"` / `role="menu"` popups) and search comboboxes — these are not value pickers, so excluding them is not a coverage cut. |
| Combobox options at scan time | **Not required.** Capture option-less (closed) comboboxes. Read the *current value* without opening; treat placeholder text (`Select…`, `Choose…`, `Select a Country`) as **empty** → routes to "Needs input" rather than reading the prompt as a value. |
| Combobox label fallback | When no `aria-labelledby`/`aria-label`/adjacent label exists, use the placeholder/display text as the label signal ("Select a Country" *is* the field name on Upwork). |
| Filler hardening | Upgrade `fillAriaListbox`: realistic open sequence (`pointerdown→mousedown→mouseup→click`), `MutationObserver` wait (~1.5s, resolves portals via `aria-controls`/`aria-owns`), reuse the F2 fuzzy ladder, **verify the value changed**, keyboard type-ahead fallback (`ArrowDown` + chars + `Enter`), and report unconfirmed fills via the existing F3 "Couldn't fill" channel. Never a silent wrong-fill. |
| Loading-forever guard | Any scanned field the LLM omits from its response resolves to a safe **skip**, not an indefinite spinner. |
| Result shape | Consent decisions travel on a **separate channel** alongside the LLM `mappings`; the LLM schema (decision #9) is untouched. Consent fields are excluded from the set sent to the LLM. |

## Architecture

### 1. Scanner — capture custom dropdowns + consent link metadata

**Stop dropping option-less comboboxes.** Tag each `AriaQuery` with `requireOptions`:

| Query | `type` | `requireOptions` |
|---|---|---|
| `[role="radiogroup"]` | radio | true (no radios ⇒ not a group) |
| `[role="checkbox"]` | checkbox | — |
| `[role="textbox"][contenteditable="true"]` | text | — |
| `[role="combobox"]` | select | **false** |
| `[role="listbox"]` (not inside a combobox) | select | **false** |
| `[aria-haspopup="listbox"]` (not `[role="combobox"]`) | select | **false** (new query) |

Replace the unconditional skip with: skip only when `q.requireOptions && options.length === 0`. Comboboxes are captured even when closed; `options` is attached when present.

**Exclusions** (added to the ARIA loop): skip an element if it (or its trigger) has `aria-haspopup="menu"`, if its popup target is `[role="menu"]`, or if it is a search combobox (`aria-autocomplete` + a search-y label/placeholder — reuses the F5 search heuristic).

**Read current value without opening** — new `readComboboxValue(el)` priority ladder:
1. `aria-activedescendant` → target element `textContent`.
2. Selected `[role="option"][aria-selected="true"]` text (when options happen to be in DOM).
3. The toggle's label child (`[class*="label"]`, falling back to the element's own `textContent`).
4. If the result matches a placeholder pattern (`/^(select|choose|please|pick|—|--)\b/i`) → return `null` (empty).

The combobox `ScannedField` gets `currentValue` (from the ladder) and, when value is empty, the placeholder display text is used as the `label` fallback and stored in `placeholder`.

**Consent link capture.** For checkbox fields, collect any `<a>` descendants of the label into `field.links: ConsentLink[]` (`{ text, href }`). Lets the popup show the actual ToS/Privacy links for legal review. No links ⇒ field omits `links`.

`ScannedField` (in `messages.ts`) gains two optional fields — non-breaking, downstream code ignores unknown optionals:
```ts
currentValue?: string;
links?: ConsentLink[];
```

### 2. Consent classifier — new deterministic module

`src/background/consent-classifier.ts`:

```ts
export function classifyConsent(field: ScannedField): "marketing" | "legal" | null;

export function buildConsentDecisions(
  fields: ScannedField[],
  marketingPref: "optIn" | "optOut"
): { consent: ConsentDecision[]; consentIds: Set<number> };
```

- A field is a consent candidate when `type === "checkbox"` (native or ARIA).
- **Marketing** — label matches `/email|newsletter|tips|offer|promo|marketing|update|subscribe|deal|news\b/i`.
- **Legal** — label matches `/terms|conditions|privacy|policy|agree|user agreement|consent|i am over|18 years|age of/i`.
- **Neither** → not a consent field (left for the normal pipeline, which skips bare checkboxes today).
- If a label matches both families, **legal wins** (more conservative).

`ConsentDecision` (`src/shared/consent.ts`):
```ts
export interface ConsentLink { text: string; href: string; }
export interface ConsentDecision {
  fieldId: number;
  selector: string;
  label: string;
  consentType: "marketing" | "legal";
  proposedChecked: boolean;        // marketing: pref === "optIn"; legal: always false
  links?: ConsentLink[];
}
```

### 3. Service worker — consent channel + loading guard

In the `mapFields` handler, before invoking the LLM:
1. Read `marketingConsent` from storage.
2. `buildConsentDecisions(fields, pref)` → `consent[]` + `consentIds`.
3. Emit `{ type: "mapFieldsConsent", consent }` immediately (port + sendResponse paths) so consent rows render without ever spinning.
4. Run the existing prefilter/rule-mapper/LLM pipeline on `fields.filter(f => !consentIds.has(f.id))`.

On the **cache-hit** path (Spec C): consent is recomputed fresh (cheap, deterministic) and emitted alongside the cached `mapFieldsResult`; consent is **not** cached (the marketing pref can change between hits).

The progressive flow already streams `mapFieldsProgress` / `mapFieldsComplete`. No new LLM-side state.

### 4. Filler — harden `fillAriaListbox` + consent fill

Replace the current `el.click()` + single `requestAnimationFrame` body with:

```ts
async function fillAriaListbox(el, value) {
  const before = readComboboxValue(el);
  fireOpen(el);                                  // pointerdown → mousedown → mouseup → click
  const listbox = await waitForListbox(el, 1500); // MutationObserver on document.body, resolves aria-controls/aria-owns
  if (listbox) {
    const match = matchOption(collectOptions(listbox), value); // exact → startsWith → substring → Levenshtein ≤2
    if (match) {
      fireOpen(match);
      if (await valueChanged(el, before, value)) return { filled: true };
    }
  }
  if (await keyboardSelect(el, value)) return { filled: true }; // ArrowDown + type-ahead + Enter
  closeIfOpen(el);
  return { filled: false, reason: "could not select option" };
}
```

- `fireOpen` dispatches the realistic pointer/mouse sequence; many widgets open on `mousedown`, not `click`.
- `waitForListbox` observes `document.body` (subtree + `aria-expanded`), bridging portals via `aria-controls`/`aria-owns`, with a global `[role="listbox"]` fallback and a timeout.
- `valueChanged` re-reads `readComboboxValue` to confirm the selection actually took before claiming success.
- Failures flow to the existing `FillResult.failed` → F3 "Couldn't fill: …" surface.

**Consent fill** reuses existing paths unchanged: a consent `FillValue` carries `value: "true" | "false"`; native checkboxes hit [form-filler.ts:45-50](../../../src/content/form-filler.ts), ARIA checkboxes hit `fillAriaCheckbox`. No new filler code for consent.

`isTrusted:false` caveat: a hardened minority of widgets ignore synthetic events (no in-page workaround exists). Those become honest "Couldn't fill" reports, not wrong values — consistent with the zero-incorrect-fills bar.

### 5. Popup — Consent section + toggles

- New `ConsentRow.tsx`: a labelled **toggle switch** (≥44px target) + the consent label; legal rows render the `links` as inline anchors (`target="_blank"`) and a subtle "required" hint. Distinct from the text-valued `FieldRow`.
- `Popup.tsx` gains a **Consent** section, ordered after "Will fill" / "Needs input" and before "Skipped". Marketing toggles initialise ON (per `proposedChecked`), legal OFF.
- Toggles that are ON count toward the "Fill N fields" total.
- `useAwtoFlow.ts`:
  - Handle `mapFieldsConsent`: populate `consentRows` and remove those `fieldId`s from `loadingFields` (so they never spin).
  - On `mapFieldsComplete`/`mapFieldsResult`: resolve any scanned field with no mapping and not in consent to a synthetic **skip** (`reason: "no mapping returned"`) — the loading-forever guard.
  - On Fill: append one `FillValue` per consent row (`value: row.checked ? "true" : "false"`) to the existing fill/missing values, then persist the marketing preference from the marketing rows' final state (`setMarketingConsent(anyMarketingChecked ? "optIn" : "optOut")`).

`FlowState` gains `consentRows: ConsentRow[]`:
```ts
export interface ConsentRow {
  fieldId: number;
  selector: string;
  label: string;
  consentType: "marketing" | "legal";
  checked: boolean;          // user-editable, seeded from proposedChecked
  links?: ConsentLink[];
}
```

### 6. Storage — marketing preference

`src/shared/storage.ts` gains a typed accessor backed by `chrome.storage.local` key `awto:consent`:
```ts
getMarketingConsent(): Promise<"optIn" | "optOut">;   // default "optIn"
setMarketingConsent(value: "optIn" | "optOut"): Promise<void>;
```
Legal choices are never written. The marketing preference is the only consent state persisted.

### 7. Messages

`AwtoMessage` gains one variant; existing variants are unchanged:
```ts
| { type: "mapFieldsConsent"; consent: ConsentDecision[] }
```

### 8. Pipeline integration

| Layer | Change |
|---|---|
| `form-scanner.ts` | `requireOptions` per ARIA query; capture option-less comboboxes; `[aria-haspopup="listbox"]` query; menu/search exclusion; `readComboboxValue` + placeholder/label handling; consent `links` capture |
| `form-filler.ts` | Harden `fillAriaListbox` (open sequence, `MutationObserver`, verify, keyboard fallback); import `readComboboxValue` from the scanner |
| `consent-classifier.ts` | **New** — `classifyConsent`, `buildConsentDecisions` |
| `service-worker.ts` | Compute + emit consent; exclude consent fields from LLM; fresh consent on cache hit |
| `shared/messages.ts` | `mapFieldsConsent`; `ScannedField.currentValue`, `ScannedField.links` |
| `shared/consent.ts` | **New** — `ConsentLink`, `ConsentDecision` types |
| `shared/storage.ts` | `getMarketingConsent` / `setMarketingConsent` |
| `popup/types.ts` | `ConsentRow`; `FlowState.consentRows` |
| `popup/useAwtoFlow.ts` | Consent handling, loading guard, consent fill values, marketing learning |
| `popup/Popup.tsx` | Consent section |
| `popup/ConsentRow.tsx` | **New** — toggle row |
| `llm/prompt.ts`, `rule-mapper.ts`, `mapping-safety.ts`, `detector.ts` | None |

## Edge cases

- **Already-correct dropdown**: `currentValue` matches the profile value → the LLM may still propose a fill; `fillAriaListbox` is idempotent (`valueChanged` sees no change needed and returns success). No spurious failure.
- **Empty combobox with placeholder only** ("Select a Country"): `currentValue` is `null`, label falls back to placeholder; LLM maps it to `country`.
- **Virtualized / portaled / shadow-DOM dropdowns**: best-effort. Portals resolved via `aria-controls`; virtualization handled by the keyboard type-ahead path; closed shadow roots are unreachable → honest "Couldn't fill". No silent wrong-fill.
- **Checkbox that is both marketing and legal-flavoured**: legal classification wins → proposed OFF.
- **Marketing box already checked on the page** (Upwork's is): proposal still reflects the stored preference; the toggle shows the proposed state, and Fill writes the explicit boolean.
- **Multiple marketing boxes**: preference learned from whether any marketing row ends checked.
- **No consent fields on the page**: `consent[]` empty; `mapFieldsConsent` still sent (harmless); no Consent section rendered.
- **Bare checkbox that is neither marketing nor legal** (e.g. "Remember me"): not a consent field; existing behaviour (skipped) preserved.
- **LLM omits a non-consent field**: resolves to skip via the loading guard rather than spinning.
- **Menu button with `role="combobox"`-like markup but `aria-haspopup="menu"`**: excluded, not offered.

## Testing

**Scanner** (`form-scanner.test.ts`):
- Closed combobox (Upwork country fixture, zero inline options) is captured with placeholder-derived label and `currentValue` from the toggle text.
- `aria-haspopup="listbox"` button captured; `aria-haspopup="menu"` / `role="menu"` excluded; search combobox excluded.
- Placeholder text ("Select a Country") → `currentValue` is `null`/empty.
- Consent checkbox with anchor children → `links` populated.

**Consent classifier** (`consent-classifier.test.ts`):
- Marketing labels → `marketing`, proposed ON when `optIn`, OFF when `optOut`.
- Legal labels → `legal`, always proposed OFF.
- Both-family label → `legal`.
- Neither → `null`.
- `buildConsentDecisions` excludes consent ids from the LLM set.

**Filler** (`form-filler.test.ts`):
- `fillAriaListbox` opens via the pointer sequence, waits for portal-rendered options, fuzzy-matches, clicks, and verifies the value.
- No matching option / unconfirmed change → keyboard fallback attempted, then `{ filled: false }`.
- Idempotent when the value is already selected.
- Consent `FillValue` ("true"/"false") toggles native and ARIA checkboxes correctly.

**Service worker** (`service-worker.test.ts`):
- `mapFieldsConsent` emitted before LLM; consent fields excluded from the LLM `fields`.
- Cache-hit path recomputes consent fresh.

**Popup** (`useAwtoFlow.test.ts`, `Popup.test.tsx`, `ConsentRow.test.tsx`):
- Consent rows removed from `loadingFields` on `mapFieldsConsent` (no spinner).
- Marketing toggle seeded ON, legal OFF; ON toggles add to the fill count.
- Fill emits consent `FillValue`s and persists the marketing preference.
- Loading guard: a scanned field with no mapping resolves to skip.

**Storage** (`storage.test.ts`): `getMarketingConsent`/`setMarketingConsent` round-trip; default `optIn`.

## Acceptance

- [ ] On the Upwork signup form, the country dropdown appears as a fillable row and Fill sets it to Patrick's country (custom Vue combobox driven correctly).
- [ ] The marketing checkbox appears in a Consent section pre-ticked (editable); the legal checkbox appears unticked and requires a deliberate flip; neither writes until Fill.
- [ ] No consent row ever shows the spinner; a field the LLM omits resolves to skip, not an endless spinner.
- [ ] Toggling the marketing box off and filling persists `optOut`; the next form proposes it off.
- [ ] A dropdown that cannot be confidently set is reported via "Couldn't fill", never wrong-filled (zero incorrect fills preserved).
- [ ] `npm run typecheck && npm run test && npm run build` green; existing suite passes plus the new tests above.

## Out of scope (deferred)

- Remembering legal/ToS agreements (explicitly excluded — confirmed fresh every time).
- Per-site consent preferences (one global marketing preference in v1).
- Closed shadow-DOM dropdowns (unreachable from a content script).
- Iframe-embedded forms (existing limitation).
- LLM-side use of `currentValue` to suppress already-correct proposals (idempotent fill covers it for v1).
