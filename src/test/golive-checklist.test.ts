import { describe, it, expect } from "vitest";
import {
  GO_LIVE_CHECKLIST,
  ALL_ITEMS,
  checklistProgress,
  type ChecklistState,
} from "@/lib/goLiveChecklist";

const stateOf = (keys: string[]): ChecklistState =>
  Object.fromEntries(keys.map((k) => [k, { done: true, note: null, updated_at: "2026-09-10T00:00:00Z", updated_by: null }]));

describe("go-live checklist", () => {
  it("keys are unique — they are the primary key in the database", () => {
    const keys = ALL_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("group keys and letters are unique too", () => {
    expect(new Set(GO_LIVE_CHECKLIST.map((g) => g.key)).size).toBe(GO_LIVE_CHECKLIST.length);
    expect(new Set(GO_LIVE_CHECKLIST.map((g) => g.letter)).size).toBe(GO_LIVE_CHECKLIST.length);
  });

  it("counts nothing done for a brand with no rows", () => {
    const p = checklistProgress({});
    expect(p.done).toBe(0);
    expect(p.total).toBe(ALL_ITEMS.length);
    expect(p.blockingLeft).toBeGreaterThan(0);
  });

  it("reports no blocking items left only when every blocking one is done", () => {
    const blocking = ALL_ITEMS.filter((i) => i.blocking).map((i) => i.key);
    expect(checklistProgress(stateOf(blocking)).blockingLeft).toBe(0);
    expect(checklistProgress(stateOf(blocking.slice(1))).blockingLeft).toBe(1);
  });

  it("ignores stored rows whose item no longer exists in the definition", () => {
    // An item removed from the code list must not inflate the count for brands
    // that had already ticked it.
    const p = checklistProgress(stateOf(["an_item_that_was_deleted"]));
    expect(p.done).toBe(0);
  });

  it("names no client — the list ships to brands that are not yet customers", () => {
    const text = JSON.stringify(GO_LIVE_CHECKLIST).toLowerCase();
    for (const name of ["roberto coin", "pomellato", "luisa beccaria", "pasquale bruni", "ferragamo", "rocit"]) {
      expect(text).not.toContain(name);
    }
  });
});
