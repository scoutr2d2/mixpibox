/**
 * Die Farben der NEUEN Oberflaeche in ein Farbthema schreiben — und zurueckholen.
 *
 * ══ WARUM AUSGERECHNET DORTHIN ═════════════════════════════════════════════
 * Gemessen am 05.08.2026 (tools/thema-weg-schau.mjs, tools/farbwaehler-wirkung.mjs):
 * die neue Oberflaeche haelt ihre Farben in `NewDesign/app.css` an `:root`. Der
 * EINZIGE Weg, der von aussen dorthin fuehrt, ist das Blatt, das
 * `/neu/index.html` VOR `app.css` einbindet:
 *
 *     <link rel="stylesheet" href="/active_theme.css">   ->  themes/<Name>.css
 *
 * Der Kommentar an dieser Zeile sagt es selbst: sie ist da, um „spaetere
 * Ergaenzungen des Farbthemas mitzufangen". Genau die sind hier gemeint.
 *
 * ZWEI EIGENSCHAFTEN DIESES WEGES SIND GEMESSEN UND NICHT VERHANDELBAR:
 *
 *   1. `!important` IST PFLICHT. Das Blatt kommt VOR app.css; bei gleicher
 *      Spezifitaet gewinnt das spaetere. Ohne `!important` bleibt jeder Wert
 *      wirkungslos — gemessen, nicht vermutet.
 *   2. DER SELEKTOR IST `:root:not([data-licht='dunkel'])`, NICHT `:root`.
 *      Der dunkle Stand ueberschreibt dieselben Variablen ueber
 *      `:root[data-licht='dunkel']` — ohne `!important`. Ein `!important` an
 *      `:root` wuerde ihn erschlagen und die Box abends hell leuchten lassen.
 *      Mit dem `:not(...)` trifft die Regel im dunklen Stand gar nicht zu.
 *      Am Geraet gemessen: fuenf Farben wirken hell, alle fuenf bleiben dunkel
 *      auf ihren eigenen Werten.
 *
 * ══ EIN BLOCK, KEIN ZWEITES BLATT ══════════════════════════════════════════
 * Die erzeugten Regeln stehen zwischen zwei Marken am ENDE der Themendatei.
 * Alles davor — die `--ion-*`-Regeln, die die KLASSISCHE Oberflaeche faerben —
 * bleibt unberuehrt. Ein Farbthema kann damit beides tragen, ohne dass eine
 * Seite der anderen ins Handwerk pfuscht.
 *
 * ══ WELCHE VARIABLEN ERLAUBT SIND: DIESES MODUL ENTSCHEIDET DAS NICHT ══════
 * Es prueft nur die FORM (`--name` und `#RRGGBB`). Die Auswahl, WELCHE Farben
 * ein Mensch stellen soll, ist eine Frage der Bedienung und steht an genau
 * einer Stelle: in der Verwaltungsseite. Haette dieses Modul seine eigene
 * Liste, gaebe es zwei — und die eine liefe der anderen davon
 * ([[drei-orte-eine-anzeige]]).
 *
 * REIN: kein Dateizugriff, kein Netz. Der Aufrufer reicht den Dateiinhalt
 * herein und bekommt den neuen zurueck.
 */

/** Anfang und Ende des erzeugten Bereichs. Aendern hiesse: alte Bloecke verwaisen. */
export const MARKE_AUF = '/* ── MuPiBox: Farben der neuen Oberflaeche — ANFANG (erzeugt) ── */'
export const MARKE_ZU = '/* ── MuPiBox: Farben der neuen Oberflaeche — ENDE ── */'

/**
 * Der Selektor, unter dem die Farben stehen.
 *
 * Steht als Konstante da, weil an ihm die halbe Begruendung dieses Moduls
 * haengt (siehe Kopf) und ein spaeteres `:root` ihn still kaputtmachen wuerde.
 */
export const SELEKTOR = ":root:not([data-licht='dunkel'])"

/**
 * Ein Variablenname, wie app.css ihn schreibt.
 *
 * GROSSBUCHSTABEN SIND ERLAUBT und das ist kein Versehen: in app.css stehen
 * `--rowBg`, `--accentInk`, `--accentDark`, `--pillInk`. CSS-Variablen sind
 * gross/klein-empfindlich — wer hier auf Kleinschreibung normierte, schriebe
 * `--rowbg` und faerbte nichts.
 */
