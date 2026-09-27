#!/usr/bin/env node
/**
 * DER AUSGESPERRTE MENSCH — WAS STEHT WIRKLICH AUF SEINEM SCHIRM?
 *
 * ══ WARUM DIESES WERKZEUG NEBEN DEN ANDEREN STEHT ═════════════════════════
 * `tools/eigene-namen-riegel.mjs` misst, OB der Riegel abweist (Statuszahl,
 * Datei nachgesehen) und dass die Verwaltung unter den echten Namen laeuft.
 * Es misst NICHT die teuerste Frage:
 *
 *     Wenn der Riegel jemanden abweist — SIEHT er den Satz, der ihm den Weg
 *     zurueck zeigt? Oder sieht er eine kaputte Seite ohne ein Wort dazu?
 *
 * Das ist keine Haarspalterei, sondern die ganze Begruendung des Riegels. In
 * `eigene-namen.ts` steht ueber `fremderNameSatz`: „ER IST DER UNTERSCHIED
 * ZWISCHEN AERGERNIS UND SACKGASSE." Ein Satz, den niemand zu sehen bekommt,
 * ist kein Ausweg — er ist eine Behauptung ueber einen Ausweg.
 *
 * UND DIE BAUART LEGT DEN VERDACHT NAHE: der Riegel haengt (server.ts, um
 * Zeile 690) NUR vor `/api` und `/player`. Die statischen Seiten (`/`,
 * `/admin`, `/neu`) sind FREI. Wer die Box unter einem unbekannten Namen
 * aufruft, bekommt die Seite also AUSGELIEFERT — und erst ihre Nachladungen
 * fallen mit 403. Der Satz steht dann in einem JSON-Rumpf, den ein Mensch nur
 * sieht, wenn die Oberflaeche ihn anzeigt.
 *
 * ══ WAS GEMESSEN WIRD ═════════════════════════════════════════════════════
 *   RING A — DIE ECHTEN NAMEN. Jeder Weg, ueber den diese Maschine wirklich
 *            erreichbar ist, lesend UND schreibend UND als Vorabfrage
 *            (OPTIONS). Unabhaengig nachgemessen, nicht uebernommen.
 *   RING B — DIE BOX-OBERFLAECHE `/neu/` unter einem gueltigen Namen, in
 *            einem echten Browser. Sie ist das, was ein KIND sieht. Jede
 *            Anfrage wird gezaehlt, jeder Fehlschlag benannt.
 *   RING C — DER AUSGESPERRTE MENSCH. Derselbe Browser, aber unter einem
 *            Namen, den die Box nicht kennt. Gemessen wird NICHT die
 *            Statuszahl, sondern der SICHTBARE TEXT der Seite: kommt der
 *            Ausweg darin vor — eine Adresse, ein „hostZusatz", irgendetwas?
 *   RING D — WENN DIE ABLEITUNG SELBST SCHEITERT. Ein Serverprozess, dem der
 *            Rechnername genommen wurde, und einer ohne lesbare Konfiguration.
 *            Faellt der Riegel dann auf oder zu?
 *
 * ══ AUFRUF ════════════════════════════════════════════════════════════════
 *     node tools/riegel-ausgesperrt-was-sieht-er.mjs [--port 9651] [--behalten]
 *
 * NUR AUF DIESEM RECHNER. Es wird nichts ausgeliefert und nichts an der Box
 * angefasst; der Server laeuft ueber einem Wegwerf-Verzeichnis.
 * Rueckgabewert: 0, wenn keine Zeile rot ist.
 */
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { hostname, networkInterfaces, tmpdir } from 'node:os'
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
const BEHALTEN = argv.includes('--behalten')

