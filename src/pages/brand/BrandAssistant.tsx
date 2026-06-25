// BrandAssistant — the in-store sales-assistant chat (chat.aioncover.com).
//
// A ChatGPT-style assistant for brand store managers / sales associates.
// It streams from the `brand-assistant` edge function, which answers from
// two sources: the brand knowledge base (RAG over uploaded docs) and live
// client/sales data (read-only SQL). Threads persist in `ai_chats_brand`,
// the same table the analytics "Ask the data" page uses, keyed on profile_id.
//
// This is intentionally a separate, leaner component from AdminAIQuery: no
// charts, reports, or analytics playbooks — just answer text, the knowledge
// sources behind it, and an optional compact data table.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp, BookOpen, Loader2, MessageSquarePlus, ShoppingBag, Sparkles,
  Trash2, Users, ScrollText,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// Local bilingual helper — this is a brand-new surface and we don't want to
// fan out dozens of i18n keys for v1. `locale` comes from useLanguage().
const tt = (locale: string, en: string, it: string) => (locale === "it" ? it : en);

type KnowledgeSource = {
  doc_title: string;
  category: string;
  similarity: number;
  snippet: string;
};

type AssistantMessage = {
  role: "assistant";
  summary: string;
  sources: KnowledgeSource[];
  sql: string | null;
  columns: string[];
  rows: Record<string, unknown>[];
  streaming: boolean;
};

type Message =
  | { role: "user"; content: string }
  | AssistantMessage;

type ChatSummary = { id: string; title: string; updated_at: string };

// Chunks often start mid-sentence; drop a leading partial word and mark it.
const cleanSnippet = (s: string): string => {
  const t = (s ?? "").trim();
  if (!t) return "";
  return /^[a-zà-ÿ]/.test(t) ? "…" + t.replace(/^\S+\s+/, "") : t;
};

const humanizeColumn = (col: string): string =>
  col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const formatCell = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length === 0 ? "—" : v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    return v.slice(0, 10);
  }
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
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return d.toLocaleDateString();
};

const emptyAssistant = (): AssistantMessage => ({
  role: "assistant",
  summary: "",
  sources: [],
  sql: null,
  columns: [],
  rows: [],
  streaming: true,
});

