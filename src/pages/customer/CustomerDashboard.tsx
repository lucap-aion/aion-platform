import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Star, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import ProgressRing from "@/components/ui/progress-ring";
import { useTenant } from "@/contexts/TenantContext";
import SmartLogo from "@/components/SmartLogo";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { sendEmail } from "@/utils/sendEmail";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import sectionTheft from "@/assets/section-theft.jpg";
import sectionDamage from "@/assets/section-damage.jpg";
import sectionFaq from "@/assets/section-faq.jpg";
import sectionFeedback from "@/assets/section-feedback.jpg";
import sectionHowItWorks from "@/assets/section-how-it-works.jpg";

const FALLBACK_FAQ = [
  {
    q: { en: "What is the scope of the Prestige Service?", it: "Qual è l'ambito del Servizio Prestige?" },
    a: { en: "The Prestige Service is a complimentary 2-year program designed to protect your jewelry against theft and accidental damage.", it: "Il Servizio Prestige è un programma gratuito di 2 anni progettato per proteggere i tuoi gioielli da furto e danni accidentali." },
  },
  {
    q: { en: "What is excluded from the Prestige Service?", it: "Cosa è escluso dal Servizio Prestige?" },
    a: { en: "Normal wear and tear, cosmetic damage, and modifications made by unauthorized third parties are excluded.", it: "L'usura normale, i danni estetici e le modifiche effettuate da terzi non autorizzati sono esclusi." },
  },
  {
    q: { en: "What are the prerequisites to activate the Prestige Service?", it: "Quali sono i prerequisiti per attivare il Servizio Prestige?" },
    a: { en: "You need a valid proof of purchase and must register your product within 30 days of purchase.", it: "È necessaria una prova di acquisto valida e la registrazione del prodotto entro 30 giorni dall'acquisto." },
  },
  {
    q: { en: "What is the duration of the Prestige Service?", it: "Qual è la durata del Servizio Prestige?" },
    a: { en: "The service covers your jewelry for 2 years from the date of purchase activation.", it: "Il servizio copre i tuoi gioielli per 2 anni dalla data di attivazione dell'acquisto." },
  },
  {
    q: { en: "Is any jewel, regardless of its value, eligible for the Prestige Service?", it: "Qualsiasi gioiello, indipendentemente dal suo valore, è idoneo al Servizio Prestige?" },
    a: { en: "The Prestige Service is available for all pieces purchased from authorized retailers, regardless of value.", it: "Il Servizio Prestige è disponibile per tutti i pezzi acquistati presso rivenditori autorizzati, indipendentemente dal valore." },
  },
];

