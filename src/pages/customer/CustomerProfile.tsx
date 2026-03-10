import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { User, Mail, Phone, MapPin, Shield, Camera, Save, CheckCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const CustomerProfile = () => {
  const { toast } = useToast();
  const { profile: authProfile, refreshProfile } = useAuth();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [profile, setProfile] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    country: "",
    postalCode: "",
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notifications, setNotifications] = useState({
    claimUpdates: true,
    coverExpiry: true,
    promotions: false,
    newsletter: true,
    smsAlerts: false,
    emailDigest: true,
  });

  useEffect(() => {
    if (!authProfile) return;
    setAvatarUrl(authProfile.avatar ?? null);
    setProfile({
      firstName: authProfile.first_name || "",
      lastName: authProfile.last_name || "",
      email: authProfile.email || "",
      phone: authProfile.phone_number || "",
      address: authProfile.address || "",
      city: authProfile.city || "",
      country: authProfile.country || "",
      postalCode: authProfile.postcode || "",
    });
  }, [authProfile]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !authProfile?.id) return;
    setUploadingAvatar(true);
    const ext = file.name.split(".").pop();
    const path = `${authProfile.id}/avatar.${ext}`;
    const { error: uploadError } = await supabase.storage.from("profile_pictures").upload(path, file, { upsert: true });
    if (uploadError) {
      toast({ title: "Upload failed", description: uploadError.message });
      setUploadingAvatar(false);
      return;
    }
    const { data: { publicUrl } } = supabase.storage.from("profile_pictures").getPublicUrl(path);
    const url = `${publicUrl}?t=${Date.now()}`;
    await supabase.from("profiles").update({ avatar: url }).eq("id", authProfile.id);
    setAvatarUrl(url);
    setUploadingAvatar(false);
    toast({ title: "Photo updated" });
    await refreshProfile();
  };

  const handleProfileChange = (field: string, value: string) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveProfile = async () => {
    if (!authProfile?.id) return;
    setSavingProfile(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        first_name: profile.firstName || null,
        last_name: profile.lastName || null,
        phone_number: profile.phone || null,
        address: profile.address || null,
        city: profile.city || null,
        country: profile.country || null,
        postcode: profile.postalCode || null,
      })
      .eq("id", authProfile.id);
    setSavingProfile(false);

    if (error) {
      toast({
        title: "Profile update failed",
        description: error.message,
      });
      return;
    }

    toast({
      title: "Profile updated",
      description: "Your changes have been saved successfully.",
    });
  };

  const handleSavePassword = async () => {
    if (!newPassword || newPassword.length < 8) {
      toast({ title: "Password is too short", description: "Use at least 8 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Password mismatch", description: "The new password values do not match." });
      return;
    }

    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);

    if (error) {
      toast({ title: "Password update failed", description: error.message });
      return;
    }

    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    toast({ title: "Password updated", description: "Your password was updated." });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 md:px-6 md:py-8 space-y-8 animate-fade-in">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="font-serif text-3xl font-bold text-foreground">My Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your personal information and preferences.</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass-card p-6">
        <div className="flex items-center gap-6">
          <div className="relative">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 overflow-hidden">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <span className="font-serif text-2xl font-bold text-primary">
                  {(profile.firstName[0] || "A").toUpperCase()}
                  {(profile.lastName[0] || "U").toUpperCase()}
                </span>
              )}
            </div>
            <button
              type="button"
              disabled={uploadingAvatar}
              onClick={() => avatarInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-primary disabled:opacity-50"
            >
              <Camera className="h-4 w-4" />
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>
          <div>
            <h2 className="font-serif text-xl font-semibold text-foreground">
              {profile.firstName} {profile.lastName}
            </h2>
            <p className="text-sm text-muted-foreground">{profile.email}</p>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <CheckCircle className="h-3.5 w-3.5 text-[hsl(var(--success))]" />
              <span className="text-muted-foreground">Verified account</span>
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Tabs defaultValue="personal" className="space-y-6">
          <TabsList className="bg-secondary/60 border border-border/50">
            <TabsTrigger value="personal" className="data-[state=active]:bg-card">Personal Details</TabsTrigger>
            <TabsTrigger value="security" className="data-[state=active]:bg-card">Security</TabsTrigger>
          </TabsList>

          <TabsContent value="personal" className="space-y-6">
            <div className="glass-card p-6 space-y-6">
              <h3 className="font-serif text-lg font-semibold text-foreground">Personal Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">First Name</Label>
                  <Input value={profile.firstName} onChange={(e) => handleProfileChange("firstName", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Last Name</Label>
                  <Input value={profile.lastName} onChange={(e) => handleProfileChange("lastName", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input className="pl-10 bg-secondary/50 cursor-not-allowed" value={profile.email} readOnly disabled />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Phone</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input className="pl-10" value={profile.phone} onChange={(e) => handleProfileChange("phone", e.target.value)} />
                  </div>
                </div>
              </div>

              <Separator />

              <h3 className="font-serif text-lg font-semibold text-foreground">Address</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="col-span-2 space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Street Address</Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input className="pl-10" value={profile.address} onChange={(e) => handleProfileChange("address", e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">City</Label>
                  <Input value={profile.city} onChange={(e) => handleProfileChange("city", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Country</Label>
                  <Input value={profile.country} onChange={(e) => handleProfileChange("country", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Postal Code</Label>
                  <Input value={profile.postalCode} onChange={(e) => handleProfileChange("postalCode", e.target.value)} />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleSaveProfile}
                  disabled={savingProfile}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" /> Save Changes
                </button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="notifications" className="hidden">
            <div className="glass-card p-6 space-y-6">
              <h3 className="font-serif text-lg font-semibold text-foreground">Email Notifications</h3>
              <div className="space-y-5">
                {[
                  { key: "claimUpdates", label: "Claim Updates", desc: "Receive updates when your claim status changes." },
                  { key: "coverExpiry", label: "Cover Expiry Reminders", desc: "Get notified before your coverage expires." },
                  { key: "emailDigest", label: "Weekly Digest", desc: "A weekly summary of your account activity." },
                  { key: "newsletter", label: "Newsletter", desc: "Tips, news, and exclusive offers from partner brands." },
                  { key: "promotions", label: "Promotional Offers", desc: "Special deals and discounts on new covers." },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                    <Switch
                      checked={notifications[item.key as keyof typeof notifications]}
                      onCheckedChange={(val) => setNotifications((prev) => ({ ...prev, [item.key]: val }))}
                    />
                  </div>
                ))}
              </div>

              <Separator />

              <h3 className="font-serif text-lg font-semibold text-foreground">SMS Notifications</h3>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">SMS Alerts</p>
                  <p className="text-xs text-muted-foreground">Receive critical alerts via text message.</p>
                </div>
                <Switch
                  checked={notifications.smsAlerts}
                  onCheckedChange={(val) => setNotifications((prev) => ({ ...prev, smsAlerts: val }))}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="security" className="space-y-6">
            <div className="glass-card p-6 space-y-6">
              <h3 className="font-serif text-lg font-semibold text-foreground">Change Password</h3>
              <div className="max-w-md space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Current Password</Label>
                  <Input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">New Password</Label>
                  <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Confirm New Password</Label>
                  <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <button
                  onClick={handleSavePassword}
                  disabled={savingPassword}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  <Shield className="h-4 w-4" /> Update Password
                </button>
              </div>

              <Separator />

              <h3 className="font-serif text-lg font-semibold text-destructive">Danger Zone</h3>
              <button className="rounded-lg border border-destructive/30 px-5 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10">
                Delete Account
              </button>
            </div>
          </TabsContent>
        </Tabs>
      </motion.div>
    </div>
  );
};

export default CustomerProfile;
