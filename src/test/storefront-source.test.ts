import { describe, it, expect } from "vitest";
import {
  refusalKeepsSource, SYNCABLE_PLATFORMS,
} from "../../supabase/functions/_shared/storefront-source.ts";

// Ferragamo was read as `structured` — 1,783 priced pieces — and then, days later, answered a
// bot challenge. Detection concluded 'blocked' and wrote that over the working source with
// enabled false, which is the one state sync-storefront never reads again. These are the
// cases that decide whether being turned away can undo a catalogue we already have.

describe("a refusal against a source that is working", () => {
  it("leaves a structured source that has delivered a catalogue alone", () => {
    expect(refusalKeepsSource({
      blocked: true, heldProducts: 1783,
      prior: { platform: "structured", enabled: true },
    })).toBe(true);
  });

  it("protects every platform the sync reads", () => {
    for (const platform of SYNCABLE_PLATFORMS) {
      expect(refusalKeepsSource({
        blocked: true, heldProducts: 12, prior: { platform, enabled: true },
      })).toBe(true);
    }
  });
});

describe("what a refusal may still change", () => {
  it("does not protect a brand with no catalogue — there is nothing to lose", () => {
    expect(refusalKeepsSource({
      blocked: true, heldProducts: 0, prior: { platform: "structured", enabled: true },
    })).toBe(false);
  });

  it("does not resurrect a source somebody switched off", () => {
    expect(refusalKeepsSource({
      blocked: true, heldProducts: 1783, prior: { platform: "structured", enabled: false },
    })).toBe(false);
  });

  it("does not protect a source the sync never reads anyway", () => {
    for (const platform of ["none", "blocked", ""]) {
      expect(refusalKeepsSource({
        blocked: true, heldProducts: 500, prior: { platform, enabled: true },
      })).toBe(false);
    }
  });

  it("does not protect a brand that has no source row at all", () => {
    expect(refusalKeepsSource({ blocked: true, heldProducts: 500, prior: null })).toBe(false);
  });

  it("still records an empty read: finding nothing IS a finding about the house", () => {
    expect(refusalKeepsSource({
      blocked: false, heldProducts: 1783,
      prior: { platform: "structured", enabled: true },
    })).toBe(false);
  });
});
