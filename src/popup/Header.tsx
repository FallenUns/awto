import { RefreshCw } from "lucide-react";
import type { FlowStatus } from "./types";

interface HeaderProps {
  status: FlowStatus;
  readyCount?: number;
  missingCount?: number;
  skipCount?: number;
  chunksDone?: number;
  chunksTotal?: number;
  filledCount?: number;
  onRescan?: () => void;
}

export function Header({
  status,
  readyCount = 0,
  missingCount = 0,
  skipCount = 0,
  chunksDone,
  chunksTotal,
  filledCount,
  onRescan,
}: HeaderProps) {
  return (
    <header className="awto-header">
      <div className="awto-header__brand">
        <span className="awto-header__avatar" aria-hidden="true">A</span>
        <span className="awto-header__name">Awto</span>
      </div>
      <span className="awto-header__pill">{pillFor(status, { readyCount, missingCount, skipCount, chunksDone, chunksTotal, filledCount })}</span>
      {onRescan && (status === "ready" || status === "error" || status === "done") && (
        <button
          type="button"
          className="awto-header__rescan"
          onClick={onRescan}
          aria-label="Rescan this form"
          title="Rescan this form"
        >
          <RefreshCw size={14} strokeWidth={1.5} />
        </button>
      )}
    </header>
  );
}

function pillFor(status: FlowStatus, counts: { readyCount: number; missingCount: number; skipCount: number; chunksDone?: number; chunksTotal?: number; filledCount?: number }): string {
  if (status === "scanning") return "Reading the form…";
  if (status === "mapping") {
    if (counts.chunksTotal && counts.chunksDone !== undefined) return `Mapping ${counts.chunksDone}/${counts.chunksTotal}`;
    return "Mapping…";
  }
  if (status === "ready") {
    const parts: string[] = [];
    if (counts.readyCount > 0) parts.push(`${counts.readyCount} ready`);
    if (counts.missingCount > 0) parts.push(`${counts.missingCount} ask`);
    if (counts.skipCount > 0) parts.push(`${counts.skipCount} skip`);
    return parts.length > 0 ? parts.join(" · ") : "Nothing to fill";
  }
  if (status === "filling") return "Filling…";
  if (status === "done") return counts.filledCount !== undefined ? `Filled ${counts.filledCount}` : "Done";
  if (status === "error") return "Error";
  if (status === "no-form") return "No form here";
  return "";
}
