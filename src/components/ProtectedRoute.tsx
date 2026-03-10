import { Navigate, useLocation } from "react-router-dom";
import { isBrandRole, isCustomerRole, useAuth } from "@/contexts/AuthContext";

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

  return <>{children}</>;
};

export default ProtectedRoute;
