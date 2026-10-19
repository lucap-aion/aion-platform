// ==============================|| THE CUSTOMER FAQ, AS A TEMPLATE ||============================== //
// The seventeen questions every programme gets asked, in English and Italian.
//
// This is the text of the programme that is LIVE in production, with everything specific to
// that house replaced by a token: its name, its programme name, its launch date, the two
// cities its boutiques are in, its price band, its category of piece, its customer-service
// address. Nothing identifying survives — asserted by a test, because the one thing worse
// than an empty FAQ tab is another client's FAQ with the wrong name on it.
//
// Why a copy of it at all: the wording has been through legal and answers the questions
// customers actually ask (resale, gifts, travel, the difference from the legal guarantee,
// what happens to a copy of their ID). Starting a new brand from a blank JSON box means
// either re-deriving all of that or shipping the tab empty, and both happened.
//
// Rendered by `renderFaqs` in brand-defaults.ts. Every value is a DRAFT for review: the
// launch date and the participating boutiques are deliberately vague until somebody fills
// them in, because inventing either would be worse than leaving the sentence general.

export type FaqBlock = { type: "p"; text: string } | { type: "ul"; items: string[] };
export type FaqTemplateEntry = { title: string; blocks: FaqBlock[]; sort_order: number };

export const FAQ_TEMPLATE_EN: readonly FaqTemplateEntry[] = [
  {
    title: "What is {{PROGRAMME}}?",
    blocks: [
      {
        type: "p",
        text: "{{PROGRAMME}} is a complimentary, worldwide {{DURATION_ADJ}} cover service offered by {{BRAND}} under specific conditions. It protects {{BRAND}} {{CATEGORY}} from theft, robbery, and irreparable accidental damage caused by sudden external events, allowing customers to receive a replacement {{CATEGORY}} of equal value via a digital voucher. The voucher’s value matches the public price of the {{CATEGORY}} at the time of purchase."
      }
    ],
    sort_order: 1
  },
  {
    title: "What is the scope of the {{PROGRAMME}}?",
    blocks: [
      {
        type: "p",
        text: "All {{BRAND}} {{CATEGORY}} purchased from {{LAUNCH}}, in {{BOUTIQUES}}, with a retail price from euro {{MIN}} to euro {{MAX}} (inclusive of VAT), is eligible for {{PROGRAMME}}. The service covers theft, robbery, and irreparable accidental damage resulting from sudden external events."
      }
    ],
    sort_order: 2
  },
  {
    title: "What is the duration of the coverage?",
    blocks: [
      {
        type: "p",
        text: "The coverage lasts for {{DURATION}} from the date of purchase. Customers can check the validity of their coverage at any time by logging into their {{PROGRAMME}} account, managed by {{BRAND}}’s technological partner AION."
      }
    ],
    sort_order: 3
  },
  {
    title: "Is every {{BRAND}} creation eligible for the service?",
    blocks: [
      {
        type: "p",
        text: "Yes, as long as it was purchased from {{LAUNCH}}, in {{BOUTIQUES}}, with a retail price from euro {{MIN}} to euro {{MAX}} (inclusive of VAT)."
      }
    ],
    sort_order: 4
  },
  {
    title: "Is my {{PROGRAMME_SHORT}} automatically activated?",
    blocks: [
      {
        type: "p",
        text: "No. {{PROGRAMME_SHORT}} is a complimentary service offered by {{BRAND}} and is subject to predefined conditions. It is at {{BRAND}}’s sole discretion to decide whether to grant the service and under which conditions."
      }
    ],
    sort_order: 5
  },
  {
    title: "What situations are covered by the {{PROGRAMME}}?",
    blocks: [
      {
        type: "p",
        text: "Jewelry is covered against theft, robbery, and irreparable accidental damage caused by sudden external events, whether occurring while traveling or at home."
      },
      {
        type: "p",
        text: "Covered events include pickpocketing occurring outdoors; robbery during travel; burglary occurring in a hotel room after a break-in; and burglary occurring at home or in a private area with restricted access after a break-in."
      },
      {
        type: "p",
        text: "Irreparable accidental damage is understood to include deep scratches or deformations, as well as the breakage of clasps, fastenings, links, and chains caused by a single event."
      }
    ],
    sort_order: 6
  },
  {
    title: "What shall I do if my {{CATEGORY}} is stolen?",
    blocks: [
      {
        type: "p",
        text: "Provided that the {{PROGRAMME}} has been successfully activated and is still valid, you will be invited to fill in a theft request on the platform, including:"
      },
      {
        type: "ul",
        items: [
          "an authentic, dated, signed, and stamped police report (online reports are not accepted);",
          "your full contact details (first and last name, address, nationality, date of birth, email address, phone number);",
          "the date, place, and country of the incident."
        ]
      },
      {
        type: "p",
        text: "{{BRAND}} will examine the case and may offer a voucher to replace your {{CATEGORY}}. By submitting the activation request you accept to assign your ownership rights of the stolen {{CATEGORY}} to {{BRAND}}. The voucher value will be the public price of the {{CATEGORY}} at the time of purchase, no cash refunds are available."
      }
    ],
    sort_order: 7
  },
  {
    title: "What shall I do if my {{CATEGORY}} is damaged?",
    blocks: [
      {
        type: "p",
        text: "Provided that the {{PROGRAMME}} has been successfully activated and is still valid, you will be invited to fill in a repair request on the platform explaining:"
      },
      {
        type: "ul",
        items: [
          "the circumstances of the damage;",
          "the date and place of the occurrence;",
          "provide images of the damage;",
          "provide your full contact details (e.g. first and last name, address, nationality, date of birth, email address, phone number)."
        ]
      },
      {
        type: "p",
        text: "{{BRAND}} will examine the case and may offer the possibility to receive a replacement {{CATEGORY_SG}} of equal value, through a digital voucher. By submitting the activation request you accept to assign your ownership {{CATEGORY}}’s rights to {{BRAND}} and to deliver the damaged {{CATEGORY}} to the address recommended by the brand customer service. The voucher value will be the public price of the {{CATEGORY}} at the time of purchase, no cash refunds are available, and the voucher may be used exclusively to purchase {{BRAND}} {{CATEGORY}}."
      }
    ],
    sort_order: 8
  },
  {
    title: "What is excluded from the {{PROGRAMME}}?",
    blocks: [
      {
        type: "p",
        text: "The following cases are excluded from the {{BRAND}} Prestige service. This is just a sample list of the main exclusions and other may apply:"
      },
      {
        type: "ul",
        items: [
          "Events occurring after the expiration of the {{BRAND}} Prestige service;",
          "Any {{CATEGORY}} where the Serial Number or unique identification code cannot be identified;",
          "All {{CATEGORY}} that has been resold as second-hand;",
          "Repairs not carried out by the {{BRAND}} network;",
          "Damage resulting from normal wear and tear or gradual deterioration of the {{CATEGORY}};",
          "Damage resulting from negligence, including improper use of the {{CATEGORY}};",
          "Theft occurring inside any private property with restricted access, without signs of forced entry.",
          "Theft from inside vehicles; including private car, private motorbike, commercial vehicle, smart vehicle (mopad, segway, hoverboard, monowheel).",
          "Theft resulting from negligence or carelessness, such as leaving the {{CATEGORY}} unattended in places where it could reasonably be stolen."
        ]
      }
    ],
    sort_order: 9
  },
  {
    title: "What are the prerequisites to activate the {{PROGRAMME_SHORT}}?",
    blocks: [
      {
        type: "p",
        text: "The granting of {{PROGRAMME_SHORT}} is neither automatic nor unconditional. Before any theft, robbery, or damage, you must activate the service in your name for each eligible {{CATEGORY}} by sharing your contact details (email and full name) at the time of purchase and by registering on the AION platform. Eligible {{CATEGORY}} will automatically appear in your account. {{BRAND}} reserves the right to modify activation requirements at any time."
      }
    ],
    sort_order: 10
  },
  {
    title: "What is the difference between the {{BRAND}} Legal Guarantee of Conformity and the {{PROGRAMME_SHORT}}?",
    blocks: [
      {
        type: "p",
        text: "the {{BRAND}} Legal Guarantee of Conformity covers new {{BRAND}} {{CATEGORY}} against manufacturing defects for {{DURATION}} from the initial purchase, as required by law. {{PROGRAMME_SHORT}} is a complimentary service offered under certain conditions, protecting against theft, robbery, and accidental damage."
      }
    ],
    sort_order: 11
  },
  {
    title: "Is the {{PROGRAMME_SHORT}} valid when I travel worldwide?",
    blocks: [
      {
        type: "p",
        text: "Yes, the service is valid worldwide, both at home and while traveling."
      }
    ],
    sort_order: 12
  },
  {
    title: "I bought several {{CATEGORY}}, do I have to register to the {{PROGRAMME_SHORT}} platform several times?",
    blocks: [
      {
        type: "p",
        text: "No. The {{PROGRAMME_SHORT}} is automatically activated after your first sign up to the platform, and you do not need to register again for each item. It is valid only for {{CATEGORY}} purchased in the brand’s {{BOUTIQUES}} from {{LAUNCH}} onwards."
      }
    ],
    sort_order: 13
  },
  {
    title: "May the {{PROGRAMME_SHORT}} be granted in case of resell of the {{CATEGORY}}?",
    blocks: [
      {
        type: "p",
        text: "No, {{PROGRAMME_SHORT}} ends when the customer resells the {{CATEGORY}} as second-hand to a third party."
      }
    ],
    sort_order: 14
  },
  {
    title: "Does the {{PROGRAMME_SHORT}} apply if the {{CATEGORY_SG}} is given as a gift?",
    blocks: [
      {
        type: "p",
        text: "Yes, the {{PROGRAMME_SHORT}} remains valid even if the {{CATEGORY}} is purchased as a gift by the original customer. However, this shall be notified immediately upon submission, and the {{CATEGORY}} ownership must be transferred via the AION platform. The {{CATEGORY}} may be gifted only once; any subsequent transfer to a third party shall result in the automatic termination of the Service."
      }
    ],
    sort_order: 15
  },
  {
    title: "Who can I contact if I have a question related to the {{PROGRAMME_SHORT}}?",
    blocks: [
      {
        type: "p",
        text: "You can contact {{BRAND}} customer service at {{SUPPORT}}"
      }
    ],
    sort_order: 16
  },
  {
    title: "How will my personal data be processed?",
    blocks: [
      {
        type: "p",
        text: "The personal data you provide when you activate the {{PROGRAMME}}, or when you inform {{BRAND}} of accidental damage, burglary, or robbery, including a copy of your ID document when requested, will be processed solely for the purpose of providing the service. The copy of your ID document will be deleted once your identity has been verified. Any additional data you may need to share for the provision of the service, such as a criminal report, will be stored for 10 years in accordance with applicable legislation. The only parties involved in providing the service are {{BRAND}} Spa and AION Cover Srl (technical partner). Please refer to the {{BRAND}} and AION Cover Privacy Policy for further information on your rights and on how your personal data is shared and stored."
      }
    ],
    sort_order: 17
  }
] as const;

