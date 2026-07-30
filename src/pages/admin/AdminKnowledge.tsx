import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import BrandKnowledge from "@/pages/brand/BrandKnowledge";

// Knowledge base, admin side.
//
// The brand portal has had this page for a while; the admin portal had none, so
// AION staff could not add or fix a brand's knowledge without logging in as the
// brand. It is the same page — an admin simply picks whose knowledge they are
// working on, since an admin profile carries no brand of its own.

type Brand = { id: number; name: string | null };

export default function AdminKnowledge() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState<number | null>(() => {
    const saved = Number(localStorage.getItem("admin.knowledge.brandId") ?? 0);
    return saved || null;
  });

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("brands").select("id, name").order("name");
      const list = (data ?? []) as Brand[];
      setBrands(list);
      setBrandId((cur) => cur ?? list[0]?.id ?? null);
    })();
  }, []);

  useEffect(() => {
    if (brandId) localStorage.setItem("admin.knowledge.brandId", String(brandId));
  }, [brandId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted-foreground">Brand</label>
        <select
          value={brandId ?? ""}
          onChange={(e) => setBrandId(Number(e.target.value) || null)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name ?? `Brand ${b.id}`}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          Uploads and edits here belong to the selected brand and feed its assistant.
        </span>
      </div>

      {brandId
        ? <BrandKnowledge key={brandId} brandIdOverride={brandId} canWriteOverride />
        : <p className="text-sm text-muted-foreground">Select a brand to manage its knowledge base.</p>}
    </div>
  );
}
