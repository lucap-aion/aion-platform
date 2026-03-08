import { useState, useMemo } from "react";
import { Home, Shield, FileText, Users, BarChart3, Settings, HelpCircle, UserCircle, LogOut, BookOpen, Search, Send } from "lucide-react";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqItems = [
  { q: "What does my cover include?", a: "Your cover protects against theft, accidental damage, and loss for the duration of the coverage period." },
  { q: "How do I file a claim?", a: "Navigate to My Covers, select the covered item, and click 'Open Claim'. Follow the guided steps to submit your claim." },
  { q: "How long does claim processing take?", a: "Most claims are reviewed within 5–7 business days. You'll receive updates via email and in your dashboard." },
  { q: "Can I transfer my cover to someone else?", a: "Yes, you can transfer coverage by clicking the 'Transfer' button on any active cover and entering the recipient's details." },
  { q: "What happens when my cover expires?", a: "You'll be notified 30 days before expiration. You can renew directly from the My Covers page." },
];

interface AppSidebarProps {
  mode: "customer" | "brand";
}

const customerLinks = [
  { to: "/home", icon: Home, label: "Home" },
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
  const [faqOpen, setFaqOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [faqSearch, setFaqSearch] = useState("");
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const links = mode === "customer" ? customerLinks : brandLinks;

  return (
    <>
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
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setSupportOpen(true)}
                className="w-full rounded-lg bg-primary py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Contact Support
              </button>
              <button
                onClick={() => setFaqOpen(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Check our FAQ
              </button>
            </div>
          </div>
        )}
      </SidebarContent>

      <SidebarFooter className="p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-secondary transition-colors cursor-pointer">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <span className="text-sm font-semibold text-primary">AB</span>
              </div>
              {!collapsed && (
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-semibold text-foreground truncate">Allegra Bianchi</p>
                  <p className="text-xs text-muted-foreground truncate">allegra@email.com</p>
                </div>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem asChild>
              <NavLink to="/profile" end className="flex cursor-default">
                <UserCircle className="mr-2 h-4 w-4" />
                <span>My Profile</span>
              </NavLink>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="focus:text-destructive cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Logout</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>

    <Sheet open={faqOpen} onOpenChange={setFaqOpen}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle className="font-serif text-xl">Frequently Asked Questions</SheetTitle>
        </SheetHeader>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search questions..."
            value={faqSearch}
            onChange={(e) => setFaqSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-secondary/50 py-2.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <Accordion type="single" collapsible className="w-full">
          {faqItems
            .filter((item) => {
              if (!faqSearch.trim()) return true;
              const s = faqSearch.toLowerCase();
              return item.q.toLowerCase().includes(s) || item.a.toLowerCase().includes(s);
            })
            .map((item, i) => (
            <AccordionItem key={i} value={`faq-${i}`}>
              <AccordionTrigger className="text-sm text-left font-medium">{item.q}</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground leading-relaxed">{item.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </SheetContent>
    </Sheet>
    </>
  );
};

export default AppSidebar;
