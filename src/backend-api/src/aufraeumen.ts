/**
 * Aufraeumen — WELCHE verschwundenen Eintraege duerfen zum Entfernen
 * angeboten werden?
 *
 * WOFUER: `verfuegbar.ts` beantwortet die Frage nach EINER Antwort von
 * Spotify („traegt / geloescht / unklar"). Das genuegt, um eine Kachel
 * auszugrauen — ein Ausgrauen nimmt man zurueck, indem man es neu prueft.
 * Ein ENTFERNEN nimmt man nicht zurueck. Bevor die Verwaltung anbietet,
 * etwas wegzuwerfen, braucht es deshalb eine zweite, strengere Huerde:
 *
 *   1. WAR DER LAUF UEBERHAUPT BRAUCHBAR?  (`laufBrauchbar`)
 *      Ein Netzausfall, ein abgelaufener Token oder Spotifys Drosselung
 *      liefern lauter `unklar` — daraus darf nie ein Loeschangebot werden.
 *      Schlimmer noch: liefe etwas bei UNS schief (falsche Durchreiche,
 *      vertauschte Kennungen), kaeme reihenweise `geloescht` zurueck. Ein
 *      Lauf, in dem die halbe Mediathek tot ist, wird deshalb VERWORFEN
 *      statt geglaubt.
 *
 *   2. HAT SICH DAS UEBER ZEIT BESTAETIGT?  (`standFortschreiben` +
 *      `vorschlaegeBilden`)
 *      Eine auf privat gestellte oder regional gesperrte Playlist antwortet
 *      mit Spotifys EIGENEM 404 — formal „geloescht", tatsaechlich vielleicht
 *      morgen wieder da. Angeboten wird deshalb erst, was in mehreren
 *      brauchbaren Laeufen UND ueber mehr als einen Tag hinweg tot blieb.
 *
 * REIN: kein Netz, kein Dateizugriff, keine Uhr. Der Server reicht die
 * Ergebnisse, den bisherigen Stand und `jetzt` herein. So ist die
 * Entscheidung pruefbar, ohne eine Box (und ohne eine tote Playlist) zu
 * haben — und sie liegt nicht hinter einem Netzaufruf im Server.
 *
 * DIE AUFNAHME/ENTNAHME SELBST WIRD NICHT NACHGEBAUT: `standFortschreiben`
 * ruft `fortschreiben` aus verfuegbar.ts auf und haengt nur Zaehler und
 * Zeitpunkt daran. Zwei Fassungen derselben Regel waeren eine Wahrheit zu
 * viel — genau die Fehlerklasse aus [darstellung-feld-faellt-still-heraus].
 */
import { fortschreiben, type Stand } from './verfuegbar'

/** Ein Pruefergebnis, so wie es der Server aus verfuegbar.ts bekommt. */
export interface Ergebnis {
  id: string
  stand: Stand
}

/**
 * Ab welchem Anteil `geloescht` an den EINDEUTIGEN Antworten der Lauf eher
 * gegen uns spricht als gegen Spotify.
 *
 * Begruendung fuer die Haelfte: eine Mediathek, in der von heute auf morgen
 * jeder zweite Spotify-Eintrag verschwunden ist, gibt es nicht. Die
 * realistische Ursache waere dann bei uns — vertauschte Kennungen, eine
 * Durchreiche, die auf einen fremden Auffang faellt, ein Konto ohne Rechte.
 * Ein solcher Lauf darf lieber gar nichts sagen als das Falsche.
 */
export const GELOESCHT_ANTEIL_MAX = 0.5

/**
 * Wie viel Anteil der pruefbaren Eintraege ueberhaupt eindeutig antworten
 * muss, damit der Lauf zaehlt.
 *
 * Bei 429 (Drosselung) faellt der Rest eines Laufes reihenweise auf `unklar`.
 * Die wenigen Antworten davor sind fuer sich genommen richtig, ergeben aber
 * kein Bild — und ein halber Lauf wuerde den Bestaetigungszaehler
 * hochtreiben, ohne etwas geprueft zu haben.
 */
export const EINDEUTIG_ANTEIL_MIN = 0.5

/** So oft muss ein Eintrag in BRAUCHBAREN Laeufen tot gemeldet worden sein. */
export const LAEUFE_NOETIG = 3

/**
 * Und so lange muss das her sein.
 *
 * 24 Stunden, weil ein reiner Laufzaehler sonst in einer Stunde voll waere,
 * wenn jemand dreimal auf „jetzt pruefen" drueckt — und genau die
 * voruebergehende Sperre (privat gestellt, Region) waere damit nicht
 * abgefangen. Bei dem 12-Stunden-Takt der Box heisst das: frueherstens nach
 * 24 h, in der Regel nach 36 h.
 */
export const WARTEZEIT_MS = 24 * 60 * 60 * 1000

