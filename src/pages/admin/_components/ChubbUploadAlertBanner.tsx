// Banner shown at the top of the admin home when the daily Chubb uploads
// have issues. Beyond the simple metadata checks (failed status, stuck
// pending), this scans the actual rows inside the uploaded files in the
// 14-day window and flags DB cover events (NEW / CAN) that haven't been
// uploaded yet — because the cron sometimes ships day D's file on day D+1.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { parseCsv, parseXlsx } from "./chubbReportParsers";

const LOOKBACK_DAYS = 14;
const STUCK_PENDING_MS = 24 * 60 * 60 * 1000;
const POLICIES_BUCKET = "policies_daily_reports";

interface ReportRow {
  id: number;
  brand_id: number | null;
  name: string | null;
  type: string | null;
  url: string | null;
  upload_status: string | null;
  created_at: string;
}

interface BrandRow {
  id: number;
  name: string | null;
  chubb_policy_prefix: string | null;
}

interface MissingEvent {
  policyId: number;
  policyNumber: string;
  brandName: string;
  txType: "NEW" | "CAN";
  eventDate: string;
}

const chubbPolicyNumber = (prefix: string, id: number) =>
  prefix + String(id).padStart(15 - prefix.length, "0");

const ChubbUploadAlertBanner = () => {
  const { t } = useLanguage();
  const [state, setState] = useState<{
    loading: boolean;
    failedCount: number;
    pendingStuckCount: number;
    missing: MissingEvent[];
  }>({ loading: true, failedCount: 0, pendingStuckCount: 0, missing: [] });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - LOOKBACK_DAYS);
    const sinceIso = since.toISOString();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayStartIso = todayStart.toISOString();

    // Reports + chubb-enabled brands in parallel
    const [reportsRes, brandsRes] = await Promise.all([
      supabase
        .from("reports")
        .select("id, brand_id, name, type, url, upload_status, created_at")
        .eq("type", "policies")
        .eq("direction", "Outbound")
        .eq("source", "automated")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(80),
      supabase
        .from("brands")
        .select("id, name, chubb_policy_prefix")
        .eq("enable_chubb_reporting", true),
    ]);

    const reports = (reportsRes.data ?? []) as ReportRow[];
    const brands = (brandsRes.data ?? []) as BrandRow[];

    const failedCount = reports.filter((r) => r.upload_status === "failed").length;
    const stuckCutoff = Date.now() - STUCK_PENDING_MS;
    const pendingStuckCount = reports.filter(
      (r) => r.upload_status === "pending" && new Date(r.created_at).getTime() < stuckCutoff,
    ).length;

    // Scan file contents → set of "<Policy_Number>|<Transaction_type>"
    const seen = new Set<string>();
    await Promise.all(
      reports
        .filter((r) => r.url && r.brand_id != null)
        .map(async (r) => {
          try {
            const { data: blob, error } = await supabase.storage
              .from(POLICIES_BUCKET)
              .download(r.url!);
            if (error || !blob) return;
            const isXlsx = (r.name ?? "").toLowerCase().endsWith(".xlsx");
            const parsed = isXlsx
              ? await parseXlsx(await blob.arrayBuffer())
              : parseCsv(await blob.text());
            const pnIdx = parsed.columns.indexOf("Policy_Number");
            const ttIdx = parsed.columns.indexOf("Transaction_type");
            if (pnIdx === -1 || ttIdx === -1) return;
            for (const row of parsed.rows) {
              const pn = (row[pnIdx] ?? "").trim();
              const tt = (row[ttIdx] ?? "").trim().toUpperCase();
              if (pn && (tt === "NEW" || tt === "CAN")) {
                seen.add(`${pn}|${tt}`);
              }
            }
          } catch (err) {
            console.warn("[chubb-alert] failed to scan", r.url, err);
          }
        }),
    );

    // DB policy events in the same window (excluding today's events)
    const brandIds = brands.map((b) => b.id);
    const brandById = new Map(brands.map((b) => [b.id, b]));
    const [newRes, canRes] = await Promise.all([
      brandIds.length === 0
        ? Promise.resolve({ data: [] as any[] })
        : supabase
            .from("policies")
            .select("id, brand_id, created_at")
            .in("brand_id", brandIds)
            .eq("status", "live")
            .gte("created_at", sinceIso)
            .lt("created_at", todayStartIso),
      brandIds.length === 0
        ? Promise.resolve({ data: [] as any[] })
        : supabase
            .from("policies")
            .select("id, brand_id, cancelled_at")
            .in("brand_id", brandIds)
            .eq("status", "cancelled")
            .gte("cancelled_at", sinceIso)
            .lt("cancelled_at", todayStartIso),
    ]);

    const missing: MissingEvent[] = [];
    for (const p of (newRes.data ?? []) as any[]) {
      const b = brandById.get(p.brand_id);
      if (!b?.chubb_policy_prefix) continue;
      const pn = chubbPolicyNumber(b.chubb_policy_prefix, Number(p.id));
      if (!seen.has(`${pn}|NEW`)) {
        missing.push({
          policyId: Number(p.id),
          policyNumber: pn,
          brandName: b.name ?? `Brand #${p.brand_id}`,
          txType: "NEW",
          eventDate: p.created_at,
        });
      }
    }
    for (const p of (canRes.data ?? []) as any[]) {
      const b = brandById.get(p.brand_id);
      if (!b?.chubb_policy_prefix) continue;
      const pn = chubbPolicyNumber(b.chubb_policy_prefix, Number(p.id));
      if (!seen.has(`${pn}|CAN`)) {
        missing.push({
          policyId: Number(p.id),
          policyNumber: pn,
          brandName: b.name ?? `Brand #${p.brand_id}`,
          txType: "CAN",
          eventDate: p.cancelled_at,
        });
      }
    }
    missing.sort((a, b) => (a.eventDate < b.eventDate ? 1 : -1));

    setState({ loading: false, failedCount, pendingStuckCount, missing });
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (state.loading) return null;
  const hasAny =
    state.failedCount > 0 || state.pendingStuckCount > 0 || state.missing.length > 0;
  if (!hasAny) return null;

  // Show up to 5 missing entries inline; rest collapsed into "+N more".
  const previewMissing = state.missing.slice(0, 5);
  const extraMissing = state.missing.length - previewMissing.length;

  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
        <AlertTriangle className="h-4 w-4" />
        {t("chubbStatus.alert.title")}
      </div>
      <ul className="mt-2 ml-6 list-disc space-y-0.5 text-xs text-foreground/80">
        {state.failedCount > 0 && (
          <li>{t("chubbStatus.alert.failed").replace("{n}", String(state.failedCount))}</li>
        )}
        {state.pendingStuckCount > 0 && (
          <li>{t("chubbStatus.alert.pendingStuck").replace("{n}", String(state.pendingStuckCount))}</li>
        )}
        {state.missing.length > 0 && (
          <li>
            {t("chubbStatus.alert.missingEvents").replace("{n}", String(state.missing.length))}
            <span className="text-muted-foreground">
              {" — "}
              {previewMissing.map((m) => `${m.policyNumber} (${m.txType})`).join(", ")}
              {extraMissing > 0 && t("chubbStatus.alert.moreCount").replace("{n}", String(extraMissing))}
            </span>
          </li>
        )}
      </ul>
    </div>
  );
};

export default ChubbUploadAlertBanner;
