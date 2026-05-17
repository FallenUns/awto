# Tohodo stress-test fixes — Implementation Plan

> Four small parser-layer changes. TDD per task.

**Goal:** Move work from "LLM / generic prompt" back to the parser where it belongs. Five symptoms; four code changes.

**Spec:** [docs/superpowers/specs/2026-05-17-tohodo-stress-test-fixes-design.md](../specs/2026-05-17-tohodo-stress-test-fixes-design.md)

---

## Task 1: Scanner skips RTE auxiliary inputs

**Files:**
- Modify: `src/content/form-scanner.ts`
- Modify: `src/content/form-scanner.test.ts`

### Step 1: Write failing tests

Append to `form-scanner.test.ts`:

```ts
describe("RTE auxiliary inputs", () => {
  it("skips CKEditor cke_* inputs", () => {
    document.body.innerHTML = `
      <form>
        <input id="email" type="email" />
        <div class="cke_editable">
          <input class="cke_clipboard" />
          <textarea class="cke_textarea_inline"></textarea>
        </div>
      </form>
    `;
    const fields = scanFields();
    expect(fields.map((f) => f.selector)).toEqual(["#email"]);
  });

  it("skips Quill ql-* inputs", () => {
    document.body.innerHTML = `
      <form>
        <input id="email" type="email" />
        <div class="ql-container">
          <textarea class="ql-clipboard"></textarea>
        </div>
      </form>
    `;
    const fields = scanFields();
    expect(fields.map((f) => f.selector)).toEqual(["#email"]);
  });

  it("skips Summernote / TinyMCE / Trumbowyg auxiliary inputs", () => {
    document.body.innerHTML = `
      <form>
        <input id="email" type="email" />
        <div class="note-editor"><textarea class="note-codable"></textarea></div>
        <div class="tox-tinymce"><input class="tox-something" /></div>
        <div class="trumbowyg-box"><textarea class="trumbowyg-textarea"></textarea></div>
      </form>
    `;
    const fields = scanFields();
    expect(fields.map((f) => f.selector)).toEqual(["#email"]);
  });
});
```

### Step 2: Implement

In `form-scanner.ts`, add inside `isEligible` (before the hidden check):

```ts
if (isInsideRichTextEditor(el)) return false;
```

Add helper near the bottom:

```ts
const RTE_ANCESTOR_SELECTOR = [
  ".ck-editor", ".ck", ".cke_editable", ".cke_wysiwyg_div",
  ".ql-container", ".ql-editor",
  ".note-editor", ".note-editable",
  ".tox-tinymce", ".tox-edit-area",
  ".fr-wrapper", ".fr-box", ".fr-element",
  ".trumbowyg-box", ".trumbowyg-editor",
  ".summernote",
  ".mce-edit-area", ".mce-tinymce",
  ".cm-editor",
  '[contenteditable="true"]',
].join(",");

const RTE_OWN_CLASS_PREFIXES = [
  "cke_", "ql-", "mce_", "tox-", "summernote-", "trumbowyg-", "fr-",
];

function isInsideRichTextEditor(el: HTMLElement): boolean {
  if (el.closest(RTE_ANCESTOR_SELECTOR)) return true;
  const classes = (el.getAttribute("class") ?? "").split(/\s+/);
  if (classes.some((c) => RTE_OWN_CLASS_PREFIXES.some((p) => c.startsWith(p)))) {
    return true;
  }
  const id = el.id ?? "";
  if (RTE_OWN_CLASS_PREFIXES.some((p) => id.startsWith(p))) return true;
  return false;
}
```

### Step 3: Run tests

```
npm run test -- form-scanner.test.ts
```

---

## Task 2: DOB-group detection via name/id

**Files:**
- Modify: `src/background/rule-mapper.ts`
- Modify: `src/background/rule-mapper.test.ts`

### Step 1: Write failing tests

Append:

```ts
describe("split DOB group with shared 'Birthday' label", () => {
  const profile = makeProfile({ dateOfBirth: "1990-04-15" });

  function dobGroup(): ScannedField[] {
    return [
      { id: 0, selector: "#bd-month", label: "Birthday", placeholder: null, type: "select", required: false, options: ["January","February","March","April","May","June","July","August","September","October","November","December"] },
      { id: 1, selector: '[name="day"]', label: "Birthday", placeholder: null, type: "select", required: false, options: ["01","02","03","04","05","06","07","08","09","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24","25","26","27","28","29","30","31"] },
      { id: 2, selector: '[name="year"]', label: "Birthday", placeholder: null, type: "select", required: false, options: ["1990","1991","1992","1993"] },
    ];
  }

  it("classifies each select to its DOB part via selector hint", () => {
    const { ruleMappings } = ruleMap(dobGroup(), profile);
    expect(ruleMappings.map((m) => m.profileKey)).toEqual([
      "dateOfBirthMonth",
      "dateOfBirthDay",
      "dateOfBirthYear",
    ]);
  });
});
```

### Step 2: Implement

Update `dateOfBirthPartKey` and its caller in `rule-mapper.ts`:

