#!/usr/bin/env node
/**
 * PLUGIN-LADEWEG-PROBE — taugt `await import(...)` im AUSGELIEFERTEN Stand?
 *
 * WARUM DIESE FRAGE NICHT AM QUELLTEXT ZU BEANTWORTEN IST: backend-api ist in
 * der Quelle ESM (`"type": "module"` in src/backend-api/package.json), wird
 * aber mit
 *
 *   esbuild src/server.ts --bundle --minify --platform=node --target=node22
 *
 * zu EINER Datei gebuendelt. `--platform=node` ohne `--format` liefert CJS.
 * Damit steht die Frage im Raum, was esbuild aus einem dynamischen
 * `await import(pfad)` macht, wenn `pfad` erst zur Laufzeit feststeht: laesst
 * es den echten ESM-Ladeweg stehen, oder ersetzt es ihn durch `require()`?
 * Der Unterschied entscheidet, ob ein Plugin-System ueberhaupt ESM-Plugins
 * laden kann — und der Fehler faellt NICHT beim Bauen auf, sondern erst auf
 * der Box, wenn das erste Fremdplugin ankommt.
 *
 * Gemessen wird ausserdem, was Isolierung an Speicher kostet. Auf einem Pi mit
 * 1 GB ist das die Frage, an der ein Entwurf scheitert oder nicht.
 *
 * ACHTUNG: laeuft auf dem ENTWICKLUNGSRECHNER. Die Speicherzahlen sind
 * Groessenordnungen, keine Boxwerte — auf arm64 nachmessen, bevor sie
 * irgendwo als Zusage stehen.
 *
 * Aufruf:  node tools/plugin-ladeweg-probe.mjs
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const WURZEL = path.resolve(HIER, '..')
const WERK = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-ladeweg-'))

let fehler = 0
const sagen = (frage, befund, gut) => {
  if (!gut) fehler++
  console.log(`${gut ? '  ok  ' : ' FEHL '} ${frage}\n         ${befund}`)
}

/** esbuild aus dem Baum, nicht aus dem Netz. */
function esbuildPfad() {
  for (const p of [
    path.join(WURZEL, 'node_modules/.bin/esbuild'),
    path.join(WURZEL, 'src/backend-api/node_modules/.bin/esbuild'),
  ]) {
    if (fs.existsSync(p)) return p
  }
  return null
}

