/**
 * DER HERKUNFTSRIEGEL VOR DER GANZEN API.
 *
 * ── DIE LAGE, GEMESSEN ──────────────────────────────────────────────────
 * In server.ts steht `app.use(cors())` VOR dem Anmeldetor und gilt fuer alle
 * Wege. In der ausgelieferten Vorlage ist `interfacelogin.state = false`, das
 * Tor also offen. Beides zusammen heisst: die Box antwortet JEDER Herkunft mit
 * `Access-Control-Allow-Origin: *` und ohne Anmeldung. Eine beliebige
 * Webseite, die ein Elternteil im selben Heimnetz aufmacht, holt sich mit
 * einem einzigen `fetch('http://mupibox:8200/api/konfiguration')` die
 * Konfiguration, die Kinderprofile, die Zugangsdaten der Dienste — und darf
 * die Antwort auch LESEN, weil der Stern das erlaubt.
 *
 * Fuer `/api/sicherung*` wurde am 07.08.2026 bereits ein Strich gezogen
 * (sicherung.ts, `r.use(...)`). DIES HIER IST DERSELBE STRICH FUER DEN REST —
 * keine zweite Bauart: Kopfzeile weg, `Vary: Origin` dazu, 403 mit einem Satz,
 * der SAGT was los ist.
 *
 * ── DIE ENTSCHEIDUNG DES BETREIBERS (07.08.2026) ────────────────────────
 * Ihm lagen drei Wege vor. Gewaehlt hat er:
 *
 *     „Anfragen MIT fremder Herkunft werden abgelehnt, alles OHNE Herkunft
 *      (die eigene Oberflaeche, curl, die Verwaltung) laeuft weiter."
 *
 * Abgelehnt hat er eine Anmeldung als Vorgabe („ein vergessenes Passwort ist
 * eine neue Sackgasse ohne SSH") und „so lassen". Hier steht deshalb KEINE
 * zweite Huerde fuer den, der davorsitzt: kein Passwort, kein Token, kein
 * Schalter, den man erst finden muss.
 *
 * ── WAS „EIGENE HERKUNFT" HEISST, UND WARUM ES AUS DER ANFRAGE KOMMT ────
 * Verglichen wird `Origin` gegen die Kopfzeile `Host` DERSELBEN ANFRAGE.
 * Nichts ist fest eingetragen — die Box ist mal `192.168.178.169`, mal
 * `mupibox.local`, mal `localhost` (Kiosk), mal `MuPiBox`, und jeder dieser
 * Namen ist fuer den Browser eine eigene Herkunft. Wer hier eine Liste
 * pflegen muesste, sperrt frueher oder spaeter die Verwaltung aus.
 *
 *   * Kiosk `http://localhost:8200/neu/`      → Host `localhost:8200`   ✓
 *   * Zweiter Rechner `http://<ip>:8200/admin`→ Host `<ip>:8200`        ✓
 *   * TLS `https://<ip>:8443/admin`           → Host `<ip>:8443`        ✓
 *   * Fremde Seite `https://boese.example`    → Host `<ip>:8200`        ✗
 *
 * ── UND WARUM DAS ALLEIN NICHT REICHT (Befund vom 07.08.2026) ───────────
 * `Origin` gegen `Host` zu halten faengt die gewoehnliche fremde Seite — aber
 * nicht den NAMENSTAUSCH. Zeigt der Name einer fremden Seite nach dem ersten
 * Laden auf die Box (der Angreifer beherrscht seine eigene Namensaufloesung),
 * dann tragen `Host` UND `Origin` denselben fremden Namen. Fuer den Browser ist
 * das gleichherkuenftig, er meldet sogar `Sec-Fetch-Site: same-origin`, und
 * beide Riegel oben sehen nichts Fremdes. Gemessen: `POST /api/konfiguration`
 * mit `Host: boese.example` kam mit 200 durch und aenderte die Lautstaerke in
 * mupiboxconfig.json.
 *
 * DAGEGEN HILFT NUR EINES: die Box muss WISSEN, WIE SIE SELBST HEISST, und
 * einen `Host`, der keiner ihrer Namen ist, zurueckweisen. Diese Namen leitet
 * `eigene-namen.ts` zur LAUFZEIT ab (Schnittstellen, Rechnername,
 * Konfiguration, reservierte Heimnetz-Endungen) — dort steht auch, warum
 * dieser Riegel im Zweifel AUFGEHT statt zuzufallen und welchen Ausweg der
 * abgewiesene Mensch bekommt.
 *
 * DAS SCHEMA WIRD ABSICHTLICH NICHT VERGLICHEN, nur Rechnername und Port.
 * Grund: ob DIESE Verbindung ueber TLS lief, weiss der Server aus dem Socket —
 * ob die SEITE ueber TLS geladen wurde, sagt nur der `Origin`. Steht je ein
 * Zwischenstueck davor, das TLS abschliesst (heute keins, aber das ist eine
 * Aussage ueber heute), waere ein Schemavergleich genau die Sackgasse, die
 * niemand melden kann, weil der Betreiber nicht davorsitzt. Der Preis ist
 * klein: `https://<box>:8200` waere erlaubt, obwohl die Box auf 8200 nur
 * Klartext spricht — eine Seite unter dieser Herkunft kann es also gar nicht
 * geben, und `Origin` kann sich eine Seite nicht ausdenken.
 *
 * ── `Origin: null` WIRD ABGEWIESEN ──────────────────────────────────────
 * `null` gibt es wirklich: aus einer lokalen Datei (`file://`), aus einem
 * `<iframe sandbox>` ohne `allow-same-origin`, nach mancher Weiterleitung.
 * Alle drei sind KEINE Seite dieser Box — die eigene Oberflaeche wird immer
 * ueber http oder https ausgeliefert und hat damit immer eine echte Herkunft.
 * `null` ist ausserdem der Wert, den ein Angreifer am leichtesten herstellt
 * (ein sandkastenrahmen genuegt); wer ihn durchlaesst, hat den Riegel fuer
 * genau den Fall geoeffnet, gegen den er gebaut ist. Also: abgewiesen.
 * Ein Werkzeug, das eine lokale HTML-Datei gegen die Box laufen laesst, muss
 * die Seite von der Box holen — oder `MUPIBOX_HERKUNFT_ZUSATZ` setzen.
 *
 * ── WERKZEUGE OHNE HERKUNFT KOMMEN DURCH ────────────────────────────────
 * curl, die Messwerkzeuge in tools/, ein Skript auf der Box, `wget` im
 * Notfall: die schicken gar keinen `Origin`. Genau das ist der Weg, den der
 * Betreiber offen haben wollte. Ohne `Origin` wird nicht abgewiesen.
 *
 * ── DER FORMULAR-POST, DER OHNE CORS FUNKTIONIERT ───────────────────────
 * Ein `<form method="post" action="http://box:8200/api/...">` auf einer
 * fremden Seite braucht KEINE Vorabfrage. Ein Riegel, der nur das LESEN
 * verhindert (also nur die Kopfzeile entfernt), laesst das SCHREIBEN offen.
 * DIESER Riegel faengt ihn: ein Formular-POST ueber Herkunftsgrenzen traegt
 * `Origin` (der Browser setzt ihn bei JEDEM POST, auch beim Formular), und
 * damit greift die Ablehnung — nicht erst das Nichtlesenkoennen der Antwort.
 * Nachgemessen in tools/herkunftsriegel-probe.mjs, Fall „Formular-POST".
 *
 * ── ZWEITE LAGE: KEIN `Origin`, ABER TROTZDEM EINE FREMDE SEITE ─────────
 * `<img src="http://box:8200/api/vorlesen/sprich?text=...">` schickt keinen
 * `Origin` — und `/api/vorlesen/sprich` ist ein GET MIT WIRKUNG (die Box
 * redet). Dagegen hilft `Sec-Fetch-Site`: die setzt der BROWSER, aus einer
 * Seite heraus ist sie nicht faelschbar. Abgewiesen wird NUR der Wert
 * `cross-site`; `same-origin`, `same-site`, `none` (Adresszeile, Lesezeichen)
 * und „gar nicht da" (curl, aelterer Browser, Zwischenstueck) kommen durch.
 *
 * MIT EINER AUSNAHME: eine Navigation der obersten Ebene
 * (`Sec-Fetch-Mode: navigate` UND `Sec-Fetch-Dest: document`) darf durch —
 * ABER NUR DORT, WO EINE SEITE LIEGT (`seitenwechselErlaubt`, s.u.). Lesen
 * kann eine fremde Seite so nichts; die Antwort landet im Fenster des
 * Menschen, nicht im Skript des Angreifers. Ein RAHMEN dagegen
 * (`Dest: iframe|embed|object|frame`) wird abgewiesen, denn den setzt eine
 * fremde Seite unsichtbar auf ihre eigene.
 *
 * ── UND WARUM DIESE AUSNAHME UNTER /api ABGESCHALTET IST ────────────────
 * Sie war fuer den Rueckweg von Spotify gedacht. DER LIEGT ABER AUF
 * `/spotify`, und dort haengt dieser Riegel gar nicht (server.ts haengt ihn
 * auf `/api` und `/player`). Sie hat dort also nie geholfen — gekostet hat
 * sie dagegen: unter `/api` liegt KEINE Seite, sondern lauter Wege, und
 * einige davon sind GETs MIT WIRKUNG. Gemessen am 07.08.2026 mit
 * tools/riegel-durchkommen.mjs, Ring 4, an einem echten Serverprozess:
 * `Sec-Fetch-Site: cross-site` + `navigate` + `document` (also ein Klick auf
 * einen Link einer fremden Seite, oder `window.open`) erreichte
 * `/api/vorlesen/sprich?text=…` — die Box redet —, `/api/netzwerk/scan` und
 * `/api/konfiguration`.
 *
 * Bis zum selben Tag war das unsichtbar: der Riegel aus sicherung.ts hing
 * ohne Pfad und wies vorher JEDE Anfrage mit `cross-site` ab. Mit dessen
 * Reparatur (er haengt jetzt auf `/api/sicherung`) wurde diese Ausnahme
 * scharf. Eine Deckung, die von einem Fehler an anderer Stelle lebt, ist
 * keine.
 *
 * UNTER `/player` BLEIBT SIE AN, und das ist kein Zoegern: dort liegen die
 * Seiten der Oberflaeche. server.ts reicht eine Navigation dorthin an die
 * Auslieferung der Einzelseiten-Anwendung weiter (`istSeitenaufruf`, Zeile
 * 1690 ff.) und laesst sie NICHT an den Abspieler — ein Startbefehl ist nie
 * eine Navigation. Wer von aussen auf `http://<box>:8200/player/…` verlinkt,
 * bekommt eine Seite zu sehen und darf das auch.
 *
 * ── WAS DIESER RIEGEL NICHT KANN ────────────────────────────────────────
 *  1. Ein Browser ohne `Sec-Fetch-*` (sehr alt) ist beim Fall oben ungedeckt.
 *     Der Origin-Teil greift dort weiterhin, denn `Origin` gibt es viel
 *     laenger als `Sec-Fetch-Site`.
 *  2. Wer im Netz steht und selbst `curl` benutzt, kommt weiterhin an alles.
 *     Das ist die Entscheidung des Betreibers, nicht ein Versehen: dagegen
 *     hilft nur eine Anmeldung, und die war ausdruecklich abgelehnt.
 *     `interfacelogin.state = true` bleibt der Weg fuer den, der das will.
 *  3. Websockets und Eventstreams gehorchen CORS nicht. Die Box BIETET
 *     keinen an — worauf es ankommt, denn nur ein angebotener Draht laesst
 *     sich von aussen ansprechen. Sie oeffnet aber seit E75 (22.08.2026)
 *     einen AUSGEHENDEN: `server.ts` haengt sich an Soloists `ws://`-Draht
 *     auf der eigenen Box. Der hat keine fremde Herkunft, niemand von
 *     draussen kann ihn ausloesen — dieser Riegel muss ihn nicht sehen.
 *
 *     Der Satz stand hier bis zum 25.08.2026 als „die Box fuehrt keine (am
 *     07.08.2026 nachgesehen: kein `ws`)". Das war 18 Tage lang eine
 *     Messung, die niemand wiederholte, und `ws` gab es laengst wieder.
 *     Ein datiertes Nachgesehen ist keine Wache: `tools/herkunft-annahme-
 *     probe.py` misst die Annahme jetzt bei jedem Lauf — kein angebotener
 *     Draht, und jeder ausgehende mit Grund eingetragen.
 *
 *     KAEME EIN ANGEBOTENER DAZU, muesste er seine Herkunft SELBST pruefen;
 *     dieser Riegel sieht ihn nicht. Die Probe wird dann rot und sagt es.
 *
 * ── DIE ZWEI SCHALTER (und wofuer sie da sind) ──────────────────────────
 *   MUPIBOX_HERKUNFT_ZUSATZ  Komma-Liste zusaetzlich erlaubter Herkuenfte,
 *                            z.B. `http://localhost:4200` fuer `ng serve`
 *                            gegen eine echte Box (environment.ts zeigt im
 *                            Entwicklungsbau auf `<rechner>:8200` — das IST
 *                            eine fremde Herkunft).
 *   MUPIBOX_HERKUNFT_AUS=1   Riegel aus. Existiert fuer die GEGENPROBE in
 *                            tools/herkunftsriegel-probe.mjs: ohne einen
 *                            Lauf, der rot wird, misst die Probe nichts.
 */

