import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { writeFileSync } from "node:fs";
import GoLiveChecklist from "@/pages/admin/_components/GoLiveChecklist";
import { ALL_ITEMS } from "@/lib/goLiveChecklist";

// The Go-live tab filters on who can close an item as well as on whether it is done. The
// rule is tested in golive-checklist.test.ts; this holds the SCREEN to it — the buttons
// exist, the list follows them, and a group with nothing of that kind disappears rather
// than reading as settled.

// A house part-way through: the record is filled in, the cycle has had its first meeting.
const signals = {
  slug: true, brand_record: true, faq: true, premium: true, intro_meeting: true,
  onboarding_run: "2 of 10 stages still queued or running",
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  },
}));
vi.mock("@/integrations/supabase/untyped", () => ({
  untyped: {
    rpc: async () => ({ data: signals, error: null }),
    from: () => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "upsert", "update"]) c[m] = () => c;
      c.then = (r: (v: unknown) => unknown) => Promise.resolve(r({ data: [], error: null }));
      return c;
    },
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));

const titles = () => screen.queryAllByRole("checkbox").map((c) => c.getAttribute("aria-label"));
const byTitle = (t: string | null) => ALL_ITEMS.find((i) => i.title === t)!;

describe("the Go-live tab's tech filter", () => {
  it("lists only tech-heavy work under Tech heavy, and only the rest under Not tech heavy", async () => {
    const { container } = render(<GoLiveChecklist brandId={21} brandName="Maison" />);
    await waitFor(() => expect(screen.getByRole("group", { name: "Filter by tech load" })).toBeTruthy());
    const techRow = within(screen.getByRole("group", { name: "Filter by tech load" }));

    fireEvent.click(techRow.getByRole("button", { name: /^Tech heavy/ }));
    const heavy = titles();
    expect(heavy.length).toBe(ALL_ITEMS.filter((i) => i.tech === "heavy").length);
    expect(heavy.every((t) => byTitle(t).tech === "heavy")).toBe(true);
    // Finance has nothing technical in it: hidden, not shown as a settled 0/0.
    expect(screen.queryByText("Finance")).toBeNull();
    if (process.env.GOLIVE_DUMP) writeFileSync(process.env.GOLIVE_DUMP, container.innerHTML);

    fireEvent.click(techRow.getByRole("button", { name: /^Not tech heavy/ }));
    const light = titles();
    expect(light.length).toBeGreaterThan(0);
    expect(light.every((t) => byTitle(t).tech !== "heavy")).toBe(true);
  });

  it("counts the tech-heavy work still open in the header", async () => {
    render(<GoLiveChecklist brandId={21} brandName="Maison" />);
    const n = ALL_ITEMS.filter((i) => i.tech === "heavy").length;
    await waitFor(() => expect(screen.getByText(`${n} tech heavy left`)).toBeTruthy());
  });

  it("shows a cycle step the platform detected as done, and why onboarding is not", async () => {
    render(<GoLiveChecklist brandId={21} brandName="Maison" />);
    await waitFor(() => expect(screen.getByText("2 of 10 stages still queued or running")).toBeTruthy());
    // Done items are not in the default To-do view.
    expect(screen.queryByRole("checkbox", { name: "Hold the first meeting" })).toBeNull();
  });
});
