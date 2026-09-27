#!/usr/bin/env node
/**
 * BORGT SICH EIN WERKZEUG ETWAS, OHNE ES ZURUECKZULEGEN? — Quelltextpruefung.
 *
 * WOFUER: Am 04.08.2026 hat sich zweimal derselbe Schaden gezeigt, und beide
 * Male meldete er sich NICHT als Fehler, sondern als falsches Messergebnis:
 *
 *   1. tools/marke-tanzt.mjs liess die geliehene Vorschau auf
 *      `/vorschau/marke-ruhig` stehen. tools/raster-marke-schau.mjs meldete
 *      daran zwei Fehler, die es nicht gab. Am selben Tag stand eine verwaiste
 *      Vorschau zwei Stunden auf `einstellungssperre: pin`, obwohl die Vorgabe
 *      `aus` ist.
 *   2. Feste Debug-Ports (9361 in vier Werkzeugen, 9351 in vier, 9357 in drei,
 *      9347 in drei). Haelt ein Browser aus einem harten Abbruch den Port, so
 *      bindet der eigene ihn NICHT — und `/json/list` liefert klaglos die
 *      Ziele des fremden. Ein Lauf von 40 Sekunden brauchte so ueber acht
 *      Minuten und meldete Fehler ueber eine Seite, die niemand gemessen hatte.
 *
 * Beides ist in tools/leihgabe.mjs behoben. DIESE PRUEFUNG SORGT DAFUER, DASS
 * ES BEHOBEN BLEIBT: Der naechste, der ein Messwerkzeug schreibt, schreibt es
 * vom Nachbarn ab — so sind die neunzehn Kopien ueberhaupt erst entstanden.
 * Eine Pruefung, die im Quelltext nachsieht, faengt die zwanzigste, bevor
 * jemand acht Minuten auf sie wartet.
 *
 * WAS SIE MISST — vier Fragen je Werkzeug in tools/*.mjs:
 *
 *   A. Steht darin ein FESTER Debug-Port (`--remote-debugging-port=<zahl>`)?
 *   B. Startet es einen Browser von Hand, statt `eigenerBrowser()` zu nehmen?
 *   C. Stellt es Lagen (`/vorschau/…`), ohne `vorschauLeihen()` zu benutzen?
 *   D. Benutzt es `vorschauLeihen()` — und ruft `zurueckgeben()` auch im
 *      `finally`? Ein Aufruf, der nur auf dem gruenen Weg steht, ist der
 *      schlimmere Fall: Er laesst die Vorschau gerade dann verstellt stehen,
 *      wenn ein Fehler gefunden wurde — also genau dann, wenn als naechstes
 *      jemand hinsieht.
 *
 * SIE OEFFNET KEINEN BROWSER UND KEINE VORSCHAU. Reine Quelltextlesung,
 * schnell genug fuer tools/pruefen.sh.
 *
 * WAS SIE NICHT KANN: Ob `zurueckgeben()` zur LAUFZEIT auch erreicht wird,
 * sagt nur ein Lauf. Sie prueft die Gestalt, nicht das Verhalten — und das ist
 * die ehrliche Grenze einer Quelltextpruefung.
 *
 * AUFRUF
 *     node tools/leihgabe-pruefen.mjs             # Tabelle
 *     node tools/leihgabe-pruefen.mjs --pruefen   # Ende 1 bei Abweichung
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRUEFEN = process.argv.includes('--pruefen')
const HIER = dirname(fileURLToPath(import.meta.url))

/** Das Modul selbst und die Attrappe sind nicht gemeint: das eine IST die
 *  Loesung, das andere ist der Server, den die anderen leihen. */
const AUSGENOMMEN = new Set(['leihgabe.mjs', 'leihgabe-pruefen.mjs', 'neu-vorschau.mjs'])

/** Kommentare heraus, bevor gesucht wird. Sonst schlaegt jede Pruefung bei den
 *  Saetzen an, die die Regel ERKLAEREN — dieselbe Falle, in die schon der
 *  erste Anlauf von tools/raster-marke-schau.mjs getappt ist, als er das Wort
 *  `lane-laeuft` verbot und prompt seinen eigenen Begruendungskommentar traf. */
function ohneKommentare(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((z) => !z.trim().startsWith('//'))
    .join('\n')
    .replace(/([^:])\/\/.*$/gm, '$1')
}

let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}

/**
 * ALLE UNTERORDNER MIT, und das ist keine Feinheit: Die vier Werkzeuge in
 * tools/e2e/ tragen denselben Fehler, und zwei von ihnen sogar dieselben
 * NUMMERN wie ihre Nachbarn eine Ebene hoeher (9351 wie tools/marke-tanzt.mjs,
 * 9353 wie tools/marke-am-geraet.mjs). Eine Pruefung, die nur die oberste
 * Ebene liest, haette „keine Abweichung" gemeldet und genau die Kollisionen
 * uebersehen, um die es geht.
 *
 * `.test.mjs` IST NICHT AUSGENOMMEN, aus demselben Grund:
 * tools/e2e/neu-oberflaeche.test.mjs startete einen Browser auf fester 9353.
 * Dass eine Datei „Test" heisst, macht ihren Port nicht eindeutig.
 */
