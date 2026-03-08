import { createContext, useContext, useMemo, type ReactNode } from "react";
import logoAion from "@/assets/logo-aion.png";
import logoIconAion from "@/assets/logo-icon-aion.png";
import logoPomellato from "@/assets/logo-pomellato.png";
import logoIconPomellato from "@/assets/logo-icon-pomellato.png";
import logoRc from "@/assets/logo-rc.png";
import logoIconRc from "@/assets/logo-icon-rc.png";

export interface TenantConfig {
  slug: string;
  name: string;
  tagline: string;
  logoUrl: string;
  logoIconUrl: string;
  logoInitial: string;
  authBackgroundUrl: string;
  primaryHsl: string;
}

const tenantConfigs: Record<string, TenantConfig> = {
  pomellato: {
    slug: "pomellato",
    name: "Pomellato",
    tagline: "Luxury Protection by Pomellato",
    logoUrl: logoPomellato,
    logoIconUrl: logoIconPomellato,
    logoInitial: "P",
    authBackgroundUrl: "https://images.unsplash.com/photo-1515562141589-67f0d569b6c6?w=1920&q=80",
    primaryHsl: "38 55% 55%",
  },
  rc: {
    slug: "rc",
    name: "Roberto Coin",
    tagline: "Protection by Roberto Coin",
    logoUrl: logoRc,
    logoIconUrl: logoIconRc,
    logoInitial: "RC",
    authBackgroundUrl: "https://images.unsplash.com/photo-1617038220319-276d3cfab638?w=1920&q=80",
    primaryHsl: "210 40% 40%",
  },
  default: {
    slug: "default",
    name: "AION Cover",
    tagline: "Global Protection for Luxury Products",
    logoUrl: logoAion,
    logoIconUrl: logoIconAion,
    logoInitial: "A",
    authBackgroundUrl: "https://images.unsplash.com/photo-1515562141589-67f0d569b6c6?w=1920&q=80",
    primaryHsl: "38 55% 55%",
  },
};

function getTenantSlug(): string {
  const hostname = window.location.hostname;
  const parts = hostname.split(".");
  if (parts.length >= 3 && parts[1] === "app") {
    return parts[0];
  }
  const params = new URLSearchParams(window.location.search);
  return params.get("tenant") || "default";
}

const TenantContext = createContext<TenantConfig>(tenantConfigs.default);

export const TenantProvider = ({ children }: { children: ReactNode }) => {
  const tenant = useMemo(() => {
    const slug = getTenantSlug();
    return tenantConfigs[slug] || tenantConfigs.default;
  }, []);

  return (
    <TenantContext.Provider value={tenant}>{children}</TenantContext.Provider>
  );
};

export const useTenant = () => useContext(TenantContext);
