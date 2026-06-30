import { OLLAMA_ORIGINS_HELP } from "@/shared/ollama-errors";

export interface PullProgress {
  status: string;
  completedBytes?: number;
  totalBytes?: number;
  percent?: number;
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${trimmed}${path}`;
}

export async function pullModel(
  ollamaUrl: string,
  model: string,
  opts: { onProgress: (p: PullProgress) => void; signal?: AbortSignal }
): Promise<void> {
  const res = await fetch(joinUrl(ollamaUrl, "/api/pull"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: true }),
    signal: opts.signal,
  });
  if (!res.ok) {
    if (res.status === 403) throw new Error(OLLAMA_ORIGINS_HELP);
    throw new Error(`Ollama returned HTTP ${res.status} while pulling ${model}`);
  }
  if (!res.body) throw new Error("Ollama pull returned an empty response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const obj = JSON.parse(line) as {
        status?: string; error?: string; total?: number; completed?: number;
      };
      if (obj.error) throw new Error(obj.error);
      const total = obj.total;
      const completed = obj.completed;
      const percent =
        typeof total === "number" && total > 0 && typeof completed === "number"
          ? (completed / total) * 100
          : undefined;
      opts.onProgress({
        status: obj.status ?? "",
        completedBytes: completed,
        totalBytes: total,
        percent,
      });
    }
  }
}

export async function deleteModel(ollamaUrl: string, model: string): Promise<void> {
  const res = await fetch(joinUrl(ollamaUrl, "/api/delete"), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  if (!res.ok) {
    if (res.status === 403) throw new Error(OLLAMA_ORIGINS_HELP);
    throw new Error(`Ollama returned HTTP ${res.status} while deleting ${model}`);
  }
}
