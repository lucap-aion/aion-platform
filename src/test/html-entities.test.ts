import { describe, it, expect } from "vitest";
import { decodeEntities } from "../../supabase/functions/_shared/html-entities.ts";
import { extractContent, isJunkLine } from "../../supabase/functions/_shared/crawl.ts";

// Buccellati's catalogue arrived as "ANELLO&#x20;COCKTAIL" and its knowledge base as
// "Gianmaria Buccellati cre&ograve;". Both read as garbage on screen, and a name with no real
// spaces in it cannot wrap, so it ran straight out of its box in the demo film.
describe("decodeEntities", () => {
  it("decodes hex, decimal and named references", () => {
    expect(decodeEntities("ANELLO&#x20;COCKTAIL")).toBe("ANELLO COCKTAIL");
    expect(decodeEntities("CR&#xCA;PE&#x20;DE&#x20;CHINE")).toBe("CRÊPE DE CHINE");
    expect(decodeEntities("caff&#232;")).toBe("caffè");
    expect(decodeEntities("Buccellati cre&ograve; una collezione")).toBe("Buccellati creò una collezione");
  });

  it("knows the Latin-1 letters an Italian or French page uses", () => {
    expect(decodeEntities("pi&ugrave; c&igrave; &ecirc;tre ch&acirc;teau &oelig;uvre na&iuml;f h&ocirc;tel"))
      .toBe("più cì être château œuvre naïf hôtel");
  });

  it("keeps capitals capital", () => {
    expect(decodeEntities("&Ugrave; &Icirc; &Igrave; &Eacute;")).toBe("Ù Î Ì É");
  });

  it("decodes a value escaped twice", () => {
    expect(decodeEntities("BANGLE&amp;#x20;BRACCIALE")).toBe("BANGLE BRACCIALE");
  });

  it("turns a non-breaking space into a space, so the name can wrap", () => {
    expect(decodeEntities("Cuff&nbsp;4.0")).toBe("Cuff 4.0");
  });

  it("leaves unknown names and stray ampersands alone", () => {
    expect(decodeEntities("Dolce & Gabbana &notareal; R&D")).toBe("Dolce & Gabbana &notareal; R&D");
    expect(decodeEntities("&#0; &#xD800;")).toBe("&#0; &#xD800;");
  });
});

describe("page text", () => {
  it("does not leak the inside of an attribute that contains '>'", () => {
    const html = `<html><body><div data-mage-init='{"tpl":"<b>x</b>","remEventSelector":"button"}'>` +
      `<p>Bracciale in oro bianco e giallo con diamanti, lavorato a mano.</p></div></body></html>`;
    const { text } = extractContent(html);
    expect(text).toContain("Bracciale in oro bianco e giallo con diamanti");
    expect(text).not.toContain("remEventSelector");
  });

  it("treats theme placeholder copy as junk", () => {
    expect(isJunkLine("Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.")).toBe(true);
    expect(isJunkLine("Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia.")).toBe(true);
    expect(isJunkLine("Bracciale in oro bianco e giallo con diamanti.")).toBe(false);
  });
});
