// PublicCoverShare — anyone with a valid cover_share_tokens uuid can view a
// read-only Passport of that cover (piece + brand + cover period + certificate
// code). Calls the public_cover_share RPC (SECURITY DEFINER, anon-allowed).
// No claim history or contact info is exposed.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Shield, Package, Hash, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Payload = {
  cover_id: number;
  cert_code: string;
  start_date: string | null;
  expiration_date: string | null;
  status: string | null;
  selling_price: number | null;
  customer_first_name: string | null;
  product: {
    name: string | null;
    picture: string | null;
    category: string | null;
    collection: string | null;
    composition: string | null;
    sku: string | null;
  } | null;
  brand: {
    name: string | null;
    logo_big: string | null;
    logo_small: string | null;
    slug: string | null;
  } | null;
  shop: { name: string | null; city: string | null; country: string | null } | null;
  error?: string;
};

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
};

const PublicCoverShare = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .rpc("public_cover_share", { p_token: token });
      setLoading(false);
      if (error) {
        setErr(error.message);
        return;
      }
      const payload = (data ?? {}) as Payload;
      if (payload.error) {
        setErr(payload.error);
        return;
      }
      setData(payload);
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 via-white to-amber-50 p-6">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (err || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 via-white to-amber-50 p-6">
        <div className="max-w-md w-full rounded-2xl border border-border bg-white p-8 text-center shadow-sm">
          <AlertCircle className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <h1 className="font-serif text-xl font-bold text-foreground mb-1">
            Link unavailable
          </h1>
          <p className="text-sm text-muted-foreground">
            {err === "invalid or revoked token"
              ? "This share link has been revoked or has expired."
              : "We couldn't load this cover."}
          </p>
        </div>
      </div>
    );
  }

  const cert = data.cert_code;
  const product = data.product;
  const brand = data.brand;
  const isLive = (data.status ?? "").toLowerCase() === "live";

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-amber-50 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="overflow-hidden rounded-3xl border border-amber-200 bg-white shadow-xl"
        >
          {/* Header strip */}
          <div className="px-6 py-4 border-b border-amber-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-amber-600" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                Certificate of Coverage
              </span>
            </div>
            <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
              {cert}
            </span>
          </div>

          {/* Brand logo */}
          <div className="px-6 pt-6 pb-2 flex items-center justify-center">
            {brand?.logo_big || brand?.logo_small ? (
              <img
                src={brand.logo_big || brand.logo_small || ""}
                alt={brand.name ?? ""}
                className="h-10 max-w-[180px] object-contain"
              />
            ) : (
              <p className="font-serif text-xl font-bold text-foreground">{brand?.name ?? ""}</p>
            )}
          </div>

          {/* Product photo */}
          <div className="relative aspect-square sm:aspect-[4/3] bg-white">
            {product?.picture ? (
              <img
                src={product.picture}
                alt={product.name ?? ""}
                className="absolute inset-0 h-full w-full object-contain p-8 mix-blend-multiply"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Package className="h-16 w-16 text-muted-foreground/30" />
              </div>
            )}
          </div>

          {/* Title + dates */}
          <div className="px-6 py-5 text-center border-t border-amber-100">
            {data.customer_first_name && (
              <p className="text-[10px] uppercase tracking-[0.18em] text-amber-700 mb-1">
                Registered to {data.customer_first_name}
              </p>
            )}
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">
              {product?.name ?? "—"}
            </h1>
            {product?.collection && (
              <p className="mt-1 text-sm italic text-muted-foreground">{product.collection}</p>
            )}

            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-amber-200 px-3 py-1 text-xs text-foreground">
              <span className={`inline-block h-2 w-2 rounded-full ${isLive ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />
              {(data.status ?? "").toUpperCase()} · {fmtDate(data.start_date)} → {fmtDate(data.expiration_date)}
            </div>
          </div>

          {/* Details grid */}
          <div className="px-6 pb-6 grid grid-cols-2 gap-4 text-xs">
            {product?.sku && <Row label="SKU" value={product.sku} mono />}
            {product?.category && <Row label="Category" value={product.category} />}
            {product?.composition && <Row label="Composition" value={product.composition} className="col-span-2" />}
            {data.shop?.name && (
              <Row
                label="Registered at"
                value={[data.shop.name, data.shop.city, data.shop.country].filter(Boolean).join(", ")}
                className="col-span-2"
              />
            )}
          </div>

          <div className="px-6 py-4 border-t border-amber-100 flex items-center justify-between gap-2">
            <Hash className="h-3 w-3 text-muted-foreground" />
            <p className="text-[10px] text-muted-foreground">
              Verified by AION · this credential confirms registration but is not legal proof of ownership.
            </p>
          </div>
        </motion.div>

        <p className="mt-4 text-center text-[10px] text-muted-foreground">
          Powered by AION · the link can be revoked by the owner at any time
        </p>
      </div>
    </div>
  );
};

const Row = ({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) => (
  <div className={className}>
    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className={`mt-0.5 text-sm font-medium text-foreground ${mono ? "font-mono text-xs" : ""}`}>
      {value}
    </p>
  </div>
);

export default PublicCoverShare;
