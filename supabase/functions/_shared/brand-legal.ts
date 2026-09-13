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

// A dot ends the capture only when it ends a SENTENCE — followed by a space and a capital.
// "Piazza Damiano Grassi Damiani n. 1" is one address and "n" was all of it that survived a
// rule that stopped at any dot before a space; "…Valenza (Al) DAMIANI S.p.A." is two
// sentences and has to be cut between them.
//
// How a company says where it is registered, across the languages these houses publish in.
// The address runs to the first sentence end or opening bracket — the Ferragamo line
// continues "(hereinafter, …)" and everything from the bracket on is not an address.
const OFFICE_PATTERNS: { re: RegExp; language: Language }[] = [
  { re: /(?:with|having)\s+(?:its\s+)?(?:registered|legal)\s+(?:office|seat|address)e?s?\s+(?:at|in)\s+((?:[^.\n]|\.(?!\s+[A-Z]|\s*$)){6,180})/i, language: "en" },
  // The connective is optional because a house writes it as a sentence as often as a label:
  // "registered office: 1 Bond Street" and "The registered office is located at 1 Bond
  // Street" are the same statement. LEAD_IN removes whatever copula it turns out to be, and
  // the "must contain a digit" test below still rejects a capture that is not an address.
  { re: /registered\s+(?:office|seat|address)e?s?\s*(?::|at|in)?\s+((?:[^.\n]|\.(?!\s+[A-Z]|\s*$)){6,180})/i, language: "en" },
  { re: /sede\s+legale\s*(?:in|:)?\s+((?:[^.\n]|\.(?!\s+[A-Z]|\s*$)){6,180})/i, language: "it" },
  { re: /siège\s+social\s*(?::|à|au)?\s+((?:[^.\n]|\.(?!\s+[A-Z]|\s*$)){6,180})/i, language: "fr" },
  { re: /domicilio\s+(?:social|fiscal)\s*(?::|en)?\s+((?:[^.\n]|\.(?!\s+[A-Z]|\s*$)){6,180})/i, language: "es" },
  { re: /(?:Sitz|Geschäftsanschrift)\s*(?::|in)\s+((?:[^.\n]|\.(?!\s+[A-Z]|\s*$)){6,180})/i, language: "de" },
];

type Language = "en" | "it" | "fr" | "es" | "de";

/**
 * What a house writes BETWEEN the label and the address.
 *
 * "Le siège social est situé au 44, avenue des Champs-Élysées" — the pattern's optional "au"
 * matched nothing, so the capture began at "est situé au" and the whole phrase went onto
 * Messika's record as its registered address, and from there onto the data request the
 * client is sent.
 */
// Unicode-aware boundaries, not \b: these phrases end in accented letters, and \b sees "é"
// as a non-word character, so "est situé au" ended at a boundary that never came. And the
// prepositions are ordered longest-first — "a" ahead of "at" ate the A and left "t 1 Bond
// Street" on the record.
const LEAD_IN =
  /^(?:est\s+situ[ée]e?s?|se\s+situe|se\s+trouve|si\s+trova|sono\s+in|è\s+in|is\s+located|are\s+located|is\s+at|located|se\s+encuentra|est[áa]\s+en|befindet\s+sich|liegt|ist)(?![\p{L}])[\s:,]*(?:aux|au|à|at|in|en|the|a)?(?![\p{L}])[\s:,]*/iu;

/**
 * The country a registered office is in, when the evidence is unambiguous.
 *
 * The language a company states its office in narrows it, and the postcode's shape settles
 * it: France, Italy, Spain and Germany all use five digits, and every other country that
 * shares one of those languages — Belgium, Switzerland, Austria, Luxembourg — uses four.
 * So a French-language office with a five-digit postcode is in France, and a French-language
 * office with a four-digit one is left alone rather than guessed at.
 *
 * It matters because the country makes the Chubb policy prefix. Without it Messika came out
 * as MESXX, which is a placeholder in a bordereau key that nothing downstream flags.
 */
const FIVE_DIGIT_COUNTRY: Partial<Record<Language, string>> = {
  fr: "France", it: "Italy", es: "Spain", de: "Germany",
};

function countryFrom(language: Language, postcode: string | null): string | null {
  if (!postcode) return null;
  return /^\d{5}$/.test(postcode.trim()) ? FIVE_DIGIT_COUNTRY[language] ?? null : null;
}

export type RegisteredOffice = {
  /** The address exactly as the site states it, before it was split up. */
  raw: string;
  street: string | null;
  postcode: string | null;
  city: string | null;
  /** Only when the language and the postcode agree on one — never a guess. */
  country: string | null;
};

