#!/usr/bin/env node
/**
 * GESTEN-INVENTUR — welche Finger-Geste ist in der neuen Oberflaeche schon
 * vergeben, und WO auf dem Schirm liegt sie?
 *
 * WOFUER. Wer eine neue Geste entwirft (E31/P1: „Geste UND Zahlenfolge,
 * waehlbar"), ohne diese Liste zu haben, kapert eine vorhandene. Eine
 * gekaperte Geste faellt nicht auf: Beide Zuhoerer feuern, beide tun etwas,
 * und welcher gewinnt, entscheidet die Reihenfolge der Registrierung — am
 * Ziel-Element auch gegen einen spaeteren Zuhoerer mit `capture: true`
 * (nachgewiesen in app.js bei `elternEinstieg`).
 *
 * WAS ES LIEST, und was ausdruecklich nicht. Gelesen wird der QUELLTEXT von
 * NewDesign/app.js und NewDesign/index.html — statisch, ohne Browser. Das ist
 * Absicht: die Frage „ist diese Geste frei?" muss beantwortbar sein, BEVOR
 * eine Vorschau laeuft, und sie darf nicht davon abhaengen, ob gerade ein
 * Fenster offen ist. Was ein statischer Lauf NICHT sehen kann, steht unten
 * unter „BLINDE FLECKEN" und wird mit ausgegeben, statt verschwiegen zu
 * werden — eine Inventur, die ihre Luecken nicht nennt, luegt durch Weglassen.
 *
 * AUFRUF
 *   node tools/gesten-inventur.mjs              alle Zuhoerer, nach Art
 *   node tools/gesten-inventur.mjs --frei       nur: was ist NICHT belegt
 *   node tools/gesten-inventur.mjs --datei X    eine andere Datei pruefen
 *   node tools/gesten-inventur.mjs --json       maschinenlesbar
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = resolve(HIER, '..')

const argv = process.argv.slice(2)
const hat = (f) => argv.includes(f)
const wert = (f, vor) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : vor
}

/**
 * Die Ereignisse, die eine GESTE tragen koennen.
 *
 * `load`, `error`, `ended`, `input`, `change` sind ausdruecklich NICHT dabei:
 * sie kommen von Bildern, Tonspuren und Formularen, nicht von einem Finger.
 * Wer sie mitzaehlt, bekommt 40 Treffer und liest keinen davon.
 */
const GESTEN_ARTEN = [
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointercancel',
  'pointerleave',
  'pointerenter',
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
  'click',
  'dblclick',
  'contextmenu',
  'mousedown',
  'mouseup',
  'mousemove',
  'wheel',
  'keydown',
  'keyup',
  'scroll',
]

/** Was NUR nach Geste aussieht, aber keine ist. */
const KEINE_GESTE = new Set([
  'load',
  'error',
  'ended',
  'pause',
  'play',
  'input',
  'change',
  'visibilitychange',
  'transitionend',
  'animationend',
  'message',
  'resize',
])

function zeilenNummer(text, index) {
  let n = 1
  for (let i = 0; i < index; i++) if (text[i] === '\n') n++
  return n
}

/** Den Text der Zeile holen, in der ein Treffer steht. */
function zeileText(zeilen, nr) {
  return (zeilen[nr - 1] || '').trim()
}

/**
 * Das Ziel eines Zuhoerers benennen — so, wie ein Mensch es sucht.
 *
 * `$('wappen').addEventListener(...)`      -> `#wappen`
 * `document.addEventListener(...)`         -> `document` (das ganze Haus!)
 * `k.addEventListener(...)`                -> die Variable, plus die Zeilen
 *                                             davor als Hinweis, was `k` ist.
 */
function zielBenennen(vorText) {
  // `vorText` endet unmittelbar VOR dem Wort `addEventListener`, also auf dem
  // Punkt. Der Ausdruck darf ihn deshalb nicht noch einmal verlangen.
  const m = vorText.match(/([A-Za-z_$][\w$]*(?:\([^()]*\))?(?:\.[A-Za-z_$][\w$]*)*)\s*\.\s*$/)
  if (!m) return '?'
  const roh = m[1]
  const d = roh.match(/^\$\(\s*['"]([^'"]+)['"]\s*\)$/)
  if (d) return '#' + d[1]
  return roh
}

