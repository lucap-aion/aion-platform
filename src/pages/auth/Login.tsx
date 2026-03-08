import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Eye, EyeOff, Globe } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useLanguage } from "@/contexts/LanguageContext";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const tenant = useTenant();
  const { t, locale, setLocale } = useLanguage();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      window.location.href = "/";
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left - Tenant branded image */}
      <div className="hidden lg:block lg:w-1/2 relative">
        <img src={tenant.authBackgroundUrl} alt={tenant.name} className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-charcoal/60 to-charcoal/30" />
        <div className="absolute bottom-16 left-16">
          <h1 className="font-serif text-5xl font-bold text-cream-light mb-3">
            {tenant.name}
          </h1>
          <p className="text-cream-light/70 text-lg max-w-md">{tenant.tagline}</p>
          </h1>
          <p className="text-cream-light/70 text-lg max-w-md">Global Protection for Luxury Products</p>
        </div>
      </div>

      {/* Right - Form */}
      <div className="flex-1 flex flex-col">
        {/* Language switcher */}
        <div className="flex justify-end p-4">
          <button
            onClick={() => setLocale(locale === "en" ? "it" : "en")}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Globe className="h-4 w-4" />
            <span className="uppercase">{locale}</span>
          </button>
        </div>

        <div className="flex-1 flex items-center justify-center p-8">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md"
          >
            <h2 className="font-serif text-3xl font-bold text-foreground mb-2 lg:hidden">
              {tenant.name}
            </h2>
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
                  <Link to="/forgot-password" className="text-xs font-medium text-primary hover:underline">
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
              <Link to="/signup" className="font-semibold text-primary hover:underline">
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
