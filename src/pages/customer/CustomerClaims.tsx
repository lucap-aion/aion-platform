import { motion } from "framer-motion";
import { Plus, Clock, CheckCircle2, XCircle } from "lucide-react";
import { Link } from "react-router-dom";

const claims = [
  {
    id: "CLM-001",
    product: "Anello Nudo Classic Amethyst",
    type: "Accidental Damage",
    date: "Feb 20, 2026",
    status: "under_review",
    description: "Ring stone chipped after accidental drop on marble floor.",
  },
];

const statusConfig = {
  under_review: { label: "Under Review", icon: Clock, className: "bg-warning/10 text-warning" },
  approved: { label: "Approved", icon: CheckCircle2, className: "bg-success/10 text-success" },
  rejected: { label: "Rejected", icon: XCircle, className: "bg-destructive/10 text-destructive" },
} as const;

const CustomerClaims = () => {
  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-bold text-foreground">My Claims</h1>
          <p className="mt-1 text-sm text-muted-foreground">Track your submitted claims and their status.</p>
        </div>
        <Link
          to="/claims/new"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New Claim
        </Link>
      </div>

      {claims.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-20">
          <p className="text-muted-foreground">No claims yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {claims.map((claim, i) => {
            const status = statusConfig[claim.status as keyof typeof statusConfig];
            return (
              <motion.div
                key={claim.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className="glass-card p-6"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="font-serif text-base font-semibold text-foreground">{claim.product}</h3>
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${status.className}`}>
                        <status.icon className="h-3.5 w-3.5" />
                        {status.label}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{claim.id} · {claim.type} · {claim.date}</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{claim.description}</p>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CustomerClaims;
