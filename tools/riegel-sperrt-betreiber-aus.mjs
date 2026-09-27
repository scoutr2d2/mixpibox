#!/usr/bin/env node
/**
 * SPERRT DER HERKUNFTSRIEGEL DEN BETREIBER AUS?
 *
 * ══ DIE FRAGE, UND WARUM SIE DIE TEUERSTE IST ══════════════════════════════
 * Seit dem 07.08.2026 steht vor `/api` und `/player` ein Riegel (herkunft.ts),
 * der Anfragen mit FREMDER Herkunft abweist. tools/herkunftsriegel-probe.mjs
 * misst, ob er den Angreifer haelt. DIESES Werkzeug misst die andere Richtung,
 * und die ist die gefaehrlichere:
 *
 *     Ein Riegel, der zu VIEL faengt, faellt nicht auf. Er faellt AUS.
 *
 * Wer davorsitzt, sieht eine halb geladene Box, eine Verwaltungsseite mit
 * leeren Karten, einen Speichern-Knopf, der nichts tut. Und wenn der Betreiber
 * nicht davorsitzt — was hier der Normalfall ist —, merkt es niemand, bis ein
 * Kind vor einer toten Box steht. Deshalb ist die Beweislast hier umgedreht:
 * jede Zeile fragt „KOMMT ES DURCH?", nicht „wird es gehalten?".
 *
 * ══ WAS GEMESSEN WIRD ══════════════════════════════════════════════════════
 *  RING 1  DIE VIER HERKUENFTE, MIT ECHTEM PAAR AUS `Origin` UND `Host`.
 *          keine · http://localhost:8200 · http://192.168.178.169:8200 ·
 *          https://192.168.178.169:8443 — je Weg-Art und JE MIT VORABFRAGE
 *          (OPTIONS). Nicht `127.0.0.1` gegen `127.0.0.1`: das misst nur, dass
 *          zwei gleiche Zeichenketten gleich sind. Hier steht in `Host`
 *          wirklich das, was auf der Box steht.
 *  RING 2  DIE VERWALTUNG IM ECHTEN BROWSER. Alle 16 Wege aus app.routes.ts,
 *          einzeln aufgeschlagen, jede Netzanfrage mitgeschrieben. Danach ein
 *          echter Klick auf „Speichern" (nachgesehen wird in der DATEI) und
 *          auf „Sicherung anlegen" (nachgesehen wird im Stand-Verzeichnis).
 *  RING 3  DER KIOSK unter /neu/ — die Oberflaeche, die das Kind sieht. Sie
 *          ruft dutzende Wege; faellt EINER, ist die Box halb geladen.
 *  RING 4  DIE WERKZEUGE AUS tools/. Sie messen gegen die Box; kommen sie
 *          noch durch? Gemessen wird mit ihrem ECHTEN Client (node `fetch`,
 *          `curl`, python `urllib`), nicht mit einem nachgebauten.
 *  RING 6  DER WEG HINEIN. Ein Link aus dem Wiki, ein Lesezeichen, die
 *          Weiterleitung von accounts.spotify.com — kommt ein MENSCH noch an
 *          `/admin` und `/spotify` an? Das ist der Rueckweg; wer ihn verliert,
 *          verliert die Box.
 *  RING 5  DIE GEGENPROBE. Eine fremde Herkunft MUSS haengenbleiben. Ohne
 *          diesen Ring sagt „alles gruen" nur, dass der Riegel nichts tut.
 *  RING 7  MIT EINGESCHALTETER ANMELDUNG — dem einzigen Rat, den herkunft.ts
 *          jemandem gibt, der mehr Schutz will. Anmelden ist ein POST, und ein
 *          POST traegt IMMER einen `Origin`; kein Passwort hilft, wenn schon
 *          der Weg zum Passwortfeld 403 sagt. Zweiter Serverprozess, eigene
 *          Konfiguration — der erste bleibt so, wie er gemessen wurde.
 *
 * ══ WARUM AN EINEM ECHTEN SERVERPROZESS UND EINEM ECHTEN BROWSER ═══════════
 * Die Reihenfolge der Zwischenschichten (`herkunftsriegel` vor `cors()`), die
 * Kopfzeilen, die am Ende wirklich herausgehen, und die Frage, was ein Browser
 * daraus macht — nichts davon ist in einer Spec messbar. Gebuendelt wird wie
 * auf der Box (esbuild, OHNE `NODE_ENV`), gestartet ueber einem Wegwerf-
 * Verzeichnis, auf einem Portblock, der vorher wirklich gebunden wurde.
 *
 * ══ ECHTE RECHNERNAMEN OHNE ECHTES NETZ ════════════════════════════════════
 * Der Browser bekommt `--host-resolver-rules`, damit `mupibox.local` und
 * `192.168.178.169` auf die Rueckschleife zeigen. Damit ist die Herkunft im
 * Browser eine ECHTE fremde Zeichenkette und nicht `localhost` gegen
 * `localhost` — ohne dass diese Probe je das Netz oder die Box beruehrt.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/riegel-sperrt-betreiber-aus.mjs [--port 9621]
 *          [--ohne-browser] [--nur 1,2,5] [--stehenlassen]
 *
 * Ohne `--nur` laufen alle sieben Ringe.
 *
 * NUR AUF DIESEM RECHNER. Nichts wird ausgeliefert, an der Box nichts
 * angefasst, kein Dienst geschaltet, keine Datei des Arbeitsbaums geaendert.
 * Rueckgabewert: 0, wenn jede Zeile stimmt.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http, { createServer } from 'node:http'
import https from 'node:https'
import { createRequire } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eigenerBrowser } from './leihgabe.mjs'

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND = join(WURZEL, 'src', 'backend-api')

const argv = process.argv.slice(2)
const opt = (n, v) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : v
}
const OHNE_BROWSER = argv.includes('--ohne-browser')
const STEHENLASSEN = argv.includes('--stehenlassen')
const NUR = new Set(
  String(opt('nur', '1,2,3,4,5,6,7'))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)
const ringAn = (n) => NUR.has(String(n))

/* ══ 0. EIN PORTBLOCK, DER WIRKLICH FREI IST ══════════════════════════════ */

/**
 * DIE NARBE AUS DER ERSTEN RUNDE (steht auch ueber herkunftsriegel-probe.mjs):
 * auf 9601/9701 lagen Server anderer Sitzungen, der eigene starb mit
 * EADDRINUSE — und die Probe mass weiter, am fremden Prozess, und lieferte
 * eine vollstaendige Tafel ueber Software, die hier gar nicht lief. Jeder
 * gebrauchte Port wird deshalb vorher wirklich gebunden, und `serverStarten`
 * prueft danach, ob die Antwort ueberhaupt von DIESEM Backend kommt.
 */
async function portFrei(p) {
  return await new Promise((fertig) => {
    const s = net.createServer()
    s.once('error', () => fertig(false))
    s.once('listening', () => s.close(() => fertig(true)))
    s.listen(p, '127.0.0.1')
  })
}

async function blockSuchen(von, bis) {
  for (let p = von; p <= bis; p++) {
    // p (http), p+1 (https), p+2 (der Abspieler-Platzhalter). Der Debug-Port
    // des Browsers braucht keinen Platz im Block — den holt sich
    // `eigenerBrowser()` selbst frei.
    if ((await Promise.all([portFrei(p), portFrei(p + 1), portFrei(p + 2)])).every(Boolean)) return p
  }
  throw new Error(`kein freier Portblock zwischen ${von} und ${bis}`)
}

const GEWUENSCHT = Number(opt('port', '9621'))
const PORT = await blockSuchen(GEWUENSCHT, GEWUENSCHT + 200)
if (PORT !== GEWUENSCHT) console.log(`(Port ${GEWUENSCHT} war belegt — diese Probe laeuft auf ${PORT})`)
const PORT_TLS = PORT + 1

/**
 * WO DER ABSPIELER STEHT — UND ZWAR EINER, DER MIR GEHOERT.
 *
 * DRITTE NARBE DESSELBEN TAGES. `/player/*` wird in server.ts an
 * `127.0.0.1:5005` weitergereicht (`PLAYER_PROXY_PORT`). Auf diesem Rechner
 * HORCHTE dort etwas — nicht von dieser Probe gestartet. Die Zeile „abspielen
 * kommt durch — 200" war damit eine Aussage ueber einen fremden Prozess: sie
 * haette genauso gut 200 gesagt, wenn der Weiterreichung nichts gefehlt haette
 * ausser dem Ziel.
 *
 * Also bekommt die Probe ihren eigenen Platzhalter auf einem Port aus ihrem
 * eigenen Block, und `PLAYER_PROXY_PORT` zeigt darauf. Was danach an
 * `/player/state` ankommt, ist nachweislich durch diesen Server gegangen —
 * und der Platzhalter sagt es auch, mit einem Feld, das nur er kennt.
 */
const PORT_SPIELER = PORT + 2

