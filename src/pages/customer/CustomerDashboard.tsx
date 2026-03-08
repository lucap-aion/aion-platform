import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Star, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import ProgressRing from "@/components/ui/progress-ring";
import { useTenant } from "@/contexts/TenantContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import sectionHowItWorks from "@/assets/section-how-it-works.jpg";
import sectionTheft from "@/assets/section-theft.jpg";
import sectionDamage from "@/assets/section-damage.jpg";
import sectionFaq from "@/assets/section-faq.jpg";
import sectionFeedback from "@/assets/section-feedback.jpg";

const faqItems = [
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

const StarRating = ({ label }: { label: string }) => {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);

  return (
    <div className="mb-4">
      <p className="text-sm text-muted-foreground mb-2">{label}</p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => setRating(star)}
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
            className="transition-colors"
          >
            <Star
              className={`h-5 w-5 ${
                star <= (hover || rating)
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
  const [comment, setComment] = useState("");

  return (
    <div className="max-w-6xl mx-auto space-y-0 animate-fade-in -m-4 md:-m-8">
      {/* Profile Completion */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-6 md:px-10 py-5 bg-card border-b border-border"
      >
        <div className="flex items-center gap-5">
          <ProgressRing value={91} />
          <div>
            <h3 className="font-serif text-base font-semibold text-foreground">{t("dashboard.completeProfile")}</h3>
            <p className="text-sm text-muted-foreground">{t("dashboard.completeProfileDesc")}</p>
          </div>
        </div>
        <button className="rounded-lg border border-primary bg-primary/5 px-6 py-2.5 text-sm font-medium text-primary transition-all hover:bg-primary hover:text-primary-foreground">
          {t("dashboard.completeProfileBtn")}
        </button>
      </motion.div>

      {/* Hero Banner */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="relative overflow-hidden"
      >
        <img
          src={sectionHowItWorks}
          alt={tenant.name}
          className="h-56 md:h-72 w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-charcoal/85 via-charcoal/60 to-charcoal/30" />
        <div className="absolute inset-0 flex flex-col justify-center px-6 md:px-10">
          <h2 className="font-serif text-2xl md:text-4xl font-bold text-cream-light mb-2">
            {tenant.name} {locale === "en" ? "Prestige Service" : "Servizio Prestige"}
          </h2>
          <p className="max-w-lg text-sm text-cream-light/80 mb-5 leading-relaxed">
            {locale === "en"
              ? `Inspired by its passion for customer experience, ${tenant.name} is pleased to introduce an exclusive cover service.`
              : `Ispirato dalla passione per l'esperienza del cliente, ${tenant.name} è lieto di presentare un servizio di copertura esclusivo.`}
          </p>
          <Link
            to="/covers"
            className="inline-flex w-fit items-center gap-2 rounded-lg border border-cream-light/30 px-5 py-2.5 text-sm font-medium text-cream-light backdrop-blur-sm transition-all hover:bg-cream-light/10"
          >
            {locale === "en" ? "See my products" : "Vedi i miei prodotti"} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </motion.div>

      {/* How it works */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="bg-charcoal text-cream-light"
      >
        <div className="px-6 md:px-10 py-8 md:py-12">
          <h3 className="font-serif text-xl md:text-2xl font-bold mb-2">
            {t("dashboard.howItWorks")}
          </h3>
          <p className="text-sm text-cream-light/70 max-w-xl mb-8 leading-relaxed">
            {locale === "en"
              ? `The ${tenant.name} Prestige Service is a complimentary 2-year program designed to protect your jewelry against theft and accidental damage.`
              : `Il Servizio Prestige di ${tenant.name} è un programma gratuito di 2 anni progettato per proteggere i tuoi gioielli da furto e danni accidentali.`}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {/* Theft card */}
            <div className="relative rounded-xl overflow-hidden group">
              <img src={sectionTheft} alt="Theft protection" className="h-52 md:h-64 w-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-charcoal/90 via-charcoal/40 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-5">
                <h4 className="font-serif text-lg font-semibold text-cream-light mb-1">
                  {locale === "en" ? "Theft" : "Furto"}
                </h4>
                <p className="text-xs text-cream-light/70 leading-relaxed">
                  {locale === "en"
                    ? `In the event of theft, ${tenant.name} team will carefully review your case. If all prerequisites are met, ${tenant.name} may, at its sole discretion, offer a replacement jewelry of equal value via a digital voucher.`
                    : `In caso di furto, il team ${tenant.name} esaminerà attentamente il tuo caso. Se tutti i prerequisiti sono soddisfatti, ${tenant.name} può, a sua esclusiva discrezione, offrire un gioiello sostitutivo di pari valore tramite un voucher digitale.`}
                </p>
              </div>
            </div>

            {/* Accidental Damage card */}
            <div className="relative rounded-xl overflow-hidden group">
              <img src={sectionDamage} alt="Accidental damage protection" className="h-52 md:h-64 w-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-charcoal/90 via-charcoal/40 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-5">
                <h4 className="font-serif text-lg font-semibold text-cream-light mb-1">
                  {locale === "en" ? "Accidental Damage" : "Danni Accidentali"}
                </h4>
                <p className="text-xs text-cream-light/70 leading-relaxed">
                  {locale === "en"
                    ? `In the event of irreparable accidental damage, ${tenant.name} will carefully review your case. If all prerequisites are met, ${tenant.name} may, at its sole discretion, offer a replacement jewelry of equal value via a digital voucher.`
                    : `In caso di danni accidentali irreparabili, ${tenant.name} esaminerà attentamente il tuo caso. Se tutti i prerequisiti sono soddisfatti, ${tenant.name} può, a sua esclusiva discrezione, offrire un gioiello sostitutivo di pari valore tramite un voucher digitale.`}
                </p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* FAQ Section */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="grid grid-cols-1 md:grid-cols-2 gap-0"
      >
        <div className="hidden md:block">
          <img src={sectionFaq} alt="FAQ" className="h-full w-full object-cover" />
        </div>
        <div className="bg-card px-6 md:px-10 py-8 md:py-12 flex flex-col justify-center">
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
        className="grid grid-cols-1 md:grid-cols-2 gap-0"
      >
        <div className="bg-card px-6 md:px-10 py-8 md:py-12">
          <h3 className="font-serif text-lg font-semibold text-foreground mb-6">
            {locale === "en"
              ? `Please rate ${tenant.name} Prestige Service`
              : `Valuta il Servizio Prestige di ${tenant.name}`}
          </h3>

          <StarRating
            label={locale === "en"
              ? `How satisfied are you with the ${tenant.name} Prestige Service?`
              : `Quanto sei soddisfatto del Servizio Prestige di ${tenant.name}?`}
          />
          <StarRating
            label={locale === "en"
              ? `Does the Prestige Service provide you with peace of mind when using your items?`
              : `Il Servizio Prestige ti offre tranquillità quando utilizzi i tuoi articoli?`}
          />
          <StarRating
            label={locale === "en"
              ? `Would you recommend ${tenant.name} to others because of this new service?`
              : `Consiglieresti ${tenant.name} ad altri grazie a questo nuovo servizio?`}
          />

          <div className="mt-4">
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              {locale === "en" ? "Comment" : "Commento"}
            </label>
            <textarea
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={locale === "en" ? "Enter a comment" : "Inserisci un commento"}
              className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>
          <div className="flex justify-end mt-3">
            <button className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
              {locale === "en" ? "Submit" : "Invia"}
            </button>
          </div>
        </div>
        <div className="hidden md:block">
          <img src={sectionFeedback} alt="Feedback" className="h-full w-full object-cover" />
        </div>
      </motion.div>

      {/* Continue Shopping */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="bg-charcoal px-6 md:px-10 py-10 md:py-14"
      >
        <h3 className="font-serif text-xl md:text-2xl font-bold text-cream-light mb-2">
          {locale === "en" ? "Continue Shopping" : "Continua lo Shopping"}
        </h3>
        <p className="text-sm text-cream-light/70 max-w-lg mb-6 leading-relaxed">
          {locale === "en"
            ? `Continue shopping our finest pieces of jewelry, enjoying peace of mind with our exclusive cover service.`
            : `Continua a fare shopping tra i nostri migliori gioielli, godendo della tranquillità del nostro esclusivo servizio di copertura.`}
        </p>
        <a
          href="#"
          className="inline-flex items-center gap-2 rounded-lg border border-cream-light/30 px-5 py-2.5 text-sm font-medium text-cream-light transition-all hover:bg-cream-light/10"
        >
          {locale === "en" ? "Continue Shopping" : "Continua lo Shopping"}
        </a>
      </motion.div>

      {/* Footer with brand logo */}
      <div className="flex items-center justify-end px-6 md:px-10 py-6 bg-background border-t border-border">
        <img
          src={tenant.logoUrl}
          alt={tenant.name}
          className="h-8 object-contain opacity-60"
        />
      </div>
    </div>
  );
};

export default CustomerDashboard;
