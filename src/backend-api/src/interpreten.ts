/**
 * Wer steht in der Interpreten-Reihe — und wer nicht.
 *
 * REINE LOGIK: kein Netz, kein Dateisystem, kein express. Herein kommen die
 * Werke der Box, die Freischaltungen aus der Ablage und das, was Spotifys
 * Suche zu einem Namen sagt; heraus kommt die fertige Reihe.
 *
 * WARUM ES DIESES STUECK GIBT — dieselbe Begruendung wie bei der
 * Album-Zerlegung (llmwiki: ein Besitzer statt zwei). Die Entscheidung „ist
 * das ein Interpret?" stand bis heute in NewDesign/app.js (`istInterpret`)
 * und merkte sich ihr Ergebnis im `sessionStorage`
 * (`mupibox_neu_interpreten_v1`). Das hat drei Folgen, und alle drei hat der
 * Benutzer gemeldet:
 *
 *   1. NACH JEDEM NEUSTART VON VORN. Der sessionStorage endet mit dem Tab.
 *      Beim naechsten Start fragt die Box fuer JEDEN Interpreten wieder bei
 *      Spotify nach — auf der Box sind das heute zehn Abrufe, bevor die erste
 *      runde Kachel steht.
 *   2. JEDE OBERFLAECHE ENTSCHEIDET FUER SICH. Der Tabletbrowser der Eltern
 *      und der Bildschirm der Box hatten je einen eigenen Speicher; wer am
 *      einen etwas wegklickte, sah es am anderen weiter.
 *   3. DIE ENTSCHEIDUNG WAR NICHT ZU UEBERSTIMMEN. „Jojo" ist auf dieser Box
 *      ein ERSTELLER, kein Interpret — aber bei Spotify gibt es eine
 *      Saengerin dieses Namens, also ueberstand er die Namenspruefung und
 *      stand jedes Mal wieder in der Reihe.
 *
 * DIE ABLEHNUNG IST DESHALB GENAUSO WICHTIG WIE DIE FREISCHALTUNG. Ein „nein"
 * das den Neustart nicht ueberlebt, ist kein „nein", sondern eine Verzoegerung.
 *
 * WAS HIER NICHT DRINSTEHT: das HOLEN. Die Spotify-Suche macht der Server
 * (`/api/interpreten`, `/api/interpreten/suche`), das Schreiben der Ablage
 * ebenso. Stuende die Regel dort, laege sie hinter einem Netzaufruf und waere
 * nur am lebenden Geraet zu pruefen — ausgerechnet die Entscheidung, um die
 * es geht.
 */

import { bildDurchgereicht } from './interpretenseite'
import { interpretSchluesselAus, interpretSchluesselTeile } from './medien'
import type { Werk } from './werke'

/**
 * Eine Spotify-Kennung ist 22 Zeichen aus Buchstaben und Ziffern.
 *
 * DIESELBE ENGE wie in WEB_API_ERLAUBT (spotify-web.ts) und in
 * `/api/interpret/:id`. Sie hier lockerer zu fassen hiesse, Kennungen
 * anzunehmen, die die Durchreiche gleich darauf abweist — die Kachel stuende
 * dann da und fuehrte ins Leere.
 */
const KENNUNG = /^[A-Za-z0-9]{22}$/

export function istSpotifyKennung(x: unknown): boolean {
  return KENNUNG.test(String(x ?? '').trim())
}

/** Woher die Entscheidung kam. Steht in der Datei und ist von Hand lesbar. */
export const QUELLEN = ['suche', 'erkannt', 'hand'] as const
export type Freischaltquelle = (typeof QUELLEN)[number]

function istQuelle(x: unknown): x is Freischaltquelle {
  return QUELLEN.includes(x as Freischaltquelle)
}

/**
 * Ein freigeschalteter Interpret.
 *
 * `schluessel` ist `interpretSchluesselAus(name)` — DERSELBE Schluessel, unter
 * dem `werke.ts` die Werke eines Interpreten zusammenfasst
 * (`Werk.interpretSchluessel`). Ein eigener Schluessel waere die zweite
 * Wahrheit, an der „Die drei ???" und „Die Drei ???" auseinanderfielen.
 *
 * BIS ZUM 19.08.2026 STAND HIER `normal()`, und das war die teuerste Zeile
 * dieser Datei: „Die drei ???" und „Die drei !!!" ergaben denselben
 * Schluessel, also loeschte die Freischaltung der einen Serie STILL die der
 * anderen (`interpretenAblageAus` behaelt je Schluessel den ERSTEN, und
 * `freischalten` legt vorn an). Die Kette steht vollstaendig an
 * `interpretSchluesselAus` (medien.ts).
 *
 * `id` ist PFLICHT. Ohne Spotify-Kennung gibt es keine Interpretenseite, und
 * eine runde Kachel, die sich nicht oeffnen laesst, ist schlimmer als keine.
 *
 * `bild` ist die ROHE CDN-Adresse, wie Spotify sie in der Suche liefert. Sie
 * wird hier abgelegt und erst beim Bauen der Reihe durch `bildDurchgereicht`
 * auf `/api/bild/extern` umgebogen. Zwei Gruende: die Reihe kostet dann keinen
 * Spotify-Abruf je Blick, und die Umbiegung bleibt an EINER Stelle (wer die
 * rohe Adresse in die Seite gaebe, umginge den Coverspeicher der Box).
 */
