import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// A real client's name sat in the "Legal entity" placeholder on every OTHER house's record
// form: opening Damiani showed "Pasquale Bruni S.p.A." greyed into the field. Four screens
// carried one, and the insurer-quote form suggested "2.83" — which is not a format hint, it
// is a real house's real quoted rate.
//
// None of it was deliberate; each was written while looking at one brand's data. Which is
// exactly why it needs a test rather than care.

// Every spelling a house turns up in: the name, the slug and the DOMAIN. The domain is the
// one that slipped through the first pass of this — the new-brand form suggested
// "pasqualebruni.com" as the website to type in — because a list of NAMES does not contain
// it. Matched case-insensitively and without separators, so "Roberto Coin", "roberto-coin"
// and "robertocoin.com" are all the same house.
const HOUSES = [
  "Pasquale Bruni", "Roberto Coin", "Pomellato", "Ferragamo", "Salvatore Ferragamo",
  "Buccellati", "Luisa Beccaria", "Messika", "Damiani",
];

/** "Roberto-Coin.com" and "robertocoin" collapse to the same thing. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "test" || entry === "node_modules") continue;
      out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/** Strip comments, so an explanation of a past bug is not mistaken for the bug. */
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

// The generators of everything a prospect is SENT. Scanned alongside src because a client's
// name reached a review panel from here: every other house's operations deck carried "SLA
// figures and voucher duration are placeholders from the Ferragamo booklet".
//
// Deliberately not all of supabase/functions: the assistant and analyst prompts name brands
// as examples of data situations ("empty for brands whose range lives online, e.g. Luisa
// Beccaria"), which is schema documentation for a model, not text anybody is shown.
const ARTEFACT_GENERATORS = [
  "supabase/functions/build-collateral/index.ts",
  "supabase/functions/brand-deck/index.ts",
];

describe("no client's data is baked into the interface", () => {
  const files = [...sourceFiles("src"), ...ARTEFACT_GENERATORS]
    .map((f) => ({ f, body: code(readFileSync(f, "utf8")) }));

  it("finds the files at all, so a passing run means something", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("names no real house in any placeholder, label or default", () => {
    const found: string[] = [];
    for (const { f, body } of files) {
      const flat = squash(body);
      for (const house of HOUSES) {
        if (flat.includes(squash(house))) found.push(`${f} names ${house}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("suggests no real figure from a real quote", () => {
    // 2.83 was Ferragamo's watches rate, sitting in the rate field as an example.
    for (const { f, body } of files) {
      expect(body, `${f} suggests a real quoted rate`).not.toMatch(/placeholder="2\.83"/);
    }
  });
});
