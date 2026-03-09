import { useState } from "react";
import { motion } from "framer-motion";
import { LayoutGrid, List } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useCustomerPolicies } from "@/hooks/use-policies";
import { format } from "date-fns";

const CustomerCovers = () => {
  const [view, setView] = useState<"list" | "grid">("list");
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferCoverId, setTransferCoverId] = useState<number | null>(null);
  const [transferEmail, setTransferEmail] = useState("");
  const { data: policies, isLoading } = useCustomerPolicies();

  const handleTransfer = (id: number) => {
    setTransferCoverId(id);
    setTransferEmail("");
    setTransferOpen(true);
  };

  const handleTransferSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTransferOpen(false);
    toast.success(`Transfer initiated to ${transferEmail}`);
  };

  const formatDate = (d: string | null) => d ? format(new Date(d), "MMM dd, yyyy") : "—";
  const getProductName = (p: any) => p.catalogues?.name || "Unknown Product";
  const getBrandName = (p: any) => p.brands?.name || "Unknown Brand";
  const getImage = (p: any) => p.catalogues?.picture || "/placeholder.svg";
  const getStatus = (p: any) => p.status || "active";

  const transferCover = policies?.find((p) => p.id === transferCoverId);

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 flex items-center justify-center min-h-[300px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8 flex items-start justify-between">
        <div>
          <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">My Covers</h1>
          <p className="mt-1 text-sm text-muted-foreground">Track and manage protection for your luxury pieces.</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-1 bg-card">
          <button onClick={() => setView("list")} className={`rounded-md p-2 transition-colors ${view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <List className="h-4 w-4" />
          </button>
          <button onClick={() => setView("grid")} className={`rounded-md p-2 transition-colors ${view === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!policies?.length ? (
        <div className="glass-card flex flex-col items-center justify-center py-20">
          <p className="text-muted-foreground">No covers found.</p>
        </div>
      ) : view === "list" ? (
        <div className="space-y-4">
          {policies.map((cover, i) => (
            <motion.div key={cover.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="glass-card p-4 md:p-5 transition-shadow hover:shadow-md">
              <div className="flex items-center gap-4 md:gap-6">
                <div className="h-16 w-16 md:h-20 md:w-20 shrink-0 overflow-hidden rounded-lg bg-secondary/50 p-2">
                  <img src={getImage(cover)} alt={getProductName(cover)} className="h-full w-full object-contain" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-serif text-sm md:text-base font-semibold text-foreground">{getProductName(cover)}</h3>
                  <p className="text-xs text-muted-foreground">{getBrandName(cover)}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 md:hidden">
                    <span className="text-xs text-muted-foreground">Start: <span className="text-foreground font-medium">{formatDate(cover.start_date)}</span></span>
                    <span className="text-xs text-muted-foreground">Exp: <span className="text-foreground font-medium">{formatDate(cover.expiration_date)}</span></span>
                  </div>
                </div>
                <div className="hidden md:block text-center">
                  <p className="text-sm font-semibold text-foreground">{formatDate(cover.start_date)}</p>
                  <p className="text-xs text-muted-foreground">Start Date</p>
                </div>
                <div className="hidden md:block text-center">
                  <p className="text-sm font-semibold text-foreground">{formatDate(cover.expiration_date)}</p>
                  <p className="text-xs text-muted-foreground">Expiration</p>
                </div>
                <div className="hidden sm:flex items-center gap-2 md:gap-3 shrink-0">
                  <Link to={`/claims/new?cover=${cover.id}`} className="rounded-lg bg-primary px-3 md:px-5 py-2 md:py-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">Open Claim</Link>
                  <button onClick={() => handleTransfer(cover.id)} className="rounded-lg border border-border px-3 md:px-5 py-2 md:py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary">Transfer</button>
                </div>
              </div>
              <div className="flex sm:hidden gap-2 mt-3 pt-3 border-t border-border">
                <Link to={`/claims/new?cover=${cover.id}`} className="flex-1 text-center rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">Open Claim</Link>
                <button onClick={() => handleTransfer(cover.id)} className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground">Transfer</button>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {policies.map((cover, i) => (
            <motion.div key={cover.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="glass-card overflow-hidden transition-shadow hover:shadow-md flex flex-col">
              <div className="flex items-center justify-center bg-secondary/30 p-6">
                <img src={getImage(cover)} alt={getProductName(cover)} className="h-32 w-32 object-contain" />
              </div>
              <div className="p-4 flex-1 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground">{getBrandName(cover)}</p>
                  <Badge variant="outline" className="border-primary/30 text-primary bg-primary/5 capitalize text-[10px]">{getStatus(cover)}</Badge>
                </div>
                <h3 className="font-serif text-sm font-semibold text-foreground mb-3">{getProductName(cover)}</h3>
                <div className="space-y-1 mb-4">
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">Start</span><span className="text-foreground font-medium">{formatDate(cover.start_date)}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">Expiration</span><span className="text-foreground font-medium">{formatDate(cover.expiration_date)}</span></div>
                </div>
                <div className="flex gap-2 mt-auto">
                  <Link to={`/claims/new?cover=${cover.id}`} className="flex-1 text-center rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">Open Claim</Link>
                  <button onClick={() => handleTransfer(cover.id)} className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-secondary">Transfer</button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Transfer Cover</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Enter the email address of the person you'd like to transfer
              {transferCover ? ` "${getProductName(transferCover)}"` : ""} to.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleTransferSubmit} className="space-y-4 mt-2">
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">Recipient Email</label>
              <input type="email" placeholder="recipient@email.com" value={transferEmail} onChange={(e) => setTransferEmail(e.target.value)} className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" required />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setTransferOpen(false)} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
              <button type="submit" className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">Transfer</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CustomerCovers;
