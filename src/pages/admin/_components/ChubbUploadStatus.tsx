// Admin home alert card for the daily Chubb uploads/downloads done by
// aion_services. Reads from public.reports (automated runs only) and lets the
// admin expand each card to inspect the file rows inline (CSV parsed
// in-browser; XLSX lazy-loaded via ExcelJS). For Inbound (returned) files we
// also count Registration_Status=KO rows so the admin sees rejections at a
// glance.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Ban, CheckCircle2, ChevronDown, ChevronRight, Clock,
  Download, FileSpreadsheet, HelpCircle, Inbox, Loader2, RefreshCw, Send, XCircle,
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

// KO check state for Inbound (returned) rows. We download the file once in
// the background and count Registration_Status="KO" rows so the admin sees
// rejections without expanding each card.
type KoState =
  | { status: "loading" }
  | { status: "ready"; total: number; ko: number; hasKoColumn: boolean }
  | { status: "error" };

const ChubbUploadStatus = ({ brands }: { brands: BrandLite[] }) => {
  const { t, locale } = useLanguage();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [koByRow, setKoByRow] = useState<Record<number, KoState>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setKoByRow({});
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - LOOKBACK_DAYS);
    const { data, error } = await supabase
      .from("reports")
      .select(
        "id, brand_id, name, type, direction, source, url, upload_status, upload_error, upload_attempts, row_count, start_date, end_date, created_at",
      )
      .in("type", ["policies", "claims"])
      .in("direction", ["Outbound", "Inbound"])
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

  // Background KO scan for Inbound rows. Limited concurrency keeps signed-URL
  // generation and storage downloads from running 10+ in parallel on refresh.
  useEffect(() => {
    const inbound = rows.filter((r) => r.direction === "Inbound" && r.url);
    if (inbound.length === 0) return;
    let cancelled = false;

    setKoByRow((prev) => {
      const next = { ...prev };
      for (const r of inbound) if (!next[r.id]) next[r.id] = { status: "loading" };
      return next;
    });

    const queue = [...inbound];
    const worker = async () => {
      while (queue.length > 0) {
        const r = queue.shift();
        if (!r || cancelled) return;
        try {
          const bucket = REPORT_BUCKET(r.type);
          const { data: signed, error: signErr } = await supabase.storage
            .from(bucket)
            .createSignedUrl(r.url!, 60 * 30);
          if (signErr || !signed?.signedUrl) throw new Error(signErr?.message ?? "sign failed");
          const res = await fetch(signed.signedUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const isXlsx = (r.name ?? "").toLowerCase().endsWith(".xlsx");
          const parsed = isXlsx
            ? await parseXlsx(await res.arrayBuffer())
            : parseCsv(await res.text());
          const idx = parsed.columns.findIndex(
            (c) => c.trim().toLowerCase() === "registration_status",
          );
          let ko = 0;
          if (idx >= 0) {
            for (const row of parsed.rows) {
              if ((row[idx] ?? "").trim().toUpperCase() === "KO") ko++;
            }
          }
          if (cancelled) return;
          setKoByRow((prev) => ({
            ...prev,
            [r.id]: { status: "ready", total: parsed.rows.length, ko, hasKoColumn: idx >= 0 },
          }));
        } catch (err) {
          console.warn("[chubb-status] KO scan failed", { id: r.id, err });
          if (cancelled) return;
          setKoByRow((prev) => ({ ...prev, [r.id]: { status: "error" } }));
        }
      }
    };

    void Promise.all([worker(), worker(), worker()]);
    return () => { cancelled = true; };
  }, [rows]);

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

  // Total KO rows across all returned files where the scan has finished.
  const koTotal = useMemo(() => {
    let n = 0;
    for (const v of Object.values(koByRow)) {
      if (v.status === "ready") n += v.ko;
    }
    return n;
  }, [koByRow]);

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
          {koTotal > 0 && (
            <span className="flex items-center gap-1 font-medium text-red-600">
              <Ban className="h-3.5 w-3.5" /> {koTotal} {t("chubbStatus.ko")}
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
                koState={koByRow[r.id]}
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
  koState,
}: {
  row: ReportRow;
  brandName: string;
  expanded: boolean;
  onToggle: () => void;
  locale: string;
  koState: KoState | undefined;
}) => {
  const { t } = useLanguage();
  const typeLabel = row.type === "claims" ? t("chubbStatus.typeClaims") : t("chubbStatus.typePolicies");
  const dayLabel = row.start_date ? fmtDate(row.start_date, locale) : "—";
  const isInbound = row.direction === "Inbound";
  const inboundTotal =
    isInbound && koState?.status === "ready" ? koState.total : null;

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
        <DirectionPill direction={row.direction} />
        {isInbound && <KoBadge state={koState} />}
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
            {inboundTotal != null && row.row_count == null && (
              <> · {inboundTotal} {inboundTotal === 1 ? t("aiQuery.row") : t("aiQuery.rows")}</>
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
          <FileViewer row={row} highlightKo={isInbound} />
        </div>
      )}
    </div>
  );
};

// ─── Direction + KO pills ───────────────────────────────────────────────────

const DirectionPill = ({ direction }: { direction: string | null }) => {
  const { t } = useLanguage();
  if (direction !== "Inbound" && direction !== "Outbound") return null;
  const isInbound = direction === "Inbound";
  const Icon = isInbound ? Inbox : Send;
  const label = isInbound ? t("chubbStatus.directionReturned") : t("chubbStatus.directionSent");
  const cls = isInbound
    ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
    : "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
};

const KoBadge = ({ state }: { state: KoState | undefined }) => {
  const { t } = useLanguage();
  if (!state) return null;
  if (state.status === "loading") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> {t("chubbStatus.checkingKo")}
      </span>
    );
  }
  if (state.status === "error") return null;
  if (!state.hasKoColumn) return null;
  if (state.ko === 0) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" /> {t("chubbStatus.allOk")}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
      <Ban className="h-3 w-3" /> {state.ko} {t("chubbStatus.ko")}
    </span>
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

const FileViewer = ({ row, highlightKo = false }: { row: ReportRow; highlightKo?: boolean }) => {
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
  const koColIndex = highlightKo
    ? columns.findIndex((c) => c.trim().toLowerCase() === "registration_status")
    : -1;

  // For Inbound files with KO rows, surface the rejected ones first.
  const sortedData =
    koColIndex >= 0
      ? [...data].sort((a, b) => {
          const aKo = (a[koColIndex] ?? "").trim().toUpperCase() === "KO" ? 0 : 1;
          const bKo = (b[koColIndex] ?? "").trim().toUpperCase() === "KO" ? 0 : 1;
          return aKo - bKo;
        })
      : data;
  const visibleData = sortedData.slice(0, 50);

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
            {visibleData.map((r, ri) => {
              const isKoRow =
                koColIndex >= 0 &&
                (r[koColIndex] ?? "").trim().toUpperCase() === "KO";
              return (
                <tr
                  key={ri}
                  className={
                    isKoRow
                      ? "border-t border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30"
                      : "border-t border-border/60"
                  }
                >
                  {nonEmptyCols.map((c) => (
                    <td
                      key={c.i}
                      className={
                        isKoRow
                          ? "px-3 py-1.5 text-red-900 tabular-nums dark:text-red-200"
                          : "px-3 py-1.5 text-foreground tabular-nums"
                      }
                    >
                      {r[c.i] ?? ""}
                    </td>
                  ))}
                </tr>
              );
            })}
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