/**
 * Steht `capture: true` in den Optionen DIESES Zuhoerers?
 *
 * DER AUSSCHNITT MUSS BEGRENZT SEIN, und das ist kein Feinschliff: Wer
 * pauschal die naechsten 400 Zeichen absucht, findet das `capture: true` des
 * NAECHSTEN Zuhoerers und meldet es beim vorigen. Genau so entstand im ersten
 * Lauf die Falschmeldung, `pointercancel` in `elternEinstieg` sei fangend.
 * Der Ausschnitt endet deshalb am naechsten `addEventListener`.
 */
function fangend(nachText) {
  const ende = nachText.slice(1).indexOf('addEventListener')
  const raum = nachText.slice(0, ende >= 0 ? ende : 400)
  return /capture\s*:\s*true/.test(raum)
}

/**
 * Traegt dieser Zuhoerer eine ZEITMESSUNG — also langes Halten?
 *
 * 300 ms ist die Grenze: darunter ist es eine Entprellung, darueber eine
 * Geste, die der Benutzer HALTEN muss.
 *
 * GESUCHT WIRD DAS ENDE, nicht der Anfang: `setTimeout(() => { … }, 700)` hat
 * zwischen Klammer und Zahl beliebig viel Rumpf mit eigenen Klammern. Ein
 * Ausdruck, der bei `setTimeout(` anfaengt und `[^)]*` verlangt, findet ihn
 * nie. Gesucht wird deshalb `}, <Zahl>)` im Ausschnitt bis zum naechsten
 * Zuhoerer.
 */
function halteZeit(nachText) {
  const ende = nachText.slice(1).indexOf('addEventListener')
  const raum = nachText.slice(0, ende >= 0 ? ende : 800)
  if (!/setTimeout\s*\(/.test(raum)) return null
  let beste = null
  for (const m of raum.matchAll(/[})]\s*,\s*(\d{3,5})\s*\)/g)) {
    const ms = Number(m[1])
    if (ms >= 300 && (beste === null || ms > beste)) beste = ms
  }
  return beste
}