export default function BrandAssistant() {
  const { profile } = useAuth();
  const { locale } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlChatId = searchParams.get("chat");

  const ownerId = profile?.id ?? null;
  const brandId = profile?.brand_id ?? null;

  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(urlChatId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(() => buildSuggestions(locale, null, null, null));
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;

  // ── Chat list ──────────────────────────────────────────────────────────────
  const refreshChatList = useCallback(async () => {
    if (!ownerId) return;
    const { data, error } = await supabase
      .from("ai_chats_brand" as any)
      .select("id, title, updated_at")
      .eq("profile_id", ownerId)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) {
      console.error("[brand-assistant chats]", error);
      return;
    }
    setChats((data as unknown as ChatSummary[] | null) ?? []);
  }, [ownerId]);

  useEffect(() => {
    void refreshChatList();
  }, [refreshChatList]);

  // Ground the starter prompts in the brand's real data: an actual product /
  // collection, a real client who has purchased, and the brand name.
  useEffect(() => {
    if (!brandId) return;
    let active = true;
    (async () => {
      const [brandRes, catRes, polRes] = await Promise.all([
        supabase.from("brands").select("name").eq("id", brandId).maybeSingle(),
        supabase.from("catalogues").select("name, collection").eq("brand_id", brandId).not("name", "is", null).limit(60),
        supabase.from("policies").select("customer:customer_id(first_name, last_name)").eq("brand_id", brandId).limit(40),
      ]);
      if (!active) return;
      const brandName = (brandRes.data?.name as string | undefined) ?? null;
      const cats = (catRes.data as { name: string | null; collection: string | null }[] | null) ?? [];
      const withCollection = cats.find((c) => c.collection && c.collection.trim());
      const product = (withCollection?.collection ?? cats[0]?.name ?? null)?.trim() || null;
      let customer: string | null = null;
      for (const p of (polRes.data as { customer: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null }[] | null) ?? []) {
        const c = Array.isArray(p.customer) ? p.customer[0] : p.customer;
        const name = [c?.first_name, c?.last_name].filter(Boolean).join(" ").trim();
        if (name) { customer = name; break; }
      }
      setSuggestions(buildSuggestions(locale, brandName, product, customer));
    })();
    return () => { active = false; };
  }, [brandId, locale]);

  // ── Load a chat ────────────────────────────────────────────────────────────
  const loadChat = useCallback(async (id: string) => {
    setChatLoading(true);
    const { data, error } = await supabase
      .from("ai_chats_brand" as any)
      .select("id, messages")
      .eq("id", id)
      .maybeSingle();
    setChatLoading(false);
    if (error || !data) {
      toast.error(tt(locale, "Couldn't load that chat.", "Impossibile caricare la chat."));
      return;
    }
    const row = data as unknown as { id: string; messages: unknown };
    setChatId(row.id);
    const raw = (row.messages as Message[]) ?? [];
    // Backfill fields that may be missing on older saved assistant turns.
    const restored: Message[] = raw.map((m) =>
      m.role === "assistant"
        ? { sources: [], columns: [], rows: [], sql: null, ...m, streaming: false }
        : m,
    );
    setMessages(restored);
  }, [locale]);

  useEffect(() => {
    if (urlChatId && urlChatId !== chatId) {
      void loadChat(urlChatId);
    } else if (!urlChatId && chatId) {
      setChatId(null);
      setMessages([]);
    }
  }, [urlChatId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // ── Persistence ────────────────────────────────────────────────────────────
  const persistChat = useCallback(
    async (msgs: Message[], existingId: string | null, firstUserMsg: string) => {
      // Saves under the effective brand profile. Real brand users own their
      // rows; admins (incl. while viewing-as) are allowed by the admin-override
      // RLS policy on ai_chats_brand.
      if (!ownerId) return existingId;

      if (existingId) {
        const { error } = await supabase
          .from("ai_chats_brand" as any)
          .update({ messages: msgs as unknown as any })
          .eq("id", existingId);
        if (error) console.error("[brand-assistant update]", error);
        return existingId;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from("ai_chats_brand" as any)
        .insert({
          profile_id: ownerId,
          user_id: user.id,
          title: titleFromQuestion(firstUserMsg),
          messages: msgs as unknown as any,
        })
        .select("id")
        .single();
      if (error || !data) {
        console.error("[brand-assistant insert]", error);
        return null;
      }
      return (data as unknown as { id: string }).id;
    },
    [ownerId],
  );

  // ── New / select / delete ────────────────────────────────────────────────
  const startNewChat = () => {
    setChatId(null);
    setMessages([]);
    setSearchParams({}, { replace: true });
    taRef.current?.focus();
  };
  const selectChat = (id: string) => {
    if (id !== chatId) setSearchParams({ chat: id }, { replace: false });
  };
  const deleteChat = async (id: string) => {
    const { error } = await supabase.from("ai_chats_brand" as any).delete().eq("id", id);
    if (error) {
      toast.error(tt(locale, "Couldn't delete.", "Eliminazione non riuscita."));
      return;
    }
    setChats((cs) => cs.filter((c) => c.id !== id));
    if (chatId === id) startNewChat();
  };

  // ── Send ─────────────────────────────────────────────────────────────────
  const send = async (question: string) => {
    const text = question.trim();
    if (!text || loading) return;
    setInput("");

    const priorHistory = messages.map((m) =>
      m.role === "user"
        ? { role: "user", content: m.content }
        : { role: "assistant", content: m.summary },
    );

    setMessages([...messages, { role: "user", content: text }, emptyAssistant()]);
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

      const res = await fetch(`${SUPABASE_URL}/functions/v1/brand-assistant`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "apikey": SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
        },
        // brand_id is used only when the caller is an admin (e.g. viewing-as a
        // brand user); real brand users are pinned to their own brand server-side.
        body: JSON.stringify({ question: text, history: priorHistory, locale, brand_id: profile?.brand_id }),
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
          if (event) handleEvent(event, data, patch, locale);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : tt(locale, "Query failed.", "Richiesta non riuscita.");
      toast.error(msg);
      patch((m) => ({ ...m, summary: m.summary || `⚠️ ${msg}`, streaming: false }));
    } finally {
      patch((m) => ({ ...m, streaming: false }));
      setLoading(false);
      taRef.current?.focus();

      const firstUser = messagesRef.current.find((m) => m.role === "user") as
        | { role: "user"; content: string } | undefined;
      const newId = await persistChat(messagesRef.current, chatId, firstUser?.content ?? text);
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
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card/40 md:flex">
        <div className="border-b border-border p-3">
          <button
            type="button"
            onClick={startNewChat}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <MessageSquarePlus className="h-4 w-4" />
            {tt(locale, "New chat", "Nuova chat")}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {chats.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              {tt(locale, "No conversations yet", "Nessuna conversazione")}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {chats.map((c) => (
                <li key={c.id}>
                  <div
                    onClick={() => selectChat(c.id)}
                    className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors ${
                      c.id === chatId ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{c.title}</span>
                      <span className="text-[11px] text-muted-foreground">{formatRelative(c.updated_at)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void deleteChat(c.id); }}
                      className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                      aria-label={tt(locale, "Delete chat", "Elimina chat")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 min-h-0 flex-1 flex-col">
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">
                {tt(locale, "AION Assistant", "Assistente AION")}
              </h1>
              <p className="text-xs text-muted-foreground">
                {tt(locale,
                  "Product, client, story & policy — on the floor",
                  "Prodotto, cliente, storytelling e policy — in negozio")}
              </p>
            </div>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
          {chatLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {tt(locale, "Loading…", "Caricamento…")}
            </div>
          ) : messages.length === 0 ? (
            <EmptyState locale={locale} prompts={suggestions} onPick={(q) => void send(q)} />
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-6">
              {messages.map((m, i) =>
                m.role === "user"
                  ? <UserBubble key={i} text={m.content} />
                  : <AssistantBlock key={i} message={m} locale={locale} />,
              )}
            </div>
          )}
        </div>

        <div className="border-t border-border bg-background px-6 py-4">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={tt(locale, "Ask about a product, client, the brand story, or a policy…",
                "Chiedi di un prodotto, un cliente, la storia del brand o una policy…")}
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
              aria-label={tt(locale, "Send", "Invia")}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted-foreground/60">
            {tt(locale,
              "AION Assistant can make mistakes. Verify prices, policies and client details before acting.",
              "L'Assistente AION può sbagliare. Verifica prezzi, policy e dati cliente prima di agire.")}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── SSE ─────────────────────────────────────────────────────────────────────
function parseSse(frame: string): { event: string | null; data: unknown } {
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
  locale: string,
) {
  if (event === "turn_start") {
    patch((m) => ({ ...m, summary: "" }));
  } else if (event === "text_delta") {
    patch((m) => ({ ...m, summary: m.summary + (data?.text ?? "") }));
  } else if (event === "knowledge") {
    const incoming = Array.isArray(data?.sources) ? (data.sources as KnowledgeSource[]) : [];
    // Collapse to one row per document (the best-scoring chunk) — a single
    // search often returns several chunks from the same doc.
    patch((m) => {
      const byTitle = new Map<string, KnowledgeSource>();
      for (const s of [...m.sources, ...incoming]) {
        const prev = byTitle.get(s.doc_title);
        if (!prev || (s.similarity ?? 0) > (prev.similarity ?? 0)) byTitle.set(s.doc_title, s);
      }
      const merged = [...byTitle.values()]
        .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
        .slice(0, 5);
      return { ...m, sources: merged };
    });
  } else if (event === "sql_result") {
    patch((m) => ({
      ...m,
      sql: data?.sql ?? m.sql,
      columns: data?.columns ?? [],
      rows: data?.rows ?? [],
    }));
  } else if (event === "done") {
    patch((m) => ({ ...m, streaming: false }));
  } else if (event === "error") {
    const msg = data?.message ?? tt(locale, "Something went wrong.", "Si è verificato un errore.");
    toast.error(msg);
    patch((m) => ({ ...m, summary: m.summary || `⚠️ ${msg}`, streaming: false }));
  }
}

// ─── Sub-components ──────────────────────────────────────────────────────────
type Suggestion = { icon: React.ComponentType<{ className?: string }>; text: string };

// Starter prompts grounded in the brand's real data (a real product/collection,
// a real client who has purchased, the brand name). Falls back to generic
// phrasing until the data loads or when nothing is available.
function buildSuggestions(
  locale: string, brandName: string | null, product: string | null, customer: string | null,
): Suggestion[] {
  return [
    {
      icon: ShoppingBag,
      text: product
        ? tt(locale, `Tell me about ${product} — materials, craftsmanship and care.`, `Parlami di ${product} — materiali, lavorazione e cura.`)
        : tt(locale, "Tell me about our signature piece — materials, craftsmanship and care.", "Parlami del nostro pezzo iconico — materiali, lavorazione e cura."),
    },
    {
      icon: Users,
      text: customer
        ? tt(locale, `What has ${customer} bought, and what's their average ticket?`, `Cosa ha comprato ${customer} e qual è il suo scontrino medio?`)
        : tt(locale, "Look up a client — what have they bought and their average ticket?", "Cerca un cliente — cosa ha comprato e il suo scontrino medio?"),
    },
    {
      icon: BookOpen,
      text: brandName
        ? tt(locale, `Tell me ${brandName}'s story, values and tone of voice.`, `Raccontami la storia di ${brandName}, i valori e il tone of voice.`)
        : tt(locale, "Tell me our brand story, values and tone of voice.", "Raccontami la storia del brand, i valori e il tone of voice."),
    },
    {
      icon: ScrollText,
      text: tt(locale, "What's our return and exchange policy, and who do I escalate to?", "Qual è la policy di reso e cambio, e a chi mi rivolgo?"),
    },
  ];
}

const EmptyState = ({ locale, prompts, onPick }: { locale: string; prompts: Suggestion[]; onPick: (q: string) => void }) => (
  <div className="mx-auto flex max-w-2xl flex-col items-center pt-16 text-center">
    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
      <Sparkles className="h-6 w-6 text-primary" />
    </div>
    <h2 className="text-xl font-semibold text-foreground">
      {tt(locale, "How can I help on the floor?", "Come posso aiutarti in negozio?")}
    </h2>
    <p className="mt-1 text-sm text-muted-foreground">
      {tt(locale,
        "Ask about products, your clients, the brand story, or company policies.",
        "Chiedi di prodotti, clienti, storia del brand o policy aziendali.")}
    </p>
    <div className="mt-8 grid w-full grid-cols-1 gap-2 text-left sm:grid-cols-2">
      {prompts.map(({ icon: Icon, text }, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onPick(text)}
          className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground transition-colors hover:border-primary/40 hover:bg-muted"
        >
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1">{text}</span>
        </button>
      ))}
    </div>
  </div>
);

const UserBubble = ({ text }: { text: string }) => (
  <div className="flex justify-end">
    <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
      {text}
    </div>
  </div>
);

const CATEGORY_LABEL: Record<string, { en: string; it: string }> = {
  product: { en: "Product", it: "Prodotto" },
  storytelling: { en: "Story", it: "Storytelling" },
  policy: { en: "Policy", it: "Policy" },
  training: { en: "Training", it: "Formazione" },
  other: { en: "Doc", it: "Documento" },
};

const AssistantBlock = ({ message, locale }: { message: AssistantMessage; locale: string }) => {
  const { summary, sources, columns, rows, streaming } = message;
  const hasAnything = summary || sources.length > 0 || rows.length > 0;

  if (!hasAnything && streaming) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{tt(locale, "Thinking…", "Sto pensando…")}</span>
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

      {!streaming && columns.length > 0 && rows.length > 0 && (
        <DataTable columns={columns} rows={rows} locale={locale} />
      )}

      {sources.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {tt(locale, "From the knowledge base", "Dalla knowledge base")}
          </p>
          <div className="flex flex-col gap-2">
            {sources.map((s, i) => {
              const cat = CATEGORY_LABEL[s.category] ?? CATEGORY_LABEL.other;
              return (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="mt-0.5 shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                    {tt(locale, cat.en, cat.it)}
                  </span>
                  <div className="min-w-0">
                    <span className="font-medium text-foreground">{s.doc_title}</span>
                    <span className="ml-1 text-muted-foreground">· {Math.round(s.similarity * 100)}%</span>
                    <p className="truncate text-muted-foreground/80">{cleanSnippet(s.snippet)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const DataTable = ({
  columns, rows, locale,
}: { columns: string[]; rows: Record<string, unknown>[]; locale: string }) => {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 15);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {rows.length.toLocaleString()} {tt(locale, "rows", "righe")}
        </span>
        {rows.length > 15 && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-xs text-primary hover:underline"
          >
            {expanded
              ? tt(locale, "Show first 15", "Mostra prime 15")
              : `${tt(locale, "Show all", "Mostra tutte")} ${rows.length}`}
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              {columns.map((c) => (
                <th key={c} className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">
                  {humanizeColumn(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                {columns.map((c) => (
                  <td key={c} className="px-4 py-2 text-foreground tabular-nums">{formatCell(row[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
