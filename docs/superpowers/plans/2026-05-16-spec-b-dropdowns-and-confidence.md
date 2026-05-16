# Spec B Implementation Plan

> **REQUIRED SUB-SKILL:** `superpowers:subagent-driven-development`. TDD per task.

**Goal:** title/pronouns/country dropdowns in profile editor + amber low-confidence dot in chat.

**Spec:** [docs/superpowers/specs/2026-05-16-spec-b-dropdowns-and-confidence-design.md](../specs/2026-05-16-spec-b-dropdowns-and-confidence-design.md)

---

## Task 1: countries.ts module + enum lists

**Files:**
- Create: `src/options/countries.ts`
- Create: `src/options/countries.test.ts`

- [ ] **Step 1: Write tests**

Create `src/options/countries.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { COUNTRIES, TITLES, PRONOUNS } from "./countries";

describe("country / enum lists", () => {
  it("COUNTRIES has the 5 pinned entries at the top in order", () => {
    expect(COUNTRIES.slice(0, 5)).toEqual([
      "Australia",
      "New Zealand",
      "United Kingdom",
      "United States",
      "Canada",
    ]);
  });

  it("COUNTRIES contains at least 150 countries total", () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(150);
  });

  it("COUNTRIES has no duplicates", () => {
    const set = new Set(COUNTRIES);
    expect(set.size).toBe(COUNTRIES.length);
  });

  it("countries after the pinned 5 are sorted alphabetically", () => {
    const tail = COUNTRIES.slice(5);
    const sorted = [...tail].sort();
    expect(tail).toEqual(sorted);
  });

  it("TITLES includes the common honorifics", () => {
    expect(TITLES).toContain("Mr");
    expect(TITLES).toContain("Mrs");
    expect(TITLES).toContain("Ms");
    expect(TITLES).toContain("Mx");
    expect(TITLES).toContain("Dr");
    expect(TITLES).toContain("Prof");
  });

  it("PRONOUNS includes the common defaults", () => {
    expect(PRONOUNS).toEqual(["he/him", "she/her", "they/them"]);
  });
});
```

- [ ] **Step 2: Run, verify failure**

`npm run test -- src/options/countries.test.ts` — fail (file does not exist).

- [ ] **Step 3: Implement countries.ts**

Create `src/options/countries.ts` with:

```ts
export const TITLES = ["Mr", "Mrs", "Ms", "Mx", "Dr", "Prof"] as const;
export const PRONOUNS = ["he/him", "she/her", "they/them"] as const;

const PINNED = [
  "Australia",
  "New Zealand",
  "United Kingdom",
  "United States",
  "Canada",
] as const;

const REST = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda",
  "Argentina", "Armenia", "Austria", "Azerbaijan", "Bahamas", "Bahrain",
  "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan",
  "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria",
  "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", "Cameroon", "Central African Republic",
  "Chad", "Chile", "China", "Colombia", "Comoros", "Congo", "Costa Rica",
  "Côte d'Ivoire", "Croatia", "Cuba", "Cyprus", "Czechia",
  "Democratic Republic of the Congo", "Denmark", "Djibouti", "Dominica",
  "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea",
  "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France",
  "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada",
  "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras",
  "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland",
  "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya",
  "Kiribati", "Kosovo", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon",
  "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg",
  "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta",
  "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia",
  "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique",
  "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", "Nicaragua", "Niger",
  "Nigeria", "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan",
  "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru",
  "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda",
  "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines",
  "Samoa", "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Senegal",
  "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia",
  "Solomon Islands", "Somalia", "South Africa", "South Korea", "South Sudan",
  "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria",
  "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo",
  "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan",
  "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates", "Uruguay",
  "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen",
  "Zambia", "Zimbabwe",
] as const;

export const COUNTRIES = [...PINNED, ...REST] as const;
```

- [ ] **Step 4: Run tests + typecheck**

`npm run test -- src/options/countries.test.ts && npm run typecheck`

