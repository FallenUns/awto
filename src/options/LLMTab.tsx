import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, Cpu, Cloud, ArrowRight } from "lucide-react";
import type { LLMSettings } from "@/shared/storage";
import type { SaveStatus, TestOllamaConnectionResult } from "./useOptionsState";
import { ModelCatalog } from "./ModelCatalog";
import { TROUBLESHOOTING_URL } from "./model-catalog";

const ANTHROPIC_MODELS = [
  "claude-opus-4-7",
  "claude-sonnet-4-7",
  "claude-haiku-4-7",
];

// Provider ids match resolveCloud() in background/llm/cloud.ts. Anthropic uses
// its own SDK path + anthropicApiKey/anthropicModel; the rest are OpenAI-compatible
// and persist per-provider under cloudApiKeys/cloudModels.
interface ProviderDef {
  id: string;
  name: string;
  keyPlaceholder: string;
  models: string[];
}

const PROVIDERS: ProviderDef[] = [
  { id: "anthropic", name: "Anthropic", keyPlaceholder: "sk-ant-…", models: ANTHROPIC_MODELS },
  { id: "openai", name: "OpenAI", keyPlaceholder: "sk-…", models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1"] },
  {
    id: "gemini",
    name: "Google Gemini",
    keyPlaceholder: "AIza…",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    keyPlaceholder: "sk-or-…",
    models: ["anthropic/claude-3.5-sonnet", "openai/gpt-4o", "meta-llama/llama-3.1-70b"],
  },
  {
    id: "custom",
    name: "Custom (OpenAI-compatible)",
    keyPlaceholder: "sk-…",
    models: [],
  },
];

interface LLMTabProps {
  settings: LLMSettings;
  saveStatus: SaveStatus;
  onUpdate: (partial: Partial<LLMSettings>) => void;
  onTestOllama: () => Promise<TestOllamaConnectionResult>;
}

type TestResult =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; modelInstalled?: boolean; warning?: string }
  | { kind: "error"; error: string };

