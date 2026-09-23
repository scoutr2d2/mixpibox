#!/usr/bin/env node
/**
 * FINGER-PROBE — die Oberflaeche mit ECHTEN BERUEHRUNGEN treiben,
 * nicht mit der Maus.
 *
 * ══ WARUM ES DIESES WERKZEUG GIBT ══════════════════════════════════════════
 *
 * Am Morgen des 06.08.2026 meldete der Betreiber vom Geraet: „es öffnet
 * einfach den alten bereich". Gemeint war das Zahnrad `#einst-knopf`, das
 * ZWEI Gesten trug — kurz tippen ging in die klassische Oberflaeche, 700 ms
 * Halten oeffnete den neuen Eltern-Bereich.
 *
 * DAS ZAHNRAD IST AM ABEND DESSELBEN TAGES ERSATZLOS ENTFALLEN. Der Einstieg
 * ist der Schriftzug `#wappen` unten links, gehalten, mit einem Ring, der die
 * Frist sichtbar macht (`elternEinstieg` in NewDesign/app.js). Die Vorgabe
 * dieses Werkzeugs ist deshalb `#wappen`; die 800 ms, ab denen ein Griff
 * zuverlaessig haelt, sind mit GENAU DIESEM Werkzeug gemessen worden und
 * stehen als Begruendung hinter WAPPEN_HALTEN_MS = 1200.
 *
 * JEDES Messwerkzeug dieses Baumes hat diese Geste bis dahin mit
 * `Input.dispatchMouseEvent` getrieben — auch die, die `pointerType: 'touch'`
 * mitgeben. Das ist NICHT dasselbe: der Schalter faerbt nur das erzeugte
 * PointerEvent ein. Er erzeugt keinen Touch-Punkt, keine `touch*`-Ereignisse,
 * keine Gestenerkennung von Blink, kein `touch-action`, keinen Bildlauf-Klau
 * und damit auch kein `pointercancel`. Eine ganze Fehlerklasse — alles, was
 * erst entsteht, weil ein FINGER anders ist als ein Zeiger — war damit
 * unsichtbar. Der Betreiber hat sie mit dem Finger in zwei Minuten gefunden.
 *
 * Dieses Werkzeug schickt echte Beruehrungen (`Input.dispatchTouchEvent`) in
 * einen Browser, dem vorher mit `Emulation.setTouchEmulationEnabled` gesagt
 * wurde, dass er einen Beruehrungsschirm hat. Und es schreibt mit, WAS dabei
 * wirklich ankommt — nicht, was ankommen sollte.
 *
 * ══ WAS ES MISST ═══════════════════════════════════════════════════════════
 *
 *   * die REIHENFOLGE der Ereignisse mit Zeitstempel (pointerdown, pointerup,
 *     pointercancel, pointerleave, pointerout, touchstart/-move/-end/-cancel,
 *     click, contextmenu, dblclick) — je Ereignis auch, ob es abbrechbar war
 *     und welchen Zeigertyp es traegt;
 *   * die WIRKUNG: ging der neue Eltern-Bereich auf, oder wurde ein
 *     Seitenwechsel angefordert (das waere der alte Bereich)?
 *   * die FRIST: bis zu welcher Haltedauer die Zeituhr von `elternEinstieg`
 *     ungestoert durchgelaufen waere. Das faellt aus dem Protokoll heraus und
 *     ist keine zweite Messung — der Abstand von `pointerdown` bis zum ersten
 *     Ereignis, das `aus()` ruft, IST die Frist, die dieser Griff zulaesst.
 *
 * DER MITSCHRIEB LAEUFT UEBER `Runtime.addBinding`, nicht ueber ein Feld am
 * `window`. Das ist der Unterschied zwischen einer Messung und einer Hoffnung:
 * die Geste kann in einem VOLLEN SEITENWECHSEL enden (`window.location.href`),
 * und der loescht jedes Feld am `window` — samt Protokoll, und zwar genau in
 * dem Fall, den man untersuchen will. Ueber die Bindung ist jedes Ereignis
 * schon draussen, bevor die Seite geht.
 *
 * ══ WAS ES NICHT KANN — gemessen, nicht vermutet ═══════════════════════════
 *
 * DAS LANGDRUCK-MENUE DES BROWSERS IST HIER NICHT MESSBAR. `contextmenu` kam
 * bei 1600 ms Halten nicht — aber auch nicht bei der GEGENPROBE auf einem
 * eigens eingesetzten Streifen mit auswaehlbarem Text und `touch-action:
 * auto`, wo ein Browser es am ehesten zeigt. Auch `selectstart` blieb aus.
 * `Input.dispatchTouchEvent` geht in den Renderer; das Langdruck-Menue
 * entscheidet der Browser-Prozess, und der ist an dieser Messung nicht
 * beteiligt. „Kein contextmenu" heisst hier also NICHT MESSBAR und nicht
 * „kommt nicht" — wer das braucht, misst es am Geraet.
 *
 * ZWEITENS ist der Messbrowser nicht der der Box (gemessen: Chrome for
 * Testing 148 hier, Chromium 150 auf .169). Die Gestenerkennung von Blink hat
 * sich zwischen den beiden nicht geaendert, aber behauptet ist das nicht.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *
 *   node tools/finger-probe.mjs                        alle Griffe, Port 8801
 *   node tools/finger-probe.mjs --port 8801            eigene Vorschau dort
 *   node tools/finger-probe.mjs http://127.0.0.1:8801/neu/   geliehene
 *   node tools/finger-probe.mjs --nur halten-ruhig     ein einzelner Griff
 *   node tools/finger-probe.mjs --liste                welche Griffe es gibt
 *   node tools/finger-probe.mjs --ziel "#bt-knopf"     ein anderes Ziel
 *   node tools/finger-probe.mjs --lage sperre-aus      Sperre vorher stellen
 *   node tools/finger-probe.mjs --lage sperre-fehlt --loesen   der Fall der
 *                                                      Box .169: das Tor mit
 *                                                      dem Finger loesen und
 *                                                      sehen, WO man landet
 *   node tools/finger-probe.mjs --json                 maschinenlesbar
 *
 * ENDE 0, wenn jeder Griff das tut, was in seiner Erwartung steht.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { browserSuchen, eigenerBrowser } from './leihgabe.mjs'
import { WAPPEN_HALTEN_MS } from './admin-weg.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const hat = (n) => argv.includes(`--${n}`)

const MITGEGEBEN = argv.find((a) => a.startsWith('http')) || null
/**
 * DER EIGENE PORT IST VORGABE 8801, NICHT 8299.
 *
 * 8299 ist der Vorgabeport eines guten Dutzends Werkzeuge, und dort haelt in
 * aller Regel eine FREMDE Vorschau aus einem anderen Arbeitsbaum. Zweimal hat
 * das schon eine Messung verdorben (llmwiki `vorschau-wird-geliehen`). Wer
 * hier misst, misst gegen seine eigene.
 */
