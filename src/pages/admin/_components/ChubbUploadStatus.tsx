// Admin home alert card for the daily Chubb uploads done by aion_services.
// Reads from public.reports (filtered to outbound automated runs), groups by
// (date, brand, type), and lets the admin expand each card to inspect the file
// rows inline (CSV parsed in-browser; XLSX lazy-loaded via ExcelJS).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clock,
  Download, FileSpreadsheet, HelpCircle, Loader2, RefreshCw, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { parseCsv, parseXlsx } from "./chubbReportParsers";

type UploadStatus = "success" | "failed" | "pending" | "not_applicable" | "unknown";

interface ReportRow {
  id: number;
  brand_id: number | null;
  name: string | null;
  type: string | null;        // "policies" | "claims"
  direction: string | null;   // "Outbound" | "Inbound"
  source: string | null;
  url: string | null;
  upload_status: UploadStatus | null;
  upload_error: string | null;
  upload_attempts: number | null;
  row_count: number | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

interface BrandLite { id: number; name: string | null; }

const REPORT_BUCKET = (type: string | null | undefined) =>
  type === "claims" ? "claims_daily_reports" : "policies_daily_reports";

const LOOKBACK_DAYS = 3;

const bcp = (locale: string) => (locale === "it" ? "it-IT" : "en-GB");

const fmtDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(bcp(locale), {
    day: "2-digit", month: "short", year: "numeric",
  }).format(new Date(iso));

const fmtDateTime = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(bcp(locale), {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));

// ─── Component ───────────────────────────────────────────────────────────────

const ChubbUploadStatus = ({ brands }: { brands: BrandLite[] }) => {
  const { t, locale } = useLanguage();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - LOOKBACK_DAYS);
    const { data, error } = await supabase
      .from("reports")
      .select(
        "id, brand_id, name, type, direction, source, url, upload_status, upload_error, upload_attempts, row_count, start_date, end_date, created_at",
      )
      .in("type", ["policies", "claims"])
      .eq("direction", "Outbound")
      .eq("source", "automated")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) {
      console.error("[chubb-status]", error);
      toast.error(t("chubbStatus.loadFailed"));
      setLoading(false);
      return;
    }
    setRows((data ?? []) as ReportRow[]);
    setLoading(false);
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const brandName = useCallback(
    (id: number | null) =>
      brands.find((b) => b.id === id)?.name ?? (id != null ? `Brand #${id}` : "—"),
    [brands],
  );

  // Roll-up counts for the header
  const counts = useMemo(() => {
    const c = { failed: 0, pending: 0, success: 0, other: 0 };
    for (const r of rows) {
      if (r.upload_status === "failed") c.failed++;
      else if (r.upload_status === "pending") c.pending++;
      else if (r.upload_status === "success") c.success++;
      else c.other++;
    }
    return c;
  }, [rows]);

  return (
    <div className="rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-primary" />
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("chubbStatus.title")}
          </p>
          <span className="text-xs text-muted-foreground/70">
            · {t("chubbStatus.lastNDays").replace("{n}", String(LOOKBACK_DAYS))}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {counts.failed > 0 && (
            <span className="flex items-center gap-1 font-medium text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> {counts.failed} {t("chubbStatus.failed")}
            </span>
          )}
          {counts.pending > 0 && (
            <span className="flex items-center gap-1 font-medium text-amber-600">
              <Clock className="h-3.5 w-3.5" /> {counts.pending} {t("chubbStatus.pending")}
            </span>
          )}
          {counts.success > 0 && (
            <span className="flex items-center gap-1 font-medium text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> {counts.success} {t("chubbStatus.ok")}
            </span>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="ml-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label={t("chubbStatus.refresh")}
            title={t("chubbStatus.refresh")}
          >
            {loading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Body */}
      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center gap-2 px-5 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("chubbStatus.loading")}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          {t("chubbStatus.empty")}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id}>
              <UploadRow
                row={r}
                brandName={brandName(r.brand_id)}
                expanded={expandedId === r.id}
                onToggle={() => setExpandedId((id) => (id === r.id ? null : r.id))}
                locale={locale}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ─── Per-row card ───────────────────────────────────────────────────────────

const UploadRow = ({
  row,
  brandName,
  expanded,
  onToggle,
  locale,
}: {
  row: ReportRow;
  brandName: string;
  expanded: boolean;
  onToggle: () => void;
  locale: string;
}) => {
  const { t } = useLanguage();
  const typeLabel = row.type === "claims" ? t("chubbStatus.typeClaims") : t("chubbStatus.typePolicies");
  const dayLabel = row.start_date ? fmtDate(row.start_date, locale) : "—";

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-muted/40"
      >
        {expanded
          ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <StatusPill status={row.upload_status} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {brandName} <span className="text-muted-foreground">·</span> {typeLabel}
            <span className="text-muted-foreground"> · {dayLabel}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {row.name}
            {row.row_count != null && (
              <> · {row.row_count} {row.row_count === 1 ? t("aiQuery.row") : t("aiQuery.rows")}</>
            )}
            {row.upload_attempts && row.upload_attempts > 1 ? (
              <> · {row.upload_attempts} {t("chubbStatus.attempts")}</>
            ) : null}
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground/70">
          {fmtDateTime(row.created_at, locale)}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border bg-muted/20 px-5 py-4">
          {row.upload_status === "failed" && row.upload_error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-destructive">
                {t("chubbStatus.errorLabel")}
              </p>
              <p className="mt-1 text-xs text-foreground whitespace-pre-wrap">{row.upload_error}</p>
            </div>
          )}
          <FileViewer row={row} />
        </div>
      )}
    </div>
  );
};

