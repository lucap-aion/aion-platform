import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// A background pipeline you cannot see is indistinguishable from one that never
// started. Ferragamo had branding DONE and nine stages QUEUED while the screen
// read "not started · 0 products · 0 chunks indexed", because nothing on this
// screen polled — only the panel buried inside step 3 did.

const overview = {
  brand: { id: 18, name: "Ferragamo", website: "https://www.ferragamo.com", legal_name: "Ferragamo", address: null },
  artifacts: {},
  progress: {},
  counts: { products: 0, knowledge_chunks: 0, customers: 0, policies: 0, brand_users: 0 },
  quotes: [],
  stages: {
    branding:   { status: "done",    queued: false, attempts: 0, error: null, detail: {}, finished_at: "2026-09-10T14:00:00Z" },
    sources:    { status: "running", queued: false, attempts: 0, error: null, detail: {}, finished_at: null },
    storefront: { status: "pending", queued: true,  attempts: 0, error: null, detail: {}, finished_at: null },
    intro_deck: { status: "pending", queued: true,  attempts: 0, error: null, detail: {}, finished_at: null },
  },
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => { const c: Record<string, unknown> = {}; for (const m of ["select","eq","is","or","not","order","limit","maybeSingle"]) c[m] = () => c;
      c.then = (r: (v: unknown) => unknown) => Promise.resolve(r({ data: [], error: null, count: 0 })); return c; },
    functions: { invoke: async () => ({ data: { artifacts: [] }, error: null }) },
  },
}));
vi.mock("@/integrations/supabase/untyped", () => ({
  untyped: { rpc: async () => ({ data: overview, error: null }),
             from: () => { const c: Record<string, unknown> = {}; for (const m of ["select","eq","order","upsert","update"]) c[m] = () => c;
               c.then = (r: (v: unknown) => unknown) => Promise.resolve(r({ data: [], error: null })); return c; } },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { brand_id: 18 }, canWrite: true }) }));
vi.mock("@/contexts/LanguageContext", () => ({ useLanguage: () => ({ locale: "en" }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const BRAND = { id: 18, name: "Ferragamo", website: "https://www.ferragamo.com", slug: "ferragamo", logo_small: null, logo_big: null };

beforeEach(() => vi.clearAllMocks());

const mount = async () => {
  const { default: CommercialCycle } = await import("@/pages/admin/_components/CommercialCycle");
  return render(<MemoryRouter><CommercialCycle brand={BRAND} brands={[]} /></MemoryRouter>);
};

describe("the screen shows the pipeline working", () => {
  it("says what it is doing, and which stage", async () => {
    await mount();
    expect(await screen.findByText(/Setting Ferragamo up/i)).toBeTruthy();
    expect(screen.getByText(/Website & news — in progress/i)).toBeTruthy();
  });

  it("counts the stages rather than leaving it a mystery", async () => {
    await mount();
    expect(await screen.findByText(/1 of 4 done/i)).toBeTruthy();
  });

  it("says the work survives leaving the page", async () => {
    await mount();
    expect(await screen.findByText(/you can leave this page/i)).toBeTruthy();
  });

  it("does not tell you to run a stage the pipeline is already queued to run", async () => {
    await mount();
    await screen.findByText(/Setting Ferragamo up/i);
    // The old screen showed "Queued — you do not need to press anything" directly
    // above "Run the Catalogue stage in step 3 first", with a live button.
    expect(screen.queryByText(/Run the Catalogue stage in step 3 first/i)).toBeNull();
  });

  it("disables the build button while the pipeline owns that step", async () => {
    await mount();
    await screen.findByText(/Setting Ferragamo up/i);
    const btn = await screen.findByRole("button", { name: /Waiting to start|Building…/i });
    expect(btn.hasAttribute("disabled")).toBe(true);
  });
});
