import { z } from "zod";

export const FieldMappingSchema = z.object({
  fieldId: z.number().int().nonnegative(),
  actionType: z.enum(["fill", "missing", "skip"]),
  profileKey: z.string().nullable(),
  suggestedKey: z.string().nullable(),
  promptText: z.string().nullable(),
  reason: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export const LLMResponseSchema = z.object({
  mappings: z.array(FieldMappingSchema),
});

export type FieldMapping = z.infer<typeof FieldMappingSchema>;
export type LLMResponse = z.infer<typeof LLMResponseSchema>;

export function isFillMapping(
  m: FieldMapping
): m is FieldMapping & { actionType: "fill"; profileKey: string } {
  return m.actionType === "fill" && m.profileKey !== null;
}

export function isMissingMapping(
  m: FieldMapping
): m is FieldMapping & {
  actionType: "missing";
  suggestedKey: string;
  promptText: string;
} {
  return (
    m.actionType === "missing" &&
    m.suggestedKey !== null &&
    m.promptText !== null
  );
}

export function isSkipMapping(
  m: FieldMapping
): m is FieldMapping & { actionType: "skip"; reason: string } {
  return m.actionType === "skip" && m.reason !== null;
}
