/**
 * Die Regeln der Einstellungssuche — ohne Oberflaeche, ohne Netz.
 *
 * WARUM EIGENE DATEI: Was hier steht, ist eine reine Entscheidung (dieser Text
 * passt zu dieser Frage, und zwar besser als jener). Im Bauteil laege sie
 * hinter einem Eingabefeld und waere nur von Hand pruefbar; hier steht ein
 * spec daneben (suche.filter.spec.ts).
 *
 * GESUCHT WIRD DER SICHTBARE TEXT, nicht der Feldname. Wer den Schalter für
 * doppelte Alben sucht, tippt „Doppelte" — nicht `verschmelzen`. Der Bestand
 * enthaelt deshalb ausschliesslich das, was auf dem Knopf steht; woher er
 * kommt, sagt such-bestand.ts.
 */

export interface SuchEintrag {
  /** Der Text, den man sieht — danach wird gesucht, nicht nach dem Feldnamen. */
  text: string
  /** Der Name der Seite, so wie er in der Kopfleiste oder auf ihrer h1 steht. */
  seite: string
  /**
   * Die Seite, von der aus man hierher kommt — nur bei UNTERSEITEN gesetzt.
   *
   * Seit dem 03.08.2026 stehen „Doppelte" und „Interpreten" nicht mehr in der
   * Kopfleiste, sondern hinter einem Weg auf der Medienseite. Ohne diese
   * Angabe hiesse der Ort eines Treffers dort nur „Doppelte" — und genau die
   * Frage, die jemand hat („wo ist das denn?"), bliebe offen: in der
   * Kopfleiste steht nichts, was so heisst.
   */
  eltern?: string
  /** Der Weg dorthin. */
  weg: string
  /** Der Abschnitt der Seite; leer, wenn der Eintrag vor der ersten Ueberschrift steht. */
  bereich: string
  /**
   * Mitgesuchter, aber NICHT angezeigter Text.
   *
   * Nur die Felder der Konfigurationsseite haben ihn: dort steht unter jedem
   * Titel ein erklaerender Satz („wirkt nach einem Neustart", „in Sekunden"),
   * und danach sucht man durchaus. Angezeigt wird trotzdem nur der Titel —
   * ein Treffer, der einen Absatz breit ist, hilft niemandem.
   */
  zusatz?: string
}

/**
 * Zwei Schreibweisen desselben Wortes gleich machen.
 *
 * Umlaute fallen auf ihren Grundbuchstaben (ä→a), scharfes S auf ss. NICHT
 * gefaltet wird ae/oe/ue in die andere Richtung: „Neues" enthaelt ue, und aus
 * einem Feld namens „Neues Passwort" wuerde sonst „Nus Passwort".
 *
 * Die typografischen Anfuehrungszeichen fliegen heraus, weil im Bestand
 * „endet um …" mit den deutschen Zeichen steht, auf der Tastatur aber " liegt.
 */
export function normal(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss')
    .replace(/[„“”"‚‘’']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Alles, was kein Buchstabe und keine Ziffer ist, trennt Woerter. */
const TRENNER = /[^\p{L}\p{N}]+/u

/**
 * Wie gut passt ein einzelnes Suchwort auf einen Text? Kleiner ist besser.
 *
 * Die Stufen sind die Reihenfolge, in der ein Mensch sucht: erst das ganze
 * Wort, dann der Anfang, dann ein Wortanfang mittendrin, dann irgendwo.
 * KEIN_TREFFER liegt ueber allem und heisst „steht hier nicht".
 */
export const KEIN_TREFFER = 9

export function rangFuer(feld: string, wort: string): number {
  if (!wort) return KEIN_TREFFER
  if (feld === wort) return 0
  if (feld.startsWith(wort)) return 1
  if (feld.split(TRENNER).some((w) => w.startsWith(wort))) return 2
  if (feld.includes(wort)) return 3
  return KEIN_TREFFER
}

/**
 * Die Treffer zu einer Frage, die besten zuerst.
 *
 * ZWEI REGELN, und die zweite ist die wichtigere:
 *   1. ALLE Suchwoerter muessen vorkommen — im Text, im Abschnitt, im
 *      Seitennamen oder im Zusatz. So schraenkt jedes weitere Wort ein,
 *      statt die Liste zu verlaengern.
 *   2. Der RANG kommt vom sichtbaren Text. „Doppelte" soll den Knopf
 *      „Doppelte zusammenfassen" bringen und nicht die vierzig Eintraege der
 *      Seite „Doppelte" — die stehen dort, weil ihr Seitenname passt, nicht
 *      sie selbst.
 */
export function treffer(bestand: SuchEintrag[], frage: string, grenze = 12): SuchEintrag[] {
  const worte = normal(frage).split(' ').filter(Boolean)
  if (worte.length === 0) return []

  const bewertet: { e: SuchEintrag; rang: number }[] = []
  for (const e of bestand) {
    const text = normal(e.text)
    const drumherum = normal(`${e.bereich} ${e.eltern ?? ''} ${e.seite} ${e.zusatz ?? ''}`)
    let bester = KEIN_TREFFER
    let vollstaendig = true
    for (const w of worte) {
      const imText = rangFuer(text, w)
      // Der Umkreis zaehlt nur als „vorhanden", nie als guter Rang — sonst
      // waere jeder Eintrag einer Seite so gut wie die Seite selbst.
      const vorhanden = imText !== KEIN_TREFFER || drumherum.includes(w)
      if (!vorhanden) {
        vollstaendig = false
        break
      }
      bester = Math.min(bester, imText === KEIN_TREFFER ? 4 : imText)
    }
    if (vollstaendig) bewertet.push({ e, rang: bester })
  }

  bewertet.sort(
    (a, b) =>
      a.rang - b.rang ||
      // Bei gleichem Rang gewinnt der kuerzere Text: er ist der genauere.
      a.e.text.length - b.e.text.length ||
      a.e.text.localeCompare(b.e.text, 'de') ||
      a.e.seite.localeCompare(b.e.seite, 'de'),
  )
  return bewertet.slice(0, grenze).map((b) => b.e)
}

/**
 * Wo liegt der Treffer? Genau das ist die Antwort, die der Benutzer will.
 *
 * Bis zu drei Stufen, und jede kommt nur dazu, wenn sie etwas sagt:
 *     Elternseite › Seite › Abschnitt
 * `bereich: 'Seite'` ist die Marke des Eintrags, der die SEITE SELBST meint —
 * dort waere „Doppelte › Seite" nur Geraeusch.
 */
export function ortVon(e: SuchEintrag): string {
  const stufen = [e.eltern, e.seite, e.bereich === 'Seite' ? '' : e.bereich]
  return stufen.filter(Boolean).join(' › ')
}
