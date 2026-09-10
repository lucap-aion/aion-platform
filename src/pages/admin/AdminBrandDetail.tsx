import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import BrandRecordForm, { type Brand } from "./_components/BrandRecordForm";
import CommercialCycle from "./_components/CommercialCycle";
import BrandDocuments from "./_components/BrandDocuments";
import { StatusBadge } from "./_components/AdminTable";

// Everything about one brand, in one place.
//
// A brand used to be spread across three destinations: a row in a table, a
// drawer over that table for its record, and a separate Commercial Cycle screen
// with its own brand picker. They depend on each other constantly — the deck
// needs the logo, the data request needs the HQ address, the demo needs the
// website — so the common move was editing a field in one place and going back
// to another to see whether it had fixed anything.
//
// Tabs rather than one long page: the record is a big form and the cycle is a
// long accordion, and stacking them would mean scrolling past forty fields to
// reach step 1. The tab is in the URL, so /admin/brands/18?tab=cycle is a link
// you can send someone.

type Tab = "record" | "cycle" | "documents";

const TABS: { key: Tab; label: string }[] = [
  { key: "record", label: "Record" },
  { key: "cycle", label: "Commercial cycle" },
  { key: "documents", label: "Documents" },
];

export default function AdminBrandDetail() {
  const { brandId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isNew = brandId === "new";
  const id = isNew ? null : Number(brandId);

  const [brand, setBrand] = useState<Brand | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(!isNew);

  const asked = params.get("tab") as Tab | null;
  // A brand being created has no cycle and no documents yet, so there is only
  // one tab to be on.
  const tab: Tab = isNew ? "record" : (TABS.some((t) => t.key === asked) ? asked! : "record");

  const load = useCallback(async () => {
    if (id == null) return;
    const [one, all] = await Promise.all([
      supabase.from("brands").select("id, name, slug, website, logo_small, logo_big, status").eq("id", id).maybeSingle(),
      // BusinessCasePanel needs the list to attribute an insurer quote to a house.
      supabase.from("brands").select("id, name").order("name"),
    ]);
    setBrand((one.data ?? null) as Brand | null);
    setBrands((all.data ?? []) as Brand[]);
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Keeps ?step, so leaving the cycle to check a field on the record and coming
  // back lands you on the step you were reading.
  const setTab = (t: Tab) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (t === "record") next.delete("tab"); else next.set("tab", t);
    return next;
  }, { replace: true });

  if (isNew) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <Link to="/admin/brands" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Brands
        </Link>
        <h1 className="font-serif text-2xl font-bold text-foreground">New brand</h1>
        <BrandRecordForm
          initialMode="add"
          embedded
          onSaved={() => navigate("/admin/brands")}
          onClose={() => navigate("/admin/brands")}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <Skeleton className="h-4 w-24" />
        <div className="flex items-center gap-4">
          <Skeleton className="h-12 w-12 rounded" />
          <div className="space-y-2"><Skeleton className="h-7 w-56" /><Skeleton className="h-3.5 w-40" /></div>
        </div>
        <Skeleton className="h-9 w-80 rounded-lg" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!brand) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <Link to="/admin/brands" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Brands
        </Link>
        <p className="text-sm text-muted-foreground">No brand with id {brandId}.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <Link to="/admin/brands" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Brands
      </Link>

      <div className="flex flex-wrap items-center gap-4">
        {brand.logo_small ? (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-white p-1.5">
            <img src={brand.logo_small} alt="" className="h-full w-full object-contain" />
          </div>
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted text-lg font-semibold">
            {(brand.name?.[0] ?? "?").toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="font-serif text-2xl font-bold text-foreground">{brand.name ?? `Brand ${brand.id}`}</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {brand.slug && <span>{brand.slug}</span>}
            {brand.website && (
              <a href={brand.website.startsWith("http") ? brand.website : `https://${brand.website}`}
                target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                {brand.website} <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
        {brand.status && <div className="ml-auto"><StatusBadge status={brand.status} /></div>}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === t.key
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Each tab is mounted only while it is the one being looked at. The cycle
          alone makes an RPC call, a function call and a handful of table reads;
          mounting all three would fire every one of them to render one. */}
      {tab === "record" && (
        <BrandRecordForm brandId={brand.id} embedded onSaved={() => void load()} />
      )}
      {tab === "cycle" && <CommercialCycle brand={brand} brands={brands} />}
      {tab === "documents" && (
        <BrandDocuments brandId={brand.id} brandName={brand.name ?? "the brand"} />
      )}
    </div>
  );
}

