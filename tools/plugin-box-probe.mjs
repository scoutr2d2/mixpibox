#!/usr/bin/env node
/**
 * PLUGIN-BOX-PROBE — dieselben Fragen, aber AUF DER BOX.
 *
 * tools/plugin-ladeweg-probe.mjs laeuft auf dem Entwicklungsrechner (x86, viel
 * Speicher). Die Zahlen, die dort herauskommen, sind fuer eine Kaufentscheidung
 * wertlos: die Box hat 2 GB und vier Kerne, und was dort 13 MB kostet, kann hier
 * das Dreifache kosten. Diese Probe beantwortet deshalb NUR die Fragen, die
 * Hardware braucht — und sie ist absichtlich EIGENSTAENDIG, damit sie sich mit
 * einem scp auf die Box tragen laesst, ohne den Baum mitzuschleppen.
 *
 * SIE FASST DIE BOX NICHT AN. Kein Dienst wird angehalten, keine Datei ausserhalb
 * von /tmp geschrieben, nichts installiert. Was sie kostet, ist Speicher fuer die
 * Dauer des Laufs — und den misst sie mit.
 *
 * Aufruf auf der Box:
 *   node /tmp/plugin-box-probe.mjs [pfad/zu/plugin-laufwerk.js]
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const WERK = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-box-'))
const LAUFWERK = process.argv[2] || '/tmp/plugin-laufwerk.js'
let fehler = 0

const sagen = (frage, befund, gut) => {
  if (!gut) fehler++
  console.log(`${gut ? '  ok  ' : ' FEHL '} ${frage}\n         ${befund}`)
}
const mb = (b) => (Number.isFinite(b) ? `${(b / 1024 / 1024).toFixed(1)} MB` : 'nicht messbar')

/** Was hat die Box ueberhaupt? Ohne das sind alle Zahlen unten heimatlos. */
function lage() {
  const modell = (() => {
    try {
      return fs.readFileSync('/proc/device-tree/model', 'utf8').replace(/\0/g, '').trim()
    } catch {
      return 'unbekannt'
    }
  })()
  const info = fs.readFileSync('/proc/meminfo', 'utf8')
  const zahl = (name) =>
    Number(/^\w+:\s+(\d+) kB$/m.exec(info.split('\n').find((z) => z.startsWith(name)) ?? '')?.[1] ?? 0)
  const gesamt = zahl('MemTotal') * 1024
  const frei = zahl('MemAvailable') * 1024
  const seite = Number(execFileSync('getconf', ['PAGESIZE'], { encoding: 'utf8' }).trim()) || 4096
  console.log(
    `${modell} — ${os.arch()}, Node ${process.versions.node}, ${os.cpus().length} Kerne, ${seite}-Byte-Seiten`,
  )
  console.log(`Speicher: ${mb(gesamt)} gesamt, ${mb(frei)} verfuegbar\n`)
  return { gesamt, frei }
}

/** Ein Stueck Node in einem eigenen Prozess laufen lassen und die Zahl lesen. */
function messen(name, quelle) {
  const datei = path.join(WERK, `${name}.mjs`)
  fs.writeFileSync(datei, quelle)
  try {
    return Number(execFileSync(process.execPath, [datei], { encoding: 'utf8', stdio: 'pipe', timeout: 60000 }).trim())
  } catch (e) {
    console.error(`  (${name} scheiterte: ${String(e.stderr || e.message).split('\n')[0]})`)
    return Number.NaN
  }
}