/** Was ein Lauf taugt — und, wenn er nichts taugt, warum nicht. */
export interface LaufUrteil {
  brauchbar: boolean
  /** Ein Satz fuer die Verwaltung. Bei `brauchbar` steht hier die Bilanz. */
  grund: string
}

/**
 * Taugt dieser Lauf als Grundlage fuer ein Loeschangebot?
 *
 * Alle drei Bedingungen muessen gelten. Sie sind bewusst in dieser
 * Reihenfolge geprueft, weil der GRUND das ist, was in der Verwaltung steht:
 * „kein Netz" ist eine andere Nachricht als „zu viele auf einmal".
 */
export function laufBrauchbar(ergebnisse: ReadonlyArray<Ergebnis>): LaufUrteil {
  const gesamt = ergebnisse.length
  if (!gesamt) return { brauchbar: false, grund: 'Kein pruefbarer Eintrag in der Mediathek.' }

  const traegt = ergebnisse.filter((e) => e.stand === 'traegt').length
  const geloescht = ergebnisse.filter((e) => e.stand === 'geloescht').length
  const eindeutig = traegt + geloescht

  // 1. OHNE EIN EINZIGES LEBENSZEICHEN ist nicht belegt, dass Netz und Token
  //    in diesem Lauf ueberhaupt funktioniert haben. Ein Lauf, der NUR tote
  //    Eintraege kennt, koennte genauso gut ein Lauf ohne Zugang sein.
  if (traegt === 0) {
    return {
      brauchbar: false,
      grund: 'Kein einziger Eintrag hat geantwortet — vermutlich kein Netz, kein Token oder Spotify drosselt.',
    }
  }

  // 2. ZU WENIG EINDEUTIGES: bei einer Drosselung mitten im Lauf stimmen die
  //    ersten Antworten, das Bild aber nicht.
  if (eindeutig / gesamt < EINDEUTIG_ANTEIL_MIN) {
    return {
      brauchbar: false,
      grund: `Nur ${eindeutig} von ${gesamt} Eintraegen haben eindeutig geantwortet — der Lauf zaehlt nicht.`,
    }
  }

  // 3. ZU VIELE TOTE: dann liegt die Ursache eher bei uns als bei Spotify.
  if (geloescht / eindeutig >= GELOESCHT_ANTEIL_MAX) {
    return {
      brauchbar: false,
      grund: `${geloescht} von ${eindeutig} Eintraegen gelten als geloescht — das ist zu viel auf einmal, der Lauf wird verworfen.`,
    }
  }

  return { brauchbar: true, grund: `${eindeutig} von ${gesamt} eindeutig, davon ${geloescht} geloescht.` }
}

/** Was die Box sich je toter Kennung merkt. */
export interface StandEintrag {
  /** Wann sie das ERSTE Mal tot gemeldet wurde (ms seit 1970). */
  seit: number
  /** In wie vielen BRAUCHBAREN Laeufen sie tot gemeldet wurde. */
  laeufe: number
}

/** Der gemerkte Stand: Kennung -> Zaehler. Landet als JSON auf der Platte. */
export type Verfuegbarkeitsstand = Record<string, StandEintrag>

/**
 * Den gemerkten Stand mit einem Lauf fortschreiben.
 *
 * Wer drin ist, entscheidet `fortschreiben` (verfuegbar.ts): `geloescht`
 * nimmt auf, `traegt` nimmt heraus, `unklar` laesst stehen. Hier kommen nur
 * Zaehler und Zeitpunkt dazu. Ein einziges `traegt` wirft den Eintrag heraus
 * und damit Zaehler UND `seit` weg — ein Eintrag, der zurueckkommt, faengt
 * bei null an.
 *
 * `zaehlen` TRENNT KENNZEICHNEN VON ENTFERNEN, und diese Trennung ist der
 * ganze Sinn dieser Datei (siehe Kopf): Ein Ausgrauen nimmt der naechste Lauf
 * zurueck, ein Loeschen niemand.
 *
 *   zaehlen: true    ein BRAUCHBARER Lauf (`laufBrauchbar`). Die Mitgliedschaft
 *                    wird fortgeschrieben UND der Bestaetigungszaehler steigt.
 *   zaehlen: false   ein VERWORFENER Lauf. Die Mitgliedschaft wird trotzdem
 *                    fortgeschrieben — sie ist die Grundlage fuer die graue
 *                    Kachel, und ein Netzausfall aendert sie ohnehin nicht
 *                    (alles `unklar` laesst den alten Zustand stehen). Der
 *                    Zaehler bleibt dagegen stehen, es kann also NICHTS zum
 *                    Entfernen reifen.
 *
 * HIER STAND EIN `return` IM SERVER, und es kostete die Kennzeichnung mit:
 * bis 2026-08-02 sprang `medienVerfuegbarkeitPruefen` bei einem verworfenen
 * Lauf VOR dieser Funktion heraus, und damit blieb auch `medienGeloescht`
 * unberuehrt. Auf einer Box mit zwei Spotify-Eintraegen, von denen einer
 * verschwindet, ist `geloescht/eindeutig` genau 0,5 — der Lauf wird also
 * IMMER verworfen, und die tote Kachel wird NIE ausgegraut. Genau die
 * Verwechslung „Playlist geloescht" gegen „Box kaputt", gegen die die ganze
 * Pruefung gebaut wurde.
 */
