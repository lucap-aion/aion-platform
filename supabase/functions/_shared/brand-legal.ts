// ==============================|| WHO THE HOUSE LEGALLY IS ||============================== //
// The legal entity and the registered office — the two fields the data-request workbook
// needs and the only two nothing has ever been able to fill.
//
// Neither is on Wikidata. Ferragamo's entity (Q3946053) has a headquarters CITY, a country,
// a logo and an inception year, and no official name and no street address; its label is
// "Salvatore Ferragamo", not "Salvatore Ferragamo S.p.A.". So the workbook went out
// contracted to a trading name, at no address at all.
//
// Both are, however, sitting in the brand's own site, which the crawl has already indexed:
//
//   "Salvatore Ferragamo S.p.A. with registered offices at Via de' Tornabuoni 2,
//    50123, Firenze (hereinafter, "Salvatore Ferragamo")"     — ferragamo.com privacy policy
//
// That is a house stating its own legal identity, which outranks every other source. Every
// European brand publishes the same line in its privacy policy or legal notice, in one of a
// handful of forms.
//
// Two deliberate limits. The ADDRESS is read from the site's legal text, because that is
// where it is; the NAME is preferred from the encyclopaedia's opening sentence, because
// there it is anchored — "Salvatore Ferragamo S.p.A., doing business as…" begins the
// sentence and cannot be confused with the words around it, whereas the same name sits
// mid-paragraph on the site after "Website Privacy Policy" and no syntactic rule reliably
// says where the company name starts. When the site's own text confirms the encyclopaedia's
// name verbatim, that is reported; when neither source produces one, the field stays null
// and the stage says so rather than guessing.
//
// No imports: pure functions over strings, unit-tested from the frontend suite.

// Corporate forms, longest-first so "S.p.A." wins over a bare "SA" inside it.
const SUFFIX = String.raw`(?:S\.p\.A\.|S\.P\.A\.|SpA|S\.r\.l\.|S\.R\.L\.|Srl|S\.a\.s\.|S\.n\.c\.|S\.A\.S\.|S\.A\.R\.L\.|SARL|S\.L\.U\.|S\.L\.|S\.A\.U\.|S\.A\.|GmbH|mbH|AG|N\.V\.|B\.V\.|A\/S|ApS|Oyj|Oy|AB|PLC|Plc|plc|Ltd\.?|Limited|Inc\.?|Corporation|Corp\.?|LLC|LLP|KGaA|KG|SE|NV|BV|SA)`;

/**
 * The legal entity, from a sentence that opens with it.
 *
 * Anchored at the start on purpose. "Salvatore Ferragamo S.p.A., doing business as
 * Ferragamo, is an Italian luxury fashion house" yields the name with no ambiguity; the
 * same words halfway down a privacy policy do not, because "Website Privacy Policy
 * Salvatore Ferragamo S.p.A." is equally well-formed and equally wrong.
 *
 * A corporate suffix is REQUIRED. "Pomellato is an Italian jewellery house" has no legal
 * form in it, and returning "Pomellato" as the legal entity would be inventing one.
 *
 * One comma is allowed, but only immediately before the suffix: American entities are
 * written "Tapestry, Inc." and "Capri Holdings, Ltd.", and a rule that stopped at the first
 * comma would drop the legal form off exactly the names that carry it that way.
 */
export function legalNameFromDescription(text: string | null | undefined): string | null {
  const first = String(text ?? "").trim();
  if (!first) return null;
  const re = new RegExp(
    `^([A-Z][^,\\n]{1,80}?(?:,\\s*|\\s)${SUFFIX})(?=\\s*,|\\s+(?:is|was|era|è|ist|est)\\b)`,
  );
  const m = re.exec(first);
  return m ? tidy(m[1]) : null;
}

/** Does the house's own site use this exact name? Cheap, and it is the difference between a
 *  name we found and a name we can stand behind. */
export function nameIsConfirmedBy(legalName: string | null, siteText: string): boolean {
  if (!legalName) return false;
  const needle = legalName.toLowerCase().replace(/\s+/g, " ");
  return siteText.toLowerCase().replace(/\s+/g, " ").includes(needle);
}

