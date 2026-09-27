#!/usr/bin/env node
/**
 * KOMMT MAN TROTZDEM DURCH? — DER NAMENSRIEGEL UND DIE SICHERUNGSKARTE,
 * GEGENGELESEN.
 *
 * ══ WOZU NOCH EIN WERKZEUG ════════════════════════════════════════════════
 * `tools/eigene-namen-riegel.mjs` misst den Riegel von der Seite dessen, der
 * ihn gebaut hat. Dieses hier misst ihn von der anderen Seite: es sucht die
 * Faelle, die dort NICHT drinstehen, und es sucht sie in der Reihenfolge, in
 * der ein Angreifer sie probieren wuerde.
 *
 *   RING 1 — DER NAMENSTAUSCH IN ALLEN FORMEN. Host und Origin gleich fremd;
 *            Host fremd und Origin FEHLEND (so kommt eine einfache
 *            gleichherkuenftige GET-Anfrage!); Host erlaubt und Origin fremd;
 *            Punkt am Ende; Grossschreibung; Port weg; falscher Port; IPv6 mit
 *            und ohne Klammern; Praefix UND Suffix eines erlaubten Namens;
 *            ZWEI Host-Kopfzeilen; Host mit Leerzeichen; Benutzerteil (`@`);
 *            Zeichen, an denen `new URL` scheitert; absolute Anfragezeile.
 *            SCHREIBEND wird IN DER DATEI nachgesehen, nicht in der Antwort —
 *            genau so ist der Befund entstanden, den dieses Werkzeug prueft.
 *
 *   RING 2 — GIBT ES WEGE VOR DEM RIEGEL? Der Riegel haengt an
 *            `app.use('/api', …)`. Diese Ringe fragen dieselben Wege in
 *            Schreibweisen, bei denen die Zwischenschicht und die Route
 *            AUSEINANDERLAUFEN koennten: Grossschreibung, doppelter
 *            Schraegstrich, `.` und `..` im Pfad, prozentkodiertes `a`,
 *            prozentkodierter Schraegstrich, Semikolon, angehaengter Punkt.
 *            ROT ist nur, wenn ein Weg die WIRKUNG hat und den Riegel NICHT
 *            gesehen hat.
 *
 *   RING 3 — LAESST SICH DIE WARNUNG DER SICHERUNG WIEDER ZUM VERSCHWINDEN
 *            BRINGEN? Unlesbarer Stand, leerer Stand, Stand mit falschem
 *            Format, alle Staende kaputt, sehr viele Pfade, sehr lange Pfade,
 *            Pfade mit Steuerzeichen. Gemessen wird die ANTWORT des echten
 *            Weges `/api/sicherung`, nicht die Funktion daneben.
 *
 *   RING 4 — DIE GEGENPROBE. Derselbe Ring 1 gegen einen zweiten Prozess mit
 *            `MUPIBOX_HERKUNFT_AUS=1`. Wird er dort nicht rot, misst Ring 1
 *            nichts.
 *
 * ══ WARUM ROHE SOCKETS ════════════════════════════════════════════════════
 * `fetch` laesst `Host` nicht setzen und `http.request` schickt keine zweite
 * Host-Kopfzeile. Genau das sind die Faelle. Also Byte fuer Byte.
 *
 * ══ AUFRUF ════════════════════════════════════════════════════════════════
 *     node tools/namensriegel-gegenlesen.mjs [--port 9657] [--behalten]
 *
 * NUR AUF DIESEM RECHNER. Nichts wird ausgeliefert, an der Box nichts
 * angefasst; der Server laeuft ueber einem Wegwerf-Verzeichnis.
 * Rueckgabewert: 0, wenn keine Zeile rot ist.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import net from 'node:net'
import { hostname, networkInterfaces, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND = join(WURZEL, 'src', 'backend-api')

const argv = process.argv.slice(2)
const opt = (n, v) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : v
}
const BEHALTEN = argv.includes('--behalten')

/**
 * EIN PORT, DER NACHGEWIESEN FREI IST.
 *
 * Auf diesem Rechner laufen fremde Sitzungen. Liegt auf dem Port schon ein
 * Server, misst dieses Werkzeug still den FALSCHEN und liefert eine
 * vollstaendige gruene Tafel ueber Software, die gar nicht laeuft. Deshalb
 * wird JEDER Port vorher wirklich gebunden — und beim Hochlauf wird
 * zusaetzlich geprueft, dass die Antwort von DIESEM Backend kommt.
 */
