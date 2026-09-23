/**
 * SPIELFUNKTION (E95/V) — die Entscheidungen hinter „spiele dieses Werk".
 *
 * Betreiber, 30.08.2026 woertlich: „die ui spielt mit der spielfunktion das
 * backend entscheidet nach eingestellten regeln." Dieses Modul ist der reine
 * Teil dieser Entscheidung: welcher Befehl, welche Quelle, welche Folge,
 * welcher Sprung — `startPlan` unten ist die Hauptstelle. Es zieht die Regeln
 * aus NewDesign/app.js hierher
 * (`abspielBefehl`, `weiterSpielen`, `ardSendungAb`, `angekommen`), wo sie
 * am 30.08.2026 dreimal an einem Abend repariert werden mussten — jede
 * Reparatur an Entscheidungslogik, die in der Oberflaeche wohnte und dort
 * serverseitig unpruefbar war.
 *
 * REINE LOGIK: kein Netz, kein Dateisystem, keine Uhr — dieselbe Bauart wie
 * kinderzeit.ts und spielweg.ts, aus demselben Grund: eine Entscheidung, die
 * erst am Geraet falsch faellt, findet man sonst nie. Den ABLAUF (anhalten,
 * senden, anhaengen, springen) fuehrt die Route `POST /api/spielen` in
 * server.ts; hier steht, WAS zu tun ist.
 */
import type { Quelle, Werk } from './werke'

/**
 * Was der Start eines Werks aus EINER Quelle verlangt.
 *
 *   befehl      EIN Pfad an den Abspieldienst startet alles.
 *   inhalt      erst `/inhalt` fragen: die Titel tragen fertige Befehle
 *               (Jellyfin-Album, ARD-Sendung, Plugin-Werk — deren
 *               Tonadressen entstehen erst beim Abruf und laufen ab; seit
 *               E111 auch das lokale Album, damit Anzeige und Ton dieselbe
 *               Liste benutzen). `rueckfall` ist der Ein-Befehl-Weg fuer den
 *               Fall, dass die Liste keine spielbaren Titel hergibt — siehe
 *               den lokal-Zweig in `startPlan`.
 *   seite       eine Interpreten-Kachel spielt nichts, sie oeffnet.
 *   unspielbar  kein bekannter Weg — ehrlich sagen statt raten.
 */
export type StartPlan =
  | { art: 'befehl'; pfad: string }
  | { art: 'inhalt'; rueckfall?: string }
  | { art: 'seite' }
  | { art: 'unspielbar' }

const enc = encodeURIComponent

/** Aus einer Spotify-Kennung die nackte Id — egal ob Id, Adresse oder
 *  `spotify:…`-Verweis. Wortgleich mit `spotifyId` in NewDesign/app.js und
 *  der Erkennung in `interpretTaugt` (werke.ts); drei Stellen, eine Form. */
export function spotifyIdAus(roh: unknown): string {
  const s = String(roh ?? '').trim()
  const netz = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?[a-z]+\/([A-Za-z0-9]+)/.exec(s)
  if (netz) return netz[1]
  const verweis = /^spotify:[a-z]+:([A-Za-z0-9]+)$/.exec(s)
  if (verweis) return verweis[1]
  return s
}

/**
 * Die rohe Kennung einer Quelle.
 *
 * Der Schluessel hat die Form `<dienst>:<kennung>` (medien.ts), und es ist
 * leicht, versehentlich IHN statt der reinen Kennung einzutragen.
 * Abgeschnitten wird nur, wenn der Rest KEINEN weiteren Doppelpunkt traegt:
 * `spotify:4aBc…` ist ersichtlich ein Schluessel, `spotify:album:4aBc…`
 * dagegen eine gueltige Spotify-Adresse, die unangetastet bleiben muss.
 * (Wortgleich mit `kennungVon` in NewDesign/app.js.)
 */
export function kennungAus(q: Pick<Quelle, 'dienst' | 'kennung'> | null | undefined): string {
  const roh = String(q?.kennung ?? '').trim()
  const vorsatz = `${q?.dienst}:`
  if (roh.startsWith(vorsatz)) {
    const rest = roh.slice(vorsatz.length)
    if (rest && rest.indexOf(':') === -1) return rest
  }
  return roh
}