// How a company says where it is registered, across the languages these houses publish in.
// The address runs to the first sentence end or opening bracket — the Ferragamo line
// continues "(hereinafter, …)" and everything from the bracket on is not an address.
const OFFICE_PATTERNS: RegExp[] = [
  /(?:with|having)\s+(?:its\s+)?(?:registered|legal)\s+(?:office|seat|address)e?s?\s+(?:at|in)\s+([^.\n(]{6,140})/i,
  /registered\s+(?:office|seat|address)e?s?\s*(?::|at|in)\s+([^.\n(]{6,140})/i,
  /sede\s+legale\s*(?:in|:)?\s+([^.\n(]{6,140})/i,
  /siège\s+social\s*(?::|à|au)?\s+([^.\n(]{6,140})/i,
  /domicilio\s+(?:social|fiscal)\s*(?::|en)?\s+([^.\n(]{6,140})/i,
  /(?:Sitz|Geschäftsanschrift)\s*(?::|in)\s+([^.\n(]{6,140})/i,
];

export type RegisteredOffice = {
  /** The address exactly as the site states it, before it was split up. */
  raw: string;
  street: string | null;
  postcode: string | null;
  city: string | null;
};

/** The registered office as the house's own legal text states it, or null. */
export function registeredOfficeFrom(text: string | null | undefined): RegisteredOffice | null {
  const body = String(text ?? "");
  if (!body) return null;
  for (const re of OFFICE_PATTERNS) {
    const m = re.exec(body);
    if (!m) continue;
    const raw = tidy(m[1]);
    // "at our offices" and similar: a real address carries a number somewhere.
    if (!/\d/.test(raw)) continue;
    return { raw, ...splitAddress(raw) };
  }
  return null;
}

// Countries appear at the end of an address and belong in hq_country, which the
// encyclopaedia already fills. Kept short on purpose — this only has to catch the trailing
// token, and a name it does not know simply stays part of the city.
const COUNTRY = /^(?:italy|italia|france|deutschland|germany|spain|españa|switzerland|svizzera|suisse|united\s+kingdom|england|u\.?k\.?|united\s+states|u\.?s\.?a\.?|netherlands|belgium|austria|portugal)$/i;

const POSTCODE_ONLY = /^[A-Z]{0,2}[-\s]?\d{4,6}$/i;
const POSTCODE_THEN_CITY = /^([A-Z]{0,2}[-\s]?\d{4,6})\s+(.{2,48})$/i;
// SW1A 1AA, EC1V 9NR.
const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const UK_THEN_CITY = /^([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\s+(.{2,48})$/i;

/**
 * "Via de' Tornabuoni 2, 50123, Firenze" -> street, postcode, city.
 *
 * Driven by finding the postcode rather than by counting commas, because the same address
 * arrives as three parts, as two ("…, 50123 Firenze"), or as two with the postcode after
 * the city. Anything before the postcode is the street, whatever number of commas it took.
 */
export function splitAddress(raw: string): { street: string | null; postcode: string | null; city: string | null } {
  const cleaned = tidy(raw);
  let parts = cleaned.split(/\s*,\s*/).map(tidy).filter(Boolean);
  if (!parts.length) return { street: null, postcode: null, city: null };

  // A trailing country belongs to hq_country, not to the street.
  if (parts.length > 1 && COUNTRY.test(parts[parts.length - 1])) parts = parts.slice(0, -1);

  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];

    if (POSTCODE_ONLY.test(part) || UK_POSTCODE.test(part)) {
      return {
        postcode: part,
        city: cityOf(parts[i + 1] ?? null),
        street: joinOrNull(parts.slice(0, i)),
      };
    }
    const both = POSTCODE_THEN_CITY.exec(part) ?? UK_THEN_CITY.exec(part);
    if (both) {
      return {
        postcode: tidy(both[1]),
        city: cityOf(both[2]),
        street: joinOrNull(parts.slice(0, i)),
      };
    }
  }

  // No postcode anywhere. The last part is the city if it reads like one — a part with a
  // house number in it is still the street, and calling it a city would be worse than
  // leaving the field empty.
  const last = parts[parts.length - 1];
  if (parts.length > 1 && !/\d/.test(last)) {
    return { street: joinOrNull(parts.slice(0, -1)), postcode: null, city: cityOf(last) };
  }
  return { street: joinOrNull(parts), postcode: null, city: null };
}

/** "Firenze (FI)" -> "Firenze". The province code is not part of the city's name. */
function cityOf(part: string | null): string | null {
  if (!part) return null;
  const city = tidy(part.replace(/\s*\([A-Z]{2}\)\s*$/i, ""));
  return city && !COUNTRY.test(city) ? city : null;
}

const joinOrNull = (parts: string[]): string | null => (parts.length ? parts.join(", ") : null);

const tidy = (s: string): string =>
  s.replace(/\s+/g, " ").replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, "").trim();
