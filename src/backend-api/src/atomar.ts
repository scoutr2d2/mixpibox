/**
 * EINE DATEI GANZ ODER GAR NICHT SCHREIBEN.
 *
 * Daneben schreiben, dann umbenennen. Der Leser sieht entweder den alten oder
 * den neuen Stand, nie einen halben.
 *
 * ══ WARUM DAS EIN EIGENES MODUL IST ════════════════════════════════════════
 *
 * In server.ts standen vierzehn Stellen mit genau diesem Muster, davon DREI
 * zeichengleich — und alle drei trugen denselben Kommentar: „Daneben
 * schreiben, dann umbenennen — wie bei darstellung.json." Der Kommentar sagte
 * es selbst: hier wurde abgeschrieben. Dazu fuenf eigene Zaehler fuer einen
 * Zweck.
 *
 * DAS PROBLEM WAR NICHT DIE WIEDERHOLUNG, SONDERN DIE ABWEICHUNG. Die
 * vierzehn Stellen waren NICHT gleich: mal mit Zaehler, mal ohne, mal mit
 * `mode`, mal ohne. Und jede Abweichung ist eine eigene Wettlaufstelle, die
 * niemand einzeln geprueft hat. Zwei Stellen schrieben nach
 * `${ziel}.${process.pid}.tmp` — ohne Zaehler teilen sich zwei gleichzeitige
 * Anfragen DIESELBE Zwischendatei und schreiben sich gegenseitig mitten
 * hinein.
 *
 * ══ DIE DREI DINGE, DIE HIER ZUSAMMENKOMMEN ════════════════════════════════
 *
 * 1. DER ZAEHLER, NICHT NUR DIE PROZESSKENNUNG. Die Begruendung stand schon
 *    bei `darstellungSchreiben` und ist am Geraet gemessen: „zwei Anfragen
 *    gleichzeitig teilten sich sonst dieselbe Zwischendatei und schrieben
 *    sich gegenseitig mitten hinein."
 *
 * 2. UMBENENNEN IM GLEICHEN VERZEICHNIS. Nur dort ist es atomar — ueber eine
 *    Dateisystemgrenze hinweg wird daraus Kopieren und Loeschen, und genau in
 *    der Mitte liegt der halbe Stand. Die Zwischendatei entsteht deshalb
 *    NEBEN dem Ziel und nicht in /tmp.
 *
 * 3. DIE RECHTE AN EINER STELLE. `mode: 0o644` stand mal da und mal nicht.
 *    Eine Datei, die je nach Schreibweg andere Rechte bekommt, faellt erst
 *    auf, wenn sie jemand anders lesen will.
 *
 * ══ WAS ES NICHT LOEST ═════════════════════════════════════════════════════
 *
 * Es macht das Schreiben unteilbar, nicht die ENTSCHEIDUNG. Wer liest,
 * rechnet und zurueckschreibt, braucht daneben weiterhin eine Sperre — sonst
 * gewinnt der letzte Schreiber, und der Erste hat umsonst gerechnet.
 */
import { chmod, rename, rm, writeFile } from 'node:fs/promises'

/**
 * Was an einer Schreibstelle abweichen darf — und sonst nichts.
 *
 * Die beiden Felder sind genau die zwei Unterschiede, an denen die vierzehn
 * Handkopien in server.ts auseinanderliefen. Sie stehen hier als OPTIONEN und
 * nicht als weitere Funktionen, damit eine neue Abweichung sichtbar am
 * Aufrufort steht statt als fuenfzehnte Kopie daneben.
 */