/**
 * Der Startplan eines Werks aus EINER Quelle — `startPlan` ist der Umzug von
 * `abspielBefehl` (NewDesign/app.js, dort seit E95/V Stufe 3 geloescht),
 * Zweig fuer Zweig, samt der am Geraet bezahlten Regeln:
 *
 *   lokal     UEBER DIE LISTE, nicht mit einem Album-Befehl (E111,
 *             31.08.2026) — mit dem musicsearch-Befehl als RUECKFALL.
 *             Begruendung im Zweig unten.
 *   spotify   Titelnummer und Fortschritt in MILLISEKUNDEN gehoeren in den
 *             STARTBEFEHL: ein Sprung nach vorn wirkt bei laufender
 *             Spotify-Wiedergabe nicht (llmwiki
 *             spotify-vorwaerts-spulen-wirkungslos). `nr` ist 1-basiert und
 *             geht UNVERAENDERT hinein — der Abspieldienst zieht selbst eins
 *             ab, und 0 heisst „von vorn" (llmwiki
 *             spotify-sprungziel-um-eins-verschoben).
 *   jellyfin  ein ALBUM ist kein Ein-Befehl-Vorgang (erst aufloesen, dann
 *             anhaengen) -> `inhalt`. Ein Einzeltitel geht direkt.
 *   ard,      NIE ein Ein-Befehl-Start: in data.json steht die Kennung der
 *   plugin    SENDUNG, die Tonadresse einer Folge laeuft ab (gemessen
 *             04.08.2026: Folge 16657073 antwortete 404, waehrend die
 *             Schnittstelle sie weiter auflistete) -> `inhalt`. AUSDRUECKLICH
 *             benannt statt dem Sammelfall ueberlassen: bis zum 04.08.2026
 *             fiel `ard` in den default und die Kachel log „Das kann die Box
 *             hier noch nicht abspielen" (tools/kachel-spielt-je-dienst.mjs).
 *
 * `nr` 1-basiert (0 = von vorn), `ms` Millisekunden — beides wirkt nur bei
 * Spotify; mpv bekommt seine Stelle hinterher mit `tracknr:`/`seekpos:`.
 */
