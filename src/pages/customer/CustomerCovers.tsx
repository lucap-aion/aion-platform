import { useState } from "react";
import { motion } from "framer-motion";
import { LayoutGrid, List } from "lucide-react";
import { Link } from "react-router-dom";
import necklaceImg from "@/assets/product-necklace.png";
import ringImg from "@/assets/product-ring.png";
import braceletImg from "@/assets/product-bracelet.png";
import { Badge } from "@/components/ui/badge";
import { Badge } from "@/components/ui/badge";

const covers = [
  { id: "1", product: "Collana con pendente Nudo Petit", brand: "Pomellato", image: necklaceImg, startDate: "Mar 08, 2026", expirationDate: "Mar 12, 2027", status: "active" },
  { id: "2", product: "Anello Nudo Classic Amethyst", brand: "Pomellato", image: ringImg, startDate: "Jan 15, 2026", expirationDate: "Jan 15, 2027", status: "active" },
  { id: "3", product: "Bracciale Iconica Bold", brand: "Pomellato", image: braceletImg, startDate: "Dec 01, 2025", expirationDate: "Dec 01, 2026", status: "active" },
];

const CustomerCovers = () => {
  const [view, setView] = useState<"card" | "table">("card");

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      <div className="mb-6 md:mb-8 flex items-start justify-between">
        <div>
          <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">My Covers</h1>
          <p className="mt-1 text-sm text-muted-foreground">Track and manage protection for your luxury pieces.</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-1 bg-card">
          <button
            onClick={() => setView("card")}
            className={`rounded-md p-2 transition-colors ${view === "card" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setView("table")}
            className={`rounded-md p-2 transition-colors ${view === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {view === "card" ? (
        <div className="space-y-4">
          {covers.map((cover, i) => (
            <motion.div
              key={cover.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="glass-card p-4 md:p-5 transition-shadow hover:shadow-md"
            >
              <div className="flex items-center gap-4 md:gap-6">
                <div className="h-16 w-16 md:h-20 md:w-20 shrink-0 overflow-hidden rounded-lg bg-secondary/50 p-2">
                  <img src={cover.image} alt={cover.product} className="h-full w-full object-contain" />
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="font-serif text-sm md:text-base font-semibold text-foreground">{cover.product}</h3>
                  <p className="text-xs text-muted-foreground">{cover.brand}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 md:hidden">
                    <span className="text-xs text-muted-foreground">Start: <span className="text-foreground font-medium">{cover.startDate}</span></span>
                    <span className="text-xs text-muted-foreground">Exp: <span className="text-foreground font-medium">{cover.expirationDate}</span></span>
                  </div>
                </div>

                <div className="hidden md:block text-center">
                  <p className="text-sm font-semibold text-foreground">{cover.startDate}</p>
                  <p className="text-xs text-muted-foreground">Start Date</p>
                </div>

                <div className="hidden md:block text-center">
                  <p className="text-sm font-semibold text-foreground">{cover.expirationDate}</p>
                  <p className="text-xs text-muted-foreground">Expiration</p>
                </div>

                <div className="hidden sm:flex items-center gap-2 md:gap-3 shrink-0">
                  <Link to={`/claims/new?cover=${cover.id}`} className="rounded-lg bg-primary px-3 md:px-5 py-2 md:py-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                    Open Claim
                  </Link>
                  <button className="rounded-lg border border-border px-3 md:px-5 py-2 md:py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary">
                    Transfer
                  </button>
                </div>
              </div>

              {/* Mobile actions */}
              <div className="flex sm:hidden gap-2 mt-3 pt-3 border-t border-border">
                <Link to={`/claims/new?cover=${cover.id}`} className="flex-1 text-center rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">
                  Open Claim
                </Link>
                <button className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground">
                  Transfer
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-card overflow-hidden"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Image</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="hidden md:table-cell">Brand</TableHead>
                <TableHead className="hidden md:table-cell">Start Date</TableHead>
                <TableHead className="hidden sm:table-cell">Expiration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {covers.map((cover) => (
                <TableRow key={cover.id}>
                  <TableCell>
                    <div className="h-10 w-10 overflow-hidden rounded-md bg-secondary/50 p-1">
                      <img src={cover.image} alt={cover.product} className="h-full w-full object-contain" />
                    </div>
                  </TableCell>
                  <TableCell className="font-serif font-medium text-foreground">{cover.product}</TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">{cover.brand}</TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">{cover.startDate}</TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground">{cover.expirationDate}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-primary/30 text-primary bg-primary/5 capitalize">
                      {cover.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link to={`/claims/new?cover=${cover.id}`} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                        Claim
                      </Link>
                      <button className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary">
                        Transfer
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </motion.div>
      )}
    </div>
  );
};

export default CustomerCovers;
