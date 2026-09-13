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

// The four brands already on dev, so duplicate detection has something real to
// catch. Roberto Coin's slug is "rc", not "roberto-coin" — slugs are chosen, not
// derived, which is why the field is on the form.
const EXISTING = [
  { id: 2, name: "Roberto Coin", slug: "rc", website: "https://robertocoin.com" },
  { id: 16, name: "Pomellato", slug: "pomellato", website: "https://www.pomellato.com" },
];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: async () => ({ data: EXISTING, error: null }) }),
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
  fireEvent.change(screen.getByPlaceholderText("Brand name"), { target: { value: name } });
  fireEvent.change(screen.getByPlaceholderText("brand.com"), { target: { value: site } });
};
const submit = () => fireEvent.click(screen.getByRole("button", { name: /Create and start/i }));

describe("a new brand starts itself", () => {
  it("queues the onboarding pipeline as soon as the brand exists", async () => {
    await mount();
    fill("Pasquale Bruni", "pasqualebruni.com");
    fireEvent.click(screen.getByRole("button", { name: /Create and start/i }));

    await waitFor(() => expect(invoked).toHaveLength(1));
    expect(invoked[0].name).toBe("onboard-brand");
    expect(invoked[0].body).toEqual({ brand_id: 42, action: "start" });
  });

  it("refuses a website an existing brand already owns, www or not", async () => {
    await mount();
    // Typed without www; Pomellato is stored WITH it. Same house.
    fill("Pomellato Milano", "pomellato.com");
    expect(await screen.findByText(/already uses that website/i)).toBeTruthy();
    submit();
    await waitFor(() => expect(inserted).toHaveLength(0));
  });

  it("refuses an address another brand already answers on", async () => {
    await mount();
    fill("RC Jewels", "rcjewels.example.com");
    fireEvent.change(screen.getByPlaceholderText("brand-name"), { target: { value: "rc" } });
    expect(await screen.findByText(/already uses that slug/i)).toBeTruthy();
    submit();
    await waitFor(() => expect(inserted).toHaveLength(0));
  });

  it("keeps only the origin when a deep link is pasted", async () => {
    await mount();
    fill("Pasquale Bruni", "https://www.pasqualebruni.com/en-gb/collections/fall?utm_source=x");
    submit();
    await waitFor(() => expect(inserted).toHaveLength(1));
    // Otherwise every crawl would start from a category page.
    expect(inserted[0].website).toBe("https://www.pasqualebruni.com");
  });

  it("does not create the brand twice when Enter fires more than once", async () => {
    await mount();
    fill("Pasquale Bruni", "pasqualebruni.com");
    const nameField = screen.getByPlaceholderText("Brand name");
    fireEvent.keyDown(nameField, { key: "Enter" });
    fireEvent.keyDown(nameField, { key: "Enter" });
    fireEvent.keyDown(nameField, { key: "Enter" });
    await waitFor(() => expect(invoked.length).toBeGreaterThan(0));
    // Two rows would mean two pipelines crawling the same site.
    expect(inserted).toHaveLength(1);
    expect(invoked).toHaveLength(1);
  });

  it("lets the address be edited without the name overwriting it again", async () => {
    await mount();
    fill("Roberto Coin Milano", "rcmilano.example.com");
    const slugField = screen.getByPlaceholderText("brand-name") as HTMLInputElement;
    expect(slugField.value).toBe("roberto-coin-milano");
    fireEvent.change(slugField, { target: { value: "rcm" } });
    fireEvent.change(screen.getByPlaceholderText("Brand name"), { target: { value: "Roberto Coin Milano SpA" } });
    expect(slugField.value).toBe("rcm");
    submit();
    await waitFor(() => expect(inserted).toHaveLength(1));
    expect(inserted[0].slug).toBe("rcm");
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
    fireEvent.change(screen.getByPlaceholderText("Brand name"), { target: { value: "Some House" } });
    expect(screen.getByRole("button", { name: /Create and start/i }).hasAttribute("disabled")).toBe(true);
    fill("Some House", "not a domain");
    expect(screen.getByRole("button", { name: /Create and start/i }).hasAttribute("disabled")).toBe(true);
    expect(inserted).toHaveLength(0);
  });
});
