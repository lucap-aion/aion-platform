// Text in a slide, as PowerPoint actually stores it.

/** A slide's words as a reader sees them: runs joined, one line per paragraph. */
export function slideText(xml: string): string {
  return (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? [])
    .map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(""))
    .join("\n");
}

// A run's properties: self-closing, or open…close. The open tag must not end in "/>", or a
// self-closing rPr would let the match run on into the NEXT run's closing tag.
const RPR = String.raw`(<a:rPr\b[^>]*?\/>|<a:rPr\b(?:[^>]*[^\/>])?>[\s\S]*?<\/a:rPr>)`;
const PAIR = new RegExp(String.raw`<a:r>${RPR}<a:t>([^<]*)<\/a:t><\/a:r><a:r>${RPR}<a:t>([^<]*)<\/a:t><\/a:r>`, "g");

/** The attributes that split a run without changing how it is drawn. */
const looks = (rPr: string) => rPr.replace(/\s(?:err|dirty|lang|altLang|noProof|smtClean)="[^"]*"/g, "");

/**
 * Adjacent runs that would look the same, joined into one.
 *
 * PowerPoint splits a phrase into runs for reasons nobody sees — a spell-check flag on one
 * word is enough: the 2026-11-04 teaser's "Leather bag" is "Leather " and "bag", identical
 * but for err="1" on the second, and a find-and-replace on the slide XML never sees the
 * phrase. Anything that does change the drawing — size, colour, bold, a font — keeps the
 * runs apart.
 */
export function mergeTwinRuns(xml: string): string {
  let out = xml;
  for (let guard = 0; guard < 50; guard++) {
    let changed = false;
    out = out.replace(PAIR, (whole, r1: string, t1: string, r2: string, t2: string) => {
      if (looks(r1) !== looks(r2)) return whole;
      changed = true;
      return `<a:r>${r1}<a:t>${t1}${t2}</a:t></a:r>`;
    });
    if (!changed) break;
  }
  return out;
}
