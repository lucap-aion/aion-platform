import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowUp, ChevronDown, ChevronRight, Loader2, MessageSquarePlus,
  Sparkles, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

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
  streaming: boolean;
};

type Message =
  | { role: "user"; content: string }
  | AssistantMessage;

type ChatSummary = {
  id: string;
  title: string;
  updated_at: string;
};

const SUGGESTIONS = [
  "How many customers signed up in the last 30 days, by brand?",
  "Top 10 products by number of active covers.",
  "Open claims grouped by brand and claim type.",
  "Monthly new policies for the last 12 months.",
  "Average satisfaction rate per brand from feedback.",
];

const CHART_COLORS = ["#B8860B", "#2A7B5B", "#5B7FA5", "#C45A3C", "#8B6DAE", "#A0A0A0"];

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

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

const titleFromQuestion = (q: string) => {
  const t = q.trim().replace(/\s+/g, " ");
  return t.length > 60 ? t.slice(0, 57) + "…" : t || "New chat";
};

const formatRelative = (iso: string) => {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
};

const AdminAIQuery = () => {
  const { adminRecord } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlChatId = searchParams.get("chat");

  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(urlChatId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Keep a ref so the stream callback can persist the latest messages without
  // closure staleness.
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;

  // ── Load chat list ─────────────────────────────────────────────────────────
  const refreshChatList = useCallback(async () => {
    if (!adminRecord?.id) return;
    const { data, error } = await supabase
      .from("ai_chats")
      .select("id, title, updated_at")
      .eq("admin_id", adminRecord.id)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) {
      console.error("[ai-chats list]", error);
      return;
    }
    setChats(data ?? []);
  }, [adminRecord?.id]);

  useEffect(() => {
    void refreshChatList();
  }, [refreshChatList]);

  // ── Load a specific chat ───────────────────────────────────────────────────
  const loadChat = useCallback(async (id: string) => {
    setChatLoading(true);
    const { data, error } = await supabase
      .from("ai_chats")
      .select("id, messages")
      .eq("id", id)
      .maybeSingle();
    setChatLoading(false);
    if (error || !data) {
      toast.error("Couldn't load chat");
      return;
    }
    setChatId(data.id);
    setMessages((data.messages as Message[]) ?? []);
  }, []);

  // React to ?chat= URL changes (deep links, back/forward)
  useEffect(() => {
    if (urlChatId && urlChatId !== chatId) {
      void loadChat(urlChatId);
    } else if (!urlChatId && chatId) {
      setChatId(null);
      setMessages([]);
    }
  }, [urlChatId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll messages ───────────────────────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // ── Persistence helpers ────────────────────────────────────────────────────
  const persistChat = useCallback(
    async (msgs: Message[], existingId: string | null, firstUserMsg: string) => {
      if (!adminRecord?.id) return existingId;
      const payload = {
        admin_id: adminRecord.id,
        user_id: adminRecord.user_id ?? "",
        title: titleFromQuestion(firstUserMsg),
        messages: msgs as unknown as any,
      };
      if (existingId) {
        const { error } = await supabase
          .from("ai_chats")
          .update({ messages: msgs as unknown as any })
          .eq("id", existingId);
        if (error) {
          console.error("[ai-chats update]", error);
          toast.error("Couldn't save chat");
        }
        return existingId;
      }
      const { data, error } = await supabase
        .from("ai_chats")
        .insert(payload)
        .select("id")
        .single();
      if (error || !data) {
        console.error("[ai-chats insert]", error);
        toast.error("Couldn't save chat");
        return null;
      }
      return data.id;
    },
    [adminRecord?.id, adminRecord?.user_id],
  );

  // ── New chat / select chat ─────────────────────────────────────────────────
  const startNewChat = () => {
    setChatId(null);
    setMessages([]);
    setSearchParams({}, { replace: true });
    taRef.current?.focus();
  };

  const selectChat = (id: string) => {
    if (id === chatId) return;
    setSearchParams({ chat: id }, { replace: false });
  };

  const deleteChat = async (id: string) => {
    const { error } = await supabase.from("ai_chats").delete().eq("id", id);
    if (error) {
      toast.error("Couldn't delete chat");
      return;
    }
    setChats((cs) => cs.filter((c) => c.id !== id));
    if (chatId === id) startNewChat();
  };

  // ── Send a question ────────────────────────────────────────────────────────
  const send = async (question: string) => {
    const text = question.trim();
    if (!text || loading) return;
    setInput("");

    const priorHistory = messages.map((m) =>
      m.role === "user"
        ? { role: "user", content: m.content }
        : { role: "assistant", content: m.summary },
    );

    const seedMessages: Message[] = [
      ...messages,
      { role: "user", content: text },
      {
        role: "assistant",
        summary: "",
        sql: null,
        columns: [],
        rows: [],
        chart: null,
        streaming: true,
      },
    ];
    setMessages(seedMessages);
    setLoading(true);

    const patch = (fn: (m: AssistantMessage) => AssistantMessage) =>
      setMessages((prev) => {
        const out = [...prev];
        for (let i = out.length - 1; i >= 0; i--) {
          if (out[i].role === "assistant") {
            out[i] = fn(out[i] as AssistantMessage);
            break;
          }
        }
        return out;
      });

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Not signed in");

      const res = await fetch(`${SUPABASE_URL}/functions/v1/query-ai`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "apikey": SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
        },
        body: JSON.stringify({ question: text, history: priorHistory }),
      });

      if (!res.ok || !res.body) {
        const errBody = await res.text().catch(() => "");
        let msg = `Request failed (${res.status})`;
        try {
          const parsed = JSON.parse(errBody);
          if (parsed?.error) msg = parsed.error;
        } catch { /* ignore */ }
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const { event, data } = parseSse(frame);
          if (!event) continue;
          handleEvent(event, data, patch);
        }
      }
    } catch (err: any) {
      const msg = err?.message ?? "Query failed";
      toast.error(msg);
      patch((m) => ({
        ...m,
        summary: m.summary || `I couldn't answer that — ${msg}.`,
        streaming: false,
      }));
    } finally {
      patch((m) => ({ ...m, streaming: false }));
      setLoading(false);
      taRef.current?.focus();

      // Persist the completed turn. messagesRef has the latest state.
      const firstUser = (messagesRef.current.find((m) => m.role === "user") as
        | { role: "user"; content: string }
        | undefined)?.content ?? text;
      const newId = await persistChat(messagesRef.current, chatId, firstUser);
      if (newId && newId !== chatId) {
        setChatId(newId);
        setSearchParams({ chat: newId }, { replace: true });
      }
      void refreshChatList();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full">
      {/* Left rail */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card/40 md:flex">
        <div className="border-b border-border p-3">
          <button
            type="button"
            onClick={startNewChat}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <MessageSquarePlus className="h-4 w-4" />
            New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {chats.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              No chats yet
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {chats.map((c) => (
                <li key={c.id}>
                  <ChatRailItem
                    chat={c}
                    active={c.id === chatId}
                    onSelect={() => selectChat(c.id)}
                    onDelete={() => deleteChat(c.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Main chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
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

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
          {chatLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading chat…
            </div>
          ) : messages.length === 0 ? (
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
            </div>
          )}
        </div>

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
    </div>
  );
};

// ─── SSE helpers ─────────────────────────────────────────────────────────────

function parseSse(frame: string): { event: string | null; data: any } {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!event) return { event: null, data: null };
  const raw = dataLines.join("\n");
  try {
    return { event, data: raw ? JSON.parse(raw) : null };
  } catch {
    return { event, data: raw };
  }
}

function handleEvent(
  event: string,
  data: any,
  patch: (fn: (m: AssistantMessage) => AssistantMessage) => void,
) {
  if (event === "turn_start") {
    patch((m) => ({ ...m, summary: "" }));
  } else if (event === "text_delta") {
    patch((m) => ({ ...m, summary: m.summary + (data?.text ?? "") }));
  } else if (event === "sql_result") {
    patch((m) => ({
      ...m,
      sql: data?.sql ?? m.sql,
      columns: data?.columns ?? [],
      rows: data?.rows ?? [],
    }));
  } else if (event === "chart") {
    patch((m) => ({ ...m, chart: data as ChartSpec }));
  } else if (event === "done") {
    patch((m) => ({ ...m, streaming: false, sql: data?.sql ?? m.sql }));
  } else if (event === "error") {
    const msg = data?.message ?? "Unknown error";
    toast.error(msg);
    patch((m) => ({
      ...m,
      summary: m.summary || `I couldn't answer that — ${msg}.`,
      streaming: false,
    }));
  }
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const ChatRailItem = ({
  chat,
  active,
  onSelect,
  onDelete,
}: {
  chat: ChatSummary;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) => (
  <div
    onClick={onSelect}
    className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors ${
      active
        ? "bg-primary/10 text-primary"
        : "text-foreground hover:bg-muted"
    }`}
  >
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-sm font-medium">{chat.title}</span>
      <span className="text-[11px] text-muted-foreground">
        {formatRelative(chat.updated_at)}
      </span>
    </div>
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
      className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
      aria-label="Delete chat"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  </div>
);

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

const AssistantBlock = ({ message }: { message: AssistantMessage }) => {
  const { summary, sql, columns, rows, chart, streaming } = message;
  const hasAnything = summary || rows.length > 0 || chart || sql;

  if (!hasAnything && streaming) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Querying the database…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {(summary || streaming) && (
        <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-a:text-primary prose-code:text-foreground prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-table:text-xs prose-th:bg-muted/40">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
          {streaming && !summary && (
            <span className="inline-block h-3 w-1.5 animate-pulse bg-foreground/40 align-middle" />
          )}
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
