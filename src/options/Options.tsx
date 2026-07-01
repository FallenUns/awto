import { useRef, useState, type KeyboardEvent } from "react";
import { User, Cpu, Info } from "lucide-react";
import { AwtoLogo } from "../shared/AwtoLogo";
import { ProfileTab } from "./ProfileTab";
import { LLMTab } from "./LLMTab";
import { AboutTab } from "./AboutTab";
import { useOptionsState } from "./useOptionsState";

type TabId = "profile" | "llm" | "about";

const TABS: Array<{ id: TabId; label: string; icon: typeof User }> = [
  { id: "profile", label: "Profile", icon: User },
  { id: "llm", label: "LLM & Models", icon: Cpu },
  { id: "about", label: "About", icon: Info },
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
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = TABS[(idx + 1) % TABS.length];
      if (next) focusTab(next.id);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
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
    <div className="awto-shell">
      <aside className="awto-sidebar">
        <div className="awto-sidebar__brand">
          <AwtoLogo size={38} variant="tile" title="Awto" />
          <div>
            <div className="awto-sidebar__name">Awto</div>
            <div className="awto-sidebar__tag">Settings</div>
          </div>
        </div>

        <nav
          className="awto-nav"
          role="tablist"
          aria-label="Settings sections"
          aria-orientation="vertical"
        >
          {TABS.map((tab, idx) => {
            const Icon = tab.icon;
            const selected = active === tab.id;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[tab.id] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-controls={`panel-${tab.id}`}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className={`awto-nav__item${selected ? " awto-nav__item--active" : ""}`}
                onClick={() => setActive(tab.id)}
                onKeyDown={(e) => handleTabKey(e, idx)}
              >
                <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <p className="awto-sidebar__foot">
          Your profile stays in this browser. No telemetry.
        </p>
      </aside>

      <main className="awto-main">
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
      </main>
    </div>
  );
}
