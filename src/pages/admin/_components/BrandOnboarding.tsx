import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Check, X, Play, RefreshCw, Copy, Trash2, AlertCircle } from "lucide-react";

// Prepare-demo panel: takes a brand that has just been created (name + website)
// all the way to something you can put in front of a prospect — site crawled and
// indexed, catalogue pulled, a believable book of business, and logins for both
// portals. Each stage runs on its own so a long crawl that needs a second pass
// doesn't mean starting the brand over.

type StageKey = "sources" | "storefront" | "demo_data" | "demo_users" | "assistant";

const STAGES: { key: StageKey; label: string; hint: string }[] = [
  { key: "sources", label: "Website & news", hint: "Register the site, discover pages, start the crawl" },
  { key: "storefront", label: "Catalogue", hint: "Detect the e-commerce feed and pull the products" },
  { key: "demo_data", label: "Demo book of business", hint: "Clients, covers, boutiques, claims and feedback" },
  { key: "demo_users", label: "Demo logins", hint: "Brand admin, sales associate and a client account" },
  { key: "assistant", label: "Assistant", hint: "Confirm there is enough indexed to answer questions" },
];

type StageRow = { stage: string; status: string; detail: Record<string, unknown>; error: string | null };
type Status = {
  demo_ready: boolean;
  blocking: string[];
  storefront: { platform: string; base_url: string; enabled: boolean } | null;
  counts: Record<string, number>;
  stages: StageRow[];
};
type Account = { email: string; password: string; portal: string };

