#!/usr/bin/env node
/**
 * ZWEITMESSUNG: NAMENSRIEGEL UND SICHERUNGSKARTE, VON EINEM ZWEITEN PAAR AUGEN.
 *
 * ══ WOZU NOCH EIN WERKZEUG ════════════════════════════════════════════════
 * `tools/eigene-namen-riegel.mjs` stammt aus demselben Lauf wie die Aenderung,
 * die es misst. Ein solches Werkzeug bestaetigt vor allem sich selbst. Dieses
 * hier ist absichtlich anders gebaut: es prueft die BEHAUPTUNGEN des Berichts
 * einzeln nach und sucht daneben die Faelle, die dort NICHT vorkommen.
 *
 *   RING 1  Die tragende Behauptung: kommt der Namenstausch schreibend durch?
 *           IN DER DATEI nachgesehen, nicht in der Antwort. Dazu die
 *           GEGENPROBE am selben Vorgang mit MUPIBOX_HERKUNFT_AUS=1 — ohne
 *           einen roten Lauf dort misst Ring 1 nichts.
 *   RING 2  Formen der `Host`-Kopfzeile, die ein Riegel gern uebersieht:
 *           Anmeldeteil (`benutzer@wirt`), absolute Anfragezeile, ZWEI
 *           Host-Kopfzeilen in beiden Reihenfolgen, Grossschreibung, Punkt am
 *           Ende, Praefix, eigene Marke unter KAEUFLICHER Endung, Punycode.
 *   RING 3  Der Besitzer: jeder Name, unter dem diese Maschine wirklich
 *           erreicht wird — lesend, schreibend, Vorabfrage.
 *   RING 4  Die Sackgassen-Frage: nennt die Ablehnung einen Weg, der WIRKLICH
 *           traegt? Jede genannte Adresse wird aufgerufen und benutzt. Und
 *           greift `hostZusatz` ohne Neustart?
 *   RING 5  Wege ausserhalb von /api und /player — liegt dort Wirkung?
 *   RING 6  Die Sicherungskarte: laesst sich die Warmung „nicht eingeordnet"
 *           durch einen kaputten NEUESTEN Stand wieder zum Schweigen bringen?
 *           Und wie gross wird die Antwort bei sehr vielen, sehr langen
 *           Pfaden? Gemessen am echten Weg /api/sicherung/lage.
 *
 * ══ DER PORT ══════════════════════════════════════════════════════════════
 * Auf diesem Rechner laufen fremde Sitzungen. Ein Lauf hat heute eine
 * vollstaendig gruene Tafel ueber Software geliefert, die gar nicht lief.
 * Deshalb: jeder Port wird VORHER wirklich gebunden, und danach wird geprueft,
 * dass die Antwort von MEINEM Prozess kommt — `/api/streaming` gibt
 * `httpsPort` aus SEINER Umgebung zurueck, und die habe ich selbst gesetzt.
 *
 * ══ AUFRUF ════════════════════════════════════════════════════════════════
 *     node tools/riegel-zweitmessung-9663.mjs [--port 9663]
 * Nur auf diesem Rechner; die Box wird nicht angefasst. 0 = keine rote Zeile.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { hostname, networkInterfaces, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND = join(WURZEL, 'src', 'backend-api')
const argv = process.argv.slice(2)
const opt = (n, v) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : v
}

/* ── 0. PORTS, DIE NACHWEISLICH MIR GEHOEREN ─────────────────────────────── */
const portFrei = (p) =>
  new Promise((f) => {
    const s = net.createServer()
    s.once('error', () => f(false))
    s.once('listening', () => s.close(() => f(true)))
    s.listen(p, '0.0.0.0')
  })
async function portblock(von, bis) {
  // Vier: Riegel an (p), Riegel aus (p+1) und die beiden TLS-Seiten. `0` hilft
  // nicht — server.ts liest `Number(...) || 8443` und belegte damit 8443.
  for (let p = von; p <= bis; p++) if ((await Promise.all([p, p + 1, p + 2, p + 3].map(portFrei))).every(Boolean)) return p
  throw new Error(`kein freier Portblock ${von}..${bis}`)
}
const WUNSCH = Number(opt('port', '9663'))
const P_AN = await portblock(WUNSCH, WUNSCH + 90)
const P_AUS = P_AN + 1
if (P_AN !== WUNSCH) console.log(`(${WUNSCH} war belegt — dieser Lauf liegt auf ${P_AN})`)

