/**
 * Eine Lautstaerke-Stufe weiter — die Rechnung hinter den +/- Tasten.
 *
 * ══ WOZU EINE EIGENE DATEI FUER FUENF ZEILEN ═══════════════════════════════
 *
 * Damit sie geprueft werden kann. Die Rechnung stand bis zum 05.09.2026
 * INNERHALB von `setVolume()` in spotify-control.ts, zwischen zwei
 * `exec()`-Aufrufen — und diese Datei laesst sich nicht importieren, ohne
 * einen Express-Server, eine Spotify-Anmeldung und einen DNS-Aufruf
 * loszutreten. Eine falsche Klammer dort war deshalb nur am Geraet zu
 * merken, und genau so ist der Fehler unten auch gefunden worden: vom
 * Betreiber, mit dem Ohr.
 *
 * ══ DER FEHLER, DEN DIESE DATEI FESTNAGELT (05.09.2026) ════════════════════
 *
 * Betreiber: „die knoepfe volumen in dem grossen player und auch im
 * titelbild [gehen] nicht bis 100 prozent ... nur bis ca 50, der
 * schieberegler vom miniplayer geht bis 100."
 *
 * Gemessen an der Box: `mupibox.maxVolume` stand auf 55 — das „ca 50".
 *
 * ES GAB ZWEI GRENZEN FUER DIESELBE SACHE. Seit die Ton-Serie
 * `mupi-lautstaerke.sh` eingefuehrt hat, IST die Nutzerskala 0..100 die
 * ganze Miete: das Werkzeug bildet sie selbst auf 0..maxVolume der Karte ab
 * („VORHER war die Grenze ein ZAUN", steht dort im Kasten). Der absolute Weg
 * des Schiebers (`setvolume:<v>`) wurde darauf umgestellt und klemmt nur
 * noch bei 100 — die Oberflaeche ebenso (`grenzeAus` in NewDesign/app.js:
 * „NICHT MEHR AUF maxVolume KLEMMEN"). Der RELATIVE Weg der Tasten blieb
 * zurueck und verglich weiter gegen `maxVolume`:
 *
 *     if (currentMeta.volume < muPiBoxConfig.mupibox.maxVolume) { ...+5 }
 *     else { currentMeta.volume = maxVolume }
 *
 * Beide Seiten dieses Vergleichs sprechen ABER VERSCHIEDENE SKALEN:
 * `currentMeta.volume` ist die Nutzerskala (0..100), `maxVolume` die der
 * Karte. Bei maxVolume 55 hoerten die Tasten also bei 55 der Nutzerskala auf
 * — und das Werkzeug machte daraus 55 % von 55, also 30 % der Karte. Zwei
 * Deckel uebereinander, und das Kind kam nie an das erlaubte Maximum.
 *
 * MERKSATZ: Wo zwei Wege dieselbe Groesse stellen, muessen sie dieselbe
 * Skala sprechen — und die Grenze gehoert an GENAU EINE Stelle. Hier ist es
 * `mupi-lautstaerke.sh`; alles davor rechnet in 0..100.
 */

/** Die Schrittweite der +/- Tasten in der Nutzerskala. */
export const LAUTSTAERKE_SCHRITT = 5

/**
 * Der naechste Wert in der NUTZERSKALA (0..100).
 *
 * KEIN `maxVolume` HIER, und das ist die ganze Behebung: die Grenze der
 * Karte steckt in `mupi-lautstaerke.sh`. Wer sie hier noch einmal zieht,
 * deckelt zweimal — siehe der Kasten oben.
 *
 * `jetzt` kommt aus `currentMeta.volume` und ist im Zweifel Unsinn (null,
 * undefined, ein String aus einer alten Konfiguration). Deshalb wird es hier
 * geprueft und nicht beim Aufrufer: eine Rechnung, die bei fehlender Eingabe
 * NaN zurueckgibt, macht aus einem stummen Lautsprecher einen kaputten.
 */
export function naechsteStufe(jetzt: unknown, richtung: number, schritt = LAUTSTAERKE_SCHRITT): number {
  const alt = Number(jetzt)
  const stand = Number.isFinite(alt) ? alt : 0
  const ziel = stand + (richtung >= 0 ? schritt : -schritt)
  return Math.max(0, Math.min(100, Math.round(ziel)))
}
