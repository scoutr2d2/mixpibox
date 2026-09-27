#!/usr/bin/env node
/**
 * WAS SIEHT EIN AUSGESPERRTER MENSCH WIRKLICH AUF DEM SCHIRM?
 *
 * ══ DIE FRAGE ═════════════════════════════════════════════════════════════
 * `eigene-namen.ts` baut einen sorgfaeltigen Satz fuer den Fall, dass die Box
 * unter einem Namen gerufen wird, den sie nicht kennt: er nennt den gerufenen
 * Namen, die Adressen, unter denen es JETZT geht (als fertige Links), und den
 * Eintrag `hostZusatz`, mit dem sich der Name dauerhaft erlauben laesst. Der
 * Satz ist ausdruecklich „der Unterschied zwischen Aergernis und Sackgasse".
 *
 * ER STEHT IM RUMPF EINER 403-ANTWORT AUF `/api`. Gemessen wurde bisher, dass
 * er DA IST — mit einem Socket, der den Rumpf ausdruckt. Nicht gemessen wurde,
 * ob ihn jemand ZU SEHEN BEKOMMT: die Verwaltung liegt unter `/admin` und
 * steht NICHT hinter dem Riegel. Sie laedt also, und erst ihre Aufrufe an
 * `/api` fallen. Was dann auf dem Schirm steht, entscheidet alles.
 *
 * ══ WIE GEMESSEN WIRD ═════════════════════════════════════════════════════
 * Ein echter Chromium, dessen Namensaufloesung umgebogen wird
 * (`--host-resolver-rules`), ruft die Verwaltung unter einem Namen auf, den
 * die Box nicht kennt — genau die Lage des Besitzers, dessen Router die Box
 * `mupibox.speedport.home` nennt. Danach wird der sichtbare TEXT der Seite
 * ausgelesen und darin gesucht:
 *
 *   1. steht der gerufene Name da?
 *   2. steht eine Adresse da, unter der es ginge?
 *   3. steht `hostZusatz` da?
 *
 * ZUM VERGLEICH derselbe Aufruf unter einem Namen, den die Box KENNT.
 *
 * ══ AUFRUF ════════════════════════════════════════════════════════════════
 *     node tools/ausgesperrt-am-schirm.mjs [--port 9681]
 *
 * NUR AUF DIESEM RECHNER. Nichts wird ausgeliefert, die Box nicht angefasst.
 */
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserSuchen, eigenerBrowser } from './leihgabe.mjs'

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND = join(WURZEL, 'src', 'backend-api')
const argv = process.argv.slice(2)
const opt = (n, v) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : v
}

async function portFrei(p) {
  return await new Promise((f) => {
    const s = net.createServer()
    s.once('error', () => f(false))
    s.once('listening', () => s.close(() => f(true)))
    s.listen(p, '0.0.0.0')
  })
}
let PORT = Number(opt('port', '9681'))
// ZWEI: der Server und seine TLS-Seite. `MUPIBOX_HTTPS_PORT=0` hilft nicht.
while (!((await portFrei(PORT)) && (await portFrei(PORT + 2)))) PORT++

// Browser GELIEHEN ueber eigenerBrowser() (tools/leihgabe.mjs); die Suche
// dort ehrt MUPIBOX_BROWSER. Frueh gefragt, damit der Lauf nicht erst den
// ganzen Arbeitsplatz baut und dann am fehlenden Browser scheitert.
if (!browserSuchen()) {
  console.error('Kein Chromium gefunden — MUPIBOX_BROWSER setzen.')
  process.exit(2)
}

/* ══ Arbeitsplatz ═════════════════════════════════════════════════════════ */

