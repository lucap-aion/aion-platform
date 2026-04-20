import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { LayoutGrid, List, Search } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { sendEmail } from "@/utils/sendEmail";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
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
  const slugPrefix = useAuthSlug();
  const navigate = useNavigate();
  const [view, _setView] = useState<"list" | "grid">(() => (localStorage.getItem("customer-covers-view") as "list" | "grid") || "list");
  const setView = (v: "list" | "grid") => { _setView(v); localStorage.setItem("customer-covers-view", v); };
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferCoverId, setTransferCoverId] = useState<number | null>(null);
  const [transferEmail, setTransferEmail] = useState("");
  const [isSubmittingTransfer, setIsSubmittingTransfer] = useState(false);
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { data: policies, isLoading } = useCustomerPolicies();

  // Derived from policies.claims — no separate query needed
  const getOpenClaim = (cover: any) =>
    (cover.claims ?? []).find((c: any) => c.status !== "closed");
  const hasClaim = (cover: any) => (cover.claims ?? []).length > 0;

  const handleTransfer = (id: number) => {
    setTransferCoverId(id);
    setTransferEmail("");
    setTransferOpen(true);
  };

  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferCover || !transferEmail.trim()) {
      return;
    }

    if (!profile?.id || !profile?.brand_id) {
      toast.error("Sign in again to request a transfer.");
      return;
    }

    setIsSubmittingTransfer(true);
    const emailError = await sendEmail("transfer_request", {
      customer: {
        first_name: profile.first_name ?? null,
        last_name: profile.last_name ?? null,
        email: profile.email ?? "",
      },
      recipient_email: transferEmail.trim(),
      cover: {
        policy_id: transferCover.id,
        product: getProductName(transferCover),
        brand: getBrandName(transferCover),
        brand_id: profile.brand_id,
      },
      portal_url: `${window.location.origin}${slugPrefix}`,
    });
    setIsSubmittingTransfer(false);

    if (emailError) {
      toast.error("Could not send transfer request. Please try again.");
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ["customer-policies", profile?.id, profile?.brand_id] });
    setTransferOpen(false);
    toast.success(`Cover transferred to ${transferEmail}`);
    setTransferEmail("");
  };

  const formatDate = (d: string | null) => d ? format(new Date(d), "MMM dd, yyyy") : "—";
  const getProductName = (p: any) => p.catalogues?.name || "Unknown Product";
  const getBrandName = (p: any) => p.brands?.name || "Unknown Brand";
  const getImage = (p: any) => p.catalogues?.picture || "/placeholder.svg";
  const getStatus = (p: any) => {
    const s = (p.status || "live").toLowerCase();
    if (s === "expired") return "Expired";
    if (p.expiration_date) {
      const diff = new Date(p.expiration_date).getTime() - Date.now();
      if (diff > 0 && diff < 30 * 24 * 60 * 60 * 1000) return "Expiring";
    }
    return "Active";
  };

  const displayedPolicies = policies?.filter((p) => {
    const matchesSearch = !search ||
      getProductName(p).toLowerCase().includes(search.toLowerCase()) ||
      getBrandName(p).toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || getStatus(p) === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const transferCover = policies?.find((p) => p.id === transferCoverId);

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
        <div className="mb-6 md:mb-8">
          <div className="h-8 w-36 bg-muted rounded-lg animate-pulse mb-2" />
          <div className="h-4 w-64 bg-muted rounded animate-pulse" />
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-card p-4 md:p-5">
              <div className="flex items-center gap-4 md:gap-6">
                <div className="h-16 w-16 md:h-20 md:w-20 shrink-0 rounded-xl bg-muted animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-40 bg-muted rounded animate-pulse" />
                  <div className="h-3 w-24 bg-muted rounded animate-pulse" />
                </div>
                <div className="hidden md:flex gap-3">
                  <div className="h-8 w-24 bg-muted rounded-lg animate-pulse" />
                  <div className="h-8 w-20 bg-muted rounded-lg animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">My Covers</h1>
            <p className="mt-1 text-sm text-muted-foreground">Track and manage protection for your luxury pieces.</p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border p-1 bg-card shrink-0">
            <button onClick={() => setView("list")} className={`rounded-md p-2 transition-colors ${view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <List className="h-4 w-4" />
            </button>
            <button onClick={() => setView("grid")} className={`rounded-md p-2 transition-colors ${view === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by product..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-input bg-background py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-[150px] rounded-lg border border-input bg-background text-sm">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Expiring">Expiring soon</SelectItem>
              <SelectItem value="Expired">Expired</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {!displayedPolicies?.length ? (
        <div className="glass-card flex flex-col items-center justify-center py-20">
          <p className="text-muted-foreground">No covers found.</p>
        </div>
      ) : view === "list" ? (
        <div className="space-y-4">
          {displayedPolicies.map((cover, i) => (
            <motion.div key={cover.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="glass-card p-4 md:p-5 transition-shadow hover:shadow-md cursor-pointer" onClick={() => navigate(`${slugPrefix}/covers/${cover.id}/view`)}>
              <div className="flex items-center gap-4 md:gap-6">
                <div className="h-16 w-16 md:h-20 md:w-20 shrink-0 overflow-hidden rounded-xl bg-white p-2">
                  <img src={getImage(cover)} alt={getProductName(cover)} className="h-full w-full object-contain " />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">#{cover.id || '-'}</p>
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
                <div className="hidden md:block text-center">
                  <p className="text-sm font-semibold text-foreground">€{(cover.selling_price || 0).toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Selling Price</p>
                </div>
                <div className="hidden sm:flex items-center gap-2 md:gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {getOpenClaim(cover) ? (
                    <Link to={`${slugPrefix}/claims?edit=${getOpenClaim(cover)?.id}`} className="rounded-lg bg-primary px-3 md:px-5 py-2 md:py-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">Manage Claim</Link>
                  ) : (
                    <Link to={`${slugPrefix}/claims/new?cover=${cover.id}`} className="rounded-lg bg-primary px-3 md:px-5 py-2 md:py-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">Open Claim</Link>
                  )}
                  <button onClick={() => handleTransfer(cover.id)} disabled={hasClaim(cover)} className="rounded-lg border border-border px-3 md:px-5 py-2 md:py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">Transfer</button>
                </div>
              </div>
              <div className="flex sm:hidden gap-2 mt-3 pt-3 border-t border-border" onClick={(e) => e.stopPropagation()}>
                {getOpenClaim(cover) ? (
                  <Link to={`${slugPrefix}/claims?edit=${getOpenClaim(cover)?.id}`} className="flex-1 text-center rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">Manage Claim</Link>
                ) : (
                  <Link to={`${slugPrefix}/claims/new?cover=${cover.id}`} className="flex-1 text-center rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">Open Claim</Link>
                )}
                <button onClick={() => handleTransfer(cover.id)} disabled={hasClaim(cover)} className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground disabled:opacity-40 disabled:cursor-not-allowed">Transfer</button>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayedPolicies.map((cover, i) => (
            <motion.div key={cover.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="glass-card overflow-hidden transition-shadow hover:shadow-md flex flex-col cursor-pointer" onClick={() => navigate(`${slugPrefix}/covers/${cover.id}/view`)}>
              <div className="flex items-center justify-center bg-white p-6">
                <img src={getImage(cover)} alt={getProductName(cover)} className="h-32 w-32 object-contain " />
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
                <div className="flex gap-2 mt-auto" onClick={(e) => e.stopPropagation()}>
                  {getOpenClaim(cover) ? (
                    <Link to={`${slugPrefix}/claims?edit=${getOpenClaim(cover)?.id}`} className="flex-1 text-center rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">Manage Claim</Link>
                  ) : (
                    <Link to={`${slugPrefix}/claims/new?cover=${cover.id}`} className="flex-1 text-center rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">Open Claim</Link>
                  )}
                  <button onClick={() => handleTransfer(cover.id)} disabled={hasClaim(cover)} className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">Transfer</button>
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
              <input type="email" placeholder="recipient@email.com" value={transferEmail} onChange={(e) => setTransferEmail(e.target.value)} className="w-full rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" required />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setTransferOpen(false)} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
              <button
                type="submit"
                disabled={isSubmittingTransfer}
                className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {isSubmittingTransfer ? "Sending" : "Send request"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CustomerCovers;
