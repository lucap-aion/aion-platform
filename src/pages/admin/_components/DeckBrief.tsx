import { useEffect, useState } from "react";

// What the intro deck should show, before it is built.
//
// "Images — for Prada they have to be images of BAGS. This is an input that can be given."
//
// It was not an input: the deck took the most valuable pieces in whatever the crawler had
// reached, which for a house with a broad catalogue is a slide of sunglasses in a meeting
// about handbags. Two inputs now, and they do different jobs:
//
//   categories   which part of the catalogue the product slots draw from. Defaults to the
//                brand record's product focus, so a house whose record already says bags
//                does not have to be told twice.
//   a photograph an exact picture for one slide, which is the only answer for the slots
//                nothing can derive — a boutique with the sign above the door is not in a
//                product feed and is not on a homepage in any form this could recognise.
//
// Both are per build, not saved: the categories default from the record, and if a house
// should permanently be "bags", the place to say so is the record's product focus.

export type Brief = {
  categories?: string[];
  images?: { slide: number; url: string }[];
};

/** The slots the template cannot fill on its own, and what each is asking for. */
const ASKS: { slide: number; label: string; hint: string }[] = [
  { slide: 2, label: "Slide 2 — brand ambassador", hint: "A campaign portrait. Falls back to the homepage shot on the brand record." },
  { slide: 4, label: "Slide 4 — boutique", hint: "A store front with the brand's sign legible. Nothing can derive this one." },
  { slide: 9, label: "Slide 9 — people wearing the pieces", hint: "Campaign photography, people in the product." },
  { slide: 10, label: "Slide 10 — brand ambassador", hint: "A second campaign portrait, or leave it to the catalogue pieces." },
];

export default function DeckBrief({ focus, value, onChange }: {
  /** brands.product_focus — the default answer to "which categories". */
  focus: string | null;
  value: Brief;
  onChange: (b: Brief) => void;
}) {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState(value.categories?.join(", ") ?? "");
  const [urls, setUrls] = useState<Record<number, string>>(() =>
    Object.fromEntries((value.images ?? []).map((i) => [i.slide, i.url])));

  // The record is read after this mounts, so the default arrives late. Only fill an untouched
  // field — retyping over somebody mid-edit is worse than a blank box.
  useEffect(() => {
    setCategories((c) => (c === "" && focus ? focus : c));
  }, [focus]);

  const push = (cats: string, imgs: Record<number, string>) => {
    onChange({
      categories: cats.split(",").map((c) => c.trim()).filter(Boolean),
      images: Object.entries(imgs)
        .filter(([, u]) => u.trim())
        .map(([slide, url]) => ({ slide: Number(slide), url: url.trim() })),
    });
  };

  const given = Object.values(urls).filter((u) => u.trim()).length;

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-sm font-medium">What the deck should show</span>
        <span className="text-xs text-muted-foreground">
          {categories.trim() ? categories.trim() : "whole catalogue"}
          {given ? ` · ${given} photograph${given === 1 ? "" : "s"} supplied` : ""}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border p-3">
          <div>
            <label className="text-xs font-medium text-foreground" htmlFor="deck-brief-categories">
              Categories for the product slides
            </label>
            <input
              id="deck-brief-categories"
              value={categories}
              onChange={(e) => { setCategories(e.target.value); push(e.target.value, urls); }}
              placeholder="Bags and leather goods"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Comma separated. Defaults to the brand record's product focus. If the catalogue
              holds too few pieces in these categories the deck falls back to the whole of it
              and says so in the notes, rather than repeating two photographs six times.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">A photograph for one slide</p>
            {ASKS.map((a) => (
              <div key={a.slide}>
                <input
                  value={urls[a.slide] ?? ""}
                  onChange={(e) => {
                    const next = { ...urls, [a.slide]: e.target.value };
                    setUrls(next); push(categories, next);
                  }}
                  placeholder={a.label}
                  aria-label={a.label}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                />
                <p className="mt-0.5 text-xs text-muted-foreground/80">{a.hint}</p>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Paste a URL the deck builder can reach. PNG or JPEG — a WebP works in current
              PowerPoint, and an AVIF is refused rather than embedded as a broken picture.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