export default function BrandOnboarding({ brandId, brandName, website }: {
  brandId: number; brandName: string; website: string | null;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Record<string, Account> | null>(null);
  const [avgTicket, setAvgTicket] = useState("");
  const [needsTicket, setNeedsTicket] = useState(false);
  const poll = useRef<number | null>(null);

  const call = useCallback(async (payload: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("onboard-brand", {
      body: { brand_id: brandId, ...payload },
    });
    if (error) throw new Error(error.message);
    if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    return data as Record<string, unknown>;
  }, [brandId]);

  const refresh = useCallback(async () => {
    try { setStatus(await call({ action: "status" }) as unknown as Status); } catch { /* transient */ }
  }, [call]);

  useEffect(() => { void refresh(); }, [refresh]);

  // While the crawl drains its queue (a per-minute cron job does the work), keep
  // the counts moving so the admin can see it is actually progressing.
  useEffect(() => {
    const pending = status?.counts?.crawl_pending ?? 0;
    if (pending > 0 && poll.current === null) {
      poll.current = window.setInterval(() => { void refresh(); }, 15000);
    }
    if (pending === 0 && poll.current !== null) {
      window.clearInterval(poll.current); poll.current = null;
    }
    return () => { if (poll.current !== null) { window.clearInterval(poll.current); poll.current = null; } };
  }, [status?.counts?.crawl_pending, refresh]);

  const run = async (stages?: StageKey[]) => {
    const label = stages?.length === 1 ? STAGES.find((s) => s.key === stages[0])?.label ?? "Stage" : "Demo preparation";
    setBusy(stages?.length === 1 ? stages[0] : "all");
    setNeedsTicket(false);
    try {
      const options: Record<string, unknown> = {};
      if (avgTicket.trim()) options.avg_ticket = Number(avgTicket.trim());
      const out = await call({ stages, options });
      const ran = (out.ran ?? {}) as Record<string, Record<string, unknown>>;
      if (ran.demo_users?.accounts) setAccounts(ran.demo_users.accounts as Record<string, Account>);
      setStatus(out.status as unknown as Status);

      const failed = Object.entries(ran).find(([, v]) => v?.ok === false);
      if (failed) {
        if (failed[1]?.needs === "avg_ticket") setNeedsTicket(true);
        toast({ title: `${label} stopped`, description: String(failed[1]?.reason ?? "see the stage detail"), variant: "destructive" });
      } else {
        toast({ title: `${label} complete` });
      }
    } catch (e) {
      toast({ title: `${label} failed`, description: e instanceof Error ? e.message : "unknown error", variant: "destructive" });
    } finally { setBusy(null); }
  };

  const purge = async () => {
    if (!confirm(`Remove ALL generated demo data for ${brandName}?\n\nClients, covers, boutiques, claims and feedback created by "Prepare demo" are deleted. Real data is untouched.`)) return;
    setBusy("purge");
    try {
      const out = await call({ action: "purge_demo" });
      toast({ title: "Demo data removed", description: JSON.stringify((out.purged as Record<string, unknown>)?.deleted ?? {}) });
      await refresh();
    } catch (e) {
      toast({ title: "Purge failed", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" });
    } finally { setBusy(null); }
  };

  const stageStatus = (key: StageKey) => status?.stages?.find((s) => s.stage === key);
  const c = status?.counts ?? {};

  return (
    <div className="space-y-5">
      {!website && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>This brand has no website yet. Add one on the brand record — everything below is built from it.</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void run()}
          disabled={!website || busy !== null}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Prepare demo
        </button>
        <button onClick={() => void refresh()} disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
        <button onClick={() => void purge()} disabled={busy !== null}
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive disabled:opacity-50">
          {busy === "purge" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Remove demo data
        </button>
      </div>

      {status && (
        <div className={`rounded-lg border p-3 text-sm ${status.demo_ready ? "border-emerald-500/40 bg-emerald-500/10" : "border-border bg-muted/40"}`}>
          {status.demo_ready
            ? <span className="font-medium text-emerald-700 dark:text-emerald-400">Demo ready — both portals have something to show.</span>
            : <span className="text-muted-foreground">Not demo ready yet: {status.blocking.join(" · ")}</span>}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{c.knowledge_docs ?? 0} pages indexed ({c.knowledge_chunks ?? 0} chunks)</span>
            {(c.crawl_pending ?? 0) > 0 && <span className="text-amber-600">{c.crawl_pending} pages still crawling…</span>}
            <span>{c.products ?? 0} products</span>
            <span>{c.customers ?? 0} clients</span>
            <span>{c.policies ?? 0} covers</span>
            <span>{c.shops ?? 0} boutiques</span>
            <span>{c.brand_users ?? 0} logins</span>
          </div>
        </div>
      )}

      {needsTicket && (
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm">This site renders its prices in JavaScript, so none could be scraped. Give a typical retail price and the demo covers will be valued around it — the pieces themselves stay real.</p>
          <div className="mt-2 flex items-center gap-2">
            <input value={avgTicket} onChange={(e) => setAvgTicket(e.target.value)} inputMode="numeric" placeholder="e.g. 4200"
              className="w-36 rounded-md border border-border bg-background px-3 py-2 text-sm" />
            <span className="text-sm text-muted-foreground">EUR</span>
            <button onClick={() => void run(["demo_data"])} disabled={!avgTicket.trim() || busy !== null}
              className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">Generate</button>
          </div>
        </div>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {STAGES.map((s) => {
          const st = stageStatus(s.key);
          const state = busy === s.key ? "running" : st?.status ?? "pending";
          return (
            <li key={s.key} className="flex items-start gap-3 p-3">
              <span className="mt-0.5">
                {state === "done" ? <Check className="h-4 w-4 text-emerald-600" />
                  : state === "failed" ? <X className="h-4 w-4 text-destructive" />
                  : state === "running" ? <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  : <span className="block h-4 w-4 rounded-full border border-border" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{s.label}</p>
                <p className="text-xs text-muted-foreground">{st?.error ?? detailLine(st) ?? s.hint}</p>
              </div>
              <button onClick={() => void run([s.key])} disabled={!website || busy !== null}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50">
                {state === "done" ? "Re-run" : "Run"}
              </button>
            </li>
          );
        })}
      </ul>

      {accounts && (
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm font-medium">Demo logins</p>
          <p className="mb-2 text-xs text-muted-foreground">Hand these to the prospect. Re-running the stage keeps the same credentials.</p>
          <ul className="space-y-2">
            {Object.entries(accounts).map(([key, a]) => (
              <li key={key} className="flex items-center gap-2 text-sm">
                <span className="w-32 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{key.replace(/_/g, " ")}</span>
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{a.email} · {a.password}</code>
                <span className="shrink-0 text-xs text-muted-foreground">{a.portal}</span>
                <button className="shrink-0 rounded border border-border p-1"
                  onClick={() => { void navigator.clipboard.writeText(`${a.email} / ${a.password}`); toast({ title: "Copied" }); }}>
                  <Copy className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// One line of "what actually landed" per stage, so a green tick is auditable.
function detailLine(st?: StageRow): string | null {
  if (!st || st.status === "pending") return null;
  const d = st.detail ?? {};
  const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : null);
  switch (st.stage) {
    case "storefront":
      return d.platform === "none" ? String(d.note ?? "no product feed on this site")
        : `${n("products") ?? 0} products from ${String(d.base ?? "the shop")}`;
    case "demo_data":
      return d.ok === false ? String(d.reason ?? "")
        : `${n("customers") ?? 0} clients · ${n("policies") ?? 0} covers · ${n("shops") ?? 0} boutiques — prices ${String(d.prices ?? "")}`;
    case "demo_users":
      return d.accounts ? `${Object.keys(d.accounts as object).length} accounts created` : null;
    case "assistant":
      return `${n("knowledge_chunks") ?? 0} chunks indexed`;
    default:
      return d.website ? `crawling ${String(d.website)}` : null;
  }
}
