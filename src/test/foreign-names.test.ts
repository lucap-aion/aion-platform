import { describe, it, expect } from "vitest";
import { foreignNamesFound } from "../../supabase/functions/_shared/foreign-names.ts";

// Every document AION sends a prospect is built from a template, and a template is the last
// document somebody made with it. That is how one house's filled-in workbook went out to
// every other one. These are the cases that decide whether the guard is worth having.

const HOUSES = [
  { name: "Roberto Coin", legal_name: "Roberto Coin S.p.A." },
  { name: "Ferragamo", legal_name: "Salvatore Ferragamo S.p.A." },
  { name: "Buccellati", legal_name: "Buccellati Holding Italia S.p.A." },
  { name: "Pomellato", legal_name: null },
];

describe("catching another house in a prospect's document", () => {
  it("finds a trading name left in the body text", () => {
    expect(foreignNamesFound("The programme as delivered for Pomellato in 2024", HOUSES))
      .toEqual(["Pomellato"]);
  });

  it("finds a legal entity, which is what a contract slot leaves behind", () => {
    expect(foreignNamesFound("contracted with Roberto Coin S.p.A. of Vicenza", HOUSES))
      .toContain("Roberto Coin S.p.A.");
  });

  it("finds a name at the very start, with nothing before it", () => {
    expect(foreignNamesFound("Buccellati — commercial terms", HOUSES)).toEqual(["Buccellati"]);
  });

  it("survives the whitespace an unzipped slide actually has", () => {
    // Tags are stripped to spaces, so a name can arrive split across what were two runs.
    expect(foreignNamesFound("prepared for   Roberto    Coin  today", HOUSES))
      .toContain("Roberto Coin");
  });
});

describe("not crying wolf, which is the whole difficulty", () => {
  it("ignores a person whose surname happens to be a client's name", () => {
    // AION's own team slide. Before this rule the guard reported a leak on every deck ever
    // built, and a warning that is wrong every time is worse than no warning.
    expect(foreignNamesFound("Advisor - Luxury Riccardo Ferragamo CTO Luca Pontone", HOUSES))
      .toEqual([]);
  });

  it("still catches the house when the preceding word is part of its own name", () => {
    // "Salvatore" belongs to Salvatore Ferragamo S.p.A.; "Riccardo" does not.
    expect(foreignNamesFound("invoiced to Salvatore Ferragamo for the pilot", HOUSES))
      .toContain("Ferragamo");
  });

  it("does not fire on the brand the document is actually for", () => {
    // The caller excludes it by id; this asserts the function reports only what it was given.
    const others = HOUSES.filter((h) => h.name !== "Buccellati");
    expect(foreignNamesFound("AION x Buccellati — intro", others)).toEqual([]);
  });

  it("skips a name too short to be distinctive", () => {
    expect(foreignNamesFound("a coin in the fountain", [{ name: "Coin" }])).toEqual([]);
  });

  it("does not match inside a longer word", () => {
    expect(foreignNamesFound("paid through Coinbase and Pomellatos", [
      { name: "Coinbase-ish" }, { name: "Pomellato" },
    ])).toEqual([]);
  });

  it("tolerates a house with no legal name and a null name", () => {
    expect(() => foreignNamesFound("anything at all", [{ name: null, legal_name: null }])).not.toThrow();
    expect(foreignNamesFound("anything at all", [{ name: null, legal_name: null }])).toEqual([]);
  });

  it("reports each house once, however many times it appears", () => {
    expect(foreignNamesFound("Pomellato and Pomellato and Pomellato", HOUSES)).toEqual(["Pomellato"]);
  });
});
