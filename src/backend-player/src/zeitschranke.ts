/**
 * EIN VERSPRECHEN ABWARTEN — ABER NICHT LAENGER ALS ERLAUBT.
 *
 * WOZU DAS GEBRAUCHT WIRD (BACKLOG E24/O2, 04.08.2026): `stop()` im
 * Abspieldienst rief `spotifyApi.pause()` und wartete das Versprechen NICHT
 * ab — der Befehl antwortete sofort 200. Die Oberflaeche schickte unmittelbar
 * danach den Startbefehl, und zwei Netzaufrufe rannten um die Wette. Kam die
 * Pause als zweite an, meldete `/player/state` einundzwanzig Sekunden lang
 * `is_playing:false, progress_ms:0`, waehrend librespot spielte
 * (llmwiki weiterhoeren-stop-und-start-im-wettlauf, 3 von 4 Runden).
 *
 * DIE REPARATUR IST „ABWARTEN". WARUM SIE OHNE ZEITSCHRANKE FALSCH WAERE —
 * gemessen am 04.08.2026, tools/pause-zeitschranke-messen.mjs:
 *
 *   http-manager.js der Bibliothek ruft `.timeout()` NIRGENDS auf.
 *   superagent hat ohne diesen Aufruf KEINE eigene Frist; es entscheidet
 *   allein der Kern.
 *
 *     Wirt antwortet sofort (hier im Haus)        5 ms
 *     Wirt nimmt an und SCHWEIGT                  laeuft nach 200 s noch
 *     Adresse geroutet, aber tot — AUF DER BOX    134,8 s  (tcp_syn_retries=6)
 *
 *   Und `stop` geht bei JEDEM Kacheltipp hinaus. Ohne Schranke haette ein
 *   DSL-Ausfall jeden Antipper zwei Minuten lang haengen lassen.
 *
 * DAS HIER IST ALSO KEINE WARTEZEIT, SONDERN EINE OBERGRENZE. Im Alltag
 * kostet sie nichts: der Rundlauf von der Box .169 zu api.spotify.com liegt
 * bei 76 bis 93 ms (fuenf Runden, 04.08.2026).
 *
 * ES WIRD NIE GEWORFEN. Ein geworfener Fehler im Befehlszweig ist eine 500er
 * Antwort statt Ton — dieselbe Begruendung wie in befehlspfad.ts. Der
 * Aufrufer bekommt stattdessen zu lesen, WELCHER der drei Ausgaenge eintrat,
 * und entscheidet selbst.
 */

/** Wie ein abgewartetes Versprechen ausgehen kann. Drei Faelle, keine Luege. */
export type Ausgang<T> =
  | { art: 'fertig'; wert: T }
  | { art: 'gescheitert'; fehler: unknown }
  | { art: 'abgelaufen' }

/**
 * @param versprechen  das abzuwartende Versprechen
 * @param ms           die Obergrenze. `<= 0` heisst „gar nicht warten“ —
 *                     dann kommt sofort `abgelaufen` zurueck, und der
 *                     Aufrufer verhaelt sich wie vor der Reparatur.
 */
export function mitZeitschranke<T>(versprechen: Promise<T>, ms: number): Promise<Ausgang<T>> {
  return new Promise<Ausgang<T>>((fertig) => {
    // WER ZUERST KOMMT, ENTSCHEIDET — und der Zweite darf nichts mehr
    // aendern. Ohne diesen Riegel wuerde eine Pause, die nach Ablauf der
    // Frist doch noch antwortet, ein zweites `fertig()` versuchen. Das ist in
    // JavaScript folgenlos, aber es verschleiert beim Lesen, dass hier ein
    // Wettlauf steht — und um einen Wettlauf geht es in dieser Datei.
    let entschieden = false
    const entscheiden = (a: Ausgang<T>) => {
      if (entschieden) return
      entschieden = true
      clearTimeout(uhr)
      fertig(a)
    }

    const uhr = setTimeout(() => entscheiden({ art: 'abgelaufen' }), Math.max(0, ms))

    // BEIDE HAENDE WERDEN GLEICH ANGELEGT, nicht erst nach dem Rennen: eine
    // Ablehnung, fuer die in DIESEM Augenblick kein Empfaenger bereitsteht,
    // ist eine `unhandledRejection` — und die beendet einen Node-Prozess seit
    // Version 15 mit Exitcode 1.
    //
    // DER ABSPIELDIENST HAT DAFUER EIN AUFFANGNETZ (spotify-control.ts hat ein
    // `process.on('unhandledRejection')`, das nur protokolliert), aber darauf
    // wird hier NICHT gebaut: dieses Modul soll auch dort richtig sein, wo es
    // kein Netz gibt — im Test etwa, oder im naechsten Dienst, der es
    // benutzt. Und ein Netz, das jede Ablehnung schluckt, verbirgt beim
    // Suchen genau das, was man sucht.
    versprechen.then(
      (wert) => entscheiden({ art: 'fertig', wert }),
      (fehler) => entscheiden({ art: 'gescheitert', fehler }),
    )
  })
}