export function startPlan(werk: Werk, quelle: Quelle | null | undefined, nr = 0, ms = 0): StartPlan {
  // EINE INTERPRETEN-KACHEL SPIELT NICHTS, SIE OEFFNET — vor jeder Quelle
  // entschieden, damit unten keine vierte Spotify-Art dazukommt, die es gar
  // nicht abzuspielen gilt (E45).
  if (werk.art === 'interpret') return { art: 'seite' }
  const q = quelle ?? werk.quellen?.[0] ?? null
  if (!q) return { art: 'unspielbar' }
  const k = kennungAus(q)
  const titel = enc(String(werk.titel ?? ''))
  const interpret = enc(String(werk.interpret ?? ''))

  switch (q.dienst) {
    /* ══ LOKAL SPIELT DIE ANGEZEIGTE LISTE (E111, 31.08.2026) ═══════════════
     *
     * Betreiber am Geraet: „titel -> track2 oder 3, track1 fehlt". Gemessen
     * war es eine Buchhaltung mit ZWEI Listen: `/inhalt` zeigt seit E111 die
     * Titel aus dem ORDNER (server.ts, `inhaltFuerEintrag` — das Verzeichnis
     * ist die Wahrheit, die playlist.m3u hinkt der Aufnahme nach), waehrend
     * `musicsearch/library/album/…` den Abspieldienst die m3u lesen liess.
     * „Guten Morgen": drei Dateien im Ordner, zwei in der m3u — jede
     * Warteschlangennummer bedeutete auf beiden Seiten etwas anderes, und ein
     * Sprung auf Titel N traf einen anderen Titel als den angezeigten.
     *
     * Deshalb derselbe Weg wie bei Jellyfin-Album, ARD und Plugin: Liste
     * holen, ersten Titel starten, Rest anhaengen, Sprung nachziehen. Die
     * Titel der lokalen Liste tragen dafuer eigene `datei`/`dateiqueue`-
     * Befehle (E108-Familie).
     *
     * DER RUECKFALL IST PFLICHT, NICHT KOSMETIK: Findet der Ordner nichts
     * (fremd gemountete Medien, andere Ablage, unlesbarer Pfad), liefert
     * `inhaltFuerEintrag` die m3u-Liste des Abspieldienstes — und deren Titel
     * tragen KEINEN Befehl, weil die m3u nur Dateinamen kennt. Ohne diesen
     * Zweig endete so eine Box in „keine-titel" und spielte gar nichts mehr,
     * obwohl der klassische musicsearch-Weg dort seit jeher funktioniert. Der
     * Rueckfall ist Zeichen fuer Zeichen der Befehl, der bis E111 der einzige
     * war; wer ihn liest, liest die alte Fassung:
     *
     *   ERST DIE PLATTENFORM DER QUELLE (30.08.2026, „Guten Morgen / Good
     *   Morning"): die Aufnahme sanitisiert Sonderzeichen (`/` -> `_`), das
     *   verschmolzene Werk fuehrt aber mit Spotify-Metadaten — ein Befehl
     *   daraus sucht Ordner, die es nie gab, und musicsearch faengt im
     *   Zweifel etwas AEHNLICHES. Dahinter die Kategorie der QUELLE vor der
     *   des Werks („Nah", E105): der Mitschnitt liegt unter `audiobook/…`,
     *   das Werk fuehrt `music`.
     */
    case 'lokal': {
      const p = q.lokalPfad
      const platte =
        p?.interpret && p.titel
          ? `${enc(String(p.kategorie || 'music'))}:${enc(String(p.interpret))}:${enc(String(p.titel))}`
          : `${enc(String(q.kategorie || werk.kategorie || 'music'))}:${interpret}:${titel}`
      return { art: 'inhalt', rueckfall: `musicsearch/library/album/${platte}` }
    }

    case 'spotify': {
      const id = spotifyIdAus(k)
      if (!id) return { art: 'unspielbar' }
      // 'interpret' und 'anderes' haben keinen Ein-Befehl-Start. `show`
      // meint die REIHE (eine Kachel ist eine Sammlung, keine Einzelfolge);
      // die showid/audiobookid-Unschaerfe war in app.js `abspielBefehl`
      // benannt; seit dessen Loeschung steht sie NUR NOCH HIER, in
      // `startPlan` — es gibt keinen zweiten Ort mehr, an dem man sie
      // nachlesen koennte.
      const typ = ({ album: 'album', playlist: 'playlist', show: 'show' } as Record<string, string>)[werk.art]
      if (!typ) return { art: 'unspielbar' }
      return {
        art: 'befehl',
        pfad: `spotify/now/spotify:${typ}:${enc(id)}:${Math.max(0, Math.round(nr))}:${Math.max(0, Math.round(ms))}`,
      }
    }

    case 'radio':
      if (!k) return { art: 'unspielbar' }
      return { art: 'befehl', pfad: `radio/${enc(k)}/${titel}:title:artist:${interpret}` }

    case 'rss':
      if (!k) return { art: 'unspielbar' }
      return { art: 'befehl', pfad: `rss/${enc(k)}/${titel}:title:artist:${interpret}` }

    case 'jellyfin':
      if (werk.art === 'album') return { art: 'inhalt' }
      if (!k) return { art: 'unspielbar' }
      return { art: 'befehl', pfad: `jellyfin/${enc(k)}/${titel}:title:artist:${interpret}` }

    case 'ard':
    case 'plugin':
      return { art: 'inhalt' }

    default:
      return { art: 'unspielbar' }
  }
}

