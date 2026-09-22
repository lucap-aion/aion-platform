import { Navigate, useLocation } from "react-router-dom";
import { isBrandRole, isCustomerRole, useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";

// In an assistant-only demo these are the screens that stay. Everything else under a brand
// slug belongs to the insurance programme and is sent back to the assistant — the sidebar
// already hides it, and this is what makes a typed URL, a bookmark or a link inside a page
// behave the same way. Profile and logout are not product, so they stay reachable.
//
// Team is here because the sidebar KEEPS it in an assistant-only demo — "who can log in" is
// a fair question about an assistant — and this list did not. The two disagreeing is worse
// than either answer on its own: the link is drawn, it is tapped, and the redirect lands
// back on the assistant, which on a phone (where the drawer closes on the way) reads as a
// link that does nothing at all.
const ASSISTANT_ONLY_PATHS = [
  /\/assistant(\/|$)/, /\/knowledge(\/|$)/, /\/profile(\/|$)/, /\/team(\/|$)/,
];

interface ProtectedRouteProps {
  children: React.ReactNode;
  mode?: "customer" | "brand";
}

const getSlugPrefix = () => {
  const s = sessionStorage.getItem("aion_tenant_slug");
  return s && s !== "default" ? `/${s}` : "";
};

const ProtectedRoute = ({ children, mode }: ProtectedRouteProps) => {
  const { user, profile, loading } = useAuth();
  const { assistantOnly } = useTenant();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    const p = getSlugPrefix();
    return <Navigate to={`${p}/login`} replace state={{ from: location }} />;
  }

  if (mode === "customer" && !isCustomerRole(profile?.role)) {
    return <Navigate to={`${getSlugPrefix()}/dashboard`} replace />;
  }

  if (mode === "brand" && !isBrandRole(profile?.role)) {
    return <Navigate to={`${getSlugPrefix()}/home`} replace />;
  }

  if (mode === "brand" && assistantOnly
      && !ASSISTANT_ONLY_PATHS.some((re) => re.test(location.pathname))) {
    return <Navigate to={`${getSlugPrefix()}/assistant`} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