function alleWerkzeuge(ordner) {
  return readdirSync(ordner, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : alleWerkzeuge(join(ordner, e.name))
    return e.name.endsWith('.mjs') && !AUSGENOMMEN.has(e.name) ? [join(ordner, e.name)] : []
  })
}

const dateien = alleWerkzeuge(HIER).sort()

console.log('\nGELIEHENES ZURUECKLEGEN  (Quelltext)\n')
let geprueft = 0
for (const pfad of dateien) {
  const name = pfad.slice(HIER.length + 1)
  const roh = readFileSync(pfad, 'utf8')
  const t = ohneKommentare(roh)
  const befunde = []

  // ── A. FESTER DEBUG-PORT ────────────────────────────────────────────────
  //
  // ZWEI GESTALTEN, und die zweite ist die, die es wirklich gab. Kein einziges
  // der 23 Werkzeuge schrieb die Nummer direkt in den Schalter; alle schrieben
  // `--remote-debugging-port=${port}` und die Zahl eine Zeile hoeher in eine
  // Konstante. Eine Pruefung, die nur nach `=9351` sucht, haette am
  // 04.08.2026 „keine Abweichung" gemeldet — waehrend vier Werkzeuge auf 9361
  // sassen, vier auf 9351, drei auf 9357 und drei auf 9347.
  const direkt = t.match(/--remote-debugging-port=(\d+)/)
  if (direkt) befunde.push(`fester Debug-Port ${direkt[1]} — \`eigenerBrowser()\` holt einen freien`)
  else {
    const ueberName = t.match(/--remote-debugging-port=\$\{(\w+)\}/)
    if (ueberName) {
      const zahl = t.match(new RegExp(`\\b(?:const|let|var)\\s+${ueberName[1]}\\s*=\\s*(\\d+)`))
      if (zahl)
        befunde.push(`fester Debug-Port ${zahl[1]} in \`${ueberName[1]}\` — \`eigenerBrowser()\` holt einen freien`)
    }
  }

  // ── B. EIGENHAENDIG GESTARTETER BROWSER ─────────────────────────────────
  const eigenhaendig = /--headless=new/.test(t) && !/eigenerBrowser\(/.test(t)
  if (eigenhaendig) befunde.push('startet Chromium selbst statt ueber `eigenerBrowser()` (tools/leihgabe.mjs)')

  // ── C. LAGEN STELLEN OHNE LEIHE ─────────────────────────────────────────
  //
  // NUR die klebrigen Wege zaehlen. `/vorschau/befehle`, `/vorschau/lage` und
  // `/vorschau/gesprochen` LESEN nur; wer sie abruft, hat nichts verstellt und
  // braucht auch nichts zurueckzulegen.
  const stelltLage = [...t.matchAll(/\/vorschau\/([a-z][a-z0-9-]*)/g)]
    .map((m) => m[1])
    .filter((w) => !['befehle', 'befehle-leeren', 'lage', 'gesprochen', 'gesprochen-leeren'].includes(w))
  const leiht = /vorschauLeihen\(/.test(t)
  if (stelltLage.length && !leiht) {
    const wie = [...new Set(stelltLage)].slice(0, 4).join(', ')
    befunde.push(`stellt Lagen (${wie}${stelltLage.length > 4 ? ', …' : ''}) ohne \`vorschauLeihen()\``)
  }

  // ── D. ZURUECKGELEGT — UND ZWAR IM `finally` ────────────────────────────
  if (leiht) {
    if (!/zurueckgeben\(\)/.test(t)) {
      befunde.push('leiht die Vorschau, legt sie aber nie zurueck (`leihe.zurueckgeben()` fehlt)')
    } else {
      // Steht mindestens ein `zurueckgeben()` NACH einem `finally {`? Grob
      // gelesen, aber grob genug: der Fall, der schiefgeht, ist „nur am Ende
      // des gruenen Wegs", und dort steht kein `finally` davor.
      const f = t.indexOf('finally')
      const z = t.lastIndexOf('zurueckgeben()')
      if (f < 0 || z < f) {
        befunde.push('`zurueckgeben()` steht nicht im `finally` — bei einem Fehler bleibt die Lage stehen')
      }
    }
  }

  if (!befunde.length) continue
  geprueft++
  console.log(`  ${name}`)
  for (const b of befunde) melde(`${name}: ${b}`)
}

if (!geprueft) {
  console.log(`  ${dateien.length} Werkzeuge — keins borgt sich etwas, ohne es zurueckzulegen.`)
}
console.log(fehler ? `\n  ${fehler} Abweichung(en).\n` : '\n  keine Abweichung.\n')
process.exit(PRUEFEN && fehler ? 1 : 0)