import type { NextFunction, Request, Response } from 'express'
import { type EigeneNamen, fremderNameSatz, fremderNameSeite, istEigenerName, namenErmitteln } from './eigene-namen'

/** Was der Riegel von einer Anfrage ueberhaupt ansieht. */
export interface HerkunftKopf {
  /** Die `Origin`-Kopfzeile, falls vorhanden. */
  origin?: string
  /** Die `Host`-Kopfzeile — Rechnername und Port, unter denen wir gefragt wurden. */
  host?: string
  /** Lief DIESE Verbindung ueber TLS? Bestimmt nur den Vorgabeport von `Host`. */
  tls?: boolean
  /** `Sec-Fetch-Site` — vom Browser gesetzt, aus einer Seite nicht faelschbar. */
  site?: string
  /** `Sec-Fetch-Mode`. */
  modus?: string
  /** `Sec-Fetch-Dest`. */
  ziel?: string
}

/** Warum eine Anfrage abgewiesen wurde — je Grund ein eigener Satz. */
export type Ablehnungsgrund =
  | 'fremde-herkunft'
  | 'herkunft-null'
  | 'fremde-seite'
  | 'fremder-seitenwechsel'
  | 'fremder-name'

export type Urteil =
  | { erlaubt: true; herkunft: 'keine' | 'eigen' | 'zusatz' }
  | { erlaubt: false; grund: Ablehnungsgrund; satz: string }

