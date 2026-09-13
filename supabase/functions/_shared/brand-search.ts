// ==============================|| WHEN THE SITE DOES NOT SAY ||============================== //
//
// A house's registered office and legal entity go onto a contract and into a Chubb
// bordereau, and they are the two things a website is least reliable about. Damiani
// publishes "Sede Legale" as a bare label with the value in a separate element, so the
// crawl indexed the label and lost the address. Messika states its office only in English
// prose. Wikidata carries neither: for Damiani it knows the legal FORM and the town, and no
// street.
//
// But a search engine has already read those pages, and its snippet carries the sentence
// whole:
//
//   "DAMIANI S.p.A., C.F. e P. IVA 01457570065, con sede in Valenza (AL), Piazza Damiano
//    Grassi Damiani n. 1"
//
// One search, three seconds, and the two fields that were going to a person to type in.
//
// The SITE stays authoritative: this runs only when the house's own legal text yielded
// nothing, because a company's own words about its own registration beat a search result
// about them. And it is anchored on the brand's name — a result naming a different company
// is discarded rather than written onto a contract.

import { registeredOfficeFrom, type RegisteredOffice } from "./brand-legal.ts";

/** What a company calls the place it is registered, in the language it registers in. */
const OFFICE_TERM: Record<string, string> = {
  Italy: "sede legale",
  France: "siège social",
  Switzerland: "siège social",
  Belgium: "siège social",
  Spain: "domicilio social",
  Germany: "Sitz der Gesellschaft",
  Austria: "Sitz der Gesellschaft",
  Netherlands: "statutaire zetel",
  Portugal: "sede social",
};

