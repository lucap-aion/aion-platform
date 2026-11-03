// Discussions — the house's staff room.
//
// Threads on the left (filter: everything / following / mentioning me, open or
// closed, by tag, by words in the subject); the open thread on the right with
// the assistant answer it started from, the messages, and a reply box that
// mentions colleagues with @. Opening a thread marks its notifications read.
//
// Lucrezia (Luisa Beccaria, 2026-11-03) asked to "mandare mail interne nel team
// direttamente dalla piattaforma"; this is that, with the conversation kept here
// instead of scattered across inboxes. Every message still reaches the people it
// concerns by email.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Bell, BellOff, CheckCircle2, ChevronDown, ChevronUp, Loader2, MessagesSquare, Plus, RotateCcw,
  Search, Send, Sparkles, Tag, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import AssistantMarkdown from "@/components/assistant/AssistantMarkdown";
import MentionTextarea, { Avatar, MessageBody } from "@/components/team/MentionTextarea";
import NewThreadDialog from "@/components/team/NewThreadDialog";
import {
  markThreadRead, mentionsIn, parseTags, postMessage, teamDb, useColleagues, useUnreadTeamNotifications,
  type Colleague, type TeamMessage, type TeamThread,
} from "@/lib/team";

const tt = (locale: string, en: string, it: string) => (locale === "it" ? it : en);
type Filter = "all" | "following" | "mentions";

