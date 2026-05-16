import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  BUILT_IN_KEYS,
  ProfileSchema,
  type BuiltInKey,
  type Profile,
} from "@/shared/profile";
import type { SaveStatus } from "./useOptionsState";

interface FieldDef {
  key: BuiltInKey;
  label: string;
  type?: string;
  autocomplete?: string;
  placeholder?: string;
  helper?: string;
}

interface SectionDef {
  id: string;
  title: string;
  fields: FieldDef[];
}

const SECTIONS: SectionDef[] = [
  {
    id: "identity",
    title: "Identity",
    fields: [
      {
        key: "title",
        label: "Title",
        autocomplete: "honorific-prefix",
        placeholder: "Mr / Ms / Mx / Dr",
      },
      { key: "firstName", label: "First name", autocomplete: "given-name" },
      {
        key: "middleName",
        label: "Middle name",
        autocomplete: "additional-name",
      },
      { key: "lastName", label: "Last name", autocomplete: "family-name" },
      {
        key: "preferredName",
        label: "Preferred name",
        autocomplete: "nickname",
      },
      { key: "pronouns", label: "Pronouns", placeholder: "they/them" },
      { key: "gender", label: "Gender" },
      {
        key: "dateOfBirth",
        label: "Date of birth",
        type: "date",
        autocomplete: "bday",
        helper: "YYYY-MM-DD",
      },
    ],
  },
  {
    id: "contact",
    title: "Contact",
    fields: [
      { key: "email", label: "Email", type: "email", autocomplete: "email" },
      {
        key: "secondaryEmail",
        label: "Secondary email",
        type: "email",
        autocomplete: "email",
      },
      { key: "phone", label: "Phone", type: "tel", autocomplete: "tel" },
      {
        key: "mobilePhone",
        label: "Mobile",
        type: "tel",
        autocomplete: "tel",
      },
    ],
  },
  {
    id: "address",
    title: "Address",
    fields: [
      {
        key: "addressLine1",
        label: "Address line 1",
        autocomplete: "address-line1",
      },
      {
        key: "addressLine2",
        label: "Address line 2",
        autocomplete: "address-line2",
      },
      { key: "suburb", label: "Suburb", autocomplete: "address-level2" },
      { key: "city", label: "City", autocomplete: "address-level2" },
      { key: "state", label: "State", autocomplete: "address-level1" },
      { key: "postcode", label: "Postcode", autocomplete: "postal-code" },
      { key: "country", label: "Country", autocomplete: "country-name" },
    ],
  },
  {
    id: "work",
    title: "Work",
    fields: [
      {
        key: "currentEmployer",
        label: "Current employer",
        autocomplete: "organization",
      },
      {
        key: "jobTitle",
        label: "Job title",
        autocomplete: "organization-title",
      },
      { key: "linkedIn", label: "LinkedIn URL", type: "url" },
      { key: "website", label: "Personal website", type: "url" },
      { key: "github", label: "GitHub URL", type: "url" },
    ],
  },
  {
    id: "education",
    title: "Education",
    fields: [
      {
        key: "highestQualification",
        label: "Highest qualification",
        placeholder: "e.g. Bachelor of Science",
      },
      { key: "university", label: "University / Institution" },
      {
        key: "graduationYear",
        label: "Graduation year",
        placeholder: "2024",
      },
    ],
  },
  {
    id: "identification",
    title: "Identification",
    fields: [
      {
        key: "taxFileNumber",
        label: "Tax File Number (TFN)",
        helper: "Australian TFN. Kept locally only.",
      },
      { key: "medicareNumber", label: "Medicare number" },
      { key: "driverLicense", label: "Driver licence" },
    ],
  },
  {
    id: "status",
    title: "Status",
    fields: [
      { key: "nationality", label: "Nationality" },
      {
        key: "workRights",
        label: "Work rights",
        placeholder: "e.g. Australian citizen",
      },
    ],
  },
];

interface ProfileTabProps {
  profile: Profile;
  saveStatus: SaveStatus;
  onUpdate: (key: BuiltInKey, value: string) => void;
  onClear: (key: BuiltInKey) => void;
  onAddCustom: (
    key: string,
    value: string
  ) => { ok: true } | { ok: false; error: string };
  onUpdateCustom: (key: string, value: string) => void;
  onRemoveCustom: (key: string) => void;
  onReplaceProfile: (next: Profile) => void;
}

