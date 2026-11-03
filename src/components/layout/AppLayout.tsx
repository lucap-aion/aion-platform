import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AppSidebar from "./AppSidebar";
import HeaderControls from "./HeaderControls";
import { useTenant } from "@/contexts/TenantContext";
import SmartLogo from "@/components/SmartLogo";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import NotificationBell from "@/components/team/NotificationBell";
import { useAuth } from "@/contexts/AuthContext";

const AppLayout = () => {
  const tenant = useTenant();
  const { isBrandUser } = useAuth();

  return (
    <SidebarProvider>
      <div className="h-screen flex w-full bg-background overflow-hidden">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Banner + header stick together as one group so the view-as bar stays
              visible while scrolling without overlapping the header. */}
          <div className="sticky top-0 z-30">
            <ImpersonationBanner />
            <header className="flex h-14 items-center justify-between border-b border-border bg-background/80 backdrop-blur-sm px-4 md:px-6">
              <div className="flex items-center gap-3">
                {/* Desktop toggle now lives in the sidebar header; on mobile we
                    still need a trigger here to open the off-canvas drawer. */}
                <SidebarTrigger className="md:hidden" />
                <div className="md:hidden">
                  {tenant.logoUrl ? (
                    <SmartLogo src={tenant.logoUrl} alt={tenant.name} className="h-7 max-w-[120px] object-contain" />
                  ) : (
                    <span className="font-serif text-sm font-semibold text-foreground">{tenant.name}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {/* Team notifications: staff only — a client has no staff room. */}
                {isBrandUser && <NotificationBell />}
                <HeaderControls />
              </div>
            </header>
          </div>
          {/* overflow-x-hidden for the same reason as the admin shell: one child wider
              than the column would otherwise make the whole portal scroll sideways. */}
          <main className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default AppLayout;
