/**
 * Videofreigabe — welches Video ein Kind wie oft anschauen darf.
 *
 * DER AUFTRAG (Betreiber, 20.09.2026): „ard videos einzelne videos
 * freischalten mit abspiel haeufigkeit es soll quasi eine belohnung sein. Mal
 * ein freigegebenes Video nicht zum dauer konsumieren."
 *
 * REINE LOGIK, wie `kinderzeit.ts` daneben: keine Uhr, kein Dateisystem, kein
 * Netz. Alles kommt herein, heraus kommt eine neue Liste oder ein Urteil.
 *
 * ══ DER UNTERSCHIED ZUR KINDERZEIT, DER HIER ZAEHLT ═════════════════════════
 *
 * `regelnNormalisieren` in kinderzeit.ts biegt alles Unlesbare auf die
 * FREUNDLICHE Seite: eine kaputte Datei darf kein Kind aussperren.
 *
 * HIER IST ES GENAU UMGEKEHRT. Eine kaputte Freigabe darf kein Video
 * AUFSPERREN. Was nicht eindeutig als Freigabe lesbar ist, faellt weg — mit
 * demselben Argument, nur andersherum: der Fehlerfall muss dorthin zeigen, wo
 * er nichts kaputt macht, und das ist bei einer Belohnung „gibt es nicht",
 * nicht „gibt es unbegrenzt". Wer hier beide Dateien nebeneinander liest,
 * soll den Unterschied sehen und nicht fuer ein Versehen halten.
 *
 * ══ EIN VIDEO, MEHRERE STUECKE — UND WARUM DIE LISTE EINEN EIGENEN
 *    SCHLUESSEL BRAUCHT (20.09.2026) ═══════════════════════════════════════
 *
 * Betreiber: „marker im video setzen zu koennen um definerte stuecke zumachen
 * eine 25 min maus ist ggf zu lange und da wuerde ich es gerne teilen".
 *
 * DREI STUECKE DESSELBEN VIDEOS SIND DREIMAL DIESELBE KENNUNG. Die Liste war
 * aber auf die Kennung geschluesselt — `finden`, `entziehen`, `urteilen` und
 * `verbrauchen` alle. Deshalb traegt jede Freigabe jetzt eine EIGENE Kennung
 * (`id`), und die Videokennung steht daneben als das, was sie ist: die Adresse
 * beim Plugin.
 *
 * DIE id IST ABGELEITET UND NICHT GEWUERFELT (`idAus`). Das ist kein Detail:
 * ein gewuerfelter Schluessel machte aus „dasselbe Stueck nochmal freigeben"
 * eine zweite Kachel statt eines Nachlegens — und ein GANZES Video behaelt so
 * seine alte Kennung als id, womit jede Ablage von vor dem 20.09.2026 ohne
 * Wanderung weiterlaeuft.
 *
 * ══ WARUM DIE SCHWELLE GEGEN DAS STUECK RECHNET ════════════════════════════
 *
 * DAS IST DIE FALLE AN DER GANZEN SACHE: „90 % gesehen" gegen die VIDEOLAENGE
 * gerechnet erreicht ein Fuenf-Minuten-Stueck eines 25-Minuten-Videos NIE. Es
 * liefe unbegrenzt oft, und es faellt niemandem auf — kein Fehler, keine
 * Meldung, nur ein Kind, das mehr sieht. Deshalb rechnet `verbrauchen` gegen
 * `laenge()`, und der Kinderschirm meldet zusaetzlich SEKUNDEN, damit der
 * Server die Bezugsgroesse nicht von ihm erfragen muss.
 *
 * ══ WARUM EIN LAUF EINE KENNUNG HAT ════════════════════════════════════════
 *
 * Gezaehlt wird, was zu Ende gesehen wurde — der Browser meldet das. Eine
 * Meldung aus dem Browser kann ZWEIMAL kommen (Neuladen, doppeltes Ereignis,
 * ein Kind, das den Knopf zweimal drueckt), und dann waere die Belohnung nach
 * einem Anschauen zweimal verbraucht. Deshalb bekommt jeder Start eine
 * Laufkennung, und je Laufkennung wird HOECHSTENS EINMAL gezaehlt.
 */

/** Wie viel vom Video gesehen sein muss, damit es zaehlt. */
export const SCHWELLE = 0.9

/** Hoechstzahl der Freigaben je Video. */
export const ANZAHL_MAX = 99