const SAETZE: Record<Ablehnungsgrund, string> = {
  'fremde-herkunft':
    'Diese Schnittstelle laesst sich nur von der Oberflaeche dieser Box aus benutzen — die Anfrage kam von einer anderen Webseite.',
  'herkunft-null':
    'Diese Schnittstelle laesst sich nur von der Oberflaeche dieser Box aus benutzen — die Anfrage kam aus einer Seite ohne eigene Herkunft (lokale Datei oder abgeschotteter Rahmen).',
  'fremde-seite':
    'Diese Schnittstelle laesst sich nur von der Oberflaeche dieser Box aus benutzen — der Browser meldet, dass die Anfrage von einer anderen Webseite ausging.',
  // DER EINZIGE SATZ, DEN EIN MENSCH WIRKLICH ZU SEHEN BEKOMMT: er steht in
  // einem Fenster, das er selbst geoeffnet hat, weil er auf einen Link
  // geklickt hat. Also sagt er nicht nur „nein", sondern was zu tun ist.
  'fremder-seitenwechsel':
    'Hier liegt keine Seite, sondern eine Schnittstelle der Box — und der Link dorthin stand auf einer anderen Webseite. Wer die Box bedienen will, gibt ihre Adresse selbst ein (zum Beispiel http://mupibox.local:8200/admin); von dort aus geht alles.',
  // ERSATZ. Der echte Satz wird gebaut, weil er die Adressen DIESER Box und
  // den gerufenen Namen nennen muss — siehe `fremderNameSatz`. Dieser hier
  // steht nur, falls jemand `SAETZE` ohne den Bauplan benutzt.
  'fremder-name':
    'Diese Box kennt sich unter dem Namen nicht, mit dem sie gerufen wurde. Rufen Sie sie unter ihrer Adresse auf (zum Beispiel http://192.168.x.y:8200/).',
}

