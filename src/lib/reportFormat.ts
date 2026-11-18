// How a report value reads: one set of rules for the screen (ReportView), the PDF
// (reportPdf) and the workbook (reportExport). Each used to carry its own copy, and
// they disagreed — "€9.800" in the PDF beside "9800" on screen, a count of policies
// shown as "€468" because its column said "total". Server-side twin: the helpers at
// the end of supabase/functions/brand-assistant/index.ts; keep the two in step.

const tokens = (c: string) => c.toLowerCase().split(/[^a-z0-9àèéìòù€]+/).filter(Boolean);

// A word that makes a column a count, a rank or a ratio, whatever else it says:
// "numero_scontrini", "pezzi_venduti", "anno", "quota_pct".
const COUNT_WORD = /^(count|conteggio|numero|num|nr|n|qty|quantity|quantita|quantità|pezzi|pieces|units|unita|unità|rank|ranking|posizione|year|anno|month|mese|week|settimana|days|giorni|pct|perc|percent|percentage|percentuale|share|quota|rate|tasso|ratio)$/;
// A thing being counted. Only a count when nothing in the name is money:
// "clienti_attivi" counts, "spesa_clienti" is spend.
const ENTITY_WORD = /^(clienti|clients|customers|policies|polizze|coperture|covers|orders|ordini|purchases|acquisti|negozi|stores|shops|items|articoli|prodotti|products|claims|visite|visits)$/;
const MONEY_WORD = /^(price|prices|revenue|revenues|spend|spent|sales|ticket|value|amount|premium|premiums|cost|costs|ltv|eur|euro|€|prezzo|prezzi|ricavi|ricavo|spesa|fatturato|scontrino|incasso|incassi|importo|valore|vendite|budget|margine|margin|aov)$/;
const MONEY_STEM = /^(prezz|ricav|fatturat|scontrin|incass|vendit|revenue|premium)/;

export function looksMoney(...names: (string | undefined | null)[]): boolean {
  for (const name of names) {
    if (!name) continue;
    const t = tokens(name);
    if (t.some((w) => COUNT_WORD.test(w))) return false;
    const money = t.some((w) => MONEY_WORD.test(w) || MONEY_STEM.test(w));
    if (money) return true;
  }
  return false;
}

// Columns whose numbers are identifiers, not quantities: never grouped ("2.025").
// "label" is a chart's category: "2025" there is a year, not 2.025 of something.
const RAW_WORD = /^(label|voce|year|anno|rank|posizione|code|codice|sku|cap|zip|phone|telefono|tel|cellulare|mobile|id|vat|piva|iva)$/;
export const isRawNumberCol = (...names: (string | undefined | null)[]) =>
  names.some((n) => !!n && tokens(n).some((w) => RAW_WORD.test(w)));

/** Italian grouping by hand: it-IT leaves four-digit numbers ungrouped ("9800"). */
export function grp(v: number, decimals = 2): string {
  if (!Number.isFinite(v)) return "—";
  const neg = v < 0;
  const f = 10 ** decimals;
  const [i, d] = (Math.round(Math.abs(v) * f) / f).toString().split(".");
  return `${neg ? "-" : ""}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${d ? `,${d}` : ""}`;
}
/** Whole euros, minus sign before the € ("-€500", not "€-500"). */
export const eur = (v: number) => (Number.isFinite(v) ? `${v < 0 ? "-" : ""}€${grp(Math.round(Math.abs(v)), 0)}` : "—");
/** Axis ticks: thousands as k, but small amounts in full (premiums read "€0k" otherwise). */
export const eurAxis = (v: number) => (Math.abs(v) >= 1000 ? `${v < 0 ? "-" : ""}€${grp(Math.round(Math.abs(v) / 1000), 0)}k` : eur(v));

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::[\d.]+)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/;
/** A date or timestamp as Postgres sends it → its calendar day in Rome. */
export function parseIsoDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const m = ISO_DATE.exec(v.trim());
  if (!m) return null;
  if (!m[4]) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const d = new Date(v.trim().replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return null;
  // The day it was in Rome, as a UTC midnight, so a sale at 00:30 on the 1st stays on the 1st.
  const [dd, mm, yy] = d.toLocaleDateString("en-GB", { timeZone: "Europe/Rome" }).split("/").map(Number);
  return new Date(Date.UTC(yy, mm - 1, dd));
}
export const fmtDate = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

const isNumericString = (v: unknown) => typeof v === "string" && v.trim() !== "" && /^-?\d+(\.\d+)?$/.test(v.trim());

/** One table cell as text: dates as dd/mm/yyyy, money with €, counts grouped, years raw.
 *  `unit` is the server's word on the column (read off its SQL) and beats the name. */
export function fmtCell(key: string, header: string | undefined, v: unknown, unit?: "eur" | "num"): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "✓" : "—";
  if (typeof v === "object") return Array.isArray(v) ? v.map(String).join(", ") : JSON.stringify(v);
  const n = typeof v === "number" ? v : isNumericString(v) ? Number(v) : null;
  if (n != null && Number.isFinite(n)) {
    if (unit === "eur") return eur(n);
    if (isRawNumberCol(key, header)) return String(n);
    return unit !== "num" && looksMoney(key, header) ? eur(n) : grp(n);
  }
  const d = parseIsoDate(v);
  if (d) return fmtDate(d);
  return String(v).replace(/\s+/g, " ").trim();
}

/** A column is numeric when every non-empty cell is a number (or a numeric string). */
export const isNumericCol = (rows: Record<string, unknown>[], key: string) =>
  rows.some((r) => r[key] != null && r[key] !== "") &&
  rows.every((r) => r[key] == null || r[key] === "" || typeof r[key] === "number" || isNumericString(r[key]));
export const isDateCol = (rows: Record<string, unknown>[], key: string) =>
  rows.some((r) => r[key] != null && r[key] !== "") &&
  rows.every((r) => r[key] == null || r[key] === "" || parseIsoDate(r[key]) != null);

/** A pie past eight slices repeats its colours and buries the legend: the tail becomes "Altro". */
export function capSlices(data: { label: string; value: number }[], locale: string, keep = 7) {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  if (sorted.length <= keep + 1) return sorted;
  const rest = sorted.slice(keep).reduce((a, d) => a + d.value, 0);
  return [...sorted.slice(0, keep), { label: locale === "it" ? "Altro" : "Other", value: rest }];
}

/** Turn a KPI's display value back into a number for the workbook ("€3.159.612" → 3159612). */
export function parseDisplayNumber(s: string): { value: number; money: boolean } | null {
  const t = s.trim();
  const m = /^(-)?(€)?\s?(-)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s?(%)?$/.exec(t);
  if (!m) return null;
  const value = Number(`${m[1] || m[3] ? "-" : ""}${m[4].replace(/\./g, "")}${m[5] ? `.${m[5]}` : ""}`);
  return Number.isFinite(value) && !m[6] ? { value, money: !!m[2] } : null;
}
