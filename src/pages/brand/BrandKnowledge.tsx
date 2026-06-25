// BrandKnowledge — manage the brand's AI knowledge base (the RAG corpus the
// in-store Assistant answers from). Brand admins / master users can:
//   • Scrape the brand's public website (scrape-knowledge edge fn)
//   • Add a document by pasting text (ingest-knowledge edge fn)
//   • Delete documents (RLS-gated direct delete; chunks cascade)
// Everyone in the brand can view the corpus.

import { useCallback, useEffect, useState } from "react";
import {
  BookOpen, Globe, Loader2, Plus, RefreshCw, Trash2, FileText, AlertCircle,
  CheckCircle2, Clock, X,
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

const CATEGORIES = ["product", "storytelling", "policy", "training", "other"];
const CATEGORY_LABEL: Record<string, { en: string; it: string }> = {
  product: { en: "Product", it: "Prodotto" },
  storytelling: { en: "Story", it: "Storytelling" },
  policy: { en: "Policy", it: "Policy" },
  training: { en: "Training", it: "Formazione" },
  other: { en: "Other", it: "Altro" },
};

export default function BrandKnowledge() {
  const { profile, canWrite } = useAuth();
  const { locale } = useLanguage();
  const brandId = profile?.brand_id ?? null;

  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [scrapeOpen, setScrapeOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("brand_knowledge_docs" as never)
      .select("id, title, category, source_type, source_url, status, error, char_count, chunk_count, updated_at")
      .eq("brand_id", brandId)
      .order("updated_at", { ascending: false });
    setLoading(false);
    if (error) {
      console.error("[knowledge list]", error);
      toast.error(tt(locale, "Couldn't load the knowledge base.", "Impossibile caricare la knowledge base."));
      return;
    }
    setDocs((data as unknown as Doc[]) ?? []);
  }, [brandId, locale]);

  useEffect(() => { void refresh(); }, [refresh]);

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
    const tid = toast.loading(tt(locale, "Scraping your website… this can take a minute.", "Sto leggendo il sito… può richiedere un minuto."));
    try {
      const r = await callFn("scrape-knowledge", { max_pages: 14, brand_id: brandId });
      toast.success(
        tt(locale,
          `Added ${r.docs_created} pages (${r.chunks_created} chunks).`,
          `Aggiunte ${r.docs_created} pagine (${r.chunks_created} sezioni).`),
        { id: tid },
      );
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scrape failed", { id: tid });
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
        <button
          type="button"
          onClick={() => void refresh()}
          className="ml-auto flex items-center gap-1.5 self-center rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" /> {tt(locale, "Refresh", "Aggiorna")}
        </button>
      </div>

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
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => void handleDelete(d)}
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label={tt(locale, "Delete", "Elimina")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
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

      {scrapeOpen && (
        <ConfirmModal
          locale={locale}
          title={tt(locale, "Scrape your website?", "Leggere il tuo sito?")}
          body={tt(locale,
            "I'll read your brand's public website (about, products, policies) and add it to the knowledge base. Existing scraped pages are refreshed. This can take up to a minute.",
            "Leggerò il sito pubblico del brand (chi siamo, prodotti, policy) e lo aggiungerò alla knowledge base. Le pagine già lette vengono aggiornate. Può richiedere fino a un minuto.")}
          confirmLabel={tt(locale, "Scrape now", "Leggi ora")}
          onCancel={() => setScrapeOpen(false)}
          onConfirm={handleScrape}
        />
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