/** Hoechstzahl der Videos je Profil — die Ablage soll klein bleiben. */
export const VIDEOS_MAX = 60

/**
 * Welches Plugin gemeint ist, wenn keines dasteht.
 *
 * ES IST EIN RUECKFALL FUER DIE VERGANGENHEIT, keine Vorliebe: alle Freigaben,
 * die vor dem 20.09.2026 angelegt wurden, kennen das Feld `quelle` nicht, und
 * damals gab es nur die ARD. Ein `quelle: ''` still auf „irgendetwas" zu
 * biegen waere dagegen falsch — welches Plugin gefragt wird, entscheidet
 * `VIDEO_PLUGINS` im Server, nicht diese Datei.
 */
export const QUELLE_VORGABE = 'mixpi-mediathek'

/**
 * Welche Kennungen ueberhaupt eine Quelle sein duerfen.
 *
 * Eine Quelle ist eine PLUGIN-KENNUNG, und sie landet spaeter in einem Pfad
 * (`/api/plugins/<quelle>/http/…`). Punkte und Schraegstriche haetten dort
 * nichts zu suchen — ein `..` waere ein Weg aus dem Plugin-Ordner heraus.
 */
const QUELLE_FORM = /^[a-z0-9][a-z0-9-]{1,63}$/

export interface Freigabe {
  /**
   * Die Kennung BEIM PLUGIN — der Schluessel dieser Liste.
   *
   * Was darin steht, gehoert der Quelle: bei `mixpi-mediathek` ist es base64
   * einer crid, bei `mixpi-mediathekview` base64url von Sender, Sendung und
   * Titel. Der Kern liest sie NIE, er reicht sie durch.
   */
  kennung: string
  /**
   * WELCHES PLUGIN diese Kennung aufloesen kann.
   *
   * Seit es mehr als eine Mediathek gibt (20.09.2026), reicht die Kennung
   * allein nicht mehr: zwei Quellen koennen dieselbe Zeichenfolge fuehren, und
   * die falsche gefragt heisst „gibt es nicht" vor einem Kind, das sich das
   * Video verdient hat.
   */
  quelle: string
  /**
   * DER SCHLUESSEL DIESER LISTE — nicht `kennung`.
   *
   * Bei einem ganzen Video ist er die Videokennung selbst (so laufen alte
   * Ablagen unveraendert weiter); bei einem Stueck ist er aus Kennung und
   * Schnitt abgeleitet (`idAus`).
   */
  id: string
  name: string
  sendung: string
  bild: string
  dauerSek: number
  /** Wie oft angeschaut werden darf, insgesamt. */
  anzahl: number
  /** Wie oft schon ganz angeschaut wurde. */
  verbraucht: number
  /** Wann freigegeben (ms seit 1970). */
  angelegt: number
  /**
   * AB WELCHER SEKUNDE DAS STUECK LAEUFT. 0 heisst „von vorn".
   *
   * `abSek` und `bisSek` sind zusammen der Schnitt. `bisSek === 0` heisst
   * „bis zum Ende" — und NICHT „Laenge null", sonst waere jedes ungeschnittene
   * Video ein leeres Stueck.
   */
  abSek: number
  /** Bis zu welcher Sekunde; 0 heisst „bis zum Ende". */
  bisSek: number
  /** Wie das Stueck heisst („Teil 2"). Leer bei einem ganzen Video. */
  teil: string
  /** Wann zuletzt ganz angeschaut (ms); 0 = noch nie. */
  zuletzt: number
  /**
   * Die Laufkennung, die zuletzt gezaehlt hat. Verhindert, dass dieselbe
   * Meldung zweimal verbraucht.
   */
  laufVerbraucht: string
}

export interface Freigaben {
  fassung: 1
  videos: Freigabe[]
}

export type Grund =
  | 'frei' // darf laufen
  | 'unbekannt' // fuer dieses Profil nicht freigegeben
  | 'aufgebraucht' // freigegeben, aber kein Mal mehr uebrig

export interface Urteil {
  erlaubt: boolean
  grund: Grund
  /** Wie oft es noch laufen darf. */
  rest: number
}

/** Eine leere Ablage. */
export function leer(): Freigaben {
  return { fassung: 1, videos: [] }
}

/** Wie oft dieses Video noch laufen darf. Nie negativ. */
export function rest(f: Freigabe | undefined | null): number {
  if (!f) return 0
  return Math.max(0, f.anzahl - f.verbraucht)
}

