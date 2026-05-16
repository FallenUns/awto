import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FieldRow } from "./FieldRow";

describe("FieldRow", () => {
  it("renders a fill row with status check icon and the resolved value", () => {
    render(
      <FieldRow
        kind="fill"
        fieldId={0}
        label="First name"
        value="Patrick"
        confidence={0.95}
      />
    );
    expect(screen.getByText("First name")).toBeTruthy();
    expect(screen.getByText("Patrick")).toBeTruthy();
    expect(document.querySelector(".awto-fieldrow--fill")).toBeTruthy();
  });

  it("renders a missing row with an input bound to onChangeValue", () => {
    const onChange = vi.fn();
    render(
      <FieldRow
        kind="missing"
        fieldId={1}
        label="Phone"
        value=""
        promptText="What's your phone?"
        onChangeValue={onChange}
      />
    );
    const input = screen.getByPlaceholderText(/phone/i);
    fireEvent.change(input, { target: { value: "0400" } });
    expect(onChange).toHaveBeenCalledWith("0400");
  });

  it("renders a skip row with reason in muted text", () => {
    render(
      <FieldRow
        kind="skip"
        fieldId={2}
        label="CAPTCHA"
        reason="Not safe to autofill"
      />
    );
    expect(screen.getByText(/not safe to autofill/i)).toBeTruthy();
  });

  it("renders a loading row with shimmer placeholder", () => {
    render(<FieldRow kind="loading" fieldId={3} label="Loading…" />);
    expect(document.querySelector(".awto-shimmer")).toBeTruthy();
  });

  it("shows the amber confidence dot when confidence < 0.85", () => {
    render(
      <FieldRow
        kind="fill"
        fieldId={0}
        label="Title"
        value="Mr"
        confidence={0.6}
      />
    );
    expect(document.querySelector(".awto-confidence-dot")).toBeTruthy();
  });
});