function inventur(datei) {
  const pfad = resolve(WURZEL, datei)
  const text = readFileSync(pfad, 'utf8')
  const zeilen = text.split('\n')
  const treffer = []

  const re = /addEventListener\s*\(\s*(['"])([a-z]+)\1/g
  let m
  while ((m = re.exec(text)) !== null) {
    const art = m[2]
    if (KEINE_GESTE.has(art)) continue
    const nr = zeilenNummer(text, m.index)
    const vor = text.slice(Math.max(0, m.index - 120), m.index)
    treffer.push({
      datei,
      zeile: nr,
      art,
      geste: !GESTEN_ARTEN.includes(art) ? art + ' (?)' : art,
      ziel: zielBenennen(vor),
      fangend: fangend(text.slice(m.index)),
      halten: halteZeit(text.slice(m.index)),
      quelle: zeileText(zeilen, nr),
    })
  }

  // Die Schleifen-Form: `for (const art of [...]) document.addEventListener(art, ...)`
  // Der reguläre Ausdruck oben sieht sie NICHT, weil die Art eine Variable
  // ist. Sie wird eigens gesucht — sonst fehlten genau die Zuhoerer, die am
  // ganzen Dokument haengen, und das sind die gefaehrlichsten.
  const reSchleife = /for\s*\(\s*const\s+(\w+)\s+of\s*\[([^\]]+)\]\s*\)/g
  while ((m = reSchleife.exec(text)) !== null) {
    const folgt = text.slice(m.index, m.index + 400)
    if (!/addEventListener\s*\(\s*\w+\s*,/.test(folgt)) continue
    const nr = zeilenNummer(text, m.index)
    for (const roh of m[2].split(',')) {
      const art = roh.trim().replace(/^['"]|['"]$/g, '')
      if (!art || KEINE_GESTE.has(art)) continue
      const zielM = folgt.match(/([A-Za-z_$][\w$.()'"\-]*)\s*\.addEventListener/)
      treffer.push({
        datei,
        zeile: nr,
        art,
        geste: art,
        ziel: zielM ? zielBenennen(zielM[1] + '.addEventListener') : '?',
        fangend: /capture\s*:\s*true/.test(folgt),
        halten: null,
        quelle: zeileText(zeilen, nr) + '  (Schleife)',
      })
    }
  }

  return treffer
}

/** Zuhoerer, die am ganzen Dokument haengen — die kapern am leichtesten. */
function amHaus(t) {
  return t.ziel === 'document' || t.ziel === 'window' || t.ziel === 'document.body'
}

const dateien = hat('--datei') ? [wert('--datei')] : ['NewDesign/app.js', 'NewDesign/index.html']
const alle = dateien.flatMap(inventur)

if (hat('--json')) {
  console.log(JSON.stringify({ dateien, treffer: alle }, null, 2))
  process.exit(0)
}

const nachArt = new Map()
for (const t of alle) {
  if (!nachArt.has(t.art)) nachArt.set(t.art, [])
  nachArt.get(t.art).push(t)
}

if (!hat('--frei')) {
  console.log('GESTEN-INVENTUR — ' + dateien.join(', '))
  console.log('='.repeat(72))
  console.log(alle.length + ' Zuhoerer, die ein Finger ausloesen kann.\n')

  const reihenfolge = [
    'pointerdown',
    'pointermove',
    'pointerup',
    'pointercancel',
    'pointerleave',
    'touchstart',
    'touchmove',
    'touchend',
    'dblclick',
    'contextmenu',
    'wheel',
    'keydown',
    'scroll',
    'click',
  ]
  const arten = [...nachArt.keys()].sort(
    (a, b) => (reihenfolge.indexOf(a) + 99) % 199 - ((reihenfolge.indexOf(b) + 99) % 199),
  )

  for (const art of arten) {
    const liste = nachArt.get(art)
    console.log('── ' + art + '  (' + liste.length + ')')
    for (const t of liste) {
      const marken = []
      if (t.fangend) marken.push('FANGEND')
      if (t.halten) marken.push('HALTEN ' + t.halten + ' ms')
      if (amHaus(t)) marken.push('GANZES DOKUMENT')
      console.log(
        '   ' +
          String(t.zeile).padStart(5) +
          '  ' +
          t.ziel.padEnd(22) +
          (marken.length ? '[' + marken.join(', ') + ']' : ''),
      )
    }
    console.log('')
  }
}

console.log('─'.repeat(72))
console.log('WAS DAS HEISST')
console.log('─'.repeat(72))

const haus = alle.filter(amHaus)
console.log('\nAm GANZEN DOKUMENT haengen ' + haus.length + ' Zuhoerer:')
for (const t of haus) {
  console.log('   ' + t.art.padEnd(14) + 'Z. ' + t.zeile + '   ' + t.quelle.slice(0, 60))
}

const halten = alle.filter((t) => t.halten)
console.log('\nLANGES HALTEN ist vergeben an ' + halten.length + ' Stelle(n):')
for (const t of halten) {
  console.log('   ' + t.ziel.padEnd(20) + t.halten + ' ms   Z. ' + t.zeile)
}

const doppelt = alle.filter((t) => t.art === 'dblclick')
const rechts = alle.filter((t) => t.art === 'contextmenu')
const mehrfinger = alle.filter((t) => t.art.startsWith('touch'))

console.log('\nWAS NIRGENDS BELEGT IST (Kandidaten fuer eine neue Geste):')
if (!doppelt.length) console.log('   dblclick     — kein einziger Zuhoerer')
if (!rechts.length) console.log('   contextmenu  — kein einziger Zuhoerer (= langes Halten am Touch!)')
if (!mehrfinger.length)
  console.log('   touchstart/-move/-end — kein einziger Zuhoerer; MEHRFINGER ist voellig frei')

console.log('\nBLINDE FLECKEN dieses Laufs — was er NICHT sehen kann:')
console.log('   * Zuhoerer der Angular-App (src/frontend-box/) — eigene Oberflaeche,')
console.log('     eigener Schirm. Beim Seitenwechsel gilt dort deren Belegung.')
console.log('   * Vom Browser selbst belegte Gesten: Doppeltipp = Zoom, langes')
console.log('     Halten = Auswahl/Kontextmenue, Zwei-Finger = Zoom/Rollen. Sie')
console.log('     stehen in KEINER Datei und sind trotzdem vergeben.')
console.log('   * CSS `touch-action` — es entscheidet mit, ob eine Geste beim')
console.log('     Skript ankommt. Siehe: grep -n "touch-action" NewDesign/app.css')
console.log('   * Zuhoerer, die erst zur Laufzeit auf gemalten Knoepfen entstehen,')
console.log('     sind erfasst (sie stehen im Quelltext), aber ihr ZIEL heisst hier')
console.log('     nur `k` — welcher Knopf das ist, sagt die Zeile daneben.')