/** Eine ganze Zahl in Grenzen, oder `null` — nichts wird geraten. */
export function zahl(roh: unknown, klein: number, gross: number): number | null {
  const n = typeof roh === 'number' ? roh : Number(roh)
  if (!Number.isFinite(n)) return null
  const g = Math.floor(n)
  if (g < klein || g > gross) return null
  return g
}

/**
 * Der Schluessel einer Freigabe, abgeleitet aus Video und Schnitt.
 *
 * ZWEI FAELLE, UND DER ERSTE IST DER WICHTIGE:
 *
 *   GANZES VIDEO (kein Schnitt) -> die Videokennung selbst. Damit ist jede
 *   Ablage von vor dem 20.09.2026 ohne eine einzige Wanderung gueltig: ihre
 *   `kennung` IST ihre `id`.
 *
 *   EIN STUECK -> `t<ab>-<bis>-<kurz>`, wobei `kurz` eine Quersumme der
 *   Videokennung ist. ABGELEITET UND NICHT GEWUERFELT, damit „dasselbe Stueck
 *   nochmal freigeben" ein NACHLEGEN ist und keine zweite Kachel.
 *
 * DIE QUERSUMME IST KEIN SICHERHEITSMITTEL. Sie trennt Stuecke verschiedener
 * Videos in einer Liste von hoechstens 60 Eintraegen — dafuer reicht sie, und
 * mehr wird ihr hier auch nicht abverlangt.
 */
export function idAus(kennung: string, abSek: number, bisSek: number): string {
  const ab = Math.max(0, Math.floor(Number(abSek) || 0))
  const bis = Math.max(0, Math.floor(Number(bisSek) || 0))
  if (ab === 0 && bis === 0) return kennung
  let summe = 0
  for (let i = 0; i < kennung.length; i++) summe = (summe * 31 + kennung.charCodeAt(i)) >>> 0
  return `t${ab}-${bis}-${summe.toString(36)}`
}

/**
 * Wie lang DIESES Stueck ist — und nicht, wie lang das Video ist.
 *
 * Die Zahl, gegen die die Schwelle rechnet. `0` heisst „unbekannt": dann
 * entscheidet der gemeldete Anteil allein, weil es nichts gibt, wogegen man
 * ihn nachrechnen koennte.
 */
export function laenge(f: Freigabe | undefined | null): number {
  if (!f) return 0
  if (f.bisSek > f.abSek) return f.bisSek - f.abSek
  if (f.dauerSek > f.abSek) return f.dauerSek - f.abSek
  return f.dauerSek
}

/** Ist diese Freigabe ein Ausschnitt und kein ganzes Video? */
export function geschnitten(f: Freigabe | undefined | null): boolean {
  return !!f && (f.abSek > 0 || f.bisSek > 0)
}

/**
 * Eine fremde Eingabe zu einer Freigabe machen — oder `null`.
 *
 * NULL IST HIER DIE SICHERE ANTWORT (siehe Kopf der Datei). Es gibt genau
 * zwei Pflichtfelder: eine Kennung und ein Name. Alles andere ist Schmuck
 * fuer die Kachel und darf fehlen; eine Freigabe ohne Bild ist eine Freigabe,
 * eine ohne Kennung ist keine.
 */