const ordner = mkdtempSync(join(tmpdir(), 'mupi-ausgesperrt-'))
mkdirSync(join(ordner, 'server', 'config'), { recursive: true })
mkdirSync(join(ordner, 'tls'), { recursive: true })
const konfigDatei = join(ordner, 'server', 'config', 'mupiboxconfig.json')
writeFileSync(
  konfigDatei,
  JSON.stringify(
    {
      mupibox: { host: 'MixPiBox', startVolume: '41', maxVolume: '100', audioDevice: 'default' },
      interfacelogin: { state: false, password: '' },
      timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
    },
    null,
    2,
  ),
)
const adminQuelle = [join(WURZEL, 'src/deploy/www-admin'), join(WURZEL, 'src/frontend-admin/www-admin')].find(existsSync)
if (!adminQuelle) {
  console.error('Keine gebaute Verwaltung gefunden — ohne sie misst dieses Werkzeug nichts.')
  process.exit(2)
}
cpSync(adminQuelle, join(ordner, 'www-admin'), { recursive: true })

const esbuild = [join(BACKEND, 'node_modules/.bin/esbuild'), join(WURZEL, 'node_modules/.bin/esbuild')].find(existsSync)
const gebaut = join(ordner, 'server.js')
console.log('Buendeln …')
const bau = spawnSync(
  esbuild,
  [join(BACKEND, 'src', 'server.ts'), '--bundle', '--platform=node', '--target=node26', `--outfile=${gebaut}`],
  { encoding: 'utf8' },
)
if (bau.status !== 0) {
  console.error(bau.stderr)
  process.exit(2)
}

