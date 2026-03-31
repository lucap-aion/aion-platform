import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const BrandSettings = () => {
  const { profile, canWrite } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    email: "",
    defaultCoverage: "2 Years",
    autoRenewal: "Enabled",
  });

  const { data: brand, isLoading } = useQuery({
    queryKey: ["brand-settings", profile?.brand_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id, name, email, website, activation_fee")
        .eq("id", profile?.brand_id || -1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!profile?.brand_id,
  });

  useEffect(() => {
    if (!brand) return;
    setForm({
      name: brand.name || "",
      email: brand.email || "",
      defaultCoverage: "2 Years",
      autoRenewal: "Enabled",
    });
  }, [brand]);

  const handleSave = async () => {
    if (!brand?.id) return;
    const { error } = await supabase
      .from("brands")
      .update({
        name: form.name || null,
        email: form.email || null,
      })
      .eq("id", brand.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["brand-settings", profile?.brand_id] });
    toast.success("Brand settings saved");
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
        <div className="mb-8 space-y-2">
          <div className="h-8 w-32 rounded-lg bg-secondary/60 animate-pulse" />
          <div className="h-4 w-56 rounded bg-secondary/40 animate-pulse" />
        </div>
        <div className="space-y-6">
          <div className="glass-card p-6 space-y-4">
            <div className="h-5 w-40 rounded bg-secondary/60 animate-pulse" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-2">
                <div className="h-3.5 w-24 rounded bg-secondary/40 animate-pulse" />
                <div className="h-10 w-full rounded-lg bg-secondary/40 animate-pulse" />
              </div>
              <div className="space-y-2">
                <div className="h-3.5 w-28 rounded bg-secondary/40 animate-pulse" />
                <div className="h-10 w-full rounded-lg bg-secondary/40 animate-pulse" />
              </div>
            </div>
          </div>
          <div className="glass-card p-6 space-y-4">
            <div className="h-5 w-44 rounded bg-secondary/60 animate-pulse" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-2">
                <div className="h-3.5 w-36 rounded bg-secondary/40 animate-pulse" />
                <div className="h-10 w-full rounded-lg bg-secondary/40 animate-pulse" />
              </div>
              <div className="space-y-2">
                <div className="h-3.5 w-24 rounded bg-secondary/40 animate-pulse" />
                <div className="h-10 w-full rounded-lg bg-secondary/40 animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-8">
        <h1 className="font-serif text-3xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your brand's platform settings.</p>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <div className="glass-card p-6">
          <h2 className="font-serif text-lg font-semibold text-foreground mb-4">Brand Information</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Brand Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                disabled={!canWrite}
                className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Contact Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                disabled={!canWrite}
                className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>
          </div>
        </div>

        <div className="glass-card p-6">
          <h2 className="font-serif text-lg font-semibold text-foreground mb-4">Coverage Settings</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Default Coverage Period</label>
              <select
                value={form.defaultCoverage}
                onChange={(e) => setForm((prev) => ({ ...prev, defaultCoverage: e.target.value }))}
                className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option>1 Year</option>
                <option>2 Years</option>
                <option>3 Years</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Auto-Renewal</label>
              <select
                value={form.autoRenewal}
                onChange={(e) => setForm((prev) => ({ ...prev, autoRenewal: e.target.value }))}
                className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option>Enabled</option>
                <option>Disabled</option>
              </select>
            </div>
          </div>
        </div>

        {canWrite && (
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              className="rounded-lg bg-primary px-8 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Save Changes
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default BrandSettings;
