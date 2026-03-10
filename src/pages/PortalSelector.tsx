import { motion } from "framer-motion";
import { Users, Shield } from "lucide-react";
import { Link } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import SmartLogo from "@/components/SmartLogo";
import HeaderControls from "@/components/layout/HeaderControls";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { isBrandRole, isCustomerRole } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";

const PortalSelector = () => {
  const tenant = useTenant();
  const { t, locale } = useLanguage();
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (user) {
    if (isCustomerRole(profile?.role)) return <Navigate to="/home" replace />;
    if (isBrandRole(profile?.role)) return <Navigate to="/brand" replace />;
  }

  return (
    <div className="h-screen overflow-hidden bg-background flex flex-col">
      <div className="flex justify-end px-4 pt-4 shrink-0">
        <HeaderControls />
      </div>
      <div className="flex-1 overflow-hidden flex">
      {/* Left - Tenant branded image */}
      <div className="hidden lg:block lg:w-1/2 relative">
        <img src={tenant.authBackgroundUrl} alt={tenant.name} className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-charcoal/60 to-charcoal/30" />
        <div className="absolute top-10 left-10">
          <SmartLogo src={tenant.logoUrl} alt={tenant.name} className="h-10 object-contain" />
        </div>
        <div className="absolute bottom-16 left-16">
          <p className="text-cream-light/70 text-lg max-w-md">{tenant.tagline}</p>
        </div>
      </div>

      {/* Right - Selection */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <SmartLogo src={tenant.logoUrl} alt={tenant.name} className="h-10 object-contain mb-8" />
          <h3 className="font-serif text-2xl font-semibold text-foreground mb-2">{t("auth.welcomeBack")}</h3>
          <p className="text-muted-foreground mb-10">
            {locale === "en"
              ? <>Select your portal to continue, or <Link to="/login" className="font-semibold text-primary hover:underline">sign in</Link> to your account.</>
              : <>Seleziona il tuo portale per continuare, oppure <Link to="/login" className="font-semibold text-primary hover:underline">accedi</Link> al tuo account.</>}
          </p>

          <div className="space-y-4">
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Link
                to="/home"
                className="glass-card flex items-center gap-5 p-6 transition-all hover:shadow-md hover:border-primary/30 block"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
                  <Shield className="h-7 w-7 text-primary" />
                </div>
                <div>
                  <h4 className="font-serif text-lg font-semibold text-foreground">
                    {locale === "en" ? "Customer Portal" : "Portale Cliente"}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {locale === "en" ? "Track covers & manage claims" : "Monitora coperture e gestisci incidenti"}
                  </p>
                </div>
              </Link>
            </motion.div>

            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Link
                to="/brand"
                className="glass-card flex items-center gap-5 p-6 transition-all hover:shadow-md hover:border-primary/30 block"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
                  <Users className="h-7 w-7 text-primary" />
                </div>
                <div>
                  <h4 className="font-serif text-lg font-semibold text-foreground">
                    {locale === "en" ? "Brand Portal" : "Portale Brand"}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {locale === "en" ? "Manage customers, covers & claims" : "Gestisci clienti, coperture e incidenti"}
                  </p>
                </div>
              </Link>
            </motion.div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};

export default PortalSelector;
