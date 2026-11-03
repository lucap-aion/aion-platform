// Start a team discussion — from the Discussions page, or from an assistant
// answer (then the question and answer travel with the thread and go out in the
// first email, so a colleague can read what was found without opening the app).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import MentionTextarea, { Avatar } from "@/components/team/MentionTextarea";
import { createThread, mentionsIn, parseTags, useColleagues, type TeamThread, type ThreadContext } from "@/lib/team";

const tt = (locale: string, en: string, it: string) => (locale === "it" ? it : en);

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context?: ThreadContext | null;
  defaultTitle?: string;
  onCreated?: (thread: TeamThread) => void;
};

export default function NewThreadDialog({ open, onOpenChange, context, defaultTitle, onCreated }: Props) {
  const { profile } = useAuth();
  const { locale } = useLanguage();
  const navigate = useNavigate();
  const slug = useAuthSlug();
  const brandId = profile?.brand_id ?? null;
  const { data: everyone = [] } = useColleagues(brandId);
  const colleagues = everyone.filter((c) => c.id !== profile?.id);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setTitle((defaultTitle ?? "").slice(0, 200)); setBody(""); setTags(""); }
  }, [open, defaultTitle]);

  const mentioned = mentionsIn(body, everyone, profile?.id);

  const toggleMention = (name: string, id: string) => {
    if (mentioned.includes(id)) {
      setBody((b) => b.split(`@${name}`).join("").replace(/\s{2,}/g, " ").trimStart());
    } else {
      setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}@${name} `);
    }
  };

  const submit = async () => {
    if (!brandId || !title.trim() || !body.trim()) return;
    setSaving(true);
    try {
      const { thread } = await createThread({
        brandId, createdBy: profile?.id ?? null, title, tags: parseTags(tags),
        context: context ?? null, firstMessage: body, mentions: mentioned,
      });
      toast.success(mentioned.length
        ? tt(locale, `Discussion started — ${mentioned.length} notified.`, `Discussione avviata — ${mentioned.length} ${mentioned.length === 1 ? "persona avvisata" : "persone avvisate"}.`)
        : tt(locale, "Discussion started.", "Discussione avviata."), {
        action: { label: tt(locale, "Open", "Apri"), onClick: () => navigate(`${slug}/discussions?thread=${thread.id}`) },
      });
      onOpenChange(false);
      onCreated?.(thread);
    } catch (e) {
      console.error("[team new thread]", e);
      toast.error(tt(locale, "Couldn't start the discussion. Try again.", "Impossibile avviare la discussione. Riprova."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tt(locale, "Discuss with the team", "Discuti con il team")}</DialogTitle>
          <DialogDescription>
            {tt(locale,
              "Mention colleagues with @. They get a notification here and an email.",
              "Menziona i colleghi con @. Riceveranno una notifica qui e un'email.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {context?.answer && (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Sparkles className="h-3 w-3" /> {tt(locale, "Assistant answer attached", "Risposta dell'assistente allegata")}
              </p>
              {context.question && <p className="truncate text-sm font-medium text-foreground">{context.question}</p>}
              <p className="line-clamp-2 text-xs text-muted-foreground">{context.answer.replace(/[#*|_`>-]+/g, " ").replace(/\s+/g, " ").trim()}</p>
            </div>
          )}

          <div>
            <label htmlFor="thread-title" className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {tt(locale, "Subject", "Oggetto")}
            </label>
            <input
              id="thread-title"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
            />
          </div>

          {colleagues.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{tt(locale, "Mention", "Menziona")}</p>
              <div className="flex flex-wrap gap-1.5">
                {colleagues.map((c) => {
                  const on = mentioned.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleMention(c.name, c.id)}
                      className={`flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs transition-colors ${on ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground hover:bg-muted"}`}
                    >
                      <Avatar initials={c.initials} />
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="thread-body" className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {tt(locale, "Message", "Messaggio")}
            </label>
            <MentionTextarea
              id="thread-body"
              value={body}
              onChange={setBody}
              colleagues={colleagues}
              onSubmit={() => void submit()}
              rows={4}
              placeholder={tt(locale, "e.g. @Luchino can you check this before Thursday?", "es. @Luchino puoi verificarla prima di giovedì?")}
            />
          </div>

          <div>
            <label htmlFor="thread-tags" className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {tt(locale, "Tags (optional, comma separated)", "Tag (facoltativi, separati da virgola)")}
            </label>
            <input
              id="thread-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={tt(locale, "e.g. trunk show, clients", "es. trunk show, clienti")}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
            />
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted"
          >
            {tt(locale, "Cancel", "Annulla")}
          </button>
          <button
            type="button"
            disabled={saving || !title.trim() || !body.trim()}
            onClick={() => void submit()}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {tt(locale, "Start discussion", "Avvia discussione")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