/** Vorgabeport eines Schemas. Alles andere als http/https zaehlt als fremd. */
function vorgabeport(schema: string): number | null {
  if (schema === 'http:') return 80
  if (schema === 'https:') return 443
  return null
}

/**
 * `Origin` in Rechnername und Port zerlegen.
 *
 * `new URL` kuemmert sich um die Klammern bei IPv6 (`http://[::1]:8200`) und
 * um Grossschreibung im Namen. Alles, was sich nicht als http/https lesen
 * laesst (`file:`, `chrome-extension:`, Muell), ergibt `null` — und `null`
 * heisst hier immer „nicht die eigene Herkunft".
 */
export function herkunftZerlegen(origin: string): { rechner: string; port: number } | null {
  try {
    const u = new URL(origin)
    const vp = vorgabeport(u.protocol)
    if (vp === null) return null
    if (!u.hostname) return null
    return { rechner: u.hostname.toLowerCase(), port: u.port ? Number(u.port) : vp }
  } catch {
    return null
  }
}

/**
 * Die `Host`-Kopfzeile zerlegen — das ist die Herkunft, unter der WIR gerade
 * gefragt werden. Fehlt der Port, entscheidet die Verbindung: ueber TLS 443,
 * sonst 80.
 */
export function gastgeberZerlegen(host: string, tls: boolean): { rechner: string; port: number } | null {
  const roh = String(host ?? '').trim()
  if (!roh) return null
  return herkunftZerlegen(`${tls ? 'https' : 'http'}://${roh}`)
}

