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
