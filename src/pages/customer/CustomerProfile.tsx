import { useState } from "react";
import { motion } from "framer-motion";
import { User, Mail, Phone, MapPin, Bell, Shield, Camera, Save, CheckCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

const CustomerProfile = () => {
  const { toast } = useToast();
  const [profile, setProfile] = useState({
    firstName: "Allegra",
    lastName: "Bianchi",
    email: "allegra@email.com",
    phone: "+39 345 678 9012",
    address: "Via Montenapoleone 8",
    city: "Milano",
    country: "Italy",
    postalCode: "20121",
  });

  const [notifications, setNotifications] = useState({
    claimUpdates: true,
    coverExpiry: true,
    promotions: false,
    newsletter: true,
    smsAlerts: false,
    emailDigest: true,
  });

  const handleProfileChange = (field: string, value: string) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    toast({
      title: "Profile updated",
      description: "Your changes have been saved successfully.",
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="font-serif text-3xl font-bold text-foreground">My Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your personal information and preferences.</p>
      </motion.div>

      {/* Avatar Card */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass-card p-6">
        <div className="flex items-center gap-6">
          <div className="relative">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
              <span className="font-serif text-2xl font-bold text-primary">AB</span>
            </div>
            <button className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-primary">
              <Camera className="h-4 w-4" />
            </button>
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

      {/* Tabs */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Tabs defaultValue="personal" className="space-y-6">
          <TabsList className="bg-secondary/60 border border-border/50">
            <TabsTrigger value="personal" className="data-[state=active]:bg-card">Personal Details</TabsTrigger>
            <TabsTrigger value="notifications" className="data-[state=active]:bg-card">Notifications</TabsTrigger>
            <TabsTrigger value="security" className="data-[state=active]:bg-card">Security</TabsTrigger>
          </TabsList>

          {/* Personal Details Tab */}
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
                    <Input className="pl-10" value={profile.email} onChange={(e) => handleProfileChange("email", e.target.value)} />
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
                <button onClick={handleSave} className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                  <Save className="h-4 w-4" /> Save Changes
                </button>
              </div>
            </div>
          </TabsContent>

          {/* Notifications Tab */}
          <TabsContent value="notifications" className="space-y-6">
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

              <div className="flex justify-end pt-2">
                <button onClick={handleSave} className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                  <Save className="h-4 w-4" /> Save Preferences
                </button>
              </div>
            </div>
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security" className="space-y-6">
            <div className="glass-card p-6 space-y-6">
              <h3 className="font-serif text-lg font-semibold text-foreground">Change Password</h3>
              <div className="max-w-md space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Current Password</Label>
                  <Input type="password" placeholder="••••••••" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">New Password</Label>
                  <Input type="password" placeholder="••••••••" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Confirm New Password</Label>
                  <Input type="password" placeholder="••••••••" />
                </div>
                <button onClick={handleSave} className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                  <Shield className="h-4 w-4" /> Update Password
                </button>
              </div>

              <Separator />

              <h3 className="font-serif text-lg font-semibold text-foreground">Two-Factor Authentication</h3>
              <div className="flex items-center justify-between max-w-md">
                <div>
                  <p className="text-sm font-medium text-foreground">Enable 2FA</p>
                  <p className="text-xs text-muted-foreground">Add an extra layer of security to your account.</p>
                </div>
                <Switch />
              </div>

              <Separator />

              <h3 className="font-serif text-lg font-semibold text-foreground text-destructive">Danger Zone</h3>
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
