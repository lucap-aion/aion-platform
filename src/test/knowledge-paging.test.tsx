import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Does the knowledge list actually page, or does it only look like it?
//
// The controls render from `page` and `docTotalCount`, but what matters is the
// RANGE that reaches PostgREST: a Next button that repaints the same 50 rows is
// worse than no Next button, because it reads as "that is the whole base".
//
// So this records every .range() the component asks for and drives the real
// buttons. It also pins the reset rule — searching from page 8 has to go back to
// page 1, or the query returns nothing and reads as "no matches" on a term that
// has plenty.

const ranges: [number, number][] = [];
const TOTAL = 531; // Pasquale Bruni, as it was on dev

vi.mock("@/integrations/supabase/client", () => {
  const rows = (from: number, to: number) =>
    Array.from({ length: Math.max(0, Math.min(to, TOTAL - 1) - from + 1) }, (_, i) => ({
      id: from + i + 1, title: `Doc ${from + i + 1}`, category: "product", source_type: "url",
      source_url: `https://x.com/p/${from + i + 1}`, status: "ready", error: null,
      char_count: 10, chunk_count: 1, updated_at: "2026-09-01T00:00:00Z",
    }));

  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "not", "is", "in", "gte", "lte", "order", "limit"]) {
      c[m] = () => c;
    }
    c.range = (from: number, to: number) => {
      ranges.push([from, to]);
      return Promise.resolve({ data: rows(from, to), error: null });
    };
    // A head:true count query is awaited directly, without .range().
    c.then = (res: (v: unknown) => unknown) =>
      Promise.resolve(res({ data: [], error: null, count: TOTAL }));
    c.maybeSingle = () => Promise.resolve({ data: null, error: null });
    c.single = () => Promise.resolve({ data: null, error: null });
    return c;
  };

  return {
    supabase: {
      from: () => chain(),
      rpc: () => Promise.resolve({ data: [{ chunks: 1434 }], error: null }),
      storage: { from: () => ({ upload: async () => ({ error: null }) }) },
      functions: { invoke: async () => ({ data: {}, error: null }) },
      auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    },
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ profile: { brand_id: 18 }, canWrite: true }),
}));
vi.mock("@/contexts/LanguageContext", () => ({ useLanguage: () => ({ locale: "en" }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

beforeEach(() => { ranges.length = 0; });

const mount = async () => {
  const { default: BrandKnowledge } = await import("@/pages/brand/BrandKnowledge");
  return render(<MemoryRouter><BrandKnowledge brandIdOverride={18} canWriteOverride /></MemoryRouter>);
};

describe("the knowledge list pages server-side", () => {
  it("asks for the first 50 rows, not the whole base", async () => {
    await mount();
    await waitFor(() => expect(ranges.length).toBeGreaterThan(0));
    expect(ranges[0]).toEqual([0, 49]);
  });

  it("says how many there are and how many pages", async () => {
    await mount();
    expect(await screen.findByText(/1–50 of 531 documents/)).toBeTruthy();
    expect(screen.getByText(/Page 1 of 11/)).toBeTruthy();
  });

  it("Next asks the DATABASE for the next 50 — not the same 50 again", async () => {
    await mount();
    await waitFor(() => expect(ranges.length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole("button", { name: /Next/i }));
    await waitFor(() => expect(ranges.at(-1)).toEqual([50, 99]));
    expect(await screen.findByText(/51–100 of 531 documents/)).toBeTruthy();
  });

  it("Previous is disabled on the first page and Next on the last", async () => {
    await mount();
    expect((await screen.findByRole("button", { name: /Previous/i })).hasAttribute("disabled")).toBe(true);
    for (let i = 0; i < 10; i++) fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    await waitFor(() => expect(screen.getByText(/Page 11 of 11/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /Next/i }).hasAttribute("disabled")).toBe(true);
    // 531 = ten full pages plus 31.
    expect(await screen.findByText(/501–531 of 531 documents/)).toBeTruthy();
  });

  it("a search from a later page starts again at the first one", async () => {
    await mount();
    await waitFor(() => expect(ranges.length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole("button", { name: /Next/i }));
    await waitFor(() => expect(ranges.at(-1)).toEqual([50, 99]));

    fireEvent.change(screen.getByPlaceholderText(/Search/i), { target: { value: "carnet" } });
    // Searching from page 2 with the offset kept would query rows 50-99 of the
    // matches and, for any term with fewer than 50 hits, come back empty.
    await waitFor(() => expect(ranges.at(-1)).toEqual([0, 49]), { timeout: 2000 });
  });
});
