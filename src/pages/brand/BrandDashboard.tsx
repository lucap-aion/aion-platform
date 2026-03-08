import { motion } from "framer-motion";
import { Users, Shield, FileText, TrendingUp, ArrowUpRight, ArrowDownRight } from "lucide-react";

const stats = [
  { label: "Total Customers", value: "1,247", change: "+12%", up: true, icon: Users },
  { label: "Active Covers", value: "3,891", change: "+8%", up: true, icon: Shield },
  { label: "Open Claims", value: "23", change: "-5%", up: false, icon: FileText },
  { label: "Protected Value", value: "€4.2M", change: "+15%", up: true, icon: TrendingUp },
];

const recentClaims = [
  { id: "CLM-047", customer: "Allegra Bianchi", product: "Anello Nudo Classic", type: "Accidental Damage", date: "Mar 07, 2026", status: "Under Review" },
  { id: "CLM-046", customer: "Marco Rossi", product: "Bracciale Iconica", type: "Theft", date: "Mar 05, 2026", status: "Approved" },
  { id: "CLM-045", customer: "Sofia Laurent", product: "Collana Nudo Petit", type: "Loss", date: "Mar 03, 2026", status: "Under Review" },
];

const BrandDashboard = () => {
  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      <div className="mb-8">
        <h1 className="font-serif text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Overview of your brand's protection program.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-5 mb-8">
        {stats.map((stat, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="glass-card p-6"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <stat.icon className="h-5 w-5 text-primary" />
              </div>
              <span className={`inline-flex items-center gap-1 text-xs font-medium ${stat.up ? "text-success" : "text-destructive"}`}>
                {stat.up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                {stat.change}
              </span>
            </div>
            <p className="font-serif text-2xl font-bold text-foreground">{stat.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Recent Claims */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="glass-card"
      >
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 className="font-serif text-lg font-semibold text-foreground">Recent Claims</h2>
          <button className="text-xs font-medium text-primary hover:underline">View All</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-t border-border">
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Customer</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Product</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recentClaims.map((claim) => (
                <tr key={claim.id} className="transition-colors hover:bg-secondary/30">
                  <td className="px-6 py-4 text-sm font-medium text-foreground">{claim.id}</td>
                  <td className="px-6 py-4 text-sm text-foreground">{claim.customer}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{claim.product}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{claim.type}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{claim.date}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${
                      claim.status === "Approved" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                    }`}>
                      {claim.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
};

export default BrandDashboard;
