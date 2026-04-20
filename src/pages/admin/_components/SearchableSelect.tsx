import { useState, useRef, useEffect } from "react";
import { ChevronDown, Search } from "lucide-react";

export interface SelectOption {
  value: string | number;
  label: string;
}

interface SearchableSelectProps {
  value: string | number | null | undefined;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  clearable?: boolean;
}

const base = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:bg-muted disabled:cursor-not-allowed";

export const SearchableSelect = ({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
  required,
  clearable = true,
}: SearchableSelectProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => String(o.value) === String(value ?? ""));
  const sorted = [...options].sort((a, b) => a.label.localeCompare(b.label));
  const filtered = sorted.filter((o) =>
    o.label.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  if (disabled) {
    return (
      <input
        disabled
        className={`${base} cursor-not-allowed bg-muted`}
        value={selected?.label ?? ""}
      />
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={`${base} flex items-center justify-between text-left ${!selected ? "text-muted-foreground" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate flex-1">{selected?.label ?? placeholder}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-card shadow-xl">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="max-h-52 overflow-y-auto">
            {clearable && !required && (
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted transition-colors italic"
                onClick={() => { onChange(""); setOpen(false); setQuery(""); }}
              >
                {placeholder}
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground text-center">No results</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                    String(o.value) === String(value ?? "")
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-foreground"
                  }`}
                  onClick={() => { onChange(String(o.value)); setOpen(false); setQuery(""); }}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
