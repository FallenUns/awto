import type { FieldMapping } from "@/shared/mapping";
import type { ScannedField } from "@/shared/messages";

export interface CachedEntry {
  mappings: FieldMapping[];
  source: "local" | "cloud" | "mixed";
  cachedAt: number;
}

const cache = new Map<string, CachedEntry>();

export function cacheKey(tabId: number, fields: ScannedField[]): string {
  const signature = fields
    .map((f) => `${f.label}|${f.placeholder ?? ""}|${f.type}`)
    .join("§");
  return `${tabId}:${signature}`;
}

export function getCached(key: string): CachedEntry | null {
  return cache.get(key) ?? null;
}

export function setCached(
  key: string,
  entry: Omit<CachedEntry, "cachedAt">
): void {
  cache.set(key, { ...entry, cachedAt: Date.now() });
}

export function invalidateTab(tabId: number): void {
  const prefix = `${tabId}:`;
  for (const k of Array.from(cache.keys())) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

export function _clearCache(): void {
  cache.clear();
}
