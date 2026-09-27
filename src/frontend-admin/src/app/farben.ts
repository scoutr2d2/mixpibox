/**
 * Farben LESEN und BEURTEILEN — beides ohne eigene Wahrheit.
 *
 * WOZU DIESE DATEI ÜBERHAUPT: Der Farbwähler auf der Darstellungsseite muss
 * zwei Dinge können, die nichts mit Angular zu tun haben, und beide sollen
 * prüfbar sein, ohne ein Bauteil zu bauen:
 *
 *   1. AUS app.css LESEN, welche Farben ausgeliefert wurden. Die Vorgaben
 *      dürfen NICHT hier stehen: `NewDesign/app.css` ist die Datei, aus der
 *      die Box ihre Farben wirklich nimmt. Eine zweite Liste in der Verwaltung
 *      liefe ihr davon, sobald jemand dort einen Ton ändert — und die
 *      Verwaltung zeigte eine Farbe, die die Box gar nicht hat
 *      ([[drei-orte-eine-anzeige]]).
 *   2. DEN KONTRAST AUSRECHNEN. Ein Wähler, der jede Farbe erlaubt, erlaubt
 *      auch Grau auf Grau. Verboten wird das nicht — das wäre eine
 *      Entscheidung, die dem Betreiber gehört. Die ZAHL steht daneben.
 *
 * Die Kontrastformel steht ausserdem in `tools/kontrast.mjs`, ausführlich
 * begründet. Das ist bewusst keine zweite Wahrheit: es ist eine FORMEL aus
 * einer veröffentlichten Norm (WCAG 2.1, Relative Luminance), kein Wert, der
 * auseinanderlaufen könnte. Der Browser kann die Datei aus `tools/` nicht
 * laden, deshalb steht der Kern hier noch einmal.
 */

/** Nur die lange Form — dieselbe, die `<input type="color">` liefert. */
const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * Die Farbvariablen aus dem `:root`-Block eines Stilblatts.
 *
 * ERST DIE KOMMENTARE WEG, DANN DIE KLAMMERN ZÄHLEN — in dieser Reihenfolge,
 * und das ist keine Kosmetik. Umgekehrt beendet die erste geschweifte Klammer
 * in einem Kommentar den Block: `:root` in app.css trägt lange erklärende
 * Absätze, und eine einzige Klammer darin schnitte alles danach ab. Genau so
 * herum stand es beim ersten Anlauf hier, und `--line2` fehlte still.
 *
 * WARUM NUR `#RRGGBB` DURCHKOMMT: in derselben Liste stehen `--umriss-luft:
 * 7px`, `--griff: 66px` und `--tipp-neutral: rgba(46, 42, 59, 0.62)`. Ein
 * Farbfeld kann keine davon anzeigen — ein Farbwähler für einen Abstand wäre
 * ein Bedienelement, das lügt.
 */
export function wurzelFarben(css: string): Record<string, string> {
  const rein = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const i = rein.indexOf(':root')
  if (i < 0) return {}
  const a = rein.indexOf('{', i)
  if (a < 0) return {}
  let tiefe = 0
  let ende = -1
  for (let k = a; k < rein.length; k++) {
    if (rein[k] === '{') tiefe++
    else if (rein[k] === '}') {
      tiefe--
      if (tiefe === 0) {
        ende = k
        break
      }
    }
  }
  if (ende < 0) return {}
  const raus: Record<string, string> = {}
  for (const m of rein.slice(a + 1, ende).matchAll(/(--[A-Za-z][A-Za-z0-9-]*)\s*:\s*([^;]+);/g)) {
    const wert = m[2].trim()
    if (HEX.test(wert)) raus[m[1]] = wert.toUpperCase()
  }
  return raus
}

/** '#RRGGBB' -> [r, g, b]; null, wenn es keine Farbe ist. */
function zerlegen(hex: string): [number, number, number] | null {
  if (!HEX.test(hex)) return null
  const s = hex.slice(1)
  return [0, 2, 4].map((i) => Number.parseInt(s.slice(i, i + 2), 16)) as [number, number, number]
}

/** sRGB 0..255 -> linear 0..1 (WCAG 2.1). */
const linear = (k: number): number => {
  const c = k / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/**
 * Kontrastverhältnis 1..21 nach WCAG 2.1, oder 0, wenn eine Farbe fehlt.
 *
 * NULL UND NICHT 21 IM ZWEIFEL: eine fehlende Farbe darf nicht als „bestens"
 * durchgehen. Die Anzeige sagt dann lieber nichts, als etwas Falsches.
 */
export function kontrast(vg: string, hg: string): number {
  const A = zerlegen(vg)
  const B = zerlegen(hg)
  if (!A || !B) return 0
  const l = (p: [number, number, number]): number =>
    0.2126 * linear(p[0]) + 0.7152 * linear(p[1]) + 0.0722 * linear(p[2])
  const x = l(A)
  const y = l(B)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/**
 * DIE FLÄCHEN, AUF DENEN SCHRIFT WIRKLICH SITZT.
 *
 * Eine Zahl allein hat hier am 05.08.2026 gelogen. Der Wähler meldete
 * `--ink` auf `--bg` — und nur das. Wer NUR `--surface` verstellte, liess die
 * Zahl unberührt bei „13,09 : 1 (reichlich)", während auf der Box die
 * Seitenleiste und das PIN-Tastenfeld unlesbar wurden. GEMESSEN am Gerät
 * (tools/farbwaehler-gegenlesen.mjs, Abschnitt 6b): mit
 * `--surface: #2E2A3B` stand `.tor-taste` auf `rgb(46,42,59)` Fläche mit
 * `rgb(46,42,59)` Ziffer — 1,00 : 1, und die Zahl daneben sagte 13,09.
 *
 * Genau diese Regel macht die zweite Zeile nötig; sie trägt BEIDE Merkmale:
 *
 *     .tor-taste { background: var(--surface); color: var(--ink); }
 *
 * Das Tastenfeld steht zwischen dem Kind und den Einstellungen. Wer es
 * unsichtbar macht, sperrt sich an der Box selbst aus.
 */
export const SCHRIFTPAARE = [
  { vg: '--ink', hg: '--bg', wo: 'auf dem Grund' },
  { vg: '--ink', hg: '--surface', wo: 'auf den Flächen (Seitenleiste, Karten, PIN-Tasten)' },
] as const

/**
 * Das SCHWÄCHSTE der Paare — und wo es sitzt.
 *
 * Das schwächste und nicht der Durchschnitt: eine gute Zahl neben einer
 * schlechten ist keine halb gute Auskunft, sondern eine falsche. Wer wissen
 * will, ob die Box lesbar ist, will die schlechteste Stelle wissen.
 *
 * `wert: 0` heisst „nicht messbar" (eine Farbe fehlt) — nicht „bestens".
 */
export function schwaechsterKontrast(farben: Record<string, string>): { wert: number; wo: string } {
  let raus = { wert: 0, wo: '' }
  for (const p of SCHRIFTPAARE) {
    const k = kontrast(farben[p.vg], farben[p.hg])
    if (k === 0) continue
    if (raus.wo === '' || k < raus.wert) raus = { wert: k, wo: p.wo }
  }
  return raus
}
