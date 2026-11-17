import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Loader2, RefreshCw, Share2, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import ReportView from "@/components/assistant/ReportView";
import { deleteDashboard, listDashboards, runDashboard, setDashboardShared, type Dashboard } from "@/lib/dashboards";

const tt = (locale: string, en: string, it: string) => (locale === "it" ? it : en);
const nameOf = (d: Dashboard) =>
  [d.owner?.first_name, d.owner?.last_name].filter(Boolean).join(" ") || d.owner?.email || "";

/**
 * The brand's own Insights: reports kept from the assistant, each run again when it is opened,
 * so it shows today's numbers. Yours, and the ones colleagues shared with the team.
 */
export default function SavedDashboards({ brandId, profileId, isMaster, locale }: {
  brandId: number; profileId: string | null; isMaster: boolean; locale: string;
}) {
  const { data: dashboards = [], isLoading } = useQuery({
    queryKey: ["brand-dashboards", brandId],
    queryFn: () => listDashboards(brandId),
  });

  if (isLoading) {
    return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{tt(locale, "Loading…", "Caricamento…")}</div>;
  }
  if (!dashboards.length) {
    return (
      <div className="glass-card mx-auto max-w-xl px-6 py-10 text-center">
        <LayoutDashboard className="mx-auto mb-3 h-8 w-8 text-primary" />
        <p className="font-serif text-lg text-foreground">{tt(locale, "No dashboards yet", "Ancora nessuna dashboard")}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {tt(locale,
            "Ask the AI Assistant for a chart or a report — \"sales by collection this quarter as a chart\" — then press Save as dashboard. It appears here and updates itself every time you open it.",
            "Chiedi all'Assistente AI un grafico o un report — \"vendite per collezione questo trimestre in un grafico\" — poi premi Salva come dashboard. Compare qui e si aggiorna ogni volta che la apri.")}
        </p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      {dashboards.map((d) => (
        <DashboardCard key={d.id} d={d} mine={d.owner_profile_id === profileId} isMaster={isMaster} locale={locale} />
      ))}
    </div>
  );
}

function DashboardCard({ d, mine, isMaster, locale }: { d: Dashboard; mine: boolean; isMaster: boolean; locale: string }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const run = useQuery({
    queryKey: ["brand-dashboard-run", d.id],
    queryFn: () => runDashboard(d.id),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const refreshList = () => queryClient.invalidateQueries({ queryKey: ["brand-dashboards"] });

  const toggleShared = async () => {
    try {
      await setDashboardShared(d.id, !d.shared);
      toast.success(d.shared
        ? tt(locale, "Only you can see it now.", "Ora la vedi solo tu.")
        : tt(locale, "Shared with your team.", "Condivisa con il team."));
      refreshList();
    } catch (e) { toast.error(e instanceof Error ? e.message : "error"); }
  };
  const remove = async () => {
    try { await deleteDashboard(d.id); refreshList(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "error"); }
  };

  const controls = (
    <>
      <button type="button" onClick={() => void run.refetch()} disabled={run.isFetching}
        title={tt(locale, "Run it again now", "Aggiorna ora")}
        className="inline-flex items-center rounded-lg border border-border bg-background p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
        <RefreshCw className={`h-3.5 w-3.5 ${run.isFetching ? "animate-spin" : ""}`} />
      </button>
      {mine && (
        <button type="button" onClick={() => void toggleShared()}
          title={d.shared ? tt(locale, "Stop sharing with the team", "Smetti di condividere") : tt(locale, "Share with the team", "Condividi con il team")}
          className={`inline-flex items-center rounded-lg border p-1.5 hover:bg-muted ${d.shared ? "border-primary/40 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}>
          <Share2 className="h-3.5 w-3.5" />
        </button>
      )}
      {(mine || isMaster) && (
        confirming ? (
          <button type="button" onClick={() => void remove()}
            className="inline-flex items-center rounded-lg bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground">
            {tt(locale, "Delete", "Elimina")}
          </button>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} title={tt(locale, "Delete", "Elimina")}
            className="inline-flex items-center rounded-lg border border-border bg-background p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )
      )}
    </>
  );

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        {d.shared && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary"><Users className="h-3 w-3" />{tt(locale, "Team", "Team")}</span>}
        {!mine && nameOf(d) && <span>{tt(locale, "by", "di")} {nameOf(d)}</span>}
      </div>
      {run.isLoading ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />{d.title}
        </div>
      ) : run.error ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="font-serif text-lg text-foreground">{d.title}</p>
          <p className="mt-1 text-sm text-destructive">{(run.error as Error).message}</p>
          <div className="mt-3 flex gap-2">{controls}</div>
        </div>
      ) : run.data ? (
        <ReportView report={run.data.report} locale={locale} extraActions={controls} />
      ) : null}
    </div>
  );
}