function speicherPruefen(frei) {
  const grund = messen('grund', 'console.log(process.memoryUsage().rss)\n')

  const mitWorkern = messen(
    'worker',
    [
      "import { Worker } from 'node:worker_threads'",
      'const w = []',
      "for (let i = 0; i < 5; i++) w.push(new Worker('setInterval(()=>{},1e9)', { eval: true }))",
      'await new Promise((f) => setTimeout(f, 2000))',
      'console.log(process.memoryUsage().rss)',
      'for (const x of w) await x.terminate()',
    ].join('\n'),
  )

  // DIE SEITENGROESSE WIRD GEFRAGT, NICHT GERATEN.
  //
  // `/proc/<pid>/statm` zaehlt SEITEN, nicht Bytes. Die erste Fassung dieser
  // Probe rechnete mit fest verdrahteten 4096 — und lieferte auf der Box
  // 11,7 MB je fork gegen 53,8 MB auf dem Entwicklungsrechner, also den
  // absurden Schluss „fork kostet auf dem Pi genauso wenig wie ein Worker".
  // Ein Raspberry Pi 5 laeuft mit 16384-Byte-Seiten (gemessen 2026-08-14,
  // `getconf PAGESIZE`); die Zahl war um genau den Faktor 4 zu klein. Wer eine
  // Seitengroesse annimmt, misst am Ende die Annahme.
  const seite = Number(execFileSync('getconf', ['PAGESIZE'], { encoding: 'utf8' }).trim()) || 4096

  const mitKindern = messen(
    'fork',
    [
      "import { fork } from 'node:child_process'",
      "import fs from 'node:fs'",
      `const SEITE = ${seite}`,
      "const datei = new URL('./kind.mjs', import.meta.url)",
      "fs.writeFileSync(datei, 'setInterval(()=>{},1e9)\\n')",
      'const k = []',
      "for (let i = 0; i < 5; i++) k.push(fork(datei, { stdio: 'ignore' }))",
      'await new Promise((f) => setTimeout(f, 2000))',
      'let summe = process.memoryUsage().rss',
      'for (const x of k) {',
      '  try {',
      "    summe += Number(fs.readFileSync(`/proc/${x.pid}/statm`, 'utf8').split(' ')[1]) * SEITE",
      '  } catch {}',
      '}',
      'console.log(summe)',
      'for (const x of k) x.kill()',
    ].join('\n'),
  )

  const jeWorker = (mitWorkern - grund) / 5
  const jeKind = (mitKindern - grund) / 5

  console.log('  Speicher (RSS, 5 Isolate, AUF DER BOX):')
  console.log(`         nackter Node-Prozess          ${mb(grund)}`)
  console.log(`         + 5 worker_threads            ${mb(mitWorkern)}   → ${mb(jeWorker)} je Plugin`)
  console.log(`         + 5 child_process.fork        ${mb(mitKindern)}   → ${mb(jeKind)} je Plugin`)

  sagen(
    'worker_threads billiger als fork?',
    Number.isFinite(jeWorker) && Number.isFinite(jeKind) ? `Faktor ${(jeKind / jeWorker).toFixed(1)}` : 'nicht messbar',
    Number.isFinite(jeWorker) && Number.isFinite(jeKind) && jeWorker < jeKind,
  )

  // DIE FRAGE, DIE WIRKLICH ZAEHLT: passen drei Plugins in den freien Speicher,
  // OHNE dass die Box ins Auslagern geraet? Drei, weil das eine realistische
  // Ausstattung ist (eine Medienquelle, ein Licht, ein Haussteuerungs-Plugin).
  const drei = jeWorker * 3
  const anteil = (drei / frei) * 100
  sagen(
    'drei Plugins im verfuegbaren Speicher — mit Luft?',
    `${mb(drei)} von ${mb(frei)} verfuegbar (${anteil.toFixed(1)} %)`,
    Number.isFinite(anteil) && anteil < 10,
  )
  return jeWorker
}

function endlosschleifePruefen() {
  const datei = path.join(WERK, 'schleife.mjs')
  fs.writeFileSync(
    datei,
    [
      "import { Worker } from 'node:worker_threads'",
      "const w = new Worker('while (true) {}', { eval: true })",
      'const start = Date.now()',
      'await new Promise((f) => setTimeout(f, 300))',
      'await w.terminate()',
      'console.log(Date.now() - start)',
    ].join('\n'),
  )
  let ms = Number.NaN
  try {
    ms = Number(execFileSync(process.execPath, [datei], { encoding: 'utf8', stdio: 'pipe', timeout: 30000 }).trim())
  } catch {
    ms = Number.NaN
  }
  sagen(
    'holt worker.terminate() eine SYNCHRONE Endlosschleife ein?',
    Number.isFinite(ms) ? `ja, nach ${ms} ms beendet` : 'NEIN / Zeitablauf — nicht abbrechbar',
    Number.isFinite(ms),
  )
}

