#!/usr/bin/env node
/**
 * WIE VIELE ABRUFE KOSTET DIE RUNDE INTERPRETEN-REIHE? — vorher gegen nachher.
 *
 * WOZU: Am 03.08.2026 ist NewDesign/app.js von der EIGENEN Erkennung (je Name
 * ein `GET /api/spotify/web/search`, Urteil im sessionStorage) auf den einen
 * Abruf `GET /api/interpreten` umgestellt worden. Der behauptete Gewinn war
 * „weniger Netz". Behauptet wurde er aus der ZAHL DER NAMEN (16 auf dieser
 * Box, tools/interpreten-erkennung.mjs) — gemessen an der Oberflaeche war er
 * nie. Genau das tut dieses Werkzeug: es laedt BEIDE Staende derselben Seite
 * im echten Browser gegen dieselbe Attrappe und zaehlt mit, was hinausgeht.
 *
 * ES MISST ZWEI DINGE, und das zweite ist das wichtigere:
 *   1. BIS DIE ERSTE RUNDE KACHEL STEHT — der Gewinn, um den es ging.
 *   2. DANACH, IM TAKT (`sichtbarerTakt`, TAKT_WERKE = 15 s) — denn beim Umzug
 *      einer Entscheidung vom Browser in den Server wandert sie IMMER in eine
 *      Schleife: der sessionStorage wurde einmal je Sitzung gefragt, ein
 *      Endpunkt wird alle 15 Sekunden gefragt. Wer nur (1) misst, meldet einen
 *      Gewinn und uebersieht einen Dauerverbrauch
 *      (llmwiki: erkennungskarte-merkt-ausfall-nicht-und-der-takt-haemmert).
 *
 * WAS ES AENDERT: NICHTS. Es startet eine eigene Vorschau auf einem eigenen
 * Port und einen headless-Browser, beide werden am Ende beendet. Keine Box,
 * kein Netz nach draussen, keine Datei wird geschrieben. Den ALTEN Stand holt
 * es mit `git show <commit>:NewDesign/app.js` und schiebt ihn dem Browser per
 * CDP unter (`Fetch.fulfillRequest`) — der Arbeitsbaum bleibt unberuehrt.
 *
 * WAS ES NICHT SAGT: was auf der Box selbst passiert. Die Attrappe hat vier
 * Interpretennamen, die Box hatte am 03.08.2026 sechzehn. Der Faktor
 * interessiert, nicht die absolute Zahl — deshalb steht „je Name" mit dabei.
 *
 * AUFRUF
 *     node tools/interpreten-netz-messen.mjs
 *     node tools/interpreten-netz-messen.mjs --sekunden 45
 *     node tools/interpreten-netz-messen.mjs --alt 7e02c2da^ --port 8481
 */
import { execFileSync, spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { browserSuchen, eigenerBrowser } from './leihgabe.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const wert = (name, vorgabe) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : vorgabe
}
/** Der Stand VOR der Umstellung. `7e02c2da` ist der Commit, der sie brachte. */
const ALT = wert('--alt', '7e02c2da^')
const PORT_VORSCHAU = Number(wert('--port', '8481'))
/**
 * DER DEBUG-PORT WIRD NICHT MEHR GEWAEHLT, SONDERN ERFRAGT.
 *
 * Bis 04.08.2026 stand hier fest 9481 (ueberschreibbar mit `--cdp`). Ein
 * fester Port ist doppelt gefaehrlich: Ein Browser, der einen harten Abbruch
 * ueberlebt hat, HAELT ihn; der eigene bindet ihn dann NICHT und sagt darueber
 * nichts; und `/json/list` liefert klaglos die Ziele des FREMDEN. Gemessen
 * wird danach eine Seite, die dieses Werkzeug nie geoeffnet hat.
 * `eigenerBrowser()` in tools/leihgabe.mjs holt sich einen freien Port, ein
 * eigenes Profil — und weist nach, dass der Browser hinter dem Port der eigene
 * ist. `--cdp` gibt es deshalb nicht mehr.
 */
/** Wie lange nach dem Laden noch mitgezaehlt wird — zwei Takte plus Luft. */
const BEOBACHTEN_MS = Number(wert('--sekunden', '35')) * 1000

const schlafen = (ms) => new Promise((r) => setTimeout(r, ms))

if (!browserSuchen()) {
  console.error('Kein Browser gefunden (chromium / google-chrome / playwright-Cache). Ohne ihn misst hier nichts.')
  process.exit(2)
}

/** Der alte app.js-Stand, roh aus der Geschichte. */
const ALT_QUELLE = execFileSync('git', ['show', `${ALT}:NewDesign/app.js`], {
  cwd: WURZEL,
  maxBuffer: 32 * 1024 * 1024,
}).toString('utf8')

let lfd = 0
let ws

