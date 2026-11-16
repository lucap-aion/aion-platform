import { describe, expect, it } from "vitest";
import {
  resultLine, reviewItems, runOutcome, type ReviewStageRow,
} from "../../supabase/functions/_shared/onboarding-review";

// Shaft (DEV brand 33, 2026-11-16) — the notes its stages actually wrote, trimmed.
const BRANDING_NOTES = [
  "the description came from the page's SEO metadata, which is written for search results rather than about the house — worth rewriting",
  "the site names no brand colour, so the primary was taken as #181817 — the colour its stylesheet uses most that can still carry white text. Check it.",
  "no indexed pages yet — the registered office is read from the site's own legal text, so run this again once the crawl has landed",
  "no legal entity could be established, on the site or in a search — the trading name is not one, so the data request needs it filled by hand",
  "the site offers no monogram, so the wordmark's own initial is the monogram for the collapsed sidebar",
  "7 images are now held in AION storage rather than hotlinked from the brand's site",
  "the sign-in photograph is cropped around its subject (50% 35%)",
  "product focus left blank — no catalogue to read it from yet",
  "policy prefix SHAXX — confirm it with Chubb before the first bordereau",
];

const rows: ReviewStageRow[] = [
  { stage: "data_request", status: "done", detail: { file_name: "AION x Shaft — data request.xlsx", review: [
    "No legal entity set — the workbook went out blank there.",
    "No registered address set — fill it on the brand record or in the field above.",
    "Categories: Ready-to-wear. The record's category table is empty — add the pilot's categories on the record to own them.",
  ] } },
  { stage: "branding", status: "done", detail: { filled: ["description", "logo_big"], notes: BRANDING_NOTES } },
  { stage: "storefront", status: "done", detail: { platform: "shopify", products: 222 } },
  { stage: "documents", status: "done", detail: { written: 5, failed: [] } },
  { stage: "demo_users", status: "skipped", detail: { policy: true, reason: "a live client" } },
  { stage: "intro_deck", status: "failed", error: "no catalogue" },
];

describe("reviewItems", () => {
  const items = reviewItems(rows, { legal_name: null, registered_address: "" });
  const texts = items.map((i) => i.text);

  it("puts a failure first", () => {
    expect(items[0]).toMatchObject({ stage: "intro_deck", label: "Intro deck" });
    expect(items[0].text).toMatch(/no catalogue/);
  });

  it("states the legal entity and the office once, from the record, not from three stages' notes", () => {
    expect(texts.filter((t) => /legal entity/i.test(t))).toHaveLength(1);
    expect(texts.filter((t) => /registered (office|address)/i.test(t))).toHaveLength(1);
  });

  it("keeps the branding notes that ask for something and drops the ones that report", () => {
    expect(texts.some((t) => /worth rewriting/.test(t))).toBe(true);
    expect(texts.some((t) => /Check it\./.test(t))).toBe(true);
    expect(texts.some((t) => /monogram/.test(t))).toBe(true);
    expect(texts.some((t) => /SHAXX/.test(t))).toBe(true);
    expect(texts.some((t) => /held in AION storage/.test(t))).toBe(false);
    expect(texts.some((t) => /cropped around its subject/.test(t))).toBe(false);
    expect(texts.some((t) => /product focus left blank/.test(t))).toBe(false);
  });

  it("keeps a deck's review lines that ask, drops the ones that report", () => {
    const deck = reviewItems([{ stage: "intro_deck", status: "done", detail: { review: [
      "Shaft's logo is on 12 slides. Check it reads well at that size.",
      "Product slots were filled from ready-to-wear.",
      "Cropped to the frame: slide 4 (34%, around its subject).",
      "5 photographs were taken off the house's own site. Open each one on the slide.",
    ] } }]).map((i) => i.text);
    expect(deck).toEqual([
      "Shaft's logo is on 12 slides. Check it reads well at that size.",
      "5 photographs were taken off the house's own site. Open each one on the slide.",
    ]);
  });

  it("carries a deck or workbook's own review lines, and points at drafted documents", () => {
    expect(texts.some((t) => /category table is empty/.test(t))).toBe(true);
    expect(texts.some((t) => /5 drafted/.test(t))).toBe(true);
  });

  it("takes the office the branding stage wrote, which lands in hq_address", () => {
    const hq = reviewItems(rows, { legal_name: null, registered_address: null, hq_address: "Piazza Savonarola 11" }).map((i) => i.text);
    expect(hq.some((t) => /registered (office|address)/i.test(t))).toBe(false);
  });

  it("says nothing about the record when it is filled", () => {
    const filled = reviewItems(rows, { legal_name: "Shaft S.r.l.", registered_address: "Via Roma 1" }).map((i) => i.text);
    expect(filled.some((t) => /legal entity|registered (office|address)/i.test(t))).toBe(false);
  });

  it("does not list a policy skip — the demo of a live client is not something to fix", () => {
    expect(items.some((i) => i.stage === "demo_users")).toBe(false);
  });
});

describe("runOutcome", () => {
  it("separates done, failed, not-for-this-brand and still running", () => {
    const o = runOutcome([...rows, { stage: "assistant", status: "pending", queued_at: "2026-11-16T15:00:00Z" }]);
    expect(o.done).toEqual(["branding", "storefront", "documents", "data_request"]);
    expect(o.failed).toEqual(["intro_deck"]);
    expect(o.notApplicable).toEqual(["demo_users"]);
    expect(o.unfinished).toEqual(["assistant"]);
  });
});

describe("resultLine", () => {
  it("says what a finished stage produced", () => {
    expect(resultLine(rows[2])).toBe("222 products (shopify)");
    expect(resultLine(rows[0])).toBe("AION x Shaft — data request.xlsx");
    expect(resultLine(rows[5])).toBe("failed — no catalogue");
  });
});
