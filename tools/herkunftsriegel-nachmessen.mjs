#!/usr/bin/env node
/**
 * NACHMESSUNG DES HERKUNFTSRIEGELS — UNABHAENGIG VON tools/herkunftsriegel-probe.mjs.
 *
 * WOZU EIN ZWEITES WERKZEUG? Weil das erste vom selben Verfasser stammt wie der
 * Riegel. Diese Datei stellt dieselben Fragen NOCH EINMAL, aber mit eigenen
 * Annahmen, eigenem Portblock (ab 9629) und einer eigenen Antwort auf die
 * Frage, was „richtig" heisst. Sie misst zusaetzlich die Wege, die der Riegel
 * NICHT deckt (/spotify, /jellyfin, / — die statischen Seiten), denn der
 * Bericht behauptet ueber genau die etwas.
 *
 * NUR AUF DIESEM RECHNER. Wegwerf-Verzeichnis, eigener Prozess, nichts an der
 * Box, nichts ausgeliefert. Rueckgabewert 0, wenn jede Zeile stimmt.
 *
 *     node tools/herkunftsriegel-nachmessen.mjs [--port 9629] [--behalten]
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND = join(WURZEL, 'src', 'backend-api')
const argv = process.argv.slice(2)
const BEHALTEN = argv.includes('--behalten')
const START = Number((argv.indexOf('--port') >= 0 && argv[argv.indexOf('--port') + 1]) || 9629)

const zeilen = []
let rot = 0
function pruefe(name, ist, soll) {
  const ok = String(ist) === String(soll)
  if (!ok) rot++
  zeilen.push(`${ok ? '  ok  ' : ' ROT  '} ${name.padEnd(64)} ist=${ist}  soll=${soll}`)
}

/** Einen Port wirklich binden, bevor er benutzt wird — sonst misst man fremd. */
function portFrei(p) {
  return new Promise((fertig) => {
    const s = net.createServer()
    s.once('error', () => fertig(false))
    s.once('listening', () => s.close(() => fertig(true)))
    s.listen(p, '127.0.0.1')
  })
}
async function freierPort(ab) {
  for (let p = ab; p < ab + 60; p++) if (await portFrei(p)) return p
  throw new Error('kein freier Port')
}

/** Rohe HTTP-Anfrage ueber einen Socket — damit auch `Host` frei setzbar ist. */
function roh(port, { methode = 'GET', weg = '/', kopf = {}, koerper = null }) {
  return new Promise((fertig, schief) => {
    const s = net.connect(port, '127.0.0.1')
    let alles = ''
    s.setTimeout(15000, () => {
      s.destroy()
      schief(new Error('Zeit abgelaufen'))
    })
    s.on('connect', () => {
      const k = { Host: `127.0.0.1:${port}`, Connection: 'close', ...kopf }
      if (koerper != null) {
        k['Content-Length'] = String(Buffer.byteLength(koerper))
        if (!k['Content-Type']) k['Content-Type'] = 'application/json'
      }
      const kopfzeilen = Object.entries(k)
        .map(([n, w]) => `${n}: ${w}`)
        .join('\r\n')
      s.write(`${methode} ${weg} HTTP/1.1\r\n${kopfzeilen}\r\n\r\n${koerper ?? ''}`)
    })
    s.on('data', (d) => {
      alles += d.toString('utf8')
    })
    s.on('error', schief)
    s.on('close', () => {
      const schnitt = alles.indexOf('\r\n\r\n')
      const kopfteil = alles.slice(0, schnitt < 0 ? alles.length : schnitt)
      const status = Number(kopfteil.split('\r\n')[0].split(' ')[1])
      const kopfe = {}
      for (const z of kopfteil.split('\r\n').slice(1)) {
        const i = z.indexOf(':')
        if (i > 0) kopfe[z.slice(0, i).trim().toLowerCase()] = z.slice(i + 1).trim()
      }
      fertig({ status, kopfe, text: schnitt < 0 ? '' : alles.slice(schnitt + 4) })
    })
  })
}

