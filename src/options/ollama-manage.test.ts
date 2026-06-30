import { describe, it, expect, vi, afterEach } from "vitest";
import { pullModel, deleteModel, type PullProgress } from "./ollama-manage";

afterEach(() => vi.unstubAllGlobals());

function streamResponse(lines: string[], ok = true, status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const l of lines) controller.enqueue(enc.encode(l));
      controller.close();
    },
  });
  return { ok, status, body } as unknown as Response;
}

describe("pullModel", () => {
  it("parses NDJSON progress lines and reports increasing percent", async () => {
    const f = vi.fn().mockResolvedValue(
      streamResponse([
        '{"status":"pulling manifest"}\n',
        '{"status":"downloading","total":1000,"completed":250}\n',
        '{"status":"downloading","total":1000,"completed":1000}\n{"status":"success"}\n',
      ])
    );
    vi.stubGlobal("fetch", f);
    const seen: PullProgress[] = [];
    await pullModel("http://localhost:11434", "qwen2.5:7b", {
      onProgress: (p) => seen.push(p),
    });
    expect(f.mock.calls[0]![0]).toBe("http://localhost:11434/api/pull");
    const pct = seen.map((s) => s.percent).filter((p): p is number => p !== undefined);
    expect(pct).toEqual([25, 100]);
    expect(seen.at(-1)?.status).toBe("success");
  });

  it("rejects with the OLLAMA_ORIGINS help on a 403", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse([], false, 403)));
    await expect(
      pullModel("http://localhost:11434", "m", { onProgress: () => {} })
    ).rejects.toThrow(/OLLAMA_ORIGINS.*chrome-extension/s);
  });

  it("rejects when a progress line carries an error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      streamResponse(['{"error":"model not found"}\n'])
    ));
    await expect(
      pullModel("http://localhost:11434", "nope", { onProgress: () => {} })
    ).rejects.toThrow(/model not found/);
  });
});

describe("deleteModel", () => {
  it("issues a DELETE to /api/delete with the model name", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal("fetch", f);
    await deleteModel("http://localhost:11434/", "llama3.2:3b");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/delete");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body as string)).toEqual({ model: "llama3.2:3b" });
  });

  it("throws on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));
    await expect(deleteModel("http://localhost:11434", "m")).rejects.toThrow(/500/);
  });
});
