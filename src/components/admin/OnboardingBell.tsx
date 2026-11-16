// Brands being set up, and the ones that just finished — in the admin header, wherever you are.
//
// Creating a brand starts half an hour of background work. The pipeline panel on the brand's
// own page shows it live, but only to someone with that page open, and the finish email only
// reaches the admin who pressed the button. On 2026-11-16 Giulio created Shaft and had to ask
// Luca to watch it. This is the same news for every admin, in the app: a spinner while
// something is building, a count when something has finished, and a toast the moment it does.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Building2, Check, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import {
  reviewItems, runOutcome, stageLabel, type ReviewStageRow,
} from "../../../supabase/functions/_shared/onboarding-review";

// The tables are newer than the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Run = {
  id: string; brand_id: number; started_by_email: string;
  started_at: string; settled_at: string | null;
};
type BrandRow = { id: number; name: string | null; legal_name: string | null; registered_address: string | null; hq_address: string | null };

export type RunView = {
  id: string; brandId: number; brandName: string; startedBy: string;
  startedAt: string; settledAt: string | null;
  done: number; total: number; running: string | null;
  failed: string[]; unfinished: string[]; toCheck: number;
};

const SEEN_KEY = "aion.admin.onboarding.seen";
const readSeen = (): number => {
  try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; }
};
const writeSeen = (t: number) => {
  try { localStorage.setItem(SEEN_KEY, String(t)); } catch { /* private window: the badge just stays */ }
};

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

async function loadRuns(): Promise<RunView[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: runs, error } = await db.from("brand_onboarding_runs")
    .select("id, brand_id, started_by_email, started_at, settled_at")
    .gte("started_at", since).order("started_at", { ascending: false }).limit(15);
  if (error) throw error;
  const list = (runs ?? []) as Run[];
  if (!list.length) return [];
  const ids = [...new Set(list.map((r) => r.brand_id))];
  const [{ data: brands }, { data: stages }] = await Promise.all([
    db.from("brands").select("id, name, legal_name, registered_address, hq_address").in("id", ids),
    db.from("brand_onboarding").select("brand_id, stage, status, error, detail, queued_at").in("brand_id", ids),
  ]);
  const brandOf = new Map(((brands ?? []) as BrandRow[]).map((b) => [b.id, b]));
  const rowsOf = new Map<number, ReviewStageRow[]>();
  for (const r of (stages ?? []) as (ReviewStageRow & { brand_id: number })[]) {
    rowsOf.set(r.brand_id, [...(rowsOf.get(r.brand_id) ?? []), r]);
  }
  return list.map((run) => {
    const rows = rowsOf.get(run.brand_id) ?? [];
    const o = runOutcome(rows);
    const b = brandOf.get(run.brand_id);
    const running = rows.find((r) => r.status === "running")?.stage
      ?? rows.find((r) => r.status === "pending" && r.queued_at && r.detail?.continue)?.stage ?? null;
    return {
      id: run.id, brandId: run.brand_id, brandName: b?.name ?? `Brand ${run.brand_id}`,
      startedBy: run.started_by_email.split("@")[0],
      startedAt: run.started_at, settledAt: run.settled_at,
      done: o.done.length + o.skipped.length,
      total: rows.length - o.notApplicable.length,
      running: running ? stageLabel(running) : null,
      failed: o.failed, unfinished: o.unfinished,
      // Only worth counting once it has finished: mid-run, half the list is about stages
      // that have not run yet.
      toCheck: run.settled_at ? reviewItems(rows, b).length : 0,
    };
  });
}

export function useOnboardingRuns() {
  return useQuery({
    queryKey: ["admin-onboarding-runs"],
    queryFn: loadRuns,
    // Fast while something is building, slow otherwise: a run is half an hour long, but the
    // moment it finishes is the moment worth hearing about.
    refetchInterval: (q) => ((q.state.data as RunView[] | undefined)?.some((r) => !r.settledAt) ? 20_000 : 120_000),
    refetchIntervalInBackground: true,
  });
}

export default function OnboardingBell() {
  const navigate = useNavigate();
  const { data: runs = [] } = useOnboardingRuns();
  const [seen, setSeen] = useState(readSeen);
  const open = runs.filter((r) => !r.settledAt);
  const unread = runs.filter((r) => r.settledAt && new Date(r.settledAt).getTime() > seen);

  // A toast when a run finishes while the app is open — only for runs this tab watched
  // building, so opening the app does not replay last week.
  const watching = useRef<Set<string> | null>(null);
  useEffect(() => {
    const prev = watching.current;
    watching.current = new Set(runs.filter((r) => !r.settledAt).map((r) => r.id));
    if (!prev) return;
    for (const r of runs) {
      if (!r.settledAt || !prev.has(r.id)) continue;
      const title = r.failed.length
        ? `${r.brandName}: ${r.failed.map(stageLabel).join(", ")} failed`
        : `${r.brandName} is set up`;
      toast(title, {
        description: r.toCheck ? `${r.toCheck} thing${r.toCheck === 1 ? "" : "s"} to check before a client sees it.` : "Nothing flagged to check.",
        duration: 15_000,
        action: { label: "Open", onClick: () => navigate(`/admin/brands/${r.brandId}?tab=cycle`) },
      });
    }
  }, [runs, navigate]);

  const markSeen = () => { const t = Date.now(); writeSeen(t); setSeen(t); };
  const go = (r: RunView) => navigate(`/admin/brands/${r.brandId}?tab=cycle`);

  const label = open.length
    ? `${open.length} brand${open.length === 1 ? "" : "s"} being set up`
    : unread.length ? `${unread.length} brand${unread.length === 1 ? "" : "s"} finished setting up` : "Brand setup";

  const sorted = useMemo(() => [...open, ...runs.filter((r) => r.settledAt)], [open, runs]);

  return (
    <Popover onOpenChange={(o) => { if (!o && unread.length) markSeen(); }}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} title={label}
          className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          {open.length ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <Building2 className="h-4 w-4" />}
          {unread.length > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
              {unread.length > 9 ? "9+" : unread.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b border-border px-3 py-2">
          <p className="text-sm font-semibold text-foreground">Brand setup</p>
          <p className="text-[11px] text-muted-foreground">Runs started in the last 7 days, by any admin.</p>
        </div>
        {sorted.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">No brand has been set up this week.</p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {sorted.map((r) => {
              const isNew = r.settledAt && new Date(r.settledAt).getTime() > seen;
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => go(r)}
                    className="flex w-full gap-2.5 px-3 py-2.5 text-left hover:bg-muted/50">
                    <span className="mt-0.5 shrink-0">
                      {!r.settledAt ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        : r.failed.length ? <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                        : <Check className="h-3.5 w-3.5 text-emerald-600" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{r.brandName}</span>
                        {isNew && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="new" />}
                        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{ago(r.settledAt ?? r.startedAt)}</span>
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {!r.settledAt
                          ? `${r.done} of ${r.total} done${r.running ? ` · ${r.running}` : ""}`
                          : r.failed.length
                          ? `${r.failed.map(stageLabel).join(", ")} failed`
                          : r.unfinished.length
                          ? `still going after 6 h: ${r.unfinished.map(stageLabel).join(", ")}`
                          : r.toCheck ? `Ready · ${r.toCheck} to check` : "Ready · nothing flagged"}
                      </span>
                      <span className="block text-[11px] text-muted-foreground/70">started by {r.startedBy}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
