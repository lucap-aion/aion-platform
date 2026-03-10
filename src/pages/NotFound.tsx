import { useEffect } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Home } from "lucide-react";
import heroImage from "@/assets/hero-jewelry.jpg";
import logoAion from "@/assets/logo-aion.png";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import { useAuth } from "@/contexts/AuthContext";
import { isBrandRole } from "@/contexts/AuthContext";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const slugPrefix = useAuthSlug();
  const { profile, user } = useAuth();
  const homePath = user
    ? isBrandRole(profile?.role) ? `${slugPrefix}/dashboard` : `${slugPrefix}/home`
    : "/";

  useEffect(() => {
    console.error("404: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-background">
      {/* Background image */}
      <div className="absolute inset-0">
        <img
          src={heroImage}
          alt=""
          className="h-full w-full object-cover object-center opacity-20 dark:opacity-10"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/80 to-background" />
      </div>

      {/* Logo top-left */}
      <div className="absolute top-6 left-6 md:top-8 md:left-8">
        <Link to="/">
          <img src={logoAion} alt="AION" className="h-7 object-contain opacity-70 hover:opacity-100 transition-opacity" />
        </Link>
      </div>

      {/* Content */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 px-6 text-center max-w-lg"
      >
        {/* Big 404 */}
        <motion.p
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, duration: 0.5 }}
          className="font-serif text-[120px] md:text-[160px] font-bold leading-none text-primary/20 select-none"
        >
          404
        </motion.p>

        <div className="-mt-6 mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary mb-3">
            Page not found
          </p>
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-foreground mb-4 leading-tight">
            This page doesn't exist
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
            The URL you entered may be misspelled, or this page may have been moved or removed.
          </p>
        </div>

        <div className="flex items-center justify-center gap-3 flex-wrap">
          <button
            onClick={() => navigate(homePath)}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/80 px-5 py-2.5 text-sm font-medium text-foreground backdrop-blur-sm transition-all hover:bg-secondary"
          >
            <ArrowLeft className="h-4 w-4" />
            Go back
          </button>
          <Link
            to={homePath}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Home className="h-4 w-4" />
            Home
          </Link>
        </div>
      </motion.div>
    </div>
  );
};

export default NotFound;
