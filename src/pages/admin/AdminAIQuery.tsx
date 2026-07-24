import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowUp, WandSparkles, Check, ChevronDown, ChevronRight, Download, FileSpreadsheet,
  Loader2, MessageSquarePlus, Search, Sparkles, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ChartSpec = {
  type: "bar" | "line" | "pie";
  x_key: string;
  y_keys: string[];
  title?: string;
};

type ReportFile = {
  brand_id: number;
  brand_name: string;
  filename: string;
  url: string;
  row_count: number;
  // Monthly reports emit year + month; daily reports emit date (YYYY-MM-DD).
  year?: number;
  month?: number;
  date?: string;
  kind?: string;
};

type SqlStep = { label: string; rowCount: number };

type AssistantMessage = {
  role: "assistant";
  summary: string;
  sql: string | null;
  columns: string[];
  rows: Record<string, unknown>[];
  chart: ChartSpec | null;
  reports: ReportFile[];
  sqlSteps: SqlStep[];
  streaming: boolean;
};

type Message =
  | { role: "user"; content: string; display?: string }
  | AssistantMessage;

type ChatSummary = {
  id: string;
  title: string;
  updated_at: string;
};

const PLAYBOOK_KEYS = [
  "aiQuery.playbook.customer360",
  "aiQuery.playbook.productAnalysis",
];

const SUGGESTION_KEYS = [
  "aiQuery.suggestion.1",
  "aiQuery.suggestion.2",
  "aiQuery.suggestion.3",
  "aiQuery.suggestion.4",
  "aiQuery.suggestion.5",
];

// Brand users only see their own brand, so they get brand-scoped suggestions
// (no cross-brand "by brand" / "per brand" framing).
const BRAND_SUGGESTION_KEYS = [
  "aiQuery.suggestion.brand.1",
  "aiQuery.suggestion.brand.2",
  "aiQuery.suggestion.brand.3",
  "aiQuery.suggestion.brand.4",
  "aiQuery.suggestion.brand.5",
];

const REPORT_KEYS = [
  "aiQuery.report.monthlyInternal",
  "aiQuery.report.monthlyInternalPrevious",
  "aiQuery.report.dailyNewPolicies",
  "aiQuery.report.dailyCancelledPolicies",
  "aiQuery.report.dailyClaims",
];

const CHART_COLORS = ["#B8860B", "#2A7B5B", "#5B7FA5", "#C45A3C", "#8B6DAE", "#A0A0A0"];

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const toNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return null;
};

const humanizeColumn = (col: string): string =>
  col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Turn a SQL string into a translation key for a short, store-manager-
// friendly step label. The component resolves the key via useLanguage(),
// so the indicator reads in the user's locale.
const summarizeSql = (sql: string): string => {
  const s = sql.toLowerCase();
  const hasFrom = (table: string) =>
    s.includes(`from ${table}`) || s.includes(`from public.${table}`);

  if (hasFrom("profiles") && (s.includes("ilike") || s.includes("p.id::text"))) {
    return "aiQuery.step.lookingUpCustomer";
  }
  if (hasFrom("catalogues") && s.includes("not in")) {
    return "aiQuery.step.pickingSuggestions";
  }
  if (hasFrom("policies") && s.includes("customer_id")) {
    if (s.includes("filter (where status='live')") || s.includes("sum(selling_price)")) {
      return "aiQuery.step.addingSpend";
    }
    return "aiQuery.step.pullingOrders";
  }
  if (hasFrom("claims")) return "aiQuery.step.checkingClaims";
  if (hasFrom("feedback")) return "aiQuery.step.readingFeedback";
  if (hasFrom("support_messages")) return "aiQuery.step.checkingSupport";
  if (hasFrom("catalogues") && (s.includes("buyers") || s.includes("co_owned"))) {
    return "aiQuery.step.findingSimilar";
  }
  if (hasFrom("catalogues")) return "aiQuery.step.lookingUpProduct";
  if (hasFrom("policies") && s.includes("item_id =")) return "aiQuery.step.whoBoughtThis";
  if (hasFrom("brands")) return "aiQuery.step.loadingBrand";
  return "aiQuery.step.crunching";
};

// ─── Cell formatting ─────────────────────────────────────────────────────────
// Recognise common Postgres/Supabase return shapes and present them politely.

