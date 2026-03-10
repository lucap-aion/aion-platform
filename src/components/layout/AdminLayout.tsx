import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AdminSidebar from "./AdminSidebar";
import HeaderControls from "./HeaderControls";

const AdminLayout = () => (
  <SidebarProvider>
    <div className="h-screen flex w-full bg-background overflow-hidden">
      <AdminSidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="shrink-0 flex h-14 items-center justify-between border-b border-border bg-background/80 backdrop-blur-sm px-4 md:px-6">
          <SidebarTrigger />
          <HeaderControls />
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  </SidebarProvider>
);

export default AdminLayout;
