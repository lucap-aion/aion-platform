import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AppSidebar from "./AppSidebar";
import HeaderControls from "./HeaderControls";
import { useTenant } from "@/contexts/TenantContext";
import SmartLogo from "@/components/SmartLogo";

const AppLayout = () => {
  const tenant = useTenant();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/80 backdrop-blur-sm px-4 md:px-6">
            <div className="flex items-center gap-3">
              <SidebarTrigger />
              <div className="md:hidden">
                {tenant.logoUrl ? (
                  <SmartLogo src={tenant.logoUrl} alt={tenant.name} className="h-7 max-w-[120px] object-contain" />
                ) : (
                  <span className="font-serif text-sm font-semibold text-foreground">{tenant.name}</span>
                )}
              </div>
            </div>
            <HeaderControls />
          </header>
          <main className="flex-1">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default AppLayout;
