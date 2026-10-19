// One HTML-entity decoder for everything that reads a page.
//
// There were two, and both carried a short list of the entities someone had already been
// bitten by. Each list was right for the house that found it and wrong for the next one:
// Buccellati writes Italian, so its knowledge base came out of the crawl with 176
// "&ograve;" and 148 "&ugrave;" in it — "Gianmaria Buccellati cre&ograve;" in the
// assistant's own sources panel — and French pages added "&ecirc;", "&oelig;" and
// "&acirc;". None of them were on either list. The full HTML 4 set is 252 names and costs
// nothing to carry, so this carries all of it, plus the handful of HTML5 names that
// actually turn up in marketing copy.
//
// Case matters: "&Ugrave;" is Ù and "&ugrave;" is ù. The old lookup lower-cased the name
// first, which turned every capital into a small letter. An unknown name is left exactly
// as written, rather than guessed at.
//
// Pure and dependency-free, so the front end's tests and both edge-function callers can
// share it.

const ENTITIES: Record<string, string> = {
  // Markup and punctuation
  quot: '"', amp: "&", apos: "'", lt: "<", gt: ">", nbsp: " ",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", sbquo: "‚",
  ldquo: "“", rdquo: "”", bdquo: "„", dagger: "†", Dagger: "‡",
  bull: "•", hellip: "…", permil: "‰", prime: "′", Prime: "″",
  lsaquo: "‹", rsaquo: "›", oline: "‾", frasl: "⁄", euro: "€",
  trade: "™", ensp: " ", emsp: " ", thinsp: " ", zwnj: "‌",
  zwj: "‍", lrm: "‎", rlm: "‏", circ: "ˆ", tilde: "˜",
  OElig: "Œ", oelig: "œ", Scaron: "Š", scaron: "š", Yuml: "Ÿ",
  fnof: "ƒ",
  // Latin-1 supplement, U+00A1–U+00FF
  iexcl: "¡", cent: "¢", pound: "£", curren: "¤", yen: "¥",
  brvbar: "¦", sect: "§", uml: "¨", copy: "©", ordf: "ª",
  laquo: "«", not: "¬", shy: "­", reg: "®", macr: "¯",
  deg: "°", plusmn: "±", sup2: "²", sup3: "³", acute: "´",
  micro: "µ", para: "¶", middot: "·", cedil: "¸", sup1: "¹",
  ordm: "º", raquo: "»", frac14: "¼", frac12: "½", frac34: "¾",
  iquest: "¿",
  Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã", Auml: "Ä",
  Aring: "Å", AElig: "Æ", Ccedil: "Ç", Egrave: "È", Eacute: "É",
  Ecirc: "Ê", Euml: "Ë", Igrave: "Ì", Iacute: "Í", Icirc: "Î",
  Iuml: "Ï", ETH: "Ð", Ntilde: "Ñ", Ograve: "Ò", Oacute: "Ó",
  Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö", times: "×", Oslash: "Ø",
  Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û", Uuml: "Ü", Yacute: "Ý",
  THORN: "Þ", szlig: "ß",
  agrave: "à", aacute: "á", acirc: "â", atilde: "ã", auml: "ä",
  aring: "å", aelig: "æ", ccedil: "ç", egrave: "è", eacute: "é",
  ecirc: "ê", euml: "ë", igrave: "ì", iacute: "í", icirc: "î",
  iuml: "ï", eth: "ð", ntilde: "ñ", ograve: "ò", oacute: "ó",
  ocirc: "ô", otilde: "õ", ouml: "ö", divide: "÷", oslash: "ø",
  ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü", yacute: "ý",
  thorn: "þ", yuml: "ÿ",
  // Greek
  Alpha: "Α", Beta: "Β", Gamma: "Γ", Delta: "Δ", Epsilon: "Ε",
  Zeta: "Ζ", Eta: "Η", Theta: "Θ", Iota: "Ι", Kappa: "Κ",
  Lambda: "Λ", Mu: "Μ", Nu: "Ν", Xi: "Ξ", Omicron: "Ο",
  Pi: "Π", Rho: "Ρ", Sigma: "Σ", Tau: "Τ", Upsilon: "Υ",
  Phi: "Φ", Chi: "Χ", Psi: "Ψ", Omega: "Ω",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", omicron: "ο",
  pi: "π", rho: "ρ", sigmaf: "ς", sigma: "σ", tau: "τ",
  upsilon: "υ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  thetasym: "ϑ", upsih: "ϒ", piv: "ϖ",
  // Arrows, maths, shapes
  larr: "←", uarr: "↑", rarr: "→", darr: "↓", harr: "↔",
  crarr: "↵", lArr: "⇐", uArr: "⇑", rArr: "⇒", dArr: "⇓",
  hArr: "⇔", forall: "∀", part: "∂", exist: "∃", empty: "∅",
  nabla: "∇", isin: "∈", notin: "∉", ni: "∋", prod: "∏",
  sum: "∑", minus: "−", lowast: "∗", radic: "√", prop: "∝",
  infin: "∞", ang: "∠", and: "∧", or: "∨", cap: "∩",
  cup: "∪", int: "∫", there4: "∴", sim: "∼", cong: "≅",
  asymp: "≈", ne: "≠", equiv: "≡", le: "≤", ge: "≥",
  sub: "⊂", sup: "⊃", nsub: "⊄", sube: "⊆", supe: "⊇",
  oplus: "⊕", otimes: "⊗", perp: "⊥", sdot: "⋅", lceil: "⌈",
  rceil: "⌉", lfloor: "⌊", rfloor: "⌋", lang: "〈", rang: "〉",
  loz: "◊", spades: "♠", clubs: "♣", hearts: "♥", diams: "♦",
  weierp: "℘", image: "ℑ", real: "ℜ", alefsym: "ℵ",
  // HTML5 names seen in the wild
  hyphen: "‐", dash: "‐", nbhy: "‑", horbar: "―", lowbar: "_",
  colon: ":", comma: ",", period: ".", excl: "!", quest: "?", num: "#", dollar: "$",
  percnt: "%", lpar: "(", rpar: ")", ast: "*", plus: "+", sol: "/", bsol: "\\",
  semi: ";", equals: "=", commat: "@", lsqb: "[", rsqb: "]", lcub: "{", rcub: "}",
  verbar: "|", grave: "`", check: "✓", star: "☆", starf: "★",
};

