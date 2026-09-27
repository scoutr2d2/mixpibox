import { type CurrentMPlayer, istDateiWiedergabe } from './current.mplayer'
import type { CurrentSpotify } from './current.spotify'
import { cleanTrackTitle } from './utils'

// ── Unified now-playing view-model (MODERNIZATION.md B1) ────────────────────
// One normalized shape for "what is playing right now", derived from either the
// Spotify state (CurrentSpotify) or the local mplayer state (CurrentMPlayer).
// This is the single seam that lets consumers (the now-playing bar, and later
// the player page) drop their own Spotify-vs-local fork. Pure + unit-tested
// (now-playing.spec.ts); the caller supplies the local cover lookup.

export interface NowPlaying {
  title: string
  subtitle: string
  /**
   * Der INTERPRET, getrennt vom Titel — leer, wenn er sich nicht sicher sagen
   * laesst.
   *
   * WOZU er hier steht und nicht beim Aufrufer: `subtitle` traegt das ALBUM,
   * und der Interpret war bis dahin nirgends in dieser Naht. Wer ihn braucht
   * (BACKLOG E84/B2, Songtexte — LRCLIB verlangt `artist_name`), haette ihn
   * sonst je Aufrufer neu aus `path`, `album` und `currentTrackname`
   * zusammengeraten, also drei Kopien derselben Mehrdeutigkeit gebaut.
   *
   * LEER IST EINE ANTWORT, kein Mangel: ein falscher Interpret liefert einen
   * fremden Songtext, und der laeuft dann Wort fuer Wort richtig und zeitlich
   * falsch (llmwiki `lrclib-fuehrt-dieselbe-nummer-vielfach`). Nichts zu
   * zeigen ist besser.
   */
  artist: string
  cover: string | null
  playing: boolean
  elapsed: number // seconds
  duration: number // seconds; 0 = unknown / endless (radio stream)
  progress: number // 0-100
  kind: 'local' | 'spotify'
}

/** A radio/endless stream reports no usable length — suppress the times. */
function usableDuration(sec: number): number {
  return sec > 0 && sec < 86400 ? sec : 0
}

/**
 * Normalize the raw Spotify / local player state into one {@link NowPlaying}.
 * Local (mplayer) takes precedence when it is playing; returns `null` when
 * nothing is playing. `covers` maps `"<artist>|<title>"` → cover URL (the
 * /local channel carries no cover).
 */
export function toNowPlaying(
  sp: CurrentSpotify | null | undefined,
  lo: CurrentMPlayer | null | undefined,
  covers: Map<string, string>,
): NowPlaying | null {
  // ZWEI Maschinennamen meinen dieselbe Sache (mplayer und mpv); `spielerArt`
  // sagt es direkt und ist der Weg, sobald der Abspieldienst es mitschickt.
  if (istDateiWiedergabe(lo) && (lo?.playing || lo?.currentTrackname)) {
    const segs = (lo.path || '').split('/')
    return {
      // Readable: strip the "Artist - " prefix + restore ": ".
      title: cleanTrackTitle(lo.currentTrackname || lo.album || ''),
      subtitle: lo.album || '',
      artist: interpretFuerLokal(lo),
      cover: coverFuerLokal(lo, covers),
      playing: !!lo.playing,
      elapsed: Math.max(0, Number(lo.timePos) || 0),
      duration: usableDuration(Math.max(0, Number(lo.duration) || 0)),
      // Aus elapsed/duration gerechnet statt aus progressTime: letzteres kommt
      // GANZZAHLIG, und ganze Prozent sind bei einem Drei-Minuten-Lied ein
      // Sprung alle ~1,8 s — genau das sichtbare Ruckeln. Ohne brauchbare
      // Dauer bleibt progressTime der Rueckfall.
      progress: (() => {
        const el = Math.max(0, Number(lo.timePos) || 0)
        const du = usableDuration(Math.max(0, Number(lo.duration) || 0))
        if (du > 0) return Math.max(0, Math.min(100, (el / du) * 100))
        return Math.max(0, Math.min(100, Number(lo.progressTime) || 0))
      })(),
      kind: 'local',
    }
  }
  if (sp?.item?.name) {
    const dur = sp.item.duration_ms || 0
    return {
      title: sp.item.name,
      subtitle: sp.item.album?.name || '',
      // Spotify nennt ihn ausdruecklich — hier ist nichts zu raten. Bei
      // mehreren Interpreten der erste: LRCLIB fuehrt Titel unter dem
      // Hauptinterpreten, eine zusammengefuegte Liste ("A, B") trifft dort nie.
      artist: sp.item.artists?.[0]?.name || '',
      cover: sp.item.album?.images?.[0]?.url || null,
      playing: !!sp.is_playing,
      elapsed: (sp.progress_ms || 0) / 1000,
      duration: usableDuration(dur / 1000),
      progress: dur > 0 ? Math.max(0, Math.min(100, ((sp.progress_ms || 0) / dur) * 100)) : 0,
      kind: 'spotify',
    }
  }
  return null
}

