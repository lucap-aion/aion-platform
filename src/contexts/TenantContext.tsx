import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import logoAion from "@/assets/logo-aion.png";
import logoIconAion from "@/assets/logo-icon-aion.png";
import heroBg from "@/assets/hero-jewelry.jpg";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

export interface TenantConfig {
  // Identity
  id: number | null;
  slug: string;
  name: string;
  tagline: string;
  email: string | null;
  website: string | null;
  // Branding
  logoUrl: string;
  logoIconUrl: string;
  logoInitial: string;
  authBackgroundUrl: string;
  topBannerImage: string | null;
  primaryHsl: string;
  // Content images
  faqImage: string | null;
  feedbackImage: string | null;
  damageImage: string | null;
  theftImage: string | null;
  // FAQs
  faqEn: Json | null;
  faqIt: Json | null;
  // HQ address
  hqAddress: string | null;
  hqCity: string | null;
  hqCountry: string | null;
  hqPostcode: string | null;
  // Pricing
  activationFee: number | null;
  insurancePremium: number | null;
  aionPremiumFee: number | null;
}

const DEFAULT_TENANT: TenantConfig = {
  id: null,
  slug: "default",
  name: "AION Cover",
  tagline: "Global Protection for Luxury Products",
  email: null,
  website: null,
  logoUrl: "/aion_dark_logo.png",
  logoIconUrl: "/aion_dark_icon.png",
  logoInitial: "A",
  authBackgroundUrl: heroBg,
  topBannerImage: null,
  primaryHsl: "38 55% 55%",
  faqImage: null,
  feedbackImage: null,
  damageImage: null,
  theftImage: null,
  faqEn: null,
  faqIt: null,
  hqAddress: null,
  hqCity: null,
  hqCountry: null,
  hqPostcode: null,
  activationFee: null,
  insurancePremium: null,
  aionPremiumFee: null,
};

const getPrimaryHslFromTheme = (theme: Database["public"]["Tables"]["brands"]["Row"]["theme_settings"] | undefined): string | null => {
  if (!theme || typeof theme !== "object") return null;
  const next = theme as { [key: string]: unknown };
  return typeof next.primary_hsl === "string" ? next.primary_hsl : null;
};

type BrandRow = Database["public"]["Tables"]["brands"]["Row"];

const BRAND_SELECT = "id, slug, name, description, email, website, logo_big, logo_small, auth_background_image, top_banner_image, theme_settings, faq_en, faq_it, faq_image, feedback_image, damage_image, theft_image, hq_address, hq_city, hq_country, hq_postcode, activation_fee, insurance_premium, aion_premium_fee" as const;

type BrandLookup = Pick<BrandRow,
  | "id" | "slug" | "name" | "description" | "email" | "website"
  | "logo_big" | "logo_small" | "auth_background_image" | "top_banner_image" | "theme_settings"
  | "faq_en" | "faq_it" | "faq_image" | "feedback_image" | "damage_image" | "theft_image"
  | "hq_address" | "hq_city" | "hq_country" | "hq_postcode"
  | "activation_fee" | "insurance_premium" | "aion_premium_fee"
>;

const mergeWithBrandData = (brand: BrandLookup): TenantConfig => ({
  ...DEFAULT_TENANT,
  id: brand.id,
  slug: brand.slug || DEFAULT_TENANT.slug,
  name: brand.name || DEFAULT_TENANT.name,
  tagline: brand.description || DEFAULT_TENANT.tagline,
  email: brand.email ?? null,
  website: brand.website ?? null,
  logoUrl: brand.logo_big || brand.logo_small || DEFAULT_TENANT.logoUrl,
  logoIconUrl: brand.logo_small || brand.logo_big || DEFAULT_TENANT.logoIconUrl,
  logoInitial: (brand.name?.[0] ?? "A").toUpperCase(),
  authBackgroundUrl: brand.auth_background_image || DEFAULT_TENANT.authBackgroundUrl,
  topBannerImage: brand.top_banner_image ?? null,
  primaryHsl: getPrimaryHslFromTheme(brand.theme_settings) || DEFAULT_TENANT.primaryHsl,
  faqEn: brand.faq_en ?? null,
  faqIt: brand.faq_it ?? null,
  faqImage: brand.faq_image ?? null,
  feedbackImage: brand.feedback_image ?? null,
  damageImage: brand.damage_image ?? null,
  theftImage: brand.theft_image ?? null,
  hqAddress: brand.hq_address ?? null,
  hqCity: brand.hq_city ?? null,
  hqCountry: brand.hq_country ?? null,
  hqPostcode: brand.hq_postcode ?? null,
  activationFee: brand.activation_fee ?? null,
  insurancePremium: brand.insurance_premium ?? null,
  aionPremiumFee: brand.aion_premium_fee ?? null,
});

const TENANT_SLUG_KEY = "aion_tenant_slug";

// Known app routes that are never tenant slugs
const KNOWN_ROUTES = new Set([
  "login", "signup", "forgot-password", "reset-password",
  "home", "covers", "claims", "profile", "brand", "settings", "admin",
]);

function getSlugFromPath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length > 0 && !KNOWN_ROUTES.has(segments[0])) {
    return segments[0];
  }
  return "";
}

const TenantContext = createContext<TenantConfig>(DEFAULT_TENANT);

interface TenantStatus { loading: boolean; notFound: boolean; }
const TenantStatusContext = createContext<TenantStatus>({ loading: true, notFound: false });
export const useTenantStatus = () => useContext(TenantStatusContext);

export const TenantProvider = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const [tenant, setTenant] = useState<TenantConfig>(DEFAULT_TENANT);
  const [status, setStatus] = useState<TenantStatus>({ loading: true, notFound: false });

  // Derive slug from URL; fall back to sessionStorage for slug-less app routes (e.g. /home)
  const slug = useMemo(() => {
    const fromPath = getSlugFromPath(location.pathname);
    if (fromPath) {
      sessionStorage.setItem(TENANT_SLUG_KEY, fromPath);
      return fromPath;
    }
    return sessionStorage.getItem(TENANT_SLUG_KEY) ?? "";
  }, [location.pathname]);

  // Apply brand primary color as CSS variable whenever tenant changes
  useEffect(() => {
    document.documentElement.style.setProperty("--primary", tenant.primaryHsl);
    document.documentElement.style.setProperty("--sidebar-primary", tenant.primaryHsl);
  }, [tenant.primaryHsl]);

  // Always fetch fresh from DB — no static cache
  useEffect(() => {
    if (!slug || slug === "default") {
      setTenant(DEFAULT_TENANT);
      setStatus({ loading: false, notFound: false });
      return;
    }

    setStatus({ loading: true, notFound: false });

    const fetchBrand = async () => {
      const { data: brand, error } = await supabase
        .from("brands")
        .select(BRAND_SELECT)
        .eq("slug", slug)
        .maybeSingle();

      if (!error && brand) {
        setTenant(mergeWithBrandData(brand));
        setStatus({ loading: false, notFound: false });
        return;
      }

      // Slug not found in DB — it's an invalid brand slug
      setTenant(DEFAULT_TENANT);
      setStatus({ loading: false, notFound: true });
    };

    void fetchBrand();
  }, [slug]);

  return (
    <TenantStatusContext.Provider value={status}>
      <TenantContext.Provider value={tenant}>{children}</TenantContext.Provider>
    </TenantStatusContext.Provider>
  );
};

export const useTenant = () => useContext(TenantContext);