const ISO_MONTH = /^\d{4}-\d{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bcp47 = (l: string) => (l === "it" ? "it-IT" : "en-GB");

const isIdColumn = (col: string) =>
  /(^|_)id$/i.test(col) || /(^|_)ids$/i.test(col) || col === "id";
const isCurrencyColumn = (col: string) =>
  /(price|cost|value|fee|premium|revenue|amount|cogs|rrp|spend|paid|sales|gross|net|protected_value)/i
    .test(col);
const isPercentColumn = (col: string) =>
  /(^|_)pct(_|$)|percent|share_pct|_share$|^share_/i.test(col);
// Column names that the rich results table should render as image thumbnails
// instead of plain text. Matched in both directions (e.g. picture, avatar,
// avatar_url, product_picture). Kept narrow so a "logo_size" or
// "image_count" doesn't accidentally trigger.
const isImageColumn = (col: string) =>
  /(^|_)(picture|avatar|photo|thumbnail)(_url)?$/i.test(col) ||
  /(^|_)image_url$/i.test(col);
// Only ever called for a known image column (see DataTable), so accept ANY
// http(s) URL — product feeds often serve images from extension-less endpoints
// (e.g. .../Base/Image/154499). Truly broken URLs are hidden via <img onError>.
const looksLikeImageUrl = (v: unknown): v is string =>
  typeof v === "string" && /^https?:\/\/\S+/i.test(v.trim());

const formatNumber = (n: number, col: string, bcp: string): string => {
  if (!Number.isFinite(n)) return "—";
  if (isIdColumn(col)) return String(n);
  if (isCurrencyColumn(col)) {
    return new Intl.NumberFormat(bcp, {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
    }).format(n);
  }
  if (isPercentColumn(col)) {
    // If the value is in 0–1 range, assume it's a fraction and scale to %.
    const v = n >= -1 && n <= 1 ? n * 100 : n;
    return new Intl.NumberFormat(bcp, { maximumFractionDigits: 1 }).format(v) + "%";
  }
  const opts: Intl.NumberFormatOptions = Number.isInteger(n)
    ? { maximumFractionDigits: 0 }
    : { maximumFractionDigits: 2 };
  return new Intl.NumberFormat(bcp, opts).format(n);
};

const formatCell = (v: unknown, column: string = "", locale: string = "en"): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length === 0 ? "—" : v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);

  const col = column.toLowerCase();
  const bcp = bcp47(locale);

  if (typeof v === "string") {
    if (UUID.test(v)) return v.slice(0, 8) + "…";
    if (ISO_MONTH.test(v)) {
      const [y, m] = v.split("-").map(Number);
      return new Intl.DateTimeFormat(bcp, { month: "short", year: "numeric" })
        .format(new Date(Date.UTC(y, m - 1, 1)));
    }
    if (ISO_DATE.test(v)) {
      return new Intl.DateTimeFormat(bcp, { day: "2-digit", month: "short", year: "numeric" })
        .format(new Date(v + "T00:00:00Z"));
    }
    if (ISO_TS.test(v)) {
      return new Intl.DateTimeFormat(bcp, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(v));
    }
    if (NUMERIC_STRING.test(v)) return formatNumber(Number(v), col, bcp);
    return v;
  }

  if (typeof v === "number") return formatNumber(v, col, bcp);
  return String(v);
};

// Lightweight tick/tooltip formatter for chart values (locale + currency aware).
const formatAxis = (col: string, locale: string) => (v: any): string => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return formatNumber(n, col.toLowerCase(), bcp47(locale));
};

// ─── Export helpers (CSV / XLSX) ─────────────────────────────────────────────
// Raw values are exported (not the formatted display strings) so spreadsheets
// can re-sort/filter/sum them as numbers and dates.

const slugify = (s: string): string =>
  s.toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 50);

const exportFilename = (question: string, ext: string): string => {
  const slug = slugify(question) || "aion-query";
  const date = new Date().toISOString().slice(0, 10);
  return `${slug}-${date}.${ext}`;
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const escapeCsv = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
};

const downloadCsv = (
  columns: string[],
  rows: Record<string, unknown>[],
  filename: string,
) => {
  const header = columns.map((c) => escapeCsv(humanizeColumn(c))).join(",");
  const body = rows
    .map((r) => columns.map((c) => escapeCsv(r[c])).join(","))
    .join("\n");
  // Excel-friendly UTF-8 BOM so non-ASCII renders correctly on first open.
  const blob = new Blob(["﻿" + header + "\n" + body], {
    type: "text/csv;charset=utf-8",
  });
  downloadBlob(blob, filename);
};

