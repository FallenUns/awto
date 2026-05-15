import { useRef, useState, type KeyboardEvent } from "react";
import { ProfileTab } from "./ProfileTab";
import { LLMTab } from "./LLMTab";
import { AboutTab } from "./AboutTab";
import { useOptionsState } from "./useOptionsState";

type TabId = "profile" | "llm" | "about";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "llm", label: "LLM" },
  { id: "about", label: "About" },
];

export function Options() {
  const [active, setActive] = useState<TabId>("profile");
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    profile: null,
    llm: null,
    about: null,
  });

  const {
    profile,
    llmSettings,
    loaded,
    profileSaveStatus,
    llmSaveStatus,
    updateProfile,
    clearProfileField,
    addCustomField,
    updateCustomField,
    removeCustomField,
    replaceProfile,
    updateLLMSettings,
    testOllamaConnection,
  } = useOptionsState();

  function focusTab(id: TabId) {
    setActive(id);
    requestAnimationFrame(() => {
      tabRefs.current[id]?.focus();
    });
  }

  function handleTabKey(e: KeyboardEvent<HTMLButtonElement>, idx: number) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = TABS[(idx + 1) % TABS.length];
      if (next) focusTab(next.id);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const next = TABS[(idx - 1 + TABS.length) % TABS.length];
      if (next) focusTab(next.id);
    } else if (e.key === "Home") {
      e.preventDefault();
      const first = TABS[0];
      if (first) focusTab(first.id);
    } else if (e.key === "End") {
      e.preventDefault();
      const last = TABS[TABS.length - 1];
      if (last) focusTab(last.id);
    }
  }

  return (
    <div className="awto-options">
      <header className="awto-options__header">
        <div>
          <h1 className="awto-options__brand">Awto</h1>
          <p className="awto-options__subtitle">Settings</p>
        </div>
      </header>

      <div className="awto-tablist" role="tablist" aria-label="Settings sections">
        {TABS.map((tab, idx) => (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[tab.id] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-controls={`panel-${tab.id}`}
            aria-selected={active === tab.id}
            tabIndex={active === tab.id ? 0 : -1}
            className="awto-tab"
            onClick={() => setActive(tab.id)}
            onKeyDown={(e) => handleTabKey(e, idx)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="panel-profile"
        aria-labelledby="tab-profile"
        hidden={active !== "profile"}
      >
        {active === "profile" && loaded && (
          <ProfileTab
            profile={profile}
            saveStatus={profileSaveStatus}
            onUpdate={updateProfile}
            onClear={clearProfileField}
            onAddCustom={addCustomField}
            onUpdateCustom={updateCustomField}
            onRemoveCustom={removeCustomField}
            onReplaceProfile={replaceProfile}
          />
        )}
      </div>

      <div
        role="tabpanel"
        id="panel-llm"
        aria-labelledby="tab-llm"
        hidden={active !== "llm"}
      >
        {active === "llm" && loaded && (
          <LLMTab
            settings={llmSettings}
            saveStatus={llmSaveStatus}
            onUpdate={updateLLMSettings}
            onTestOllama={testOllamaConnection}
          />
        )}
      </div>

      <div
        role="tabpanel"
        id="panel-about"
        aria-labelledby="tab-about"
        hidden={active !== "about"}
      >
        {active === "about" && <AboutTab />}
      </div>
    </div>
  );
}
