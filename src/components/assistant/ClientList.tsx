import { useState } from "react";
import ClientAvatar from "@/components/ClientAvatar";

// Clients in an assistant answer — "top 10 clients", the client a Customer 360
// brief is about — as compact rows, not photo cards.
//
// They used to go through the product photo grid, because `avatar` is an image
// column: every client got a square the size of a product shot, and since most
// clients have no photo, most squares were empty. Ten of them read as a broken
// page. A row is the same height with or without a face (a small avatar or the
// initials monogram), the name gets the width, and the figures that ranked the
// client sit on the right where the eye compares them down the list.

const tt = (locale: string, en: string, it: string) => (locale === "it" ? it : en);

// The client's own picture — not a product's. `picture` / `image_url` are the
// catalogue's, and a result carrying only those is a product result.
export const isPersonImageColumn = (col: string) =>
  /(^|_)avatar(_url)?$/i.test(col) ||
  /(^|_)(profile|client|customer|cliente)_(picture|photo|image)(_url)?$/i.test(col);
const isProductImageColumn = (col: string) =>
  !isPersonImageColumn(col) && /(^|_)(picture|photo|thumbnail|image)(_url)?$/i.test(col);

const FIRST = /^(first_name|firstname|nome)$/i;
const LAST = /^(last_name|lastname|surname|cognome)$/i;
const FULL = /^(full_name|client_name|customer_name|client|customer|cliente|nome_cliente|nome_completo)$/i;
const EMAIL = /(^|_)e?mail$/i;
const PHONE = /(^|_)(phone|phone_number|telefono|mobile)$/i;
const PLACE = /(^|_)(city|citta|città|country|paese|nazione|province)$/i;
const SEGMENT = /(^|_)(segment|segmento|tier|vip_tier|status_tier|level)$/i;
const COUNT = /(pieces|count|orders|purchases|items|policies|covers|visits|qty|quantity|pezzi|acquisti|ordini|^n_|_n$|^num_|_num$)/i;
// "total_spent" is money, "total_pieces" is a count.
const isMoney = (c: string) =>
  /(spent|spend|revenue|value|ltv|lifetime|amount|ticket|price|sales|fatturato|speso|valore|importo|scontrino)/i.test(c)
  || (/total|totale/i.test(c) && !COUNT.test(c));
const HIDDEN = /(^|_)id$|^uuid$/i;

/** A result about people: it carries a client's picture, or a client's name. */
export const isClientResult = (columns: string[]) =>
  columns.some(isPersonImageColumn) ||
  (!columns.some(isProductImageColumn) &&
    (columns.some((c) => FULL.test(c)) || (columns.some((c) => FIRST.test(c)) && columns.some((c) => LAST.test(c)))));

const str = (v: unknown) => (v == null ? "" : String(v).trim());
const isNumeric = (v: unknown) =>
  (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()));
const humanize = (col: string) => col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const money = (v: unknown) => `€${Number(v).toLocaleString("it-IT", { maximumFractionDigits: 0 })}`;
const num = (v: unknown) => Number(v).toLocaleString("it-IT", { maximumFractionDigits: 2 });

function layout(columns: string[], rows: Record<string, unknown>[]) {
  const visible = columns.filter((c) => !HIDDEN.test(c));
  const avatar = visible.find(isPersonImageColumn);
  const productImage = visible.find(isProductImageColumn);
  const first = visible.find((c) => FIRST.test(c));
  const last = visible.find((c) => LAST.test(c));
  const full = visible.find((c) => FULL.test(c))
    ?? (!first && !last ? visible.find((c) => /(^|_)(name|nome)$/i.test(c)) : undefined);
  const email = visible.find((c) => EMAIL.test(c));
  const phone = visible.find((c) => PHONE.test(c));
  const places = visible.filter((c) => PLACE.test(c));
  const segment = visible.find((c) => SEGMENT.test(c));
  const used = new Set([avatar, productImage, first, last, full, email, phone, segment, ...places].filter(Boolean) as string[]);
  // The figures that ranked the client: a column whose values are numbers.
  const numericCols = visible.filter((c) => !used.has(c) && rows.some((r) => isNumeric(r[c]))
    && rows.every((r) => r[c] == null || r[c] === "" || isNumeric(r[c])));
  const metrics = [
    ...numericCols.filter((c) => isMoney(c)),
    ...numericCols.filter((c) => !isMoney(c) && COUNT.test(c)),
    ...numericCols.filter((c) => !isMoney(c) && !COUNT.test(c)),
  ].slice(0, 2);
  metrics.forEach((c) => used.add(c));
  const extras = visible.filter((c) => !used.has(c)).slice(0, 3);
  return { avatar, productImage, first, last, full, email, phone, places, segment, metrics, extras };
}