// ── 1. Was wird aus `await import(variable)` im CJS-Buendel? ───────────────
function ladewegPruefen() {
  const eb = esbuildPfad()
  if (!eb) {
    sagen('esbuild vorhanden?', 'nicht gefunden — npm install fehlt', false)
    return
  }

  // Ein Plugin, wie ein Fremdentwickler es schreiben wuerde: ESM.
  fs.mkdirSync(path.join(WERK, 'plugin'), { recursive: true })
  fs.writeFileSync(
    path.join(WERK, 'plugin/index.mjs'),
    'export const id = "probe-plugin"\nexport default { id }\n',
  )

  /** Mit den Fahnen aus src/backend-api/package.json bauen. */
  const bauen = (quelldatei, zieldatei) => {
    try {
      execFileSync(
        eb,
        [
          quelldatei,
          '--bundle',
          '--platform=node',
          '--target=node22',
          '--log-level=error',
          `--outfile=${zieldatei}`,
        ],
        { stdio: 'pipe' },
      )
      return null
    } catch (e) {
      return String(e.stderr || e.message)
        .split('\n')
        .find((z) => z.includes('ERROR'))
        ?.trim()
    }
  }

  // (a) Die naive Form aus dem Entwurf: `await import(...)` auf oberster Ebene.
  fs.writeFileSync(
    path.join(WERK, 'oben.ts'),
    ['const pfad = process.argv[2]', 'const m = await import(pfad)', 'console.log("GELADEN:" + m.id)'].join('\n'),
  )
  const obenFehler = bauen(path.join(WERK, 'oben.ts'), path.join(WERK, 'oben.js'))
  sagen(
    '`await import()` auf oberster Ebene — baut das ueberhaupt?',
    obenFehler ? `NEIN, der Bau bricht ab: ${obenFehler.replace(/^✘ /, '')}` : 'ja',
    !obenFehler,
  )

  // (b) Die Form, die ein PluginManager wirklich haette: in einer async-Methode.
  fs.writeFileSync(
    path.join(WERK, 'wirt.ts'),
    [
      'async function laden(pfad: string) {',
      '  const modul = await import(pfad)',
      '  return modul.id ?? modul.default?.id',
      '}',
      'laden(process.argv[2]).then((id) => console.log("GELADEN:" + id))',
    ].join('\n'),
  )
  const wirtFehler = bauen(path.join(WERK, 'wirt.ts'), path.join(WERK, 'wirt.js'))
  if (wirtFehler) {
    sagen('`await import()` in async-Methode — baut das?', `NEIN: ${wirtFehler}`, false)
    return
  }

  const gebaut = fs.readFileSync(path.join(WERK, 'wirt.js'), 'utf8')
  // DAS FORMAT SAGT ESBUILD SELBST — an der Datei ist es nicht abzulesen: ein
  // Buendel ohne eigene Abhaengigkeiten enthaelt weder `require(` noch ein
  // `"use strict"` am Kopf. Der Abbruch aus (a) nennt es dagegen ausdruecklich.
  sagen(
    'Buendelformat bei --platform=node ohne --format',
    obenFehler?.includes('"cjs"')
      ? 'CJS — von esbuild selbst benannt, passt zu src/deploy/server.js (enthaelt require())'
      : 'nicht eindeutig bestimmt',
    true, // Befund, kein Urteil
  )

  const zuRequire = /__toESM\(require\(|Promise\.resolve\(\)\.then\(\(\)\s*=>\s*__toESM\(require\(/.test(gebaut)
  const echtesImport = /\bimport\(/.test(gebaut)
  sagen(
    'bleibt `await import(pfad)` ein ECHTER ESM-Ladeweg?',
    zuRequire
      ? 'NEIN — esbuild ersetzt es durch require(). ESM-Plugins waeren dann nicht ladbar.'
      : echtesImport
        ? 'ja — import() steht unveraendert im CJS-Buendel, wird NICHT zu require()'
        : 'unklar — weder require-Ersatz noch import() gefunden',
    !zuRequire,
  )

  // Der harte Beweis: laeuft es?
  let lauf
  try {
    lauf = execFileSync(process.execPath, [path.join(WERK, 'wirt.js'), path.join(WERK, 'plugin/index.mjs')], {
      encoding: 'utf8',
      stdio: 'pipe',
    })
  } catch (e) {
    lauf = `ABBRUCH: ${String(e.stderr || e.message).split('\n')[0]}`
  }
  sagen(
    `laedt das gebaute CJS-Buendel ein ESM-Plugin (Node ${process.versions.node})?`,
    lauf.trim(),
    lauf.includes('GELADEN:probe-plugin'),
  )
  console.log(
    '         Damit ist der Ladeweg selbst NICHT das Problem: dynamisches\n' +
      '         import() aus CJS kann Node seit 12. Die Fessel ist (a) — der\n' +
      '         PluginManager darf KEIN top-level await benutzen, sonst baut\n' +
      '         backend-api nicht mehr.',
  )
}

// ── 2. Was kostet Isolierung an Speicher? ─────────────────────────────────
function speicherPruefen() {
  const messen = (name, quelle) => {
    const datei = path.join(WERK, `${name}.mjs`)
    fs.writeFileSync(datei, quelle)
    try {
      const aus = execFileSync(process.execPath, [datei], { encoding: 'utf8', stdio: 'pipe' })
      return Number(aus.trim())
    } catch (e) {
      console.error(`  (${name} scheiterte: ${String(e.stderr || e.message).split('\n')[0]})`)
      return Number.NaN
    }
  }

  const grund = messen('grund', 'console.log(process.memoryUsage().rss)\n')

  const mitWorkern = messen(
    'worker',
    [
      "import { Worker } from 'node:worker_threads'",
      'const n = 5',
      'const w = []',
      'for (let i = 0; i < n; i++) {',
      "  w.push(new Worker('setInterval(()=>{},1e9)', { eval: true }))",
      '}',
      'await new Promise((f) => setTimeout(f, 1500))',
      'console.log(process.memoryUsage().rss)',
      'for (const x of w) await x.terminate()',
    ].join('\n'),
  )

  const mitKindern = messen(
    'fork',
    [
      "import { fork } from 'node:child_process'",
      "import fs from 'node:fs'",
      "const datei = new URL('./kind.mjs', import.meta.url)",
      "fs.writeFileSync(datei, 'setInterval(()=>{},1e9)\\n')",
      'const n = 5',
      'const k = []',
      'for (let i = 0; i < n; i++) k.push(fork(datei, { stdio: "ignore" }))',
      'await new Promise((f) => setTimeout(f, 1500))',
      "let summe = process.memoryUsage().rss",
      'for (const x of k) {',
      '  try {',
      "    summe += Number(fs.readFileSync(`/proc/${x.pid}/statm`, 'utf8').split(' ')[1]) * 4096",
      '  } catch {}',
      '}',
      'console.log(summe)',
      'for (const x of k) x.kill()',
    ].join('\n'),
  )

  const mb = (b) => (Number.isFinite(b) ? `${(b / 1024 / 1024).toFixed(1)} MB` : 'nicht messbar')
  const jeWorker = (mitWorkern - grund) / 5
  const jeKind = (mitKindern - grund) / 5

  console.log('\n  Speicher (RSS, 5 Isolate, dieser Rechner — NICHT die Box):')
  console.log(`         nackter Node-Prozess          ${mb(grund)}`)
  console.log(`         + 5 worker_threads            ${mb(mitWorkern)}   → ${mb(jeWorker)} je Plugin`)
  console.log(`         + 5 child_process.fork        ${mb(mitKindern)}   → ${mb(jeKind)} je Plugin`)
  sagen(
    'worker_threads deutlich billiger als fork?',
    Number.isFinite(jeWorker) && Number.isFinite(jeKind)
      ? `Faktor ${(jeKind / jeWorker).toFixed(1)}`
      : 'nicht messbar',
    Number.isFinite(jeWorker) && Number.isFinite(jeKind) && jeWorker < jeKind,
  )
}

// ── 2b. Laesst sich ein durchgedrehtes Plugin ueberhaupt noch stoppen? ────
//
// DIE ENTSCHEIDENDE FRAGE FUER VORGABE 1 („ein fehlerhaftes Plugin darf den
// Kern nie lahmlegen"). Eine Endlosschleife IM HAUPTPROZESS ist nicht
// abbrechbar — JavaScript hat keinen Vorrang-Wechsel, der Webserver antwortet
// bis zum Neustart nicht mehr. Die Frage ist, ob `worker.terminate()` einen
// SYNCHRON drehenden Worker wirklich einholt oder nur hoeflich anfragt.
function endlosschleifePruefen() {
  const datei = path.join(WERK, 'schleife.mjs')
  fs.writeFileSync(
    datei,
    [
      "import { Worker } from 'node:worker_threads'",
      // while(true){} ohne jeden Rueckgabepunkt an die Laufzeit.
      "const w = new Worker('while (true) {}', { eval: true })",
      'const start = Date.now()',
      'await new Promise((f) => setTimeout(f, 300))',
      'await w.terminate()',
      'console.log(Date.now() - start)',
    ].join('\n'),
  )
  let ms = Number.NaN
  try {
    // Reisst der Abbruch nicht, haengt der Prozess hier fuer immer.
    ms = Number(execFileSync(process.execPath, [datei], { encoding: 'utf8', stdio: 'pipe', timeout: 15000 }).trim())
  } catch {
    ms = Number.NaN
  }
  sagen(
    'holt worker.terminate() eine SYNCHRONE Endlosschleife ein?',
    Number.isFinite(ms)
      ? `ja, nach ${ms} ms beendet — V8 unterbricht den Isolat`
      : 'NEIN / Zeitablauf — die Schleife war nicht abbrechbar',
    Number.isFinite(ms),
  )
  console.log(
    '         Gegenprobe im Kopf: dieselbe Schleife IM Hauptprozess ist mit\n' +
      '         keinem Mittel abbrechbar — genau deshalb darf Plugin-Code nicht\n' +
      '         dorthin.',
  )
}

// ── 3. Greift die Kinderzeit an einem Plugin-Pfad? ────────────────────────
async function kinderzeitPruefen() {
  const { istStartbefehl } = await import(path.join(WURZEL, 'src/backend-api/src/kinderzeit.ts'))
  // ACHTUNG BEIM LESEN: die Pruefung sitzt in `app.use('/player', …)`, und
  // Express STREICHT den Aufhaengepunkt aus `req.url`. `istStartbefehl` sieht
  // also `/spotify/now/…`, nicht `/player/spotify/now/…`. Wer hier den vollen
  // Pfad einsetzt, misst etwas anderes als den Betrieb.
  const faelle = [
    ['/spotify/now/spotify:album:x', true, 'Kernweg heute'],
    ['/ard/12345', true, 'ARD, seit 04.08.2026 nachgetragen'],
    ['/deezer/67890', false, 'neues Schema eines Plugins'],
    ['/plugin/wasauchimmer/start', false, 'beliebiger Plugin-Startbefehl'],
  ]
  console.log('\n  Kinderzeit-Erlaubnisliste (kinderzeit.ts istStartbefehl, Pfad OHNE /player):')
  let luecken = 0
  for (const [pfad, erwartet, was] of faelle) {
    const ist = istStartbefehl(pfad)
    if (ist !== erwartet) console.log(`  ACHTUNG Erwartung verfehlt bei ${pfad}`)
    if (!ist) luecken++
    console.log(`         ${ist ? 'erfasst  ' : 'DURCHLASS'} ${pfad}   (${was})`)
  }
  console.log(
    `         ${luecken} von ${faelle.length} laufen ungeprueft durch. DAS BLEIBT SO und ist\n` +
      '         fuer die KERN-Wege (Spotify, Jellyfin, Radio, RSS, ARD) weiterhin\n' +
      '         das erste Netz. Jedes neue KERN-Schema muss weiter von Hand in\n' +
      '         diese Regex — der Umbau der 181 Kernrouten auf die Tuer ist ein\n' +
      '         eigener Block.',
  )

  // ── Und nun die neue Lage: geht der PLUGIN-Weg durch die Tuer? ──────────
  const server = fs.readFileSync(path.join(WURZEL, 'src/backend-api/src/server.ts'), 'utf8')
  const tuer = fs.existsSync(path.join(WURZEL, 'src/backend-api/src/spielweg.ts'))
  const routeGehtDurch = /app\.post\('\/api\/plugins\/spielen'[\s\S]{0,600}?spielAnfordern\(/.test(server)
  const nurEineTuer = (server.match(/fundAnDenSpieler\(/g) ?? []).length === 2 // Definition + genau EIN Aufruf

  console.log('\n  Der Plugin-Weg:')
  sagen(
    'gibt es die Tuer (spielweg.ts)?',
    tuer ? 'ja' : 'nein — dann ist der Plugin-Weg ungedeckt',
    tuer,
  )
  sagen(
    'geht /api/plugins/spielen durch spielAnfordern?',
    routeGehtDurch ? 'ja — die Kinderzeit wird dort gefragt, nicht erraten' : 'NEIN — die Route umgeht die Tuer',
    routeGehtDurch,
  )
  sagen(
    'gibt es NUR EINEN Weg zum Abspieldienst im Plugin-Zweig?',
    nurEineTuer
      ? 'ja — fundAnDenSpieler wird genau einmal gerufen, aus der Tuer'
      : 'ACHTUNG: fundAnDenSpieler hat mehr als einen Aufrufer — jeder weitere ist ein Weg an der Kinderzeit vorbei',
    nurEineTuer,
  )
}

// ── 4. Traegt der AUSGELIEFERTE Stand? ────────────────────────────────────
//
// Die Abschnitte oben messen an nachgebauten Beispielen. Dieser hier nimmt die
// Datei, die WIRKLICH auf die Box geht: src/deploy/plugin-laufwerk.js. Ohne
// diesen Schritt bliebe die Frage offen, ob esbuild beim echten Laufwerk
// dasselbe tut wie beim Spielzeug — und die Antwort kaeme dann von der Box.
async function ausgeliefertPruefen() {
  const laufwerk = path.join(WURZEL, 'src/deploy/plugin-laufwerk.js')
  if (!fs.existsSync(laufwerk)) {
    sagen(
      'ist plugin-laufwerk.js gebaut?',
      'NEIN — "npm run build --workspace=mupibox-backend-api" fehlt. Ohne diese Datei laedt die Box KEIN Plugin.',
      false,
    )
    return
  }

  const ordner = path.join(WERK, 'echt')
  fs.mkdirSync(ordner, { recursive: true })
  fs.writeFileSync(
    path.join(ordner, 'index.mjs'),
    `export default {
       async aufloesen(rest, kontext) {
         if (!kontext.holen) throw new Error('kein Netz')
         return { titel: { name: 'Folge ' + rest }, quelle: { art: 'strom', adresse: 'https://example.org/x.mp3' } }
       },
     }`,
  )

  const { Worker } = await import('node:worker_threads')
  const antwort = await new Promise((fertig) => {
    const w = new Worker(laufwerk, {
      workerData: {
        manifest: { kennung: 'probe', name: 'Probe', fassung: '1.0.0', haupt: 'index.mjs', rechte: ['netz'] },
        ordner,
        einstellungen: {},
        fristMs: 3000,
        eigeneAdressen: ['127.0.0.1'],
      },
      resourceLimits: { maxOldGenerationSizeMb: 48, maxYoungGenerationSizeMb: 8 },
    })
    const uhr = setTimeout(() => fertig('Zeitablauf — keine Antwort'), 10000)
    w.on('message', (n) => {
      if (n.art === 'bereit') w.postMessage({ art: 'ruf', nr: 1, verb: 'aufloesen', arg: '4711' })
      if (n.art === 'ladefehler') { clearTimeout(uhr); void w.terminate(); fertig(`Ladefehler: ${n.meldung}`) }
      if (n.art === 'antwort') { clearTimeout(uhr); void w.terminate(); fertig(n.wert?.titel?.name ?? '(leer)') }
      if (n.art === 'fehler') { clearTimeout(uhr); void w.terminate(); fertig(`Fehler: ${n.meldung}`) }
    })
    w.on('error', (e) => { clearTimeout(uhr); fertig(`Worker-Fehler: ${e.message}`) })
  })

  sagen(
    'laedt das GEBAUTE Laufwerk ein echtes Plugin und antwortet?',
    antwort === 'Folge 4711' ? 'ja — "Folge 4711" zurueck' : antwort,
    antwort === 'Folge 4711',
  )
}

console.log(`Plugin-Ladeweg-Probe — Node ${process.versions.node}, ${process.arch}\n`)
ladewegPruefen()
speicherPruefen()
endlosschleifePruefen()
await ausgeliefertPruefen()
await kinderzeitPruefen()
fs.rmSync(WERK, { recursive: true, force: true })
console.log(`\n${fehler === 0 ? 'Alles gehalten.' : `${fehler} Befund(e), die im Entwurf stehen muessen.`}`)
process.exit(0)
