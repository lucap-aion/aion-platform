// On-screen report (client dossier or weekly/monthly performance) rendered from
// the brand-assistant `report` event — with charts and PDF / Excel download.
import { useRef, useState } from "react";
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { downloadPdfFromNode, downloadXlsx, type Sheet } from "@/lib/reportExport";

const tt = (locale: string, en: string, it: string) => (locale === "it" ? it : en);
const eur = (v: number | null | undefined) =>
  v == null ? "—" : `€${Number(v).toLocaleString("it-IT", { maximumFractionDigits: 0 })}`;
const PALETTE = ["#2A7B5B", "#B8860B", "#8FB7A6", "#D9B25F", "#4C9E7A", "#C79A3B", "#A7CBBC", "#E4C87E"];

export type ClientReport = {
  kind: "client"; generated_at: string; brand: string | null;
  client: { name: string; email: string | null; phone: string | null; city: string | null; country: string | null; since: string | null };
  kpis: { total_spend: number; pieces: number; avg_ticket: number; open_claims: number };
  purchases: { name: string; collection: string | null; image_url: string | null; price: number | null; date: string | null; status: string | null }[];
  claims: { type: string; status: string | null; date: string | null }[];
  feedback: { satisfaction: number; recommendation: number; peace_of_mind: number; comment: string | null } | null;
  spend_by_year: { year: string; value: number }[];
};
export type PerformanceReport = {
  kind: "performance"; generated_at: string; brand: string | null; period: "week" | "month";
  kpis: { revenue: number; covers: number; avg_ticket: number; customers: number; claims: number };
  series: { bucket: string; revenue: number; covers: number }[];
  category_mix: { label: string; count: number; revenue: number }[];
  top_collections: { label: string; count: number; revenue: number }[];
  top_clients: { label: string; count: number; revenue: number }[];
};
export type ReportPayload = ClientReport | PerformanceReport;

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className="mt-0.5 text-lg font-semibold text-foreground">{value}</div>
  </div>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h4 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</h4>
);

export default function ReportView({ report, locale }: { report: ReportPayload; locale: string }) {
  const printRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<null | "pdf" | "xlsx">(null);

  const title = report.kind === "client"
    ? tt(locale, "Client report", "Report cliente")
    : report.period === "week"
      ? tt(locale, "Weekly performance", "Performance settimanale")
      : tt(locale, "Monthly performance", "Performance mensile");
  const subject = report.kind === "client" ? report.client.name : (report.brand ?? "");
  const fileBase = `${title}_${subject}`.replace(/\s+/g, "_");

  const onPdf = async () => {
    if (!printRef.current) return;
    setBusy("pdf");
    try {
      await downloadPdfFromNode(printRef.current, fileBase);
    } catch (e) {
      console.error("[report pdf]", e);
      toast.error(`${tt(locale, "PDF export failed", "Export PDF non riuscito")}: ${e instanceof Error ? e.message : "error"}`);
    } finally { setBusy(null); }
  };
  const onXlsx = async () => {
    setBusy("xlsx");
    try {
      await downloadXlsx(report.kind === "client" ? clientSheets(report, locale) : perfSheets(report, locale), fileBase);
    } catch (e) {
      console.error("[report xlsx]", e);
      toast.error(`${tt(locale, "Excel export failed", "Export Excel non riuscito")}: ${e instanceof Error ? e.message : "error"}`);
    } finally { setBusy(null); }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Printable area */}
      <div ref={printRef} className="bg-white p-5 text-foreground">
        <div className="flex items-start justify-between border-b border-border pb-3">
          <div>
            {report.brand && <div className="text-[11px] font-semibold uppercase tracking-widest text-primary">{report.brand}</div>}
            <h3 className="text-lg font-semibold">{title}{subject ? ` — ${subject}` : ""}</h3>
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            {tt(locale, "Generated", "Generato")}<br />{new Date(report.generated_at).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB")}
          </div>
        </div>
        {report.kind === "client" ? <ClientBody r={report} locale={locale} /> : <PerfBody r={report} locale={locale} />}
      </div>

      {/* Actions (excluded from the PDF capture) */}
      <div className="flex items-center gap-2 border-t border-border bg-muted/20 px-4 py-2.5">
        <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Download className="h-3.5 w-3.5" />{tt(locale, "Download", "Scarica")}
        </span>
        <button type="button" onClick={onPdf} disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50">
          {busy === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} PDF
        </button>
        <button type="button" onClick={onXlsx} disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50">
          {busy === "xlsx" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />} Excel
        </button>
      </div>
    </div>
  );
}

