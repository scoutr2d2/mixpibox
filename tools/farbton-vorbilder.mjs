/**
 * AUF WELCHEM GRAD LIEGT „PINK"? — Farbnamen an Vorbildern nachgemessen.
 *
 * ══ DER FALL, WEGEN DEM ES DAS GIBT ═══════════════════════════════════════
 * Betreiber, 08.08.2026, ueber Super-Rosa: „sie meint es ist lila und nicht
 * pink" — die Gutachterin ist seine Tochter. Der Satz steht auf 342 Grad, und
 * das ist derselbe Grad wie Rosa; mit viel Buntheit liest er sich als LILA.
 *
 * Daraus folgt eine Frage, die man nicht im Kopf beantwortet: Auf welchem
 * OKLCH-Grad liegt eigentlich das, was ein Kind „Pink" nennt? Und „Gelb"?
 * Und „Orange"?
 *
 * ══ WIE ES ANTWORTET ══════════════════════════════════════════════════════
 * Nicht durch Nachdenken, sondern an VORBILDERN: bekannte Farben, deren Name
 * unstrittig ist (CSS-`hotpink`, `deeppink`, `gold`, `orange`, …). Ihr Grad
 * wird gerechnet, und daraus ergibt sich die Spanne, in der ein Name liegt.
 *
 * ES RECHNET AUSSERDEM DIE ABSTAENDE — zu den drei Bedeutungsfarben, die
 * NICHT mitdrehen, und zu den Saetzen, die es schon gibt. Ein neuer Satz, der
 * auf dem Grad einer Bedeutungsfarbe liegt, macht aus „laeuft gerade" eine
 * Flaeche in der Farbe ihres Untergrunds; einer, der auf dem Grad eines
 * anderen Satzes liegt, ist kein zweiter Satz, sondern derselbe nochmal.
 *
 * ══ WAS ES NICHT KANN ═════════════════════════════════════════════════════
 * Es sagt NICHT, ob eine Palette am Ende haelt. Ob die Kontraste stehen,
 * entscheidet tools/farbsaetze-messen.mjs; ob die Buntheit ueberhaupt in den
 * Bildschirmraum passt, entscheidet die Bisektion in farbsaetze-bauen.mjs.
 * Dieses Werkzeug beantwortet nur die eine Frage: WELCHER GRAD HEISST SO.
 *
 * ══ WAS ES AENDERT ════════════════════════════════════════════════════════
 * Nichts. Es rechnet und schreibt auf die Konsole.
 *
 * ══ AUFRUF ════════════════════════════════════════════════════════════════
 *     node tools/farbton-vorbilder.mjs
 *     node tools/farbton-vorbilder.mjs 335 350 95     # eigene Grade pruefen
 */
import { SAETZE, oklch } from './farbsaetze-bauen.mjs'

/**
 * DIE VORBILDER — Farben, ueber deren NAMEN niemand streitet.
 *
 * Die meisten sind CSS-Farbnamen (also seit Jahrzehnten festgeschrieben),
 * dazu ein paar aus dem Kinderzimmer-Umfeld, wo „Pink" am eindeutigsten ist.
 * Sie stehen hier ALS HEX und nicht als Namen, damit dieses Werkzeug keine
 * Farbtabelle des Browsers braucht.
 */
const VORBILDER = {
  Pink: [
    ['hotpink', '#FF69B4'],
    ['deeppink', '#FF1493'],
    ['pink (CSS)', '#FFC0CB'],
    ['Barbie-Pink', '#E0218A'],
    ['Magenta/Fuchsia', '#FF00FF'],
    ['Bubblegum', '#FFC1CC'],
  ],
  Lila: [
    ['violet', '#EE82EE'],
    ['orchid', '#DA70D6'],
    ['mediumorchid', '#BA55D3'],
    ['purple', '#800080'],
  ],
  Gelb: [
    ['yellow', '#FFFF00'],
    ['gold', '#FFD700'],
    ['khaki', '#F0E68C'],
    ['Sonnenblume', '#FFC300'],
  ],
  Orange: [
    ['orange', '#FFA500'],
    ['darkorange', '#FF8C00'],
    ['coral', '#FF7F50'],
    ['Mandarine', '#F28500'],
  ],
}

