import { motion } from "framer-motion";
import { Search, Filter, Shield } from "lucide-react";
import necklaceImg from "@/assets/product-necklace.png";
import ringImg from "@/assets/product-ring.png";
import braceletImg from "@/assets/product-bracelet.png";

const covers = [
  { product: "Collana Nudo Petit", customer: "Allegra Bianchi", image: necklaceImg, start: "Mar 08, 2026", end: "Mar 12, 2027", status: "Active" },
  { product: "Anello Nudo Classic", customer: "Allegra Bianchi", image: ringImg, start: "Jan 15, 2026", end: "Jan 15, 2027", status: "Active" },
  { product: "Bracciale Iconica", customer: "Marco Rossi", image: braceletImg, start: "Dec 01, 2025", end: "Dec 01, 2026", status: "Active" },
  { product: "Collana Nudo Petit", customer: "Sofia Laurent", image: necklaceImg, start: "Nov 20, 2025", end: "Nov 20, 2026", status: "Expiring" },
  { product: "Anello Nudo Classic", customer: "Luca Ferrari", image: ringImg, start: "Aug 10, 2025", end: "Aug 10, 2026", status: "Expired" },
];

const BrandCovers = () => {
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
            <input type="text" placeholder="Search covers..." className="rounded-lg border border-input bg-background py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <button className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary">
            <Filter className="h-4 w-4" /> Filter
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {covers.map((cover, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass-card flex items-center gap-5 p-4 transition-shadow hover:shadow-md cursor-pointer"
          >
            <div className="h-14 w-14 shrink-0 rounded-lg bg-secondary/50 p-1.5">
              <img src={cover.image} alt={cover.product} className="h-full w-full object-contain" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">{cover.product}</p>
              <p className="text-xs text-muted-foreground">{cover.customer}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-foreground">{cover.start}</p>
              <p className="text-xs text-muted-foreground">Start</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-foreground">{cover.end}</p>
              <p className="text-xs text-muted-foreground">Expiration</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${
              cover.status === "Active" ? "bg-success/10 text-success" :
              cover.status === "Expiring" ? "bg-warning/10 text-warning" :
              "bg-muted text-muted-foreground"
            }`}>
              {cover.status}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default BrandCovers;
