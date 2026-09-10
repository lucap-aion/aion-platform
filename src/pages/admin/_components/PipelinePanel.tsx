import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { AlertCircle, Check, Circle, Clock, Loader2, Play, SkipForward } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PIPELINE_STAGES, type PipelineStage, type StageState,
  stageDisplayState, summarisePipeline,
} from "@/lib/commercialCycle";

// What the background pipeline is doing, once.
//
// This used to be two components. A banner at the top of the cycle drew ten stage chips
// with no way to act on any of them, and a panel buried inside step 3 drew seven of the
// same stages again — same keys, same labels, its own Run buttons, its own Refresh, its own
// poller on a different interval. The two lists were hand-maintained copies that had
// already drifted, product counts appeared three times on one screen, and there were two
// Refresh buttons about two hundred pixels apart.
//
// So: one list, one definition (src/lib/commercialCycle.ts), no poller. The parent owns
// polling and passes the stage rows down, because it is already reading them for the steps.

type Props = {
  brandId: number;
  brandName: string;
  website: string | null;
  /** Undefined until the overview has been read — NOT the same as "no stage has run". */
  stages: Record<string, StageState> | undefined;
  /** Demo stages are hidden entirely where they cannot run — see demoAllowedForBrand. */
  demoAllowed: boolean;
  demoBlockedReason?: string | null;
  /** Called once work has been queued, so the parent can reload and start polling. */
  onQueued: () => void;
};

const ICON: Record<string, React.ReactNode> = {
  done: <Check className="h-3 w-3" />,
  running: <Loader2 className="h-3 w-3 animate-spin" />,
  failed: <AlertCircle className="h-3 w-3" />,
  queued: <Clock className="h-3 w-3" />,
  skipped: <SkipForward className="h-3 w-3" />,
  pending: <Circle className="h-3 w-3 opacity-40" />,
};

const CHIP: Record<string, string> = {
  done: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  running: "border-primary/50 bg-primary/10 text-primary",
  failed: "border-destructive/40 bg-destructive/5 text-destructive",
  queued: "border-primary/40 bg-primary/5 text-primary",
  skipped: "border-border text-muted-foreground/60",
  pending: "border-border text-muted-foreground",
};