let fehler = 0
let offen = 0
const pruefe = (satz, ok, dazu = '') => {
  console.log(`  ${ok ? 'ok  ' : 'NEIN'} ${satz}${dazu ? `  — ${dazu}` : ''}`)
  if (!ok) fehler++
}
const merke = (satz) => {
  console.log(`  ??   ${satz}`)
  offen++
}
const ueberschrift = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 70 - t.length))}`)

/* ══ 1. EIN ARBEITSPLATZ, DER AUSSIEHT WIE DIE BOX ════════════════════════ */

/**
 * Der Server laeuft ohne `NODE_ENV` in seinem Produktivzweig; der sucht
 * `www`/`www-admin` NEBEN SICH und liest die Konfiguration relativ zum
 * Arbeitsverzeichnis. Also wird ein Wegwerf-Verzeichnis gebaut, das genauso
 * aussieht — ein Verweis auf src/deploy waere der echte Baum, und ein
 * Fehlgriff schriebe hinein.
 */
function arbeitsplatz() {
  const ordner = mkdtempSync(join(tmpdir(), 'mupi-riegel-betreiber-'))
  const konf = join(ordner, 'server', 'config')
  mkdirSync(konf, { recursive: true })
  const mit = join(WURZEL, 'config')
  for (const d of ['active_data.json', 'network_config.json', 'monitor.json', 'albumstop.json']) {
    if (existsSync(join(mit, d))) cpSync(join(mit, d), join(konf, d))
  }
  writeFileSync(
    join(konf, 'mupiboxconfig.json'),
    JSON.stringify(
      {
        // `audioDevice` MUSS hier stehen: `pruefeKonfig` lehnt sonst JEDES
        // Schreiben ab („die Box haette keinen Ton"), und die Schreibprobe
        // misst dann eine luecken­hafte Vorlage statt den Riegel.
        mupibox: { host: 'MuPiBox', startVolume: '40', maxVolume: '100', audioDevice: 'default' },
        // WIE AUSGELIEFERT: keine Anmeldung. Genau dieser Zustand ist der
        // Grund, warum der Riegel gebaut wurde — und der Zustand, in dem er
        // die Verwaltung auf keinen Fall aussperren darf.
        interfacelogin: { state: false, password: '' },
        timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
      },
      null,
      2,
    ),
  )

  // Die gebaute Verwaltung.
  const adminQuelle = [join(WURZEL, 'src/deploy/www-admin'), join(WURZEL, 'src/frontend-admin/www-admin')].find(
    existsSync,
  )
  if (adminQuelle) cpSync(adminQuelle, join(ordner, 'www-admin'), { recursive: true })

  // Die Box-Oberflaeche.
  //
  // `src/deploy/www/browser` UND NICHT `src/deploy/www`: der Angular-Bau legt
  // die Seiten unter `browser/` ab, auf der Box liegen sie FLACH in `www/`
  // (07.08.2026 am Geraet nachgesehen:
  // ~/.mupibox/Sonos-Kids-Controller-master/www/ enthaelt index.html direkt).
  // Mit der falschen Ebene antwortet `/` und `/spotify` mit 404 — und dann
  // misst Ring 6 „nicht vom Riegel abgewiesen" an einer Seite, die es im
  // Sandkasten gar nicht gibt. Das ist keine Aussage, das ist ein Loch.
  const wwwQuelle = [join(WURZEL, 'src/deploy/www/browser'), join(WURZEL, 'src/deploy/www')].find((p) =>
    existsSync(join(p, 'index.html')),
  )
  if (wwwQuelle) cpSync(wwwQuelle, join(ordner, 'www'), { recursive: true })
  else mkdirSync(join(ordner, 'www'), { recursive: true })
  const wwwDa = Boolean(wwwQuelle)
  const kioskQuelle = join(WURZEL, 'NewDesign')
  const kioskDa = existsSync(join(kioskQuelle, 'index.html'))
  if (kioskDa) cpSync(kioskQuelle, join(ordner, 'www', 'neu'), { recursive: true })

  // Das Sicherungs-Skript. NICHT das echte: `mupibox-sicherung.py` liest und
  // schreibt unter /etc/mupibox und /home/dietpi. Diese Probe darf nichts
  // ausserhalb ihres Wegwerf-Verzeichnisses beruehren. Der Stellvertreter
  // beantwortet genau die zwei Aufrufe, die die Seite macht (`--liste --json`,
  // `--anlegen`) — gemessen wird ohnehin der WEG dorthin, nicht das Python.
  const staende = join(ordner, 'sicherungen')
  mkdirSync(staende, { recursive: true })
  const skript = join(ordner, 'sicherung-stellvertreter.py')
  writeFileSync(
    skript,
    [
      'import json, os, sys, time',
      `STAENDE = ${JSON.stringify(staende)}`,
      'a = sys.argv[1:]',
      'if "--liste" in a:',
      '    aus = []',
      '    for n in sorted(os.listdir(STAENDE)):',
      '        p = os.path.join(STAENDE, n)',
      '        aus.append({"name": n, "bytes": os.path.getsize(p), "zeit": int(os.path.getmtime(p)),',
      '                    "grund": "verwaltung", "mitZugangsdaten": False})',
      '    print(json.dumps(aus))',
      '    sys.exit(0)',
      'if "--anlegen" in a:',
      '    name = "mupibox-" + time.strftime("%Y%m%d-%H%M%S") + "-verwaltung.tar.gz"',
      '    with open(os.path.join(STAENDE, name), "wb") as f:',
      '        f.write(b"nicht-echt-nur-die-probe")',
      '    print(name)',
      '    sys.exit(0)',
      'sys.exit(0)',
    ].join('\n'),
  )

  mkdirSync(join(ordner, 'tls'), { recursive: true })
  return {
    ordner,
    konfigDatei: join(konf, 'mupiboxconfig.json'),
    adminDa: Boolean(adminQuelle),
    wwwDa,
    kioskDa,
    staende,
    skript,
  }
}

/** Die drei Dateien, ueber die dieser Lauf eine Aussage macht. */
const TRAGENDE = ['herkunft.ts', 'sicherung.ts', 'server.ts']

/** Ihr Fingerabdruck, so wie sie GERADE im Arbeitsbaum stehen. */
function fingerabdruck() {
  const a = {}
  for (const d of TRAGENDE) {
    const p = join(BACKEND, 'src', d)
    a[d] = existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12) : '(fehlt)'
  }
  return a
}

/**
 * GEBUENDELT WIRD AUS DEM ARBEITSBAUM — ABER NICHT BLIND.
 *
 * ZWEITE NARBE DESSELBEN TAGES. Am 07.08.2026 arbeitete eine Parallelsitzung
 * waehrend dieses Laufes an `herkunft.ts` und `sicherung.ts`; beide Dateien
 * aenderten sich, waehrend die Probe lief. Herausgekommen waere eine Tafel
 * ueber einen Zwischenstand, den es hinterher nicht mehr gibt — und man haette
 * es der Tafel nicht angesehen.
 *
 * Aus dem Baum HERAUSKOPIEREN ging nicht: esbuild loest den echten Pfad einer
 * Datei auf und sucht `node_modules` von dort aus aufwaerts; ein Abzug unter
 * /tmp findet nichts, ein Verweis daneben hilft nicht, und NODE_PATH liest es
 * nicht. Ein Abzug IM Baum waere schlimmer — er liefe der Parallelsitzung in
 * `tsc` und `biome`.
 *
 * Also der andere Weg: der Fingerabdruck wird VOR dem Buendeln genommen und
 * NACH dem letzten Ring noch einmal. Wandert er, sagt der Lauf es — laut, und
 * mit den Namen der Dateien. Eine Messung, deren Gegenstand sich bewegt hat,
 * darf nicht als Ergebnis durchgehen.
 */
function buendeln(ordner) {
  const esbuild = [
    join(BACKEND, 'node_modules', '.bin', 'esbuild'),
    join(WURZEL, 'node_modules', '.bin', 'esbuild'),
  ].find(existsSync)
  if (!esbuild) {
    console.error('esbuild nicht gefunden — npm install fehlt.')
    process.exit(2)
  }
  const abdruck = fingerabdruck()
  const ziel = join(ordner, 'server.js')
  const bau = spawnSync(
    esbuild,
    [join(BACKEND, 'src', 'server.ts'), '--bundle', '--platform=node', '--target=node26', `--outfile=${ziel}`],
    { encoding: 'utf8' },
  )
  if (bau.status !== 0) {
    console.error('Buendeln fehlgeschlagen:\n', bau.stderr)
    process.exit(2)
  }
  return { ziel, abdruck }
}

async function serverStarten(platz, gebaut, riegelAus = false) {
  const umgebung = { ...process.env }
  // DER GANZE PUNKT: auf der Box ist NODE_ENV nicht gesetzt.
  delete umgebung.NODE_ENV
  Object.assign(umgebung, {
    MUPIBOX_HTTP_PORT: String(PORT),
    MUPIBOX_HTTPS_PORT: String(PORT_TLS),
    MUPIBOX_TLS_DIR: join(platz.ordner, 'tls'),
    MUPIBOX_CONFIG: platz.konfigDatei,
    MUPIBOX_LOCK_DIR: platz.ordner,
    MUPIBOX_ADMIN_DIR: join(platz.ordner, 'www-admin'),
    MUPIBOX_SICHERUNG_SKRIPT: platz.skript,
    MUPIBOX_SICHERUNG_STAENDE: platz.staende,
    // NICHT die 5005 der Box: siehe den Absatz bei PORT_SPIELER.
    PLAYER_PROXY_HOST: '127.0.0.1',
    PLAYER_PROXY_PORT: String(PORT_SPIELER),
  })
  if (riegelAus) umgebung.MUPIBOX_HERKUNFT_AUS = '1'
  else delete umgebung.MUPIBOX_HERKUNFT_AUS

  const kind = spawn(process.execPath, [gebaut], {
    cwd: platz.ordner,
    env: umgebung,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  kind.stdout.on('data', (d) => {
    log += d
  })
  kind.stderr.on('data', (d) => {
    log += d
  })

  // ANTWORTET DA WIRKLICH UNSER SERVER? Nicht „irgendetwas mit 200", sondern
  // eine Antwort, die nur DIESES Backend gibt.
  let oben = false
  for (let i = 0; i < 250 && !oben; i++) {
    if (kind.exitCode !== null) throw new Error(`Server beendete sich mit ${kind.exitCode}:\n${log}`)
    try {
      const a = await roh({ port: PORT, weg: '/api/auth/state' })
      oben = a.status === 200 && typeof JSON.parse(a.text)?.anmeldungNoetig === 'boolean'
    } catch {
      /* noch nicht oben */
    }
    if (!oben) await new Promise((r) => setTimeout(r, 150))
  }
  if (!oben) {
    kind.kill('SIGKILL')
    throw new Error(`auf ${PORT} antwortet nicht dieses Backend:\n${log}`)
  }
  let tlsDa = false
  for (let i = 0; i < 40 && !tlsDa; i++) {
    try {
      tlsDa = (await roh({ port: PORT_TLS, tls: true, weg: '/api/auth/state' })).status === 200
    } catch {
      await new Promise((r) => setTimeout(r, 150))
    }
  }
  return { kind, tlsDa, log: () => log }
}

/* ══ 2. EINE ANFRAGE MIT VOLLER GEWALT UEBER DIE KOPFZEILEN ═══════════════ */

/**
 * NICHT `fetch`: der setzt `Host` selbst und laesst ihn nicht setzen. Genau
 * das braucht dieser Ring aber — `Host: 192.168.178.169:8200` bei einer
 * Verbindung, die auf der Rueckschleife ankommt. Ohne diese Freiheit misst man
 * nur, dass `127.0.0.1` gleich `127.0.0.1` ist.
 */
function roh({ port, tls = false, weg, methode = 'GET', kopf = {}, rumpf = null }) {
  const modul = tls ? https : http
  return new Promise((fertig, schief) => {
    const a = modul.request(
      {
        host: '127.0.0.1',
        port,
        path: weg,
        method: methode,
        headers: { ...kopf, ...(rumpf ? { 'Content-Length': Buffer.byteLength(rumpf) } : {}) },
        rejectUnauthorized: false,
        timeout: 10000,
      },
      (antwort) => {
        let text = ''
        antwort.on('data', (d) => {
          text += d
        })
        antwort.on('end', () =>
          fertig({
            status: antwort.statusCode,
            acao: antwort.headers['access-control-allow-origin'] ?? null,
            vary: antwort.headers.vary ?? null,
            // Fuer Ring 7: ohne den Keks laesst sich nicht messen, ob die
            // Anmeldung wirklich AUFGEMACHT hat oder nur „ok" gesagt hat.
            keks: [].concat(antwort.headers['set-cookie'] ?? []).join('; '),
            text,
          }),
        )
      },
    )
    a.on('error', schief)
    a.on('timeout', () => a.destroy(new Error('Zeit abgelaufen')))
    if (rumpf) a.write(rumpf)
    a.end()
  })
}

/**
 * WER HAT ABGEWIESEN? Es gibt auf diesem Server ZWEI Riegel; sie zu
 * verwechseln macht jede Aussage wertlos.
 *   * 'riegel'    — herkunft.ts, antwortet mit einem Feld `grund`.
 *   * 'sicherung' — der Riegel aus sicherung.ts. Sein Router haengt in
 *                   server.ts OHNE Pfad (`app.use(sicherungWegeBauen(...))`),
 *                   sein `r.use(...)` gilt deshalb fuer JEDE Anfrage der
 *                   ganzen Anwendung. Er weist `Sec-Fetch-Site: cross-site`
 *                   ab und antwortet mit `fehler`, aber ohne `grund`.
 *   * ''          — niemand; die Antwort kommt vom Weg dahinter.
 */
const werWies = (a) => {
  if (a.status !== 403) return ''
  try {
    const k = JSON.parse(a.text)
    if (typeof k?.grund === 'string') return 'riegel'
    if (typeof k?.fehler === 'string') return 'sicherung'
  } catch {
    /* kein JSON — dann war es ein Weg dahinter */
  }
  return ''
}

/* ══ RING 1: DIE VIER HERKUENFTE, MIT ECHTEM PAAR ═════════════════════════ */

/**
 * Die vier Lagen, die es auf dieser Box wirklich gibt. `host` ist das, was in
 * der Kopfzeile steht — also das, was der Browser aus der Adresszeile macht.
 * Bei `keine` gibt es keine Herkunft: curl, ein Skript auf der Box, ein
 * Werkzeug aus tools/.
 */
const LAGEN = [
  { name: 'keine Herkunft (curl, tools/, Skript auf der Box)', origin: null, host: '192.168.178.169:8200', tls: false },
  { name: 'Kiosk  http://localhost:8200', origin: 'http://localhost:8200', host: 'localhost:8200', tls: false },
  {
    name: 'zweiter Rechner  http://192.168.178.169:8200',
    origin: 'http://192.168.178.169:8200',
    host: '192.168.178.169:8200',
    tls: false,
  },
  {
    name: 'ueber TLS  https://192.168.178.169:8443',
    origin: 'https://192.168.178.169:8443',
    host: '192.168.178.169:8443',
    tls: true,
  },
]

/**
 * Die Weg-Arten. Jede ist ein Weg, den die Verwaltung oder der Kiosk WIRKLICH
 * geht — kein erfundener. `soll` ist immer „durch": das ist die Linse.
 */
const WEGE = [
  { name: 'lesen      GET  /api/konfiguration', weg: '/api/konfiguration', methode: 'GET' },
  { name: 'lesen      GET  /api/streaming', weg: '/api/streaming', methode: 'GET' },
  { name: 'lesen      GET  /api/sicherung', weg: '/api/sicherung', methode: 'GET' },
  {
    name: 'schreiben  POST /api/konfiguration',
    weg: '/api/konfiguration',
    methode: 'POST',
    rumpf: JSON.stringify({ aenderungen: { startLautstaerke: 40 } }),
    kopf: { 'Content-Type': 'application/json' },
  },
  // `bisZumSpieler`: es genuegt NICHT, dass hier 200 steht. Die Weiterreichung
  // muss beim Platzhalter DIESER Probe angekommen sein — sonst misst die Zeile
  // nur, dass irgendetwas auf dem Rechner geantwortet hat (siehe PORT_SPIELER).
  { name: 'abspielen  GET  /player/state', weg: '/player/state', methode: 'GET', bisZumSpieler: true },
]

async function ring1(tlsDa) {
  ueberschrift('RING 1 — die vier Herkuenfte, je Weg und je Vorabfrage')
  console.log(
    '  Beweislast umgedreht: jede Zeile MUSS durchkommen. `Host` traegt die\n' +
      '  echte Adresse der Box, nicht 127.0.0.1 — sonst misst der Vergleich sich\n' +
      '  selbst.\n',
  )
  for (const lage of LAGEN) {
    if (lage.tls && !tlsDa) {
      merke(`${lage.name}: kein TLS im Sandkasten (openssl?) — nicht gemessen`)
      continue
    }
    console.log(`  ┌ ${lage.name}`)
    const port = lage.tls ? PORT_TLS : PORT
    for (const w of WEGE) {
      // Die BROWSERKOPFZEILEN gehoeren dazu. Eine eigene Oberflaeche schickt
      // `Sec-Fetch-Site: same-origin` — wer sie weglaesst, misst den zweiten
      // Riegel (sicherung.ts) gar nicht mit und uebersieht damit die Haelfte.
      const browser = lage.origin ? { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors' } : {}
      const kopf = {
        Host: lage.host,
        ...(lage.origin ? { Origin: lage.origin } : {}),
        ...browser,
        ...(w.kopf ?? {}),
      }
      const a = await roh({ port, tls: lage.tls, weg: w.weg, methode: w.methode, kopf, rumpf: w.rumpf ?? null })
      const wer = werWies(a)
      const angekommen = w.bisZumSpieler ? a.text.includes('riegel-sperrt-betreiber-aus') : true
      pruefe(
        `│ ${w.name}${w.bisZumSpieler ? ' (bis zum Abspieler)' : ''}`,
        wer === '' && angekommen,
        wer
          ? `${a.status}, abgewiesen von ${wer}`
          : angekommen
            ? `${a.status}`
            : `${a.status}, aber die Antwort kam NICHT vom Platzhalter dieser Probe`,
      )

      // DIE VORABFRAGE. Sie ist der Fall, wegen dem der Riegel VOR `cors()`
      // steht — und damit auch der Fall, in dem er die eigene Oberflaeche als
      // Erster aussperren wuerde. Ein `fetch` mit `Content-Type:
      // application/json` loest sie aus, also trifft sie jedes Speichern.
      if (lage.origin) {
        const v = await roh({
          port,
          tls: lage.tls,
          weg: w.weg,
          methode: 'OPTIONS',
          kopf: {
            Host: lage.host,
            Origin: lage.origin,
            'Access-Control-Request-Method': w.methode,
            'Access-Control-Request-Headers': 'content-type',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Mode': 'cors',
          },
        })
        const werV = werWies(v)
        pruefe(
          `│ Vorabfrage OPTIONS ${w.weg}`,
          werV === '' && v.status < 400,
          werV ? `${v.status}, abgewiesen von ${werV}` : `${v.status}`,
        )
      }
    }
    console.log('  └')
  }
}

