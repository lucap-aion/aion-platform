import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import SmartLogo from "@/components/SmartLogo";
import HeaderControls from "@/components/layout/HeaderControls";

interface Brand {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  logo_big: string | null;
  logo_small: string | null;
}

const BrandCard = ({ brand, index }: { brand: Brand; index: number }) => {
  const logo = brand.logo_big || brand.logo_small;
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
        className="group flex flex-col items-center justify-between gap-6 rounded-2xl border border-border bg-card px-8 pt-10 pb-6 text-center transition-all duration-300 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 w-64 h-52"
      >
        <div className="flex flex-1 items-center justify-center w-full">
          {logo ? (
            <SmartLogo
              src={logo}
              alt={brand.name}
              className="max-h-14 max-w-[180px] w-auto object-contain"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <span className="text-2xl font-serif font-bold text-primary">{initial}</span>
            </div>
          )}
        </div>

        <div className="flex w-full items-center justify-between">
          <span className="text-xs text-muted-foreground font-medium tracking-wide">{brand.name}</span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 transition-all duration-300 group-hover:text-primary group-hover:translate-x-0.5" />
        </div>
      </Link>
    </motion.div>
  );
};

const SkeletonCard = () => (
  <div className="rounded-2xl border border-border bg-card w-64 h-52 animate-pulse" />
);

const LandingPage = () => {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await supabase
          .from("brands")
          .select("id, slug, name, description, logo_big, logo_small")
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
      <div className="flex justify-end px-4 pt-4">
        <HeaderControls />
      </div>
      {/* Hero */}
      <div className="mx-auto max-w-4xl px-6 pt-20 pb-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-5"
        >
          <SmartLogo src="/aion_dark_logo.png" alt="AION Cover" className="h-9 object-contain" />
          <div className="w-8 h-px bg-primary/40 mt-1" />
          <p className="text-muted-foreground text-base max-w-sm mx-auto leading-relaxed">
            Global protection for luxury products.{" "}
            <span className="text-foreground/60">Select your brand to continue.</span>
          </p>
        </motion.div>
      </div>

      {/* Brand grid */}
      <div className="mx-auto max-w-5xl px-6 pb-24 flex-1">
        {loading ? (
          <div className="flex flex-wrap justify-center gap-5">
            {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
          </div>
        ) : brands.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground text-sm">No brands available.</div>
        ) : (
          <motion.div
            className="flex flex-wrap justify-center gap-5"
          >
            {brands.map((brand, i) => (
              <BrandCard key={brand.id} brand={brand} index={i} />
            ))}
          </motion.div>
        )}
      </div>

      {/* Footer */}
      <div className="pb-10 text-center">
        <p className="text-xs text-muted-foreground/40 tracking-widest uppercase">
          Powered by AION Cover
        </p>
      </div>
    </div>
  );
};

export default LandingPage;