/** Eine Herkunftsangabe auf die Form bringen, in der verglichen wird. */
function normieren(text: string): string {
  return text.trim().replace(/\/+$/, '').toLowerCase()
}

/** `MUPIBOX_HERKUNFT_ZUSATZ` (oder eine Liste) in eine Menge verwandeln. */
export function zusatzLesen(roh: string | undefined): Set<string> {
  return new Set(
    String(roh ?? '')
      .split(',')
      .map(normieren)
      .filter((s) => s.length > 0),
  )
}

/**
 * Das Urteil ueber EINE Anfrage. Reine Funktion — sie kennt kein express,
 * damit sie sich Fall fuer Fall pruefen laesst (herkunft.spec.ts) und die
 * Probe am echten Server (tools/herkunftsriegel-probe.mjs) dieselbe Formel
 * misst und nicht eine zweite Fassung davon.
 */
export function herkunftBeurteilen(
  kopf: HerkunftKopf,
  zusatz: Set<string> = new Set(),
  /**
   * Darf eine Navigation der obersten Ebene von einer fremden Seite durch?
   *
   * VORGABE `true`, weil die Regel fuer einen Weg gilt, an dem eine SEITE
   * liegt. Wer den Riegel vor eine Schnittstelle haengt (`/api`), setzt sie
   * auf `false` — die Begruendung steht im Kopf dieser Datei.
   */
  seitenwechselErlaubt = true,
  /**
   * Die Namen, unter denen diese Box sich selbst kennt.
   *
   * `null` (die VORGABE) heisst: der Namensteil wird uebersprungen. Das ist
   * kein Versehen, sondern die Bauart — so bleibt diese Funktion fuer alle
   * bisherigen Aufrufer und Tests unveraendert, und die Ableitung der Namen
   * (die das Netz und eine Datei liest) bleibt draussen.
   */
  eigene: EigeneNamen | null = null,
): Urteil {
  const origin = String(kopf.origin ?? '').trim()
  const wirSelbst = gastgeberZerlegen(String(kopf.host ?? ''), Boolean(kopf.tls))

  // ── ZUERST: HEISSEN WIR UEBERHAUPT SO? ────────────────────────────────
  //
  // Dieser Teil steht VOR dem Origin-Vergleich, weil er die Frage beantwortet,
  // auf der jener aufbaut: `Origin` gegen `Host` zu halten ist nur dann eine
  // Aussage, wenn `Host` WIRKLICH wir sind. Beim Namenstausch stimmen beide
  // ueberein und sind trotzdem fremd.
  //
  // OHNE LESBAREN `Host` WIRD NICHT GERATEN (`wirSelbst === null`): HTTP/1.0
  // kennt die Kopfzeile nicht, ein Werkzeug laesst sie weg. Ein Browser
  // schickt sie immer und kann sie aus einer Seite heraus nicht faelschen —
  // der Fall kommt also nicht aus einem Angriff, und Aussperren waere hier
  // der teurere Fehler.
  //
  // `verlaesslich === false` heisst: die Box konnte ihre eigenen Namen nicht
  // ermitteln. Dann gilt derselbe Satz — lieber der Stand von gestern als eine
  // Box, die niemanden mehr hereinlaesst. Begruendet in eigene-namen.ts.
  if (eigene?.verlaesslich && wirSelbst && !istEigenerName(wirSelbst.rechner, eigene)) {
    return {
      erlaubt: false,
      grund: 'fremder-name',
      satz: fremderNameSatz(wirSelbst.rechner, eigene, kopf.tls ? 'https' : 'http', wirSelbst.port),
    }
  }

  if (origin) {
    // `null` ist keine Herkunft, sondern die Abwesenheit einer. Siehe Kopf.
    if (origin.toLowerCase() === 'null') {
      return { erlaubt: false, grund: 'herkunft-null', satz: SAETZE['herkunft-null'] }
    }
    if (zusatz.has(normieren(origin))) return { erlaubt: true, herkunft: 'zusatz' }

    const wer = herkunftZerlegen(origin)
    const wir = wirSelbst
    // OHNE `Host` KANN NICHT VERGLICHEN WERDEN — und dann wird nicht geraten.
    // Ein Browser schickt die Kopfzeile immer und kann sie nicht veraendern
    // (`fetch` verbietet es), ein fehlender `Host` kommt also nicht aus einer
    // fremden Seite. Durchlassen ist hier das kleinere Uebel: der Riegel darf
    // die Verwaltung nicht aussperren, wenn er die Lage nicht beurteilen kann.
    if (!wir) return { erlaubt: true, herkunft: 'keine' }
    if (!wer || wer.rechner !== wir.rechner || wer.port !== wir.port) {
      return { erlaubt: false, grund: 'fremde-herkunft', satz: SAETZE['fremde-herkunft'] }
    }
    return { erlaubt: true, herkunft: 'eigen' }
  }

  // Keine Herkunft: curl, ein Skript auf der Box, ein Werkzeug aus tools/,
  // eine einfache gleichherkuenftige GET-Anfrage des Browsers.
  if (String(kopf.site ?? '').toLowerCase() === 'cross-site') {
    if (!istSeitenwechsel(kopf)) {
      return { erlaubt: false, grund: 'fremde-seite', satz: SAETZE['fremde-seite'] }
    }
    // Es IST eine Navigation der obersten Ebene — aber liegt hier eine Seite?
    if (!seitenwechselErlaubt) {
      return { erlaubt: false, grund: 'fremder-seitenwechsel', satz: SAETZE['fremder-seitenwechsel'] }
    }
  }
  return { erlaubt: true, herkunft: 'keine' }
}

