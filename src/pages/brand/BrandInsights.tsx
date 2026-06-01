import AdminInsights from "@/pages/admin/AdminInsights";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";

export default function BrandInsights() {
  const { profile } = useAuth();
  const tenant = useTenant();

  if (!profile?.brand_id) return null;

  return (
    <AdminInsights
      lockedBrandId={profile.brand_id}
      lockedBrandName={tenant?.name ?? ""}
    />
  );
}
