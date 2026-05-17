# Grouped popup + LLM safety hardening — Implementation Plan

> Multi-file change. TDD per task. Backend safety first, then UI.

**Goal:** Group popup rows by trust level (Will fill → Review → Needs input → Skipped) so the user can verify at a glance. Tighten LLM prompt + post-validation so the categorisation is trustworthy.

**Spec:** [docs/superpowers/specs/2026-05-17-grouped-popup-and-llm-safety-design.md](../specs/2026-05-17-grouped-popup-and-llm-safety-design.md)

---

## Task 1: mapping-safety deny-list for name/pronoun/phone keys + promptText normalisation

**Files:** `src/background/mapping-safety.ts`, `src/background/mapping-safety.test.ts`

### Failing tests

Add to `mapping-safety.test.ts`:

```ts
describe("name/pronoun/phone deny-list", () => {
  it("skips firstName on a Color picker field", () => {
    const sanitized = sanitizeMappings(
      [field(0, "Color picker", "color")],
      [fill(0, "firstName")]
    );
    expect(sanitized[0]).toMatchObject({
      actionType: "skip",
      reason: expect.stringMatching(/doesn't fit/i),
    });
  });

  it("skips fullName on a Search field", () => {
    const sanitized = sanitizeMappings(
      [field(0, "Search", "search")],
      [fill(0, "fullName")]
    );
    expect(sanitized[0]).toMatchObject({ actionType: "skip" });
  });

  it("skips pronouns on a Search field", () => {
    const sanitized = sanitizeMappings(
      [field(0, "Search", "search")],
      [fill(0, "pronouns")]
    );
    expect(sanitized[0]).toMatchObject({ actionType: "skip" });
  });

  it("skips phone on an Account field", () => {
    const sanitized = sanitizeMappings(
      [field(0, "Account")],
      [fill(0, "phone")]
    );
    expect(sanitized[0]).toMatchObject({ actionType: "skip" });
  });

  it("allows pronouns on a Pronouns field", () => {
    const m = fill(0, "pronouns");
    expect(sanitizeMappings([field(0, "Pronouns")], [m])).toEqual([m]);
  });

  it("allows firstName on a First Name field", () => {
    const m = fill(0, "firstName");
    expect(sanitizeMappings([field(0, "First Name")], [m])).toEqual([m]);
  });

  it("normalises LLM-generated promptText ending in :?", () => {
    const sanitized = sanitizeMappings(
      [field(0, "Date:", "date")],
      [{
        fieldId: 0,
        actionType: "missing",
        profileKey: null,
        suggestedKey: "appointmentDate",
        promptText: "What's your date:?",
        reason: null,
        confidence: 1,
      }]
    );
    expect(sanitized[0]?.promptText).toBe("What's your Date?");
  });
});
```

### Implement

In `mapping-safety.ts`:

1. Add `pronouns` rule to INTENT_RULES:
   ```ts
   { patterns: [/\bpronouns?\b/], allow: ["pronouns"] },
   ```

2. Add `REQUIRE_LABEL_MATCH` map at module scope:
   ```ts
   const REQUIRE_LABEL_MATCH: Record<string, string[]> = {
     firstName: ["firstName", "fullName"],
     lastName: ["lastName", "fullName"],
     middleName: ["middleName", "fullName"],
     preferredName: ["preferredName", "fullName"],
     fullName: ["fullName"],
     pronouns: ["pronouns"],
     gender: ["gender"],
     phone: ["phone", "mobilePhone"],
     mobilePhone: ["phone", "mobilePhone"],
   };
   ```

3. Refactor `decide()` so it tracks which rules matched. After the loop, if no rule matched AND `profileKey` is in REQUIRE_LABEL_MATCH → skip with reason "Profile value doesn't fit this field — skipped".

4. Add a `normaliseMissing()` helper that takes a missing mapping + matching field, and if `promptText` is malformed (contains `:?` or is the legacy `What's your X:?` shape), regenerates via `phrasePrompt(field.label, suggestedKey)`.

5. Call `normaliseMissing` in `sanitizeMappings` for any `actionType: "missing"` mapping passing through.

