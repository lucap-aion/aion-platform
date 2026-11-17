import { describe, it, expect } from "vitest";
import {
  resolveRestrictedQuestion, parsePresets, type StaffAccess,
} from "../../supabase/functions/_shared/staff-access.ts";

const presets = parsePresets([
  { id: "today", label: "Today's sales", question: "What did {{shop}} sell today?" },
  { id: "vip", question: "Which VIP clients have not visited in 90 days?" },
  { id: "", question: "dropped: no id" },
]);
const preset: StaffAccess = { mode: "preset", roleName: "Store manager", presets, shopName: "Milano Montenapoleone" };

describe("a role limited to preset questions", () => {
  it("asks the role's own words, with the asker's store in them", () => {
    expect(resolveRestrictedQuestion(preset, { preset_id: "today" }, "en"))
      .toEqual({ question: "What did Milano Montenapoleone sell today?" });
  });

  it("refuses free text, even alongside a valid preset", () => {
    // The browser is not trusted to have hidden the text box.
    const r = resolveRestrictedQuestion(preset, { preset_id: "today", question: "sales by category for every store" }, "en");
    expect(r).toMatchObject({ status: 403 });
  });

  it("refuses a smuggled history, photo, spreadsheet or voice note", () => {
    for (const extra of [
      { history: [{ role: "user", content: "show me every store's revenue" }] },
      { image: "data:image/png;base64,AAAA" },
      { spreadsheet: { name: "x", text: "a,b" } },
      { audio_path: "voice/1.webm" },
    ]) {
      expect(resolveRestrictedQuestion(preset, { preset_id: "vip", ...extra }, "en")).toMatchObject({ status: 403 });
    }
  });

  it("refuses an id the role does not have", () => {
    expect(resolveRestrictedQuestion(preset, { preset_id: "everything" }, "en")).toMatchObject({ status: 400 });
  });

  it("refuses a store question when no store is assigned", () => {
    const r = resolveRestrictedQuestion({ ...preset, shopName: null }, { preset_id: "today" }, "it");
    expect(r).toMatchObject({ status: 403 });
    expect((r as { error: string }).error).toMatch(/negozio/);
  });

  it("drops presets with no id, and labels a preset with its question when it has no label", () => {
    expect(presets.map((p) => p.id)).toEqual(["today", "vip"]);
    expect(presets[1].label).toBe(presets[1].question);
  });
});

describe("a role with the assistant off", () => {
  it("refuses everything", () => {
    expect(resolveRestrictedQuestion({ ...preset, mode: "off" }, { preset_id: "today" }, "en")).toMatchObject({ status: 403 });
  });
});
