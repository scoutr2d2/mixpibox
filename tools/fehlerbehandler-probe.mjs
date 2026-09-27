#!/usr/bin/env node
/**
 * WAS ANTWORTET DAS BACKEND, WENN DER RUMPF EINER ANFRAGE KAPUTT IST?
 *
 * Gemessen wird an einem ECHTEN Serverprozess mit NODE_ENV **NICHT GESETZT** —
 * genau so, wie er auf der Box läuft (im /proc/<pid>/environ des laufenden
 * Backends nachgesehen, 07.08.2026: die Unit setzt es nicht).
 *
 * WARUM DAS NICHT ALS SPEC IM PROZESS GEHT: `npm test` setzt NODE_ENV=test,
 * und Express entscheidet AN DIESER VARIABLEN, ob sein Vorgabe-Fehlerbehandler
 * den Stapelabzug in die Antwort schreibt. Eine Prüfung im selben Prozess
 * hätte den Fehler deshalb NIE gesehen: sie läuft immer in der Welt, in der es
 * ihn nicht gibt. Der Fehler entsteht in der Express-Kette, nicht in einer
 * Formel — also wird die Kette gestartet.
 *
 *   node tools/fehlerbehandler-probe.mjs [--port 9951]
 *
 * Ausgabe: je Probe eine Zeile, am Ende die Zahl der Fehlschläge als
 * Rückgabewert. NUR LESEND gegenüber der Box — hier läuft nichts als root,
 * hier wird nichts ausgeliefert, der Prozess ist ein eigener auf diesem
 * Rechner.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND = join(WURZEL, 'src', 'backend-api')

const arg = (name, vorgabe) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : vorgabe
}
const PORT = Number(arg('--port', '9951'))

let fehler = 0
const pruefe = (satz, ok, dazu = '') => {
  console.log(`${ok ? '  ok  ' : '  FEHLT'} ${satz}${dazu ? ` — ${dazu}` : ''}`)
  if (!ok) fehler++
}

/**
 * Ein Arbeitsplatz, der aussieht wie die Box.
 *
 * Ohne NODE_ENV gilt `productionServe`, und dann liest der Server seine
 * Konfiguration aus `./server/config` RELATIV ZUM ARBEITSVERZEICHNIS — die
 * Umleitung über MUPIBOX_CONFIG_DIR greift dort mit Absicht nicht (sie wäre
 * sonst ein Hebel von aussen). Also wird das Verzeichnis gebaut und der Prozess
 * dort hineingestellt.
 */
function arbeitsplatz() {
  const ordner = mkdtempSync(join(tmpdir(), 'mupi-fehlerbehandler-'))
  const konf = join(ordner, 'server', 'config')
  mkdirSync(konf, { recursive: true })
  const mit = join(WURZEL, 'config')
  if (existsSync(mit)) {
    for (const d of ['active_data.json', 'network_config.json', 'monitor.json', 'albumstop.json']) {
      if (existsSync(join(mit, d))) cpSync(join(mit, d), join(konf, d))
    }
  }
  writeFileSync(
    join(konf, 'mupiboxconfig.json'),
    JSON.stringify({
      mupibox: { host: 'MuPiBox', startVolume: '40', maxVolume: '100' },
      // WIE AUF DER BOX AUSGELIEFERT: keine Anmeldung. Genau deshalb ist ein
      // Stapelabzug in der Antwort nicht nur hässlich, sondern eine Auskunft
      // an jeden im Netz.
      interfacelogin: { state: false, password: '' },
      timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
    }),
  )
  return ordner
}

async function warteAufServer(basis, kind) {
  for (let i = 0; i < 200; i++) {
    if (kind.exitCode !== null) throw new Error(`Server beendete sich mit ${kind.exitCode}`)
    try {
      const r = await fetch(`${basis}/api/auth/state`, { signal: AbortSignal.timeout(500) })
      if (r.ok) return
    } catch {
      /* noch nicht oben */
    }
    await new Promise((f) => setTimeout(f, 150))
  }
  throw new Error('Server kam nicht hoch')
}