export function freigabeNormalisieren(roh: unknown): Freigabe | null {
  if (!roh || typeof roh !== 'object') return null
  const r = roh as Record<string, unknown>
  const kennung = String(r.kennung ?? '').trim()
  // KENNUNGEN SIND BASE64 ODER BASE64URL — sie koennen `+`, `/`, `=`, `-` und
  // `_` enthalten. Was sie NICHT enthalten duerfen, ist ein Zeichen, das einen
  // Pfad oder eine Adresse zerlegt: sie werden spaeter in eine URL gesetzt.
  //
  // DIE GRENZE STAND BIS ZUM 20.09.2026 BEI 256 und liegt seither bei 512:
  // `mixpi-mediathekview` kodiert Sender, Sendung und Titel in die Kennung,
  // weil sein Dienst nichts Kuerzeres zum Nachschlagen anbietet. 256 Zeichen
  // haetten lange Titel stumm verschluckt — die Kachel waere dagewesen und der
  // Knopf haette nichts getan.
  if (!kennung || kennung.length > 512 || !/^[A-Za-z0-9+/=_-]+$/.test(kennung)) return null
  // EINE UNLESBARE QUELLE FAELLT AUF DIE VORGABE, statt den Eintrag zu
  // verwerfen: das Feld gab es frueher nicht, und alte Freigaben sind die
  // Arbeit der Eltern. Was NICHT passiert, ist Raten — ein `quelle` mit
  // Sonderzeichen ist keine Plugin-Kennung und wird zur Vorgabe, nicht zu
  // einem Pfad.
  const quelleRoh = String(r.quelle ?? '')
    .trim()
    .toLowerCase()
  const quelle = QUELLE_FORM.test(quelleRoh) ? quelleRoh : QUELLE_VORGABE
  const name = String(r.name ?? '').trim()
  if (!name) return null
  const anzahl = zahl(r.anzahl, 1, ANZAHL_MAX)
  if (anzahl === null) return null
  const verbraucht = zahl(r.verbraucht, 0, ANZAHL_MAX) ?? 0
  const bild = String(r.bild ?? '').trim()
  // DER SCHNITT. Beide Zahlen einzeln gelesen, damit eine unlesbare nicht die
  // andere mitnimmt — und `bis <= ab` faellt ganz weg statt ein Stueck mit
  // negativer Laenge zu ergeben, das jede spaetere Rechnung verdreht.
  const abSek = zahl(r.abSek, 0, 86400) ?? 0
  const bisRoh = zahl(r.bisSek, 0, 86400) ?? 0
  const bisSek = bisRoh > abSek ? bisRoh : 0
  return {
    kennung,
    quelle,
    // DIE id AUS DER EINGABE WIRD NICHT GEGLAUBT, sondern neu abgeleitet: sie
    // ist eine Funktion von Kennung und Schnitt, und zwei Wahrheiten darueber
    // waeren eine Liste, in der `finden` und `freigeben` verschiedene Zeilen
    // treffen.
    id: idAus(kennung, abSek, bisSek),
    abSek,
    bisSek,
    teil: String(r.teil ?? '')
      .trim()
      .slice(0, 60),
    name: name.slice(0, 200),
    sendung: String(r.sendung ?? '')
      .trim()
      .slice(0, 200),
    // EIN BILD IST EINE ADRESSE, DIE DIE OBERFLAECHE LAEDT. http/https oder
    // gar nichts — alles andere waere ein `javascript:` in einem `src`.
    bild: /^https?:\/\//i.test(bild) ? bild.slice(0, 500) : '',
    dauerSek: zahl(r.dauerSek, 1, 86400) ?? 0,
    anzahl,
    // MEHR VERBRAUCHT ALS FREIGEGEBEN gibt es nicht: das waere ein negativer
    // Rest, und der rechnet sich durch jede spaetere Anzeige.
    verbraucht: Math.min(verbraucht, anzahl),
    angelegt: zahl(r.angelegt, 0, Number.MAX_SAFE_INTEGER) ?? 0,
    zuletzt: zahl(r.zuletzt, 0, Number.MAX_SAFE_INTEGER) ?? 0,
    laufVerbraucht: String(r.laufVerbraucht ?? '')
      .trim()
      .slice(0, 64),
  }
}

/**
 * Eine ganze Ablage lesen. Kaputte Eintraege fallen weg, der Rest bleibt.
 *
 * EIN KAPUTTER EINTRAG NIMMT NICHT DIE GANZE LISTE MIT: die Freigaben sind
 * die Arbeit der Eltern, oft ueber Wochen. Sie wegen einer unlesbaren Zeile
 * alle zu verlieren waere der teurere Fehler.
 */
export function freigabenNormalisieren(roh: unknown): Freigaben {
  const r = (roh ?? {}) as Record<string, unknown>
  const liste = Array.isArray(r.videos) ? r.videos : []
  const videos: Freigabe[] = []
  const gesehen = new Set<string>()
  for (const e of liste) {
    const f = freigabeNormalisieren(e)
    if (!f) continue
    // DUBLETTEN: die ERSTE gilt. Zwei Zeilen zu derselben Kennung haetten
    // zwei Zaehler, und welcher zaehlt, entschiede die Reihenfolge.
    //
    // GESCHLUESSELT WIRD AUF `id` UND NICHT AUF `kennung`: drei Stuecke
    // desselben Videos tragen dreimal dieselbe Kennung und sind trotzdem drei
    // Zeilen. Bei einem ganzen Video sind beide gleich — dort aendert sich
    // nichts.
    if (gesehen.has(f.id)) continue
    gesehen.add(f.id)
    videos.push(f)
    if (videos.length >= VIDEOS_MAX) break
  }
  return { fassung: 1, videos }
}

