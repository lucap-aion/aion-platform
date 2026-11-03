// A textarea that knows the team: type "@" and pick a colleague, and the
// message carries "@Full Name" — which mentionsIn() later reads back into the
// list of people to notify. Cmd/Ctrl+Enter sends.
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Colleague } from "@/lib/team";

type Props = {
  value: string;
  onChange: (v: string) => void;
  colleagues: Colleague[];
  onSubmit?: () => void;
  placeholder?: string;
  rows?: number;
  id?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Open the colleague list upward — for a reply box pinned to the bottom of the screen. */
  dropUp?: boolean;
};

// "@lu" right before the caret, at the start or after a space.
const TRIGGER = /(^|\s)@([^\s@]{0,30})$/;

export default function MentionTextarea({ value, onChange, colleagues, onSubmit, placeholder, rows = 3, id, autoFocus, disabled, dropUp }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  // Where the caret goes once the picked name is in the text. Applied right
  // after React commits the new value: done in a requestAnimationFrame instead,
  // the first letters typed after a pick landed at the END of the message
  // ("Perfetto, @Luca Pontone a prova di risposta.questa è l").
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pendingCaret.current !== null) {
      el.focus();
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return colleagues
      .filter((c) => !q || c.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || c.email.toLowerCase().startsWith(q))
      .slice(0, 6);
  }, [query, colleagues]);

  const readTrigger = (text: string, caret: number) => {
    const m = text.slice(0, caret).match(TRIGGER);
    setQuery(m ? m[2] : null);
    setActive(0);
  };

  const pick = (c: Colleague) => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(TRIGGER, (_all, lead: string) => `${lead}@${c.name} `);
    pendingCaret.current = before.length;
    onChange(before + value.slice(caret));
    setQuery(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (query !== null && matches.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(matches[active]); return; }
      if (e.key === "Escape") { e.preventDefault(); setQuery(null); return; }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) { e.preventDefault(); onSubmit(); }
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); readTrigger(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
        onKeyDown={onKeyDown}
        onClick={(e) => readTrigger(value, (e.target as HTMLTextAreaElement).selectionStart ?? value.length)}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 disabled:opacity-60"
      />
      {query !== null && matches.length > 0 && (
        <ul
          role="listbox"
          className={`absolute left-2 right-2 z-50 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg ${dropUp ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
          {matches.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(c); }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${i === active ? "bg-muted" : ""}`}
              >
                <Avatar initials={c.initials} />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{c.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{c.email}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Avatar({ initials, size = "sm" }: { initials: string; size?: "sm" | "md" }) {
  const cls = size === "md" ? "h-8 w-8 text-xs" : "h-6 w-6 text-[10px]";
  return (
    <span className={`flex ${cls} shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary`}>
      {initials}
    </span>
  );
}

/** A message body with its "@Full Name" mentions picked out. Plain text otherwise — never HTML. */
export function MessageBody({ body, colleagues }: { body: string; colleagues: Colleague[] }) {
  const names = [...colleagues].map((c) => c.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return <span className="whitespace-pre-wrap">{body}</span>;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(@(?:${names.map(esc).join("|")}))`, "gi");
  const parts: ReactNode[] = body.split(re).map((p, i) =>
    i % 2 === 1
      ? <span key={i} className="rounded bg-primary/10 px-1 font-medium text-primary">{p}</span>
      : <Fragment key={i}>{p}</Fragment>,
  );
  return <span className="whitespace-pre-wrap">{parts}</span>;
}
