/**
 * ARD Sounds — was davon im KERN verblieben ist.
 *
 * ══ DIE GESCHICHTE DIESER DATEI (E78/E79, 22.08.2026) ══════════════════════
 *
 * Bis zum 22.08.2026 stand hier das gesamte ARD-Wissen der Box: GraphQL-
 * Abfragen, Folgen-Regeln (Ton-Nachsicht, Verweildauer, Sperrliste),
 * Altersfenster, Teaser-Aufloesung, Suche — rund 980 Zeilen, jede Regel mit
 * ihrer Messung im Kommentar. Mit der Anbieter-Migration ist dieses Wissen in
 * das Plugin `plugins/mixpi-ardsounds` umgezogen; die MESSPROTOKOLLE stehen
 * kompakt in dessen Kopfkommentaren, die vollen Fassungen in der Git-Historie
 * dieser Datei (bis Commit 41bed1d8) und im Wissenspaket (llmwiki, E78/E79).
 *
 * WAS BLEIBT, ist Kern-Infrastruktur — die zwei Stellen, an denen der Kern
 * selbst mit ARD-Eintraegen und -Befehlen umgeht:
 *
 *   `sendungsKennung`  liest die Sendungskennung aus einem data.json-Eintrag
 *                      (der Eintrag gehoert der Bibliothek, also dem Kern)
 *   `abspielWeg`       baut die mpv-Befehle (`ard/…` und `ardqueue/…`) samt
 *                      Vorspann-Sprung — die Verben gehoeren dem
 *                      Abspieldienst, nicht dem Anbieter
 */

export const ARD_TYP = 'ard'

/** Eine spielbare Folge, wie der /inhalt-Zweig sie dem Befehlsbau reicht. */
export interface Folge {
  kennung: string
  titel: string
  /** Sekunden, wie die Schnittstelle sie meldet (deckt sich mit der Datei). */
  dauerS?: number
  /** ISO-Zeitpunkt der Veroeffentlichung. */
  veroeffentlicht?: string
  bild: string
  ton: string
  /** `audioList[].availableTo` — bis wann die Adresse gilt. Oft nicht gesetzt. */
  bis?: string
}

/**
 * Die Sendungskennung eines data.json-Eintrags — `ard:`/`ard-` faellt ab.
 */
export function sendungsKennung(eintrag: { id?: unknown; ardSendung?: unknown } | null | undefined): string {
  const roh = String(eintrag?.ardSendung ?? eintrag?.id ?? '').trim()
  return roh.replace(/^ard[-:]/i, '')
}

/**
 * Die Befehle fuer den Abspieldienst — Start und Anhaengen.
 *
 * DIE FORM IST NICHT NEU ERFUNDEN, sondern die des jellyfin-Verbs: Adresse
 * und Anzeige-Titel im Pfad, `:title:artist:` als Trenner.
 *
 * ── DER VORSPANN-SPRUNG REIST IM BEFEHL MIT (15.08.2026) ────────────────
 * Betreiber: „jingle überspringen … es gibt immer einen anfangs jingle der
 * bei allen gleich ist". Wie lang er ist, MISST
 * scripts/box/ard-vorspann-messen.py (bei „MausHoerspiel kurz": 5,25 s an
 * vier Folgen). Die Zahl haengt hinten am Namen und wird im Abspieldienst
 * von `abAusName` gelesen — ohne sie ist der Befehl Zeichen fuer Zeichen
 * der von gestern.
 *
 * Warum nicht in einer Datei beim Abspieldienst: der Sprung gilt je
 * SENDUNG, und welche gerade laeuft, weiss nur, wer den Befehl schickt.
 */
export function abspielWeg(
  folge: Folge,
  interpret = '',
  abSekunden = 0,
): { befehl: string; anhaengen: string } {
  const enc = encodeURIComponent
  const ab = Number.isFinite(abSekunden) && abSekunden > 0 ? `:ab:${Math.round(abSekunden * 100) / 100}` : ''
  const schwanz = `${enc(folge.ton)}/${enc(folge.titel ?? '')}:title:artist:${enc(interpret)}${ab}`
  return { befehl: `${ARD_TYP}/${schwanz}`, anhaengen: `${ARD_TYP}queue/${schwanz}` }
}