export interface Freischaltung {
  schluessel: string
  id: string
  name: string
  quelle: Freischaltquelle
  /** Rohe Bildadresse von Spotify. Optional — ohne sie zeigt die Kachel den Buchstaben. */
  bild?: string
  /** ISO-Zeitpunkt. Nur zum Nachlesen von Hand; nichts haengt daran. */
  seit?: string
}

/**
 * Ein ausdruecklich abgelehnter Name.
 *
 * NACH NAMEN UND NICHT NACH KENNUNG. Das ist die Stelle, an der der erste
 * Entwurf falsch war: Abgelehnt wird ja gerade das, was KEIN Interpret ist —
 * „Jojo" ist ein Ersteller in der Bibliothek und hat auf dieser Box gar keine
 * Interpretenkennung. Eine Ablehnung nach Kennung liefe an genau dem Fall
 * vorbei, fuer den es sie gibt.
 */
export interface Ablehnung {
  schluessel: string
  name: string
  seit?: string
}

export interface InterpretenAblage {
  frei: Freischaltung[]
  abgelehnt: Ablehnung[]
}

export const INTERPRETEN_ABLAGE_LEER: InterpretenAblage = { frei: [], abgelehnt: [] }

/**
 * Die Ablage aus rohem JSON — kaputte Zeilen fliegen WEG, nicht die Datei.
 *
 * Dieselbe Haltung wie `ablageAus` (abgleich.ts): die Datei soll von Hand
 * aenderbar sein, also wird sie irgendwann von Hand krumm sein. An einer
 * krummen Zeile zu scheitern hiesse, dass ein Tippfehler die ganze
 * Interpreten-Reihe kostet.
 */
export function interpretenAblageAus(roh: unknown): InterpretenAblage {
  const o = (roh ?? {}) as { frei?: unknown; abgelehnt?: unknown }
  const frei: Freischaltung[] = []
  const gesehenFrei = new Set<string>()
  for (const f of Array.isArray(o.frei) ? o.frei : []) {
    const e = (f ?? {}) as Record<string, unknown>
    const name = String(e.name ?? '').trim()
    const id = String(e.id ?? '').trim()
    // Der Schluessel wird NEU GEBILDET und nicht geglaubt: stuende in der
    // Datei von Hand ein anderer, faende die Reihe die Werke des Interpreten
    // nicht mehr — und niemand saehe, warum.
    const schluessel = interpretSchluesselAus(name)
    if (!name || !schluessel || !istSpotifyKennung(id)) continue
    if (gesehenFrei.has(schluessel)) continue
    gesehenFrei.add(schluessel)
    const eintrag: Freischaltung = {
      schluessel,
      id,
      name,
      quelle: istQuelle(e.quelle) ? e.quelle : 'hand',
    }
    const bild = String(e.bild ?? '').trim()
    if (bild) eintrag.bild = bild
    const seit = String(e.seit ?? '').trim()
    if (seit) eintrag.seit = seit
    frei.push(eintrag)
  }

  const abgelehnt: Ablehnung[] = []
  const gesehenNein = new Set<string>()
  for (const a of Array.isArray(o.abgelehnt) ? o.abgelehnt : []) {
    const e = (a ?? {}) as Record<string, unknown>
    // Eine Ablehnung darf auch als blosser Name dastehen — das ist die Form,
    // die man von Hand hinschreibt.
    const name = String(typeof e === 'string' ? e : (e.name ?? '')).trim()
    const schluessel = interpretSchluesselAus(name)
    if (!name || !schluessel) continue
    if (gesehenNein.has(schluessel)) continue
    gesehenNein.add(schluessel)
    const eintrag: Ablehnung = { schluessel, name }
    const seit = String(e.seit ?? '').trim()
    if (seit) eintrag.seit = seit
    abgelehnt.push(eintrag)
  }
  return { frei, abgelehnt }
}

/** Eine Zeile, deren Schluessel in der Datei nicht mehr stimmt. */
export interface Wanderzeile {
  name: string
  /** Was in der Datei stand. Leer, wenn sie von Hand ohne Schluessel geschrieben wurde. */
  alt: string
  /** Was daraus wird. */
  neu: string
  liste: 'frei' | 'abgelehnt'
}

/**
 * DIE WANDERUNG DER BESTANDSABLAGE — und warum sie so klein ausfaellt.
 *
 * Der Schluessel des Interpreten hat sich am 19.08.2026 geaendert
 * (`interpretSchluesselAus` statt `normal()`, Begruendung in medien.ts). Ein
 * Schluesselwechsel ist sonst der teuerste Eingriff, den es gibt — an
 * `medienSchluessel` haengen Verlauf, Weiterhoeren und die Medienauswahl jedes
 * Kindes, und die muessten Zeile fuer Zeile umgeschrieben werden.
 *
 * HIER NICHT, und das ist keine Nachlaessigkeit, sondern eine alte
 * Entscheidung, die sich heute auszahlt:
 *
 *   `Werk.interpretSchluessel`  entsteht bei JEDEM Abruf neu aus dem Namen
 *                               (werke.ts) — nichts davon liegt auf Platte.
 *   `Freischaltung.schluessel`  wird von `interpretenAblageAus()` NEU GEBILDET
 *                               und der Datei ausdruecklich NICHT geglaubt.
 *   profile/<kind>/auswahl.json steht auf WERKschluesseln, nicht auf
 *                               Interpretenschluesseln (auswahl.ts, dort
 *                               ausfuehrlich begruendet).
 *
 * Die Ablage wandert also von selbst, sobald sie gelesen wird. WAS BLEIBT, ist
 * der veraltete `schluessel` IN DER DATEI — und die Datei soll von Hand lesbar
 * und aenderbar sein (server.ts, Grund 2 fuer ihre Existenz). Ein Mensch, der
 * dort „die drei" liest, waehrend das Werk „die drei ???" traegt, sucht den
 * Fehler an der falschen Stelle.
 *
 * DESHALB DIESE FUNKTION: sie sagt, WAS sich beim naechsten Lesen verschiebt.
 * Der Server ruft sie einmal beim Start; nur wenn etwas dasteht, schreibt er
 * die Datei nach und schreibt es ins Journal. Nach dem ersten Start ist sie
 * still — sie ist eine Nachricht, keine laufende Arbeit.
 *
 * SIE FINDET AUCH DEN ZWEITEN FALL, und der ist der eigentliche Schaden:
 * Zeilen, die unter dem ALTEN Schluessel zusammenfielen und jetzt beide
 * ueberleben (`gesehenFrei` verwarf die zweite still). Sie stehen danach in
 * `frei` und sind an der Zahl zu sehen — genau das war „wer '!!!' freischaltet,
 * loescht die Freischaltung von '???'".
 */