/**
 * DIE QUELLEN EINES VERSUCHS, in der Reihenfolge, in der sie probiert werden.
 *
 * Traegt drei Regeln, jede einzeln bezahlt:
 *
 * 1. AUSWEICHEN (app.js `spielen()`, 27./28.07.2026): Spotify fiel an EINEM
 *    Tag auf drei Arten aus, Jellyfin und lokal kein einziges Mal. Eine
 *    Kachel mit zwei Quellen, die beim Ausfall der ersten schweigt, hat den
 *    Zweck der Verschmelzung verfehlt. `werk.quellen` kommt bereits GEORDNET
 *    aus der Verschmelzung (quellenOrdnen: Vollstaendigkeit vor Rang) — hier
 *    wird die Ordnung benutzt, nicht neu erfunden.
 *
 * 2. DER ANBIETER-SCHALTER (E76) WIRKT ALS SIEB, nicht als Mauer: eine
 *    abgeschaltete Quelle wird uebersprungen, solange eine andere spielt.
 *    Bis E95 lief der Startbefehl der bevorzugten Quelle in das 403 des
 *    Proxys, und das beendete den GANZEN Versuch — ein Werk mit
 *    abgeschaltetem Spotify und lebendem Jellyfin schwieg. Erst wenn ALLE
 *    Quellen im Sieb haengen, gibt es die Verweigerung (`alleAus` traegt
 *    dann den bevorzugten Dienst fuer den Meldungssatz).
 *
 * 3. DIE NUMMERNRAUM-REGEL (30.08.2026, „Du bedeutest mir die Welt" aus
 *    Weiterhoeren): `titelNr`/`positionMs` sind in der Liste der Quelle
 *    entstanden, bei der GEMERKT wurde. Ein lokaler Mitschnitt traegt oft
 *    nur einen TEIL des Albums — Titel 8 der Spotify-Liste existiert dort
 *    nicht, der Sprung landet irgendwo oder nirgends. Ist die bevorzugte
 *    Quelle `lokal` und wurde bei einem anderen Dienst gemerkt, rueckt die
 *    gemerkte Quelle nach vorn, sofern das Werk sie traegt. Volle Listen
 *    (Spotify <-> Jellyfin) tauschen weiter frei; die Kreuz-Uebersetzung der
 *    Nummernraeume bleibt offen (BACKLOG E95). Greift nur, wenn `gemerktBei`
 *    hereinkommt — ein Kacheltipp von vorn hat keinen Nummernraum.
 *
 * `wunschDienst` schaltet alles ab: Wer nach GENAU einer Quelle fragt
 * (Ausweich-Wiederholung der Oberflaeche, `quelle=`-Muster von /inhalt),
 * bekommt genau sie — oder nichts. Ihm stattdessen eine andere zu geben
 * hiesse, ein Ausweichen zu quittieren, das nie stattfand.
 */
export function versuchsQuellen(
  werk: Werk,
  opts: { wunschDienst?: string; abgeschaltet?: readonly string[]; gemerktBei?: string } = {},
): { quellen: Quelle[]; alleAus: string | null } {
  const alle = Array.isArray(werk.quellen) ? werk.quellen.filter((q): q is Quelle => Boolean(q)) : []

  if (opts.wunschDienst) {
    const genau = alle.filter((q) => q.dienst === opts.wunschDienst)
    const aus = (opts.abgeschaltet ?? []).includes(opts.wunschDienst)
    if (aus) return { quellen: [], alleAus: genau.length ? opts.wunschDienst : null }
    return { quellen: genau, alleAus: null }
  }

  const uebrig = alle.filter((q) => !(opts.abgeschaltet ?? []).includes(q.dienst))
  if (!uebrig.length) {
    return { quellen: [], alleAus: alle.length ? alle[0].dienst : null }
  }

  const gemerkt = String(opts.gemerktBei ?? '')
  if (gemerkt && uebrig[0].dienst === 'lokal' && gemerkt !== 'lokal') {
    const i = uebrig.findIndex((q) => q.dienst === gemerkt)
    if (i > 0) {
      const vorn = uebrig[i]
      const rest = uebrig.filter((_, j) => j !== i)
      return { quellen: [vorn, ...rest], alleAus: null }
    }
  }
  return { quellen: uebrig, alleAus: null }
}

