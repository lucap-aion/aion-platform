import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Smoke tests: do the pages we changed today actually mount?
//
// tsc proves the types line up and `vite build` proves it bundles — neither
// proves a component renders. A bad hook order, a null deref on first paint or a
// missing provider only shows up when something actually mounts it, and nothing
// had mounted any of this.

vi.mock("@/integrations/supabase/client", () => {
  const thenable = (rows: unknown[] = []) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "not", "in", "gte", "lte", "order", "limit", "single", "maybeSingle", "insert", "update", "upsert", "delete"]) {
      chain[m] = () => chain;
    }
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve(res({ data: rows, error: null, count: rows.length }));
    return chain;
  };
  return {
    supabase: {
      from: () => thenable([]),
      rpc: () => thenable([]),
      storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({}) }) },
      functions: { invoke: async () => ({ data: {}, error: null }) },
      auth: { getUser: async () => ({ data: { user: null } }) },
    },
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    profile: { brand_id: 17, first_name: "Test", last_name: "User", email: "t@example.com" },
    canWrite: true, isBrandUser: true, loading: false, adminRecord: null, user: null,
  }),
}));

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (k: string) => k, locale: "en" }),
}));

vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ name: "Luisa Beccaria", logoUrl: null }),
}));

vi.mock("@/hooks/useAuthSlug", () => ({ useAuthSlug: () => "/lb" }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));

const BRAND = { id: 18, name: "Pasquale Bruni", website: "https://www.pasqualebruni.com",
                slug: "pb", logo_small: null, logo_big: null };

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
};

beforeEach(() => vi.clearAllMocks());

describe("pages mount", () => {
  it("brand Home renders and greets rather than showing a bare zero", async () => {
    const { default: Home } = await import("@/pages/brand/BrandDashboard");
    wrap(<Home />);
    // The greeting is time-of-day dependent, so assert on the shape not the word.
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  });

  it("the onboarding panel renders for a brand with no run yet", async () => {
    const { default: BrandOnboarding } = await import("@/pages/admin/_components/BrandOnboarding");
    wrap(<BrandOnboarding brandId={18} brandName="Pasquale Bruni" website="https://www.pasqualebruni.com" />);
    expect(screen.getByText(/Brand identity/i)).toBeTruthy();
  });

  it("the onboarding panel warns when the brand has no website", async () => {
    const { default: BrandOnboarding } = await import("@/pages/admin/_components/BrandOnboarding");
    wrap(<BrandOnboarding brandId={99} brandName="No Site" website={null} />);
    expect(screen.getByText(/no website yet/i)).toBeTruthy();
  });

  it("knowledge is a tab on the brand, with no picker to point at the wrong one", async () => {
    const { default: AdminBrandDetail } = await import("@/pages/admin/AdminBrandDetail");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/admin/brands/18?tab=knowledge"]}>
          <Routes><Route path="/admin/brands/:brandId" element={<AdminBrandDetail />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("button", { name: "Knowledge" })).toBeTruthy();
    // The old page carried a brand <select> whose choice was remembered across
    // sessions; the brand is the page now, so there is nothing to mis-select.
    expect(screen.queryByText(/Uploads and edits here belong to the selected brand/i)).toBeNull();
  });

  it("the commercial cycle lists all five steps", async () => {
    const { default: CommercialCycle } = await import("@/pages/admin/_components/CommercialCycle");
    wrap(<CommercialCycle brand={BRAND} brands={[]} />);
    for (const title of ["First meeting", "NDA & data request", "Platform demo", "Pricing", "Operations review"]) {
      expect(await screen.findByText(title)).toBeTruthy();
    }
  });

  it("the business case panel renders its perimeter without a calculation", async () => {
    const { default: BusinessCasePanel } = await import("@/pages/admin/_components/BusinessCasePanel");
    wrap(<BusinessCasePanel brandId={18} brands={[{ id: 18, name: "Pasquale Bruni" }]} />);
    expect(screen.getByText(/Perimeter/i)).toBeTruthy();
    // Build deck stays disabled until Calculate has produced figures to build from.
    expect(screen.getByRole("button", { name: /Build deck/i }).hasAttribute("disabled")).toBe(true);
  });

  it("the old business-case route lands on step 4, keeping the brand", async () => {
    const { default: AdminBusinessCase } = await import("@/pages/admin/AdminBusinessCase");
    const { default: AdminBrandDetail } = await import("@/pages/admin/AdminBrandDetail");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/admin/business-case?brand=18"]}>
          <Routes>
            <Route path="/admin/business-case" element={<AdminBusinessCase />} />
            <Route path="/admin/brands/:brandId" element={<AdminBrandDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // It was a sidebar item for months, so the URL is bookmarked — it has to
    // land on that brand's own cycle rather than 404.
    expect(await screen.findByText("Pricing")).toBeTruthy();
  });

  it("a brand is one page with record, cycle and documents on it", async () => {
    const { default: AdminBrandDetail } = await import("@/pages/admin/AdminBrandDetail");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/admin/brands/18?tab=cycle"]}>
          <Routes><Route path="/admin/brands/:brandId" element={<AdminBrandDetail />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // All three reachable from the one place, and ?tab= decides which is shown.
    expect(await screen.findByRole("button", { name: "Record" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Commercial cycle" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Documents" })).toBeTruthy();
    expect(await screen.findByText("First meeting")).toBeTruthy();
    rerender(<span />);
  });

  it("brand documents name every kind, drafted or not", async () => {
    const { default: BrandDocuments } = await import("@/pages/admin/_components/BrandDocuments");
    wrap(<BrandDocuments brandId={18} brandName="Pasquale Bruni" />);
    // All five are listed even with nothing drafted, so a missing one is visible
    // rather than absent — which is how they went unnoticed for two months.
    for (const label of ["Customer FAQ", "Sales-floor one-pager", "Cover summary",
                         "Activation email", "Partnership proposal"]) {
      expect(await screen.findByText(label)).toBeTruthy();
    }
  });

  it("the catalogue source says why an empty catalogue matters", async () => {
    const { default: CatalogueSource } = await import("@/pages/admin/_components/CatalogueSource");
    wrap(<CatalogueSource brandId={18} products={0} />);
    expect(await screen.findByText(/No catalogue source registered/i)).toBeTruthy();
  });

  it("the insurer quote editor says plainly when nothing can be priced", async () => {
    const { default: InsurerQuotes } = await import("@/pages/admin/_components/InsurerQuotes");
    wrap(<InsurerQuotes brands={[{ id: 18, name: "Pasquale Bruni" }]} />);
    expect(await screen.findByText(/No quotes on file/i)).toBeTruthy();
  });
});
