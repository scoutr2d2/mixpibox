#!/usr/bin/env node
/**
 * HEISST DIE BOX WIRKLICH SO? — DER NAMENSRIEGEL, VON BEIDEN SEITEN GEMESSEN.
 *
 * ══ WORUM ES GEHT ═════════════════════════════════════════════════════════
 * `herkunft.ts` hielt `Origin` gegen `Host` DERSELBEN Anfrage. Das faengt die
 * gewoehnliche fremde Seite — aber nicht den NAMENSTAUSCH: laesst der
 * Angreifer seinen eigenen Namen nach dem ersten Laden auf die Box zeigen,
 * tragen `Host` UND `Origin` denselben fremden Namen, der Browser haelt die
 * Anfrage fuer gleichherkuenftig und meldet sogar `same-origin`. Gemessen am
 * 07.08.2026 (riegel-durchkommen.mjs, Ring 3): `POST /api/konfiguration` mit
 * `Host: boese.example` kam mit 200 durch und aenderte die Lautstaerke IN DER
 * DATEI von 41 auf 57.
 *
 * `eigene-namen.ts` leitet seither zur Laufzeit ab, wie die Box selbst heisst.
 * DIESES WERKZEUG MISST BEIDE RICHTUNGEN, und die zweite ist die wichtigere:
 *
 *   RING A — KOMMT MAN DURCH? Namenstausch lesend und schreibend (in der
 *            DATEI nachgesehen, nicht in der Antwort), `Host` leer, `Host`
 *            fehlend, HTTP/1.0 ohne Host, Punkt am Ende, Grossschreibung,
 *            Port weggelassen, IPv6 in Klammern, Praefix eines erlaubten
 *            Namens.
 *   RING B — SPERRT ES DEN BESITZER AUS? Jeder Name, unter dem diese Maschine
 *            wirklich erreichbar ist, lesend UND schreibend, dazu die
 *            Vorabfrage (OPTIONS) und der Weg ueber TLS.
 *   RING C — DER AUSWEG. Traegt die Fehlermeldung eine Adresse, die WIRKLICH
 *            funktioniert? Und laesst sich ein fremder Name ueber
 *            `hostZusatz` in mupiboxconfig.json erlauben, OHNE Neustart?
 *   RING D — DIE GEGENPROBE. Derselbe Ring A gegen einen zweiten Serverprozess
 *            mit `MUPIBOX_HERKUNFT_AUS=1`. Wird er dort nicht rot, misst
 *            dieses Werkzeug nichts.
 *
 * ══ WARUM MIT ROHEN SOCKETS ═══════════════════════════════════════════════
 * `fetch` laesst `Host` nicht setzen, `http.request` weigert sich, eine
 * Anfragezeile ohne Host zu schicken. Genau das sind die Faelle. Also wird die
 * Anfrage Byte fuer Byte geschrieben.
 *
 * ══ AUFRUF ════════════════════════════════════════════════════════════════
 *     node tools/eigene-namen-riegel.mjs [--port 9631] [--behalten]
 *
 * NUR AUF DIESEM RECHNER. Es wird nichts ausgeliefert, nichts an der Box
 * angefasst; der Server laeuft ueber einem Wegwerf-Verzeichnis.
 * Rueckgabewert: 0, wenn keine Zeile rot ist.
 */
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { homedir, hostname, networkInterfaces, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'
import { eigenerBrowser } from './leihgabe.mjs'

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
 * Dieselbe Narbe wie in den Nachbarwerkzeugen, und sie ist teuer bezahlt:
 * liegt auf dem Port schon ein Server einer fremden Sitzung, misst dieses
 * Werkzeug still den FALSCHEN und liefert eine vollstaendige gruene Tafel
 * ueber Software, die gar nicht laeuft. Deshalb wird JEDER Port vorher
 * wirklich gebunden — und weiter unten wird zusaetzlich geprueft, dass die
 * Antwort von DIESEM Backend kommt.
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
  // VIER: p (Riegel an), p+1 (Gegenprobe, Riegel aus) und die beiden
  // TLS-Seiten p+2 und p+3. `MUPIBOX_HTTPS_PORT=0` hilft NICHT — server.ts
  // liest `Number(...) || 8443` und belegte damit den TLS-Port DIESES
  // Rechners, an dem fremde Sitzungen ihre Vorschau haben.
  for (let p = von; p <= bis; p++) {
    const alle = await Promise.all([portFrei(p), portFrei(p + 1), portFrei(p + 2), portFrei(p + 3)])
    if (alle.every(Boolean)) return p
  }
  throw new Error(`kein freier Portblock zwischen ${von} und ${bis}`)
}