const PORT = Number(opt('port', 8801))
const NUR = typeof opt('nur', null) === 'string' ? opt('nur', null) : null
// VORGABE `#wappen`: der Einstieg ins Admin-Menue. Bis zum 06.08.2026 war es
// das Zahnrad `#einst-knopf`; es ist ersatzlos entfallen (tools/admin-weg.mjs).
const ZIEL_WAHL = typeof opt('ziel', null) === 'string' ? opt('ziel', null) : '#wappen'
const LAGE = typeof opt('lage', null) === 'string' ? opt('lage', null) : null
const JSONAUS = hat('json')
/**
 * `--loesen`: die Rechenaufgabe des Tors mit dem Finger loesen und melden, wo
 * man DANACH landet. Nur mit gesetzter Sperre sinnvoll — und dort unerlaesslich
 * (Begruendung an der Stelle, an der geloest wird).
 */
const LOESEN = hat('loesen')

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

// ═══════════════════════════════════════════════════════════════════════════
//  DIE GRIFFE
// ═══════════════════════════════════════════════════════════════════════════
//
// Jeder Griff ist EINE Bewegung eines EINZELNEN Fingers, beschrieben in
// Schritten. `schritte` sind Punkte relativ zur Mitte des Ziels, mit der Zeit
// in ms seit dem Aufsetzen. Der Griff endet mit `abheben` (touchEnd) oder
// `abbrechen` (touchCancel) — letzteres ist das, was ein Kiosk-Browser tut,
// wenn er die Beruehrung fuer sich beansprucht.
//
// WARUM MIT ZWISCHENSCHRITTEN UND NICHT MIT ZWEI EREIGNISSEN: Blink erkennt
// Gesten aus der FOLGE der Beruehrungspunkte. Ein Sprung von 0 auf 30 px in
// einem einzigen `touchMove` ist etwas anderes als ein Finger, der in zehn
// Schritten dorthin wandert — der erste sieht wie ein Messfehler aus, der
// zweite wie ein Mensch.
const GRIFFE = [
  {
    name: 'kurz-tippen',
    wort: 'kurz antippen (60 ms), kein Wackeln',
    halten: 60,
    schritte: [],
    // BIS ZUM 06.08.2026 STAND HIER `erwartet: 'alter Weg'`. Das galt fuer das
    // Zahnrad `#einst-knopf`: ein kurzer Tipp sprang nach /settings. Das
    // Zahnrad ist ersatzlos entfallen, der Einstieg `#wappen` traegt genau
    // EINE Geste — ein kurzer Tipp tut nichts. Die Erwartung ist deshalb
    // umgekehrt worden und nicht abgeschaltet.
    erwartet: 'nichts',
  },
  {
    name: 'halten-ruhig',
    wort: '800 ms halten, absolut ruhig — UNTER der Frist von 1200 ms',
    halten: 800,
    schritte: [],
    // FRUEHER `'neuer Bereich'`: die Frist lag bei 700 ms, 800 reichten also.
    // Seit dem 06.08.2026 sind es 1200 (WAPPEN_HALTEN_MS, tools/admin-weg.mjs),
    // und 800 ms sind der GEGENFALL — die Zahl bleibt stehen, weil genau sie
    // mit diesem Werkzeug als „haelt ein Mensch zuverlaessig" gemessen wurde.
    erwartet: 'nichts',
  },
  {
    name: 'halten-zittern-2px',
    wort: '1500 ms halten, dabei um 2 px zittern (ruhige Hand)',
    halten: 1500,
    schritte: zittern(2, 1500),
    erwartet: 'neuer Bereich',
  },
  {
    name: 'halten-zittern-6px',
    wort: '1500 ms halten, dabei um 6 px zittern (unruhige Hand)',
    halten: 1500,
    schritte: zittern(6, 1500),
    erwartet: 'neuer Bereich',
  },
  {
    name: 'halten-schieben-15px',
    wort: '800 ms halten, dabei 15 px nach unten schieben',
    halten: 800,
    schritte: schieben(0, 15, 800),
    erwartet: '?',
  },
  {
    name: 'halten-schieben-40px',
    wort: '800 ms halten, dabei 40 px nach unten schieben (Wisch-Ansatz)',
    halten: 800,
    schritte: schieben(0, 40, 800),
    erwartet: '?',
  },
  {
    name: 'halten-schieben-seitlich-40px',
    wort: '800 ms halten, dabei 40 px zur Seite schieben',
    halten: 800,
    schritte: schieben(40, 0, 800),
    erwartet: '?',
  },
  {
    name: 'halten-lang-1600',
    wort: '1600 ms halten — kommt ein Langdruck-Menue des Browsers?',
    halten: 1600,
    schritte: [],
    erwartet: 'neuer Bereich',
  },
  {
    name: 'halten-abgebrochen',
    wort: '800 ms halten, dann touchCancel statt touchEnd (der Browser nimmt die Beruehrung)',
    halten: 800,
    schritte: [],
    abbrechen: true,
    erwartet: '?',
  },
  {
    name: 'halten-ruhig-touchaction-none',
    wort: '1500 ms halten, aber `touch-action: none` am Knopf',
    halten: 1500,
    schritte: [],
    stil: 'none',
    erwartet: 'neuer Bereich',
  },
  {
    name: 'halten-schieben-40px-touchaction-none',
    wort: '40 px schieben mit `touch-action: none` — schuetzt es den Griff?',
    halten: 800,
    schritte: schieben(0, 40, 800),
    stil: 'none',
    erwartet: '?',
  },
  {
    name: 'halten-ruhig-rollbar',
    wort: '800 ms ruhig halten, aber der Knopf sitzt in einer ROLLBAREN Flaeche',
    halten: 800,
    schritte: [],
    rollbar: true,
    erwartet: '?',
  },
  {
    name: 'halten-schieben-40px-rollbar',
    wort: '40 px schieben in einer ROLLBAREN Flaeche — der Fall, den nur ein Finger hat',
    halten: 800,
    schritte: schieben(0, 40, 800),
    rollbar: true,
    erwartet: '?',
  },
  /**
   * ── DIE GEGENPROBE ZUM AUSBLEIBENDEN LANGDRUCK-MENUE ──────────────────
   *
   * „Bei 1600 ms kam kein `contextmenu`" ist als Aussage WERTLOS, solange
   * nicht feststeht, dass dieser Aufbau ueberhaupt eines erzeugen KANN. Ein
   * headless-Chromium ohne Fensterverwaltung koennte es genauso gut
   * grundsaetzlich unterdruecken — dann misst man nicht die Box, sondern die
   * Messeinrichtung, und meldet eine Entwarnung, die keine ist.
   *
   * Deshalb dieser Griff: er legt einen Streifen mit AUSWAEHLBAREM Text und
   * `touch-action: auto` ueber den Schirm — die Umgebung, in der ein Browser
   * das Menue am ehesten zeigt — und haelt DORT lange. Kommt auch hier
   * keines, sagt der Bericht „nicht messbar" statt „kommt nicht".
   */
  {
    name: 'kontext-gegenprobe',
    wort: '1600 ms auf auswaehlbarem Text — kann dieser Aufbau ueberhaupt ein contextmenu?',
    halten: 1600,
    schritte: [],
    erwartet: '?',
    gegenprobe: true,
  },
]

