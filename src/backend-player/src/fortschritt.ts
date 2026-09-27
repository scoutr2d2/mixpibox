/**
 * Fortschritt — Spotifys verspaetete Antwort ausbuegeln.
 *
 * DAS GEMESSENE PROBLEM (am Geraet, 2026-07-28): nach einem Startbefehl
 * meldet Spotifys Wiedergabe-Schnittstelle noch mehrere Sekunden den Stand
 * des VORIGEN Stuecks. Mitgeschrieben:
 *
 *     0,9 s nach dem Start   ->  Position 105.010 ms
 *     5,5 s nach dem Start   ->  Position   1.690 ms   (Ruecksprung 103 s)
 *
 * Die Fortschrittsleiste der Box stand also erst weit hinten und schnellte
 * dann an den Anfang. Bei Jellyfin/mpv tritt das nicht auf - der meldet
 * lokal und sofort (ebenfalls nachgemessen: kein einziger Ruecksprung).
 *
 * DIE REGEL, die das aufloest, ohne zu raten:
 *
 *     EIN STUECK KANN NICHT WEITER SEIN ALS DIE ZEIT,
 *     DIE SEIT DEM STARTBEFEHL VERGANGEN IST.
 *
 * Meldet Spotify mehr, ist die Antwort veraltet - dann gilt die selbst
 * gezaehlte Zeit.
 *
 * BEWUSST NICHT SO GELOEST: die Meldung eine feste Zeit lang verwerfen. Wie
 * lange Spotify braucht, schwankt (hier zwischen 3 und 5 Sekunden gemessen);
 * eine feste Frist waere mal zu kurz und mal zu lang. Die Regel oben braucht
 * keine.
 *
 * REIN: keine Uhr, kein Netz - `jetzt` kommt herein. Sonst liesse sich der
 * Fall "0,9 s nach dem Start" nicht pruefen, ohne 0,9 Sekunden zu warten.
 */

export interface Startpunkt {
  /** Zeitpunkt des Startbefehls (ms seit 1970). 0 = kein Start bekannt. */
  seit: number
  /** Position, an der gestartet wurde (ms). Bei Wiederaufnahme groesser 0. */
  ab: number
}

/** So viel Nachsicht, dass Netz- und Rundungsunschaerfe nicht auffaellt. */
export const TOLERANZ_MS = 2500

/**
 * Den Startpunkt aus dem Abspielbefehl lesen.
 *
 * DIE FORM (beide Oberflaechen bauen sie so — klassisch media-provider.ts /
 * player.service.ts, neu ueber den Server: `startPlan` in spielfunktion.ts):
 *
 *     spotify:<typ>:<kennung>:<titelnummer>:<stelle-in-MILLISEKUNDEN>
 *
 * DIE STELLE IST IN MILLISEKUNDEN, und das ist der ganze Grund, warum diese
 * Funktion hier steht statt als Einzeiler im Verteiler. Dort stand bis
 * 2026-08-02:
 *
 *     ab: abTeil > 0 ? abTeil * 1000 : 0     // Kommentar: "<ab-sekunde>"
 *
 * `playMe()` reicht DASSELBE Glied unveraendert als `position_ms` an Spotify
 * weiter — es waren also zwei Deutungen desselben Feldes im selben Programm.
 * Folge: nach einem Fortsetzen bei 1:32 stand `ab` bei ueber 25 Stunden, und
 * `richtig()` liess von da an JEDE Meldung durch. Die Absicherung gegen
 * Spotifys verspaetete Antworten war damit still abgeschaltet — sichtbar nur
 * als gelegentlich springender Balken, also als etwas, das man dem Netz
 * zuschreibt. Mit „Weiterhoeren" wird das Fortsetzen zum Normalfall; ein
 * Fehler, der nur beim Fortsetzen auftritt, ist dann kein Randfall mehr.
 *
 * REIN und geprueft: hier laesst sich die Einheit festnageln, im Verteiler
 * nicht.
 */
export function startpunktAus(name: string | null | undefined, jetzt: number): Startpunkt {
  const teile = String(name ?? '').split(':')
  const ms = Number.parseInt(teile[teile.length - 1] ?? '', 10)
  return { seit: jetzt, ab: Number.isFinite(ms) && ms > 0 ? ms : 0 }
}

/**
 * Die gemeldete Position richtigstellen, wenn sie unmoeglich ist.
 *
 * @param gemeldet was Spotify sagt (ms)
 * @param start    wann und wo wir gestartet haben
 * @param jetzt    aktuelle Zeit (ms)
 * @returns die Position, die angezeigt werden soll (ms)
 */