// ── Fortschritt zwischen zwei Meldungen weiterzaehlen ───────────────────────
//
// WARUM: der Balken lief sichtbar in Stufen. Die Ursache ist NICHT der Regler
// (der steht auf step="0.1") und auch nicht mehr die Ganzzahligkeit von
// progressTime — sondern der Takt: der Dienst meldet, die Oberflaeche holt im
// Sekundentakt ab, und der 1-Sekunden-CSS-Uebergang ist fertig, bevor der
// naechste Wert da ist. Der Balken gleitet, steht, gleitet, steht.
//
// mpv hat das nicht geloest und konnte es nicht: es MELDET zwar von selbst
// (observe_property statt Nachfragen), aber die Oberflaeche fragt weiterhin
// im Sekundentakt. Wer die Stufen loswerden will, muss zwischen den
// Meldungen selbst weiterzaehlen — dann ist der Abholtakt gleichgueltig.

/** Der letzte gemeldete Stand, mit lokalem Zeitstempel. */
export interface Fortschrittsanker {
  /** Sekunden im Titel, wie zuletzt gemeldet. */
  elapsed: number
  /** Gesamtlaenge in Sekunden. 0 = unbekannt (Radio, endloser Strom). */
  duration: number
  /** Lief die Wiedergabe zum Zeitpunkt der Meldung? */
  playing: boolean
  /** Lokale Uhr (ms) beim Eintreffen der Meldung. */
  stamp: number
}

/**
 * Wie weit ist der Titel JETZT, gerechnet vom letzten Anker aus? Pure.
 *
 * Gibt Prozent (0-100) zurueck, oder `null`, wenn sich nichts sinnvoll
 * rechnen laesst — dann soll der Aufrufer beim gemeldeten Wert bleiben statt
 * eine Zahl zu erfinden (Radio hat keine Laenge; ein fehlender Anker auch
 * keinen Anfang).
 *
 * PAUSE friert ein: ohne diese Regel liefe der Balken im Pausenzustand
 * munter weiter, und das ist schlimmer als eine Stufe.
 */
export function fortschrittJetzt(anker: Fortschrittsanker | null, jetzt: number): number | null {
  if (!anker) return null
  if (!(anker.duration > 0)) return null
  const seither = anker.playing ? Math.max(0, (jetzt - anker.stamp) / 1000) : 0
  const sek = Math.min(anker.duration, Math.max(0, anker.elapsed + seither))
  return Math.max(0, Math.min(100, (sek / anker.duration) * 100))
}

/**
 * Ist der neue Wert ein normales Weiterlaufen — oder ein Sprung? Pure.
 *
 * Beim Weiterlaufen darf weich ueberblendet werden; bei Titelwechsel oder
 * Spulen NICHT, sonst wandert der Balken quer durchs Bild. Rueckwaerts ist
 * immer ein Sprung (Spulen zurueck).
 */
export function laeuftWeiter(vorher: number, nachher: number, spielraum = 5): boolean {
  return nachher >= vorher && nachher - vorher <= spielraum
}

/**
 * Ist das Stueck zu Ende — oder hat es nur kurz gestockt?
 *
 * DER FEHLER, den das behebt (gefunden 2026-07-28): der Player kehrte
 * mitten im Lied von selbst zur Liste zurueck. Die Bedingung dafuer war ein
 * Zaehler, der bei jeder Meldung "spielt nicht" hochgezaehlt und NIE
 * zurueckgesetzt wurde. Solche Meldungen kommen aber auch, wenn nichts zu
 * Ende ist: kurz nach dem Start (Spotify meldet dann noch den alten Stand),
 * beim Titelwechsel, bei einem Netzhaenger. Nach zehn solchen Momenten
 * IRGENDWANN in der Sitzung klappte der Player zu - je laenger gehoert wurde,
 * desto sicherer.
 *
 * Gemeint war "zehnmal HINTEREINANDER". Genau das steht hier: laeuft es
 * wieder, faellt der Zaehler auf null.
 *
 * @param zaehler  bisheriger Stand
 * @param zuEnde   meldet die Quelle GERADE, dass nichts mehr laeuft?
 * @param schwelle so viele Meldungen hintereinander gelten als Ende
 */
