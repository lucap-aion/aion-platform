import { useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { User, Mail, Save, Camera } from "lucide-react";

const AdminProfile = () => {
  const { adminRecord, user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [firstName, setFirstName] = useState(adminRecord?.first_name ?? "");
  const [lastName, setLastName] = useState(adminRecord?.last_name ?? "");
  const [phone, setPhone] = useState(adminRecord?.phone_number ?? "");
  const [city, setCity] = useState(adminRecord?.city ?? "");
  const [country, setCountry] = useState(adminRecord?.country ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(adminRecord?.avatar ?? null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !adminRecord?.id) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `admins/${adminRecord.id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("profile_pictures")
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("profile_pictures").getPublicUrl(path);
      const url = `${data.publicUrl}?t=${Date.now()}`;
      const { error: dbErr } = await supabase
        .from("admins")
        .update({ avatar: url })
        .eq("id", adminRecord.id);
      if (dbErr) throw dbErr;
      setAvatarUrl(url);
      toast({ title: "Photo updated" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminRecord?.id) return;
    setSaving(true);
    const { error } = await supabase
      .from("admins")
      .update({
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        phone_number: phone.trim() || null,
        city: city.trim() || null,
        country: country.trim() || null,
        avatar: avatarUrl,
      })
      .eq("id", adminRecord.id);
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Profile updated" });
    }
  };

  const initials = `${(firstName?.[0] || "A").toUpperCase()}${(lastName?.[0] || "D").toUpperCase()}`;

  const inputClass =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";
  const disabledClass =
    "w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground cursor-not-allowed";

  return (
    <div className="p-6 md:p-8 max-w-xl space-y-8">
      <div>
        <h1 className="font-serif text-2xl font-bold text-foreground">My Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your admin account details.</p>
      </div>

      {/* Avatar — single clickable photo */}
      <div className="flex items-center gap-5">
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="group relative h-20 w-20 shrink-0 rounded-full focus:outline-none"
          title="Change photo"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt={`${firstName} ${lastName}`} className="h-20 w-20 rounded-full object-cover border border-border" />
          ) : (
            <div className="h-20 w-20 rounded-full bg-primary/10 border border-border flex items-center justify-center">
              <span className="text-2xl font-bold text-primary">{initials}</span>
            </div>
          )}
          {/* Hover overlay */}
          <div className="absolute inset-0 rounded-full bg-black/40 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Camera className="h-5 w-5 text-white" />
            <span className="text-[10px] text-white mt-0.5 font-medium">{uploading ? "…" : "Change"}</span>
          </div>
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
        <div>
          <p className="text-lg font-semibold text-foreground">{`${firstName} ${lastName}`.trim() || "Admin"}</p>
          <p className="text-sm text-muted-foreground">{adminRecord?.email || user?.email || "—"}</p>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="mt-1 text-xs text-primary hover:underline disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Change photo"}
          </button>
        </div>
      </div>

      <form onSubmit={handleSave} className="rounded-xl border border-border bg-card p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-muted-foreground" /> First Name
            </label>
            <input className={inputClass} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-muted-foreground" /> Last Name
            </label>
            <input className={inputClass} value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5 text-muted-foreground" /> Email
          </label>
          <input disabled className={disabledClass} value={adminRecord?.email || user?.email || ""} />
          <p className="text-xs text-muted-foreground/70">Email is managed by your auth provider.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Phone</label>
            <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 000 0000" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">City</label>
            <input className={inputClass} value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Country</label>
          <input className={inputClass} value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" />
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AdminProfile;