/**
 * DIE FOLGE EINER SENDUNG WIEDERFINDEN — als 0-basierter Index in `titel`,
 * oder -1. Der Umzug der Wahl aus `ardSendungAb` (app.js), Stufe fuer Stufe:
 *
 *   1. die KENNUNG (`id`) — nie eine Nummer: hinter einer ARD-Kachel steht
 *      eine ROLLENDE Liste, bei „neueste zuerst" schiebt jede neue Folge
 *      alle anderen um eins nach hinten.
 *   2. `weiterAb` — die Folge, die der Server ueber Kennung ODER Titel schon
 *      zugeordnet hat (`folgeWiederfinden`, weiterhoeren.ts). NUR wenn der
 *      Wunsch aus der GEMERKTEN STELLE kommt (`ausStelle`): ein Tipp auf
 *      eine Folgenkachel meint GENAU diese Folge, dort waere das Ausweichen
 *      ein stiller Fehlgriff.
 *   3. die NUMMER als Schiedsrichter (15.08.2026): trifft die Kennung nicht
 *      — Folge unter neuer Kennung wieder eingesetzt, oder die Kennung kam
 *      gar nicht mit —, gilt die Position der angetippten Kachel. Still
 *      Folge 1 zu spielen waere die schlechteste aller Antworten („oeffnet
 *      immer den ersten titel ganz egal was ich tippe").
 */
export function folgeWaehlen(
  titel: readonly { id?: unknown; weiterAb?: unknown }[],
  gesucht: string,
  ausStelle: boolean,
  nrFallback = 0,
): number {
  const kennung = String(gesucht ?? '')
  let i = kennung ? titel.findIndex((t) => String(t?.id ?? '') === kennung) : -1
  if (i < 0 && ausStelle) i = titel.findIndex((t) => t && (t as { weiterAb?: unknown }).weiterAb)
  if (i < 0 && Number.isFinite(nrFallback) && nrFallback >= 1 && nrFallback <= titel.length) {
    i = nrFallback - 1
  }
  return i
}

/**
 * Das Sprungziel in Prozent — oder null, wenn nicht gesprungen wird.
 *
 * NICHT GENAU 0: eine aeltere Box liest `seekpos:0` noch als RELATIVEN
 * Sprung und geht dreissig Sekunden zurueck; ein Zehntelprozent daneben
 * merkt niemand. (Wortgleich mit `titelUndStelle` in app.js.)
 */
export function seekZiel(prozent: unknown): number | null {
  const p = Number(prozent)
  if (!Number.isFinite(p) || p <= 0) return null
  return Math.max(0.1, Math.min(100, p))
}

/** Wie weit die erreichte Stelle unter dem Ziel liegen darf und trotzdem als
 *  angekommen gilt (Sekunden). */
export const ANKUNFT_KULANZ_S = 8

/**
 * IST DER SPRUNG ANGEKOMMEN? — nachgerechnet, nicht geglaubt.
 *
 * `currentTracknr` taugt dafuer nicht: der Abspieldienst setzt sie beim
 * mpv-Sprung sofort selbst, lange bevor der Titel geladen ist — sie wuerde
 * immer ja sagen. Die STELLE kann dagegen nur stimmen, wenn der gewaehlte
 * Titel wirklich offen ist: `duration` steht erst dann. Kulanz NUR nach
 * unten — nach dem Ankommen laeuft die Wiedergabe weiter, die Stelle wird
 * also nur groesser. (Umzug von `angekommen` in app.js, samt dem dort
 * benannten, bewusst hingenommenen Grenzfall unter acht Sekunden.)
 */
export function sprungAngekommen(
  stand: { duration?: unknown; timePos?: unknown } | null | undefined,
  zielProzent: number,
): boolean {
  const dauer = Number(stand?.duration)
  const stelle = Number(stand?.timePos)
  if (!Number.isFinite(dauer) || dauer <= 0) return false
  if (!Number.isFinite(stelle)) return false
  const soll = (dauer * zielProzent) / 100
  return stelle >= soll - ANKUNFT_KULANZ_S
}

