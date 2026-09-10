import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AdminSidebar from "./AdminSidebar";
import HeaderControls from "./HeaderControls";

const AdminLayout = () => (
  <SidebarProvider>
    <div className="h-screen flex w-full bg-background overflow-hidden">
      <AdminSidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* `ml-auto` on the controls rather than `justify-between` on the header.
            justify-between only pushes them right while there are two flex
            children, and the trigger beside them is `md:hidden` — which is
            display:none, so it leaves the flex layout entirely on desktop. One
            child and justify-between puts it at flex-START, which is how the
            language, theme and fullscreen buttons ended up on the left of the
            header at every desktop width. This pins them right whether the
            trigger is there or not. */}
        <header className="shrink-0 flex h-14 items-center gap-3 border-b border-border bg-background/80 backdrop-blur-sm px-4 md:px-6">
          {/* Desktop toggle lives in the sidebar's top-right corner; on mobile
              this trigger opens the off-canvas drawer. */}
          <SidebarTrigger className="md:hidden" />
          <div className="ml-auto">
            <HeaderControls />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  </SidebarProvider>
);

export default AdminLayout;
