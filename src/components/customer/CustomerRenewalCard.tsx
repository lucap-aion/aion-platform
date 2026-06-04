// CustomerRenewalCard — sits on /home right under the Vault hero whenever any
// of the customer's covers expires in the next 30 days. Silently renders
// nothing when there's nothing to nudge about. Same data the Cover Passport
// already shows; this is the proactive surface.

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Calendar, AlertTriangle, ArrowRight } from "lucide-react";
import { useCustomerPolicies } from "@/hooks/use-policies";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuthSlug } from "@/hooks/useAuthSlug";

type CoverRow = {
  id: number;
  status: string | null;
  start_date: string | null;
  expiration_date: string | null;
  selling_price: number | null;
  catalogues: { name?: string | null; picture?: string | null } | null;
};

const daysUntil = (iso: string | null) => {
  if (!iso) return Infinity;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
};

const CustomerRenewalCard = () => {
  const { data: policies } = useCustomerPolicies();
  const { t, locale } = useLanguage();
  const slugPrefix = useAuthSlug();

  // Pick LIVE covers expiring inside the next 30 days. Already-expired ones
  // are out of scope here — renewal isn't possible after the fact.
  const expiringSoon = useMemo(() => {
    return ((policies ?? []) as CoverRow[])
      .filter((p) => p.status === "live")
      .map((p) => ({ ...p, days: daysUntil(p.expiration_date) }))
      .filter((p) => p.days >= 0 && p.days <= 30)
      .sort((a, b) => a.days - b.days);
  }, [policies]);

  if (expiringSoon.length === 0) return null;

  // Tone: the soonest cover sets the urgency level. <=7 days = warn (rose),
  // <=14 = amber, else neutral.
  const minDays = expiringSoon[0].days;
  const tone =
    minDays <= 7
      ? "border-rose-500/40 bg-rose-500/[0.06]"
      : minDays <= 14
        ? "border-amber-500/40 bg-amber-500/[0.06]"
        : "border-border bg-card";

  const total = expiringSoon.length;
  const headline = total === 1
    ? t("renewalCard.single").replace("{n}", String(expiringSoon[0].days))
    : t("renewalCard.multi").replace("{n}", String(total)).replace("{soonest}", String(minDays));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border ${tone} p-5 md:p-6`}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card border border-border">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("renewalCard.label")}
          </p>
          <h3 className="font-serif text-lg md:text-xl font-bold text-foreground mt-0.5">
            {headline}
          </h3>
        </div>
      </div>

      {/* Up to 3 expiring rows — keeps the card compact even for collectors. */}
      <ul className="space-y-2 mb-4">
        {expiringSoon.slice(0, 3).map((c) => {
          const name = c.catalogues?.name ?? `Cover #${c.id}`;
          const expDate = c.expiration_date
            ? new Date(c.expiration_date).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", {
                day: "numeric", month: "short", year: "numeric",
              })
            : "—";
          return (
            <li key={c.id}>
              <Link
                to={`${slugPrefix}/covers/${c.id}/view`}
                className="group flex items-center gap-3 rounded-xl bg-card border border-border/60 p-3 transition-colors hover:border-primary/40"
              >
                <div className="h-10 w-10 shrink-0 rounded-lg bg-white p-1 border border-border/40">
                  {c.catalogues?.picture ? (
                    <img
                      src={c.catalogues.picture}
                      alt={name}
                      className="h-full w-full object-contain mix-blend-multiply"
                    />
                  ) : (
                    <Calendar className="h-full w-full text-muted-foreground p-1" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("renewalCard.expiresOn").replace("{date}", expDate)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-foreground tabular-nums">
                    {c.days}d
                  </p>
                  <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {total > 3 && (
        <Link
          to={`${slugPrefix}/covers`}
          className="text-xs font-medium text-primary hover:underline"
        >
          {t("renewalCard.viewAll").replace("{n}", String(total - 3))}
        </Link>
      )}
    </motion.div>
  );
};

export default CustomerRenewalCard;
