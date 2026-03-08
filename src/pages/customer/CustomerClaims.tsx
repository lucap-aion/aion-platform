import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Clock, CheckCircle2, XCircle, LayoutGrid, List, Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/LanguageContext";
import necklaceImg from "@/assets/product-necklace.png";
import ringImg from "@/assets/product-ring.png";
import braceletImg from "@/assets/product-bracelet.png";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const initialClaims = [
  {
    id: "CLM-001",
    product: "Anello Nudo Classic Amethyst",
    brand: "Pomellato",
    image: ringImg,
    type: "Accidental Damage",
    date: "Feb 20, 2026",
    status: "under_review",
    description: "Ring stone chipped after accidental drop on marble floor.",
    coverId: "COV-002",
    coverStart: "Jan 15, 2026",
    coverExpiry: "Jan 15, 2027",
    estimatedValue: "€3,200",
  },
  {
    id: "CLM-002",
    product: "Collana con pendente Nudo Petit",
    brand: "Pomellato",
    image: necklaceImg,
    type: "Theft",
    date: "Mar 01, 2026",
    status: "approved",
    description: "Necklace stolen during travel. Police report filed.",
    coverId: "COV-001",
    coverStart: "Mar 08, 2026",
    coverExpiry: "Mar 12, 2027",
    estimatedValue: "€5,400",
  },
  {
    id: "CLM-003",
    product: "Bracciale Iconica Bold",
    brand: "Pomellato",
    image: braceletImg,
    type: "Accidental Damage",
    date: "Mar 05, 2026",
    status: "rejected",
    description: "Clasp broken due to wear and tear. Not covered under policy.",
    coverId: "COV-003",
    coverStart: "Dec 01, 2025",
    coverExpiry: "Dec 01, 2026",
    estimatedValue: "€3,800",
  },
];

const statusConfig = {
  under_review: { label: "Under Review", labelIt: "In Revisione", icon: Clock, className: "bg-warning/10 text-warning border-warning/20" },
  approved: { label: "Approved", labelIt: "Approvato", icon: CheckCircle2, className: "bg-success/10 text-success border-success/20" },
  rejected: { label: "Rejected", labelIt: "Rifiutato", icon: XCircle, className: "bg-destructive/10 text-destructive border-destructive/20" },
} as const;

