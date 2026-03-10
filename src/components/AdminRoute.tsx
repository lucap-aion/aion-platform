import { Navigate } from "react-router-dom";
import { type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";

const Spinner = () => (
  <div className="h-screen flex items-center justify-center bg-background">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
  </div>
);

const AdminRoute = ({ children }: { children: ReactNode }) => {
  const { user, isAdmin, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/admin/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
};

export default AdminRoute;