const formatExtra = (v: unknown) => {
  const s = str(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 10);
  if (typeof v === "number") return num(v);
  return s;
};

export default function ClientList({ columns, rows, locale }: {
  columns: string[]; rows: Record<string, unknown>[]; locale: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const L = layout(columns, rows);
  const CAP = 10;
  const visible = expanded ? rows : rows.slice(0, CAP);

  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
        {visible.map((row, i) => {
          const name = (L.full ? str(row[L.full]) : [L.first, L.last].map((c) => (c ? str(row[c]) : "")).filter(Boolean).join(" "))
            || (L.email ? str(row[L.email]) : "") || "—";
          const emailVal = L.email ? str(row[L.email]) : "";
          const place = L.places.map((c) => str(row[c])).filter(Boolean).join(", ");
          const meta = [L.segment ? str(row[L.segment]) : "", place, emailVal && emailVal !== name ? emailVal : (L.phone ? str(row[L.phone]) : "")]
            .filter(Boolean);
          const extras = L.extras
            .map((c) => ({ c, v: formatExtra(row[c]) }))
            .filter((e) => e.v);
          const productSrc = L.productImage ? str(row[L.productImage]) : "";
          return (
            <li key={i} className="flex items-center gap-3 px-4 py-3">
              <ClientAvatar name={name} email={emailVal} value={L.avatar ? str(row[L.avatar]) : null} className="h-10 w-10 text-sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{name}</p>
                {meta.length > 0 && <p className="truncate text-xs text-muted-foreground">{meta.join(" · ")}</p>}
                {extras.length > 0 && (
                  <p className="truncate text-xs text-muted-foreground/90">
                    {extras.map((e, k) => (
                      <span key={e.c}>
                        {k > 0 && " · "}
                        <span className="text-muted-foreground/70">{humanize(e.c)}</span> {e.v}
                      </span>
                    ))}
                  </p>
                )}
              </div>
              {/^https?:\/\//i.test(productSrc) && (
                <img src={productSrc} alt="" loading="lazy" referrerPolicy="no-referrer"
                  className="h-10 w-10 shrink-0 rounded-md border border-border object-cover"
                  onError={(e) => { e.currentTarget.style.display = "none"; }} />
              )}
              {L.metrics.map((c, k) => {
                const v = row[c];
                const has = v != null && v !== "" && isNumeric(v);
                return (
                  <div key={c} className={`shrink-0 text-right ${k > 0 ? "hidden sm:block" : ""}`}>
                    <div className="text-sm font-semibold tabular-nums text-foreground">
                      {has ? (isMoney(c) ? money(v) : num(v)) : "—"}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{humanize(c)}</div>
                  </div>
                );
              })}
            </li>
          );
        })}
      </ul>
      {rows.length > CAP && (
        <button type="button" onClick={() => setExpanded((e) => !e)}
          className="self-center rounded-full border border-border bg-card px-4 py-1.5 text-xs text-foreground transition-colors hover:bg-muted">
          {expanded ? tt(locale, "Show fewer", "Mostra meno") : `${tt(locale, "Show all", "Mostra tutti")} ${rows.length}`}
        </button>
      )}
    </div>
  );
}