export function ProfileTab({
  profile,
  saveStatus,
  onUpdate,
  onClear,
  onAddCustom,
  onUpdateCustom,
  onRemoveCustom,
  onReplaceProfile,
}: ProfileTabProps) {
  const [showJson, setShowJson] = useState(false);
  const [jsonDraft, setJsonDraft] = useState<string>("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const customEntries = useMemo(
    () => Object.entries(profile.custom),
    [profile.custom]
  );

  const builtInKeysSet = new Set<string>(BUILT_IN_KEYS);

  function handleToggleJson() {
    if (!showJson) {
      setJsonDraft(JSON.stringify(profile, null, 2));
      setJsonError(null);
    }
    setShowJson((s) => !s);
  }

  function handleJsonBlur() {
    try {
      const parsed = JSON.parse(jsonDraft);
      const result = ProfileSchema.safeParse(parsed);
      if (!result.success) {
        setJsonError(result.error.issues[0]?.message ?? "Invalid profile");
        setJsonDraft(JSON.stringify(profile, null, 2));
        return;
      }
      setJsonError(null);
      onReplaceProfile(result.data);
      setJsonDraft(JSON.stringify(result.data, null, 2));
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : "Invalid JSON");
      setJsonDraft(JSON.stringify(profile, null, 2));
    }
  }

  function handleAddCustom(e: React.FormEvent) {
    e.preventDefault();
    const result = onAddCustom(newKey, newValue);
    if (result.ok) {
      setNewKey("");
      setNewValue("");
      setAddError(null);
    } else {
      setAddError(result.error);
    }
  }

  return (
    <div className="awto-tabpanel" aria-live="polite">
      {SECTIONS.map((section) => (
        <section key={section.id} className="awto-card" aria-labelledby={`section-${section.id}`}>
          <div className="awto-card__header">
            <h3 id={`section-${section.id}`} className="awto-section-title">
              {section.title}
            </h3>
            {saveStatus === "saved" && (
              <span
                className="awto-badge awto-badge--success awto-badge--saved"
                aria-live="polite"
              >
                Saved
              </span>
            )}
          </div>
          <div className="awto-field-grid">
            {section.fields.map((field) => {
              const id = `profile-${field.key}`;
              const value = profile[field.key] ?? "";
              return (
                <div key={field.key} className="awto-field">
                  <label className="awto-label" htmlFor={id}>
                    {field.label}
                  </label>
                  <div className="awto-field__row">
                    <input
                      id={id}
                      className="awto-input"
                      type={field.type ?? "text"}
                      autoComplete={field.autocomplete}
                      placeholder={field.placeholder}
                      value={value}
                      onChange={(e) => onUpdate(field.key, e.target.value)}
                    />
                    {value !== "" && (
                      <button
                        type="button"
                        className="awto-iconbtn awto-iconbtn--danger"
                        aria-label={`Clear ${field.label}`}
                        onClick={() => onClear(field.key)}
                      >
                        <X size={16} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {field.helper && (
                    <p className="awto-helper--inline">{field.helper}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <section className="awto-card" aria-labelledby="section-custom">
        <div className="awto-card__header">
          <h3 id="section-custom" className="awto-section-title">
            Custom fields
          </h3>
          {saveStatus === "saved" && (
            <span
              className="awto-badge awto-badge--success awto-badge--saved"
              aria-live="polite"
            >
              Saved
            </span>
          )}
        </div>
        {customEntries.length === 0 && (
          <p className="awto-helper--inline">
            Add your own fields like "linkedin" or "favouriteColour".
          </p>
        )}
        {customEntries.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {customEntries.map(([key, value]) => {
              const id = `custom-${key}`;
              return (
                <div key={key} className="awto-custom-row">
                  <label htmlFor={id} className="awto-custom-row__key">
                    {key}
                  </label>
                  <input
                    id={id}
                    className="awto-input"
                    type="text"
                    value={value}
                    onChange={(e) => onUpdateCustom(key, e.target.value)}
                  />
                  <button
                    type="button"
                    className="awto-iconbtn awto-iconbtn--danger"
                    aria-label={`Remove ${key}`}
                    onClick={() => onRemoveCustom(key)}
                  >
                    <X size={16} strokeWidth={1.5} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <hr className="awto-divider" />
        <form className="awto-inline-form" onSubmit={handleAddCustom}>
          <div className="awto-field">
            <label className="awto-label" htmlFor="new-custom-key">
              Key
            </label>
            <input
              id="new-custom-key"
              className="awto-input"
              type="text"
              value={newKey}
              onChange={(e) => {
                setNewKey(e.target.value);
                if (addError) setAddError(null);
              }}
              placeholder="e.g. linkedin"
              aria-invalid={addError !== null}
              aria-describedby={addError ? "new-custom-error" : undefined}
            />
          </div>
          <div className="awto-field">
            <label className="awto-label" htmlFor="new-custom-value">
              Value
            </label>
            <input
              id="new-custom-value"
              className="awto-input"
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="e.g. linkedin.com/in/you"
            />
          </div>
          <button
            type="submit"
            className="awto-btn awto-btn--secondary"
            disabled={newKey.trim() === "" || builtInKeysSet.has(newKey.trim())}
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            <span>Add custom field</span>
          </button>
        </form>
        {addError && (
          <p id="new-custom-error" className="awto-inline-error" role="alert">
            {addError}
          </p>
        )}
      </section>

      <section className="awto-card" aria-labelledby="section-rawjson">
        <div className="awto-card__header">
          <h3 id="section-rawjson" className="awto-section-title">
            Raw JSON
          </h3>
          <button
            type="button"
            className="awto-btn awto-btn--secondary"
            onClick={handleToggleJson}
            aria-expanded={showJson}
            aria-controls="profile-json"
          >
            {showJson ? "Hide raw JSON" : "View raw JSON"}
          </button>
        </div>
        {showJson && (
          <>
            <textarea
              id="profile-json"
              className="awto-textarea"
              value={jsonDraft}
              onChange={(e) => setJsonDraft(e.target.value)}
              onBlur={handleJsonBlur}
              spellCheck={false}
              aria-describedby={jsonError ? "profile-json-error" : undefined}
              aria-invalid={jsonError !== null}
            />
            {jsonError && (
              <p
                id="profile-json-error"
                className="awto-inline-error"
                role="alert"
              >
                {jsonError}. Reverted to previous value.
              </p>
            )}
            <p className="awto-helper--inline">
              Edits are applied on blur. Invalid JSON is rejected and reverted.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
