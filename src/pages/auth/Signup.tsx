import { useState } from "react";
import { motion } from "framer-motion";
import { Link, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Mail } from "lucide-react";
import HeaderControls from "@/components/layout/HeaderControls";
import { useTenant } from "@/contexts/TenantContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import SmartLogo from "@/components/SmartLogo";
import AuthPanel from "@/components/AuthPanel";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import { siteUrl } from "@/utils/siteUrl";

const Signup = () => {
  const [searchParams] = useSearchParams();
  const emailFromInvite = searchParams.get("email") ?? "";

  const [form, setForm] = useState({ email: emailFromInvite, firstName: "", lastName: "", password: "", confirmPassword: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);

  const tenant = useTenant();
  const { locale } = useLanguage();
  const slugPrefix = useAuthSlug();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.email) {
      toast.error(locale === "en" ? "Please enter your email." : "Inserisci la tua email.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      toast.error(locale === "en" ? "Passwords do not match." : "Le password non coincidono.");
      return;
    }
    if (form.password.length < 8) {
      toast.error(
        locale === "en" ? "Password must be at least 8 characters." : "La password deve essere di almeno 8 caratteri."
      );
      return;
    }
    if (!tenant.id) {
      toast.error(locale === "en" ? "Invalid brand portal." : "Portale brand non valido.");
      return;
    }

    setIsLoading(true);

    // Verify a pending profile exists for this email + brand
    const { data: inviteStatus } = await supabase.rpc("check_brand_invitation", {
      p_email: form.email,
      p_brand_id: tenant.id,
    });

    if (inviteStatus === "registered") {
      setIsLoading(false);
      toast.error(
        locale === "en"
          ? "This email is already registered. Please sign in."
          : "Questa email è già registrata. Accedi."
      );
      return;
    }
    if (inviteStatus !== "invited") {
      setIsLoading(false);
      toast.error(
        locale === "en"
          ? "No pending invitation found for this email. Please contact your brand representative."
          : "Nessun invito in attesa trovato per questa email. Contatta il tuo rappresentante brand."
      );
      return;
    }

    // After email verification, Supabase redirects to /{slug}
    // TenantSlugEntry routes the user to /home or /dashboard based on their role
    const { error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        emailRedirectTo: `${siteUrl()}/${tenant.slug}`,
        data: {
          first_name: form.firstName,
          last_name: form.lastName,
          brand_slug: tenant.slug,
          brand_name: tenant.name,
          brand_logo_url: tenant.logoUrl ?? null,
        },
      },
    });

    setIsLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    setDone(true);
  };

  return (
    <div className="h-screen overflow-hidden bg-background flex">
      <AuthPanel logoUrl={tenant.logoUrl} bgUrl={tenant.authBackgroundUrl} name={tenant.name} />

      <div className="flex-1 flex flex-col overflow-y-auto">
        <div className="flex justify-end p-4">
          <HeaderControls />
        </div>

        <div className="flex-1 flex items-center justify-center p-8">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md"
          >
            <SmartLogo src={tenant.logoUrl} alt={tenant.name} className="h-12 object-contain mb-8 block mx-auto" />

            {done ? (
              /* Confirmation screen — shown after successful signUp() */
              <div className="text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <Mail className="h-8 w-8 text-primary" />
                </div>
                <h3 className="font-serif text-2xl font-semibold text-foreground mb-3">
                  {locale === "en" ? "Check your email" : "Controlla la tua email"}
                </h3>
                <p className="text-muted-foreground mb-1">
                  {locale === "en" ? "We've sent a verification link to" : "Abbiamo inviato un link di verifica a"}
                </p>
                <p className="font-semibold text-foreground mb-6">{form.email}</p>
                <p className="text-sm text-muted-foreground mb-8">
                  {locale === "en"
                    ? "Click the link in the email to verify your address and activate your account. The link expires in 24 hours."
                    : "Clicca il link nell'email per verificare il tuo indirizzo e attivare il tuo account. Il link scade in 24 ore."}
                </p>
                <Link
                  to={`${slugPrefix}/login`}
                  className="inline-block rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  {locale === "en" ? "Back to Sign In" : "Torna all'accesso"}
                </Link>
              </div>
            ) : (
              /* Registration form */
              <>
                <h3 className="font-serif text-2xl font-semibold text-foreground mb-2">
                  {locale === "en" ? "Create your account" : "Crea il tuo account"}
                </h3>
                <p className="text-muted-foreground mb-8">
                  {locale === "en"
                    ? `Complete your registration for ${tenant.name}.`
                    : `Completa la tua registrazione per ${tenant.name}.`}
                </p>

                <form onSubmit={handleSubmit} className="space-y-5">
                  {/* Email — pre-filled from invite link but editable */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">Email</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder={locale === "en" ? "Enter your email" : "Inserisci la tua email"}
                      required
                      className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
                    />
                  </div>

                  {/* Name row */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-foreground mb-1.5 block">
                        {locale === "en" ? "First Name" : "Nome"}
                      </label>
                      <input
                        type="text"
                        value={form.firstName}
                        onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                        placeholder={locale === "en" ? "First name" : "Nome"}
                        required
                        className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-1.5 block">
                        {locale === "en" ? "Last Name" : "Cognome"}
                      </label>
                      <input
                        type="text"
                        value={form.lastName}
                        onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                        placeholder={locale === "en" ? "Last name" : "Cognome"}
                        required
                        className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
                      />
                    </div>
                  </div>

                  {/* Password */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">
                      {locale === "en" ? "Password" : "Password"}
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        placeholder={locale === "en" ? "Create a password (min 8 chars)" : "Crea una password (min 8 caratteri)"}
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

                  {/* Confirm Password */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">
                      {locale === "en" ? "Confirm Password" : "Conferma Password"}
                    </label>
                    <input
                      type="password"
                      value={form.confirmPassword}
                      onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                      placeholder={locale === "en" ? "Confirm your password" : "Conferma la tua password"}
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
                      ? (locale === "en" ? "Creating account…" : "Creazione account…")
                      : (locale === "en" ? "Create Account" : "Crea Account")}
                  </button>
                </form>

                <p className="mt-8 text-center text-sm text-muted-foreground">
                  {locale === "en" ? "Already have an account?" : "Hai già un account?"}{" "}
                  <Link to={`${slugPrefix}/login`} className="font-semibold text-primary hover:underline">
                    {locale === "en" ? "Sign in" : "Accedi"}
                  </Link>
                </p>
              </>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default Signup;