/**
 * Die Freigabe zu einer id, oder `undefined`.
 *
 * ES IST DIE id UND NICHT DIE VIDEOKENNUNG. Bei einem ganzen Video sind beide
 * dieselbe Zeichenfolge, weshalb jeder alte Aufruf weiter trifft; bei einem
 * Stueck waere die Kennung mehrdeutig.
 */
export function finden(stand: Freigaben, id: string): Freigabe | undefined {
  return stand.videos.find((f) => f.id === id)
}

/** Alle Stuecke EINES Videos — fuer die Elternflaeche, die sie zusammen zeigt. */
export function stueckeVon(stand: Freigaben, kennung: string): Freigabe[] {
  return stand.videos.filter((f) => f.kennung === kennung)
}

/**
 * Was der KINDERSCHIRM sehen darf: nur, was noch laeuft.
 *
 * Aufgebrauchtes verschwindet fuer das Kind und bleibt fuer die Eltern
 * stehen — sie sollen nachlegen koennen, ohne neu zu suchen, und sie sollen
 * sehen, was gelaufen ist. Eine Kachel, die nichts mehr tut, ist auf dem
 * Kinderschirm dagegen nur eine Enttaeuschung, die jeden Tag wiederkommt.
 */
export function fuerKind(stand: Freigaben): Freigabe[] {
  return stand.videos.filter((f) => rest(f) > 0)
}

/** Darf dieses Video (oder dieses Stueck) JETZT starten? */
export function urteilen(stand: Freigaben, id: string): Urteil {
  const f = finden(stand, id)
  if (!f) return { erlaubt: false, grund: 'unbekannt', rest: 0 }
  const uebrig = rest(f)
  if (uebrig <= 0) return { erlaubt: false, grund: 'aufgebraucht', rest: 0 }
  return { erlaubt: true, grund: 'frei', rest: uebrig }
}

/**
 * Ein Video freigeben (oder die Zahl eines schon freigegebenen erhoehen).
 *
 * WIEDERHOLTES FREIGEBEN LEGT NACH, statt eine zweite Kachel zu machen: das
 * ist, was ein Elternteil meint, das dasselbe Video noch einmal freigibt.
 * Dabei wird die ANZAHL erhoeht und der Verbrauch NICHT zurueckgesetzt —
 * „noch dreimal" heisst dann wirklich noch dreimal.
 */
export function freigeben(
  stand: Freigaben,
  neu: {
    kennung: string
    quelle?: string
    name: string
    sendung?: string
    bild?: string
    dauerSek?: number
    abSek?: number
    bisSek?: number
    teil?: string
  },
  anzahl: number,
  jetzt: number,
): { stand: Freigaben; ok: boolean; fehler?: string } {
  const n = zahl(anzahl, 1, ANZAHL_MAX)
  if (n === null) return { stand, ok: false, fehler: `anzahl muss zwischen 1 und ${ANZAHL_MAX} liegen` }
  const f = freigabeNormalisieren({ ...neu, anzahl: n, verbraucht: 0, angelegt: jetzt })
  if (!f) return { stand, ok: false, fehler: 'kennung oder name fehlt' }
  // NACHGELEGT WIRD AUF DIE id: dasselbe STUECK noch einmal freigeben erhoeht
  // seine Zahl, ein ANDERER Schnitt desselben Videos wird eine eigene Zeile.
  const vorhanden = finden(stand, f.id)
  if (vorhanden) {
    const gesamt = Math.min(ANZAHL_MAX, vorhanden.anzahl + n)
    // NACHLEGEN ZIEHT DIE QUELLE MIT: gibt ein Elternteil dasselbe Video aus
    // einer anderen Mediathek noch einmal frei, ist die NEUE Quelle die, die
    // gerade nachweislich geantwortet hat.
    const videos = stand.videos.map((v) =>
      v.id === f.id
        ? { ...v, anzahl: gesamt, name: f.name || v.name, bild: f.bild || v.bild, quelle: f.quelle, teil: f.teil || v.teil }
        : v,
    )
    return { stand: { fassung: 1, videos }, ok: true }
  }
  if (stand.videos.length >= VIDEOS_MAX) {
    return { stand, ok: false, fehler: `hoechstens ${VIDEOS_MAX} Videos je Profil` }
  }
  return { stand: { fassung: 1, videos: [...stand.videos, f] }, ok: true }
}

