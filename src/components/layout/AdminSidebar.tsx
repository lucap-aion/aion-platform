import { House, Users, Building2, ClipboardList, Store, UserCog, LogOut, ChevronsUpDown, UserCircle, Package, TrendingUp, ShieldCheck, Users2, LineChart } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
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

const adminLinks = [
  { path: "/admin", icon: House, label: "Home" },
  { path: "/admin/admins", icon: UserCog, label: "Admins" },
  { path: "/admin/shop-assistants", icon: Users2, label: "Brand Users" },
  { path: "/admin/brands", icon: Building2, label: "Brands" },
  { path: "/admin/catalogues", icon: Package, label: "Catalogues" },
  { path: "/admin/claims", icon: ClipboardList, label: "Claims" },
  { path: "/admin/covers", icon: ShieldCheck, label: "Covers" },
  { path: "/admin/customers", icon: Users, label: "Customers" },
  { path: "/admin/insights", icon: LineChart, label: "Insights" },
  { path: "/admin/reports", icon: TrendingUp, label: "Reports" },
  { path: "/admin/stores", icon: Store, label: "Stores" },
];

const AdminSidebar = () => {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { adminRecord, signOut, user } = useAuth();
  const navigate = useNavigate();

  const profileName = `${adminRecord?.first_name || ""} ${adminRecord?.last_name || ""}`.trim() || user?.email || "Admin";
  const profileInitials = `${(adminRecord?.first_name?.[0] || "A").toUpperCase()}${(adminRecord?.last_name?.[0] || "D").toUpperCase()}`;
  const profileEmail = adminRecord?.email || user?.email || "—";
  const avatarUrl = adminRecord?.avatar;

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-card">
      <SidebarHeader className={collapsed ? "p-2" : "p-4"}>
        <div className={`flex items-center ${collapsed ? "justify-center" : "px-2"}`}>
          {collapsed ? (
            <img src="/aion_dark_icon.png" alt="AION" className="h-7 w-7 object-contain dark:brightness-0 dark:invert" />
          ) : (
            <img src="/aion_dark_logo.png" alt="AION" className="h-8 max-w-[140px] object-contain dark:brightness-0 dark:invert" />
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-widest text-muted-foreground">
            {collapsed ? "" : "Management"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminLinks.map((link) => {
                const isActive =
                  link.path === "/admin"
                    ? location.pathname === "/admin"
                    : location.pathname.startsWith(link.path);
                return (
                  <SidebarMenuItem key={link.path}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={link.label}>
                      <NavLink
                        to={link.path}
                        end
                        className="gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
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
      </SidebarContent>

      <SidebarFooter className={collapsed ? "p-1.5" : "p-3"}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={`flex w-full items-center rounded-lg hover:bg-muted transition-colors cursor-pointer ${collapsed ? "justify-center p-2" : "gap-3 px-3 py-2.5"}`}>
              <div className={`flex shrink-0 items-center justify-center rounded-full overflow-hidden ${collapsed ? "h-8 w-8" : "h-10 w-10"}`}>
                {avatarUrl ? (
                  <img src={avatarUrl} alt={profileName} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center bg-primary/10">
                    <span className={`font-semibold text-primary ${collapsed ? "text-xs" : "text-sm"}`}>{profileInitials}</span>
                  </div>
                )}
              </div>
              {!collapsed && (
                <>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-semibold text-foreground truncate">{profileName}</p>
                    <p className="text-xs text-muted-foreground truncate">{profileEmail}</p>
                  </div>
                  <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="cursor-pointer">
              <NavLink to="/admin/profile" className="flex items-center w-full">
                <UserCircle className="mr-2 h-4 w-4" />
                <span>My Profile</span>
              </NavLink>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="focus:text-destructive cursor-pointer" onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              <span>Logout</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
};

export default AdminSidebar;