export function rueckkehrZaehler(
  zaehler: number,
  zuEnde: boolean,
  schwelle: number,
): { zaehler: number; zurueck: boolean } {
  if (!zuEnde) return { zaehler: 0, zurueck: false }
  const neu = zaehler + 1
  return { zaehler: neu, zurueck: neu > schwelle }
}

/** Platzhalter, wenn es nirgends ein Bild gibt. */
export const KEIN_COVER = '../assets/images/nocover_mupi.png'

/**
 * Welches Cover gehoert JETZT auf die Player-Seite?
 *
 * ZWEI FEHLER, zwischen denen diese Regel steht:
 *
 *   a) Zu frueh das Live-Cover nehmen. Spotify meldet nach dem Umschalten
 *      noch einige Sekunden das VORIGE Stueck (gemessen: 3 bis 5 s, siehe
 *      fortschritt.ts) - dessen Bild darf hier nicht erscheinen.
 *
 *   b) Es NIE nehmen. Genau das passierte (gemeldet 2026-07-28: "das
 *      Albumbild laedt beim Wiederholen manchmal nicht"): die alte Regel
 *      verlangte, dass sich das Live-Cover von dem beim Eintritt
 *      UNTERSCHEIDET. Oeffnet man den Player aber fuer das Album, das GERADE
 *      LAEUFT, ist es dasselbe Bild - die Sperre ging nie wieder auf, und
 *      angezeigt wurde das eigene Cover des Eintrags oder, wenn es keines
 *      gab, der Platzhalter.
 *
 * DIE AUFLOESUNG: die Sperre ist ZEITLICH begrenzt. Solange Spotifys Antwort
 * veraltet sein KANN, gilt der Unterschied als Beweis; danach hat die
 * Wiedergabe fuer dieses Medium laengst begonnen und das Live-Bild gehoert
 * ihr - auch wenn es zufaellig dasselbe ist.
 */
export const COVER_STALE_MS = 6000

export function coverJetzt(a: {
  /** Was gerade wirklich laeuft (Spotify), falls bekannt. */
  liveCover?: string | null
  /** Das Bild, das am Eintrag selbst haengt. */
  eigenesCover?: string | null
  /** Das Live-Bild im Moment des Oeffnens - also das des VORIGEN Stuecks. */
  coverBeiEintritt?: string | null
  /** Hat die Wiedergabe FUER DIESES Medium begonnen? */
  gestartet: boolean
  /** Seit wann laeuft sie (ms seit 1970)? 0 = unbekannt. */
  seit: number
  jetzt: number
  /** Nur fuer Spotify greift die Sperre - andere Quellen melden sofort richtig. */
  istSpotify: boolean
}): string {
  const eigen = a.eigenesCover || KEIN_COVER
  if (!a.liveCover) return eigen
  if (!a.istSpotify) return eigen
  if (!a.gestartet) return eigen

  const nochUnsicher = a.seit > 0 && a.jetzt - a.seit < COVER_STALE_MS
  if (nochUnsicher && a.liveCover === a.coverBeiEintritt) return eigen

  return a.liveCover
}

/**
 * Das Cover fuer die LOKALE Wiedergabe (mpv) finden.
 *
 * DER FEHLER (gemeldet und nachgemessen 2026-07-28, "Kapelle Petra hatte kein
 * Cover im Mini-Player"): der Schluessel wurde aus dem DATEIPFAD gebaut -
 * `segs[1]|segs[2]`. Das passt fuer eine lokale Datei
 * ("audiobook/Interpret/Album"), aber bei Jellyfin meldet der Dienst:
 *
 *     path             (LEER)
 *     album            "Kapelle Petra"      <- der INTERPRET, nicht das Album
 *     currentTrackname "Es war nicht alles schlecht"
 *
 * Gesucht wurde also nach dem Schluessel "|" - der trifft nie. Dabei ENTHIELT
 * die Karte den richtigen Eintrag ("Kapelle Petra|HAMM"), er wurde nur nie
 * gefragt.
 *
 * DESHALB MEHRERE VERSUCHE, vom Genauesten zum Grobsten. Das `album`-Feld
 * wird von den Quellen uneinheitlich befuellt (mal Album, mal Interpret), also
 * wird es gegen BEIDE Haelften des Schluessels probiert, statt eine Bedeutung
 * zu unterstellen.
 */
