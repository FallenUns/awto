import { useMemo, useState } from "react";
import { Download, Trash2, Check, Loader2, TriangleAlert, HelpCircle } from "lucide-react";
import {
  MODEL_CATALOG, findCatalogModel, isHeavyForDevice, TROUBLESHOOTING_URL,
  type CatalogModel,
} from "./model-catalog";
import {
  pullModel as defaultPull, deleteModel as defaultDelete, type PullProgress,
} from "./ollama-manage";

export interface ModelCatalogProps {
  selectedModel: string;
  installedModels: string[] | null;
  ollamaUrl: string;
  onSelectModel: (id: string) => void;
  onModelsChanged: () => void;
  deps?: {
    _pullModel?: typeof defaultPull;
    _deleteModel?: typeof defaultDelete;
    _deviceMemoryGB?: number;
    _confirm?: (msg: string) => boolean;
  };
}

type RowState =
  | { kind: "idle" }
  | { kind: "downloading"; percent?: number; status: string; controller: AbortController }
  | { kind: "deleting" }
  | { kind: "error"; message: string };

function readDeviceMemory(deps: ModelCatalogProps["deps"]): number | undefined {
  if (deps?._deviceMemoryGB !== undefined) return deps._deviceMemoryGB;
  const nav = navigator as Navigator & { deviceMemory?: number };
  return typeof nav.deviceMemory === "number" ? nav.deviceMemory : undefined;
}

