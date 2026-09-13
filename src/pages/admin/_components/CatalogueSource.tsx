import { useCallback, useEffect, useState } from "react";
import { untyped } from "@/integrations/supabase/untyped";
import { toast } from "@/hooks/use-toast";
import { Loader2, Check, AlertCircle, Package } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

// Where a brand's catalogue comes from.
//
// The storefront stage detects Shopify by asking for /products.json on the site
// and its www/apex twin. When that fails it writes platform 'none' and moves on,
// which is the right call — but the row it writes was readable and not writable
// from anywhere, so a shop living on a subdomain (shop.brand.com), behind a
// redirect chain detection could not follow, or on a market-specific domain was
// simply a brand with no catalogue, permanently.
//
// That is not a small failure downstream: no catalogue means no images for the
// intro deck and no real pieces for the demo book, so steps 1 and 3 of the cycle
// both stall on a single text field.

type Source = {
  brand_id: number; base_url: string; platform: string; currency: string;
  keep_untyped: boolean; enabled: boolean; detected_at: string | null; last_synced_at: string | null;
};

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "never";

export default function CatalogueSource({ brandId, products, onSaved }: {
  brandId: number; products: number; onSaved?: () => void;
}) {
  const [row, setRow] = useState<Source | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [keepUntyped, setKeepUntyped] = useState(false);
  const [enabled, setEnabled] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await untyped.from("storefront_sources").select("*").eq("brand_id", brandId).maybeSingle();
    const r = (data ?? null) as Source | null;
    setRow(r);
    setBaseUrl(r?.base_url ?? "");
    setKeepUntyped(r?.keep_untyped ?? false);
    setEnabled(r?.enabled ?? true);
    setLoading(false);
  }, [brandId]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    // A feed URL has a path and often a query string, so only a trailing slash is trimmed
    // and a path is no longer a reason to refuse it.
    const url = baseUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/[^/\s]+/.test(url)) {
      toast({ title: "That is not a URL", description: "A shop origin like https://shop.brand.com, or a feed like https://brand.com/feeds/google.xml", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await untyped.from("storefront_sources").upsert({
      brand_id: brandId, base_url: url,
      // Setting a URL by hand is an assertion that there IS a catalogue there, so the
      // platform goes back to shopify — leaving it 'none' or 'blocked' would keep the sync
      // skipping the brand no matter what URL was entered. The Catalogue stage then decides
      // what it actually is: it tries the URL as a product feed first, and a feed that
      // reads sets the platform to 'feed'.
      platform: "shopify",
      keep_untyped: keepUntyped, enabled,
      currency: row?.currency ?? "EUR",
    } as never, { onConflict: "brand_id" });
    setSaving(false);
    if (error) { toast({ title: "Could not save", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Catalogue source saved", description: "Re-run the Catalogue stage above — it works out whether that URL is a shop or a product feed." });
    await load(); onSaved?.();
  };

  // "No catalogue source registered" is the alarming case, and it was what an
  // unloaded component looked like.
  if (loading) {
    return (
      <div className="space-y-3 rounded-lg border border-border p-3">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Catalogue source</p>
          <Skeleton className="h-3.5 w-40" />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Skeleton className="h-9 min-w-56 flex-1 rounded-md" />
          <Skeleton className="h-9 w-40 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-lg" />
        </div>
      </div>
    );
  }

  const dead = !row || row.platform === "none" || !row.enabled;
  const dirty = row ? (baseUrl.trim().replace(/\/+$/, "") !== row.base_url || keepUntyped !== row.keep_untyped || enabled !== row.enabled) : baseUrl.trim() !== "";

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Catalogue source</p>
        <span className="text-xs text-muted-foreground">
          {products} product{products === 1 ? "" : "s"} · last synced {when(row?.last_synced_at)}
        </span>
      </div>

      {dead && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>
            {row?.platform === "blocked"
              ? "This site answers a bot challenge rather than its catalogue. Ask the house for its product feed — the file it already publishes for Google Shopping — and paste the URL here."
              : row?.platform === "none"
              ? "No product feed was found on this site. Paste a shop origin, or the product feed the house publishes for Google Shopping — either works."
              : "No catalogue source registered. Without one there are no images for the intro deck and no real pieces for the demo book."}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          Shop origin or feed URL
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://shop.brand.com  ·  or  ·  https://brand.com/feeds/google.xml"
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={keepUntyped} onChange={(e) => setKeepUntyped(e.target.checked)} />
          Keep untyped products
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Sync enabled
        </label>
        <button onClick={() => void save()} disabled={saving || !dirty}
          className="mb-0.5 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs disabled:opacity-50">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Some shops leave the product type empty on real products; without "keep untyped" the sync
        discards them, which can silently throw away the whole catalogue.
      </p>
    </div>
  );
}