export function coverFuerLokal(
  lo: { path?: string; album?: string; currentTrackname?: string } | null | undefined,
  covers: Map<string, string>,
): string | null {
  if (!lo || !covers?.size) return null

  // 1. Der Pfad einer lokalen Datei: "kategorie/Interpret/Album".
  const segs = String(lo.path || '').split('/')
  if (segs[1] && segs[2]) {
    const treffer = covers.get(`${segs[1]}|${segs[2]}`)
    if (treffer) return treffer
  }

  const feld = String(lo.album || '').trim()
  if (!feld) return null

  // 2. Das Feld als INTERPRET lesen (so faellt es bei Jellyfin an).
  for (const [schluessel, bild] of covers) {
    if (schluessel.slice(0, schluessel.indexOf('|')) === feld) return bild
  }
  // 3. Das Feld als ALBUM lesen (so faellt es bei lokalen Dateien an).
  for (const [schluessel, bild] of covers) {
    if (schluessel.slice(schluessel.indexOf('|') + 1) === feld) return bild
  }
  return null
}

/**
 * Wer SPIELT das gerade — bei lokaler Wiedergabe und bei Jellyfin?
 *
 * DAS PROBLEM IST DASSELBE WIE BEI {@link coverFuerLokal}: der Abspieldienst
 * befuellt `album` uneinheitlich (mal das Album, mal den Interpreten), `path`
 * ist bei Jellyfin leer, und der Interpret steckt je nach Quelle woanders.
 * Einen Interpreten gibt es in `CurrentMPlayer` NICHT als eigenes Feld.
 *
 * DESHALB MEHRERE VERSUCHE, vom Genauesten zum Grobsten — und einer WENIGER
 * als beim Cover:
 *
 *   1. `path` = "kategorie/Interpret/Album" (lokale Datei). Eindeutig.
 *   2. Der Teil VOR " - " in `currentTrackname`. Genau den schneidet
 *      `cleanTrackTitle` fuer den Titel weg, hier wird er aufgehoben.
 *   3. `album`, WENN 1 und 2 nichts hergaben. Das ist der Jellyfin-Fall, den
 *      `coverFuerLokal` dokumentiert (album "Kapelle Petra" = der Interpret).
 *
 * `album` wird also nur als LETZTES gefragt und nur, wenn die eindeutigen Wege
 * schweigen — bei einer lokalen Datei sind sie es nie, dort greift 1 oder 2.
 *
 * WAS ES BEWUSST NICHT TUT: raten. Gibt es keinen der drei Wege, kommt ein
 * leerer Text zurueck. Fuer den Aufrufer heisst das "unbekannt", nicht
 * "namenlos" — und ein Songtext-Weg fragt dann gar nicht erst nach.
 */
export function interpretFuerLokal(
  lo: { path?: string; album?: string; currentTrackname?: string } | null | undefined,
): string {
  if (!lo) return ''

  // 1. Der Pfad einer lokalen Datei.
  const segs = String(lo.path || '').split('/')
  if (segs.length > 2 && segs[1]?.trim()) return segs[1].trim()

  // 2. Das Praefix des Stuecknamens — dasselbe " - ", das cleanTrackTitle wegnimmt.
  const name = String(lo.currentTrackname || '')
  const schnitt = name.indexOf(' - ')
  if (schnitt > 0) {
    const vorne = name.slice(0, schnitt).trim()
    if (vorne) return vorne
  }

  // 3. Jellyfin legt den Interpreten ins album-Feld.
  return String(lo.album || '').trim()
}

/**
 * Welches Cover gehoert auf die GROSSE Player-Seite?
 *
 * DER FEHLER (gemeldet 2026-07-28: "der Player zeigt nur Symbolbilder, wenn
 * ich gross mache"): die grosse Ansicht setzte ihr Bild an genau zwei Stellen -
 * im Spotify-Zweig und beim Eintritt aus dem eigenen Cover des Eintrags. Fuer
 * Jellyfin und lokale Dateien fragte sie die Cover-Karte NIE. Die kleine
 * Leiste tut das (coverFuerLokal) - deshalb war das Bild unten da und oben
 * weg, sobald man vergroesserte.
 *
 * Verschaerft wird es beim Weg LEISTE -> GROSS: dort laeuft die Wiedergabe
 * schon, der Eintrag wurde nie uebergeben (`media` fehlt), und damit gab es
 * auch kein eigenes Cover - uebrig blieb der Platzhalter.
 *
 * Hier steht die Entscheidung EINMAL, fuer beide Quellen, und beide Ansichten
 * benutzen dieselben Bausteine.
 */
