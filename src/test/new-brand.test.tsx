import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Creating a brand has to START something.
//
// The whole point of asking for two fields instead of forty is that everything
// else gets discovered — and that only holds if the pipeline is queued on
// create. If this call goes missing, the form still "works": a brand appears in
// the table, nothing happens to it, and nobody finds out until someone opens the
// cycle a week later and finds every step empty.

const invoked: { name: string; body: Record<string, unknown> }[] = [];
const inserted: Record<string, unknown>[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return { select: () => ({ single: async () => ({ data: { id: 42 }, error: null }) }) };
      },
    }),
    functions: {
      invoke: async (name: string, opts: { body: Record<string, unknown> }) => {
        invoked.push({ name, body: opts.body });
        return { data: { ok: true }, error: null };
      },
    },
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

beforeEach(() => { invoked.length = 0; inserted.length = 0; navigate.mockClear(); });

const mount = async () => {
  const { default: NewBrand } = await import("@/pages/admin/_components/NewBrand");
  return render(<MemoryRouter><NewBrand /></MemoryRouter>);
};

const fill = (name: string, site: string) => {
  fireEvent.change(screen.getByPlaceholderText("Pasquale Bruni"), { target: { value: name } });
  fireEvent.change(screen.getByPlaceholderText("pasqualebruni.com"), { target: { value: site } });
};

describe("a new brand starts itself", () => {
  it("queues the onboarding pipeline as soon as the brand exists", async () => {
    await mount();
    fill("Pasquale Bruni", "pasqualebruni.com");
    fireEvent.click(screen.getByRole("button", { name: /Create and start/i }));

    await waitFor(() => expect(invoked).toHaveLength(1));
    expect(invoked[0].name).toBe("onboard-brand");
    expect(invoked[0].body).toEqual({ brand_id: 42, action: "start" });
  });

  it("derives the slug and normalises a bare domain to https", async () => {
    await mount();
    fill("Pasquale Bruni", "pasqualebruni.com");
    fireEvent.click(screen.getByRole("button", { name: /Create and start/i }));
    await waitFor(() => expect(inserted).toHaveLength(1));
    expect(inserted[0]).toMatchObject({
      name: "Pasquale Bruni", slug: "pasquale-bruni",
      website: "https://pasqualebruni.com", status: "pending",
    });
  });

  it("lands on the cycle, where the work is now visibly running", async () => {
    await mount();
    fill("Pasquale Bruni", "pasqualebruni.com");
    fireEvent.click(screen.getByRole("button", { name: /Create and start/i }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/admin/brands/42?tab=cycle"));
  });

  it("will not create a brand with no website to discover anything from", async () => {
    await mount();
    fireEvent.change(screen.getByPlaceholderText("Pasquale Bruni"), { target: { value: "Some House" } });
    expect(screen.getByRole("button", { name: /Create and start/i }).hasAttribute("disabled")).toBe(true);
    fill("Some House", "not a domain");
    expect(screen.getByRole("button", { name: /Create and start/i }).hasAttribute("disabled")).toBe(true);
    expect(inserted).toHaveLength(0);
  });
});
