/**
 * Der gemeldete STAND der Oberflaeche — und wie man ein Neuladen anstoesst.
 *
 * HINTERGRUND: der Kiosk-Browser laeuft durch. Von aussen laesst sich kein F5
 * ausloesen, ohne einen Fernwartungs-Port zu oeffnen (den hier niemand offen
 * haben will), und ein Kiosk-Neustart ueber SSH toetet X, ohne ihn wieder
 * hochzubringen. Stattdessen fragt die Oberflaeche selbst
 * `GET /api/oberflaeche/stand` und laedt neu, sobald sich der Wert AENDERT
 * (`sollNeuLaden` in der Box-Oberflaeche).
 *
 * WOFUER DIESES MODUL: bisher aenderte sich der Stand nur, wenn wirklich ein
 * neues Buendel ausgeliefert wurde. Nach einem Testlauf steht die Box aber
 * irgendwo mitten in der Bibliothek herum, und aufraeumen konnte man sie nur
 * von Hand. Ein Zaehler im Stand gibt der Box einen GRUND, neu zu laden, ohne
 * dass ein einziges Byte ausgeliefert werden muss — derselbe, erprobte Weg,
 * nur bewusst ausgeloest.
 *
 * WARUM DAS GEFAHRLOS IST: die Wiedergabe laeuft in librespot bzw. mpv auf der
 * Box, NICHT im Browser. Ein Neuladen zeichnet die Anzeige neu und unterbricht
 * die Musik nicht.
 *
 * REIN: kein Dateisystem, kein Netz, keine Uhr — der Aufrufer reicht herein,
 * was er gemessen hat. Damit ist die Regel pruefbar, ohne einen Server zu
 * starten.
 */

/**
 * Die Kennung, die der Server als `stand` meldet.
 *
 * @param buendel   Dateinamen der ausgelieferten Buendel (tragen einen Hash)
 * @param sekunden  juengste Aenderungszeit in ganzen Sekunden
 * @param zaehler   wie oft ein Neuladen ANGEFORDERT wurde (0 = nie)
 *
 * Der Zaehler wird nur angehaengt, wenn er ueberhaupt gezaehlt hat — sonst
 * aenderte sich die Kennung allein durch die Einfuehrung dieses Feldes, und
 * jede laufende Box haette einmal grundlos neu geladen.
 */
export function standKennung(buendel: readonly string[], sekunden: number, zaehler = 0): string {
  const sek = Number.isFinite(sekunden) ? Math.floor(sekunden) : 0
  const kern = `${[...buendel].sort().join(',')}|${sek}`
  return zaehler > 0 ? `${kern}|r${Math.floor(zaehler)}` : kern
}

/**
 * Kein Stand ist besser als ein falscher.
 *
 * Die Oberflaeche laedt bei einem LEEREN Wert absichtlich NICHT neu — sonst
 * startet ein Serveraussetzer eine Neulade-Schleife, und eine Box, die
 * staendig neu laedt, ist schlimmer als eine, die einen Tag alt ist.
 */
export const KEIN_STAND = ''
