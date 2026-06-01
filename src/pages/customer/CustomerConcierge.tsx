// Customer Concierge — a brand-flavoured AI chat for end customers. Reuses
// the query-ai edge function (in "customer" mode) but ships with a much
// lighter UI than AdminAIQuery: no left rail, no playbook tiles, no SQL
// accordion. Conversations persist to public.ai_chats_brand (profile_id
// keyed, RLS-scoped) and can be deep-linked via ?chat=<uuid>, so a refresh
// doesn't wipe context.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowUp, Loader2, Sparkles, Shield, Calendar, FileText,
  MessageSquarePlus, History,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTenant } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const RECENT_CHATS_LIMIT = 10;
// Cheap client-side throttle to keep an over-eager (or scripted) customer
// from hammering the Anthropic-backed endpoint between turns. The edge
// function already costs money per request — at minimum, wait a beat after
// the previous answer completed before we accept the next one.
const COOLDOWN_MS = 1500;

type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; text: string; streaming: boolean };

type ChatSummary = { id: string; title: string; updated_at: string };

// Flatten the brand FAQ (TenantContext exposes JSON arrays per-locale) into a
// plaintext block the edge function can prefix to the system prompt.
const flattenFaq = (source: unknown): string => {
  if (!Array.isArray(source)) return "";
  return (source as any[])
    .map((item) => {
      const q = (item?.title ?? item?.question ?? "").toString().trim();
      const a = item?.content?.blocks
        ? (item.content.blocks as any[])
            .filter((b: any) => b?.text)
            .map((b: any) => String(b.text))
            .join(" ")
            .trim()
        : (item?.answer ?? "").toString().trim();
      if (!q && !a) return "";
      return `Q: ${q}\nA: ${a}`;
    })
    .filter(Boolean)
    .join("\n\n");
};

const titleFromQuestion = (q: string) => {
  const t = q.trim().replace(/\s+/g, " ");
  return t.length > 60 ? t.slice(0, 57) + "…" : t || "New chat";
};

const formatRelative = (iso: string, locale: "en" | "it") => {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return locale === "it" ? "ora" : "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return d.toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", {
    day: "2-digit", month: "short",
  });
};