const NAME = /^--[A-Za-z][A-Za-z0-9-]{0,39}$/
/** Nur die lange Form. Kurzform und Namen waeren zwei Schreibweisen fuer eine Farbe. */
const FARBE = /^#[0-9a-fA-F]{6}$/

export function nameGueltig(n: unknown): boolean {
  return typeof n === 'string' && NAME.test(n)
}

export function farbeGueltig(w: unknown): boolean {
  return typeof w === 'string' && FARBE.test(w)
}

/**
 * Nur Paare durchlassen, die beides bestehen — der Rest faellt still weg.
 *
 * STILL, und das ist Absicht: die Verwaltung schickt genau die Felder, die sie
 * anzeigt. Kaeme hier etwas anderes an, waere das kein Bedienfehler, sondern
 * ein fremder Aufruf — und dem eine Fehlermeldung zu schreiben, die erklaert,
 * was erlaubt waere, hilft nur ihm.
 */
export function farbenPruefen(roh: unknown): Record<string, string> {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return {}
  const raus: Record<string, string> = {}
  for (const [n, w] of Object.entries(roh as Record<string, unknown>)) {
    if (nameGueltig(n) && farbeGueltig(w)) raus[n] = (w as string).toUpperCase()
  }
  return raus
}

/**
 * Der erzeugte Block als Text. Leere Auswahl -> leerer Text (kein Block).
 *
 * Die Reihenfolge ist SORTIERT, nicht die des Aufrufers: sonst aendert sich
 * die Datei bei jedem Speichern, auch wenn sich keine Farbe geaendert hat, und
 * ein Blick in die Datei sagt nicht mehr, ob etwas passiert ist.
 */
export function blockBauen(farben: Record<string, string>): string {
  const paare = Object.entries(farben).sort(([a], [b]) => a.localeCompare(b))
  if (paare.length === 0) return ''
  const zeilen = paare.map(([n, w]) => `  ${n}: ${w} !important;`).join('\n')
  return [
    MARKE_AUF,
    '/* Von der Verwaltung erzeugt (Darstellung -> Farben der neuen Oberflaeche).',
    '   Aenderungen von Hand gehen beim naechsten Speichern verloren.',
    '   !important ist noetig: dieses Blatt wird VOR app.css eingebunden.',
    "   :not([data-licht='dunkel']) laesst den dunklen Stand unangetastet. */",
    `${SELEKTOR} {`,
    zeilen,
    '}',
    MARKE_ZU,
  ].join('\n')
}

/** Die Datei ohne den erzeugten Block — der von Hand gepflegte Teil. */
export function ohneBlock(css: string): string {
  const a = css.indexOf(MARKE_AUF)
  if (a < 0) return css
  const z = css.indexOf(MARKE_ZU, a)
  // Eine angefangene Marke ohne Ende: dann gehoert der Rest der Datei zum
  // Block. Alles andere hiesse, kaputte Reste stehenzulassen und bei jedem
  // Speichern einen weiteren dazuzulegen.
  const rest = z < 0 ? '' : css.slice(z + MARKE_ZU.length)
  return css.slice(0, a) + rest
}

/** Die Farben aus einem vorhandenen Block zurueckholen. */
export function blockLesen(css: string): Record<string, string> {
  const a = css.indexOf(MARKE_AUF)
  if (a < 0) return {}
  const z = css.indexOf(MARKE_ZU, a)
  const teil = css.slice(a, z < 0 ? css.length : z)
  const raus: Record<string, string> = {}
  for (const m of teil.matchAll(/(--[A-Za-z][A-Za-z0-9-]*)\s*:\s*(#[0-9a-fA-F]{6})\s*!important\s*;/g)) {
    raus[m[1]] = m[2].toUpperCase()
  }
  return raus
}

/**
 * Den neuen Dateiinhalt bauen: alter Teil + neuer Block.
 *
 * KEIN ANHAENGEN AN DEN ALTEN BLOCK. Beim ersten Anlauf stand hier ein
 * schlichtes `css + block` — nach dem dritten Speichern lagen drei Bloecke in
 * der Datei, der letzte gewann, und die Datei wuchs bei jedem Klick. Deshalb
 * wird IMMER zuerst herausgeschnitten.
 */
export function blockErsetzen(css: string, farben: Record<string, string>): string {
  const grund = ohneBlock(css).replace(/\s*$/, '')
  const block = blockBauen(farbenPruefen(farben))
  if (!block) return grund === '' ? '' : `${grund}\n`
  return `${grund}\n\n${block}\n`
}