const downloadXlsx = async (
  columns: string[],
  rows: Record<string, unknown>[],
  filename: string,
) => {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "AION Cover";
  wb.created = new Date();
  const ws = wb.addWorksheet("Results");
  ws.columns = columns.map((c) => ({
    header: humanizeColumn(c),
    key: c,
    width: Math.min(40, Math.max(12, humanizeColumn(c).length + 4)),
  }));
  // Coerce numeric-strings to numbers and ISO date-strings to Date so Excel
  // gets native types rather than text.
  ws.addRows(
    rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const c of columns) {
        const v = r[c];
        if (typeof v === "string") {
          if (/^-?\d+(\.\d+)?$/.test(v)) out[c] = Number(v);
          else if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) {
            const d = new Date(v.length === 10 ? v + "T00:00:00Z" : v);
            out[c] = Number.isNaN(d.getTime()) ? v : d;
          } else out[c] = v;
        } else if (Array.isArray(v) || (v && typeof v === "object")) {
          out[c] = JSON.stringify(v);
        } else {
          out[c] = v as any;
        }
      }
      return out;
    }),
  );
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: "middle" };
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  downloadBlob(blob, filename);
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

// `mode` toggles owner/storage between the admin chat table (`ai_chats`,
// keyed on admin_id) and the brand chat table (`ai_chats_brand`, keyed on
// profile_id). The brand variant also hides the admin-only Reports section
// from the empty state. Everything else — playbooks, SQL panel, exports —
// works identically for both.
export type AIQueryProps = {
  mode?: "admin" | "brand";
};

