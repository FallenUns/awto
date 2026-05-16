import { z } from "zod";
import { ProfileSchema, EMPTY_PROFILE, type Profile } from "./profile";

export const LLMSettingsSchema = z.object({
  ollamaUrl: z.string().url().default("http://localhost:11434"),
  ollamaModel: z.string().default("llama3.2"),
  ollamaTimeoutMs: z
    .number()
    .int()
    .min(5000)
    .max(600000)
    .default(90000),
  anthropicApiKey: z.string().default(""),
  anthropicModel: z.string().default("claude-opus-4-7"),
  cloudFallbackEnabled: z.boolean().default(true),
  confidenceThreshold: z.number().min(0).max(1).default(0.7),
});

export type LLMSettings = z.infer<typeof LLMSettingsSchema>;

export const DEFAULT_LLM_SETTINGS: LLMSettings = LLMSettingsSchema.parse({});

const KEY_PROFILE = "awto:profile";
const KEY_LLM = "awto:llm";

async function readKey(key: string): Promise<unknown> {
  const result = await chrome.storage.local.get(key);
  return (result as Record<string, unknown>)[key];
}

async function writeKey(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function loadProfile(): Promise<Profile> {
  const raw = await readKey(KEY_PROFILE);
  if (raw === undefined) return EMPTY_PROFILE;
  const parsed = ProfileSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_PROFILE;
}

export async function saveProfile(profile: Profile): Promise<void> {
  await writeKey(KEY_PROFILE, profile);
}

export async function loadLLMSettings(): Promise<LLMSettings> {
  const raw = await readKey(KEY_LLM);
  if (raw === undefined) return DEFAULT_LLM_SETTINGS;
  const parsed = LLMSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_LLM_SETTINGS;
}

export async function saveLLMSettings(settings: LLMSettings): Promise<void> {
  await writeKey(KEY_LLM, settings);
}