const GEWUENSCHT = Number(opt('port', '9631'))
const PORT = await portSuchen(GEWUENSCHT, GEWUENSCHT + 60)
const PORT_OFFEN = PORT + 1
const PORT_TLS = PORT + 2
if (PORT !== GEWUENSCHT) console.log(`(Port ${GEWUENSCHT} war belegt — dieser Lauf liegt auf ${PORT})`)

let fehler = 0
const pruefe = (satz, ok, dazu = '') => {
  console.log(`  ${ok ? 'ok  ' : 'NEIN'} ${satz}${dazu ? `  — ${dazu}` : ''}`)
  if (!ok) fehler++
}
const merke = (satz) => console.log(`  ····  ${satz}`)

/* ══ 1. WIE HEISST DIESE MASCHINE WIRKLICH? ═══════════════════════════════
 *
 * RING B MUSS MIT ECHTEN NAMEN MESSEN, sonst misst er nichts. Die sechs Wege
 * beim Betreiber (localhost, 127.0.0.1, die LAN-Adresse, dieselbe ueber TLS,
 * der Rechnername, `<name>.local`, dazu `mupibox.host` aus der Konfiguration)
 * haben hier ihre Entsprechung — dieselbe Ableitung, andere Werte. Ein fest
 * eingetragenes `192.168.178.169` waere eine Behauptung ueber eine Maschine,
 * die gar nicht laeuft.
 */
const RECHNERNAME = hostname()
const MARKE = RECHNERNAME.split('.')[0]
const LAN = (() => {
  for (const liste of Object.values(networkInterfaces())) {
    for (const a of liste ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address
    }
  }
  return null
})()
const KONFIG_NAME = 'mixpibox'

/* ══ 2. EIN ARBEITSPLATZ, DER AUSSIEHT WIE DIE BOX ════════════════════════ */

function arbeitsplatz() {
  const ordner = mkdtempSync(join(tmpdir(), 'mupi-namen-'))
  const konf = join(ordner, 'server', 'config')
  mkdirSync(konf, { recursive: true })
  mkdirSync(join(ordner, 'tls'), { recursive: true })
  const datei = join(konf, 'mupiboxconfig.json')
  schreibeKonfig(datei, {})
  // Die gebaute Verwaltung — ohne sie laesst sich Ring E nicht messen.
  const adminQuelle = [join(WURZEL, 'src/deploy/www-admin'), join(WURZEL, 'src/frontend-admin/www-admin')].find(existsSync)
  if (adminQuelle) cpSync(adminQuelle, join(ordner, 'www-admin'), { recursive: true })
  return { ordner, konfigDatei: datei, adminDa: Boolean(adminQuelle) }
}