/**
 * ── ZWEI LEITERN, weil eine einzelne Messung keine Grenze findet ──────────
 *
 * „40 px schieben bricht ab, 15 px nicht" sagt noch nicht, WO die Grenze
 * liegt — und die Grenze ist das, was man braucht, um zu entscheiden, ob ein
 * Mensch sie im Alltag ueberschreitet. Dasselbe gilt fuer die Frist: die
 * Frage ist nicht, ob 1500 ms reichen, sondern ab wann es kippt.
 *
 * DIE LEITER STAND BIS ZUM 06.08.2026 AUF [300, 500, 650, 690, 710, 900] und
 * erwartete `ms >= 700 ? 'neuer Bereich' : 'alter Weg'` — die Frist lag bei
 * 700 ms, und unterhalb davon fuehrte ein Tipp aufs Zahnrad in die ALTE
 * Oberflaeche. Beides gilt nicht mehr: die Frist ist WAPPEN_HALTEN_MS = 1200,
 * und unterhalb davon passiert GAR NICHTS. Die Sprossen sind mitgewandert,
 * die Frage darunter ist dieselbe.
 */
for (const ms of [300, 800, 1100, 1150, 1250, 1500]) {
  GRIFFE.push({
    name: `leiter-halten-${ms}`,
    wort: `${ms} ms halten, ruhig — kippt es bei ${WAPPEN_HALTEN_MS}?`,
    halten: ms,
    schritte: [],
    erwartet: ms >= WAPPEN_HALTEN_MS ? 'neuer Bereich' : 'nichts',
    leiter: 'halten',
  })
}
for (const px of [18, 22, 26, 30, 34, 38, 45]) {
  GRIFFE.push({
    name: `leiter-abdrift-${px}`,
    wort: `1500 ms halten, dabei ${px} px nach unten abdriften`,
    halten: 1500,
    schritte: schieben(0, px, 1500),
    erwartet: '?',
    leiter: 'abdrift',
  })
}

