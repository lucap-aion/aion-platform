import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowLeft, Mail } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import SmartLogo from "@/components/SmartLogo";
import AuthPanel from "@/components/AuthPanel";
import HeaderControls from "@/components/layout/HeaderControls";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import { siteUrl } from "@/utils/siteUrl";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const tenant = useTenant();
  const { t, locale } = useLanguage();
  const slugPrefix = useAuthSlug();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl()}/${tenant.slug}/reset-password`,
    });
    setIsLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      setSent(true);
    }
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
          <Link to={`${slugPrefix}/login`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8">
            <ArrowLeft className="h-4 w-4" /> {locale === "en" ? "Back to Sign In" : "Torna al Login"}
          </Link>

          {sent ? (
            <div className="text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <Mail className="h-8 w-8 text-primary" />
              </div>
              <h3 className="font-serif text-2xl font-semibold text-foreground mb-3">
                {locale === "en" ? "Check your email" : "Controlla la tua email"}
              </h3>
              <p className="text-muted-foreground mb-6">
                {locale === "en"
                  ? <>We've sent a password reset link to <span className="font-semibold text-foreground">{email}</span></>
                  : <>Abbiamo inviato un link di ripristino a <span className="font-semibold text-foreground">{email}</span></>}
              </p>
              <Link
                to={`${slugPrefix}/login`}
                className="inline-block rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {locale === "en" ? "Back to Sign In" : "Torna al Login"}
              </Link>
            </div>
          ) : (
            <>
              <h3 className="font-serif text-2xl font-semibold text-foreground mb-2">
                {locale === "en" ? "Reset your password" : "Reimposta la tua password"}
              </h3>
              <p className="text-muted-foreground mb-8">
                {locale === "en" ? "Enter your email and we'll send you a reset link." : "Inserisci la tua email e ti invieremo un link di ripristino."}
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

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {isLoading
                    ? (locale === "en" ? "Sending..." : "Invio in corso...")
                    : (locale === "en" ? "Send Reset Link" : "Invia Link di Ripristino")}
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

export default ForgotPassword;