/**
 * Hat diese Quelle den gewuenschten Titel NICHT?
 *
 * DIE STILLSTE REGEL DES ABSPIELWEGS, und sie hat am 04.09.2026 einen ganzen
 * Nachmittag gekostet. `folgeWaehlen` liefert `-1`, wenn die gewuenschte
 * Nummer ausserhalb der Liste dieser Quelle liegt. Der Aufrufer machte daraus
 * bis dahin `titel[0]` und meldete `ergebnis: 'ok'` — ein Fehlschlag, der
 * Erfolg meldet.
 *
 * GEMESSEN am Werk „101 Meerjungfrauen": angezeigt 11 Kapitel (Spotify),
 * Spotify scheitert an der Anmeldung, das Ausweichen nimmt die lokale Quelle
 * mit EINEM Titel, `folgeWaehlen(…, 3)` gibt `-1` — und es lief Kapitel 1.
 * Fuer den Betreiber sah das aus, als sei die Titelauswahl kaputt; die
 * eigentliche Ursache (Spotify-Anmeldung) stand nirgends.
 *
 * `titelNr === 0` HEISST „VON VORN" und ist deshalb ausdruecklich KEIN
 * verfehlter Wunsch: Ohne diese Unterscheidung koennte gar nichts mehr
 * ausweichen, und das Ausweichen ist ein Merkmal, kein Fehler.
 */
export function wunschVerfehlt(titelNr: number, gewaehlt: number): boolean {
  if (!Number.isFinite(titelNr) || titelNr < 1) return false
  return !Number.isFinite(gewaehlt) || gewaehlt < 0
}

/* ══ DER WECHSELPUNKT IST VORHERSAGBAR — WEIL DIE LISTE BEKANNT IST ════════
 *
 * Betreiber, 04.09.2026: „wir kennen ja die liste." Genau daran haengt die
 * Machbarkeit von E108 Stufe 3. Ein Cue, das erst AM Uebergang merkt, dass
 * die Maschine wechselt, kommt zu spaet: Starten, Puffern und Springen
 * kosten die 1-2 s, die es zu verstecken gilt. Weiss man den Uebergang
 * dagegen, waehrend der VORHERIGE Titel noch laeuft, liegt das ganze
 * riskante Fenster in einem Moment, in dem niemand zuhoert.
 *
 * Die Vorhersage ist deshalb REIN und steht hier, nicht im Abspieldienst:
 * eine Entscheidung, die erst am Geraet falsch faellt, findet man sonst nie
 * — dieselbe Begruendung wie fuer den Rest dieses Moduls.
 *
 * ══ NUR LINEAR, UND DAS IST EINE ENTSCHEIDUNG ═══════════════════════════
 *
 * Betreiber, 04.09.2026: „falls frei gewaehlt wird gibt es eben einen
 * versatz von 1-2s."
 *
 * Vorhersagbar ist genau EIN Fall: der Titel laeuft aus, der naechste der
 * Liste beginnt. Ein TIPP auf ein beliebiges Kapitel ist nicht vorhersagbar
 * — er kommt in dem Moment, in dem das Kind ihn macht, und ein Cue braucht
 * seinen Vorlauf VOR dem Uebergang. Dort bleibt es bei den 1-2 s, und das
 * ist kein Rest, sondern der bezahlte Preis fuer freie Wahl. Genau dieselbe
 * Grenze hat mpvs eigenes `--prefetch-playlist=yes`: vorgeladen wird beim
 * ERREICHEN des Endes und nur der naechste Eintrag.
 *
 * Wer das spaeter aufweichen will, sollte wissen, was es kostet: Ein Cue
 * „auf Verdacht" muesste den Spotify-Zweig dauerhaft stumm halten oder bei
 * jedem Tipp raten. Das erste macht die Box stumm, wenn das Cue haengt; das
 * zweite reisst Fenster fuer Uebergaenge auf, die nie kommen. Beides ist
 * teurer als 1-2 s Versatz an einer Stelle, an der ohnehin gerade jemand
 * bewusst etwas Neues gewaehlt hat und auf Ton wartet.
 */

/** Die Tonmaschine hinter einem Dienst. */
export type Tonmaschine = 'spotify' | 'mpv'