/**
 * Ist das ein Mensch, der ein FENSTER auf diesen Weg schickt?
 *
 * Nur die oberste Ebene (`Dest: document`) zaehlt. Ein Rahmen (`iframe`,
 * `embed`, `object`, `frame`) ist auch eine Navigation, aber eine, die eine
 * fremde Seite unsichtbar auf ihrer eigenen unterbringt — und ein GET mit
 * Wirkung waere damit ausloesbar, ohne dass jemand etwas sieht.
 */
function istSeitenwechsel(kopf: HerkunftKopf): boolean {
  return String(kopf.modus ?? '').toLowerCase() === 'navigate' && String(kopf.ziel ?? '').toLowerCase() === 'document'
}

export interface RiegelEinstellungen {
  /** Zusaetzlich erlaubte Herkuenfte (Vorgabe: `MUPIBOX_HERKUNFT_ZUSATZ`). */
  zusatz?: Set<string>
  /** Riegel abschalten — NUR fuer die Gegenprobe (`MUPIBOX_HERKUNFT_AUS=1`). */
  aus?: boolean
  /**
   * Darf eine Navigation der obersten Ebene von einer fremden Seite durch?
   * Vorgabe `true` (dort liegt eine Seite). Vor `/api` steht `false` — siehe
   * den Kopf dieser Datei.
   */
  seitenwechselErlaubt?: boolean
  /** Wird bei jeder Ablehnung gerufen; im Betrieb `console.warn`. */
  melden?: (satz: string) => void
  /**
   * Woher die eigenen Namen kommen. Vorgabe: `namenErmitteln` (Schnittstellen,
   * Rechnername, Konfiguration — gepuffert). Ein Werkzeug oder ein Test setzt
   * hier eine eigene Quelle ein; `() => null` schaltet den Namensteil ab.
   */
  eigeneNamen?: () => EigeneNamen | null
}