/** Und traegt das AUSGELIEFERTE Laufwerk hier genauso wie auf dem Entwicklungsrechner? */
async function laufwerkPruefen() {
  if (!fs.existsSync(LAUFWERK)) {
    sagen('liegt plugin-laufwerk.js bereit?', `nicht gefunden unter ${LAUFWERK}`, false)
    return
  }
  const ordner = path.join(WERK, 'plugin')
  fs.mkdirSync(ordner, { recursive: true })
  fs.writeFileSync(
    path.join(ordner, 'index.mjs'),
    `export default {
       async aufloesen(rest, kontext) {
         if (!kontext.holen) throw new Error('kein Netz-Recht')
         return { titel: { name: 'Folge ' + rest }, quelle: { art: 'strom', adresse: 'https://example.org/x.mp3' } }
       },
     }`,
  )

  const { Worker } = await import('node:worker_threads')
  const antwort = await new Promise((fertig) => {
    const w = new Worker(LAUFWERK, {
      workerData: {
        manifest: { kennung: 'probe', name: 'Probe', fassung: '1.0.0', haupt: 'index.mjs', rechte: ['netz'] },
        ordner,
        einstellungen: {},
        fristMs: 3000,
        eigeneAdressen: ['127.0.0.1'],
      },
      resourceLimits: { maxOldGenerationSizeMb: 48, maxYoungGenerationSizeMb: 8 },
    })
    const uhr = setTimeout(() => {
      void w.terminate()
      fertig('Zeitablauf')
    }, 15000)
    const schluss = (t) => {
      clearTimeout(uhr)
      void w.terminate()
      fertig(t)
    }
    w.on('message', (n) => {
      if (n.art === 'bereit') w.postMessage({ art: 'ruf', nr: 1, verb: 'aufloesen', arg: '4711' })
      if (n.art === 'ladefehler') schluss(`Ladefehler: ${String(n.meldung).split('\n')[0]}`)
      if (n.art === 'antwort') schluss(n.wert?.titel?.name ?? '(leer)')
      if (n.art === 'fehler') schluss(`Fehler: ${n.meldung}`)
    })
    w.on('error', (e) => schluss(`Worker-Fehler: ${e.message}`))
  })
  sagen(
    'laedt das gebaute Laufwerk hier ein Plugin und antwortet?',
    antwort === 'Folge 4711' ? 'ja — "Folge 4711" zurueck' : antwort,
    antwort === 'Folge 4711',
  )

  // Und haelt die Speichergrenze? Ein Plugin, das frisst, muss STERBEN, nicht
  // die Box in den OOM-Killer treiben. Auf 2 GB ist das keine Theorie.
  const gefressen = await new Promise((fertig) => {
    fs.writeFileSync(
      path.join(ordner, 'gierig.mjs'),
      `export default {
         async aufloesen() {
           const halde = []
           while (true) halde.push(new Array(1e6).fill(Math.random()))
         },
       }`,
    )
    const w = new Worker(LAUFWERK, {
      workerData: {
        manifest: { kennung: 'gierig', name: 'Gierig', fassung: '1.0.0', haupt: 'gierig.mjs', rechte: [] },
        ordner,
        einstellungen: {},
        fristMs: 3000,
        eigeneAdressen: [],
      },
      resourceLimits: { maxOldGenerationSizeMb: 48, maxYoungGenerationSizeMb: 8 },
    })
    const uhr = setTimeout(() => {
      void w.terminate()
      fertig('lebt nach 30 s noch — Grenze griff NICHT')
    }, 30000)
    w.on('message', (n) => {
      if (n.art === 'bereit') w.postMessage({ art: 'ruf', nr: 1, verb: 'aufloesen', arg: 'x' })
    })
    // ERWARTET WIRD EIN 'error' MIT ERR_WORKER_OUT_OF_MEMORY.
    w.on('error', (e) => {
      clearTimeout(uhr)
      fertig(e.message)
    })
    w.on('exit', () => {
      clearTimeout(uhr)
      fertig('Worker beendet')
    })
  })
  sagen(
    'stirbt ein speicherfressendes Plugin an seiner Grenze?',
    gefressen,
    /out of memory|heap out of memory|beendet/i.test(gefressen),
  )
}

const { frei } = lage()
speicherPruefen(frei)
endlosschleifePruefen()
await laufwerkPruefen()
fs.rmSync(WERK, { recursive: true, force: true })
console.log(`\n${fehler === 0 ? 'Alles gehalten — auf dieser Box.' : `${fehler} Befund(e).`}`)
process.exit(0)
