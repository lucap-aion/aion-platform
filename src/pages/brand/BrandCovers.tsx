import { motion } from "framer-motion";
import { Search, Filter } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import { useBrandPolicies } from "@/hooks/use-policies";

const BrandCovers = () => {
  const [search, setSearch] = useState("");
  const { data: policies, isLoading } = useBrandPolicies();

  const formatDate = (d: string | null) => d ? format(new Date(d), "MMM dd, yyyy") : "—";

  const getStatus = (p: any) => {
    if (!p.status) return "Active";
    if (p.status === "expired") return "Expired";
    if (p.expiration_date) {
      const exp = new Date(p.expiration_date);
      const now = new Date();
      const diff = exp.getTime() - now.getTime();
      if (diff < 30 * 24 * 60 * 60 * 1000 && diff > 0) return "Expiring";
    }
    return p.status.charAt(0).toUpperCase() + p.status.slice(1);
  };

  const filtered = policies?.filter((p) => {
    const name = p.catalogues?.name || "";
    const customer = `${p.profiles?.first_name || ""} ${p.profiles?.last_name || ""}`;
    return name.toLowerCase().includes(search.toLowerCase()) || customer.toLowerCase().includes(search.toLowerCase());
  });

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto flex items-center justify-center min-h-[300px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      <div className="mb-6 md:mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">Covers</h1>
          <p className="mt-1 text-sm text-muted-foreground">All product covers across your customer base.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input type="text" placeholder="Search covers..." value={search} onChange={(e) => setSearch(e.target.value)} className="rounded-lg border border-input bg-background py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <button className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary">
            <Filter className="h-4 w-4" /> Filter
          </button>
        </div>
      </div>

      {!filtered?.length ? (
        <div className="glass-card flex items-center justify-center py-20">
          <p className="text-muted-foreground">No covers found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((cover, i) => {
            const status = getStatus(cover);
            return (
              <motion.div
                key={cover.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass-card flex items-center gap-5 p-4 transition-shadow hover:shadow-md cursor-pointer"
              >
                <div className="h-14 w-14 shrink-0 rounded-lg bg-secondary/50 p-1.5">
                  <img src={cover.catalogues?.picture || "/placeholder.svg"} alt={cover.catalogues?.name || ""} className="h-full w-full object-contain" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{cover.catalogues?.name || "Unknown"}</p>
                  <p className="text-xs text-muted-foreground">{cover.profiles?.first_name} {cover.profiles?.last_name}</p>
                </div>
                <div className="hidden md:block text-center">
                  <p className="text-sm text-foreground">{formatDate(cover.start_date)}</p>
                  <p className="text-xs text-muted-foreground">Start</p>
                </div>
                <div className="hidden md:block text-center">
                  <p className="text-sm text-foreground">{formatDate(cover.expiration_date)}</p>
                  <p className="text-xs text-muted-foreground">Expiration</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                  status === "Active" ? "bg-success/10 text-success" :
                  status === "Expiring" ? "bg-warning/10 text-warning" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {status}
                </span>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BrandCovers;