/**
 * WELCHE MASCHINE SPIELT DIESEN DIENST?
 *
 * Diese Regel stand bis zum 04.09.2026 als PROSA an mindestens drei Stellen
 * (titelkarte.ts, server.ts `/inhalt`, mpv-wrapper.ts) und nirgends als
 * Code. Eine Regel an mehreren Orten laeuft auseinander, sobald jemand einen
 * davon anfasst — dieselbe Bauart wie E110 (zwei Wahrheiten ueber ein Werk)
 * und E111 (zwei Listen derselben Quelle). Hier ist der eine Ort.
 *
 * DER RIEGEL IST DIE AUSNAHME, NICHT DIE AUFZAEHLUNG: Spotify ist die
 * einzige eigene Maschine (librespot bzw. soloist, eigener Prozess, laeuft
 * dauerhaft). Alles andere — lokal, jellyfin, ard, rss, radio, Plugin —
 * laeuft ueber mpv und teilt sich EINE Warteschlange, in der Datei neben
 * Stromadresse steht (nahtlos dank `--prefetch-playlist=yes`). Ein neuer
 * Dienst ist damit im Zweifel mpv, und das ist die richtige Vorgabe: ein
 * faelschlich als mpv gefuehrter Dienst kostet den Wechsel, den es ohnehin
 * gaebe; ein faelschlich als Spotify gefuehrter risse ein Cue-Fenster fuer
 * nichts auf.
 */
export function tonmaschine(dienst: unknown): Tonmaschine {
  return String(dienst ?? '').trim().toLowerCase() === 'spotify' ? 'spotify' : 'mpv'
}

/** Was an EINEM Titeluebergang geschieht. */
export interface Wechselpunkt {
  /** Position (0-basiert) des Titels, der endet. */
  vonPlatz: number
  vonNr: number
  nachNr: number
  vonDienst: string
  nachDienst: string
  vonMaschine: Tonmaschine
  nachMaschine: Tonmaschine
}

/**
 * Ein Titel, wie ihn `titelMischen`/`titelQuellenStempeln` hinterlassen.
 *
 * OFFEN FUER WEITERE FELDER, und das ist keine Nachlaessigkeit: die echte
 * Liste traegt `befehl`, `anhaengen`, `titel`, `interpret`, `quellen`, `uri`
 * und mehr (`titelkarte.ts` gibt `Record<string, unknown>[]` zurueck). Ein
 * geschlossener Typ zwaenge jeden Aufrufer zu einer Umdeutung — und genau
 * die verdeckt spaeter, dass ein Feld gar nicht mehr ankommt.
 */
type GemischterTitel = { nr?: unknown; quelle?: unknown; [feld: string]: unknown }

/**
 * ALLE Uebergaenge, die eine Maschine wechseln — in Abspielreihenfolge.
 *
 * ZWEI ZAEHLUNGEN, UND SIE SIND NICHT DASSELBE: Gegangen wird ueber die
 * POSITION in der Liste, benannt wird ueber die `nr`. Bei einem
 * Halb-Mitschnitt traegt die Liste 01, 02, 06, 08 — der Nachfolger von 02
 * ist dort 06 und nicht 03. Wer hier `nr + 1` rechnet, baut denselben Fehler
 * ein, der als E110/E111 schon zweimal bezahlt wurde (und der als offene
 * Fussnote im E111-Eintrag genau fuer diesen Fall vermerkt ist).
 *
 * Titel OHNE `quelle` werden UEBERSPRUNGEN, nicht geraten: `titelMischen`
 * laesst `quelle` weg, wenn keine Quelle den Titel hat (`quellen` ist dann
 * leer). So ein Titel wird gar nicht gespielt, also ist an ihm auch kein
 * Uebergang — ihn als mpv zu zaehlen erfaende einen Wechsel, den es nicht
 * gibt.
 */
export function wechselpunkte(titel: readonly GemischterTitel[]): Wechselpunkt[] {
  const spielbar = (Array.isArray(titel) ? titel : [])
    .map((t, platz) => ({ t, platz }))
    .filter(({ t }) => String(t?.quelle ?? '') !== '')
  const raus: Wechselpunkt[] = []
  for (let i = 0; i + 1 < spielbar.length; i++) {
    const a = spielbar[i]
    const b = spielbar[i + 1]
    const vonDienst = String(a.t.quelle)
    const nachDienst = String(b.t.quelle)
    const vonMaschine = tonmaschine(vonDienst)
    const nachMaschine = tonmaschine(nachDienst)
    if (vonMaschine === nachMaschine) continue
    raus.push({
      vonPlatz: a.platz,
      vonNr: Number(a.t.nr),
      nachNr: Number(b.t.nr),
      vonDienst,
      nachDienst,
      vonMaschine,
      nachMaschine,
    })
  }
  return raus
}

