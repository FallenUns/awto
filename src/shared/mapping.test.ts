import { describe, it, expect } from "vitest";
import {
  FieldMappingSchema,
  LLMResponseSchema,
  isFillMapping,
  isMissingMapping,
  isSkipMapping,
  type FieldMapping,
} from "./mapping";

describe("FieldMappingSchema", () => {
  it("parses a valid fill mapping", () => {
    const mapping = FieldMappingSchema.parse({
      fieldId: 0,
      actionType: "fill",
      profileKey: "firstName",
      suggestedKey: null,
      promptText: null,
      reason: null,
      confidence: 0.95,
    });
    expect(mapping.actionType).toBe("fill");
    expect(mapping.profileKey).toBe("firstName");
  });

  it("parses a valid missing mapping", () => {
    const mapping = FieldMappingSchema.parse({
      fieldId: 1,
      actionType: "missing",
      profileKey: null,
      suggestedKey: "linkedIn",
      promptText: "What is your LinkedIn URL?",
      reason: null,
      confidence: 0.8,
    });
    expect(mapping.actionType).toBe("missing");
    expect(mapping.suggestedKey).toBe("linkedIn");
    expect(mapping.promptText).toBe("What is your LinkedIn URL?");
  });

  it("parses a valid skip mapping", () => {
    const mapping = FieldMappingSchema.parse({
      fieldId: 2,
      actionType: "skip",
      profileKey: null,
      suggestedKey: null,
      promptText: null,
      reason: "captcha",
      confidence: 0.1,
    });
    expect(mapping.actionType).toBe("skip");
    expect(mapping.reason).toBe("captcha");
  });

  it("rejects an invalid actionType", () => {
    expect(() =>
      FieldMappingSchema.parse({
        fieldId: 0,
        actionType: "invalid",
        profileKey: null,
        suggestedKey: null,
        promptText: null,
        reason: null,
        confidence: 0.5,
      })
    ).toThrow();
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(() =>
      FieldMappingSchema.parse({
        fieldId: 0,
        actionType: "fill",
        profileKey: "firstName",
        suggestedKey: null,
        promptText: null,
        reason: null,
        confidence: 1.5,
      })
    ).toThrow();
    expect(() =>
      FieldMappingSchema.parse({
        fieldId: 0,
        actionType: "fill",
        profileKey: "firstName",
        suggestedKey: null,
        promptText: null,
        reason: null,
        confidence: -0.1,
      })
    ).toThrow();
  });

  it("rejects a negative fieldId", () => {
    expect(() =>
      FieldMappingSchema.parse({
        fieldId: -1,
        actionType: "fill",
        profileKey: "firstName",
        suggestedKey: null,
        promptText: null,
        reason: null,
        confidence: 0.9,
      })
    ).toThrow();
  });

  it("rejects a non-integer fieldId", () => {
    expect(() =>
      FieldMappingSchema.parse({
        fieldId: 1.5,
        actionType: "fill",
        profileKey: "firstName",
        suggestedKey: null,
        promptText: null,
        reason: null,
        confidence: 0.9,
      })
    ).toThrow();
  });
});

describe("LLMResponseSchema", () => {
  it("parses an empty mappings array", () => {
    expect(LLMResponseSchema.parse({ mappings: [] }).mappings).toEqual([]);
  });

  it("parses a response with multiple mappings", () => {
    const response = LLMResponseSchema.parse({
      mappings: [
        {
          fieldId: 0,
          actionType: "fill",
          profileKey: "firstName",
          suggestedKey: null,
          promptText: null,
          reason: null,
          confidence: 0.9,
        },
        {
          fieldId: 1,
          actionType: "skip",
          profileKey: null,
          suggestedKey: null,
          promptText: null,
          reason: "captcha",
          confidence: 0.2,
        },
      ],
    });
    expect(response.mappings).toHaveLength(2);
  });
});

describe("type guards", () => {
  const fill: FieldMapping = {
    fieldId: 0,
    actionType: "fill",
    profileKey: "firstName",
    suggestedKey: null,
    promptText: null,
    reason: null,
    confidence: 0.95,
  };
  const missing: FieldMapping = {
    fieldId: 1,
    actionType: "missing",
    profileKey: null,
    suggestedKey: "linkedIn",
    promptText: "What is your LinkedIn URL?",
    reason: null,
    confidence: 0.7,
  };
  const skip: FieldMapping = {
    fieldId: 2,
    actionType: "skip",
    profileKey: null,
    suggestedKey: null,
    promptText: null,
    reason: "captcha",
    confidence: 0.1,
  };

  it("isFillMapping narrows fill mappings only", () => {
    expect(isFillMapping(fill)).toBe(true);
    expect(isFillMapping(missing)).toBe(false);
    expect(isFillMapping(skip)).toBe(false);
  });

  it("isFillMapping rejects fill mappings with null profileKey", () => {
    const bad: FieldMapping = { ...fill, profileKey: null };
    expect(isFillMapping(bad)).toBe(false);
  });

  it("isMissingMapping narrows missing mappings only", () => {
    expect(isMissingMapping(missing)).toBe(true);
    expect(isMissingMapping(fill)).toBe(false);
    expect(isMissingMapping(skip)).toBe(false);
  });

  it("isMissingMapping rejects missing mappings with null suggestedKey or promptText", () => {
    expect(isMissingMapping({ ...missing, suggestedKey: null })).toBe(false);
    expect(isMissingMapping({ ...missing, promptText: null })).toBe(false);
  });

  it("isSkipMapping narrows skip mappings only", () => {
    expect(isSkipMapping(skip)).toBe(true);
    expect(isSkipMapping(fill)).toBe(false);
    expect(isSkipMapping(missing)).toBe(false);
  });

  it("isSkipMapping rejects skip mappings with null reason", () => {
    expect(isSkipMapping({ ...skip, reason: null })).toBe(false);
  });
});