export function interpretenAblageWandern(roh: unknown): { ablage: InterpretenAblage; wandert: Wanderzeile[] } {
  const ablage = interpretenAblageAus(roh)
  const o = (roh ?? {}) as { frei?: unknown; abgelehnt?: unknown }
  const wandert: Wanderzeile[] = []
  const pruefen = (liste: 'frei' | 'abgelehnt', zeilen: unknown) => {
    for (const z of Array.isArray(zeilen) ? zeilen : []) {
      const e = (z ?? {}) as Record<string, unknown>
      const name = String(typeof e === 'string' ? e : (e.name ?? '')).trim()
      if (!name) continue
      const neu = interpretSchluesselAus(name)
      if (!neu) continue
      const alt = String(typeof e === 'string' ? '' : (e.schluessel ?? '')).trim()
      if (alt === neu) continue
      wandert.push({ name, alt, neu, liste })
    }
  }
  pruefen('frei', o.frei)
  pruefen('abgelehnt', o.abgelehnt)
  return { ablage, wandert }
}

/**
 * Was die Ablage ueber einen Namen sagt.
 *
 * `offen` heisst: niemand hat entschieden — dann gilt die AUTOMATIK.
 */
export function urteilFuer(ablage: InterpretenAblage, name: string): 'frei' | 'abgelehnt' | 'offen' {
  const s = interpretSchluesselAus(name)
  if (!s) return 'offen'
  if ((ablage?.abgelehnt ?? []).some((a) => a.schluessel === s)) return 'abgelehnt'
  if ((ablage?.frei ?? []).some((f) => f.schluessel === s)) return 'frei'
  return 'offen'
}

/**
 * FREISCHALTEN — und zwar entschieden.
 *
 * Eine Freischaltung raeumt eine bestehende Ablehnung desselben Namens WEG.
 * Sonst stuende der Name in beiden Listen, und welche gilt, entschiede die
 * Reihenfolge der Pruefung — also nichts, was jemand nachlesen kann.
 */
export function freischalten(
  ablage: InterpretenAblage,
  eintrag: { id: string; name: string; bild?: string; quelle?: Freischaltquelle },
  jetzt: string = new Date().toISOString(),
): InterpretenAblage {
  const name = String(eintrag?.name ?? '').trim()
  const schluessel = interpretSchluesselAus(name)
  if (!schluessel || !istSpotifyKennung(eintrag?.id)) return interpretenAblageAus(ablage)
  const neu: Freischaltung = {
    schluessel,
    id: String(eintrag.id).trim(),
    name,
    quelle: istQuelle(eintrag.quelle) ? eintrag.quelle : 'hand',
    seit: jetzt,
  }
  const bild = String(eintrag.bild ?? '').trim()
  if (bild) neu.bild = bild
  return interpretenAblageAus({
    // Der neue Eintrag zuerst: `interpretenAblageAus` behaelt beim doppelten
    // Schluessel den ERSTEN. So ueberschreibt eine zweite Freischaltung
    // desselben Namens die alte (etwa mit einer anderen Kennung), statt still
    // wirkungslos zu bleiben.
    frei: [neu, ...(ablage?.frei ?? [])],
    abgelehnt: (ablage?.abgelehnt ?? []).filter((a) => a.schluessel !== schluessel),
  })
}

/**
 * ABLEHNEN — das „nein", das den Neustart ueberlebt.
 *
 * DER GANZE PUNKT DER ABLAGE. Ohne ihn taucht „Jojo" bei jedem Start wieder
 * auf, weil die Automatik jedes Mal aufs Neue zu demselben Schluss kommt: es
 * GIBT bei Spotify eine Saengerin dieses Namens. Die Automatik hat also nicht
 * geirrt — sie kann diese Frage nur nicht beantworten, und deswegen bekommt
 * der Mensch das letzte Wort.
 */
export function ablehnen(
  ablage: InterpretenAblage,
  name: string,
  jetzt: string = new Date().toISOString(),
): InterpretenAblage {
  const klar = String(name ?? '').trim()
  const schluessel = interpretSchluesselAus(klar)
  if (!schluessel) return interpretenAblageAus(ablage)
  return interpretenAblageAus({
    frei: (ablage?.frei ?? []).filter((f) => f.schluessel !== schluessel),
    abgelehnt: [{ schluessel, name: klar, seit: jetzt }, ...(ablage?.abgelehnt ?? [])],
  })
}