const StarRating = ({
  label,
  value,
  onChange,
}: { 
  label: string;
  value: number;
  onChange: (value: number) => void;
}) => {
  const [hover, setHover] = useState(0);

  return (
    <div className="mb-5">
      <p className="text-sm text-muted-foreground mb-2">{label}</p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => onChange(star)}
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
            className="transition-colors"
          >
            <Star
              className={`h-6 w-6 ${
                star <= (hover || value)
                  ? "fill-primary text-primary"
                  : "text-muted-foreground/30"
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
};

const CustomerDashboard = () => {
  const tenant = useTenant();
  const { t, locale } = useLanguage();
  const { profile } = useAuth();
  const slugPrefix = useAuthSlug();

  // Profile completion
  const profileFields = [
    profile?.first_name,
    profile?.last_name,
    profile?.email,
    profile?.phone_number,
    profile?.address,
    profile?.city,
    profile?.country,
    profile?.postcode,
    profile?.avatar,
  ];
  const filledCount = profileFields.filter(Boolean).length;
  const completionPct = Math.round((filledCount / profileFields.length) * 100);

  // Images: use brand images from DB, fall back to static assets
  const imgHero = tenant.topBannerImage || sectionHowItWorks;
  const imgTheft = tenant.theftImage || sectionTheft;
  const imgDamage = tenant.damageImage || sectionDamage;
  const imgFaq = tenant.faqImage || sectionFaq;
  const imgFeedback = tenant.feedbackImage || sectionFeedback;

  // FAQ: use brand JSON from DB, fall back to hardcoded
  const faqItems = (() => {
    const source = locale === "it" ? tenant.faqIt : tenant.faqEn;
    if (Array.isArray(source) && source.length > 0) {
      return (source as any[]).slice(0, 5).map((item) => {
        const question = item.title ?? item.question ?? "";
        const answer = item.content?.blocks
          ? (item.content.blocks as any[])
              .filter((b: any) => b.text)
              .map((b: any) => b.text)
              .join(" ")
          : (item.answer ?? "");
        return {
          q: { en: question, it: question },
          a: { en: answer, it: answer },
        };
      });
    }
    return FALLBACK_FAQ;
  })();
  const [comment, setComment] = useState("");
  const [satisfactionRate, setSatisfactionRate] = useState(0);
  const [peaceOfMindRate, setPeaceOfMindRate] = useState(0);
  const [recommendationRate, setRecommendationRate] = useState(0);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  const submitFeedback = async () => {
    if (!profile?.id || !profile?.brand_id) {
      toast.error(locale === "en" ? "Sign in again to send feedback." : "Accedi di nuovo per inviare feedback.");
      return;
    }

    if (!comment.trim() && !satisfactionRate && !peaceOfMindRate && !recommendationRate) {
      toast.error(locale === "en" ? "Add at least one rating or a comment." : "Aggiungi almeno una valutazione o un commento.");
      return;
    }

    setIsSubmittingFeedback(true);
    const { error } = await supabase.from("feedback").insert({
      brand_id: profile.brand_id,
      user_id: profile.id,
      comment: comment.trim() || null,
      satisfaction_rate: satisfactionRate || null,
      peace_of_mind_rate: peaceOfMindRate || null,
      recommendation_rate: recommendationRate || null,
    });
    setIsSubmittingFeedback(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    sendEmail("feedback_submitted", {
      feedback: {
        customer: {
          first_name: profile.first_name ?? null,
          last_name: profile.last_name ?? null,
          email: profile.email,
        },
        satisfaction_rate: satisfactionRate || null,
        recommendation_rate: recommendationRate || null,
        peace_of_mind_rate: peaceOfMindRate || null,
        comment: comment.trim() || null,
      },
    });
    toast.success(locale === "en" ? "Feedback submitted." : "Feedback inviato.");
    setComment("");
    setSatisfactionRate(0);
    setPeaceOfMindRate(0);
    setRecommendationRate(0);
  };

  const handleCompleteProfile = () => {
    window.location.href = `${slugPrefix}/profile`;
  };

  return (
    <div className="animate-fade-in space-y-4 p-4 md:p-6">
      {/* Profile Completion Card — hidden when 100% */}
      {completionPct < 100 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl bg-card p-6"
        >
          <div className="flex items-center gap-5">
            <ProgressRing value={completionPct} />
            <div>
              <h3 className="font-serif text-base font-semibold text-foreground">{t("dashboard.completeProfile")}</h3>
              <p className="text-sm text-muted-foreground">{t("dashboard.completeProfileDesc")}</p>
            </div>
          </div>
          <button
            onClick={handleCompleteProfile}
            className="rounded-lg border border-primary bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 whitespace-nowrap"
          >
            {t("dashboard.completeProfileBtn")}
          </button>
        </motion.div>
      )}

      {/* Hero Banner */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="relative rounded-xl overflow-hidden"
      >
        <img src={imgHero} alt="" className="w-full h-56 md:h-72 object-cover object-[50%_70%]" />
        <div className="absolute inset-0 bg-black/75" />
        <div className="absolute inset-0 flex flex-col justify-center p-8 md:p-12">
          <h2 className="font-serif text-2xl md:text-4xl font-bold text-white mb-3">
            {tenant.name} {locale === "en" ? "Prestige Service" : "Servizio Prestige"}
          </h2>
          <p className="max-w-md text-sm text-white/80 mb-6 leading-relaxed">
            {locale === "en"
              ? `Inspired by its passion for customer excellence, ${tenant.name} is pleased to introduce an exclusive cover service.`
              : `Ispirato dalla passione per l'esperienza del cliente, ${tenant.name} è lieto di presentare un servizio di copertura esclusivo.`}
          </p>
          <Link
            to={`${slugPrefix}/covers`}
            className="inline-flex w-fit items-center gap-2 rounded-lg border border-white/40 px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-white/10"
          >
            {locale === "en" ? "See All Products" : "Vedi tutti i prodotti"}
          </Link>
        </div>
      </motion.div>

      {/* How it works */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="rounded-xl bg-card p-6 md:p-8"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <h3 className="font-serif text-xl md:text-2xl font-bold text-foreground mb-3">
              {t("dashboard.howItWorks")}
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {locale === "en"
                ? `The ${tenant.name} Prestige Service is a complimentary 2-year program designed to protect your ${tenant.name} jewelry against theft and accidental damage.`
                : `Il Servizio Prestige di ${tenant.name} è un programma gratuito di 2 anni progettato per proteggere i tuoi gioielli ${tenant.name} da furto e danni accidentali.`}
            </p>
          </div>

          <div className="rounded-xl overflow-hidden border border-border">
            <img src={imgTheft} alt="Theft protection" className="w-full aspect-[4/3] object-cover" />
            <div className="p-4">
              <h4 className="font-serif text-base font-semibold text-foreground mb-1">
                {locale === "en" ? "Theft" : "Furto"}
              </h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {locale === "en"
                  ? `In the event of theft, ${tenant.name} team will carefully review your case. If all prerequisites are met, ${tenant.name} may, at its sole discretion, offer a replacement jewelry of equal value via a digital voucher.`
                  : `In caso di furto, il team ${tenant.name} esaminerà attentamente il tuo caso. Se tutti i prerequisiti sono soddisfatti, ${tenant.name} può, a sua esclusiva discrezione, offrire un gioiello sostitutivo di pari valore tramite un voucher digitale.`}
              </p>
            </div>
          </div>

          <div className="rounded-xl overflow-hidden border border-border">
            <img src={imgDamage} alt="Accidental damage protection" className="w-full aspect-[4/3] object-cover" />
            <div className="p-4">
              <h4 className="font-serif text-base font-semibold text-foreground mb-1">
                {locale === "en" ? "Accidental damage" : "Danni Accidentali"}
              </h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {locale === "en"
                  ? `In the event of irreparable accidental damage, ${tenant.name} will carefully review your case. If all prerequisites are met, ${tenant.name} may, at its sole discretion, offer a replacement jewelry of equal value via a digital voucher.`
                  : `In caso di danni accidentali irreparabili, ${tenant.name} esaminerà attentamente il tuo caso. Se tutti i prerequisiti sono soddisfatti, ${tenant.name} può, a sua esclusiva discrezione, offrire un gioiello sostitutivo di pari valore tramite un voucher digitale.`}
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* FAQ Section */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="grid grid-cols-1 md:grid-cols-2 rounded-xl overflow-hidden"
      >
        <div className="hidden md:relative md:block overflow-hidden">
          <img src={imgFaq} alt="FAQ" className="absolute inset-0 h-full w-full object-cover" />
        </div>
        <div className="bg-card p-6 md:p-8 flex flex-col justify-start">
          <h3 className="font-serif text-lg font-semibold text-foreground mb-1">FAQ</h3>
          <Accordion type="single" collapsible className="w-full">
            {faqItems.map((item, i) => (
              <AccordionItem key={i} value={`faq-${i}`} className="border-border">
                <AccordionTrigger className="text-sm text-left font-medium text-foreground py-3">
                  {locale === "it" ? item.q.it : item.q.en}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
                  {locale === "it" ? item.a.it : item.a.en}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <Link
            to="#"
            className="mt-4 self-end inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            {locale === "en" ? "View More" : "Vedi Altro"} <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </motion.div>

      {/* Feedback / Survey Section */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="grid grid-cols-1 md:grid-cols-2 rounded-xl overflow-hidden"
      >
        <div className="bg-card p-6 md:p-8">
          <h3 className="font-serif text-lg font-semibold text-foreground mb-6">
            {locale === "en"
              ? `Please rate ${tenant.name} Prestige Service`
              : `Valuta il Servizio Prestige di ${tenant.name}`}
          </h3>

          <StarRating
            label={locale === "en"
              ? `How satisfied are you with the ${tenant.name} Prestige Service?`
              : `Quanto sei soddisfatto del Servizio Prestige di ${tenant.name}?`}
            value={satisfactionRate}
            onChange={setSatisfactionRate}
          />
          <StarRating
            label={locale === "en"
              ? `Does the Prestige Service provide you with peace of mind when using your item?`
              : `Il Servizio Prestige ti offre tranquillità quando utilizzi i tuoi articoli?`}
            value={peaceOfMindRate}
            onChange={setPeaceOfMindRate}
          />
          <StarRating
            label={locale === "en"
              ? `Would you recommend ${tenant.name} to others because of this new service?`
              : `Consiglieresti ${tenant.name} ad altri grazie a questo nuovo servizio?`}
            value={recommendationRate}
            onChange={setRecommendationRate}
          />

          <div className="mt-4">
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              {locale === "en" ? "Comment" : "Commento"}
            </label>
            <textarea
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={locale === "en" ? "Enter comment" : "Inserisci un commento"}
              className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>
          <div className="flex justify-end mt-3">
            <button
              type="button"
              onClick={submitFeedback}
              disabled={isSubmittingFeedback}
              className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {locale === "en" ? "Submit" : "Invia"}
            </button>
          </div>
        </div>
        <div className="hidden md:block">
          <img src={imgFeedback} alt="Feedback" className="h-full w-full object-cover" />
        </div>
      </motion.div>

      {/* Continue Shopping */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="rounded-xl bg-card p-6 md:p-8"
      >
        <h3 className="font-serif text-xl md:text-2xl font-bold text-foreground mb-2">
          {locale === "en" ? "Continue Shopping" : "Continua lo shopping"}
        </h3>
        <p className="text-sm text-muted-foreground max-w-lg mb-6 leading-relaxed">
          {locale === "en"
            ? `Continue shopping our finest pieces of jewelry, enjoying peace of mind with our exclusive cover service.`
            : `Continua a fare shopping tra i nostri migliori gioielli, godendo della tranquillità del nostro esclusivo servizio di copertura.`}
        </p>
        <a
          href={tenant.website ?? "#"}
          target={tenant.website ? "_blank" : undefined}
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-all hover:bg-muted"
        >
          {locale === "en" ? "Continue Shopping" : "Continua lo shopping"}
        </a>
        <div className="flex justify-end mt-6">
          <SmartLogo src={tenant.logoUrl}
            alt={tenant.name}
            className="h-10 object-contain opacity-100 dark:opacity-80"
          />
        </div>
      </motion.div>
    </div>
  );
};

export default CustomerDashboard;