const CustomerClaims = () => {
  const [view, setView] = useState<"list" | "grid">("list");
  const [claims, setClaims] = useState(initialClaims);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editClaim, setEditClaim] = useState<typeof initialClaims[0] | null>(null);
  const [editForm, setEditForm] = useState({ type: "", description: "", incidentDate: "", incidentCity: "", incidentCountry: "" });
  const { locale } = useLanguage();

  const isEditable = (status: string) => status === "under_review";

  const handleDelete = (id: string) => {
    setClaims((prev) => prev.filter((c) => c.id !== id));
    setDeleteId(null);
  };

  const handleEditOpen = (claim: typeof initialClaims[0]) => {
    setEditClaim(claim);
    setEditForm({ type: claim.type, description: claim.description, incidentDate: claim.date, incidentCity: "", incidentCountry: "" });
  };

  const handleEditSave = () => {
    if (!editClaim) return;
    setClaims((prev) =>
      prev.map((c) =>
        c.id === editClaim.id ? { ...c, type: editForm.type, description: editForm.description } : c
      )
    );
    setEditClaim(null);
  };

  const statusLabel = (key: keyof typeof statusConfig) => {
    const cfg = statusConfig[key];
    return locale === "it" ? cfg.labelIt : cfg.label;
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">
            {locale === "en" ? "My Claims" : "I Miei Reclami"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {locale === "en" ? "Track your submitted claims and their status." : "Monitora i tuoi reclami e il loro stato."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-border p-1 bg-card">
            <button
              onClick={() => setView("list")}
              className={`rounded-md p-2 transition-colors ${view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setView("grid")}
              className={`rounded-md p-2 transition-colors ${view === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
          <Link
            to="/claims/new"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> {locale === "en" ? "New Claim" : "Nuovo Reclamo"}
          </Link>
        </div>
      </div>

      {claims.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-20">
          <p className="text-muted-foreground">{locale === "en" ? "No claims yet." : "Nessun reclamo."}</p>
        </div>
      ) : view === "list" ? (
        <div className="space-y-4">
          {claims.map((claim, i) => {
            const status = statusConfig[claim.status as keyof typeof statusConfig];
            const editable = isEditable(claim.status);
            return (
              <motion.div
                key={claim.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className="glass-card p-5 md:p-6"
              >
                <div className="flex gap-4 md:gap-6">
                  {/* Product image */}
                  <div className="h-16 w-16 md:h-20 md:w-20 shrink-0 overflow-hidden rounded-lg bg-secondary/50 p-2">
                    <img src={claim.image} alt={claim.product} className="h-full w-full object-contain" />
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Header row */}
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-serif text-sm md:text-base font-semibold text-foreground">{claim.product}</h3>
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${status.className}`}>
                            <status.icon className="h-3.5 w-3.5" />
                            {statusLabel(claim.status as keyof typeof statusConfig)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {claim.id} · {claim.brand} · {claim.type} · {claim.date}
                        </p>
                      </div>
                      {editable && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleEditOpen(claim)}
                            className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            title={locale === "en" ? "Edit" : "Modifica"}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteId(claim.id)}
                            className="rounded-lg border border-destructive/30 p-2 text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
                            title={locale === "en" ? "Delete" : "Elimina"}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Description */}
                    <p className="text-sm text-muted-foreground mb-3">{claim.description}</p>

                    {/* Policy details */}
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                      <span className="text-muted-foreground">
                        {locale === "en" ? "Cover" : "Copertura"}: <span className="text-foreground font-medium">{claim.coverId}</span>
                      </span>
                      <span className="text-muted-foreground">
                        {locale === "en" ? "Valid" : "Valida"}: <span className="text-foreground font-medium">{claim.coverStart} – {claim.coverExpiry}</span>
                      </span>
                      <span className="text-muted-foreground">
                        {locale === "en" ? "Est. Value" : "Val. Stimato"}: <span className="text-foreground font-medium">{claim.estimatedValue}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {claims.map((claim, i) => {
            const status = statusConfig[claim.status as keyof typeof statusConfig];
            const editable = isEditable(claim.status);
            return (
              <motion.div
                key={claim.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className="glass-card overflow-hidden flex flex-col"
              >
                {/* Image */}
                <div className="flex items-center justify-center bg-secondary/30 p-6">
                  <img src={claim.image} alt={claim.product} className="h-28 w-28 object-contain" />
                </div>

                <div className="p-4 flex-1 flex flex-col">
                  {/* Status & brand */}
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-muted-foreground">{claim.brand}</p>
                    <Badge variant="outline" className={`capitalize text-[10px] ${status.className}`}>
                      <status.icon className="h-3 w-3 mr-1" />
                      {statusLabel(claim.status as keyof typeof statusConfig)}
                    </Badge>
                  </div>

                  <h3 className="font-serif text-sm font-semibold text-foreground mb-1">{claim.product}</h3>
                  <p className="text-xs text-muted-foreground mb-1">{claim.id} · {claim.type}</p>
                  <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{claim.description}</p>

                  {/* Policy info */}
                  <div className="space-y-1 mb-4 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{locale === "en" ? "Cover" : "Copertura"}</span>
                      <span className="text-foreground font-medium">{claim.coverId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{locale === "en" ? "Expiry" : "Scadenza"}</span>
                      <span className="text-foreground font-medium">{claim.coverExpiry}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{locale === "en" ? "Est. Value" : "Val. Stimato"}</span>
                      <span className="text-foreground font-medium">{claim.estimatedValue}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  {editable && (
                    <div className="flex gap-2 mt-auto">
                      <button
                        onClick={() => handleEditOpen(claim)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-secondary"
                      >
                        <Pencil className="h-3.5 w-3.5" /> {locale === "en" ? "Edit" : "Modifica"}
                      </button>
                      <button
                        onClick={() => setDeleteId(claim.id)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive/80 hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> {locale === "en" ? "Delete" : "Elimina"}
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Delete confirmation */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif">
              {locale === "en" ? "Delete Claim" : "Elimina Reclamo"}
            </DialogTitle>
            <DialogDescription>
              {locale === "en"
                ? "Are you sure you want to delete this claim? This action cannot be undone."
                : "Sei sicuro di voler eliminare questo reclamo? Questa azione non può essere annullata."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => setDeleteId(null)}
              className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground hover:bg-secondary"
            >
              {locale === "en" ? "Cancel" : "Annulla"}
            </button>
            <button
              onClick={() => deleteId && handleDelete(deleteId)}
              className="flex-1 rounded-lg bg-destructive py-2.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
            >
              {locale === "en" ? "Delete" : "Elimina"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editClaim} onOpenChange={() => setEditClaim(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">
              {locale === "en" ? "Edit Claim" : "Modifica Reclamo"}
            </DialogTitle>
            <DialogDescription>
              {editClaim?.id} — {editClaim?.product}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleEditSave();
            }}
            className="space-y-4 mt-2"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-foreground mb-1.5 block">
                  {locale === "en" ? "Claim Type" : "Tipo di Reclamo"}
                </label>
                <select
                  value={editForm.type}
                  onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                  className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                >
                  <option value="">Select Type</option>
                  {["Theft", "Accidental Damage", "Loss", "Other"].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1.5 block">
                  {locale === "en" ? "Incident Date" : "Data Incidente"}
                </label>
                <input
                  type="date"
                  value={editForm.incidentDate}
                  onChange={(e) => setEditForm({ ...editForm, incidentDate: e.target.value })}
                  className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1.5 block">
                  {locale === "en" ? "Incident City" : "Città Incidente"}
                </label>
                <input
                  type="text"
                  placeholder="Enter city"
                  value={editForm.incidentCity}
                  onChange={(e) => setEditForm({ ...editForm, incidentCity: e.target.value })}
                  className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1.5 block">
                  {locale === "en" ? "Incident Country" : "Paese Incidente"}
                </label>
                <select
                  value={editForm.incidentCountry}
                  onChange={(e) => setEditForm({ ...editForm, incidentCountry: e.target.value })}
                  className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                >
                  <option value="">Select Country</option>
                  {["Italy", "France", "United Kingdom", "Germany", "Switzerland", "United States", "Other"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">
                {locale === "en" ? "Description" : "Descrizione"}
              </label>
              <textarea
                rows={4}
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                required
              />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setEditClaim(null)}
                className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground hover:bg-secondary"
              >
                {locale === "en" ? "Cancel" : "Annulla"}
              </button>
              <button
                type="submit"
                className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {locale === "en" ? "Save Changes" : "Salva Modifiche"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CustomerClaims;