/**
 * Die Zwischenschicht fuer server.ts.
 *
 * SIE GEHOERT VOR `app.use(cors())`, und das ist der Punkt: `cors()` beantwortet
 * eine Vorabfrage (OPTIONS) SELBST und beendet die Antwort. Stuende der Riegel
 * dahinter, saehe er die Vorabfrage nie und die fremde Seite bekaeme auf sie
 * ein freundliches `Access-Control-Allow-Origin: *`. Davor gestellt faellt die
 * Vorabfrage mit ab — sie traegt `Origin` wie jede andere Anfrage.
 *
 * Auf dem erlaubten Weg wird `cors()` danach normal gefragt und setzt seinen
 * Stern. Das ist unschaedlich: dort ist die Herkunft entweder die eigene
 * (dann prueft der Browser gar nicht erst) oder es gibt keine (dann gibt es
 * auch niemanden, dem der Stern etwas erlauben koennte).
 */
export function herkunftsriegelBauen(e: RiegelEinstellungen = {}) {
  const zusatz = e.zusatz ?? zusatzLesen(process.env.MUPIBOX_HERKUNFT_ZUSATZ)
  const aus = e.aus ?? process.env.MUPIBOX_HERKUNFT_AUS === '1'
  const namenQuelle = e.eigeneNamen ?? (() => namenErmitteln())
  return (req: Request, res: Response, next: NextFunction): void => {
    if (aus) {
      next()
      return
    }
    const urteil = herkunftBeurteilen(
      {
        origin: einKopf(req.headers.origin),
        host: einKopf(req.headers.host),
        tls: Boolean((req.socket as { encrypted?: boolean } | undefined)?.encrypted),
        site: einKopf(req.headers['sec-fetch-site']),
        modus: einKopf(req.headers['sec-fetch-mode']),
        ziel: einKopf(req.headers['sec-fetch-dest']),
      },
      zusatz,
      e.seitenwechselErlaubt ?? true,
      namenQuelle(),
    )
    // `Vary: Origin` IMMER — auch auf dem erlaubten Weg. Sonst legt ein
    // Zwischenspeicher (Browser, Proxy) die Antwort der eigenen Oberflaeche ab
    // und gibt sie spaeter auf eine Anfrage mit anderer Herkunft heraus.
    res.setHeader('Vary', 'Origin')
    if (urteil.erlaubt) {
      next()
      return
    }

    // Die Kopfzeile, die das Lesen erlauben wuerde, kommt hier weg — falls sie
    // ueberhaupt schon steht. Zusammen mit dem 403 sind das zwei Striche: die
    // fremde Seite bekommt kein Ergebnis UND duerfte es nicht lesen.
    res.removeHeader('Access-Control-Allow-Origin')
    e.melden?.(`Herkunftsriegel: ${req.method} ${req.originalUrl} abgewiesen (${urteil.grund})`)
    res.status(403).json({
      ok: false,
      // BEIDE SCHLUESSEL: die alte Oberflaeche liest `error`, sicherung.ts und
      // die neue lesen `fehler`. Ein Riegel, dessen Meldung niemand anzeigt,
      // wird als „kaputt" gemeldet statt als „gesperrt".
      fehler: urteil.satz,
      error: urteil.satz,
      grund: urteil.grund,
    })
  }
}

/** Eine Kopfzeile als einzelner Text — Node liefert manche als Feld. */
function einKopf(wert: string | string[] | undefined): string | undefined {
  if (Array.isArray(wert)) return wert[0]
  return wert
}

