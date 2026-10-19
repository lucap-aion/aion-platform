// What a house is, from a source that describes it rather than sells to it.
//
// The identity harvester reads the brand's own site, which is the right first
// answer for a logo and colours and the wrong one for a description: a
// storefront's <meta name="description"> is written for Google's results page.
// Ferragamo's is "Shop the latest Ferragamo collection for women & men at
// Ferragamo.com. Explore an assortment of…" — accurate, useless, and it went
// straight onto the brand record.
//
// Wikidata and Wikipedia describe the same company as an encyclopaedia would:
// "an Italian luxury fashion house focused on apparel, footwear, and accessories
// headquartered in Florence, Italy", founded 1927. Wikidata also holds the
// OFFICIAL logo as a Commons file, and Commons rasterises SVG on request — so a
// vector wordmark, which PowerPoint cannot embed, comes back as a 960x120 PNG
// that it can. That is the difference between a co-branded deck and one carrying
// only AION's mark.
//
// The danger in an external source is attaching the wrong company: "Ferragamo"
// is also a person, a film and a street. So nothing is accepted unless the
// entity's own `official website` matches the website we were given. No match,
// no enrichment — an empty field beats a confident wrong one.

export type Enrichment = {
  description?: string;
  logo?: string;
  hq_city?: string;
  hq_country?: string;
  founded?: number;
  entity: string;
  matched_on: string;
  source: string;
};

const UA = "AION-Cover/1.0 (brand onboarding; contact: tech@aioncover.com)";

/**
 * The opening sentences, without breaking on an abbreviation.
 *
 * Splitting on every period truncated "Buccellati Holding Italia S.p.A. is an
 * Italian jewellery house" to "Buccellati Holding Italia S. p." — which is not a
 * description, it is a fragment. Italian company names are full of them, so the
 * split only fires where a sentence plausibly ends: after a period, a space, and
 * a capital, with the preceding token long enough not to be an initial.
 */
