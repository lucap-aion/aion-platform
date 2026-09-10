// ==============================|| DISPLAY FORMATTING ||============================== //
// Small helpers for values that are stored as whatever the source gave us and have to be
// shown consistently anyway.

/**
 * A country as a person reads it.
 *
 * `brands.hq_country` and `profiles.country` are free text, filled from several places
 * over the years, so the same country sits in the data under more than one spelling: the
 * brands table holds "Italy" three times and "IT" once, and customer profiles hold "IT",
 * "Italy", "US" and "United States" side by side. Sorting puts them apart, and a client
 * document that joins the address ends up reading "Milano, IT" next to "Vicenza, Italy".
 *
 * Rather than pick a winner and rewrite history, the display layer resolves it: a
 * two-letter ISO code becomes its English name, anything else is shown as it was typed.
 * `Intl.DisplayNames` is in every browser we support, so this costs no dependency.
 */
export function formatCountry(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "—";
  if (!/^[A-Za-z]{2}$/.test(raw)) return raw;
  const code = raw.toUpperCase();
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    // Two non-answers to guard against: `of()` echoes the input back for a code it does
    // not know ("XX" -> "XX"), and it resolves the reserved code ZZ to the literal
    // "Unknown Region", which is a worse thing to show a person than the code itself.
    if (!name || name.toUpperCase() === code || /unknown/i.test(name)) return code;
    return name;
  } catch {
    return code;
  }
}

/**
 * A website as a label: no scheme, no `www.`, no trailing slash.
 *
 * The stored value is whatever was pasted — "https://www.example.com" — which is four
 * words of chrome before the part anyone reads. The full value stays in `href`.
 */
export function formatWebsiteLabel(url: string | null | undefined): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  return raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

/** A website as a link target. Adds a scheme when the stored value has none. */
export function websiteHref(url: string | null | undefined): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
}
