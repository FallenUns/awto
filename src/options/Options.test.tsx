import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    onMessage: { addListener: vi.fn() },
    lastError: undefined,
    getManifest: () => ({ version: "0.1.0" }),
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
};

const { Options } = await import("./Options");

describe("Options smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all three tab labels", async () => {
    render(<Options />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /profile/i })).toBeTruthy();
    });
    expect(screen.getByRole("tab", { name: /llm/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /about/i })).toBeTruthy();
  });
});