Import `phrasePrompt` from `./rule-mapper`.

---

## Task 2: LLM prompt hard rules + claimedKeys parameter

**Files:** `src/background/llm/prompt.ts`, `src/background/llm/prompt.test.ts`, `src/background/llm/hybrid.ts`, `src/background/llm/local.ts`, `src/background/llm/cloud.ts`

### Failing tests (in prompt.test.ts if it exists, else new)

```ts
describe("buildUserPrompt — claimedKeys hint", () => {
  it("includes claimed-keys section when supplied", () => {
    const prompt = buildUserPrompt(profile, fields, ["firstName", "email"]);
    expect(prompt).toMatch(/keys already claimed/i);
    expect(prompt).toContain("firstName");
    expect(prompt).toContain("email");
  });

  it("omits claimed-keys section when empty/undefined", () => {
    expect(buildUserPrompt(profile, fields)).not.toMatch(/keys already claimed/i);
    expect(buildUserPrompt(profile, fields, [])).not.toMatch(/keys already claimed/i);
  });
});

describe("SYSTEM_PROMPT — hard never-rules", () => {
  it("includes name-on-non-name-field rule", () => {
    expect(SYSTEM_PROMPT).toMatch(/never put a person's name/i);
  });
  it("includes pronouns rule", () => {
    expect(SYSTEM_PROMPT).toMatch(/never put pronouns/i);
  });
  it("includes color picker / slider skip rule", () => {
    expect(SYSTEM_PROMPT).toMatch(/color picker.*skip/is);
  });
});
```

### Implement

1. Append to `SYSTEM_PROMPT`:
   ```
   Hard never-rules — these override everything else:

   - NEVER put a person's name (firstName, lastName, fullName, preferredName, middleName) into a field whose label does NOT contain a name word (name, applicant, passenger, customer, contact, given, family, surname). For "Color picker", "Search", "Quality", "Fruit", "Filter", "Quantity", generic input — SKIP.

   - NEVER put pronouns into a field that doesn't mention pronouns.

   - NEVER put a phone number into "Account", "Account #", "Card", "ID", "Code", or any non-phone-labelled field.

   - NEVER fill a color picker, slider, search input, file upload. SKIP with confidence 1.0.

   - For checkboxes that represent colour/food/preference choices: SKIP. Only fill consent/agreement checkboxes.

   - For radio groups: only fill if the profile value EXACTLY matches one option (case-insensitive). "he/him" does NOT match "Female".

   - If confidence < 0.85, prefer SKIP over fill. Wrong fills are worse than empty fields.
   ```

2. Update `buildUserPrompt(profile, fields, claimedKeys?)` signature. Append to the prompt body:
   ```
   Keys already claimed by parser-resolved fields on this form: [firstName, email]
   Avoid reusing these keys for other fields unless the new field clearly asks for the same data.
   ```
   Only when claimedKeys.length > 0.

3. Thread `claimedKeys` through `callHybrid` → `callLocal` / `callCloud`. The hybrid signature gains an optional argument; LLM call sites in service-worker compute it from ruleMappings.

---

## Task 3: service-worker passes claimedKeys + uses sanitised promptText

**Files:** `src/background/service-worker.ts`, `src/background/service-worker.test.ts`

### Implement

In `handleMessage`, after computing `ruleMappings`:

```ts
const claimedKeys = Array.from(new Set(
  ruleMappings
    .filter((m) => m.actionType === "fill" && m.profileKey)
    .map((m) => m.profileKey!)
));
```

Pass `claimedKeys` into the hybrid call. `sanitizeMappings` already gets called per chunk — the missing-normalisation logic from Task 1 makes the trailing `:?` fix automatic.

Add a service-worker test asserting the hybrid mock is called with claimedKeys when there's a rule mapping.

---

## Task 4: Popup grouped sections

**Files:** `src/popup/Popup.tsx`, `src/popup/Popup.test.tsx`, `src/popup/SectionHeader.tsx` (new), `src/popup/SectionHeader.test.tsx` (new), `src/popup/FieldRow.tsx`, `src/popup/styles.css`

### SectionHeader component

