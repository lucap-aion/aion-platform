import { describe, it, expect } from "vitest";
import {
  legalNameFromDescription, registeredOfficeFrom, splitAddress, nameIsConfirmedBy,
} from "../../supabase/functions/_shared/brand-legal.ts";

// The two fields the data-request workbook needs and nothing could fill: the legal entity
// and the registered office. Getting either subtly wrong sends a contract to the wrong
// company at the wrong address, so every case here is one where being wrong is quiet.

describe("the legal entity", () => {
  it("reads the entity out of the sentence that opens with it", () => {
    expect(legalNameFromDescription(
      "Salvatore Ferragamo S.p.A., doing business as Ferragamo, is an Italian luxury fashion house focused on apparel, footwear, and accessories headquartered in Florence, Italy.",
    )).toBe("Salvatore Ferragamo S.p.A.");
  });

  it("handles the forms these houses actually use", () => {
    expect(legalNameFromDescription("Compagnie Financière Richemont SA is a Swiss luxury goods holding company"))
      .toBe("Compagnie Financière Richemont SA");
    expect(legalNameFromDescription("Burberry Group plc is a British luxury fashion house"))
      .toBe("Burberry Group plc");
    expect(legalNameFromDescription("Hugo Boss AG is a German luxury fashion house"))
      .toBe("Hugo Boss AG");
    // The comma is part of the name, not the end of it.
    expect(legalNameFromDescription("Tapestry, Inc. is an American multinational fashion holding company"))
      .toBe("Tapestry, Inc.");
    expect(legalNameFromDescription("Capri Holdings, Ltd. is a British-domiciled fashion group"))
      .toBe("Capri Holdings, Ltd.");
  });

  it("refuses to invent a legal form that is not stated", () => {
    // "Pomellato" is a trading name. Returning it as the legal entity would put a name on a
    // contract that no registry holds.
    expect(legalNameFromDescription("Pomellato is an Italian jewellery house founded in Milan in 1967.")).toBeNull();
    expect(legalNameFromDescription("Pasquale Bruni is a jeweller based in Valenza.")).toBeNull();
  });

  it("will not take a name from mid-paragraph", () => {
    // The same words sit in every privacy policy after some heading, where "Website Privacy
    // Policy Salvatore Ferragamo S.p.A." is equally well-formed and equally wrong. Only a
    // sentence that OPENS with the entity is trusted.
    expect(legalNameFromDescription(
      "Website Privacy Policy Salvatore Ferragamo S.p.A. with registered offices at Via de' Tornabuoni 2",
    )).toBeNull();
  });

  it("says nothing for nothing", () => {
    expect(legalNameFromDescription("")).toBeNull();
    expect(legalNameFromDescription(null)).toBeNull();
    expect(legalNameFromDescription(undefined)).toBeNull();
  });

  it("confirms a name against the house's own words", () => {
    const site = "…Website Privacy Policy Salvatore  Ferragamo S.p.A. with registered offices at…";
    expect(nameIsConfirmedBy("Salvatore Ferragamo S.p.A.", site)).toBe(true);
    expect(nameIsConfirmedBy("Gucci S.p.A.", site)).toBe(false);
    expect(nameIsConfirmedBy(null, site)).toBe(false);
  });
});

describe("the registered office", () => {
  it("reads the line ferragamo.com actually publishes", () => {
    const office = registeredOfficeFrom(
      'Website Privacy Policy Salvatore Ferragamo S.p.A. with registered offices at Via de’ Tornabuoni 2, 50123, Firenze (hereinafter, "Salvatore Ferragamo") and each company of the group',
    );
    expect(office).toMatchObject({
      street: "Via de’ Tornabuoni 2",
      postcode: "50123",
      city: "Firenze",
    });
    // The bracket is where the address stops. Everything after it is prose.
    expect(office!.raw).not.toMatch(/hereinafter/);
  });

  it("reads the same statement in the other languages these houses publish in", () => {
    expect(registeredOfficeFrom("Pomellato S.p.A. con sede legale in Via Cusani 5, 20121 Milano"))
      .toMatchObject({ street: "Via Cusani 5", postcode: "20121", city: "Milano" });
    expect(registeredOfficeFrom("Société anonyme au capital de 1 000 euros, siège social : 2 Rue du Pont Neuf, 75001 Paris"))
      .toMatchObject({ postcode: "75001", city: "Paris" });
    expect(registeredOfficeFrom("registered office: 1 Horse Guards Avenue, SW1A 2HU London"))
      .toMatchObject({ street: "1 Horse Guards Avenue", postcode: "SW1A 2HU", city: "London" });
  });

  it("ignores a phrase with no address in it", () => {
    // "at our registered offices" is a sentence about where a thing happens, not an address.
    expect(registeredOfficeFrom("You may inspect the register at our registered offices in Milan")).toBeNull();
    expect(registeredOfficeFrom("We take privacy seriously.")).toBeNull();
    expect(registeredOfficeFrom(null)).toBeNull();
  });
});

