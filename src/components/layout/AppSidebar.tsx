import { NavLink, useLocation } from "react-router-dom";
import { Home, Shield, FileText, Users, BarChart3, Settings, HelpCircle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface AppSidebarProps {
  mode: "customer" | "brand";
}

const customerLinks = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/covers", icon: Shield, label: "My Covers" },
  { to: "/claims", icon: FileText, label: "My Claims" },
];

const brandLinks = [
  { to: "/brand", icon: BarChart3, label: "Dashboard" },
  { to: "/brand/customers", icon: Users, label: "Customers" },
  { to: "/brand/covers", icon: Shield, label: "Covers" },
  { to: "/brand/claims", icon: FileText, label: "Claims" },
  { to: "/brand/settings", icon: Settings, label: "Settings" },
];

const AppSidebar = ({ mode }: AppSidebarProps) => {
  const location = useLocation();
  const links = mode === "customer" ? customerLinks : brandLinks;

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-72 flex-col border-r border-border bg-card">
      {/* Logo */}
      <div className="flex h-20 items-center px-8">
        <h1 className="font-serif text-2xl font-bold tracking-wide text-foreground">
          AION <span className="font-light text-primary">Cover</span>
        </h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-4 py-4">
        {links.map((link) => {
          const isActive = location.pathname === link.to;
          return (
            <NavLink
              key={link.to}
              to={link.to}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <link.icon className={cn("h-5 w-5", isActive && "text-primary")} />
              <span>{link.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Help Card */}
      <div className="mx-4 mb-4 rounded-xl border border-border bg-secondary/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <HelpCircle className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Need Help?</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">Contact our support team anytime.</p>
        <button className="w-full rounded-lg bg-primary py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">
          Contact Support
        </button>
      </div>

      {/* User */}
      <div className="border-t border-border px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <span className="text-sm font-semibold text-primary">AB</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">Allegra Bianchi</p>
            <p className="text-xs text-muted-foreground truncate">allegra@email.com</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </aside>
  );
};

export default AppSidebar;
