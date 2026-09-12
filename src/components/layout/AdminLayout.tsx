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
        {/* overflow-x-hidden, not just overflow-y-auto.
            `overflow-y: auto` with `overflow-x: visible` is not a thing in CSS — the
            visible axis computes to `auto` — so any single child wider than the column
            turned the whole page into a horizontal scroller: the sidebar stayed put, the
            content slid off to the right, and you had to scroll sideways to read a form.
            One unbreakable identifier, one wide table, one fixed-width grid is enough.
            Clipping here keeps the page in the viewport; anything that genuinely needs
            more width (a table, a diagram) scrolls inside its own box, which is where a
            reader expects a sideways scrollbar to be. */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  </SidebarProvider>
);

export default AdminLayout;