/** Ein zitternder Finger: kleine Ausschlaege um die Mitte, alle 40 ms. */
function zittern(px, dauer) {
  const s = []
  for (let t = 40; t < dauer; t += 40) {
    const i = t / 40
    s.push({ t, dx: (i % 2 ? px : -px) * 0.7, dy: (i % 3 ? -px : px) * 0.7 })
  }
  return s
}

/** Ein schiebender Finger: gleichmaessig in eine Richtung, alle 40 ms. */
function schieben(dx, dy, dauer) {
  const s = []
  const n = Math.floor(dauer / 40)
  for (let i = 1; i <= n; i++) s.push({ t: i * 40, dx: (dx * i) / n, dy: (dy * i) / n })
  return s
}

if (hat('liste')) {
  for (const g of GRIFFE) console.log(`${g.name.padEnd(38)} ${g.wort}`)
  process.exit(0)
}

// ═══════════════════════════════════════════════════════════════════════════
//  Der Mitschreiber, der IN der Seite laeuft
// ═══════════════════════════════════════════════════════════════════════════
//
// Er haengt FANGEND am `document`. Das ist kein Feinschliff, sondern die
// einzige Stelle, an der man alles sieht:
//   * `pointerleave`, `pointerout` und `pointerenter` BLASEN NICHT — ein
//     blasender Zuhoerer am document saehe sie nie. Die Fangphase laeuft
//     trotzdem, auch fuer nicht blasende Ereignisse.
//   * fangend am document ist der Mitschreiber VOR jedem Zuhoerer der Seite;
//     er sieht also auch, was ein `stopPropagation` unterwegs schluckt.
//   * `passive: true`, damit der Mitschreiber die Gestenerkennung des Browsers
//     nicht veraendert. Ein nicht-passiver `touchmove`-Zuhoerer zwingt Blink,
//     auf die Seite zu warten, bevor er rollt — das WAERE eine Messung, die
//     ihren Gegenstand verstellt.
const MITSCHREIBER = `(() => {
  if (window.__fingerProbeSteht) return
  window.__fingerProbeSteht = true
  const ARTEN = ['pointerdown','pointerup','pointercancel','pointerleave','pointerout',
                 'pointermove','touchstart','touchmove','touchend','touchcancel',
                 'click','dblclick','contextmenu','mousedown','mouseup','selectstart']
  let null0 = null
  const kurz = (e) => {
    let z = e.target
    let pfad = ''
    if (z && z.nodeType === 1) {
      const k = z.closest && z.closest('button, a, [id]')
      pfad = k ? (k.id ? '#' + k.id : k.tagName.toLowerCase()) : z.tagName.toLowerCase()
    }
    return pfad
  }
  const melde = (e) => {
    if (null0 === null) null0 = e.timeStamp
    // NUR was am Ziel haengt — sonst ersaeuft das Protokoll in pointermove
    // ueber dem halben Haus.
    const imZiel = e.target && e.target.nodeType === 1 && e.target.closest &&
                   e.target.closest(window.__fingerZiel || '#wappen')
    if (!imZiel && e.type !== 'contextmenu' && e.type !== 'click') return
    window.fingerMeld(JSON.stringify({
      art: e.type,
      ms: Math.round(e.timeStamp - null0),
      ziel: kurz(e),
      imZiel: !!imZiel,
      zeiger: e.pointerType || (e.touches ? 'touch' : ''),
      abbrechbar: !!e.cancelable,
      echt: !!e.isTrusted,
      x: Math.round(e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0) || 0),
      y: Math.round(e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0) || 0),
    }))
  }
  for (const a of ARTEN) document.addEventListener(a, melde, { capture: true, passive: true })

  // ── DER SEITENWECHSEL IST DAS ERGEBNIS, NICHT EIN NEBENGERAEUSCH ────────
  // andereOberflaeche setzt window.location.href. Ob das passiert ist,
  // laesst sich hinterher nicht mehr fragen — die Seite ist dann weg. Der
  // beforeunload meldet es, solange die alte Seite noch steht.
  // (KEINE BACKTICKS IN DIESEM BLOCK: er steht selbst in einem Template.)
  window.addEventListener('beforeunload', () => {
    window.fingerMeld(JSON.stringify({ art: 'SEITE-GEHT', ms: -1, ziel: location.pathname }))
  })
})()`

// ═══════════════════════════════════════════════════════════════════════════
//  Aufbau: Vorschau und Browser
// ═══════════════════════════════════════════════════════════════════════════
if (!browserSuchen()) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

let vorschau = null
let ZIEL = MITGEGEBEN

process.on('exit', () => {
  try {
    vorschau?.kill()
  } catch {
    /* schon weg */
  }
})

if (!ZIEL) {
  ZIEL = `http://127.0.0.1:${PORT}/neu/`
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(PORT)], {
    cwd: WURZEL,
    stdio: 'ignore',
  })
  vorschau.unref()
  let gestorben = null
  vorschau.on('exit', (c) => {
    gestorben = c
  })
  const bis = Date.now() + 10000
  for (;;) {
    if (gestorben !== null)
      throw new Error(`tools/neu-vorschau.mjs endete sofort (${gestorben}) — Port ${PORT} war belegt`)
    try {
      await fetch(`http://127.0.0.1:${PORT}/api/werke`)
      break
    } catch {
      if (Date.now() > bis) throw new Error('tools/neu-vorschau.mjs kam nicht hoch')
      await warte(150)
    }
  }
}

