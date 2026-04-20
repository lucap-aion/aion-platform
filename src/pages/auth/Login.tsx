import { useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import HeaderControls from "@/components/layout/HeaderControls";
import { useTenant } from "@/contexts/TenantContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { isBrandRole } from "@/contexts/AuthContext";
import SmartLogo from "@/components/SmartLogo";
import AuthPanel from "@/components/AuthPanel";
import { toast } from "sonner";
import { useAuthSlug } from "@/hooks/useAuthSlug";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const tenant = useTenant();
  const { t, locale, setLocale } = useLanguage();
  const navigate = useNavigate();
  const slugPrefix = useAuthSlug();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!tenant.id) {
      toast.error(locale === "en" ? "Invalid brand portal." : "Portale brand non valido.");
      return;
    }

    setIsLoading(true);

    // Pre-login check: verify email has access to this brand portal
    const { data: eligibility } = await supabase.rpc("check_brand_eligibility", {
      p_email: email,
      p_brand_id: tenant.id,
    });

    if (eligibility === "is_admin") {
      setIsLoading(false);
      toast.error(
        locale === "en"
          ? "Admin accounts cannot access brand portals. Please use the admin portal."
          : "Gli account admin non possono accedere ai portali brand. Usa il portale admin."
      );
      return;
    }

    if (eligibility === "unconfirmed") {
      setIsLoading(false);
      toast.error(
        locale === "en"
          ? "Please confirm your email before signing in."
          : "Conferma la tua email prima di accedere."
      );
      return;
    }

    if (eligibility !== "ok") {
      setIsLoading(false);
      toast.error(
        locale === "en"
          ? "You don't have access to this brand portal."
          : "Non hai accesso a questo portale brand."
      );
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setIsLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    // Filter by brand_id so multi-brand users are routed correctly for this portal
    const { data: profileData } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("brand_id", tenant.id)
      .maybeSingle();

    const role = profileData?.role ?? "customer";
    if (isBrandRole(role)) {
      navigate(`${slugPrefix}/dashboard`);
    } else {
      navigate(`${slugPrefix}/home`);
    }
  };

  return (
    <div className="h-screen overflow-hidden bg-background flex">
      <AuthPanel logoUrl={tenant.logoUrl} bgUrl={tenant.authBackgroundUrl} name={tenant.name} />

      {/* Right - Form */}
      <div className="flex-1 flex flex-col">
        <div className="flex justify-end p-4">
          <HeaderControls />
        </div>

        <div className="flex-1 flex items-center justify-center p-8">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md"
          >
            <SmartLogo src={tenant.logoUrl} alt={tenant.name} className="h-9 object-contain mb-8 block mx-auto" />
            <h3 className="font-serif text-2xl font-semibold text-foreground mb-2">{t("auth.welcomeBack")}</h3>
            <p className="text-muted-foreground mb-8">
              {locale === "en" ? "Sign in to your account to continue." : "Accedi al tuo account per continuare."}
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">{t("auth.email")}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={locale === "en" ? "Enter your email" : "Inserisci la tua email"}
                  required
                  className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-foreground">{t("auth.password")}</label>
                  <Link to={`${slugPrefix}/forgot-password`} className="text-xs font-medium text-primary hover:underline">
                    {t("auth.forgotPassword")}
                  </Link>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={locale === "en" ? "Enter your password" : "Inserisci la tua password"}
                    required
                    className="w-full rounded-lg border border-input bg-background px-4 py-3 pr-11 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {isLoading
                  ? (locale === "en" ? "Signing in..." : "Accesso in corso...")
                  : t("auth.login")}
              </button>
            </form>

            <p className="mt-8 text-center text-sm text-muted-foreground">
              {t("auth.noAccount")}{" "}
              <Link to={`${slugPrefix}/signup`} className="font-semibold text-primary hover:underline">
                {t("auth.signup")}
              </Link>
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default Login;