/* ══ RING 5: DIE GEGENPROBE ═══════════════════════════════════════════════ */

/**
 * Ohne diesen Ring sagt „alles gruen" nur, dass der Riegel nichts tut. Eine
 * FREMDE Herkunft muss haengenbleiben — sonst misst Ring 1 die Abwesenheit
 * eines Riegels und nennt sie Erfolg.
 */
async function ring5() {
  ueberschrift('RING 5 — die Gegenprobe: fremde Herkunft MUSS haengenbleiben')
  const faelle = [
    { name: 'fremde Seite liest', origin: 'https://boese.example', weg: '/api/konfiguration', methode: 'GET' },
    {
      name: 'fremde Seite schreibt (Formular-POST)',
      origin: 'https://boese.example',
      weg: '/api/konfiguration',
      methode: 'POST',
      kopf: { 'Content-Type': 'application/x-www-form-urlencoded' },
      rumpf: 'aenderungen=x',
    },
    { name: 'Herkunft `null` (lokale Datei, Sandkasten-Rahmen)', origin: 'null', weg: '/api/konfiguration' },
    {
      name: 'gleiche Adresse, ANDERER Port (8201)',
      origin: 'http://192.168.178.169:8201',
      weg: '/api/konfiguration',
    },
    { name: 'anderer Name, gleicher Port', origin: 'http://nachbar.fritz.box:8200', weg: '/api/konfiguration' },
  ]
  for (const f of faelle) {
    const a = await roh({
      port: PORT,
      weg: f.weg,
      methode: f.methode ?? 'GET',
      kopf: { Host: '192.168.178.169:8200', Origin: f.origin, ...(f.kopf ?? {}) },
      rumpf: f.rumpf ?? null,
    })
    pruefe(`${f.name} → abgewiesen`, werWies(a) === 'riegel', `${a.status}${a.acao ? `, ACAO ${a.acao}` : ''}`)
  }
  // Und die Vorabfrage: sie muss VOR cors() sterben, sonst bekommt die fremde
  // Seite ein freundliches `Access-Control-Allow-Origin: *` und der Riegel
  // dahinter kommt zu spaet.
  const v = await roh({
    port: PORT,
    weg: '/api/konfiguration',
    methode: 'OPTIONS',
    kopf: {
      Host: '192.168.178.169:8200',
      Origin: 'https://boese.example',
      'Access-Control-Request-Method': 'POST',
    },
  })
  pruefe('Vorabfrage der fremden Seite → abgewiesen, kein ACAO', werWies(v) === 'riegel' && !v.acao, `${v.status}`)
}

