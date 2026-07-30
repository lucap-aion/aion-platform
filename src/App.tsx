import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthProvider } from "@/contexts/AuthContext";
import { isBrandRole, isCustomerRole, useAuth } from "@/contexts/AuthContext";
import { TenantProvider, useTenantStatus } from "@/contexts/TenantContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminRoute from "@/components/AdminRoute";
import Clarity from "@/components/Clarity";
import LandingPage from "./pages/LandingPage";
import Login from "./pages/auth/Login";
import Signup from "./pages/auth/Signup";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";
import FAQ from "./pages/FAQ";
import AppLayout from "./components/layout/AppLayout";
import AdminLayout from "./components/layout/AdminLayout";
import CustomerDashboard from "./pages/customer/CustomerDashboard";
import CustomerCovers from "./pages/customer/CustomerCovers";
import CustomerClaims from "./pages/customer/CustomerClaims";
import NewClaim from "./pages/customer/NewClaim";
import CustomerProfile from "./pages/customer/CustomerProfile";
import CustomerClaimDetail from "./pages/customer/CustomerClaimDetail";
import CustomerCoverDetail from "./pages/customer/CustomerCoverDetail";
import BrandDashboard from "./pages/brand/BrandDashboard";
import BrandCustomers from "./pages/brand/BrandCustomers";
import BrandCovers from "./pages/brand/BrandCovers";
import BrandClaims from "./pages/brand/BrandClaims";
import BrandClaimDetail from "./pages/brand/BrandClaimDetail";
import BrandCustomerDetail from "./pages/brand/BrandCustomerDetail";
import BrandCoverDetail from "./pages/brand/BrandCoverDetail";
import BrandTeam from "./pages/brand/BrandTeam";
import BrandInsights from "./pages/brand/BrandInsights";
import BrandAIQuery from "./pages/brand/BrandAIQuery";
import BrandAssistant from "./pages/brand/BrandAssistant";
import BrandKnowledge from "./pages/brand/BrandKnowledge";
import BrandShops from "./pages/brand/BrandShops";
import BrandShopDetail from "./pages/brand/BrandShopDetail";
import BrandRenewals from "./pages/brand/BrandRenewals";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminBrands from "./pages/admin/AdminBrands";
import AdminCustomers from "./pages/admin/AdminCustomers";
import AdminCustomerDetail from "./pages/admin/AdminCustomerDetail";
import AdminCovers from "./pages/admin/AdminCovers";
import AdminClaims from "./pages/admin/AdminClaims";
import AdminShops from "./pages/admin/AdminShops";
import AdminKnowledge from "./pages/admin/AdminKnowledge";
import AdminShopAssistants from "./pages/admin/AdminShopAssistants";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminForgotPassword from "./pages/admin/AdminForgotPassword";
import AdminRegister from "./pages/admin/AdminRegister";
import AdminProfile from "./pages/admin/AdminProfile";
import AdminAdmins from "./pages/admin/AdminAdmins";
import AdminCatalogues from "./pages/admin/AdminCatalogues";
import AdminReports from "./pages/admin/AdminReports";
import AdminInsights from "./pages/admin/AdminInsights";
import AdminFeedback from "./pages/admin/AdminFeedback";
import AdminAIQuery from "./pages/admin/AdminAIQuery";
import NotFound from "./pages/NotFound";

const TENANT_SLUG_KEY = "aion_tenant_slug";

const queryClient = new QueryClient();

const Spinner = () => (
  <div className="h-screen flex items-center justify-center bg-background">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
  </div>
);

const getSlugPrefix = () => {
  const s = sessionStorage.getItem(TENANT_SLUG_KEY);
  return s && s !== "default" ? `/${s}` : "";
};

/** Wraps auth-only pages: redirects away if user is already logged in */
const AuthRoute = ({ children }: { children: ReactNode }) => {
  const { user, profile, isAdmin, loading } = useAuth();
  if (loading) return <Spinner />;
  if (user) {
    if (isAdmin) return <Navigate to="/admin" replace />;
    const p = getSlugPrefix();
    if (p && profile) {
      if (isCustomerRole(profile.role)) return <Navigate to={`${p}/home`} replace />;
      if (isBrandRole(profile.role)) return <Navigate to={`${p}/dashboard`} replace />;
    }
  }
  return <>{children}</>;
};

/** Root `/` landing: redirect if logged in with a known slug, else show brand selector */
const AuthLanding = () => {
  const { user, profile, isAdmin, loading } = useAuth();
  if (loading) return <Spinner />;
  if (user) {
    if (isAdmin) return <Navigate to="/admin" replace />;
    const p = getSlugPrefix();
    if (p && profile) {
      if (isCustomerRole(profile.role)) return <Navigate to={`${p}/home`} replace />;
      if (isBrandRole(profile.role)) return <Navigate to={`${p}/dashboard`} replace />;
    }
  }
  return <LandingPage />;
};

