import { motion } from "framer-motion";
import { Users, Shield } from "lucide-react";
import { Link } from "react-router-dom";
import heroImage from "@/assets/hero-jewelry.jpg";

const PortalSelector = () => {
  return (
    <div className="min-h-screen bg-background flex">
      {/* Left - Image */}
      <div className="hidden lg:block lg:w-1/2 relative">
        <img src={heroImage} alt="Luxury jewelry" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-charcoal/60 to-charcoal/30" />
        <div className="absolute bottom-16 left-16">
          <h1 className="font-serif text-5xl font-bold text-cream-light mb-3">
            AION <span className="font-light">Cover</span>
          </h1>
          <p className="text-cream-light/70 text-lg max-w-md">Global Protection for Luxury Products</p>
        </div>
      </div>

      {/* Right - Selection */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <h2 className="font-serif text-3xl font-bold text-foreground mb-2 lg:hidden">AION Cover</h2>
          <h3 className="font-serif text-2xl font-semibold text-foreground mb-2">Welcome back</h3>
          <p className="text-muted-foreground mb-10">Select your portal to continue, or <Link to="/login" className="font-semibold text-primary hover:underline">sign in</Link> to your account.</p>

          <div className="space-y-4">
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Link
                to="/home"
                className="glass-card flex items-center gap-5 p-6 transition-all hover:shadow-md hover:border-primary/30 block"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
                  <Shield className="h-7 w-7 text-primary" />
                </div>
                <div>
                  <h4 className="font-serif text-lg font-semibold text-foreground">Customer Portal</h4>
                  <p className="text-sm text-muted-foreground">Track covers & manage claims</p>
                </div>
              </Link>
            </motion.div>

            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Link
                to="/brand"
                className="glass-card flex items-center gap-5 p-6 transition-all hover:shadow-md hover:border-primary/30 block"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
                  <Users className="h-7 w-7 text-primary" />
                </div>
                <div>
                  <h4 className="font-serif text-lg font-semibold text-foreground">Brand Portal</h4>
                  <p className="text-sm text-muted-foreground">Manage customers, covers & claims</p>
                </div>
              </Link>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PortalSelector;
