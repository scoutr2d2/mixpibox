#!/usr/bin/env node
/**
 * FARBEN NACHRECHNEN STATT BEHAUPTEN.
 *
 * WOZU: In dieser Oberflaeche traegt Farbe Bedeutung — „gruenes/neutrales Play
 * heisst von vorn, blaues Play heisst weiterhoeren" (llmwiki
 * schwebende-fenster-favoriten-resume). Eine Farbe, die auf dem 800x480-Schirm
 * der Box im Dunkeln nicht mehr als eigene Farbe durchkommt, ist dann keine
 * Kosmetik, sondern eine falsche Auskunft. „Sieht kontrastreich aus" ist keine
 * Messung; WCAG 2.1 nennt Zahlen, und hier stehen sie.
 *
 * WAS ES AENDERT: nichts. Es rechnet und schreibt auf die Konsole.
 *
 * AUFRUF
 *     node tools/kontrast.mjs                       # die Paare dieser Oberflaeche
 *     node tools/kontrast.mjs --pruefen             # Ende 1, wenn ein Paar durchfaellt
 *     node tools/kontrast.mjs "#1B6EF3" "#FFFFFF"   # ein einzelnes Paar
 *
 * ZWEI FRAGEN, ZWEI RECHNUNGEN:
 *
 *   1. KONTRAST (WCAG 2.1, 1.4.3/1.4.11). Relative Leuchtdichte, dann
 *      (hell + 0,05) / (dunkel + 0,05). Schwellen: 4,5 fuer normalen Text,
 *      3,0 fuer grosse Schrift und fuer Bedienelemente/Grafik.
 *   2. UNTERSCHEIDBARKEIT ZWEIER BEDEUTUNGSFARBEN, auch bei Rot-Gruen-Schwaeche.
 *      Blau gegen Gruen ist dafuer der guenstige Fall — aber „guenstig" ist
 *      wieder eine Behauptung. Gerechnet wird deshalb der Abstand NACH einer
 *      Simulation von Deuteranopie und Protanopie (Brettel/Vienot-Verfahren in
 *      der ueblichen linearen Matrixform). Bleibt der Abstand darunter, tragen
 *      die beiden Farben ihre Bedeutung fuer einen Teil der Betrachter nicht
 *      mehr — dann muss ein zweites Merkmal her (hier: die FORM des Zeichens).
 *
 * DIE ZAHL ALLEIN ENTSCHEIDET NICHT. Der Play-Knopf liegt auf einem FREMDEN
 * Cover; gegen welchen Untergrund er steht, weiss niemand. Deshalb wird hier
 * gegen den Knopf selbst gerechnet (weisses Zeichen auf farbiger Scheibe) und
 * gegen die beiden Flaechen, die die Oberflaeche sicher hat: hell und dunkel.
 */
import { pathToFileURL } from 'node:url'

const ARGS = process.argv.slice(2)
const PRUEFEN = ARGS.includes('--pruefen')

/*
 * WIRD DIESE DATEI AUFGERUFEN ODER EINGEBUNDEN?
 *
 * SIE IST BEIDES: ein Befehl (`node tools/kontrast.mjs`) UND ein Baustein
 * (`import { kontrast, abstand } from './kontrast.mjs'`). Bis zum 07.08.2026
 * lief der Befehlsteil AUCH BEIM EINBINDEN — er liest `process.argv`, und die
 * gehoeren dann einem ganz anderen Werkzeug.
 *
 * GEMESSEN, NICHT BEFUERCHTET: `node tools/akkukurve-schau.mjs --ziel
 * http://127.0.0.1:9701/neu/ --bilder /tmp/akku` hat hier zwei Argumente ohne
 * `--` stehen. Der Zweig „ein einzelnes Paar rechnen" nimmt genau die beiden
 * und wirft `keine Farbe: http://127.0.0.1:9701/neu/` — beim IMPORT, also
 * bevor das aufrufende Werkzeug seine erste Zeile ausfuehrt. Der Fehler zeigt
 * dann auf diese Datei und nicht auf den Aufrufer.
 *
 * DAS IST DER GRUND, WARUM DIE FORMEL DREIMAL ABGESCHRIEBEN IM BAUM STAND
 * (cover-ring-schau.mjs, neue-anzeigen-am-kind.mjs, schirm-regler-ansehen.mjs
 * haben je eine eigene Fassung). Wer sie einbinden wollte, kam nicht durch und
 * schrieb sie ab; und drei Fassungen einer WCAG-Rechnung sind drei Stellen,
 * an denen eine Schwelle eines Tages anders lautet. Ab hier ist die Datei
 * einbindbar — die Abschriften koennen gehen, wenn jemand sie anfasst.
 */
const ALS_BEFEHL = import.meta.url === pathToFileURL(process.argv[1] || '').href