/** Redirects to landing if the current slug doesn't exist in DB */
const BrandGuard = ({ children }: { children: ReactNode }) => {
  const { loading, notFound } = useTenantStatus();
  if (loading) return <Spinner />;
  if (notFound) return <Navigate to="/" replace />;
  return <>{children}</>;
};

/** Shared covers page — renders customer or brand view based on role */
const CoversPage = () => {
  const { isBrandUser, loading } = useAuth();
  if (loading) return <Spinner />;
  return isBrandUser ? <BrandCovers /> : <CustomerCovers />;
};

/** Shared claims page — renders customer or brand view based on role */
const ClaimsPage = () => {
  const { isBrandUser, loading } = useAuth();
  if (loading) return <Spinner />;
  return isBrandUser ? <BrandClaims /> : <CustomerClaims />;
};

/**
 * Handles /:slug (no sub-path).
 * Validates slug, stores it, then redirects to appropriate page.
 */
const TenantSlugEntry = () => {
  const { slug } = useParams<{ slug: string }>();
  const { user, profile, isAdmin, loading } = useAuth();
  const [brandChecked, setBrandChecked] = useState<"pending" | "found" | "notfound">("pending");

  useEffect(() => {
    if (!slug) { setBrandChecked("notfound"); return; }
    supabase
      .from("brands")
      .select("id")
      .eq("slug", slug)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          sessionStorage.setItem(TENANT_SLUG_KEY, slug);
          setBrandChecked("found");
        } else {
          setBrandChecked("notfound");
        }
      });
  }, [slug]);

  if (loading || brandChecked === "pending") return <Spinner />;
  if (brandChecked === "notfound") return <Navigate to="/" replace />;
  if (!user) return <Navigate to={`/${slug}/login`} replace />;
  if (isAdmin) return <Navigate to="/admin" replace />;
  if (isBrandRole(profile?.role)) return <Navigate to={`/${slug}/dashboard`} replace />;
  return <Navigate to={`/${slug}/home`} replace />;
};

const AdminProtectedLayout = () => (
  <AdminRoute>
    <AdminLayout />
  </AdminRoute>
);

// True on chat.aioncover.com / dev.chat.aioncover.com — the dedicated
// sales-assistant subdomain. The same SPA build serves every host (Vercel's
// catch-all rewrite), so the chat experience is selected here at runtime.
const isChatHost = () =>
  /(^|\.)chat\./i.test(window.location.hostname);

/**
 * Root `/` entry.
 * - On the normal app host: keep the historical redirect to /rc.
 * - On the chat subdomain: send the signed-in brand user straight to their
 *   brand's assistant; admins to /admin; everyone else to the brand selector.
 */