/** Rohes Senden: fetch mit kaputtem JSON im Rumpf, Antwort als Text. */
async function kaputterRumpf(basis, weg, methode, rumpf) {
  const r = await fetch(`${basis}${weg}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json' },
    body: rumpf,
  })
  return { status: r.status, typ: r.headers.get('content-type') || '', text: await r.text() }
}

const VERRAETERISCH = [
  [/at\s+\S+\s+\(\/.+:\d+:\d+\)/, 'eine Zeile eines Stapelabzugs mit Dateipfad'],
  [/\/home\/|\/usr\/|\/opt\/|node_modules/, 'ein Pfad aus dem Dateisystem'],
  [/<pre>|<html/i, 'HTML statt einer Antwort für ein JSON-Gegenüber'],
]

async function proben(basis) {
  // Die Wege, die ein JSON-Gegenüber wirklich benutzt — einer neu, einer alt,
  // einer hinter dem Tor. Der Fehler ist bei allen derselbe: er entsteht in
  // express.json(), lange bevor der Weg selbst dran ist.
  const wege = [
    ['/api/schirm/helligkeit', 'PUT'],
    ['/api/ton', 'POST'],
    ['/api/konfiguration', 'POST'],
  ]
  for (const [weg, methode] of wege) {
    const a = await kaputterRumpf(basis, weg, methode, '{kaputt')
    console.log(`\n${methode} ${weg}  ->  ${a.status} ${a.typ.split(';')[0]}`)
    console.log(`  ${a.text.slice(0, 300).replace(/\n/g, ' ')}`)
    pruefe('antwortet mit 400 (der Rumpf war falsch, nicht der Server)', a.status === 400, `war ${a.status}`)
    pruefe('antwortet als JSON', a.typ.includes('application/json'), a.typ || 'ohne Typ')
    for (const [muster, was] of VERRAETERISCH) {
      pruefe(`verrät nicht ${was}`, !muster.test(a.text))
    }
    pruefe(
      'sagt trotzdem, WAS falsch war',
      /json|rumpf|body|lesbar|gültig|gueltig/i.test(a.text),
      a.text.slice(0, 80),
    )
  }

  // Ein Rumpf über der Grenze: derselbe Weg durch die Fehlerkette, anderer Grund.
  const gross = await kaputterRumpf(basis, '/api/schirm/helligkeit', 'PUT', JSON.stringify({ f: 'x'.repeat(200000) }))
  console.log(`\nPUT /api/schirm/helligkeit (200 kB)  ->  ${gross.status}`)
  pruefe('ein zu grosser Rumpf ergibt 413', gross.status === 413, `war ${gross.status}`)
  for (const [muster, was] of VERRAETERISCH) {
    pruefe(`auch dabei kein ${was}`, !muster.test(gross.text))
  }

  // EIN FEHLER, DER NICHT AUS express.json() KOMMT. Ohne diesen Fall hinge die
  // ganze Probe an body-parser, und der eigene Behandler koennte an jedem
  // anderen Fehler weiterhin vorbeigehen. Der Rueckfall auf index.html findet
  // hier keine Datei (der Prozess laeuft in einem leeren Verzeichnis) und ruft
  // `next(err)` — genau der Weg, den jeder unerwartete Fehler nimmt.
  const seite = await fetch(`${basis}/gibtesnicht`)
  console.log(`\nGET /gibtesnicht  ->  ${seite.status} ${(seite.headers.get('content-type') || '').split(';')[0]}`)
  const seitentext = await seite.text()
  console.log(`  ${seitentext.slice(0, 200).replace(/\n/g, ' ')}`)
  for (const [muster, was] of VERRAETERISCH) {
    pruefe(`ein Fehler abseits von express.json() verrät nicht ${was}`, !muster.test(seitentext))
  }

  // Und der Server lebt danach noch.
  const r = await fetch(`${basis}/api/auth/state`)
  pruefe('der Server antwortet danach weiter', r.ok)
}

const ordner = arbeitsplatz()
const basis = `http://127.0.0.1:${PORT}`
// NODE_ENV WIRD BEWUSST GELÖSCHT — das ist der ganze Punkt dieser Probe.
const umgebung = { ...process.env }
umgebung.NODE_ENV = undefined
delete umgebung.NODE_ENV
Object.assign(umgebung, {
  MUPIBOX_HTTP_PORT: String(PORT),
  MUPIBOX_HTTPS_PORT: String(PORT + 1),
  MUPIBOX_NO_AUTO_TLS: '1',
  MUPIBOX_LOCK_DIR: ordner,
  // Damit die Probe NICHT an /etc/mupibox der echten Box rührt.
  MUPIBOX_CONFIG: join(ordner, 'server', 'config', 'mupiboxconfig.json'),
})

/**
 * GEBÜNDELT WIE AUF DER BOX, nicht unter tsx.
 *
 * Ohne NODE_ENV läuft der Server in seinem Produktivzweig, und der greift auf
 * `__dirname` zu (statische Dateien, Rückfall auf index.html). Unter tsx ist
 * die Datei ein ES-Modul, dort gibt es den Namen nicht — der Prozess stirbt in
 * Zeile 1606, bevor irgendeine Anfrage ankommt. Auf der Box läuft `server.js`
 * aus `npm run build` (esbuild, CJS). Also wird genau das gebaut: sonst misst
 * diese Probe eine Welt, die es nirgends gibt.
 */
const ESBUILD = [join(BACKEND, 'node_modules', '.bin', 'esbuild'), join(WURZEL, 'node_modules', '.bin', 'esbuild')].find(
  (p) => existsSync(p),
)
if (!ESBUILD) {
  console.error('esbuild nicht gefunden — npm install fehlt.')
  process.exit(2)
}
const gebaut = join(ordner, 'server.js')
const bau = spawnSync(
  ESBUILD,
  [join(BACKEND, 'src', 'server.ts'), '--bundle', '--platform=node', '--target=node26', `--outfile=${gebaut}`],
  { encoding: 'utf8' },
)
if (bau.status !== 0) {
  console.error('Bündeln fehlgeschlagen:\n', bau.stderr)
  rmSync(ordner, { recursive: true, force: true })
  process.exit(2)
}

const kind = spawn(process.execPath, [gebaut], {
  cwd: ordner,
  env: umgebung,
  stdio: ['ignore', 'pipe', 'pipe'],
})
const protokoll = []
kind.stdout.on('data', (d) => protokoll.push(String(d)))
kind.stderr.on('data', (d) => protokoll.push(String(d)))

try {
  await warteAufServer(basis, kind)
  console.log(`Server läuft auf ${basis}, NODE_ENV ist NICHT gesetzt.`)
  await proben(basis)

  // WAS INS PROTOKOLL GEHT, DARF VOLLSTÄNDIG SEIN. Der Betreiber, der auf der
  // Box `journalctl` liest, braucht den ganzen Fehler — knapp wird nur, was
  // über das Netz geht.
  const log = protokoll.join('')
  console.log('\n── was der Server dabei selbst protokolliert hat ──')
  const zeilen = log.split('\n').filter((z) => /fehler|error|json/i.test(z))
  for (const z of zeilen.slice(-12)) console.log(`  ${z}`)
  pruefe('der Fehler steht im Protokoll des Servers', zeilen.length > 0)
  pruefe(
    'und der Stapelabzug ist dort VOLLSTÄNDIG — knapp wird nur, was über das Netz geht',
    /\n\s+at .+:\d+:\d+/.test(log),
  )

  // DER ZWEITE RIEGEL, am laufenden Prozess abgelesen: Express darf ohne
  // NODE_ENV NICHT auf 'development' fallen. Diese Zeile ist der Beleg dafür,
  // dass auch der Vorgabebehandler — der noch drankommt, wenn die Kopfzeilen
  // schon draussen sind — keine Stapelabzüge mehr schreibt.
  const betriebsart = /Express-Betriebsart: (\S+)/.exec(log)
  console.log(`\n  gemeldete Betriebsart: ${betriebsart?.[1] ?? '(keine Meldung)'}`)
  pruefe('Express läuft ohne NODE_ENV in der Betriebsart production', betriebsart?.[1] === 'production')
} catch (err) {
  console.error('ABBRUCH:', err instanceof Error ? err.message : err)
  console.error(protokoll.join('').slice(-3000))
  fehler++
} finally {
  kind.kill('SIGKILL')
  rmSync(ordner, { recursive: true, force: true })
}

console.log(`\n${fehler === 0 ? 'ALLES GRÜN' : `${fehler} FEHLSCHLÄGE`}`)
process.exit(fehler === 0 ? 0 : 1)
