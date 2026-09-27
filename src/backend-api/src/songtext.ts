/**
 * Songtexte: LRC zerlegen, die RICHTIGE Fassung waehlen, die Zeile zur Zeit
 * finden. Rein — keine Netzaufrufe, kein Dateizugriff, kein Zustand.
 *
 * WOZU (BACKLOG E84/B2): der Kern soll Songtexte ausliefern, die Quelle darf
 * spaeter ein Plugin sein. Was hier steht, ist der Teil, der bei JEDER Quelle
 * gleich bleibt — und der Teil, an dem man sich ohne diese Datei die Finger
 * verbrennt.
 *
 * ══ DIE FALLE, DIE DIESES MODUL TRAEGT ═══════════════════════════════════
 *
 * LRCLIB ist nutzerbefuellt und fuehrt dieselbe Nummer VIELFACH — Studio,
 * Single-Edit, Live, Bearbeitung. Jede Fassung ist fuer sich richtig und
 * traegt korrekte Zeitmarken. Gemessen am 05.09.2026 mit
 * `tools/songtext-quellen-probe.py` (je 20 Treffer):
 *
 *     Queen - Bohemian Rhapsody     14 Dauern   263-415 s   Spanne 152 s
 *     Radiohead - Creep             12 Dauern   236-311 s   Spanne  75 s
 *     Nena - 99 Luftballons         10 Dauern   229-284 s   Spanne  55 s
 *
 * WER DEN ERSTEN TREFFER NIMMT, bekommt mit hoher Wahrscheinlichkeit die
 * Zeitmarken einer fremden Aufnahme. Der Text stimmt dann Wort fuer Wort und
 * laeuft trotzdem um bis zu zweieinhalb Minuten versetzt — der schlimmste
 * Fehlerfall, weil er wie ein Fehler der eigenen Zeitbasis aussieht und man
 * dort dann auch sucht.
 *
 * UND DIE SCHNITTSTELLE NIMMT EINEM DAS NICHT AB (ebenfalls gemessen):
 *
 *     duration=239 (richtig)  -> 200      album falsch  -> 404
 *     duration=30  (absurd)   -> 200 (!)  track erfunden -> 404
 *     duration=600 (absurd)   -> 404
 *
 * Das ALBUM riegelt ab, die DAUER waehlt nur unter den Dubletten aus und weist
 * nicht zuverlaessig zurueck. Wer sich auf einen 404 verlaesst, bekommt still
 * die falsche Fassung statt einer Fehlermeldung. Deshalb gleicht
 * {@link fassungWaehlen} SELBST ab, statt der Antwort zu glauben.
 *
 * llmwiki: `lrclib-fuehrt-dieselbe-nummer-vielfach`
 */

/** Eine Zeile mit Zeitmarke. */
export interface Songzeile {
  /** Millisekunden ab Stueckbeginn. */
  zeitMs: number
  text: string
}

/** Was eine Quelle je Fassung anbietet. */
export interface Fassung {
  /** Laenge dieser Fassung in Sekunden. 0/fehlend = unbekannt. */
  dauerSek?: number
  /** LRC-Text mit Zeitmarken, wenn vorhanden. */
  synchron?: string | null
  /** Reiner Text ohne Zeitmarken. */
  einfach?: string | null
  /** Die Quelle sagt: hier gibt es nichts zu singen. */
  instrumental?: boolean
}

/**
 * Wie weit darf die Dauer abweichen, damit es noch DIESELBE Aufnahme ist?
 *
 * FUENF SEKUNDEN, und die Zahl ist gemessen begruendet: verschiedene Fassungen
 * desselben Stuecks liegen zehnfach weiter auseinander (55 bis 152 s Spanne,
 * siehe Kopf), waehrend dieselbe Aufnahme sich je nach Auszeichnung um ein bis
 * zwei Sekunden unterscheidet — bei „Creep" liegen 236,0 / 236,2 / 239,0
 * nebeneinander und sind alle die Studiofassung.
 *
 * Fuenf Sekunden trennen also die FASSUNGEN sicher und tolerieren die
 * Ungenauigkeit der eigenen Angabe. Enger waere Scheingenauigkeit, weiter
 * liesse den Live-Mitschnitt herein.
 */
export const DAUER_SPIELRAUM_S = 5

