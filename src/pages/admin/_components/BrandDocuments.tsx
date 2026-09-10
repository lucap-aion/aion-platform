import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { untyped } from "@/integrations/supabase/untyped";
// The standalone `toast`, not `useToast().toast`: the hook returns a fresh
// object every render, so a fetcher that lists it as a dependency re-runs on
// every render — an infinite loop that never leaves the spinner.
import { toast } from "@/hooks/use-toast";
import {
  Loader2, ChevronDown, ChevronRight, Check, Copy, RefreshCw, Globe,
  AlertCircle, ExternalLink, Undo2, FileText,
} from "lucide-react";
import AssistantMarkdown from "@/components/assistant/AssistantMarkdown";

// The paperwork the onboarding run drafted, and what happens to it next.
//
// generate-brand-docs has been writing these since July and nothing has ever
// displayed one. The FAQ is the sharp end: each draft is already rendered into
// the block shape the public FAQ page expects, and approve_brand_faq() moves it
// there — so a brand can have a finished, source-cited FAQ sitting in a table
// while its public FAQ page is empty, which is exactly the state all three
// brands on dev were in.
//
// These are DRAFTS written by a model from the brand's own site. The sources are
// shown on every one, not tucked away, because that is how you catch a document
// grounded in the wrong pages — one of these FAQs cites the Arabic locale of the
// brand's site, which you would never know from reading the prose.

type Doc = {
  id: number;
  kind: string;
  locale: string;
  title: string;
  body_md: string;
  body_json: unknown[] | null;
  status: "draft" | "approved" | "published";
  model: string | null;
  sources: { url?: string; title?: string; category?: string }[];
  generated_at: string;
  approved_at: string | null;
};

const KINDS: { key: string; label: string; blurb: string }[] = [
  { key: "faq", label: "Customer FAQ", blurb: "Lands on the brand's public FAQ page once published" },
  { key: "associate_onepager", label: "Sales-floor one-pager", blurb: "What an associate holds when they pitch the cover" },
  { key: "cover_summary", label: "Cover summary", blurb: "What the cover actually does, in plain language" },
  { key: "welcome_email", label: "Activation email", blurb: "What the client receives when their cover starts" },
  { key: "partnership_proposal", label: "Partnership proposal", blurb: "The commercial proposal for the brand itself" },
];

const STATUS_STYLE: Record<string, string> = {
  draft: "border-border text-muted-foreground",
  approved: "border-primary/40 text-primary",
  published: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
};

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;

