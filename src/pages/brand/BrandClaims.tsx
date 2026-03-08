import { motion } from "framer-motion";
import { Search, Filter, Eye, CheckCircle2, XCircle } from "lucide-react";
import { Link } from "react-router-dom";

const claims = [
  { id: "CLM-047", customer: "Allegra Bianchi", product: "Anello Nudo Classic", type: "Accidental Damage", date: "Mar 07, 2026", status: "Under Review" },
  { id: "CLM-046", customer: "Marco Rossi", product: "Bracciale Iconica", type: "Theft", date: "Mar 05, 2026", status: "Approved" },
  { id: "CLM-045", customer: "Sofia Laurent", product: "Collana Nudo Petit", type: "Loss", date: "Mar 03, 2026", status: "Under Review" },
  { id: "CLM-044", customer: "Elena Conti", product: "Anello Nudo Classic", type: "Accidental Damage", date: "Feb 28, 2026", status: "Rejected" },
  { id: "CLM-043", customer: "Luca Ferrari", product: "Bracciale Iconica Bold", type: "Theft", date: "Feb 25, 2026", status: "Approved" },
];

const BrandClaims = () => {
  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      <div className="mb-6 md:mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">Claims</h1>
          <p className="mt-1 text-sm text-muted-foreground">Review and manage customer claims.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input type="text" placeholder="Search claims..." className="rounded-lg border border-input bg-background py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <button className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary">
            <Filter className="h-4 w-4" /> Filter
          </button>
        </div>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">ID</th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Customer</th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Product</th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Type</th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Date</th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {claims.map((claim) => (
              <tr key={claim.id} className="transition-colors hover:bg-secondary/30">
                <td className="px-6 py-4 text-sm font-medium text-foreground">{claim.id}</td>
                <td className="px-6 py-4 text-sm text-foreground">{claim.customer}</td>
                <td className="px-6 py-4 text-sm text-muted-foreground">{claim.product}</td>
                <td className="px-6 py-4 text-sm text-muted-foreground">{claim.type}</td>
                <td className="px-6 py-4 text-sm text-muted-foreground">{claim.date}</td>
                <td className="px-6 py-4">
                  <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${
                    claim.status === "Approved" ? "bg-success/10 text-success" :
                    claim.status === "Rejected" ? "bg-destructive/10 text-destructive" :
                    "bg-warning/10 text-warning"
                  }`}>
                    {claim.status}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <Link to={`/brand/claims/${claim.id}`} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" title="View">
                      <Eye className="h-4 w-4" />
                    </Link>
                    {claim.status === "Under Review" && (
                      <>
                        <button className="rounded-md p-1.5 text-success transition-colors hover:bg-success/10" title="Approve">
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                        <button className="rounded-md p-1.5 text-destructive transition-colors hover:bg-destructive/10" title="Reject">
                          <XCircle className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </motion.div>
    </div>
  );
};

export default BrandClaims;