export function standFortschreiben(
  alt: Readonly<Verfuegbarkeitsstand>,
  ergebnisse: ReadonlyArray<Ergebnis>,
  jetzt: number,
  zaehlen = true,
): Verfuegbarkeitsstand {
  const drin = fortschreiben(new Set(Object.keys(alt ?? {})), ergebnisse)
  // Je Lauf hoechstens EINMAL zaehlen: stuende eine Kennung zweimal in der
  // Mediathek, kaeme sie sonst doppelt durch und waere nach zwei statt drei
  // Laeufen reif.
  const totIndiesemLauf = zaehlen
    ? new Set(ergebnisse.filter((e) => e.stand === 'geloescht').map((e) => e.id))
    : new Set<string>()

  const neu: Verfuegbarkeitsstand = {}
  for (const id of drin) {
    const vorher = alt?.[id]
    const seit = vorher && Number.isFinite(vorher.seit) ? vorher.seit : jetzt
    const laeufe = (vorher && Number.isFinite(vorher.laeufe) ? vorher.laeufe : 0) + (totIndiesemLauf.has(id) ? 1 : 0)
    neu[id] = { seit, laeufe }
  }
  return neu
}

/** Ein Eintrag der Mediathek, so wie ihn der Server fuer den Vorschlag zurechtlegt. */
export interface AufraeumKandidat {
  /** Der Schluessel, ueber den entfernt wird (medienSchluessel). */
  schluessel: string
  /** Die Kennung, unter der geprueft wurde (verfuegbar.kennungVon). */
  kennung: string
  titel?: string
  interpret?: string
  cover?: string
  dienst?: string
  art?: string
}

/** Ein Eintrag, den die Verwaltung zum Entfernen anbieten darf. */
export interface Vorschlag extends AufraeumKandidat {
  seit: number
  laeufe: number
  /**
   * Zwei Eintraege der Mediathek tragen denselben Schluessel.
   *
   * `findeIndex` (medien.ts) gibt dann -1 zurueck und das Entfernen greift
   * NICHT — lieber nichts tun als das Falsche. Die Verwaltung muss das sagen,
   * sonst meldet sie „5 entfernt", waehrend zwei noch dastehen.
   */
  doppelt?: true
}

/**
 * Was darf zum Entfernen angeboten werden?
 *
 * NUR was in `stand` steht (also zuletzt eindeutig als geloescht gemeldet
 * wurde), lange genug UND oft genug. Alles andere — `unklar`, `traegt`, nie
 * geprueft, keine Spotify-Kennung — faellt hier heraus und wird gar nicht
 * erst gezeigt.
 *
 * SCHLUESSEL UND KENNUNG SIND NICHT DASSELBE, und das ist kein Detail:
 * `medienSchluessel` nimmt `id` VOR `playlistid`, `kennungVon` umgekehrt. Ein
 * Eintrag mit beiden Feldern wuerde unter der einen Kennung gemeldet und
 * unter der anderen geloescht — es fiele der falsche Eintrag. Deshalb bringt
 * der Kandidat BEIDE mit, und die Verwaltung baut nie selbst einen daraus.
 */
export function vorschlaegeBilden(
  kandidaten: ReadonlyArray<AufraeumKandidat>,
  stand: Readonly<Verfuegbarkeitsstand>,
  jetzt: number,
): Vorschlag[] {
  const wieOft = new Map<string, number>()
  for (const k of kandidaten ?? []) wieOft.set(k.schluessel, (wieOft.get(k.schluessel) ?? 0) + 1)

  const raus: Vorschlag[] = []
  const schonDrin = new Set<string>()
  for (const k of kandidaten ?? []) {
    const s = stand?.[k.kennung]
    if (!s) continue
    if (!(s.laeufe >= LAEUFE_NOETIG)) continue
    if (!(jetzt - s.seit >= WARTEZEIT_MS)) continue
    // Ein doppelter Schluessel ergibt EINE Zeile mit Warnung, nicht zwei
    // gleiche Zeilen — sonst sieht es aus, als seien es zwei Werke.
    if (schonDrin.has(k.schluessel)) continue
    schonDrin.add(k.schluessel)
    const v: Vorschlag = { ...k, seit: s.seit, laeufe: s.laeufe }
    if ((wieOft.get(k.schluessel) ?? 0) > 1) v.doppelt = true
    raus.push(v)
  }
  return raus
}
