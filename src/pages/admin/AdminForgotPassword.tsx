import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Mail } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { siteUrl } from "@/utils/siteUrl";
import { toast } from "sonner";

const AdminForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl()}/reset-password`,
    });
    setIsLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      setSent(true);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-background p-8">
      <div className="w-full max-w-md">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <img src="/aion_dark_logo.png" alt="AION Cover" className="h-12 object-contain mb-8" />

          {sent ? (
            <div className="text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <Mail className="h-8 w-8 text-primary" />
              </div>
              <h3 className="font-serif text-2xl font-semibold text-foreground mb-3">Check your email</h3>
              <p className="text-muted-foreground mb-6">
                We've sent a password reset link to <span className="font-semibold text-foreground">{email}</span>
              </p>
              <Link
                to="/admin/login"
                className="inline-block rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Back to Sign In
              </Link>
            </div>
          ) : (
            <>
              <Link to="/admin/login" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8">
                <ArrowLeft className="h-4 w-4" /> Back to Sign In
              </Link>
              <h3 className="font-serif text-2xl font-semibold text-foreground mb-2">Reset your password</h3>
              <p className="text-muted-foreground mb-8">Enter your admin email and we'll send you a reset link.</p>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@aioncover.com"
                    required
                    className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {isLoading ? "Sending..." : "Send Reset Link"}
                </button>
              </form>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default AdminForgotPassword;