```tsx
interface SectionHeaderProps {
  label: string;
  count: number;
  tone: "neutral" | "amber" | "muted";
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}

export function SectionHeader({ label, count, tone, collapsible, collapsed, onToggle }: SectionHeaderProps) {
  if (count === 0) return null;
  const isButton = !!collapsible;
  const Tag = isButton ? "button" : "div";
  return (
    <Tag
      className={`awto-section-header awto-section-header--${tone}`}
      onClick={isButton ? onToggle : undefined}
      type={isButton ? "button" : undefined}
      aria-expanded={isButton ? !collapsed : undefined}
    >
      {isButton && <ChevronRight className={collapsed ? "" : "awto-rotate-90"} size={14} />}
      <span className="awto-section-header__label">{label}</span>
      <span className="awto-section-header__count">{count}</span>
    </Tag>
  );
}
```

### Popup partition

```tsx
const REVIEW_THRESHOLD = 0.85;

const sections = useMemo(() => {
  const willFill: FillRow[] = [];
  const review: FillRow[] = [];
  for (const r of state.fillRows) {
    if (r.confidence >= REVIEW_THRESHOLD || promoted.has(r.fieldId)) willFill.push(r);
    else review.push(r);
  }
  return {
    willFill,
    review,
    missing: state.missingRows,
    skipped: state.skippedRows,
  };
}, [state.fillRows, state.missingRows, state.skippedRows, promoted]);
```

`promoted` is `useState<Set<number>>(new Set())`.

ActionBar count = willFill.length + answered missing.

### FieldRow review actions

Add optional props to FieldRow: `reviewable?: boolean`, `onUse?: () => void`. When reviewable, render a tiny "Use" pill at the end (where the value is) and the value greys out slightly.

Actually simpler: render the value as today, and render "Use" / "Skip" chips below or to the right via the existing actions slot. Let me opt for: the row stays the same shape; the user clicks the row to promote, and there's a small "Tap to use" hint shown once. **Actually simplest**: a single "Use" pill button on the row. Skip is implicit (do nothing → remains in Review).

### Skipped collapse

Local `useState<boolean>(true)` for `skippedCollapsed`. When the SectionHeader is clicked, toggle. When expanded, render the skipped FieldRows.

### Tests

```ts
describe("Popup grouped sections", () => {
  it("renders Will fill section above Review section", async () => {
    mockFlow({
      status: "ready",
      state: {
        loadingFields: [],
        fillRows: [
          { fieldId: 0, selector: "#a", label: "First name", profileKey: "firstName", resolvedValue: "Patrick", confidence: 1 },
          { fieldId: 1, selector: "#b", label: "Account", profileKey: "phone", resolvedValue: "0400 000 000", confidence: 0.7 },
        ],
      },
    });
    const { Popup } = await import("./Popup");
    const { render, screen } = await import("@testing-library/react");
    const { container } = render(<Popup />);
    const headers = container.querySelectorAll(".awto-section-header__label");
    const labels = Array.from(headers).map((h) => h.textContent);
    expect(labels[0]).toBe("Will fill");
    expect(labels[1]).toBe("Review before filling");
  });

  it("promoting a Review row moves it to Will fill", async () => {
    // ... user clicks "Use" pill, ActionBar count increases
  });

  it("Skipped section starts collapsed and toggles open on click", async () => {
    // ...
  });
});
```

---

## Task 5: Verification

```
npm run typecheck && npm run test && npm run build
```

## Task 6: Commit

```
feat: grouped popup + LLM safety hardening

- Popup groups rows by trust level: Will fill > Review > Needs input > Skipped
- Skipped section collapsed by default
- Review section shows LLM fills with confidence < 0.85; user clicks Use to promote
- ActionBar fills only Will fill + answered missing rows
- mapping-safety: deny-list guard for name/pronouns/phone keys when label doesn't match
- LLM prompt: hard never-rules for name-on-non-name-field, pronouns, phone-on-account,
  color picker/slider/search skip, radio option-exact-match
- LLM prompt: claimed-keys hint listing parser-resolved keys to avoid reuse
- promptText auto-normalised via phrasePrompt for malformed "What's your X:?"
```

## Acceptance

See spec acceptance checklist.