/**
 * EIN PORT, DER NACHGEWIESEN FREI IST.
 *
 * Auf diesem Rechner laufen fremde Sitzungen. Liegt auf dem Port schon ein
 * Server, misst dieses Werkzeug still den FALSCHEN und liefert eine gruene
 * Tafel ueber Software, die gar nicht laeuft. Deshalb wird jeder Port vorher
 * wirklich gebunden — und unten zusaetzlich geprueft, dass die Antwort von
 * DIESEM Backend kommt.
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
  // Vier am Stueck: p (Riegel an), p+1 (ohne Rechnernamen), p+2 (ohne
  // Konfiguration) und p+3 als TLS-Seite. `MUPIBOX_HTTPS_PORT=0` hilft NICHT —
  // server.ts liest `Number(...) || 8443` und belegte damit den TLS-Port
  // dieses Rechners. (Der Debug-Port des Browsers braucht keinen Platz im
  // Block mehr — den holt sich `eigenerBrowser()` selbst frei.)
  for (let p = von; p <= bis; p++) {
    const alle = await Promise.all([portFrei(p), portFrei(p + 1), portFrei(p + 2), portFrei(p + 3)])
    if (alle.every(Boolean)) return p
  }
  throw new Error(`kein freier Portblock zwischen ${von} und ${bis}`)
}

const GEWUENSCHT = Number(opt('port', '9651'))
const PORT = await portSuchen(GEWUENSCHT, GEWUENSCHT + 60)
if (PORT !== GEWUENSCHT) console.log(`(Port ${GEWUENSCHT} war belegt — dieser Lauf liegt auf ${PORT})`)

let fehler = 0
const pruefe = (satz, ok, dazu = '') => {
  console.log(`  ${ok ? 'ok  ' : 'NEIN'} ${satz}${dazu ? `  — ${dazu}` : ''}`)
  if (!ok) fehler++
}
const merke = (satz) => console.log(`  ····  ${satz}`)

/* ══ 1. WIE HEISST DIESE MASCHINE WIRKLICH? ═══════════════════════════════ */

const RECHNERNAME = hostname()
const MARKE = RECHNERNAME.split('.')[0].toLowerCase()
const LAN = (() => {
  for (const liste of Object.values(networkInterfaces())) {
    for (const a of liste ?? []) if (a.family === 'IPv4' && !a.internal) return a.address
  }
  return null
})()
const KONFIG_NAME = 'mixpibox'

/* ══ 2. EIN ARBEITSPLATZ, DER AUSSIEHT WIE DIE BOX ════════════════════════ */

/** `audioDevice` MUSS stehen, sonst lehnt der Server JEDES Schreiben ab. */
function schreibeKonfig(datei, mehr) {
  writeFileSync(
    datei,
    JSON.stringify(
      {
        mupibox: { host: 'MixPiBox', startVolume: '41', maxVolume: '100', audioDevice: 'default', ...mehr },
        interfacelogin: { state: false, password: '' },
        timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
      },
      null,
      2,
    ),
  )
}

function arbeitsplatz() {
  const ordner = mkdtempSync(join(tmpdir(), 'mupi-ausgesperrt-'))
  const konf = join(ordner, 'server', 'config')
  mkdirSync(konf, { recursive: true })
  mkdirSync(join(ordner, 'tls'), { recursive: true })
  const datei = join(konf, 'mupiboxconfig.json')
  schreibeKonfig(datei, {})

  const adminQuelle = [join(WURZEL, 'src/deploy/www-admin'), join(WURZEL, 'src/frontend-admin/www-admin')].find(
    existsSync,
  )
  if (adminQuelle) cpSync(adminQuelle, join(ordner, 'www-admin'), { recursive: true })

  // DIE BOX-OBERFLAECHE. `express.static(__dirname/www)` liefert sie aus, und
  // `/neu/` ist im Bau `NewDesign/` an dieser Stelle. Ohne beides misst Ring B
  // nichts — und Ring B ist der, in dem ein Kind vor der Box sitzt.
  const wwwZiel = join(ordner, 'www')
  const boxQuelle = [join(WURZEL, 'src/deploy/www/browser'), join(WURZEL, 'src/frontend-box/www/browser')].find(
    existsSync,
  )
  if (boxQuelle) cpSync(boxQuelle, wwwZiel, { recursive: true })
  else mkdirSync(wwwZiel, { recursive: true })
  const neuQuelle = join(WURZEL, 'NewDesign')
  if (existsSync(neuQuelle)) cpSync(neuQuelle, join(wwwZiel, 'neu'), { recursive: true })

  return {
    ordner,
    konfigDatei: datei,
    adminDa: Boolean(adminQuelle),
    boxDa: Boolean(boxQuelle),
    neuDa: existsSync(join(wwwZiel, 'neu', 'index.html')),
  }
}

