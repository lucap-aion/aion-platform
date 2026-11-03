// The bell in the brand header: who mentioned me, who replied, in which
// discussion. Clicking one opens the thread (and marks it read); the same
// notifications also went out by email.
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import { markNotificationsRead, useColleagues, useUnreadTeamNotifications } from "@/lib/team";

const tt = (locale: string, en: string, it: string) => (locale === "it" ? it : en);

export default function NotificationBell() {
  const { profile } = useAuth();
  const { locale } = useLanguage();
  const navigate = useNavigate();
  const slug = useAuthSlug();
  const qc = useQueryClient();
  const me = profile?.id ?? null;
  const { data: items = [] } = useUnreadTeamNotifications(me);
  const { data: colleagues = [] } = useColleagues(profile?.brand_id ?? null);
  const names = useMemo(() => new Map(colleagues.map((c) => [c.id, c.name])), [colleagues]);
  const unread = items.filter((n) => !n.read_at);

  const refresh = () => qc.invalidateQueries({ queryKey: ["team-notifications", me] });

  const openOne = async (id: string, threadId: string) => {
    await markNotificationsRead([id]);
    void refresh();
    navigate(`${slug}/discussions?thread=${threadId}`);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="tap-target relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={unread.length
            ? tt(locale, `${unread.length} unread notifications`, `${unread.length} notifiche non lette`)
            : tt(locale, "Notifications", "Notifiche")}
        >
          <Bell className="h-4 w-4" />
          {unread.length > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
              {unread.length > 9 ? "9+" : unread.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-sm font-semibold text-foreground">{tt(locale, "Notifications", "Notifiche")}</p>
          {unread.length > 0 && (
            <button
              type="button"
              onClick={async () => { await markNotificationsRead(unread.map((n) => n.id)); void refresh(); }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {tt(locale, "Mark all read", "Segna tutte come lette")}
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {tt(locale, "Nothing yet. When a colleague mentions you, it shows here.", "Ancora niente. Quando un collega ti menziona, compare qui.")}
          </p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {items.slice(0, 20).map((n) => {
              const who = (n.actor_profile_id && names.get(n.actor_profile_id)) || tt(locale, "A colleague", "Un collega");
              const title = n.team_threads?.title ?? "";
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void openOne(n.id, n.thread_id)}
                    className="flex w-full gap-2 border-b border-border px-3 py-2.5 text-left last:border-b-0 hover:bg-muted/60"
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-primary"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-foreground">
                        <span className="font-semibold">{who}</span>{" "}
                        {n.kind === "mention" ? tt(locale, "mentioned you in", "ti ha menzionato in") : tt(locale, "replied in", "ha risposto in")}{" "}
                        <span className="font-medium">{title}</span>
                      </span>
                      {n.team_messages?.body && (
                        <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{n.team_messages.body}</span>
                      )}
                      <span className="mt-0.5 block text-[11px] text-muted-foreground/80">
                        {new Date(n.created_at).toLocaleString(locale === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-border px-3 py-2">
          <button
            type="button"
            onClick={() => navigate(`${slug}/discussions`)}
            className="w-full rounded-md py-1 text-center text-xs font-medium text-primary hover:bg-muted"
          >
            {tt(locale, "Open discussions", "Apri le discussioni")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