/** The query that finds a company's registration, in the right language for its country. */
export function officeQuery(name: string, country: string | null, website: string | null): string {
  const term = OFFICE_TERM[String(country ?? "")] ?? "registered office";
  let host = "";
  try { if (website) host = new URL(website).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
  // The host anchors the search on this house rather than a namesake, without restricting
  // results TO the site — which would defeat the point, since the site is what failed.
  return [`"${name}"`, term, host].filter(Boolean).join(" ");
}

// Corporate forms, longest-first so "S.p.A." wins over the "SA" inside it. Mirrors the list
// in brand-legal.ts deliberately: that one reads a description, this one reads a snippet,
// and they are allowed to diverge.
const SUFFIX = String.raw`(?:S\.p\.A\.|S\.P\.A\.|SpA|S\.r\.l\.|S\.R\.L\.|Srl|S\.A\.R\.L\.|SARL|S\.A\.S\.|S\.L\.U\.|S\.L\.|S\.A\.U\.|S\.A\.|GmbH|mbH|AG|N\.V\.|B\.V\.|ApS|Oyj|Oy|AB|PLC|Plc|plc|Ltd\.?|Limited|Inc\.?|Corp\.?|LLC|KGaA|KG|SE|NV|BV|SA)`;

/**
 * The legal entity named in a search result, for THIS house.
 *
 * Anchored on the brand's own first word, so "Damiani S.p.A." is taken and "Rocca 1794
 * S.p.A." — a retailer that stocks them, and a likely neighbour in any result — is not.
 *
 * Prefers a form that is not shouted: the same entity appears as "DAMIANI S.p.A." in one
 * snippet and "Damiani S.p.A." in the next, and a contract should carry the second.
 */
export function legalEntityFor(text: string, brandName: string): string | null {
  const first = String(brandName ?? "").trim().split(/\s+/)[0];
  if (first.length < 3) return null;
  const re = new RegExp(
    `\\b(${first}[^,\\n]{0,60}?(?:,\\s*|\\s)${SUFFIX})(?![\\p{L}])`, "giu",
  );
  const seen = new Map<string, number>();
  for (const m of String(text ?? "").matchAll(re)) {
    const found = m[1].replace(/\s+/g, " ").trim();
    seen.set(found, (seen.get(found) ?? 0) + 1);
  }
  if (!seen.size) return null;

  // Shouted means the NAME is, not the suffix: "DAMIANI S.p.A." is the same entity as
  // "Damiani S.p.A." and a contract should carry the second. Testing the whole string for
  // all-caps fails, because the "p" in "S.p.A." is lowercase in both.
  const shouted = (s: string) => /^[A-Z]{3,}(\s|$)/.test(s);
  // Not shouted, then the FULLEST form — "Damiani S.p.A." over "Damiani Spa", which is the
  // same entity abbreviated — then whichever a search saw more of.
  return [...seen.entries()].sort((a, b) =>
    Number(shouted(a[0])) - Number(shouted(b[0])) ||
    b[0].length - a[0].length ||
    b[1] - a[1] ||
    a[0].localeCompare(b[0]),
  )[0][0];
}

/** The phrases a company's registration is announced with, in the languages these use. */
const OFFICE_PHRASE = /sede\s+legale|si[èe]ge\s+social|registered\s+office|domicilio\s+(?:social|fiscal)|Sitz\s+der\s+Gesellschaft|sede\s+social|statutaire\s+zetel/gi;

/**
 * The office stated for THIS house, out of a page of results about several.
 *
 * The reader in brand-legal has no notion of whose address it is reading, and on a site it
 * does not need one. In a search result it does: a query for Damiani returns Rocca 1794
 * S.p.A. — a retailer that stocks them — announcing ITS registered office in Via Roma,
 * Milano, in a snippet that also says the word "Damiani". Scored on its own merits that
 * address wins, and it would have gone onto Damiani's contract and into a Chubb bordereau.
 *
 * So each mention is judged by the nearest company named before it. If that is somebody
 * else, the mention is not this house's, whoever else the sentence goes on to mention.
 */
export function officeFor(text: string, brandName: string): RegisteredOffice | null {
  const body = String(text ?? "");
  const first = String(brandName ?? "").trim().split(/\s+/)[0];
  if (!first) return null;

  // Case-insensitive: a house writes itself "Damiani S.p.a." as readily as "S.p.A.", and a
  // case-sensitive suffix list silently matched neither. The check that matters is the
  // brand one below, not the capitalisation.
  const entity = new RegExp(`([\\p{L}][^,\\n]{0,60}?(?:,\\s*|\\s)${SUFFIX})(?![\\p{L}])`, "giu");
  // Is the company named here OURS? Tested at the END of the capture, not the start: a
  // regex scanning a snippet begins its match at the earliest position that can work, so
  // "…Description: Damiani S.P.A." is one match and an anchor at the front sees
  // "Description" and rejects the house.
  const esc = first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mine = new RegExp(`\\b${esc}\\b[^,\\n]{0,40}?${SUFFIX}\\s*$`, "iu");

  const ours: string[] = [];
  for (const at of body.matchAll(OFFICE_PHRASE)) {
    const before = body.slice(Math.max(0, at.index! - 160), at.index!);
    const named = [...before.matchAll(entity)].pop()?.[1]?.trim();
    // A mention with no company named before it is ambiguous, not ours — a search result is
    // full of them, and guessing costs more than waiting for a person.
    if (!named || !mine.test(named)) continue;
    // Stop at the end of THIS result. A fixed window ran on into the next snippet, which is
    // a different company's, and the address it found there was picked up as this house's.
    const rest = body.slice(at.index!, at.index! + 400);
    const boundary = rest.search(/\n\s*\n|\n\s*\[\d+\]/);
    ours.push(boundary > 0 ? rest.slice(0, boundary) : rest);
  }
  if (!ours.length) return null;

  // Everything this house said about its own office, handed to the reader TOGETHER so its
  // scoring can choose between them. Taking the first accepted mention meant a heading that
  // happened to come earlier beat the sentence that actually carried the address.
  return registeredOfficeFrom(ours.join("\n"));
}

/**
 * The corporate forms a country actually registers companies under.
 *
 * A search for a French house returns its Italian branch as readily as its parent, and
 * "Messika Group S.r.l." is a real company — just not the one a French contract names. The
 * form is the tell: an S.r.l. is Italian, a SAS is French, a GmbH is German, and a house
 * registered in Paris is not any of the other two.
 *
 * Only used to REJECT, and only where the country is known. Shared forms — S.A. is French,
 * Spanish and Swiss; SE is European — belong to every country that uses them.
 */
const FORMS_BY_COUNTRY: Record<string, RegExp> = {
  Italy: /^(?:S\.?p\.?A\.?|S\.?r\.?l\.?|S\.?a\.?s\.?|S\.?n\.?c\.?|SE)$/i,
  France: /^(?:S\.?A\.?S\.?U?\.?|S\.?A\.?R\.?L\.?|SARL|S\.?A\.?|S\.?N\.?C\.?|SE)$/i,
  Spain: /^(?:S\.?A\.?U?\.?|S\.?L\.?U?\.?|SE)$/i,
  Germany: /^(?:GmbH|mbH|AG|KGaA|KG|SE)$/i,
  Austria: /^(?:GmbH|AG|KG|SE)$/i,
  Switzerland: /^(?:S\.?A\.?|AG|GmbH|S\.?[àa]\.?r\.?l\.?|SE)$/i,
  Netherlands: /^(?:N\.?V\.?|B\.?V\.?|SE)$/i,
  Belgium: /^(?:S\.?A\.?|N\.?V\.?|B\.?V\.?|S\.?P\.?R\.?L\.?|SE)$/i,
  Portugal: /^(?:S\.?A\.?|Lda\.?|SE)$/i,
  "United Kingdom": /^(?:Ltd\.?|Limited|PLC|plc|Plc)$/i,
  "United States": /^(?:Inc\.?|Corp\.?|Corporation|LLC|LLP)$/i,
};

/** Does this entity's corporate form belong in that country? Unknown country: yes. */
export function formSuitsCountry(entity: string, country: string | null): boolean {
  const allowed = FORMS_BY_COUNTRY[String(country ?? "")];
  if (!allowed) return true;
  const form = entity.trim().split(/[\s,]+/).pop() ?? "";
  return allowed.test(form);
}

export type SearchedIdentity = {
  legalName: string | null;
  office: RegisteredOffice | null;
  /** What was searched, so a note can say where an answer came from. */
  query: string;
};

/**
 * Ask the web what a house's registered office and legal entity are.
 *
 * Snippets only — `X-Respond-With: no-content` — because the answer is in the snippet and
 * fetching every result would cost a page read each for information a search engine has
 * already extracted.
 */
export async function searchIdentity(
  name: string, country: string | null, website: string | null, jinaKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SearchedIdentity> {
  const query = officeQuery(name, country, website);
  const empty: SearchedIdentity = { legalName: null, office: null, query };

  let text: string;
  try {
    const res = await fetchImpl(`https://s.jina.ai/${encodeURIComponent(query)}`, {
      headers: {
        ...(jinaKey ? { "Authorization": `Bearer ${jinaKey}` } : {}),
        "X-Respond-With": "no-content",
        "Accept": "text/plain",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return empty;
    text = await res.text();
  } catch {
    return empty;
  }
  if (!text.trim()) return empty;

  // A form that does not belong in this country is a different company — usually a local
  // branch of the same house, which is a real entity and the wrong one for the contract.
  const found = legalEntityFor(text, name);
  return {
    legalName: found && formSuitsCountry(found, country) ? found : null,
    // Anchored on the house: a search for one jeweller returns others, each announcing its
    // own registered office in a sentence that mentions ours.
    office: officeFor(text, name),
    query,
  };
}
