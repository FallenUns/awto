import { TriangleAlert } from "lucide-react";
import { findCatalogModel, isHeavyForDevice, TROUBLESHOOTING_URL } from "@/options/model-catalog";

export function HeavyModelBanner({
  model, deviceMemoryGB,
}: { model: string; deviceMemoryGB: number | undefined }) {
  const entry = findCatalogModel(model);
  if (!entry || !isHeavyForDevice(entry, deviceMemoryGB)) return null;
  return (
    <div className="awto-heavy-banner" role="note">
      <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
      <span>
        {entry.displayName} may be slow or fail on this device.{" "}
        <a href={TROUBLESHOOTING_URL} target="_blank" rel="noreferrer">Help</a>
      </span>
    </div>
  );
}