export function richtig(gemeldet: number, start: Startpunkt | null, jetzt: number): number {
  if (!Number.isFinite(gemeldet) || gemeldet < 0) return 0
  // Ohne bekannten Start koennen wir nichts pruefen - dann gilt die Meldung.
  // (Nach einem Neustart des Dienstes ist das so; die Leiste darf dann nicht
  // faelschlich auf 0 zurueckfallen.)
  if (!start || !start.seit) return gemeldet

  const vergangen = jetzt - start.seit
  if (vergangen < 0) return gemeldet

  const hoechstens = start.ab + vergangen + TOLERANZ_MS
  if (gemeldet <= hoechstens) return gemeldet

  // Unmoeglich weit - also die Antwort von vorher. Selbst gezaehlt weiter.
  return start.ab + vergangen
}

/** War die Meldung veraltet? Fuer Protokoll und Tests. */
export function veraltet(gemeldet: number, start: Startpunkt | null, jetzt: number): boolean {
  return richtig(gemeldet, start, jetzt) !== gemeldet
}

/**
 * Spielt es WIRKLICH nicht - oder ist die Meldung nur veraltet?
 *
 * DAS GEMESSENE PROBLEM (2026-07-28): der Abspiel-Knopf sprang kurz nach dem
 * Start auf "abspielen zurueck, obwohl gespielt wurde. Mitgeschrieben:
 *
 *     0,2 s nach dem Start  ->  is_playing: false
 *     1,4 s nach dem Start  ->  is_playing: true
 *
 * Es ist derselbe Nachlauf wie bei der Position (siehe `richtig`): Spotifys
 * Wiedergabe-Schnittstelle hat den Startbefehl noch nicht verarbeitet.
 *
 * DIE REGEL: haben WIR gerade Wiedergabe befohlen und seither weder Pause noch
 * Stopp, dann ist ein gemeldetes "spielt nicht" innerhalb der Nachlaufzeit
 * unglaubwuerdig - es wird gespielt.
 *
 * WICHTIG: der Aufrufer MUSS den Startpunkt bei Pause und Stopp loeschen
 * (`seit: 0`). Sonst wuerde eine echte Pause kurz nach dem Start verschluckt,
 * und ein Knopf, der eine gedrueckte Pause ignoriert, ist schlimmer als einer,
 * der kurz flackert.
 */
export function spieltWirklich(gemeldet: boolean, start: Startpunkt | null, jetzt: number): boolean {
  if (gemeldet) return true
  if (!start || !start.seit) return false
  const vergangen = jetzt - start.seit
  if (vergangen < 0 || vergangen > TOLERANZ_MS) return false
  return true
}

/**
 * Ist die GANZE Antwort von Spotify noch die von vorher?
 *
 * DAS MUSTER (systematisch gemessen, 2026-07-28): nach einem Startbefehl
 * hinkt nicht ein Feld hinterher, sondern die vollstaendige Antwort. Beim
 * Wechsel auf ein anderes Album meldete sie 0,2 s lang:
 *
 *     Titel    "Guck mal diese Biene da Summ Summ"  (das VORIGE Stueck)
 *     Dauer    176229 ms                            (die vorige Dauer)
 *     Kontext  die vorige Playlist
 *
 * Wer das je Feld ausbessert, behandelt Symptome und wird bei jedem neuen
 * Feld erneut ueberrascht. Der VERLAESSLICHE Beweis steht in der Antwort
 * selbst: wir wissen, WAS wir befohlen haben. Meldet Spotify einen anderen
 * Kontext, ist die Antwort von vorher - unabhaengig davon, welches Feld man
 * gerade ansieht.
 *
 * @param gemeldeteUri was Spotify als laufenden Kontext nennt
 * @param befohleneId  was wir gestartet haben (z. B. "spotify:playlist:…:1:0")
 */
export function zustandVeraltet(
  gemeldeteUri: string | null | undefined,
  befohleneId: string | null | undefined,
  start: Startpunkt | null,
  jetzt: number,
): boolean {
  if (!start || !start.seit) return false
  const vergangen = jetzt - start.seit
  // Nach der Nachlaufzeit ist nichts mehr "veraltet" - dann stimmt es einfach
  // nicht ueberein, etwa weil jemand am Handy etwas anderes gestartet hat.
  if (vergangen < 0 || vergangen > TOLERANZ_MS) return false

  const gemeldet = String(gemeldeteUri || '')
  const befohlen = String(befohleneId || '')
  if (!gemeldet || !befohlen) return false

  // Die befohlene Kennung traegt hinten noch Titel- und Startangaben
  // ("spotify:playlist:XYZ:1:0"), die in der gemeldeten URI nicht stehen.
  // Verglichen wird deshalb der gemeinsame Anfang.
  const kern = befohlen.split(':').slice(0, 3).join(':')
  if (!kern) return false
  return !gemeldet.startsWith(kern)
}