/**
 * DER SEITENRIEGEL — damit ein Ausgesperrter erfaehrt, dass er ausgesperrt ist.
 *
 * ══ DAS GEMESSENE PROBLEM ═════════════════════════════════════════════════
 * Der Riegel oben haengt nur vor `/api` und `/player`. Die Seiten (`/`,
 * `/admin`, `/neu`) sind frei — mit gutem Grund (siehe server.ts). Folge: wer
 * die Box unter einem unbekannten Namen aufruft, bekommt die SEITE, und erst
 * ihre Nachladungen fallen mit 403. Der Satz mit dem Ausweg liegt dann in
 * einem JSON-Rumpf, den nur die Oberflaeche sieht.
 *
 * GEMESSEN (tools/riegel-ausgesperrt-was-sieht-er.mjs, Ring C), echter Browser:
 * `/` zeigte NULL Zeichen sichtbaren Text, `/neu/` meldete eine Stoerung mit
 * „Noch einmal versuchen" (das Wiederholen hilft nie), `/admin` verlangte ein
 * Passwort, das es gar nicht gibt. Drei Sackgassen, kein Wort ueber den Grund.
 *
 * ══ WARUM DAS HIER SICHER IST, WO EIN VOLLER RIEGEL AUF `/` ES NICHT WAERE ══
 * Dieser Riegel prueft AUSSCHLIESSLICH DEN NAMEN — nicht `Origin`, nicht
 * `Sec-Fetch-Site`. Genau daran haette ein voller Riegel den `<embed>` des
 * alten PHP-Admin zerschossen (ein eingebetteter Rahmen ist `cross-site`).
 * Nachgesehen: `AdminInterface/www/content.php` bettet
 * `http://<mupibox.host>:8200` ein — und `mupibox.host` IST eine der Quellen,
 * aus denen die eigenen Namen abgeleitet werden. Der Embed kann also gar nicht
 * unter einem Namen laufen, den dieser Riegel nicht kennt.
 *
 * UND ER NIMMT NIEMANDEM ETWAS WEG: er antwortet nur in Faellen, in denen der
 * `/api`-Riegel ohnehin schon JEDE Anfrage der Seite abweist. Die Seite war
 * dort bereits unbrauchbar. Er tauscht einen weissen Schirm gegen eine
 * Erklaerung — in beiden Zweigen besser, in keinem schlechter.
 *
 * ══ DIE VIER BEDINGUNGEN, DIE IHN EINGRENZEN ══════════════════════════════
 *   1. NUR wenn die Box ihre eigenen Namen VERLAESSLICH kennt. Sonst aus —
 *      derselbe Satz wie ueberall: im Zweifel auf, nicht zu.
 *   2. NUR `GET`/`HEAD`. Ein Formular bleibt unberuehrt.
 *   3. NUR wenn der Klient wirklich eine SEITE will (`Accept: text/html`).
 *      Ein Stilblatt, ein Bild, ein `fetch` bekommen weiter das, was sie
 *      bekommen haben — eine Erklaerungsseite an ihrer Stelle waere Unsinn,
 *      und ein Riegel, der Beiwerk abweist, koennte etwas zerlegen, das heute
 *      geht.
 *   4. NICHT auf `/api` und `/player` — die haben ihren eigenen Riegel und
 *      ihre eigene Antwortform (JSON), auf die sich die Oberflaeche verlaesst.
 */
export function seitenNamensriegelBauen(e: RiegelEinstellungen = {}) {
  const aus = e.aus ?? process.env.MUPIBOX_HERKUNFT_AUS === '1'
  const namenQuelle = e.eigeneNamen ?? (() => namenErmitteln())
  return (req: Request, res: Response, next: NextFunction): void => {
    const tls = Boolean((req.socket as { encrypted?: boolean } | undefined)?.encrypted)
    // DIE VIER EINGRENZUNGEN, in der Reihenfolge des billigsten Ausstiegs.
    // Jede einzelne ist oben begruendet; faellt eine von ihnen weg, faengt
    // dieser Riegel Anfragen, die er nichts angeht.
    const durchlassen =
      aus ||
      (req.method !== 'GET' && req.method !== 'HEAD') ||
      (req.path || req.url || '').startsWith('/api') ||
      (req.path || req.url || '').startsWith('/player') ||
      !/text\/html/i.test(String(einKopf(req.headers.accept) ?? ''))
    if (durchlassen) {
      next()
      return
    }

    const eigene = namenQuelle()
    const wirSelbst = gastgeberZerlegen(String(einKopf(req.headers.host) ?? ''), tls)
    // `verlaesslich === false` heisst: die Box kennt ihre Namen nicht — dann
    // wird nicht geraten. Ohne lesbaren `Host` ebenso. Beides wie im Riegel
    // oben: im Zweifel auf, nicht zu.
    if (!eigene?.verlaesslich || !wirSelbst || istEigenerName(wirSelbst.rechner, eigene)) {
      next()
      return
    }

    e.melden?.(
      `Herkunftsriegel: Seite ${req.method} ${req.originalUrl} unter fremdem Namen „${wirSelbst.rechner}" — Erklaerung ausgeliefert`,
    )
    res.setHeader('Vary', 'Origin')
    res
      .status(403)
      .type('html')
      .send(fremderNameSeite(wirSelbst.rechner, eigene, tls ? 'https' : 'http', wirSelbst.port))
  }
}
