#!/usr/bin/env node
/**
 * KOMMT EINE FREMDE WEBSEITE AN DIE API DIESER BOX?
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * In server.ts steht `app.use(cors())` vor allem anderen, und in der
 * ausgelieferten Vorlage ist `interfacelogin.state = false`. Zusammen heisst
 * das: die Box antwortet jeder Herkunft mit `Access-Control-Allow-Origin: *`
 * und ohne Anmeldung — jede Seite, die ein Elternteil im Heimnetz aufmacht,
 * kann die Konfiguration, die Kinderprofile und die Zugangsdaten LESEN.
 *
 * Seit dem 07.08.2026 steht davor der Herkunftsriegel (herkunft.ts). Diese
 * Probe misst, ob er haelt UND — wichtiger — ob er die eigene Verwaltung
 * nicht aussperrt. Der Betreiber sitzt nicht davor; ein Riegel, der zu scharf
 * greift, faellt sonst erst auf, wenn niemand mehr an die Box kommt.
 *
 * ══ WARUM AN EINEM ECHTEN SERVERPROZESS UND NICHT ALS SPEC ═════════════════
 * Drei Dinge sind im selben Prozess nicht messbar:
 *   1. die REIHENFOLGE der Zwischenschichten (steht der Riegel wirklich vor
 *      `cors()`, oder beantwortet `cors()` die Vorabfrage schon selbst?),
 *   2. was am Ende an KOPFZEILEN herausgeht (`Access-Control-Allow-Origin`),
 *   3. was ein ECHTER BROWSER daraus macht. Nur er entscheidet, ob eine
 *      fremde Seite die Antwort lesen darf — kein `assert` der Welt tut das.
 * Deshalb: gebuendelt wie auf der Box (esbuild, ohne NODE_ENV), gestartet auf
 * EIGENEN Ports, dazu ein echtes Chromium.
 *
 * ══ WAS GEMESSEN WIRD ══════════════════════════════════════════════════════
 *  A) DIE TAFEL: je Weg-Art (lesen · schreiben · Vorabfrage · Abspielen) und
 *     je Herkunft (keine · eigene http · eigene https · fremde · null ·
 *     gleiche Adresse anderer Port · anderer Name · Browserfaelle ohne
 *     Origin) — kommt es durch, und steht ein `Access-Control-Allow-Origin`
 *     in der Antwort?
 *  B) DAS SCHREIBEN: ein POST, der wirklich etwas aendert, mit und ohne
 *     Herkunft — nachgesehen wird in der DATEI, nicht in der Antwort.
 *  C) DER BROWSER: die Verwaltung unter /admin wird geladen und jede ihrer
 *     Anfragen mitgeschrieben; danach versucht eine SEITE AUF EINER FREMDEN
 *     HERKUNFT dasselbe.
 *  D) DIE GEGENPROBE: derselbe Durchgang mit `MUPIBOX_HERKUNFT_AUS=1`. Dort
 *     MUSS die fremde Seite durchkommen — sonst misst diese Probe nichts.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/herkunftsriegel-probe.mjs [--port 9601] [--ohne-browser]
 *                                          [--behalten]
 *
 * NUR AUF DIESEM RECHNER. Es wird nichts ausgeliefert, nichts an der Box
 * angefasst, kein Dienst geschaltet. Der Serverprozess laeuft ueber einem
 * Wegwerf-Verzeichnis und wird am Ende beendet.
 * Rueckgabewert: 0, wenn jede Zeile stimmt.
 */
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http, { createServer } from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { homedir, tmpdir } from 'node:os'
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
const BEHALTEN = argv.includes('--behalten')