/**
 * Beides zuruecknehmen — zurueck zur Automatik.
 *
 * Ohne diesen Weg waere jede Entscheidung eine Einbahnstrasse; dieselbe
 * Ueberlegung wie bei „wieder zulassen" auf der Seite „Doppelte".
 */
export function zuruecknehmen(ablage: InterpretenAblage, name: string): InterpretenAblage {
  const schluessel = interpretSchluesselAus(name)
  if (!schluessel) return interpretenAblageAus(ablage)
  return interpretenAblageAus({
    frei: (ablage?.frei ?? []).filter((f) => f.schluessel !== schluessel),
    abgelehnt: (ablage?.abgelehnt ?? []).filter((a) => a.schluessel !== schluessel),
  })
}

/**
 * DER NAMENSVERGLEICH DER ERKENNUNG — und warum er NICHT der Ablageschluessel
 * ist.
 *
 * DAS IST DIE STELLE, AN DER DER ERSTE ENTWURF MESSBAR FALSCH WAR. Er nahm
 * `normal()` (medien.ts) mit dem Argument, das sei doch derselbe Schluessel,
 * unter dem `werke.ts` die Werke eines Interpreten gruppiert — eine Regel
 * weniger. Die Messung gegen die echte Bibliothek hat es widerlegt
 * (tools/interpreten-erkennung.mjs, 2026-08-03, 26 Eintraege, 16 Interpreten):
 *
 *     "🩵Jojo 🩵"   normal() -> "jojo"      und Spotify hat eine Saengerin
 *                                            namens "JoJo" -> "jojo".
 *     alte Regel: nein      normal(): JA
 *
 * `normal()` wirft ALLES weg, was kein Buchstabe und keine Ziffer ist —
 * Emoji, Satzzeichen, Zierschrift. Es hat auf dieser Bibliothek KEINEN
 * richtigen Treffer dazugewonnen und genau einen falschen: ausgerechnet
 * „Jojo", den Fall, der dieses ganze Feature ausgeloest hat.
 *
 * WARUM DIE ABLAGE TROTZDEM EINEN ANDEREN, GROSSZUEGIGEREN SCHLUESSEL FUEHRT:
 * Das sind ZWEI FRAGEN, und sie werden staendig verwechselt (llmwiki
 * [regal-je-interpret-gegen-verschmelzen] beschreibt dieselbe Verwechslung an
 * anderer Stelle). „Gehoeren diese beiden Werke ZUSAMMEN?" darf grosszuegig
 * sein — der Preis eines Fehlers ist ein Regal zu wenig. „Ist dieser Name ein
 * INTERPRET bei Spotify?" darf es nicht — der Preis eines Fehlers ist eine
 * fremde Person im Regal des Kindes.
 *
 * SEIT DEM 19.08.2026 IST DER ABLAGESCHLUESSEL `interpretSchluesselAus` und
 * nicht mehr `normal()` — er rueckt damit ein Stueck NAEHER an diesen
 * Vergleich heran (Satzzeichen bleiben stehen), bleibt aber grosszuegiger:
 * Klebstoff wie „-" und „&" faellt weiterhin zusammen, und Umlaute werden
 * zerlegt. Die beiden Funktionen zusammenzulegen bleibt falsch, und zwar aus
 * demselben Grund wie oben: die Messung an „🩵Jojo 🩵" bliebe die Messung an
 * „🩵Jojo 🩵".
 *
 * WAS DIESER VERGLEICH GEGENUEBER `trim().toLowerCase()` (app.js) KANN:
 * zusammengesetzte und zerlegte Umlaute gelten als gleich (NFKC — „Bjö" kommt
 * aus einer Jellyfin-Datenbank mal so, mal so daher), und mehrfache
 * Leerzeichen fallen zusammen. Beides sind Schreibweisen DESSELBEN Namens.
 * Zeichen werden dabei NICHT entfernt.
 */
