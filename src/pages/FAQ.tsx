import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowLeft, Search } from "lucide-react";
import HeaderControls from "@/components/layout/HeaderControls";
import SmartLogo from "@/components/SmartLogo";
import { useTenant } from "@/contexts/TenantContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

/**
 * Public FAQ page — accessible without authentication at /:slug/faq.
 * Reads brand FAQ JSON from the tenant (already publicly readable via RLS).
 */
const FAQ = () => {
  const tenant = useTenant();
  const { t, locale } = useLanguage();
  const slugPrefix = useAuthSlug();
  const [search, setSearch] = useState("");

  // FAQ: use brand JSON from DB. Supports both the editor format
  // ({ title, content: { blocks } }) and the legacy ({ question, answer }) shape.
  const faqItems = (() => {
    const source = locale === "it" ? tenant.faqIt : tenant.faqEn;
    if (Array.isArray(source) && source.length > 0) {
      return (source as any[]).map((item) => ({
        q: item.title ?? item.question ?? "",
        a: item.content?.blocks
          ? (item.content.blocks as any[]).filter((b: any) => b.text).map((b: any) => b.text).join(" ")
          : (item.answer ?? ""),
      }));
    }
    return [] as { q: string; a: string }[];
  })();

  const filtered = faqItems.filter((item) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return item.q.toLowerCase().includes(s) || item.a.toLowerCase().includes(s);
  });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-4 md:px-8">
        <Link to={`${slugPrefix}/login`} className="flex items-center">
          <SmartLogo src={tenant.logoUrl} alt={tenant.name} className="h-8 object-contain" />
        </Link>
        <HeaderControls />
      </header>

      {/* Content */}
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-10 md:py-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-foreground mb-2">
            {t("faq.title")}
          </h1>
          <p className="text-muted-foreground mb-8">{t("faq.subtitle")}</p>

          <div className="relative mb-6">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder={t("faq.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-muted py-2.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {filtered.length > 0 ? (
            <Accordion type="single" collapsible className="w-full">
              {filtered.map((item, i) => (
                <AccordionItem key={i} value={`faq-${i}`} className="border-border">
                  <AccordionTrigger className="text-sm text-left font-medium text-foreground py-4">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
                    {item.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">{t("faq.empty")}</p>
          )}

          <Link
            to={`${slugPrefix}/login`}
            className="mt-10 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("faq.backToLogin")}
          </Link>
        </motion.div>
      </main>
    </div>
  );
};

export default FAQ;