const AdminAIQuery = ({ mode = "admin" }: AIQueryProps = {}) => {
  const { adminRecord, profile, isImpersonating } = useAuth();
  const { t, locale } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlChatId = searchParams.get("chat");

  const chatsTable = mode === "brand" ? "ai_chats_brand" : "ai_chats";
  const ownerColumn = mode === "brand" ? "profile_id" : "admin_id";
  const ownerId = mode === "brand" ? profile?.id ?? null : adminRecord?.id ?? null;

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
    if (!ownerId) return;
    const { data, error } = await supabase
      .from(chatsTable as any)
      .select("id, title, updated_at")
      .eq(ownerColumn, ownerId)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) {
      console.error("[ai-chats list]", error);
      return;
    }
    setChats((data as unknown as ChatSummary[] | null) ?? []);
  }, [ownerId, chatsTable, ownerColumn]);

  useEffect(() => {
    void refreshChatList();
  }, [refreshChatList]);

  // ── Load a specific chat ───────────────────────────────────────────────────
  const loadChat = useCallback(async (id: string) => {
    setChatLoading(true);
    const { data, error } = await supabase
      .from(chatsTable as any)
      .select("id, messages")
      .eq("id", id)
      .maybeSingle();
    setChatLoading(false);
    if (error || !data) {
      toast.error(t("aiQuery.error.couldntLoad"));
      return;
    }
    const row = data as unknown as { id: string; messages: unknown };
    setChatId(row.id);
    // Older saved chats may lack the `reports` field on assistant messages;
    // default to an empty array so the new type-shape stays consistent.
    const raw = (row.messages as any[]) ?? [];
    const restored: Message[] = raw.map((m) =>
      m?.role === "assistant"
        ? ({ reports: [], sqlSteps: [], ...m } as AssistantMessage)
        : m,
    );
    setMessages(restored);
  }, [t, chatsTable]);

  // React to ?chat= URL changes (deep links, back/forward)
  useEffect(() => {
    if (urlChatId && urlChatId !== chatId) {
      void loadChat(urlChatId);
    } else if (!urlChatId && chatId) {
      setChatId(null);
      setMessages([]);
    }
  }, [urlChatId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-link auto-send: `?playbook=customer360&id=<uuid>` or
  // `?playbook=productAnalysis&id=<int>` arrives from the admin
  // customer/product drawers. Run once per playbook+id pair, then strip
  // the params so a refresh doesn't replay.
  const playbookFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ownerId) return;
    const pb = searchParams.get("playbook");
    const id = searchParams.get("id");
    const label = searchParams.get("label") ?? undefined;
    if (!pb || !id) return;
    const fireKey = `${pb}:${id}`;
    if (playbookFiredRef.current === fireKey) return;
    const forPrep = locale === "it" ? "per" : "for";
    const prompt =
      pb === "customer360"
        ? `Customer 360 brief for: ${id}`
        : pb === "productAnalysis"
          ? `Product analysis for: ${id}`
          : null;
    if (!prompt) return;
    const titleKey =
      pb === "customer360"
        ? "aiQuery.playbook.customer360.title"
        : "aiQuery.playbook.productAnalysis.title";
    const display = label ? `${t(titleKey)} ${forPrep}: ${label}` : undefined;
    playbookFiredRef.current = fireKey;
    setChatId(null);
    setMessages([]);
    setSearchParams({}, { replace: true });
    void send(prompt, display);
  }, [ownerId, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll messages ───────────────────────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // ── Persistence helpers ────────────────────────────────────────────────────
  const persistChat = useCallback(
    async (msgs: Message[], existingId: string | null, firstUserMsg: string) => {
      // While an admin is viewing-as a user, don't save chats: the session is the
      // admin's JWT but the row would be owned by the target (RLS rejects it), and
      // saving would pollute the target's chat history. The admin sees it live only.
      if (isImpersonating) return existingId;
      if (!ownerId) {
        console.warn("[ai-chats] no owner record yet — skipping save");
        return existingId;
      }

      if (existingId) {
        const { error } = await supabase
          .from(chatsTable as any)
          .update({ messages: msgs as unknown as any })
          .eq("id", existingId);
        if (error) {
          console.error("[ai-chats update]", error);
          toast.error(`${t("aiQuery.error.couldntSave")}: ${error.message}`);
        }
        return existingId;
      }

      // Fetch user_id at save time — adminRecord.user_id can be null on a
      // freshly-claimed admin row, but auth always has the real auth uid.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error(t("aiQuery.error.notSignedIn"));
        return null;
      }

      const insertRow: Record<string, unknown> = {
        [ownerColumn]: ownerId,
        user_id: user.id,
        title: titleFromQuestion(firstUserMsg),
        messages: msgs as unknown as any,
      };
      const { data, error } = await supabase
        .from(chatsTable as any)
        .insert(insertRow as any)
        .select("id")
        .single();

      if (error || !data) {
        console.error("[ai-chats insert]", error);
        toast.error(`${t("aiQuery.error.couldntSave")}: ${error?.message ?? t("aiQuery.error.unknown")}`);
        return null;
      }
      return (data as unknown as { id: string }).id;
    },
    [ownerId, chatsTable, ownerColumn, t, isImpersonating],
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
    const { error } = await supabase.from(chatsTable as any).delete().eq("id", id);
    if (error) {
      toast.error(t("aiQuery.error.couldntDelete"));
      return;
    }
    setChats((cs) => cs.filter((c) => c.id !== id));
    if (chatId === id) startNewChat();
  };

  // ── Send a question ────────────────────────────────────────────────────────
  // `display` is an optional user-facing version of `question`. When a
  // playbook is triggered we send the entity id to the model but show the
  // entity name in the chat bubble.
  const send = async (question: string, display?: string) => {
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
      { role: "user", content: text, ...(display ? { display } : {}) },
      {
        role: "assistant",
        summary: "",
        sql: null,
        columns: [],
        rows: [],
        chart: null,
        reports: [],
        sqlSteps: [],
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

      // Merged assistant: admins hit the same function brand users do, but with
      // all-brand (or view-as) scope and the analyst persona + charts + exports.
      const res = await fetch(`${SUPABASE_URL}/functions/v1/brand-assistant`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "apikey": SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
        },
        body: JSON.stringify({
          question: text,
          history: priorHistory,
          locale,
          // When viewing-as, scope the answer to the target (effective profile).
          impersonate_profile_id: isImpersonating ? profile?.id : undefined,
        }),
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
          handleEvent(event, data, patch, t);
        }
      }
    } catch (err: any) {
      const msg = err?.message ?? t("aiQuery.error.queryFailed");
      toast.error(msg);
      patch((m) => ({
        ...m,
        summary: m.summary || `${t("aiQuery.error.prefix")}${msg}.`,
        streaming: false,
      }));
    } finally {
      patch((m) => ({ ...m, streaming: false }));
      setLoading(false);
      taRef.current?.focus();

      // Persist the completed turn. messagesRef has the latest state.
      // Prefer the user-facing display (e.g. "Customer 360 brief for: Angela
      // Gemma") over the model-facing content (which carries the UUID) for
      // the chat title.
      const firstUserMsg = messagesRef.current.find((m) => m.role === "user") as
        | { role: "user"; content: string; display?: string }
        | undefined;
      const firstUser = firstUserMsg?.display ?? firstUserMsg?.content ?? text;
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
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Left rail */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card/40 md:flex">
        <div className="border-b border-border p-3">
          <button
            type="button"
            onClick={startNewChat}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <MessageSquarePlus className="h-4 w-4" />
            {t("aiQuery.newChat")}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {chats.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              {t("aiQuery.noChats")}
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
      <div className="flex min-w-0 min-h-0 flex-1 flex-col">
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">{t("aiQuery.title")}</h1>
              <p className="text-xs text-muted-foreground">
                {t("aiQuery.subtitle")}
              </p>
            </div>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
          {chatLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("aiQuery.loadingChat")}
            </div>
          ) : messages.length === 0 ? (
            <EmptyState
              onPick={(q, display) => send(q, display)}
              showReports={mode === "admin"}
              suggestionKeys={mode === "brand" ? BRAND_SUGGESTION_KEYS : SUGGESTION_KEYS}
            />
          ) : (
            <div className="mx-auto flex max-w-4xl flex-col gap-6">
              {messages.map((m, i) => {
                if (m.role === "user") return <UserBubble key={i} text={m.display ?? m.content} />;
                // Find the preceding user message — used as the export filename slug.
                let q = "aion-query";
                for (let j = i - 1; j >= 0; j--) {
                  if (messages[j].role === "user") {
                    q = (messages[j] as { content: string }).content;
                    break;
                  }
                }
                return <AssistantBlock key={i} message={m} question={q} hideSql={mode === "brand"} />;
              })}
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
              placeholder={t("aiQuery.placeholder")}
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
              aria-label={t("aiQuery.sendAria")}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
          <p className="mx-auto mt-2 max-w-4xl text-center text-[11px] text-muted-foreground/60">
            {t("aiQuery.disclaimer")}
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
  t: (k: string) => string,
) {
  if (event === "turn_start") {
    patch((m) => ({ ...m, summary: "" }));
  } else if (event === "text_delta") {
    patch((m) => ({ ...m, summary: m.summary + (data?.text ?? "") }));
  } else if (event === "sql_result") {
    const sql = data?.sql ?? "";
    const rowCount =
      typeof data?.row_count === "number"
        ? data.row_count
        : Array.isArray(data?.rows)
          ? data.rows.length
          : 0;
    const stepLabel = summarizeSql(sql);
    patch((m) => ({
      ...m,
      sql: data?.sql ?? m.sql,
      columns: data?.columns ?? [],
      rows: data?.rows ?? [],
      sqlSteps: [...(m.sqlSteps ?? []), { label: stepLabel, rowCount }],
    }));
  } else if (event === "chart") {
    patch((m) => ({ ...m, chart: data as ChartSpec }));
  } else if (event === "report_files") {
    const incoming = Array.isArray(data?.reports) ? data.reports as ReportFile[] : [];
    patch((m) => ({ ...m, reports: [...(m.reports ?? []), ...incoming] }));
  } else if (event === "done") {
    patch((m) => ({ ...m, streaming: false, sql: data?.sql ?? m.sql }));
  } else if (event === "error") {
    const msg = data?.message ?? t("aiQuery.error.unknown");
    toast.error(msg);
    patch((m) => ({
      ...m,
      summary: m.summary || `${t("aiQuery.error.prefix")}${msg}.`,
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
}) => {
  const { t } = useLanguage();
  return (
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
        aria-label={t("aiQuery.deleteChatAria")}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

const EmptyState = ({
  onPick,
  showReports = true,
  suggestionKeys = SUGGESTION_KEYS,
}: {
  onPick: (q: string, display?: string) => void;
  showReports?: boolean;
  suggestionKeys?: string[];
}) => {
  const { t } = useLanguage();
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center pt-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Sparkles className="h-6 w-6 text-primary" />
      </div>
      <h2 className="text-xl font-semibold text-foreground">{t("aiQuery.empty.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("aiQuery.empty.subtitle")}</p>

      <PlaybookPicker onPick={onPick} />

      <EmptySection
        title={t("aiQuery.section.suggestions")}
        items={suggestionKeys.map((key) => ({ key, label: t(key), icon: Sparkles }))}
        onPick={onPick}
      />

      {showReports && (
        <EmptySection
          title={t("aiQuery.section.reports")}
          items={REPORT_KEYS.map((key) => ({ key, label: t(key), icon: FileSpreadsheet }))}
          onPick={onPick}
        />
      )}
    </div>
  );
};

type SearchResult = { id: string; label: string; sub?: string };

const PlaybookPicker = ({ onPick }: { onPick: (q: string, display?: string) => void }) => {
  const { t, locale } = useLanguage();
  const forPrep = locale === "it" ? "per" : "for";
  return (
    <div className="mt-8 w-full">
      <p className="mb-2 text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {t("aiQuery.section.playbooks")}
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <PlaybookCard
          title={t("aiQuery.playbook.customer360.title")}
          placeholder={t("aiQuery.playbook.customer360.searchPlaceholder")}
          search={searchCustomers}
          onPick={(id, label) =>
            onPick(
              `Customer 360 brief for: ${id}`,
              `${t("aiQuery.playbook.customer360.title")} ${forPrep}: ${label}`,
            )
          }
        />
        <PlaybookCard
          title={t("aiQuery.playbook.productAnalysis.title")}
          placeholder={t("aiQuery.playbook.productAnalysis.searchPlaceholder")}
          search={searchProducts}
          onPick={(id, label) =>
            onPick(
              `Product analysis for: ${id}`,
              `${t("aiQuery.playbook.productAnalysis.title")} ${forPrep}: ${label}`,
            )
          }
        />
      </div>
    </div>
  );
};

const PlaybookCard = ({
  title,
  placeholder,
  search,
  onPick,
}: {
  title: string;
  placeholder: string;
  search: (q: string) => Promise<SearchResult[]>;
  onPick: (id: string, label: string) => void;
}) => {
  const { t } = useLanguage();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = window.setTimeout(async () => {
      // Capture the query at request-time so a stale slower response doesn't
      // overwrite a faster newer one.
      const queryAtCall = q;
      const rows = await search(queryAtCall);
      if (queryAtCall === q) {
        setResults(rows);
        setSearching(false);
      }
    }, 200);
    return () => window.clearTimeout(handle);
  }, [q, search]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const handlePick = (id: string, label: string) => {
    setOpen(false);
    setQ("");
    setResults([]);
    onPick(id, label);
  };

  return (
    <div
      ref={wrapRef}
      className="relative rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40"
    >
      <div className="mb-2 flex items-center gap-2">
        <WandSparkles className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-sm font-medium text-foreground">{title}</span>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full rounded-md border border-border bg-background py-2 pl-7 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {searching ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {t("aiQuery.playbook.searching")}
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {t("aiQuery.playbook.noResults")}
            </div>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => handlePick(r.id, r.label)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
              >
                <div className="text-foreground">{r.label}</div>
                {r.sub && <div className="text-xs text-muted-foreground">{r.sub}</div>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const escapeIlike = (s: string) =>
  s.replace(/[\\%_,()]/g, (c) => `\\${c}`);

// Split the user input on whitespace so a multi-token query like
// "Angela G" matches a row where the tokens live in different columns
// (e.g. first_name='Angela', last_name='Gemma'). PostgREST chains
// multiple .or() calls with AND between groups.
const tokenize = (s: string): string[] =>
  s.trim().split(/\s+/).filter((t) => t.length > 0);

const searchCustomers = async (q: string): Promise<SearchResult[]> => {
  const tokens = tokenize(q);
  if (tokens.length === 0) return [];

  let query = supabase
    .from("profiles")
    .select("id, first_name, last_name, email, brands(name)")
    .or("role.is.null,role.eq.customer");
  for (const tok of tokens) {
    const pattern = `%${escapeIlike(tok)}%`;
    query = query.or(
      `first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern},phone_number.ilike.${pattern}`,
    );
  }
  const { data, error } = await query.limit(8);
  if (error) {
    console.error("[playbook customer search]", error);
    return [];
  }
  return (data ?? []).map((r) => {
    const row = r as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      brands: { name: string | null } | { name: string | null }[] | null;
    };
    const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
    const brand = Array.isArray(row.brands) ? row.brands[0]?.name : row.brands?.name;
    return {
      id: row.id,
      label: name || row.email || row.id,
      sub: [row.email && name ? row.email : null, brand].filter(Boolean).join(" · "),
    };
  });
};

const searchProducts = async (q: string): Promise<SearchResult[]> => {
  const tokens = tokenize(q);
  if (tokens.length === 0) return [];

  let query = supabase
    .from("catalogues")
    .select("id, name, sku, category, brands(name)");
  for (const tok of tokens) {
    const pattern = `%${escapeIlike(tok)}%`;
    query = query.or(`name.ilike.${pattern},sku.ilike.${pattern}`);
  }
  const { data, error } = await query.limit(8);
  if (error) {
    console.error("[playbook product search]", error);
    return [];
  }
  return (data ?? []).map((r) => {
    const row = r as {
      id: number;
      name: string | null;
      sku: string | null;
      category: string | null;
      brands: { name: string | null } | { name: string | null }[] | null;
    };
    const brand = Array.isArray(row.brands) ? row.brands[0]?.name : row.brands?.name;
    return {
      id: String(row.id),
      label: row.name || `#${row.id}`,
      sub: [row.sku, row.category, brand].filter(Boolean).join(" · "),
    };
  });
};

const EmptySection = ({
  title,
  items,
  onPick,
}: {
  title: string;
  items: {
    key: string;
    label: string;
    display?: string;
    icon: React.ComponentType<{ className?: string }>;
  }[];
  onPick: (q: string) => void;
}) => (
  <div className="mt-8 w-full">
    <p className="mb-2 text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
      {title}
    </p>
    <div className="grid grid-cols-1 gap-2 text-left sm:grid-cols-2">
      {items.map(({ key, label, display, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onPick(label)}
          className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground transition-colors hover:border-primary/40 hover:bg-muted"
        >
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1">{display ?? label}</span>
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

const AssistantBlock = ({
  message,
  question,
  hideSql = false,
}: {
  message: AssistantMessage;
  question: string;
  hideSql?: boolean;
}) => {
  const { t, locale } = useLanguage();
  const { summary, sql, columns, rows, chart, reports, streaming } = message;
  const reportList = reports ?? [];
  const sqlSteps = message.sqlSteps ?? [];
  const hasAnything =
    summary || rows.length > 0 || chart || sql || reportList.length > 0 || sqlSteps.length > 0;

  if (!hasAnything && streaming) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t("aiQuery.thinking")}</span>
      </div>
    );
  }

  // While the assistant is still working, show a step-by-step progress
  // indicator instead of letting the rich table flicker as each new
  // sql_result event lands. Once streaming ends, the markdown brief
  // takes over and the final table is rendered normally.
  const showSteps = streaming && sqlSteps.length > 0;

  // For playbook responses (Customer 360 / Product analysis) the brief
  // already embeds the data inline as markdown, so the trailing rich
  // table and SQL accordion are noise. Detect from the originating user
  // message — that's the raw model-side prompt, not the display label.
  const isPlaybookResponse = /^(customer 360 brief|product analysis|brief customer 360|analisi prodotto)/i
    .test(question);

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

      {showSteps && <StepProgress steps={sqlSteps} writingSummary={!!summary} />}

      {chart && rows.length >= 2 && <ChartView spec={chart} rows={rows} locale={locale} />}

      {reportList.length > 0 && <ReportCards reports={reportList} locale={locale} />}

      {!streaming && !isPlaybookResponse && columns.length > 0 && rows.length > 0 && (
        <ResultsTable columns={columns} rows={rows} locale={locale} question={question} />
      )}

      {!streaming && !isPlaybookResponse && !hideSql && sql && <SqlBlock sql={sql} />}
    </div>
  );
};

const StepProgress = ({
  steps,
  writingSummary,
}: {
  steps: SqlStep[];
  writingSummary: boolean;
}) => {
  const { t } = useLanguage();
  // Collapse consecutive duplicates — retries and heuristic collisions
  // shouldn't add noise to the progress list. step.label is a translation
  // key (e.g. "aiQuery.step.pullingOrders"); resolve it via t() for the
  // user's locale.
  const deduped = steps.filter((s, i) => i === 0 || s.label !== steps[i - 1].label);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm">
      {deduped.map((step, i) => (
        <div key={i} className="flex items-center gap-2 text-foreground">
          <Check className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="flex-1">{t(step.label)}</span>
        </div>
      ))}
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        <span>{t(writingSummary ? "aiQuery.step.puttingTogether" : "aiQuery.step.justMoment")}</span>
      </div>
    </div>
  );
};

const ResultsTable = ({
  columns,
  rows,
  locale,
  question,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
  locale: string;
  question: string;
}) => {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 25);

  const handleCsv = () => {
    try {
      downloadCsv(columns, rows, exportFilename(question, "csv"));
    } catch (err: any) {
      toast.error(`${t("aiQuery.downloadFailed")}: ${err?.message ?? ""}`);
    }
  };
  const handleXlsx = async () => {
    try {
      await downloadXlsx(columns, rows, exportFilename(question, "xlsx"));
    } catch (err: any) {
      toast.error(`${t("aiQuery.downloadFailed")}: ${err?.message ?? ""}`);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {rows.length.toLocaleString()} {rows.length === 1 ? t("aiQuery.row") : t("aiQuery.rows")}
        </span>
        <div className="flex items-center gap-3">
          {rows.length > 25 && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="text-xs text-primary hover:underline"
            >
              {expanded ? t("aiQuery.showFirst") : `${t("aiQuery.showAll")} ${rows.length}`}
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
              >
                <Download className="h-3.5 w-3.5" />
                {t("aiQuery.download")}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleCsv} className="cursor-pointer text-xs">
                {t("aiQuery.downloadCsv")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleXlsx} className="cursor-pointer text-xs">
                {t("aiQuery.downloadXlsx")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              {columns.map((c) => (
                <th
                  key={c}
                  className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground"
                >
                  {humanizeColumn(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                {columns.map((c) =>
                  isImageColumn(c) ? (
                    <td key={c} className="px-4 py-2">
                      <ImageCell url={row[c]} />
                    </td>
                  ) : (
                    <td key={c} className="px-4 py-2 text-foreground tabular-nums">
                      {formatCell(row[c], c, locale)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Render an image-URL column cell. Falls back to a muted placeholder when
// the value is missing or doesn't look like a URL — keeps row heights
// consistent even when half the customers don't have an avatar.
const ImageCell = ({ url }: { url: unknown }) => {
  const isUrl = looksLikeImageUrl(url);
  if (!isUrl) {
    return <div className="h-10 w-10 rounded-md bg-muted/50" />;
  }
  return (
    <a
      href={url as string}
      target="_blank"
      rel="noopener noreferrer"
      className="block h-10 w-10 overflow-hidden rounded-md border border-border bg-muted/40 transition-opacity hover:opacity-80"
      onClick={(e) => e.stopPropagation()}
    >
      <img
        src={url as string}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
        onError={(e) => {
          const target = e.currentTarget;
          target.style.display = "none";
          target.parentElement?.classList.add("bg-muted/50");
        }}
      />
    </a>
  );
};

const SqlBlock = ({ sql }: { sql: string }) => {
  const { t } = useLanguage();
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
          {t("aiQuery.sqlUsed")}
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

const ReportCards = ({
  reports,
  locale,
}: {
  reports: ReportFile[];
  locale: string;
}) => {
  const { t } = useLanguage();
  const bcp = bcp47(locale);
  return (
    <div className="flex flex-col gap-2">
      {reports.map((r) => {
        let periodLabel = "";
        if (r.date) {
          const [y, m, d] = r.date.split("-").map(Number);
          periodLabel = new Intl.DateTimeFormat(bcp, {
            day: "2-digit",
            month: "short",
            year: "numeric",
          }).format(new Date(Date.UTC(y, m - 1, d)));
        } else if (r.year && r.month) {
          periodLabel = new Intl.DateTimeFormat(bcp, {
            month: "long",
            year: "numeric",
          }).format(new Date(Date.UTC(r.year, r.month - 1, 1)));
        }
        return (
          <a
            key={`${r.brand_id}-${r.date ?? `${r.year}-${r.month}`}-${r.kind ?? ""}`}
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Download className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {r.brand_name} — {periodLabel}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.row_count.toLocaleString(bcp)}{" "}
                  {r.row_count === 1 ? t("aiQuery.row") : t("aiQuery.rows")}
                  {" · "}
                  {r.filename}
                </p>
              </div>
            </div>
            <span className="shrink-0 text-xs font-medium text-primary">
              {t("aiQuery.download")}
            </span>
          </a>
        );
      })}
    </div>
  );
};

const ChartView = ({
  spec,
  rows,
  locale,
}: {
  spec: ChartSpec;
  rows: Record<string, unknown>[];
  locale: string;
}) => {
  const data = rows.map((r) => {
    const out: Record<string, unknown> = { ...r };
    spec.y_keys.forEach((k) => {
      out[k] = toNumber(r[k]) ?? 0;
    });
    return out;
  });

  // Pick the dominant Y-key to drive axis/tooltip currency/percent formatting.
  const primaryY = spec.y_keys[0] ?? "";
  const yTick = formatAxis(primaryY, locale);
  const tooltipFmt = (value: any, name: any) =>
    [formatNumber(Number(value), String(name).toLowerCase(), bcp47(locale)), humanizeColumn(String(name))];

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
            <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" tickFormatter={yTick} />
            <Tooltip formatter={tooltipFmt} />
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
            <Tooltip formatter={tooltipFmt} />
          </PieChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={spec.x_key} fontSize={11} stroke="hsl(var(--muted-foreground))" />
            <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" tickFormatter={yTick} />
            <Tooltip formatter={tooltipFmt} />
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