```ts
function dateOfBirthPartKey(
  field: ScannedField,
  signal: string
): "dateOfBirthMonth" | "dateOfBirthDay" | "dateOfBirthYear" | null {
  if (field.type !== "select") return null;
  const hint = normalizeSignal(selectorHint(field.selector));
  const combined = `${signal} ${hint}`.trim();
  if (!/\b(date\s*of\s*birth|birth\s*date|dob|birthday|month|day|year)\b/.test(combined)) {
    return null;
  }

  if (/\bmonth\b/.test(hint)) return "dateOfBirthMonth";
  if (/\bday\b/.test(hint)) return "dateOfBirthDay";
  if (/\byear\b/.test(hint)) return "dateOfBirthYear";

  const options = (field.options ?? []).map(normalizeSignal).filter(Boolean);
  if (/^month$/.test(signal) || options.some((o) => MONTH_OPTION_WORDS.has(o))) {
    return "dateOfBirthMonth";
  }
  if (/^day$/.test(signal) || options.includes("day")) {
    return "dateOfBirthDay";
  }
  if (/^year$/.test(signal) || options.includes("year") || options.some((o) => /^\d{4}$/.test(o))) {
    return "dateOfBirthYear";
  }
  return null;
}
```

Note `selectorHint` is already defined. Also note the entry condition now includes `birthday`.

### Step 3: Add radio/select option-match guard

In `ruleMap`, after computing `value` but before emitting `makeFill`:

```ts
if (value !== undefined && value !== "") {
  if (
    field.type === "radio" &&
    field.options && field.options.length > 0 &&
    !matchesAnyOption(value, field.options)
  ) {
    remaining.push(field);
    continue;
  }
  ruleMappings.push(makeFill(field.id, key));
} else {
  ruleMappings.push(makeMissing(field.id, key, field.label));
}
```

Note: the guard applies only to `radio`. Selects already have fuzzy fill-time matching (exact → substring → Levenshtein in `form-filler.ts`), so an option-match guard here would be redundant and would reject legitimate cases (e.g. DOB month "04" vs select option "April" — the filler handles that fuzzy translation downstream). Radios have no such safety net — a wrong value selects the wrong button silently.

Add helper:

```ts
function matchesAnyOption(value: string, options: string[]): boolean {
  const v = value.trim().toLowerCase();
  return options.some((o) => o.trim().toLowerCase() === v);
}
```

For DOB month select, the profile value `dateOfBirthMonth` is the month name (e.g. "April") which matches the option. For day/year, the value is "15" / "1990" which matches. Verify by reading `getProfileValue` semantics; if it returns "04" for day, the option list `["01"..."31"]` matches "04". Good.

Add a test for radio with no matching option:

```ts
it("radio with no matching profile option falls through to LLM", () => {
  const profile = makeProfile({ gender: "Male" });
  const fields: ScannedField[] = [
    { id: 0, selector: '[name="g"]', label: "Gender", placeholder: null, type: "radio", required: false, options: ["Female", "Other"] },
  ];
  const { ruleMappings, remaining } = ruleMap(fields, profile);
  expect(ruleMappings).toHaveLength(0);
  expect(remaining).toHaveLength(1);
});

it("radio with matching profile option fills", () => {
  const profile = makeProfile({ gender: "Female" });
  const fields: ScannedField[] = [
    { id: 0, selector: '[name="g"]', label: "Gender", placeholder: null, type: "radio", required: false, options: ["Male", "Female", "Other"] },
  ];
  const { ruleMappings } = ruleMap(fields, profile);
  expect(ruleMappings[0]).toMatchObject({ actionType: "fill", profileKey: "gender" });
});
```

---

## Task 3: Prefilter becomes minimal passthrough

**Files:**
- Modify: `src/background/field-prefilter.ts`
- Modify: `src/background/field-prefilter.test.ts`

### Step 1: Update tests

Existing tests assert radios/checkboxes get skipped. Flip them:

```ts
it("does not pre-skip radios", () => {
  const fields = [makeField({ id: 0, type: "radio" })];
  const { toLLM, skipped } = prefilter(fields, makeProfile({}));
  expect(toLLM).toHaveLength(1);
  expect(skipped).toHaveLength(0);
});

it("does not pre-skip checkboxes", () => {
  const fields = [makeField({ id: 0, type: "checkbox" })];
  const { toLLM, skipped } = prefilter(fields, makeProfile({}));
  expect(toLLM).toHaveLength(1);
  expect(skipped).toHaveLength(0);
});
```

### Step 2: Implement

Replace the loop with:

```ts
export function prefilter(
  fields: ScannedField[],
  _profile: Profile
): PrefilterResult {
  return { toLLM: [...fields], skipped: [] };
}
```

Keep the export shape so callers don't change. The `_profile` arg stays for future use.

Delete the now-unused `CONSENT_KEY_PATTERNS` / `hasConsentKey` / `makeSkip` helpers.

---

## Task 4: Smarter prompt phrasing in rule-mapper

