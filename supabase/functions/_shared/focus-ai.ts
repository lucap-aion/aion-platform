// What a house sells, decided by reading the catalogue rather than by counting words in it.
//
// The counting version (productFocus in brand-defaults.ts) answers a narrow question well:
// which of our category words appear on the most shelves. That is not the question. The
// question is which categories a pilot should cover, and the two come apart exactly where it
// matters — Ferragamo's catalogue holds 354 accessories and 60 watches, so counting says
// "Bags and Accessories" while the house's own commercial answer is bags and watches. Scarves
// and keyrings are numerous and cheap; watches are few, expensive and a different insurance
// risk. No amount of tuning the word list fixes that, because the missing thing is judgement
// about what the categories MEAN.
//
// So the catalogue is summarised — every shelf label with its count and what it is worth, the
// price range, a sample of product names — and a model picks one or two categories from a
// FIXED vocabulary, with a reason. Constrained to the vocabulary because the answer is not
// prose: it goes into the data request telling a client which categories the pilot covers,
// and it filters the catalogue the deck draws its pieces from. An invented category breaks
// both silently.
//
// It never gets the last word. An admin's own wording wins (product_focus_manual), and when
// the model is unavailable, slow, or answers with something outside the vocabulary, the
// counting version stands. Worse than today is not an option this is allowed to reach.

import { productFocus, focusBreakdown, type FocusEvidence, type FocusShare } from "./brand-defaults.ts";

/** Everything the model is told about a house, and nothing else. */
export type CatalogueDigest = {
  brand: string;
  description: string | null;
  products: number;
  /** Shelf labels, biggest first: what the house files its own pieces under. */
  shelves: { label: string; products: number; share: number; value: number; averagePrice: number | null }[];
  /** The categories our own counting picked, so the model is told what it is disagreeing with. */
  counted: FocusShare[];
  /** A spread of real product names — the cheap end, the middle and the expensive end. */
  sample: string[];
};

export type FocusDecision = {
  focus: string;
  /** One sentence, for the onboarding notes. The reason is the checkable part. */
  reason: string;
  source: "ai" | "counted";
};

export type DigestRow = {
  name?: string | null;
  category?: string | null;
  collection?: string | null;
  price?: number | null;
};

/**
 * The catalogue, small enough to send and complete enough to judge.
 *
 * Shelf labels carry the counts AND the value, because value is most of what distinguishes a
 * category worth insuring from a long tail — sixty watches at €4,000 are the point of a
 * pilot in a way three hundred keyrings are not. Names are sampled across the price range
 * rather than taken from the top, so a house does not read as a jeweller because its six most
 * expensive pieces are necklaces.
 */
export function catalogueDigest(
  brand: string, description: string | null, rows: DigestRow[], evidence: FocusEvidence,
): CatalogueDigest {
  const byShelf = new Map<string, { products: number; value: number; priced: number }>();
  for (const r of rows) {
    const label = (r.category ?? "").trim() || (r.collection ?? "").trim() || "(unfiled)";
    const s = byShelf.get(label) ?? { products: 0, value: 0, priced: 0 };
    s.products += 1;
    const price = Number(r.price);
    if (price > 0) { s.value += price; s.priced += 1; }
    byShelf.set(label, s);
  }

  const shelves = [...byShelf.entries()]
    .map(([label, s]) => ({
      label,
      products: s.products,
      share: rows.length ? s.products / rows.length : 0,
      value: Math.round(s.value),
      averagePrice: s.priced ? Math.round(s.value / s.priced) : null,
    }))
    .sort((a, b) => b.products - a.products)
    .slice(0, 20);

  return {
    brand,
    description: description?.slice(0, 600) ?? null,
    products: rows.length,
    shelves,
    counted: focusBreakdown(evidence).slice(0, 5),
    sample: sampleNames(rows, 24),
  };
}

/** Names from across the price range, not from one end of it. */
function sampleNames(rows: DigestRow[], want: number): string[] {
  const named = rows.filter((r) => (r.name ?? "").trim());
  if (!named.length) return [];
  const priced = named.filter((r) => Number(r.price) > 0)
    .sort((a, b) => Number(a.price) - Number(b.price));
  const pool = priced.length >= want ? priced : named;
  const step = Math.max(1, Math.floor(pool.length / want));
  const out: string[] = [];
  for (let i = 0; i < pool.length && out.length < want; i += step) {
    const name = (pool[i].name ?? "").trim();
    const price = Number(pool[i].price) > 0 ? ` (€${Math.round(Number(pool[i].price))})` : "";
    if (name) out.push(name + price);
  }
  return out;
}

