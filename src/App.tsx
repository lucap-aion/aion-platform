import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import PortalSelector from "./pages/PortalSelector";
import Login from "./pages/auth/Login";
import Signup from "./pages/auth/Signup";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";
import AppLayout from "./components/layout/AppLayout";
import CustomerDashboard from "./pages/customer/CustomerDashboard";
import CustomerCovers from "./pages/customer/CustomerCovers";
import CustomerClaims from "./pages/customer/CustomerClaims";
import NewClaim from "./pages/customer/NewClaim";
import CustomerProfile from "./pages/customer/CustomerProfile";
import BrandDashboard from "./pages/brand/BrandDashboard";
import BrandCustomers from "./pages/brand/BrandCustomers";
import BrandCovers from "./pages/brand/BrandCovers";
import BrandClaims from "./pages/brand/BrandClaims";
import BrandSettings from "./pages/brand/BrandSettings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PortalSelector />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          
          {/* Customer Portal */}
          <Route element={<AppLayout mode="customer" />}>
            <Route path="/home" element={<CustomerDashboard />} />
            <Route path="/covers" element={<CustomerCovers />} />
            <Route path="/claims" element={<CustomerClaims />} />
            <Route path="/claims/new" element={<NewClaim />} />
          </Route>

          {/* Brand Portal */}
          <Route element={<AppLayout mode="brand" />}>
            <Route path="/brand" element={<BrandDashboard />} />
            <Route path="/brand/customers" element={<BrandCustomers />} />
            <Route path="/brand/covers" element={<BrandCovers />} />
            <Route path="/brand/claims" element={<BrandClaims />} />
            <Route path="/brand/settings" element={<BrandSettings />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
