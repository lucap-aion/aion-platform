import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Clock, CheckCircle2, LayoutGrid, List, Pencil, Trash2, FileText, Upload, X } from "lucide-react";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import { Link, useSearchParams } from "react-router-dom";
import SearchableSelect from "@/components/SearchableSelect";
import { CLAIM_TYPES, COUNTRIES } from "@/utils/countries";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { sendEmail } from "@/utils/sendEmail";
import { useCustomerClaims } from "@/hooks/use-claims";
import { useCustomerPolicies } from "@/hooks/use-policies";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ClaimRow = {
  id: number;
  type: string | null;
  description: string | null;
  status: string | null;
  incident_date: string | null;
  incident_city: string | null;
  incident_country: string | null;
  media?: string[] | null;
  created_at: string | null;
  policies: {
    id: number;
    brand_id: number | null;
    catalogues: { name: string | null; picture: string | null } | null;
    brands: { name: string | null } | null;
  } | null;
};

const statusConfig = {
  open: { label: "Open", icon: Clock, className: "bg-orange-50 text-orange-700 border-orange-200" },
  closed: { label: "Closed", icon: CheckCircle2, className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
} as const;

const toTitleCase = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const getStatusKey = (status: string | null | undefined): keyof typeof statusConfig =>
  (status || "").toLowerCase() === "closed" ? "closed" : "open";

const canEditClaim = (status: string | null | undefined) =>
  getStatusKey(status) !== "closed";

const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
};

