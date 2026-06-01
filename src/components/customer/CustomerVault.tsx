import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles, Shield } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuthSlug } from "@/hooks/useAuthSlug";

const fmtEur = (n: number, locale: "en" | "it") =>
  new Intl.NumberFormat(locale === "it" ? "it-IT" : "en-GB", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);

const monthYear = (iso: string | null, locale: "en" | "it") => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", {
    month: "long",
    year: "numeric",
  });
};

// The Vault hero: replaces the marketing banner at the top of the customer
// dashboard with a personal collection view. Hero number on top, gallery
// strip underneath, soft soft details below. Same data the customer already
// has in /covers, just framed as a collection rather than a list.

type VaultSummary = {
  live_count: number;
  all_count: number;
  protected_value: number | string;
  earliest_start: string | null;
  categories: string[];
  gallery: Array<{ id: number; status: string | null; picture: string | null; name: string | null }>;
};

const GALLERY_LIMIT = 6;

const CustomerVault = () => {
  const { profile } = useAuth();
  const tenant = useTenant();
  const { t, locale } = useLanguage();
  const slugPrefix = useAuthSlug();

  // Lightweight server-side aggregate (customer_vault_summary RPC). Returns
  // the four hero numbers and a 6-thumbnail gallery in a single round trip
  // instead of pulling every policy + its joins. Scales fine for collectors
  // with hundreds of pieces.
  const { data: summary, isLoading } = useQuery({
    queryKey: ["customer-vault-summary", profile?.id, GALLERY_LIMIT],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("customer_vault_summary", { p_gallery_limit: GALLERY_LIMIT });
      if (error) throw error;
      return (data ?? {
        live_count: 0,
        all_count: 0,
        protected_value: 0,
        earliest_start: null,
        categories: [],
        gallery: [],
      }) as VaultSummary;
    },
    enabled: !!profile?.id,
    staleTime: 5 * 60 * 1000,
  });

  const stats = {
    liveCount: summary?.live_count ?? 0,
    allCount: summary?.all_count ?? 0,
    protectedValue: Number(summary?.protected_value ?? 0),
    categories: summary?.categories ?? [],
    earliestStart: summary?.earliest_start ?? null,
    gallery: summary?.gallery ?? [],
  };

  if (isLoading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-2xl border border-border bg-card p-6 md:p-8"
      >
        <div className="h-3 w-24 rounded bg-muted animate-pulse mb-4" />
        <div className="h-12 w-48 rounded bg-muted animate-pulse mb-2" />
        <div className="h-4 w-64 rounded bg-muted animate-pulse mb-6" />
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="aspect-square rounded-xl bg-muted/60 animate-pulse" />
          ))}
        </div>
      </motion.div>
    );
  }

  // Empty state — customer has no covers yet. Still hero-worthy: invites them
  // to register their first piece without feeling like a 404.
  if (stats.allCount === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border bg-card p-8 text-center"
      >
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <h2 className="font-serif text-2xl font-bold text-foreground mb-2">
          {t("vault.empty.title")}
        </h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          {t("vault.empty.subtitle").replace("{brand}", tenant.name)}
        </p>
      </motion.div>
    );
  }

  // Gallery already pre-sorted (live first, newest first) and capped by the
  // RPC, so no client-side trimming is needed.
  const gallery = stats.gallery;

  const memberSince = monthYear(stats.earliestStart ?? null, locale);
  const firstName = profile?.first_name?.trim() || "";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-primary/5"
    >
      <div className="absolute inset-0 pointer-events-none opacity-[0.04]" aria-hidden>
        <div
          className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-primary blur-3xl"
        />
      </div>

      <div className="relative p-6 md:p-10">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="h-4 w-4 text-primary" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            {t("vault.label")}
          </p>
        </div>

        <h1 className="font-serif text-3xl md:text-5xl font-bold text-foreground leading-tight">
          {firstName ? t("vault.greeting").replace("{name}", firstName) : t("vault.title")}
        </h1>

        {/* Headline number — the most important pixel on this page. */}
        <div className="mt-5 mb-7">
          <p className="font-serif text-4xl md:text-6xl font-bold text-foreground tabular-nums tracking-tight">
            {fmtEur(stats.protectedValue, locale)}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {t("vault.protectedAcross").replace("{n}", String(stats.liveCount))}
          </p>
        </div>

        {/* Gallery strip */}
        {gallery.length > 0 && (
          <div className="mb-6">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
              {gallery.map((p) => {
                const pic = p.picture;
                const name = p.name ?? "";
                const isLive = p.status === "live";
                return (
                  <Link
                    key={p.id}
                    to={`${slugPrefix}/covers/${p.id}/view`}
                    className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-white transition-all hover:border-primary/40 hover:shadow-sm"
                    title={name}
                  >
                    {pic ? (
                      <img
                        src={pic}
                        alt={name}
                        loading="lazy"
                        className={`h-full w-full object-contain p-2 mix-blend-multiply transition-transform group-hover:scale-105 ${isLive ? "" : "opacity-40 grayscale"}`}
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <Shield className="h-6 w-6 text-muted-foreground/40" />
                      </div>
                    )}
                    {!isLive && (
                      <span className="absolute bottom-1 left-1 right-1 text-center text-[9px] font-medium uppercase tracking-wide text-muted-foreground bg-card/90 rounded py-0.5">
                        {p.status ?? "—"}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Soft details + CTA */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pt-2 border-t border-border/50">
          <div className="space-y-1.5 text-sm">
            {stats.categories.length > 0 && (
              <p className="text-muted-foreground">
                <span className="text-foreground font-medium">
                  {stats.categories.slice(0, 4).map(prettyCategory).join(" · ")}
                </span>
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {t("vault.memberSince").replace("{date}", memberSince)}
            </p>
          </div>

          <Link
            to={`${slugPrefix}/covers`}
            className="group inline-flex items-center gap-2 self-start rounded-xl bg-foreground px-5 py-3 text-sm font-medium text-background transition-all hover:bg-foreground/90"
          >
            {t("vault.viewAll")}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </motion.div>
  );
};

// Normalise category text so "BRACELET" / "bracelets" both render as
// "Bracelets". Doesn't try to pluralise non-English text.
const prettyCategory = (raw: string) => {
  const v = raw.trim();
  if (!v) return v;
  const lower = v.toLowerCase();
  const cap = lower.charAt(0).toUpperCase() + lower.slice(1);
  // crude singular→plural for common English jewelry categories; passes
  // already-plural and non-English through unchanged.
  if (/^(ring|bracelet|necklace|earring|pendant|charm|tiara)$/i.test(v)) {
    return cap + "s";
  }
  return cap;
};

export default CustomerVault;
