import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

type Locale = "en" | "it";

interface Translations {
  [key: string]: { en: string; it: string };
}

const translations: Translations = {
  // Nav
  "nav.home": { en: "Home", it: "Home" },
  "nav.myCovers": { en: "My Covers", it: "Le Mie Coperture" },
  "nav.myClaims": { en: "My Claims", it: "I Miei Incidenti" },
  "nav.dashboard": { en: "Dashboard", it: "Dashboard" },
  "nav.customers": { en: "Customers", it: "Clienti" },
  "nav.covers": { en: "Covers", it: "Coperture" },
  "nav.claims": { en: "Claims", it: "Incidenti" },
  "nav.team": { en: "Team", it: "Team" },
  "nav.settings": { en: "Settings", it: "Impostazioni" },
  "nav.menu": { en: "Menu", it: "Menu" },
  "nav.management": { en: "Management", it: "Gestione" },

  // Help
  "help.title": { en: "Need Help?", it: "Hai bisogno di aiuto?" },
  "help.desc": { en: "Contact our support team anytime.", it: "Contatta il nostro team di supporto." },
  "help.contact": { en: "Contact Support", it: "Contatta il Supporto" },
  "help.faq": { en: "Check our FAQ", it: "Consulta le FAQ" },

  // Profile
  "profile.myProfile": { en: "My Profile", it: "Il Mio Profilo" },
  "profile.logout": { en: "Logout", it: "Esci" },

  // Covers page
  "covers.title": { en: "My Covers", it: "Le Mie Coperture" },
  "covers.subtitle": { en: "Track and manage protection for your luxury pieces.", it: "Monitora e gestisci la protezione dei tuoi pezzi di lusso." },
  "covers.openClaim": { en: "Open Claim", it: "Apri Incidente" },
  "covers.transfer": { en: "Transfer", it: "Trasferisci" },
  "covers.startDate": { en: "Start Date", it: "Data Inizio" },
  "covers.expiration": { en: "Expiration", it: "Scadenza" },
  "covers.start": { en: "Start", it: "Inizio" },

  // Dashboard
  "dashboard.completeProfile": { en: "Complete your profile", it: "Completa il tuo profilo" },
  "dashboard.completeProfileDesc": { en: "Complete your profile to unlock all features.", it: "Completa il tuo profilo per sbloccare tutte le funzionalità." },
  "dashboard.completeProfileBtn": { en: "Complete Profile", it: "Completa Profilo" },
  "dashboard.heroTitle": { en: "Prestige Protection", it: "Protezione di Prestigio" },
  "dashboard.heroDesc": { en: "Your luxury pieces deserve world-class coverage. AION Cover safeguards your treasures against theft and accidental damage.", it: "I tuoi pezzi di lusso meritano una copertura di livello mondiale. AION Cover protegge i tuoi tesori da furto e danni accidentali." },
  "dashboard.viewCovers": { en: "View My Covers", it: "Vedi le Mie Coperture" },
  "dashboard.activeCovers": { en: "Active Covers", it: "Coperture Attive" },
  "dashboard.openClaims": { en: "Open Claims", it: "Incidenti Aperti" },
  "dashboard.totalProtected": { en: "Total Protected Value", it: "Valore Totale Protetto" },
  "dashboard.howItWorks": { en: "How It Works", it: "Come Funziona" },
  "dashboard.step1Title": { en: "Coverage at Checkout", it: "Copertura al Checkout" },
  "dashboard.step1Desc": { en: "Complimentary coverage included with your luxury purchase.", it: "Copertura inclusa con il tuo acquisto di lusso." },
  "dashboard.step2Title": { en: "Simple Activation", it: "Attivazione Semplice" },
  "dashboard.step2Desc": { en: "Activate your coverage effortlessly in just a few clicks.", it: "Attiva la tua copertura in pochi click." },
  "dashboard.step3Title": { en: "Effortless Claims", it: "Incidenti Semplici" },
  "dashboard.step3Desc": { en: "Submit claims quickly through our intuitive platform.", it: "Invia incidenti rapidamente tramite la nostra piattaforma intuitiva." },

  // Auth
  "auth.login": { en: "Log In", it: "Accedi" },
  "auth.signup": { en: "Sign Up", it: "Registrati" },
  "auth.email": { en: "Email", it: "Email" },
  "auth.password": { en: "Password", it: "Password" },
  "auth.forgotPassword": { en: "Forgot Password?", it: "Password dimenticata?" },
  "auth.noAccount": { en: "Don't have an account?", it: "Non hai un account?" },
  "auth.hasAccount": { en: "Already have an account?", it: "Hai già un account?" },
  "auth.welcomeBack": { en: "Welcome back", it: "Bentornato" },
  "auth.createAccount": { en: "Create your account", it: "Crea il tuo account" },
  "auth.fullName": { en: "Full Name", it: "Nome Completo" },

  // FAQ
  "faq.title": { en: "Frequently Asked Questions", it: "Domande Frequenti" },
  "faq.search": { en: "Search questions...", it: "Cerca domande..." },

  // Dashboard — Prestige Service
  "dashboard.prestigeService": { en: "Prestige Service", it: "Servizio Prestige" },
  "dashboard.seeAllProducts": { en: "See All Products", it: "Vedi tutti i prodotti" },
  "dashboard.heroDesc": { en: "Inspired by its passion for customer excellence, {brand} is pleased to introduce an exclusive cover service.", it: "Ispirato dalla passione per l'esperienza del cliente, {brand} è lieto di presentare un servizio di copertura esclusivo." },
  "dashboard.prestigeServiceDesc": { en: "The {brand} Prestige Service is a complimentary 2-year program designed to protect your {brand} jewelry against theft and accidental damage.", it: "Il Servizio Prestige di {brand} è un programma gratuito di 2 anni progettato per proteggere i tuoi gioielli {brand} da furto e danni accidentali." },
  "dashboard.theft": { en: "Theft", it: "Furto" },
  "dashboard.theftDesc": { en: "In the event of theft, {brand} team will carefully review your case. If all prerequisites are met, {brand} may, at its sole discretion, offer a replacement jewelry of equal value via a digital voucher.", it: "In caso di furto, il team {brand} esaminerà attentamente il tuo caso. Se tutti i prerequisiti sono soddisfatti, {brand} può, a sua esclusiva discrezione, offrire un gioiello sostitutivo di pari valore tramite un voucher digitale." },
  "dashboard.accidentalDamage": { en: "Accidental damage", it: "Danni Accidentali" },
  "dashboard.damageDesc": { en: "In the event of irreparable accidental damage, {brand} will carefully review your case. If all prerequisites are met, {brand} may, at its sole discretion, offer a replacement jewelry of equal value via a digital voucher.", it: "In caso di danni accidentali irreparabili, {brand} esaminerà attentamente il tuo caso. Se tutti i prerequisiti sono soddisfatti, {brand} può, a sua esclusiva discrezione, offrire un gioiello sostitutivo di pari valore tramite un voucher digitale." },
  "dashboard.faq": { en: "FAQ", it: "FAQ" },
  "dashboard.viewMore": { en: "View More", it: "Vedi Altro" },
  "dashboard.feedbackTitle": { en: "Please rate {brand} Prestige Service", it: "Valuta il Servizio Prestige di {brand}" },
  "dashboard.satisfactionLabel": { en: "How satisfied are you with the {brand} Prestige Service?", it: "Quanto sei soddisfatto del Servizio Prestige di {brand}?" },
  "dashboard.peaceOfMindLabel": { en: "Does the Prestige Service provide you with peace of mind when using your item?", it: "Il Servizio Prestige ti offre tranquillità quando utilizzi i tuoi articoli?" },
  "dashboard.recommendLabel": { en: "Would you recommend {brand} to others because of this new service?", it: "Consiglieresti {brand} ad altri grazie a questo nuovo servizio?" },
  "dashboard.comment": { en: "Comment", it: "Commento" },
  "dashboard.commentPlaceholder": { en: "Enter comment", it: "Inserisci un commento" },
  "dashboard.submit": { en: "Submit", it: "Invia" },
  "dashboard.continueShopping": { en: "Continue Shopping", it: "Continua lo shopping" },
  "dashboard.continueShoppingDesc": { en: "Continue shopping our finest pieces of jewelry, enjoying peace of mind with our exclusive cover service.", it: "Continua a fare shopping tra i nostri migliori gioielli, godendo della tranquillità del nostro esclusivo servizio di copertura." },
  "dashboard.feedbackSignInError": { en: "Sign in again to send feedback.", it: "Accedi di nuovo per inviare feedback." },
  "dashboard.feedbackEmptyError": { en: "Add at least one rating or a comment.", it: "Aggiungi almeno una valutazione o un commento." },
  "dashboard.feedbackSuccess": { en: "Feedback submitted.", it: "Feedback inviato." },

  // Support
  "support.title": { en: "Contact Support", it: "Contatta il Supporto" },
  "support.desc": { en: "Describe your issue and our team will get back to you within 24 hours.", it: "Descrivi il tuo problema e il nostro team ti risponderà entro 24 ore." },
  "support.subject": { en: "Subject", it: "Oggetto" },
  "support.subjectPlaceholder": { en: "Brief summary of your issue", it: "Breve riepilogo del problema" },
  "support.message": { en: "Message", it: "Messaggio" },
  "support.messagePlaceholder": { en: "Describe your issue in detail...", it: "Descrivi il tuo problema in dettaglio..." },
  "support.send": { en: "Send Message", it: "Invia Messaggio" },
};

interface LanguageContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  locale: "en",
  setLocale: () => {},
  t: (key) => key,
});

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [locale, setLocale] = useState<Locale>(
    () => (localStorage.getItem("locale") as Locale) || "en"
  );

  const handleSetLocale = useCallback((l: Locale) => {
    setLocale(l);
    localStorage.setItem("locale", l);
  }, []);

  const t = useCallback(
    (key: string) => {
      const entry = translations[key];
      if (!entry) return key;
      return entry[locale] || entry.en || key;
    },
    [locale]
  );

  return (
    <LanguageContext.Provider value={{ locale, setLocale: handleSetLocale, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