/**
 * EIN FREIER PORTBLOCK — UND ZWAR NACHGEWIESEN FREI.
 *
 * DAS HIER IST KEINE VORSICHT, SONDERN EINE NARBE. Beim ersten Lauf lagen auf
 * 9601 und 9701 schon Server anderer Sitzungen. Der eigene Server starb mit
 * EADDRINUSE, die Probe fragte weiter — und MASS DEN FREMDEN SERVER. Sie
 * lieferte eine vollstaendige, schoen formatierte Tafel voller Aussagen ueber
 * eine Software, die hier gar nicht lief. Ein Werkzeug, das still das falsche
 * misst, ist schlimmer als keins.
 *
 * Deshalb wird jeder gebrauchte Port VORHER wirklich gebunden, und weiter
 * unten prueft `serverStarten` zusaetzlich, ob die Antwort ueberhaupt von
 * DIESEM Backend kommt.
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
    // Gebraucht werden p (http), p+1 (https), p+2 (die fremde Seite) und
    // p+10 (die Fernsteuerung des Browsers).
    const alle = await Promise.all([portFrei(p), portFrei(p + 1), portFrei(p + 2), portFrei(p + 10)])
    if (alle.every(Boolean)) return p
  }
  throw new Error(`kein freier Portblock zwischen ${von} und ${bis} — laeuft hier noch eine andere Sitzung?`)
}

const GEWUENSCHT = Number(opt('port', '9601'))
const PORT = await blockSuchen(GEWUENSCHT, GEWUENSCHT + 200)
if (PORT !== GEWUENSCHT) console.log(`(Port ${GEWUENSCHT} war belegt — diese Probe laeuft auf ${PORT})`)
const PORT_TLS = PORT + 1
const PORT_ANGREIFER = PORT + 2
/** Nur als ERFUNDENE Herkunft gebraucht, hier hoert nichts. */
const PORT_NEBENAN = PORT + 3

let fehler = 0
const pruefe = (satz, ok, dazu = '') => {
  console.log(`  ${ok ? 'ok  ' : 'NEIN'} ${satz}${dazu ? `  — ${dazu}` : ''}`)
  if (!ok) fehler++
}

/* ══ 1. EIN ARBEITSPLATZ, DER AUSSIEHT WIE DIE BOX ════════════════════════ */

/**
 * Ohne NODE_ENV laeuft der Server in seinem Produktivzweig; der liest seine
 * Konfiguration RELATIV zum Arbeitsverzeichnis und sucht `www`/`www-admin`
 * neben sich. Also wird das Verzeichnis gebaut und der Prozess hineingestellt
 * — genau wie tools/fehlerbehandler-probe.mjs es tut. Ein Verweis auf
 * src/deploy waere der echte Baum, und ein Fehlgriff schriebe hinein.
 */
function arbeitsplatz() {
  const ordner = mkdtempSync(join(tmpdir(), 'mupi-herkunft-'))
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
        // `audioDevice` steht hier, weil `pruefeKonfig` sonst JEDES Schreiben
        // ablehnt („die Box haette keinen Ton") — und dann misst die
        // Schreibprobe nicht den Riegel, sondern eine luecken­hafte Vorlage.
        mupibox: { host: 'MuPiBox', startVolume: '40', maxVolume: '100', audioDevice: 'default' },
        // WIE AUSGELIEFERT: keine Anmeldung. Genau deshalb ist die Herkunft
        // hier das Einzige, was zwischen einer fremden Seite und den Daten
        // dieser Box steht.
        interfacelogin: { state: false, password: '' },
        timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
      },
      null,
      2,
    ),
  )
  // Die gebaute Verwaltung — ohne sie laesst sich Teil C nicht messen.
  const adminQuelle = [join(WURZEL, 'src/deploy/www-admin'), join(WURZEL, 'src/frontend-admin/www-admin')].find(
    existsSync,
  )
  if (adminQuelle) cpSync(adminQuelle, join(ordner, 'www-admin'), { recursive: true })
  mkdirSync(join(ordner, 'tls'), { recursive: true })
  return { ordner, konfigDatei: join(konf, 'mupiboxconfig.json'), adminDa: Boolean(adminQuelle) }
}

function buendeln(ordner) {
  const esbuild = [
    join(BACKEND, 'node_modules', '.bin', 'esbuild'),
    join(WURZEL, 'node_modules', '.bin', 'esbuild'),
  ].find(existsSync)
  if (!esbuild) {
    console.error('esbuild nicht gefunden — npm install fehlt.')
    process.exit(2)
  }
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
  return ziel
}

