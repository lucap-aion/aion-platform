import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blockedBy, BLOCKS, PIPELINE_ORDER, type StageName } from "../../supabase/functions/_shared/stage-graph.ts";

// Which stages a failure takes down with it. Getting this too wide is what left Ferragamo
// with no client documents, no assistant check, no ops deck and no data request — because
// its intro deck could not be built for want of a catalogue.

describe("what a failure stops", () => {
  it("stops the stages that read what the failed one produces", () => {
    expect(blockedBy("sources").sort()).toEqual(["assistant", "documents"]);
    expect(blockedBy("storefront").sort()).toEqual(["demo_data", "demo_users", "intro_deck"]);
  });

  it("follows the chain", () => {
    // storefront -> demo_data -> demo_users. A demo login is useless without a book of
    // business, which is useless without a catalogue.
    expect(blockedBy("storefront")).toContain("demo_users");
  });

  it("stops nothing when nothing depended on it", () => {
    // The case that caused the damage. An intro deck is a file; no other stage reads it.
    expect(blockedBy("intro_deck")).toEqual([]);
    expect(blockedBy("ops_deck")).toEqual([]);
    expect(blockedBy("data_request")).toEqual([]);
    // Branding is cosmetic — a brand with no logo can still be crawled, documented and priced.
    expect(blockedBy("branding")).toEqual([]);
  });

  it("never leaves the data request hostage to anything", () => {
    // It is step 2 of the commercial cycle and is built from a template plus three fields
    // on the brand record. Nothing it needs can fail in this pipeline.
    for (const stage of PIPELINE_ORDER) {
      expect(blockedBy(stage), `${stage} must not block the data request`).not.toContain("data_request");
    }
  });

  it("cannot cycle", () => {
    for (const stage of PIPELINE_ORDER) {
      expect(blockedBy(stage), `${stage} depends on itself`).not.toContain(stage);
    }
  });

  it("only ever names real stages", () => {
    for (const [stage, blocked] of Object.entries(BLOCKS)) {
      expect(PIPELINE_ORDER).toContain(stage as StageName);
      for (const b of blocked ?? []) expect(PIPELINE_ORDER).toContain(b);
    }
  });

  it("lists the stages the function runs, in the order it runs them", () => {
    // The map is only meaningful against the real queue order, and the function is deployed
    // separately so it cannot import this. Read its source rather than trust a copy.
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/onboard-brand/index.ts"), "utf8");
    const block = /const ALL_STAGES = \[([\s\S]*?)\] as const;/.exec(src);
    const keys = [...block![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect([...PIPELINE_ORDER]).toEqual(keys);
  });
});