/* ══ RING 6: DER WEG HINEIN — WIE EIN MENSCH AN DER BOX ANKOMMT ═══════════ */

/**
 * DIE HAELFTE, DIE MAN BEIM RIEGELBAUEN VERGISST.
 *
 * Ring 1 misst, was eine Seite tut, die schon OFFEN ist. Dieser Ring misst,
 * wie sie ueberhaupt aufgeht. Ein Mensch kommt auf drei Arten an diese Box:
 *
 *   1. ADRESSZEILE ODER LESEZEICHEN — der Browser schickt `Sec-Fetch-Site:
 *      none`, keinen `Origin`.
 *   2. EIN LINK VON WOANDERS — aus dem MuPiBox-Wiki, aus der Oberflaeche des
 *      Routers, aus einer Mail, von einem QR-Code-Blatt. Der Browser schickt
 *      `Sec-Fetch-Site: cross-site`, `Mode: navigate`, `Dest: document`, und
 *      KEINEN `Origin` (eine Navigation traegt ihn bei GET nicht).
 *   3. EINE WEITERLEITUNG VON EINEM DIENST — `accounts.spotify.com` schickt
 *      den Menschen nach `/spotify` zurueck. Kopfzeilen wie bei 2.
 *
 * Fall 2 und 3 sehen fuer einen Server EXAKT SO AUS WIE EIN ANGRIFF: fremde
 * Seite, keine Herkunft. Der Unterschied ist, dass das Ergebnis im FENSTER DES
 * MENSCHEN landet und nicht im Skript des Angreifers — deshalb hat herkunft.ts
 * dafuer die Ausnahme `istSeitenwechsel`. Ob der ZWEITE Riegel dieser Anwendung
 * (sicherung.ts) sie auch hat, misst dieser Ring, und zwar an jedem Weg, den
 * ein Mensch wirklich aufschlaegt.
 *
 * ES GEHT DABEI NICHT UM /api. Es geht um `/admin` — die Verwaltung. Wer die
 * nicht mehr aufbekommt, hat keinen Rueckweg mehr, und der Betreiber sitzt
 * nicht davor, um es zu melden.
 */
/**
 * `soll: 'durch'` — hier LIEGT eine Seite. Wer sie nicht mehr aufbekommt, hat
 *                   keinen Rueckweg; das ist die teuerste Art zu scheitern.
 * `soll: 'ab'`    — hier liegt KEINE Seite, sondern eine Schnittstelle. Ein
 *                   Link von aussen darauf ist kein Rueckweg, sondern der Fall
 *                   `<a href>`/`window.open` auf ein GET MIT WIRKUNG
 *                   (`/api/vorlesen/sprich` laesst die Box reden). Abweisen ist
 *                   hier richtig — aber NUR, wenn der Satz dem Menschen sagt,
 *                   wo er stattdessen hin soll. Genau das wird mitgeprueft.
 */
const EINGAENGE = [
  { name: '/            die Box-Oberflaeche', weg: '/', soll: 'durch' },
  { name: '/admin/      DIE VERWALTUNG', weg: '/admin/', soll: 'durch' },
  { name: '/admin/sicherung  ein Lesezeichen mitten hinein', weg: '/admin/sicherung', soll: 'durch' },
  { name: '/neu/        der Kiosk', weg: '/neu/', soll: 'durch' },
  { name: '/spotify     der Rueckweg von accounts.spotify.com', weg: '/spotify', soll: 'durch' },
  { name: '/player/     eine Seite des Abspielers', weg: '/player/', soll: 'durch' },
  { name: '/api/konfiguration  ein Link aus dem Wiki (keine Seite)', weg: '/api/konfiguration', soll: 'kommtDrauf' },
]