export function LLMTab({
  settings,
  saveStatus,
  onUpdate,
  onTestOllama,
}: LLMTabProps) {
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>({ kind: "idle" });
  const [installedModels, setInstalledModels] = useState<string[] | null>(null);

  const provider = settings.cloudProvider || "anthropic";
  const providerDef = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0]!;
  const isAnthropic = provider === "anthropic";

  const keyValue = isAnthropic
    ? settings.anthropicApiKey
    : settings.cloudApiKeys[provider] ?? "";
  const modelValue = isAnthropic
    ? settings.anthropicModel
    : settings.cloudModels[provider] ?? providerDef.models[0] ?? "";

  const fallbackOn = settings.cloudFallbackEnabled;
  const thresholdPct = Math.round(settings.confidenceThreshold * 100);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await onTestOllama();
        if (cancelled) return;
        if (result.ok && result.models) {
          setInstalledModels(result.models);
        }
      } catch {
        // silent — user can still click Test connection for visible feedback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onTestOllama]);

  async function handleTest() {
    setTestResult({ kind: "testing" });
    try {
      const result = await onTestOllama();
      if (!result.ok) {
        setTestResult({ kind: "error", error: result.error ?? "Unknown error" });
        return;
      }
      if (result.models) {
        setInstalledModels(result.models);
      }
      setTestResult({
        kind: "ok",
        modelInstalled: result.modelInstalled,
        warning: result.error,
      });
    } catch (err) {
      setTestResult({
        kind: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function setKeyValue(v: string) {
    if (isAnthropic) onUpdate({ anthropicApiKey: v });
    else onUpdate({ cloudApiKeys: { ...settings.cloudApiKeys, [provider]: v } });
  }

  function setModelValue(v: string) {
    if (isAnthropic) onUpdate({ anthropicModel: v });
    else onUpdate({ cloudModels: { ...settings.cloudModels, [provider]: v } });
  }

  return (
    <div className="awto-view" aria-live="polite">
      <div className="awto-view__head">
        <h1 className="awto-view__title">LLM &amp; Models</h1>
        <p className="awto-view__sub">
          Awto tries your local model first, then optionally falls back to the
          cloud when it's unsure.
        </p>
      </div>

      <div className="awto-pipeline">
        <div className="awto-pipe-card awto-pipe-card--local">
          <div className="awto-pipe-card__icon">
            <Cpu size={19} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div>
            <div className="awto-pipe-card__title">Local · Ollama</div>
            <div className="awto-pipe-card__sub">Runs on your machine</div>
          </div>
        </div>
        <div className="awto-pipe-arrow">
          <ArrowRight size={22} strokeWidth={1.6} aria-hidden="true" />
          <span>
            if confidence &lt;{" "}
            <span className="awto-pipe-arrow__thr">
              {settings.confidenceThreshold.toFixed(2)}
            </span>
          </span>
        </div>
        <div
          className={`awto-pipe-card awto-pipe-card--cloud${fallbackOn ? "" : " awto-pipe-card--off"}`}
        >
          <div className="awto-pipe-card__icon">
            <Cloud size={19} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div>
            <div className="awto-pipe-card__title">Cloud · {providerDef.name}</div>
            <div className="awto-pipe-card__sub">Fallback only</div>
          </div>
        </div>
      </div>

      <section className="awto-sec" aria-labelledby="card-ollama">
        <div className="awto-sec__head awto-sec__head--dot">
          <span className="awto-dot awto-dot--local" aria-hidden="true" />
          <div className="awto-sec__head-text">
            <h2 id="card-ollama" className="awto-sec__title">
              Local (Ollama)
            </h2>
            <p className="awto-sec__sub">
              Fast, private, runs entirely on your machine.
            </p>
          </div>
          {saveStatus === "saved" && (
            <span className="awto-badge awto-badge--success awto-badge--saved">
              Saved
            </span>
          )}
        </div>

        <div className="awto-field-grid awto-field-grid--2">
          <div className="awto-field">
            <label htmlFor="ollama-url" className="awto-label">
              Server URL
            </label>
            <input
              id="ollama-url"
              className="awto-input awto-input--mono"
              type="url"
              value={settings.ollamaUrl}
              onChange={(e) => onUpdate({ ollamaUrl: e.target.value })}
              placeholder="http://localhost:11434"
            />
          </div>
          <div className="awto-field">
            <label htmlFor="ollama-timeout" className="awto-label">
              Request timeout (seconds)
            </label>
            <input
              id="ollama-timeout"
              className="awto-input awto-input--mono"
              type="number"
              min={5}
              max={600}
              step={5}
              value={Math.round(settings.ollamaTimeoutMs / 1000)}
              onChange={(e) => {
                const sec = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(sec)) {
                  onUpdate({
                    ollamaTimeoutMs: Math.max(5, Math.min(600, sec)) * 1000,
                  });
                }
              }}
            />
          </div>
        </div>
        <p className="awto-helper--inline">
          First call on a fresh model loads weights into VRAM and can take 30–90s.
          Raise the timeout if you see timeout errors on a new model.
        </p>

        <div className="awto-field">
          <span className="awto-label">Model</span>
          <ModelCatalog
            selectedModel={settings.ollamaModel}
            installedModels={installedModels}
            ollamaUrl={settings.ollamaUrl}
            onSelectModel={(id) => onUpdate({ ollamaModel: id })}
            onModelsChanged={() => void handleTest()}
          />
        </div>

        <div className="awto-action-row">
          <button
            type="button"
            className="awto-btn awto-btn--secondary"
            onClick={() => void handleTest()}
            disabled={testResult.kind === "testing"}
          >
            {testResult.kind === "testing" ? (
              <>
                <Loader2
                  size={16}
                  className="awto-spin"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <span>Testing…</span>
              </>
            ) : (
              <span>Test connection</span>
            )}
          </button>
          {testResult.kind === "ok" && testResult.modelInstalled === false && (
            <span className="awto-badge awto-badge--warn" role="status" aria-live="polite">
              Connected · model "{settings.ollamaModel}" not installed
            </span>
          )}
          {testResult.kind === "ok" && testResult.modelInstalled === true && (
            <span className="awto-badge awto-badge--success" role="status" aria-live="polite">
              Connected · {settings.ollamaModel} ready
            </span>
          )}
          {testResult.kind === "ok" && testResult.modelInstalled === undefined && (
            <span className="awto-badge awto-badge--success" role="status" aria-live="polite">
              Connected{testResult.warning ? ` · ${testResult.warning}` : ""}
            </span>
          )}
          {testResult.kind === "error" && (
            <span className="awto-badge awto-badge--error" role="status" aria-live="polite">
              Not reachable: {testResult.error}
            </span>
          )}
        </div>
      </section>

      <section
        className="awto-sec awto-sec--cloud"
        aria-labelledby="card-cloud"
      >
        <div className="awto-sec__head awto-sec__head--dot">
          <span className="awto-dot awto-dot--cloud" aria-hidden="true" />
          <div className="awto-sec__head-text">
            <h2 id="card-cloud" className="awto-sec__title">
              Cloud provider
            </h2>
            <p className="awto-sec__sub">
              Used only when the local model is uncertain.
            </p>
          </div>
          <label className="awto-toggle awto-toggle--pill" htmlFor="cloud-fallback">
            <input
              id="cloud-fallback"
              type="checkbox"
              checked={fallbackOn}
              onChange={(e) => onUpdate({ cloudFallbackEnabled: e.target.checked })}
            />
            <span className="awto-toggle__label">Enable cloud fallback</span>
          </label>
        </div>

        <div className={`awto-cloud-body${fallbackOn ? "" : " awto-cloud-body--off"}`}>
          <div className="awto-field">
            <label htmlFor="cloud-provider" className="awto-label">
              Provider
            </label>
            <select
              id="cloud-provider"
              className="awto-input"
              value={provider}
              onChange={(e) => onUpdate({ cloudProvider: e.target.value })}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {provider === "custom" && (
            <div className="awto-field">
              <label htmlFor="cloud-base-url" className="awto-label">
                Base URL
              </label>
              <input
                id="cloud-base-url"
                className="awto-input awto-input--mono"
                type="url"
                value={settings.cloudBaseUrl}
                onChange={(e) => onUpdate({ cloudBaseUrl: e.target.value })}
                placeholder="https://your-endpoint/v1"
                spellCheck={false}
              />
              <p className="awto-helper--inline">
                OpenAI-compatible endpoint. Awto POSTs to{" "}
                <code>&lt;base&gt;/chat/completions</code>.
              </p>
            </div>
          )}

          <div className="awto-field-grid awto-field-grid--2">
            <div className="awto-field">
              <label htmlFor="cloud-key" className="awto-label">
                <span>API key</span>
                <span className="awto-ondevice">ON-DEVICE</span>
              </label>
              <div className="awto-field__row">
                <div className="awto-password-wrap">
                  <input
                    id="cloud-key"
                    className="awto-input awto-input--password awto-input--mono"
                    type={showKey ? "text" : "password"}
                    value={keyValue}
                    onChange={(e) => setKeyValue(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={providerDef.keyPlaceholder}
                  />
                  <button
                    type="button"
                    className="awto-password-toggle"
                    onClick={() => setShowKey((s) => !s)}
                    aria-label={showKey ? "Hide API key" : "Show API key"}
                    aria-pressed={showKey}
                  >
                    {showKey ? (
                      <EyeOff size={16} strokeWidth={1.5} aria-hidden="true" />
                    ) : (
                      <Eye size={16} strokeWidth={1.5} aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
              <p className="awto-helper--inline">
                Stored only in your browser's local storage. Never leaves this
                device.
              </p>
            </div>

            <div className="awto-field">
              <label htmlFor="cloud-model" className="awto-label">
                Model
              </label>
              {providerDef.models.length > 0 ? (
                <select
                  id="cloud-model"
                  className="awto-input awto-input--mono"
                  value={modelValue}
                  onChange={(e) => setModelValue(e.target.value)}
                >
                  {!providerDef.models.includes(modelValue) && modelValue && (
                    <option value={modelValue}>{modelValue}</option>
                  )}
                  {providerDef.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="cloud-model"
                  className="awto-input awto-input--mono"
                  value={modelValue}
                  onChange={(e) => setModelValue(e.target.value)}
                  placeholder="model id"
                  spellCheck={false}
                />
              )}
            </div>
          </div>

          <div className="awto-field">
            <div className="awto-threshold__head">
              <label htmlFor="confidence-threshold" className="awto-label">
                Confidence threshold
              </label>
              <span className="awto-threshold__value" aria-live="polite">
                {settings.confidenceThreshold.toFixed(2)}
              </span>
            </div>
            <div className="awto-threshold">
              <div className="awto-threshold__track">
                <div
                  className="awto-threshold__fill-cloud"
                  style={{ width: `${thresholdPct}%` }}
                />
                <div className="awto-threshold__fill-local" />
              </div>
              <input
                id="confidence-threshold"
                className="awto-range"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.confidenceThreshold}
                onChange={(e) =>
                  onUpdate({
                    confidenceThreshold: Number.parseFloat(e.target.value),
                  })
                }
              />
            </div>
            <div className="awto-threshold__legend">
              <span className="awto-threshold__legend-cloud">
                ← Cloud fallback ({thresholdPct}%)
              </span>
              <span className="awto-threshold__legend-local">
                Local handles ({100 - thresholdPct}%) →
              </span>
            </div>
            <p className="awto-helper--inline">
              Field mappings below this confidence trigger the cloud fallback.
              Your API key never leaves this device.
            </p>
          </div>
        </div>
      </section>

      <section className="awto-sec" aria-labelledby="card-aria-forms">
        <div className="awto-sec__head awto-sec__head--between">
          <div className="awto-sec__head-text">
            <h2 id="card-aria-forms" className="awto-sec__title">
              Custom-widget forms
            </h2>
            <p className="awto-sec__sub">
              Adds support for Google Forms, Microsoft Forms, and other sites
              that use ARIA widgets instead of native inputs. Turn off if a site
              fills incorrectly.
            </p>
          </div>
          <label className="awto-toggle awto-toggle--bare" htmlFor="aria-forms-enabled">
            <input
              id="aria-forms-enabled"
              type="checkbox"
              checked={settings.enableAriaForms}
              onChange={(e) => onUpdate({ enableAriaForms: e.target.checked })}
            />
            <span className="awto-sr-only">Fill custom-widget forms</span>
          </label>
        </div>

        <div className="awto-action-row">
          <a
            className="awto-textlink"
            href={TROUBLESHOOTING_URL}
            target="_blank"
            rel="noreferrer"
          >
            Troubleshooting guide →
          </a>
        </div>
      </section>
    </div>
  );
}