const umgebung = { ...process.env }
delete umgebung.NODE_ENV
delete umgebung.MUPIBOX_HERKUNFT_AUS
delete umgebung.MUPIBOX_HERKUNFT_ZUSATZ
delete umgebung.MUPIBOX_HOST_ZUSATZ
Object.assign(umgebung, {
  MUPIBOX_HTTP_PORT: String(PORT),
  MUPIBOX_HTTPS_PORT: String(PORT + 2),
  MUPIBOX_TLS_DIR: join(ordner, 'tls'),
  MUPIBOX_CONFIG: konfigDatei,
  MUPIBOX_LOCK_DIR: ordner,
  MUPIBOX_ADMIN_DIR: join(ordner, 'www-admin'),
  MUPIBOX_SICHERUNG_STAENDE: join(ordner, 'staende'),
})
const kind = spawn(process.execPath, [gebaut], { cwd: ordner, env: umgebung, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
kind.stdout.on('data', (d) => {
  log += d
})
kind.stderr.on('data', (d) => {
  log += d
})

function hole(weg, host) {
  return new Promise((f, s) => {
    const c = net.connect(PORT, '127.0.0.1')
    let t = ''
    c.setTimeout(8000)
    c.on('connect', () => c.write(`GET ${weg} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`))
    c.on('data', (d) => {
      t += d
    })
    c.on('timeout', () => {
      c.destroy()
      s(new Error('Zeit'))
    })
    c.on('error', s)
    c.on('close', () => f(t))
  })
}
let oben = false
for (let i = 0; i < 240 && !oben; i++) {
  try {
    const t = await hole('/api/auth/state', `127.0.0.1:${PORT}`)
    // NICHT „200" — nur diese Form kommt von DIESEM Backend.
    oben = t.includes('anmeldungNoetig')
  } catch {
    /* noch nicht */
  }
  if (!oben) await new Promise((r) => setTimeout(r, 150))
}
if (!oben) {
  kind.kill('SIGKILL')
  console.error(`auf ${PORT} antwortet nicht dieses Backend:\n${log}`)
  process.exit(2)
}
console.log(`Server auf 127.0.0.1:${PORT}, Verwaltung aus ${adminQuelle}\n`)

/* ══ Der Rumpf der Ablehnung — was DRIN steht ═════════════════════════════ */

const abgewiesen = await hole('/api/konfiguration', `mupibox.speedport.home:${PORT}`)
const drin = {
  name: abgewiesen.includes('mupibox.speedport.home'),
  adresse: /http:\/\/(127\.0\.0\.1|localhost|\d+\.\d+\.\d+\.\d+)/.test(abgewiesen.split('\r\n\r\n')[1] ?? ''),
  hostZusatz: abgewiesen.includes('hostZusatz'),
}
console.log('IM RUMPF DER 403-ANTWORT steht:')
console.log(`  gerufener Name: ${drin.name ? 'ja' : 'NEIN'}`)
console.log(`  Adresse als Link: ${drin.adresse ? 'ja' : 'NEIN'}`)
console.log(`  hostZusatz: ${drin.hostZusatz ? 'ja' : 'NEIN'}\n`)

/* ══ UND WAS DAVON AUF DEM SCHIRM ANKOMMT ═════════════════════════════════ */

/**
 * Die Verwaltung unter einem Namen aufrufen und den SICHTBAREN Text auslesen.
 *
 * `--host-resolver-rules` biegt die Namensaufloesung dieses einen Chromium um
 * — genau das, was ein Angreifer mit seiner eigenen Zone tut und was ein
 * Heimrouter fuer den Besitzer tut. Es wird nichts an diesem Rechner geaendert.
 */
/**
 * UEBER DAS DEVTOOLS-PROTOKOLL, NICHT UEBER `--dump-dom`.
 *
 * Erste Fassung dieses Werkzeugs nahm `--dump-dom`. Auf dem Chromium dieser
 * Maschine gibt das NICHTS aus — auch nicht fuer eine gewoehnliche Seite. Die
 * Messung waere „0 Zeichen sichtbar" gewesen, und zwar auch dort, wo alles in
 * Ordnung ist: eine vollstaendige rote Tafel ueber einen Browser, der gar
 * nichts gemessen hat. Deshalb wird der Text hier aus der laufenden Seite
 * geholt, und deshalb steht unten ein VERGLEICHSFALL, der gruen sein MUSS.
 */
let browserBrw = null
let browserRuf = null
let browserHorcher = []
async function browserOeffnen(namen) {
  browserBrw = await eigenerBrowser({
    fenster: '1200,900',
    zusatz: [
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--no-first-run',
      // Die Namensaufloesung DIESES einen Browsers wird umgebogen — genau das,
      // was ein Heimrouter fuer den Besitzer tut. An diesem Rechner aendert
      // sich nichts.
      `--host-resolver-rules=${namen.map((n) => `MAP ${n} 127.0.0.1`).join(', ')}`,
    ],
  })
  if (!browserBrw) throw new Error('kein Browser gefunden')
  // Dieses Werkzeug spricht mit dem BROWSER-Ziel (Target.createTarget je
  // Schirm) — deshalb json/version am geliehenen Port, nicht brw.seite().
  let ziel = null
  for (let i = 0; i < 80 && !ziel; i++) {
    try {
      ziel = (await (await fetch(`http://127.0.0.1:${browserBrw.port}/json/version`)).json()).webSocketDebuggerUrl
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  if (!ziel) throw new Error('Browser kam nicht hoch')
  const { WebSocket } = await import('ws')
  const ws = new WebSocket(ziel)
  await new Promise((r, x) => {
    ws.on('open', r)
    ws.on('error', x)
  })
  let id = 0
  const offen = new Map()
  ws.on('message', (d) => {
    const n = JSON.parse(d)
    if (n.id && offen.has(n.id)) {
      offen.get(n.id)(n)
      offen.delete(n.id)
    } else if (n.method) for (const h of browserHorcher) h(n)
  })
  browserRuf = (method, params = {}, sessionId) =>
    new Promise((r) => {
      const i = ++id
      offen.set(i, r)
      ws.send(JSON.stringify({ id: i, method, params, sessionId }))
    })
}

async function schirmtext(name, weg = '/admin') {
  const { result: t } = await browserRuf('Target.createTarget', { url: 'about:blank' })
  const { result: s } = await browserRuf('Target.attachToTarget', { targetId: t.targetId, flatten: true })
  const sid = s.sessionId
  const anfragen = []
  browserHorcher.push((n) => {
    if (n.sessionId === sid && n.method === 'Network.responseReceived')
      anfragen.push({ url: n.params.response.url, status: n.params.response.status })
  })
  await browserRuf('Network.enable', {}, sid)
  await browserRuf('Page.enable', {}, sid)
  await browserRuf('Runtime.enable', {}, sid)
  await browserRuf('Page.navigate', { url: `http://${name}:${PORT}${weg}` }, sid)
  // Angular braucht einen Moment, und die Aufrufe an /api kommen erst danach.
  await new Promise((r) => setTimeout(r, 6000))
  const a = await browserRuf(
    'Runtime.evaluate',
    { expression: 'document.body ? document.body.innerText : ""', returnByValue: true },
    sid,
  )
  const text = String(a.result?.result?.value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  await browserRuf('Target.closeTarget', { targetId: t.targetId })
  return { text, anfragen }
}

let rot = 0
const merkeZeile = (satz) => console.log(`  ····  ${satz}`)
const pruefe = (satz, ok, dazu = '') => {
  console.log(`  ${ok ? 'ok  ' : 'NEIN'} ${satz}${dazu ? `  — ${dazu}` : ''}`)
  if (!ok) rot++
}

await browserOeffnen(['mupibox.speedport.home'])

/* ══ ZUERST DER VERGLEICHSFALL ════════════════════════════════════════════
 *
 * ER MUSS GRUEN SEIN, sonst misst der Rest nichts. Ein Browser, der auch unter
 * einem bekannten Namen nichts anzeigt, wuerde jede Frage unten mit „nein"
 * beantworten — und das saehe aus wie ein Befund. */
console.log('VERGLEICHSFALL: die Verwaltung unter einem Namen, den die Box KENNT\n')
const gut = await schirmtext('localhost')
console.log(`  sichtbarer Text (${gut.text.length} Zeichen):`)
console.log(`  „${gut.text.slice(0, 300)}${gut.text.length > 300 ? ' …' : ''}"\n`)
pruefe('unter einem bekannten Namen zeigt die Verwaltung wirklich etwas an', gut.text.length > 40)
pruefe(
  '… und ihre Aufrufe an /api kommen durch',
  gut.anfragen.some((a) => a.url.includes('/api/') && a.status === 200),
  `${gut.anfragen.filter((a) => a.url.includes('/api/')).length} Aufrufe an /api, davon ${
    gut.anfragen.filter((a) => a.url.includes('/api/') && a.status === 403).length
  } × 403`,
)

console.log('\nDER FALL: die Verwaltung unter einem Namen, den die Box NICHT kennt')
console.log('  (mupibox.speedport.home — so nennt ein Telekom-Router die Box)\n')
const aus = await schirmtext('mupibox.speedport.home')
console.log(`  sichtbarer Text (${aus.text.length} Zeichen):`)
console.log(`  „${aus.text.slice(0, 600)}${aus.text.length > 600 ? ' …' : ''}"\n`)
console.log(
  `  Aufrufe an /api: ${aus.anfragen.filter((a) => a.url.includes('/api/')).length}, davon ${
    aus.anfragen.filter((a) => a.url.includes('/api/') && a.status === 403).length
  } × 403\n`,
)
pruefe('die Seite laedt ueberhaupt (sie liegt nicht hinter dem Riegel)', aus.text.length > 0)
pruefe('auf dem SCHIRM steht der gerufene Name', aus.text.includes('mupibox.speedport.home'))
pruefe('auf dem SCHIRM steht eine Adresse, unter der es ginge', /127\.0\.0\.1|localhost/.test(aus.text))
pruefe('auf dem SCHIRM steht das Wort hostZusatz', aus.text.includes('hostZusatz'))

/* ══ UND WER LIEST DIESEN SATZ SONST NOCH? ════════════════════════════════
 *
 * DIE ABLEHNUNG NENNT DIE ADRESSEN DIESER BOX — als Ausweg fuer den
 * Ausgesperrten, und das ist gut so. Aber ausgesperrt wird auch der
 * ANGREIFER, und zwar mit derselben Seite.
 *
 * DIE FRAGE IST, OB ER SIE LESEN KANN. Beim Namenstausch laesst er seinen
 * eigenen Namen AUF DIESEM PORT auf die Box zeigen. Seine Seite liegt dann
 * unter `http://boese.example:<port>` — und die Antwort der Box kommt unter
 * DEMSELBEN Namen und DEMSELBEN Port heraus. Fuer den Browser ist das
 * gleichherkuenftig; CORS wird gar nicht erst gefragt, und `Access-Control-
 * Allow-Origin` zu entfernen aendert daran nichts.
 *
 * GEMESSEN WIRD GENAU DAS: eine Seite unter dem fremden Namen holt sich
 * `/api/konfiguration` und versucht, den RUMPF zu lesen. Was dabei
 * herauskommt, hat der Angreifer.
 */
console.log('\nWAS DER ANGREIFER AUS DER ABLEHNUNG HERAUSLIEST\n')
const { result: t2 } = await browserRuf('Target.createTarget', { url: 'about:blank' })
const { result: s2 } = await browserRuf('Target.attachToTarget', { targetId: t2.targetId, flatten: true })
await browserRuf('Page.enable', {}, s2.sessionId)
await browserRuf('Runtime.enable', {}, s2.sessionId)
// Die Seite liegt unter dem FREMDEN Namen auf DEMSELBEN Port — das ist die
// Lage nach dem Namenstausch, und sie ist gleichherkuenftig.
await browserRuf('Page.navigate', { url: `http://mupibox.speedport.home:${PORT}/` }, s2.sessionId)
await new Promise((r) => setTimeout(r, 2500))
const beute = await browserRuf(
  'Runtime.evaluate',
  {
    expression: `fetch('/api/konfiguration').then(r => r.text()).then(t => 'STATUS-LESBAR: ' + t.slice(0, 700)).catch(e => 'NICHT LESBAR: ' + e)`,
    returnByValue: true,
    awaitPromise: true,
  },
  s2.sessionId,
)
const gelesen = String(beute.result?.result?.value ?? '')
console.log(`  „${gelesen.slice(0, 700)}"\n`)
const konnteLesen = gelesen.startsWith('STATUS-LESBAR')

/**
 * WAS HIER GEPRUEFT WIRD — UND WAS ABSICHTLICH NICHT.
 *
 * Dass der Angreifer den Rumpf LESEN kann, ist nicht zu verhindern: seine
 * Seite ist gleichherkuenftig, CORS wird nicht gefragt. Und dass darin
 * Adressen stehen, ist der SINN der Seite — ohne sie steht der ausgesperrte
 * Besitzer in der Sackgasse, und das ist der teurere Fehler.
 *
 * DIE GRENZE LIEGT WOANDERS, und nur sie wird hier gemessen: eine Adresse, die
 * WELTWEIT anwaehlbar ist, darf nicht dabei sein. Alles Uebrige gilt nur im
 * Haus — wer es hat, muss weiter ein fremdes Fenster im selben Netz
 * fernsteuern. Eine globale IPv6-Adresse dagegen macht daraus einen
 * dauerhaften Weg von aussen, gegen eine API, die in der Vorlage ohne
 * Anmeldung dasteht.
 *
 * Eine Pruefung „gar keine Adresse" waere dauerhaft rot und damit wertlos.
 */
const weltweit = [
  // Globales Unicast-IPv6 (2000::/3) — alles ausser fc00::/7, fe80::/10, ::1.
  /\[(2|3)[0-9a-f]{0,3}:[0-9a-f:]+\]/,
  // Oeffentliches IPv4 — die Heimnetz-Bereiche ausgenommen.
  /\b(?!10\.)(?!127\.)(?!192\.168\.)(?!169\.254\.)(?!172\.(1[6-9]|2\d|3[01])\.)(?!100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
]
const gefunden = weltweit.map((r) => r.exec(gelesen)?.[0]).filter(Boolean)
merkeZeile(`der Angreifer KANN den Rumpf lesen: ${konnteLesen ? 'ja (gleichherkuenftig, unvermeidbar)' : 'nein'}`)
pruefe(
  'aus der Ablehnung faellt KEINE weltweit anwaehlbare Adresse',
  gefunden.length === 0,
  gefunden.length ? `gefunden: ${gefunden.join(', ')}` : 'nur Adressen, die im Haus gelten',
)
await browserRuf('Target.closeTarget', { targetId: t2.targetId })

await browserBrw?.schliessen()
kind.kill('SIGKILL')
rmSync(ordner, { recursive: true, force: true })
console.log(`\n${rot} rot.`)
process.exit(rot === 0 ? 0 : 1)