describe("splitting an address", () => {
  it("finds the postcode wherever the commas fall", () => {
    expect(splitAddress("Via de' Tornabuoni 2, 50123, Firenze"))
      .toEqual({ street: "Via de' Tornabuoni 2", postcode: "50123", city: "Firenze" });
    expect(splitAddress("Via Cusani 5, 20121 Milano"))
      .toEqual({ street: "Via Cusani 5", postcode: "20121", city: "Milano" });
    expect(splitAddress("Piazza San Babila 1, Scala B, 20122 Milano"))
      .toEqual({ street: "Piazza San Babila 1, Scala B", postcode: "20122", city: "Milano" });
  });

  it("keeps the country out of the street", () => {
    // hq_country is filled from the encyclopaedia; repeating it inside hq_address puts it
    // twice on the workbook.
    expect(splitAddress("Via Cusani 5, 20121 Milano, Italy"))
      .toEqual({ street: "Via Cusani 5", postcode: "20121", city: "Milano" });
  });

  it("drops the province code from the city", () => {
    expect(splitAddress("Via Roma 1, 15048 Valenza (AL)"))
      .toEqual({ street: "Via Roma 1", postcode: "15048", city: "Valenza" });
  });

  it("leaves the city empty rather than calling a street a city", () => {
    // One part with a house number in it is an address line, not a town. An address that
    // half-parsed is worse on a contract than one that plainly did not.
    expect(splitAddress("Via Cusani 5")).toEqual({ street: "Via Cusani 5", postcode: null, city: null });
    expect(splitAddress("Via Cusani 5, Milano"))
      .toEqual({ street: "Via Cusani 5", postcode: null, city: "Milano" });
  });
});

// ── What a house writes between the label and the address ────────────────────────────────
describe("a registered office stated in a sentence, not a field", () => {
  it("drops the copula a French company writes in front of its address", () => {
    // messika.com: "Le siège social est situé au 44, avenue des Champs-Élysées, 75008 Paris,
    // immatriculée au RCS de Paris". The pattern's optional "au" matched nothing, so the
    // capture began at "est situé" and that phrase went onto the brand record as the
    // registered address — and from there onto the data request sent to the client.
    const office = registeredOfficeFrom(
      "Le siège social est situé au 44, avenue des Champs-Elysées, 75008 Paris, immatriculée au RCS",
    );
    expect(office?.street).toBe("44, avenue des Champs-Elysées");
    expect(office?.postcode).toBe("75008");
    expect(office?.city).toBe("Paris");
  });

  it("drops the same phrase in the other languages these houses publish in", () => {
    expect(registeredOfficeFrom("La sede legale si trova in Via Cusani 5, 20121 Milano")?.street)
      .toBe("Via Cusani 5");
    expect(registeredOfficeFrom("The registered office is located at 1 Bond Street, SW1A 2HU London")?.street)
      .toBe("1 Bond Street");
    expect(registeredOfficeFrom("El domicilio social se encuentra en Calle Serrano 12, 28001 Madrid")?.street)
      .toBe("Calle Serrano 12");
  });

  it("leaves an address that needs no stripping exactly as it was", () => {
    expect(registeredOfficeFrom("siège social : 2 Rue du Pont Neuf, 75001 Paris")?.street)
      .toBe("2 Rue du Pont Neuf");
    expect(registeredOfficeFrom("con sede legale in Via Cusani 5, 20121 Milano")?.street)
      .toBe("Via Cusani 5");
  });
});

