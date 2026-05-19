import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import type { LLMSettings } from "@/shared/storage";
import type { SaveStatus, TestOllamaConnectionResult } from "./useOptionsState";

const ANTHROPIC_MODELS = [
  "claude-opus-4-7",
  "claude-sonnet-4-7",
  "claude-haiku-4-7",
];

const CUSTOM_MODEL_SENTINEL = "__awto_custom__";

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
  const [customMode, setCustomMode] = useState(false);

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

  const modelOptions = installedModels ?? [];
  const currentModelInList = modelOptions.includes(settings.ollamaModel);
  const showCustomInput = customMode || (installedModels !== null && !currentModelInList);

  function handleModelSelect(value: string) {
    if (value === CUSTOM_MODEL_SENTINEL) {
      setCustomMode(true);
      return;
    }
    setCustomMode(false);
    onUpdate({ ollamaModel: value });
  }

  return (
    <div className="awto-tabpanel" aria-live="polite">
      <section className="awto-card" aria-labelledby="card-ollama">
        <div className="awto-card__header">
          <div>
            <h3 id="card-ollama" className="awto-card__title">
              Local (Ollama)
            </h3>
            <p className="awto-card__subtitle">
              Fast, private, runs entirely on your machine.
            </p>
          </div>
          {saveStatus === "saved" && (
            <span
              className="awto-badge awto-badge--success awto-badge--saved"
              aria-live="polite"
            >
              Saved
            </span>
          )}
        </div>

        <div className="awto-field">
          <label htmlFor="ollama-url" className="awto-label">
            Server URL
          </label>
          <input
            id="ollama-url"
            className="awto-input"
            type="url"
            value={settings.ollamaUrl}
            onChange={(e) => onUpdate({ ollamaUrl: e.target.value })}
            placeholder="http://localhost:11434"
          />
        </div>

        <div className="awto-field">
          <label htmlFor="ollama-model" className="awto-label">
            Model name
          </label>
          {installedModels === null ? (
            <input
              id="ollama-model"
              className="awto-input"
              type="text"
              value={settings.ollamaModel}
              onChange={(e) => onUpdate({ ollamaModel: e.target.value })}
              placeholder="llama3.2"
            />
          ) : (
            <select
              id="ollama-model"
              className="awto-input"
              value={
                showCustomInput
                  ? CUSTOM_MODEL_SENTINEL
                  : currentModelInList
                    ? settings.ollamaModel
                    : CUSTOM_MODEL_SENTINEL
              }
              onChange={(e) => handleModelSelect(e.target.value)}
            >
              {modelOptions.length === 0 && (
                <option value="" disabled>
                  No models installed — run `ollama pull llama3.2`
                </option>
              )}
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value={CUSTOM_MODEL_SENTINEL}>Custom…</option>
            </select>
          )}
          {showCustomInput && installedModels !== null && (
            <input
              className="awto-input awto-input--custom"
              type="text"
              value={settings.ollamaModel}
              onChange={(e) => onUpdate({ ollamaModel: e.target.value })}
              placeholder="llama3.2"
              aria-label="Custom model name"
            />
          )}
          <p className="awto-helper--inline">
            {installedModels === null
              ? "Connect to Ollama to see installed models."
              : `${modelOptions.length} model${modelOptions.length === 1 ? "" : "s"} installed locally.`}
          </p>
        </div>

        <div className="awto-field">
          <label htmlFor="ollama-timeout" className="awto-label">
            Request timeout (seconds)
          </label>
          <input
            id="ollama-timeout"
            className="awto-input"
            type="number"
            min={5}
            max={600}
            step={5}
            value={Math.round(settings.ollamaTimeoutMs / 1000)}
            onChange={(e) => {
              const sec = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(sec)) {
                onUpdate({ ollamaTimeoutMs: Math.max(5, Math.min(600, sec)) * 1000 });
              }
            }}
          />
          <p className="awto-helper--inline">
            First call on a fresh model loads weights into VRAM and can take
            30–90s. Raise this if you see timeout errors on a new model.
          </p>
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
            <span
              className="awto-badge awto-badge--warn"
              role="status"
              aria-live="polite"
            >
              Connected · model "{settings.ollamaModel}" not installed
            </span>
          )}
          {testResult.kind === "ok" && testResult.modelInstalled === true && (
            <span
              className="awto-badge awto-badge--success"
              role="status"
              aria-live="polite"
            >
              Connected · {settings.ollamaModel} ready
            </span>
          )}
          {testResult.kind === "ok" && testResult.modelInstalled === undefined && (
            <span
              className="awto-badge awto-badge--success"
              role="status"
              aria-live="polite"
            >
              Connected{testResult.warning ? ` · ${testResult.warning}` : ""}
            </span>
          )}
          {testResult.kind === "error" && (
            <span
              className="awto-badge awto-badge--error"
              role="status"
              aria-live="polite"
            >
              Not reachable: {testResult.error}
            </span>
          )}
        </div>
      </section>

      <section className="awto-card" aria-labelledby="card-anthropic">
        <div className="awto-card__header">
          <div>
            <h3 id="card-anthropic" className="awto-card__title">
              Cloud (Anthropic)
            </h3>
            <p className="awto-card__subtitle">
              Used only when the local model is uncertain.
            </p>
          </div>
          {saveStatus === "saved" && (
            <span
              className="awto-badge awto-badge--success awto-badge--saved"
              aria-live="polite"
            >
              Saved
            </span>
          )}
        </div>

        <div className="awto-field">
          <label htmlFor="anthropic-key" className="awto-label">
            API key
          </label>
          <div className="awto-field__row">
            <div className="awto-password-wrap">
              <input
                id="anthropic-key"
                className="awto-input awto-input--password"
                type={showKey ? "text" : "password"}
                value={settings.anthropicApiKey}
                onChange={(e) => onUpdate({ anthropicApiKey: e.target.value })}
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-ant-…"
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
            Stored only in your browser's local storage.
          </p>
        </div>

        <div className="awto-field">
          <label htmlFor="anthropic-model" className="awto-label">
            Model
          </label>
          <select
            id="anthropic-model"
            className="awto-input"
            value={settings.anthropicModel}
            onChange={(e) => onUpdate({ anthropicModel: e.target.value })}
          >
            {ANTHROPIC_MODELS.includes(settings.anthropicModel) ? null : (
              <option value={settings.anthropicModel}>
                {settings.anthropicModel}
              </option>
            )}
            {ANTHROPIC_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div className="awto-field">
          <label className="awto-toggle" htmlFor="cloud-fallback">
            <input
              id="cloud-fallback"
              type="checkbox"
              checked={settings.cloudFallbackEnabled}
              onChange={(e) =>
                onUpdate({ cloudFallbackEnabled: e.target.checked })
              }
            />
            <span className="awto-label">Enable cloud fallback</span>
          </label>
          <p className="awto-helper--inline">
            When off, Awto only uses the local model.
          </p>
        </div>

        <div className="awto-field">
          <label htmlFor="confidence-threshold" className="awto-label">
            Confidence threshold
          </label>
          <div className="awto-range-row">
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
            <span className="awto-range-value" aria-live="polite">
              {settings.confidenceThreshold.toFixed(2)}
            </span>
          </div>
          <p className="awto-helper--inline">
            Mappings below this confidence trigger the cloud fallback.
          </p>
        </div>

        <p className="awto-card__footer-note">
          Awto tries local first. Cloud is only used when local is uncertain.
          Your API key never leaves this device.
        </p>
      </section>

      <section className="awto-card" aria-labelledby="card-aria-forms">
        <div className="awto-card__header">
          <div>
            <h3 id="card-aria-forms" className="awto-card__title">
              Custom-widget forms
            </h3>
            <p className="awto-card__subtitle">
              Support for sites that use ARIA widgets instead of native inputs.
            </p>
          </div>
          {saveStatus === "saved" && (
            <span
              className="awto-badge awto-badge--success awto-badge--saved"
              aria-live="polite"
            >
              Saved
            </span>
          )}
        </div>

        <div className="awto-field">
          <label className="awto-toggle" htmlFor="aria-forms-enabled">
            <input
              id="aria-forms-enabled"
              type="checkbox"
              checked={settings.enableAriaForms}
              onChange={(e) =>
                onUpdate({ enableAriaForms: e.target.checked })
              }
            />
            <span className="awto-label">Fill custom-widget forms</span>
          </label>
          <p className="awto-helper--inline">
            Adds support for Google Forms, Microsoft Forms, and other forms
            that use ARIA widgets instead of native inputs. Turn off if a site
            fills incorrectly.
          </p>
        </div>
      </section>
    </div>
  );
}
