import { motion } from "framer-motion";
import { Search, Filter } from "lucide-react";

const customers = [
  { name: "Allegra Bianchi", email: "allegra@email.com", covers: 3, claims: 1, value: "€12,400", joined: "Jan 2025" },
  { name: "Marco Rossi", email: "marco.rossi@email.com", covers: 2, claims: 0, value: "€8,200", joined: "Mar 2025" },
  { name: "Sofia Laurent", email: "sofia.l@email.com", covers: 5, claims: 2, value: "€24,600", joined: "Nov 2024" },
  { name: "Elena Conti", email: "elena.c@email.com", covers: 1, claims: 0, value: "€3,900", joined: "Jun 2025" },
  { name: "Luca Ferrari", email: "l.ferrari@email.com", covers: 4, claims: 1, value: "€18,750", joined: "Feb 2025" },
];

const BrandCustomers = () => {
  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-bold text-foreground">Customers</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your brand's customer base.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search customers..."
              className="rounded-lg border border-input bg-background py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
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
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Customer</th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Covers</th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Claims</th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Protected Value</th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {customers.map((c, i) => (
              <tr key={i} className="cursor-pointer transition-colors hover:bg-secondary/30">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {c.name.split(" ").map(n => n[0]).join("")}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-foreground">{c.covers}</td>
                <td className="px-6 py-4 text-sm text-foreground">{c.claims}</td>
                <td className="px-6 py-4 text-sm font-medium text-foreground">{c.value}</td>
                <td className="px-6 py-4 text-sm text-muted-foreground">{c.joined}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </motion.div>
    </div>
  );
};

export default BrandCustomers;
