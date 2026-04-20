import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import logoAion from "@/assets/logo-aion.png";
import logoIconAion from "@/assets/logo-icon-aion.png";
import heroBg from "@/assets/hero-jewelry.jpg";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

/** Customisable CSS colour slots stored in brands.theme_settings JSON.
 *  Only keys explicitly set by the brand are applied — everything else
 *  falls through to the defaults in index.css. */
export interface ThemeColors {
  primary_hsl?: string;
  secondary_hsl?: string;
  accent_hsl?: string;
  background_hsl?: string;
  foreground_hsl?: string;
  card_hsl?: string;
  border_hsl?: string;
  sidebar_background_hsl?: string;
  muted_hsl?: string;
  destructive_hsl?: string;
}

/** Theme keys that brands can override.
 *  Only primary_hsl is commonly used — the rest are advanced/optional.
 *  secondary/accent are excluded because the UI uses neutral bg-muted
 *  and legacy DB values often contain stale gold colours. */
const THEME_KEYS: (keyof ThemeColors)[] = [
  "primary_hsl", "background_hsl",
  "foreground_hsl", "card_hsl", "border_hsl", "sidebar_background_hsl",
  "muted_hsl", "destructive_hsl",
];

/** Map each theme key → CSS custom properties it controls (light mode) */
const LIGHT_CSS_MAP: Record<keyof ThemeColors, string[]> = {
  primary_hsl:            ["--primary", "--sidebar-primary", "--ring", "--sidebar-ring"],
  secondary_hsl:          ["--secondary"],
  accent_hsl:             ["--accent"],
  background_hsl:         ["--background"],
  foreground_hsl:         ["--foreground"],
  card_hsl:               ["--card", "--popover"],
  border_hsl:             ["--border", "--input", "--sidebar-border"],
  sidebar_background_hsl: ["--sidebar-background"],
  muted_hsl:              ["--muted"],
  destructive_hsl:        ["--destructive"],
};

/** Map each theme key → CSS custom properties it controls (dark mode) */
const DARK_CSS_MAP: Record<keyof ThemeColors, string[]> = {
  primary_hsl:            ["--primary", "--sidebar-primary", "--ring", "--sidebar-ring"],
  secondary_hsl:          ["--secondary"],
  accent_hsl:             ["--accent"],
  background_hsl:         ["--background"],
  foreground_hsl:         ["--foreground"],
  card_hsl:               ["--card", "--popover"],
  border_hsl:             ["--border", "--input", "--sidebar-border"],
  sidebar_background_hsl: ["--sidebar-background"],
  muted_hsl:              ["--muted"],
  destructive_hsl:        ["--destructive"],
};

// ── HSL helpers for auto-deriving dark mode ─────────────────────────
function parseHsl(hsl: string): [number, number, number] {
  const parts = hsl.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return [0, 0, 50];
  return [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])];
}