const ClientBody = ({ r, locale }: { r: ClientReport; locale: string }) => (
  <div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat label={tt(locale, "Total spend", "Spesa totale")} value={eur(r.kpis.total_spend)} />
      <Stat label={tt(locale, "Pieces", "Pezzi")} value={String(r.kpis.pieces)} />
      <Stat label={tt(locale, "Avg ticket", "Scontrino medio")} value={eur(r.kpis.avg_ticket)} />
      <Stat label={tt(locale, "Open claims", "Claim aperti")} value={String(r.kpis.open_claims)} />
    </div>
    <p className="mt-2 text-xs text-muted-foreground">
      {[r.client.city, r.client.country].filter(Boolean).join(", ")}
      {r.client.since ? ` · ${tt(locale, "client since", "cliente dal")} ${r.client.since}` : ""}
      {r.client.email ? ` · ${r.client.email}` : ""}
    </p>

    {r.spend_by_year.length > 1 && (
      <>
        <SectionTitle>{tt(locale, "Spend by year", "Spesa per anno")}</SectionTitle>
        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={r.spend_by_year}>
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={48} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => eur(v)} />
              <Bar dataKey="value" fill={PALETTE[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </>
    )}

    <SectionTitle>{tt(locale, "Pieces purchased", "Pezzi acquistati")}</SectionTitle>
    {r.purchases.length === 0 ? (
      <p className="text-xs text-muted-foreground">{tt(locale, "No purchases on record.", "Nessun acquisto registrato.")}</p>
    ) : (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {r.purchases.slice(0, 8).map((p, i) => (
          <div key={i} className="overflow-hidden rounded-lg border border-border">
            <div className="aspect-square bg-muted/30">
              {p.image_url && <img src={p.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />}
            </div>
            <div className="p-2">
              {p.collection && <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{p.collection}</div>}
              <div className="line-clamp-2 text-[11px] font-medium leading-tight">{p.name}</div>
              <div className="mt-0.5 text-[11px] font-semibold">{p.price != null ? eur(p.price) : "—"}</div>
            </div>
          </div>
        ))}
      </div>
    )}

    {r.feedback && (
      <>
        <SectionTitle>{tt(locale, "Feedback", "Feedback")}</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          <Stat label={tt(locale, "Satisfaction", "Soddisfazione")} value={`${r.feedback.satisfaction}/5`} />
          <Stat label={tt(locale, "Recommendation", "Raccomandazione")} value={`${r.feedback.recommendation}/5`} />
          <Stat label={tt(locale, "Peace of mind", "Serenità")} value={`${r.feedback.peace_of_mind}/5`} />
        </div>
        {r.feedback.comment && <p className="mt-2 text-xs italic text-muted-foreground">“{r.feedback.comment}”</p>}
      </>
    )}
  </div>
);

const MiniTable = ({ rows, locale, valueLabel }: { rows: { label: string; count: number; revenue: number }[]; locale: string; valueLabel: string }) => (
  <table className="w-full text-xs">
    <thead>
      <tr className="border-b border-border text-left text-muted-foreground">
        <th className="py-1 font-medium">{tt(locale, "Name", "Nome")}</th>
        <th className="py-1 text-right font-medium">{tt(locale, "Pieces", "Pezzi")}</th>
        <th className="py-1 text-right font-medium">{valueLabel}</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((r, i) => (
        <tr key={i} className="border-b border-border/50 last:border-0">
          <td className="py-1 pr-2">{r.label}</td>
          <td className="py-1 text-right tabular-nums">{r.count}</td>
          <td className="py-1 text-right font-medium tabular-nums">{eur(r.revenue)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const PerfBody = ({ r, locale }: { r: PerformanceReport; locale: string }) => (
  <div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
      <Stat label={tt(locale, "Revenue", "Ricavi")} value={eur(r.kpis.revenue)} />
      <Stat label={tt(locale, "Pieces sold", "Pezzi venduti")} value={String(r.kpis.covers)} />
      <Stat label={tt(locale, "Avg ticket", "Scontrino medio")} value={eur(r.kpis.avg_ticket)} />
      <Stat label={tt(locale, "Clients", "Clienti")} value={String(r.kpis.customers)} />
      <Stat label={tt(locale, "Claims", "Claim")} value={String(r.kpis.claims)} />
    </div>

    <SectionTitle>{tt(locale, "Revenue trend", "Andamento ricavi")}</SectionTitle>
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={r.series}>
          <XAxis dataKey="bucket" tick={{ fontSize: 10 }} tickFormatter={(v) => (r.period === "month" ? v.slice(0, 7) : v.slice(5))} />
          <YAxis tick={{ fontSize: 11 }} width={48} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
          <Tooltip formatter={(v: number) => eur(v)} labelFormatter={(l) => l} />
          <Bar dataKey="revenue" fill={PALETTE[0]} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>

    {r.category_mix.length > 0 && (
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <SectionTitle>{tt(locale, "Category mix (revenue)", "Mix categorie (ricavi)")}</SectionTitle>
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={r.category_mix} dataKey="revenue" nameKey="label" cx="50%" cy="50%" outerRadius={70} label={(e) => e.label}>
                  {r.category_mix.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => eur(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <SectionTitle>{tt(locale, "Top collections", "Top collezioni")}</SectionTitle>
          <MiniTable rows={r.top_collections} locale={locale} valueLabel={tt(locale, "Revenue", "Ricavi")} />
        </div>
      </div>
    )}

    <SectionTitle>{tt(locale, "Top clients", "Top clienti")}</SectionTitle>
    <MiniTable rows={r.top_clients} locale={locale} valueLabel={tt(locale, "Revenue", "Ricavi")} />
  </div>
);

// ── Excel sheet builders ─────────────────────────────────────────────────────
function clientSheets(r: ClientReport, locale: string): Sheet[] {
  return [
    {
      name: tt(locale, "Summary", "Riepilogo"),
      columns: [{ key: "k", header: tt(locale, "Metric", "Metrica") }, { key: "v", header: tt(locale, "Value", "Valore") }],
      rows: [
        { k: tt(locale, "Client", "Cliente"), v: r.client.name },
        { k: "Email", v: r.client.email ?? "" },
        { k: tt(locale, "City", "Città"), v: [r.client.city, r.client.country].filter(Boolean).join(", ") },
        { k: tt(locale, "Client since", "Cliente dal"), v: r.client.since ?? "" },
        { k: tt(locale, "Total spend", "Spesa totale"), v: r.kpis.total_spend },
        { k: tt(locale, "Pieces", "Pezzi"), v: r.kpis.pieces },
        { k: tt(locale, "Avg ticket", "Scontrino medio"), v: r.kpis.avg_ticket },
        { k: tt(locale, "Open claims", "Claim aperti"), v: r.kpis.open_claims },
      ],
    },
    {
      name: tt(locale, "Purchases", "Acquisti"),
      columns: [
        { key: "name", header: tt(locale, "Piece", "Pezzo") }, { key: "collection", header: tt(locale, "Collection", "Collezione") },
        { key: "price", header: tt(locale, "Price", "Prezzo") }, { key: "date", header: tt(locale, "Date", "Data") }, { key: "status", header: "Status" },
      ],
      rows: r.purchases.map((p) => ({ name: p.name, collection: p.collection ?? "", price: p.price ?? "", date: p.date ?? "", status: p.status ?? "" })),
    },
    ...(r.claims.length ? [{
      name: "Claims",
      columns: [{ key: "type", header: "Type" }, { key: "status", header: "Status" }, { key: "date", header: tt(locale, "Date", "Data") }],
      rows: r.claims.map((c) => ({ type: c.type, status: c.status ?? "", date: c.date ?? "" })),
    }] : []),
  ];
}

function perfSheets(r: PerformanceReport, locale: string): Sheet[] {
  const rev = tt(locale, "Revenue", "Ricavi");
  const pieces = tt(locale, "Pieces", "Pezzi");
  const name = tt(locale, "Name", "Nome");
  return [
    {
      name: "KPI",
      columns: [{ key: "k", header: tt(locale, "Metric", "Metrica") }, { key: "v", header: tt(locale, "Value", "Valore") }],
      rows: [
        { k: rev, v: r.kpis.revenue }, { k: tt(locale, "Pieces sold", "Pezzi venduti"), v: r.kpis.covers },
        { k: tt(locale, "Avg ticket", "Scontrino medio"), v: r.kpis.avg_ticket },
        { k: tt(locale, "Clients", "Clienti"), v: r.kpis.customers }, { k: "Claims", v: r.kpis.claims },
      ],
    },
    { name: tt(locale, "Trend", "Andamento"), columns: [{ key: "bucket", header: tt(locale, "Period", "Periodo") }, { key: "revenue", header: rev }, { key: "covers", header: pieces }], rows: r.series },
    { name: tt(locale, "Categories", "Categorie"), columns: [{ key: "label", header: name }, { key: "count", header: pieces }, { key: "revenue", header: rev }], rows: r.category_mix },
    { name: tt(locale, "Collections", "Collezioni"), columns: [{ key: "label", header: name }, { key: "count", header: pieces }, { key: "revenue", header: rev }], rows: r.top_collections },
    { name: tt(locale, "Clients", "Clienti"), columns: [{ key: "label", header: name }, { key: "count", header: pieces }, { key: "revenue", header: rev }], rows: r.top_clients },
  ];
}