function fromCode(code: number, whole: string): string {
  // NUL, surrogates and out-of-range code points are not characters; leave the text alone
  // rather than emit something that breaks JSON or Postgres further down the line.
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
  return String.fromCodePoint(code);
}

/**
 * Decode HTML character references: named (`&ograve;`), decimal (`&#242;`) and hex
 * (`&#xF2;`, `&#x20;`).
 *
 * Repeated until nothing changes (three passes at most), because a value escaped twice is
 * common — a platform that escapes a title it already escaped serves `&amp;#x20;`, which
 * one pass turns into the very `&#x20;` this exists to remove. Every caller wants display
 * text, never markup, so there is no literal entity worth preserving.
 *
 * A non-breaking space comes back as a plain space: every caller wants text, and a U+00A0
 * between two words is what stops a long name wrapping.
 */
export function decodeEntities(value: string): string {
  let s = value;
  for (let pass = 0; pass < 3 && s && s.indexOf("&") !== -1; pass++) {
    const next = decodeOnce(s);
    if (next === s) break;
    s = next;
  }
  return s;
}

function decodeOnce(value: string): string {
  return value.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body: string) => {
    let out: string;
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      out = fromCode(parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10), whole);
    } else {
      // Exact name first; a lower-cased fallback only for the markup five, which some
      // sites shout ("&AMP;", "&NBSP;") and which have no capital form to confuse.
      out = ENTITIES[body] ?? (/^(amp|lt|gt|quot|apos|nbsp)$/i.test(body) ? ENTITIES[body.toLowerCase()] : undefined) ?? whole;
    }
    return out === " " ? " " : out;
  });
}

/**
 * Text that still carries a character reference after decoding — the tell of a value that
 * was escaped twice, or never decoded at all. Used by checks, not by the decoder.
 */
export const HAS_ENTITY = /&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/;
