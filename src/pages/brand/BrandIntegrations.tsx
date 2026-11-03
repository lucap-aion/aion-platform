// Integrations — where a brand master connects the house's own systems.
//
// Today that is Google Drive and Shopify, both feeding the knowledge base
// (ConnectedSources does the work; this page is its home). They used to sit on
// the Knowledge page, which is about what the Assistant knows, not about which
// accounts are plugged in — a master looking for "where do I connect Shopify"
// looks in settings, next to Team, not halfway down a document list.
//
// Shopify's approval screen sends the person back here (shopify-oauth's
// integrationsPath), with ?connected=shopify or ?connect_error=….

import { Link } from "react-router-dom";
import { Library } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import ConnectedSources from "@/components/knowledge/ConnectedSources";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const tt = (locale: string, en: string, it: string) => (locale === "it" ? it : en);

export default function BrandIntegrations() {
  const { profile, canWrite } = useAuth();
  const { locale } = useLanguage();
  const slugPrefix = useAuthSlug();
  const brandId = profile?.brand_id ?? null;

  const callFn = async (fn: string, body: Record<string, unknown>) => {
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    if (!token) throw new Error(tt(locale, "Not signed in", "Non autenticato"));
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error ?? `Request failed (${res.status})`);
    return payload;
  };

  if (!canWrite || !brandId) {
    return (
      <div className="w-full px-4 py-6 md:px-8 md:py-8">
        <div className="glass-card p-6">
          <p className="text-sm text-muted-foreground">
            {tt(locale, "Access restricted to master users.", "Accesso riservato agli utenti master.")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 py-6 md:px-8 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8">
        <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">
          {tt(locale, "Integrations", "Integrazioni")}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {tt(locale,
            "Connect the systems your house already works in. AION reads them on a schedule, so the Assistant follows every change you make at the source.",
            "Collega i sistemi che la maison usa già. AION li legge periodicamente, così l'Assistente segue ogni modifica fatta alla fonte.")}
        </p>
      </div>

      <div className="max-w-3xl space-y-3">
        <ConnectedSources brandId={brandId} locale={locale} callFn={callFn} onChanged={() => {}} />
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Library className="h-3.5 w-3.5" />
          {tt(locale, "What they bring in appears in the", "Quello che importano compare nella")}{" "}
          <Link to={`${slugPrefix}/knowledge`} className="font-medium text-foreground hover:underline">
            {tt(locale, "Knowledge base", "Knowledge base")}
          </Link>
          {tt(locale, ", marked with its source.", ", con la fonte indicata.")}
        </p>
      </div>
    </div>
  );
}
