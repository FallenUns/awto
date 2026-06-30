import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ModelCatalog } from "./ModelCatalog";
import { TROUBLESHOOTING_URL } from "./model-catalog";

function setup(overrides: Partial<React.ComponentProps<typeof ModelCatalog>> = {}) {
  const onSelectModel = vi.fn();
  const onModelsChanged = vi.fn();
  const pull = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn().mockResolvedValue(undefined);
  render(
    <ModelCatalog
      selectedModel="llama3.2:3b"
      installedModels={["llama3.2:3b"]}
      ollamaUrl="http://localhost:11434"
      onSelectModel={onSelectModel}
      onModelsChanged={onModelsChanged}
      deps={{ _pullModel: pull, _deleteModel: del, _deviceMemoryGB: 8, _confirm: () => true }}
      {...overrides}
    />
  );
  return { onSelectModel, onModelsChanged, pull, del };
}

describe("ModelCatalog", () => {
  it("renders recommended and heavy groups", () => {
    setup();
    expect(screen.getAllByText(/Recommended/i)[0]).toBeTruthy();
    expect(screen.getAllByText(/Heavy/i)[0]).toBeTruthy();
    expect(screen.getByText("Qwen 2.5 7B")).toBeTruthy();
  });

  it("downloads a not-installed model when Download is clicked", async () => {
    const { pull, onModelsChanged } = setup();
    const row = screen.getByText("Qwen 2.5 7B").closest("[data-model]") as HTMLElement;
    fireEvent.click(row.querySelector("[data-action='download']")!);
    await waitFor(() => expect(pull).toHaveBeenCalledWith(
      "http://localhost:11434", "qwen2.5:7b", expect.anything()
    ));
    await waitFor(() => expect(onModelsChanged).toHaveBeenCalled());
  });

  it("deletes an installed model after confirm", async () => {
    const { del } = setup();
    const row = screen.getByText("Llama 3.2 3B").closest("[data-model]") as HTMLElement;
    fireEvent.click(row.querySelector("[data-action='delete']")!);
    await waitFor(() => expect(del).toHaveBeenCalledWith("http://localhost:11434", "llama3.2:3b"));
  });

  it("warns when a model needs more RAM than the device reports", () => {
    setup();
    const row = screen.getByText("Gemma 3 27B").closest("[data-model]") as HTMLElement;
    expect(row.textContent).toMatch(/above your|too large|may be slow|may run/i);
  });

  it("uses a custom model id", () => {
    const { onSelectModel } = setup();
    fireEvent.change(screen.getByPlaceholderText(/custom model/i), { target: { value: "mistral-nemo:12b" } });
    fireEvent.click(screen.getByRole("button", { name: /use/i }));
    expect(onSelectModel).toHaveBeenCalledWith("mistral-nemo:12b");
  });

  it("links the troubleshooting guide to GitHub", () => {
    setup();
    const link = screen.getByRole("link", { name: /troubleshoot/i }) as HTMLAnchorElement;
    expect(link.href).toBe(TROUBLESHOOTING_URL);
  });
});