Expected: 6 tests pass, clean.

- [ ] **Step 5: Commit**

```bash
git add src/options/countries.ts src/options/countries.test.ts
git commit -m "feat(options): countries + title + pronouns enum lists"
```

---

## Task 2: ProfileTab dropdowns

**Files:**
- Modify: `src/options/ProfileTab.tsx`
- Modify: `src/options/ProfileTab.test.tsx` (create if missing)

- [ ] **Step 1: Check existing test file**

Look for `src/options/ProfileTab.test.tsx`. If absent, create with vitest + @testing-library/react setup mirroring `Popup.test.tsx`.

- [ ] **Step 2: Write failing tests**

Add (in whichever location is appropriate):

```ts
it("renders title as a <select> with the standard honorifics", () => {
  render(<ProfileTab profile={{ ...EMPTY_PROFILE, title: "Mr" }} onUpdate={vi.fn()} ... />);
  const select = screen.getByLabelText(/title/i) as HTMLSelectElement;
  expect(select.tagName).toBe("SELECT");
  expect(Array.from(select.options).map((o) => o.value)).toEqual(
    expect.arrayContaining(["Mr", "Mrs", "Ms", "Mx", "Dr", "Prof", "__custom__"])
  );
  expect(select.value).toBe("Mr");
});

it("selecting Other... reveals a text input bound to the same field", () => {
  const onUpdate = vi.fn();
  render(<ProfileTab profile={EMPTY_PROFILE} onUpdate={onUpdate} ... />);
  const select = screen.getByLabelText(/title/i) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: "__custom__" } });
  // Now the text input should appear
  const customInput = screen.getByLabelText(/custom title/i);
  fireEvent.change(customInput, { target: { value: "Reverend" } });
  expect(onUpdate).toHaveBeenCalledWith("title", "Reverend");
});

it("a non-standard preset value renders as 'Other...' with the text input populated", () => {
  render(<ProfileTab profile={{ ...EMPTY_PROFILE, title: "Reverend" }} onUpdate={vi.fn()} ... />);
  const select = screen.getByLabelText(/title/i) as HTMLSelectElement;
  expect(select.value).toBe("__custom__");
  const customInput = screen.getByLabelText(/custom title/i) as HTMLInputElement;
  expect(customInput.value).toBe("Reverend");
});
```

Adjust to whatever the existing ProfileTab signature is — the props passed in real production are whatever `useOptionsState` returns.

- [ ] **Step 3: Run, verify failure**

`npm run test -- src/options/ProfileTab.test.tsx`

- [ ] **Step 4: Implement dropdown in ProfileTab.tsx**

Add at the top of the file:

```ts
import { TITLES, PRONOUNS, COUNTRIES } from "./countries";

const CUSTOM_SENTINEL = "__custom__";

const ENUM_FIELDS: Partial<Record<BuiltInKey, readonly string[]>> = {
  title: TITLES,
  pronouns: PRONOUNS,
  country: COUNTRIES,
};
```

Find the input rendering loop. Where each profile field gets an `<input type="text">`, branch:

```tsx
const options = ENUM_FIELDS[field.key];
if (options) {
  const isCustom = value !== "" && !options.includes(value);
  return (
    <div key={field.key} className="awto-field">
      <label className="awto-label" htmlFor={id}>{field.label}</label>
      <select
        id={id}
        value={isCustom ? CUSTOM_SENTINEL : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM_SENTINEL) {
            // user wants to type something; keep existing custom value if any
            if (!isCustom) onUpdate(field.key, value === "" ? " " : value);
            return;
          }
          onUpdate(field.key, e.target.value);
        }}
        className="awto-input"
      >
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
        <option value={CUSTOM_SENTINEL}>Other…</option>
      </select>
      {isCustom && (
        <input
          type="text"
          aria-label={`Custom ${field.label}`}
          value={value}
          onChange={(e) => onUpdate(field.key, e.target.value)}
          className="awto-input"
          style={{ marginTop: 8 }}
        />
      )}
    </div>
  );
}

// otherwise existing <input type="text"> path...
```

