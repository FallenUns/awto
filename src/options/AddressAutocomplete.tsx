import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { searchAddresses, type AddressResult } from "./geocoder";

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (result: AddressResult) => void;
  id?: string;
  _search?: typeof searchAddresses;
}

const DEBOUNCE_MS = 500;
const MIN_QUERY = 3;

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  id,
  _search = searchAddresses,
}: AddressAutocompleteProps) {
  const [results, setResults] = useState<AddressResult[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listboxId = id ? `${id}-listbox` : "address-autocomplete-listbox";

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
  }, []);

  function handleChange(next: string) {
    onChange(next);
    setHighlight(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();

    if (next.trim().length < MIN_QUERY) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const ctl = new AbortController();
      abortRef.current = ctl;
      setLoading(true);
      void _search(next, { signal: ctl.signal })
        .then((r) => {
          if (ctl.signal.aborted) return;
          setResults(r);
          setOpen(r.length > 0);
          setLoading(false);
        })
        .catch((err) => {
          if (err instanceof Error && err.name === "AbortError") return;
          setLoading(false);
        });
    }, DEBOUNCE_MS);
  }

  function selectAt(index: number) {
    const r = results[index];
    if (!r) return;
    onSelect(r);
    setOpen(false);
    setResults([]);
    setHighlight(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length === 0) return;
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (open && highlight >= 0) {
        e.preventDefault();
        selectAt(highlight);
      } else if (open && results.length > 0) {
        e.preventDefault();
        selectAt(0);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="awto-address-autocomplete">
      <div className="awto-address-autocomplete__input-wrap">
        <input
          id={id}
          type="text"
          className="awto-input"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={
            highlight >= 0 ? `${listboxId}-${highlight}` : undefined
          }
          autoComplete="off"
        />
        {loading && (
          <Loader2
            size={16}
            strokeWidth={1.5}
            className="awto-address-autocomplete__spinner awto-spin"
            aria-hidden="true"
          />
        )}
      </div>
      {open && results.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="awto-address-autocomplete__list"
        >
          {results.map((r, i) => (
            <li
              id={`${listboxId}-${i}`}
              key={`${r.displayName}-${i}`}
              role="option"
              aria-selected={i === highlight}
              className={`awto-address-autocomplete__item ${i === highlight ? "is-highlighted" : ""}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                selectAt(i);
              }}
              onClick={() => selectAt(i)}
            >
              {r.displayName}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