async function portFrei(p) {
  return await new Promise((fertig) => {
    const s = net.createServer()
    s.once('error', () => fertig(false))
    s.once('listening', () => s.close(() => fertig(true)))
    s.listen(p, '0.0.0.0')
  })
}
async function portSuchen(von, bis) {
  // VIER: p (Riegel an), p+1 (Gegenprobe) und die beiden TLS-Seiten p+2/p+3.
  // `MUPIBOX_HTTPS_PORT=0` hilft NICHT — server.ts liest `Number(…) || 8443`
  // und belegte damit den TLS-Port DIESES Rechners.
  for (let p = von; p <= bis; p++) {
    const alle = await Promise.all([portFrei(p), portFrei(p + 1), portFrei(p + 2), portFrei(p + 3)])
    if (alle.every(Boolean)) return p
  }
  throw new Error(`kein freier Portblock zwischen ${von} und ${bis}`)
}

const GEWUENSCHT = Number(opt('port', '9657'))
const PORT = await portSuchen(GEWUENSCHT, GEWUENSCHT + 80)
const PORT_OFFEN = PORT + 1
if (PORT !== GEWUENSCHT) console.log(`(Port ${GEWUENSCHT} war belegt — dieser Lauf liegt auf ${PORT})`)

let fehler = 0
let zeilen = 0
const pruefe = (satz, ok, dazu = '') => {
  zeilen++
  console.log(`  ${ok ? 'ok  ' : 'NEIN'} ${satz}${dazu ? `  — ${dazu}` : ''}`)
  if (!ok) fehler++
}
const merke = (satz) => console.log(`  ····  ${satz}`)

/* ══ 1. WIE HEISST DIESE MASCHINE WIRKLICH ════════════════════════════════ */

const RECHNERNAME = hostname()
const MARKE = RECHNERNAME.split('.')[0]
const LAN = (() => {
  for (const liste of Object.values(networkInterfaces())) {
    for (const a of liste ?? []) if (a.family === 'IPv4' && !a.internal) return a.address
  }
  return null
})()
const KONFIG_MARKE = 'mixpibox'

/* ══ 2. ARBEITSPLATZ ══════════════════════════════════════════════════════ */

function arbeitsplatz() {
  const ordner = mkdtempSync(join(tmpdir(), 'mupi-gegen-'))
  mkdirSync(join(ordner, 'server', 'config'), { recursive: true })
  mkdirSync(join(ordner, 'tls'), { recursive: true })
  mkdirSync(join(ordner, 'staende'), { recursive: true })
  const datei = join(ordner, 'server', 'config', 'mupiboxconfig.json')
  schreibeKonfig(datei)
  return { ordner, konfigDatei: datei, staende: join(ordner, 'staende') }
}

/** `audioDevice` MUSS stehen, sonst lehnt der Server JEDES Schreiben ab. */
function schreibeKonfig(datei, mehr = {}) {
  writeFileSync(
    datei,
    JSON.stringify(
      {
        mupibox: { host: 'MixPiBox', startVolume: '41', maxVolume: '100', audioDevice: 'default', ...mehr },
        // WIE AUSGELIEFERT: keine Anmeldung.
        interfacelogin: { state: false, password: '' },
        timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
      },
      null,
      2,
    ),
  )
}