function buendeln(ordner) {
  const esbuild = [join(BACKEND, 'node_modules/.bin/esbuild'), join(WURZEL, 'node_modules/.bin/esbuild')].find(
    existsSync,
  )
  if (!esbuild) {
    console.error('esbuild nicht gefunden — npm install fehlt.')
    process.exit(2)
  }
  const ziel = join(ordner, 'server.js')
  const bau = spawnSync(
    esbuild,
    [join(BACKEND, 'src/server.ts'), '--bundle', '--platform=node', '--target=node26', `--outfile=${ziel}`],
    { encoding: 'utf8' },
  )
  if (bau.status !== 0) {
    console.error('Buendeln fehlgeschlagen:\n', bau.stderr)
    process.exit(2)
  }
  return ziel
}

/**
 * Einen Serverprozess hochbringen — und BEWEISEN, dass er es ist.
 *
 * `zusatzUmgebung` erlaubt Ring D: einem Prozess den Rechnernamen oder die
 * Konfiguration wegzunehmen, ohne an diesem Rechner etwas zu aendern.
 */
async function serverStarten(platz, gebaut, port, zusatzUmgebung = {}) {
  const umgebung = { ...process.env }
  // Auf der Box ist NODE_ENV NICHT gesetzt — der Server soll in genau dem
  // Zweig laufen, in dem er dort laeuft.
  delete umgebung.NODE_ENV
  delete umgebung.MUPIBOX_HERKUNFT_ZUSATZ
  delete umgebung.MUPIBOX_HOST_ZUSATZ
  delete umgebung.MUPIBOX_HERKUNFT_AUS
  Object.assign(
    umgebung,
    {
      MUPIBOX_HTTP_PORT: String(port),
      MUPIBOX_HTTPS_PORT: String(port + 3),
      MUPIBOX_TLS_DIR: join(platz.ordner, 'tls'),
      MUPIBOX_CONFIG: platz.konfigDatei,
      MUPIBOX_LOCK_DIR: platz.ordner,
      MUPIBOX_ADMIN_DIR: join(platz.ordner, 'www-admin'),
      MUPIBOX_WWW_DIR: join(platz.ordner, 'www'),
      MUPIBOX_SICHERUNG_STAENDE: join(platz.ordner, 'staende'),
    },
    zusatzUmgebung,
  )
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
  let oben = false
  for (let i = 0; i < 220 && !oben; i++) {
    if (kind.exitCode !== null) throw new Error(`Server beendete sich mit ${kind.exitCode}:\n${log}`)
    try {
      const a = await rohAnfrage({ zeile: 'GET /api/auth/state HTTP/1.1', koepfe: [['Host', '127.0.0.1']], port })
      // NICHT „Status 200" — der koennte von einem fremden Prozess kommen.
      // Nur DIESE Form kommt von DIESEM Backend.
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

/* ══ 3. EINE ANFRAGE, BYTE FUER BYTE ══════════════════════════════════════
 *
 * `fetch` laesst `Host` nicht setzen. Genau das ist hier der Messwert. Also
 * wird die Anfrage von Hand geschrieben.
 */
function rohAnfrage({ zeile, koepfe = [], rumpf = '', port = PORT }) {
  return new Promise((fertig, schief) => {
    const s = net.connect(port, '127.0.0.1')
    let text = ''
    const alle = [...koepfe]
    if (rumpf) alle.push(['Content-Length', String(Buffer.byteLength(rumpf))])
    alle.push(['Connection', 'close'])
    s.setTimeout(8000)
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
      fertig({
        status: Number(/^HTTP\/1\.[01] (\d+)/.exec(text)?.[1] ?? 0),
        kopf: trenn < 0 ? text : text.slice(0, trenn),
        rumpf: trenn < 0 ? '' : text.slice(trenn + 4),
      })
    })
  })
}

/* ══ 4. DER BROWSER ═══════════════════════════════════════════════════════
 *
 * WOZU, wenn die Sockets doch alles messen: weil der Browser `Host` aus der
 * ADRESSZEILE setzt, `Origin` und `Sec-Fetch-*` selbst anhaengt — und weil nur
 * er zeigt, was ein MENSCH am Ende sieht. Genau darum geht es hier.
 */

/**
 * `--host-resolver-rules` ist der Kern von Ring C: damit loest JEDER Name auf
 * 127.0.0.1 auf — genau die Lage, die der Angreifer herstellt und die auch der
 * Heimrouter herstellt, wenn er der Box einen eigenen Namen gibt. Es aendert
 * NICHTS an diesem Rechner (kein /etc/hosts), nur an diesem einen Browser.
 *
 * Suche, freier Debug-Port, Wegwerf-Profil und Aufraeumen kommen aus
 * tools/leihgabe.mjs; `null` heisst: kein Browser auf diesem Rechner.
 */
async function browserOeffnen() {
  const brw = await eigenerBrowser({
    fenster: '1024,768',
    zusatz: ['--host-resolver-rules=MAP * 127.0.0.1'],
  })
  if (!brw) return null
  // Gebraucht wird die Fernsteuerung des BROWSERS (Target.createTarget unten),
  // nicht die einer Seite — also /json/version auf dem Port des eigenen.
  const ziel = (await (await fetch(`http://127.0.0.1:${brw.port}/json/version`)).json()).webSocketDebuggerUrl
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
    } else for (const h of horcher) if (n.method) h(n)
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
 * Eine Seite oeffnen, mitschreiben was sie ueber das Netz tut — UND ABLESEN,
 * WAS SICHTBAR DASTEHT. Das Letzte ist der eigentliche Messwert dieses
 * Werkzeugs: `document.body.innerText` ist das, was ein Mensch liest.
 */
async function seiteMessen(b, url, wartenMs = 3500, klicks = []) {
  const { result: t } = await b.ruf('Target.createTarget', { url: 'about:blank' })
  const { result: s } = await b.ruf('Target.attachToTarget', { targetId: t.targetId, flatten: true })
  const sid = s.sessionId
  const anfragen = []
  b.horchen((n) => {
    if (n.sessionId !== sid) return
    if (n.method === 'Network.responseReceived')
      anfragen.push({ url: n.params.response.url, status: n.params.response.status })
    if (n.method === 'Network.loadingFailed')
      anfragen.push({ url: '(abgebrochen)', status: 0, grund: n.params.errorText })
  })
  await b.ruf('Network.enable', {}, sid)
  await b.ruf('Page.enable', {}, sid)
  await b.ruf('Runtime.enable', {}, sid)
  await b.ruf('Page.navigate', { url }, sid)
  await new Promise((r) => setTimeout(r, wartenMs))
  for (const k of klicks) {
    await b.ruf('Runtime.evaluate', { expression: k, returnByValue: true, awaitPromise: true }, sid)
    await new Promise((r) => setTimeout(r, 900))
  }
  const lies = async (ausdruck) => {
    const a = await b.ruf('Runtime.evaluate', { expression: ausdruck, returnByValue: true, awaitPromise: true }, sid)
    return a.result?.result?.value ?? null
  }
  const sichtbar = await lies('document.body ? document.body.innerText : ""')
  const titel = await lies('document.title')
  await b.ruf('Target.closeTarget', { targetId: t.targetId })
  return { anfragen, sichtbar: String(sichtbar ?? ''), titel: String(titel ?? '') }
}

/* ══ 5. LOSLEGEN ══════════════════════════════════════════════════════════ */

const platz = arbeitsplatz()
const lautstaerke = () => {
  try {
    return String(JSON.parse(readFileSync(platz.konfigDatei, 'utf8'))?.mupibox?.startVolume ?? '')
  } catch {
    return '(unlesbar)'
  }
}

console.log('\n════ DER AUSGESPERRTE MENSCH — WAS STEHT WIRKLICH AUF SEINEM SCHIRM? ════')
console.log(`  Rechner: ${RECHNERNAME}   Marke: ${MARKE}   LAN: ${LAN ?? '(keine)'}`)
console.log(`  Port ${PORT} · Arbeitsplatz ${platz.ordner}`)
console.log(
  `  Verwaltung: ${platz.adminDa ? 'da' : 'FEHLT'} · Box-Oberflaeche: ${platz.boxDa ? 'da' : 'FEHLT'} · /neu/: ${platz.neuDa ? 'da' : 'FEHLT'}`,
)

const gebaut = buendeln(platz.ordner)
const laeuft = []
const zumachen = () => {
  for (const s of laeuft) s.kind.kill('SIGKILL')
  if (!BEHALTEN) rmSync(platz.ordner, { recursive: true, force: true })
  else console.log(`\n(Arbeitsplatz behalten: ${platz.ordner})`)
}
process.on('exit', zumachen)

const haupt = await serverStarten(platz, gebaut, PORT)
laeuft.push(haupt)

/* ── RING A — DIE ECHTEN NAMEN ────────────────────────────────────────── */

console.log('\n── RING A — jeder echte Weg, lesend UND schreibend UND als Vorabfrage ──')
console.log('  Faellt hier eine Zeile, ist der Besitzer ausgesperrt. Das ist der')
console.log('  teuerste Fehler, den dieser Riegel machen kann.')

const echteWege = [
  ['localhost (der Kiosk auf der Box)', 'localhost'],
  ['localhost mit Port', `localhost:${PORT}`],
  ['127.0.0.1 (Werkzeuge auf der Box)', '127.0.0.1'],
  ['::1 in Klammern', '[::1]'],
  ...(LAN ? [[`LAN-Adresse ${LAN} (zweiter Rechner)`, `${LAN}:${PORT}`]] : []),
  [`Rechnername ${MARKE}`, MARKE],
  [`${MARKE}.local (mDNS)`, `${MARKE}.local`],
  [`${MARKE}.local. (Punkt am Ende)`, `${MARKE}.local.`],
  [`${MARKE}.fritz.box (Heimrouter)`, `${MARKE}.fritz.box`],
  [`${MARKE}.lan`, `${MARKE}.lan`],
  [`${MARKE}.home.arpa`, `${MARKE}.home.arpa`],
  [`Konfigname ${KONFIG_NAME}`, KONFIG_NAME],
  [`${KONFIG_NAME}.local`, `${KONFIG_NAME}.local`],
  [`${MARKE.toUpperCase()} (gross geschrieben)`, MARKE.toUpperCase()],
]

for (const [was, host] of echteWege) {
  const lesen = await rohAnfrage({ zeile: 'GET /api/konfiguration HTTP/1.1', koepfe: [['Host', host]] })
  const vorher = lautstaerke()
  const neu = vorher === '57' ? '58' : '57'
  const schreiben = await rohAnfrage({
    zeile: 'POST /api/konfiguration HTTP/1.1',
    koepfe: [
      ['Host', host],
      ['Content-Type', 'application/json'],
      ['Origin', `http://${host}`],
    ],
    rumpf: JSON.stringify({ aenderungen: { startLautstaerke: neu } }),
  })
  const nachher = lautstaerke()
  const vorab = await rohAnfrage({
    zeile: 'OPTIONS /api/konfiguration HTTP/1.1',
    koepfe: [
      ['Host', host],
      ['Origin', `http://${host}`],
      ['Access-Control-Request-Method', 'POST'],
    ],
  })
  const ok = lesen.status === 200 && schreiben.status < 400 && nachher === neu && vorab.status < 400
  pruefe(
    `${was}`,
    ok,
    `lesen ${lesen.status} · schreiben ${schreiben.status} (Datei ${vorher}→${nachher}) · OPTIONS ${vorab.status}`,
  )
}

// Die Gegenprobe zu Ring A: ein wirklich fremder Name MUSS abprallen, sonst
// misst dieser Ring nur, dass der Riegel gar nichts tut.
{
  const vorher = lautstaerke()
  const a = await rohAnfrage({
    zeile: 'POST /api/konfiguration HTTP/1.1',
    koepfe: [
      ['Host', 'boese.example'],
      ['Content-Type', 'application/json'],
      ['Origin', 'http://boese.example'],
    ],
    rumpf: JSON.stringify({ aenderungen: { startLautstaerke: '99' } }),
  })
  pruefe(
    'GEGENPROBE: boese.example prallt ab',
    a.status === 403 && lautstaerke() === vorher,
    `${a.status}, Datei ${lautstaerke()}`,
  )
}

/* ── RING B/C — DER BROWSER ───────────────────────────────────────────── */

const b = await browserOeffnen()
if (!b) {
  console.log('\n── RING B und C uebersprungen: kein Chromium gefunden (MUPIBOX_BROWSER setzen) ──')
  fehler++
} else {
  try {
    console.log('\n── RING B — die BOX-OBERFLAECHE unter einem gueltigen Namen ──')
    console.log('  Das ist, was ein KIND sieht. Faellt EINE Anfrage, sieht es eine halb')
    console.log(`  geladene Box. Aufgerufen unter „${MARKE}.fritz.box" — NICHT unter`)
    console.log('  127.0.0.1, denn genau der Unterschied ist der Messwert.')

    for (const [was, weg] of [
      ['die Box-Oberflaeche /', '/'],
      ['die neue Oberflaeche /neu/', '/neu/'],
      ['die Verwaltung /admin', '/admin/'],
    ]) {
      const r = await seiteMessen(b, `http://${MARKE}.fritz.box:${PORT}${weg}`, 4500)
      const api = r.anfragen.filter((a) => /\/api\//.test(a.url))
      const verboten = r.anfragen.filter((a) => a.status === 403)
      pruefe(
        `${was}: ${r.anfragen.length} Anfragen, davon ${api.length} an /api — 0 × 403`,
        verboten.length === 0,
        verboten.length
          ? verboten
              .map((v) => v.url)
              .slice(0, 3)
              .join(' ')
          : '',
      )
    }

    console.log('\n── RING C — DER AUSGESPERRTE MENSCH ──')
    console.log('  Ein Name, den die Box nicht kennt (ein Router, den niemand vorhergesehen')
    console.log('  hat). Gemessen wird NICHT die Statuszahl, sondern was SICHTBAR dasteht:')
    console.log('  bekommt der Mensch den Ausweg zu lesen — oder eine stumme kaputte Seite?')

    for (const [was, weg] of [
      ['die Box-Oberflaeche /', '/'],
      ['die neue Oberflaeche /neu/', '/neu/'],
      ['die Verwaltung /admin', '/admin/'],
    ]) {
      const r = await seiteMessen(b, `http://mupibox.unbekannt-vom-router.example:${PORT}${weg}`, 4500)
      const verboten = r.anfragen.filter((a) => a.status === 403)
      const seite = r.anfragen.find((a) => a.status === 200)
      const text = r.sichtbar.replace(/\s+/g, ' ').trim()
      // DIE FRAGE, AN DER ALLES HAENGT: steht der Ausweg auf dem Schirm?
      const nenntAusweg = /hostZusatz|erreichen Sie sie jetzt/i.test(r.sichtbar)
      const nenntNamen = /kennt sich unter dem Namen/i.test(r.sichtbar)
      merke(`${was}: Seite ausgeliefert = ${seite ? 'JA' : 'nein'}, ${verboten.length} × 403 nachgeladen`)
      merke(`   sichtbar (${text.length} Zeichen): „${text.slice(0, 150)}${text.length > 150 ? '…' : ''}"`)
      pruefe(`${was}: der ausgesperrte Mensch LIEST den Ausweg`, nenntAusweg && nenntNamen)
    }

    // ── DIE GEGENPROBE ZUM SEITENRIEGEL ────────────────────────────────
    // Er darf NUR bei einer echten Seitenanfrage antworten. Ein Bild, ein
    // Stilblatt, ein `fetch` muessen unberuehrt bleiben — sonst hat die
    // Erklaerung mehr zerlegt, als sie erklaert.
    {
      const fremd = 'mupibox.unbekannt-vom-router.example'
      const seite = await rohAnfrage({
        zeile: 'GET / HTTP/1.1',
        koepfe: [
          ['Host', fremd],
          ['Accept', 'text/html,application/xhtml+xml'],
        ],
      })
      pruefe(
        'Seitenanfrage unter fremdem Namen bekommt die Erklaerung als HTML',
        seite.status === 403 && /kennt sich unter dem Namen/.test(seite.rumpf) && /text\/html/.test(seite.kopf),
        `${seite.status}`,
      )
      const bild = await rohAnfrage({
        zeile: 'GET /neu/app.css HTTP/1.1',
        koepfe: [
          ['Host', fremd],
          ['Accept', 'text/css,*/*;q=0.1'],
        ],
      })
      pruefe('ein Stilblatt bleibt unberuehrt (kein HTML an seiner Stelle)', bild.status !== 403, `${bild.status}`)
      const eigen = await rohAnfrage({
        zeile: 'GET / HTTP/1.1',
        koepfe: [
          ['Host', `${MARKE}.fritz.box`],
          ['Accept', 'text/html'],
        ],
      })
      pruefe('unter einem EIGENEN Namen kommt die Seite wie bisher', eigen.status === 200, `${eigen.status}`)
      // ── DER GERUFENE NAME LANDET IN DER SEITE, UND ER IST FREMD ──────
      // Gemessen (scratchpad/fuzz.mjs, Zeichen 1..0x2100): `new URL` wirft bei
      // `<` und `>`, laesst aber `"`, `'` und `&` DURCH BIS IN `.hostname`.
      // Die Maskierung in `fremderNameSeite` ist also nicht Zierat — ohne sie
      // truege die Erklaerungsseite fremden Text mit Anfuehrungszeichen.
      const mitAnfuehrung = await rohAnfrage({
        zeile: 'GET / HTTP/1.1',
        koepfe: [
          ['Host', 'a"b.example'],
          ['Accept', 'text/html'],
        ],
      })
      pruefe(
        'ein Name mit " kommt MASKIERT in der Seite an',
        mitAnfuehrung.status === 403 &&
          mitAnfuehrung.rumpf.includes('a&quot;b.example') &&
          !mitAnfuehrung.rumpf.includes('a"b.example'),
      )
      // Und der Fall, den `new URL` gar nicht erst durchlaesst: kein `Host`,
      // den man lesen koennte → nicht raten, durchlassen (wie im Riegel oben).
      const spitz = await rohAnfrage({
        zeile: 'GET / HTTP/1.1',
        koepfe: [
          ['Host', 'a<script>x.example'],
          ['Accept', 'text/html'],
        ],
      })
      pruefe(
        'ein unlesbarer Host wird nicht geraten (Seite wie bisher)',
        spitz.status === 200 && !/<script>x\.example/.test(spitz.rumpf),
        `${spitz.status}`,
      )
    }

    // Und der Beweis, dass der Satz ueberhaupt existiert — er steht im Rumpf,
    // den die Oberflaeche bekommt. Wenn Ring C oben rot ist und diese Zeile
    // gruen, dann ist der Satz da und wird nur nicht angezeigt.
    const roh = await rohAnfrage({
      zeile: 'GET /api/konfiguration HTTP/1.1',
      koepfe: [['Host', 'mupibox.unbekannt-vom-router.example']],
    })
    let satz = ''
    try {
      satz = JSON.parse(roh.rumpf)?.fehler ?? ''
    } catch {
      /* kein JSON */
    }
    console.log('\n  Der Satz, der im Rumpf STEHT (403 auf /api/konfiguration):')
    for (const zeile of String(satz).split('  ')) if (zeile.trim()) console.log(`      ${zeile.trim()}`)
    pruefe('der Satz nennt eine Adresse, die wirklich traegt', /http:\/\//.test(satz))
  } finally {
    await b.zu()
  }
}

/* ── RING D — WENN DIE ABLEITUNG SELBST SCHEITERT ─────────────────────── */

console.log('\n── RING D — die Ableitung der eigenen Namen scheitert ──')
console.log('  Wenn die Box nicht mehr weiss, wie sie heisst: faellt der Riegel AUF')
console.log('  oder ZU? Zu waere die Sackgasse, gegen die die ganze Datei geschrieben ist.')

// D1: keine lesbare Konfiguration. Der Rechnername bleibt — die Box sollte
//     unter ihm und unter den Adressen weiter erreichbar sein.
{
  const kaputt = join(platz.ordner, 'gibt-es-nicht.json')
  const s = await serverStarten(platz, gebaut, PORT + 2, { MUPIBOX_CONFIG: kaputt })
  laeuft.push(s)
  const wege = [
    ['localhost', 'localhost'],
    ['127.0.0.1', '127.0.0.1'],
    ...(LAN ? [[`LAN ${LAN}`, LAN]] : []),
    [`Rechnername ${MARKE}`, MARKE],
    [`${MARKE}.fritz.box`, `${MARKE}.fritz.box`],
  ]
  for (const [was, host] of wege) {
    const a = await rohAnfrage({ zeile: 'GET /api/auth/state HTTP/1.1', koepfe: [['Host', host]], port: PORT + 2 })
    pruefe(`ohne Konfiguration: ${was} kommt durch`, a.status === 200, `${a.status}`)
  }
  const f = await rohAnfrage({
    zeile: 'GET /api/auth/state HTTP/1.1',
    koepfe: [['Host', 'boese.example']],
    port: PORT + 2,
  })
  pruefe('ohne Konfiguration: boese.example prallt weiter ab', f.status === 403, `${f.status}`)
}

console.log(`\n════ ${fehler === 0 ? 'keine Zeile rot' : `${fehler} Zeile(n) ROT`} ════\n`)
process.exit(fehler === 0 ? 0 : 1)