export function coverFuerPlayer(a: {
  istSpotify: boolean
  /** Spotify: was gerade laeuft. */
  liveCover?: string | null
  coverBeiEintritt?: string | null
  gestartet: boolean
  seit: number
  jetzt: number
  /** Lokal/Jellyfin: die Meldung des Wiedergabedienstes. */
  lokal?: { path?: string; album?: string; currentTrackname?: string } | null
  /** Die Karte "Interpret|Titel" -> Bild aus der Bibliothek. */
  covers?: Map<string, string> | null
  /** Das Bild am geoeffneten Eintrag - fehlt, wenn aus der Leiste geoeffnet. */
  eigenesCover?: string | null
  /**
   * Lief die Wiedergabe schon, als die Seite geoeffnet wurde?
   *
   * Dann gibt es KEIN voriges Stueck, vor dem zu schuetzen waere - das
   * laufende IST das gemeinte. Die Sperre gegen veraltete Meldungen wuerde
   * hier genau das richtige Bild zurueckhalten: beim Oeffnen aus der kleinen
   * Leiste ist das "Bild beim Eintritt" dasselbe wie das laufende, also
   * schlug sie immer zu (im Browser gemessen: Leiste zeigt das Cover, grosse
   * Ansicht sechs Sekunden lang den Platzhalter).
   */
  extern?: boolean
}): string {
  // DER PLATZHALTER IST KEIN BILD. Wird der Player aus der kleinen Leiste
  // geoeffnet, baut die Seite ein Ersatz-Medium mit `cover: nocover_mupi.png`.
  // Als "eigenes Cover" genommen, gewinnt es gegen jedes echte - und genau so
  // stand oben der Platzhalter, waehrend unten das Bild hing (am Geraet
  // gemessen: [GROSS] 177px nocover_mupi.png, [LEISTE] 44px das echte).
  const eigen = a.eigenesCover && !a.eigenesCover.includes('nocover') ? a.eigenesCover : ''

  // WAS LAEUFT, entscheidet - nicht, was der Eintrag behauptet. Dasselbe
  // Ersatz-Medium traegt IMMER `type: 'spotify'`, auch waehrend Jellyfin
  // spielt. Meldet der lokale Dienst eine Wiedergabe, ist sie es.
  const lokalLaeuft = !!(a.lokal && (a.lokal.album || a.lokal.currentTrackname))

  if (a.istSpotify && !lokalLaeuft) {
    // Bei schon laufender Wiedergabe gibt es kein voriges Stueck - dann darf
    // das laufende Bild sofort gelten (siehe `extern`).
    if (a.extern && a.liveCover) return a.liveCover
    return coverJetzt({
      liveCover: a.liveCover,
      eigenesCover: eigen,
      coverBeiEintritt: a.coverBeiEintritt,
      gestartet: a.gestartet,
      seit: a.seit,
      jetzt: a.jetzt,
      istSpotify: true,
    })
  }
  // Das eigene Bild des Eintrags zuerst - es ist das genaueste.
  if (eigen) return eigen
  // Sonst dasselbe Nachschlagen wie in der kleinen Leiste.
  const gefunden = coverFuerLokal(a.lokal, a.covers || new Map())
  return gefunden || KEIN_COVER
}


