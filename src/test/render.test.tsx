import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

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

  it("admin knowledge renders its brand picker", async () => {
    const { default: AdminKnowledge } = await import("@/pages/admin/AdminKnowledge");
    wrap(<AdminKnowledge />);
    // The picker's own label, not any of the several other "brand" strings.
    expect(screen.getByText(/Uploads and edits here belong to the selected brand/i)).toBeTruthy();
  });
});
