import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import SmartLogo from "@/components/SmartLogo";
import HeaderControls from "@/components/layout/HeaderControls";
import { useLanguage } from "@/contexts/LanguageContext";

interface Brand {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  logo_big: string | null;
  logo_small: string | null;
  top_banner_image: string | null;
}

const BrandCard = ({ brand, index }: { brand: Brand; index: number }) => {
  const logo = brand.logo_small || brand.logo_big;
  const image = brand.top_banner_image;
  const initial = brand.name?.[0]?.toUpperCase() ?? "?";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
    >
      <Link
        to={`/${brand.slug}`}
        className="group relative flex flex-col rounded-2xl border border-border/70 bg-card transition-all duration-500 hover:border-primary/40 hover:shadow-2xl hover:shadow-primary/10 w-64 h-72 overflow-hidden"
      >
        <div className="relative w-full flex-1 overflow-hidden bg-muted/30">
          {image ? (
            <SmartLogo
              src={image}
              alt={brand.name}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted/30 to-muted/50">
              <span className="text-5xl font-serif font-bold text-primary/20">{initial}</span>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-card via-card/70 to-transparent" />
        </div>

        <div className="relative flex items-center justify-center px-5 py-3.5">
          {logo ? (
            <SmartLogo
              src={logo}
              alt={brand.name}
              className="max-h-6 max-w-[120px] w-auto object-contain transition-transform duration-500 group-hover:-translate-y-0.5"
            />
          ) : (
            <span className="text-sm font-serif font-medium text-foreground/80">{brand.name}</span>
          )}
          <ArrowRight className="absolute right-5 h-3.5 w-3.5 text-muted-foreground/30 transition-all duration-300 group-hover:text-primary group-hover:translate-x-1" />
        </div>
      </Link>
    </motion.div>
  );
};

const ComingSoonCard = ({ index, label }: { index: number; label: string }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: index * 0.08 }}
    className="relative w-64 h-72 rounded-2xl border border-border/70 bg-card overflow-hidden cursor-not-allowed select-none"
    aria-disabled="true"
  >
    <div className="flex flex-col h-full filter blur-[3px] opacity-40 pointer-events-none">
      <div className="relative flex-1 w-full overflow-hidden bg-gradient-to-br from-muted/30 to-muted/50" />
      <div className="flex items-center justify-center px-5 py-3.5">
        <div className="h-5 w-24 rounded bg-muted-foreground/20" />
      </div>
    </div>
    <div className="absolute inset-0 flex items-center justify-center">
      <span className="px-4 py-1.5 rounded-full bg-background/90 backdrop-blur-sm text-xs tracking-widest uppercase text-foreground/70 border border-border shadow-sm">
        {label}
      </span>
    </div>
  </motion.div>
);

const SkeletonCard = () => (
  <div className="rounded-2xl border border-border bg-card w-64 h-72 animate-pulse" />
);

const LandingPage = () => {
  const { t } = useLanguage();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await supabase
          .from("brands")
          .select("id, slug, name, description, logo_big, logo_small, top_banner_image")
          .not("slug", "is", null)
          .neq("slug", "")
          .eq("status", "verified")
          .order("name");
        setBrands(data ?? []);
      } catch {
        // silently handle network errors
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex items-center justify-between px-4 pt-4">
        <a
          href="https://aioncover.com"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("landing.back")}
        </a>
        <HeaderControls />
      </div>
      {/* Main content — centered vertically in remaining viewport */}
      <div className="flex-1 flex flex-col justify-center">
        {/* Hero */}
        <div className="mx-auto max-w-4xl px-6 pt-6 pb-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-4"
          >
            <SmartLogo src="/aion_dark_logo.png" alt="AION Cover" className="h-8 object-contain" />
            <div className="w-8 h-px bg-primary/40" />
            <p className="text-muted-foreground text-sm sm:text-base max-w-lg mx-auto leading-relaxed">
              {t("landing.intro")}{" "}
              <span className="text-foreground/60">{t("landing.selectBrand")}</span>
            </p>
          </motion.div>
        </div>

        {/* Brand grid */}
        <div className="mx-auto max-w-5xl px-6">
          {loading ? (
            <div className="flex flex-wrap justify-center gap-5">
              {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
            </div>
          ) : brands.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground text-sm">{t("landing.noBrands")}</div>
          ) : (
            <motion.div
              className="flex flex-wrap justify-center gap-5"
            >
              {brands.map((brand, i) => (
                <BrandCard key={brand.id} brand={brand} index={i} />
              ))}
              <ComingSoonCard index={brands.length} label={t("landing.comingSoon")} />
            </motion.div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="pb-6 pt-4 text-center">
        <p className="text-xs text-muted-foreground/40 tracking-widest uppercase">
          {t("landing.poweredBy")}
        </p>
      </div>
    </div>
  );
};

export default LandingPage;
