import { motion } from "framer-motion";
import { Shield, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import necklaceImg from "@/assets/product-necklace.png";
import ringImg from "@/assets/product-ring.png";
import braceletImg from "@/assets/product-bracelet.png";

const covers = [
  {
    id: "1",
    product: "Collana con pendente Nudo Petit",
    brand: "Pomellato",
    image: necklaceImg,
    startDate: "Mar 08, 2026",
    expirationDate: "Mar 12, 2027",
    status: "active",
  },
  {
    id: "2",
    product: "Anello Nudo Classic Amethyst",
    brand: "Pomellato",
    image: ringImg,
    startDate: "Jan 15, 2026",
    expirationDate: "Jan 15, 2027",
    status: "active",
  },
  {
    id: "3",
    product: "Bracciale Iconica Bold",
    brand: "Pomellato",
    image: braceletImg,
    startDate: "Dec 01, 2025",
    expirationDate: "Dec 01, 2026",
    status: "active",
  },
];

const CustomerCovers = () => {
  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      <div className="mb-8">
        <h1 className="font-serif text-3xl font-bold text-foreground">My Covers</h1>
        <p className="mt-1 text-sm text-muted-foreground">Track and manage protection for your luxury pieces.</p>
      </div>

      <div className="space-y-4">
        {covers.map((cover, i) => (
          <motion.div
            key={cover.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="glass-card flex items-center gap-6 p-5 transition-shadow hover:shadow-md"
          >
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-secondary/50 p-2">
              <img src={cover.image} alt={cover.product} className="h-full w-full object-contain" />
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="font-serif text-base font-semibold text-foreground">{cover.product}</h3>
              <p className="text-xs text-muted-foreground">{cover.brand}</p>
            </div>

            <div className="text-center">
              <p className="text-sm font-semibold text-foreground">{cover.startDate}</p>
              <p className="text-xs text-muted-foreground">Start Date</p>
            </div>

            <div className="text-center">
              <p className="text-sm font-semibold text-foreground">{cover.expirationDate}</p>
              <p className="text-xs text-muted-foreground">Expiration</p>
            </div>

            <div className="flex items-center gap-3">
              <Link
                to={`/claims/new?cover=${cover.id}`}
                className="rounded-lg bg-primary px-5 py-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Open Claim
              </Link>
              <button className="rounded-lg border border-border px-5 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary">
                Transfer
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default CustomerCovers;
