import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AddressAutocomplete } from "./AddressAutocomplete";
import type { AddressResult } from "./geocoder";

const sampleResult: AddressResult = {
  displayName: "206 La Trobe Street, Melbourne, VIC 3000, Australia",
  addressLine1: "206 La Trobe Street",
  suburb: "Melbourne",
  city: "Melbourne",
  state: "Victoria",
  postcode: "3000",
  country: "Australia",
  raw: {},
};

describe("AddressAutocomplete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("does not call _search for queries under 3 chars", () => {
    const search = vi.fn();
    render(
      <AddressAutocomplete
        value=""
        onChange={() => {}}
        onSelect={() => {}}
        _search={search}
      />
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "ab" } });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(search).not.toHaveBeenCalled();
  });

  it("debounces and calls _search once per typing burst", () => {
    const search = vi.fn().mockResolvedValue([]);
    render(
      <AddressAutocomplete
        value=""
        onChange={() => {}}
        onSelect={() => {}}
        _search={search}
      />
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "206 L" } });
    fireEvent.change(input, { target: { value: "206 La" } });
    fireEvent.change(input, { target: { value: "206 La T" } });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("206 La T", expect.objectContaining({ signal: expect.anything() }));
  });

  it("renders results in the dropdown and selects on click", async () => {
    const search = vi.fn().mockResolvedValue([sampleResult]);
    const onSelect = vi.fn();
    render(
      <AddressAutocomplete
        value=""
        onChange={() => {}}
        onSelect={onSelect}
        _search={search}
      />
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "206 la" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const option = screen.getByRole("option", { name: /206 La Trobe Street/i });
    act(() => {
      fireEvent.click(option);
    });
    expect(onSelect).toHaveBeenCalledWith(sampleResult);
  });

  it("ArrowDown highlights first option, Enter selects it", async () => {
    const search = vi.fn().mockResolvedValue([sampleResult]);
    const onSelect = vi.fn();
    render(
      <AddressAutocomplete
        value=""
        onChange={() => {}}
        onSelect={onSelect}
        _search={search}
      />
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "206 la" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    act(() => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(onSelect).toHaveBeenCalledWith(sampleResult);
  });

  it("Escape closes the dropdown", async () => {
    const search = vi.fn().mockResolvedValue([sampleResult]);
    render(
      <AddressAutocomplete
        value=""
        onChange={() => {}}
        onSelect={() => {}}
        _search={search}
      />
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "206 la" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByRole("listbox")).toBeTruthy();
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