/** `audioDevice` MUSS stehen, sonst lehnt der Server JEDES Schreiben ab. */
function schreibeKonfig(datei, mehr) {
  writeFileSync(
    datei,
    JSON.stringify(
      {
        mupibox: {
          // Der Name, den der Betreiber in der Verwaltung setzen kann — der
          // einzige der Namensquellen, der OHNE SSH erreichbar ist.
          host: 'MixPiBox',
          startVolume: '41',
          maxVolume: '100',
          audioDevice: 'default',
          ...mehr,
        },
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
  const esbuild = [join(BACKEND, 'node_modules', '.bin', 'esbuild'), join(WURZEL, 'node_modules', '.bin', 'esbuild')].find(
    existsSync,
  )
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
  // Auf der Box ist NODE_ENV NICHT gesetzt — der Server soll in genau dem
  // Zweig laufen, in dem er dort laeuft.
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
    MUPIBOX_SICHERUNG_STAENDE: join(platz.ordner, 'staende'),
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
  for (let i = 0; i < 220 && !oben; i++) {
    if (kind.exitCode !== null) throw new Error(`Server beendete sich mit ${kind.exitCode}:\n${log}`)
    try {
      const a = await anfrage({ weg: '/api/auth/state', port })
      // NICHT „Status 200" — der koennte von irgendeinem fremden Prozess
      // kommen. Nur diese Form kommt von DIESEM Backend.
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

function rohAnfrage({ zeile, koepfe = [], rumpf = '', port = PORT, ueberTls = false }) {
  return new Promise((fertig, schief) => {
    const s = ueberTls
      ? tls.connect({ port, host: '127.0.0.1', rejectUnauthorized: false, servername: undefined })
      : net.connect(port, '127.0.0.1')
    let text = ''
    const alle = [...koepfe]
    if (rumpf) alle.push(['Content-Length', String(Buffer.byteLength(rumpf))])
    alle.push(['Connection', 'close'])
    s.setTimeout(8000)
    const los = () => s.write(`${zeile}\r\n${alle.map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n${rumpf}`)
    s.on(ueberTls ? 'secureConnect' : 'connect', los)
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
      const zeilen = kopfteil.split('\r\n')
      const status = Number(zeilen[0]?.split(' ')[1] ?? 0)
      const kopf = {}
      for (const z of zeilen.slice(1)) {
        const i = z.indexOf(':')
        if (i > 0) kopf[z.slice(0, i).trim().toLowerCase()] = z.slice(i + 1).trim()
      }
      fertig({ status, kopf, rumpf: entstueckeln(rest, kopf) })
    })
  })
}

/** `Transfer-Encoding: chunked` von Hand aufloesen. */
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

function anfrage({ weg, methode = 'GET', koepfe = [], rumpf = '', host, port = PORT, ueberTls = false }) {
  return rohAnfrage({
    zeile: `${methode} ${weg} HTTP/1.1`,
    koepfe: [['Host', host ?? `127.0.0.1:${port}`], ...koepfe],
    rumpf,
    port,
    ueberTls,
  })
}

/** WER hat abgewiesen — und WARUM? Ein 403 allein sagt das nicht. */
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

/* ══ 3b. EIN ECHTER BROWSER ═══════════════════════════════════════════════
 *
 * WOZU, wenn die Sockets oben doch alles messen: weil ein Browser die
 * Kopfzeilen selbst setzt und dabei Dinge tut, die kein Werkzeug nachbaut —
 * er haengt `Origin` an, er schickt `Sec-Fetch-*`, und vor allem: er setzt
 * `Host` aus der ADRESSZEILE. Genau daran haengt dieser Riegel. Wenn die
 * Verwaltung unter einem NAMEN (nicht unter 127.0.0.1) nicht mehr laeuft,
 * sieht man es nur so.
 */
// Browser GELIEHEN ueber eigenerBrowser() (tools/leihgabe.mjs); die Suche
// dort ehrt MUPIBOX_BROWSER und kennt Playwright wie das System.
async function browserOeffnen() {
  const brw = await eigenerBrowser({ fenster: '1200,900' })
  if (!brw) throw new Error('kein Browser gefunden')
  // Dieses Werkzeug spricht mit dem BROWSER-Ziel (Target.createTarget je
  // Seite) — deshalb json/version am geliehenen Port, nicht brw.seite().
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

/** Eine Seite oeffnen und mitschreiben, was sie ueber das Netz tut. */
async function seiteMessen(b, url, wartenMs, ablesen) {
  const { result: t } = await b.ruf('Target.createTarget', { url: 'about:blank' })
  const { result: s } = await b.ruf('Target.attachToTarget', { targetId: t.targetId, flatten: true })
  const sid = s.sessionId
  const anfragen = []
  b.horchen((n) => {
    if (n.sessionId !== sid) return
    if (n.method === 'Network.responseReceived') anfragen.push({ url: n.params.response.url, status: n.params.response.status })
    if (n.method === 'Network.loadingFailed') anfragen.push({ url: '(abgebrochen)', status: 0, grund: n.params.errorText })
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
 * Daran haengt die ganze Aussage: ein Server kann mit 403 antworten und
 * trotzdem geschrieben haben, und er kann mit 200 antworten, ohne etwas
 * geaendert zu haben. Nur die Datei weiss es.
 */
async function schreibVersuch({ host, koepfe = [], port = PORT, ueberTls = false, wert }) {
  const vorher = lautstaerke()
  const a = await anfrage({
    weg: '/api/konfiguration',
    methode: 'POST',
    host,
    port,
    ueberTls,
    koepfe: [['Content-Type', 'application/json'], ...koepfe],
    rumpf: JSON.stringify({ aenderungen: { startLautstaerke: wert } }),
  })
  const nachher = lautstaerke()
  return { a, vorher, nachher, geschrieben: nachher !== vorher }
}

/** Nach einem erfolgreichen Schreiben zurueckstellen — der naechste misst neu. */
function zurueckstellen() {
  schreibeKonfig(platz.konfigDatei, {})
}

console.log('Buendeln …')
const gebaut = buendeln(platz.ordner)
console.log(`Diese Maschine heisst: ${RECHNERNAME}  (Marke ${MARKE}, LAN ${LAN ?? '—'})`)
console.log(`Server auf 127.0.0.1:${PORT}, Gegenprobe auf ${PORT_OFFEN}, TLS auf ${PORT_TLS}`)
console.log(`Wegwerf-Verzeichnis ${platz.ordner}\n`)
const server = await serverStarten(platz, gebaut, PORT)
let gegen = null

try {
  /* ══ RING A — KOMMT MAN DURCH? ═══════════════════════════════════════ */
  console.log('══ RING A — kommt man unter einem fremden Namen durch? ══════════════════\n')
  {
    const gruss = await anfrage({ weg: '/api/konfiguration' })
    pruefe(
      `Grundlage: unter 127.0.0.1 kommt die echte Auskunft heraus (Status ${gruss.status})`,
      echteAuskunft(gruss),
      'ohne diese Zeile misst alles darunter nichts',
    )
  }

  /** Faelle, die AM NAMENSRIEGEL enden muessen. */
  const FREMD = [
    {
      name: 'DER NAMENSTAUSCH (Host+Origin derselbe fremde Name)',
      host: 'boese.example',
      koepfe: [
        ['Origin', 'http://boese.example'],
        ['Sec-Fetch-Site', 'same-origin'],
      ],
    },
    { name: 'derselbe Name, nur lesend, ganz ohne Herkunft', host: 'boese.example' },
    { name: 'mit Port dran', host: `boese.example:${PORT}` },
    { name: 'GROSS geschrieben', host: 'BOESE.EXAMPLE' },
    { name: 'Punkt am Ende', host: 'boese.example.' },
    { name: 'Praefix eines erlaubten Namens (127.0.0.1.boese.example)', host: '127.0.0.1.boese.example' },
    { name: 'die eigene Marke unter kaeuflicher Endung', host: `${MARKE}.boese.example` },
    { name: 'die eigene Marke unter einer echten TLD (.box ist kaeuflich!)', host: `${MARKE}.box` },
    { name: 'eine fremde Adresse aus demselben Netz', host: '10.11.12.13' },
    { name: 'IPv6 in Klammern, aber eine fremde', host: '[2001:db8::1]' },
  ]
  for (const f of FREMD) {
    const a = await anfrage({ weg: '/api/konfiguration', host: f.host, koepfe: f.koepfe })
    const g = grundVon(a)
    pruefe(
      `${f.name.padEnd(58)} ${String(a.status).padEnd(3)} ${(g || '—').padEnd(14)}`,
      a.status === 403 && g === 'fremder-name',
      a.status === 200 ? 'DIE ECHTE AUSKUNFT KAM HERAUS' : '',
    )
  }

  console.log('')
  {
    const s = await schreibVersuch({
      host: 'boese.example',
      wert: 57,
      koepfe: [
        ['Origin', 'http://boese.example'],
        ['Sec-Fetch-Site', 'same-origin'],
      ],
    })
    pruefe(
      `NAMENSTAUSCH SCHREIBEND  ${String(s.a.status).padEnd(3)} ${(grundVon(s.a) || '—').padEnd(14)} Datei: ${s.vorher}→${s.nachher}`,
      !s.geschrieben,
      s.geschrieben ? 'GESCHRIEBEN — eine fremde Seite hat die Box verstellt' : '',
    )
    if (s.geschrieben) zurueckstellen()
  }

  console.log('\n  ── und die Faelle, in denen NICHT geurteilt werden kann ──────────────')
  console.log('  Ein Browser schickt `Host` immer und kann ihn aus einer Seite heraus')
  console.log('  nicht faelschen. Diese Anfragen kommen also nicht aus einem Angriff —')
  console.log('  und Aussperren waere hier der teurere Fehler. Sie MUESSEN durchkommen.\n')
  {
    const ohne = [
      { name: 'HTTP/1.0 ganz ohne Host-Kopfzeile', zeile: 'GET /api/konfiguration HTTP/1.0', koepfe: [] },
      { name: 'HTTP/1.1 mit LEEREM Host', zeile: 'GET /api/konfiguration HTTP/1.1', koepfe: [['Host', '']] },
      { name: 'HTTP/1.1 mit Host aus Leerzeichen', zeile: 'GET /api/konfiguration HTTP/1.1', koepfe: [['Host', '   ']] },
    ]
    for (const f of ohne) {
      const a = await rohAnfrage({ zeile: f.zeile, koepfe: f.koepfe })
      pruefe(
        `${f.name.padEnd(58)} ${String(a.status).padEnd(3)} ${(grundVon(a) || '—').padEnd(14)}`,
        a.status !== 403,
        a.status === 403 ? 'ausgesperrt, obwohl nichts zu beurteilen war' : '',
      )
    }
  }

  /* ══ RING B — SPERRT ES DEN BESITZER AUS? ════════════════════════════ */
  console.log('\n══ RING B — jeder Name, unter dem die Box wirklich erreicht wird ════════\n')
  console.log('  Die Entsprechung der sechs Wege beim Betreiber, auf DIESER Maschine.')
  console.log('  Jeder Name wird LESEND und SCHREIBEND gemessen, dazu die Vorabfrage.\n')

  const ECHT = [
    ['der Kiosk auf der Box selbst', `localhost:${PORT}`],
    ['Werkzeuge und Skripte auf der Box', `127.0.0.1:${PORT}`],
    ['dasselbe ueber IPv6', `[::1]:${PORT}`],
    ['ohne Port (der Browser laesst 80 weg)', 'localhost'],
    ['mit Punkt am Ende', `localhost.:${PORT}`],
    ['GROSS geschrieben', `LOCALHOST:${PORT}`],
    ['der Rechnername', `${MARKE}:${PORT}`],
    ['der mDNS-Name', `${MARKE}.local:${PORT}`],
    ['der Name, den ein Router vergibt', `${MARKE}.fritz.box:${PORT}`],
    ['derselbe unter .lan', `${MARKE}.lan:${PORT}`],
    ['der Name aus mupiboxconfig.json (ohne SSH aenderbar)', `${KONFIG_NAME}:${PORT}`],
    ['und dessen mDNS-Form', `${KONFIG_NAME}.local:${PORT}`],
    ...(LAN ? [['ein zweiter Rechner im Heimnetz', `${LAN}:${PORT}`]] : []),
  ]

  let wert = 42
  for (const [wozu, host] of ECHT) {
    const schema = 'http'
    const lesend = await anfrage({ weg: '/api/konfiguration', host, koepfe: [['Origin', `${schema}://${host}`]] })
    const s = await schreibVersuch({
      host,
      wert: wert++,
      koepfe: [
        ['Origin', `${schema}://${host}`],
        ['Sec-Fetch-Site', 'same-origin'],
      ],
    })
    const vor = await anfrage({
      weg: '/api/konfiguration',
      methode: 'OPTIONS',
      host,
      koepfe: [
        ['Origin', `${schema}://${host}`],
        ['Access-Control-Request-Method', 'POST'],
      ],
    })
    const ok = echteAuskunft(lesend) && s.geschrieben && vor.status !== 403
    pruefe(
      `${wozu.padEnd(48)} ${host.padEnd(34)} lesen ${String(lesend.status).padEnd(3)} schreiben ${s.vorher}→${s.nachher} vorab ${vor.status}`,
      ok,
      ok ? '' : `AUSGESPERRT (${grundVon(lesend) || grundVon(s.a) || grundVon(vor) || 'kein Riegelgrund'})`,
    )
  }

  console.log('')
  {
    // TLS — dieselbe Seite ueber den zweiten Port. server.ts legt sich das
    // Zertifikat selbst an; geprueft wird der Riegel, nicht das Zertifikat.
    let tlsOk = null
    try {
      const a = await anfrage({
        weg: '/api/konfiguration',
        host: `127.0.0.1:${PORT_TLS}`,
        port: PORT_TLS,
        ueberTls: true,
        koepfe: [['Origin', `https://127.0.0.1:${PORT_TLS}`]],
      })
      tlsOk = echteAuskunft(a) ? true : `Status ${a.status} ${grundVon(a)}`
    } catch (e) {
      tlsOk = `keine TLS-Seite: ${e.message}`
    }
    pruefe(`dieselbe Seite ueber TLS (Port ${PORT_TLS})`, tlsOk === true, tlsOk === true ? '' : String(tlsOk))
  }

  /* ══ RING C — DER AUSWEG ═════════════════════════════════════════════ */
  console.log('\n══ RING C — der Ausweg fuer den, der doch ausgesperrt wird ══════════════\n')
  {
    const a = await anfrage({ weg: '/api/konfiguration', host: 'wohnzimmer.example' })
    let satz = ''
    try {
      satz = String(JSON.parse(a.rumpf)?.fehler ?? '')
    } catch {
      /* kein JSON */
    }
    pruefe('die Ablehnung nennt den Namen, unter dem gerufen wurde', satz.includes('wohnzimmer.example'))
    pruefe('… und sagt, wie er dauerhaft gilt (Datei und Feld)', satz.includes('hostZusatz') && satz.includes('mupiboxconfig.json'))

    // DER AUSWEG MUSS NICHT NUR DASTEHEN, ER MUSS FUNKTIONIEREN. Also: die
    // erste Adresse aus dem Satz herausziehen und WIRKLICH aufrufen.
    const treffer = [...satz.matchAll(/https?:\/\/([^/\s]+)\//g)].map((m) => m[1])
    const brauchbar = treffer.filter((h) => !h.includes('mupibox.local') || h.startsWith(MARKE))
    let gegangen = false
    for (const h of brauchbar) {
      const b = await anfrage({ weg: '/api/konfiguration', host: h.replace(/:\d+$/, `:${PORT}`) })
      if (echteAuskunft(b)) {
        gegangen = true
        merke(`die genannte Adresse funktioniert wirklich: ${h}`)
        break
      }
    }
    pruefe(`der Satz nennt ${treffer.length} Adresse(n) — und mindestens eine davon TRAEGT`, gegangen)
  }

  console.log('')
  {
    // DER ZWEITE AUSWEG: `hostZusatz` in mupiboxconfig.json. Er ist nur dann
    // einer, wenn er OHNE Neustart greift — wer nicht davorsitzt, kann das
    // Backend nicht neu starten.
    const vorher = await anfrage({ weg: '/api/konfiguration', host: 'wohnzimmer.example' })
    pruefe('vorher ist «wohnzimmer.example» gesperrt', vorher.status === 403)
    schreibeKonfig(platz.konfigDatei, { hostZusatz: 'wohnzimmer.example' })
    // Der Puffer haelt 5 s — genau die wird gewartet, nicht der Server
    // angefasst.
    await new Promise((r) => setTimeout(r, 5400))
    const nachher = await anfrage({ weg: '/api/konfiguration', host: 'wohnzimmer.example' })
    pruefe(
      'nach dem Eintrag in mupiboxconfig.json kommt er durch — OHNE Neustart',
      echteAuskunft(nachher),
      echteAuskunft(nachher) ? '' : `Status ${nachher.status} ${grundVon(nachher)}`,
    )
    // Und zurueck: der Riegel bleibt kein Scheunentor, wenn der Eintrag geht.
    schreibeKonfig(platz.konfigDatei, {})
    await new Promise((r) => setTimeout(r, 5400))
    const wieder = await anfrage({ weg: '/api/konfiguration', host: 'wohnzimmer.example' })
    pruefe('und nach dem Entfernen ist er wieder gesperrt', wieder.status === 403)
  }

  /* ══ RING E — DIE VERWALTUNG, IN EINEM ECHTEN BROWSER ════════════════ */
  console.log('\n══ RING E — die Verwaltung durchgeklickt, unter einem NAMEN ═════════════\n')
  if (!platz.adminDa) {
    console.log('  (uebersprungen: www-admin ist nicht gebaut — npm run build:frontend-admin)')
  } else if (!BROWSER) {
    console.log('  (uebersprungen: kein Chromium gefunden — MUPIBOX_BROWSER setzen)')
  } else {
    console.log('  NICHT unter 127.0.0.1 — genau darin liegt der Unterschied. Der Browser')
    console.log('  setzt `Host` aus der Adresszeile, und ein Name ist der Fall, den dieser')
    console.log('  Riegel neu beurteilt. Jede Seite einzeln, weil ein einzelnes 403 beim')
    console.log('  Ueberfliegen genau die Art Ausfall ist, die man uebersieht.\n')
    const b = await browserOeffnen()
    try {
      const ueber = [['der Rechnername', MARKE], ...(LAN ? [['die LAN-Adresse', LAN]] : [])]
      for (const [wozu, name] of ueber) {
        const wurzel = `http://${name}:${PORT}`
        const seiten = ['', 'konfiguration', 'system', 'netzwerk', 'darstellung', 'dienste', 'sicherung']
        let alle = 0
        let abgewiesen = 0
        for (const s of seiten) {
          const { anfragen } = await seiteMessen(b, `${wurzel}/admin/${s}`, 4000, null)
          const eigene = anfragen.filter((a) => a.url.includes('/api/'))
          const ab = eigene.filter((a) => a.status === 403)
          alle += eigene.length
          abgewiesen += ab.length
          console.log(`      ${name}/admin/${(s || '(Start)').padEnd(16)} ${eigene.length} Anfragen an /api, ${ab.length} × 403`)
          for (const a of ab) console.log(`          403: ${a.url}`)
        }
        pruefe(
          `${wozu}: ${seiten.length} Seiten, ${alle} Anfragen an /api, keine abgewiesen`,
          alle >= seiten.length && abgewiesen === 0,
          `${abgewiesen} × 403`,
        )

        // EINMAL SPEICHERN — aus der geladenen Seite heraus, mit allem, was
        // der Browser dabei anhaengt. Nachgesehen wird in der DATEI.
        const vorher = lautstaerke()
        const neu = String(Number(vorher) + 1)
        const { wert } = await seiteMessen(
          b,
          `${wurzel}/admin/konfiguration`,
          2500,
          `(async () => {
             const a = await fetch('/api/konfiguration', {
               method: 'POST', headers: {'Content-Type':'application/json'},
               body: JSON.stringify({ aenderungen: { startLautstaerke: '${neu}' } }),
             })
             return { status: a.status, text: (await a.text()).slice(0, 200) }
           })()`,
        )
        const nachher = lautstaerke()
        pruefe(
          `${wozu}: einmal gespeichert — Antwort ${wert?.status ?? '?'}, Datei ${vorher}→${nachher}`,
          nachher === neu,
          nachher === neu ? '' : `NICHT GESCHRIEBEN: ${JSON.stringify(wert)}`,
        )
      }
    } finally {
      await b.zu()
    }
  }

  /* ══ RING D — DIE GEGENPROBE ═════════════════════════════════════════ */
  console.log('\n══ RING D — die Gegenprobe: derselbe Ring A mit abgeschaltetem Riegel ═══\n')
  console.log('  Wird hier nichts rot, misst dieses Werkzeug nichts.\n')
  gegen = await serverStarten(platz, gebaut, PORT_OFFEN, true)
  {
    const a = await anfrage({ weg: '/api/konfiguration', host: 'boese.example', port: PORT_OFFEN })
    pruefe('OHNE Riegel kommt die echte Auskunft unter fremdem Namen heraus', echteAuskunft(a))
    const s = await schreibVersuch({
      host: 'boese.example',
      port: PORT_OFFEN,
      wert: 57,
      koepfe: [
        ['Origin', 'http://boese.example'],
        ['Sec-Fetch-Site', 'same-origin'],
      ],
    })
    pruefe(
      `OHNE Riegel schreibt der Namenstausch wirklich  (Datei: ${s.vorher}→${s.nachher})`,
      s.geschrieben,
      s.geschrieben ? '' : 'die Gegenprobe misst nichts — der Weg schreibt gar nicht mehr',
    )
    zurueckstellen()
  }
} finally {
  server.kind.kill('SIGKILL')
  gegen?.kind.kill('SIGKILL')
  if (!BEHALTEN) rmSync(platz.ordner, { recursive: true, force: true })
  else console.log(`\n(Wegwerf-Verzeichnis behalten: ${platz.ordner})`)
}

console.log(`\n${fehler === 0 ? 'Keine Zeile rot.' : `${fehler} Zeile(n) ROT.`}`)
process.exit(fehler === 0 ? 0 : 1)
