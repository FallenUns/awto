export type ModelTier = "light" | "balanced" | "heavy";

export interface CatalogModel {
  id: string;
  displayName: string;
  params: string;
  downloadGB: number;
  ramGB: number;
  tier: ModelTier;
  recommended: boolean;
  blurb: string;
}

// Curated general-purpose instruct/chat models (reasoning models excluded —
// their <think> output breaks structured JSON). Sizes are approximate, for
// display only. Verified against ollama.com/library 2026-06-30.
export const MODEL_CATALOG: CatalogModel[] = [
  { id: "llama3.2:3b", displayName: "Llama 3.2 3B", params: "3B", downloadGB: 2.0, ramGB: 8, tier: "light", recommended: false, blurb: "Light and fast. Runs on almost any machine." },
  { id: "qwen2.5:3b", displayName: "Qwen 2.5 3B", params: "3B", downloadGB: 1.9, ramGB: 8, tier: "light", recommended: false, blurb: "Compact, strong at following instructions." },
  { id: "gemma3:4b", displayName: "Gemma 3 4B", params: "4B", downloadGB: 3.3, ramGB: 8, tier: "light", recommended: false, blurb: "Google's small model. Good general quality." },
  { id: "qwen2.5:7b", displayName: "Qwen 2.5 7B", params: "7B", downloadGB: 4.7, ramGB: 16, tier: "balanced", recommended: true, blurb: "Best balance of quality and structured-output reliability." },
  { id: "llama3.1:8b", displayName: "Llama 3.1 8B", params: "8B", downloadGB: 4.9, ramGB: 16, tier: "balanced", recommended: false, blurb: "Popular, well-rounded mid-size model." },
  { id: "mistral:7b", displayName: "Mistral 7B", params: "7B", downloadGB: 4.1, ramGB: 16, tier: "balanced", recommended: false, blurb: "Fast 7B with solid instruction following." },
  { id: "phi4:14b", displayName: "Phi-4 14B", params: "14B", downloadGB: 9.1, ramGB: 24, tier: "heavy", recommended: false, blurb: "Microsoft's strong 14B. Needs a capable machine." },
  { id: "qwen2.5:14b", displayName: "Qwen 2.5 14B", params: "14B", downloadGB: 9.0, ramGB: 24, tier: "heavy", recommended: false, blurb: "Higher quality at the cost of speed and RAM." },
  { id: "gemma3:27b", displayName: "Gemma 3 27B", params: "27B", downloadGB: 17, ramGB: 32, tier: "heavy", recommended: false, blurb: "Large. Needs a strong GPU or 32 GB+ RAM." },
  { id: "qwen2.5:32b", displayName: "Qwen 2.5 32B", params: "32B", downloadGB: 20, ramGB: 32, tier: "heavy", recommended: false, blurb: "Top local quality. Heavy hardware required." },
];

export function findCatalogModel(id: string): CatalogModel | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

export function isHeavyForDevice(
  model: CatalogModel,
  deviceMemoryGB: number | undefined
): boolean {
  if (typeof deviceMemoryGB !== "number") return false;
  return model.ramGB > deviceMemoryGB;
}

export const TROUBLESHOOTING_URL =
  "https://github.com/FallenUns/awto/blob/main/docs/TROUBLESHOOTING.md";