/**
 * Darf eine neu eingetroffene Meldung den angezeigten Wert setzen?
 *
 * DER FEHLER (im Browser gemessen, 2026-07-28): in der GROSSEN Ansicht sprang
 * der Balken zurueck - sechsmal in zwoelf Sekunden -, waehrend die kleine
 * Leiste ruhig lief. Beide bekommen dieselben Meldungen.
 *
 * Der Unterschied: in der grossen Ansicht schrieben ZWEI Stellen denselben
 * Wert. Der Viertelsekunden-Takt rechnet aus dem Anker VORWAERTS, und
 * unmittelbar danach setzte die eintreffende Meldung den ROHEN Wert - der
 * liegt naturgemaess hinter dem hochgerechneten, weil er einen Moment alt ist.
 * Genau das sieht man als Ruckeln. Die kleine Leiste hat immer nur EINEN
 * Schreiber (den Takt) und war deshalb ruhig.
 *
 * DIE REGEL: eine Meldung setzt den Wert nur, wenn er dadurch nicht
 * ZURUECKGEHT - oder wenn es ein echter Sprung ist (Titelwechsel, Spulen),
 * denn dann SOLL der Balken springen.
 *
 * @param angezeigt was gerade steht
 * @param gemeldet  was eben hereinkam
 * @param spielraum bis hierhin gilt eine Ruecknahme als Rundungsrest des
 *                  Hochrechnens, nicht als echter Sprung (in Prozent)
 */
export function meldungUebernehmen(angezeigt: number, gemeldet: number, spielraum = 3): boolean {
  if (!Number.isFinite(gemeldet)) return false
  if (gemeldet >= angezeigt) return true
  // Deutlich zurueck heisst: da ist wirklich etwas passiert (zurueckgespult,
  // neuer Titel). Dann soll der Balken folgen.
  return angezeigt - gemeldet > spielraum
}

// ═══════════════════════════════════════════════════════════════════════════
// EINE Quelle fuer den Fortschritt - fuer BEIDE Leisten
// ═══════════════════════════════════════════════════════════════════════════
//
// DIE FRAGE DES NUTZERS (2026-07-28): "ob man 2 unterschiedliche Leisten
// braucht oder die eine nur skaliert - dann faellt auch die Wartung zweier
// weg". Genau richtig, und es ist zugleich die Ursache des Fehlers:
//
// Die kleine Leiste und die grosse Ansicht rechneten den Fortschritt GETRENNT
// aus denselben Meldungen. Ergebnis, im Browser gemessen: die kleine lief
// ruhig, die grosse sprang sechsmal in zwoelf Sekunden zurueck. Zwei
// Rechnungen sind zwei Verhalten - und zwei Stellen, an denen man dasselbe
// reparieren muss.
//
// Ab hier rechnet DIESE Datei, und beide Ansichten zeigen nur noch an.

/**
 * Wie oft soll weitergerechnet werden?
 *
 * DAS PROBLEM (vom Nutzer beobachtet): "es springt deutlicher bei kurzen
 * Titeln auf der langen Leiste". Der Grund ist Arithmetik: der Balken misst in
 * PROZENT. Bei einem Zwei-Minuten-Titel ist eine Sekunde 0,83 % - bei einem
 * Zehn-Minuten-Titel nur 0,17 %. Ein fester Takt macht also bei kurzen Titeln
 * fuenfmal so grosse Schritte, und genau die sieht man.
 *
 * Deshalb ADAPTIV: der Takt wird so gewaehlt, dass ein Schritt ungefaehr ein
 * Zehntelprozent betraegt - unabhaengig von der Laenge. Nach unten begrenzt,
 * damit ein sehr kurzer Titel die Box nicht mit Neuzeichnen beschaeftigt; nach
 * oben, damit es nie traeger wird als bisher.
 */
export const TAKT_MIN_MS = 60
export const TAKT_MAX_MS = 250

export function taktFuerDauer(dauerSek: number): number {
  if (!Number.isFinite(dauerSek) || dauerSek <= 0) return TAKT_MAX_MS
  // Ein Zehntelprozent der Spieldauer, in Millisekunden.
  const ms = (dauerSek / 1000) * 1000
  return Math.max(TAKT_MIN_MS, Math.min(TAKT_MAX_MS, Math.round(ms)))
}

/**
 * Der naechste anzuzeigende Wert - niemals rueckwaerts, ausser es ist echt.
 *
 * Zwischen zwei Meldungen wird vorwaerts gerechnet; die naechste Meldung ist
 * dann naturgemaess einen Moment ALT und laege darunter. Sie darf den Balken
 * nicht zurueckziehen - ein ECHTER Sprung (Titelwechsel, Zurueckspulen) aber
 * schon, sonst klebt er am alten Titel.
 */
export function naechsterFortschritt(angezeigt: number, gerechnet: number, spielraum = 3): number {
  if (!Number.isFinite(gerechnet)) return angezeigt
  if (gerechnet >= angezeigt) return gerechnet
  return angezeigt - gerechnet > spielraum ? gerechnet : angezeigt
}
