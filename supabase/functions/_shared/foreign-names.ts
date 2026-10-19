// ==============================|| ANOTHER HOUSE'S NAME ||============================== //
//
// Every document AION generates for a prospect is built from a template, and a template is
// the last document somebody made with it. That is how a filled-in workbook belonging to one
// house went out to every other one. So each artefact is searched, before it is stored, for
// the name of any other brand on the platform.
//
// The whole difficulty is people. AION's own team slide carries an advisor called Riccardo
// Ferragamo, and a substring match reports a leak on every deck ever built — a warning that
// is wrong every time is a warning nobody reads, which is worse than no warning at all.

export type House = { name?: string | null; legal_name?: string | null };

/**
 * Which of `houses` are named in `text`.
 *
 * A single-word house name preceded by a capitalised word is read as somebody's surname and
 * ignored — UNLESS that preceding word belongs to the house's own legal name, which is
 * precisely how "Salvatore Ferragamo" differs from "Riccardo Ferragamo".
 *
 * Names under five characters are skipped: a three-letter house matches half the language.
 */
export function foreignNamesFound(text: string, houses: House[]): string[] {
  const found = new Set<string>();

  for (const house of houses) {
    // Every word of this house's own identity, so a first name that is genuinely part of it
    // ("Salvatore", "Roberto", "Pasquale") does not disguise a real leak as a person.
    const ownWords = new Set(
      `${house.name ?? ""} ${house.legal_name ?? ""}`.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean),
    );

    for (const raw of [house.name, house.legal_name]) {
      const needle = (raw ?? "").trim();
      if (needle.length < 5 || found.has(needle)) continue;

      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      // Capture whatever word sits immediately before the match, so a surname can be told
      // from a house. The trailing guard stops "Coin" matching inside "Coinbase".
      const re = new RegExp(`(\\S+[ \\t]+)?${escaped}(?![\\p{L}])`, "giu");

      for (const m of text.matchAll(re)) {
        const before = (m[1] ?? "").trim().replace(/[^\p{L}]/gu, "");
        const looksLikeAPerson =
          !needle.includes(" ") &&
          /^\p{Lu}\p{L}+$/u.test(before) &&
          !ownWords.has(before.toLowerCase());
        if (!looksLikeAPerson) { found.add(needle); break; }
      }
    }
  }
  return [...found];
}

/**
 * The readable text of an OOXML file — pptx, xlsx or docx alike.
 *
 * Every part that can carry words: slides, notes, the shared string table, charts, headers,
 * and the document properties, where an author's name and a previous title survive a "save
 * as". Tags are stripped so the search sees what a reader would.
 */
export async function readableText(
  bytes: Uint8Array,
  load: (b: Uint8Array) => Promise<{ files: Record<string, unknown>; file(p: string): { async(t: "string"): Promise<string> } | null }>,
): Promise<string> {
  let zip: Awaited<ReturnType<typeof load>>;
  try { zip = await load(bytes); } catch { return ""; }

  const parts: string[] = [];
  for (const path of Object.keys(zip.files)) {
    if (!/\.(xml|rels)$/i.test(path)) continue;
    if (/^(ppt|xl|word)\/media\//.test(path)) continue;
    const xml = await zip.file(path)?.async("string").catch(() => null);
    if (xml) parts.push(xml);
  }
  return parts.join(" ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ");
}