// ─── Status pill ────────────────────────────────────────────────────────────

const StatusPill = ({ status }: { status: UploadStatus | null }) => {
  const { t } = useLanguage();
  const map: Record<UploadStatus | "null", { label: string; cls: string; Icon: any }> = {
    success: { label: t("chubbStatus.status.success"), cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", Icon: CheckCircle2 },
    failed: { label: t("chubbStatus.status.failed"), cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", Icon: XCircle },
    pending: { label: t("chubbStatus.status.pending"), cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", Icon: Clock },
    not_applicable: { label: t("chubbStatus.status.na"), cls: "bg-muted text-muted-foreground", Icon: HelpCircle },
    unknown: { label: t("chubbStatus.status.unknown"), cls: "bg-muted text-muted-foreground", Icon: HelpCircle },
    null: { label: t("chubbStatus.status.unknown"), cls: "bg-muted text-muted-foreground", Icon: HelpCircle },
  };
  const v = map[(status ?? "null") as keyof typeof map];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${v.cls}`}>
      <v.Icon className="h-3 w-3" /> {v.label}
    </span>
  );
};

// ─── File row viewer ────────────────────────────────────────────────────────

const FileViewer = ({ row }: { row: ReportRow }) => {
  const { t } = useLanguage();
  const [columns, setColumns] = useState<string[] | null>(null);
  const [data, setData] = useState<string[][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!row.url) {
        setError(t("chubbStatus.noFile"));
        setLoading(false);
        return;
      }
      try {
        const bucket = REPORT_BUCKET(row.type);
        const { data: signed, error: signErr } = await supabase.storage
          .from(bucket)
          .createSignedUrl(row.url, 60 * 30);
        if (signErr || !signed?.signedUrl) {
          throw new Error(signErr?.message ?? "Couldn't sign URL");
        }
        if (cancelled) return;
        setDownloadUrl(signed.signedUrl);
        const res = await fetch(signed.signedUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const isXlsx = (row.name ?? "").toLowerCase().endsWith(".xlsx");
        if (isXlsx) {
          const buf = await res.arrayBuffer();
          const parsed = await parseXlsx(buf);
          if (cancelled) return;
          setColumns(parsed.columns);
          setData(parsed.rows);
        } else {
          const text = await res.text();
          const parsed = parseCsv(text);
          if (cancelled) return;
          setColumns(parsed.columns);
          setData(parsed.rows);
        }
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message ?? "Failed to load file");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [row.id, row.url, row.type, row.name, t]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("chubbStatus.loadingFile")}
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-xs text-destructive">
        {t("chubbStatus.fileError")}: {error}
      </p>
    );
  }
  if (!columns || columns.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("chubbStatus.empty")}</p>;
  }

  // Only show columns that have at least one non-empty value — Chubb sales
  // file has ~200 cols mostly blank for AION. Keeps the inline table readable.
  const nonEmptyCols = columns
    .map((c, i) => ({ name: c, i, hasValue: data.some((r) => (r[i] ?? "").trim() !== "") }))
    .filter((c) => c.hasValue);
  const visibleData = data.slice(0, 50);

  return (
    <div>
      <div className="flex items-center justify-between pb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {data.length} {data.length === 1 ? t("aiQuery.row") : t("aiQuery.rows")}
          {nonEmptyCols.length < columns.length && (
            <> · {t("chubbStatus.colsHidden")
              .replace("{shown}", String(nonEmptyCols.length))
              .replace("{total}", String(columns.length))}</>
          )}
        </p>
        {downloadUrl && (
          <a
            href={downloadUrl}
            download={row.name ?? "report"}
            className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
          >
            <Download className="h-3 w-3" /> {t("aiQuery.download")}
          </a>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>
              {nonEmptyCols.map((c) => (
                <th key={c.i} className="px-3 py-1.5 text-left font-semibold text-muted-foreground">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleData.map((r, ri) => (
              <tr key={ri} className="border-t border-border/60">
                {nonEmptyCols.map((c) => (
                  <td key={c.i} className="px-3 py-1.5 text-foreground tabular-nums">
                    {r[c.i] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.length > visibleData.length && (
        <p className="mt-2 text-[11px] text-muted-foreground/70">
          {t("chubbStatus.truncated")
            .replace("{shown}", String(visibleData.length))
            .replace("{total}", String(data.length))}
        </p>
      )}
    </div>
  );
};

export default ChubbUploadStatus;
