import { motion } from "framer-motion";
import { Shield, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import ProgressRing from "@/components/ui/progress-ring";
import heroImage from "@/assets/hero-jewelry.jpg";

const CustomerDashboard = () => {
  return (
    <div className="max-w-5xl mx-auto space-y-6 md:space-y-8 animate-fade-in">
      {/* Profile Completion */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 md:p-6"
      >
        <div className="flex items-center gap-6">
          <ProgressRing value={91} />
          <div>
            <h3 className="font-serif text-lg font-semibold text-foreground">Complete your profile</h3>
            <p className="text-sm text-muted-foreground">Complete your profile to unlock all features.</p>
          </div>
        </div>
        <button className="rounded-lg border border-primary bg-primary/5 px-6 py-2.5 text-sm font-medium text-primary transition-all hover:bg-primary hover:text-primary-foreground">
          Complete Profile
        </button>
      </motion.div>

      {/* Hero Banner */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="relative overflow-hidden rounded-2xl"
      >
        <img
          src={heroImage}
          alt="Luxury jewelry collection"
          className="h-64 w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-charcoal/80 via-charcoal/50 to-transparent" />
        <div className="absolute inset-0 flex flex-col justify-center px-10">
          <h2 className="font-serif text-3xl font-bold text-cream-light mb-2">
            Prestige Protection
          </h2>
          <p className="max-w-md text-sm text-cream-light/80 mb-5 leading-relaxed">
            Your luxury pieces deserve world-class coverage. AION Cover safeguards your treasures against theft and accidental damage.
          </p>
          <Link
            to="/covers"
            className="inline-flex w-fit items-center gap-2 rounded-lg border border-cream-light/30 px-5 py-2.5 text-sm font-medium text-cream-light backdrop-blur-sm transition-all hover:bg-cream-light/10"
          >
            View My Covers <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </motion.div>

      {/* Quick Stats */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="grid grid-cols-3 gap-5"
      >
        {[
          { label: "Active Covers", value: "3", icon: Shield },
          { label: "Open Claims", value: "1", icon: Shield },
          { label: "Total Protected Value", value: "€12,400", icon: Shield },
        ].map((stat, i) => (
          <div key={i} className="glass-card p-6">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">{stat.label}</p>
            <p className="font-serif text-2xl font-bold text-foreground">{stat.value}</p>
          </div>
        ))}
      </motion.div>

      {/* How it works */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="glass-card p-8"
      >
        <h3 className="font-serif text-xl font-semibold text-foreground mb-6">How It Works</h3>
        <div className="grid grid-cols-3 gap-8">
          {[
            { step: "01", title: "Coverage at Checkout", desc: "Complimentary coverage included with your luxury purchase." },
            { step: "02", title: "Simple Activation", desc: "Activate your coverage effortlessly in just a few clicks." },
            { step: "03", title: "Effortless Claims", desc: "Submit claims quickly through our intuitive platform." },
          ].map((item, i) => (
            <div key={i} className="text-center">
              <span className="gold-text font-serif text-3xl font-bold">{item.step}</span>
              <h4 className="mt-3 font-serif text-base font-semibold text-foreground">{item.title}</h4>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
};

export default CustomerDashboard;
