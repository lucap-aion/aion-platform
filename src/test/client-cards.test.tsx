import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Clients in the assistant used to go through the product photo grid, and the
// many without a photo became empty squares — "a list of ten looks broken".
// These pin the replacement: people are told apart from pieces, and a missing
// or dead photo is a monogram, never a blank box.

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: new Error("gone") }) }) } },
}));

import ClientList, { isClientResult, isPersonImageColumn } from "@/components/assistant/ClientList";
import ClientAvatar, { clientInitials } from "@/components/ClientAvatar";

describe("telling clients from pieces", () => {
  it("a result with a client's avatar is a client result", () => {
    expect(isClientResult(["first_name", "last_name", "avatar", "total_spent"])).toBe(true);
    expect(isPersonImageColumn("avatar")).toBe(true);
    expect(isPersonImageColumn("customer_photo_url")).toBe(true);
  });

  it("a result with names but no picture is still about people", () => {
    expect(isClientResult(["first_name", "last_name", "email", "pieces"])).toBe(true);
    expect(isClientResult(["client_name", "segment"])).toBe(true);
  });

  it("a product result is not, even with a buyer's name on it", () => {
    expect(isClientResult(["name", "collection", "image_url", "price"])).toBe(false);
    expect(isClientResult(["name", "picture", "customer_name"])).toBe(false);
    expect(isPersonImageColumn("picture")).toBe(false);
    expect(isPersonImageColumn("image_url")).toBe(false);
  });
});

describe("the monogram", () => {
  it("is first and last initial, from the email when there is no name", () => {
    expect(clientInitials("Camilla De Santis")).toBe("CS");
    expect(clientInitials("Sofia")).toBe("S");
    expect(clientInitials("  ", "élodie@x.com")).toBe("É");
    expect(clientInitials("", "")).toBe("");
  });

  it("stands in when there is no photo", () => {
    render(<ClientAvatar name="Sofia Romano" value={null} />);
    expect(screen.getByText("SR")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("replaces a photo that fails to load", async () => {
    render(<ClientAvatar name="Aurora Ricci" value="https://cdn.example.com/a.jpg" />);
    const img = await waitFor(() => {
      const el = document.querySelector("img");
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.error(img);
    expect(screen.getByText("AR")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("replaces a stored file that cannot be signed", async () => {
    render(<ClientAvatar name="Ginevra Marino" value="abc/avatar.jpg" />);
    await waitFor(() => expect(screen.getByText("GM")).toBeInTheDocument());
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("a top-10 list", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    id: `u${i}`, first_name: `Name${i}`, last_name: `Surname${i}`, email: `c${i}@x.com`, city: "Milano",
    avatar: i % 3 === 0 ? `https://cdn.example.com/${i}.jpg` : null, total_spent: 50000 - i * 1000, pieces: 10 - i,
  }));

  it("draws one row per client, with the full name and the figures", () => {
    render(<ClientList columns={["first_name", "last_name", "email", "city", "avatar", "total_spent", "pieces"]} rows={rows} locale="en" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByText("Name0 Surname0")).toBeInTheDocument();
    expect(screen.getByText("€50.000")).toBeInTheDocument();
    // Clients without a photo get their initials, not an empty box.
    expect(screen.getAllByText("NS", { selector: "span" }).length).toBeGreaterThanOrEqual(6);
  });
});
