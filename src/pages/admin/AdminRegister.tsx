import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Mail, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { siteUrl } from "@/utils/siteUrl";

const AdminRegister = () => {
  const [searchParams] = useSearchParams();
  const emailFromInvite = searchParams.get("email") ?? "";

  const [form, setForm] = useState({ firstName: "", lastName: "", password: "", confirmPassword: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (form.password !== form.confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    if (form.password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }

    setIsLoading(true);

    // Verify the email is actually in the admins table before creating auth account
    const { data: eligibility } = await supabase.rpc("check_admin_eligibility", {
      p_email: emailFromInvite,
    });

    if (eligibility === "not_admin") {
      setIsLoading(false);
      toast.error("This email has not been invited as an admin. Please contact your administrator.");
      return;
    }

    // After email verification, Supabase redirects the user to /admin
    const { error } = await supabase.auth.signUp({
      email: emailFromInvite,
      password: form.password,
      options: {
        emailRedirectTo: `${siteUrl()}/admin`,
        data: {
          first_name: form.firstName,
          last_name: form.lastName,
        },
      },
    });

    setIsLoading(false);

    if (error) {
      // User already registered but unconfirmed — resend confirmation
      if (
        error.message.toLowerCase().includes("already registered") ||
        error.message.toLowerCase().includes("already been registered")
      ) {
        const { error: resendError } = await supabase.auth.resend({
          type: "signup",
          email: emailFromInvite,
          options: { emailRedirectTo: `${siteUrl()}/admin` },
        });
        if (resendError) {
          toast.info("Your account is already confirmed. Please sign in.");
          return;
        }
        setDone(true);
        return;
      }
      toast.error(error.message);
      return;
    }

    setDone(true);
  };

  // No email in URL — show helpful error instead of a broken form
  if (!emailFromInvite) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-[#1a1a1a] border border-white/10 rounded-2xl p-8 text-center"
        >
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
            <AlertCircle className="h-8 w-8 text-red-400" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-3">Invalid registration link</h2>
          <p className="text-white/50 text-sm mb-6">
            This page must be opened from the invitation email sent to you by an AION administrator.
          </p>
          <Link
            to="/admin/login"
            className="inline-block rounded-lg bg-white px-8 py-3 text-sm font-semibold text-black transition-colors hover:bg-white/90"
          >
            Go to Sign In
          </Link>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-[#1a1a1a] border border-white/10 rounded-2xl p-8"
      >
        <div className="mb-8 text-center">
          <span className="font-serif text-2xl font-bold tracking-wide text-white">AION</span>
          <p className="text-sm text-white/40 mt-1">Admin Portal</p>
        </div>

        {done ? (
          /* Confirmation screen */
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
              <Mail className="h-8 w-8 text-green-400" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-3">Check your email</h3>
            <p className="text-white/50 text-sm mb-2">
              We've sent a verification link to
            </p>
            <p className="text-white font-medium mb-6">{emailFromInvite}</p>
            <p className="text-white/40 text-sm mb-8">
              Click the link to verify your email and activate your admin account. The link expires in 24 hours.
            </p>
            <Link
              to="/admin/login"
              className="inline-block rounded-lg bg-white px-8 py-3 text-sm font-semibold text-black transition-colors hover:bg-white/90"
            >
              Back to Sign In
            </Link>
          </div>
        ) : (
          /* Registration form */
          <>
            <h2 className="text-xl font-semibold text-white mb-1">Create your account</h2>
            <p className="text-sm text-white/40 mb-8">
              Complete your registration to activate admin access.
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email — read-only from invite URL */}
              <div>
                <label className="text-xs font-medium text-white/60 mb-1.5 block">Email</label>
                <input
                  type="email"
                  value={emailFromInvite}
                  readOnly
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/50 cursor-not-allowed"
                />
              </div>

              {/* Name row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-white/60 mb-1.5 block">First Name</label>
                  <input
                    type="text"
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    placeholder="First name"
                    required
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/20 focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-white/60 mb-1.5 block">Last Name</label>
                  <input
                    type="text"
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    placeholder="Last name"
                    required
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/20 focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="text-xs font-medium text-white/60 mb-1.5 block">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="Create a password (min 8 chars)"
                    required
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 pr-11 text-sm text-white placeholder:text-white/20 focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="text-xs font-medium text-white/60 mb-1.5 block">Confirm Password</label>
                <input
                  type="password"
                  value={form.confirmPassword}
                  onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                  placeholder="Confirm your password"
                  required
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/20 focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full rounded-lg bg-white py-3 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-50"
              >
                {isLoading ? "Creating account…" : "Create Account"}
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-white/30">
              Already have an account?{" "}
              <Link to="/admin/login" className="text-white/60 hover:text-white">
                Sign in
              </Link>
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
};

export default AdminRegister;
