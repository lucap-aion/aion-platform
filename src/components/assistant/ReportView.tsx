// On-screen report rendered from the brand-assistant `report` event. A report is
// a generic list of sections (KPIs, charts, tables, product cards, notes), so the
// same renderer handles the client & performance presets AND any ad-hoc report.
// Exports to PDF (the rendered layout) and Excel (a sheet per data section).
import { useRef, useState } from "react";
import {
  Bar, BarChart, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { downloadPdfFromNode, downloadXlsx, type Sheet } from "@/lib/reportExport";

const tt = (locale: string, en: string, it: string) => (locale === "it" ? it : en);
const eur = (v: number | null | undefined) =>
  v == null ? "—" : `€${Number(v).toLocaleString("it-IT", { maximumFractionDigits: 0 })}`;
const numGrouped = (v: number) => v.toLocaleString("it-IT", { maximumFractionDigits: 2 });
const PALETTE = ["#2A7B5B", "#B8860B", "#8FB7A6", "#D9B25F", "#4C9E7A", "#C79A3B", "#A7CBBC", "#E4C87E"];
const looksMoney = (c: string) => /(price|revenue|spend|ticket|value|amount|premium|cost|total|prezzo|ricav|spesa|scontrino)/i.test(c);

export type ReportSection =
  | { type: "kpis"; title?: string; items: { label: string; value: string }[] }
  | { type: "bar" | "line" | "pie"; title?: string; unit?: "eur" | "num"; data: { label: string; value: number }[] }
  | { type: "table"; title?: string; columns: { key: string; header: string }[]; rows: Record<string, unknown>[] }
  | { type: "products"; title?: string; items: { name: string; subtitle?: string | null; price?: number | null; image_url?: string | null; url?: string | null }[] }
  | { type: "note"; title?: string; body: string };

export type ReportPayload = {
  title: string; subtitle?: string | null; generated_at: string; brand: string | null; sections: ReportSection[];
};

const SectionTitle = ({ children }: { children: React.ReactNode }) =>
  children ? <h4 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</h4> : null;

const axisMoney = (v: number) => `€${(v / 1000).toFixed(0)}k`;

function Chart({ s, locale }: { s: Extract<ReportSection, { type: "bar" | "line" | "pie" }>; locale: string }) {
  const money = s.unit === "eur";
  const total = (s.data ?? []).reduce((a, d) => a + (Number(d.value) || 0), 0);
  if (!s.data?.length || total === 0) {
    return <p className="py-4 text-xs text-muted-foreground">{tt(locale, "No data for this period.", "Nessun dato per questo periodo.")}</p>;
  }
  if (s.type === "pie") {
    return (
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={s.data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={72} label={(e: { label?: string }) => e.label ?? ""}>
              {s.data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip formatter={(v: number) => (money ? eur(v) : numGrouped(v))} />
          </PieChart>
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
          <YAxis tick={{ fontSize: 11 }} width={48} tickFormatter={money ? axisMoney : (v) => numGrouped(v)} />
          <Tooltip formatter={(v: number) => (money ? eur(v) : numGrouped(v))} />
          {s.type === "line"
            ? <Line dataKey="value" stroke={PALETTE[0]} strokeWidth={2} dot={false} />
            : <Bar dataKey="value" fill={PALETTE[0]} radius={[4, 4, 0, 0]} />}
        </Wrap>
      </ResponsiveContainer>
    </div>
  );
}

function DataSection({ s }: { s: Extract<ReportSection, { type: "table" }> }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          {s.columns.map((c) => <th key={c.key} className="py-1 pr-2 font-medium">{c.header}</th>)}
        </tr>
      </thead>
      <tbody>
        {s.rows.map((r, i) => (
          <tr key={i} className="border-b border-border/50 last:border-0">
            {s.columns.map((c) => {
              const v = r[c.key];
              const txt = v == null ? "—"
                : (looksMoney(c.key) || looksMoney(c.header)) && Number.isFinite(Number(v)) ? eur(Number(v))
                : typeof v === "number" ? numGrouped(v) : String(v);
              return <td key={c.key} className="py-1 pr-2 tabular-nums">{txt}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Products({ s }: { s: Extract<ReportSection, { type: "products" }> }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {s.items.slice(0, 12).map((p, i) => {
        const inner = (
          <>
            <div className="aspect-square bg-muted/30">
              {p.image_url && <img src={p.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />}
            </div>
            <div className="p-2">
              {p.subtitle && <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{p.subtitle}</div>}
              <div className="line-clamp-2 text-[11px] font-medium leading-tight">{p.name}</div>
              {p.price != null && <div className="mt-0.5 text-[11px] font-semibold">{eur(p.price)}</div>}
            </div>
          </>
        );
        const cls = "block overflow-hidden rounded-lg border border-border";
        return p.url
          ? <a key={i} href={p.url} target="_blank" rel="noreferrer" className={cls}>{inner}</a>
          : <div key={i} className={cls}>{inner}</div>;
      })}
    </div>
  );
}

const Kpis = ({ s }: { s: Extract<ReportSection, { type: "kpis" }> }) => (
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {s.items.map((it, i) => (
      <div key={i} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{it.label}</div>
        <div className="mt-0.5 text-lg font-semibold text-foreground">{it.value}</div>
      </div>
    ))}
  </div>
);

export default function ReportView({ report, locale }: { report: ReportPayload; locale: string }) {
  const printRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<null | "pdf" | "xlsx">(null);
  const fileBase = (report.title || "report").replace(/\s+/g, "_");

  const onPdf = async () => {
    if (!printRef.current) return;
    setBusy("pdf");
    try { await downloadPdfFromNode(printRef.current, fileBase); }
    catch (e) { console.error("[report pdf]", e); toast.error(`${tt(locale, "PDF export failed", "Export PDF non riuscito")}: ${e instanceof Error ? e.message : "error"}`); }
    finally { setBusy(null); }
  };
  const onXlsx = async () => {
    setBusy("xlsx");
    try { await downloadXlsx(sectionsToSheets(report, locale), fileBase); }
    catch (e) { console.error("[report xlsx]", e); toast.error(`${tt(locale, "Excel export failed", "Export Excel non riuscito")}: ${e instanceof Error ? e.message : "error"}`); }
    finally { setBusy(null); }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div ref={printRef} className="bg-white p-5 text-foreground">
        <div className="flex items-start justify-between border-b border-border pb-3">
          <div>
            {report.brand && <div className="text-[11px] font-semibold uppercase tracking-widest text-primary">{report.brand}</div>}
            <h3 className="text-lg font-semibold">{report.title}</h3>
            {report.subtitle && <p className="text-xs text-muted-foreground">{report.subtitle}</p>}
          </div>
          <div className="shrink-0 text-right text-[11px] text-muted-foreground">
            {tt(locale, "Generated", "Generato")}<br />{new Date(report.generated_at).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB")}
          </div>
        </div>

        {report.sections.map((s, i) => (
          <div key={i}>
            <SectionTitle>{s.title}</SectionTitle>
            {s.type === "kpis" ? <Kpis s={s} />
              : s.type === "table" ? <DataSection s={s} />
              : s.type === "products" ? <Products s={s} />
              : s.type === "note" ? <p className="mt-2 text-xs italic text-muted-foreground">{s.body}</p>
              : <Chart s={s} locale={locale} />}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-border bg-muted/20 px-4 py-2.5">
        <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Download className="h-3.5 w-3.5" />{tt(locale, "Download", "Scarica")}
        </span>
        <button type="button" onClick={onPdf} disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50">
          {busy === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} PDF
        </button>
        <button type="button" onClick={onXlsx} disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50">
          {busy === "xlsx" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />} Excel
        </button>
      </div>
    </div>
  );
}

// Each data section becomes a sheet; all KPI sections merge into one summary sheet.
function sectionsToSheets(report: ReportPayload, locale: string): Sheet[] {
  const sheets: Sheet[] = [];
  const used = new Set<string>();
  const name = (base: string) => {
    // Excel forbids \ / ? * [ ] : and caps sheet names at 31 chars.
    const clean = (base || "Sheet").replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim() || "Sheet";
    let k = clean.slice(0, 31);
    let i = 2;
    while (used.has(k)) { const suf = ` ${i++}`; k = clean.slice(0, 31 - suf.length) + suf; }
    used.add(k); return k;
  };
  const kpiRows: Record<string, unknown>[] = [];
  for (const s of report.sections) {
    if (s.type === "kpis") { kpiRows.push(...s.items.map((it) => ({ k: it.label, v: it.value }))); }
    else if (s.type === "bar" || s.type === "line" || s.type === "pie") {
      sheets.push({ name: name(s.title ?? "Chart"), columns: [{ key: "label", header: tt(locale, "Label", "Voce") }, { key: "value", header: tt(locale, "Value", "Valore") }], rows: s.data });
    } else if (s.type === "table") {
      sheets.push({ name: name(s.title ?? "Table"), columns: s.columns, rows: s.rows });
    } else if (s.type === "products") {
      sheets.push({ name: name(s.title ?? "Products"), columns: [{ key: "name", header: tt(locale, "Name", "Nome") }, { key: "subtitle", header: tt(locale, "Collection", "Collezione") }, { key: "price", header: tt(locale, "Price", "Prezzo") }], rows: s.items.map((p) => ({ name: p.name, subtitle: p.subtitle ?? "", price: p.price ?? "" })) });
    }
  }
  if (kpiRows.length) sheets.unshift({ name: name(tt(locale, "Summary", "Riepilogo")), columns: [{ key: "k", header: tt(locale, "Metric", "Metrica") }, { key: "v", header: tt(locale, "Value", "Valore") }], rows: kpiRows });
  return sheets.length ? sheets : [{ name: "Report", columns: [{ key: "k", header: "—" }], rows: [] }];
}