let rot = 0
let zeilen = 0
const ok = (satz, gut, dazu = '') => {
  zeilen++
  if (!gut) rot++
  console.log(`  ${gut ? 'ok  ' : 'ROT '} ${satz}${dazu ? `  — ${dazu}` : ''}`)
}
const notiz = (s) => console.log(`  ····  ${s}`)

/* ── 1. DIE NAMEN DIESER MASCHINE, ABGELEITET STATT EINGETRAGEN ──────────── */
const RECHNER = hostname().toLowerCase()
const MARKE = RECHNER.split('.')[0]
const LAN = (() => {
  for (const l of Object.values(networkInterfaces()))
    for (const a of l ?? []) if (a.family === 'IPv4' && !a.internal) return a.address
  return null
})()
const KONFIGNAME = 'zweitmesskiste'

/* ── 2. ARBEITSPLATZ UND SERVER ──────────────────────────────────────────── */
function platzBauen() {
  const ordner = mkdtempSync(join(tmpdir(), 'riegel-zweitmessung-'))
  mkdirSync(join(ordner, 'server', 'config'), { recursive: true })
  mkdirSync(join(ordner, 'tls'), { recursive: true })
  const staende = join(ordner, 'staende')
  mkdirSync(staende, { recursive: true })
  const datei = join(ordner, 'server', 'config', 'mupiboxconfig.json')
  konfigSchreiben(datei, {})
  return { ordner, datei, staende }
}
/** `audioDevice` MUSS stehen, sonst lehnt der Server JEDES Schreiben ab. */
function konfigSchreiben(datei, mehr) {
  writeFileSync(
    datei,
    JSON.stringify(
      {
        mupibox: { host: KONFIGNAME, startVolume: '41', maxVolume: '100', audioDevice: 'default', ...mehr },
        // WIE AUSGELIEFERT: keine Anmeldung. Genau deshalb ist der Name das
        // Einzige, was zwischen einer fremden Seite und den Daten steht.
        interfacelogin: { state: false, password: '' },
        timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
      },
      null,
      2,
    ),
  )
}
function buendeln(ordner) {
  const eb = [join(BACKEND, 'node_modules/.bin/esbuild'), join(WURZEL, 'node_modules/.bin/esbuild')].find(existsSync)
  if (!eb) {
    console.error('esbuild fehlt (npm install)')
    process.exit(2)
  }
  const ziel = join(ordner, 'server.js')
  const b = spawnSync(eb, [join(BACKEND, 'src/server.ts'), '--bundle', '--platform=node', '--target=node26', `--outfile=${ziel}`], {
    encoding: 'utf8',
  })
  if (b.status !== 0) {
    console.error(b.stderr)
    process.exit(2)
  }
  return ziel
}
async function starten(platz, gebaut, port, riegelAus = false) {
  const u = { ...process.env }
  delete u.NODE_ENV // auf der Box ist es nicht gesetzt — dieser Zweig soll laufen
  delete u.MUPIBOX_HERKUNFT_ZUSATZ
  delete u.MUPIBOX_HOST_ZUSATZ
  delete u.MUPIBOX_HERKUNFT_AUS
  if (riegelAus) u.MUPIBOX_HERKUNFT_AUS = '1'
  Object.assign(u, {
    MUPIBOX_HTTP_PORT: String(port),
    MUPIBOX_HTTPS_PORT: String(port + 2),
    MUPIBOX_TLS_DIR: join(platz.ordner, 'tls'),
    MUPIBOX_CONFIG: platz.datei,
    MUPIBOX_LOCK_DIR: platz.ordner,
    MUPIBOX_SICHERUNG_STAENDE: platz.staende,
  })
  const kind = spawn(process.execPath, [gebaut], { cwd: platz.ordner, env: u, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  kind.stdout.on('data', (d) => {
    log += d
  })
  kind.stderr.on('data', (d) => {
    log += d
  })
  for (let i = 0; i < 260; i++) {
    if (kind.exitCode !== null) throw new Error(`Server endete mit ${kind.exitCode}\n${log}`)
    try {
      // NICHT „Status 200": das kann jeder Prozess auf diesem Port. `httpsPort`
      // gibt der Server aus SEINER Umgebung zurueck, und die habe ich gerade
      // selbst auf `port + 2` gesetzt — kein fremder Prozess sagt das.
      const a = await anfrage({ weg: '/api/streaming', port, host: `127.0.0.1:${port}` })
      if (a.status === 200 && JSON.parse(a.rumpf)?.httpsPort === port + 2) return { kind, log: () => log }
    } catch {
      /* noch nicht oben */
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  kind.kill('SIGKILL')
  throw new Error(`auf ${port} antwortet nicht MEIN Prozess (httpsPort != ${port + 2})\n${log}`)
}

/* ── 3. ANFRAGEN, BYTE FUER BYTE ─────────────────────────────────────────── */
// `fetch` laesst `Host` nicht setzen und schickt keine zweite Host-Kopfzeile.
// Genau das sind die Faelle, um die es hier geht.
function roh({ zeile, koepfe = [], rumpf = '', port = P_AN }) {
  return new Promise((f, s) => {
    const c = net.connect(port, '127.0.0.1')
    let t = ''
    const alle = [...koepfe]
    if (rumpf) alle.push(['Content-Length', String(Buffer.byteLength(rumpf))])
    alle.push(['Connection', 'close'])
    c.setTimeout(9000)
    c.on('connect', () => c.write(`${zeile}\r\n${alle.map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n${rumpf}`))
    c.on('data', (d) => {
      t += d
    })
    c.on('timeout', () => {
      c.destroy()
      s(new Error('Zeit abgelaufen'))
    })
    c.on('error', s)
    c.on('close', () => {
      const i = t.indexOf('\r\n\r\n')
      const kt = i < 0 ? t : t.slice(0, i)
      const rest = i < 0 ? '' : t.slice(i + 4)
      const zs = kt.split('\r\n')
      const kopf = {}
      for (const z of zs.slice(1)) {
        const j = z.indexOf(':')
        if (j > 0) kopf[z.slice(0, j).trim().toLowerCase()] = z.slice(j + 1).trim()
      }
      f({ status: Number(zs[0]?.split(' ')[1] ?? 0), kopf, rumpf: stueckeAufloesen(rest, kopf) })
    })
  })
}
function stueckeAufloesen(rest, kopf) {
  if ((kopf['transfer-encoding'] ?? '') !== 'chunked') return rest
  let p = 0
  let aus = ''
  while (p < rest.length) {
    const e = rest.indexOf('\r\n', p)
    if (e < 0) break
    const n = Number.parseInt(rest.slice(p, e).split(';')[0], 16)
    if (!Number.isFinite(n) || n === 0) break
    aus += rest.slice(e + 2, e + 2 + n)
    p = e + 2 + n + 2
  }
  return aus
}
const anfrage = ({ weg, methode = 'GET', koepfe = [], rumpf = '', host, port = P_AN }) =>
  roh({ zeile: `${methode} ${weg} HTTP/1.1`, koepfe: [['Host', host ?? `127.0.0.1:${port}`], ...koepfe], rumpf, port })

const jsonVon = (a) => {
  try {
    return JSON.parse(a.rumpf)
  } catch {
    return null
  }
}
const grund = (a) => jsonVon(a)?.grund ?? ''
/** Der Satz, den der Mensch zu sehen bekommt. Der Riegel legt ihn unter
 *  `fehler` UND `error` ab — beide, weil zwei Oberflaechen ihn lesen. */
const ablehnungssatz = (a) => {
  const j = jsonVon(a)
  return String(j?.fehler ?? j?.error ?? '')
}

/* ── 4. DER SCHREIBVORGANG, AN DEM SICH ALLES ENTSCHEIDET ────────────────── */
// Die Antwort ist NICHT der Beweis. Nur die Datei ist es — genau daran ist der
// urspruengliche Befund entstanden.
const lautstaerke = (datei) => String(JSON.parse(readFileSync(datei, 'utf8'))?.mupibox?.startVolume ?? '')
// `startLautstaerke` ist die Feldkennung aus konfiguration.ts; sie schreibt
// `mupibox.startVolume`. Genau diesen Rumpf schickt die Verwaltung.
const SCHREIBRUMPF = (wert) => JSON.stringify({ aenderungen: { startLautstaerke: wert } })

async function schreibversuch(platz, { host, origin, wert = 57, port = P_AN }) {
  konfigSchreiben(platz.datei, {}) // immer von 41 aus
  const koepfe = origin === undefined ? [] : [['Origin', origin]]
  koepfe.push(['Content-Type', 'application/json'])
  const a = await anfrage({ weg: '/api/konfiguration', methode: 'POST', host, port, koepfe, rumpf: SCHREIBRUMPF(wert) })
  return { antwort: a, inDerDatei: lautstaerke(platz.datei) }
}
/** Der Wert, den ein LESENDER Zugriff herausgibt — aus der Feldliste. */
const lautstaerkeAusAntwort = (a) => String(jsonVon(a)?.felder?.find((f) => f.id === 'startLautstaerke')?.wert ?? '')

/* ══ LAUF ═════════════════════════════════════════════════════════════════ */
const platz = platzBauen()
const gebaut = buendeln(platz.ordner)
let an = null
let aus = null
try {
  console.log(`\nZweitmessung — Riegel an auf ${P_AN}, Gegenprobe auf ${P_AUS}`)
  console.log(`Rechnername ${RECHNER} · Marke ${MARKE} · LAN ${LAN ?? '(keine)'} · Konfigname ${KONFIGNAME}\n`)
  an = await starten(platz, gebaut, P_AN, false)
  ok('auf dem Port antwortet MEIN Prozess (httpsPort aus meiner Umgebung)', true)

  /* ─ RING 1 ─ */
  console.log('\nRING 1 — der Namenstausch, schreibend, IN DER DATEI nachgesehen')
  {
    const r = await schreibversuch(platz, { host: 'boese.example', origin: 'http://boese.example' })
    ok('Host+Origin boese.example wird abgewiesen', r.antwort.status === 403, `Status ${r.antwort.status}, Grund ${grund(r.antwort)}`)
    ok('die Lautstaerke IN DER DATEI blieb 41', r.inDerDatei === '41', `Datei sagt ${r.inDerDatei}`)
    const l = await anfrage({ weg: '/api/konfiguration', host: 'boese.example', koepfe: [['Origin', 'http://boese.example']] })
    ok('lesend kommt unter fremdem Namen nichts heraus', l.status === 403 && lautstaerkeAusAntwort(l) === '', `Status ${l.status}`)
    // Eine gleichherkuenftige GET-Anfrage traegt gar keinen Origin. Genau die
    // haette der alte Riegel durchgelassen, weil er nur Origin ansah.
    const o = await anfrage({ weg: '/api/konfiguration', host: 'boese.example' })
    ok('auch OHNE Origin kommt der fremde Name nicht durch', o.status === 403, `Status ${o.status}, Grund ${grund(o)}`)
  }

  console.log('\nRING 1b — DIE GEGENPROBE: derselbe Vorgang, Riegel abgeschaltet')
  aus = await starten(platz, gebaut, P_AUS, true)
  {
    const r = await schreibversuch(platz, { host: 'boese.example', origin: 'http://boese.example', port: P_AUS })
    ok(
      'ohne Riegel schreibt der Namenstausch WIRKLICH (41 -> 57)',
      r.antwort.status === 200 && r.inDerDatei === '57',
      `Status ${r.antwort.status}, Datei ${r.inDerDatei}`,
    )
    if (r.inDerDatei !== '57') notiz('ohne diesen roten Lauf misst Ring 1 nichts — dann ist die gruene Tafel wertlos')
  }
  konfigSchreiben(platz.datei, {})

  /* ─ RING 2 ─ */
  console.log('\nRING 2 — Formen der Host-Kopfzeile, die ein Riegel gern uebersieht')
  const mussAbprallen = [
    ['schlichter fremder Name', 'boese.example'],
    ['Grossschreibung', 'BOESE.Example'],
    ['Punkt am Ende', 'boese.example.'],
    ['Praefix eines erlaubten Namens', `${LAN ?? '127.0.0.1'}.boese.example`],
    ['eigene Marke unter kaeuflicher Endung', `${MARKE}.boese.example`],
    ['eigene Marke unter .box — KAEUFLICH, darf NICHT gelten', `${MARKE}.box`],
    ['Konfigname unter kaeuflicher Endung', `${KONFIGNAME}.example.com`],
    ['fremde Adresse', '10.11.12.13'],
    ['fremde Adresse mit Port', '10.11.12.13:8200'],
    ['fremdes IPv6 in Klammern', '[2001:db8::99]:8200'],
    // Der Anmeldeteil ist die Falle: `new URL` liest hier `boese.example` als
    // Rechner. Wer stattdessen bis zum ersten `@` liest, sperrt auf.
    ['Anmeldeteil vor dem Wirt', `${MARKE}@boese.example`],
    ['Anmeldeteil mit Doppelpunkt', `${MARKE}:geheim@boese.example`],
    ['Unterdomaene der eigenen Marke, kaeuflich', `a.${MARKE}.boese.example`],
    ['Punycode-Schreibweise eines fremden Namens', 'xn--bse-qla.example'],
    ['localhost als erste Marke eines fremden Namens', 'localhost.boese.example'],
  ]
  for (const [was, host] of mussAbprallen) {
    const r = await schreibversuch(platz, { host, origin: `http://${host}` })
    ok(`prallt ab: ${was}`, r.antwort.status === 403 && r.inDerDatei === '41', `Status ${r.antwort.status}, Datei ${r.inDerDatei}`)
  }
  for (const [was, ersteZeile, zweiteZeile] of [
    ['fremd zuerst, eigen danach', 'boese.example', `127.0.0.1:${P_AN}`],
    ['eigen zuerst, fremd danach', `127.0.0.1:${P_AN}`, 'boese.example'],
  ]) {
    // ZWEI Host-Kopfzeilen. ROT ist nur, wenn der FREMDE Name gewinnt und
    // dabei geschrieben wird — dass die EIGENE gewinnt, ist harmlos (ein
    // Browser schickt ohnehin nur eine, und faelschen kann er sie nicht).
    konfigSchreiben(platz.datei, {})
    const a = await roh({
      zeile: 'POST /api/konfiguration HTTP/1.1',
      koepfe: [['Host', ersteZeile], ['Host', zweiteZeile], ['Content-Type', 'application/json']],
      rumpf: SCHREIBRUMPF(57),
    })
    const gewinner = ersteZeile // Node behaelt bei `host` die ERSTE Kopfzeile
    const fremdGewinnt = gewinner === 'boese.example' && lautstaerke(platz.datei) === '57'
    ok(`zwei Host-Kopfzeilen (${was}): der fremde Name gewinnt nicht`, !fremdGewinnt, `Status ${a.status}, Datei ${lautstaerke(platz.datei)}`)
  }
  {
    // Absolute Anfragezeile: der fremde Name steht im Ziel.
    konfigSchreiben(platz.datei, {})
    const a = await roh({
      zeile: 'POST http://boese.example/api/konfiguration HTTP/1.1',
      koepfe: [
        ['Host', 'boese.example'],
        ['Origin', 'http://boese.example'],
        ['Content-Type', 'application/json'],
      ],
      rumpf: SCHREIBRUMPF(57),
    })
    ok('absolute Anfragezeile schreibt nicht', lautstaerke(platz.datei) === '41', `Status ${a.status}, Datei ${lautstaerke(platz.datei)}`)
  }

  /* ─ RING 3 ─ */
  console.log('\nRING 3 — jeder Name, unter dem diese Maschine wirklich erreicht wird')
  const echteNamen = [
    'localhost',
    `localhost:${P_AN}`,
    '127.0.0.1',
    `127.0.0.1:${P_AN}`,
    '[::1]',
    `[::1]:${P_AN}`,
    RECHNER,
    `${RECHNER}:${P_AN}`,
    MARKE,
    `${MARKE}.local`,
    `${MARKE}.local:${P_AN}`,
    `${MARKE}.local.`, // der Punkt am Ende, den mancher Router mitschickt
    `${MARKE}.fritz.box:${P_AN}`,
    `${MARKE}.lan`,
    `${MARKE}.home.arpa`,
    `${MARKE}.internal`,
    KONFIGNAME,
    `${KONFIGNAME}.local:${P_AN}`,
    `${MARKE.toUpperCase()}.LOCAL`,
    ...(LAN ? [LAN, `${LAN}:${P_AN}`] : []),
  ]
  for (const host of echteNamen) {
    const l = await anfrage({ weg: '/api/konfiguration', host, koepfe: [['Origin', `http://${host}`]] })
    const s = await schreibversuch(platz, { host, origin: `http://${host}` })
    const v = await anfrage({
      weg: '/api/konfiguration',
      methode: 'OPTIONS',
      host,
      koepfe: [
        ['Origin', `http://${host}`],
        ['Access-Control-Request-Method', 'POST'],
      ],
    })
    ok(
      `kommt durch: ${host}`,
      l.status === 200 && s.antwort.status === 200 && s.inDerDatei === '57' && v.status < 400,
      `lesen ${l.status}, schreiben ${s.antwort.status}/Datei ${s.inDerDatei}, Vorabfrage ${v.status}`,
    )
  }
  konfigSchreiben(platz.datei, {})
  {
    // Ohne Host (HTTP/1.0) und mit leerem Host: die Entscheidung war
    // „durchlassen". Ich messe sie, statt sie zu glauben.
    const a = await roh({ zeile: 'GET /api/konfiguration HTTP/1.0', koepfe: [] })
    notiz(`HTTP/1.0 ganz ohne Host: Status ${a.status} (bewusst durchgelassen — ein Browser schickt Host immer)`)
    const b = await anfrage({ weg: '/api/konfiguration', host: '' })
    notiz(`leerer Host: Status ${b.status} (bewusst durchgelassen)`)
  }

  /* ─ RING 4 ─ */
  console.log('\nRING 4 — der Ausweg in der Ablehnung: genannt UND benutzt')
  {
    const a = await anfrage({ weg: '/api/konfiguration', host: 'boese.example' })
    const satz = ablehnungssatz(a)
    ok('die Ablehnung nennt den gerufenen Namen', satz.includes('boese.example'), satz.slice(0, 70))
    ok('die Ablehnung nennt den Weg ohne SSH (hostZusatz)', satz.includes('hostZusatz'))
    const genannt = [...satz.matchAll(/https?:\/\/(\[[^\]]+\]|[^\s/:]+)/g)].map((m) => m[1])
    ok('die Ablehnung nennt ueberhaupt eine Adresse', genannt.length > 0, genannt.join(' '))
    // Jede genannte Adresse wird WIRKLICH aufgerufen. Ein Ausweg, den man nur
    // liest, ist kein Ausweg.
    for (const g of [...new Set(genannt)].slice(0, 5)) {
      const h = `${g}:${P_AN}`
      const t = await anfrage({ weg: '/api/konfiguration', host: h, koepfe: [['Origin', `http://${h}`]] })
      ok(`der genannte Weg traegt WIRKLICH: ${h}`, t.status === 200 && lautstaerkeAusAntwort(t) !== '', `Status ${t.status}`)
    }
  }
  {
    // hostZusatz OHNE Neustart — die zweite Haelfte des Auswegs.
    const fremd = 'meine-kiste.example.net'
    const vorher = await anfrage({ weg: '/api/konfiguration', host: fremd })
    konfigSchreiben(platz.datei, { hostZusatz: fremd })
    await new Promise((r) => setTimeout(r, 5600)) // der Puffer ist 5 s
    const mit = await anfrage({ weg: '/api/konfiguration', host: fremd })
    konfigSchreiben(platz.datei, {})
    await new Promise((r) => setTimeout(r, 5600))
    const danach = await anfrage({ weg: '/api/konfiguration', host: fremd })
    ok(
      'hostZusatz greift OHNE Neustart und faellt nach dem Entfernen wieder weg',
      vorher.status === 403 && mit.status === 200 && danach.status === 403,
      `${vorher.status} -> ${mit.status} -> ${danach.status}`,
    )
  }

  /* ─ RING 5 ─ */
  console.log('\nRING 5 — die Wege ausserhalb von /api und /player')
  {
    const s = await anfrage({ weg: '/', host: 'boese.example' })
    notiz(`statische Wurzel unter fremdem Namen: Status ${s.status} (ohne Riegel — dort liegen Seiten, keine Wirkung)`)
    konfigSchreiben(platz.datei, {})
    const p = await anfrage({
      weg: '/konfiguration',
      methode: 'POST',
      host: 'boese.example',
      koepfe: [['Content-Type', 'application/json']],
      rumpf: SCHREIBRUMPF(57),
    })
    ok('kein Schreibweg neben /api', lautstaerke(platz.datei) === '41', `Status ${p.status}, Datei ${lautstaerke(platz.datei)}`)
  }

  /* ─ RING 6: die Sicherungskarte ─ */
  console.log('\nRING 6 — die Warnung der Sicherung: laesst sie sich wieder zum Schweigen bringen?')
  // DIE NAMEN SIND NICHT FREI: `standNamen` nimmt nur `mupibox-sicherung-…
  // .tar.gz`. Und die Liste heisst im stand.json `unbekannt`, nicht so wie
  // das Feld in der Antwort — beides am Quelltext nachgesehen, nicht geraten.
  const standSchreiben = (name, unbekannt, kaputt = false) => {
    const kopf = JSON.stringify({ format: 1, erzeugt: name, grund: 'probe', host: 'probe', dateien: [], unbekannt })
    // Der Kopf liegt als `stand.json` in einem tar.gz. Ein „kaputter" Stand
    // ist schlicht kein gzip — genau der Fall aus dem Befund.
    const inhalt = kaputt ? Buffer.from('das ist kein gzip, sondern Text') : tarGz('stand.json', kopf)
    writeFileSync(join(platz.staende, name), inhalt)
  }
  // Ein minimales tar.gz mit genau einer Datei — kein fremdes Werkzeug noetig.
  function tarGz(name, inhalt) {
    const daten = Buffer.from(inhalt, 'utf8')
    const kopf = Buffer.alloc(512)
    kopf.write(name, 0, 100, 'utf8')
    kopf.write('0000644\0', 100)
    kopf.write('0000000\0', 108)
    kopf.write('0000000\0', 116)
    kopf.write(`${daten.length.toString(8).padStart(11, '0')}\0`, 124)
    kopf.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136)
    kopf.write('        ', 148) // Pruefsumme zunaechst Leerzeichen
    kopf.write('0', 156)
    kopf.write('ustar\0', 257)
    kopf.write('00', 263)
    let summe = 0
    for (const b of kopf) summe += b
    kopf.write(`${summe.toString(8).padStart(6, '0')}\0 `, 148)
    const fuell = Buffer.alloc((512 - (daten.length % 512)) % 512)
    return gzipSync(Buffer.concat([kopf, daten, fuell, Buffer.alloc(1024)]))
  }
  const lage = async () => {
    for (const weg of ['/api/sicherung/lage', '/api/sicherung', '/api/sicherung/staende']) {
      const a = await anfrage({ weg, host: `127.0.0.1:${P_AN}` })
      if (a.status === 200) return { weg, ...a, j: jsonVon(a) }
    }
    return null
  }
  {
    standSchreiben('mupibox-sicherung-2026-08-01-000000.tar.gz', [{ pfad: '/home/dietpi/.mupibox/eigenes.json', warum: 'unbekannt' }])
    const mitFund = await lage()
    if (!mitFund) {
      notiz('kein lesbarer Weg zur Sicherungslage gefunden — Ring 6 nicht gemessen')
    } else {
      const text = JSON.stringify(mitFund.j)
      ok(`die Warnung steht bei einem gueltigen Stand (${mitFund.weg})`, text.includes('eigenes.json'), `${text.length} Zeichen`)
      // Jetzt der Befund: ein NEUERER Stand, der kein gzip ist.
      standSchreiben('mupibox-sicherung-2026-08-02-000000.tar.gz', [], true)
      const mitKaputt = await lage()
      const t2 = JSON.stringify(mitKaputt?.j ?? {})
      ok(
        'ein kaputter NEUESTER Stand bringt die Warnung nicht zum Verschwinden',
        t2.includes('eigenes.json'),
        `${t2.length} Zeichen`,
      )
      ok('und der kaputte Stand wird beim Namen genannt', t2.includes('mupibox-sicherung-2026-08-02-000000.tar.gz'), t2.slice(0, 60))
      // Der Deckel: sehr viele, sehr lange Pfade.
      const viele = Array.from({ length: 400 }, (_, i) => ({ pfad: `/home/dietpi/${'x'.repeat(190)}/${i}.json`, warum: 'unbekannt' }))
      standSchreiben('mupibox-sicherung-2026-08-03-000000.tar.gz', viele)
      const grosse = await lage()
      const t3 = JSON.stringify(grosse?.j ?? {})
      ok('400 sehr lange Pfade ergeben keine Wand', t3.length < 12000, `${t3.length} Zeichen`)
      ok('die volle Zahl 400 steht trotzdem im Satz', t3.includes('400'), t3.length > 0 ? 'ja' : 'leer')
    }
  }

  /* ─ RING 7: die Kopfzeilen, die ein ECHTER Browser schickt ─ */
  console.log('\nRING 7 — mit den Kopfzeilen eines echten Browsers')
  {
    // (a) Der klassische Fall, den der ALTE Riegel schon fangen musste: eigener
    //     Host, FREMDER Origin. Wird der Namensteil zu frueh zufrieden, faellt
    //     genau diese Pruefung hinten herunter.
    const eigen = `${LAN ?? '127.0.0.1'}:${P_AN}`
    const r = await schreibversuch(platz, { host: eigen, origin: 'http://boese.example' })
    ok(
      'eigener Host, FREMDER Origin wird weiterhin abgewiesen',
      r.antwort.status === 403 && r.inDerDatei === '41',
      `Status ${r.antwort.status}, Grund ${grund(r.antwort)}, Datei ${r.inDerDatei}`,
    )
    const s = await anfrage({
      weg: '/api/konfiguration',
      methode: 'POST',
      host: eigen,
      koepfe: [
        ['Origin', 'http://boese.example'],
        ['Sec-Fetch-Site', 'cross-site'],
        ['Sec-Fetch-Mode', 'cors'],
        ['Sec-Fetch-Dest', 'empty'],
        ['Content-Type', 'application/json'],
      ],
      rumpf: SCHREIBRUMPF(57),
    })
    ok('dasselbe mit Sec-Fetch-Site: cross-site', s.status === 403, `Status ${s.status}, Grund ${grund(s)}`)
    // (b) Ein Link von einer fremden Seite auf /api — Navigation der obersten
    //     Ebene. Unter /api steht `seitenwechselErlaubt: false`.
    const n = await anfrage({
      weg: '/api/konfiguration',
      host: eigen,
      koepfe: [
        ['Sec-Fetch-Site', 'cross-site'],
        ['Sec-Fetch-Mode', 'navigate'],
        ['Sec-Fetch-Dest', 'document'],
      ],
    })
    ok('der Link von einer fremden Seite auf /api wird abgewiesen', n.status === 403, `Status ${n.status}, Grund ${grund(n)}`)
  }
  {
    // (c) DIE VERWALTUNG, wie der Browser sie wirklich abschickt: die Seite
    //     liegt unter DIESEM Namen, also same-origin. Das ist der Weg, auf dem
    //     der Besitzer sitzt — hier rot heisst: Box unbedienbar.
    for (const wirt of [`${RECHNER}:${P_AN}`, ...(LAN ? [`${LAN}:${P_AN}`] : []), `${MARKE}.local:${P_AN}`, `localhost:${P_AN}`]) {
      const browser = [
        ['Origin', `http://${wirt}`],
        ['Referer', `http://${wirt}/admin/`],
        ['Sec-Fetch-Site', 'same-origin'],
        ['Sec-Fetch-Mode', 'cors'],
        ['Sec-Fetch-Dest', 'empty'],
      ]
      const l = await anfrage({ weg: '/api/konfiguration', host: wirt, koepfe: browser })
      konfigSchreiben(platz.datei, {})
      const s = await anfrage({
        weg: '/api/konfiguration',
        methode: 'POST',
        host: wirt,
        koepfe: [...browser, ['Content-Type', 'application/json']],
        rumpf: SCHREIBRUMPF(57),
      })
      // Und die Seite selbst holen, wie ein Mensch sie aufruft (Navigation).
      const seite = await anfrage({
        weg: '/admin/',
        host: wirt,
        koepfe: [
          ['Sec-Fetch-Site', 'none'],
          ['Sec-Fetch-Mode', 'navigate'],
          ['Sec-Fetch-Dest', 'document'],
        ],
      })
      ok(
        `die Verwaltung arbeitet unter ${wirt}`,
        l.status === 200 && s.status === 200 && lautstaerke(platz.datei) === '57' && seite.status !== 403,
        `lesen ${l.status}, speichern ${s.status}/Datei ${lautstaerke(platz.datei)}, Seite ${seite.status}`,
      )
    }
    konfigSchreiben(platz.datei, {})
  }

  console.log(`\n${zeilen - rot} von ${zeilen} Zeilen gruen, ${rot} rot.\n`)
} finally {
  an?.kind.kill('SIGKILL')
  aus?.kind.kill('SIGKILL')
  try {
    rmSync(platz.ordner, { recursive: true, force: true })
  } catch {
    /* Wegwerf-Verzeichnis */
  }
}
process.exit(rot === 0 ? 0 : 1)