/** '#RRGGBB' -> [r, g, b] in 0..255. Kurzform '#RGB' wird mitgenommen. */
function zerlegen(hex) {
  const s = String(hex).trim().replace(/^#/, '')
  const v = s.length === 3 ? [...s].map((c) => c + c).join('') : s
  if (!/^[0-9a-fA-F]{6}$/.test(v)) throw new Error(`keine Farbe: ${hex}`)
  return [0, 2, 4].map((i) => Number.parseInt(v.slice(i, i + 2), 16))
}

/** sRGB 0..255 -> linear 0..1 (WCAG 2.1, Relative Luminance). */
const linear = (k) => {
  const c = k / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Relative Leuchtdichte nach WCAG 2.1. */
function leuchte(hex) {
  const [r, g, b] = zerlegen(hex).map(linear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Kontrastverhaeltnis 1..21. */
export function kontrast(a, b) {
  const x = leuchte(a)
  const y = leuchte(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/**
 * Farbfehlsichtigkeit simulieren.
 *
 * Matrizen im LINEAREN sRGB-Raum (Vienot/Brettel/Mollon 1999, die in
 * Werkzeugen ueblichen Koeffizienten). WICHTIG: erst linearisieren, dann
 * rechnen, dann zurueck — wer die Matrix auf die 0..255-Werte wirft, bekommt
 * zu dunkle Ergebnisse und haelt anschliessend jede Farbe fuer ununterscheidbar.
 */
const MATRIZEN = {
  deuteranopie: [
    [0.625, 0.375, 0.0],
    [0.7, 0.3, 0.0],
    [0.0, 0.3, 0.7],
  ],
  protanopie: [
    [0.567, 0.433, 0.0],
    [0.558, 0.442, 0.0],
    [0.0, 0.242, 0.758],
  ],
  tritanopie: [
    [0.95, 0.05, 0.0],
    [0.0, 0.433, 0.567],
    [0.0, 0.475, 0.525],
  ],
}

const zurueck = (c) => {
  const k = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(k * 255)))
}

/** Auch fuer andere Werkzeuge: tools/farbsaetze-messen.mjs prueft damit, ob
 *  die Bedeutungsfarben auf den neuen Gruenden unterscheidbar bleiben. */
export function simulieren(hex, art) {
  const m = MATRIZEN[art]
  const [r, g, b] = zerlegen(hex).map(linear)
  return m.map((zeile) => zurueck(zeile[0] * r + zeile[1] * g + zeile[2] * b))
}

/**
 * Wie weit liegen zwei Farben auseinander? — euklidisch im Lab-nahen Raum.
 *
 * KEIN RGB-ABSTAND: dort liegt ein Sprung im Blau numerisch weit und wirkt
 * doch kaum. Gerechnet wird in CIELAB (D65), also in einem Raum, der dem
 * Sehen ungefaehr folgt. Faustzahl: ab etwa 20 sind zwei Flaechen sicher als
 * VERSCHIEDENE Farben zu benennen, nicht nur als „irgendwie anders".
 */
function lab(rgb) {
  const [r, g, b] = rgb.map(linear)
  // sRGB -> XYZ (D65)
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29)
  const [fx, fy, fz] = [f(x), f(y), f(z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function abstand(a, b) {
  const [l1, a1, b1] = Array.isArray(a) ? lab(a) : lab(zerlegen(a))
  const [l2, a2, b2] = Array.isArray(b) ? lab(b) : lab(zerlegen(b))
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

// ── Die Paare dieser Oberflaeche ──────────────────────────────────────────
//
// SIE STEHEN HIER UND NICHT IM CSS-PARSER: Was zusammengehoert, sagt keine
// Datei — `--weiter-blau` und der neutrale Knopf treffen sich erst am Bild.
// Wer die Werte in app.css aendert, aendert sie hier mit; genau dann faellt
// beim naechsten Lauf auf, ob die Bedeutung noch traegt.

/** Der neutrale Play-Knopf auf einer Lane-Kachel (`.tipp-spiel`), auf Cover.
 *  rgba(46,42,59,.62) ueber einem mittleren Cover ~ #6B6873; hier wird gegen
 *  die deckende Form gerechnet, weil das der unguenstigere Fall ist. */
const NEUTRAL = '#2E2A3B'

const PAARE = [
  // [Name, Vordergrund, Hintergrund, Mindestwert, Wofuer]
  ['weisses Zeichen auf blauem Knopf (hell)', '#FFFFFF', '#1B6EF3', 4.5, 'Zeichen im Knopf'],
  ['weisses Zeichen auf blauem Knopf (dunkel)', '#FFFFFF', '#3B87FF', 3.0, 'Zeichen im Knopf'],
  ['weisses Zeichen auf neutralem Knopf', '#FFFFFF', NEUTRAL, 4.5, 'Zeichen im Knopf'],
  ['blauer Knopf gegen helle Flaeche', '#1B6EF3', '#FFF7EC', 3.0, 'Knopfrand sichtbar'],
  ['blauer Knopf gegen dunkle Flaeche', '#3B87FF', '#1A1726', 3.0, 'Knopfrand sichtbar'],
  // DER GELBE AUSWAHL-UMRISS IST DER SCHWACHE PUNKT, und er steht hier
  // ausdruecklich mit seiner echten Zahl: 1,52 : 1 gegen die cremefarbene
  // Reihe. Die Farbe bleibt trotzdem — sie sagt, in welcher EBENE man ist
  // (llmwiki lanes-playlist-alben-titel), und eine zweite Bedeutung derselben
  // Farbe waere schlimmer als ein schwacher Kontrast. Getragen wird der
  // Umriss deshalb vom dunklen SAUM daneben, nicht von der Farbe allein.
  ['Auswahl-Umriss gelb gegen helle Flaeche', '#FFC145', '#FFF7EC', 1.5, 'Umriss, Saum traegt mit'],
  ['Saum des Umrisses gegen helle Flaeche', '#D4CFC6', '#FFF7EC', 1.2, 'die dunkle Kante daneben'],
  // Die Marke „laeuft gerade": weisses Zeichen auf `--accentDark`. Auf
  // `--accent` (#FF6B57) waeren es nur 2,80 : 1 — deshalb der dunklere Ton.
  ['weisses Zeichen auf der Laeuft-Marke', '#FFFFFF', '#D9422F', 3.0, 'Zeichen in der Marke'],
  ['Laeuft-Marke gegen helle Flaeche', '#D9422F', '#FFF7EC', 3.0, 'Marke sichtbar'],
  ['Laeuft-Marke gegen dunkle Flaeche', '#D9422F', '#1A1726', 3.0, 'Marke sichtbar'],
]

/** Farbpaare, die BEDEUTUNG tragen und deshalb unterscheidbar bleiben muessen. */
const BEDEUTUNG = [
  ['blau (weiterhoeren) gegen neutral (von vorn), hell', '#1B6EF3', NEUTRAL],
  ['blau (weiterhoeren) gegen neutral (von vorn), dunkel', '#3B87FF', NEUTRAL],
  ['blau (weiterhoeren) gegen gruen (von vorn, klassisch)', '#1B6EF3', '#2DD36F'],
  ['blau (weiterhoeren) gegen die Laeuft-Marke', '#1B6EF3', '#D9422F'],
  ['blau (weiterhoeren) gegen den Auswahl-Umriss', '#1B6EF3', '#FFC145'],
]

/** Ab hier gelten zwei Flaechen als sicher verschiedene FARBEN. */
const MIN_ABSTAND = 20

if (ALS_BEFEHL) {
  if (ARGS.filter((a) => !a.startsWith('--')).length >= 2) {
    const [a, b] = ARGS.filter((x) => !x.startsWith('--'))
    console.log(`  ${a} auf ${b}: ${kontrast(a, b).toFixed(2)} : 1`)
    console.log(`  Abstand (CIELAB): ${abstand(a, b).toFixed(1)}`)
    for (const art of Object.keys(MATRIZEN)) {
      const s = abstand(simulieren(a, art), simulieren(b, art))
      console.log(`  Abstand bei ${art.padEnd(13)}: ${s.toFixed(1)}`)
    }
    process.exit(0)
  }

  let schlecht = 0

  console.log('\n  KONTRAST (WCAG 2.1)')
  console.log('  ' + '─'.repeat(76))
  for (const [name, vg, hg, min, wofuer] of PAARE) {
    const k = kontrast(vg, hg)
    const ok = k >= min
    if (!ok) schlecht++
    console.log(
      `  ${ok ? 'ok  ' : 'NEIN'} ${name.padEnd(42)} ${k.toFixed(2).padStart(6)} : 1   (>= ${min}, ${wofuer})`,
    )
  }

  console.log('\n  UNTERSCHEIDBARKEIT DER BEDEUTUNGSFARBEN (CIELAB-Abstand)')
  console.log(`  ${'─'.repeat(76)}`)
  console.log(`  ${''.padEnd(52)} normal  deuter.  protan.`)
  for (const [name, a, b] of BEDEUTUNG) {
    const n = abstand(a, b)
    const d = abstand(simulieren(a, 'deuteranopie'), simulieren(b, 'deuteranopie'))
    const pr = abstand(simulieren(a, 'protanopie'), simulieren(b, 'protanopie'))
    const ok = Math.min(n, d, pr) >= MIN_ABSTAND
    if (!ok) schlecht++
    console.log(
      `  ${ok ? 'ok  ' : 'NEIN'} ${name.padEnd(47)} ${n.toFixed(1).padStart(6)} ${d.toFixed(1).padStart(8)} ${pr.toFixed(1).padStart(8)}`,
    )
  }
  console.log(`\n  Schwelle Abstand: ${MIN_ABSTAND}\n`)

  if (schlecht) {
    console.log(`  ${schlecht} Paar(e) unter der Schwelle.`)
    if (PRUEFEN) process.exit(1)
  }
}
