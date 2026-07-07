// BrandKnowledge — manage the brand's AI knowledge base (the RAG corpus the
// in-store Assistant answers from). Brand admins / master users can:
//   • Crawl the brand's public website + news (seed-crawl → crawl-worker)
//   • Add specific page URLs, retry failed pages, toggle news
//   • Upload files (parse-knowledge) or paste text (ingest-knowledge)
//   • Edit / re-embed (update-knowledge), preview chunks, delete
// Everyone in the brand can view the corpus.

import { useCallback, useEffect, useState } from "react";
import {
  BookOpen, Globe, Loader2, Plus, RefreshCw, Trash2, FileText, AlertCircle,
  CheckCircle2, Clock, X, UploadCloud, Link2, Pencil, Eye, Newspaper, RotateCw,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const tt = (locale: string, en: string, it: string) => (locale === "it" ? it : en);

type Doc = {
  id: string;
  title: string;
  category: string;
  source_type: string;
  source_url: string | null;
  status: string;
  error: string | null;
  char_count: number;
  chunk_count: number;
  updated_at: string;
};

const UPLOAD_BUCKET = "brand-knowledge-uploads";
const UPLOAD_ACCEPT = ".pdf,.docx,.pptx,.txt,.md,.csv";
const UPLOAD_MAX_MB = 25;

type SourceRow = { kind: string; enabled: boolean; target: string | null; last_seeded_at: string | null; config: { news_enabled?: boolean } | null };
type FailedItem = { id: string; url: string; error: string | null };

const CATEGORIES = ["product", "storytelling", "policy", "training", "other"];
const CATEGORY_LABEL: Record<string, { en: string; it: string }> = {
  product: { en: "Product", it: "Prodotto" },
  storytelling: { en: "Story", it: "Storytelling" },
  policy: { en: "Policy", it: "Policy" },
  training: { en: "Training", it: "Formazione" },
  news: { en: "News", it: "News" },
  other: { en: "Other", it: "Altro" },
};

export default function BrandKnowledge() {
  const { profile, canWrite } = useAuth();
  const { locale } = useLanguage();
  const brandId = profile?.brand_id ?? null;

  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [pending, setPending] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [scrapeOpen, setScrapeOpen] = useState(false);
  const [addUrlOpen, setAddUrlOpen] = useState(false);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [failed, setFailed] = useState<FailedItem[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [editDoc, setEditDoc] = useState<Doc | null>(null);
  const [previewDoc, setPreviewDoc] = useState<Doc | null>(null);

  const refresh = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("brand_knowledge_docs" as never)
      .select("id, title, category, source_type, source_url, status, error, char_count, chunk_count, updated_at")
      .eq("brand_id", brandId)
      .order("updated_at", { ascending: false });
    const { count } = await supabase
      .from("knowledge_crawl_queue" as never)
      .select("id", { count: "exact", head: true })
      .eq("brand_id", brandId)
      .eq("status", "pending");
    const { data: srcData } = await supabase
      .from("knowledge_sources" as never)
      .select("kind, enabled, target, last_seeded_at, config")
      .eq("brand_id", brandId);
    const { data: failData } = await supabase
      .from("knowledge_crawl_queue" as never)
      .select("id, url, error")
      .eq("brand_id", brandId)
      .eq("status", "error")
      .limit(100);
    setLoading(false);
    setPending(count ?? 0);
    setSources((srcData as unknown as SourceRow[]) ?? []);
    setFailed((failData as unknown as FailedItem[]) ?? []);
    if (error) {
      console.error("[knowledge list]", error);
      toast.error(tt(locale, "Couldn't load the knowledge base.", "Impossibile caricare la knowledge base."));
      return;
    }
    setDocs((data as unknown as Doc[]) ?? []);
  }, [brandId, locale]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Poll while a background crawl is draining the queue.
  useEffect(() => {
    if (pending <= 0) return;
    const t = setTimeout(() => void refresh(), 15000);
    return () => clearTimeout(t);
  }, [pending, refresh]);

  const callFn = async (fn: string, body: Record<string, unknown>) => {
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    if (!token) throw new Error(tt(locale, "Not signed in", "Non autenticato"));
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error ?? `Request failed (${res.status})`);
    return payload;
  };

  const handleScrape = async () => {
    setScrapeOpen(false);
    setScraping(true);
    const tid = toast.loading(tt(locale, "Starting a full crawl of your website…", "Avvio scansione completa del sito…"));
    try {
      const r = await callFn("seed-crawl", { brand_id: brandId });
      toast.success(
        tt(locale,
          `Queued ${r.page_urls} pages + ${r.news_items} news articles — indexing in the background.`,
          `In coda ${r.page_urls} pagine + ${r.news_items} articoli — indicizzazione in background.`),
        { id: tid },
      );
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Crawl failed", { id: tid });
    } finally {
      setScraping(false);
    }
  };

  const handleDelete = async (doc: Doc) => {
    if (!confirm(tt(locale, `Delete "${doc.title}"?`, `Eliminare "${doc.title}"?`))) return;
    const { error } = await supabase.from("brand_knowledge_docs" as never).delete().eq("id", doc.id);
    if (error) {
      toast.error(tt(locale, "Delete failed.", "Eliminazione non riuscita."));
      return;
    }
    setDocs((d) => d.filter((x) => x.id !== doc.id));
    toast.success(tt(locale, "Deleted.", "Eliminato."));
  };

  // Enqueue one or more specific page URLs to be crawled (beyond the site the
  // scraper auto-discovers). The background worker picks them up within a minute.
  const handleAddUrls = async (urls: string[]) => {
    const rows = urls.map((u) => ({ brand_id: brandId, url: u, kind: "page", status: "pending" }));
    const { error } = await supabase
      .from("knowledge_crawl_queue" as never)
      .upsert(rows as never, { onConflict: "brand_id,url", ignoreDuplicates: false });
    if (error) throw new Error(error.message);
    setAddUrlOpen(false);
    toast.success(tt(locale, `Queued ${urls.length} page${urls.length > 1 ? "s" : ""} — indexing shortly.`, `In coda ${urls.length} pagine — indicizzazione a breve.`));
    await refresh();
  };

  // Reset every failed crawl URL to 'pending' so the worker retries them.
  const handleRetryFailed = async () => {
    setRetrying(true);
    const { error } = await supabase
      .from("knowledge_crawl_queue" as never)
      .update({ status: "pending", error: null } as never)
      .eq("brand_id", brandId)
      .eq("status", "error");
    setRetrying(false);
    if (error) { toast.error(tt(locale, "Retry failed.", "Nuovo tentativo non riuscito.")); return; }
    toast.success(tt(locale, "Retrying failed pages…", "Nuovo tentativo sulle pagine non riuscite…"));
    await refresh();
  };

  // Toggle recent-news ingestion on/off (persisted on the website source config;
  // the weekly re-crawl honours it).
  const website = sources.find((s) => s.kind === "website");
  const newsEnabled = website?.config?.news_enabled ?? true;
  const handleToggleNews = async (next: boolean) => {
    if (!website) { toast.message(tt(locale, "Run a crawl first to set this.", "Avvia prima una scansione.")); return; }
    const { error } = await supabase
      .from("knowledge_sources" as never)
      .update({ config: { ...(website.config ?? {}), news_enabled: next } } as never)
      .eq("brand_id", brandId)
      .eq("kind", "website");
    if (error) { toast.error(tt(locale, "Couldn't update.", "Aggiornamento non riuscito.")); return; }
    setSources((prev) => prev.map((s) => (s.kind === "website" ? { ...s, config: { ...(s.config ?? {}), news_enabled: next } } : s)));
    toast.success(next ? tt(locale, "Recent news will be included.", "Le news recenti saranno incluse.") : tt(locale, "Recent news turned off.", "News recenti disattivate."));
  };

  const totalChunks = docs.reduce((s, d) => s + (d.chunk_count ?? 0), 0);

  if (!brandId) {
    return <div className="p-8 text-sm text-muted-foreground">{tt(locale, "No brand context.", "Nessun contesto brand.")}</div>;
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <BookOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">{tt(locale, "Knowledge base", "Knowledge base")}</h1>
            <p className="text-sm text-muted-foreground">
              {tt(locale,
                "What your AI Assistant knows about your products, brand and policies.",
                "Cosa sa il tuo Assistente AI su prodotti, brand e policy.")}
            </p>
          </div>
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setScrapeOpen(true)}
              disabled={scraping}
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {scraping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
              {tt(locale, "Scrape website", "Leggi il sito")}
            </button>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <UploadCloud className="h-4 w-4" />
              {tt(locale, "Upload files", "Carica file")}
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              {tt(locale, "Add document", "Aggiungi documento")}
            </button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="flex gap-3">
        <Stat label={tt(locale, "Documents", "Documenti")} value={docs.length} />
        <Stat label={tt(locale, "Knowledge chunks", "Sezioni indicizzate")} value={totalChunks} />
        {pending > 0 && (
          <div className="flex items-center gap-2 self-center rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {tt(locale, `Indexing… ${pending} pages left`, `Indicizzazione… ${pending} pagine rimaste`)}
          </div>
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          className="ml-auto flex items-center gap-1.5 self-center rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" /> {tt(locale, "Refresh", "Aggiorna")}
        </button>
      </div>

      {/* Sources & crawl */}
      {canWrite && (website || failed.length > 0) && (
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {website && (
              <div className="flex items-center gap-2 text-sm">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <a href={website.target ?? undefined} target="_blank" rel="noreferrer" className="max-w-[220px] truncate font-medium text-foreground hover:underline" title={website.target ?? ""}>
                  {(website.target ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
                {website.last_seeded_at && (
                  <span className="text-xs text-muted-foreground">· {tt(locale, "crawled", "scansionato")} {new Date(website.last_seeded_at).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB")}</span>
                )}
              </div>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <Newspaper className="h-4 w-4 text-muted-foreground" />
              {tt(locale, "Include recent news", "Includi news recenti")}
              <input type="checkbox" checked={newsEnabled} onChange={(e) => void handleToggleNews(e.target.checked)} className="h-4 w-4 accent-primary" />
            </label>
            <button
              type="button"
              onClick={() => setAddUrlOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              <Link2 className="h-3.5 w-3.5" /> {tt(locale, "Add page URL", "Aggiungi URL")}
            </button>
            {failed.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                {tt(locale, `${failed.length} page${failed.length > 1 ? "s" : ""} failed`, `${failed.length} pagine non riuscite`)}
                <button
                  type="button"
                  onClick={() => void handleRetryFailed()}
                  disabled={retrying}
                  className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  {retrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />} {tt(locale, "Retry", "Riprova")}
                </button>
              </div>
            )}
          </div>
          {failed.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">{tt(locale, "Show failed pages", "Mostra pagine non riuscite")}</summary>
              <ul className="mt-1.5 max-h-32 space-y-1 overflow-auto text-xs">
                {failed.slice(0, 50).map((f) => (
                  <li key={f.id} className="flex gap-2">
                    <span className="max-w-[280px] truncate text-foreground" title={f.url}>{f.url.replace(/^https?:\/\//, "")}</span>
                    <span className="truncate text-muted-foreground" title={f.error ?? ""}>— {f.error ?? "error"}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* List */}
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {tt(locale, "Loading…", "Caricamento…")}
          </div>
        ) : docs.length === 0 ? (
          <div className="flex h-56 flex-col items-center justify-center gap-2 text-center">
            <BookOpen className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">{tt(locale, "No knowledge yet", "Ancora nessun contenuto")}</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {tt(locale,
                "Scrape your website or add a document so the Assistant can answer about your brand.",
                "Leggi il tuo sito o aggiungi un documento così l'Assistente potrà rispondere sul tuo brand.")}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60 backdrop-blur">
              <tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
                <th className="px-4 py-2.5">{tt(locale, "Title", "Titolo")}</th>
                <th className="px-3 py-2.5">{tt(locale, "Category", "Categoria")}</th>
                <th className="px-3 py-2.5">{tt(locale, "Source", "Origine")}</th>
                <th className="px-3 py-2.5 text-right">{tt(locale, "Chunks", "Sezioni")}</th>
                <th className="px-3 py-2.5">{tt(locale, "Status", "Stato")}</th>
                {canWrite && <th className="px-3 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                  <td className="max-w-xs px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium text-foreground" title={d.title}>{d.title}</span>
                    </div>
                    {d.source_url && (
                      <a href={d.source_url} target="_blank" rel="noreferrer" className="ml-5 block truncate text-[11px] text-primary/80 hover:underline">
                        {d.source_url}
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                      {tt(locale, CATEGORY_LABEL[d.category]?.en ?? d.category, CATEGORY_LABEL[d.category]?.it ?? d.category)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {d.source_type === "url" ? tt(locale, "Website", "Sito") : d.source_type === "upload" ? tt(locale, "Upload", "Caricato") : tt(locale, "Manual", "Manuale")}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{d.chunk_count}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={d.status} error={d.error} locale={locale} /></td>
                  {canWrite && (
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          onClick={() => setPreviewDoc(d)}
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          aria-label={tt(locale, "Preview", "Anteprima")}
                          title={tt(locale, "Preview indexed sections", "Anteprima sezioni indicizzate")}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditDoc(d)}
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          aria-label={tt(locale, "Edit", "Modifica")}
                          title={tt(locale, "Edit", "Modifica")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(d)}
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          aria-label={tt(locale, "Delete", "Elimina")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {addOpen && (
        <AddDocModal
          locale={locale}
          onClose={() => setAddOpen(false)}
          onSubmit={async (title, category, content) => {
            await callFn("ingest-knowledge", { title, category, content, source_type: "manual", brand_id: brandId });
            setAddOpen(false);
            toast.success(tt(locale, "Document added.", "Documento aggiunto."));
            await refresh();
          }}
        />
      )}

      {uploadOpen && (
        <UploadModal
          locale={locale}
          brandId={brandId}
          callFn={callFn}
          onClose={() => setUploadOpen(false)}
          onDone={() => void refresh()}
        />
      )}

      {scrapeOpen && (
        <ConfirmModal
          locale={locale}
          title={tt(locale, "Crawl your whole website?", "Scansionare tutto il sito?")}
          body={tt(locale,
            "I'll crawl your brand's entire public website (every page) plus recent news, and index it. It runs in the background and refreshes weekly; only changed pages are re-indexed. Pages appear here as they're processed.",
            "Scansionerò l'intero sito pubblico del brand (tutte le pagine) più le news recenti, e lo indicizzerò. Gira in background e si aggiorna ogni settimana; solo le pagine modificate vengono re-indicizzate. Le pagine compaiono qui man mano.")}
          confirmLabel={tt(locale, "Start full crawl", "Avvia scansione")}
          onCancel={() => setScrapeOpen(false)}
          onConfirm={handleScrape}
        />
      )}

      {addUrlOpen && (
        <AddUrlModal locale={locale} onClose={() => setAddUrlOpen(false)} onSubmit={handleAddUrls} />
      )}

      {editDoc && (
        <EditDocModal
          locale={locale}
          doc={editDoc}
          onClose={() => setEditDoc(null)}
          onSubmit={async (title, category, content) => {
            await callFn("update-knowledge", { doc_id: editDoc.id, title, category, content, brand_id: brandId });
            setEditDoc(null);
            toast.success(tt(locale, "Document updated.", "Documento aggiornato."));
            await refresh();
          }}
        />
      )}

      {previewDoc && (
        <PreviewChunksModal locale={locale} doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      )}
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-lg border border-border bg-card px-4 py-2">
    <div className="text-lg font-semibold tabular-nums text-foreground">{value.toLocaleString()}</div>
    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
  </div>
);

const StatusBadge = ({ status, error, locale }: { status: string; error: string | null; locale: string }) => {
  if (status === "ready") {
    return <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> {tt(locale, "Ready", "Pronto")}</span>;
  }
  if (status === "processing") {
    return <span className="inline-flex items-center gap-1 text-xs text-amber-600"><Clock className="h-3.5 w-3.5" /> {tt(locale, "Processing", "In corso")}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-destructive" title={error ?? ""}>
      <AlertCircle className="h-3.5 w-3.5" /> {tt(locale, "Error", "Errore")}
    </span>
  );
};

const AddDocModal = ({
  locale, onClose, onSubmit,
}: {
  locale: string;
  onClose: () => void;
  onSubmit: (title: string, category: string, content: string) => Promise<void>;
}) => {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("product");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || !content.trim()) return;
    setBusy(true);
    try { await onSubmit(title.trim(), category, content.trim()); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">{tt(locale, "Add document", "Aggiungi documento")}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={tt(locale, "Title (e.g. Leather care guide)", "Titolo (es. Guida alla cura della pelle)")}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{tt(locale, CATEGORY_LABEL[c].en, CATEGORY_LABEL[c].it)}</option>
            ))}
          </select>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={tt(locale, "Paste the document text here…", "Incolla qui il testo del documento…")}
            rows={10}
            className="resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">{tt(locale, "Cancel", "Annulla")}</button>
          <button
            onClick={() => void submit()}
            disabled={busy || !title.trim() || !content.trim()}
            className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {tt(locale, "Add", "Aggiungi")}
          </button>
        </div>
      </div>
    </Overlay>
  );
};

type UpItem = { id: string; file: File; status: "queued" | "uploading" | "parsing" | "done" | "error"; note?: string };

const UploadModal = ({
  locale, brandId, callFn, onClose, onDone,
}: {
  locale: string;
  brandId: number;
  callFn: (fn: string, body: Record<string, unknown>) => Promise<{ chunk_count?: number; truncated?: boolean } & Record<string, unknown>>;
  onClose: () => void;
  onDone: () => void;
}) => {
  const [category, setCategory] = useState("other");
  const [items, setItems] = useState<UpItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  const update = (id: string, patch: Partial<UpItem>) =>
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const allowed = UPLOAD_ACCEPT.split(",").map((e) => e.replace(".", "").toLowerCase());
    const next: UpItem[] = [];
    for (const file of Array.from(list)) {
      const ext = (file.name.split(".").pop() ?? "").toLowerCase();
      if (!allowed.includes(ext)) {
        toast.error(tt(locale, `${file.name}: unsupported type`, `${file.name}: tipo non supportato`));
        continue;
      }
      if (file.size > UPLOAD_MAX_MB * 1024 * 1024) {
        toast.error(tt(locale, `${file.name}: over ${UPLOAD_MAX_MB}MB`, `${file.name}: oltre ${UPLOAD_MAX_MB}MB`));
        continue;
      }
      next.push({ id: crypto.randomUUID(), file, status: "queued" });
    }
    if (next.length) setItems((prev) => [...prev, ...next]);
  };

  const start = async () => {
    const queued = items.filter((i) => i.status === "queued");
    if (queued.length === 0) return;
    setBusy(true);
    let ok = 0;
    for (const it of queued) {
      update(it.id, { status: "uploading", note: undefined });
      const ext = (it.file.name.split(".").pop() ?? "bin").toLowerCase();
      const path = `${brandId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(UPLOAD_BUCKET)
        .upload(path, it.file, { upsert: false, contentType: it.file.type || undefined });
      if (upErr) {
        update(it.id, { status: "error", note: upErr.message });
        continue;
      }
      update(it.id, { status: "parsing" });
      try {
        const r = await callFn("parse-knowledge", { storage_path: path, filename: it.file.name, category });
        const secs = `${r.chunk_count} ${tt(locale, "sections", "sezioni")}`;
        update(it.id, { status: "done", note: r.truncated ? `${secs} · ${tt(locale, "truncated", "troncato")}` : secs });
        ok++;
      } catch (e) {
        update(it.id, { status: "error", note: e instanceof Error ? e.message : "failed" });
        // Best-effort cleanup so a failed parse doesn't orphan the raw file.
        void supabase.storage.from(UPLOAD_BUCKET).remove([path]);
      }
    }
    setBusy(false);
    if (ok) {
      toast.success(tt(locale, `Indexed ${ok} file${ok > 1 ? "s" : ""}.`, `Indicizzati ${ok} file.`));
      onDone();
    }
  };

  const queuedCount = items.filter((i) => i.status === "queued").length;

  return (
    <Overlay onClose={busy ? () => {} : onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">{tt(locale, "Upload files", "Carica file")}</h2>
          <button onClick={onClose} disabled={busy} className="text-muted-foreground hover:text-foreground disabled:opacity-40"><X className="h-4 w-4" /></button>
        </div>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          disabled={busy}
          className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{tt(locale, CATEGORY_LABEL[c].en, CATEGORY_LABEL[c].it)}</option>
          ))}
        </select>

        <label
          onDragOver={(e) => { e.preventDefault(); if (!busy) setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) addFiles(e.dataTransfer.files); }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${drag ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"} ${busy ? "pointer-events-none opacity-60" : ""}`}
        >
          <UploadCloud className="h-6 w-6 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{tt(locale, "Drag files here or click to browse", "Trascina i file qui o clicca per sceglierli")}</span>
          <span className="text-xs text-muted-foreground">PDF · DOCX · PPTX · TXT · MD · CSV · {tt(locale, `max ${UPLOAD_MAX_MB}MB`, `max ${UPLOAD_MAX_MB}MB`)}</span>
          <input type="file" accept={UPLOAD_ACCEPT} multiple className="hidden" disabled={busy}
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        </label>

        {items.length > 0 && (
          <div className="mt-3 max-h-52 space-y-1.5 overflow-auto">
            {items.map((it) => (
              <div key={it.id} className="flex items-center gap-2 rounded-lg border border-border/60 px-2.5 py-1.5 text-sm">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-foreground" title={it.file.name}>{it.file.name}</span>
                <UploadItemStatus item={it} locale={locale} />
                {it.status === "queued" && !busy && (
                  <button onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))} className="text-muted-foreground hover:text-destructive" aria-label="remove">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40">
            {tt(locale, "Close", "Chiudi")}
          </button>
          <button
            onClick={() => void start()}
            disabled={busy || queuedCount === 0}
            className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy
              ? tt(locale, "Indexing…", "Indicizzazione…")
              : tt(locale, `Upload${queuedCount ? ` ${queuedCount}` : ""}`, `Carica${queuedCount ? ` ${queuedCount}` : ""}`)}
          </button>
        </div>
      </div>
    </Overlay>
  );
};

const UploadItemStatus = ({ item, locale }: { item: UpItem; locale: string }) => {
  if (item.status === "queued") return <span className="text-xs text-muted-foreground">{tt(locale, "queued", "in coda")}</span>;
  if (item.status === "uploading") return <span className="inline-flex items-center gap-1 text-xs text-amber-600"><Loader2 className="h-3 w-3 animate-spin" /> {tt(locale, "uploading", "caricamento")}</span>;
  if (item.status === "parsing") return <span className="inline-flex items-center gap-1 text-xs text-amber-600"><Loader2 className="h-3 w-3 animate-spin" /> {tt(locale, "indexing", "indicizzazione")}</span>;
  if (item.status === "done") return <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3 w-3" /> {item.note}</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-destructive" title={item.note}><AlertCircle className="h-3 w-3" /> {tt(locale, "failed", "errore")}</span>;
};

const ConfirmModal = ({
  locale, title, body, confirmLabel, onCancel, onConfirm,
}: {
  locale: string; title: string; body: string; confirmLabel: string;
  onCancel: () => void; onConfirm: () => void;
}) => (
  <Overlay onClose={onCancel}>
    <div className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
      <h2 className="mb-2 text-base font-semibold text-foreground">{title}</h2>
      <p className="mb-4 text-sm text-muted-foreground">{body}</p>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">{tt(locale, "Cancel", "Annulla")}</button>
        <button onClick={onConfirm} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">{confirmLabel}</button>
      </div>
    </div>
  </Overlay>
);

const Overlay = ({ children, onClose }: { children: React.ReactNode; onClose: () => void }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
    {children}
  </div>
);

// ── Add specific page URLs to the crawl queue ─────────────────────────────────
const AddUrlModal = ({
  locale, onClose, onSubmit,
}: { locale: string; onClose: () => void; onSubmit: (urls: string[]) => Promise<void> }) => {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const urls = text.split(/\s+/).map((u) => u.trim()).filter(Boolean)
      .map((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`))
      .filter((u) => { try { new URL(u); return true; } catch { return false; } });
    const unique = [...new Set(urls)];
    if (!unique.length) { toast.error(tt(locale, "Enter at least one valid URL.", "Inserisci almeno un URL valido.")); return; }
    setBusy(true);
    try { await onSubmit(unique); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">{tt(locale, "Add page URLs", "Aggiungi URL")}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">{tt(locale, "One URL per line. They'll be crawled and indexed in the background.", "Un URL per riga. Verranno scansionati e indicizzati in background.")}</p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5}
          placeholder={"https://brand.com/heritage\nhttps://brand.com/care"}
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">{tt(locale, "Cancel", "Annulla")}</button>
          <button onClick={() => void submit()} disabled={busy || !text.trim()}
            className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{tt(locale, "Add to crawl", "Aggiungi")}
          </button>
        </div>
      </div>
    </Overlay>
  );
};

// ── Edit an existing doc (title / category / content). A content change
// re-chunks + re-embeds via the update-knowledge edge fn. ──────────────────────
const EditDocModal = ({
  locale, doc, onClose, onSubmit,
}: {
  locale: string; doc: Doc;
  onClose: () => void;
  onSubmit: (title: string, category: string, content: string) => Promise<void>;
}) => {
  const [title, setTitle] = useState(doc.title);
  const [category, setCategory] = useState(doc.category);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const options = CATEGORIES.includes(doc.category) ? CATEGORIES : [...CATEGORIES, doc.category];

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase.from("brand_knowledge_docs" as never).select("content").eq("id", doc.id).maybeSingle();
      if (!alive) return;
      setContent(((data as unknown as { content?: string } | null)?.content) ?? "");
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [doc.id]);

  const submit = async () => {
    if (!title.trim() || !content.trim()) return;
    setBusy(true);
    try { await onSubmit(title.trim(), category, content.trim()); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <Overlay onClose={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">{tt(locale, "Edit document", "Modifica documento")}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {tt(locale, "Loading…", "Caricamento…")}</div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tt(locale, "Title", "Titolo")}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
              {options.map((c) => <option key={c} value={c}>{tt(locale, CATEGORY_LABEL[c]?.en ?? c, CATEGORY_LABEL[c]?.it ?? c)}</option>)}
            </select>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={12}
              className="min-h-0 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            <p className="text-xs text-muted-foreground">{tt(locale, "Changing the text re-indexes this document.", "Modificando il testo il documento viene re-indicizzato.")}</p>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">{tt(locale, "Cancel", "Annulla")}</button>
          <button onClick={() => void submit()} disabled={busy || loading || !title.trim() || !content.trim()}
            className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{tt(locale, "Save", "Salva")}
          </button>
        </div>
      </div>
    </Overlay>
  );
};

// ── Preview the indexed chunks of a doc (what the assistant actually retrieves).
const PreviewChunksModal = ({ locale, doc, onClose }: { locale: string; doc: Doc; onClose: () => void }) => {
  const [chunks, setChunks] = useState<{ chunk_index: number; content: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase.from("brand_knowledge_chunks" as never)
        .select("chunk_index, content").eq("doc_id", doc.id).order("chunk_index", { ascending: true }).limit(300);
      if (!alive) return;
      setChunks((data as unknown as { chunk_index: number; content: string }[]) ?? []);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [doc.id]);

  return (
    <Overlay onClose={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="truncate text-base font-semibold text-foreground" title={doc.title}>{doc.title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{tt(locale, `${chunks.length} indexed section${chunks.length === 1 ? "" : "s"} — what the Assistant searches.`, `${chunks.length} sezioni indicizzate — ciò che l'Assistente cerca.`)}</p>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto">
          {loading ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {tt(locale, "Loading…", "Caricamento…")}</div>
          ) : chunks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{tt(locale, "No indexed sections.", "Nessuna sezione indicizzata.")}</p>
          ) : chunks.map((c) => (
            <div key={c.chunk_index} className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{tt(locale, "Section", "Sezione")} {c.chunk_index + 1}</div>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{c.content}</p>
            </div>
          ))}
        </div>
      </div>
    </Overlay>
  );
};