/**
 * STEHT AM ENDE DIESES TITELS EIN MASCHINENWECHSEL? — die Frage, die der
 * Abspieldienst waehrend der Wiedergabe stellt, um das Cue rechtzeitig zu
 * spannen. `null` heisst: nichts vorzubereiten (letzter Titel, unbekannte
 * Nummer, oder der naechste laeuft auf derselben Maschine).
 *
 * GEFRAGT WIRD MIT DER `nr`, nicht mit der Position: der Abspieldienst kennt
 * seine Warteschlangennummer, und die ist die Identitaet des Titels
 * (titelkarte.ts). Kommt eine Nummer doppelt vor — was bei einem
 * verschmolzenen Werk mit zwei Quellen vorkommen kann —, gilt das ERSTE
 * Vorkommen; die Liste ist die Abspielreihenfolge, und rueckwaerts wird
 * nicht gespielt.
 */
export function wechselNach(titel: readonly GemischterTitel[], nr: number): Wechselpunkt | null {
  if (!Number.isFinite(nr)) return null
  return wechselpunkte(titel).find((w) => w.vonNr === nr) ?? null
}

/** Eine zusammenhaengende Strecke EINER Maschine, ab einem Startpunkt. */
export interface Abschnitt {
  /** Die Titel, die diese Maschine am Stueck spielt (in Reihenfolge). */
  titel: GemischterTitel[]
  /** Die Maschine, die sie spielt. */
  maschine: Tonmaschine
  /** Der Uebergang am Ende — oder `null`, wenn die Strecke bis zum Schluss reicht. */
  uebergabe: Wechselpunkt | null
}

/**
 * DIE STRECKE AB EINEM TITEL — bis die Maschine wechselt.
 *
 * Das Gegenstueck zu `wechselpunkte` fuer den Abspielweg: Der spielt nicht
 * „die Liste", sondern immer nur so weit, wie EINE Maschine traegt. Danach
 * steht eine Uebergabe an, und die braucht ihren Vorlauf (E114, das stumme
 * Fenster).
 *
 * WARUM NICHT EINFACH ALLE LOKALEN TITEL: Weil die Reihenfolge zaehlt. Liegt
 * lokal 1, 2 und 7 vor, ist die Strecke ab 1 genau [1, 2] — die 7 kommt
 * NACH einem Spotify-Stueck und ist eine eigene Strecke. Wer stattdessen
 * alle lokalen in eine mpv-Warteschlange wirft, spielt 1, 2, 7 hintereinander
 * und ueberspringt 3 bis 6 stillschweigend. Das waere derselbe Fehlgriff wie
 * E110, nur andersherum: eine Liste, die nicht die angezeigte ist.
 *
 * `startNr` nicht gefunden -> leere Strecke ohne Uebergabe. Der Aufrufer
 * spielt dann wie bisher; erfunden wird hier nichts.
 */
export function abschnittAb(titel: readonly GemischterTitel[], startNr: number): Abschnitt {
  const leer: Abschnitt = { titel: [], maschine: 'mpv', uebergabe: null }
  if (!Number.isFinite(startNr)) return leer
  const spielbar = (Array.isArray(titel) ? titel : []).filter((t) => String(t?.quelle ?? '') !== '')
  const start = spielbar.findIndex((t) => Number(t?.nr) === startNr)
  if (start < 0) return leer

  const maschine = tonmaschine(spielbar[start].quelle)
  const strecke: GemischterTitel[] = []
  let i = start
  while (i < spielbar.length && tonmaschine(spielbar[i].quelle) === maschine) {
    strecke.push(spielbar[i])
    i++
  }
  const letzte = strecke[strecke.length - 1]
  const uebergabe = i < spielbar.length ? wechselNach(titel, Number(letzte?.nr)) : null
  return { titel: strecke, maschine, uebergabe }
}
