import { describe, it, expect } from "vitest";
import { formatCountry, formatWebsiteLabel, websiteHref } from "@/lib/format";

describe("formatCountry", () => {
  it("resolves the ISO codes actually in the data", () => {
    // brands.hq_country holds "IT"; profiles.country holds IT, DE, US, AE, CH, HK.
    expect(formatCountry("IT")).toBe("Italy");
    expect(formatCountry("US")).toBe("United States");
    expect(formatCountry("DE")).toBe("Germany");
    expect(formatCountry("CH")).toBe("Switzerland");
  });

  it("leaves a name that was already spelled out alone", () => {
    expect(formatCountry("Italy")).toBe("Italy");
    expect(formatCountry("United States")).toBe("United States");
  });

  it("makes the two spellings of one country agree", () => {
    expect(formatCountry("IT")).toBe(formatCountry("Italy"));
  });

  it("is case-insensitive about codes", () => {
    expect(formatCountry("it")).toBe("Italy");
  });

  it("shows an em dash for nothing, and passes through what it cannot resolve", () => {
    expect(formatCountry(null)).toBe("—");
    expect(formatCountry("")).toBe("—");
    expect(formatCountry("  ")).toBe("—");
    expect(formatCountry("XX")).toBe("XX");
    // ZZ is a real reserved code that resolves to "Unknown Region" — the code reads better.
    expect(formatCountry("ZZ")).toBe("ZZ");
  });
});

describe("website formatting", () => {
  it("strips the chrome nobody reads", () => {
    expect(formatWebsiteLabel("https://www.pasqualebruni.com")).toBe("pasqualebruni.com");
    expect(formatWebsiteLabel("https://robertocoin.com")).toBe("robertocoin.com");
    expect(formatWebsiteLabel("http://www.example.com/")).toBe("example.com");
  });

  it("keeps the path, which is not chrome", () => {
    expect(formatWebsiteLabel("https://www.example.com/en/shop")).toBe("example.com/en/shop");
  });

  it("builds a usable href, adding a scheme when the stored value has none", () => {
    expect(websiteHref("https://example.com")).toBe("https://example.com");
    expect(websiteHref("example.com")).toBe("https://example.com");
    expect(websiteHref(null)).toBeNull();
    expect(websiteHref("   ")).toBeNull();
  });
});
