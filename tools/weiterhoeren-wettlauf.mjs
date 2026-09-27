#!/usr/bin/env node
/*
 * WOZU
 *   Einen WETTLAUF zaehlt man nicht an einem Lauf ab. Dieses Werkzeug ruft
 *   tools/weiterhoeren-am-geraet.mjs mehrfach auf und stellt die Trefferquote
 *   zweier Varianten nebeneinander:
 *
 *     OHNE Atempause   `stop` und Startbefehl gehen ohne Abstand hinaus —
 *                      so, wie NewDesign/app.js `weiterSpielen` es tut.
 *     MIT  Atempause   dazwischen wird gewartet (--warten).
 *
 *   Gemessen wird je Runde: „meldet die Box waehrend der Wiedergabe
 *   `is_playing: false`?" Das ist der gemeldete Fehler — Ton laeuft, die
 *   Anzeige steht auf „play" und der Balken auf 0.
 *
 * AUFRUF
 *   node tools/weiterhoeren-wettlauf.mjs --box 192.168.178.169 --runden 4
 *   node tools/weiterhoeren-wettlauf.mjs --runden 4 --warten 1500
 *   node tools/weiterhoeren-wettlauf.mjs --runden 4 --nur mit    # bzw. ohne
 *
 * DAUER
 *   Rund 50 s je Runde und Variante (20 s Vorlauf, damit wirklich etwas
 *   LAEUFT — aus einer ruhenden Box heraus ist der Fall nicht zu stellen).
 *
 * ZURUECKSTELLEN
 *   Das gerufene Werkzeug haelt am Ende jeder Runde selbst an (finally).
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ausfuehren = promisify(execFile)
const HIER = path.dirname(fileURLToPath(import.meta.url))
const MESSER = path.join(HIER, 'weiterhoeren-am-geraet.mjs')

const args = process.argv.slice(2)
const opt = (n, s = null) => {
  const i = args.indexOf(n)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : s
}

const BOX = opt('--box', '192.168.178.169')
const RUNDEN = Number(opt('--runden', '3'))
const WARTEN = opt('--warten', '1500')
const NUR = opt('--nur', null)
const NR = opt('--nr', '1')

async function runde(mitAtempause) {
  const a = ['--box', BOX, '--nr', NR, '--vorlauf', '20', '--sekunden', '14', '--ton']
  if (mitAtempause) a.push('--warten', WARTEN)
  const { stdout } = await ausfuehren('node', [MESSER, ...a], { timeout: 300000, maxBuffer: 16 * 1024 * 1024 })
  const t = String(stdout)
  const zahl = (muster) => {
    const m = t.match(muster)
    return m ? Number(m[1]) : null
  }
  const steht = zahl(/Titel da, aber „steht":\s+(\d+)/)
  const laeuft = zahl(/„laeuft" \(Pause-Symbol\):\s+(\d+)/)
  const weg = zahl(/gar nichts \(Leiste weg\):\s+(\d+)/)
  const ton = /TON LAEUFT/.test(t)
  return { steht, laeuft, weg, ton, fehler: ton && steht > 2 }
}

async function serie(mitAtempause, name) {
  const ergebnisse = []
  for (let i = 1; i <= RUNDEN; i++) {
    process.stdout.write(`  ${name} Runde ${i}/${RUNDEN} … `)
    try {
      const r = await runde(mitAtempause)
      ergebnisse.push(r)
      console.log(
        `steht=${r.steht} laeuft=${r.laeuft} wegg=${r.weg} ton=${r.ton ? 'ja' : 'NEIN'}  ${r.fehler ? '<<< FEHLER' : 'ok'}`,
      )
    } catch (e) {
      console.log(`Abbruch: ${String(e.message).slice(0, 90)}`)
      ergebnisse.push({ fehler: null })
    }
  }
  const schlecht = ergebnisse.filter((r) => r.fehler === true).length
  console.log(`  => ${name}: ${schlecht} von ${ergebnisse.length} Runden mit dem Fehler\n`)
  return schlecht
}

console.log(`Wettlauf-Messung an ${BOX}, ${RUNDEN} Runden je Variante.`)
console.log('Der Fehler heisst: Ton laeuft, aber die Box meldet „spielt nicht".\n')

let a = null
let b = null
if (NUR !== 'mit') a = await serie(false, 'OHNE Atempause')
if (NUR !== 'ohne') b = await serie(true, `MIT  ${WARTEN} ms      `)

console.log('══ ERGEBNIS ══')
if (a !== null) console.log(`  ohne Atempause: ${a}/${RUNDEN} fehlerhaft`)
if (b !== null) console.log(`  mit Atempause:  ${b}/${RUNDEN} fehlerhaft`)
