import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { AwtoMessage } from "@/shared/messages";

(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    onMessage: { addListener: vi.fn() },
    lastError: undefined,
    connect: vi.fn(() => ({
      name: "awto-chat",
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    })),
  },
  tabs: {
    query: vi.fn((_q, cb: (tabs: chrome.tabs.Tab[]) => void) =>
      cb([{ id: 1 } as chrome.tabs.Tab])
    ),
    sendMessage: vi.fn(
      (
        _tabId: number,
        msg: AwtoMessage,
        cb: (response: AwtoMessage) => void
      ) => {
        if (msg.type === "scanForm") {
          cb({ type: "scanFormResult", fields: [] });
        }
      }
    ),
  },
  storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn() } },
};

const { Popup } = await import("./Popup");

describe("Popup smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the 'No form on this page' empty state", async () => {
    render(<Popup />);
    await waitFor(() => {
      expect(screen.getByText(/no form on this page/i)).toBeTruthy();
    });
  });
});