/**
 * Den REST auf einen Wert setzen (statt nachzulegen). 0 heisst: keins mehr.
 *
 * GESETZT WIRD DER REST, NICHT DIE GESAMTZAHL. Ein Elternteil, das in der
 * Liste „noch 2" liest und „noch 1" haben will, meint den Rest; die
 * Gesamtzahl ist eine Buchhaltungsgroesse, die niemand im Kopf hat. Der
 * Verbrauch bleibt dabei stehen — die Vergangenheit wird nicht gefaelscht,
 * die Gesamtzahl wandert mit (`anzahl = verbraucht + rest`).
 */
export function restSetzen(stand: Freigaben, id: string, neuerRest: number): { stand: Freigaben; ok: boolean } {
  const f = finden(stand, id)
  if (!f) return { stand, ok: false }
  const n = zahl(neuerRest, 0, ANZAHL_MAX)
  if (n === null) return { stand, ok: false }
  const anzahl = Math.min(ANZAHL_MAX, f.verbraucht + n)
  const videos = stand.videos.map((v) => (v.id === id ? { ...v, anzahl } : v))
  return { stand: { fassung: 1, videos }, ok: true }
}

/** Eine Freigabe ganz entfernen — der ausdrueckliche Wille der Eltern. */
export function entziehen(stand: Freigaben, id: string): { stand: Freigaben; ok: boolean } {
  if (!finden(stand, id)) return { stand, ok: false }
  // NUR DIESES STUECK. Ein Elternteil, das „Teil 2" wegnimmt, meint Teil 2 —
  // die anderen Stuecke desselben Videos bleiben stehen.
  return { stand: { fassung: 1, videos: stand.videos.filter((f) => f.id !== id) }, ok: true }
}

/** Was der Kinderschirm ueber eine Sichtung meldet. */
export interface Meldung {
  /**
   * WIE VIELE SEKUNDEN DES STUECKS GELAUFEN SIND — die bevorzugte Angabe.
   *
   * Sie ist besser als ein Anteil, weil der Server die BEZUGSGROESSE selbst
   * kennt: ein Anteil zwingt ihn, dem Browser zu glauben, wovon der Anteil
   * genommen wurde. Genau daran haengt bei einem Stueck alles.
   */
  sekunden?: number
  /** Anteil 0..1 DES STUECKS — der alte Weg, und der Rueckfall. */
  anteil?: number
}

export type VerbrauchGrund =
  | 'gezaehlt' // ein Mal ist weg
  | 'zuWenigGesehen' // abgebrochen — kostet nichts
  | 'schonGezaehlt' // dieselbe Laufkennung ein zweites Mal
  | 'unbekannt' // nicht freigegeben
  | 'aufgebraucht' // war schon leer

/**
 * Wie viel des STUECKS gesehen wurde — aus dem, was gemeldet wurde.
 *
 * NUR EIN GESCHNITTENES STUECK RECHNET UEBER SEKUNDEN — und das ist nicht
 * Sparsamkeit, sondern eine Korrektur. Der erste Wurf rechnete IMMER so, und
 * `tools/video-belohnung-schau.mjs` hat noch am selben Tag gezeigt, was daran
 * falsch ist: ein GANZES Video verbrauchte danach nichts mehr.
 *
 * DER GRUND IST, WEM DIE LAENGE GEHOERT:
 *
 *   BEI EINEM STUECK gehoert sie dem SERVER. `abSek`/`bisSek` sind seine
 *   Zahlen, sie DEFINIEREN das Stueck, und nur er kann sagen, wann es zu
 *   Ende ist. Der Browser koennte die Bezugsgroesse hier gar nicht kennen.
 *
 *   BEI EINEM GANZEN VIDEO gehoert sie der DATEI. `dauerSek` ist eine
 *   Angabe aus der Suche — sie kann veraltet, gerundet oder schlicht falsch
 *   sein. Ein Video, das laut Ablage 1626 s hat und in Wahrheit 2 s lang
 *   ist, erreichte gegen die Ablage gerechnet NIE die Schwelle. Der Anteil
 *   des Browsers misst dagegen die Datei, die wirklich lief.
 *
 * DIE REIHENFOLGE ALSO:
 *   1  GESCHNITTEN + Sekunden + bekannte Laenge -> der Server rechnet.
 *   2  SONST DER ANTEIL, wie bisher.
 *   3  Fehlt der Anteil ganz, gelten die Sekunden doch — eine Meldung ohne
 *      jede brauchbare Zahl waere sonst ein stilles `NaN`.
 *
 * EINE ZAHL STATT EINES OBJEKTS WIRD WEITER ANGENOMMEN: so rief der Kern
 * diese Funktion vor dem 20.09.2026, und ein Aufrufer, der es noch tut, soll
 * nicht still `NaN` melden.
 */
