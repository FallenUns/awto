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

const { Popup, formatFailureReason } = await import("./Popup");

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

describe("Popup confidence dot", () => {
  it("renders an amber confidence dot for rows with confidence < 0.85", async () => {
    const { container } = render(
      <div className="awto-fill-list">
        <li className="awto-fill-list__item">
          <span className="awto-fill-list__label">
            <span
              className="awto-confidence-dot"
              title="Low confidence — verify this value"
              aria-label="Low confidence"
            />
            Title
          </span>
          <span className="awto-fill-list__value">Mister</span>
        </li>
        <li className="awto-fill-list__item">
          <span className="awto-fill-list__label">First Name</span>
          <span className="awto-fill-list__value">Pat</span>
        </li>
      </div>
    );

    const dots = container.querySelectorAll(".awto-confidence-dot");
    expect(dots).toHaveLength(1);

    const dotElement = dots[0] as HTMLElement;
    expect(dotElement.title).toBe("Low confidence — verify this value");
    expect(dotElement.getAttribute("aria-label")).toBe("Low confidence");
  });
});

describe("formatFailureReason", () => {
  it("explains when a dropdown has no matching option", () => {
    expect(formatFailureReason("no matching option")).toMatch(
      /dropdown did not have a matching option/i
    );
  });
});