const senden = (methode, params = {}) =>
  new Promise((ok, nein) => {
    const i = ++lfd
    ws.send(JSON.stringify({ id: i, method: methode, params }))
    const h = (roh) => {
      const x = JSON.parse(roh)
      if (x.id !== i) return
      ws.off('message', h)
      x.error ? nein(new Error(x.error.message)) : ok(x.result)
    }
    ws.on('message', h)
  })

const ev = async (ausdruck) =>
  (await senden('Runtime.evaluate', { expression: ausdruck, returnByValue: true, awaitPromise: true }))?.result?.value

/**
 * Die Schubladen, in die eine Adresse faellt.
 *
 * NUR DIE INTERPRETENFRAGE ZAEHLT HIER. `/api/werke`, `/api/status` und die
 * Bilder laufen in beiden Staenden gleich; sie mitzuzaehlen wuerde den
 * Unterschied kleinrechnen, um den es geht. Sie stehen trotzdem unter
 * `sonst`, damit man sieht, dass beide Laeufe dasselbe getan haben.
 */
function fach(url) {
  if (url.includes('/api/spotify/web/search')) return 'suche'
  if (/\/api\/interpreten(\?|$)/.test(url)) return 'interpreten'
  if (url.includes('/api/werke')) return 'werke'
  return 'sonst'
}

/**
 * Einen Stand messen.
 *
 * `alt === true` schiebt dem Browser die alte app.js unter. Der Umweg ueber
 * `Fetch.fulfillRequest` statt einer Kopie im Dateisystem ist Absicht: eine
 * zweite app.js auf der Platte wird irgendwann versehentlich bearbeitet.
 */
async function messen(alt) {
  /** Jede gezaehlte Anfrage mit ihrem Zeitversatz — erst daraus faellt der
   *  Unterschied zwischen ANLAUF und DAUERBETRIEB. Nur die Summe zu bilden
   *  waere hier die Luege: der alte Stand feuerte alles VORNE und danach nie
   *  wieder, der neue verteilt es auf den Takt. Eine gemeinsame Zahl je
   *  Minute liesse den alten Stand schlechter aussehen, als er im Betrieb
   *  war. */
  const spuren = []
  let ersteKachelMs = null

  // Bei jedem Lauf ein frischer Sitzungsspeicher — sonst misst der zweite
  // Durchgang des ALTEN Standes seinen eigenen Cache und meldet null Abrufe.
  await senden('Network.clearBrowserCache')
  await senden('Storage.clearDataForOrigin', {
    origin: `http://127.0.0.1:${PORT_VORSCHAU}`,
    storageTypes: 'local_storage,cache_storage,indexeddb,websql,service_workers',
  })
  await senden('Page.navigate', { url: 'about:blank' })
  await schlafen(200)

  await senden('Fetch.enable', { patterns: [{ urlPattern: '*/neu/app.js', requestStage: 'Request' }] })
  const aufFetch = (roh) => {
    const x = JSON.parse(roh)
    if (x.method !== 'Fetch.requestPaused') return
    if (alt) {
      void senden('Fetch.fulfillRequest', {
        requestId: x.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/javascript; charset=utf-8' }],
        body: Buffer.from(ALT_QUELLE, 'utf8').toString('base64'),
      })
    } else {
      void senden('Fetch.continueRequest', { requestId: x.params.requestId })
    }
  }
  ws.on('message', aufFetch)

  const start = Date.now()
  const aufNetz = (roh) => {
    const x = JSON.parse(roh)
    if (x.method !== 'Network.requestWillBeSent') return
    spuren.push({ fach: fach(x.params.request.url), ms: Date.now() - start })
  }
  ws.on('message', aufNetz)

  await senden('Page.navigate', { url: `http://127.0.0.1:${PORT_VORSCHAU}/neu/` })

  // Auf die ERSTE runde Kachel warten, nicht auf eine feste Zeit — sonst misst
  // man die Geschwindigkeit des Rechners statt die der Seite.
  const bis = Date.now() + 15_000
  while (Date.now() < bis) {
    if (await ev(`document.getElementById('leute-reihe')?.children.length > 0`)) {
      ersteKachelMs = Date.now() - start
      break
    }
    await schlafen(50)
  }

  await schlafen(Math.max(0, BEOBACHTEN_MS - (Date.now() - start)))
  const dauerMs = Date.now() - start

  ws.off('message', aufNetz)
  ws.off('message', aufFetch)
  await senden('Fetch.disable')

  // DIE GRENZE ZWISCHEN ANLAUF UND DAUERBETRIEB liegt bei 5 s. Nicht bei der
  // ersten Kachel: der alte Stand zeichnete nach 209 ms und schickte danach
  // noch Suchen hinterher (zwei Laeufe von `interpretenZeichnen` starten,
  // bevor der erste seinen Cache geschrieben hat). Die Grenze muss also hinter
  // dem ganzen Anlauf liegen und vor dem ersten Takt (15 s).
  const GRENZE_MS = 5000
  const zaehlen = (f, von, bis2) => spuren.filter((s) => s.fach === f && s.ms >= von && s.ms < bis2).length
  const anlauf = { suche: zaehlen('suche', 0, GRENZE_MS), interpreten: zaehlen('interpreten', 0, GRENZE_MS) }
  const dauer = {
    suche: zaehlen('suche', GRENZE_MS, Infinity),
    interpreten: zaehlen('interpreten', GRENZE_MS, Infinity),
    ms: dauerMs - GRENZE_MS,
  }
  const namen = await ev(`document.getElementById('leute-reihe')?.children.length || 0`)
  return { anlauf, dauer, ersteKachelMs, dauerMs, werke: zaehlen('werke', 0, Infinity), kacheln: namen }
}

