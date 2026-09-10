import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// What the cycle screen costs while a pipeline runs.
//
// It used to run TWO pollers against THREE endpoints. This screen refreshed every six
// seconds — an RPC *and* a `build-collateral` invoke whose only job was to re-sign download
// links that had not changed — and the onboarding panel buried inside step 3 polled
// `onboard-brand` every eight. A storefront crawl runs for minutes, so a single brand's
// onboarding cost hundreds of edge-function invocations, nearly all of them redrawing chips
// that already said the right thing.
//
// Now: one RPC on a timer, and the two function calls happen once each — the second only
// when the set of built files actually changes.

const overview = {
  brand: {
    id: 18, name: "Ferragamo", website: "https://www.ferragamo.com", is_prospect: true,
    legal_name: null, product_focus: null, address: null, address_is_override: false,
  },
  artifacts: { intro_teaser: { storage_path: "brands/18/intro.pptx", generated_at: "2026-09-10T14:00:00Z", slots_filled: 3 } },
  progress: {},
  business_case: null,
  counts: { products: 120, knowledge_chunks: 400, customers: 0, policies: 0, brand_users: 0 },
  quotes: [],
  // Something is genuinely in flight, so the poller is meant to be running.
  stages: {
    branding: { status: "done", queued: false, attempts: 0, error: null, detail: {}, finished_at: "2026-09-10T14:00:00Z" },
    sources: { status: "running", queued: false, attempts: 0, error: null, detail: {}, finished_at: null },
    storefront: { status: "pending", queued: true, attempts: 0, error: null, detail: {}, finished_at: null },
  },
};

const invoke = vi.fn(async (fn: string) => {
  if (fn === "onboard-brand") return { data: { demo_allowed: true, demo_blocked_reason: null }, error: null };
  return { data: { artifacts: [] }, error: null };
});
const rpc = vi.fn(async () => ({ data: overview, error: null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "or", "not", "order", "limit", "maybeSingle", "update"]) c[m] = () => c;
      c.then = (r: (v: unknown) => unknown) => Promise.resolve(r({ data: [], error: null, count: 0 }));
      return c;
    },
    functions: { invoke: (fn: string) => invoke(fn) },
  },
}));
vi.mock("@/integrations/supabase/untyped", () => ({
  untyped: {
    rpc: () => rpc(),
    from: () => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "upsert", "update"]) c[m] = () => c;
      c.then = (r: (v: unknown) => unknown) => Promise.resolve(r({ data: [], error: null }));
      return c;
    },
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { brand_id: 18 }, canWrite: true }) }));
vi.mock("@/contexts/LanguageContext", () => ({ useLanguage: () => ({ locale: "en" }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const BRAND = { id: 18, name: "Ferragamo", website: "https://www.ferragamo.com", slug: "ferragamo", logo_small: null, logo_big: null };

const callsTo = (fn: string) => invoke.mock.calls.filter((c) => c[0] === fn).length;

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const mountAndRun = async (ms: number) => {
  const { default: CommercialCycle } = await import("@/pages/admin/_components/CommercialCycle");
  await act(async () => {
    render(<MemoryRouter><CommercialCycle brand={BRAND} brands={[]} /></MemoryRouter>);
    // Flush the mount fetches.
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

describe("what the cycle costs while the pipeline runs", () => {
  it("polls the overview, and only the overview", async () => {
    await mountAndRun(30_000);
    // Five ticks at six seconds, plus the initial read.
    expect(rpc.mock.calls.length).toBeGreaterThan(3);
  });

  it("does not re-invoke build-collateral on every tick just to re-sign links", async () => {
    await mountAndRun(30_000);
    // The artifact fingerprint never changes here, so one call is all it may make. This
    // used to be one per tick, for the whole length of a crawl.
    expect(callsTo("build-collateral")).toBe(1);
  });

  it("asks once whether demo tooling is allowed, rather than polling for it", async () => {
    await mountAndRun(30_000);
    // Whether a brand may have a demo built in it does not change while you look at it.
    // The old panel re-read it every eight seconds because the same response also carried
    // the stage rows.
    expect(callsTo("onboard-brand")).toBe(1);
  });
});
