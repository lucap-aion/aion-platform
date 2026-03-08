import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AppSidebar from "./AppSidebar";
import HeaderControls from "./HeaderControls";
import { useTenant } from "@/contexts/TenantContext";

interface AppLayoutProps {
  mode: "customer" | "brand";
}

const AppLayout = ({ mode }: AppLayoutProps) => {
  const tenant = useTenant();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar mode={mode} />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/80 backdrop-blur-sm px-4 md:px-6">
            <div className="flex items-center">
              <SidebarTrigger className="mr-4" />
              <span className="font-serif text-sm font-medium text-muted-foreground md:hidden">
                {tenant.name}
              </span>
            </div>
            <HeaderControls />
          </header>
          <main className="flex-1 p-4 md:p-8">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default AppLayout;