function zeile(was, a, n) {
  const p = (v) => String(v).padStart(9)
  console.log(`  ${was.padEnd(38)}${p(a)}${p(n)}`)
}

const vorschau = spawn('node', ['tools/neu-vorschau.mjs', '--port', String(PORT_VORSCHAU)], {
  cwd: WURZEL,
  stdio: 'ignore',
})
const chrome = await eigenerBrowser()

// ERST DAS ENDE DES BROWSERS ABWARTEN, DANN das Profil loeschen — das macht
// `schliessen()`. Deshalb ist Aufraeumen hier asynchron; der SIGINT-Weg wartet
// es ab, statt den Prozess mitten im Loeschen abzuschneiden.
const aufraeumen = async () => {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await chrome.schliessen()
  vorschau.kill()
}
process.on('SIGINT', () => {
  aufraeumen().finally(() => process.exit(130))
})

try {
  const bis = Date.now() + 10_000
  for (;;) {
    try {
      await fetch(`http://127.0.0.1:${PORT_VORSCHAU}/api/werke`)
      break
    } catch {
      if (Date.now() > bis) throw new Error('tools/neu-vorschau.mjs kam nicht hoch')
      await schlafen(150)
    }
  }
  // Auf den Browser warten muss hier niemand mehr: `eigenerBrowser()` kehrt
  // erst zurueck, wenn eine Seite da ist und der Port nachweislich dem eigenen
  // Browser gehoert.
  ws = new WebSocket(await chrome.seite())
  await new Promise((r) => ws.on('open', r))
  await senden('Runtime.enable')
  await senden('Page.enable')
  await senden('Network.enable')

  console.log(`Attrappe: tools/neu-vorschau.mjs auf ${PORT_VORSCHAU}, Beobachtung ${BEOBACHTEN_MS / 1000} s je Stand`)
  const a = await messen(true)
  const n = await messen(false)

  const namen = Math.max(a.kacheln, n.kacheln, 1)
  const summe = (x) => x.suche + x.interpreten
  const jeMinute = (x, ms) => (ms > 0 ? ((summe(x) * 60000) / ms).toFixed(1) : '—')

  console.log(`\n  ${''.padEnd(38)}${'ALT'.padStart(9)}${'NEU'.padStart(9)}   (${ALT} gegen Arbeitsbaum)`)
  console.log(`  ${'-'.repeat(56)}`)
  zeile('runde Kacheln in der Reihe', a.kacheln, n.kacheln)
  zeile('ms bis zur ersten Kachel', a.ersteKachelMs ?? '—', n.ersteKachelMs ?? '—')
  console.log('  ANLAUF (die ersten 5 s, bis die Reihe steht):')
  zeile('  /api/spotify/web/search', a.anlauf.suche, n.anlauf.suche)
  zeile('  /api/interpreten', a.anlauf.interpreten, n.anlauf.interpreten)
  zeile('  zusammen', summe(a.anlauf), summe(n.anlauf))
  zeile('  je Interpretenname', (summe(a.anlauf) / namen).toFixed(2), (summe(n.anlauf) / namen).toFixed(2))
  console.log(
    `  DAUERBETRIEB (danach, ${Math.round(a.dauer.ms / 1000)} bzw. ${Math.round(n.dauer.ms / 1000)} s beobachtet):`,
  )
  zeile('  /api/spotify/web/search', a.dauer.suche, n.dauer.suche)
  zeile('  /api/interpreten', a.dauer.interpreten, n.dauer.interpreten)
  zeile('  hochgerechnet je Minute', jeMinute(a.dauer, a.dauer.ms), jeMinute(n.dauer, n.dauer.ms))
  console.log('  zur Kontrolle (muss gleich sein):')
  zeile('  /api/werke', a.werke, n.werke)
  console.log(
    '\n  LESEART: der Gewinn liegt im ANLAUF und waechst mit der Zahl der Namen\n' +
      '  (Attrappe 4, Box 16). Im DAUERBETRIEB kostet der neue Stand MEHR als der\n' +
      '  alte — der sessionStorage wurde einmal je Sitzung gefragt, ein Endpunkt\n' +
      '  wird im Takt gefragt. Was das beim Server auslöst, steht im llmwiki unter\n' +
      '  [erkennungskarte-merkt-ausfall-nicht-und-der-takt-haemmert].',
  )
} finally {
  await aufraeumen()
}
