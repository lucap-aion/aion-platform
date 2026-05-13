import { useEffect, useRef, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ArrowUp, ChevronDown, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type ChartSpec = {
  type: "bar" | "line" | "pie";
  x_key: string;
  y_keys: string[];
  title?: string;
};

type AssistantMessage = {
  role: "assistant";
  summary: string;
  sql: string | null;
  columns: string[];
  rows: Record<string, unknown>[];
  chart: ChartSpec | null;
};

type Message =
  | { role: "user"; content: string }
  | AssistantMessage;

const SUGGESTIONS = [
  "How many customers signed up in the last 30 days, by brand?",
  "Top 10 products by number of active covers.",
  "Open claims grouped by brand and claim type.",
  "Monthly new policies for the last 12 months.",
  "Average satisfaction rate per brand from feedback.",
];

const CHART_COLORS = ["#B8860B", "#2A7B5B", "#5B7FA5", "#C45A3C", "#8B6DAE", "#A0A0A0"];

const toNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return null;
};

const formatCell = (v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
};

const AdminAIQuery = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const send = async (question: string) => {
    const text = question.trim();
    if (!text || loading) return;
    setInput("");

    const history = messages.map((m) =>
      m.role === "user"
        ? { role: "user", content: m.content }
        : { role: "assistant", content: m.summary },
    );

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("query-ai", {
        body: { question: text, history },
      });
      if (error) throw error;
      if (!data || data.error) throw new Error(data?.error ?? "Unknown error");

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          summary: data.summary ?? "",
          sql: data.sql ?? null,
          columns: data.columns ?? [],
          rows: data.rows ?? [],
          chart: data.chart ?? null,
        },
      ]);
    } catch (err: any) {
      toast.error(err?.message ?? "Query failed");
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          summary: `I couldn't answer that — ${err?.message ?? "unknown error"}.`,
          sql: null,
          columns: [],
          rows: [],
          chart: null,
        },
      ]);
    } finally {
      setLoading(false);
      taRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Ask the data</h1>
            <p className="text-xs text-muted-foreground">
              Natural-language questions across the AION database. Read-only.
            </p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <EmptyState onPick={(q) => send(q)} />
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-6">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <UserBubble key={i} text={m.content} />
              ) : (
                <AssistantBlock key={i} message={m} />
              ),
            )}
            {loading && <ThinkingBubble />}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border bg-background px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-end gap-2">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask anything about the data…"
            rows={1}
            disabled={loading}
            className="flex-1 resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
            style={{ maxHeight: 160 }}
          />
          <button
            type="button"
            onClick={() => void send(input)}
            disabled={loading || !input.trim()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            aria-label="Send"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
        <p className="mx-auto mt-2 max-w-4xl text-center text-[11px] text-muted-foreground/60">
          Results are capped at 1000 rows. The assistant can occasionally get SQL wrong — verify before acting.
        </p>
      </div>
    </div>
  );
};

// ─── Sub-components ──────────────────────────────────────────────────────────

const EmptyState = ({ onPick }: { onPick: (q: string) => void }) => (
  <div className="mx-auto flex max-w-2xl flex-col items-center pt-16 text-center">
    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
      <Sparkles className="h-6 w-6 text-primary" />
    </div>
    <h2 className="text-xl font-semibold text-foreground">Ask anything</h2>
    <p className="mt-1 text-sm text-muted-foreground">
      The assistant writes read-only SQL and answers with a summary, table and chart.
    </p>
    <div className="mt-8 grid w-full grid-cols-1 gap-2 text-left sm:grid-cols-2">
      {SUGGESTIONS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground transition-colors hover:border-primary/40 hover:bg-muted"
        >
          {s}
        </button>
      ))}
    </div>
  </div>
);

const UserBubble = ({ text }: { text: string }) => (
  <div className="flex justify-end">
    <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-primary px-4 py-2.5 text-sm text-primary-foreground whitespace-pre-wrap">
      {text}
    </div>
  </div>
);

const ThinkingBubble = () => (
  <div className="flex items-center gap-2 text-sm text-muted-foreground">
    <Loader2 className="h-4 w-4 animate-spin" />
    <span>Querying the database…</span>
  </div>
);

const AssistantBlock = ({ message }: { message: AssistantMessage }) => {
  const { summary, sql, columns, rows, chart } = message;
  return (
    <div className="flex flex-col gap-4">
      {summary && (
        <div className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
          {summary}
        </div>
      )}

      {chart && rows.length >= 2 && <ChartView spec={chart} rows={rows} />}

      {columns.length > 0 && rows.length > 0 && (
        <ResultsTable columns={columns} rows={rows} />
      )}

      {sql && <SqlBlock sql={sql} />}
    </div>
  );
};

const ResultsTable = ({
  columns,
  rows,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
}) => {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 25);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {rows.length.toLocaleString()} {rows.length === 1 ? "row" : "rows"}
        </span>
        {rows.length > 25 && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-xs text-primary hover:underline"
          >
            {expanded ? "Show first 25" : `Show all ${rows.length}`}
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              {columns.map((c) => (
                <th
                  key={c}
                  className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                {columns.map((c) => (
                  <td key={c} className="px-4 py-2 text-foreground tabular-nums">
                    {formatCell(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SqlBlock = ({ sql }: { sql: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <span className="flex items-center gap-1.5">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          SQL used
        </span>
      </button>
      {open && (
        <pre className="overflow-x-auto border-t border-border bg-background/60 px-4 py-3 text-xs text-foreground/90">
          <code>{sql}</code>
        </pre>
      )}
    </div>
  );
};

const ChartView = ({
  spec,
  rows,
}: {
  spec: ChartSpec;
  rows: Record<string, unknown>[];
}) => {
  // Coerce numerics
  const data = rows.map((r) => {
    const out: Record<string, unknown> = { ...r };
    spec.y_keys.forEach((k) => {
      out[k] = toNumber(r[k]) ?? 0;
    });
    return out;
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {spec.title && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {spec.title}
        </p>
      )}
      <ResponsiveContainer width="100%" height={280}>
        {spec.type === "line" ? (
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={spec.x_key} fontSize={11} stroke="hsl(var(--muted-foreground))" />
            <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
            <Tooltip />
            {spec.y_keys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {spec.y_keys.map((k, i) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        ) : spec.type === "pie" ? (
          <PieChart>
            <Pie
              data={data}
              dataKey={spec.y_keys[0]}
              nameKey={spec.x_key}
              outerRadius={100}
              label={(e: any) => String(e[spec.x_key] ?? "")}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={spec.x_key} fontSize={11} stroke="hsl(var(--muted-foreground))" />
            <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
            <Tooltip />
            {spec.y_keys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {spec.y_keys.map((k, i) => (
              <Bar key={k} dataKey={k} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
};

export default AdminAIQuery;
