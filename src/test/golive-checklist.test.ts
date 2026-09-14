import { describe, it, expect } from "vitest";
import {
  GO_LIVE_CHECKLIST,
  ALL_ITEMS,
  checklistProgress,
  isItemDone,
  filterChecklist,
  blockingItems,
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

// ── The half of the list the platform can answer itself ──────────────────────────────────
describe("what the checklist can see for itself", () => {
  it("counts a detected item as done without anybody ticking it", () => {
    // Eighteen of the thirty-three items are facts on the record — a premium, a prefix, two
    // jsonb columns. Asking a person to confirm those produced a checklist that disagreed
    // with the platform the moment anything changed.
    const { done, detected } = checklistProgress({}, { premium: true, faq: true, policy_prefix: true });
    expect(done).toBe(3);
    expect(detected).toBe(3);
  });

  it("lets a tick and a signal agree without double-counting", () => {
    const state = { premium: { done: true, note: null, updated_at: "", updated_by: null } };
    expect(checklistProgress(state, { premium: true }).done).toBe(1);
  });

  it("clears a blocking item when the platform can see it is done", () => {
    const before = checklistProgress({}, {}).blockingLeft;
    const after = checklistProgress({}, { premium: true }).blockingLeft;
    expect(after).toBe(before - 1);
  });

  it("still lets a person tick what no query can see", () => {
    // Training, the claims runbook, the first sale date: work with no trace in any table.
    const manual = ALL_ITEMS.filter((i) => !i.evidence).map((i) => i.key);
    expect(manual).toContain("training");
    expect(manual).toContain("claims_runbook");
    expect(isItemDone("training", { training: { done: true, note: null, updated_at: "", updated_by: null } }, {})).toBe(true);
  });

  it("gives every detectable item a phrase saying what it looks at", () => {
    // "Detected" has to be checkable rather than magic.
    for (const item of ALL_ITEMS.filter((i) => i.evidence)) {
      expect(item.evidence!.length).toBeGreaterThan(10);
    }
    expect(ALL_ITEMS.filter((i) => i.evidence)).toHaveLength(19);
  });

  it("keeps the status out of the record item, because it is not a field", () => {
    // A brand with description, website, customer-care address and registered office all
    // set sat unticked and blocking, under a sentence listing four things that were every
    // one of them true. The fifth clause — "the status is verified" — was the real gap, and
    // it is a decision rather than data: Verified is what publishes a brand to the portal's
    // brand picker and the AION dashboards. Conflating the two made the checklist look
    // broken on exactly the brands where the automation had done its job.
    const record = ALL_ITEMS.find((i) => i.key === "brand_record")!;
    const verify = ALL_ITEMS.find((i) => i.key === "brand_verified")!;
    expect(`${record.detail} ${record.evidence}`.toLowerCase()).not.toContain("verif");
    expect(verify.blocking).toBe(true);
    expect(verify.evidence).toBeTruthy();
    // And it says what verifying DOES, so nobody clicks it on a prospect by accident.
    expect(verify.detail.toLowerCase()).toContain("anonymous visitors");
  });
});


// The screen lands on what is LEFT rather than on all thirty-three rows, so "which items
// does each view mean" is a rule, not a detail of the markup.
describe("what each view shows", () => {
  const someDone = stateOf(ALL_ITEMS.filter((i) => !i.blocking).map((i) => i.key));

  it("to do hides everything already behind you", () => {
    const shown = filterChecklist("todo", someDone).flatMap((g) => g.items);
    expect(shown.length).toBe(ALL_ITEMS.filter((i) => i.blocking).length);
    expect(shown.every((i) => !isItemDone(i.key, someDone))).toBe(true);
  });

  it("blocking shows only the items that stop a launch", () => {
    const shown = filterChecklist("blocking", {}).flatMap((g) => g.items);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((i) => i.blocking === true)).toBe(true);
  });

  it("everything shows every item whatever its state", () => {
    const shown = filterChecklist("all", someDone).flatMap((g) => g.items);
    expect(shown.length).toBe(ALL_ITEMS.length);
  });

  it("counts an item the platform detected as done, not as work", () => {
    const key = ALL_ITEMS.find((i) => i.evidence)!.key;
    const shown = filterChecklist("todo", {}, { [key]: true }).flatMap((g) => g.items);
    expect(shown.some((i) => i.key === key)).toBe(false);
  });

  it("marks a group settled only when all of it is done", () => {
    const group = GO_LIVE_CHECKLIST[0];
    const all = stateOf(group.items.map((i) => i.key));
    const groups = filterChecklist("todo", all);
    expect(groups.find((g) => g.group.key === group.key)!.settled).toBe(true);
    expect(groups.find((g) => g.group.key !== group.key)!.settled).toBe(false);
  });

  it("always returns every group, so a settled one can still be opened", () => {
    expect(filterChecklist("blocking", {}).length).toBe(GO_LIVE_CHECKLIST.length);
  });
});

describe("the blocking items named in the header", () => {
  it("lists only blocking items that are not done", () => {
    const all = blockingItems({});
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((b) => b.item.blocking)).toBe(true);
  });

  it("puts the ones with a real diagnosis first", () => {
    const withReason = ALL_ITEMS.find((i) => i.blocking && i.evidence)!;
    const sorted = blockingItems({}, { [withReason.key]: "still missing: a test credential" });
    expect(sorted[0].item.key).toBe(withReason.key);
    expect(sorted[0].because).toBe("still missing: a test credential");
  });

  it("drops an item once it is ticked", () => {
    const one = ALL_ITEMS.find((i) => i.blocking)!;
    expect(blockingItems(stateOf([one.key])).some((b) => b.item.key === one.key)).toBe(false);
  });
});
