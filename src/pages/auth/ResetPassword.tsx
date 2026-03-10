import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import SmartLogo from "@/components/SmartLogo";
import AuthPanel from "@/components/AuthPanel";
import HeaderControls from "@/components/layout/HeaderControls";
import { useAuthSlug } from "@/hooks/useAuthSlug";

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState(false);
  const tenant = useTenant();
  const { locale } = useLanguage();
  const navigate = useNavigate();
  const slugPrefix = useAuthSlug();

  useEffect(() => {
    // PKCE flow: Supabase sends ?code= in the URL — must exchange it for a session
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");

    if (code) {
      supabase.auth.exchangeCodeForSession(window.location.href).then(({ error }) => {
        if (error) setSessionError(true);
        else setSessionReady(true);
      });
      return;
    }

    // Implicit flow: token arrives as a hash fragment — client processes it automatically
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setSessionReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setSessionReady(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error(locale === "en" ? "Passwords do not match." : "Le password non coincidono.");
      return;
    }

    setIsLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setIsLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    setDone(true);
    const loginPath = slugPrefix ? `${slugPrefix}/login` : "/admin/login";
    setTimeout(() => navigate(loginPath), 1300);
  };

  return (
    <div className="h-screen overflow-hidden bg-background flex">
      <AuthPanel logoUrl={tenant.logoUrl} bgUrl={tenant.authBackgroundUrl} name={tenant.name} />

      <div className="flex-1 flex flex-col">
        <div className="flex justify-end p-4">
          <HeaderControls />
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <SmartLogo src={tenant.logoUrl} alt={tenant.name} className="h-12 object-contain mb-8 block mx-auto" />
          {sessionError ? (
            <div className="text-center">
              <p className="text-destructive mb-4">
                {locale === "en"
                  ? "This reset link is invalid or has expired. Please request a new one."
                  : "Il link di ripristino non è valido o è scaduto. Richiedine uno nuovo."}
              </p>
              <Link
                to={slugPrefix ? `${slugPrefix}/forgot-password` : "/admin/forgot-password"}
                className="inline-block rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {locale === "en" ? "Request New Link" : "Richiedi nuovo link"}
              </Link>
            </div>
          ) : done ? (
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
                to={`${slugPrefix}/login`}
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
                  disabled={isLoading || !sessionReady}
                  className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {!sessionReady
                    ? (locale === "en" ? "Verifying link..." : "Verifica link...")
                    : isLoading
                    ? (locale === "en" ? "Updating..." : "Aggiornamento...")
                    : (locale === "en" ? "Update Password" : "Aggiorna Password")}
                </button>
              </form>
            </>
          )}
        </motion.div>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