export function firstSentences(text: string, count: number): string {
  const parts: string[] = [];
  let buf = "";
  for (const chunk of text.split(/(?<=[.!?])\s+(?=[A-Z(])/)) {
    buf = buf ? `${buf} ${chunk}` : chunk;
    // "S.p.A." and "Inc." leave a last token that is an initial or a known
    // abbreviation — keep absorbing until the sentence actually looks finished.
    const lastToken = buf.trim().split(/\s+/).pop() ?? "";
    const looksAbbreviated = /^(?:[A-Za-z]\.){1,4}$|^(?:S\.p\.A|Inc|Ltd|Co|Corp|S\.A|N\.V|GmbH|Srl|S\.r\.l)\.?$/i.test(lastToken);
    if (looksAbbreviated) continue;
    parts.push(buf.trim());
    buf = "";
    if (parts.length >= count) break;
  }
  if (buf.trim() && parts.length < count) parts.push(buf.trim());
  return parts.join(" ").trim();
}

const host = (url: string | undefined | null) =>
  (url ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();

async function getJson(url: string, timeoutMs = 15000): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

const claim = (claims: Record<string, unknown>, pid: string): Record<string, unknown> | string | null => {
  const arr = claims?.[pid] as Array<Record<string, unknown>> | undefined;
  const v = arr?.[0]?.mainsnak as Record<string, unknown> | undefined;
  const dv = v?.datavalue as Record<string, unknown> | undefined;
  return (dv?.value as Record<string, unknown> | string) ?? null;
};

/** English label for a Q-id — headquarters and country are stored as entities. */
async function labelOf(qid: string): Promise<string | null> {
  const d = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels&languages=en&format=json&origin=*`);
  const ent = (d?.entities as Record<string, Record<string, unknown>> | undefined)?.[qid];
  const labels = ent?.labels as Record<string, { value?: string }> | undefined;
  return labels?.en?.value ?? null;
}

/**
 * Look the brand up, and only return anything if it is provably the same company.
 *
 * `website` is the check, not a hint: Wikidata's `official website` (P856) has to
 * resolve to the same host we were given. That is what stops "Ferragamo" the
 * house being confused with Salvatore Ferragamo the man, whose entity has no
 * website at all, and what stops a same-named company in another industry.
 */
export async function enrichFromWikidata(name: string, website: string): Promise<Enrichment | null> {
  const wanted = host(website);
  if (!name.trim() || !wanted) return null;

  const search = await getJson(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&limit=7&origin=*`);
  const candidates = ((search?.search as Array<{ id?: string }> | undefined) ?? [])
    .map((r) => r.id).filter((id): id is string => !!id);
  if (!candidates.length) return null;

  // Score every candidate whose website matches, then take the most
  // company-like. Matching on the website alone is not enough: searching
  // "Ferragamo" returns Salvatore Ferragamo the MAN before the house he founded,
  // and his entity carries the company's website too — so the first match was a
  // description reading "was an Italian shoe designer" on a brand record.
  const matches: { qid: string; entity: Record<string, unknown>; claims: Record<string, unknown>; score: number }[] = [];

  for (const qid of candidates) {
    const data = await getJson(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, 20000);
    const entity = (data?.entities as Record<string, Record<string, unknown>> | undefined)?.[qid];
    if (!entity) continue;
    const claims = entity.claims as Record<string, unknown>;
    if (!claims) continue;

    const official = claim(claims, "P856");
    if (typeof official !== "string" || host(official) !== wanted) continue;

    // instance of human — a founder, not the house.
    const instances = ((claims.P31 as Array<Record<string, unknown>> | undefined) ?? [])
      .map((c) => ((c.mainsnak as Record<string, unknown>)?.datavalue as Record<string, unknown> | undefined)?.value as { id?: string } | undefined)
      .map((v) => v?.id).filter(Boolean);
    if (instances.includes("Q5")) continue;

    // The properties an organisation has and a person does not.
    const score = ["P154", "P159", "P571", "P452", "P1128", "P2139"].filter((pid) => claims[pid]).length;
    matches.push({ qid, entity, claims, score });
  }

  matches.sort((a, b) => b.score - a.score);

  for (const { qid, entity, claims } of matches) {
    const official = claim(claims, "P856") as string;

    const out: Enrichment = {
      entity: qid,
      matched_on: `official website ${host(official)}`,
      source: `wikidata:${qid}`,
    };

    // Logo. Commons rasterises on request, so a vector wordmark arrives as a PNG
    // wide enough for a slide instead of an SVG nothing can embed.
    const logoFile = claim(claims, "P154");
    if (typeof logoFile === "string") {
      out.logo = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(logoFile.replace(/ /g, "_"))}?width=800`;
    }

    const inception = claim(claims, "P571");
    if (inception && typeof inception === "object") {
      const year = Number(String((inception as { time?: string }).time ?? "").match(/^\+?(\d{4})/)?.[1]);
      if (year > 1000) out.founded = year;
    }

    for (const [pid, key] of [["P159", "hq_city"], ["P17", "hq_country"]] as const) {
      const v = claim(claims, pid);
      const id = v && typeof v === "object" ? (v as { id?: string }).id : undefined;
      if (id) {
        const label = await labelOf(id);
        if (label) out[key] = label;
      }
    }

    // The description comes from the Wikipedia article this entity links to,
    // because the article's first paragraph is a description and Wikidata's own
    // one-liner ("Italian luxury goods company") is a disambiguator.
    const sitelinks = entity.sitelinks as Record<string, { title?: string }> | undefined;
    const title = sitelinks?.enwiki?.title;
    if (title) {
      const page = await getJson(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`, 15000);
      const extract = typeof page?.extract === "string" ? page.extract.trim() : "";
      // One or two sentences: the record shows a paragraph, not an article.
      if (extract.length > 60) {
        out.description = firstSentences(extract, 2).slice(0, 600);
        out.source = `wikipedia:${title}`;
      }
    }

    // A match that yielded nothing usable is not a match worth reporting.
    return (out.description || out.logo || out.hq_city) ? out : null;
  }

  return null;
}