/** The only answers accepted, in the words the rest of the system already speaks. */
export const FOCUS_VOCABULARY = [
  "High jewellery", "Watches", "Bags and leather goods", "Ready-to-wear", "Shoes",
  "Eyewear", "Silver and tableware", "Accessories", "Fragrance and beauty",
  "Writing instruments",
] as const;

export function buildPrompt(d: CatalogueDigest): string {
  const money = (n: number) => `€${n.toLocaleString("en-US")}`;
  const shelves = d.shelves
    .map((s) => `- ${s.label}: ${s.products} pieces (${Math.round(s.share * 100)}%)` +
      (s.value ? `, worth ${money(s.value)}` : "") +
      (s.averagePrice ? `, average ${money(s.averagePrice)}` : ""))
    .join("\n");

  return [
    `House: ${d.brand}`,
    d.description ? `How it describes itself: ${d.description}` : "",
    "",
    `Catalogue read from its website — ${d.products} pieces, filed by the house under these shelves:`,
    shelves,
    "",
    d.sample.length ? `Product names, sampled across the price range:\n${d.sample.map((n) => `- ${n}`).join("\n")}` : "",
    "",
    d.counted.length
      ? `A word-matching pass over the same catalogue ranked it: ${
        d.counted.map((c) => `${c.focus} (${c.products} pieces)`).join(", ")
      }. It counts pieces and knows nothing else; disagree with it where the commercial reality differs.`
      : "A word-matching pass over the same catalogue recognised nothing.",
    "",
    "Which one or two categories should an insurance pilot for this house cover?",
    "",
    "This decides which categories a client is asked about in a data request, and which part",
    "of the catalogue goes into their pitch deck. Judge by what the house is FOR — its",
    "signature categories and where its value sits — not by which shelf has the most rows. A",
    "catalogue scraped from a website is a sample: a category can be under-represented in it",
    "and still be the point of the house. Equally, a shelf full of cheap accessories is",
    "usually a long tail rather than a pilot.",
    "",
    `Answer with JSON only: {"focus": ["<category>"], "reason": "<one sentence>"}`,
    `Each category must be exactly one of: ${FOCUS_VOCABULARY.join(", ")}.`,
    "One category if the house is clearly one thing; two at most, most important first.",
  ].filter(Boolean).join("\n");
}

/**
 * The model's answer, or nothing.
 *
 * Nothing is a perfectly good outcome — the caller falls back to counting. What must never
 * happen is a category outside the vocabulary reaching the record: `product_focus` is matched
 * back to a pattern to filter the deck's catalogue, and a value nothing recognises produces a
 * deck with no pieces in it and a data request naming a category the pricing model has never
 * heard of.
 */
export function parseDecision(raw: string): { focus: string; reason: string } | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  // Models fence JSON about half the time, and sometimes say a sentence first.
  const body = /\{[\s\S]*\}/.exec(text.replace(/```json|```/g, ""))?.[0];
  if (!body) return null;

  let parsed: { focus?: unknown; reason?: unknown };
  try { parsed = JSON.parse(body); } catch { return null; }

  const list = Array.isArray(parsed.focus)
    ? parsed.focus
    : typeof parsed.focus === "string" ? [parsed.focus] : [];

  const allowed = new Set<string>(FOCUS_VOCABULARY);
  const chosen: string[] = [];
  for (const c of list) {
    if (typeof c !== "string") continue;
    // Case-insensitively, but the STORED spelling is ours: everything downstream compares it.
    const match = [...allowed].find((v) => v.toLowerCase() === c.trim().toLowerCase());
    if (match && !chosen.includes(match)) chosen.push(match);
  }
  if (!chosen.length) return null;

  const reason = typeof parsed.reason === "string" ? parsed.reason.trim().slice(0, 300) : "";
  return { focus: chosen.slice(0, 2).join(", "), reason };
}

/**
 * Decide the focus, with the counting version underneath.
 *
 * `ask` is injected — the caller owns the model client and its key — so everything above can
 * be tested without one, and so a caller with no key at all still gets an answer.
 */
export async function decideFocus(
  digest: CatalogueDigest,
  evidence: FocusEvidence,
  ask: ((prompt: string) => Promise<string>) | null,
): Promise<FocusDecision | null> {
  const counted = productFocus(evidence);

  if (ask && digest.products > 0) {
    try {
      const answer = parseDecision(await ask(buildPrompt(digest)));
      if (answer) {
        return {
          focus: answer.focus,
          reason: answer.reason || "read from the catalogue",
          source: "ai",
        };
      }
    } catch {
      // Deliberately silent here and reported by the caller: a model that is down must not
      // fail a branding run, it must just not be consulted.
    }
  }

  return counted ? { focus: counted, reason: "counted from the catalogue's own shelf labels", source: "counted" } : null;
}
