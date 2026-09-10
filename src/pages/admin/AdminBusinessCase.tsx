import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight } from "lucide-react";
import BusinessCasePanel from "./_components/BusinessCasePanel";

// Step 4 on its own, for when the pricing conversation is the only thing you
// came here for. The screen itself lives in BusinessCasePanel and is the same
// component the commercial-cycle page embeds, so the two cannot drift.

type Brand = { id: number; name: string | null };

export default function AdminBusinessCase() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("brands").select("id, name").order("name");
      const list = (data ?? []) as Brand[];
      setBrands(list);
      setBrandId((cur) => cur ?? list[0]?.id ?? null);
    })();
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-bold text-foreground">Business case</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Price a programme from the perimeter the client declared. Figures are a model, not an offer —
            the formal insurer quotation governs.
          </p>
        </div>
        {brandId && (
          <Link to={`/admin/commercial?brand=${brandId}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm">
            The whole cycle for this brand <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      <label className="flex w-fit flex-col gap-1 text-xs text-muted-foreground">
        Brand
        <select value={brandId ?? ""} onChange={(e) => setBrandId(Number(e.target.value) || null)}
          className="min-w-56 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name ?? `Brand ${b.id}`}</option>)}
        </select>
      </label>

      <BusinessCasePanel brandId={brandId} brands={brands} />
    </div>
  );
}
