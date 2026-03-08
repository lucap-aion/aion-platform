import { Home, Shield, FileText, Users, BarChart3, Settings, HelpCircle, UserCircle, LogOut } from "lucide-react";
import { useLocation } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface AppSidebarProps {
  mode: "customer" | "brand";
}

const customerLinks = [
  { to: "/home", icon: Home, label: "Home" },
  { to: "/covers", icon: Shield, label: "My Covers" },
  { to: "/claims", icon: FileText, label: "My Claims" },
  { to: "/profile", icon: UserCircle, label: "My Profile" },
];

const brandLinks = [
  { to: "/brand", icon: BarChart3, label: "Dashboard" },
  { to: "/brand/customers", icon: Users, label: "Customers" },
  { to: "/brand/covers", icon: Shield, label: "Covers" },
  { to: "/brand/claims", icon: FileText, label: "Claims" },
  { to: "/brand/settings", icon: Settings, label: "Settings" },
];

const AppSidebar = ({ mode }: AppSidebarProps) => {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const links = mode === "customer" ? customerLinks : brandLinks;

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-card">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2 px-2">
          <span className="font-serif text-xl font-bold tracking-wide text-foreground">
            {collapsed ? "A" : <>AION <span className="font-light text-primary">Cover</span></>}
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-widest text-muted-foreground">
            {collapsed ? "" : mode === "customer" ? "Menu" : "Management"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {links.map((link) => {
                const isActive = location.pathname === link.to;
                return (
                  <SidebarMenuItem key={link.to}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={link.label}>
                      <NavLink
                        to={link.to}
                        end
                        className="gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:bg-secondary hover:text-foreground"
                        activeClassName="bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary"
                      >
                        <link.icon className="h-5 w-5 shrink-0" />
                        {!collapsed && <span>{link.label}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Help Card - only when expanded */}
        {!collapsed && (
          <div className="mx-3 mt-auto rounded-xl border border-border bg-secondary/50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <HelpCircle className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Need Help?</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">Contact our support team anytime.</p>
            <button className="w-full rounded-lg bg-primary py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">
              Contact Support
            </button>
          </div>
        )}
      </SidebarContent>

      <SidebarFooter className="p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-3 rounded-lg px-2 py-2 hover:bg-secondary transition-colors cursor-pointer">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <span className="text-xs font-semibold text-primary">AB</span>
              </div>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">Allegra Bianchi</p>
                  <p className="text-xs text-muted-foreground truncate">allegra@email.com</p>
                </div>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem className="focus:text-destructive cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Logout</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
};

export default AppSidebar;
