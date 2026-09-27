/**
 * Was auf den Funkschaltern steht — und wann gar keiner dasteht.
 *
 * DIE REGEL SELBST STEHT IM BACKEND (/api/funk, funk.ts). Hier wird sie nicht
 * nachgerechnet, sondern nur ANGEZEIGT: `ausErlaubt` kommt fertig herein.
 * Diese Datei entscheidet nur, ob ein Knopf ueberhaupt erscheint und welcher
 * Satz danebensteht.
 *
 * WARUM DAS EINE EIGENE, REINE DATEI IST: der Satz in der Rueckfrage ist der
 * wichtigste Text der ganzen Seite. Er muss die ANDERE Adresse nennen — sonst
 * klickt jemand „ja" und sucht danach eine Box, von der er nicht weiss, wo
 * sie hin ist. So laesst er sich pruefen, ohne die Seite zu starten.
 */
import type { Funklage } from './netzwerk.dienst'

/** Was die Oberflaeche beim WLAN- und Flugschalter anbieten darf. */
export interface Knopflage {
  /** Steht ein Schalter da? Ein Knopf, der 409 kassiert, ist schlechter als keiner. */
  knopf: boolean
  /** Der Satz daneben — der Grund, wenn kein Knopf dasteht. */
  satz: string
  /** Muss `vorOrt: true` mitgeschickt werden? Nur auf dem Schirm der Box. */
  vorOrt: boolean
}

/**
 * Darf hier ein Ausschalter stehen?
 *
 * Drei Faelle, genau die des Backends:
 *   * zweiter Weg da        -> Knopf, mit Rueckfrage, die die Adresse nennt
 *   * diese Seite auf der Box -> Knopf, aber ausdruecklich „vor Ort"
 *   * sonst                 -> KEIN Knopf, sondern der Satz, warum
 */
export function knopflage(l: Funklage | null): Knopflage {
  if (!l) return { knopf: false, satz: 'Der Funkzustand wird gelesen …', vorOrt: false }
  if (!l.wlan.vorhanden) {
    return { knopf: false, satz: 'Diese Box hat keine WLAN-Schnittstelle.', vorOrt: false }
  }
  if (l.ausErlaubt) return { knopf: true, satz: l.grund, vorOrt: false }
  if (l.vonDerBox) {
    return {
      knopf: true,
      satz: 'Kein zweiter Weg zur Box. Am Bildschirm der Box geht es trotzdem — wieder einschalten dann aber auch nur dort.',
      vorOrt: true,
    }
  }
  return {
    knopf: false,
    satz: `${l.grund} Das geht nur an der Box selbst — oder mit einem Netzwerkkabel.`,
    vorOrt: false,
  }
}

/**
 * Der Satz in der Rueckfrage.
 *
 * ZWEI DINGE MUESSEN DARIN STEHEN, und das zweite wird gern vergessen:
 *   1. unter welcher ANDEREN Adresse die Box danach erreichbar ist,
 *   2. dass die EIGENE Sitzung trotzdem abreisst, wenn man ueber WLAN
 *      verbunden ist. „Die Box bleibt erreichbar" allein liest sich wie
 *      „es passiert nichts" — und dann steht der Benutzer vor einer toten
 *      Seite und haelt es fuer einen Fehler.
 */
export function rueckfrage(l: Funklage, was: 'WLAN' | 'Flugmodus'): string {
  const tat = was === 'WLAN' ? 'Das WLAN wirklich abschalten?' : 'Wirklich in den Flugmodus?'
  const dazu = was === 'Flugmodus' ? ' Bluetooth geht mit aus — der Lautsprecher wird dabei getrennt.' : ''
  if (l.zweiterWeg?.adresse) {
    return `${tat} Die Box bleibt über ${l.zweiterWeg.adresse} (${l.zweiterWeg.name}, Kabel) erreichbar. Wer diese Seite gerade über WLAN bedient, verliert sie trotzdem und muss unter der anderen Adresse weitermachen.${dazu}`
  }
  return `${tat} Es gibt keinen zweiten Weg zu dieser Box — danach ist sie nur noch am Gerät selbst erreichbar.${dazu}`
}

/** Eine Zeile je Anschluss fuer die Uebersicht: Adresse, Kabel, Zustand. */
export function wegText(w: { adresse: string; kabel: boolean | null; zustand: string }): string {
  const teile: string[] = []
  teile.push(w.adresse ? w.adresse : 'keine Adresse')
  // „unbekannt" ist eine eigene Aussage: bei einer heruntergefahrenen
  // Schnittstelle liefert der Kernel gar nichts. Das als „kein Kabel" zu
  // zeigen waere eine Behauptung.
  if (w.kabel === true) teile.push('Kabel steckt')
  else if (w.kabel === false) teile.push('kein Kabel')
  if (w.zustand) teile.push(w.zustand)
  return teile.join(' · ')
}
