// On-screen report rendered from the brand-assistant `report` event. A report is
// a generic list of sections (KPIs, charts, tables, product cards, notes), so the
// same renderer handles the client & performance presets AND any ad-hoc report.
// Exports to PDF (the rendered layout) and Excel (a sheet per data section).
import { useMemo, useRef, useState } from "react";
import {
  Bar, BarChart, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Check, Download, FileSpreadsheet, FileText, LayoutDashboard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { downloadXlsx, type Sheet } from "@/lib/reportExport";
import { downloadReportPdf } from "@/lib/reportPdf";
import { capSlices, eur as eurFmt, eurAxis, fmtCell, grp, isNumericCol } from "@/lib/reportFormat";

const tt = (locale: string, en: string, it: string) => (locale === "it" ? it : en);
const eur = (v: number | null | undefined) => (v == null ? "—" : eurFmt(Number(v)));
const numGrouped = (v: number) => grp(v);
const PALETTE = ["#2A7B5B", "#B8860B", "#8FB7A6", "#D9B25F", "#4C9E7A", "#C79A3B", "#A7CBBC", "#E4C87E"];
// The report is a document, white in both themes: inside it the colours are fixed, not
// theme tokens. With text-foreground it went near-white on white in dark mode.
const INK = "text-neutral-900", MUTED = "text-neutral-500", RULE = "border-neutral-200";

export type ReportSection =
  | { type: "kpis"; title?: string; items: { label: string; value: string }[] }
  | { type: "bar" | "line" | "pie"; title?: string; unit?: "eur" | "num"; data: { label: string; value: number }[] }
  | { type: "table"; title?: string; columns: { key: string; header: string; unit?: "eur" | "num" }[]; rows: Record<string, unknown>[] }
  | { type: "products"; title?: string; items: { name: string; subtitle?: string | null; price?: number | null; image_url?: string | null; url?: string | null }[] }
  | { type: "note"; title?: string; body: string };

export type ReportPayload = {
  title: string; subtitle?: string | null; generated_at: string;
  brand: string | null; brand_logo?: string | null; sections: ReportSection[];
  /** What built it (generate_report's input) — saved as a dashboard, it is run again. */
  spec?: Record<string, unknown>;
};

// A section with nothing in it is worse than no section at all: on screen it
// draws a headerless table, in the PDF it divides by zero laying out 0 columns,
// and in the Excel it becomes a sheet with no columns and no rows — which is
// exactly the "it generates an empty file" the associate sees. One predicate,
// applied once, so the screen, the PDF and the workbook agree on what exists.
export const sectionHasData = (s: ReportSection) =>
  s.type === "note" ? !!s.body?.trim()
  : s.type === "kpis" ? !!s.items?.length
  : s.type === "products" ? !!s.items?.length
  : s.type === "table" ? !!s.rows?.length && !!s.columns?.length
  // A chart of zeros is "no data" everywhere — on screen it said so while the PDF drew
  // empty axes and the workbook got a sheet of zeros.
  : !!s.data?.some((d) => Number(d.value) !== 0 && Number.isFinite(Number(d.value)));

const SectionTitle = ({ children }: { children: React.ReactNode }) =>
  children ? <h4 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">{children}</h4> : null;

// Many bars, or long names under them: Recharts drops the labels that would collide,
// leaving bars nobody can name. Drawn sideways instead — the PDF follows the same rule.
const barsSideways = (data: { label: string }[]) =>
  data.length > 16 || data.some((d) => String(d.label ?? "").length > 14) ||
  (data.length > 8 && data.some((d) => String(d.label ?? "").length > 9));

function Chart({ s, locale }: { s: Extract<ReportSection, { type: "bar" | "line" | "pie" }>; locale: string }) {
  const money = s.unit === "eur";
  if (!s.data?.some((d) => Number(d.value) !== 0)) {
    return <p className={`py-4 text-xs ${MUTED}`}>{tt(locale, "No data for this period.", "Nessun dato per questo periodo.")}</p>;
  }
  if (s.type === "pie") {
    // Inline slice labels overlap on small/adjacent slices — use a clean legend
    // (swatch · label · value · %) beside the pie instead.
    const sorted = capSlices(s.data, locale);
    const total = sorted.reduce((a, d) => a + (Number(d.value) || 0), 0) || 1;
    return (
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <div className="h-40 w-40 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={sorted} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={68} isAnimationActive={false}>
                {sorted.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => (money ? eur(v) : numGrouped(v))} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="grid w-full grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
          {sorted.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="min-w-0 flex-1 truncate">{d.label}</span>
              <span className="shrink-0 font-medium tabular-nums">{money ? eur(d.value) : numGrouped(d.value)}</span>
              <span className={`w-9 shrink-0 text-right tabular-nums ${MUTED}`}>{Math.round((d.value / total) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  const fmt = (v: number) => (money ? eur(v) : numGrouped(v));
  if (s.type === "bar" && barsSideways(s.data)) {
    return (
      <div className="w-full" style={{ height: s.data.length * 24 + 16 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={s.data} layout="vertical" margin={{ left: 4, right: 56 }}>
            <XAxis type="number" hide domain={[(min: number) => Math.min(0, min), "auto"]} />
            <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 10 }} interval={0} />
            <Tooltip formatter={(v: number) => fmt(v)} />
            <Bar dataKey="value" fill={PALETTE[0]} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}
              label={{ position: "right", fontSize: 10, formatter: (v: number) => fmt(v) }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
  const Wrap = s.type === "line" ? LineChart : BarChart;
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <Wrap data={s.data}>
          <XAxis dataKey="label" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={money ? eurAxis : (v) => numGrouped(v)} />
          <Tooltip formatter={(v: number) => (money ? eur(v) : numGrouped(v))} />
          {s.type === "line"
            ? <Line dataKey="value" stroke={PALETTE[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
            : <Bar dataKey="value" fill={PALETTE[0]} radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false} />}
        </Wrap>
      </ResponsiveContainer>
    </div>
  );
}

function DataSection({ s }: { s: Extract<ReportSection, { type: "table" }> }) {
  const numeric = useMemo(() => s.columns.map((c) => isNumericCol(s.rows, c.key)), [s]);
  // Scrolls sideways rather than clipping: on a phone or a half-width dashboard the
  // right-hand money columns used to vanish with no hint they existed.
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full text-xs">
        <thead>
          <tr className={`border-b ${RULE} text-left ${MUTED}`}>
            {s.columns.map((c, i) => <th key={c.key} className={`whitespace-nowrap py-1 pr-3 font-medium ${numeric[i] ? "text-right" : ""}`}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r, i) => (
            <tr key={i} className={`border-b ${RULE} last:border-0`}>
              {s.columns.map((c, j) => (
                <td key={c.key} className={`py-1 pr-3 tabular-nums ${numeric[j] ? "whitespace-nowrap text-right" : ""}`}>{fmtCell(c.key, c.header, r[c.key], c.unit)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Products({ s }: { s: Extract<ReportSection, { type: "products" }> }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {s.items.slice(0, 12).map((p, i) => {
        const inner = (
          <>
            <div className="aspect-square bg-neutral-100">
              {p.image_url && <img src={p.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />}
            </div>
            <div className="p-2">
              {p.subtitle && <div className={`truncate text-[10px] uppercase tracking-wide ${MUTED}`}>{p.subtitle}</div>}
              <div className="line-clamp-2 text-[11px] font-medium leading-tight">{p.name}</div>
              {p.price != null && <div className="mt-0.5 text-[11px] font-semibold">{eur(p.price)}</div>}
            </div>
          </>
        );
        const cls = `block overflow-hidden rounded-lg border ${RULE}`;
        return p.url
          ? <a key={i} href={p.url} target="_blank" rel="noreferrer" className={cls}>{inner}</a>
          : <div key={i} className={cls}>{inner}</div>;
      })}
    </div>
  );
}

const Kpis = ({ s }: { s: Extract<ReportSection, { type: "kpis" }> }) => (
  <div className={`grid grid-cols-2 gap-x-6 gap-y-4 border-t ${RULE} pt-3 sm:grid-cols-4`}>
    {s.items.map((it, i) => (
      <div key={i}>
        <div className={`text-[10px] uppercase tracking-[0.15em] ${MUTED}`}>{it.label}</div>
        <div className={`mt-1 font-serif text-2xl leading-tight ${INK}`}>{it.value}</div>
      </div>
    ))}
  </div>
);

export default function ReportView({ report, locale, onSave, extraActions }: {
  report: ReportPayload; locale: string;
  /** Keep this report as a dashboard. Shown only when given. */
  onSave?: () => Promise<void>;
  /** Anything the host adds to the footer (a dashboard's own controls). */
  extraActions?: React.ReactNode;
}) {
  const printRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<null | "pdf" | "xlsx" | "save">(null);
  const [saved, setSaved] = useState(false);
  const onSaveClick = async () => {
    if (!onSave) return;
    setBusy("save");
    try { await onSave(); setSaved(true); }
    catch (e) { toast.error(`${tt(locale, "Could not save", "Salvataggio non riuscito")}: ${e instanceof Error ? e.message : "error"}`); }
    finally { setBusy(null); }
  };
  const fileBase = (report.title || "report").replace(/\s+/g, "_");
  const sections = useMemo(() => (report.sections ?? []).filter(sectionHasData), [report.sections]);
  const shown = useMemo(() => ({ ...report, sections }), [report, sections]);
  const sheets = useMemo(() => sectionsToSheets(shown, locale), [shown, locale]);

  const onPdf = async () => {
    setBusy("pdf");
    try { await downloadReportPdf(shown, fileBase, locale); }
    catch (e) { console.error("[report pdf]", e); toast.error(`${tt(locale, "PDF export failed", "Export PDF non riuscito")}: ${e instanceof Error ? e.message : "error"}`); }
    finally { setBusy(null); }
  };
  const onXlsx = async () => {
    setBusy("xlsx");
    try { await downloadXlsx(sheets, fileBase); }
    catch (e) { console.error("[report xlsx]", e); toast.error(`${tt(locale, "Excel export failed", "Export Excel non riuscito")}: ${e instanceof Error ? e.message : "error"}`); }
    finally { setBusy(null); }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div ref={printRef} className={`bg-white p-5 ${INK}`}>
        <div data-block="" className={`border-b ${RULE} pb-3`}>
          <div className="flex items-start justify-between gap-3">
            {report.brand_logo
              ? <img src={report.brand_logo} alt={report.brand ?? ""} className="h-8 w-auto max-w-[150px] object-contain" />
              : report.brand
                ? <div className="text-[11px] font-semibold uppercase tracking-widest text-primary">{report.brand}</div>
                : <span />}
            <div className={`shrink-0 text-right text-[11px] ${MUTED}`}>
              {tt(locale, "Generated", "Generato")}<br />{new Date(report.generated_at).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB")}
            </div>
          </div>
          <div className="mt-4">
            <h3 className="font-serif text-xl font-semibold leading-tight">{report.title}</h3>
            {report.subtitle && <p className={`mt-0.5 text-xs ${MUTED}`}>{report.subtitle}</p>}
          </div>
        </div>

        {sections.length === 0 && (
          <p className={`py-6 text-xs ${MUTED}`}>
            {tt(locale, "No data for this report.", "Nessun dato per questo report.")}
          </p>
        )}

        {sections.map((s, i) => (
          <div key={i} data-block="" className="pt-1">
            <SectionTitle>{s.title}</SectionTitle>
            {s.type === "kpis" ? <Kpis s={s} />
              : s.type === "table" ? <DataSection s={s} />
              : s.type === "products" ? <Products s={s} />
              : s.type === "note" ? <p className={`mt-2 whitespace-pre-line text-xs italic ${MUTED}`}>{s.body}</p>
              : <Chart s={s} locale={locale} />}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/20 px-4 py-2.5">
        <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Download className="h-3.5 w-3.5" />{tt(locale, "Download", "Scarica")}
        </span>
        <button type="button" onClick={onPdf} disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50">
          {busy === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} PDF
        </button>
        <button type="button" onClick={onXlsx} disabled={busy !== null || sheets.length === 0}
          title={sheets.length === 0
            ? tt(locale, "Nothing to put in a spreadsheet — this report has no table data.", "Niente da mettere in un foglio — questo report non ha dati tabellari.")
            : undefined}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50">
          {busy === "xlsx" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />} Excel
        </button>
        {onSave && (
          <button type="button" onClick={() => void onSaveClick()} disabled={busy !== null || saved}
            title={tt(locale, "Keep it in Insights → My dashboards, where it re-runs with today's data", "Tienilo in Insights → Le mie dashboard, dove si aggiorna con i dati di oggi")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60">
            {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : saved ? <Check className="h-3.5 w-3.5 text-primary" /> : <LayoutDashboard className="h-3.5 w-3.5" />}
            {saved ? tt(locale, "Saved", "Salvata") : tt(locale, "Save as dashboard", "Salva come dashboard")}
          </button>
        )}
        {extraActions}
      </div>
    </div>
  );
}

// Each data section becomes a sheet; all KPI sections merge into one summary sheet.
export function sectionsToSheets(report: ReportPayload, locale: string): Sheet[] {
  const sheets: Sheet[] = [];
  const used = new Set<string>();
  const name = (base: string) => {
    // Excel forbids \ / ? * [ ] : , caps names at 31 chars, refuses a name that starts or
    // ends with an apostrophe ("…dell'" after the cut) and reserves "History"; and two
    // names differing only in case collide. Any of these threw, and the whole export failed.
    const tidy = (x: string) => x.replace(/^['\s]+|['\s(\-—–,:·]+$/g, "");
    let clean = tidy((base || "Sheet").replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ")) || "Sheet";
    if (clean.toLowerCase() === "history") clean = `${clean} 1`;
    let k = tidy(clean.slice(0, 31)) || "Sheet";
    let i = 2;
    while (used.has(k.toLowerCase())) { const suf = ` ${i++}`; k = tidy(clean.slice(0, 31 - suf.length)) + suf; }
    used.add(k.toLowerCase()); return k;
  };
  const kpiRows: Record<string, unknown>[] = [];
  for (const s of report.sections) {
    if (!sectionHasData(s)) continue; // a blank sheet is the empty download
    if (s.type === "kpis") { kpiRows.push(...s.items.map((it) => ({ k: it.label, v: it.value }))); }
    else if (s.type === "bar" || s.type === "line" || s.type === "pie") {
      sheets.push({ name: name(s.title ?? "Chart"), columns: [{ key: "label", header: tt(locale, "Label", "Voce") }, { key: "value", header: tt(locale, "Value", "Valore"), unit: s.unit === "eur" ? "eur" : "num" }], rows: s.data });
    } else if (s.type === "table") {
      sheets.push({ name: name(s.title ?? "Table"), columns: s.columns, rows: s.rows });
    } else if (s.type === "products") {
      sheets.push({ name: name(s.title ?? "Products"), columns: [{ key: "name", header: tt(locale, "Name", "Nome") }, { key: "subtitle", header: tt(locale, "Collection", "Collezione") }, { key: "price", header: tt(locale, "Price", "Prezzo"), unit: "eur" }], rows: s.items.map((p) => ({ name: p.name, subtitle: p.subtitle ?? "", price: p.price ?? "" })) });
    }
  }
  if (kpiRows.length) sheets.unshift({ name: name(tt(locale, "Summary", "Riepilogo")), columns: [{ key: "k", header: tt(locale, "Metric", "Metrica") }, { key: "v", header: tt(locale, "Value", "Valore") }], rows: kpiRows, kpi: true });
  // No fallback sheet: an empty workbook is the bug, not a graceful degradation.
  // With nothing to write, the Excel button is disabled instead.
  return sheets;
}