/**
 * DIE DREI FARBEN, DIE NICHT MITDREHEN — mit ihrem Grad.
 *
 * Sie stehen im Kopf von farbsaetze-bauen.mjs begruendet; hier stehen sie als
 * Zahl, weil ein Abstand ohne Gegenueber keiner ist.
 */
const BEDEUTUNG = [
  ['--accent (laeuft gerade)', 30],
  ['--mp-akzent (Haupttaste)', 81],
  ['--weiter-blau (weiterhoeren)', 260],
]

/** Der kuerzere Weg auf dem Farbkreis — 350 und 10 sind 20 Grad, nicht 340. */
const rund = (a, b) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

console.log('\n══ WO DIE NAMEN LIEGEN — Vorbilder in OKLCH ══════════════════')
const spannen = {}
for (const [name, liste] of Object.entries(VORBILDER)) {
  console.log(`\n  ${name}`)
  const grade = []
  for (const [wort, hex] of liste) {
    const o = oklch(hex)
    grade.push(o.h)
    console.log(
      `    ${wort.padEnd(18)} ${hex}   ${o.h.toFixed(0).padStart(3)}°   Buntheit ${o.C.toFixed(3)}   Helligkeit ${o.L.toFixed(2)}`,
    )
  }
  // DER MITTELWERT WIRD RUND GERECHNET. Bei Pink liegen Werte um 0 herum
  // (359 und 3), und ein gerader Mittelwert daraus waere 181 — die
  // Gegenfarbe.
  const x = grade.reduce((s, g) => s + Math.cos((g * Math.PI) / 180), 0)
  const y = grade.reduce((s, g) => s + Math.sin((g * Math.PI) / 180), 0)
  const mitte = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
  const weit = Math.max(...grade.map((g) => rund(g, mitte)))
  spannen[name] = mitte
  console.log(`    ${'→ Mitte'.padEnd(18)}          ${mitte.toFixed(0).padStart(3)}°   (+/- ${weit.toFixed(0)}°)`)
}

console.log('\n══ WIE WEIT DIE MITTEN VONEINANDER STEHEN ════════════════════')
const namen = Object.keys(spannen)
for (let i = 0; i < namen.length; i++) {
  for (let j = i + 1; j < namen.length; j++) {
    const d = rund(spannen[namen[i]], spannen[namen[j]])
    console.log(`  ${namen[i]} gegen ${namen[j]}`.padEnd(34) + `${d.toFixed(0).padStart(3)}°`)
  }
}

// ── DIE PRUEFUNG FUER EINEN VORSCHLAG ─────────────────────────────────────
const eigene = process.argv.slice(2).map(Number).filter(Number.isFinite)
const kandidaten = eigene.length ? eigene : Object.values(spannen).map(Math.round)

console.log('\n══ ABSTAND ZU DEM, WAS SCHON DASTEHT ═════════════════════════')
console.log('  Grad   naechste Bedeutungsfarbe          naechster Satz')
for (const g of kandidaten) {
  const b = BEDEUTUNG.map(([n, h]) => [n, rund(g, h)]).sort((x, y) => x[1] - y[1])[0]
  const s = SAETZE.filter((x) => x.ton !== null)
    .map((x) => [x.wort, rund(g, x.ton)])
    .sort((x, y) => x[1] - y[1])[0]
  // 25 GRAD IST DIE GEMESSENE UNTERGRENZE DES BESTANDS: Rot liegt auf 22 und
  // `--accent` auf 30, das sind 8 Grad — und es traegt nur, weil die Buntheit
  // (0,19 gegen 0,04) und die Helligkeit den Unterschied machen. Wo ein
  // Abstand kleiner wird, ist das kein Verbot, sondern ein Hinweis: dann muss
  // tools/farbsaetze-messen.mjs die Aussage tragen, nicht der Grad.
  const eng = b[1] < 25 || s[1] < 25
  console.log(
    `  ${String(g).padStart(3)}°   ${b[0].padEnd(28)} ${String(b[1].toFixed(0)).padStart(3)}°   ` +
      `${s[0].padEnd(12)} ${String(s[1].toFixed(0)).padStart(3)}°${eng ? '   <- ENG, messen' : ''}`,
  )
}
console.log('')