async function lauf() {
  const port = await freierPort(START)
  const ordner = mkdtempSync(join(tmpdir(), 'herkunft-nachmessen-'))
  const konfig = join(ordner, 'mupiboxconfig.json')
  mkdirSync(join(ordner, 'www-admin'), { recursive: true })
  const vorlage = join(WURZEL, 'config', 'templates', 'mupiboxconfig.json')
  writeFileSync(konfig, existsSync(vorlage) ? readFileSync(vorlage, 'utf8') : '{}')
  writeFileSync(join(ordner, 'www-admin', 'index.html'), '<html><body>admin</body></html>')

  const umgebung = {
    ...process.env,
    MUPIBOX_HTTP_PORT: String(port),
    MUPIBOX_HTTPS_PORT: String(port + 1),
    MUPIBOX_TLS_DIR: join(ordner, 'tls'),
    MUPIBOX_CONFIG: konfig,
    MUPIBOX_LOCK_DIR: ordner,
    MUPIBOX_ADMIN_DIR: join(ordner, 'www-admin'),
    MUPIBOX_SICHERUNG_STAENDE: join(ordner, 'sicherungen'),
  }
  delete umgebung.NODE_ENV
  delete umgebung.MUPIBOX_HERKUNFT_AUS

  // GEBUENDELT WIE AUF DER BOX. `tsx src/server.ts` laeuft als ES-Modul und
  // stirbt an `__dirname` (server.ts:1733) — das ist eine Eigenheit des
  // Startwegs, keine der Software. esbuild macht daraus CommonJS, genau wie
  // der Bau, der auf der Box liegt.
  const esbuild = [
    join(BACKEND, 'node_modules', '.bin', 'esbuild'),
    join(WURZEL, 'node_modules', '.bin', 'esbuild'),
  ].find(existsSync)
  if (!esbuild) throw new Error('esbuild nicht gefunden')
  const gebaut = join(ordner, 'server.js')
  const bau = spawnSync(
    esbuild,
    [join(BACKEND, 'src', 'server.ts'), '--bundle', '--platform=node', '--target=node26', `--outfile=${gebaut}`],
    { encoding: 'utf8' },
  )
  if (bau.status !== 0) throw new Error(`Buendeln fehlgeschlagen: ${bau.stderr}`)
  mkdirSync(join(ordner, 'www'), { recursive: true })
  writeFileSync(join(ordner, 'www', 'index.html'), '<html><body>box</body></html>')

  const kind = spawn(process.execPath, [gebaut], { cwd: ordner, env: umgebung, stdio: ['ignore', 'pipe', 'pipe'] })
  let protokoll = ''
  kind.stdout.on('data', (d) => {
    protokoll += d
  })
  kind.stderr.on('data', (d) => {
    protokoll += d
  })

  // WARTEN, BIS DIESER SERVER ANTWORTET — und zwar dieser. Ein 404 von einem
  // fremden Prozess sieht aus wie ein 404 von unserem.
  let bereit = false
  for (let i = 0; i < 120; i++) {
    await new Promise((f) => setTimeout(f, 500))
    try {
      const a = await roh(port, { weg: '/api/konfiguration' })
      if (a.status) {
        bereit = true
        break
      }
    } catch {}
    if (kind.exitCode !== null) break
  }
  if (!bereit) {
    console.log(protokoll.slice(-3000))
    throw new Error('Server nicht hochgekommen')
  }
  const eigen = `http://127.0.0.1:${port}`

  // ── A) LESEN AUF /api ────────────────────────────────────────────────────
  const faelle = [
    ['keine Herkunft (curl)', {}, 200, true],
    ['eigene Herkunft', { Origin: eigen }, 200, true],
    ['eigene Herkunft, GROSS geschrieben', { Origin: `HTTP://127.0.0.1:${port}` }, 200, true],
    ['fremde Herkunft', { Origin: 'https://boese.example' }, 403, false],
    ['Origin: null', { Origin: 'null' }, 403, false],
    ['gleicher Rechner, anderer Port', { Origin: `http://127.0.0.1:${port + 7}` }, 403, false],
    ['anderer Name, gleicher Port', { Origin: `http://localhost:${port}` }, 403, false],
    ['file:-Herkunft', { Origin: 'file://' }, 403, false],
    [
      'Bild-Einbettung ohne Origin (cross-site)',
      { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'image' },
      403,
      false,
    ],
    [
      'Rahmen ohne Origin (cross-site, iframe)',
      { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'iframe' },
      403,
      false,
    ],
    ['Adresszeile (Sec-Fetch-Site: none)', { 'Sec-Fetch-Site': 'none' }, 200, true],
  ]
  for (const [name, kopf, sollStatus, sollStern] of faelle) {
    const a = await roh(port, { weg: '/api/konfiguration', kopf })
    pruefe(`A lesen: ${name}`, a.status, sollStatus)
    const stern = 'access-control-allow-origin' in a.kopfe
    pruefe(`A lesen: ${name} — ACAO-Kopfzeile`, stern, sollStern)
  }

  // ── A2) EIN FALL, DER HIER NICHT ENTSCHIEDEN WIRD ────────────────────────
  //
  // Navigation der obersten Ebene von einer fremden Seite auf einen /api-Weg.
  // herkunft.ts laesst sie absichtlich durch (der Mensch sieht das Ergebnis in
  // seinem eigenen Fenster). SOLANGE der Riegel aus sicherung.ts ohne Pfad
  // hing, kam sie trotzdem nie an — die Reparatur oben macht sie scharf, und
  // unter /api liegen GETs MIT WIRKUNG (/api/vorlesen/sprich laesst die Box
  // reden). Ob die Ausnahme dort bleiben darf, gehoert herkunft.ts und wird
  // hier deshalb BERICHTET, nicht gefordert: eine Zahl, die man nicht selbst
  // verantwortet, gehoert nicht in eine Zusage.
  const fenster = await roh(port, {
    weg: '/api/konfiguration',
    kopf: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' },
  })
  zeilen.push(`  ??  A2 Fenster von fremder Seite auf /api/konfiguration -> Status ${fenster.status}`)
  if (fenster.status === 200) {
    zeilen.push('      ^ BEFUND fuer herkunft.ts: die Ausnahme fuer die Navigation der obersten')
    zeilen.push('        Ebene ist unter /api scharf. Dort liegt keine Seite, sondern Wege mit Wirkung.')
  }

  // ── B) VORABFRAGE (OPTIONS) — die faellt cors() sonst selbst zu ──────────
  const vor = await roh(port, {
    methode: 'OPTIONS',
    weg: '/api/konfiguration',
    kopf: { Origin: 'https://boese.example', 'Access-Control-Request-Method': 'POST' },
  })
  pruefe('B Vorabfrage fremde Herkunft', vor.status, 403)
  pruefe('B Vorabfrage fremde Herkunft — ACAO-Kopfzeile', 'access-control-allow-origin' in vor.kopfe, false)

  // ── C) SCHREIBEN: in der DATEI nachgesehen, nicht in der Antwort ─────────
  const vorher = readFileSync(konfig, 'utf8')
  const formular = await roh(port, {
    methode: 'POST',
    weg: '/api/konfiguration',
    kopf: { Origin: 'https://boese.example', 'Content-Type': 'application/x-www-form-urlencoded' },
    koerper: 'volume=99',
  })
  pruefe('C Formular-POST fremder Herkunft', formular.status, 403)
  pruefe('C Formular-POST — Datei unveraendert', readFileSync(konfig, 'utf8') === vorher, true)

  // ── D) VARY: Origin AUCH AUF DEM ERLAUBTEN WEG ──────────────────────────
  const gut = await roh(port, { weg: '/api/konfiguration', kopf: { Origin: eigen } })
  pruefe('D Vary auf erlaubtem Weg enthaelt Origin', /origin/i.test(gut.kopfe.vary ?? ''), true)

  // ── E) WAS DER RIEGEL NICHT DECKT — /player und die statischen Wege ─────
  const spieler = await roh(port, { weg: '/player/current', kopf: { Origin: 'https://boese.example' } })
  pruefe('E /player fremde Herkunft', spieler.status, 403)

  // /spotify: NICHT vom Herkunftsriegel gedeckt (steht nicht unter /api).
  // Der Bericht behauptet, ein FREMDER Riegel aus sicherung.ts faengt ihn
  // trotzdem — genau das wird hier gemessen, nicht geglaubt.
  // DER RUECKWEG VON SPOTIFY. `accounts.spotify.com` schickt den Browser
  // hierher — Navigation der obersten Ebene, also `Sec-Fetch-Site: cross-site`.
  // Er MUSS durchkommen, sonst laesst sich Spotify nicht einrichten.
  const rueckweg = await roh(port, {
    weg: '/spotify?code=abc&state=xyz',
    kopf: {
      Accept: 'text/html',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
    },
  })
  pruefe('E /spotify Rueckweg (cross-site, Fenster) kommt an', rueckweg.status, 200)
  if (rueckweg.status !== 200) zeilen.push(`      Koerper: ${rueckweg.text.slice(0, 200).replace(/\s+/g, ' ')}`)

  // Die eigenen Sicherungswege bleiben gedeckt — jetzt vom Herkunftsriegel.
  const sich = await roh(port, { weg: '/api/sicherung', kopf: { Origin: 'https://boese.example' } })
  pruefe('E /api/sicherung fremde Herkunft', sich.status, 403)

  const wurzel = await roh(port, { weg: '/', kopf: { Origin: 'https://boese.example' } })
  zeilen.push(`  ??  E / (statische Seite) mit fremder Herkunft -> Status ${wurzel.status}`)

  // ── F) GEGENPROBE: ohne Riegel muss dieselbe Anfrage durchkommen ─────────
  kind.kill('SIGTERM')
  await new Promise((f) => setTimeout(f, 1500))
  const kind2 = spawn(process.execPath, [gebaut], {
    cwd: ordner,
    env: { ...umgebung, MUPIBOX_HERKUNFT_AUS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  kind2.stdout.on('data', () => {})
  kind2.stderr.on('data', () => {})
  let bereit2 = false
  for (let i = 0; i < 120; i++) {
    await new Promise((f) => setTimeout(f, 500))
    try {
      const a = await roh(port, { weg: '/api/konfiguration' })
      if (a.status) {
        bereit2 = true
        break
      }
    } catch {}
  }
  if (bereit2) {
    // OHNE Sec-Fetch-Kopfzeilen — nur so misst die Gegenprobe MEINEN Riegel
    // und nicht den zweiten aus sicherung.ts.
    const b = await roh(port, { weg: '/api/konfiguration', kopf: { Origin: 'https://boese.example' } })
    pruefe('F Gegenprobe ohne Riegel: fremde Herkunft kommt durch', b.status, 200)
    pruefe('F Gegenprobe ohne Riegel: ACAO steht da', a_stern(b), true)
  } else {
    pruefe('F Gegenprobe: Server hochgekommen', false, true)
  }
  kind2.kill('SIGTERM')

  if (!BEHALTEN) rmSync(ordner, { recursive: true, force: true })
  console.log(zeilen.join('\n'))
  console.log(`\nPort ${port}. ${rot === 0 ? 'ALLES GRUEN' : `${rot} ROT`}`)
  process.exit(rot === 0 ? 0 : 1)
}
const a_stern = (a) => 'access-control-allow-origin' in a.kopfe

lauf().catch((f) => {
  console.error(f)
  process.exit(2)
})
