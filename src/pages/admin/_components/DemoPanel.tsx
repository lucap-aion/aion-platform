import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { AlertCircle, Copy, Loader2, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { StageState } from "@/lib/commercialCycle";

// The demo itself: is there anything to show, the logins to hand over, and the way to take
// it all out again at hand-over.
//
// This was BrandOnboarding — a second screen inside step 3 that drew its own copy of the
// stage list, its own Refresh button and its own eight-second poller against a function the
// parent was already polling every six seconds. The stages moved to PipelinePanel, which
// there is now exactly one of; the parent owns the polling; and what is left here is the
// part that was actually about the demo.

type Account = { email: string; password: string; portal: string };
type PurgePreview = {
  will_remove: Record<string, number>;
  will_remove_logins: { email: string; role: string }[];
  will_keep: Record<string, number>;
};

type Props = {
  brandId: number;
  brandName: string;
  stages: Record<string, StageState> | undefined;
  /** Undefined until the overview has been read. "Not demo ready yet" is a verdict. */
  counts: Record<string, number> | undefined;
  demoAllowed: boolean;
  demoBlockedReason?: string | null;
  onChanged: () => void;
};

export default function DemoPanel({
  brandId, brandName, stages, counts, demoAllowed, demoBlockedReason, onChanged,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [avgTicket, setAvgTicket] = useState("");
  const [preview, setPreview] = useState<PurgePreview | null>(null);

  const call = async (payload: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("onboard-brand", {
      body: { brand_id: brandId, ...payload },
    });
    if (error) throw new Error(error.message);
    if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    return data as Record<string, unknown>;
  };

  // Both of these are facts about the RUN, not about this component, so they are read from
  // the stage rows the parent already has. As component state they survived nothing — not a
  // refresh, and not a colleague opening the same brand.
  const accounts = useMemo(() => {
    const d = stages?.demo_users?.detail as { accounts?: Record<string, Account> } | undefined;
    return d?.accounts ?? null;
  }, [stages]);

  // The generator reports { ok: false, needs: 'avg_ticket' } for a site that renders its
  // prices in JavaScript. That is a question for the admin, not a failure.
  const needsTicket = (stages?.demo_data?.detail as { needs?: string } | undefined)?.needs === "avg_ticket";

  const c = counts ?? {};
  const ready = (c.knowledge_chunks ?? 0) > 0 && (c.policies ?? 0) > 0
    && (c.customers ?? 0) > 0 && (c.brand_users ?? 0) > 0;
  const blocking = [
    (c.knowledge_chunks ?? 0) === 0 && "nothing indexed yet (Website & news)",
    (c.customers ?? 0) === 0 && "no clients (Demo book of business)",
    (c.policies ?? 0) === 0 && "no covers (Demo book of business)",
    (c.brand_users ?? 0) === 0 && "no logins (Demo logins)",
  ].filter(Boolean) as string[];

  const generateWithTicket = async () => {
    setBusy("ticket");
    try {
      await call({ action: "start", stages: ["demo_data"], options: { avg_ticket: Number(avgTicket.trim()) } });
      toast({ title: "Queued", description: "The book of business is being rebuilt around that price." });
      onChanged();
    } catch (e) {
      toast({ title: "Could not queue", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" });
    } finally { setBusy(null); }
  };

  // Never purge blind: fetch exactly what would go and what would stay, and make the admin
  // confirm against that list.
  const openPurge = async () => {
    setBusy("purge");
    try { setPreview(await call({ action: "preview_purge" }) as unknown as PurgePreview); }
    catch (e) { toast({ title: "Could not read the demo data", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const confirmPurge = async () => {
    setBusy("purge");
    try {
      const out = await call({ action: "purge_demo" });
      const removed = (out.removed_logins as string[] | undefined)?.length ?? 0;
      toast({
        title: "Demo data removed",
        description: `${sumCounts((out.purged as { deleted?: Record<string, number> })?.deleted)} rows and ${removed} login${removed === 1 ? "" : "s"} deleted. The brand, its indexed site and its catalogue are untouched.`,
      });
      setPreview(null);
      onChanged();
    } catch (e) {
      toast({ title: "Purge failed", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" });
    } finally { setBusy(null); }
  };

  if (!counts) return <Skeleton className="h-24 w-full rounded-lg" />;

  if (!demoAllowed) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {demoBlockedReason ??
            "Demo generation is not available for this brand here. Crawling, catalogue, documents and the assistant all run."}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={`rounded-lg border p-3 text-sm ${ready ? "border-emerald-500/40 bg-emerald-500/10" : "border-border bg-muted/40"}`}>
        {ready
          ? <span className="font-medium text-emerald-700 dark:text-emerald-400">Demo ready — both portals have something to show.</span>
          : <span className="text-muted-foreground">Not demo ready yet: {blocking.join(" · ")}</span>}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{c.customers ?? 0} clients</span>
          <span>{c.policies ?? 0} covers</span>
          <span>{c.shops ?? 0} boutiques</span>
          <span>{c.brand_users ?? 0} logins</span>
          {(c.crawl_pending ?? 0) > 0 && (
            <span className="text-amber-600">{c.crawl_pending} pages still crawling…</span>
          )}
        </div>
      </div>

      {needsTicket && (
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm">
            This site renders its prices in JavaScript, so none could be scraped. Give a typical retail
            price and the demo covers will be valued around it — the pieces themselves stay real.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={avgTicket} onChange={(e) => setAvgTicket(e.target.value)} inputMode="numeric" placeholder="e.g. 4200"
              className="w-36 rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <span className="text-sm text-muted-foreground">EUR</span>
            <button onClick={() => void generateWithTicket()} disabled={!avgTicket.trim() || busy !== null}
              className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">
              {busy === "ticket" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generate"}
            </button>
          </div>
        </div>
      )}

      {accounts && (
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm font-medium">Demo logins</p>
          <p className="mb-2 text-xs text-muted-foreground">
            Hand these to the prospect. Re-running the stage keeps the same credentials.
          </p>
          <ul className="space-y-2">
            {Object.entries(accounts).map(([key, a]) => (
              <li key={key} className="flex items-center gap-2 text-sm">
                <span className="w-32 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{key.replace(/_/g, " ")}</span>
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{a.email} · {a.password}</code>
                <span className="shrink-0 text-xs text-muted-foreground">{a.portal}</span>
                <button
                  className="shrink-0 rounded border border-border p-1"
                  onClick={() => { void navigator.clipboard.writeText(`${a.email} / ${a.password}`); toast({ title: "Copied" }); }}
                  aria-label={`Copy the ${key.replace(/_/g, " ")} login`}
                >
                  <Copy className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-medium">Hand the account over to {brandName}?</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Everything generated for the demo is deleted. Everything harvested from the brand — the
            indexed site, the news, the catalogue, the brand record itself — stays.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-destructive">Deleted</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {Object.entries(preview.will_remove ?? {}).map(([k, n]) => <li key={k}>{n} {label(k)}</li>)}
                {preview.will_remove_logins?.map((l) => <li key={l.email} className="truncate">login {l.email}</li>)}
                {!Object.keys(preview.will_remove ?? {}).length && !preview.will_remove_logins?.length && (
                  <li>nothing — no demo data on this brand</li>
                )}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Kept</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {Object.entries(preview.will_keep ?? {}).map(([k, n]) => <li key={k}>{n} {label(k)}</li>)}
              </ul>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => void confirmPurge()} disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50">
              {busy === "purge" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete the demo data
            </button>
            <button onClick={() => setPreview(null)} disabled={busy !== null}
              className="rounded-lg border border-border px-3 py-2 text-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => void openPurge()} disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive disabled:opacity-50">
          {busy === "purge" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Remove demo data
        </button>
      )}
    </div>
  );
}

function sumCounts(o?: Record<string, number>): number {
  return Object.values(o ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

const LABELS: Record<string, string> = {
  profiles: "demo clients", policies: "demo covers", catalogues: "demo catalogue items",
  shops: "demo boutiques", claims: "demo claims", feedback: "demo feedback",
  events: "seeded events", event_attendees: "seeded attendees",
  brand_record: "brand record", knowledge_docs: "indexed pages",
  knowledge_chunks: "knowledge chunks", knowledge_sources: "knowledge sources",
  catalogue_products: "catalogue products", real_customers: "real clients",
  real_policies: "real covers",
};
function label(key: string): string {
  return LABELS[key] ?? key.replace(/_/g, " ");
}