function when(iso: string, locale: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return d.toLocaleString(locale === "it" ? "it-IT" : "en-GB", sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function BrandDiscussions() {
  const { profile } = useAuth();
  const { locale } = useLanguage();
  const qc = useQueryClient();
  const brandId = profile?.brand_id ?? null;
  const me = profile?.id ?? null;
  const [params, setParams] = useSearchParams();
  const openId = params.get("thread");

  const [filter, setFilter] = useState<Filter>("all");
  const [showClosed, setShowClosed] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const { data: colleagues = [] } = useColleagues(brandId);
  const { data: notifications = [] } = useUnreadTeamNotifications(me);
  const unreadThreads = useMemo(() => new Set(notifications.filter((n) => !n.read_at).map((n) => n.thread_id)), [notifications]);
  // Every thread where someone mentioned me — from the messages themselves, not
  // from the last few notifications, which only reach back so far.
  const mentionsQ = useQuery({
    queryKey: ["team-mentions", me],
    enabled: !!me,
    refetchInterval: 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await teamDb.from("team_messages").select("thread_id").contains("mentions", [me]).limit(1000);
      if (error) throw error;
      return (data as { thread_id: string }[]).map((r) => r.thread_id);
    },
  });
  const mentionThreads = useMemo(() => new Set(mentionsQ.data ?? []), [mentionsQ.data]);

  const threadsQ = useQuery({
    queryKey: ["team-threads", brandId],
    enabled: !!brandId,
    refetchInterval: 30_000,
    queryFn: async (): Promise<TeamThread[]> => {
      const { data, error } = await teamDb.from("team_threads").select("*")
        .eq("brand_id", brandId).order("last_activity_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data as TeamThread[];
    },
  });
  const followingQ = useQuery({
    queryKey: ["team-following", me],
    enabled: !!me,
    queryFn: async (): Promise<{ thread_id: string; muted: boolean }[]> => {
      const { data, error } = await teamDb.from("team_thread_followers").select("thread_id, muted").eq("profile_id", me);
      if (error) throw error;
      return data;
    },
  });
  const following = useMemo(() => new Map((followingQ.data ?? []).map((f) => [f.thread_id, f.muted])), [followingQ.data]);

  const threads = useMemo(() => threadsQ.data ?? [], [threadsQ.data]);
  const allTags = useMemo(() => [...new Set(threads.flatMap((t) => t.tags))].sort(), [threads]);
  const visible = threads.filter((t) =>
    (showClosed ? t.status === "closed" : t.status === "open")
    && (filter === "all" || (filter === "following" ? following.has(t.id) : mentionThreads.has(t.id)))
    && (!tagFilter || t.tags.includes(tagFilter))
    && (!search.trim() || t.title.toLowerCase().includes(search.trim().toLowerCase())),
  );
  const open = threads.find((t) => t.id === openId) ?? null;

  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("thread", id); else next.delete("thread");
    setParams(next, { replace: false });
  };

  const byId = useMemo(() => new Map(colleagues.map((c) => [c.id, c])), [colleagues]);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* ── Thread list ─────────────────────────────────────────────────── */}
      <aside className={`${open ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r border-border md:w-80`}>
        <div className="space-y-3 border-b border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <h1 className="font-serif text-xl font-semibold text-foreground">{tt(locale, "Discussions", "Discussioni")}</h1>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" /> {tt(locale, "New", "Nuova")}
            </button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tt(locale, "Search subjects", "Cerca negli oggetti")}
              className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {(["all", "following", "mentions"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${filter === f ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
              >
                {f === "all" ? tt(locale, "All", "Tutte") : f === "following" ? tt(locale, "Following", "Che seguo") : tt(locale, "Mentions me", "Mi menzionano")}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowClosed((v) => !v)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${showClosed ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
            >
              {tt(locale, "Closed", "Chiuse")}
            </button>
          </div>
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {allTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTagFilter(tagFilter === t ? null : t)}
                  className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${tagFilter === t ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                >
                  <Tag className="h-2.5 w-2.5" />{t}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {threadsQ.isLoading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{tt(locale, "Loading…", "Caricamento…")}</div>
          ) : visible.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <MessagesSquare className="mx-auto mb-2 h-6 w-6 opacity-50" />
              {threads.length === 0
                ? tt(locale, "No discussions yet. Start one here, or from any assistant answer.", "Ancora nessuna discussione. Avviane una da qui, o da qualsiasi risposta dell'assistente.")
                : tt(locale, "Nothing matches these filters.", "Nessuna discussione con questi filtri.")}
            </div>
          ) : (
            <ul>
              {visible.map((t) => {
                const author = t.created_by ? byId.get(t.created_by) : undefined;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => select(t.id)}
                      className={`w-full border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/60 ${t.id === openId ? "bg-muted" : ""}`}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unreadThreads.has(t.id) ? "bg-primary" : "bg-transparent"}`} />
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm ${unreadThreads.has(t.id) ? "font-semibold" : "font-medium"} text-foreground`}>{t.title}</p>
                          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            {t.context_type === "assistant_answer" && <Sparkles className="h-3 w-3" />}
                            <span className="truncate">{author?.name ?? "—"}</span>
                            <span>·</span>
                            <span className="shrink-0">{when(t.last_activity_at, locale)}</span>
                            <span>·</span>
                            <span className="shrink-0">{t.message_count}</span>
                          </p>
                          {t.tags.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {t.tags.slice(0, 4).map((tag) => (
                                <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">#{tag}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* ── Open thread ─────────────────────────────────────────────────── */}
      <section className={`${open ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
        {open ? (
          <ThreadView
            key={open.id}
            thread={open}
            colleagues={colleagues}
            following={following}
            onBack={() => select(null)}
            onChanged={() => {
              void qc.invalidateQueries({ queryKey: ["team-threads", brandId] });
              void qc.invalidateQueries({ queryKey: ["team-following", me] });
            }}
            onDeleted={() => { select(null); void qc.invalidateQueries({ queryKey: ["team-threads", brandId] }); }}
          />
        ) : openId && threadsQ.isSuccess ? (
          <div className="m-auto max-w-sm p-6 text-center text-sm text-muted-foreground">
            {tt(locale, "This discussion no longer exists, or isn't one you can see.", "Questa discussione non esiste più, o non è tra quelle che puoi vedere.")}
          </div>
        ) : (
          <div className="m-auto p-6 text-center text-sm text-muted-foreground">
            <MessagesSquare className="mx-auto mb-2 h-8 w-8 opacity-40" />
            {tt(locale, "Pick a discussion, or start a new one.", "Scegli una discussione, o avviane una nuova.")}
          </div>
        )}
      </section>

      <NewThreadDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(t) => { void qc.invalidateQueries({ queryKey: ["team-threads", brandId] }); select(t.id); }}
      />
    </div>
  );
}

function ThreadView({ thread, colleagues, following, onBack, onChanged, onDeleted }: {
  thread: TeamThread; colleagues: Colleague[]; following: Map<string, boolean>;
  onBack: () => void; onChanged: () => void; onDeleted: () => void;
}) {
  const { profile } = useAuth();
  const { locale } = useLanguage();
  const qc = useQueryClient();
  const me = profile?.id ?? null;
  const byId = useMemo(() => new Map(colleagues.map((c) => [c.id, c])), [colleagues]);
  const others = colleagues.filter((c) => c.id !== me);

  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [editingTags, setEditingTags] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const msgsQ = useQuery({
    queryKey: ["team-messages", thread.id],
    refetchInterval: 15_000,
    queryFn: async (): Promise<TeamMessage[]> => {
      const { data, error } = await teamDb.from("team_messages").select("*")
        .eq("thread_id", thread.id).order("created_at", { ascending: true });
      if (error) throw error;
      return data as TeamMessage[];
    },
  });
  const messages = msgsQ.data ?? [];

  // Opening it is reading it.
  useEffect(() => {
    if (!me) return;
    void markThreadRead(me, thread.id).then(() => qc.invalidateQueries({ queryKey: ["team-notifications", me] }));
  }, [me, thread.id, messages.length, qc]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  const isFollowing = following.has(thread.id);
  const muted = following.get(thread.id) === true;
  const canDelete = thread.created_by === me || !!profile?.is_master;

  const send = async () => {
    if (!profile?.brand_id || !reply.trim()) return;
    setSending(true);
    try {
      await postMessage({
        threadId: thread.id, brandId: profile.brand_id, authorProfileId: me,
        body: reply, mentions: mentionsIn(reply, colleagues, me),
      });
      setReply("");
      await qc.invalidateQueries({ queryKey: ["team-messages", thread.id] });
      onChanged();
    } catch (e) {
      console.error("[team reply]", e);
      toast.error(tt(locale, "Couldn't send. Try again.", "Invio non riuscito. Riprova."));
    } finally {
      setSending(false);
    }
  };

  const update = async (patch: Partial<Pick<TeamThread, "status" | "tags" | "title">>) => {
    const { error } = await teamDb.from("team_threads").update(patch).eq("id", thread.id);
    if (error) { toast.error(tt(locale, "Couldn't save.", "Salvataggio non riuscito.")); return; }
    onChanged();
  };

  const setFollow = async (mode: "follow" | "mute") => {
    if (!me || !profile?.brand_id) return;
    const { error } = await teamDb.from("team_thread_followers")
      .upsert({ thread_id: thread.id, profile_id: me, brand_id: profile.brand_id, muted: mode === "mute" });
    if (error) { toast.error(tt(locale, "Couldn't save.", "Salvataggio non riuscito.")); return; }
    onChanged();
  };

  const remove = async () => {
    if (!window.confirm(tt(locale, "Delete this discussion and all its messages for everyone?", "Eliminare questa discussione e tutti i suoi messaggi per tutti?"))) return;
    const { error } = await teamDb.from("team_threads").delete().eq("id", thread.id);
    if (error) { toast.error(tt(locale, "Couldn't delete it.", "Eliminazione non riuscita.")); return; }
    onDeleted();
  };

  const removeMessage = async (id: string) => {
    if (!window.confirm(tt(locale, "Delete this message?", "Eliminare questo messaggio?"))) return;
    const { error } = await teamDb.from("team_messages").delete().eq("id", id);
    if (error) { toast.error(tt(locale, "Couldn't delete it.", "Eliminazione non riuscita.")); return; }
    void qc.invalidateQueries({ queryKey: ["team-messages", thread.id] });
  };

  return (
    <>
      <header className="space-y-2 border-b border-border px-4 py-3 md:px-6">
        <div className="flex items-start gap-2">
          <button type="button" onClick={onBack} className="mt-0.5 rounded-md p-1 text-muted-foreground hover:bg-muted md:hidden" aria-label={tt(locale, "Back", "Indietro")}>
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-foreground">{thread.title}</h2>
            <p className="text-xs text-muted-foreground">
              {tt(locale, "Started by", "Avviata da")} {(thread.created_by && byId.get(thread.created_by)?.name) || "—"} · {when(thread.created_at, locale)}
              {thread.status === "closed" && <> · <span className="font-medium text-emerald-700">{tt(locale, "Closed", "Chiusa")}</span></>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => void setFollow(isFollowing && !muted ? "mute" : "follow")}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              title={isFollowing && !muted
                ? tt(locale, "You are notified of replies. Click to mute.", "Ricevi le risposte. Clicca per silenziare.")
                : tt(locale, "Follow to be notified of replies.", "Segui per ricevere le risposte.")}
            >
              {isFollowing && !muted ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{isFollowing && !muted ? tt(locale, "Following", "Segui") : tt(locale, "Muted", "Silenziata")}</span>
            </button>
            <button
              type="button"
              onClick={() => void update({ status: thread.status === "open" ? "closed" : "open" })}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {thread.status === "open" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{thread.status === "open" ? tt(locale, "Close", "Chiudi") : tt(locale, "Reopen", "Riapri")}</span>
            </button>
            {canDelete && (
              <button type="button" onClick={() => void remove()} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={tt(locale, "Delete", "Elimina")}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {thread.tags.map((t) => (
            <span key={t} className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              #{t}
              <button type="button" onClick={() => void update({ tags: thread.tags.filter((x) => x !== t) })} aria-label={tt(locale, "Remove tag", "Rimuovi tag")}>
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          {editingTags ? (
            <input
              autoFocus
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const add = parseTags(tagDraft);
                  if (add.length) void update({ tags: [...new Set([...thread.tags, ...add])] });
                  setTagDraft(""); setEditingTags(false);
                }
                if (e.key === "Escape") { setTagDraft(""); setEditingTags(false); }
              }}
              onBlur={() => { setTagDraft(""); setEditingTags(false); }}
              placeholder={tt(locale, "tag, Enter", "tag, Invio")}
              className="w-32 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] outline-none focus:border-primary/50"
            />
          ) : (
            <button type="button" onClick={() => setEditingTags(true)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted">
              <Tag className="h-2.5 w-2.5" /> {tt(locale, "Add tag", "Aggiungi tag")}
            </button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {thread.context?.answer && (
            <div className="rounded-xl border border-border bg-muted/20">
              <button
                type="button"
                onClick={() => setShowContext((v) => !v)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{tt(locale, "Assistant answer", "Risposta dell'assistente")}</span>
                  {thread.context.question && <span className="block truncate text-sm font-medium text-foreground">{thread.context.question}</span>}
                </span>
                {showContext ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>
              {showContext && (
                <div className="prose prose-sm max-w-none border-t border-border px-4 py-3 text-sm text-foreground prose-strong:text-foreground prose-table:text-xs prose-th:bg-muted/40">
                  <AssistantMarkdown>{thread.context.answer}</AssistantMarkdown>
                </div>
              )}
            </div>
          )}

          {msgsQ.isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>}
          {messages.map((m) => {
            const a = m.author_profile_id ? byId.get(m.author_profile_id) : undefined;
            const mine = m.author_profile_id === me;
            return (
              <div key={m.id} className="group flex gap-3">
                <Avatar initials={a?.initials ?? "?"} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-foreground">{a?.name ?? tt(locale, "Former colleague", "Ex collega")}</span>
                    <span className="text-muted-foreground">{when(m.created_at, locale)}</span>
                    {mine && (
                      <button
                        type="button"
                        onClick={() => void removeMessage(m.id)}
                        className="ml-auto hidden rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block"
                        aria-label={tt(locale, "Delete message", "Elimina messaggio")}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </p>
                  <div className="mt-0.5 text-sm leading-relaxed text-foreground">
                    <MessageBody body={m.body} colleagues={colleagues} />
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottom} />
        </div>
      </div>

      <div className="border-t border-border bg-background px-4 py-3 md:px-6">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <div className="flex-1">
            <MentionTextarea
              value={reply}
              onChange={setReply}
              colleagues={others}
              onSubmit={() => void send()}
              rows={2}
              dropUp
              disabled={sending}
              placeholder={tt(locale, "Reply — @ to mention a colleague · ⌘↵ to send", "Rispondi — @ per menzionare un collega · ⌘↵ per inviare")}
            />
          </div>
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !reply.trim()}
            className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            aria-label={tt(locale, "Send", "Invia")}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </>
  );
}