const CustomerConcierge = () => {
  const { profile } = useAuth();
  const tenant = useTenant();
  const { t, locale } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlChatId = searchParams.get("chat");

  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(urlChatId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keep a ref to the latest messages so the persist call uses the current
  // state even when invoked from inside the streaming finally block.
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;

  // Throttle: timestamp the previous turn completed at. send() refuses if
  // less than COOLDOWN_MS has passed since.
  const lastSendAt = useRef<number>(0);

  const brandFaq = useMemo(
    () => flattenFaq(locale === "it" ? tenant.faqIt : tenant.faqEn),
    [tenant.faqIt, tenant.faqEn, locale],
  );

  // ── Load chat list ────────────────────────────────────────────────────────
  const refreshChatList = useCallback(async () => {
    if (!profile?.id) return;
    const { data, error } = await supabase
      .from("ai_chats_brand")
      .select("id, title, updated_at")
      .eq("profile_id", profile.id)
      .order("updated_at", { ascending: false })
      .limit(RECENT_CHATS_LIMIT);
    if (error) {
      console.error("[concierge chats]", error);
      return;
    }
    setChats((data as ChatSummary[]) ?? []);
  }, [profile?.id]);

  useEffect(() => { void refreshChatList(); }, [refreshChatList]);

  // ── Load a specific chat by URL ?chat= ────────────────────────────────────
  const loadChat = useCallback(async (id: string) => {
    setChatLoading(true);
    const { data, error } = await supabase
      .from("ai_chats_brand")
      .select("id, messages")
      .eq("id", id)
      .maybeSingle();
    setChatLoading(false);
    if (error || !data) {
      toast.error(t("concierge.error.couldntLoad"));
      return;
    }
    const raw = (data.messages as any[]) ?? [];
    const restored: Message[] = raw.map((m: any) =>
      m?.role === "assistant"
        ? { role: "assistant", text: m.text ?? "", streaming: false }
        : { role: "user", content: m.content ?? "" },
    );
    setChatId(data.id as string);
    setMessages(restored);
  }, [t]);

  useEffect(() => {
    if (urlChatId && urlChatId !== chatId) {
      void loadChat(urlChatId);
    } else if (!urlChatId && chatId) {
      // URL was cleared (e.g. user clicked "New chat")
      setChatId(null);
      setMessages([]);
    }
  }, [urlChatId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Autoscroll on new content ─────────────────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // ── Auto-resize the composer textarea up to a sensible cap ────────────────
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(160, ta.scrollHeight)}px`;
  }, [input]);

  // Suggested starters — surface the most useful 4 from the empty state.
  const suggestions = [
    { Icon: Calendar, key: "concierge.suggest.expiry", q: t("concierge.suggest.expiry") },
    { Icon: Shield, key: "concierge.suggest.total", q: t("concierge.suggest.total") },
    { Icon: FileText, key: "concierge.suggest.claimsHelp", q: t("concierge.suggest.claimsHelp") },
    { Icon: Sparkles, key: "concierge.suggest.howClean", q: t("concierge.suggest.howClean") },
  ];

  const persistChat = useCallback(
    async (msgs: Message[], existingId: string | null, firstUserMsg: string) => {
      if (!profile?.id) return existingId;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return existingId;

      // Strip the streaming flag before saving — restoration always re-marks
      // assistant rows as not streaming.
      const serialised = msgs.map((m) =>
        m.role === "user"
          ? { role: "user", content: m.content }
          : { role: "assistant", text: m.text },
      );

      if (existingId) {
        const { error } = await supabase
          .from("ai_chats_brand")
          .update({ messages: serialised as any })
          .eq("id", existingId);
        if (error) console.error("[concierge persist update]", error);
        return existingId;
      }

      const { data, error } = await supabase
        .from("ai_chats_brand")
        .insert({
          profile_id: profile.id,
          user_id: user.id,
          title: titleFromQuestion(firstUserMsg),
          messages: serialised as any,
        })
        .select("id")
        .single();
      if (error || !data) {
        console.error("[concierge persist insert]", error);
        return null;
      }
      return (data as { id: string }).id;
    },
    [profile?.id],
  );

  const startNewChat = () => {
    setChatId(null);
    setMessages([]);
    setSearchParams({}, { replace: true });
    inputRef.current?.focus();
  };

  const selectChat = (id: string) => {
    if (id === chatId) return;
    setSearchParams({ chat: id }, { replace: false });
  };

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || loading) return;
    const now = Date.now();
    const wait = lastSendAt.current + COOLDOWN_MS - now;
    if (wait > 0) {
      toast.info(t("concierge.tooFast"));
      return;
    }
    setInput("");

    const history = messages.map((m) =>
      m.role === "user" ? { role: "user", content: m.content } : { role: "assistant", content: m.text },
    );

    setMessages((prev) => [
      ...prev,
      { role: "user", content: question },
      { role: "assistant", text: "", streaming: true },
    ]);
    setLoading(true);

    const patchLast = (fn: (m: Extract<Message, { role: "assistant" }>) => Extract<Message, { role: "assistant" }>) =>
      setMessages((prev) => {
        const out = [...prev];
        for (let i = out.length - 1; i >= 0; i--) {
          if (out[i].role === "assistant") {
            out[i] = fn(out[i] as Extract<Message, { role: "assistant" }>);
            break;
          }
        }
        return out;
      });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error(t("concierge.error.signin"));

      const res = await fetch(`${SUPABASE_URL}/functions/v1/query-ai`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "apikey": SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
        },
        body: JSON.stringify({
          question,
          history,
          locale,
          brand_faq: brandFaq,
        }),
      });
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => "");
        let msg = `HTTP ${res.status}`;
        try { msg = (JSON.parse(txt)?.error as string) ?? msg; } catch { /* ignore */ }
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const { event, data } = parseSse(frame);
          if (event === "text_delta" && typeof data?.text === "string") {
            patchLast((m) => ({ ...m, text: m.text + data.text }));
          } else if (event === "turn_start") {
            patchLast((m) => ({ ...m, text: "" }));
          } else if (event === "error" && typeof data?.message === "string") {
            patchLast((m) => ({ ...m, text: m.text || data.message, streaming: false }));
          }
        }
      }
    } catch (e: any) {
      patchLast((m) => ({
        ...m,
        text: m.text || (e?.message ?? t("concierge.error.generic")),
        streaming: false,
      }));
    } finally {
      patchLast((m) => ({ ...m, streaming: false }));
      setLoading(false);
      // Stamp completion time, so the cooldown starts when the answer
      // finishes streaming, not when the send button was pressed.
      lastSendAt.current = Date.now();
      inputRef.current?.focus();

      // Persist the completed turn. The first send of a fresh chat creates
      // a row + updates the URL so a refresh restores the conversation.
      const firstUserMsg =
        (messagesRef.current.find((m) => m.role === "user") as { role: "user"; content: string } | undefined)?.content ?? question;
      const newId = await persistChat(messagesRef.current, chatId, firstUserMsg);
      if (newId && newId !== chatId) {
        setChatId(newId);
        setSearchParams({ chat: newId }, { replace: true });
      }
      void refreshChatList();
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const firstName = profile?.first_name?.trim() || "";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-4 py-4 md:px-6">
        <div className="flex items-center justify-between gap-3 max-w-3xl mx-auto">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="font-serif text-lg md:text-xl font-bold text-foreground truncate">
                {t("concierge.title").replace("{brand}", tenant.name)}
              </h1>
              <p className="text-xs text-muted-foreground">{t("concierge.subtitle")}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {chats.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={t("concierge.recent")}
                  >
                    <History className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t("concierge.recent")}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  {chats.map((c) => {
                    const active = c.id === chatId;
                    return (
                      <DropdownMenuItem
                        key={c.id}
                        onClick={() => selectChat(c.id)}
                        className={`flex flex-col items-start gap-0.5 cursor-pointer ${active ? "bg-primary/10" : ""}`}
                      >
                        <span className="text-sm font-medium text-foreground line-clamp-1 w-full">
                          {c.title}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatRelative(c.updated_at, locale)}
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <button
              type="button"
              onClick={startNewChat}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("concierge.newChat")}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Chat scroll area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
        {chatLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("concierge.loadingChat")}
          </div>
        ) : messages.length === 0 ? (
          <EmptyState
            firstName={firstName}
            brandName={tenant.name}
            t={t}
            suggestions={suggestions}
            onPick={(q) => void send(q)}
          />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            {messages.map((m, i) =>
              m.role === "user" ? <UserBubble key={i} text={m.content} /> : <AssistantBubble key={i} text={m.text} streaming={m.streaming} t={t} />,
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-background px-4 py-3 md:px-6">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={t("concierge.placeholder")}
            rows={1}
            disabled={loading}
            className="flex-1 resize-none overflow-y-auto rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
            style={{ maxHeight: 160 }}
          />
          <button
            type="button"
            onClick={() => void send(input)}
            disabled={loading || !input.trim()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            aria-label={t("concierge.send")}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted-foreground/60">
          {t("concierge.disclaimer")}
        </p>
      </div>
    </div>
  );
};

function parseSse(frame: string): { event: string | null; data: any } {
  let event: string | null = null;
  const lines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) lines.push(line.slice(5).trim());
  }
  if (!event) return { event: null, data: null };
  const raw = lines.join("\n");
  try {
    return { event, data: raw ? JSON.parse(raw) : null };
  } catch {
    return { event, data: raw };
  }
}

const EmptyState = ({
  firstName,
  brandName,
  t,
  suggestions,
  onPick,
}: {
  firstName: string;
  brandName: string;
  t: (k: string) => string;
  suggestions: { Icon: any; key: string; q: string }[];
  onPick: (q: string) => void;
}) => (
  <div className="mx-auto flex max-w-2xl flex-col items-center pt-12 md:pt-20 text-center">
    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
      <Sparkles className="h-7 w-7 text-primary" />
    </div>
    <h2 className="font-serif text-2xl font-bold text-foreground">
      {firstName
        ? t("concierge.greetingNamed").replace("{name}", firstName)
        : t("concierge.greeting")}
    </h2>
    <p className="mt-2 text-sm text-muted-foreground max-w-md">
      {t("concierge.welcome").replace("{brand}", brandName)}
    </p>

    <div className="mt-8 w-full grid grid-cols-1 sm:grid-cols-2 gap-2">
      {suggestions.map(({ Icon, key, q }) => (
        <button
          key={key}
          type="button"
          onClick={() => onPick(q)}
          className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-4 py-3 text-left text-sm text-foreground transition-colors hover:border-primary/40 hover:bg-muted"
        >
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1">{q}</span>
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

const AssistantBubble = ({
  text,
  streaming,
  t,
}: {
  text: string;
  streaming: boolean;
  t: (k: string) => string;
}) => {
  if (!text && streaming) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t("concierge.thinking")}</span>
      </div>
    );
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-a:text-primary prose-table:text-xs prose-th:bg-muted/40"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      {streaming && (
        <span className="inline-block h-3 w-1.5 animate-pulse bg-foreground/40 align-middle" />
      )}
    </motion.div>
  );
};

export default CustomerConcierge;