export function anteilAus(f: Freigabe, meldung: Meldung | number): number {
  const m: Meldung = typeof meldung === 'number' ? { anteil: meldung } : (meldung ?? {})
  const sek = Number(m.sekunden)
  const lang = laenge(f)
  const sekunden = Number.isFinite(sek) && sek >= 0 && lang > 0 ? Math.min(1, sek / lang) : Number.NaN
  if (geschnitten(f) && Number.isFinite(sekunden)) return sekunden
  const anteil = Number(m.anteil)
  return Number.isFinite(anteil) ? anteil : sekunden
}

/**
 * Melden, wie viel gesehen wurde.
 *
 * @param meldung Sekunden (bevorzugt) oder ein Anteil 0..1 DES STUECKS.
 * @param lauf    die Kennung DIESES Starts; je Lauf wird hoechstens einmal
 *                gezaehlt.
 */
export function verbrauchen(
  stand: Freigaben,
  id: string,
  lauf: string,
  meldung: Meldung | number,
  jetzt: number,
): { stand: Freigaben; grund: VerbrauchGrund; rest: number } {
  const f = finden(stand, id)
  if (!f) return { stand, grund: 'unbekannt', rest: 0 }
  const l = String(lauf ?? '')
    .trim()
    .slice(0, 64)
  if (l && f.laufVerbraucht === l) return { stand, grund: 'schonGezaehlt', rest: rest(f) }
  const a = anteilAus(f, meldung)
  if (!Number.isFinite(a) || a < SCHWELLE) return { stand, grund: 'zuWenigGesehen', rest: rest(f) }
  if (rest(f) <= 0) return { stand, grund: 'aufgebraucht', rest: 0 }
  const neu: Freigabe = { ...f, verbraucht: f.verbraucht + 1, zuletzt: jetzt, laufVerbraucht: l }
  const videos = stand.videos.map((v) => (v.id === id ? neu : v))
  return { stand: { fassung: 1, videos }, grund: 'gezaehlt', rest: rest(neu) }
}

/**
 * UNTER WELCHEM PFAD DAS PLUGIN NACH DIESER FREIGABE GEFRAGT WIRD.
 *
 * DREI ZEILEN CODE UND EIN EIGENER NAME, WEIL HIER EIN FEHLER SASS, DEN KEIN
 * ZEUGE SAH: der Server hatte die id der ZEILE in den Pfad gesetzt. Bei einem
 * ganzen Video faellt das nie auf (id und Kennung sind dieselbe Zeichenfolge);
 * bei einem Stueck haette die Mediathek nach `t0-500-1a2b3c` gesucht und
 * „gibt es nicht mehr" geantwortet — vor einem Kind, das sich die Belohnung
 * verdient hat.
 *
 * ES STEHT DESHALB HIER UND NICHT IM SERVER: eine Entscheidung, die im
 * `await` klebt, ist nur an einer laufenden Box pruefbar. So hat sie einen
 * Zeugen, und die Gegenprobe wird rot.
 */
export function pluginPfad(f: Freigabe): string {
  return `video/${encodeURIComponent(f.kennung)}`
}

/** Was die Oberflaeche sehen soll — ohne die Buchfuehrung nach aussen zu tragen. */
export function fuerAntwort(f: Freigabe): Record<string, unknown> {
  return {
    id: f.id,
    kennung: f.kennung,
    quelle: f.quelle,
    abSek: f.abSek,
    bisSek: f.bisSek,
    teil: f.teil,
    laengeSek: laenge(f),
    name: f.name,
    sendung: f.sendung,
    bild: f.bild,
    dauerSek: f.dauerSek,
    anzahl: f.anzahl,
    verbraucht: f.verbraucht,
    rest: rest(f),
    angelegt: f.angelegt,
    zuletzt: f.zuletzt,
  }
}