export function ModelCatalog({
  selectedModel, installedModels, ollamaUrl, onSelectModel, onModelsChanged, deps,
}: ModelCatalogProps) {
  const pull = deps?._pullModel ?? defaultPull;
  const del = deps?._deleteModel ?? defaultDelete;
  const confirmFn = deps?._confirm ?? ((m: string) => window.confirm(m));
  const deviceMemoryGB = readDeviceMemory(deps);

  const [rows, setRows] = useState<Record<string, RowState>>({});
  const installed = useMemo(() => new Set(installedModels ?? []), [installedModels]);

  const recommended = MODEL_CATALOG.filter((m) => m.tier !== "heavy");
  const heavy = MODEL_CATALOG.filter((m) => m.tier === "heavy");

  function setRow(id: string, s: RowState) {
    setRows((prev) => ({ ...prev, [id]: s }));
  }

  async function handleDownload(model: CatalogModel) {
    const controller = new AbortController();
    setRow(model.id, { kind: "downloading", status: "starting…", controller });
    try {
      await pull(ollamaUrl, model.id, {
        signal: controller.signal,
        onProgress: (p: PullProgress) =>
          setRow(model.id, { kind: "downloading", percent: p.percent, status: p.status, controller }),
      });
      setRow(model.id, { kind: "idle" });
      onModelsChanged();
      onSelectModel(model.id);
    } catch (err) {
      if (controller.signal.aborted) {
        setRow(model.id, { kind: "idle" });
        return;
      }
      setRow(model.id, { kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleDelete(model: CatalogModel) {
    if (!confirmFn(`Delete ${model.displayName} from Ollama? This frees ~${model.downloadGB} GB of disk.`)) return;
    setRow(model.id, { kind: "deleting" });
    try {
      await del(ollamaUrl, model.id);
      setRow(model.id, { kind: "idle" });
      onModelsChanged();
    } catch (err) {
      setRow(model.id, { kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  function renderRow(model: CatalogModel) {
    const state = rows[model.id] ?? { kind: "idle" };
    const isInstalled = installed.has(model.id);
    const isSelected = selectedModel === model.id;
    const tooHeavy = isHeavyForDevice(model, deviceMemoryGB);

    return (
      <div
        key={model.id}
        data-model={model.id}
        className={`awto-model-row${isSelected ? " awto-model-row--selected" : ""}`}
      >
        <button
          type="button"
          className="awto-model-row__select"
          disabled={!isInstalled}
          aria-pressed={isSelected}
          onClick={() => isInstalled && onSelectModel(model.id)}
          aria-label={isInstalled ? `Select ${model.displayName}` : `${model.displayName} not installed`}
          title={isInstalled ? "Select this model" : "Download to use"}
        >
          <span className={`awto-radio${isSelected ? " awto-radio--on" : ""}`} aria-hidden="true" />
        </button>

        <div className="awto-model-row__main">
          <div className="awto-model-row__name">
            {model.displayName}
            {model.recommended && <span className="awto-badge awto-badge--rec" aria-label="Recommended">★</span>}
            <span className={`awto-badge awto-badge--tier-${model.tier}`} data-tier={model.tier} aria-label={model.tier} />
          </div>
          {state.kind === "downloading" ? (
            <div className="awto-prog">
              <div className="awto-prog__bar">
                <div className="awto-prog__fill" style={{ width: `${Math.round(state.percent ?? 0)}%` }} />
              </div>
              <div className="awto-prog__txt">
                <span>{state.status}</span>
                <span>{state.percent !== undefined ? `${Math.round(state.percent)}%` : ""}</span>
              </div>
            </div>
          ) : (
            <div className="awto-model-row__meta">
              <span>{model.params}</span>
              <span>{model.downloadGB} GB download</span>
              <span className={tooHeavy ? "awto-meta-warn" : ""}>
                ~{model.ramGB} GB RAM{tooHeavy ? " — above your device estimate, may be slow or fail" : ""}
              </span>
            </div>
          )}
          {state.kind === "error" && (
            <p className="awto-model-row__error">
              {state.message} · <a href={TROUBLESHOOTING_URL} target="_blank" rel="noreferrer">Troubleshoot</a>
            </p>
          )}
        </div>

        <div className="awto-model-row__actions">
          {state.kind === "downloading" ? (
            <button type="button" className="awto-btn awto-btn--secondary" onClick={() => state.controller.abort()}>
              Cancel
            </button>
          ) : isInstalled ? (
            <>
              {isSelected ? (
                <span className="awto-installed"><Check size={15} strokeWidth={2.4} aria-hidden="true" /> In use</span>
              ) : (
                <span className="awto-installed awto-installed--muted"><Check size={15} strokeWidth={2} aria-hidden="true" /> Installed</span>
              )}
              <button
                type="button" className="awto-iconbtn" data-action="delete"
                aria-label={`Delete ${model.displayName}`}
                disabled={state.kind === "deleting"}
                onClick={() => void handleDelete(model)}
              >
                {state.kind === "deleting"
                  ? <Loader2 size={16} className="awto-spin" strokeWidth={1.5} aria-hidden="true" />
                  : <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />}
              </button>
            </>
          ) : (
            <button
              type="button" className="awto-btn awto-btn--primary" data-action="download"
              onClick={() => void handleDownload(model)}
            >
              <Download size={15} strokeWidth={2} aria-hidden="true" /> Download
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="awto-catalog">
      {deviceMemoryGB !== undefined && (
        <div className="awto-hwchip">
          Your device reports ~{deviceMemoryGB} GB RAM (Chrome estimate). Heavier models may be slow.
        </div>
      )}

      <div className="awto-group-hdr">Recommended<span className="awto-group-line" /></div>
      {recommended.map(renderRow)}

      <div className="awto-group-hdr">Heavy — needs strong hardware<span className="awto-group-line" /></div>
      <div className="awto-disclaimer" role="note">
        <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />
        <span>These need a strong GPU or 24 GB+ RAM. Awto can't verify your hardware — they may run very slowly or fail. You can still try them.</span>
      </div>
      {heavy.map(renderRow)}

      <div className="awto-custom">
        <label className="awto-label" htmlFor="custom-model">Use a custom model</label>
        <div className="awto-custom__row">
          <input
            id="custom-model"
            className="awto-input"
            placeholder="custom model id, e.g. mistral-nemo:12b"
            defaultValue={findCatalogModel(selectedModel) ? "" : selectedModel}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = (e.target as HTMLInputElement).value.trim();
                if (v) onSelectModel(v);
              }
            }}
          />
          <button
            type="button" className="awto-btn awto-btn--secondary"
            onClick={() => {
              const el = document.getElementById("custom-model") as HTMLInputElement | null;
              const v = el?.value.trim();
              if (v) onSelectModel(v);
            }}
          >
            Use
          </button>
        </div>
      </div>

      <p className="awto-catalog__foot">
        <HelpCircle size={15} strokeWidth={2} aria-hidden="true" />
        Model won't load or fills wrong?{" "}
        <a href={TROUBLESHOOTING_URL} target="_blank" rel="noreferrer">Troubleshooting guide →</a>
      </p>
    </div>
  );
}
