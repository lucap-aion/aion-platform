import { useRef, useState } from "react";
import { Home, Shield, FileText, Users, BarChart3, HelpCircle, UserCircle, LogOut, BookOpen, Search, Send, ChevronsUpDown, UserCog } from "lucide-react";
import { useLocation } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { sendEmail } from "@/utils/sendEmail";
import { useNavigate } from "react-router-dom";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import SmartLogo from "@/components/SmartLogo";
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
import { toast } from "sonner";

const customerPaths = [
  { path: "/home", icon: Home, labelKey: "nav.home" },
  { path: "/covers", icon: Shield, labelKey: "nav.myCovers" },
  { path: "/claims", icon: FileText, labelKey: "nav.myClaims" },
];

const brandPaths = [
  { path: "/dashboard", icon: BarChart3, labelKey: "nav.dashboard", exact: true },
  { path: "/customers", icon: Users, labelKey: "nav.customers" },
  { path: "/covers", icon: Shield, labelKey: "nav.covers" },
  { path: "/claims", icon: FileText, labelKey: "nav.claims" },
];

const brandMasterPaths = [
  { path: "/team", icon: UserCog, labelKey: "nav.team" },
];

const AppSidebar = () => {
  const { isBrandUser, canWrite } = useAuth();
  const mode = isBrandUser ? "brand" : "customer";
  const [faqOpen, setFaqOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [isSubmittingSupport, setIsSubmittingSupport] = useState(false);
  const [faqSearch, setFaqSearch] = useState("");
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const tenant = useTenant();
  const { t, locale } = useLanguage();

  const faqItems = (() => {
    const source = locale === "it" ? tenant.faqIt : tenant.faqEn;
    if (Array.isArray(source) && source.length > 0) {
      return (source as any[]).map((item) => ({
        q: item.title ?? item.question ?? "",
        a: item.content?.blocks
          ? (item.content.blocks as any[]).filter((b: any) => b.text).map((b: any) => b.text).join(" ")
          : (item.answer ?? ""),
      }));
    }
    return [] as { q: string; a: string }[];
  })();

  const { profile, signOut, user } = useAuth();
  const navigate = useNavigate();
  const slugPrefix = useAuthSlug();
  const paths = mode === "customer" ? customerPaths : brandPaths;
  const masterLinks = (mode === "brand" && canWrite)
    ? brandMasterPaths.map((l) => ({ ...l, to: `${slugPrefix}${l.path}`, label: t(l.labelKey) }))
    : [];
  const links = paths.map((l) => ({ ...l, to: `${slugPrefix}${l.path}`, label: t(l.labelKey) }));
  const profileName = `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim() || user?.email || "User";
  const profileInitials = `${(profile?.first_name?.[0] || user?.email?.[0] || "?").toUpperCase()}${(profile?.last_name?.[0] || "").toUpperCase()}`;
  const avatar = profile?.avatar;
  const profileEmail = profile?.email || user?.email || "—";
  const profileRoute = `${slugPrefix}/profile`;

  const handleSignOut = async () => {
    await signOut();
    navigate(`${slugPrefix}/login`);
  };

  const handleSupportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supportSubject.trim() || !supportMessage.trim()) return;

    if (!profile?.id || !profile?.brand_id) {
      toast.error(t("dashboard.feedbackSignInError"));
      return;
    }

    setIsSubmittingSupport(true);
    const { error } = await supabase.from("support_messages").insert({
      brand_id: profile.brand_id,
      customer_id: profile.id,
      message: `${supportSubject.trim()}\n\n${supportMessage.trim()}`,
    });
    setIsSubmittingSupport(false);

    if (error) { toast.error(error.message); return; }

    sendEmail("support_submitted", {
      user: {
        email: profile.email,
        firstName: profile.first_name ?? null,
      },
      message: {
        customer: {
          first_name: profile.first_name ?? null,
          last_name: profile.last_name ?? null,
          email: profile.email,
        },
        brand: { name: tenant.name, id: profile.brand_id },
        message: `${supportSubject.trim()}\n\n${supportMessage.trim()}`,
      },
    });
    setSupportSubject("");
    setSupportMessage("");
    setSupportOpen(false);
    toast.success(t("support.send"));
  };

  return (
    <>
    <Sidebar collapsible="icon" className="border-r border-border bg-card">
      <SidebarHeader className={collapsed ? "p-2" : "p-4"}>
        <div className={`flex items-center ${collapsed ? "justify-center" : "px-2"}`}>
          {collapsed ? (
            tenant.logoIconUrl
              ? <SmartLogo src={tenant.logoIconUrl} alt={tenant.name} className="h-8 w-8 object-contain" />
              : <span className="text-lg font-serif font-bold text-foreground">{tenant.logoInitial}</span>
          ) : (
            tenant.logoUrl
              ? <SmartLogo src={tenant.logoUrl} alt={tenant.name} className="h-10 max-w-[160px] object-contain" />
              : <span className="text-2xl font-serif font-bold text-foreground tracking-tight">{tenant.name}</span>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-widest text-muted-foreground">
            {collapsed ? "" : mode === "customer" ? t("nav.menu") : t("nav.management")}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {links.map((link) => {
                const isActive = location.pathname === link.to || (!(link as any).exact && location.pathname.startsWith(link.to + "/"));
                return (
                  <SidebarMenuItem key={link.to}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={link.label}>
                      <NavLink
                        to={link.to}
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

        {/* Master-only links */}
        {masterLinks.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs uppercase tracking-widest text-muted-foreground">
              {collapsed ? "" : t("nav.settings") || "Settings"}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {masterLinks.map((link) => {
                  const isActive = location.pathname === link.to || location.pathname.startsWith(link.to + "/");
                  return (
                    <SidebarMenuItem key={link.to}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={link.label}>
                        <NavLink
                          to={link.to}
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
        )}

        {/* Help Card - only when expanded */}
        {!collapsed && (
          <div className="mx-3 mt-auto rounded-xl border border-border bg-muted p-4">
            <div className="flex items-center gap-2 mb-2">
              <HelpCircle className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">{t("help.title")}</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">{t("help.desc")}</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setSupportOpen(true)}
                className="w-full rounded-lg bg-primary py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {t("help.contact")}
              </button>
              {mode === "customer" && (
                <button
                  onClick={() => setFaqOpen(true)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  {t("help.faq")}
                </button>
              )}
            </div>
          </div>
        )}
      </SidebarContent>

      <SidebarFooter className={collapsed ? "p-1.5" : "p-3"}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={`flex w-full items-center rounded-lg hover:bg-muted transition-colors cursor-pointer ${collapsed ? "justify-center p-2" : "gap-3 px-3 py-2.5"}`}>
              <div className={`flex shrink-0 items-center justify-center rounded-full bg-primary/10 overflow-hidden ${collapsed ? "h-8 w-8" : "h-10 w-10"}`}>
                {avatar ? (
                  <img src={avatar} alt="Profile" className="h-full w-full object-cover" />
                ) : (
                  <span className={`font-semibold text-primary ${collapsed ? "text-xs" : "text-sm"}`}>{profileInitials}</span>
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
            <DropdownMenuItem asChild>
              <NavLink to={profileRoute} end className="flex cursor-default">
                <UserCircle className="mr-2 h-4 w-4" />
                <span>{t("profile.myProfile")}</span>
              </NavLink>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="focus:text-destructive cursor-pointer" onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              <span>{t("profile.logout")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>

    <Sheet open={faqOpen} onOpenChange={setFaqOpen}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle className="font-serif text-xl">{t("faq.title")}</SheetTitle>
        </SheetHeader>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder={t("faq.search")}
            value={faqSearch}
            onChange={(e) => setFaqSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-muted py-2.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
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

    <Dialog open={supportOpen} onOpenChange={setSupportOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">{t("support.title")}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t("support.desc")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSupportSubmit} className="space-y-4 mt-2">
          <div>
            <label className="text-xs font-medium text-foreground mb-1.5 block">{t("support.subject")}</label>
            <input
              value={supportSubject}
              onChange={(e) => setSupportSubject(e.target.value)}
              type="text"
              maxLength={120}
              placeholder={t("support.subjectPlaceholder")}
              className="w-full rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground mb-1.5 block">{t("support.message")}</label>
            <textarea
              rows={4}
              value={supportMessage}
              onChange={(e) => setSupportMessage(e.target.value)}
              maxLength={1000}
              placeholder={t("support.messagePlaceholder")}
              className="w-full rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              required
            />
          </div>
          <button
            type="submit"
            disabled={isSubmittingSupport}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {t("support.send")}
          </button>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
};

export default AppSidebar;
