import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({}), isBrandRole: () => true }));

import { roleAllows, landingFor, ROLE_PAGES, type StaffRole } from "@/hooks/useStaffRole";

const role = (over: Partial<StaffRole> = {}): StaffRole => ({
  id: 1, name: "Store manager", pages: ["/dashboard", "/customers"], assistant_mode: "preset", preset_questions: [], ...over,
});

describe("what a role can open", () => {
  it("no role opens everything", () => {
    expect(roleAllows(null, "/insights")).toBe(true);
  });

  it("opens its pages and their detail screens, and nothing else that is gated", () => {
    const r = role();
    expect(roleAllows(r, "/customers")).toBe(true);
    expect(roleAllows(r, "/customers/abc-123")).toBe(true);
    expect(roleAllows(r, "/insights")).toBe(false);
    expect(roleAllows(r, "/shops/4")).toBe(false);
  });

  it("always opens what is not a role's to close", () => {
    expect(roleAllows(role({ pages: [] }), "/profile")).toBe(true);
  });

  it("the assistant follows its mode; the older data chat only opens unrestricted", () => {
    expect(roleAllows(role({ assistant_mode: "preset" }), "/assistant")).toBe(true);
    expect(roleAllows(role({ assistant_mode: "off" }), "/assistant")).toBe(false);
    expect(roleAllows(role({ assistant_mode: "preset" }), "/ai-query")).toBe(false);
    expect(roleAllows(role({ assistant_mode: "full" }), "/ai-query")).toBe(true);
  });
});

describe("where a role lands", () => {
  // Every combination: the landing must be a screen the role may open and the brand has,
  // or two redirects send each other round in a loop.
  const modes = ["full", "preset", "off"] as const;
  const pageSets = [[], ["/customers"], ["/dashboard", "/shops"], ROLE_PAGES.map((p) => p.path)];
  for (const mode of modes) for (const pages of pageSets) for (const assistantAvailable of [true, false]) {
    it(`${mode}, [${pages.join(",")}], assistant ${assistantAvailable ? "on" : "off"}`, () => {
      const r = role({ assistant_mode: mode, pages });
      const to = landingFor(r, { assistantFirst: false, assistantAvailable });
      expect(roleAllows(r, to)).toBe(true);
      if (!assistantAvailable) expect(to).not.toBe("/assistant");
    });
  }
});