/** The registered office as the house's own legal text states it, or null. */
export function registeredOfficeFrom(text: string | null | undefined): RegisteredOffice | null {
  const body = String(text ?? "");
  if (!body) return null;
  // EVERY occurrence of every pattern, scored — not the first that parses.
  //
  // Site text states the office once. A SEARCH RESULT states it several times over, across
  // snippets of wildly different quality: one search for Damiani returned a heading with no
  // address under it, a snippet the engine had truncated mid-street ("Piazza ani, N.1"),
  // and one clean sentence carrying the whole thing. First-past-the-post took the truncated
  // one and would have put it on a contract.
  const candidates: { office: RegisteredOffice; score: number }[] = [];

  for (const { re, language } of OFFICE_PATTERNS) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of body.matchAll(global)) {
      const raw = tidy(cutAtClause(tidy(m[1]).replace(LEAD_IN, "")).replace(AFTER_THE_ADDRESS, ""));
      // "at our offices" and similar: a real address carries a number somewhere.
      if (!/\d/.test(raw)) continue;
      const parts = splitAddress(raw);
      // A label with no street under it is not an address: a bare "Sede Legale" heading
      // parses to a town and nothing else, and that is worse than leaving the field empty.
      if (!parts.street) continue;
      // The address's own words first: a house that writes "75008 Paris, France" has told
      // us, and no inference beats being told. Language-and-postcode is the fallback.
      const named = raw.split(/\s*,\s*/).map(countryNamed).find(Boolean) ?? null;
      candidates.push({
        office: { raw, ...parts, country: named ?? countryFrom(language, parts.postcode) },
        // A postcode is the strongest sign the line is a real address rather than prose.
        score: (parts.postcode ? 2 : 0) + (parts.city ? 1 : 0) + (named ? 1 : 0),
      });
    }
  }
  if (!candidates.length) return null;

  // Best score, then the SHORTEST raw: a capture that ran on into the next sentence is
  // longer than one that stopped where the address did.
  candidates.sort((a, b) => b.score - a.score || a.office.raw.length - b.office.raw.length);
  return candidates[0].office;
}

// Countries appear in an address and belong in hq_country. Mapped to one canonical English
// spelling, because that is what the policy prefix is built from — policyPrefix("Hermès",
// "France") is HERFR, and "Francia" would be HERXX.
const COUNTRIES: [RegExp, string][] = [
  [/^(?:italy|italia|italie|italien)$/i, "Italy"],
  [/^(?:france|francia|frankreich)$/i, "France"],
  [/^(?:germany|deutschland|germania|allemagne)$/i, "Germany"],
  [/^(?:spain|españa|espana|espagne|spagna)$/i, "Spain"],
  [/^(?:switzerland|svizzera|suisse|schweiz)$/i, "Switzerland"],
  [/^(?:united\s+kingdom|england|great\s+britain|u\.?k\.?)$/i, "United Kingdom"],
  [/^(?:united\s+states|u\.?s\.?a\.?|u\.?s\.?)$/i, "United States"],
  [/^(?:netherlands|nederland|pays-bas)$/i, "Netherlands"],
  [/^(?:belgium|belgique|belgië|belgio)$/i, "Belgium"],
  [/^(?:austria|österreich|autriche)$/i, "Austria"],
  [/^(?:portugal)$/i, "Portugal"],
];

/** The canonical name of a country an address part names, or null. */
function countryNamed(part: string): string | null {
  const t = tidy(part);
  for (const [re, name] of COUNTRIES) if (re.test(t)) return name;
  return null;
}

const COUNTRY = /^(?:italy|italia|france|deutschland|germany|spain|españa|switzerland|svizzera|suisse|united\s+kingdom|england|u\.?k\.?|united\s+states|u\.?s\.?a\.?|netherlands|belgium|austria|portugal)$/i;

// What a company appends after its address, which is not part of it: "…, 75008 Paris,
// France, registered with the Paris Trade and Companies Register under number 301 29…"
/**
 * A bracket that opens a CLAUSE rather than part of the address.
 *
 * The capture used to forbid "(" outright, because Ferragamo's line continues "(hereinafter,
 * …)". But an Italian address carries its province in brackets — "15048 Valenza (AL),
 * Piazza Damiano Grassi Damiani n. 1" — so forbidding it truncated the line before the
 * street and threw the street away. Five characters is the rule: "(AL)" is an address,
 * anything longer is prose.
 */
function cutAtClause(raw: string): string {
  const at = [...raw.matchAll(/\(/g)].find((m) => {
    const close = raw.indexOf(")", m.index! + 1);
    return close < 0 || close - m.index! > 6;
  });
  return at ? raw.slice(0, at.index!) : raw;
}

const AFTER_THE_ADDRESS = /[,;]?\s*(?:registered\s+(?:with|in|at|under)|immatricul[ée]e?\s+au|iscritta\s+al|inscrita\s+en|eingetragen\s+im|r\.?c\.?s\.?\b|vat\b|p\.?\s?iva\b|partita\s+iva\b|codice\s+fiscale\b|c\.f\.|company\s+(?:no|number)\b)[\s\S]*$/i;

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
  // A SPACED hyphen is a separator in Italian addresses — "Piazza … N.1 - 15048 Valenza (Al)
  // - Italia" — while an unspaced one is part of a name, as in "Rue Saint-Honoré". Splitting
  // on it as well as the comma is what finds the postcode in that line.
  let parts = cleaned.split(/\s*,\s*|\s+-\s+/).map(tidy).filter(Boolean);
  if (!parts.length) return { street: null, postcode: null, city: null };

  // A country belongs in hq_country, not in the street — wherever in the line it sits. It
  // used to be dropped only when it was the LAST part, and Messika writes "…, 75008 Paris,
  // France, registered with the Paris Trade and Companies Register…", so the country was
  // neither removed nor read.
  if (parts.length > 1) {
    const withoutCountry = parts.filter((p) => !COUNTRY.test(p));
    if (withoutCountry.length) parts = withoutCountry;
  }

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
        // Italian legal text puts the postcode and town FIRST and the street after:
        // "15048 Valenza (AL), Piazza Damiano Grassi Damiani n. 1". Taking only what came
        // before the postcode returned no street at all on exactly those addresses.
        street: joinOrNull(i === 0 ? parts.slice(1) : parts.slice(0, i)),
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