async function serverStarten(platz, gebaut, riegelAus) {
  const umgebung = { ...process.env }
  // DER GANZE PUNKT: NODE_ENV ist auf der Box NICHT gesetzt.
  umgebung.NODE_ENV = undefined
  delete umgebung.NODE_ENV
  Object.assign(umgebung, {
    MUPIBOX_HTTP_PORT: String(PORT),
    MUPIBOX_HTTPS_PORT: String(PORT_TLS),
    MUPIBOX_TLS_DIR: join(platz.ordner, 'tls'),
    MUPIBOX_CONFIG: platz.konfigDatei,
    MUPIBOX_LOCK_DIR: platz.ordner,
    MUPIBOX_ADMIN_DIR: join(platz.ordner, 'www-admin'),
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
  /**
   * ANTWORTET DA WIRKLICH UNSER SERVER?
   *
   * Nicht „irgendetwas mit Status 200" — sondern eine Antwort, die nur DIESES
   * Backend gibt: `/api/auth/state` mit dem Feld `anmeldungNoetig`. Siehe die
   * Narbe bei `blockSuchen`: eine fremde Sitzung auf demselben Port hat diese
   * Probe schon einmal vollstaendig in die Irre gefuehrt.
   */
  let oben = false
  for (let i = 0; i < 200 && !oben; i++) {
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
  // Steht TLS? Ohne openssl faellt der Server auf reines HTTP zurueck — dann
  // ist der Fall „eigene https-Herkunft" nicht messbar und wird als solcher
  // gemeldet, statt still zu fehlen.
  let tlsDa = false
  for (let i = 0; i < 40 && !tlsDa; i++) {
    try {
      const a = await roh({ port: PORT_TLS, tls: true, weg: '/api/auth/state' })
      tlsDa = a.status === 200
    } catch {
      await new Promise((r) => setTimeout(r, 150))
    }
  }
  return { kind, tlsDa, log: () => log }
}

/* ══ 2. EINE ANFRAGE MIT VOLLER GEWALT UEBER DIE KOPFZEILEN ═══════════════ */

/**
 * NICHT `fetch`: der setzt `Host` selbst und laesst ihn nicht setzen. Fuer den
 * Fall „gleiche Adresse, anderer Port" und fuer „anderer Name, gleiche
 * Adresse" muss `Host` und `Origin` aber UNABHAENGIG voneinander stehen —
 * sonst misst man nur, was der eigene Client zufaellig tut.
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
        timeout: 8000,
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
 * WER HAT ABGEWIESEN?
 *
 * Es gibt auf diesem Server ZWEI Riegel, und sie zu verwechseln macht jede
 * Aussage wertlos:
 *   * 'riegel'     — herkunft.ts. Antwortet mit einem Feld `grund`.
 *   * 'sicherung'  — der Riegel aus sicherung.ts. Der Router wird in server.ts
 *                    OHNE Pfad eingehaengt (`app.use(sicherungWegeBauen(...))`),
 *                    sein `r.use(...)` gilt deshalb fuer JEDE Anfrage der
 *                    ganzen Anwendung — nicht nur fuer /api/sicherung. Er
 *                    weist alles mit `Sec-Fetch-Site: cross-site` ab und
 *                    antwortet mit `fehler`, aber ohne `grund`.
 *   * ''           — niemand, die Antwort kommt vom Weg dahinter.
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
const vomRiegel = (a) => werWies(a) === 'riegel'

/* ══ 3. DIE TAFEL ════════════════════════════════════════════════════════ */

const EIGEN_HTTP = `http://127.0.0.1:${PORT}`
const EIGEN_HTTPS = `https://127.0.0.1:${PORT_TLS}`

/**
 * Die Herkuenfte, die es wirklich gibt.
 *
 * `soll: 'durch'` heisst: DIESE Anfrage MUSS ankommen, sonst ist die
 * Verwaltung kaputt. `soll: 'ab'` heisst: sie MUSS am Riegel enden.
 */
const HERKUENFTE = (tlsDa) =>
  [
    {
      name: 'keine Herkunft (curl, tools/, ein Skript auf der Box)',
      kopf: {},
      soll: 'durch',
    },
    {
      name: 'eigene Oberflaeche ueber http (Kiosk, /admin vom zweiten Rechner)',
      kopf: { Origin: EIGEN_HTTP, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors' },
      soll: 'durch',
    },
    tlsDa
      ? {
          name: 'dieselbe Seite ueber https auf 8443 (andere Herkunft im Sinne des Browsers)',
          tls: true,
          port: PORT_TLS,
          kopf: { Origin: EIGEN_HTTPS, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors' },
          soll: 'durch',
        }
      : null,
    {
      name: 'Adresszeile / Lesezeichen (Sec-Fetch-Site: none, kein Origin)',
      kopf: { 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' },
      soll: 'durch',
    },
    {
      name: 'der alte PHP-Admin auf Port 80 zeigt die Oberflaeche im <embed>',
      kopf: { 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'embed' },
      soll: 'durch',
    },
    {
      name: 'FREMDE Webseite im Heimnetz',
      kopf: { Origin: 'https://boese.example', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' },
      soll: 'ab',
    },
    {
      // DER FALL, DER NUR AM HERKUNFTSRIEGEL HAENGT — und deshalb der einzige,
      // an dem sich die Gegenprobe ueberhaupt festmachen laesst: ohne
      // `Sec-Fetch-*` greift der Riegel aus sicherung.ts nicht.
      name: 'FREMDE Webseite, aelterer Browser (gar keine Sec-Fetch-Kopfzeilen)',
      kopf: { Origin: 'https://boese.example' },
      soll: 'ab',
      alleinDerRiegel: true,
    },
    {
      name: 'Origin: null (lokale Datei, abgeschotteter Rahmen)',
      kopf: { Origin: 'null', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' },
      soll: 'ab',
    },
    {
      name: `gleiche Adresse, ANDERER Port (http://127.0.0.1:${PORT_NEBENAN})`,
      kopf: { Origin: `http://127.0.0.1:${PORT_NEBENAN}`, 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'cors' },
      soll: 'ab',
    },
    {
      name: 'anderer Name, gleiche Maschine (localhost statt 127.0.0.1)',
      kopf: { Origin: `http://localhost:${PORT}`, 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' },
      soll: 'ab',
    },
    {
      name: '<img> einer fremden Seite (kein Origin, aber cross-site)',
      kopf: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Dest': 'image' },
      soll: 'ab',
    },
    {
      name: 'unsichtbarer Rahmen einer fremden Seite',
      kopf: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'iframe' },
      soll: 'ab',
    },
    {
      // DIESE ERWARTUNG HAENGT AM WEG, seit 89151181 — und genau daran war sie
      // drei Zeilen lang rot, ohne dass es an einem Fehler lag.
      //
      // Frueher galt „durch" ueberall: die Ausnahme fuer die Navigation der
      // obersten Ebene war fuer den Rueckweg von Spotify gedacht. Dann wurde
      // gemessen, dass sie unter `/api` ein Loch ist — ein Klick auf einen
      // Link einer FREMDEN Seite erreichte damit `/api/vorlesen/sprich?text=…`
      // (die Box redet), `/api/netzwerk/scan` und `/api/konfiguration`. Seither
      // steht dort `seitenwechselErlaubt: false`, und der Rueckweg von Spotify
      // liegt ohnehin auf `/spotify`, also gar nicht hinter diesem Riegel
      // (gemessen weiter unten in `abseits`).
      //
      // Unter `/player` liegen SEITEN, und wer von aussen auf eine Seite der
      // Box verlinkt, darf sie sehen — dort gilt weiterhin „durch".
      //
      // Eine Messung, die dauerhaft rot steht, wird nicht gelesen. Deshalb
      // bildet die Erwartung jetzt ab, was die Box ABSICHTLICH tut, statt was
      // sie einmal getan hat.
      name: 'Navigation der obersten Ebene von fremder Seite (Rueckweg von Spotify)',
      kopf: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' },
      soll: (weg) => (weg.startsWith('/api') ? 'ab' : 'durch'),
    },
  ].filter(Boolean)

/** Die Weg-Arten: lesen, schreiben, Vorabfrage, abspielen. */
const WEGE = [
  { name: 'lesen   GET  /api/konfiguration', weg: '/api/konfiguration', methode: 'GET' },
  {
    name: 'schreib POST /api/konfiguration',
    weg: '/api/konfiguration',
    methode: 'POST',
    kopf: { 'Content-Type': 'application/json' },
    rumpf: JSON.stringify({ aenderungen: {} }),
  },
  { name: 'vorab   OPTIONS /api/konfiguration', weg: '/api/konfiguration', methode: 'OPTIONS' },
  { name: 'spielen GET  /player/current/state', weg: '/player/current/state', methode: 'GET' },
]

async function tafel(tlsDa, riegelAus) {
  const herkuenfte = HERKUENFTE(tlsDa)
  for (const weg of WEGE) {
    console.log(`\n  ── ${weg.name} ──`)
    for (const h of herkuenfte) {
      const port = h.port ?? PORT
      const a = await roh({
        port,
        tls: Boolean(h.tls),
        weg: weg.weg,
        methode: weg.methode,
        kopf: { Host: `127.0.0.1:${port}`, ...(weg.kopf ?? {}), ...h.kopf },
        rumpf: weg.rumpf ?? null,
      })
      const wer = werWies(a)
      const zeile = `${String(a.status).padEnd(3)} ${(wer ? wer.toUpperCase() : '').padEnd(9)} ACAO=${a.acao ?? '—'}`
      if (riegelAus) {
        // In der GEGENPROBE wird nur EINE Zeile verlangt: die, die allein am
        // Herkunftsriegel haengt. Alles andere wird gezeigt, nicht gefordert —
        // der zweite Riegel aus sicherung.ts laeuft ja weiter.
        if (h.alleinDerRiegel) {
          pruefe(`GEGENPROBE  ${h.name.padEnd(60)} ${zeile}`, wer !== 'riegel' && a.status !== 403)
        } else {
          console.log(`  ····  ${h.name.padEnd(66)} ${zeile}`)
        }
        continue
      }
      // `soll` darf vom WEG abhaengen: unter `/api` liegt kein Seiteninhalt,
      // unter `/player` schon — und der Riegel behandelt beide deshalb nicht
      // gleich (`seitenwechselErlaubt`). Ein fester Wert waere hier eine
      // Erwartung, die einen der beiden Faelle zwangslaeufig falsch nennt.
      const soll = typeof h.soll === 'function' ? h.soll(weg.weg) : h.soll
      if (soll === 'durch') {
        pruefe(`${h.name.padEnd(66)} ${zeile}`, wer !== 'riegel')
      } else {
        pruefe(`${h.name.padEnd(66)} ${zeile}`, wer === 'riegel' && a.acao === null)
      }
    }
  }
}

/* ══ 3b. WAS AUSSERHALB VON /api PASSIERT ════════════════════════════════ */

/**
 * DER HERKUNFTSRIEGEL HAENGT NUR AN /api UND /player. Diese Wege liegen
 * ausserhalb — hier wird gemessen, WER dort antwortet und ob der Rueckweg von
 * Spotify noch offen ist. Er ist der empfindlichste: eine Weiterleitung von
 * `accounts.spotify.com` auf `/spotify` ist eine Navigation der obersten
 * Ebene und traegt `Sec-Fetch-Site: cross-site`.
 */
async function abseits(riegelAus) {
  const faelle = [
    { name: 'Rueckweg von Spotify  GET /spotify (Navigation, cross-site)', weg: '/spotify' },
    { name: 'die Verwaltung von einem Lesezeichen  GET /admin/', weg: '/admin/' },
  ]
  for (const f of faelle) {
    const a = await roh({
      port: PORT,
      weg: f.weg,
      kopf: {
        Host: `127.0.0.1:${PORT}`,
        Accept: 'text/html',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Dest': 'document',
      },
    })
    const wer = werWies(a)
    const zeile = `${String(a.status).padEnd(3)} ${(wer ? wer.toUpperCase() : '').padEnd(9)}`
    if (riegelAus) {
      console.log(`  ····  ${f.name.padEnd(66)} ${zeile}`)
      continue
    }
    // GEFORDERT WIRD NUR, DASS ES NICHT AM HERKUNFTSRIEGEL LIEGT. Was der
    // zweite Riegel dort tut, gehoert sicherung.ts und wird BERICHTET,
    // nicht hier stillschweigend fuer richtig erklaert.
    pruefe(`${f.name.padEnd(66)} ${zeile}`, wer !== 'riegel')
    if (wer === 'sicherung') {
      console.log('        ^ BEFUND: das ist NICHT der Herkunftsriegel, sondern sicherung.ts —')
      console.log('          dessen Router haengt in server.ts OHNE Pfad und gilt fuer die ganze Anwendung.')
    }
  }
}

/* ══ 4. WIRD WIRKLICH NICHT GESCHRIEBEN? ═════════════════════════════════ */

/**
 * Die Antwort einer Anfrage kann luegen — die DATEI nicht.
 *
 * Ein Riegel, der nur `Access-Control-Allow-Origin` entfernt, verhindert das
 * LESEN. Das SCHREIBEN laeuft weiter: ein Formular-POST von einer fremden
 * Seite braucht keine Vorabfrage, die Antwort interessiert den Angreifer
 * nicht. Deshalb wird hier in der Datei nachgesehen, nicht in der Antwort.
 */
async function schreibprobe(platz, riegelAus) {
  const lesen = () => {
    try {
      return String(JSON.parse(readFileSync(platz.konfigDatei, 'utf8'))?.mupibox?.startVolume ?? '')
    } catch {
      return '(nicht lesbar)'
    }
  }
  const setzen = (wert, kopf) =>
    roh({
      port: PORT,
      weg: '/api/konfiguration',
      methode: 'POST',
      kopf: { Host: `127.0.0.1:${PORT}`, 'Content-Type': 'application/json', ...kopf },
      rumpf: JSON.stringify({ aenderungen: { startLautstaerke: wert } }),
    })

  const vorher = lesen()
  const ohne = await setzen('41', {})
  const nachOhne = lesen()
  pruefe(
    `OHNE Herkunft schreibt weiterhin (${vorher} → ${nachOhne})`,
    ohne.status === 200 && nachOhne === '41',
    `Status ${ohne.status} ${ohne.text.slice(0, 120)}`,
  )

  // OHNE `Sec-Fetch-*` — nur so haengt der Fall allein am Herkunftsriegel und
  // die Gegenprobe misst wirklich IHN (siehe `werWies`).
  const fremd = await setzen('77', { Origin: 'https://boese.example' })
  const nachFremd = lesen()
  if (riegelAus) {
    pruefe(
      `GEGENPROBE: ohne Riegel schreibt die fremde Seite (${nachFremd})`,
      nachFremd === '77',
      `Status ${fremd.status}`,
    )
  } else {
    pruefe(
      `FREMDE Herkunft schreibt NICHT (steht weiter auf ${nachFremd})`,
      vomRiegel(fremd) && nachFremd === '41',
      `Status ${fremd.status}`,
    )
  }
  // Zuruecksetzen, damit ein zweiter Durchgang von derselben Lage ausgeht.
  await setzen('40', {})
}

/* ══ 5. DER BROWSER — DIE EINZIGE STELLE, DIE ES WIRKLICH ENTSCHEIDET ════ */

// Der Browser kommt GELIEHEN aus tools/leihgabe.mjs (eigenerBrowser):
// freier Port, eigenes Profil, Eigentumsnachweis — statt PORT+10, an dem ein
// Ueberlebender eines harten Abbruchs haengen koennte.

/**
 * Die Seite des Angreifers. Sie liegt auf `http://localhost:<PORT_ANGREIFER>`
 * — anderer Name UND anderer Port als die Box unter `http://127.0.0.1:<PORT>`,
 * also aus Sicht des Browsers echt fremd (cross-site).
 *
 * Sie versucht genau das, was eine solche Seite versuchen wuerde:
 *   1. LESEN   per fetch — geht nur mit `Access-Control-Allow-Origin`.
 *   2. SCHREIBEN per Formular in einen versteckten Rahmen — braucht KEINE
 *      Vorabfrage und ist der Weg, den ein Riegel gegen das Lesen offen laesst.
 *   3. AUSLOESEN per <img> auf einen GET mit Wirkung.
 */
const ANGRIFFSSEITE = (ziel) => `<!doctype html><meta charset="utf-8"><title>fremde Seite</title>
<script>
window.__fertig = (async () => {
  const ergebnis = { gelesen: null, fehler: null, bild: null }
  try {
    const a = await fetch('${ziel}/api/konfiguration', { credentials: 'include' })
    ergebnis.gelesen = (await a.text()).slice(0, 120)
    ergebnis.status = a.status
  } catch (e) { ergebnis.fehler = String(e).slice(0, 160) }
  // Ein Formular-POST — ohne Vorabfrage, Antwort egal.
  const f = document.createElement('form')
  f.method = 'POST'; f.action = '${ziel}/api/konfiguration'; f.target = 'stiller'
  const r = document.createElement('iframe'); r.name = 'stiller'; r.style.display = 'none'
  document.body ? document.body.append(r, f) : document.documentElement.append(r, f)
  f.submit()
  // Ein <img> auf einen GET mit Wirkung.
  ergebnis.bild = await new Promise((fertig) => {
    const b = new Image()
    b.onload = () => fertig('geladen')
    b.onerror = () => fertig('abgewiesen')
    b.src = '${ziel}/api/vorlesen/sprich?text=probe'
    setTimeout(() => fertig('keine Antwort'), 4000)
  })
  return ergebnis
})()
</script>`

function angreiferServer(ziel) {
  const s = createServer((_a, b) => {
    b.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    b.end(ANGRIFFSSEITE(ziel))
  })
  return new Promise((f) => s.listen(PORT_ANGREIFER, '127.0.0.1', () => f(s)))
}

/** Ein Chromium, das man fragen kann. Der Weg ist CDP ueber WebSocket. */
async function browserOeffnen() {
  const brw = await eigenerBrowser({ fenster: '1200,900' })
  if (!brw) throw new Error('kein Browser gefunden')
  // Dieses Werkzeug spricht mit dem BROWSER-Ziel (Target.createTarget je
  // Platz), nicht mit einer einzelnen Seite — deshalb json/version am
  // geliehenen Port, nicht brw.seite().
  let ziel = null
  for (let i = 0; i < 80 && !ziel; i++) {
    try {
      ziel = (await (await fetch(`http://127.0.0.1:${brw.port}/json/version`)).json()).webSocketDebuggerUrl
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  if (!ziel) {
    await brw.schliessen()
    throw new Error('Browser kam nicht hoch')
  }
  const { WebSocket } = await import('ws')
  const ws = new WebSocket(ziel)
  await new Promise((r, x) => {
    ws.on('open', r)
    ws.on('error', x)
  })
  let id = 0
  const offen = new Map()
  const horcher = []
  ws.on('message', (d) => {
    const n = JSON.parse(d)
    if (n.id && offen.has(n.id)) {
      offen.get(n.id)(n)
      offen.delete(n.id)
    } else if (n.method) {
      for (const h of horcher) h(n)
    }
  })
  const ruf = (method, params = {}, sessionId) =>
    new Promise((r) => {
      const i = ++id
      offen.set(i, r)
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
 * EINE SEITE OEFFNEN UND ALLES MITSCHREIBEN, WAS SIE UEBER DAS NETZ TUT.
 * `Network.responseReceived` ist der Punkt, an dem der Status feststeht;
 * `Network.loadingFailed` faengt die Anfragen, die der Browser wegen CORS gar
 * nicht erst ausliefert.
 */
async function seiteMessen(b, url, wartenMs, ablesen) {
  const { result: t } = await b.ruf('Target.createTarget', { url: 'about:blank' })
  const { result: s } = await b.ruf('Target.attachToTarget', { targetId: t.targetId, flatten: true })
  const sid = s.sessionId
  const anfragen = []
  b.horchen((n) => {
    if (n.sessionId !== sid) return
    if (n.method === 'Network.responseReceived') {
      anfragen.push({ url: n.params.response.url, status: n.params.response.status })
    }
    if (n.method === 'Network.loadingFailed') {
      anfragen.push({ url: '(abgebrochen)', status: 0, grund: n.params.errorText })
    }
  })
  await b.ruf('Network.enable', {}, sid)
  await b.ruf('Page.enable', {}, sid)
  await b.ruf('Runtime.enable', {}, sid)
  await b.ruf('Page.navigate', { url }, sid)
  await new Promise((r) => setTimeout(r, wartenMs))
  let wert = null
  if (ablesen) {
    const a = await b.ruf('Runtime.evaluate', { expression: ablesen, returnByValue: true, awaitPromise: true }, sid)
    wert = a.result?.result?.value ?? a.result?.exceptionDetails?.text ?? null
  }
  await b.ruf('Target.closeTarget', { targetId: t.targetId })
  return { anfragen, wert }
}

async function imBrowser(platz, riegelAus) {
  const b = await browserOeffnen()
  try {
    /* ── C1: DIE VERWALTUNG SELBST ────────────────────────────────────── */
    //
    // NICHT NUR DIE STARTSEITE. Die holt zwei Angaben und sagt damit fast
    // nichts. Angesehen werden die Seiten, die wirklich Daten ziehen — und
    // zwar jede einzeln, weil eine 403-Antwort in EINER von ihnen genau die
    // Art Ausfall ist, die man beim Ueberfliegen uebersieht.
    if (platz.adminDa) {
      const seiten = ['', 'konfiguration', 'system', 'netzwerk', 'darstellung', 'dienste', 'sicherung']
      let alle = 0
      let abgewiesen = 0
      for (const s of seiten) {
        const { anfragen } = await seiteMessen(b, `http://127.0.0.1:${PORT}/admin/${s}`, 4000, null)
        const eigene = anfragen.filter((a) => a.url.includes('/api/'))
        const ab = eigene.filter((a) => a.status === 403)
        alle += eigene.length
        abgewiesen += ab.length
        console.log(`      /admin/${(s || '(Start)').padEnd(16)} ${eigene.length} Anfragen an /api, ${ab.length} × 403`)
        for (const a of ab) console.log(`          403: ${a.url}`)
      }
      if (!riegelAus) {
        pruefe(
          `die VERWALTUNG laeuft weiter — ${alle} Anfragen ueber ${seiten.length} Seiten, keine abgewiesen`,
          alle >= seiten.length && abgewiesen === 0,
          `${abgewiesen} × 403`,
        )
      }
    } else {
      console.log('  (uebersprungen: www-admin ist nicht gebaut — npm run build:frontend-admin)')
    }

    /* ── C2: DIE EIGENE OBERFLAECHE UNTER / ───────────────────────────── */
    const eigen = await seiteMessen(
      b,
      `http://127.0.0.1:${PORT}/admin/`,
      1500,
      `(async () => {
         const a = await fetch('/api/konfiguration')
         const b = await fetch('/api/konfiguration', {
           method: 'POST', headers: {'Content-Type':'application/json'},
           body: JSON.stringify({ aenderungen: { startLautstaerke: '43' } }),
         })
         return { lesen: a.status, schreiben: b.status }
       })()`,
    )
    if (!riegelAus) {
      pruefe(
        'von der EIGENEN Herkunft aus geht lesen UND schreiben',
        eigen.wert?.lesen === 200 && eigen.wert?.schreiben === 200,
        JSON.stringify(eigen.wert),
      )
    }

    /* ── C3: DIE FREMDE SEITE ─────────────────────────────────────────── */
    const angriff = await seiteMessen(b, `http://localhost:${PORT_ANGREIFER}/`, 6000, 'window.__fertig.then(x => x)')
    const w = angriff.wert ?? {}
    console.log(`      fremdes fetch:  ${w.fehler ? `abgewiesen (${w.fehler})` : `GELESEN: ${w.gelesen}`}`)
    console.log(`      fremdes <img>:  ${w.bild}`)
    const nachher = String(JSON.parse(readFileSync(platz.konfigDatei, 'utf8'))?.mupibox?.startVolume ?? '')
    console.log(`      Lautstaerke in der Datei nach dem Formular-POST: ${nachher}`)
    if (riegelAus) {
      // KEINE FORDERUNG, SONDERN EIN BEFUND: ein echter Browser schickt immer
      // `Sec-Fetch-Site: cross-site`, und die faengt der zweite Riegel aus
      // sicherung.ts (pathless eingehaengt, gilt fuer die ganze Anwendung).
      // Die Gegenprobe FUER DEN HERKUNFTSRIEGEL steht deshalb oben in der
      // Tafel und in der Schreibprobe, nicht hier.
      console.log(
        `      (auch ohne Herkunftsriegel bleibt die fremde Seite draussen — das ist der Riegel aus sicherung.ts: ${
          w.fehler ?? 'kam durch!'
        })`,
      )
    } else {
      pruefe('die fremde Seite kann die Konfiguration NICHT lesen', !w.gelesen && Boolean(w.fehler), w.gelesen ?? '')
      pruefe('das <img> der fremden Seite loest nichts aus', w.bild !== 'geladen', String(w.bild))
      pruefe('der Formular-POST der fremden Seite hat nichts geschrieben', nachher === '43', `steht auf ${nachher}`)
    }
  } finally {
    await b.zu()
  }
}

/* ══ 6. DER LAUF ═════════════════════════════════════════════════════════ */

const platz = arbeitsplatz()
const gebaut = buendeln(platz.ordner)
let angreifer = null

async function durchgang(riegelAus) {
  const ueberschrift = riegelAus
    ? '══ GEGENPROBE: MUPIBOX_HERKUNFT_AUS=1 — hier MUSS es rot werden ══'
    : '══ DER RIEGEL WIE AUF DER BOX ══'
  console.log(`\n${ueberschrift}\n`)
  const s = await serverStarten(platz, gebaut, riegelAus)
  try {
    if (!s.tlsDa) console.log('  (Hinweis: kein TLS — der Fall „eigene https-Herkunft" bleibt ungemessen)')
    await tafel(s.tlsDa, riegelAus)
    console.log('\n  ── abseits von /api: wer antwortet dort? ──')
    await abseits(riegelAus)
    console.log('\n  ── was WIRKLICH in der Datei landet ──')
    await schreibprobe(platz, riegelAus)
    if (!OHNE_BROWSER && BROWSER) {
      console.log('\n  ── im echten Browser ──')
      await imBrowser(platz, riegelAus)
    } else if (!OHNE_BROWSER) {
      console.log('\n  (kein Chromium gefunden — Teil C uebersprungen, die Aussage bleibt unvollstaendig)')
      fehler++
    }
  } finally {
    s.kind.kill('SIGKILL')
    await new Promise((r) => setTimeout(r, 400))
  }
}

try {
  angreifer = await angreiferServer(`http://127.0.0.1:${PORT}`)
  await durchgang(false)
  await durchgang(true)
} catch (err) {
  console.error('\nAbgebrochen:', err instanceof Error ? err.message : err)
  fehler++
} finally {
  angreifer?.close()
  if (BEHALTEN) console.log(`\nArbeitsplatz bleibt liegen: ${platz.ordner}`)
  else rmSync(platz.ordner, { recursive: true, force: true })
}

console.log(`\n${fehler === 0 ? 'Alles wie erwartet.' : `${fehler} Zeile(n) stimmen nicht.`}`)
process.exit(fehler === 0 ? 0 : 1)
