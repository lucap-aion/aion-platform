import { motion } from "framer-motion";
import { Search, Plus, Pencil, Trash2, X, Mail, Crown, UserCheck, UserX } from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { sendEmail } from "@/utils/sendEmail";
import { siteUrl } from "@/utils/siteUrl";
import { toast } from "sonner";

type TeamMember = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  is_master: boolean | null;
  status: string | null;
};

type MemberForm = {
  firstName: string;
  lastName: string;
  email: string;
  isMaster: boolean;
  status: string;
};

const EMPTY_FORM: MemberForm = {
  firstName: "",
  lastName: "",
  email: "",
  isMaster: false,
  status: "active",
};

const inputCls =
  "w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

const Field = ({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) => (
  <div>
    <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5 block">
      {label}{required && <span className="text-destructive ml-0.5">*</span>}
    </label>
    {children}
  </div>
);

const BrandTeam = () => {
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MemberForm>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const { profile, canWrite } = useAuth();
  const tenant = useTenant();
  const queryClient = useQueryClient();

  const { data: members, isLoading } = useQuery({
    queryKey: ["brand-team", profile?.brand_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, email, is_master, status")
        .eq("brand_id", profile?.brand_id)
        .eq("role", "brand")
        .order("first_name");
      if (error) throw error;
      return (data || []) as TeamMember[];
    },
    enabled: !!profile?.brand_id,
    staleTime: 5 * 60 * 1000,
  });

  const filtered = members?.filter((m) => {
    const name = `${m.first_name || ""} ${m.last_name || ""} ${m.email}`;
    return name.toLowerCase().includes(search.toLowerCase());
  });

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (m: TeamMember) => {
    setEditingId(m.id);
    setForm({
      firstName: m.first_name || "",
      lastName: m.last_name || "",
      email: m.email,
      isMaster: m.is_master ?? false,
      status: m.status || "active",
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!profile?.brand_id) return;
    if (!editingId && !form.email) {
      toast.error("Please fill in: Email.");
      return;
    }
    setIsSaving(true);

    if (editingId) {
      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: form.firstName || null,
          last_name: form.lastName || null,
          is_master: form.isMaster,
          status: form.status || null,
        })
        .eq("id", editingId);
      if (error) {
        toast.error(error.message);
        setIsSaving(false);
        return;
      }
      toast.success("Team member updated.");
    } else {
      const { error } = await supabase.from("profiles").insert({
        brand_id: profile.brand_id,
        first_name: form.firstName || null,
        last_name: form.lastName || null,
        email: form.email,
        role: "brand",
        is_master: form.isMaster,
        status: "pending",
      });
      if (error) {
        toast.error(error.message);
        setIsSaving(false);
        return;
      }
      // Send invite email
      const emailErr = await sendEmail("brand_user_invite", {
        brandUser: {
          email: form.email,
          first_name: form.firstName || null,
          brand_name: tenant.name,
          brand_id: profile?.brand_id,
        },
        url: `${siteUrl()}/${tenant.slug}/signup`,
      });
      if (emailErr) toast.error(`Invite email failed: ${emailErr}`);
      else toast.success(`Invite sent to ${form.email}`);
    }

    setIsSaving(false);
    setModalOpen(false);
    queryClient.invalidateQueries({ queryKey: ["brand-team"] });
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("profiles").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setConfirmDeleteId(null);
    toast.success("Team member removed.");
    queryClient.invalidateQueries({ queryKey: ["brand-team"] });
  };

  const handleResendInvite = async (m: TeamMember) => {
    setResendingId(m.id);
    const emailErr = await sendEmail("brand_user_invite", {
      brandUser: {
        email: m.email,
        first_name: m.first_name ?? null,
        brand_name: tenant.name,
        brand_id: profile?.brand_id,
      },
      url: `${siteUrl()}/${tenant.slug}/signup`,
    });
    setResendingId(null);
    if (emailErr) toast.error(`Failed to send invite: ${emailErr}`);
    else toast.success(`Invite resent to ${m.email}`);
  };

  if (!canWrite) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 md:px-6 md:py-8">
        <div className="glass-card p-6">
          <p className="text-sm text-muted-foreground">Access restricted to master users.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 md:px-6 md:py-8 flex items-center justify-center min-h-[300px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">Team</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage who has access to your brand portal.
            </p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 shrink-0"
          >
            <Plus className="h-4 w-4" /> Invite Member
          </button>
        </div>
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search team..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-input bg-background py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="border-b border-border">
                <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Member</th>
                <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Role</th>
                <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {!filtered?.length ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
                    No team members found.
                  </td>
                </tr>
              ) : (
                filtered.map((m) => {
                  const isPending = m.status === "pending" || !m.status;
                  return (
                    <tr key={m.id} className="transition-colors hover:bg-secondary/30">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary shrink-0">
                            {(m.first_name?.[0] || m.email[0] || "?").toUpperCase()}
                            {(m.last_name?.[0] || "").toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">
                              {m.first_name || m.last_name
                                ? `${m.first_name || ""} ${m.last_name || ""}`.trim()
                                : <span className="text-muted-foreground italic">No name</span>}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {m.is_master ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                            <Crown className="h-3 w-3" /> Master
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
                            <UserCheck className="h-3 w-3" /> Staff
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${
                          isPending
                            ? "bg-warning/10 text-warning"
                            : m.status === "active"
                            ? "bg-success/10 text-success"
                            : "bg-muted text-muted-foreground"
                        }`}>
                          {isPending ? "Pending" : m.status === "active" ? "Active" : (m.status || "—")}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5">
                          {isPending && (
                            <button
                              onClick={() => handleResendInvite(m)}
                              disabled={resendingId === m.id}
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
                              title="Resend invite"
                            >
                              <Mail className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => openEdit(m)}
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(m.id)}
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            title="Remove"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setModalOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-border/50">
              <div>
                <h2 className="font-serif text-lg font-semibold text-foreground">
                  {editingId ? "Edit Member" : "Invite Team Member"}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {editingId
                    ? "Update this member's details and access level."
                    : "An invitation email will be sent to the address you enter."}
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Personal */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Personal Information
                </p>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="First Name">
                      <input
                        type="text"
                        value={form.firstName}
                        onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))}
                        placeholder="First name"
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Last Name">
                      <input
                        type="text"
                        value={form.lastName}
                        onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))}
                        placeholder="Last name"
                        className={inputCls}
                      />
                    </Field>
                  </div>
                  <Field label="Email" required>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                      placeholder="colleague@brand.com"
                      disabled={!!editingId}
                      className={`${inputCls} disabled:opacity-50 disabled:cursor-not-allowed`}
                    />
                  </Field>
                </div>
              </div>

              {/* Access */}
              <div className="border-t border-border/50 pt-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Access Level
                </p>
                <div className="space-y-3">
                  <label className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-4 py-3 cursor-pointer hover:bg-secondary/50 transition-colors">
                    <div>
                      <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                        <Crown className="h-4 w-4 text-primary" /> Master Access
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Can create, edit, and delete records across the portal.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={form.isMaster}
                      onChange={(e) => setForm((p) => ({ ...p, isMaster: e.target.checked }))}
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                  </label>
                  {editingId && (
                    <Field label="Status">
                      <select
                        value={form.status}
                        onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
                        className={inputCls}
                      >
                        <option value="active">Active</option>
                        <option value="pending">Pending</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </Field>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-border/50">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-input px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {isSaving ? "Saving..." : editingId ? "Save Changes" : "Send Invite"}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setConfirmDeleteId(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5 border-b border-border/50">
              <h2 className="font-serif text-lg font-semibold text-foreground flex items-center gap-2">
                <UserX className="h-5 w-5 text-destructive" /> Remove member?
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                This will revoke their access to the brand portal. Their customer data will not be affected.
              </p>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-lg border border-input px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                className="rounded-lg bg-destructive px-5 py-2.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                Remove
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default BrandTeam;
