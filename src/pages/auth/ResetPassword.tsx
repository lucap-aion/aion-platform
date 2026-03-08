import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useLanguage } from "@/contexts/LanguageContext";

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);
  const tenant = useTenant();
  const { locale } = useLanguage();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      setDone(true);
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-background flex">
      <div className="hidden lg:block lg:w-1/2 relative">
        <img src={tenant.authBackgroundUrl} alt={tenant.name} className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-charcoal/60 to-charcoal/30" />
        <div className="absolute bottom-16 left-16">
          <h1 className="font-serif text-5xl font-bold text-cream-light mb-3">{tenant.name}</h1>
          <p className="text-cream-light/70 text-lg max-w-md">{tenant.tagline}</p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          {done ? (
            <div className="text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
                <CheckCircle2 className="h-8 w-8 text-success" />
              </div>
              <h3 className="font-serif text-2xl font-semibold text-foreground mb-3">
                {locale === "en" ? "Password updated" : "Password aggiornata"}
              </h3>
              <p className="text-muted-foreground mb-6">
                {locale === "en" ? "Your password has been successfully reset." : "La tua password è stata reimpostata con successo."}
              </p>
              <Link
                to="/login"
                className="inline-block rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {locale === "en" ? "Sign In" : "Accedi"}
              </Link>
            </div>
          ) : (
            <>
              <h3 className="font-serif text-2xl font-semibold text-foreground mb-2">
                {locale === "en" ? "Set new password" : "Imposta nuova password"}
              </h3>
              <p className="text-muted-foreground mb-8">
                {locale === "en" ? "Choose a strong password for your account." : "Scegli una password sicura per il tuo account."}
              </p>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">
                    {locale === "en" ? "New Password" : "Nuova Password"}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={locale === "en" ? "Enter new password" : "Inserisci nuova password"}
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

                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">
                    {locale === "en" ? "Confirm Password" : "Conferma Password"}
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={locale === "en" ? "Confirm new password" : "Conferma nuova password"}
                    required
                    className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {isLoading
                    ? (locale === "en" ? "Updating..." : "Aggiornamento...")
                    : (locale === "en" ? "Update Password" : "Aggiorna Password")}
                </button>
              </form>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default ResetPassword;