export default function BrandDocuments({ brandId, brandName }: { brandId: number; brandName: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [faqLive, setFaqLive] = useState<{ en: boolean; it: boolean }>({ en: false, it: false });

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: rows }, { data: brand }] = await Promise.all([
      untyped.from("brand_documents").select("*").eq("brand_id", brandId).order("kind"),
      supabase.from("brands").select("faq_en, faq_it").eq("id", brandId).maybeSingle(),
    ]);
    setDocs((rows ?? []) as unknown as Doc[]);
    // Whether the FAQ is actually on the public page — the document's own status
    // says what we intended, the brands row says what a visitor sees.
    setFaqLive({ en: brand?.faq_en != null, it: brand?.faq_it != null });
    setLoading(false);
  }, [brandId]);

  useEffect(() => { void load(); }, [load]);

  const byKind = (kind: string, locale = "en") => docs.find((d) => d.kind === kind && d.locale === locale);

  const generate = async (kinds: string[], locales: string[], label: string) => {
    setBusy(label);
    try {
      const { data, error } = await supabase.functions.invoke("generate-brand-docs", {
        body: { brand_id: brandId, kinds, locales, force: true },
      });
      if (error) throw new Error(error.message);
      const d = data as { ok?: boolean; reason?: string; documents?: Record<string, { ok?: boolean; reason?: string }> };
      if (d.ok === false) throw new Error(d.reason ?? "the generator declined");
      const failed = Object.entries(d.documents ?? {}).filter(([, v]) => v?.ok === false);
      if (failed.length) {
        toast({
          title: `${failed.length} of ${Object.keys(d.documents ?? {}).length} could not be written`,
          description: failed.map(([k, v]) => `${k}: ${v.reason ?? "unknown"}`).join(" · "),
          variant: "destructive",
        });
      } else {
        toast({ title: "Drafted", description: "Read it before it goes anywhere near a client." });
      }
      await load();
    } catch (e) {
      toast({ title: "Could not draft", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" });
    } finally { setBusy(null); }
  };

  const setStatus = async (doc: Doc, status: Doc["status"]) => {
    setBusy(`status-${doc.id}`);
    const { error } = await untyped.from("brand_documents")
      .update({ status, approved_at: status === "draft" ? null : new Date().toISOString() } as never)
      .eq("id", doc.id);
    setBusy(null);
    if (error) { toast({ title: "Could not update", description: error.message, variant: "destructive" }); return; }
    await load();
  };

  // The FAQ is the one document that goes somewhere public, so it gets its own
  // path — and its own way back down.
  const publishFaq = async (publish: boolean) => {
    setBusy("faq");
    const { data, error } = await untyped.rpc(publish ? "approve_brand_faq" : "unpublish_brand_faq", { p_brand_id: brandId });
    setBusy(null);
    if (error) { toast({ title: publish ? "Could not publish" : "Could not unpublish", description: error.message, variant: "destructive" }); return; }
    const d = data as { ok?: boolean; reason?: string; faq_en?: number; faq_it?: number };
    if (d?.ok === false) { toast({ title: "Nothing to publish", description: d.reason, variant: "destructive" }); return; }
    toast({
      title: publish ? "FAQ is live" : "FAQ taken down",
      description: publish
        ? `${d?.faq_en ?? 0} entries in English${d?.faq_it ? `, ${d.faq_it} in Italian` : ""} on ${brandName}'s FAQ page.`
        : `${brandName}'s FAQ page is empty again and the drafts are back to draft.`,
    });
    await load();
  };

  if (loading) {
    return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading documents…
    </div>;
  }

  const missing = KINDS.filter((k) => !byKind(k.key));
  const faqEn = byKind("faq"); const faqIt = byKind("faq", "it");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs text-muted-foreground">
          Drafted from {brandName}'s own indexed site. Every one is a draft for a human to approve —
          check the sources on each, not just the prose.
        </p>
        <button onClick={() => void generate(KINDS.map((k) => k.key), ["en"], "all")}
          disabled={busy !== null}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs disabled:opacity-50">
          {busy === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {docs.length ? "Redraft all" : "Draft all five"}
        </button>
      </div>

      {docs.length === 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>Nothing drafted yet. The brand's site has to be indexed first — that's the Website &amp; news stage above.</span>
        </div>
      )}

      {/* Where the FAQ actually stands, which is not the same as its status. */}
      {faqEn && (
        <div className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm ${
          faqLive.en ? "border-emerald-500/40 bg-emerald-500/10" : "border-border bg-muted/30"}`}>
          <Globe className={`h-4 w-4 shrink-0 ${faqLive.en ? "text-emerald-600" : "text-muted-foreground"}`} />
          <span className="min-w-0 flex-1">
            {faqLive.en
              ? <>The FAQ is live on {brandName}'s public page{faqLive.it ? ", in English and Italian" : ", in English only"}.</>
              : <>{brandName}'s public FAQ page is <strong>empty</strong>. This draft has {faqEn.body_json?.length ?? 0} entries ready to go on it.</>}
          </span>
          {faqLive.en ? (
            <button onClick={() => void publishFaq(false)} disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs disabled:opacity-50">
              {busy === "faq" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Take it down
            </button>
          ) : (
            <button onClick={() => void publishFaq(true)} disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
              {busy === "faq" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />} Publish to the FAQ page
            </button>
          )}
          {!faqIt && (
            <button onClick={() => void generate(["faq"], ["it"], "faq-it")} disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs disabled:opacity-50">
              {busy === "faq-it" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Draft it in Italian
            </button>
          )}
        </div>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {KINDS.map((k) => {
          const doc = byKind(k.key);
          const it = k.key === "faq" ? faqIt : undefined;
          const isOpen = open === k.key;
          return (
            <li key={k.key}>
              <div className="flex items-start gap-3 p-3">
                <button onClick={() => setOpen(isOpen ? null : k.key)} disabled={!doc}
                  className="mt-0.5 shrink-0 text-muted-foreground disabled:opacity-30">
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{k.label}</p>
                    {doc && (
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_STYLE[doc.status]}`}>
                        {doc.status}
                      </span>
                    )}
                    {it && <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">+ IT</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {doc
                      ? <>{k.blurb} · drafted {when(doc.generated_at)} from {doc.sources?.length ?? 0} pages</>
                      : <>{k.blurb} · <span className="text-amber-600">not drafted</span></>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {doc && doc.status === "draft" && (
                    <button onClick={() => void setStatus(doc, "approved")} disabled={busy !== null}
                      title="Mark this draft approved"
                      className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50">
                      {busy === `status-${doc.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : "Approve"}
                    </button>
                  )}
                  {doc && doc.status === "approved" && (
                    <button onClick={() => void setStatus(doc, "draft")} disabled={busy !== null}
                      title="Back to draft" className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50">
                      Unapprove
                    </button>
                  )}
                  <button onClick={() => void generate([k.key], ["en"], k.key)} disabled={busy !== null}
                    title={doc ? "Draft it again from scratch" : "Draft this document"}
                    className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50">
                    {busy === k.key ? <Loader2 className="h-3 w-3 animate-spin" /> : doc ? "Redraft" : "Draft"}
                  </button>
                </div>
              </div>

              {isOpen && doc && (
                <div className="space-y-3 border-t border-border bg-muted/20 p-4">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{doc.title}</p>
                    <button
                      onClick={() => { void navigator.clipboard.writeText(doc.body_md); toast({ title: "Markdown copied" }); }}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs">
                      <Copy className="h-3 w-3" /> Copy
                    </button>
                  </div>

                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <AssistantMarkdown>{doc.body_md}</AssistantMarkdown>
                  </div>

                  {doc.sources?.length > 0 && (
                    <details className="rounded-lg border border-border bg-background p-3">
                      <summary className="cursor-pointer text-xs font-medium text-foreground">
                        Written from {doc.sources.length} page{doc.sources.length === 1 ? "" : "s"}
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {doc.sources.map((s, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                            <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                            <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:text-foreground hover:underline">
                              {s.title || s.url}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  <p className="text-[11px] text-muted-foreground">
                    {doc.model ? `Drafted by ${doc.model}. ` : ""}
                    {doc.approved_at ? `Approved ${when(doc.approved_at)}.` : "Not approved yet."}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {missing.length > 0 && docs.length > 0 && (
        <button onClick={() => void generate(missing.map((m) => m.key), ["en"], "missing")}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs disabled:opacity-50">
          {busy === "missing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Draft the {missing.length} that {missing.length === 1 ? "is" : "are"} missing
        </button>
      )}
    </div>
  );
}
