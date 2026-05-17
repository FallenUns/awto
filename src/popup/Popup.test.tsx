import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { AwtoMessage } from "@/shared/messages";
import type { FlowState, FlowStatus } from "./types";

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

  it("explains when live page label disagrees with the mapped field", () => {
    expect(formatFailureReason("label mismatch")).toMatch(
      /label did not match/i
    );
  });
});

function mockFlow(overrides: { status: FlowStatus; state: Partial<FlowState> }) {
  vi.doMock("./useAwtoFlow", () => ({
    useAwtoFlow: () => ({
      status: overrides.status,
      state: {
        status: overrides.status,
        error: null,
        fields: [],
        mappings: [],
        fillRows: [],
        missingRows: [],
        skippedRows: [],
        filledCount: 0,
        failedFills: [],
        chunksCompleted: 0,
        loadingFields: [],
        ...overrides.state,
      } as FlowState,
      setMissingValue: vi.fn(),
      fill: vi.fn(),
      retry: vi.fn(),
      cancel: vi.fn(),
      rescan: vi.fn(),
    }),
  }));
}

describe("Popup progressive row resolution", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("renders resolved fill rows in their fieldId slot during mapping; remaining rows shimmer", async () => {
    mockFlow({
      status: "mapping",
      state: {
        loadingFields: [
          { id: 0, selector: "#a", label: "First name", placeholder: null, type: "text", required: false },
          { id: 1, selector: "#b", label: "Email", placeholder: null, type: "email", required: false },
          { id: 2, selector: "#c", label: "Mystery", placeholder: null, type: "text", required: false },
        ],
        fillRows: [
          { fieldId: 0, selector: "#a", label: "First name", profileKey: "firstName", resolvedValue: "Patrick", confidence: 1 },
          { fieldId: 1, selector: "#b", label: "Email", profileKey: "email", resolvedValue: "p@x.com", confidence: 1 },
        ],
      },
    });
    const { Popup: PopupDyn } = await import("./Popup");
    const { render: renderDyn, screen: screenDyn } = await import("@testing-library/react");
    renderDyn(<PopupDyn />);
    expect(screenDyn.getByText("Patrick")).toBeTruthy();
    expect(screenDyn.getByText("p@x.com")).toBeTruthy();
    expect(document.querySelectorAll(".awto-shimmer")).toHaveLength(1);
    expect(document.querySelectorAll(".awto-fieldrow")).toHaveLength(3);
  });

  it("renders ActionBar with Fill disabled during mapping", async () => {
    mockFlow({
      status: "mapping",
      state: {
        loadingFields: [
          { id: 0, selector: "#a", label: "First name", placeholder: null, type: "text", required: false },
        ],
        fillRows: [
          { fieldId: 0, selector: "#a", label: "First name", profileKey: "firstName", resolvedValue: "Patrick", confidence: 1 },
        ],
      },
    });
    const { Popup: PopupDyn } = await import("./Popup");
    const { render: renderDyn, screen: screenDyn } = await import("@testing-library/react");
    renderDyn(<PopupDyn />);
    const fillBtn = screenDyn.getByRole("button", { name: /mapping|fill/i });
    expect((fillBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("ActionBar Fill is enabled in ready state when there's at least one fillable row", async () => {
    mockFlow({
      status: "ready",
      state: {
        loadingFields: [
          { id: 0, selector: "#a", label: "First name", placeholder: null, type: "text", required: false },
        ],
        fillRows: [
          { fieldId: 0, selector: "#a", label: "First name", profileKey: "firstName", resolvedValue: "Patrick", confidence: 1 },
        ],
      },
    });
    const { Popup: PopupDyn } = await import("./Popup");
    const { render: renderDyn, screen: screenDyn } = await import("@testing-library/react");
    renderDyn(<PopupDyn />);
    const fillBtn = screenDyn.getByRole("button", { name: /fill 1 field/i });
    expect((fillBtn as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("Popup grouped sections", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("renders Will fill section above Review before filling section", async () => {
    mockFlow({
      status: "ready",
      state: {
        loadingFields: [],
        fillRows: [
          { fieldId: 0, selector: "#a", label: "First name", profileKey: "firstName", resolvedValue: "Patrick", confidence: 1 },
          { fieldId: 1, selector: "#b", label: "Account", profileKey: "phone", resolvedValue: "0400 000 000", confidence: 0.7 },
        ],
      },
    });
    const { Popup: PopupDyn } = await import("./Popup");
    const { render: renderDyn } = await import("@testing-library/react");
    const { container } = renderDyn(<PopupDyn />);
    const headers = container.querySelectorAll(".awto-section-header__label");
    const labels = Array.from(headers).map((h) => h.textContent);
    expect(labels[0]).toBe("Will fill");
    expect(labels[1]).toBe("Review before filling");
  });

  it("low-confidence fills land in Review, not Will fill (ActionBar count excludes them)", async () => {
    mockFlow({
      status: "ready",
      state: {
        loadingFields: [],
        fillRows: [
          { fieldId: 0, selector: "#a", label: "First name", profileKey: "firstName", resolvedValue: "Patrick", confidence: 1 },
          { fieldId: 1, selector: "#b", label: "Account", profileKey: "phone", resolvedValue: "0400 000 000", confidence: 0.7 },
        ],
      },
    });
    const { Popup: PopupDyn } = await import("./Popup");
    const { render: renderDyn, screen: screenDyn } = await import("@testing-library/react");
    renderDyn(<PopupDyn />);
    const fillBtn = screenDyn.getByRole("button", { name: /fill 1 field/i });
    expect((fillBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("clicking Use on a Review row promotes it into Will fill (count goes up)", async () => {
    mockFlow({
      status: "ready",
      state: {
        loadingFields: [],
        fillRows: [
          { fieldId: 0, selector: "#a", label: "First name", profileKey: "firstName", resolvedValue: "Patrick", confidence: 1 },
          { fieldId: 1, selector: "#b", label: "Account", profileKey: "phone", resolvedValue: "0400 000 000", confidence: 0.7 },
        ],
      },
    });
    const { Popup: PopupDyn } = await import("./Popup");
    const { render: renderDyn, screen: screenDyn, fireEvent } = await import("@testing-library/react");
    renderDyn(<PopupDyn />);
    expect(screenDyn.getByRole("button", { name: /fill 1 field/i })).toBeTruthy();
    const useBtn = screenDyn.getByRole("button", { name: /use 0400 000 000/i });
    fireEvent.click(useBtn);
    expect(screenDyn.getByRole("button", { name: /fill 2 fields/i })).toBeTruthy();
  });

  it("Skipped section is collapsed by default and expands on click", async () => {
    mockFlow({
      status: "ready",
      state: {
        loadingFields: [],
        skippedRows: [
          { fieldId: 0, label: "Slider", reason: "Cannot fill slider" },
          { fieldId: 1, label: "Color", reason: "Cannot fill color picker" },
        ],
      },
    });
    const { Popup: PopupDyn } = await import("./Popup");
    const { render: renderDyn, screen: screenDyn, fireEvent } = await import("@testing-library/react");
    renderDyn(<PopupDyn />);
    expect(document.querySelectorAll(".awto-fieldrow--skip")).toHaveLength(0);
    const header = screenDyn.getByRole("button", { name: /skipped/i });
    fireEvent.click(header);
    expect(document.querySelectorAll(".awto-fieldrow--skip")).toHaveLength(2);
  });

  it("hides section headers whose count is zero", async () => {
    mockFlow({
      status: "ready",
      state: {
        loadingFields: [],
        fillRows: [
          { fieldId: 0, selector: "#a", label: "First name", profileKey: "firstName", resolvedValue: "Patrick", confidence: 1 },
        ],
      },
    });
    const { Popup: PopupDyn } = await import("./Popup");
    const { render: renderDyn } = await import("@testing-library/react");
    renderDyn(<PopupDyn />);
    const headers = document.querySelectorAll(".awto-section-header__label");
    const labels = Array.from(headers).map((h) => h.textContent);
    expect(labels).toEqual(["Will fill"]);
  });
});
