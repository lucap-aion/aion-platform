import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useState } from "react";
import {
  ArrowLeft, Shield, AlertTriangle, Clock, CheckCircle2, Store,
  Download, Hash, Package, Calendar, Share2, Copy, X, Eye, Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuthSlug } from "@/hooks/useAuthSlug";

const claimStatusConfig = {
  open: { icon: Clock, className: "bg-orange-50 text-orange-700" },
  closed: { icon: CheckCircle2, className: "bg-emerald-50 text-emerald-700" },
} as const;

const fmt = (d: string | null, locale: "en" | "it") =>
  d ? format(new Date(d), locale === "it" ? "dd MMM yyyy" : "MMM dd, yyyy") : "—";

const fmtLong = (d: string | null, locale: "en" | "it") =>
  d ? new Date(d).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", {
    day: "numeric", month: "long", year: "numeric",
  }) : "—";

// Short, human-readable certificate ID derived from the policy id. Stable —
// the same cover always renders the same code on the certificate PDF.
const certCode = (id: number | string) => `AION-${String(id).padStart(6, "0")}`;

const CustomerCoverDetail = () => {
  const { coverId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const tenant = useTenant();
  const { t, locale } = useLanguage();
  const slugPrefix = useAuthSlug();
  const queryClient = useQueryClient();
  const [shareOpen, setShareOpen] = useState(false);
  const [creatingToken, setCreatingToken] = useState(false);

  // Share tokens for THIS cover. Loaded when the modal opens; React Query
  // caches it across opens.
  const { data: shareTokens } = useQuery({
    queryKey: ["cover-share-tokens", coverId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cover_share_tokens")
        .select("token, created_at, view_count, last_viewed_at, revoked")
        .eq("cover_id", Number(coverId))
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: shareOpen && !!coverId,
    staleTime: 60 * 1000,
  });

  const createShareLink = async () => {
    if (!coverId || !profile?.id) return;
    setCreatingToken(true);
    const { error } = await supabase
      .from("cover_share_tokens")
      .insert({
        cover_id: Number(coverId),
        created_by: profile.id,
      });
    setCreatingToken(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["cover-share-tokens", coverId] });
    toast.success(t("coverShare.linkCreated"));
  };

  const revokeShareLink = async (token: string) => {
    const { error } = await supabase
      .from("cover_share_tokens")
      .update({ revoked: true })
      .eq("token", token);
    if (error) {
      toast.error(error.message);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["cover-share-tokens", coverId] });
  };

  const shareUrl = (token: string) => `${window.location.origin}/share/cover/${token}`;

  const copyShareLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      toast.success(t("coverShare.copied"));
    } catch {
      toast.error(t("coverShare.copyFailed"));
    }
  };

  const { data: cover, isLoading } = useQuery({
    queryKey: ["customer-cover-detail", coverId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policies")
        .select(`
          id, start_date, expiration_date, status, selling_price, recommended_retail_price, created_at,
          catalogues!insured_items_item_id_fkey ( id, name, picture, category, collection, sku, composition ),
          brands!policies_brand_id_fkey ( name, logo_small, logo_big ),
          shops!insured_items_shop_id_fkey ( name, city, country ),
          claims ( id, type, status, created_at )
        `)
        .eq("id", Number(coverId))
        .eq("customer_id", profile!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!coverId && !!profile?.id,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
        <div className="mb-8 h-8 w-32 rounded-lg bg-muted animate-pulse" />
        <div className="rounded-3xl bg-muted/40 animate-pulse h-96 mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass-card p-6 space-y-3">
              <div className="h-5 w-40 rounded bg-muted animate-pulse" />
              <div className="h-4 w-full rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!cover) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
        <div className="glass-card p-6">
          <p className="text-sm text-muted-foreground">{t("coverDetail.notFound")}</p>
          <button
            type="button"
            onClick={() => navigate(`${slugPrefix}/covers`)}
            className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            {t("coverDetail.back")}
          </button>
        </div>
      </div>
    );
  }

  const catalogue = (cover as any).catalogues;
  const brand = (cover as any).brands;
  const shop = (cover as any).shops;
  const claims = ((cover as any).claims || []) as Array<{ id: number; type: string; status: string; created_at: string }>;
  const status = (cover.status || "live").toLowerCase();
  const productName = catalogue?.name || t("coverDetail.unknownProduct");
  const brandName = brand?.name || tenant.name || "";
  const code = certCode(cover.id);

  const customerName = `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() || profile?.email || "—";

  const handleDownloadCertificate = async () => {
    try {
      const { generateCoverCertificate } = await import("@/utils/coverCertificate");
      await generateCoverCertificate({
        certCode: code,
        customerName,
        productName,
        brandName,
        sku: catalogue?.sku ?? null,
        composition: catalogue?.composition ?? null,
        category: catalogue?.category ?? null,
        productPicture: catalogue?.picture ?? null,
        brandLogo: brand?.logo_big || brand?.logo_small || tenant.logoUrl || null,
        startDate: cover.start_date ?? null,
        expirationDate: cover.expiration_date ?? null,
        sellingPrice: cover.selling_price ?? null,
        shopName: shop?.name ?? null,
        shopCity: shop?.city ?? null,
        locale,
        labels: {
          title: t("certificate.title"),
          subtitle: t("certificate.subtitle"),
          certId: t("certificate.certId"),
          issuedTo: t("certificate.issuedTo"),
          piece: t("certificate.piece"),
          sku: t("certificate.sku"),
          composition: t("certificate.composition"),
          category: t("certificate.category"),
          coverPeriod: t("certificate.coverPeriod"),
          protectedValue: t("certificate.protectedValue"),
          registeredAt: t("certificate.registeredAt"),
          footer: t("certificate.footer"),
        },
      });
      toast.success(t("coverDetail.certificateDownloaded"));
    } catch (e: any) {
      console.error("[certificate]", e);
      toast.error(e?.message ?? t("coverDetail.certificateFailed"));
    }
  };

  const statusTone =
    status === "live" ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30"
    : status === "cancelled" ? "bg-rose-500/15 text-rose-700 border-rose-500/30"
    : status === "pending" ? "bg-amber-500/15 text-amber-700 border-amber-500/30"
    : "bg-muted text-muted-foreground border-border";

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <Link
        to={`${slugPrefix}/covers`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> {t("coverDetail.back")}
      </Link>

      {/* Passport hero — full-bleed product photo with brand mark + status. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-card via-card to-primary/5 mb-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="relative aspect-square md:aspect-auto bg-white">
            {catalogue?.picture ? (
              <img
                src={catalogue.picture}
                alt={productName}
                className="absolute inset-0 h-full w-full object-contain p-8 mix-blend-multiply"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Package className="h-16 w-16 text-muted-foreground/30" />
              </div>
            )}
          </div>
          <div className="p-6 md:p-10 flex flex-col justify-between gap-6">
            <div>
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${statusTone}`}>
                  <Shield className="h-3 w-3" />
                  {t(`coverDetail.status.${status}`)}
                </span>
                <span className="font-mono text-[10px] tracking-widest text-muted-foreground">{code}</span>
              </div>

              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary mb-2">
                {brandName}
              </p>
              <h1 className="font-serif text-3xl md:text-4xl font-bold text-foreground leading-tight">
                {productName}
              </h1>

              {catalogue?.collection && (
                <p className="mt-2 text-sm text-muted-foreground italic">
                  {catalogue.collection}
                </p>
              )}
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="uppercase tracking-wider text-muted-foreground/80">{t("coverDetail.kpi.startDate")}</p>
                  <p className="mt-0.5 font-medium text-foreground tabular-nums">{fmt(cover.start_date, locale)}</p>
                </div>
                <div>
                  <p className="uppercase tracking-wider text-muted-foreground/80">{t("coverDetail.kpi.expiration")}</p>
                  <p className="mt-0.5 font-medium text-foreground tabular-nums">{fmt(cover.expiration_date, locale)}</p>
                </div>
                <div>
                  <p className="uppercase tracking-wider text-muted-foreground/80">{t("coverDetail.kpi.protectedValue")}</p>
                  <p className="mt-0.5 font-medium text-foreground tabular-nums">
                    €{(cover.selling_price || 0).toLocaleString(locale === "it" ? "it-IT" : "en-GB")}
                  </p>
                </div>
                {shop?.name && (
                  <div>
                    <p className="uppercase tracking-wider text-muted-foreground/80">{t("coverDetail.kpi.registeredAt")}</p>
                    <p className="mt-0.5 font-medium text-foreground flex items-center gap-1">
                      <Store className="h-3 w-3" /> {shop.name}
                    </p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void handleDownloadCertificate()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-foreground px-4 py-3 text-sm font-medium text-background transition-all hover:bg-foreground/90"
                >
                  <Download className="h-4 w-4" />
                  {t("coverDetail.downloadCertificate")}
                </button>
                <button
                  type="button"
                  onClick={() => setShareOpen(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-foreground/20 bg-background px-4 py-3 text-sm font-medium text-foreground transition-all hover:bg-foreground/5"
                >
                  <Share2 className="h-4 w-4" />
                  {t("coverShare.share")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Details + claim history grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Provenance card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:col-span-2"
        >
          <div className="glass-card p-6">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2 mb-4">
              <Hash className="h-4 w-4 text-primary" /> {t("coverDetail.provenance")}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {catalogue?.sku && (
                <Row label={t("coverDetail.row.sku")} value={catalogue.sku} mono />
              )}
              {catalogue?.category && (
                <Row label={t("coverDetail.row.category")} value={prettyCategory(catalogue.category)} />
              )}
              {catalogue?.composition && (
                <Row label={t("coverDetail.row.composition")} value={catalogue.composition} className="sm:col-span-2" />
              )}
              {shop?.name && (
                <Row label={t("coverDetail.row.boutique")} value={[shop.name, shop.city, shop.country].filter(Boolean).join(", ")} className="sm:col-span-2" />
              )}
              <Row label={t("coverDetail.row.registered")} value={fmtLong(cover.created_at, locale)} />
            </div>
          </div>
        </motion.div>

        {/* Certificate / brand mark */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <div className="glass-card p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-3">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {t("coverDetail.certifiedBy")}
            </p>
            {brand?.logo_big || brand?.logo_small ? (
              <img
                src={brand.logo_big || brand.logo_small}
                alt={brandName}
                className="mx-auto mt-3 h-10 max-w-[160px] object-contain"
              />
            ) : (
              <p className="mt-3 font-serif text-lg font-semibold text-foreground">{brandName}</p>
            )}
            <p className="mt-4 font-mono text-[10px] tracking-widest text-muted-foreground">
              {code}
            </p>
          </div>
        </motion.div>

        {/* Claim history */}
        {claims.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="lg:col-span-3"
          >
            <div className="glass-card overflow-hidden">
              <div className="px-6 py-4 border-b border-border/50 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                <h2 className="text-base font-semibold text-foreground">
                  {t("coverDetail.claimHistory")} ({claims.length})
                </h2>
              </div>
              <div className="divide-y divide-border">
                {claims.map((claim) => {
                  const st = claim.status === "closed" ? "closed" : "open";
                  const cfg = claimStatusConfig[st];
                  return (
                    <Link
                      key={claim.id}
                      to={`${slugPrefix}/claims/${claim.id}/view`}
                      className="flex items-center justify-between px-6 py-3.5 transition-colors hover:bg-muted"
                    >
                      <div className="flex items-center gap-3">
                        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            #{claim.id} — {claim.type || t("coverDetail.claimGeneral")}
                          </p>
                          <p className="text-xs text-muted-foreground">{fmt(claim.created_at, locale)}</p>
                        </div>
                      </div>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}>
                        <cfg.icon className="h-3 w-3" />
                        {t(`coverDetail.claimStatus.${st}`)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Share modal */}
      {shareOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
          onClick={() => setShareOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card w-full sm:max-w-md max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4 text-primary" />
                <h2 className="font-serif text-lg font-semibold text-foreground">{t("coverShare.title")}</h2>
              </div>
              <button
                type="button"
                onClick={() => setShareOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <p className="text-xs text-muted-foreground">{t("coverShare.intro")}</p>

              <button
                type="button"
                onClick={() => void createShareLink()}
                disabled={creatingToken}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {creatingToken ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                {t("coverShare.createNew")}
              </button>

              {shareTokens && shareTokens.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {t("coverShare.existing")}
                  </p>
                  <ul className="space-y-2">
                    {shareTokens.map((tk: any) => {
                      const revoked = tk.revoked;
                      return (
                        <li
                          key={tk.token}
                          className={`rounded-xl border p-3 ${revoked ? "border-border bg-muted/30 opacity-60" : "border-border bg-card"}`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <Eye className="h-3 w-3" /> {tk.view_count} {t("coverShare.views")}
                            </div>
                            <span className="text-[10px] text-muted-foreground tabular-nums">
                              {new Date(tk.created_at).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", {
                                day: "2-digit", month: "short", year: "numeric",
                              })}
                            </span>
                          </div>
                          <p className="text-[11px] font-mono break-all text-foreground/80 mb-2 line-clamp-1">
                            {shareUrl(tk.token)}
                          </p>
                          {!revoked ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void copyShareLink(tk.token)}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-foreground hover:bg-muted"
                              >
                                <Copy className="h-3 w-3" /> {t("coverShare.copy")}
                              </button>
                              <button
                                type="button"
                                onClick={() => void revokeShareLink(tk.token)}
                                className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10"
                              >
                                {t("coverShare.revoke")}
                              </button>
                            </div>
                          ) : (
                            <p className="text-[11px] text-muted-foreground">{t("coverShare.revoked")}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
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
    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className={`mt-0.5 font-medium text-foreground ${mono ? "font-mono text-xs tracking-wide" : ""}`}>
      {value}
    </p>
  </div>
);

const prettyCategory = (raw: string) =>
  raw
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

export default CustomerCoverDetail;
