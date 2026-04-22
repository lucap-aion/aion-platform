import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const AdminLogin = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingRedirect, setPendingRedirect] = useState(false);
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  // Navigate only after AuthContext confirms admin status
  useEffect(() => {
    if (pendingRedirect && isAdmin) {
      setPendingRedirect(false);
      navigate("/admin");
    }
  }, [pendingRedirect, isAdmin, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    // Pre-login check: only admins may use this portal
    const { data: eligibility } = await supabase.rpc("check_admin_eligibility", { p_email: email });
    if (eligibility === "unconfirmed") {
      setIsLoading(false);
      toast.error("Please verify your email before signing in. Check your inbox for the confirmation link.");
      return;
    }
    if (eligibility !== "ok") {
      setIsLoading(false);
      toast.error("Access denied. This portal is for AION administrators only.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setIsLoading(false);
      toast.error(error.message);
      return;
    }

    // Don't navigate yet — wait for AuthContext to hydrate admin status via useEffect above
    sessionStorage.removeItem("aion_tenant_slug");
    setPendingRedirect(true);
  };

  return (
    <div className="h-screen flex items-center justify-center bg-background p-8">
      <div className="w-full max-w-md">
        <div>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md"
          >
            <img src="/aion_dark_logo.png" alt="AION Cover" className="h-12 object-contain mb-8 block mx-auto" />
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              Admin Platform
            </p>
            <h3 className="font-serif text-2xl font-semibold text-foreground mb-2">
              Welcome back
            </h3>
            <p className="text-muted-foreground mb-8">Sign in to your admin account.</p>

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

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-foreground">Password</label>
                  <Link to="/admin/forgot-password" className="text-xs font-medium text-primary hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
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
                {isLoading ? "Signing in..." : "Sign In"}
              </button>
            </form>

            <p className="mt-8 text-center text-sm text-muted-foreground">
              Not an admin?{" "}
              <Link to="/" className="font-semibold text-primary hover:underline">
                Go to brand portal
              </Link>
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
