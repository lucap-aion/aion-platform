import { describe, it, expect, vi } from "vitest";
import { officeQuery, legalEntityFor, officeFor, formSuitsCountry, searchIdentity } from "../../supabase/functions/_shared/brand-search.ts";

// A registered office and a legal entity go onto a contract and into a Chubb bordereau, and
// they are the two things a website is least reliable about. Damiani publishes "Sede Legale"
// as a bare label with the value in a separate element; Wikidata knows its legal FORM and
// its town and no street. A search engine has already read those pages, and its snippet
// carries the sentence whole.

// Shape of a real s.jina.ai result for "Damiani" sede legale damiani.com, abridged.
const DAMIANI = `
[1] Title: Note Legali
[1] URL Source: https://www.damiani.com/it_it/legal
[1] Description: Damiani S.P.A. - Sede Legale Piazza ani, N.1 - 15048 Valenza (Al) DAMIANI S.p.A., C.F. e P. IVA 01457570065, con sede in Valenza (AL) ...

[2] Title: PRIVACY COOKIES - Damiani
[2] URL Source: https://www.damianigroup.com/cookies/
[2] Description: ... Damiani S.p.a. con sede legale in Piazza Damiano Grassi Damiani, 1, 15048, Valenza (AL), Codice Fiscale/Partita IVA n. 01457570065. Con questa informativa ...

[3] Title: Rocca 1794
[3] URL Source: https://www.rocca1794.com/
[3] Description: Rocca 1794 S.p.A., a retailer of Damiani, with sede legale in Via Roma 1, 20121 Milano ...
`;

describe("what to search for", () => {
  it("asks in the language the company registers in", () => {
    expect(officeQuery("Damiani", "Italy", "https://www.damiani.com")).toBe('"Damiani" sede legale damiani.com');
    expect(officeQuery("Messika", "France", "https://www.messika.com")).toBe('"Messika" siège social messika.com');
    expect(officeQuery("Loewe", "Spain", null)).toBe('"Loewe" domicilio social');
  });

  it("falls back to English for a country it has no phrase for", () => {
    expect(officeQuery("Brand", "Japan", null)).toBe('"Brand" registered office');
    expect(officeQuery("Brand", null, null)).toBe('"Brand" registered office');
  });
});

describe("the legal entity in a search result", () => {
  it("takes this house's entity", () => {
    expect(legalEntityFor(DAMIANI, "Damiani")).toBe("Damiani S.p.a.");
  });

  it("ignores another company that happens to be in the results", () => {
    // A retailer that stocks them is a likely neighbour in any search, and its S.p.A. is
    // just as well-formed. Writing it onto a contract would be a serious error.
    expect(legalEntityFor(DAMIANI, "Damiani")).not.toContain("Rocca");
  });

  it("prefers the unshouted, fullest form", () => {
    // "DAMIANI S.p.A.", "Damiani Spa" and "Damiani S.p.a." are one entity; a contract
    // carries the last.
    const text = "DAMIANI S.p.A. ... Damiani Spa ... Damiani S.p.a. ...";
    expect(legalEntityFor(text, "Damiani")).toBe("Damiani S.p.a.");
  });

  it("says nothing when no corporate form is stated", () => {
    expect(legalEntityFor("Damiani is an Italian jewellery house", "Damiani")).toBe(null);
    expect(legalEntityFor(DAMIANI, "")).toBe(null);
    // Too short a name to anchor on safely.
    expect(legalEntityFor(DAMIANI, "Di")).toBe(null);
  });
});

