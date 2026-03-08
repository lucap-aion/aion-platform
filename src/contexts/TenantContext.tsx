import { createContext, useContext, useMemo, type ReactNode } from "react";

export interface TenantConfig {
  slug: string;
  name: string;
  logoUrl: string;
  logoIconUrl: string;
  authBackgroundUrl: string;
  primaryHsl: string;
}

const tenantConfigs: Record<string, TenantConfig> = {
  pomellato: {
    slug: "pomellato",
    name: "Pomellato",
    logoUrl: "/placeholder.svg",
    logoIconUrl: "/placeholder.svg",
    authBackgroundUrl: "https://images.unsplash.com/photo-1515562141589-67f0d569b6c6?w=1920&q=80",
    primaryHsl: "38 55% 55%",
  },
  rc: {
    slug: "rc",
    name: "Roberto Coin",
    logoUrl: "/placeholder.svg",
    logoIconUrl: "/placeholder.svg",
    authBackgroundUrl: "https://images.unsplash.com/photo-1617038220319-276d3cfab638?w=1920&q=80",
    primaryHsl: "210 40% 40%",
  },
  default: {
    slug: "default",
    name: "AION Cover",
    logoUrl: "/placeholder.svg",
    logoIconUrl: "/placeholder.svg",
    authBackgroundUrl: "https://images.unsplash.com/photo-1515562141589-67f0d569b6c6?w=1920&q=80",
    primaryHsl: "38 55% 55%",
  },
};

function getTenantSlug(): string {
  const hostname = window.location.hostname;
  // e.g. pomellato.app.aioncover.com → "pomellato"
  const parts = hostname.split(".");
  if (parts.length >= 3 && parts[1] === "app") {
    return parts[0];
  }
  // For localhost / preview, check query param ?tenant=pomellato
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