export default function PipelinePanel({
  brandId, brandName, website, stages, demoAllowed, demoBlockedReason, onQueued,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const visible = PIPELINE_STAGES.filter((s) => demoAllowed || !s.demo);
  const summary = summarisePipeline(stages, visible);
  const at = (s: PipelineStage) => stageDisplayState(stages?.[s.key], busy === s.key);

  // Open on the stage that needs a person: the first failure, else whatever is running.
  // A pipeline that stopped four stages ago should not need a click to say so.
  //
  // Keyed on the stage KEYS, not on the objects: `summary.failed` is a fresh array every
  // render, so depending on it would re-run this effect on every render for the whole life
  // of the panel.
  const wantsAttention = summary.failed[0]?.key ?? summary.running?.key ?? null;
  useEffect(() => {
    if (open || !wantsAttention) return;
    setOpen(wantsAttention);
  }, [open, wantsAttention]);

  const run = async (keys: string[]) => {
    setBusy(keys.length === 1 ? keys[0] : "all");
    try {
      const { data, error } = await supabase.functions.invoke("onboard-brand", {
        body: { brand_id: brandId, action: "start", stages: keys },
      });
      if (error) throw new Error(error.message);
      const d = data as { error?: string; queued?: string[]; skipped?: string[] };
      if (d.error) throw new Error(d.error);
      const skipped = d.skipped ?? [];
      toast({
        title: keys.length === 1 ? "Stage queued" : `${(d.queued ?? []).length} stages queued`,
        description: skipped.length
          ? `${skipped.join(", ")} could not be queued here.`
          : "It runs on the server — you can close this and come back.",
      });
      onQueued();
    } catch (e) {
      toast({ title: "Could not queue", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  // Every line below is a claim about this brand — "idle", "nothing has run for this brand
  // yet", "3 of 10 done". None of them can be made before the stage rows have arrived.
  if (!stages) return <Skeleton className="h-28 w-full rounded-xl" />;

  const openStage = open ? visible.find((s) => s.key === open) ?? null : null;
  const openState = openStage ? stages?.[openStage.key] : undefined;
  const openAt = openStage ? at(openStage) : "pending";

  return (
    <div className={`overflow-hidden rounded-xl border ${
      summary.active ? "border-primary/30 bg-primary/5"
        : summary.failed.length ? "border-destructive/30 bg-destructive/5"
        : "border-border"}`}>
      <div className="flex flex-wrap items-center gap-3 p-4 pb-3">
        {summary.active
          ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          : summary.failed.length
          ? <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
          : <Check className="h-4 w-4 shrink-0 text-muted-foreground" />}

        <p className="text-sm font-medium text-foreground">
          {summary.active ? `Setting ${brandName} up` : "Pipeline"}
        </p>
        <span className="text-xs text-muted-foreground">
          {summary.active
            ? summary.running
              ? `${summary.running.label} — in progress`
              : `${summary.queued} step${summary.queued === 1 ? "" : "s"} waiting to start`
            : summary.failed.length
            ? `${summary.failed.length === 1 ? "One stage" : `${summary.failed.length} stages`} could not complete`
            : summary.total === 0
            ? "nothing has run for this brand yet"
            : "idle"}
        </span>

        <div className="ml-auto flex items-center gap-3">
          {summary.total > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground">{summary.done} of {summary.total} done</span>
          )}
          <button
            onClick={() => void run(visible.map((s) => s.key))}
            disabled={!website || busy !== null || summary.active}
            title={!website ? "This brand has no website — everything below is built from it" : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs disabled:opacity-50"
          >
            {busy === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {summary.total === 0 ? "Run everything" : "Re-run everything"}
          </button>
        </div>
      </div>

      {/* Indeterminate on purpose: the stages take wildly different times — a crawl is
          minutes, a deck is seconds — so a percentage would be a lie that appears to stall. */}
      {summary.total > 0 && (
        <div className="mx-4 h-1 overflow-hidden rounded-full bg-primary/15">
          <div
            className={`h-full rounded-full transition-all duration-700 ${summary.failed.length ? "bg-destructive/60" : "bg-primary/70"}`}
            style={{ width: `${Math.max(4, (summary.done / Math.max(1, summary.total)) * 100)}%` }}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 p-4 pt-3">
        {visible.map((s) => {
          const state = at(s);
          return (
            <button
              key={s.key}
              onClick={() => setOpen(open === s.key ? null : s.key)}
              aria-expanded={open === s.key}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-shadow ${CHIP[state]} ${
                open === s.key ? "ring-1 ring-foreground/30" : "hover:opacity-80"}`}
            >
              {ICON[state]}
              {s.label}
            </button>
          );
        })}
      </div>

      {openStage && (
        <div className="border-t border-border/60 bg-background/60 p-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{openStage.label}</p>
              <p className={`mt-0.5 text-xs ${openAt === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
                {openAt === "queued"
                  ? "Queued — the background runner picks it up within a minute, and nothing needs pressing."
                  : openAt === "running"
                  ? "Running now. It will land here when it finishes; you can leave the page."
                  : openState?.error ?? detailLine(openStage.key, openState) ?? openStage.hint}
              </p>
              {(openState?.attempts ?? 0) > 0 && openAt !== "done" && (
                <p className="mt-1 text-[11px] text-muted-foreground">Attempt {(openState?.attempts ?? 0) + 1} of 3.</p>
              )}
              {openAt === "skipped" && typeof openState?.detail?.reason === "string" && (
                <p className="mt-1 text-[11px] text-muted-foreground">{String(openState.detail.reason)}</p>
              )}
            </div>
            <button
              onClick={() => void run([openStage.key])}
              disabled={!website || busy !== null || openAt === "queued" || openAt === "running"}
              className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs disabled:opacity-50"
            >
              {busy === openStage.key ? "Queueing…"
                : openAt === "done" ? "Re-run"
                : openAt === "queued" ? "Queued"
                : openAt === "running" ? "Running"
                : openAt === "failed" ? "Try again"
                : "Run"}
            </button>
          </div>
        </div>
      )}

      {!demoAllowed && demoBlockedReason && (
        <p className="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">{demoBlockedReason}</p>
      )}
      {summary.active && (
        <p className="border-t border-primary/20 px-4 py-2 text-xs text-muted-foreground">
          This runs on the server — you can leave this page and come back. Steps below stay
          unavailable until the work they need has landed.
        </p>
      )}
    </div>
  );
}

// One line of "what actually landed" per stage, so a green tick is auditable.
function detailLine(stage: string, st: StageState | undefined): string | null {
  if (!st || st.status === "pending") return null;
  const d = (st.detail ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : null);
  switch (stage) {
    case "storefront":
      return d.platform === "none"
        ? String(d.note ?? "no product feed on this site")
        : `${n("products") ?? 0} products from ${String(d.base ?? "the shop")}`;
    case "demo_data":
      return d.ok === false ? String(d.reason ?? "")
        : `${n("customers") ?? 0} clients · ${n("policies") ?? 0} covers · ${n("shops") ?? 0} boutiques — prices ${String(d.prices ?? "")}`;
    case "demo_users":
      return d.accounts ? `${Object.keys(d.accounts as object).length} accounts created — they are in step 3` : null;
    case "documents": {
      if (d.waiting_for_crawl) return String(d.note ?? "waiting for the crawl");
      const failed = (d.failed as string[] | undefined) ?? [];
      return `${n("written") ?? 0} drafted${failed.length ? ` · ${failed.length} failed (${failed.join(", ")})` : ""} — on the Documents tab, for review`;
    }
    case "branding": {
      const filled = (d.filled as string[] | undefined) ?? [];
      const notes = (d.notes as string[] | undefined) ?? [];
      return filled.length
        ? `${filled.length} field${filled.length === 1 ? "" : "s"} filled: ${filled.join(", ")}${notes.length ? ` · ${notes[0]}` : ""}`
        : notes[0] ?? "nothing new to fill — the record already has it";
    }
    case "assistant": {
      const left = n("pages_still_crawling") ?? 0;
      return `${n("knowledge_chunks") ?? 0} chunks indexed${left ? ` · ${left} pages still crawling` : ""}` +
        (d.legal_requeued ? " · sent Brand identity back for the legal entity and registered office, now the site is indexed" : "");
    }
    case "intro_deck":
    case "ops_deck":
    case "data_request":
      return d.file_name ? `${String(d.file_name)} — it is on the step below` : null;
    default:
      return d.website ? `crawling ${String(d.website)}` : null;
  }
}