/** Die drei Ankunftsarten, so wie ein Browser sie wirklich schickt. */
const ANKUENFTE = [
  {
    name: 'Adresszeile / Lesezeichen',
    // Hier gibt es keine fremde Seite — auch `/api` darf durch.
    apiSoll: 'durch',
    kopf: { 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' },
  },
  {
    name: 'Link von einer anderen Webseite (Wiki, Router, QR-Blatt)',
    apiSoll: 'ab',
    kopf: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' },
  },
  {
    name: 'Weiterleitung eines Dienstes (Spotify schickt zurueck)',
    apiSoll: 'ab',
    kopf: {
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-User': '?1',
    },
  },
]

async function ring6(platz) {
  ueberschrift('RING 6 — der Weg HINEIN: kommt ein Mensch ueberhaupt noch an')
  console.log(
    '  Eine Navigation der obersten Ebene. Wo eine SEITE liegt, muss sie\n' +
      '  ankommen — die Antwort landet im Fenster des Menschen, nicht im Skript\n' +
      '  einer fremden Seite. Wo KEINE Seite liegt (/api), ist Abweisen richtig,\n' +
      '  aber nur mit einem Satz, der sagt, wo es stattdessen langgeht.\n',
  )
  if (!platz.wwwDa) merke('die Box-Oberflaeche ist nicht gebaut — `/` und `/spotify` sagen 404 statt Seite')
  for (const ank of ANKUENFTE) {
    console.log(`  ┌ ${ank.name}`)
    for (const e of EINGAENGE) {
      const a = await roh({
        port: PORT,
        weg: e.weg,
        kopf: {
          Host: '192.168.178.169:8200',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...ank.kopf,
        },
      })
      const wer = werWies(a)
      const soll = e.soll === 'kommtDrauf' ? ank.apiSoll : e.soll
      if (soll === 'durch') {
        // NICHT NUR „kein 403". Eine 404 waere auch kein Riegel — und trotzdem
        // stuende der Mensch vor nichts. Wo eine Seite liegen soll, muss auch
        // eine kommen.
        pruefe(`│ ${e.name}`, wer === '' && a.status < 400, wer ? `${a.status}, abgewiesen von ${wer}` : `${a.status}`)
      } else {
        // Abgewiesen — und der Satz muss dem Menschen einen WEG nennen, nicht
        // nur ein Nein. Ohne das ist es eine Sackgasse mit besserer Grammatik.
        let satz = ''
        try {
          const k = JSON.parse(a.text)
          satz = String(k?.fehler ?? k?.error ?? '')
        } catch {
          /* kein JSON */
        }
        const nenntWeg = /\/admin|adresse .*(selbst|eingibt|eingeben)|selbst ein/i.test(satz)
        pruefe(`│ ${e.name} → abgewiesen`, wer !== '', `${a.status}${wer ? ` von ${wer}` : ''}`)
        pruefe(`│    … und der Satz nennt einen Weg`, nenntWeg, satz.slice(0, 150) || '(kein Satz)')
      }
    }
    console.log('  └')
  }
}

/* ══ RING 4: DIE WERKZEUGE AUS tools/ ═════════════════════════════════════ */

/**
 * Gemessen wird mit dem ECHTEN Client, nicht mit einem nachgebauten: node
 * `fetch` (undici), `curl`, python `urllib`. Der Unterschied ist nicht
 * theoretisch — undici schickt von sich aus `Sec-Fetch-Mode: cors`, und haette
 * der Riegel darauf gehoert statt auf `Sec-Fetch-Site`, waere JEDES Werkzeug
 * in tools/ ab heute ausgesperrt.
 */
async function ring4() {
  ueberschrift('RING 4 — die Werkzeuge aus tools/, mit ihrem echten Client')
  const ziel = `http://127.0.0.1:${PORT}`

  // a) node `fetch` — der Client der .mjs- und .ts-Werkzeuge.
  const nodeAus = spawnSync(
    process.execPath,
    [
      '-e',
      `const z=${JSON.stringify(ziel)};
       (async()=>{
         const g=await fetch(z+'/api/konfiguration');
         const p=await fetch(z+'/api/konfiguration',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({aenderungen:{startLautstaerke:40}})});
         console.log(JSON.stringify({g:g.status,p:p.status}));
       })()`,
    ],
    { encoding: 'utf8' },
  )
  let n = {}
  try {
    n = JSON.parse(nodeAus.stdout.trim().split('\n').pop() ?? '{}')
  } catch {
    /* unten faellt es auf */
  }
  pruefe('node fetch — lesen kommt durch', n.g === 200, `Status ${n.g ?? nodeAus.stderr.slice(0, 120)}`)
  pruefe('node fetch — schreiben kommt durch', n.p === 200, `Status ${n.p}`)

  // b) curl — der Client der .sh-Werkzeuge.
  const c = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `${ziel}/api/konfiguration`], {
    encoding: 'utf8',
  })
  pruefe('curl — lesen kommt durch', c.stdout.trim() === '200', `Status ${c.stdout.trim()}`)

  // c) python urllib — der Client der .py-Werkzeuge.
  const py = spawnSync(
    'python3',
    [
      '-c',
      `import urllib.request as u
print(u.urlopen(${JSON.stringify(`${ziel}/api/konfiguration`)}, timeout=10).status)`,
    ],
    { encoding: 'utf8' },
  )
  pruefe(
    'python urllib — lesen kommt durch',
    py.stdout.trim() === '200',
    `Status ${py.stdout.trim() || py.stderr.slice(0, 120)}`,
  )

  /* ── d) IST DAMIT ALLES ABGEDECKT? ──────────────────────────────────────
   *
   * Drei Clients zu messen ist nur dann eine Aussage ueber tools/, wenn tools/
   * auch nur diese drei benutzt. Also wird nicht behauptet, sondern GEZAEHLT:
   * jede Datei in tools/ wird darauf angesehen, womit sie spricht. Taucht eine
   * VIERTE Art auf (`requests`, `axios`, `http.client`, `wget`), sagt diese
   * Zeile es — statt dass die Deckung still schrumpft, waehrend die Tafel
   * gruen bleibt.
   */
  /**
   * DIE MUSTER VERLANGEN EINEN AUFRUF, KEINE ERWAEHNUNG.
   *
   * Der erste Entwurf suchte `\bwget\b` und `\baxios\b` und meldete zwei
   * ungedeckte Arten. Beide waren Gespenster: „holt librespot NUR ueber wget"
   * steht in librespot-ausrollweg-abgleich.py in einem f-String, und `axios`
   * stand in der Mustertabelle DIESER Datei. Ein Werkzeug, das sich selbst
   * findet und daraufhin rot wird, erzieht nur dazu, sein Rot zu uebergehen.
   * Verlangt wird deshalb die Form eines Aufrufs — `wget -`, `curl -`,
   * `axios.get(`, `import axios`.
   */
  const arten = {
    'node fetch': [/\bfetch\s*\(/, ['.mjs', '.ts', '.js']],
    curl: [/\bcurl\s+[-'"$]|\bcurl\s+http/, ['.sh', '.py', '.mjs', '.ts']],
    'python urllib': [/urllib\.request|\burlopen\s*\(/, ['.py']],
    // Die drei oben sind gemessen. Was hier daruntersteht, ist es NICHT:
    'python requests': [/^\s*(import requests|from requests import)/m, ['.py']],
    'python http.client': [/http\.client\.\w/, ['.py']],
    axios: [/\baxios\s*\.\s*\w|require\(['"]axios['"]\)|from ['"]axios['"]/, ['.mjs', '.ts', '.js']],
    ky: [/from ['"]ky['"]|\bky\s*\.\s*(get|post)\b/, ['.mjs', '.ts', '.js']],
    wget: [/\bwget\s+[-'"$]|\bwget\s+http/, ['.sh', '.py']],
  }
  const GEMESSEN = new Set(['node fetch', 'curl', 'python urllib'])
  const SELBST = 'riegel-sperrt-betreiber-aus.mjs'
  const zahl = {}
  for (const datei of readdirSync(join(WURZEL, 'tools'))) {
    // Sich selbst nicht mitzaehlen: hier steht die Tabelle, nach der gesucht wird.
    if (datei === SELBST) continue
    let inhalt = ''
    try {
      inhalt = readFileSync(join(WURZEL, 'tools', datei), 'utf8')
    } catch {
      continue // Verzeichnis oder nicht lesbar
    }
    for (const [art, [muster, endungen]] of Object.entries(arten)) {
      if (!endungen.some((e) => datei.endsWith(e))) continue
      if (muster.test(inhalt)) zahl[art] = (zahl[art] ?? 0) + 1
    }
  }
  const benutzt = Object.entries(zahl).filter(([, n]) => n > 0)
  console.log(`  In tools/ benutzt: ${benutzt.map(([a, n]) => `${a} (${n})`).join(' · ')}`)
  const ungedeckt = benutzt.filter(([a]) => !GEMESSEN.has(a)).map(([a, n]) => `${a} (${n} Werkzeuge)`)
  pruefe(
    'jede Art, mit der tools/ spricht, ist oben auch gemessen',
    ungedeckt.length === 0,
    ungedeckt.length ? `nicht gemessen: ${ungedeckt.join(', ')}` : '',
  )
}

/* ══ DER BROWSER ══════════════════════════════════════════════════════════ */

/**
 * Ein Chromium, das man fragen kann (CDP ueber WebSocket).
 *
 * `--host-resolver-rules` ist der Kern: damit ist `mupibox.local` und
 * `192.168.178.169` fuer DIESEN Browser die Rueckschleife. Die Herkunft in der
 * Adresszeile ist damit eine echte fremde Zeichenkette — und diese Probe
 * beruehrt trotzdem weder das Netz noch die Box.
 *
 * Suche, freier Debug-Port, Wegwerf-Profil und Aufraeumen kommen aus
 * tools/leihgabe.mjs; `null` heisst: kein Browser auf diesem Rechner.
 */
async function browserOeffnen() {
  const brw = await eigenerBrowser({
    fenster: '1280,900',
    zusatz: [
      '--ignore-certificate-errors',
      '--host-resolver-rules=MAP mupibox.local 127.0.0.1, MAP 192.168.178.169 127.0.0.1, MAP nachbar.fritz.box 127.0.0.1',
    ],
  })
  if (!brw) return null
  // Gebraucht wird die Fernsteuerung des BROWSERS (Target.createTarget in
  // `fensterOeffnen`), nicht die einer Seite — also /json/version auf dem
  // Port des eigenen.
  const ziel = (await (await fetch(`http://127.0.0.1:${brw.port}/json/version`)).json()).webSocketDebuggerUrl
  const { WebSocket } = await import('ws')
  const ws = new WebSocket(ziel)
  await new Promise((r, x) => {
    ws.on('open', r)
    ws.on('error', x)
  })
  let id = 0
  const wartend = new Map()
  const horcher = []
  ws.on('message', (d) => {
    const n = JSON.parse(d)
    if (n.id && wartend.has(n.id)) {
      wartend.get(n.id)(n)
      wartend.delete(n.id)
    } else if (n.method) for (const h of horcher) h(n)
  })
  /**
   * EIN CDP-AUFRUF — MIT FRIST.
   *
   * VIERTE NARBE DESSELBEN TAGES. Ohne die Frist wartet dieses Versprechen
   * EWIG, wenn das Chromium dazwischen stirbt (abgeschossen, abgestuerzt, oder
   * weil sein Profilverzeichnis unter ihm weggeraeumt wurde). Genau das ist
   * passiert: die Probe stand 18 Minuten in Ring 2, ohne eine Zeile zu
   * schreiben und ohne einen Fehler. Ein Werkzeug, das haengt statt zu melden,
   * ist so schlimm wie eins, das das Falsche misst — man merkt beides erst,
   * wenn man selbst nachsieht, und dann ist die Sitzung vorbei.
   */
  const ruf = (method, params = {}, sessionId) =>
    new Promise((r) => {
      const i = ++id
      const uhr = setTimeout(() => {
        if (wartend.delete(i)) r({ fehler: `CDP ${method} kam nicht zurueck (30 s)` })
      }, 30000)
      wartend.set(i, (n) => {
        clearTimeout(uhr)
        r(n)
      })
      ws.send(JSON.stringify({ id: i, method, params, sessionId }))
    })
  return {
    ruf,
    horchen: (h) => horcher.push(h),
    zu: async () => {
      ws.close()
      await brw.schliessen()
    },
  }
}

/**
 * EIN FENSTER, DAS ALLES MITSCHREIBT, WAS ES UEBER DAS NETZ TUT.
 *
 * `Network.responseReceived` ist der Punkt, an dem der Status feststeht;
 * `Network.loadingFailed` faengt die Anfragen, die der Browser wegen CORS gar
 * nicht erst ausliefert — und genau die waeren die stumme Art zu scheitern.
 */
async function fensterOeffnen(b) {
  const { result: t } = await b.ruf('Target.createTarget', { url: 'about:blank' })
  const antwort = await b.ruf('Target.attachToTarget', { targetId: t.targetId, flatten: true })
  const sid = antwort?.result?.sessionId
  // OHNE SITZUNG KEIN FENSTER — und dann wird das gesagt, statt still ein
  // leeres Fenster zu messen. Ein Ring, der null Anfragen sieht und „keine
  // abgewiesen" meldet, waere die freundlichste Art zu luegen.
  if (!sid) throw new Error(`der Browser gab kein Fenster her (${antwort?.fehler ?? 'keine Sitzung'})`)
  const anfragen = []
  const meldungen = []
  b.horchen((n) => {
    if (n.sessionId !== sid) return
    if (n.method === 'Network.responseReceived') {
      anfragen.push({ url: n.params.response.url, status: n.params.response.status, art: n.params.type })
    }
    if (n.method === 'Network.loadingFailed') {
      anfragen.push({ url: '(abgebrochen)', status: 0, grund: n.params.errorText })
    }
    if (n.method === 'Runtime.consoleAPICalled' && n.params.type === 'error') {
      meldungen.push(String(n.params.args?.[0]?.value ?? '').slice(0, 200))
    }
  })
  await b.ruf('Network.enable', {}, sid)
  await b.ruf('Page.enable', {}, sid)
  await b.ruf('Runtime.enable', {}, sid)
  const gehe = async (url, wartenMs = 2500) => {
    await b.ruf('Page.navigate', { url }, sid)
    await new Promise((r) => setTimeout(r, wartenMs))
  }
  const werte = async (ausdruck) => {
    const a = await b.ruf('Runtime.evaluate', { expression: ausdruck, returnByValue: true, awaitPromise: true }, sid)
    return a.result?.result?.value ?? a.result?.exceptionDetails?.text ?? null
  }
  return {
    anfragen,
    meldungen,
    gehe,
    werte,
    zu: () => b.ruf('Target.closeTarget', { targetId: t.targetId }),
  }
}

/** Nur die Anfragen, die auf einen Weg mit Wirkung gingen. */
const anWege = (liste) => liste.filter((a) => /\/(api|player)\//.test(a.url) || /\/(api|player)$/.test(a.url))

/* ══ RING 2: DIE VERWALTUNG IM ECHTEN BROWSER ═════════════════════════════ */

/** Die 16 Wege aus src/frontend-admin/src/app/app.routes.ts. */
const ADMIN_WEGE = [
  '',
  'darstellung',
  'dienste',
  'streaming',
  'system',
  'protokolle',
  'aktualisierung',
  'konfiguration',
  'medien',
  'verschmelzung',
  'interpreten',
  'kinderzeit',
  'vorlesen',
  'bluetooth',
  'netzwerk',
  'mupihat',
  'sicherung',
]

async function ring2(b, platz, basis) {
  ueberschrift(`RING 2 — die Verwaltung im echten Browser (${basis})`)
  if (!platz.adminDa) {
    merke('www-admin nicht gebaut — die Verwaltung wurde NICHT gemessen')
    return
  }
  const f = await fensterOeffnen(b)
  const proSeite = []
  for (const weg of ADMIN_WEGE) {
    const vorher = f.anfragen.length
    await f.gehe(`${basis}/admin/${weg}`, 2600)
    const neu = anWege(f.anfragen.slice(vorher))
    const schlecht = neu.filter((a) => a.status === 403 || a.status === 0)
    proSeite.push({ weg: weg || '(Uebersicht)', zahl: neu.length, schlecht })
  }
  const gesamt = proSeite.reduce((s, p) => s + p.zahl, 0)
  console.log(`  ${gesamt} Anfragen an /api und /player ueber ${ADMIN_WEGE.length} Seiten.`)
  for (const p of proSeite) {
    pruefe(
      `/admin/${p.weg} — ${p.zahl} Anfragen, keine abgewiesen`,
      p.schlecht.length === 0,
      p.schlecht.length
        ? p.schlecht.map((s) => `${s.status} ${s.url.slice(-48)}${s.grund ? ` (${s.grund})` : ''}`).join(' · ')
        : '',
    )
  }
  // EINE SEITE, DIE GAR NICHTS RUFT, waere kein Beweis. Wenn ueber 17 Seiten
  // keine einzige Anfrage lief, hat die Verwaltung nicht geladen — und „keine
  // abgewiesen" ist dann eine leere Aussage.
  pruefe('die Verwaltung hat wirklich gerufen (nicht leer gemessen)', gesamt >= 10, `${gesamt} Anfragen`)

  /* ── Ein echter Klick auf „Speichern" ─────────────────────────────────── */
  //
  // NACHGESEHEN WIRD IN DER DATEI, nicht in der Antwort. Eine Oberflaeche, die
  // „gespeichert" sagt und nichts geschrieben hat, ist genau die Art, wie ein
  // zu scharfer Riegel unbemerkt bleibt.
  await f.gehe(`${basis}/admin/konfiguration`, 3000)
  const vorWert = JSON.parse(readFileSync(platz.konfigDatei, 'utf8'))?.mupibox?.startVolume
  const knoepfe = await f.werte(
    `JSON.stringify([...document.querySelectorAll('button')].map(b => (b.textContent||'').trim()).filter(Boolean).slice(0,40))`,
  )
  console.log(`  Knoepfe auf /admin/konfiguration: ${String(knoepfe).slice(0, 300)}`)
  /**
   * DER ECHTE KLICK — kein `fetch` aus der Konsole.
   *
   * GEWARTET WIRD AUF ZUSTAENDE, NICHT AUF SEKUNDEN. Der erste Entwurf setzte
   * den Wert und klickte 400 ms spaeter; an `localhost` ging das, an
   * `mupibox.local` fand er den Knopf gesperrt und wich auf `fetch` aus. Ein
   * Werkzeug, das je nach Adresse etwas anderes misst und beides „gruen"
   * nennt, ist die Art von Messung, die man besser nicht hat.
   *
   * Das Feld haengt an `(change)`, nicht an `(input)` (konfiguration.ts,
   * Zweig `zahl`) — beides wird geschickt, weil der Zweig sich aendern kann.
   * Gesucht wird ueber die BESCHRIFTUNG, nicht ueber „das erste Zahlenfeld":
   * eine neue Zahl weiter oben haette sonst still das falsche Feld gemessen.
   */
  const geklickt = await f.werte(`(async () => {
    const warte = async (was, ms = 8000) => {
      const bis = Date.now() + ms
      while (Date.now() < bis) { const r = was(); if (r) return r; await new Promise(r => setTimeout(r, 100)) }
      return null
    }
    const zahlenfeld = () => {
      for (const li of document.querySelectorAll('li')) {
        if (!/Lautst.rke beim Einschalten/i.test(li.textContent || '')) continue
        const i = li.querySelector('input[type=number]')
        if (i && !i.disabled) return i
      }
      return null
    }
    const z = await warte(zahlenfeld)
    if (!z) return 'kein Feld „Lautstaerke beim Einschalten" gefunden'
    const setzer = Object.getOwnPropertyDescriptor(z.constructor.prototype, 'value').set
    setzer.call(z, '41')
    z.dispatchEvent(new Event('input', { bubbles: true }))
    z.dispatchEvent(new Event('change', { bubbles: true }))
    const knopf = () => [...document.querySelectorAll('button')]
      .find(b => /speichern/i.test(b.textContent || '') && !b.disabled)
    const k = await warte(knopf)
    if (!k) return 'Speichern-Knopf wurde nicht frei'
    k.click()
    return 'geklickt'
  })()`)
  // Auf die DATEI warten, nicht auf eine Zusage der Oberflaeche. Sie ist die
  // einzige Stelle, an der „gespeichert" nachpruefbar ist.
  let nachWert = vorWert
  for (let i = 0; i < 60 && String(nachWert) !== '41'; i++) {
    await new Promise((r) => setTimeout(r, 150))
    nachWert = JSON.parse(readFileSync(platz.konfigDatei, 'utf8'))?.mupibox?.startVolume
  }
  pruefe(
    `Speichern am echten Knopf schreibt in die Datei (${vorWert} → ${nachWert})`,
    geklickt === 'geklickt' && String(nachWert) === '41',
    geklickt === 'geklickt' ? `Datei sagt ${nachWert}` : String(geklickt),
  )

  /* ── Ein echter Klick auf „Sicherung anlegen" ──────────────────────────── */
  await f.gehe(`${basis}/admin/sicherung`, 3200)
  const staendeVor = readdirSync(platz.staende).length
  const sKnoepfe = await f.werte(
    `JSON.stringify([...document.querySelectorAll('button')].map(b => (b.textContent||'').trim()).filter(Boolean).slice(0,40))`,
  )
  console.log(`  Knoepfe auf /admin/sicherung: ${String(sKnoepfe).slice(0, 300)}`)
  // „Sichern und herunterladen" ist der einzige Knopf, der wirklich etwas
  // anlegt — der zweite („Herunterladen") holt einen VORHANDENEN Stand.
  const sGeklickt = await f.werte(`(async () => {
    const bis = Date.now() + 8000
    while (Date.now() < bis) {
      const k = [...document.querySelectorAll('button')]
        .find(b => /sichern und herunterladen|sicherung anlegen|jetzt sichern/i.test(b.textContent || '') && !b.disabled)
      if (k) { k.click(); return 'geklickt' }
      await new Promise(r => setTimeout(r, 100))
    }
    return 'Knopf wurde nicht frei'
  })()`)
  let staendeNach = staendeVor
  for (let i = 0; i < 80 && staendeNach <= staendeVor; i++) {
    await new Promise((r) => setTimeout(r, 150))
    staendeNach = readdirSync(platz.staende).length
  }
  pruefe(
    `„Sichern und herunterladen" am echten Knopf legt einen Stand an (${staendeVor} → ${staendeNach})`,
    sGeklickt === 'geklickt' && staendeNach > staendeVor,
    sGeklickt === 'geklickt' ? '' : String(sGeklickt),
  )

  // Konfiguration zuruecksetzen, damit ein zweiter Lauf von derselben Lage ausgeht.
  await f.werte(`fetch('/api/konfiguration', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aenderungen: { startLautstaerke: 40 } }) }).then(a => a.status)`)

  const rot = f.meldungen.filter((m) => /CORS|Access-Control|403/i.test(m))
  pruefe('keine CORS-Meldung in der Konsole der Verwaltung', rot.length === 0, rot.slice(0, 3).join(' · '))
  await f.zu()
}

/* ══ RING 3: DER KIOSK ════════════════════════════════════════════════════ */

async function ring3(b, platz, basis) {
  ueberschrift(`RING 3 — der Kiosk unter /neu/ (${basis})`)
  if (!platz.kioskDa) {
    merke('NewDesign/index.html nicht gefunden — der Kiosk wurde NICHT gemessen')
    return
  }
  const f = await fensterOeffnen(b)
  // Der Kiosk laedt lange und fragt im Takt nach; 9 s sind mehr als eine
  // Runde seiner Nachfragen (TAKT_HAT in NewDesign/app.js sind 30 s, die
  // erste Runde laeuft aber sofort).
  await f.gehe(`${basis}/neu/`, 9000)
  const wege = anWege(f.anfragen)
  const schlecht = wege.filter((a) => a.status === 403 || a.status === 0)
  console.log(`  ${wege.length} Anfragen an /api und /player beim Hochfahren des Kiosks.`)
  const liste = [...new Set(wege.map((a) => a.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]))].sort()
  console.log(`  ${liste.length} verschiedene Wege: ${liste.slice(0, 24).join(' ')}${liste.length > 24 ? ' …' : ''}`)
  pruefe('der Kiosk hat wirklich gerufen (nicht leer gemessen)', wege.length >= 5, `${wege.length} Anfragen`)
  pruefe(
    'keine einzige Anfrage des Kiosks wurde abgewiesen',
    schlecht.length === 0,
    schlecht.map((s) => `${s.status} ${s.url.slice(-56)}${s.grund ? ` (${s.grund})` : ''}`).join(' · '),
  )
  // EIN WEG MIT WIRKUNG, den der Kiosk wirklich geht (NewDesign/app.js,
  // `fetch(API + '/gespielt')`). Der Rumpf traegt `key` — das ist die Form,
  // die `istMeldung` (gespielt.ts) verlangt; mit einem erfundenen Rumpf haette
  // diese Zeile ein 400 gemessen und es dem Riegel angelastet.
  const gespielt = await f.werte(`(async () => {
    const a = await fetch('/api/gespielt', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'probe:riegel-sperrt-betreiber-aus' }) })
    return a.status
  })()`)
  pruefe(
    'der Kiosk darf melden, was gespielt wurde (POST /api/gespielt)',
    Number(gespielt) === 200,
    `Status ${gespielt}`,
  )
  await f.zu()
}

/* ══ RING 7: MIT EINGESCHALTETER ANMELDUNG ════════════════════════════════ */

/**
 * DER FALL, DEN DIE VORLAGE NICHT HAT — UND DEN NIEMAND SIEHT.
 *
 * Alle Ringe darueber laufen mit `interfacelogin.state = false`, so wie die
 * Box ausgeliefert wird. Wer den Schalter aber UMLEGT — und das ist der einzige
 * Rat, den herkunft.ts jemandem gibt, der mehr Schutz will —, geht danach durch
 * eine Tuer, die vorher keine war: anmelden, ein Sitzungskeks, und JEDE weitere
 * Anfrage traegt ihn.
 *
 * Das ist eine eigene Gelegenheit, sich auszusperren, denn die Anmeldung ist
 * ein POST — und ein POST traegt IMMER einen `Origin`, auch same-origin. Ginge
 * hier etwas schief, waere die Box zu, und zwar so richtig: kein Passwort
 * hilft, wenn der Weg zum Passwortfeld schon 403 sagt.
 *
 * Gemessen wird an einem ZWEITEN Serverprozess mit eigener Konfiguration —
 * der erste laeuft weiter wie ausgeliefert, damit die Ringe darueber nicht
 * nachtraeglich eine andere Lage beschreiben, als sie gemessen haben.
 */
async function ring7(gebaut) {
  ueberschrift('RING 7 — mit EINGESCHALTETER Anmeldung')
  // DASSELBE bcryptjs, das auch der Server benutzt — ueber `createRequire`,
  // weil das Paket kein ES-Modul ist und ein Verzeichnis-Import daran
  // scheitert. Der Hash MUSS von dieser Bibliothek kommen: einer aus einer
  // anderen wuerde von `passwortStimmt` abgelehnt, und der Ring meldete dann
  // eine Aussperrung, die es gar nicht gibt.
  let bcrypt
  try {
    bcrypt = createRequire(import.meta.url)('bcryptjs')
  } catch {
    merke('bcryptjs nicht gefunden — die Anmeldung wurde NICHT gemessen')
    return
  }
  const PASSWORT = 'riegel-probe-2026'

  // EIGENER ARBEITSPLATZ, EIGENE PORTS. Der Server der Ringe 1–6 bleibt
  // unberuehrt — sonst beschriebe er hinterher eine andere Lage, als er
  // gemessen hat.
  const p2 = arbeitsplatz()
  const konf = JSON.parse(readFileSync(p2.konfigDatei, 'utf8'))
  konf.interfacelogin = { state: true, password: bcrypt.hashSync(PASSWORT, 8) }
  writeFileSync(p2.konfigDatei, JSON.stringify(konf, null, 2))

  const PORT2 = await blockSuchen(PORT + 20, PORT + 140)
  const umgebung = { ...process.env }
  delete umgebung.NODE_ENV
  delete umgebung.MUPIBOX_HERKUNFT_AUS
  Object.assign(umgebung, {
    MUPIBOX_HTTP_PORT: String(PORT2),
    MUPIBOX_HTTPS_PORT: String(PORT2 + 1),
    MUPIBOX_TLS_DIR: join(p2.ordner, 'tls'),
    MUPIBOX_CONFIG: p2.konfigDatei,
    MUPIBOX_LOCK_DIR: p2.ordner,
    MUPIBOX_ADMIN_DIR: join(p2.ordner, 'www-admin'),
    MUPIBOX_SICHERUNG_SKRIPT: p2.skript,
    MUPIBOX_SICHERUNG_STAENDE: p2.staende,
    PLAYER_PROXY_HOST: '127.0.0.1',
    PLAYER_PROXY_PORT: String(PORT_SPIELER),
  })
  const kind = spawn(process.execPath, [gebaut], { cwd: p2.ordner, env: umgebung, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  kind.stdout.on('data', (d) => {
    log += d
  })
  kind.stderr.on('data', (d) => {
    log += d
  })
  const frage = (o) => roh({ port: PORT2, ...o })

  // OBEN heisst hier: er antwortet UND meldet, dass eine Anmeldung noetig ist.
  // Ein blosses 200 waere zu wenig — es koennte der Server ohne Schalter sein.
  let oben = false
  for (let i = 0; i < 250 && !oben; i++) {
    if (kind.exitCode !== null) break
    try {
      const a = await frage({ weg: '/api/auth/state' })
      oben = a.status === 200 && JSON.parse(a.text)?.anmeldungNoetig === true
    } catch {
      /* noch nicht oben */
    }
    if (!oben) await new Promise((r) => setTimeout(r, 150))
  }
  if (!oben) {
    kind.kill('SIGKILL')
    rmSync(p2.ordner, { recursive: true, force: true })
    merke(`der zweite Server kam nicht hoch — die Anmeldung wurde NICHT gemessen (${log.slice(-200)})`)
    return
  }
  console.log(`  Zweiter Server auf ${PORT2}, Anmeldung eingeschaltet.`)

  try {
    for (const lage of LAGEN) {
      // Der zweite Server bekommt keinen eigenen TLS-Ring; die TLS-Herkunft
      // ist in Ring 1 und Ring 2 schon dreifach gemessen.
      if (lage.tls) continue
      console.log(`  ┌ ${lage.name}`)
      const browser = lage.origin ? { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors' } : {}
      const kopf = {
        Host: lage.host,
        ...(lage.origin ? { Origin: lage.origin } : {}),
        ...browser,
        'Content-Type': 'application/json',
      }

      // 1. DIE ANMELDESEITE. Laege sie hinter dem Tor, koennte man sich nur
      //    anmelden, wenn man schon angemeldet ist. Das ist der Grund, warum
      //    /admin in server.ts VOR dem Tor steht — hier wird es nachgemessen.
      const seite = await frage({
        weg: '/admin/anmeldung',
        kopf: { Host: lage.host, 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' },
      })
      pruefe(`│ die Anmeldeseite ist erreichbar`, werWies(seite) === '' && seite.status < 400, `${seite.status}`)

      // 2. DIE ANMELDUNG. Ein POST — und ein POST traegt IMMER einen `Origin`,
      //    auch bei gleicher Herkunft. Genau hier koennte ein zu scharfer
      //    Riegel die Box endgueltig zumachen: kein Passwort hilft, wenn schon
      //    der Weg zum Passwortfeld 403 sagt.
      const an = await frage({
        weg: '/api/auth/login',
        methode: 'POST',
        kopf,
        rumpf: JSON.stringify({ password: PASSWORT }),
      })
      const werAn = werWies(an)
      const hatKeks = /mupibox|sitzung|=/.test(an.keks) && an.keks.length > 0
      pruefe(
        `│ anmelden kommt durch UND setzt einen Sitzungskeks`,
        werAn === '' && an.status === 200 && hatKeks,
        werAn ? `${an.status} von ${werAn}` : `${an.status}${hatKeks ? '' : ', aber ohne Keks'}`,
      )

      // 3. UND DANACH: kommt man mit dem Keks wirklich an die Daten? Ohne
      //    diese Zeile hiesse „angemeldet" nur, dass der Server „ok" gesagt hat.
      const keks = an.keks.split(';')[0]
      const daten = await frage({ weg: '/api/konfiguration', kopf: { ...kopf, Cookie: keks } })
      const werD = werWies(daten)
      pruefe(
        `│ mit dem Keks kommt man an die Konfiguration`,
        werD === '' && daten.status === 200,
        werD ? `${daten.status} von ${werD}` : `${daten.status}`,
      )

      // 4. OHNE KEKS — UND HIER STEHT NICHT DAS, WAS MAN ERWARTET.
      //
      //    Von der Rueckschleife aus laesst `torBauen` (auth.ts, Zeile 184)
      //    JEDE Anfrage durch, egal ob ein Keks dabei ist: `istRueckschleife`
      //    deckt ganz 127.0.0.0/8. Das ist kein Loch, sondern genau dieselbe
      //    Vorsicht, die dieses Werkzeug misst — der Kiosk laeuft AUF der Box,
      //    und ein Fehler in der Sitzungsverwaltung darf ihn nie aussperren
      //    (der Kommentar ueber `torBauen` sagt es wortwoertlich).
      //
      //    Der erste Entwurf dieser Zeile verlangte 401 und wurde dreimal rot.
      //    Rot war die Erwartung, nicht die Box. Gemessen wird deshalb, was
      //    wirklich die Regel ist — und was daran NICHT gemessen ist, steht
      //    eine Zeile weiter.
      const ohne = await frage({ weg: '/api/konfiguration', kopf })
      pruefe(
        `│ von der Box selbst kommt man auch ohne Keks durch (Kiosk-Vorsicht)`,
        werWies(ohne) === '' && ohne.status === 200,
        `${ohne.status}`,
      )

      // 5. Ein FALSCHES Passwort muss 401 sagen und nicht 403: der Unterschied
      //    ist fuer den, der davorsitzt, der zwischen „vertippt" und „die Box
      //    laesst mich grundsaetzlich nicht".
      const falsch = await frage({
        weg: '/api/auth/login',
        methode: 'POST',
        kopf,
        rumpf: JSON.stringify({ password: 'daneben' }),
      })
      pruefe(`│ falsches Passwort sagt 401 („vertippt"), nicht 403`, falsch.status === 401, `${falsch.status}`)
      console.log('  └')
    }
    // WAS DIESER RING NICHT KANN, und das gehoert dazu:
    // Ein Zugriff von einem ANDEREN Rechner mit eingeschalteter Anmeldung ist
    // hier nicht messbar. Die Probe verbindet sich ueber die Rueckschleife,
    // und `istRueckschleife` deckt ganz 127.0.0.0/8 — auch 127.0.0.2. Um an
    // den Sitzungszweig zu kommen, muesste der Sandkasten einen Port ins LAN
    // oeffnen; das ist eine Probe nicht wert.
    merke('mit Anmeldung von einem ANDEREN Rechner aus: nicht gemessen (die Probe sitzt auf der Rueckschleife)')
  } finally {
    kind.kill('SIGKILL')
    rmSync(p2.ordner, { recursive: true, force: true })
  }
}

/* ══ LAUF ═════════════════════════════════════════════════════════════════ */

/**
 * Der Platzhalter fuer den Abspieldienst. Er antwortet auf ALLES mit einem
 * Feld, das nur er setzt — daran erkennt die Probe, dass die Weiterreichung
 * wirklich bei IHM gelandet ist und nicht bei irgendetwas anderem auf 5005.
 */
const spieler = createServer((_a, b) => {
  b.writeHead(200, { 'Content-Type': 'application/json' })
  b.end(JSON.stringify({ platzhalter: 'riegel-sperrt-betreiber-aus', state: 'stopped' }))
})
await new Promise((f) => spieler.listen(PORT_SPIELER, '127.0.0.1', f))

const platz = arbeitsplatz()
console.log(`Arbeitsplatz: ${platz.ordner}`)
console.log(
  `Verwaltung gebaut: ${platz.adminDa ? 'ja' : 'NEIN'} · Box-Oberflaeche: ${platz.wwwDa ? 'ja' : 'NEIN'} · Kiosk: ${platz.kioskDa ? 'ja' : 'NEIN'}`,
)
const { ziel: gebaut, abdruck } = buendeln(platz.ordner)
// WELCHE FASSUNG WURDE GEMESSEN. Ohne diese Zeile ist „gruen" eine Aussage
// ohne Datum — und genau das ist an diesem Tag schon einmal schiefgegangen.
console.log(
  `Gemessene Fassung: ${Object.entries(abdruck)
    .map(([d, h]) => `${d} ${h}`)
    .join(' · ')}`,
)
const server = await serverStarten(platz, gebaut, false)
console.log(`Server laeuft: http ${PORT} · https ${PORT_TLS} ${server.tlsDa ? '' : '(TLS kam nicht hoch)'}`)

try {
  if (ringAn(1)) await ring1(server.tlsDa)
  if (ringAn(6)) await ring6(platz)
  if (ringAn(5)) await ring5()
  if (ringAn(4)) await ring4()
  if (ringAn(7)) await ring7(gebaut)

  if ((ringAn(2) || ringAn(3)) && !OHNE_BROWSER) {
    const b = await browserOeffnen()
    if (!b) {
      merke('kein Chromium gefunden — Ring 2 und 3 wurden NICHT gemessen')
    } else {
      try {
        // ZWEI ADRESSEN, weil sie zwei verschiedene Lagen sind: der Kiosk
        // steht auf `localhost`, der zweite Rechner tippt einen NAMEN. Wer nur
        // `localhost` misst, uebersieht jeden Fehler, der am Vergleich von
        // Rechnernamen haengt.
        for (const basis of [`http://localhost:${PORT}`, `http://mupibox.local:${PORT}`]) {
          if (ringAn(2)) await ring2(b, platz, basis)
          if (ringAn(3)) await ring3(b, platz, basis)
        }
        // Und ueber TLS — die dritte Herkunft der Verwaltung.
        if (server.tlsDa && ringAn(2)) await ring2(b, platz, `https://192.168.178.169:${PORT_TLS}`)
        else if (!server.tlsDa) merke('TLS kam nicht hoch — die Verwaltung ueber https wurde NICHT im Browser gemessen')
      } finally {
        await b.zu()
      }
    }
  } else if (OHNE_BROWSER) {
    merke('--ohne-browser: Ring 2 und 3 wurden NICHT gemessen')
  }
} finally {
  if (!STEHENLASSEN) {
    spieler.close()
    server.kind.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 300))
    server.kind.kill('SIGKILL')
    rmSync(platz.ordner, { recursive: true, force: true })
  } else {
    console.log(`\n(--stehenlassen: Server ${PORT} laeuft weiter, Arbeitsplatz ${platz.ordner} bleibt)`)
  }
}

/* ── HAT SICH DER GEGENSTAND WAEHRENDDESSEN BEWEGT? ─────────────────────── */
const danach = fingerabdruck()
const gewandert = TRAGENDE.filter((d) => danach[d] !== abdruck[d])
if (gewandert.length) {
  // KEIN `merke`, SONDERN ROT. „Nicht gemessen" waere zu milde: hier steht
  // eine vollstaendige Tafel, die einer Fassung zugeordnet ist, die es nicht
  // mehr gibt. Wer das uebersieht, liefert nach einer gruenen Messung aus.
  pruefe(
    `der Arbeitsbaum stand still, waehrend gemessen wurde`,
    false,
    `${gewandert.join(', ')} hat sich waehrend des Laufes geaendert — diese Tafel gilt fuer ${gewandert
      .map((d) => `${d} ${abdruck[d]}`)
      .join(', ')}, im Baum steht jetzt ${gewandert.map((d) => danach[d]).join(', ')}. NOCH EINMAL LAUFEN LASSEN.`,
  )
}

console.log(
  `\n${fehler === 0 ? 'ALLES DURCHGEKOMMEN' : `${fehler} ZEILE(N) ROT`}${offen ? ` · ${offen} nicht gemessen` : ''}`,
)
process.exit(fehler === 0 ? 0 : 1)