describe("the country, when it can be known rather than guessed", () => {
  it("reads it off the language and the postcode together", () => {
    // Both halves are needed. France, Italy, Spain and Germany use five digits; every other
    // country sharing one of those languages — Belgium, Switzerland, Austria, Luxembourg —
    // uses four. It matters because the country makes the Chubb policy prefix, and without
    // it Messika came out as MESXX: a placeholder in a bordereau key that nothing flags.
    expect(registeredOfficeFrom("siège social : 44 avenue des Champs-Elysées, 75008 Paris")?.country).toBe("France");
    expect(registeredOfficeFrom("con sede legale in Via Cusani 5, 20121 Milano")?.country).toBe("Italy");
    expect(registeredOfficeFrom("domicilio social: Calle Serrano 12, 28001 Madrid")?.country).toBe("Spain");
    expect(registeredOfficeFrom("Sitz: Kurfürstendamm 1, 10719 Berlin")?.country).toBe("Germany");
  });

  it("says nothing when the postcode does not settle it", () => {
    // Brussels is French-speaking and four digits. Guessing France there would put a wrong
    // country code into a policy number.
    expect(registeredOfficeFrom("siège social : 10 Avenue Louise, 1000 Bruxelles")?.country).toBe(null);
    expect(registeredOfficeFrom("siège social : 5 Rue du Rhône, 1204 Genève")?.country).toBe(null);
    // English is spoken in too many places for five digits to mean anything.
    expect(registeredOfficeFrom("registered office: 1 Horse Guards Avenue, SW1A 2HU London")?.country).toBe(null);
  });

  it("says nothing when there is no postcode at all", () => {
    expect(registeredOfficeFrom("siège social : 44 avenue des Champs-Elysées Paris")?.country).toBe(null);
  });
});

describe("a country the house names in the address itself", () => {
  it("reads it wherever it sits in the line, and keeps it out of the street", () => {
    // messika.com's English legal page: "…registered office 44, avenue des Champs-Elysées,
    // 75008 Paris, France, registered with the Paris Trade and Companies Register under
    // number 301 29…". The country was dropped only when it was the LAST part, so here it
    // was neither removed from the address nor read into hq_country — and the policy prefix
    // came out MESXX, a placeholder in a Chubb bordereau key.
    const office = registeredOfficeFrom(
      "registered office 44, avenue des Champs-Elysées, 75008 Paris, France, " +
      "registered with the Paris Trade and Companies Register under number 301 29",
    );
    expect(office?.country).toBe("France");
    expect(office?.street).toBe("44, avenue des Champs-Elysées");
    expect(office?.city).toBe("Paris");
    expect(office?.raw).not.toContain("Trade and Companies Register");
  });

  it("normalises whatever spelling the house used, because the prefix is built from it", () => {
    expect(registeredOfficeFrom("sede legale in Via Cusani 5, 20121 Milano, Italia")?.country).toBe("Italy");
    expect(registeredOfficeFrom("Sitz: Kurfürstendamm 1, 10719 Berlin, Deutschland")?.country).toBe("Germany");
    expect(registeredOfficeFrom("domicilio social: Calle Serrano 12, 28001 Madrid, España")?.country).toBe("Spain");
    expect(registeredOfficeFrom("siège social : 5 Rue du Rhône, 1204 Genève, Suisse")?.country).toBe("Switzerland");
  });

  it("drops the registration clause these pages append after the address", () => {
    const it = registeredOfficeFrom("sede legale in Via Cusani 5, 20121 Milano, iscritta al Registro Imprese di Milano n. 12345");
    expect(it?.raw).toBe("Via Cusani 5, 20121 Milano");
    const fr = registeredOfficeFrom("siège social : 2 Rue du Pont Neuf, 75001 Paris, immatriculée au RCS de Paris");
    expect(fr?.raw).toBe("2 Rue du Pont Neuf, 75001 Paris");
  });

  it("prefers what the house says over what the postcode implies", () => {
    // A French-language page naming Belgium: the postcode rule would have said nothing, and
    // guessing France off the language would have been wrong.
    expect(registeredOfficeFrom("siège social : 10 Avenue Louise, 1000 Bruxelles, Belgique")?.country)
      .toBe("Belgium");
  });
});