describe("the office in a search result", () => {
  it("takes the clean snippet over the mangled one", () => {
    // The engine truncated snippet 1 mid-street to "Piazza ani, N.1", and first-past-the-post
    // would have put that on a contract.
    const office = officeFor(DAMIANI, "Damiani");
    expect(office?.street).toBe("Piazza Damiano Grassi Damiani, 1");
    expect(office?.postcode).toBe("15048");
    expect(office?.city).toBe("Valenza");
    expect(office?.country).toBe("Italy");
  });

  it("refuses a DIFFERENT house's office, however close by it is stated", () => {
    // "Rocca 1794 S.p.A., a retailer of Damiani, with sede legale in Via Roma 1, 20121
    // Milano" — a retailer that stocks them, a likely neighbour in any search, and an
    // address that scored better on its own merits than the truncated real one. It would
    // have gone onto Damiani's contract and into a Chubb bordereau.
    expect(officeFor(DAMIANI, "Damiani")?.street).not.toContain("Via Roma");
    // And asking about the retailer gets the retailer.
    expect(officeFor(DAMIANI, "Rocca")?.street).toBe("Via Roma 1");
  });

  it("drops the fiscal-code clause the sentence continues into", () => {
    expect(officeFor(DAMIANI, "Damiani")?.raw).not.toMatch(/Codice Fiscale|Partita IVA/i);
  });
});

describe("asking the web", () => {
  const ok = (body: string) => Promise.resolve(new Response(body, { status: 200 }));

  it("reads both fields out of one search", async () => {
    const fetchImpl = vi.fn(() => ok(DAMIANI)) as unknown as typeof fetch;
    const out = await searchIdentity("Damiani", "Italy", "https://www.damiani.com", "k", fetchImpl);
    expect(out.legalName).toBe("Damiani S.p.a.");
    expect(out.office?.street).toBe("Piazza Damiano Grassi Damiani, 1");
    expect(out.query).toBe('"Damiani" sede legale damiani.com');
  });

  it("asks for snippets only — the answer is in them, and pages cost a read each", async () => {
    const fetchImpl = vi.fn(() => ok(DAMIANI)) as unknown as typeof fetch;
    await searchIdentity("Damiani", "Italy", null, "k", fetchImpl);
    const init = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1];
    expect((init.headers as Record<string, string>)["X-Respond-With"]).toBe("no-content");
  });

  it("comes back empty rather than throwing when the search fails", async () => {
    for (const impl of [
      () => Promise.resolve(new Response("", { status: 429 })),
      () => Promise.reject(new Error("network")),
      () => ok("   "),
    ]) {
      const out = await searchIdentity("Damiani", "Italy", null, "k", impl as unknown as typeof fetch);
      expect(out).toMatchObject({ legalName: null, office: null });
    }
  });
});

describe("the right entity for the country", () => {
  it("refuses a local branch whose corporate form belongs elsewhere", async () => {
    // A search for a French house returns its Italian branch as readily as its parent.
    // "Messika Group S.r.l." is a real company and the wrong one for a French contract.
    const text = "Messika Group S.r.l. con sede legale in Via Montenapoleone 1, 20121 Milano";
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(text, { status: 200 }))) as unknown as typeof fetch;
    const out = await searchIdentity("Messika", "France", "https://www.messika.com", "k", fetchImpl);
    expect(out.legalName).toBe(null);
  });

  it("accepts the same form where it does belong", () => {
    expect(formSuitsCountry("Damiani S.p.A.", "Italy")).toBe(true);
    expect(formSuitsCountry("Messika Group SAS", "France")).toBe(true);
    expect(formSuitsCountry("Montblanc GmbH", "Germany")).toBe(true);
    expect(formSuitsCountry("Loewe S.A.", "Spain")).toBe(true);
  });

  it("lets a shared form through in every country that uses it", () => {
    // S.A. is French, Spanish, Swiss, Belgian and Portuguese; SE is European.
    for (const c of ["France", "Spain", "Switzerland", "Belgium", "Portugal"]) {
      expect(formSuitsCountry("House S.A.", c), c).toBe(true);
    }
    for (const c of ["Italy", "France", "Germany"]) {
      expect(formSuitsCountry("House SE", c), c).toBe(true);
    }
  });

  it("judges nothing when the country is unknown", () => {
    expect(formSuitsCountry("House S.r.l.", null)).toBe(true);
    expect(formSuitsCountry("House S.r.l.", "Japan")).toBe(true);
  });

  it("rejects the wrong form outright", () => {
    expect(formSuitsCountry("Messika Group S.r.l.", "France")).toBe(false);
    expect(formSuitsCountry("House GmbH", "Italy")).toBe(false);
    expect(formSuitsCountry("House Ltd", "France")).toBe(false);
  });
});