function formatHsl(h: number, s: number, l: number): string {
  return `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;
}

/** Auto-derive a dark-mode variant from a light-mode brand colour based on its role */
function deriveDarkVariant(key: keyof ThemeColors, hsl: string): string {
  const [h, s, l] = parseHsl(hsl);
  switch (key) {
    case "primary_hsl":
    case "accent_hsl":
      return formatHsl(h, s, Math.max(l, 45));
    case "background_hsl":
      return formatHsl(h, Math.min(s, 15), 8);
    case "foreground_hsl":
      return formatHsl(h, Math.min(s, 20), 90);
    case "card_hsl":
      return formatHsl(h, Math.min(s, 12), 12);
    case "sidebar_background_hsl":
      return formatHsl(h, Math.min(s, 12), 10);
    case "secondary_hsl":
    case "muted_hsl":
      return formatHsl(h, Math.min(s, 10), 18);
    case "border_hsl":
      return formatHsl(h, Math.min(s, 10), 20);
    case "destructive_hsl":
      return formatHsl(h, Math.min(s, 63), Math.min(l, 31));
    default:
      return hsl;
  }
}

const STYLE_TAG_ID = "aion-tenant-theme";

/** Font settings stored alongside colours in theme_settings JSON */
export interface ThemeFonts {
  /** CSS @import URL for loading the font (Google Fonts, self-hosted CSS, etc.) */
  font_url?: string;
  /** CSS font-family for headings (h1-h6). Falls back to Playfair Display. */
  heading_font?: string;
  /** CSS font-family for body text. Falls back to DM Sans. */
  body_font?: string;
}

const FONT_KEYS: (keyof ThemeFonts)[] = ["font_url", "heading_font", "body_font"];
const FONT_LINK_ID = "aion-tenant-font";

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
  /** Full resolved theme colours (DB values merged over defaults) */
  themeColors: ThemeColors;
  /** Brand font overrides */
  themeFonts: ThemeFonts;
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

/** Empty — no overrides. index.css defaults apply for any key not set. */
const EMPTY_THEME: ThemeColors = {};

const EMPTY_FONTS: ThemeFonts = {};

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
  themeColors: EMPTY_THEME,
  themeFonts: EMPTY_FONTS,
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

/** Parse theme_settings JSON — only keeps keys the brand explicitly set. */
const parseThemeSettings = (raw: Database["public"]["Tables"]["brands"]["Row"]["theme_settings"] | undefined): { colors: ThemeColors; fonts: ThemeFonts } => {
  if (!raw || typeof raw !== "object") return { colors: {}, fonts: {} };
  const obj = raw as Record<string, unknown>;
  const colors: ThemeColors = {};
  for (const key of THEME_KEYS) {
    if (typeof obj[key] === "string" && obj[key]) {
      colors[key] = obj[key] as string;
    }
  }
  const fonts: ThemeFonts = {};
  for (const key of FONT_KEYS) {
    if (typeof obj[key] === "string" && obj[key]) {
      fonts[key] = obj[key] as string;
    }
  }
  return { colors, fonts };
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

const mergeWithBrandData = (brand: BrandLookup): TenantConfig => {
  const { colors: themeColors, fonts: themeFonts } = parseThemeSettings(brand.theme_settings);
  return {
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
    primaryHsl: themeColors.primary_hsl || DEFAULT_TENANT.primaryHsl,
    themeColors,
    themeFonts,
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
  };
};

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

  // Derive slug from URL; fall back to sessionStorage for slug-less app routes (e.g. /home).
  // Admin routes (/admin/*) never use a brand slug — always default AION theme.
  const slug = useMemo(() => {
    if (location.pathname.startsWith("/admin")) return "";
    const fromPath = getSlugFromPath(location.pathname);
    if (fromPath) {
      sessionStorage.setItem(TENANT_SLUG_KEY, fromPath);
      return fromPath;
    }
    return sessionStorage.getItem(TENANT_SLUG_KEY) ?? "";
  }, [location.pathname]);

  // Inject a <style> tag with both :root (light) and .dark scopes.
  // Only brand-set colours are emitted — everything else stays as index.css defaults.
  useEffect(() => {
    const keys = THEME_KEYS.filter((k) => tenant.themeColors[k]);
    if (keys.length === 0) {
      // No brand overrides — remove any leftover tag
      document.getElementById(STYLE_TAG_ID)?.remove();
      return;
    }

    let tag = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
    if (!tag) {
      tag = document.createElement("style");
      tag.id = STYLE_TAG_ID;
      document.head.appendChild(tag);
    }

    let lightVars = "";
    let darkVars = "";

    for (const key of keys) {
      const lightVal = tenant.themeColors[key]!;

      for (const cssVar of LIGHT_CSS_MAP[key]) {
        lightVars += `  ${cssVar}: ${lightVal};\n`;
      }

      const darkVal = deriveDarkVariant(key, lightVal);
      for (const cssVar of DARK_CSS_MAP[key]) {
        darkVars += `  ${cssVar}: ${darkVal};\n`;
      }
    }

    tag.textContent = `:root {\n${lightVars}}\n.dark {\n${darkVars}}`;

    return () => { tag?.remove(); };
  }, [tenant.themeColors]);

  // Inject brand fonts: load external CSS and override font-family
  useEffect(() => {
    const { font_url, heading_font, body_font } = tenant.themeFonts;

    // 1. Load external font CSS (Google Fonts URL, self-hosted, etc.)
    let link = document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
    if (font_url) {
      if (!link) {
        link = document.createElement("link");
        link.id = FONT_LINK_ID;
        link.rel = "stylesheet";
        document.head.appendChild(link);
      }
      link.href = font_url;
    } else {
      link?.remove();
    }

    // 2. Apply font-family overrides via the same style tag
    const root = document.documentElement;
    if (heading_font) {
      root.style.setProperty("--heading-font", `'${heading_font}', Georgia, serif`);
    } else {
      root.style.removeProperty("--heading-font");
    }
    if (body_font) {
      root.style.setProperty("--body-font", `'${body_font}', system-ui, sans-serif`);
    } else {
      root.style.removeProperty("--body-font");
    }

    return () => {
      document.getElementById(FONT_LINK_ID)?.remove();
      root.style.removeProperty("--heading-font");
      root.style.removeProperty("--body-font");
    };
  }, [tenant.themeFonts]);

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
