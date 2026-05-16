import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Header } from "./Header";

describe("Header", () => {
  it("renders the Awto brand and name", () => {
    render(<Header status="no-form" />);
    expect(screen.getByText("Awto")).toBeTruthy();
    const avatar = document.querySelector(".awto-header__avatar");
    expect(avatar?.textContent).toBe("A");
  });

  it("shows 'Reading the form…' pill in scanning status", () => {
    render(<Header status="scanning" />);
    expect(screen.getByText("Reading the form…")).toBeTruthy();
  });

  it("shows 'Mapping…' pill in mapping status without chunks", () => {
    render(<Header status="mapping" />);
    expect(screen.getByText("Mapping…")).toBeTruthy();
  });

  it("shows 'Mapping N/M' pill in mapping status with chunks", () => {
    render(<Header status="mapping" chunksDone={2} chunksTotal={5} />);
    expect(screen.getByText("Mapping 2/5")).toBeTruthy();
  });

  it("shows ready counts separated by dots in ready status", () => {
    render(
      <Header
        status="ready"
        readyCount={6}
        missingCount={3}
        skipCount={1}
      />
    );
    expect(screen.getByText("6 ready · 3 ask · 1 skip")).toBeTruthy();
  });

  it("shows 'Nothing to fill' when ready with no counts", () => {
    render(<Header status="ready" />);
    expect(screen.getByText("Nothing to fill")).toBeTruthy();
  });

  it("shows 'Filling…' pill in filling status", () => {
    render(<Header status="filling" />);
    expect(screen.getByText("Filling…")).toBeTruthy();
  });

  it("shows 'Filled N' pill in done status with count", () => {
    render(<Header status="done" filledCount={5} />);
    expect(screen.getByText("Filled 5")).toBeTruthy();
  });

  it("shows 'Done' pill in done status without count", () => {
    render(<Header status="done" />);
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("shows 'Error' pill in error status", () => {
    render(<Header status="error" />);
    expect(screen.getByText("Error")).toBeTruthy();
  });

  it("shows 'No form here' pill in no-form status", () => {
    render(<Header status="no-form" />);
    expect(screen.getByText("No form here")).toBeTruthy();
  });

  it("shows rescan button in ready status when onRescan provided", () => {
    const onRescan = vi.fn();
    render(<Header status="ready" onRescan={onRescan} />);
    const button = document.querySelector(".awto-header__rescan");
    expect(button).toBeTruthy();
  });

  it("shows rescan button in error status when onRescan provided", () => {
    const onRescan = vi.fn();
    render(<Header status="error" onRescan={onRescan} />);
    const button = document.querySelector(".awto-header__rescan");
    expect(button).toBeTruthy();
  });

  it("shows rescan button in done status when onRescan provided", () => {
    const onRescan = vi.fn();
    render(<Header status="done" onRescan={onRescan} />);
    const button = document.querySelector(".awto-header__rescan");
    expect(button).toBeTruthy();
  });

  it("hides rescan button in scanning status even with onRescan", () => {
    const onRescan = vi.fn();
    render(<Header status="scanning" onRescan={onRescan} />);
    const button = document.querySelector(".awto-header__rescan");
    expect(button).toBeFalsy();
  });

  it("hides rescan button in mapping status even with onRescan", () => {
    const onRescan = vi.fn();
    render(<Header status="mapping" onRescan={onRescan} />);
    const button = document.querySelector(".awto-header__rescan");
    expect(button).toBeFalsy();
  });

  it("hides rescan button in filling status even with onRescan", () => {
    const onRescan = vi.fn();
    render(<Header status="filling" onRescan={onRescan} />);
    const button = document.querySelector(".awto-header__rescan");
    expect(button).toBeFalsy();
  });

  it("hides rescan button when onRescan not provided", () => {
    render(<Header status="ready" />);
    const button = document.querySelector(".awto-header__rescan");
    expect(button).toBeFalsy();
  });

  it("calls onRescan when rescan button clicked", () => {
    const onRescan = vi.fn();
    render(<Header status="ready" onRescan={onRescan} />);
    const button = document.querySelector(".awto-header__rescan") as HTMLButtonElement;
    fireEvent.click(button);
    expect(onRescan).toHaveBeenCalledOnce();
  });

  it("omits zero counts from pill", () => {
    render(
      <Header
        status="ready"
        readyCount={3}
        missingCount={0}
        skipCount={2}
      />
    );
    expect(screen.getByText("3 ready · 2 skip")).toBeTruthy();
  });
});