Tweak details to fit the actual ProfileTab structure.

- [ ] **Step 5: Run tests + typecheck**

`npm run test && npm run typecheck`

Expected: typecheck clean, all tests pass, total grows by 3.

- [ ] **Step 6: Commit**

```bash
git add src/options/ProfileTab.tsx src/options/ProfileTab.test.tsx
git commit -m "feat(options): title / pronouns / country as dropdowns with Other escape"
```

---

## Task 3: Amber confidence dot in chat

**Files:**
- Modify: `src/popup/Popup.tsx`
- Modify: `src/popup/styles.css`
- Modify: `src/popup/Popup.test.tsx`

- [ ] **Step 1: Write failing test**

Add to `src/popup/Popup.test.tsx`:

```ts
it("renders an amber confidence dot for rows with confidence < 0.85", () => {
  // Inject a mocked useAwtoFlow that returns ready state with rows of varying confidence.
  // Easiest: mock the entire hook via vi.mock("./useAwtoFlow", ...).
  vi.doMock("./useAwtoFlow", () => ({
    useAwtoFlow: () => ({
      state: {
        status: "ready",
        error: null,
        fields: [],
        mappings: [],
        fillRows: [
          { fieldId: 0, selector: "#a", label: "First", profileKey: "firstName", resolvedValue: "Pat", confidence: 0.9 },
          { fieldId: 1, selector: "#b", label: "Title", profileKey: "title", resolvedValue: "Mister", confidence: 0.6 },
        ],
        missingRows: [],
        skippedRows: [],
        filledCount: 0,
        failedFills: [],
      },
      status: "ready",
      setMissingValue: vi.fn(),
      fill: vi.fn(),
      retry: vi.fn(),
      cancel: vi.fn(),
    }),
  }));
  const { Popup } = await import("./Popup");
  render(<Popup />);
  const dots = document.querySelectorAll(".awto-confidence-dot");
  expect(dots).toHaveLength(1);
});
```

If the existing `Popup.test.tsx` uses a different mocking pattern, follow that.

- [ ] **Step 2: Run, verify failure**

`npm run test -- src/popup/Popup.test.tsx`

- [ ] **Step 3: Implement dot in Popup.tsx**

In `src/popup/Popup.tsx`, find the fill-list rendering (search for `awto-fill-list__item`). Update the label cell:

```tsx
<li key={row.fieldId} className="awto-fill-list__item">
  <span className="awto-fill-list__label">
    {row.confidence < 0.85 && (
      <span
        className="awto-confidence-dot"
        title="Low confidence — verify this value"
        aria-label="Low confidence"
      />
    )}
    {row.label}
  </span>
  <span className="awto-fill-list__value">
    {row.resolvedValue || <em className="awto-muted">empty</em>}
  </span>
</li>
```

- [ ] **Step 4: Add CSS rule**

Append to `src/popup/styles.css`:

```css
.awto-confidence-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #F59E0B;
  margin-right: 6px;
  vertical-align: middle;
}
```

- [ ] **Step 5: Run tests + typecheck + build**

`npm run test && npm run typecheck && npm run build`

Expected: all green, total tests grow by 1.

- [ ] **Step 6: Commit**

```bash
git add src/popup/Popup.tsx src/popup/styles.css src/popup/Popup.test.tsx
git commit -m "feat(popup): amber dot for low-confidence (<0.85) fill rows"
```

---

## Acceptance

- [ ] Profile editor's title, pronouns, country render as `<select>`
- [ ] Each has an "Other…" sentinel that reveals a text input
- [ ] Non-preset values load back into the "Other…" + text input correctly
- [ ] Will-fill rows with confidence < 0.85 show an amber dot with tooltip
- [ ] All existing tests pass + ~10 new tests added (6 countries + 3 ProfileTab + 1 Popup)
- [ ] typecheck + build clean