**Files:**
- Modify: `src/background/rule-mapper.ts`
- Modify: `src/background/rule-mapper.test.ts`

### Step 1: Write failing tests

Append:

```ts
describe("phrasePrompt — question-form labels", () => {
  it("uses verbatim when label ends with ?", () => {
    const profile = makeProfile({});
    const fields: ScannedField[] = [
      { id: 0, selector: '[name="x"]', label: "What's your favourite colour?", placeholder: null, type: "text", required: false },
    ];
    const { ruleMappings } = ruleMap(fields, profile);
    // No rule matches → falls through to LLM; this case is exercised via the helper export. Test the helper directly.
  });

  it("appends ? when label starts with a wh-word", () => {
    expect(phrasePrompt("Tell us about yourself", "x")).toBe("Tell us about yourself?");
    expect(phrasePrompt("Describe your role", "x")).toBe("Describe your role?");
    expect(phrasePrompt("How long have you worked here", "x")).toBe("How long have you worked here?");
  });

  it("uses 'What's your X?' template for noun-form labels", () => {
    expect(phrasePrompt("Email", "email")).toBe("What's your Email?");
    expect(phrasePrompt("Email:", "email")).toBe("What's your Email?");
  });

  it("returns verbatim when already a question", () => {
    expect(phrasePrompt("What's your name?", "x")).toBe("What's your name?");
    expect(phrasePrompt("To what URL should this link go?", "x")).toBe("To what URL should this link go?");
  });

  it("falls back to fallbackKey when label is empty", () => {
    expect(phrasePrompt("", "userId")).toBe("What's your userId?");
  });
});
```

### Step 2: Implement

Add to `rule-mapper.ts` (and export):

```ts
export function phrasePrompt(label: string, fallbackKey: string): string {
  const trimmed = label.trim();
  if (!trimmed) return `What's your ${fallbackKey}?`;
  if (trimmed.endsWith("?")) return trimmed;
  if (looksLikeQuestion(trimmed)) {
    return trimmed.endsWith(".") ? `${trimmed.slice(0, -1)}?` : `${trimmed}?`;
  }
  const stripped = trimmed.replace(/[:.]+$/, "");
  return `What's your ${stripped}?`;
}

function looksLikeQuestion(text: string): boolean {
  return /^(what|where|when|why|how|who|which|to\s+what|is|are|do|does|did|can|could|should|would|will|tell|describe)\b/i.test(text);
}
```

Update `makeMissing` to use it:

```ts
function makeMissing(
  fieldId: number,
  key: string,
  label: string,
  promptText?: string
): FieldMapping {
  return {
    fieldId,
    actionType: "missing",
    profileKey: null,
    suggestedKey: key,
    promptText: promptText ?? phrasePrompt(label, key),
    reason: null,
    confidence: 1,
  };
}
```

LABEL_RULES with explicit `missingPrompt` still take precedence (they pass `promptText` to `makeMissing`).

---

## Task 5: Verification

```
npm run typecheck
npm run test
npm run build
```

All green. Existing 347 + ~10 new tests pass.

## Task 6: Commit

```bash
git add src/content/form-scanner.ts src/content/form-scanner.test.ts \
        src/background/rule-mapper.ts src/background/rule-mapper.test.ts \
        src/background/field-prefilter.ts src/background/field-prefilter.test.ts \
        docs/superpowers/specs/2026-05-17-tohodo-stress-test-fixes-design.md \
        docs/superpowers/plans/2026-05-17-tohodo-stress-test-fixes.md
git commit -m "feat: parser handles split DOB + radios + skip RTE auxiliary inputs

Five Tohodo stress-test fixes, all in the parser layer:

1. Scanner skips inputs inside known RTE wrappers (CKEditor, Quill,
   Summernote, TinyMCE, Trumbowyg, Froala, CodeMirror) — kills the
   'Field 30/31/32/33' rows that came from RTE plumbing inputs.

2. DOB-part rule also reads selector hint (name/id). Three selects
   named month/day/year under one 'Birthday:' label now classify
   individually instead of producing three duplicate shimmer rows.

3. Field-prefilter no longer hard-skips all radios and checkboxes.
   Rule-mapper picks up gender/pronouns/work-rights radios; LLM
   handles the rest with its existing conservative per-type rules.

4. Rule-mapper guards radio/select fills: if profile value doesn't
   match any of the field's options, fall through to LLM instead
   of emitting a wrong fill.

5. Missing-row prompts use the label verbatim when it's already a
   question (ends with ?, or starts with what/how/tell/describe/etc).
   Kills 'What's your To what URL should this link go??'."
```

## Acceptance

- [ ] +tests passing for RTE skip, DOB selector-hint, radio option-match guard, phrasePrompt helper
- [ ] Previously skipped radio/checkbox prefilter tests flipped to assert passthrough
- [ ] `npm run typecheck && npm run test && npm run build` green
- [ ] Manual Tohodo retest shows: no "Field 30+" rows, one Birthday entry per part, "Female" radio fills, no double-? prompts
