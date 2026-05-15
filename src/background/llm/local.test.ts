import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { callLocal, pingOllama, LocalLLMError } from "./local";
import type { Profile } from "@/shared/profile";
import type { ScannedField } from "@/shared/messages";

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
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
};

function mockFetchResponse(init: {
  ok?: boolean;
  status?: number;
  jsonValue?: unknown;
  jsonThrows?: boolean;
  textValue?: string;
}): Response {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 500);
  return {
    ok,
    status,
    json: vi.fn(async () => {
      if (init.jsonThrows) throw new Error("invalid json");
      return init.jsonValue;
    }),
    text: vi.fn(async () => init.textValue ?? ""),
  } as unknown as Response;
}

describe("pingOllama", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok=true on a 2xx response", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse({ ok: true, status: 200 })
    );
    const result = await pingOllama("http://localhost:11434");
    expect(result.ok).toBe(true);
  });

  it("returns ok=false with HTTP status on a non-2xx response", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse({ ok: false, status: 503 })
    );
    const result = await pingOllama("http://localhost:11434");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("503");
  });

  it("returns ok=false on a network failure", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("ECONNREFUSED")
    );
    const result = await pingOllama("http://localhost:11434");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("hits the /api/version endpoint and trims trailing slash on base url", async () => {
    const f = vi.fn().mockResolvedValue(mockFetchResponse({ ok: true }));
    vi.stubGlobal("fetch", f);
    await pingOllama("http://localhost:11434/");
    const calledUrl = f.mock.calls[0]?.[0] as string | undefined;
    expect(calledUrl).toBe("http://localhost:11434/api/version");
  });
});

describe("callLocal", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const validLLMResponse = {
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

  it("returns a parsed LLMResponse on the happy path", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse({
        ok: true,
        jsonValue: {
          message: { role: "assistant", content: JSON.stringify(validLLMResponse) },
        },
      })
    );
    const result = await callLocal(profile, fields, opts);
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0]?.profileKey).toBe("firstName");
  });

  it("posts to /api/chat with the model name and structured format", async () => {
    const f = vi.fn().mockResolvedValue(
      mockFetchResponse({
        ok: true,
        jsonValue: {
          message: { content: JSON.stringify(validLLMResponse) },
        },
      })
    );
    vi.stubGlobal("fetch", f);
    await callLocal(profile, fields, opts);
    expect(f).toHaveBeenCalledTimes(1);
    const call = f.mock.calls[0] as [string, RequestInit];
    const url = call[0];
    const init = call[1];
    expect(url).toBe("http://localhost:11434/api/chat");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("llama3.2");
    expect(body.stream).toBe(false);
    expect(body.format).toBeDefined();
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
  });

  it("throws LocalLLMError on a network error", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("ECONNREFUSED")
    );
    await expect(callLocal(profile, fields, opts)).rejects.toBeInstanceOf(
      LocalLLMError
    );
  });

  it("throws LocalLLMError on a non-2xx response", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse({ ok: false, status: 500, textValue: "server crash" })
    );
    await expect(callLocal(profile, fields, opts)).rejects.toThrow(
      /HTTP 500/
    );
  });

  it("throws LocalLLMError when message.content is missing", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse({
        ok: true,
        jsonValue: { message: {} },
      })
    );
    await expect(callLocal(profile, fields, opts)).rejects.toThrow(
      /message\.content/
    );
  });

  it("throws LocalLLMError when message.content is not valid JSON", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse({
        ok: true,
        jsonValue: { message: { content: "not json at all" } },
      })
    );
    await expect(callLocal(profile, fields, opts)).rejects.toThrow(/JSON/);
  });

  it("throws LocalLLMError when content fails schema validation", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse({
        ok: true,
        jsonValue: {
          message: {
            content: JSON.stringify({
              mappings: [
                {
                  fieldId: 0,
                  actionType: "fill",
                  // missing required fields
                },
              ],
            }),
          },
        },
      })
    );
    await expect(callLocal(profile, fields, opts)).rejects.toThrow(
      /schema validation/i
    );
  });

  it("throws LocalLLMError when the response body is not JSON", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse({ ok: true, jsonThrows: true })
    );
    await expect(callLocal(profile, fields, opts)).rejects.toThrow(/JSON/);
  });
});
