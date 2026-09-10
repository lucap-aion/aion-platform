import { describe, it, expect } from "vitest";
import { firstSentences } from "../../supabase/functions/_shared/brand-enrich";

// Italian company names are mostly abbreviations, and a naive sentence split
// turned "Buccellati Holding Italia S.p.A. is an Italian jewellery and watch
// company" into "Buccellati Holding Italia S. p." — a fragment on a brand record.
describe("the opening sentences of a description", () => {
  it("does not break on S.p.A.", () => {
    const out = firstSentences(
      "Buccellati Holding Italia S.p.A. is an Italian jewellery and watch company. It was formed in 2011. A third one.", 2);
    expect(out).toBe("Buccellati Holding Italia S.p.A. is an Italian jewellery and watch company. It was formed in 2011.");
  });

  it("keeps a name that opens with an abbreviation intact", () => {
    const out = firstSentences("Salvatore Ferragamo S.p.A., doing business as Ferragamo, is an Italian luxury fashion house. Next.", 1);
    expect(out).toContain("S.p.A., doing business as Ferragamo");
    expect(out).not.toContain("Next");
  });

  it("handles Inc. and Ltd. the same way", () => {
    expect(firstSentences("Acme Inc. is a company. And more.", 1)).toBe("Acme Inc. is a company.");
    expect(firstSentences("Foo Ltd. makes things. Second.", 1)).toBe("Foo Ltd. makes things.");
  });

  it("returns everything when there is only one sentence", () => {
    expect(firstSentences("Pomellato is an Italian jewelry company.", 2))
      .toBe("Pomellato is an Italian jewelry company.");
  });

  it("takes the requested number and no more", () => {
    expect(firstSentences("One. Two. Three. Four.", 2)).toBe("One. Two.");
  });
});