/**
 * Mehr Zeilen nimmt niemand entgegen.
 *
 * Dieselbe Begruendung wie beim FOLGEN_DECKEL des Plugin-Vertrags: das ist
 * eine Anzeige, kein Katalog. Ein Text mit 2000 Zeilen ist keine Nummer,
 * sondern ein Fehler in der Quelle.
 */
export const ZEILEN_DECKEL = 600

/** Warum es nichts anzuzeigen gibt — fuer das Journal, nicht fuer das Kind. */
export type KeinTextGrund =
  | 'instrumental'
  | 'keine-dauer'
  | 'keine-fassung'
  | 'dauer-passt-nicht'
  | 'ohne-zeitmarken'

export interface Songtext {
  zeilen: Songzeile[]
  /** Die Dauer der gewaehlten Fassung — zum Nachvollziehen im Journal. */
  fassungDauerSek: number
}

/**
 * Eine LRC-Zeichenkette in Zeilen zerlegen. Rein.
 *
 * WAS ES WEGWIRFT UND WARUM:
 *  * Kopfzeilen wie `[ar:…]`, `[ti:…]`, `[length:…]` — sie sehen aus wie
 *    Zeitmarken, sind aber Angaben ueber das Stueck. Ohne diese Pruefung
 *    stuenden sie als Text bei Sekunde 0 auf dem Schirm.
 *  * Zeilen ohne jede Zeitmarke. Sie koennen nicht eingeordnet werden.
 *
 * WAS ES BEHAELT: leere Texte MIT Zeitmarke. Das sind die Pausen zwischen den
 * Strophen, und sie sind der Grund, warum die Anzeige zwischendurch leer wird,
 * statt die letzte Zeile stehen zu lassen.
 *
 * MEHRERE MARKEN AN EINER ZEILE (`[00:12.00][01:30.00]Text`) sind im Format
 * ueblich fuer Refrains — daraus werden mehrere Zeilen, nicht eine.
 */
export function lrcZerlegen(lrc: string | null | undefined): Songzeile[] {
  if (!lrc || typeof lrc !== 'string') return []
  const zeilen: Songzeile[] = []

  for (const roh of lrc.split(/\r?\n/)) {
    // Alle fuehrenden Marken einsammeln: [mm:ss] oder [mm:ss.xx] / [mm:ss:xx].
    const marken: number[] = []
    let rest = roh
    for (;;) {
      const treffer = /^\s*\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/.exec(rest)
      if (!treffer) break
      const min = Number(treffer[1])
      const sek = Number(treffer[2])
      // Hundertstel sind der Normalfall, Tausendstel kommen vor. Die LAENGE
      // entscheidet, nicht die Zahl: "5" heisst 50 Hundertstel, nicht 5 ms.
      const bruchteil = treffer[3] ?? ''
      const bruch =
        bruchteil === ''
          ? 0
          : bruchteil.length === 3
            ? Number(bruchteil)
            : Number(bruchteil.padEnd(2, '0')) * 10
      marken.push(min * 60_000 + sek * 1000 + bruch)
      rest = rest.slice(treffer[0].length)
    }
    if (!marken.length) continue

    const text = rest.trim()
    for (const zeitMs of marken) {
      if (Number.isFinite(zeitMs) && zeitMs >= 0) zeilen.push({ zeitMs, text })
    }
  }

  zeilen.sort((a, b) => a.zeitMs - b.zeitMs)
  return zeilen.slice(0, ZEILEN_DECKEL)
}

/**
 * WELCHE Fassung gehoert zu dem, was gerade laeuft? Rein.
 *
 * Das ist die Stelle, an der die Falle aus dem Dateikopf abgefangen wird.
 * Die Regeln, in dieser Reihenfolge:
 *
 *  1. OHNE EIGENE DAUER wird NICHT gewaehlt. Ein Radio-Strom oder ein Stueck
 *     ohne Laengenangabe laesst sich nicht zuordnen — und genau dort waere der
 *     erste Treffer besonders verlockend und besonders falsch.
 *  2. Es gewinnt die Fassung mit der GERINGSTEN Abweichung, nicht die erste.
 *  3. Liegt auch die beste weiter als {@link DAUER_SPIELRAUM_S} daneben,
 *     kommt NICHTS zurueck. Leer ist die richtige Antwort: B2 verlangt sie fuer
 *     Hoerspiele ohnehin, und ein versetzter Text ist schlimmer als keiner.
 *  4. `instrumental` ist ein ERGEBNIS, kein Fehlschlag — hier gibt es nichts
 *     zu singen, und das ist eine Auskunft.
 *
 * @param treffer  was die Quelle anbietet
 * @param dauerSek Laenge dessen, was WIRKLICH laeuft
 */
