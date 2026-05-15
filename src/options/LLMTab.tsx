import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import type { LLMSettings } from "@/shared/storage";
import type { SaveStatus } from "./useOptionsState";

const ANTHROPIC_MODELS = [
  "claude-opus-4-7",
  "claude-sonnet-4-7",
  "claude-haiku-4-7",
];

interface LLMTabProps {
  settings: LLMSettings;
  saveStatus: SaveStatus;
  onUpdate: (partial: Partial<LLMSettings>) => void;
  onTestOllama: () => Promise<{ ok: boolean; error?: string }>;
}

type TestResult =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok" }
  | { kind: "error"; error: string };

export function LLMTab({
  settings,
  saveStatus,
  onUpdate,
  onTestOllama,
}: LLMTabProps) {
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>({ kind: "idle" });

  async function handleTest() {
    setTestResult({ kind: "testing" });
    try {
      const result = await onTestOllama();
      if (result.ok) {
        setTestResult({ kind: "ok" });
      } else {
        setTestResult({ kind: "error", error: result.error ?? "Unknown error" });
      }
    } catch (err) {
      setTestResult({
        kind: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
          <input
            id="ollama-model"
            className="awto-input"
            type="text"
            value={settings.ollamaModel}
            onChange={(e) => onUpdate({ ollamaModel: e.target.value })}
            placeholder="llama3.2"
          />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
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
          {testResult.kind === "ok" && (
            <span
              className="awto-badge awto-badge--success"
              role="status"
              aria-live="polite"
            >
              Connected
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
    </div>
  );
}
