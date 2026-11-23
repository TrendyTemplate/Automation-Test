import type { MessageKind } from "./risk";

/**
 * Deterministic fallback copy, used when the AI writer is unavailable
 * (no API key, API error, refusal). Short and safe: no promises about dates.
 */
interface Copy {
  subject: Record<MessageKind, string>;
  hello: string;
  line: Record<MessageKind, string>;
  track: string;
  discount: string;
  thanks: string;
}

const COPY: Record<string, Copy> = {
  en: {
    subject: {
      stalled: "An update on your order {order}",
      delayed: "Your order {order} is running late",
      exception: "Action may be needed for your order {order}",
      lost: "We're looking into your order {order}",
      delivered: "Your order {order} has arrived",
    },
    hello: "Hi there,",
    line: {
      stalled:
        "Your parcel hasn't had a tracking update from the carrier for a little while. Pauses like this usually clear up on their own, and we're keeping an eye on it for you.",
      delayed:
        "Your parcel is taking longer than expected to reach you. We're sorry about the wait. It's still on its way and we're watching it closely.",
      exception:
        "The carrier reported an issue while delivering your parcel. Please check the tracking page for details, or simply reply to this email and we'll help.",
      lost:
        "Your parcel is well past its expected delivery date. We're sorry. We're investigating with the carrier and will make it right. Reply to this email if you have any questions.",
      delivered: "Good news: the carrier shows your parcel as delivered. Thank you for bearing with us during the delay. If anything isn't right, just reply to this email.",
    },
    track: "Track your parcel: {url}",
    discount: "As a thank-you for your patience, here's {percent}% off your next order: {code}",
    thanks: "Thank you for your patience,",
  },
  es: {
    subject: {
      stalled: "Novedades sobre tu pedido {order}",
      delayed: "Tu pedido {order} viene con retraso",
      exception: "Tu pedido {order} podría necesitar atención",
      lost: "Estamos revisando tu pedido {order}",
      delivered: "Tu pedido {order} ha llegado",
    },
    hello: "Hola,",
    line: {
      stalled:
        "Tu paquete no ha tenido actualizaciones de seguimiento desde hace un tiempo. Estas pausas suelen resolverse solas y lo estamos vigilando.",
      delayed:
        "Tu paquete está tardando más de lo previsto. Sentimos la espera. Sigue en camino y lo estamos siguiendo de cerca.",
      exception:
        "La empresa de transporte informó de un problema con la entrega. Revisa la página de seguimiento o responde a este correo y te ayudaremos.",
      lost:
        "Tu paquete ha superado con creces la fecha prevista. Lo sentimos. Estamos investigándolo con la empresa de transporte y lo solucionaremos.",
      delivered: "Buenas noticias: la empresa de transporte indica que tu paquete ha sido entregado. Gracias por tu paciencia con el retraso. Si algo no está bien, responde a este correo.",
    },
    track: "Sigue tu paquete: {url}",
    discount: "Como agradecimiento por tu paciencia, tienes un {percent}% de descuento en tu próximo pedido: {code}",
    thanks: "Gracias por tu paciencia,",
  },
  fr: {
    subject: {
      stalled: "Des nouvelles de votre commande {order}",
      delayed: "Votre commande {order} a du retard",
      exception: "Votre commande {order} nécessite peut-être votre attention",
      lost: "Nous enquêtons sur votre commande {order}",
      delivered: "Votre commande {order} est arrivée",
    },
    hello: "Bonjour,",
    line: {
      stalled:
        "Votre colis n'a pas reçu de mise à jour du transporteur depuis un moment. Ces pauses se résolvent généralement d'elles-mêmes et nous le surveillons.",
      delayed:
        "Votre colis met plus de temps que prévu à arriver. Nous sommes désolés pour l'attente. Il est toujours en route et nous le suivons de près.",
      exception:
        "Le transporteur a signalé un problème lors de la livraison. Consultez la page de suivi ou répondez simplement à cet e-mail pour obtenir de l'aide.",
      lost:
        "Votre colis a largement dépassé la date de livraison prévue. Nous en sommes désolés. Nous enquêtons auprès du transporteur et allons trouver une solution.",
      delivered: "Bonne nouvelle : le transporteur indique que votre colis a été livré. Merci pour votre patience malgré le retard. Si quelque chose ne va pas, répondez simplement à cet e-mail.",
    },
    track: "Suivre votre colis : {url}",
    discount: "Pour vous remercier de votre patience, voici {percent} % de réduction sur votre prochaine commande : {code}",
    thanks: "Merci pour votre patience,",
  },
  de: {
    subject: {
      stalled: "Neuigkeiten zu deiner Bestellung {order}",
      delayed: "Deine Bestellung {order} verspätet sich",
      exception: "Deine Bestellung {order} braucht eventuell Aufmerksamkeit",
      lost: "Wir kümmern uns um deine Bestellung {order}",
      delivered: "Deine Bestellung {order} ist angekommen",
    },
    hello: "Hallo,",
    line: {
      stalled:
        "Für dein Paket gab es seit einer Weile kein Tracking-Update vom Versanddienstleister. Solche Pausen lösen sich meist von selbst, und wir behalten es im Blick.",
      delayed:
        "Dein Paket braucht länger als erwartet. Entschuldige die Wartezeit. Es ist weiterhin unterwegs und wir verfolgen es genau.",
      exception:
        "Der Versanddienstleister hat ein Problem bei der Zustellung gemeldet. Sieh dir die Sendungsverfolgung an oder antworte einfach auf diese E-Mail, wir helfen dir.",
      lost:
        "Dein Paket ist deutlich über dem erwarteten Liefertermin. Das tut uns leid. Wir klären es mit dem Versanddienstleister und finden eine Lösung.",
      delivered: "Gute Nachrichten: Laut Versanddienstleister wurde dein Paket zugestellt. Danke für deine Geduld trotz der Verspätung. Falls etwas nicht stimmt, antworte einfach auf diese E-Mail.",
    },
    track: "Sendung verfolgen: {url}",
    discount: "Als Dankeschön für deine Geduld erhältst du {percent} % Rabatt auf deine nächste Bestellung: {code}",
    thanks: "Danke für deine Geduld,",
  },
  it: {
    subject: {
      stalled: "Aggiornamento sul tuo ordine {order}",
      delayed: "Il tuo ordine {order} è in ritardo",
      exception: "Il tuo ordine {order} potrebbe richiedere attenzione",
      lost: "Stiamo verificando il tuo ordine {order}",
      delivered: "Il tuo ordine {order} è arrivato",
    },
    hello: "Ciao,",
    line: {
      stalled:
        "Il tuo pacco non riceve aggiornamenti dal corriere da un po'. Di solito queste pause si risolvono da sole e lo stiamo monitorando.",
      delayed:
        "Il tuo pacco sta impiegando più tempo del previsto. Ci scusiamo per l'attesa. È ancora in viaggio e lo seguiamo da vicino.",
      exception:
        "Il corriere ha segnalato un problema durante la consegna. Controlla la pagina di tracciamento o rispondi a questa email e ti aiuteremo.",
      lost:
        "Il tuo pacco ha superato di molto la data di consegna prevista. Ci dispiace. Stiamo indagando con il corriere e risolveremo.",
      delivered: "Buone notizie: il corriere indica che il tuo pacco è stato consegnato. Grazie per la pazienza durante il ritardo. Se qualcosa non va, rispondi a questa email.",
    },
    track: "Traccia il tuo pacco: {url}",
    discount: "Per ringraziarti della pazienza, ecco il {percent}% di sconto sul prossimo ordine: {code}",
    thanks: "Grazie per la pazienza,",
  },
  pt: {
    subject: {
      stalled: "Novidades sobre o seu pedido {order}",
      delayed: "O seu pedido {order} está atrasado",
      exception: "O seu pedido {order} pode precisar de atenção",
      lost: "Estamos verificando o seu pedido {order}",
      delivered: "O seu pedido {order} chegou",
    },
    hello: "Olá,",
    line: {
      stalled:
        "O seu pacote está há algum tempo sem atualizações da transportadora. Essas pausas costumam se resolver sozinhas e estamos acompanhando.",
      delayed:
        "O seu pacote está demorando mais do que o previsto. Desculpe pela espera. Ele continua a caminho e estamos acompanhando de perto.",
      exception:
        "A transportadora informou um problema na entrega. Confira a página de rastreamento ou responda a este e-mail e vamos ajudar.",
      lost:
        "O seu pacote passou bastante da data prevista. Sentimos muito. Estamos investigando com a transportadora e vamos resolver.",
      delivered: "Boas notícias: a transportadora indica que o seu pacote foi entregue. Obrigado pela paciência durante o atraso. Se algo não estiver certo, responda a este e-mail.",
    },
    track: "Rastreie o seu pacote: {url}",
    discount: "Como agradecimento pela paciência, aqui está {percent}% de desconto no seu próximo pedido: {code}",
    thanks: "Obrigado pela paciência,",
  },
  nl: {
    subject: {
      stalled: "Een update over je bestelling {order}",
      delayed: "Je bestelling {order} heeft vertraging",
      exception: "Je bestelling {order} heeft mogelijk aandacht nodig",
      lost: "We zoeken je bestelling {order} uit",
      delivered: "Je bestelling {order} is aangekomen",
    },
    hello: "Hoi,",
    line: {
      stalled:
        "Je pakket heeft al een tijdje geen update van de vervoerder gehad. Zulke pauzes lossen zich meestal vanzelf op en we houden het in de gaten.",
      delayed:
        "Je pakket doet er langer over dan verwacht. Sorry voor het wachten. Het is nog onderweg en we volgen het nauwlettend.",
      exception:
        "De vervoerder meldde een probleem bij de bezorging. Bekijk de trackingpagina of beantwoord deze e-mail en we helpen je.",
      lost:
        "Je pakket is ruim over de verwachte bezorgdatum. Het spijt ons. We onderzoeken het met de vervoerder en lossen het op.",
      delivered: "Goed nieuws: volgens de vervoerder is je pakket bezorgd. Bedankt voor je geduld tijdens de vertraging. Klopt er iets niet? Beantwoord dan deze e-mail.",
    },
    track: "Volg je pakket: {url}",
    discount: "Als dank voor je geduld krijg je {percent}% korting op je volgende bestelling: {code}",
    thanks: "Bedankt voor je geduld,",
  },
};

export const TEMPLATE_LANGUAGES = Object.keys(COPY);

export interface TemplateArgs {
  kind: MessageKind;
  language: string;
  orderName: string;
  storeName: string;
  trackingUrl?: string | null;
  discount?: { code: string; percent: number } | null;
  signature?: string | null;
}

export function renderTemplate(args: TemplateArgs): {
  subject: string;
  body: string;
  language: string;
} {
  const language = COPY[args.language] ? args.language : "en";
  const c = COPY[language];
  const fill = (s: string) =>
    s
      .replaceAll("{order}", args.orderName)
      .replaceAll("{url}", args.trackingUrl ?? "")
      .replaceAll("{code}", args.discount?.code ?? "")
      .replaceAll("{percent}", String(args.discount?.percent ?? ""));

  const parts = [c.hello, "", fill(c.line[args.kind])];
  if (args.trackingUrl) parts.push("", fill(c.track));
  if (args.discount) parts.push("", fill(c.discount));
  parts.push("", c.thanks, args.signature?.trim() || args.storeName);

  return { subject: fill(c.subject[args.kind]), body: parts.join("\n"), language };
}