function buendeln(ordner) {
  const esbuild = [join(BACKEND, 'node_modules/.bin/esbuild'), join(WURZEL, 'node_modules/.bin/esbuild')].find(existsSync)
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

async function serverStarten(platz, gebaut, port, riegelAus = false) {
  const umgebung = { ...process.env }
  // Auf der Box ist NODE_ENV NICHT gesetzt — genau dieser Zweig soll laufen.
  delete umgebung.NODE_ENV
  delete umgebung.MUPIBOX_HERKUNFT_ZUSATZ
  delete umgebung.MUPIBOX_HOST_ZUSATZ
  delete umgebung.MUPIBOX_HERKUNFT_AUS
  if (riegelAus) umgebung.MUPIBOX_HERKUNFT_AUS = '1'
  Object.assign(umgebung, {
    MUPIBOX_HTTP_PORT: String(port),
    MUPIBOX_HTTPS_PORT: String(port + 2),
    MUPIBOX_TLS_DIR: join(platz.ordner, 'tls'),
    MUPIBOX_CONFIG: platz.konfigDatei,
    MUPIBOX_LOCK_DIR: platz.ordner,
    MUPIBOX_ADMIN_DIR: join(platz.ordner, 'www-admin'),
    MUPIBOX_SICHERUNG_STAENDE: platz.staende,
  })
  const kind = spawn(process.execPath, [gebaut], { cwd: platz.ordner, env: umgebung, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  kind.stdout.on('data', (d) => {
    log += d
  })
  kind.stderr.on('data', (d) => {
    log += d
  })
  let oben = false
  for (let i = 0; i < 240 && !oben; i++) {
    if (kind.exitCode !== null) throw new Error(`Server beendete sich mit ${kind.exitCode}:\n${log}`)
    try {
      const a = await anfrage({ weg: '/api/auth/state', port })
      // NICHT „Status 200" — der koennte von einem fremden Prozess kommen.
      // Nur diese Form kommt von DIESEM Backend.
      oben = a.status === 200 && typeof JSON.parse(a.rumpf)?.anmeldungNoetig === 'boolean'
    } catch {
      /* noch nicht oben */
    }
    if (!oben) await new Promise((r) => setTimeout(r, 150))
  }
  if (!oben) {
    kind.kill('SIGKILL')
    throw new Error(`auf ${port} antwortet nicht dieses Backend:\n${log}`)
  }
  return { kind, log: () => log }
}

/* ══ 3. EINE ANFRAGE, BYTE FUER BYTE ══════════════════════════════════════ */

function rohAnfrage({ zeile, koepfe = [], rumpf = '', port = PORT }) {
  return new Promise((fertig, schief) => {
    const s = net.connect(port, '127.0.0.1')
    let text = ''
    const alle = [...koepfe]
    if (rumpf) alle.push(['Content-Length', String(Buffer.byteLength(rumpf))])
    alle.push(['Connection', 'close'])
    s.setTimeout(15000)
    s.on('connect', () => s.write(`${zeile}\r\n${alle.map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n${rumpf}`))
    s.on('data', (d) => {
      text += d
    })
    s.on('timeout', () => {
      s.destroy()
      schief(new Error('Zeit abgelaufen'))
    })
    s.on('error', schief)
    s.on('close', () => {
      const trenn = text.indexOf('\r\n\r\n')
      const kopfteil = trenn < 0 ? text : text.slice(0, trenn)
      const rest = trenn < 0 ? '' : text.slice(trenn + 4)
      const zs = kopfteil.split('\r\n')
      const status = Number(zs[0]?.split(' ')[1] ?? 0)
      const kopf = {}
      for (const z of zs.slice(1)) {
        const i = z.indexOf(':')
        if (i > 0) kopf[z.slice(0, i).trim().toLowerCase()] = z.slice(i + 1).trim()
      }
      fertig({ status, kopf, rumpf: entstueckeln(rest, kopf) })
    })
  })
}

function entstueckeln(rest, kopf) {
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

function anfrage({ weg, methode = 'GET', koepfe = [], rumpf = '', host, port = PORT, version = '1.1' }) {
  const alle = host === null ? [...koepfe] : [['Host', host ?? `127.0.0.1:${port}`], ...koepfe]
  return rohAnfrage({ zeile: `${methode} ${weg} HTTP/${version}`, koepfe: alle, rumpf, port })
}

const grundVon = (a) => {
  if (a.status !== 403) return ''
  try {
    return String(JSON.parse(a.rumpf)?.grund ?? '?')
  } catch {
    return '?'
  }
}
/** Kam die ECHTE Auskunft heraus? Nicht „Status 200", sondern der Inhalt. */
const echteAuskunft = (a) => {
  if (a.status !== 200) return false
  try {
    const k = JSON.parse(a.rumpf)
    return Array.isArray(k?.bereiche) || Array.isArray(k?.felder) || typeof k?.werte === 'object'
  } catch {
    return false
  }
}

/* ══ 4. LOS ═══════════════════════════════════════════════════════════════ */

const platz = arbeitsplatz()
const lautstaerke = () => {
  try {
    return String(JSON.parse(readFileSync(platz.konfigDatei, 'utf8'))?.mupibox?.startVolume ?? '?')
  } catch {
    return '?'
  }
}

/**
 * SCHREIBEN — UND IN DER DATEI NACHSEHEN, NICHT IN DER ANTWORT.
 *
 * Ein Server kann mit 403 antworten und trotzdem geschrieben haben, und er
 * kann mit 200 antworten, ohne etwas geaendert zu haben. Nur die Datei weiss es.
 */
async function schreibVersuch({ host, koepfe = [], port = PORT, wert = '57', zeile = null }) {
  const vorher = lautstaerke()
  const rumpf = JSON.stringify({ aenderungen: { startLautstaerke: wert } })
  const kopfliste = [['Content-Type', 'application/json'], ...koepfe]
  const a = zeile
    ? await rohAnfrage({
        zeile,
        koepfe: [...(host === null ? [] : [['Host', host ?? `127.0.0.1:${port}`]]), ...kopfliste],
        rumpf,
        port,
      })
    : await anfrage({ weg: '/api/konfiguration', methode: 'POST', host, port, koepfe: kopfliste, rumpf })
  const nachher = lautstaerke()
  return { a, vorher, nachher, geschrieben: nachher !== vorher }
}

function zurueckstellen() {
  schreibeKonfig(platz.konfigDatei)
}

console.log('Buendeln …')
const gebaut = buendeln(platz.ordner)
console.log(`Diese Maschine heisst: ${RECHNERNAME}  (Marke ${MARKE}, LAN ${LAN ?? '—'})`)
console.log(`Server auf 127.0.0.1:${PORT}, Gegenprobe auf ${PORT_OFFEN}`)
console.log(`Wegwerf-Verzeichnis ${platz.ordner}\n`)
const server = await serverStarten(platz, gebaut, PORT)

/* ══ RING 1 — DER NAMENSTAUSCH IN ALLEN FORMEN ════════════════════════════ */

console.log('RING 1 — kommt man mit einem fremden Namen durch?\n')

/**
 * Jede Zeile: ein `Host`, wie ihn ein Angreifer gern haette. ERWARTET wird
 * `sperrt` — abgewiesen und NICHTS in der Datei. `durch` heisst: hier ist
 * Durchlassen die begruendete Entscheidung (siehe `warum`), dann wird nur
 * geprueft, dass es kein UNBEMERKTES Schreiben unter fremdem Namen ist.
 */
const FREMD = [
  { was: 'Host und Origin gleich fremd (der Namenstausch selbst)', host: 'boese.example', origin: 'http://boese.example' },
  { was: 'Host fremd, Origin FEHLT (die einfache gleichherkuenftige GET-Anfrage)', host: 'boese.example' },
  { was: 'Host fremd mit Port', host: `boese.example:${PORT}`, origin: `http://boese.example:${PORT}` },
  { was: 'Host fremd, Punkt am Ende', host: 'boese.example.' },
  { was: 'Host fremd, Grossbuchstaben', host: 'BOESE.EXAMPLE' },
  { was: 'Host fremd, Punkt am Ende UND Gross', host: 'BOESE.EXAMPLE.' },
  { was: 'Praefix eines erlaubten Namens', host: `${MARKE}.boese.example` },
  { was: 'Suffix eines erlaubten Namens', host: `boese.example.${MARKE}` },
  { was: 'eigene Marke unter KAEUFLICHER Endung (.box)', host: `${MARKE}.box` },
  { was: 'Konfigmarke unter kaeuflicher Endung', host: `${KONFIG_MARKE}.box` },
  { was: 'eigene Marke, zwei Marken tief unter reservierter Endung', host: `${MARKE}.a.lan` },
  { was: 'reservierte Endung als PRAEFIX einer kaeuflichen', host: `${MARKE}.lan.boese.example` },
  { was: 'Adresse mit angehaengtem fremdem Namen', host: `${LAN ?? '127.0.0.1'}.boese.example` },
  { was: 'Host mit Benutzerteil: fremd@erlaubt', host: `boese.example@${MARKE}`, note: 'ein Browser kann kein @ in Host setzen' },
  { was: 'Host mit Benutzerteil: erlaubt@fremd', host: `${MARKE}@boese.example` },
  { was: 'ZWEI Host-Kopfzeilen, erlaubt dann fremd', host: MARKE, zweiterHost: 'boese.example' },
  { was: 'ZWEI Host-Kopfzeilen, fremd dann erlaubt', host: 'boese.example', zweiterHost: MARKE },
  { was: 'Host mit Leerzeichen mittendrin', host: `${MARKE} boese.example` },
  { was: 'Host mit fuehrendem Leerzeichen (fremd)', host: '  boese.example' },
  { was: 'Host mit Zeichen, an denen new URL scheitert', host: `boese.example|${MARKE}` },
  { was: 'Host leer', host: '' },
  { was: 'Host nur aus Leerzeichen', host: '   ' },
  { was: 'Host FEHLT ganz', host: null },
]

for (const f of FREMD) {
  const koepfe = []
  if (f.zweiterHost) koepfe.push(['Host', f.zweiterHost])
  if (f.origin) koepfe.push(['Origin', f.origin])
  const lesend = await anfrage({ weg: '/api/konfiguration', host: f.host, koepfe })
  const s = await schreibVersuch({ host: f.host, koepfe })
  if (s.geschrieben) zurueckstellen()
  const gesperrt = !echteAuskunft(lesend) && !s.geschrieben
  pruefe(
    f.was,
    gesperrt,
    `lesend ${lesend.status}${grundVon(lesend) ? `/${grundVon(lesend)}` : ''}, schreibend ${s.a.status}${
      grundVon(s.a) ? `/${grundVon(s.a)}` : ''
    }, Datei ${s.vorher}→${s.nachher}${f.note ? ` [${f.note}]` : ''}`,
  )
}

/* Die Faelle, in denen Durchlassen die BEGRUENDETE Entscheidung ist: hier wird
 * nur festgehalten, WAS wirklich passiert — nicht behauptet, es sei gut. */
console.log('\n  (festgehalten, nicht bewertet — hier laesst der Riegel bewusst durch)')
for (const f of [
  { was: 'HTTP/1.0 ganz ohne Host', version: '1.0', host: null },
  { was: 'Host erlaubt, Origin fremd', host: MARKE, origin: 'http://boese.example' },
]) {
  const koepfe = f.origin ? [['Origin', f.origin]] : []
  const lesend = await anfrage({ weg: '/api/konfiguration', host: f.host, koepfe, version: f.version ?? '1.1' })
  merke(`${f.was}: lesend ${lesend.status}${grundVon(lesend) ? `/${grundVon(lesend)}` : ''}`)
}

/* ══ RING 1b — IPv6 UND DIE NORMALISIERUNG VON ADRESSEN ═══════════════════ */

console.log('\nRING 1b — Adressen in ungewoehnlicher Schreibweise\n')
for (const f of [
  { was: 'IPv6 Rueckschleife in Klammern', host: `[::1]:${PORT}`, erwartet: 'durch' },
  { was: 'IPv6 Rueckschleife lang geschrieben', host: `[0:0:0:0:0:0:0:1]:${PORT}`, erwartet: 'durch' },
  { was: 'IPv6 OHNE Klammern (kein gueltiger Host)', host: `::1`, erwartet: 'egal' },
  { was: 'IPv4 als Dezimalzahl (127.0.0.1 = 2130706433)', host: `2130706433:${PORT}`, erwartet: 'durch' },
  { was: 'IPv4 oktal geschrieben', host: `0177.0.0.01:${PORT}`, erwartet: 'durch' },
  { was: 'fremde IPv6-Adresse', host: `[2001:db8::1]:${PORT}`, erwartet: 'sperrt' },
]) {
  const lesend = await anfrage({ weg: '/api/konfiguration', host: f.host })
  const kam = echteAuskunft(lesend) ? 'durch' : 'sperrt'
  const ok = f.erwartet === 'egal' || kam === f.erwartet
  pruefe(f.was, ok, `${lesend.status}${grundVon(lesend) ? `/${grundVon(lesend)}` : ''} → ${kam}`)
}

/* ══ RING 2 — WEGE VOR DEM RIEGEL ═════════════════════════════════════════
 *
 * Der Riegel haengt an `app.use('/api', …)`, die Wirkung an
 * `app.post('/api/konfiguration', …)`. Beide gehen durch dieselbe
 * Pfadauswertung — aber wenn sie irgendwo AUSEINANDERLAUFEN, ist genau dort
 * ein Weg mit Wirkung ohne Riegel. Fremder Host, dann nachsehen: hat es
 * geschrieben?
 */

console.log('\nRING 2 — laeuft die Zwischenschicht irgendwo an der Route vorbei?\n')

const WEGE = [
  '/api/konfiguration',
  '/API/konfiguration',
  '/Api/Konfiguration',
  '//api/konfiguration',
  '/./api/konfiguration',
  '/api/./konfiguration',
  '/foo/../api/konfiguration',
  '/%61pi/konfiguration',
  '/api%2fkonfiguration',
  '/api/konfiguration/',
  '/api/konfiguration/.',
  '/api/konfiguration;x=1',
  '/api/konfiguration?x=1',
  '/api//konfiguration',
  '/api/konfiguration%20',
  '/api\\konfiguration',
]

for (const weg of WEGE) {
  const s = await schreibVersuch({ host: 'boese.example', wert: '63', zeile: `POST ${weg} HTTP/1.1` })
  if (s.geschrieben) zurueckstellen()
  // ROT ist nur: es HAT geschrieben. Ein 404 ist genauso gut wie ein 403 —
  // was nicht ankommt, kann nichts anrichten.
  pruefe(
    `POST ${weg} mit fremdem Host schreibt nichts`,
    !s.geschrieben,
    `${s.a.status}${grundVon(s.a) ? `/${grundVon(s.a)}` : ''}, Datei ${s.vorher}→${s.nachher}`,
  )
}

// Und dieselben Wege mit ERLAUBTEM Host: welche kommen ueberhaupt an? Nur so
// laesst sich sagen, ob Ring 2 oben etwas gemessen hat oder lauter 404.
merke('Gegenstueck: dieselben Wege mit erlaubtem Host — welche haben ueberhaupt Wirkung?')
const wirksam = []
for (const weg of WEGE) {
  const s = await schreibVersuch({ host: `127.0.0.1:${PORT}`, wert: '59', zeile: `POST ${weg} HTTP/1.1` })
  if (s.geschrieben) {
    wirksam.push(weg)
    zurueckstellen()
  }
}
merke(`wirksame Schreibweisen: ${wirksam.join('  ') || '(keine)'}`)
pruefe('mindestens eine Schreibweise hat wirklich Wirkung (sonst misst Ring 2 nichts)', wirksam.length > 0)

/* ══ RING 2b — DIE ANDEREN WEGE HINTER DEM RIEGEL ═════════════════════════ */

console.log('\nRING 2b — andere Wege mit Wirkung unter fremdem Namen\n')
for (const w of [
  { weg: '/api/sicherung', methode: 'GET' },
  { weg: '/api/data', methode: 'GET' },
  { weg: '/api/netzwerk', methode: 'GET' },
  { weg: '/api/auth/state', methode: 'GET' },
  { weg: '/api/spotify/web/me', methode: 'GET' },
  { weg: '/player/status', methode: 'GET' },
]) {
  const a = await anfrage({ weg: w.weg, methode: w.methode, host: 'boese.example' })
  pruefe(`${w.methode} ${w.weg} unter fremdem Namen abgewiesen`, a.status === 403 && grundVon(a) === 'fremder-name', `${a.status}/${grundVon(a) || '—'}`)
}

/* ══ RING 3 — DIE WARNUNG DER SICHERUNG ═══════════════════════════════════
 *
 * Ein Stand ist ein tar.gz mit einem `stand.json` darin. Das hier baut welche
 * — auch kaputte, denn genau die sind die Frage.
 */

console.log('\nRING 3 — laesst sich die Warnung der Sicherung wieder zum Verschwinden bringen?\n')

function tarEintrag(name, inhalt) {
  const daten = Buffer.from(inhalt, 'utf8')
  const kopf = Buffer.alloc(512)
  kopf.write(name, 0, 100, 'utf8')
  kopf.write('000644 \0', 100, 8, 'ascii')
  kopf.write('000000 \0', 108, 8, 'ascii')
  kopf.write('000000 \0', 116, 8, 'ascii')
  kopf.write(`${daten.length.toString(8).padStart(11, '0')} `, 124, 12, 'ascii')
  kopf.write('00000000000 ', 136, 12, 'ascii')
  kopf.write('        ', 148, 8, 'ascii') // Pruefsumme spaeter
  kopf.write('0', 156, 1, 'ascii')
  let summe = 0
  for (const b of kopf) summe += b
  kopf.write(`${summe.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  const fuell = Buffer.alloc(Math.ceil(daten.length / 512) * 512 - daten.length)
  return Buffer.concat([kopf, daten, fuell])
}

function standBauen(standJson) {
  return gzipSync(Buffer.concat([tarEintrag('stand.json', standJson), Buffer.alloc(1024)]))
}

function standLegen(name, inhalt) {
  writeFileSync(join(platz.staende, `mupibox-sicherung-${name}.tar.gz`), inhalt)
}
function staendeLeeren() {
  rmSync(platz.staende, { recursive: true, force: true })
  mkdirSync(platz.staende, { recursive: true })
}

const gueltigerStand = (unbekannt) =>
  standBauen(
    JSON.stringify({
      format: 1,
      erzeugt: '2026-08-01T10:00:00',
      grund: 'probe',
      host: 'mupibox',
      dateien: [],
      ausgelassen: [],
      unbekannt,
    }),
  )

async function karte() {
  const a = await anfrage({ weg: '/api/sicherung', host: `127.0.0.1:${PORT}` })
  let k = null
  try {
    k = JSON.parse(a.rumpf)
  } catch {
    /* nicht lesbar */
  }
  return { status: a.status, laenge: a.rumpf.length, n: k?.nichtEingeordnet ?? null }
}

const EIN_FUND = [{ pfad: '/home/dietpi/.mupibox/eigenes.json', bytes: 12, warum: 'unbekannt' }]

// 3a — der Ausgangszustand: ein gueltiger Stand mit Fund, die Warnung steht.
staendeLeeren()
standLegen('2026-08-01_10-00-00', gueltigerStand(EIN_FUND))
let k = await karte()
pruefe('gueltiger Stand mit Fund → Warnung steht', Boolean(k.n?.satz), `satz=${JSON.stringify(k.n?.satz ?? null)}`)

// 3b — DER ALTE BEFUND: ein NEUERER, unlesbarer Stand daneben.
standLegen('2026-08-02_10-00-00', Buffer.from('das ist kein gzip'))
k = await karte()
pruefe(
  'neuerer UNLESBARER Stand → Warnung verschwindet NICHT',
  Boolean(k.n?.satz),
  `satz=${JSON.stringify((k.n?.satz ?? '').slice(0, 60))}, pfade=${k.n?.pfade?.length ?? '—'}`,
)
pruefe(
  '… und der unlesbare Stand wird BENANNT',
  JSON.stringify(k.n?.rat ?? []).includes('2026-08-02'),
  `rat=${JSON.stringify(k.n?.rat ?? []).slice(0, 140)}`,
)

// 3c — ein LEERER neuester Stand (0 Byte).
staendeLeeren()
standLegen('2026-08-01_10-00-00', gueltigerStand(EIN_FUND))
standLegen('2026-08-02_10-00-00', Buffer.alloc(0))
k = await karte()
pruefe('neuester Stand 0 Byte → Warnung steht weiter', Boolean(k.n?.satz), `satz=${JSON.stringify((k.n?.satz ?? '').slice(0, 60))}`)

// 3d — gueltiges gzip, aber KEIN tar (falsches Format).
staendeLeeren()
standLegen('2026-08-01_10-00-00', gueltigerStand(EIN_FUND))
standLegen('2026-08-02_10-00-00', gzipSync(Buffer.from('kein tar, nur text')))
k = await karte()
pruefe('neuester Stand gzip ohne tar → Warnung steht weiter', Boolean(k.n?.satz), `satz=${JSON.stringify((k.n?.satz ?? '').slice(0, 60))}`)

// 3e — tar, aber stand.json ist kein JSON.
staendeLeeren()
standLegen('2026-08-01_10-00-00', gueltigerStand(EIN_FUND))
standLegen('2026-08-02_10-00-00', standBauen('{kaputt'))
k = await karte()
pruefe('neuester Stand mit kaputtem stand.json → Warnung steht weiter', Boolean(k.n?.satz), `satz=${JSON.stringify((k.n?.satz ?? '').slice(0, 60))}`)

// 3f — ALLE Staende kaputt: sagt es das?
staendeLeeren()
for (const t of ['2026-08-01_10-00-00', '2026-08-02_10-00-00', '2026-08-03_10-00-00'])
  standLegen(t, Buffer.from('kein gzip'))
k = await karte()
pruefe('alle Staende kaputt → die Karte steht und sagt es', Boolean(k.n?.satz), `satz=${JSON.stringify(k.n?.satz ?? null)}`)
merke(`rat: ${JSON.stringify(k.n?.rat ?? []).slice(0, 200)}`)
merke(`stand=${JSON.stringify(k.n?.stand ?? null)} erzeugt=${JSON.stringify(k.n?.erzeugt ?? null)}`)

// 3g — gar kein Stand: schweigt es?
staendeLeeren()
k = await karte()
pruefe('gar kein Stand → schweigt (Normalfall frische Box)', k.n === null, `nichtEingeordnet=${JSON.stringify(k.n)}`)

// 3h — SEHR VIELE Pfade.
staendeLeeren()
standLegen(
  '2026-08-01_10-00-00',
  gueltigerStand(Array.from({ length: 4000 }, (_, i) => ({ pfad: `/home/dietpi/ablage-${i}/${'x'.repeat(200)}`, bytes: 1, warum: 'x' }))),
)
k = await karte()
pruefe('4000 Pfade zu je 200+ Zeichen → Antwort bleibt klein', k.laenge < 20000, `Antwort ${k.laenge} Zeichen, ${k.n?.pfade?.length ?? '—'} Pfade`)
pruefe('… und die volle ZAHL steht im Satz', String(k.n?.satz ?? '').includes('4000'), `satz=${JSON.stringify((k.n?.satz ?? '').slice(0, 80))}`)

// 3i — SEHR LANGE einzelne Pfade.
staendeLeeren()
standLegen('2026-08-01_10-00-00', gueltigerStand([{ pfad: `/${'y'.repeat(400000)}`, bytes: 1, warum: 'x' }]))
k = await karte()
pruefe('ein Pfad mit 400 000 Zeichen → Antwort bleibt klein', k.laenge < 20000, `Antwort ${k.laenge} Zeichen, laengster Pfad ${Math.max(0, ...(k.n?.pfade ?? []).map((p) => p.length))}`)

// 3j — Steuerzeichen im Pfad.
staendeLeeren()
standLegen(
  '2026-08-01_10-00-00',
  gueltigerStand([{ pfad: '/home/[31mrot\n\r ende', bytes: 1, warum: 'x' }]),
)
k = await karte()
pruefe(
  'Pfad mit Steuerzeichen → Antwort ist noch gueltiges JSON',
  k.n !== null,
  `pfad=${JSON.stringify((k.n?.pfade ?? [])[0] ?? null)}`,
)

// 3k — der Deckel darf die Aufzaehlung nicht MITTEN in einem Zeichen kappen.
staendeLeeren()
standLegen('2026-08-01_10-00-00', gueltigerStand([{ pfad: `/home/${'ä'.repeat(300)}/x.json`, bytes: 1, warum: 'x' }]))
k = await karte()
const gekuerzt = (k.n?.pfade ?? [])[0] ?? ''
pruefe('gekuerzter Umlautpfad bleibt lesbarer Text', !gekuerzt.includes('�'), `${JSON.stringify(gekuerzt.slice(0, 40))}… (${gekuerzt.length} Zeichen)`)

staendeLeeren()

/* ══ RING 4 — DIE GEGENPROBE ══════════════════════════════════════════════ */

console.log('\nRING 4 — Gegenprobe: mit MUPIBOX_HERKUNFT_AUS=1 muss Ring 1 rot werden\n')
const offen = await serverStarten(platz, gebaut, PORT_OFFEN, true)
zurueckstellen()
const g = await schreibVersuch({ host: 'boese.example', koepfe: [['Origin', 'http://boese.example']], port: PORT_OFFEN, wert: '57' })
pruefe(
  'ohne Riegel schreibt der Namenstausch WEITERHIN durch (sonst misst Ring 1 nichts)',
  g.geschrieben,
  `${g.a.status}, Datei ${g.vorher}→${g.nachher}`,
)
const gl = await anfrage({ weg: '/api/konfiguration', host: 'boese.example', port: PORT_OFFEN })
pruefe('ohne Riegel kommt die echte Auskunft heraus', echteAuskunft(gl), `${gl.status}`)
zurueckstellen()

/* ══ SCHLUSS ══════════════════════════════════════════════════════════════ */

server.kind.kill('SIGKILL')
offen.kind.kill('SIGKILL')
if (!BEHALTEN) rmSync(platz.ordner, { recursive: true, force: true })
else console.log(`\n(Wegwerf-Verzeichnis behalten: ${platz.ordner})`)

console.log(`\n${zeilen} Zeilen, ${fehler} rot.`)
process.exit(fehler === 0 ? 0 : 1)
