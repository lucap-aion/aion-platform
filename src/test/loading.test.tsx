// NOTE: this file mocks @/integrations/supabase/client with promises that NEVER
// resolve, while knowledge-paging.test.tsx mocks the same module with promises
// that always do. Contradictory per-file mocks are legal under vitest's default
// threads pool, which gives each file its own module registry — they are not
// under a shared registry (`--pool=forks --poolOptions.forks.singleFork`), where
// whichever mock is registered last wins and one of the two files fails. If you
// ever turn file isolation off, that is why.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// What a component says before its data arrives.
//
// Every one of these screens had the same defect: an unfetched component and an
// empty one looked identical, because `[]` and `null` were rendered as fact. So
// a fully quoted brand flashed "No rate on file", a brand with a working
// catalogue flashed "No catalogue source registered", and a brand with all five
// documents flashed five ambers reading "not drafted". None of it was true, and
// the one that stuck around longest — a slow connection — was the one a person
// would actually act on.
//
// The client here NEVER resolves, so the loading state is the only state. Any
// assertion the component makes here is an assertion it cannot support.

vi.mock("@/integrations/supabase/client", () => {
  const pending = () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "not", "in", "gte", "lte", "order", "limit",
                     "single", "maybeSingle", "insert", "update", "upsert", "delete"]) {
      chain[m] = () => chain;
    }
    // A promise that never settles: exactly a request still in flight.
    chain.then = () => new Promise(() => {});
    return chain;
  };
  return {
    supabase: {
      from: () => pending(),
      rpc: () => pending(),
      storage: { from: () => ({ upload: async () => ({ error: null }) }) },
      functions: { invoke: () => new Promise(() => {}) },
      auth: { getUser: () => new Promise(() => {}) },
    },
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ profile: null, canWrite: true, isBrandUser: false, loading: true, adminRecord: null, user: null }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
};

// A skeleton is the animate-pulse element the shared primitive renders.
const skeletons = (c: HTMLElement) => c.querySelectorAll(".animate-pulse").length;

describe("nothing claims a fact it has not loaded", () => {
  it("brand documents show the five kinds without calling any of them missing", async () => {
    const { default: BrandDocuments } = await import("@/pages/admin/_components/BrandDocuments");
    const { container } = wrap(<BrandDocuments brandId={18} brandName="Pasquale Bruni" />);

    // The five kinds are static, so naming them is honest.
    expect(screen.getByText("Customer FAQ")).toBeTruthy();
    expect(screen.getByText("Partnership proposal")).toBeTruthy();
    // Whether any exists is not.
    expect(screen.queryByText(/not drafted/i)).toBeNull();
    expect(screen.queryByText(/Nothing drafted yet/i)).toBeNull();
    expect(skeletons(container)).toBeGreaterThan(0);
  });

  it("the catalogue source does not report itself unregistered", async () => {
    const { default: CatalogueSource } = await import("@/pages/admin/_components/CatalogueSource");
    const { container } = wrap(<CatalogueSource brandId={18} products={0} />);
    expect(screen.queryByText(/No catalogue source registered/i)).toBeNull();
    expect(screen.queryByText(/No product feed was found/i)).toBeNull();
    expect(skeletons(container)).toBeGreaterThan(0);
  });

  it("the quote editor does not announce that nothing can be priced", async () => {
    const { default: InsurerQuotes } = await import("@/pages/admin/_components/InsurerQuotes");
    const { container } = wrap(<InsurerQuotes brands={[{ id: 18, name: "Pasquale Bruni" }]} />);
    expect(screen.queryByText(/No quotes on file/i)).toBeNull();
    expect(skeletons(container)).toBeGreaterThan(0);
  });

  it("the business case does not flag a segment as unquoted before quotes load", async () => {
    const { default: BusinessCasePanel } = await import("@/pages/admin/_components/BusinessCasePanel");
    const { container } = wrap(
      <BusinessCasePanel brandId={18} brands={[{ id: 18, name: "Pasquale Bruni" }]} />);
    expect(screen.queryByText(/No rate on file/i)).toBeNull();
    expect(skeletons(container)).toBeGreaterThan(0);
  });

  it("the onboarding panel does not present every stage as never run", async () => {
    const { default: BrandOnboarding } = await import("@/pages/admin/_components/BrandOnboarding");
    const { container } = wrap(
      <BrandOnboarding brandId={18} brandName="Pasquale Bruni" website="https://www.pasqualebruni.com" />);
    expect(screen.getByText("Brand identity")).toBeTruthy();
    // "Not demo ready yet" is a verdict, and it needs the counts to reach it.
    expect(screen.queryByText(/Not demo ready yet/i)).toBeNull();
    expect(screen.queryByText(/Demo ready/i)).toBeNull();
    expect(skeletons(container)).toBeGreaterThan(0);
  });

  it("the cycle screen does not report zero products or zero steps done", async () => {
    const { default: CommercialCycle } = await import("@/pages/admin/_components/CommercialCycle");
    const { container } = wrap(<CommercialCycle
      brand={{ id: 18, name: "Pasquale Bruni", website: null, slug: "pb", logo_small: null, logo_big: null }}
      brands={[]} />);
    expect(screen.queryByText(/0 products/i)).toBeNull();
    expect(screen.queryByText(/0\/5 steps done/i)).toBeNull();
    // Its replacement must not claim "not started" before it has read anything either.
    expect(screen.queryByText(/not started/i)).toBeNull();
    expect(screen.queryByText(/Nothing built yet/i)).toBeNull();
    expect(skeletons(container)).toBeGreaterThan(0);
  });
});