export function namensSchluessel(s: unknown): string {
  return (
    String(s ?? '')
      // NFKC und nicht NFKD: zusammenziehen, nicht zerlegen. NFKD liesse die
      // Zeichen fuer sich stehen, und dann waere "Bjö" fuenf Zeichen lang.
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** Was Spotifys Suche zu einem Namen ergeben hat. `null` = nicht gefragt/Ausfall. */
export interface Erkennung {
  ja: boolean
  id: string | null
  bild?: string | null
}

/** Ein Treffer, so wie Spotify ihn in `artists.items` liefert. */
export interface SpotifyInterpret {
  id?: unknown
  name?: unknown
  images?: unknown
  genres?: unknown
  followers?: { total?: unknown }
}

/**
 * DIE AUTOMATIK: Steht hinter diesem Namen bei Spotify ein Interpret?
 *
 * NAMENSGENAU, siehe `namensSchluessel` — die Grosszuegigkeit gehoert an die
 * Gruppierung, nicht hierher. Gemessen wird der Unterschied zur alten Regel
 * mit tools/interpreten-erkennung.mjs (Spalten „alt" und „neu").
 *
 * OHNE KENNUNG KEIN JA — das ist die eine echte Aenderung gegenueber
 * `istInterpret` in app.js. Dort kam bei einem Treffer ohne brauchbare `id`
 * `{ ja: true, id: '' }` heraus; die Kachel stand dann in der Reihe, und
 * `interpretSeiteOeffnen` wies sie beim Antippen mit „Ohne Kennung gibt es
 * keine Seite" ab. Eine Kachel, die auf nichts fuehrt, ist ein Versprechen,
 * das die Box nicht einloest — und fuer ein Kind, das noch nicht liest, sieht
 * eine solche Kachel aus wie eine kaputte Box.
 *
 * DER ERSTE PASSENDE TREFFER GEWINNT, nicht der mit den meisten Hoerern.
 * Spotify ordnet die Suche nach Relevanz; eine eigene Ordnung darueberzulegen
 * hiesse, Spotifys Wissen ueber Namensgleiche durch eine Zahl zu ersetzen.
 */
export function interpretAusTreffern(name: string, treffer: readonly SpotifyInterpret[] | null): Erkennung {
  const gesucht = namensSchluessel(name)
  if (!gesucht) return { ja: false, id: null }
  // NICHT GEFRAGT ODER AUSGEFALLEN heisst NICHT „kein Interpret".
  //
  // Die Vorgabe bei Fehlern ist „lieber zeigen" — genau wie bisher in app.js.
  // Ein Netzausfall darf die Reihe nicht leeren: das saehe aus, als haette die
  // Box die Bibliothek vergessen. Ohne Kennung fuehrt die Kachel dann zwar
  // nicht auf die Interpretenseite, aber sie steht da, wo sie hingehoert.
  if (treffer === null) return { ja: true, id: null }
  for (const t of treffer) {
    if (namensSchluessel(t?.name) !== gesucht) continue
    const id = String(t?.id ?? '').trim()
    if (!istSpotifyKennung(id)) continue
    return { ja: true, id, bild: bildAusTreffer(t) }
  }
  return { ja: false, id: null }
}

/**
 * Wie lange ein Urteil gilt: zwoelf Stunden.
 *
 * Lang genug, dass ein Tag am Kinderzimmer-Bildschirm keinen zweiten Abruf
 * kostet; kurz genug, dass ein Interpret, den Spotify neu fuehrt, nicht bis zum
 * naechsten Neustart der Box unsichtbar bleibt. Die Box laeuft wochenlang
 * durch — ohne Frist waere „nie wieder" die Antwort.
 */
export const ERKENNUNG_MS = 12 * 60 * 60 * 1000

/**
 * Und eine Minute, wenn der Abruf AUSGEFALLEN ist.
 *
 * WARUM ES DIESE ZWEITE FRIST GEBEN MUSS. Der erste Entwurf merkte sich einen
 * Ausfall gar nicht — mit der guten Begruendung, dass ein WLAN-Aussetzer von
 * einer Sekunde sonst zwoelf Stunden lang die Erkennung festhaelt. Was dabei
 * uebersehen wurde, ist der TAKT auf der anderen Seite: NewDesign/app.js holt
 * `/api/interpreten` alle 15 Sekunden (TAKT_WERKE), und `zuPruefen` gibt jeden
 * unentschiedenen Namen wieder heraus, solange nichts gemerkt ist. Ohne diese
 * Frist waeren das 16 Abrufe alle 15 Sekunden je Oberflaeche — und ist das
 * Zugangsmerkmal abgelaufen, dazu 16 Anlaeufe an accounts.spotify.com. Genau
 * das Verhalten, mit dem man sich eine Drosselung (429) einfaengt, und die
 * trifft dann auch das ABSPIELEN.
 *
 * Eine Minute ist die kleinste Frist, die diesen Takt bricht (15 s -> 60 s ist
 * ein Viertel der Last) und die kurz genug ist, dass ein Aussetzer nicht
 * spuerbar nachhaengt.
 */
export const ERKENNUNG_AUSFALL_MS = 60 * 1000

/**
 * WAS BEI EINEM AUSFALL GEMERKT WIRD — und warum das NICHT einfach das neue
 * Urteil ist.
 *
 * DAS IST DIE STELLE, AN DER DIE UMSTELLUNG AUF DAS BACKEND EINEN RUECKSCHRITT
 * GEGENUEBER DEM sessionStorage HATTE. Gefunden beim Gegenlesen am 03.08.2026,
 * und es ist kein Randfall, sondern der Normalfall einer Box, die wochenlang
 * durchlaeuft:
 *
 *   t=0      Spotify antwortet. Neun der sechzehn Namen bekommen ein `ja` mit
 *            Kennung, sieben ein `nein`. Die Reihe zeigt neun Kacheln, jede
 *            fuehrt auf ihre Interpretenseite.
 *   t=12h+   Die Frist ist abgelaufen, und in genau diesem Augenblick ist das
 *            WLAN weg (oder Spotify drosselt). Jeder Abruf faellt aus.
 *   FOLGE    `interpretAusTreffern(name, null)` urteilt „lieber zeigen" —
 *            {ja:true, id:null} — und das ueberschrieb das Gewusste. Die Reihe
 *            zeigt jetzt SECHZEHN Kacheln statt neun, und KEINE EINZIGE
 *            oeffnet sich: `interpretSeiteOeffnen` weist jede mit „Zu diesem
 *            Interpreten weiß Spotify hier nichts." ab. Die sieben, die der
 *            Benutzer nie in der Reihe sehen wollte, sind zurueck — darunter
 *            „Jojo", der Fall, der dieses ganze Feature ausgeloest hat.
 *            Alle 60 Sekunden von vorn, solange der Ausfall dauert.
 *
 * Der sessionStorage konnte das nicht: er hielt sein Urteil die ganze Sitzung,
 * ohne Frist. Was die Frist bringt (ein Interpret, den Spotify neu fuehrt, wird
 * irgendwann sichtbar), soll sie behalten — sie darf nur nicht dazu fuehren,
 * dass ein AUSFALL Wissen VERNICHTET.
 *
 * DIE REGEL LAUTET DESHALB: „lieber zeigen" gilt nur, wenn man NICHTS weiss.
 * Weiss man etwas — und sei es abgelaufen —, gilt das. Ein abgelaufenes Faktum
 * ueber Spotify ist besser als gar keins; abgelaufen heisst „bitte nachfragen",
 * nicht „falsch".
 *
 * `vorher` ist ausdruecklich das ABGELAUFENE Urteil aus der Karte. Wer noch
 * gueltig ist, kommt hier gar nicht erst an (der Aufrufer kuerzt vorher ab).
 */
export function erkennungFortschreiben(
  name: string,
  treffer: readonly SpotifyInterpret[] | null,
  vorher?: Erkennung | null,
): { urteil: Erkennung; dauerMs: number } {
  if (treffer !== null) return { urteil: interpretAusTreffern(name, treffer), dauerMs: ERKENNUNG_MS }
  // AUSFALL. Das zuletzt Gewusste behalten — auch ein `nein`, denn genau das
  // haelt die sieben Ersteller draussen, die der Benutzer nicht sehen will.
  if (vorher) return { urteil: vorher, dauerMs: ERKENNUNG_AUSFALL_MS }
  // Und nur wenn gar nichts bekannt ist: „lieber zeigen". Ein leeres Netz darf
  // die Reihe nicht leeren — das saehe aus, als haette die Box die Bibliothek
  // vergessen.
  return { urteil: interpretAusTreffern(name, null), dauerMs: ERKENNUNG_AUSFALL_MS }
}

/**
 * Die ROHE Bildadresse aus einem Treffer — mittlere Groesse.
 *
 * Dieselbe Wahl wie `bildMittel` (interpretenseite.ts): Spotify liefert
 * 640/320/160 px, die runde Kachel ist 118 px breit. `bildMittel` gibt
 * allerdings schon den durchgereichten Pfad zurueck; fuer die ABLAGE wird die
 * rohe Adresse gebraucht (siehe Begruendung an `Freischaltung.bild`).
 */
export function bildAusTreffer(t: SpotifyInterpret | null | undefined): string | null {
  const liste = Array.isArray(t?.images) ? (t?.images as Array<{ url?: unknown }>) : []
  if (!liste.length) return null
  const gewaehlt = liste[1] ?? liste[0]
  const u = String(gewaehlt?.url ?? '').trim()
  return u || null
}

/** Ein Treffer der Interpretensuche, wie ihn die Verwaltung anzeigt. */
export interface Suchtreffer {
  id: string
  name: string
  /** Ueber die Box, nie die CDN-Adresse. */
  bild: string | null
  /** Die ROHE Adresse — sie wandert beim Freischalten in die Ablage. */
  bildRoh: string | null
  genres: string[]
  follower: number
}

/**
 * Spotifys Suchantwort in Treffer verwandeln.
 *
 * OHNE KENNUNG WIRD NICHTS ANGEZEIGT — ein Treffer, den man nicht
 * freischalten kann, ist eine Zeile, die nur Fragen aufwirft.
 */
export function suchtrefferAus(treffer: readonly SpotifyInterpret[] | null): Suchtreffer[] {
  const heraus: Suchtreffer[] = []
  const gesehen = new Set<string>()
  for (const t of treffer ?? []) {
    const id = String(t?.id ?? '').trim()
    const name = String(t?.name ?? '').trim()
    if (!istSpotifyKennung(id) || !name || gesehen.has(id)) continue
    gesehen.add(id)
    const roh = bildAusTreffer(t)
    heraus.push({
      id,
      name,
      bild: bildDurchgereicht(roh),
      bildRoh: roh,
      genres: (Array.isArray(t?.genres) ? (t.genres as unknown[]) : []).map((g) => String(g)).slice(0, 2),
      follower: Number(t?.followers?.total) || 0,
    })
  }
  return heraus
}

/** Ein Eintrag der runden Interpreten-Reihe. */
export interface Interpret {
  /** `interpretSchluesselAus(name)` — derselbe wie `Werk.interpretSchluessel`. */
  schluessel: string
  name: string
  /** Spotify-Kennung. `null` heisst: die Kachel fuehrt (noch) nirgendwohin. */
  id: string | null
  /** IMMER ein Weg ueber die Box — `/api/bild/…`, nie eine CDN-Adresse. */
  bild: string | null
  /** Wie viele Werke der Box unter ihm stehen. 0 = freigeschaltet ohne eigene Werke. */
  anzahl: number
  /** Die Werkschluessel — damit die Oberflaeche „In deiner Box" fuellen kann. */
  werke: string[]
  /**
   * AUS WELCHEN DIENSTEN DIESER INTERPRET BESTEHT (E45).
   *
   * Betreiber, 19.08.2026: „der interpet ist … eine komposition aus
   * verschiedenen diensten … wichtig ist mir auch das die service tags dort
   * angezeigt werden."
   *
   * Ohne dieses Feld muesste die Oberflaeche fuer jede runde Kachel selbst
   * ueber `werke[]` in ihre Werkliste greifen und die Dienste zusammensuchen
   * — eine zweite Fassung der Zuordnung, die HIER schon getroffen ist. Genau
   * solche Doppelungen sind in E43 auseinandergelaufen.
   *
   * LEER bei einem Freigeschalteten ohne eigene Werke: er hat in dieser Box
   * (noch) keine Quelle, und ein erfundenes Spotify-Zeichen waere eine
   * Behauptung ueber Bestand, den es nicht gibt.
   */
  dienste: string[]
  /** Woher er kommt: aus der Bibliothek oder aus der Freischaltung. */
  herkunft: 'bibliothek' | 'frei'
  /** Nur bei `versteckt`: warum er NICHT in der Reihe steht. */
  grund?: 'abgelehnt' | 'nichtErkannt'
}

export interface ReihenErgebnis {
  reihe: Interpret[]
  /**
   * Wer aus der Bibliothek NICHT in der Reihe steht — mit Grund.
   *
   * WOFUER: Die Verwaltung soll zeigen koennen, was die Automatik aussortiert
   * hat. Ohne diese Liste waere „freischalten" nur ueber die Suche moeglich,
   * und ausgerechnet der haeufigste Fall (ein Interpret der eigenen
   * Bibliothek, den Spotify unter diesem Namen nicht kennt) haette keinen
   * Knopf.
   */
  versteckt: Interpret[]
}

/**
 * DIE REIHE BAUEN — aus Bibliothek UND Freischaltungen.
 *
 * WOHER DIE REIHE IHRE EINTRAEGE NIMMT, war bisher eindeutig: aus den Werken.
 * `interpretenZeichnen()` (app.js) gruppierte `/api/werke` nach
 * `interpretSchluessel`. Ein Interpret ohne Werk konnte darin gar nicht
 * vorkommen — nicht weil es verboten war, sondern weil es keine Zeile gab,
 * aus der er haette entstehen koennen.
 *
 * DER NEUE FALL ist genau der: ein per Suche gefundener Interpret, von dem
 * NICHTS in der Bibliothek steht, soll trotzdem in der Reihe stehen und auf
 * seine Diskografie fuehren. Er wird deshalb hier DAZUGELEGT — und
 * ausdruecklich NICHT als Medieneintrag. data.json bleibt unberuehrt (so vom
 * Benutzer entschieden), denn was die Box nicht besitzt, gehoert nicht in die
 * Bibliothek — dieselbe Regel wie bei [medienverwaltung-listen] Punkt 4.
 *
 * DIE ORDNUNG: erst die Bibliothek in ihrer eigenen Reihenfolge (so wie
 * bisher — die Reihe sieht fuer alles Vorhandene aus wie vorher), dann die
 * Freigeschalteten ohne eigene Werke, nach Namen sortiert. Sie hinten
 * anzuhaengen ist die Wahl, die am wenigsten verschiebt: das Kind findet
 * seine gewohnten Gesichter an derselben Stelle.
 */
export function interpretenReihe(
  werke: readonly Werk[],
  ablage: InterpretenAblage,
  erkannt: ReadonlyMap<string, Erkennung> = new Map(),
): ReihenErgebnis {
  const sicher = interpretenAblageAus(ablage)
  const freiJe = new Map(sicher.frei.map((f) => [f.schluessel, f]))
  const neinJe = new Set(sicher.abgelehnt.map((a) => a.schluessel))

  // ── 1. Nach Interpret gruppieren, genau wie `interpretenZeichnen` es tat ──
  const nach = new Map<string, { schluessel: string; name: string; werke: Werk[] }>()
  for (const w of werke ?? []) {
    const k = w?.interpretSchluessel
    // Werke ohne brauchbare Kennung tragen gar keinen `interpretSchluessel`
    // (`interpretTaugt` in werke.ts) — damit faellt „External Playback" hier
    // heraus, ohne dass diese Datei eine zweite Regel dafuer braucht.
    if (!k) continue
    if (!nach.has(k)) nach.set(k, { schluessel: k, name: String(w.interpret ?? ''), werke: [] })
    nach.get(k)?.werke.push(w)
  }

  // ── 1b. Mehrnamen-Werke den BESTEHENDEN Kreisen dazulegen (12.09.2026) ──
  //
  // "Team Karacho, ANOTHER NGUYEN" traegt den ganzen String als
  // `interpretSchluessel` und fiel damit aus dem Kreis "Team Karacho"
  // heraus — dessen Rundkachel konnte fuer dieses Album nie den laufenden
  // Rahmen zeigen, und `anzahl` zaehlte es nicht. Jetzt faellt ein
  // Kombi-Werk ZUSAETZLICH in jede Gruppe, die es OHNEHIN gibt (also
  // Solo-Werke hat). Neue Kreise entstehen hier ausdruecklich nicht: jeder
  // Feature-Gast als eigener Kreis flutete die Reihe mit Fremden
  // (Begruendung an `interpretSchluesselTeile`, medien.ts). GRENZE, bewusst:
  // ein NUR freigeschalteter Kreis ohne eigene Werke (unten, `werke: []`)
  // bekommt Kombi-Werke nicht dazugelegt — er entsteht erst nach dieser
  // Schleife; wer das braucht, zieht die Freischaltungs-Schluessel hier mit
  // heran.
  for (const w of werke ?? []) {
    if (!w?.interpretSchluessel) continue
    const teile = interpretSchluesselTeile(w.interpret)
    if (teile.length < 2) continue
    for (const t of teile) {
      if (t === w.interpretSchluessel) continue
      nach.get(t)?.werke.push(w)
    }
  }

  const reihe: Interpret[] = []
  const versteckt: Interpret[] = []
  for (const p of nach.values()) {
    const frei = freiJe.get(p.schluessel)
    const auto = erkannt.get(p.schluessel)
    // Das Bild des ersten Werks steht fuer den Interpreten — so wie bisher.
    // Eine Freischaltung bringt ein ECHTES Interpretenbild mit; das ist
    // besser, und deshalb geht es vor.
    const eigenes = p.werke.find((w) => w.bild)?.bild ?? null
    // DERSELBE SCHLUESSEL ZWEIMAL IST EIN WERK (berichtigt 19.08.2026,
    // E45-Review). An der Box liegt eine Playlist in ZWEI Kategorien und
    // kommt aus /api/werke doppelt zurueck (gemessen 02.08.2026) — die
    // Kachel zaehlte sie zweimal und sagte der Vorlesestimme eine falsche
    // Zahl. `interpretenseite.ts` entdoppelt an derselben Stelle schon
    // ueber `gesehen`; hier fehlte es.
    const eigeneWerke: Werk[] = []
    const schonDa = new Set<string>()
    for (const w of p.werke) {
      if (schonDa.has(w.schluessel)) continue
      schonDa.add(w.schluessel)
      eigeneWerke.push(w)
    }
    // Die Dienste aller eigenen Werke, ohne Dubletten, in der Reihenfolge
    // ihres ersten Auftretens — dieselbe Bauart wie `diensteVon` in der
    // Oberflaeche, damit die Reihenfolge der Zeichen ueberall dieselbe ist.
    const dienste: string[] = []
    for (const w of eigeneWerke) {
      for (const q of Array.isArray(w.quellen) ? w.quellen : []) {
        const d = String(q?.dienst ?? '').trim()
        if (d && !dienste.includes(d)) dienste.push(d)
      }
    }
    const eintrag: Interpret = {
      schluessel: p.schluessel,
      name: p.name,
      id: frei?.id ?? auto?.id ?? null,
      bild: (frei?.bild ? bildDurchgereicht(frei.bild) : null) ?? eigenes,
      anzahl: eigeneWerke.length,
      werke: eigeneWerke.map((w) => w.schluessel),
      herkunft: frei ? 'frei' : 'bibliothek',
      dienste,
    }
    // ── Die Rangfolge der Entscheidungen ──────────────────────────────────
    // ABGELEHNT SCHLAEGT ALLES. Es ist die einzige Angabe, die ein Mensch
    // ausdruecklich gemacht hat, um etwas WEGZUBEKOMMEN; sie von einer
    // Automatik ueberstimmen zu lassen hiesse, den Knopf zu entwerten.
    if (neinJe.has(p.schluessel)) {
      versteckt.push({ ...eintrag, grund: 'abgelehnt' })
      continue
    }
    // FREIGESCHALTET schlaegt die Automatik. Genau dafuer gibt es sie.
    if (frei) {
      reihe.push(eintrag)
      continue
    }
    // Sonst entscheidet die Automatik. Wurde gar nicht gefragt (kein Eintrag
    // in `erkannt`), gilt „lieber zeigen" — dieselbe Vorgabe wie in app.js,
    // damit ein ausgefallener Spotify-Abruf die Reihe nicht leert.
    if (auto && !auto.ja) {
      versteckt.push({ ...eintrag, grund: 'nichtErkannt' })
      continue
    }
    reihe.push(eintrag)
  }

  // ── 2. Freigeschaltete OHNE eigene Werke — der neue Fall ─────────────────
  const ohneWerk = sicher.frei.filter((f) => !nach.has(f.schluessel)).sort((a, b) => a.name.localeCompare(b.name, 'de'))
  for (const f of ohneWerk) {
    reihe.push({
      schluessel: f.schluessel,
      name: f.name,
      id: f.id,
      bild: bildDurchgereicht(f.bild),
      anzahl: 0,
      werke: [],
      herkunft: 'frei',
      // KEIN Dienst: in dieser Box liegt nichts von ihm. Ein Spotify-Zeichen
      // waere hier eine Behauptung ueber Bestand statt ueber Herkunft.
      dienste: [],
    })
  }

  return { reihe, versteckt }
}

/**
 * WELCHE NAMEN MUSS DER SERVER UEBERHAUPT BEI SPOTIFY NACHSCHLAGEN?
 *
 * Nicht alle. Wer freigeschaltet oder abgelehnt ist, ist entschieden — ihn zu
 * suchen waere ein Abruf, dessen Ergebnis nichts aendert. Auf der Box sind es
 * heute zehn Namen; jede Entscheidung nimmt einen davon weg.
 */
export function zuPruefen(
  werke: readonly Werk[],
  ablage: InterpretenAblage,
): Array<{ schluessel: string; name: string }> {
  const sicher = interpretenAblageAus(ablage)
  const entschieden = new Set([...sicher.frei.map((f) => f.schluessel), ...sicher.abgelehnt.map((a) => a.schluessel)])
  const heraus = new Map<string, string>()
  for (const w of werke ?? []) {
    const k = w?.interpretSchluessel
    if (!k || entschieden.has(k) || heraus.has(k)) continue
    const name = String(w.interpret ?? '').trim()
    if (name) heraus.set(k, name)
  }
  return [...heraus.entries()].map(([schluessel, name]) => ({ schluessel, name }))
}
