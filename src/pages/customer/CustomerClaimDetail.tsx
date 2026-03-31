import { useState, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Clock, CheckCircle2, Paperclip, Package, Image, FileText, File, ChevronLeft, ChevronRight, X, ExternalLink, Download, MapPin, Calendar, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useCustomerClaim } from "@/hooks/use-claims";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { sendEmail } from "@/utils/sendEmail";
import { CLAIM_TYPES, COUNTRIES } from "@/utils/countries";
import SearchableSelect from "@/components/SearchableSelect";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const statusConfig = {
  open: { color: "bg-amber-50 text-amber-700 border-amber-200", icon: Clock, label: "Open" },
  closed: { color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2, label: "Closed" },
} as const;

const normalizeStatus = (value?: string | null): keyof typeof statusConfig =>
  value === "closed" ? "closed" : "open";

const toLabel = (s: string | null | undefined) =>
  s ? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";

const getFileName = (url: string) => {
  try {
    const raw = url.split("/").pop()?.split("?")[0] || url;
    return decodeURIComponent(raw);
  } catch {
    return url;
  }
};

const CustomerClaimDetail = () => {
  const { claimId } = useParams();
  const navigate = useNavigate();
  const { data: claim, isLoading, refetch } = useCustomerClaim(claimId);
  const { profile } = useAuth();
  const slugPrefix = useAuthSlug();
  const queryClient = useQueryClient();
  const statusKey = normalizeStatus((claim as any)?.status);
  const status = statusConfig[statusKey];
  const policy = (claim as any)?.policies as any;
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const attachments: string[] = Array.isArray((claim as any)?.media) ? (claim as any).media : [];
  const editable = statusKey !== "closed";

  // Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ type: "", description: "", incidentDate: "", incidentCity: "", incidentCountry: "" });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const openEdit = () => {
    if (!claim) return;
    setEditForm({
      type: (claim as any).type || "",
      description: (claim as any).description || "",
      incidentDate: (claim as any).incident_date ? (claim as any).incident_date.split("T")[0] : "",
      incidentCity: (claim as any).incident_city || "",
      incidentCountry: (claim as any).incident_country || "",
    });
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!claim) return;
    const { error } = await supabase.from("claims").update({
      type: editForm.type,
      description: editForm.description,
      incident_date: editForm.incidentDate || null,
      incident_city: editForm.incidentCity || null,
      incident_country: editForm.incidentCountry || null,
    }).eq("id", claim.id);

    if (error) { toast.error(error.message); return; }
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ["customer-claims", profile?.id] }),
    ]);
    setEditOpen(false);
    toast.success("Claim updated");

    sendEmail("claim_updated", {
      claim: {
        claimId: claim.id,
        customerFirstName: profile?.first_name ?? "",
        customerLastName: profile?.last_name ?? "",
        customerEmail: profile?.email ?? "",
        product: policy?.catalogues?.name ?? "Unknown Product",
        brand: policy?.brands?.name ?? "Unknown Brand",
        brand_id: policy?.brands ? policy.brand_id : null,
        brandEmail: null,
        type: editForm.type,
        description: editForm.description,
        incidentDate: editForm.incidentDate || null,
      },
    });
  };

  const handleDelete = async () => {
    if (!claim) return;
    const { error } = await supabase.from("claims").delete().eq("id", claim.id);
    if (error) { toast.error(error.message); return; }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["customer-claims", profile?.id] }),
      queryClient.invalidateQueries({ queryKey: ["customer-policies", profile?.id] }),
    ]);
    toast.success("Claim deleted");
    navigate(`${slugPrefix}/claims`);
  };

  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxIndex(null);
      if (e.key === "ArrowLeft" && lightboxIndex > 0) setLightboxIndex((i) => (i ?? 0) - 1);
      if (e.key === "ArrowRight" && lightboxIndex < attachments.length - 1) setLightboxIndex((i) => (i ?? 0) + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, attachments.length]);

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
        <div className="mb-8 h-8 w-32 rounded-lg bg-secondary/60 animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {[1, 2].map((i) => (
              <div key={i} className="glass-card p-6 space-y-3">
                <div className="h-5 w-40 rounded bg-secondary/60 animate-pulse" />
                <div className="h-4 w-full rounded bg-secondary/40 animate-pulse" />
                <div className="h-4 w-3/4 rounded bg-secondary/40 animate-pulse" />
              </div>
            ))}
          </div>
          <div className="space-y-6">
            {[1, 2].map((i) => (
              <div key={i} className="glass-card p-6 space-y-3">
                <div className="h-5 w-28 rounded bg-secondary/60 animate-pulse" />
                <div className="h-4 w-full rounded bg-secondary/40 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!claim) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
        <div className="glass-card p-6">
          <p className="text-sm text-muted-foreground">Claim not found.</p>
          <button
            type="button"
            onClick={() => navigate(`${slugPrefix}/claims`)}
            className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Back to claims
          </button>
        </div>
      </div>
    );
  }

  const productName = policy?.catalogues?.name || "Unknown product";
  const brandName = policy?.brands?.name || "";

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8">
        <Link to={`${slugPrefix}/claims`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to My Claims
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {policy?.catalogues?.picture && (
              <div className="h-16 w-16 shrink-0 rounded-xl bg-gradient-to-br from-[#f5f0e8] to-[#ede8df] p-2">
                <img src={policy.catalogues.picture} alt={productName} className="h-full w-full object-contain mix-blend-multiply" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-3">
                <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">Claim #{claim.id}</h1>
                <Badge className={`${status.color} border`}>
                  <status.icon className="h-3 w-3 mr-1" /> {status.label}
                </Badge>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {productName}{brandName ? ` · ${brandName}` : ""}
              </p>
            </div>
          </div>
          {editable && (
            <div className="flex items-center gap-2 self-start shrink-0">
              <button
                onClick={openEdit}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 px-4 py-2 text-sm font-medium text-destructive/80 transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Description */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="glass-card p-6">
              <h2 className="text-base font-semibold text-foreground mb-3">Claim Description</h2>
              <Badge variant="outline" className="text-xs mb-3">{toLabel((claim as any).type) || "General"}</Badge>
              <p className="text-sm text-muted-foreground leading-relaxed">{(claim as any).description || "No description provided."}</p>
            </div>
          </motion.div>

          {/* Attachments */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <div className="glass-card p-6">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2 mb-4">
                <Paperclip className="h-4 w-4" /> Attached Files ({attachments.length})
              </h2>
              {attachments.length ? (
                <div className="grid grid-cols-2 gap-3">
                  {attachments.map((file: string, i: number) => {
                    const name = getFileName(file);
                    const ext = name.split(".").pop()?.toLowerCase() || "";
                    const isImage = ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].includes(ext);
                    const isPdf = ext === "pdf";
                    return (
                      <button
                        key={i}
                        onClick={() => setLightboxIndex(i)}
                        title={`${name} — click to expand`}
                        className="group relative rounded-xl border border-border bg-secondary/30 overflow-hidden transition-all hover:border-primary/40 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/40"
                      >
                        {isImage ? (
                          <img src={file} alt={name} className="w-full h-48 object-cover transition-transform group-hover:scale-[1.02]" />
                        ) : isPdf ? (
                          <div className="w-full h-48 pointer-events-none">
                            <embed src={file} type="application/pdf" className="w-full h-full" />
                          </div>
                        ) : (
                          <div className="flex h-36 w-full flex-col items-center justify-center gap-2 p-4">
                            <File className="h-10 w-10 text-muted-foreground" />
                            <span className="text-center text-xs text-muted-foreground leading-tight line-clamp-2">{name}</span>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors flex items-center justify-center">
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs font-medium bg-black/50 rounded-full px-3 py-1">Expand</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No files attached.</p>
              )}
            </div>
          </motion.div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Incident details */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <div className="glass-card p-6">
              <h3 className="text-base font-semibold text-foreground mb-4">Incident Details</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-2.5">
                  <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p className="font-medium text-foreground">
                      {(claim as any).incident_date ? new Date((claim as any).incident_date).toLocaleDateString() : "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Location</p>
                    <p className="font-medium text-foreground">
                      {[(claim as any).incident_city, (claim as any).incident_country].filter(Boolean).join(", ") || "—"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Product info */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <div className="glass-card p-6">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2 mb-4">
                <Package className="h-4 w-4" /> Covered Product
              </h3>
              <div className="space-y-2.5 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Product</p>
                  <p className="font-medium text-foreground">{productName}</p>
                </div>
                {brandName && (
                  <div>
                    <p className="text-xs text-muted-foreground">Brand</p>
                    <p className="font-medium text-foreground">{brandName}</p>
                  </div>
                )}
                {policy?.catalogues?.category && (
                  <div>
                    <p className="text-xs text-muted-foreground">Category</p>
                    <p className="font-medium text-foreground">{toLabel(policy.catalogues.category)}</p>
                  </div>
                )}
                {policy?.catalogues?.collection && (
                  <div>
                    <p className="text-xs text-muted-foreground">Collection</p>
                    <p className="font-medium text-foreground">{policy.catalogues.collection}</p>
                  </div>
                )}
                {policy?.id && (
                  <div>
                    <p className="text-xs text-muted-foreground">Cover ID</p>
                    <p className="font-medium text-foreground">#{policy.id}</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>

          {/* Submitted date */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <div className="glass-card p-6">
              <p className="text-xs text-muted-foreground">Submitted on</p>
              <p className="text-sm font-medium text-foreground mt-1">
                {(claim as any).created_at ? new Date((claim as any).created_at).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : "—"}
              </p>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && (() => {
        const file = attachments[lightboxIndex];
        const name = getFileName(file);
        const ext = name.split(".").pop()?.toLowerCase() || "";
        const isImage = ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].includes(ext);
        const isPdf = ext === "pdf";
        const hasPrev = lightboxIndex > 0;
        const hasNext = lightboxIndex < attachments.length - 1;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setLightboxIndex(null)}
          >
            <button
              className="absolute top-4 right-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
              onClick={() => setLightboxIndex(null)}
            >
              <X className="h-5 w-5" />
            </button>
            {hasPrev && (
              <button
                className="absolute left-4 top-1/2 -translate-y-1/2 z-10 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20 transition-colors"
                onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex - 1); }}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            {hasNext && (
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 z-10 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20 transition-colors"
                onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex + 1); }}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            )}
            <div
              className="relative max-h-[90vh] max-w-[90vw] flex flex-col items-center gap-3"
              onClick={(e) => e.stopPropagation()}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={lightboxIndex}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center justify-center"
                >
                  {isImage ? (
                    <img src={file} alt={name} className="max-h-[80vh] max-w-[85vw] rounded-xl object-contain shadow-2xl" />
                  ) : isPdf ? (
                    <div className="bg-white rounded-xl overflow-hidden shadow-2xl" style={{ width: "min(85vw, 800px)", height: "80vh" }}>
                      <embed src={file} type="application/pdf" className="w-full h-full" />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-4 rounded-xl bg-white/10 p-12 text-white">
                      <File className="h-16 w-16 opacity-60" />
                      <p className="text-sm font-medium opacity-80 max-w-xs text-center break-all">{name}</p>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
              <div className="flex items-center gap-4">
                <span className="text-white/60 text-xs">{lightboxIndex + 1} / {attachments.length}</span>
                <a
                  href={file}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20 transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open in tab
                </a>
                <a
                  href={file}
                  download={name}
                  className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Delete confirmation */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif">Delete Claim</DialogTitle>
            <DialogDescription>Are you sure you want to delete this claim? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-4">
            <button onClick={() => setConfirmDelete(false)} className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground hover:bg-secondary">Cancel</button>
            <button onClick={handleDelete} className="flex-1 rounded-lg bg-destructive py-2.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90">Delete</button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">Edit Claim</DialogTitle>
            <DialogDescription>#{claim?.id} — {productName}</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); handleEditSave(); }} className="space-y-4 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-foreground mb-1.5 block">Claim Type</label>
                <select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })} className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" required>
                  <option value="">Select type</option>
                  {CLAIM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1.5 block">Incident Date</label>
                <input type="date" value={editForm.incidentDate} max={new Date().toISOString().split("T")[0]} onChange={(e) => setEditForm({ ...editForm, incidentDate: e.target.value })} className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" required />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">Incident City</label>
              <input value={editForm.incidentCity} onChange={(e) => setEditForm({ ...editForm, incidentCity: e.target.value })} className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" required />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">Country</label>
              <SearchableSelect
                value={editForm.incidentCountry}
                onChange={(v) => setEditForm({ ...editForm, incidentCountry: v || "" })}
                options={COUNTRIES.map((c) => ({ value: c, label: c }))}
                placeholder="Select country"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">Description</label>
              <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={3} className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none" required />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setEditOpen(false)} className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground hover:bg-secondary">Cancel</button>
              <button type="submit" className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">Save Changes</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CustomerClaimDetail;