export const FAQ_TEMPLATE_IT: readonly FaqTemplateEntry[] = [
  {
    title: "Cos’è {{PROGRAMME}}?",
    blocks: [
      {
        type: "p",
        text: "{{PROGRAMME}} è un servizio di copertura gratuita e globale {{DURATION_ADJ}} offerto da {{BRAND}} in specifiche condizioni. Protegge i {{CATEGORY}} {{BRAND}} da furto, rapina e danni accidentali irreparabili causati da eventi esterni improvvisi, consentendo ai clienti di ricevere un {{CATEGORY_SG}} sostitutivo di pari valore tramite un voucher digitale. Il valore del voucher corrisponde al prezzo pubblico del {{CATEGORY_SG}} al momento dell’acquisto."
      }
    ],
    sort_order: 1
  },
  {
    title: "Qual è il perimetro del servizio {{PROGRAMME}}?",
    blocks: [
      {
        type: "p",
        text: "Tutti i {{CATEGORY}} {{BRAND}} acquistati {{LAUNCH}} {{BOUTIQUES}}, con un prezzo di vendita da euro {{MIN}} fino a euro {{MAX}} (IVA inclusa), sono idonei per {{PROGRAMME}}. Il servizio copre furto, rapina e danni accidentali irreparabili derivanti da eventi esterni improvvisi."
      }
    ],
    sort_order: 2
  },
  {
    title: "Qual è la durata della copertura?",
    blocks: [
      {
        type: "p",
        text: "La copertura ha una durata {{DURATION_ADJ}} dalla data di acquisto. I clienti possono verificare la validità della copertura in qualsiasi momento accedendo al proprio account {{PROGRAMME}}, gestito dal partner tecnologico di {{BRAND}}, AION."
      }
    ],
    sort_order: 3
  },
  {
    title: "Tutte le creazioni {{BRAND}} sono idonee per il servizio?",
    blocks: [
      {
        type: "p",
        text: "Sì, purché siano state acquistate {{LAUNCH}} {{BOUTIQUES}}, con un prezzo di vendita da euro {{MIN}} fino a euro {{MAX}} (IVA inclusa)."
      }
    ],
    sort_order: 4
  },
  {
    title: "{{PROGRAMME_SHORT}} si attiva automaticamente?",
    blocks: [
      {
        type: "p",
        text: "No. Il {{PROGRAMME_SHORT}} è un servizio gratuito offerto da {{BRAND}} e soggetto a condizioni predeterminate. Spetta a {{BRAND}} decidere, a sua esclusiva discrezione, se concedere il servizio e in quali condizioni."
      },
      {
        type: "p",
        text: "Al momento dell’acquisto, direttamente ed esclusivamente presso la boutique ove esso avviene, il cliente deve fornire le proprie generalità complete e il proprio recapito e-mail tramite la compilazione di apposito modulo, al fine di poter ricevere, sempre via mail, il link per l’attivazione del servizio."
      },
      {
        type: "p",
        text: "Una volta ricevuta l’e-mail, tramite il link contenuto nella stessa, il cliente dovrà accedere e registrarsi sulla piattaforma dedicata. Il link per l’attivazione rimarrà attivo per 30 giorni e non potrà essere ripristinato."
      },
      {
        type: "p",
        text: "Se il cliente non ricevesse l’e-mail di invito, può contattare direttamente {{BRAND}} al seguente indirizzo: {{SUPPORT}}."
      }
    ],
    sort_order: 5
  },
  {
    title: "Quali situazioni sono coperte dal servizio {{PROGRAMME}}?",
    blocks: [
      {
        type: "p",
        text: "I {{CATEGORY}} sono coperti da furto con scasso, rapina e danni accidentali irreparabili causati da eventi esterni improvvisi, che avvengano sia in viaggio sia a casa. Tra gli eventi coperti rientrano i casi di borseggio verificatosi all’aperto, di rapina durante i viaggi o di furto con scasso avvenuto nella stanza d’albergo, furto con scasso verificatosi a casa o in uno spazio privato con accesso limitato. Mentre per danni accidentali irreparabili si intendono graffi profondi o deformazioni, e rottura di chiusure, fermagli, maglie e catene causata da un singolo evento."
      }
    ],
    sort_order: 6
  },
  {
    title: "Cosa devo fare se il mio {{CATEGORY_SG}} viene rubato?",
    blocks: [
      {
        type: "p",
        text: "A condizione che il servizio {{PROGRAMME}} sia stato attivato correttamente e sia ancora valido, ti verrà richiesto di compilare una richiesta di furto sulla piattaforma, includendo:"
      },
      {
        type: "ul",
        items: [
          "Un verbale di polizia autentico, datato, firmato e timbrato (non sono accettati verbali online);",
          "I tuoi dati di contatto completi (nome e cognome, indirizzo, nazionalità, data di nascita, indirizzo email, numero di telefono);",
          "La data, il luogo e il paese dell’evento."
        ]
      },
      {
        type: "p",
        text: "{{BRAND}} esaminerà il caso e potrà offrire un voucher per sostituire il {{CATEGORY_SG}}. Con la richiesta di attivazione dovrai cedere i diritti di proprietà del {{CATEGORY_SG}} rubato a {{BRAND}}. Il valore del voucher corrisponde al prezzo pubblico del {{CATEGORY_SG}} al momento dell’acquisto, il voucher non è soggetto a rimborso, e può essere utilizzato solo per acquistare {{CATEGORY}} {{BRAND}}."
      }
    ],
    sort_order: 7
  },
  {
    title: "Cosa devo fare se il mio {{CATEGORY_SG}} è danneggiato irreparabilmente?",
    blocks: [
      {
        type: "p",
        text: "A condizione che il servizio {{PROGRAMME}} sia stato attivato correttamente e sia ancora valido, ti verrà richiesto di compilare una richiesta di riparazione sulla piattaforma spiegando:"
      },
      {
        type: "ul",
        items: [
          "Le circostanze del danno;",
          "La data e il luogo dell’evento;",
          "Fornire immagini del danno;",
          "Fornire i tuoi dati di contatto completi (nome e cognome, indirizzo, nazionalità, data di nascita, indirizzo email, numero di telefono)."
        ]
      },
      {
        type: "p",
        text: "{{BRAND}} esaminerà il caso e potrà offrire la possibilità di ricevere un {{CATEGORY_SG}} sostitutivo di pari valore tramite un voucher digitale. Con la richiesta di attivazione dovrai cedere i diritti di proprietà del {{CATEGORY_SG}} danneggiato a {{BRAND}} e consegnare il {{CATEGORY_SG}} danneggiato all’indirizzo indicato dal nostro servizio clienti. Il valore del voucher corrisponde al prezzo pubblico del {{CATEGORY_SG}} al momento dell’acquisto, il voucher non è soggetto a rimborso, e può essere utilizzato solo per acquistare {{CATEGORY}} {{BRAND}}"
      }
    ],
    sort_order: 8
  },
  {
    title: "Cosa è escluso da {{PROGRAMME}}?",
    blocks: [
      {
        type: "p",
        text: "I seguenti casi sono esclusi dal servizio {{PROGRAMME}}. Questa è solo una lista esemplificativa delle principali esclusioni, altre potrebbero applicarsi:"
      },
      {
        type: "ul",
        items: [
          "Eventi avvenuti dopo la scadenza del servizio {{PROGRAMME}};",
          "Qualsiasi {{CATEGORY_SG}} il cui numero di serie o codice identificativo unico non può essere identificato;",
          "Tutti i {{CATEGORY}} rivenduti;",
          "Riparazioni non effettuate dalla rete {{BRAND}};",
          "Danni derivanti da usura normale o deterioramento graduale del {{CATEGORY_SG}};",
          "Danni derivanti da negligenza, inclusi l’uso improprio del {{CATEGORY_SG}};",
          "Furto all’interno di proprietà private con accesso limitato, senza segni di effrazione;",
          "Furto all’interno di veicoli; compresa auto privata, moto privata, veicolo commerciale, veicolo intelligente (monopattino, segway, hoverboard, monoruota);",
          "Furto derivante da negligenza o distrazione, come lasciare il {{CATEGORY_SG}} incustodito in luoghi dove potrebbe ragionevolmente venire rubato."
        ]
      }
    ],
    sort_order: 9
  },
  {
    title: "Quali sono i prerequisiti per attivare {{PROGRAMME_SHORT}}?",
    blocks: [
      {
        type: "p",
        text: "La concessione del {{PROGRAMME_SHORT}} non è né automatica né incondizionata. Prima di qualsiasi furto, rapina o danno, devi attivare il servizio a tuo nome per ogni {{CATEGORY_SG}} idoneo, condividendo i tuoi dati di contatto (email e nome completo) al momento dell’acquisto e registrandoti sulla piattaforma AION. I {{CATEGORY}} idonei appariranno automaticamente nel tuo account. {{BRAND}} si riserva il diritto di modificare i requisiti di attivazione in qualsiasi momento."
      }
    ],
    sort_order: 10
  },
  {
    title: "Qual è la differenza tra la garanzia legale di {{BRAND}} e il {{PROGRAMME_SHORT}}?",
    blocks: [
      {
        type: "p",
        text: "La Garanzia Legale di {{BRAND}} copre i {{CATEGORY}} {{BRAND}} nuovi contro i difetti di fabbricazione per {{DURATION}} dall’acquisto iniziale, come previsto dalla legge. Il {{PROGRAMME_SHORT}} è un servizio gratuito offerto in determinate condizioni, che protegge da furto, rapina e danni accidentali."
      }
    ],
    sort_order: 11
  },
  {
    title: "Il {{PROGRAMME_SHORT}} è valido quando viaggio in tutto il mondo?",
    blocks: [
      {
        type: "p",
        text: "Si, il servizio è valido in tutto il mondo, sia a casa che durante i viaggi."
      }
    ],
    sort_order: 12
  },
  {
    title: "Ho acquistato diversi {{CATEGORY}}, devo registrarmi più volte sulla piattaforma?",
    blocks: [
      {
        type: "p",
        text: "No. {{PROGRAMME_SHORT}} viene attivato automaticamente dopo la prima registrazione sulla piattaforma e non è necessario registrarsi nuovamente per ogni articolo. È valido solo per i {{CATEGORY}} acquistati {{BOUTIQUES}} {{LAUNCH}} in poi."
      }
    ],
    sort_order: 13
  },
  {
    title: "{{PROGRAMME_SHORT}} può essere concesso in caso di rivendita del {{CATEGORY_SG}}?",
    blocks: [
      {
        type: "p",
        text: "No, {{PROGRAMME_SHORT}} termina quando il cliente rivende il {{CATEGORY_SG}} usato a un terzo."
      }
    ],
    sort_order: 14
  },
  {
    title: "{{PROGRAMME_SHORT}} si applica se il {{CATEGORY_SG}} viene regalato?",
    blocks: [
      {
        type: "p",
        text: "Si, {{PROGRAMME}} rimane valido anche se il {{CATEGORY_SG}} è stato acquistato come regalo dal cliente originale, ma ciò deve essere dichiarato subito e sarà necessario trasferire la proprietà del {{CATEGORY_SG}} tramite la piattaforma AION. Il {{CATEGORY_SG}} può essere regalato solo per una volta; se ulteriormente ceduto a terzi, il servizio decade."
      }
    ],
    sort_order: 15
  },
  {
    title: "A chi posso rivolgermi se ho domande sul {{PROGRAMME_SHORT}}?",
    blocks: [
      {
        type: "p",
        text: "Puoi contattare il servizio clienti {{BRAND}} all’indirizzo {{SUPPORT}}"
      }
    ],
    sort_order: 16
  },
  {
    title: "Come verranno trattati i miei dati personali?",
    blocks: [
      {
        type: "p",
        text: "I dati personali che fornisci quando attivi {{PROGRAMME}} o quando informi {{BRAND}} di danni accidentali, furti o rapine, inclusa una copia del tuo documento di identità quando richiesto, saranno trattati esclusivamente per la fornitura del servizio. La copia del documento di identità sarà eliminata una volta verificata la tua identità. Eventuali ulteriori dati che potresti dover condividere per la fornitura del servizio, come una denuncia alla polizia, saranno conservati per 10 anni secondo la normativa applicabile. Le uniche parti coinvolte nella fornitura del servizio sono {{BRAND}} Spa e AION Cover Srl (partner tecnico). Si prega di consultare la Privacy Policy di {{BRAND}} e AION Cover per ulteriori informazioni sui tuoi diritti e sul trattamento dei tuoi dati personali."
      }
    ],
    sort_order: 17
  }
] as const;

