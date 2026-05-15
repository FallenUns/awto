import { describe, it, expect, beforeEach, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { callCloud, CloudLLMError } from "./cloud";
import type { Profile } from "@/shared/profile";
import type { ScannedField } from "@/shared/messages";

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn(() => ({
      messages: { create: vi.fn() },
    })),
  };
});

const profile: Profile = { firstName: "Patrick", custom: {} };
const fields: ScannedField[] = [
  {
    id: 0,
    selector: "#fname",
    label: "First name",
    placeholder: null,
    type: "text",
    required: true,
  },
];
const opts = {
  anthropicApiKey: "sk-ant-test",
  anthropicModel: "claude-opus-4-7",
};

const validResponse = {
  mappings: [
    {
      fieldId: 0,
      actionType: "fill",
      profileKey: "firstName",
      suggestedKey: null,
      promptText: null,
      reason: null,
      confidence: 0.95,
    },
  ],
};

function setMockImplementation(create: ReturnType<typeof vi.fn>) {
  (Anthropic as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    () => ({ messages: { create } })
  );
}

describe("callCloud", () => {
  beforeEach(() => {
    (Anthropic as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  it("returns parsed LLMResponse on happy path", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "submit_mapping",
          input: validResponse,
        },
      ],
    });
    setMockImplementation(create);

    const result = await callCloud(profile, fields, opts);
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0]?.profileKey).toBe("firstName");
  });

  it("constructs the client with dangerouslyAllowBrowser and the user's api key", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        { type: "tool_use", name: "submit_mapping", input: validResponse },
      ],
    });
    setMockImplementation(create);

    await callCloud(profile, fields, opts);
    const ctorCalls = (Anthropic as unknown as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(ctorCalls.length).toBeGreaterThan(0);
    const ctorArg = ctorCalls[0]?.[0] as {
      apiKey: string;
      dangerouslyAllowBrowser: boolean;
    };
    expect(ctorArg.apiKey).toBe("sk-ant-test");
    expect(ctorArg.dangerouslyAllowBrowser).toBe(true);
  });

  it("forces tool use on submit_mapping", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        { type: "tool_use", name: "submit_mapping", input: validResponse },
      ],
    });
    setMockImplementation(create);

    await callCloud(profile, fields, opts);
    const callArg = create.mock.calls[0]?.[0];
    expect(callArg.tool_choice).toEqual({
      type: "tool",
      name: "submit_mapping",
    });
    expect(callArg.tools).toHaveLength(1);
    expect(callArg.tools[0].name).toBe("submit_mapping");
    expect(callArg.model).toBe("claude-opus-4-7");
  });

  it("throws CloudLLMError when apiKey is empty", async () => {
    await expect(
      callCloud(profile, fields, { ...opts, anthropicApiKey: "" })
    ).rejects.toBeInstanceOf(CloudLLMError);
  });

  it("throws when the response has no tool_use block", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "I refuse" }],
    });
    setMockImplementation(create);

    await expect(callCloud(profile, fields, opts)).rejects.toThrow(
      /tool/i
    );
  });

  it("throws when the tool block has the wrong name", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        { type: "tool_use", name: "other_tool", input: validResponse },
      ],
    });
    setMockImplementation(create);

    await expect(callCloud(profile, fields, opts)).rejects.toThrow(
      /tool/i
    );
  });

  it("throws when tool input does not validate", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "submit_mapping",
          input: { mappings: [{ fieldId: 0, actionType: "fill" }] },
        },
      ],
    });
    setMockImplementation(create);

    await expect(callCloud(profile, fields, opts)).rejects.toThrow(
      /schema validation/i
    );
  });

  it("redacts the api key from network error messages", async () => {
    const create = vi
      .fn()
      .mockRejectedValue(new Error("auth failed for sk-ant-test"));
    setMockImplementation(create);

    try {
      await callCloud(profile, fields, opts);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error).message).not.toContain("sk-ant-test");
    }
  });

  it("wraps network errors in CloudLLMError", async () => {
    const create = vi.fn().mockRejectedValue(new Error("network down"));
    setMockImplementation(create);

    await expect(callCloud(profile, fields, opts)).rejects.toBeInstanceOf(
      CloudLLMError
    );
  });
});
