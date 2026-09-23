/**
 * Live-Messungen aus der laufenden Oberflaeche einsammeln.
 *
 * WOFUER: bei "der Player ist langsam" oder "der Flip geht nicht auf" fuehrt
 * Nachdenken ueber den Code schnell in die Irre — hier schon mehrfach. Was
 * hilft, ist ein Mitschnitt WAEHREND jemand normal bedient: was wurde
 * angetippt, und wie lange dauerte es, bis sich etwas zeigte.
 *
 * Bisher ging das nur ueber den DevTools-Port des Kiosk-Browsers. Der verlangt
 * eine geaenderte Startzeile und einen Neustart, und er soll nicht dauerhaft
 * offen stehen. Deshalb schickt die Oberflaeche ihre Messungen stattdessen
 * hierher, und ein Werkzeug liest sie ab.
 *
 * NUR IM ARBEITSSPEICHER, mit Deckel. Messungen sind Wegwerfware: sie
 * beantworten eine Frage von jetzt. Nichts davon gehoert auf die Platte einer
 * Box mit begrenztem Speicher, und ein unbegrenzter Puffer waere ein Leck, das
 * erst nach Tagen auffiele.
 *
 * REIN: kein Netz, keine Uhr, kein Zustand — der Aufrufer haelt den Puffer.
 */

/** Eine einzelne Messung, so wie die Oberflaeche sie meldet. */
export interface Messung {
  /** Fortlaufend, vom Server vergeben — der Abholer merkt sich die letzte. */
  nr?: number
  /** Was angetippt wurde, in Worten ("Kachel", "Titelzeile", "Zurueck"). */
  art: string
  /** Beschriftung des Elements, soweit lesbar. */
  text?: string
  /** Millisekunden bis sich sichtbar etwas tat; null = nichts beobachtet. */
  ms: number | null
  /** Welche Aenderung als Reaktion galt ("Seitenwechsel", "Liste", "Player"). */
  reaktion?: string
  /** Zeitstempel der Oberflaeche (ms seit 1970). */
  zeit?: number
  /**
   * Bei NICHT eingeordneten Elementen: deren echte Klassennamen.
   *
   * So sagt die naechste Messrunde, was in die Erkennungstabelle gehoert,
   * statt dass wieder geraten wird - beim ersten Lauf war "Sonstiges" die
   * haeufigste Art, und ohne diese Namen war nicht herauszufinden, was das
   * ueberhaupt war.
   */
  klassen?: string[]
}

/** Mehr als das braucht niemand — und es begrenzt den Speicher. */
export const PUFFER_MAX = 500

/**
 * Neue Messungen anhaengen und den Puffer begrenzen.
 *
 * @param puffer  bisheriger Inhalt (wird NICHT veraendert)
 * @param neue    was gerade hereinkam
 * @param naechsteNr  die naechste zu vergebende laufende Nummer
 * @returns  neuer Puffer und die dann naechste Nummer
 *
 * Die Nummer wird HIER vergeben, nicht von der Oberflaeche: mehrere Fenster
 * (Kiosk und ein Browser am Schreibtisch) wuerden sonst gleiche Nummern
 * liefern, und der Abholer verlaesst sich darauf, dass sie steigen.
 */
export function anhaengen(
  puffer: readonly Messung[],
  neue: readonly Messung[],
  naechsteNr: number,
): { puffer: Messung[]; naechsteNr: number } {
  let nr = Math.max(1, Math.floor(naechsteNr) || 1)
  const nummeriert = neue.filter(istMessung).map((m) => ({ ...m, nr: nr++ }))
  const zusammen = [...puffer, ...nummeriert]
  // Vorne abschneiden: die aeltesten Messungen sind die uninteressantesten.
  return { puffer: zusammen.slice(Math.max(0, zusammen.length - PUFFER_MAX)), naechsteNr: nr }
}

/**
 * Alles ab einer laufenden Nummer.
 *
 * Der Abholer fragt wiederholt und will nur das NEUE sehen. `ab` ist die
 * letzte Nummer, die er schon hat — geliefert wird alles danach.
 */
export function ab(puffer: readonly Messung[], nr: number): Messung[] {
  const grenze = Number.isFinite(nr) ? nr : 0
  return puffer.filter((m) => (m.nr ?? 0) > grenze)
}

/**
 * Ist das ueberhaupt eine Messung?
 *
 * Der Endpunkt nimmt Fremdes entgegen; was nicht passt, wird verworfen statt
 * gespeichert. Eine kaputte Zeile im Puffer verdirbt sonst jede Auswertung.
 */
export function istMessung(x: unknown): x is Messung {
  if (!x || typeof x !== 'object') return false
  const m = x as Record<string, unknown>
  if (typeof m.art !== 'string' || !m.art.trim()) return false
  if (m.ms !== null && typeof m.ms !== 'number') return false
  if (typeof m.ms === 'number' && (!Number.isFinite(m.ms) || m.ms < 0)) return false
  return true
}

/**
 * Aus mehreren Messungen derselben Art eine REGEL ableiten.
 *
 * AUSWERTEWEG, KEIN ENDPUNKT — festgehalten am 19.09.2026
 * (AUDIT-2026-09-19 Rang 7, das sie als Export ohne Aufrufer gezaehlt hat).
 * Die Box misst (`POST /api/messung`) und legt ab; was aus einer Reihe von
 * Messungen eine Erwartung macht, gehoert an die Auswertung und nicht in
 * eine Antwort, die ein Kind beim Tippen mitrechnet. Sie steht hier und
 * nicht in `tools/`, weil sie dieselben Typen braucht wie das Ablegen — und
 * weil eine Regel, die von einer Kopie im Werkzeug abgeleitet wird, still
 * von der Messung abweichen kann.
 *
 * @returns  Anzahl, Mittelwert (Median), und ein Band, in dem die Werte liegen
 *
 * Der MEDIAN, nicht der Durchschnitt: ein einzelner Ausreisser (ein Titel, der
 * gerade erst geladen wurde) zieht den Durchschnitt weg, waehrend der Median
 * stehen bleibt. Das Band ist der Bereich vom kleinsten bis zum groessten Wert
 * ohne die aeusseren 10 % — damit taugt es als "so ist es normal", ohne dass
 * ein Ausreisser die Grenze aufweicht.
 *
 * Unter DREI Messungen wird KEINE Regel abgeleitet. Aus einem einzelnen Wert
 * eine Erwartung zu machen, hat sich hier schon geraecht — er sah nach einem
 * Befund aus und war der Anlauf.
 */
export function regel(werte: readonly (number | null)[]): {
  anzahl: number
  median: number | null
  von: number | null
  bis: number | null
} | null {
  const z = werte.filter((w): w is number => typeof w === 'number' && Number.isFinite(w)).sort((a, b) => a - b)
  if (z.length < 3) return { anzahl: z.length, median: null, von: null, bis: null }
  const mitte = Math.floor(z.length / 2)
  const median = z.length % 2 ? z[mitte] : Math.round((z[mitte - 1] + z[mitte]) / 2)
  const rand = Math.floor(z.length * 0.1)
  return { anzahl: z.length, median, von: z[rand], bis: z[z.length - 1 - rand] }
}
