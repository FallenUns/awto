import { useMemo, useState } from "react";
import {
  Plus,
  X,
  User,
  Mail,
  MapPin,
  Briefcase,
  GraduationCap,
  Lock,
  Globe,
  SlidersHorizontal,
  Eye,
  EyeOff,
  Shield,
  type LucideIcon,
} from "lucide-react";
import {
  BUILT_IN_KEYS,
  ProfileSchema,
  type BuiltInKey,
  type Profile,
} from "@/shared/profile";
import type { SaveStatus } from "./useOptionsState";
import { TITLES, PRONOUNS, COUNTRIES } from "./countries";
import { AddressAutocomplete } from "./AddressAutocomplete";
import type { AddressResult } from "./geocoder";

const ENUM_FIELDS: Partial<Record<BuiltInKey, readonly string[]>> = {
  title: TITLES,
  pronouns: PRONOUNS,
  country: COUNTRIES,
};

const CUSTOM_SENTINEL = "__custom__";

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
  subtitle: string;
  chip: string;
  icon: LucideIcon;
  sensitive?: boolean;
  fields: FieldDef[];
}

const SECTIONS: SectionDef[] = [
  {
    id: "identity",
    title: "Identity",
    subtitle: "Who you are on forms",
    chip: "Identity",
    icon: User,
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
        helper: "Stored as YYYY-MM-DD",
      },
    ],
  },
  {
    id: "contact",
    title: "Contact",
    subtitle: "How forms reach you",
    chip: "Contact",
    icon: Mail,
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
    subtitle: "Mailing & residential",
    chip: "Address",
    icon: MapPin,
    fields: [
      {
        key: "unitNumber",
        label: "Unit / Apt (optional)",
        placeholder: "5 or Apt 12",
        helper:
          "Will be prepended to your street address on forms that don't have a separate unit field.",
      },
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
    subtitle: "Employment & links",
    chip: "Work",
    icon: Briefcase,
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
    subtitle: "Qualifications",
    chip: "Education",
    icon: GraduationCap,
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
    subtitle: "Sensitive — handled with extra care",
    chip: "IDs",
    icon: Lock,
    sensitive: true,
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
    subtitle: "Nationality & work rights",
    chip: "Status",
    icon: Globe,
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

const CHIPS = [...SECTIONS.map((s) => ({ id: s.id, label: s.chip })), { id: "advanced", label: "Advanced" }];

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

function isFilled(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
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
  const [showSensitive, setShowSensitive] = useState(false);

  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const customEntries = useMemo(
    () => Object.entries(profile.custom),
    [profile.custom]
  );

  const builtInKeysSet = new Set<string>(BUILT_IN_KEYS);

  const filledCount = useMemo(
    () => BUILT_IN_KEYS.filter((k) => isFilled(profile[k])).length,
    [profile]
  );
  const totalCount = BUILT_IN_KEYS.length;
  const emptyCount = totalCount - filledCount;
  const pct = Math.round((filledCount / totalCount) * 100);
  const ringRadius = 26;
  const ringCirc = 2 * Math.PI * ringRadius;
  const ringDash = `${((pct / 100) * ringCirc).toFixed(1)} ${ringCirc.toFixed(1)}`;

  function handleAddressSelect(a: AddressResult) {
    onUpdate("addressLine1", a.addressLine1);
    if (a.suburb) onUpdate("suburb", a.suburb);
    if (a.city) onUpdate("city", a.city);
    if (a.state) onUpdate("state", a.state);
    if (a.postcode) onUpdate("postcode", a.postcode);
    if (a.country) onUpdate("country", a.country);
  }

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

  function renderField(field: FieldDef, sensitive: boolean) {
    const id = `profile-${field.key}`;
    const value = profile[field.key] ?? "";

    if (field.key === "addressLine1") {
      return (
        <div key={field.key} className="awto-field">
          <label className="awto-label" htmlFor={id}>
            {field.label}
          </label>
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

    const enumOptions = ENUM_FIELDS[field.key];
    if (enumOptions) {
      const isCustom = value !== "" && !enumOptions.includes(value);
      return (
        <div key={field.key} className="awto-field">
          <label className="awto-label" htmlFor={id}>
            {field.label}
          </label>
          <select
            id={id}
            className="awto-input"
            value={isCustom ? CUSTOM_SENTINEL : value}
            onChange={(e) => {
              const v = e.target.value;
              if (v === CUSTOM_SENTINEL) {
                if (!isCustom) onUpdate(field.key, " ");
                return;
              }
              onUpdate(field.key, v);
            }}
          >
            <option value="">Choose…</option>
            {enumOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            <option value={CUSTOM_SENTINEL}>Other…</option>
          </select>
          {isCustom && (
            <input
              type="text"
              className="awto-input awto-input--custom"
              aria-label={`Custom ${field.label}`}
              value={value.trim() === "" ? "" : value}
              onChange={(e) => onUpdate(field.key, e.target.value)}
            />
          )}
          {field.helper && <p className="awto-helper--inline">{field.helper}</p>}
        </div>
      );
    }

    return (
      <div key={field.key} className="awto-field">
        <label className="awto-label" htmlFor={id}>
          <span>{field.label}</span>
          {sensitive && <span className="awto-ondevice">ON-DEVICE</span>}
        </label>
        <div className="awto-field__row">
          <input
            id={id}
            className={`awto-input${sensitive ? " awto-input--sensitive" : ""}`}
            type={sensitive && !showSensitive ? "password" : field.type ?? "text"}
            autoComplete={sensitive ? "off" : field.autocomplete}
            placeholder={field.placeholder}
            value={value}
            spellCheck={sensitive ? false : undefined}
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
        {field.helper && <p className="awto-helper--inline">{field.helper}</p>}
      </div>
    );
  }

  return (
    <div className="awto-view" aria-live="polite">
      <div className="awto-profile-head">
        <div className="awto-profile-head__meta">
          <div className="awto-ring" aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 60 60">
              <circle
                cx="30"
                cy="30"
                r={ringRadius}
                fill="none"
                stroke="rgba(148,163,184,0.16)"
                strokeWidth="6"
              />
              <circle
                cx="30"
                cy="30"
                r={ringRadius}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={ringDash}
                transform="rotate(-90 30 30)"
              />
            </svg>
            <span className="awto-ring__pct">{pct}%</span>
          </div>
          <div>
            <h1 className="awto-view__title">Profile</h1>
            <p className="awto-view__sub">
              {pct}% complete · {emptyCount} field{emptyCount === 1 ? "" : "s"} empty
              {saveStatus === "saved" && (
                <span className="awto-saved-inline"> · Saved</span>
              )}
            </p>
          </div>
        </div>
        <nav className="awto-chips" aria-label="Jump to section">
          {CHIPS.map((chip) => (
            <a key={chip.id} className="awto-chip" href={`#${chip.id}`}>
              {chip.label}
            </a>
          ))}
        </nav>
      </div>

      {SECTIONS.map((section) => {
        const Icon = section.icon;
        return (
          <section
            key={section.id}
            id={section.id}
            className={`awto-sec${section.sensitive ? " awto-sec--sensitive" : ""}`}
            aria-labelledby={`section-${section.id}`}
          >
            <div className="awto-sec__head">
              <div
                className={`awto-sec__icon${section.sensitive ? " awto-sec__icon--amber" : ""}`}
              >
                <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
              </div>
              <div className="awto-sec__head-text">
                <h2 id={`section-${section.id}`} className="awto-sec__title">
                  {section.title}
                </h2>
                <p className="awto-sec__sub">{section.subtitle}</p>
              </div>
              {section.sensitive && (
                <button
                  type="button"
                  className="awto-reveal"
                  aria-pressed={showSensitive}
                  onClick={() => setShowSensitive((s) => !s)}
                >
                  {showSensitive ? (
                    <EyeOff size={15} strokeWidth={1.7} aria-hidden="true" />
                  ) : (
                    <Eye size={15} strokeWidth={1.7} aria-hidden="true" />
                  )}
                  <span>{showSensitive ? "Hide" : "Show"}</span>
                </button>
              )}
            </div>

            {section.sensitive && (
              <div className="awto-sensitive-note" role="note">
                <Shield size={15} strokeWidth={1.9} aria-hidden="true" />
                <span>
                  These values never leave this device and are masked by default.
                  Awto only fills them when a form explicitly asks.
                </span>
              </div>
            )}

            <div className="awto-field-grid">
              {section.fields.map((field) =>
                renderField(field, section.sensitive ?? false)
              )}
            </div>

            {section.id === "address" && (
              <p className="awto-card__footer-note">
                Address suggestions powered by OpenStreetMap. Each typed query goes
                to <code>nominatim.openstreetmap.org</code>. No account, no login.
              </p>
            )}
          </section>
        );
      })}

      <section id="advanced" className="awto-sec" aria-labelledby="section-advanced">
        <div className="awto-sec__head">
          <div className="awto-sec__icon">
            <SlidersHorizontal size={16} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div className="awto-sec__head-text">
            <h2 id="section-advanced" className="awto-sec__title">
              Advanced
            </h2>
            <p className="awto-sec__sub">Custom fields &amp; raw data</p>
          </div>
        </div>

        <h3 className="awto-subhead">Custom fields</h3>
        {customEntries.length === 0 && (
          <p className="awto-helper--inline">
            Add your own fields like "linkedin" or "favouriteColour".
          </p>
        )}
        {customEntries.length > 0 && (
          <div className="awto-custom-list">
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

        <hr className="awto-divider" />
        <div className="awto-rawjson-head">
          <h3 className="awto-subhead">Raw JSON</h3>
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
              <p id="profile-json-error" className="awto-inline-error" role="alert">
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