export function fassungWaehlen(
  treffer: readonly Fassung[] | null | undefined,
  dauerSek: number,
): { text: Songtext } | { grund: KeinTextGrund } {
  if (!Array.isArray(treffer) || treffer.length === 0) return { grund: 'keine-fassung' }

  // 1. Ohne eigene Dauer ist jede Wahl geraten.
  if (!Number.isFinite(dauerSek) || dauerSek <= 0) return { grund: 'keine-dauer' }

  // 2. Die geringste Abweichung gewinnt — unter denen, die ueberhaupt etwas
  //    Synchrones tragen. Eine Fassung ohne Zeitmarken hilft hier nicht.
  let beste: Fassung | null = null
  let besteAbweichung = Number.POSITIVE_INFINITY
  let sahInstrumental = false
  let sahOhneZeitmarken = false

  for (const fassung of treffer) {
    if (!fassung) continue
    const dauer = Number(fassung.dauerSek)
    if (!Number.isFinite(dauer) || dauer <= 0) continue
    const abweichung = Math.abs(dauer - dauerSek)
    if (abweichung > DAUER_SPIELRAUM_S) continue

    if (fassung.instrumental) {
      sahInstrumental = true
      continue
    }
    if (!fassung.synchron) {
      sahOhneZeitmarken = true
      continue
    }
    if (abweichung < besteAbweichung) {
      beste = fassung
      besteAbweichung = abweichung
    }
  }

  if (beste) {
    const zeilen = lrcZerlegen(beste.synchron)
    if (zeilen.length) {
      return { text: { zeilen, fassungDauerSek: Number(beste.dauerSek) } }
    }
    // Zeitmarken versprochen, keine geliefert — das ist "ohne Zeitmarken",
    // nicht "nichts gefunden". Der Unterschied gehoert ins Journal.
    return { grund: 'ohne-zeitmarken' }
  }

  // 3./4. Nichts Passendes. Der GRUND unterscheidet die Faelle, damit im
  //       Journal steht, ob die Quelle nichts hat oder ob die Dauer nicht passt.
  if (sahInstrumental) return { grund: 'instrumental' }
  if (sahOhneZeitmarken) return { grund: 'ohne-zeitmarken' }
  return { grund: 'dauer-passt-nicht' }
}

/**
 * Welche Zeile steht JETZT? Rein.
 *
 * Gibt den INDEX zurueck, nicht den Text — der Aufrufer will meist auch die
 * naechste Zeile zeigen und braucht dafuer die Stelle in der Liste.
 * `-1` heisst „noch keine": vor der ersten Marke laeuft das Vorspiel, und dort
 * soll nichts stehen, nicht schon die erste Zeile.
 *
 * ZUR ZEITBASIS: die gemeldete Position kann zwei Sekunden alt sein (zwei
 * unabhaengige Sekundentakte, llmwiki `mupi-fortschritt-zwei-sekundentakte`).
 * Fuer Zeilensync ist das zu grob — der Aufrufer rechnet mit
 * `fortschrittJetzt()` zwischen den Meldungen weiter und gibt HIER die
 * hochgerechnete Position hinein, nicht die zuletzt gemeldete.
 */
export function zeileJetzt(zeilen: readonly Songzeile[] | null | undefined, positionMs: number): number {
  if (!Array.isArray(zeilen) || zeilen.length === 0) return -1
  if (!Number.isFinite(positionMs)) return -1

  // Binaere Suche: die letzte Zeile, deren Marke nicht in der Zukunft liegt.
  let links = 0
  let rechts = zeilen.length - 1
  let gefunden = -1
  while (links <= rechts) {
    const mitte = (links + rechts) >> 1
    if (zeilen[mitte].zeitMs <= positionMs) {
      gefunden = mitte
      links = mitte + 1
    } else {
      rechts = mitte - 1
    }
  }
  return gefunden
}