let lfd = 0
const send = (ws, m, p = {}) =>
  new Promise((ok, no) => {
    const i = ++lfd
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
    const h = (r) => {
      const x = JSON.parse(r)
      if (x.id !== i) return
      ws.off('message', h)
      x.error ? no(new Error(x.error.message)) : ok(x.result)
    }
    ws.on('message', h)
  })

const befunde = []
const ja = (gut, wort, dazu = '') => {
  befunde.push({ gut, wort, dazu })
  if (!JSONAUS) console.log(`${gut ? 'ok  ' : 'NEIN'}  ${wort}${dazu ? `  — ${dazu}` : ''}`)
}

let chrome = null
const ergebnisse = []

try {
  chrome = await eigenerBrowser()
  if (!chrome) throw new Error('kein Browser erreichbar')
  const ws = new WebSocket(await chrome.seite(), { perMessageDeflate: false })
  await new Promise((r) => ws.once('open', r))

  await send(ws, 'Page.enable')
  await send(ws, 'Runtime.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 480,
    deviceScaleFactor: 1,
    // `mobile: false` MIT ABSICHT: die Box ist ein Kiosk-Chromium auf einem
    // Beruehrungsschirm, kein Telefon. `mobile: true` schaltete zusaetzlich
    // die Ansichtsfenster-Regeln eines Telefons dazu und maesse damit eine
    // Seite, die es so nirgends gibt.
    mobile: false,
  })
  /**
   * ══ DIE EINE ZEILE, AN DER ALLES HAENGT ═══════════════════════════════
   *
   * Ohne sie meldet `Input.dispatchTouchEvent` zwar keinen Fehler, aber die
   * Seite bekommt nichts: `ontouchstart` fehlt am window, `maxTouchPoints`
   * ist 0, und Blink hat gar keine Beruehrungs-Gestenerkennung geladen. Man
   * misst dann eine Seite, die glaubt, an einem Rechner ohne Beruehrungsschirm
   * zu haengen — also genau den Zustand, aus dem der Fehler nicht zu sehen ist.
   */
  await send(ws, 'Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  await send(ws, 'Emulation.setEmitTouchEventsForMouse', { enabled: false }).catch(() => {})

  // Die Bindung, ueber die der Mitschreiber herausredet.
  await send(ws, 'Runtime.addBinding', { name: 'fingerMeld' })
  let protokoll = []
  ws.on('message', (r) => {
    const x = JSON.parse(r)
    if (x.method === 'Runtime.bindingCalled' && x.params.name === 'fingerMeld') {
      try {
        protokoll.push(JSON.parse(x.params.payload))
      } catch {
        /* unlesbar — dann eben nicht */
      }
    }
    if (x.method === 'Page.frameRequestedNavigation') {
      protokoll.push({ art: 'WECHSEL-ANGEFORDERT', ms: -1, ziel: x.params.url })
    }
  })
  // NACH JEDEM Seitenwechsel wieder da: die Griffe, die in einem Wechsel
  // enden, laden die Seite danach neu.
  await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: MITSCHREIBER })

  const ev = async (js) => {
    const r = await send(ws, 'Runtime.evaluate', {
      expression: js,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Fehler in der Seite')
    return r.result.value
  }

  const stand = async (w) => {
    await fetch(new URL(`/vorschau/${w}`, ZIEL))
  }

  const neuLaden = async () => {
    await send(ws, 'Page.navigate', { url: ZIEL })
    await warte(1400)
    await ev(MITSCHREIBER)
    await ev(`window.__fingerZiel = ${JSON.stringify(ZIEL_WAHL)}`)
  }

  if (LAGE) await stand(LAGE)
  await neuLaden()

  // ── Erst einmal feststellen, dass die Seite den Finger ueberhaupt sieht ──
  const schirmLage = await ev(`({
    touchAmFenster: 'ontouchstart' in window,
    maxPunkte: navigator.maxTouchPoints,
    grob: window.matchMedia('(pointer: coarse)').matches,
    schweben: window.matchMedia('(hover: hover)').matches,
  })`)
  ja(
    schirmLage.touchAmFenster && schirmLage.maxPunkte > 0,
    'der Browser hat einen Beruehrungsschirm',
    `ontouchstart=${schirmLage.touchAmFenster}, maxTouchPoints=${schirmLage.maxPunkte}, pointer:coarse=${schirmLage.grob}`,
  )

  const zielMasse = await ev(`(() => {
    const e = document.querySelector(${JSON.stringify(ZIEL_WAHL)})
    if (!e) return null
    const b = e.getBoundingClientRect()
    const s = getComputedStyle(e)
    return { x: Math.round(b.left + b.width/2), y: Math.round(b.top + b.height/2),
             b: Math.round(b.width), h: Math.round(b.height),
             touchAction: s.touchAction, userSelect: s.userSelect }
  })()`)
  if (!zielMasse) throw new Error(`${ZIEL_WAHL} nicht im Baum`)
  ja(
    true,
    `${ZIEL_WAHL} liegt bei ${zielMasse.x}/${zielMasse.y}`,
    `${zielMasse.b}x${zielMasse.h} px, touch-action: ${zielMasse.touchAction}`,
  )

  /** Einen Punkt schicken. `punkte: []` heisst „Finger weg". */
  const touch = async (typ, x, y) =>
    send(ws, 'Input.dispatchTouchEvent', {
      type: typ,
      touchPoints:
        typ === 'touchEnd' || typ === 'touchCancel'
          ? []
          : [
              {
                x: Math.round(x),
                y: Math.round(y),
                // Ein Finger ist keine Nadel. 12 px Radius entsprechen grob
                // einer Fingerkuppe auf 800x480 (0,14 mm/px -> ~3,4 mm).
                radiusX: 12,
                radiusY: 12,
                force: 1,
                id: 1,
              },
            ],
    })

  /**
   * EINEN GRIFF AUSFUEHREN und alles mitschreiben, was dabei ankommt.
   */
  const greifen = async (g) => {
    protokoll = []
    if (g.stil)
      await ev(`document.querySelector(${JSON.stringify(ZIEL_WAHL)}).style.touchAction = ${JSON.stringify(g.stil)}`)
    if (g.gegenprobe) {
      await ev(`(() => {
        const d = document.createElement('div')
        d.id = 'finger-probe-text'
        d.textContent = 'Auswaehlbarer Text fuer die Gegenprobe zum Langdruck-Menue'
        d.setAttribute('style', 'position:fixed;left:20px;top:200px;width:400px;height:80px;' +
          'z-index:99999;background:#fff;color:#000;font-size:20px;' +
          'user-select:text;-webkit-user-select:text;touch-action:auto')
        document.body.appendChild(d)
      })()`)
      await ev(`window.__fingerZiel = '#finger-probe-text'`)
    }
    if (g.rollbar) {
      // EINE ROLLBARE FLAECHE UM DEN KNOPF. Der Verdacht war, `touch-action:
      // manipulation` erlaube dem Browser, die Beruehrung fuers Rollen zu
      // beanspruchen. Beansprucht wird sie aber nur, wenn es ETWAS ZU ROLLEN
      // gibt. Ohne diesen Griff misst man den Verdacht gar nicht — man misst
      // nur, dass eine Seite ohne Bildlauf nicht rollt.
      await ev(`(() => {
        const e = document.querySelector(${JSON.stringify(ZIEL_WAHL)})
        const p = e.parentElement
        p.dataset.fingerProbeVorher = p.getAttribute('style') || ''
        p.style.overflowY = 'auto'
        p.style.maxHeight = '60px'
        if (!p.querySelector('.finger-probe-fueller')) {
          const f = document.createElement('div')
          f.className = 'finger-probe-fueller'
          f.style.height = '600px'
          p.appendChild(f)
        }
      })()`)
    }

    // DAS ZIEL DIESES GRIFFS — nicht zwingend das Ziel des Laufs: die
    // Gegenprobe zum Langdruck-Menue haelt ausdruecklich woanders.
    const wahl = g.gegenprobe ? '#finger-probe-text' : ZIEL_WAHL
    const m = await ev(`(() => {
      const e = document.querySelector(${JSON.stringify(wahl)})
      const b = e.getBoundingClientRect()
      return { x: Math.round(b.left + b.width/2), y: Math.round(b.top + b.height/2) }
    })()`)

    const t0 = Date.now()
    await touch('touchStart', m.x, m.y)
    for (const s of g.schritte) {
      const wann = t0 + s.t
      const rest = wann - Date.now()
      if (rest > 0) await warte(rest)
      await touch('touchMove', m.x + s.dx, m.y + s.dy)
    }
    const rest = t0 + g.halten - Date.now()
    if (rest > 0) await warte(rest)
    await touch(g.abbrechen ? 'touchCancel' : 'touchEnd', m.x, m.y)

    // Zeit fuer Klick, Uhr, `/api/config` und den Aufbau des Bereichs.
    await warte(1200)

    // WIRKUNG. Nach einem Seitenwechsel ist die Seite weg — dann sagt das
    // Protokoll (`SEITE-GEHT` / `WECHSEL-ANGEFORDERT`), was passiert ist, und
    // die Abfrage unten laeuft ins Leere. Deshalb wird sie abgesichert.
    let schirm = null
    try {
      schirm = await ev(`(() => {
        const sicht = (id) => {
          const e = document.getElementById(id)
          if (!e) return false
          const b = e.getBoundingClientRect()
          return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'
        }
        return { pfad: location.pathname, bereich: sicht('eltern'),
                 tor: sicht('eltern-tor'), flaeche: sicht('eltern-flaeche'),
                 unter: (document.getElementById('eltern-unter')||{}).textContent || '' }
      })()`)
    } catch {
      schirm = null
    }

    // ══ DIE AUFGABE LOESEN — mit dem Finger, wie der Betreiber ═════════════
    //
    // WOFUER: Steht die Sperre (auf der Box .169 steht sie, weil der
    // Schluessel FEHLT), sieht das Tor nach einem KURZEN Tipp Zeichen fuer
    // Zeichen genauso aus wie nach langem Halten. Welche Geste man erwischt
    // hat, sagt erst das, was NACH der Aufgabe kommt: der neue Bereich oder
    // ein Seitenwechsel in die alte Oberflaeche. Ohne diesen Schritt endet
    // jede Messung mit gesetzter Sperre bei „Tor" und beantwortet die Frage
    // nicht.
    let nachDerAufgabe = null
    if (LOESEN && schirm && schirm.tor) {
      const frage = await ev(`(document.getElementById('tor-frage')||{}).textContent || ''`)
      // `×` IST U+00D7, NICHT DER BUCHSTABE x — `torMalen` schreibt
      // „Was ist 7 × 9?". Der erste Anlauf suchte nach `x` und fand nie eine
      // Aufgabe; das Werkzeug meldete dann still gar nichts.
      const m = String(frage).match(/(\d+)\s*([+\-×x*])\s*(\d+)/)
      if (m) {
        const a = Number(m[1])
        const b = Number(m[3])
        const l = m[2] === '+' ? a + b : m[2] === '-' ? a - b : a * b
        for (const z of String(l).split('')) await tasteTippen(z)
        await tasteTippen('weiter')
        await warte(1200)
        try {
          nachDerAufgabe = await ev(`(() => {
            const sicht = (id) => { const e = document.getElementById(id); if (!e) return false
              const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 }
            return { pfad: location.pathname, tor: sicht('eltern-tor'), flaeche: sicht('eltern-flaeche') }
          })()`)
        } catch {
          nachDerAufgabe = { pfad: '(Seite gewechselt)', tor: false, flaeche: false }
        }
        nachDerAufgabe.aufgabe = String(frage).trim()
        nachDerAufgabe.antwort = l
      }
    }

    // ══ DAS PROTOKOLL WIRD HIER FESTGEHALTEN, VOR DEM NEULADEN ═════════════
    // Sonst schreibt der `beforeunload` des NEULADENS ein „SEITE-GEHT" hinein,
    // und jeder Griff saehe aus, als haette er einen Seitenwechsel ausgeloest.
    // Genau diese Falschmeldung stand im ersten Lauf dieses Werkzeugs.
    const fest = protokoll.slice()

    // Aufraeumen und zurueck auf einen sauberen Anfang.
    await neuLaden()
    return { protokoll: fest, schirm, nachDerAufgabe }
  }

  /** Eine Taste des Tors mit einer ECHTEN Beruehrung treffen. */
  async function tasteTippen(wert) {
    const p = await ev(`(() => {
      const t = [...document.querySelectorAll('#tor-feld .tor-taste')]
        .find((e) => e.textContent.trim() === ${JSON.stringify(wert)} ||
                     e.dataset.taste === ${JSON.stringify(wert)} ||
                     (${JSON.stringify(wert)} === 'weiter' && e.classList.contains('tor-weiter')))
      if (!t) return null
      const b = t.getBoundingClientRect()
      return { x: Math.round(b.left + b.width/2), y: Math.round(b.top + b.height/2) }
    })()`)
    if (!p) return false
    await touch('touchStart', p.x, p.y)
    await warte(60)
    await touch('touchEnd', p.x, p.y)
    await warte(160)
    return true
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Auswertung eines Protokolls
  // ═══════════════════════════════════════════════════════════════════════
  //
  // DIE FRIST FAELLT AUS DEM PROTOKOLL HERAUS. `elternEinstieg` startet die
  // Uhr bei `pointerdown` und loescht sie bei `pointerup`, `pointercancel`
  // ODER `pointerleave`. Der Abstand vom `pointerdown` bis zum ERSTEN dieser
  // drei ist also genau die Frist, die dieser Griff zulaesst — eine laengere
  // Frist als diese Zahl kann bei diesem Griff nicht mehr feuern.
  const ABBRUCH = new Set(['pointerup', 'pointercancel', 'pointerleave'])
  const auswerten = (p) => {
    const nieder = p.find((e) => e.art === 'pointerdown' && e.imZiel)
    const abbruch = p.find((e) => ABBRUCH.has(e.art) && e.imZiel && (!nieder || e.ms >= nieder.ms))
    return {
      niederMs: nieder ? nieder.ms : null,
      abbruchArt: abbruch ? abbruch.art : null,
      fristMs: nieder && abbruch ? abbruch.ms - nieder.ms : null,
      klick: p.some((e) => e.art === 'click'),
      kontextmenue: p.some((e) => e.art === 'contextmenu'),
      abgebrochen: p.some((e) => e.art === 'pointercancel' || e.art === 'touchcancel'),
      wechsel: p.find((e) => e.art === 'WECHSEL-ANGEFORDERT' || e.art === 'SEITE-GEHT') || null,
    }
  }

  // `--nur` trifft auch als ANFANG eines Namens: `--nur leiter-halten` laeuft
  // die ganze Leiter, `--nur leiter-halten-690` genau eine Sprosse.
  const zuLaufen = NUR ? GRIFFE.filter((g) => g.name === NUR || g.name.startsWith(NUR)) : GRIFFE
  if (!zuLaufen.length) throw new Error(`kein Griff namens „${NUR}" — --liste zeigt sie`)

  for (const g of zuLaufen) {
    const { protokoll: p, schirm, nachDerAufgabe } = await greifen(g)
    const a = auswerten(p)
    const wirkung =
      schirm && schirm.bereich ? (schirm.tor ? 'Tor' : 'neuer Bereich') : a.wechsel ? 'SEITENWECHSEL' : 'nichts'
    ergebnisse.push({ griff: g.name, wort: g.wort, wirkung, ...a, protokoll: p, schirm, nachDerAufgabe })

    if (!JSONAUS) {
      console.log('')
      console.log(`── ${g.name} — ${g.wort}`)
      const zeile = p
        .filter((e) => e.art !== 'pointermove' && e.art !== 'touchmove')
        .map((e) => `${e.ms >= 0 ? `${e.ms}ms` : ''} ${e.art}${e.zeiger ? `[${e.zeiger}]` : ''}`)
        .join('  →  ')
      const bewegt = p.filter((e) => e.art === 'pointermove' || e.art === 'touchmove').length
      console.log(`   ${zeile}${bewegt ? `   (+${bewegt} Bewegungen)` : ''}`)
      console.log(
        `   Frist bis zum Abbruch: ${a.fristMs === null ? '— (kein Abbruch gemessen)' : `${a.fristMs} ms durch ${a.abbruchArt}`}` +
          `   ·   click: ${a.klick ? 'ja' : 'nein'}   ·   contextmenu: ${a.kontextmenue ? 'JA' : 'nein'}`,
      )
      console.log(
        `   WIRKUNG: ${wirkung}${schirm ? `   (Pfad ${schirm.pfad}, Unterzeile „${schirm.unter.trim()}")` : ''}`,
      )
      if (nachDerAufgabe)
        console.log(
          `   NACH DER AUFGABE („${nachDerAufgabe.aufgabe}" = ${nachDerAufgabe.antwort}): ` +
            `Pfad ${nachDerAufgabe.pfad}, Tor ${nachDerAufgabe.tor ? 'steht noch' : 'weg'}, ` +
            `Bereich ${nachDerAufgabe.flaeche ? 'DA' : 'nicht da'}`,
        )
    }

    if (g.erwartet !== '?') {
      /*
       * DREI ERWARTUNGEN, NICHT MEHR ZWEI.
       *
       * BIS ZUM 06.08.2026 GAB ES NUR `'neuer Bereich'` UND `'alter Weg'`,
       * und der zweite Zweig hiess wortwoertlich „SEITENWECHSEL oder Tor" —
       * denn ein kurzer Tipp aufs Zahnrad `#einst-knopf` verliess die
       * Oberflaeche nach /settings. Das Zahnrad ist ersatzlos entfallen; der
       * Einstieg `#wappen` traegt genau EINE Geste, und alles unterhalb der
       * Frist tut GAR NICHTS.
       *
       * `'nichts'` DARF DESHALB NICHT AUF DEN ALTEN ZWEIG FALLEN. Es tat es
       * beim ersten Anlauf, und dann meldete die Zeile „erwartet nichts —
       * bekommen nichts" als FEHLER. Eine Aussage, die sich selbst
       * widerspricht, liest niemand zweimal.
       */
      const gut =
        g.erwartet === 'neuer Bereich'
          ? wirkung === 'neuer Bereich' || wirkung === 'Tor'
          : g.erwartet === 'nichts'
            ? wirkung === 'nichts'
            : wirkung === 'SEITENWECHSEL' || wirkung === 'Tor'
      ja(gut, `${g.name}: erwartet „${g.erwartet}"`, `bekommen „${wirkung}"`)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  WELCHE FRIST HAETTE WELCHEN GRIFF UEBERLEBT
  // ═══════════════════════════════════════════════════════════════════════
  //
  // DAS IST KEINE ZWEITE MESSUNG UND KEINE SIMULATION. `elternEinstieg`
  // startet die Uhr bei `pointerdown` und loescht sie beim ERSTEN von
  // `pointerup`, `pointercancel`, `pointerleave`. Der gemessene Abstand
  // dazwischen ist genau das Zeitfenster, das dieser Griff zulaesst — eine
  // Frist unterhalb davon haette gefeuert, eine darueber nicht. Die Tabelle
  // ordnet also nur um, was oben schon dasteht.
  //
  // WOFUER MAN SIE BRAUCHT: Die Frage „ist 700 ms zu lang?" laesst sich sonst
  // nur mit einem Gefuehl beantworten. Hier steht, welchen Preis jede Zahl hat
  // — nach unten wird der kurze Tipp zur Falle, nach oben der lange Griff.
  if (!JSONAUS && ergebnisse.length > 1) {
    const KANDIDATEN = [250, 400, 500, 600, 700]
    console.log('')
    console.log('── WELCHE FRIST HAETTE GEFEUERT (aus den Fristen oben, nicht neu gemessen)')
    console.log(`   ${'Griff'.padEnd(38)}${'Frist'.padEnd(10)}${KANDIDATEN.map((k) => `${k}ms`.padStart(8)).join('')}`)
    for (const r of ergebnisse) {
      if (r.fristMs === null) continue
      const spalten = KANDIDATEN.map((k) => (r.fristMs > k ? 'ja' : '—').padStart(8)).join('')
      console.log(`   ${r.griff.padEnd(38)}${`${r.fristMs}ms`.padEnd(10)}${spalten}`)
    }
  }

  if (JSONAUS) console.log(JSON.stringify({ schirmLage, zielMasse, ergebnisse, befunde }, null, 2))
} finally {
  await chrome?.schliessen()
  vorschau?.kill()
}

const schlecht = befunde.filter((b) => !b.gut).length
if (!JSONAUS) {
  console.log('')
  console.log(`${befunde.length - schlecht} von ${befunde.length} Aussagen halten.`)
}
process.exit(schlecht ? 1 : 0)
