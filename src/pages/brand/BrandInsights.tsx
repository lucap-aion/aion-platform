import { useSearchParams } from "react-router-dom";
import AdminInsights from "@/pages/admin/AdminInsights";
import SavedDashboards from "@/components/brand/SavedDashboards";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useLanguage } from "@/contexts/LanguageContext";

const tt = (locale: string, en: string, it: string) => (locale === "it" ? it : en);

// Two views of the brand's numbers: the programme's own (AdminInsights, locked to the brand)
// and the brand's own — reports kept from the assistant, re-run on open (Kevin at Roberto Coin:
// "their own section of insight"). The tab is in the URL, so a link can open on dashboards.
export default function BrandInsights() {
  const { profile } = useAuth();
  const tenant = useTenant();
  const { locale } = useLanguage();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "dashboards" ? "dashboards" : "overview";

  if (!profile?.brand_id) return null;

  const tabs: { key: "overview" | "dashboards"; label: string }[] = [
    { key: "overview", label: tt(locale, "Overview", "Panoramica") },
    { key: "dashboards", label: tt(locale, "My dashboards", "Le mie dashboard") },
  ];

  return (
    <div>
      <div className="flex gap-1 border-b border-border px-6 pt-4 md:px-8">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setParams(t.key === "overview" ? {} : { tab: t.key }, { replace: true })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "overview" ? (
        <AdminInsights lockedBrandId={profile.brand_id} lockedBrandName={tenant?.name ?? ""} />
      ) : (
        <div className="space-y-6 p-6 md:p-8">
          <div>
            <h1 className="font-serif text-2xl font-bold text-foreground">{tenant?.name ?? ""} — {tt(locale, "My dashboards", "Le mie dashboard")}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {tt(locale,
                "Reports kept from the AI Assistant. Each one runs again when you open it, so it always shows today's data.",
                "Report salvati dall'Assistente AI. Ognuno si aggiorna quando lo apri, quindi mostra sempre i dati di oggi.")}
            </p>
          </div>
          <SavedDashboards brandId={profile.brand_id} profileId={profile.id ?? null} isMaster={profile.is_master === true} locale={locale} />
        </div>
      )}
    </div>
  );
}