const RootEntry = () => {
  const { user, profile, isAdmin, loading } = useAuth();
  const [slug, setSlug] = useState<string | null>(null);
  const [slugChecked, setSlugChecked] = useState(false);

  const chatHost = isChatHost();

  useEffect(() => {
    if (!chatHost || !profile?.brand_id) { setSlugChecked(true); return; }
    let active = true;
    supabase
      .from("brands")
      .select("slug")
      .eq("id", profile.brand_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setSlug((data?.slug as string | undefined) ?? null);
        setSlugChecked(true);
      });
    return () => { active = false; };
  }, [chatHost, profile?.brand_id]);

  if (!chatHost) return <Navigate to="/rc" replace />;
  if (loading) return <Spinner />;
  if (isAdmin) return <Navigate to="/admin" replace />;
  // Not signed in (or no brand profile): let them pick a brand, then log in.
  if (!user) return <LandingPage />;
  if (!slugChecked) return <Spinner />;
  if (slug) return <Navigate to={`/${slug}/assistant`} replace />;
  // Brand unknown — fall back to the selector rather than a dead end.
  return <LandingPage />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider delayDuration={150} skipDelayDuration={100}>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <TenantProvider>
        <AuthProvider>
          <Clarity />
          <Routes>
            {/* Root — host-aware (chat subdomain → assistant, else /rc) */}
            <Route path="/" element={<RootEntry />} />

            {/* Landing page bypass — view brand selector without auto-redirect to /rc */}
            <Route path="/all" element={<LandingPage />} />

            {/* Admin login */}
            <Route path="/admin/login" element={<AuthRoute><AdminLogin /></AuthRoute>} />
            <Route path="/admin/forgot-password" element={<AdminForgotPassword />} />
            <Route path="/admin/register" element={<AdminRegister />} />

            {/* Admin Platform */}
            <Route element={<AdminProtectedLayout />}>
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/brands" element={<AdminBrands />} />
              <Route path="/admin/customers" element={<AdminCustomers />} />
              <Route path="/admin/customers/:customerId" element={<AdminCustomerDetail />} />
              <Route path="/admin/covers" element={<AdminCovers />} />
              <Route path="/admin/claims" element={<AdminClaims />} />
              <Route path="/admin/stores" element={<AdminShops />} />
              <Route path="/admin/knowledge" element={<AdminKnowledge />} />
              <Route path="/admin/shop-assistants" element={<AdminShopAssistants />} />
              <Route path="/admin/profile" element={<AdminProfile />} />
              <Route path="/admin/admins" element={<AdminAdmins />} />
              <Route path="/admin/catalogues" element={<AdminCatalogues />} />
              <Route path="/admin/reports" element={<AdminReports />} />
              <Route path="/admin/insights" element={<AdminInsights />} />
              <Route path="/admin/feedback" element={<AdminFeedback />} />
              <Route path="/admin/ai-query" element={<AdminAIQuery />} />
            </Route>

            {/* Slug entry point: /:slug → redirect to login or home */}
            <Route path="/:slug" element={<TenantSlugEntry />} />

            {/* Slug-prefixed auth pages */}
            <Route path="/:slug/login" element={<BrandGuard><AuthRoute><Login /></AuthRoute></BrandGuard>} />
            <Route path="/:slug/signup" element={<BrandGuard><AuthRoute><Signup /></AuthRoute></BrandGuard>} />
            <Route path="/:slug/forgot-password" element={<BrandGuard><ForgotPassword /></BrandGuard>} />
            <Route path="/:slug/reset-password" element={<BrandGuard><ResetPassword /></BrandGuard>} />

            {/* Public FAQ — no auth required */}
            <Route path="/:slug/faq" element={<BrandGuard><FAQ /></BrandGuard>} />

            {/* Authenticated app — all pages use /:slug/page format */}
            <Route element={<BrandGuard><ProtectedRoute><AppLayout /></ProtectedRoute></BrandGuard>}>
              {/* Customer-only pages */}
              <Route path="/:slug/home" element={<ProtectedRoute mode="customer"><CustomerDashboard /></ProtectedRoute>} />
              <Route path="/:slug/profile" element={<ProtectedRoute><CustomerProfile /></ProtectedRoute>} />
              <Route path="/:slug/claims/new" element={<ProtectedRoute mode="customer"><NewClaim /></ProtectedRoute>} />
              <Route path="/:slug/claims/:claimId/view" element={<ProtectedRoute mode="customer"><CustomerClaimDetail /></ProtectedRoute>} />
              <Route path="/:slug/covers/:coverId/view" element={<ProtectedRoute mode="customer"><CustomerCoverDetail /></ProtectedRoute>} />

              {/* Brand-only pages */}
              <Route path="/:slug/dashboard" element={<ProtectedRoute mode="brand"><BrandDashboard /></ProtectedRoute>} />
              <Route path="/:slug/customers" element={<ProtectedRoute mode="brand"><BrandCustomers /></ProtectedRoute>} />
              <Route path="/:slug/team" element={<ProtectedRoute mode="brand"><BrandTeam /></ProtectedRoute>} />
              <Route path="/:slug/insights" element={<ProtectedRoute mode="brand"><BrandInsights /></ProtectedRoute>} />
              <Route path="/:slug/ai-query" element={<ProtectedRoute mode="brand"><BrandAIQuery /></ProtectedRoute>} />
              <Route path="/:slug/assistant" element={<ProtectedRoute mode="brand"><BrandAssistant /></ProtectedRoute>} />
              <Route path="/:slug/knowledge" element={<ProtectedRoute mode="brand"><BrandKnowledge /></ProtectedRoute>} />
              <Route path="/:slug/shops" element={<ProtectedRoute mode="brand"><BrandShops /></ProtectedRoute>} />
              <Route path="/:slug/shops/:shopId" element={<ProtectedRoute mode="brand"><BrandShopDetail /></ProtectedRoute>} />
              <Route path="/:slug/renewals" element={<ProtectedRoute mode="brand"><BrandRenewals /></ProtectedRoute>} />
              <Route path="/:slug/claims/:claimId" element={<ProtectedRoute mode="brand"><BrandClaimDetail /></ProtectedRoute>} />
              <Route path="/:slug/customers/:customerId" element={<ProtectedRoute mode="brand"><BrandCustomerDetail /></ProtectedRoute>} />
              <Route path="/:slug/covers/:coverId" element={<ProtectedRoute mode="brand"><BrandCoverDetail /></ProtectedRoute>} />

              {/* Shared pages — content differs by role */}
              <Route path="/:slug/covers" element={<CoversPage />} />
              <Route path="/:slug/claims" element={<ClaimsPage />} />
            </Route>

            {/* Plain login/signup without slug → redirect to landing */}
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/signup" element={<Navigate to="/" replace />} />
            <Route path="/forgot-password" element={<Navigate to="/" replace />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
        </TenantProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