export interface AtomarOptionen {
  /**
   * Die Rechte der fertigen Datei. Vorgabe 0644.
   *
   * SIE WERDEN GESETZT, NICHT GEWUENSCHT: `writeFile({mode})` laesst die
   * umask des Prozesses noch daran nagen — 0664 kommt unter umask 022 als
   * 0644 an. Bei `/etc/mupibox/mupiboxconfig.json` (dietpi:www-data 664) ist
   * genau das der Schaden: nach einem Schreibvorgang ohne `mode` darf die
   * Gruppe nicht mehr schreiben. Deshalb zusaetzlich `chmod`.
   */
  mode?: number
  /**
   * Nur fuer JSON: die Einrueckung. Vorgabe 2.
   *
   * VIER fuer `mupiboxconfig.json` — die Datei liegt seit jeher so auf der
   * Box, und ein Wechsel auf zwei machte aus jedem Schreibvorgang einen Diff
   * ueber die ganze Datei.
   */
  einzug?: number
}

/**
 * Fortlaufend fuer den ganzen Prozess, nicht je Datei.
 *
 * Er muss nur INNERHALB eines Prozesses eindeutig sein; zwischen Prozessen
 * trennt die Prozesskennung. Ein Zaehler je Datei waere die naheliegende
 * Alternative und braeuchte eine Verwaltung, die genau nichts dazugewinnt.
 */
let lauf = 0

/** Nur fuer Tests: den Zaehler zuruecksetzen. */
export function laufZuruecksetzen(): void {
  lauf = 0
}

/** Der Name der Zwischendatei. Rein, damit die Eindeutigkeit pruefbar ist. */
export function zwischenname(ziel: string, pid: number = process.pid): string {
  return `${ziel}.${pid}.${++lauf}.tmp`
}

/**
 * Beliebige Daten unteilbar schreiben — Text oder Bytes.
 *
 * Fuer alles, was KEIN JSON ist: eine Themendatei, ein heruntergeladenes
 * Sprachmodell. Der Inhalt geht unveraendert durch.
 */
export async function atomarSchreiben(ziel: string, daten: string | Uint8Array, o: AtomarOptionen = {}): Promise<void> {
  const tmp = zwischenname(ziel)
  const mode = o.mode ?? 0o644
  try {
    await writeFile(tmp, daten, { mode })
    // `writeFile({mode})` ist ein Wunsch, `chmod` ist die Ansage — siehe
    // AtomarOptionen.mode. Vor dem Umbenennen, damit die Datei unter ihrem
    // richtigen Namen nie kurz falsche Rechte traegt.
    await chmod(tmp, mode)
    await rename(tmp, ziel)
  } catch (fehler) {
    // KEINE LEICHE BEI EINEM FEHLSCHLAG. Bis hierher war das Aufraeumen die
    // Sache des Aufrufers, und genau deshalb fehlte es an den zwei
    // Piper-Stellen: ein abgebrochener Sprechversuch liess seine `.tmp` fuer
    // immer im Vorlese-Speicher liegen — auf dem Wurzel-Dateisystem einer
    // Box mit SD-Karte.
    await rm(tmp, { force: true }).catch(() => undefined)
    throw fehler
  }
}

/**
 * JSON unteilbar schreiben — eingerueckt, wie es die Box ueberall tut.
 *
 * ZWEI LEERZEICHEN EINRUECKUNG sind kein Geschmack: diese Dateien sind
 * ausdruecklich dafuer da, von Hand gelesen und berichtigt zu werden (die
 * Begruendung steht bei `interpretenFile` in server.ts). Eine Zeile JSON
 * kann man nicht von Hand berichtigen.
 *
 * WER VIER BRAUCHT, SAGT ES (`{einzug: 4}`): `mupiboxconfig.json` liegt auf
 * jeder Box mit vier Leerzeichen, und ein stiller Wechsel auf zwei machte aus
 * jedem Schreibvorgang einen Diff ueber die ganze Datei.
 */
export async function jsonAtomarSchreiben(ziel: string, inhalt: unknown, o: AtomarOptionen = {}): Promise<void> {
  await atomarSchreiben(ziel, JSON.stringify(inhalt, null, o.einzug ?? 2), { mode: o.mode })
}
