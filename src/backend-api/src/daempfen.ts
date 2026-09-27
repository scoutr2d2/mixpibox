/**
 * Die Musik leiser drehen, waehrend vorgelesen wird.
 *
 * WOFUER: beim Vorlesen lief die Musik bisher in voller Lautstaerke weiter, und
 * das Kind hoerte beides zugleich. Anhalten waere die grobe Loesung - der Titel
 * bricht ab und muss danach wieder anlaufen (was auf dieser Box Sekunden
 * dauert, siehe mupi-knopf-schnell-ton-langsam). Leiser drehen stoert nicht.
 *
 * WICHTIG - NICHT ALLES DAEMPFEN: die Sprache selbst kommt aus dem
 * Kiosk-Browser und laeuft ueber denselben Tonserver. Wer stumpf alle Stroeme
 * absenkt, macht die Ansage genauso leise wie die Musik und erreicht nichts.
 * Gedaempft wird nur, was NICHT die Sprache ist.
 *
 * REIN: kein Kindprozess, kein Netz. Der Aufrufer reicht die Ausgabe von
 * `pactl list sink-inputs` herein und fuehrt die berechneten Befehle aus.
 */

/** Ein Tonstrom, wie ihn pactl auflistet. */
export interface Strom {
  /** Die Nummer aus "Sink Input #69". */
  id: number
  /** application.name, etwa "PipeWire ALSA [librespot]" oder "Chromium". */
  name: string
  /** Lautstaerke in Prozent, aus der ersten Kanalangabe. */
  prozent: number
}

/**
 * Auf so viel Prozent wird abgesenkt.
 *
 * Nicht auf null: das Kind soll merken, dass die Musik weiterlaeuft und nur
 * kurz zurueckgetreten ist. Ganz still wirkt wie ein Abbruch.
 *
 * ANGEHOBEN von 20 auf 45: zusammen mit einer Sprache, die (fehlerhaft) mit
 * voller Lautstaerke lief, ergaben 20 % einen brutalen Sprung - leise Musik,
 * bruellende Ansage. Da die Sprache jetzt der Box-Lautstaerke folgt, genuegt
 * ein sanftes Zuruecktreten.
 */
export const LEISE_PROZENT = 45

/** Woran die Sprachausgabe zu erkennen ist - sie darf NICHT gedaempft werden. */
const SPRACHE = /chromium|chrome|firefox|browser|speech|piper/i

/**
 * Die Ausgabe von `pactl list sink-inputs` lesen.
 *
 * Bewusst zeilenweise und tolerant: das Format hat je nach PipeWire-Fassung
 * mehr oder weniger Felder, und ein fehlendes darf nicht den ganzen Eintrag
 * verwerfen.
 */
export function stroemeLesen(text: string): Strom[] {
  const raus: Strom[] = []
  let jetzt: Strom | null = null
  for (const zeile of String(text || '').split('\n')) {
    const kopf = /^Sink Input #(\d+)/.exec(zeile.trim())
    if (kopf) {
      if (jetzt) raus.push(jetzt)
      jetzt = { id: Number(kopf[1]), name: '', prozent: 100 }
      continue
    }
    if (!jetzt) continue
    const name = /application\.name\s*=\s*"(.*)"/.exec(zeile)
    if (name) jetzt.name = name[1]
    // "Volume: front-left: 65536 / 100% / 0.00 dB, ..." - der ERSTE Kanal
    // genuegt; unterschiedlich laute Kanaele sind hier kein Thema.
    const laut = /Volume:.*?\/\s*(\d+)%/.exec(zeile)
    if (laut) jetzt.prozent = Number(laut[1])
  }
  if (jetzt) raus.push(jetzt)
  return raus
}

/**
 * Welche Stroeme werden gedaempft?
 *
 * Alles ausser der Sprachausgabe - und nur, was ueberhaupt lauter ist als das
 * Ziel. Einen bereits leisen Strom anzufassen hiesse, seine Lautstaerke beim
 * Wiederherstellen falsch zu setzen.
 */
export function zuDaempfen(stroeme: readonly Strom[], ziel = LEISE_PROZENT): Strom[] {
  // NUR ECHTE ANWENDUNGEN (05.09.2026): die Verbindungs-Stroeme der Tonkette
  // (klangwerk.ausgang, entzerrer.ausgang) sind auch sink-inputs — aber OHNE
  // application.name. Wer sie daempft, senkt die ganze Kette statt einer
  // Quelle, und beim Wiederherstellen stuende die Kette womoeglich schief.
  // Dieselbe Regel lebt schon in quellenAusPactlJson (ton.ts): kein Name,
  // keine Quelle.
  return stroeme.filter((s) => s.name !== '' && !istSprache(s.name) && s.prozent > ziel)
}

/**
 * Ist das die Sprachausgabe?
 *
 * Einzeln herausgezogen, damit die Regel an einer Stelle steht und geprueft
 * werden kann - sie ist der Kern des Ganzen.
 *
 * VERDRAHTET AM 19.09.2026 (AUDIT-2026-09-19 Rang 7). Das Audit fuehrte diese
 * Funktion auf der Loeschliste ("einziger Baum-Treffer ist die Definition").
 * Das war richtig gezaehlt und falsch geschlossen: `zuDaempfen` daneben
 * prueste dieselbe Regel mit `SPRACHE.test(...)` von Hand. Wer die benannte,
 * getestete Fassung loescht, behaelt die Regel — nur als ungetestete Kopie
 * eine Zeile hoeher. Also andersherum: `zuDaempfen` ruft sie jetzt.
 */
export function istSprache(name: string): boolean {
  return SPRACHE.test(String(name || ''))
}
