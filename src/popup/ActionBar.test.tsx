import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActionBar } from "./ActionBar";

describe("ActionBar", () => {
  it("renders Cancel and Fill buttons", () => {
    render(
      <ActionBar
        filling={false}
        fillDisabled={false}
        fillCount={3}
        onCancel={vi.fn()}
        onFill={vi.fn()}
      />
    );
    expect(screen.getByText("Cancel")).toBeTruthy();
    expect(screen.getByText(/fill 3 fields/i)).toBeTruthy();
  });

  it("shows 'Fill 1 field' with singular form when fillCount is 1", () => {
    render(
      <ActionBar
        filling={false}
        fillDisabled={false}
        fillCount={1}
        onCancel={vi.fn()}
        onFill={vi.fn()}
      />
    );
    expect(screen.getByText("Fill 1 field")).toBeTruthy();
  });

  it("shows 'Fill X fields' with plural form when fillCount > 1", () => {
    render(
      <ActionBar
        filling={false}
        fillDisabled={false}
        fillCount={5}
        onCancel={vi.fn()}
        onFill={vi.fn()}
      />
    );
    expect(screen.getByText("Fill 5 fields")).toBeTruthy();
  });

  it("disables Fill button when fillDisabled is true", () => {
    render(
      <ActionBar
        filling={false}
        fillDisabled={true}
        fillCount={3}
        onCancel={vi.fn()}
        onFill={vi.fn()}
      />
    );
    const fillButton = screen.getByText(/fill 3 fields/i)
      .closest("button") as HTMLButtonElement;
    expect(fillButton.disabled).toBe(true);
  });

  it("disables Fill button when filling is true", () => {
    render(
      <ActionBar
        filling={true}
        fillDisabled={false}
        fillCount={3}
        onCancel={vi.fn()}
        onFill={vi.fn()}
      />
    );
    const fillButton = document.querySelector(
      ".awto-actionbar__fill"
    ) as HTMLButtonElement;
    expect(fillButton.disabled).toBe(true);
  });

  it("disables Cancel button when filling is true", () => {
    render(
      <ActionBar
        filling={true}
        fillDisabled={false}
        fillCount={3}
        onCancel={vi.fn()}
        onFill={vi.fn()}
      />
    );
    const cancelButton = screen.getByText("Cancel") as HTMLButtonElement;
    expect(cancelButton.disabled).toBe(true);
  });

  it("shows 'Filling…' text with spinner when filling is true", () => {
    render(
      <ActionBar
        filling={true}
        fillDisabled={false}
        fillCount={3}
        onCancel={vi.fn()}
        onFill={vi.fn()}
      />
    );
    expect(screen.getByText("Filling…")).toBeTruthy();
    const spinner = document.querySelector(
      ".awto-actionbar__fill .awto-spin"
    );
    expect(spinner).toBeTruthy();
  });

  it("calls onCancel when Cancel button clicked", () => {
    const onCancel = vi.fn();
    render(
      <ActionBar
        filling={false}
        fillDisabled={false}
        fillCount={3}
        onCancel={onCancel}
        onFill={vi.fn()}
      />
    );
    const cancelButton = screen.getByText("Cancel");
    fireEvent.click(cancelButton);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onFill when Fill button clicked", () => {
    const onFill = vi.fn();
    render(
      <ActionBar
        filling={false}
        fillDisabled={false}
        fillCount={3}
        onCancel={vi.fn()}
        onFill={onFill}
      />
    );
    const fillButton = screen.getByText(/fill 3 fields/i)
      .closest("button") as HTMLButtonElement;
    fireEvent.click(fillButton);
    expect(onFill).toHaveBeenCalledOnce();
  });

  it("does not call onCancel when Cancel button clicked during filling", () => {
    const onCancel = vi.fn();
    render(
      <ActionBar
        filling={true}
        fillDisabled={false}
        fillCount={3}
        onCancel={onCancel}
        onFill={vi.fn()}
      />
    );
    const cancelButton = screen.getByText("Cancel") as HTMLButtonElement;
    expect(cancelButton.disabled).toBe(true);
    fireEvent.click(cancelButton);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("does not call onFill when Fill button clicked while filling", () => {
    const onFill = vi.fn();
    render(
      <ActionBar
        filling={true}
        fillDisabled={false}
        fillCount={3}
        onCancel={vi.fn()}
        onFill={onFill}
      />
    );
    const fillButton = document.querySelector(
      ".awto-actionbar__fill"
    ) as HTMLButtonElement;
    expect(fillButton.disabled).toBe(true);
    fireEvent.click(fillButton);
    expect(onFill).not.toHaveBeenCalled();
  });

  it("disables Fill button when fillCount is 0", () => {
    render(
      <ActionBar
        filling={false}
        fillDisabled={true}
        fillCount={0}
        onCancel={vi.fn()}
        onFill={vi.fn()}
      />
    );
    const fillButton = document.querySelector(
      ".awto-actionbar__fill"
    ) as HTMLButtonElement;
    expect(fillButton.disabled).toBe(true);
  });
});