const CustomerClaims = () => {
  const [view, _setView] = useState<"list" | "grid">(() => (localStorage.getItem("customer-claims-view") as "list" | "grid") || "list");
  const setView = (v: "list" | "grid") => { _setView(v); localStorage.setItem("customer-claims-view", v); };
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editClaim, setEditClaim] = useState<ClaimRow | null>(null);
  const [editForm, setEditForm] = useState({ type: "", description: "", incidentDate: "", incidentCity: "", incidentCountry: "" });
  const [editMedia, setEditMedia] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const editFileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { profile, user } = useAuth();
  const slugPrefix = useAuthSlug();

  const [searchParams] = useSearchParams();
  const { data: claims, isLoading, isFetching } = useCustomerClaims();
  const { data: policies } = useCustomerPolicies();
  const hasLiveCovers = (policies || []).some((p) => p.status === "live");

  // Auto-open edit dialog when navigated from "Manage Claim"
  useEffect(() => {
    const editId = Number(searchParams.get("edit"));
    if (!editId || !claims?.length) return;
    const target = claims.find((c) => c.id === editId);
    if (target && canEditClaim(target.status)) handleEditOpen(target as unknown as ClaimRow);
  }, [claims, searchParams]);

  const orderedClaims = useMemo(() => {
    return (claims || []).filter(Boolean);
  }, [claims]);


  const handleDelete = async () => {
    if (!deleteId) return;
    const target = orderedClaims.find((claim) => claim.id === deleteId);
    if (!target || !canEditClaim(target.status)) {
      toast.error("This claim cannot be deleted.");
      setDeleteId(null);
      return;
    }
    const { error } = await supabase.from("claims").delete().eq("id", deleteId);
    setDeleteId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["customer-claims", profile?.id] }),
      queryClient.invalidateQueries({ queryKey: ["customer-policies", profile?.id] }),
    ]);
    toast.success("Claim deleted");
  };

  const handleEditOpen = (claim: ClaimRow) => {
    setEditClaim(claim);
    setEditForm({
      type: claim.type || "",
      description: claim.description || "",
      incidentDate: claim.incident_date ? claim.incident_date.split("T")[0] : "",
      incidentCity: claim.incident_city || "",
      incidentCountry: claim.incident_country || "",
    });
    setEditMedia(Array.isArray(claim.media) ? [...claim.media] : []);
    setNewFiles([]);
  };

  const handleEditSave = async () => {
    if (!editClaim) return;
    setIsSavingEdit(true);

    // Upload new files
    const uploadedUrls: string[] = [];
    for (const file of newFiles) {
      const ext = file.name.split(".").pop();
      const path = `${profile?.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("claims_media").upload(path, file);
      if (uploadError) {
        toast.error(`Upload failed: ${uploadError.message}`);
        setIsSavingEdit(false);
        return;
      }
      const { data: { publicUrl } } = supabase.storage.from("claims_media").getPublicUrl(path);
      uploadedUrls.push(publicUrl);
    }

    const mergedMedia = [...editMedia, ...uploadedUrls];

    const { error } = await supabase.from("claims").update({
      type: editForm.type,
      description: editForm.description,
      incident_date: editForm.incidentDate || null,
      incident_city: editForm.incidentCity || null,
      incident_country: editForm.incidentCountry || null,
      media: mergedMedia,
    }).eq("id", editClaim.id);

    setIsSavingEdit(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ["customer-claims", profile?.id] });
    setEditClaim(null);
    toast.success("Claim updated");

    sendEmail("claim_updated", {
      claim: {
        claimId: editClaim.id,
        customerFirstName: profile?.first_name ?? "",
        customerLastName: profile?.last_name ?? "",
        customerEmail: profile?.email ?? "",
        product: editClaim.policies?.catalogues?.name ?? "Unknown Product",
        brand: editClaim.policies?.brands?.name ?? "Unknown Brand",
        brand_id: editClaim.policies?.brand_id ?? null,
        brandEmail: null,
        type: editForm.type,
        description: editForm.description,
        incidentDate: editForm.incidentDate || null,
      },
    });
  };

  const getProduct = (claim: ClaimRow | null | undefined) => claim?.policies?.catalogues?.name || "Unknown Product";
  const getBrand = (claim: ClaimRow | null | undefined) => claim?.policies?.brands?.name || "Unknown Brand";
  const getImage = (claim: ClaimRow | null | undefined) => claim?.policies?.catalogues?.picture || "/placeholder.svg";

  if (isLoading || (isFetching && !claims?.length)) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
        <div className="mb-6 md:mb-8">
          <div className="h-8 w-32 bg-muted rounded-lg animate-pulse mb-2" />
          <div className="h-4 w-56 bg-muted rounded animate-pulse" />
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-card p-5 md:p-6">
              <div className="flex gap-4 md:gap-6">
                <div className="h-16 w-16 md:h-20 md:w-20 shrink-0 rounded-xl bg-muted animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 bg-muted rounded animate-pulse" />
                  <div className="h-3 w-32 bg-muted rounded animate-pulse" />
                  <div className="h-3 w-full max-w-sm bg-muted rounded animate-pulse" />
                  <div className="h-3 w-40 bg-muted rounded animate-pulse" />
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">My Claims</h1>
            <p className="mt-1 text-sm text-muted-foreground">Track your submitted claims and their status.</p>
          </div>
          {hasLiveCovers ? (
            <Link
              to={user ? `${slugPrefix}/claims/new` : `${slugPrefix}/login`}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 self-start sm:self-auto"
            >
              <Plus className="h-4 w-4" /> New Claim
            </Link>
          ) : (
            <span
              title="You need an active cover to file a claim"
              className="inline-flex items-center gap-2 rounded-lg bg-primary/40 px-5 py-2.5 text-sm font-medium text-primary-foreground cursor-not-allowed self-start sm:self-auto"
            >
              <Plus className="h-4 w-4" /> New Claim
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
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
        </div>
      </div>

      {!orderedClaims.length ? (
        <div className="glass-card flex flex-col items-center justify-center py-20">
          <p className="text-muted-foreground">No claims yet.</p>
        </div>
      ) : view === "list" ? (
        <div className="space-y-4">
          {orderedClaims.map((claim, i) => {
            const key = getStatusKey(claim.status);
            const cfg = statusConfig[key];
            const editable = canEditClaim(claim.status);
            return (
              <Link key={claim.id} to={`${slugPrefix}/claims/${claim.id}/view`} className="block">
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                  className="glass-card p-5 md:p-6 cursor-pointer transition-shadow hover:shadow-md"
                >
                  <div className="flex gap-4 md:gap-6">
                    <div className="h-16 w-16 md:h-20 md:w-20 shrink-0 overflow-hidden rounded-xl bg-white p-2">
                      <img src={getImage(claim)} alt={getProduct(claim)} className="h-full w-full object-contain" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-serif text-sm md:text-base font-semibold text-foreground">{getProduct(claim)}</h3>
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${cfg.className}`}>
                              <cfg.icon className="h-3.5 w-3.5" />
                              {cfg.label}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            #{claim.id} · {getBrand(claim)} · {toTitleCase(claim.type || "General")} · {formatDate(claim.created_at)}
                          </p>
                        </div>
                        {editable && (
                          <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.preventDefault()}>
                            <button
                              onClick={(e) => { e.preventDefault(); handleEditOpen(claim); }}
                              className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              title="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={(e) => { e.preventDefault(); setDeleteId(claim.id); }}
                              className="rounded-lg border border-destructive/30 p-2 text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      <p className="text-sm text-muted-foreground mb-3">{claim.description || "No description provided."}</p>

                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                        <span className="text-muted-foreground">
                          Cover: <span className="text-foreground font-medium">#{claim.policies?.id || "—"}</span>
                        </span>
                        <span className="text-muted-foreground">
                          Incident: <span className="text-foreground font-medium">{formatDate(claim.incident_date)}</span>
                        </span>
                        <span className="text-muted-foreground">
                          Location: <span className="text-foreground font-medium">{claim.incident_city || "—"} {claim.incident_country ? `, ${claim.incident_country}` : ""}</span>
                        </span>
                      </div>

                      {Array.isArray(claim.media) && claim.media.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border/50" onClick={(e) => e.preventDefault()}>
                          {(claim.media as string[]).map((url, idx) => {
                            const ext = url.split("?")[0].split(".").pop()?.toLowerCase() || "";
                            const isImage = ["jpg","jpeg","png","gif","webp","avif","svg"].includes(ext);
                            return (
                              <a key={idx} href={url} target="_blank" rel="noopener noreferrer"
                                className="h-10 w-10 shrink-0 rounded-lg border border-border overflow-hidden bg-muted flex items-center justify-center hover:border-primary/40 transition-colors"
                              >
                                {isImage
                                  ? <img src={url} alt="" className="h-full w-full object-cover" />
                                  : <FileText className="h-5 w-5 text-muted-foreground" />}
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {orderedClaims.map((claim, i) => {
            const key = getStatusKey(claim.status);
            const cfg = statusConfig[key];
            return (
              <Link
                key={claim.id}
                to={`${slugPrefix}/claims/${claim.id}/view`}
              >
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                  className="glass-card overflow-hidden flex flex-col cursor-pointer transition-shadow hover:shadow-md"
                >
                  <div className="flex items-center justify-center bg-white p-6">
                    <img src={getImage(claim)} alt={getProduct(claim)} className="h-28 w-28 object-contain" />
                  </div>

                  <div className="p-4 flex-1 flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-muted-foreground">{getBrand(claim)}</p>
                      <Badge variant="outline" className={`capitalize text-[10px] ${cfg.className}`}>
                        <cfg.icon className="h-3 w-3 mr-1" />
                        {cfg.label}
                      </Badge>
                    </div>
                    <h3 className="font-serif text-sm font-semibold text-foreground mb-1">{getProduct(claim)}</h3>
                    <p className="text-xs text-muted-foreground mb-1">{claim.id} · {toTitleCase(claim.type || "General")}</p>
                    <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{claim.description || "No description provided."}</p>

                    <div className="space-y-1 mb-4 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Incident</span>
                        <span className="text-foreground font-medium">{formatDate(claim.incident_date)}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </Link>
            );
          })}
        </div>
      )}

      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif">Delete Claim</DialogTitle>
            <DialogDescription>Are you sure you want to delete this claim? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => setDeleteId(null)}
              className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              className="flex-1 rounded-lg bg-destructive py-2.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editClaim} onOpenChange={() => setEditClaim(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">Edit Claim</DialogTitle>
            <DialogDescription>
              {editClaim ? `${editClaim.id} — ${getProduct(editClaim)}` : "Selected claim"}
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
                <label className="text-xs font-medium text-foreground mb-1.5 block">Claim Type</label>
                <select
                  value={editForm.type}
                  onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                  className="w-full rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                >
                  <option value="">Select type</option>
                  {CLAIM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1.5 block">Incident Date</label>
                <input
                  type="date"
                  value={editForm.incidentDate}
                  max={new Date().toISOString().split("T")[0]}
                  onChange={(e) => setEditForm({ ...editForm, incidentDate: e.target.value })}
                  className="w-full rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">Incident City</label>
              <input
                value={editForm.incidentCity}
                onChange={(e) => setEditForm({ ...editForm, incidentCity: e.target.value })}
                className="w-full rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">Incident Country</label>
              <SearchableSelect
                value={editForm.incidentCountry}
                onChange={(v) => setEditForm({ ...editForm, incidentCountry: v })}
                options={COUNTRIES.map((c) => ({ value: c, label: c }))}
                placeholder="Select Country"
                searchPlaceholder="Search countries..."
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">Description</label>
              <textarea
                rows={4}
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                className="w-full rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">Files</label>
              <div className="flex flex-wrap gap-3">
                {editMedia.map((url, i) => {
                  const ext = url.split("?")[0].split(".").pop()?.toLowerCase() || "";
                  const isImage = ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].includes(ext);
                  return (
                    <div key={`existing-${i}`} className="relative group h-20 w-20 rounded-lg border border-border overflow-hidden bg-muted flex items-center justify-center shrink-0">
                      {isImage
                        ? <img src={url} alt={`file-${i}`} className="h-full w-full object-cover" />
                        : <FileText className="h-8 w-8 text-muted-foreground" />}
                      <button
                        type="button"
                        onClick={() => setEditMedia((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] truncate px-1 py-0.5">
                        {url.split("/").pop()?.split("?")[0] || `file-${i + 1}`}
                      </span>
                    </div>
                  );
                })}
                {newFiles.map((file, i) => (
                  <div key={`new-${i}`} className="relative group h-20 w-20 rounded-lg border border-primary/30 overflow-hidden bg-primary/5 flex items-center justify-center shrink-0">
                    {file.type.startsWith("image/")
                      ? <img src={URL.createObjectURL(file)} alt={file.name} className="h-full w-full object-cover" />
                      : <FileText className="h-8 w-8 text-muted-foreground" />}
                    <button
                      type="button"
                      onClick={() => setNewFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] truncate px-1 py-0.5">
                      {file.name}
                    </span>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => editFileRef.current?.click()}
                  className="h-20 w-20 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors shrink-0"
                >
                  <Upload className="h-5 w-5" />
                  <span className="text-[9px]">Add file</span>
                </button>
              </div>
              <input
                ref={editFileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) {
                    setNewFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
                  }
                  e.target.value = "";
                }}
              />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setEditClaim(null)}
                className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button type="submit" disabled={isSavingEdit} className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {isSavingEdit ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CustomerClaims;
