// Team discussions — the data side of the staff room.
//
// A house's staff open threads (on their own, or from an assistant answer),
// write messages that @mention colleagues, tag threads, and are notified in the
// app and by email. The rules live in the database (migration
// 20261103000002_team_discussions.sql): a message's brand and author are set by
// the trigger, mentions outside the house are dropped, and the notifications are
// written there too. This file only reads and writes through those rules.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sendEmail } from "@/utils/sendEmail";

// The tables are newer than the generated types; one cast here, typed rows out.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const STAFF_ROLES = ["brand", "brand_admin", "brand_user"];

export type Colleague = { id: string; email: string; name: string; initials: string };

export type ThreadContext = { question?: string; answer?: string; chat_id?: string | null };

export type TeamThread = {
  id: string;
  brand_id: number;
  title: string;
  created_by: string | null;
  status: "open" | "closed";
  tags: string[];
  context_type: "assistant_answer" | null;
  context_chat_id: string | null;
  context: ThreadContext | null;
  message_count: number;
  last_activity_at: string;
  created_at: string;
};

export type TeamMessage = {
  id: string;
  thread_id: string;
  author_profile_id: string | null;
  body: string;
  mentions: string[];
  created_at: string;
  edited_at: string | null;
};

export type TeamNotification = {
  id: string;
  thread_id: string;
  message_id: string | null;
  kind: "mention" | "reply";
  actor_profile_id: string | null;
  read_at: string | null;
  created_at: string;
  team_threads?: { title: string } | null;
  team_messages?: { body: string } | null;
};

const initialsOf = (first: string | null, last: string | null, email: string) =>
  `${(first?.[0] || email[0] || "?").toUpperCase()}${(last?.[0] || "").toUpperCase()}`;

/** Every staff member of the house (including me — callers filter as they need). */
export function useColleagues(brandId: number | null | undefined) {
  return useQuery({
    queryKey: ["team-colleagues", brandId],
    enabled: !!brandId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Colleague[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, first_name, last_name")
        .eq("brand_id", brandId as number)
        .in("role", STAFF_ROLES)
        .order("first_name");
      if (error) throw error;
      return ((data ?? []) as { id: string; email: string | null; first_name: string | null; last_name: string | null }[])
        .filter((r) => r.email)
        .map((r) => ({
          id: r.id,
          email: r.email as string,
          name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || (r.email as string),
          initials: initialsOf(r.first_name, r.last_name, r.email as string),
        }));
    },
  });
}

/**
 * Who a message mentions: every colleague whose "@Full Name" appears in it.
 * Longest names first, so "@Luca Pontone" is not also read as a "@Luca".
 * The database re-checks the list and drops anyone outside the house.
 */
export function mentionsIn(body: string, colleagues: Colleague[], selfId?: string | null): string[] {
  const lower = body.toLowerCase();
  const found = new Set<string>();
  let rest = lower;
  for (const c of [...colleagues].sort((a, b) => b.name.length - a.name.length)) {
    const tag = `@${c.name.toLowerCase()}`;
    if (rest.includes(tag)) {
      if (c.id !== selfId) found.add(c.id);
      rest = rest.split(tag).join(" ");
    }
  }
  return [...found];
}

/** Ask the server to email whoever this message notified. Best-effort: the in-app notification already exists. */
export function notifyByEmail(messageId: string) {
  void sendEmail("team_notify", { message_id: messageId });
}

export async function postMessage(args: {
  threadId: string; brandId: number; authorProfileId: string | null; body: string; mentions: string[];
}): Promise<TeamMessage> {
  const { data, error } = await db
    .from("team_messages")
    .insert({
      thread_id: args.threadId,
      brand_id: args.brandId,
      // Overwritten by the trigger for a staff member; used only when an AION
      // admin is viewing as this person.
      author_profile_id: args.authorProfileId,
      body: args.body.trim(),
      mentions: args.mentions,
    })
    .select("*")
    .single();
  if (error) throw error;
  const msg = data as TeamMessage;
  // Always: besides the people mentioned, the thread's followers were notified of a reply.
  notifyByEmail(msg.id);
  return msg;
}

export async function createThread(args: {
  brandId: number; createdBy: string | null; title: string; tags: string[];
  context?: ThreadContext | null; firstMessage: string; mentions: string[];
}): Promise<{ thread: TeamThread; message: TeamMessage }> {
  const { data, error } = await db
    .from("team_threads")
    .insert({
      brand_id: args.brandId,
      created_by: args.createdBy,
      title: args.title.trim().slice(0, 200),
      tags: args.tags,
      context_type: args.context ? "assistant_answer" : null,
      context_chat_id: args.context?.chat_id ?? null,
      context: args.context ? { question: args.context.question ?? "", answer: args.context.answer ?? "" } : null,
    })
    .select("*")
    .single();
  if (error) throw error;
  const thread = data as TeamThread;
  const message = await postMessage({
    threadId: thread.id, brandId: args.brandId, authorProfileId: args.createdBy,
    body: args.firstMessage, mentions: args.mentions,
  });
  return { thread, message };
}

/** Normalise free-typed tags: "Trunk show, #clienti " -> ["trunk show", "clienti"]. */
export function parseTags(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map((t) => t.replace(/^#/, "").trim().toLowerCase()).filter((t) => t && t.length <= 40))];
}

export function useUnreadTeamNotifications(profileId: string | null | undefined) {
  return useQuery({
    queryKey: ["team-notifications", profileId],
    enabled: !!profileId,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<TeamNotification[]> => {
      const { data, error } = await db
        .from("team_notifications")
        .select("id, thread_id, message_id, kind, actor_profile_id, read_at, created_at, team_threads(title), team_messages(body)")
        .eq("profile_id", profileId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as TeamNotification[];
    },
  });
}

export async function markNotificationsRead(ids: string[]) {
  if (!ids.length) return;
  await db.from("team_notifications").update({ read_at: new Date().toISOString() }).in("id", ids).is("read_at", null);
}

/** Mark everything I was notified about in one thread as read — opening it means I've seen it. */
export async function markThreadRead(profileId: string, threadId: string) {
  await db.from("team_notifications").update({ read_at: new Date().toISOString() })
    .eq("profile_id", profileId).eq("thread_id", threadId).is("read_at", null);
}

export { db as teamDb };
