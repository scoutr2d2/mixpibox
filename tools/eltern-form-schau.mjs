#!/usr/bin/env node
/**
 * DIE FORM DES ELTERN-BEREICHS — was man SIEHT, in jeder Lage und beiden Themen.
 *
 * ══ WOZU, UND WARUM DIE DREI VORHANDENEN WERKZEUGE ES NICHT TUN ════════════
 *
 * Fuer diesen Bereich messen heute drei Werkzeuge, und keines beantwortet die
 * Frage „ueberlappt etwas?":
 *
 *   * `beruehrziele-neu.mjs` misst die GROESSE jedes Ziels und nennt je Schirm
 *     EINEN Abstand — den engsten. Es kennt genau zwei Eltern-Lagen
 *     (`eltern-tor` mit PIN, `eltern-flaeche` mit Bluetooth) und keine der
 *     Lagen, in denen dieser Bereich WIRKLICH steht: eine getippte Antwort,
 *     eine Fehlermeldung, ein Bluetooth-Suchlauf, ein Adapter, den es nicht
 *     gibt.
 *   * `eltern-masse-messen.mjs` misst ABSTAENDE zwischen Zielen, ebenfalls in
 *     genau diesen zwei Lagen, und ob die Faecherspalte rollt.
 *   * `eltern-tor-schau.mjs` misst die WIRKUNG des Tors — es faellt nur
 *     richtig. Ueber das Aussehen sagt es nichts.
 *
 * ZWEI ARTEN VON SCHADEN FALLEN DURCH ALLE DREI HINDURCH, und beide sind an
 * dieser Oberflaeche schon vorgekommen:
 *
 *   1. UEBERLAPPUNG. Zwei Ziele, die einander UEBERDECKEN, haben zwischen
 *      sich keinen zu kleinen Abstand — sie haben gar keinen. Ein Werkzeug,
 *      das den kleinsten POSITIVEN Abstand meldet, sieht darueber hinweg;
 *      `beruehrziele-neu.mjs` meldet an solchen Stellen „0,00 mm" und zaehlt
 *      das als engen Abstand, nicht als Deckung. Im Bild faellt es sofort auf.
 *      Genau so sind in diesem Baum die letzten drei Ueberlappungen gefunden
 *      worden: im BILD, nicht in den Zahlen.
 *   2. ABGESCHNITTENE SCHRIFT. Eine Rechenaufgabe, die am Rand klebt, eine
 *      Antwort, die nicht ins Feld passt, ein Fachname, der unter dem Pfeil
 *      verschwindet. Kein Abstandsmass wird davon rot.
 *
 * ══ WAS ES MISST — und was daran Messung ist ═══════════════════════════════
 *
 * Je Lage und je Thema:
 *   * UEBERLAPPUNG: alle sichtbaren Beruehrziele paarweise. Ueberschneiden
 *     sich zwei Rechtecke um mehr als `--schlupf` (Vorgabe 1 px, gegen die
 *     Rundung von `getBoundingClientRect`), wird die Stelle gemeldet — mit
 *     der Zahl der ueberdeckten Pixel.
 *   * BESCHNITT: `scrollWidth`/`scrollHeight` gegen `clientWidth`/`Height`
 *     fuer jedes Element mit Text. Das ist die Frage „passt die Schrift in
 *     ihren Kasten", und sie ist nicht dieselbe wie „ist der Kasten gross
 *     genug fuer einen Finger".
 *   * UEBER DEN RAND: jedes sichtbare Ziel gegen die 800x480 des Schirms.
 *   * DER EINE RUECKWEG: `elementFromPoint` auf seine Mitte. Nicht „steht er
 *     im Baum" — ob ihn ein Finger TRIFFT. Auf JEDER Lage, denn genau das
 *     ist an dieser Oberflaeche schon zweimal danebengegangen.
 *
 * DIE LAGEN sind die, in denen der Bereich wirklich steht, nicht die, die
 * sich leicht stellen lassen: das Tor in allen vier Sorten, mit und ohne
 * Eingabe, mit Fehlermeldung; die offene Flaeche in allen fuenf
 * Bluetooth-Lagen samt laufendem Suchlauf.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei des Baums. An der Box wird nicht gemessen. Ohne
 * Adresse startet es seine EIGENE Vorschau auf einem freien Port — eine
 * geliehene bediente den Arbeitsbaum dessen, der sie gestartet hat
 * ([[vorschau-wird-geliehen]]). Wird eine Adresse mitgegeben, wird deren Lage
 * am Ende zurueckgelegt.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/eltern-form-schau.mjs                       eigene Vorschau
 *     node tools/eltern-form-schau.mjs http://127.0.0.1:8613/neu/   geliehene
 *     node tools/eltern-form-schau.mjs --bild /tmp/form      je Lage ein PNG
 *     node tools/eltern-form-schau.mjs --nur rechnen         nur diese Lagen
 *     node tools/eltern-form-schau.mjs --thema hell          nur ein Thema
 *     node tools/eltern-form-schau.mjs --schlupf 2           groebere Marke
 *
 * ENDE 0, wenn jede Aussage haelt.
 */
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { browserSuchen, eigenerBrowser, freierPort, vorschauLeihen } from './leihgabe.mjs'
import { adminAufHalten } from './admin-weg.mjs'

const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const MITGEGEBEN = argv.find((a) => a.startsWith('http')) || null
const BILD = typeof opt('bild', null) === 'string' ? opt('bild', null) : null
const NUR = typeof opt('nur', null) === 'string' ? opt('nur', null) : null
const THEMA = typeof opt('thema', null) === 'string' ? opt('thema', null) : null
/** Rundungsschlupf in Pixeln — `getBoundingClientRect` gibt Bruchteile. */
const SCHLUPF = Number(opt('schlupf', 1)) || 1

const MM_JE_PIXEL = 0.14
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

const befunde = []
const ja = (gut, wort, dazu = '') => {
  befunde.push({ gut, wort, dazu })
  console.log(`${gut ? 'ok  ' : 'NEIN'}  ${wort}${dazu ? `  — ${dazu}` : ''}`)
}

if (!browserSuchen()) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

let ZIEL = MITGEGEBEN
if (!ZIEL) {
  // Ohne Adresse: ein freier Port — vorschauLeihen startet dort gleich die
  // eigene Vorschau (ausdruecklich mit `--port`, nicht auf dem Vorgabeport
  // 8299, der womoeglich einem anderen Arbeitsbaum gehoert).
  const p = await freierPort()
  ZIEL = `http://127.0.0.1:${p}/neu/`
}

// EINE SCHON LAUFENDE VORSCHAU WIRD GELIEHEN — UND ZURUECKGELEGT.
//
// Wer eine Lage stellt (/vorschau/…), muss sie am Ende wieder hinlegen,
// wenn ihm die Vorschau nicht gehoert: sonst misst der naechste Lauf gegen
// eine Vorschau, die jemand anders verstellt hat. Laeuft unter ZIEL noch
// keine, startet vorschauLeihen dort selbst eine und beendet sie am Ende —
// eine eigene Vorschau, die den Lauf ueberlebte, hielte sonst als
// `spawn`-Kind die Ereignisschleife von Node am Leben.
// Beides samt der Messungen dahinter: tools/leihgabe.mjs.
const leihe = await vorschauLeihen(ZIEL)

let chrome = null
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

/**
 * DIE LAGEN — die, in denen der Bereich wirklich steht.
 *
 * `stand` sind Vorschau-Schalter vor dem Betreten, `tun` ist die Bedienung
 * DANACH. Beides getrennt, weil ein Neuladen den zweiten Teil vergisst: ein
 * halb getipptes Tor ueberlebt kein `Page.navigate`, und genau das soll es
 * auch nicht.
 */
const LAGEN = [
  { name: 'rechnen-leer', stand: ['sperre-rechnen'], wort: 'Rechenaufgabe, nichts getippt' },
  { name: 'rechnen-getippt', stand: ['sperre-rechnen'], tun: 'ziffern', wort: 'Rechenaufgabe, zweistellige Antwort getippt' },
  { name: 'rechnen-falsch', stand: ['sperre-rechnen'], tun: 'falsch', wort: 'Rechenaufgabe, falsch beantwortet — die Meldung steht' },
  { name: 'pin-leer', stand: ['sperre-pin'], wort: 'PIN, nichts getippt' },
  { name: 'pin-getippt', stand: ['sperre-pin'], tun: 'ziffern', wort: 'PIN, zwei Ziffern getippt' },
  // DER LAENGSTE FALL, den die Bedienung ueberhaupt zulaesst: `torTaste`
  // deckelt die PIN bei 8 Ziffern (die obere Grenze des Backends) und die
  // Rechenantwort bei 2 (9 x 9 = 81). Wer nur „zwei Ziffern" misst, hat den
  // engsten Fall nicht gestellt.
  { name: 'pin-acht', stand: ['sperre-pin'], tun: 'achtZiffern', wort: 'PIN, alle acht Ziffern — der laengste Fall' },
  { name: 'pin-falsch', stand: ['sperre-pin'], tun: 'falsch', wort: 'PIN, falsch — die Meldung steht' },
  { name: 'geste-leer', stand: ['sperre-geste'], wort: 'Geste, keine Ecke' },
  { name: 'geste-drei', stand: ['sperre-geste'], tun: 'dreiEcken', wort: 'Geste, drei von vier Ecken' },
  { name: 'offen-getrennt', stand: ['sperre-aus', 'bt-getrennt'], wort: 'offen, ein gekoppeltes Geraet ohne Verbindung' },
  { name: 'offen-verbunden', stand: ['sperre-aus', 'bt-verbunden'], wort: 'offen, verbunden' },
  { name: 'offen-aus', stand: ['sperre-aus', 'bt-aus'], wort: 'offen, Bluetooth ist abgeschaltet' },
  { name: 'offen-weg', stand: ['sperre-aus', 'bt-weg'], wort: 'offen, gar kein Adapter' },
  // ── DIE ZWEI LAGEN, IN DENEN DAS FACH ETWAS ZU MELDEN HAT ────────────────
  // `hinweis` sagt, WAS dastehen muss und ob es ein FEHLSCHLAG ist. Beides
  // gehoert zusammen: Ein Satz, der von einer Auskunft nicht zu unterscheiden
  // ist, ist am Schirm keine Fehlermeldung, auch wenn er die richtigen Worte
  // hat. Bis zum 06.08.2026 war das hier grau wie „Suche läuft …".
  {
    name: 'offen-suche-kaputt',
    stand: ['sperre-aus', 'bt-suche-kaputt'],
    tun: 'suchen',
    wort: 'offen, die Suche misslingt — die Meldung steht',
    hinweis: { text: /fehlgeschlagen/, falsch: true },
  },
  {
    name: 'offen-tat-kaputt',
    stand: ['sperre-aus', 'bt-tat-kaputt'],
    tun: 'verbinden',
    wort: 'offen, „Verbinden" misslingt — die Meldung steht',
    hinweis: { text: /./, falsch: true },
  },
]

/**
 * WAS AM SCHIRM EIN ZIEL IST. Dieselbe Liste wie in beruehrziele-neu.mjs,
 * damit die beiden Berichte dieselben Dinge meinen: was man antippen kann.
 */
const ZIELWAHL = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])'

try {
  chrome = await eigenerBrowser()
  if (!chrome) throw new Error('kein Browser erreichbar')
  const ws = new WebSocket(await chrome.seite(), { perMessageDeflate: false })
  await new Promise((r) => ws.once('open', r))
  await send(ws, 'Page.enable')
  await send(ws, 'Runtime.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (js) => {
    const r = await send(ws, 'Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Fehler in der Seite')
    return r.result.value
  }
  const stand = async (w) => {
    await fetch(new URL(`/vorschau/${w}`, ZIEL))
  }
  const neuLaden = async () => {
    await send(ws, 'Page.navigate', { url: ZIEL })
    await warte(1500)
  }
  const bild = async (name) => {
    if (!BILD) return
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(`${BILD}-${name}.png`, Buffer.from(s.data, 'base64'))
    console.log(`      Bild: ${BILD}-${name}.png`)
  }
  const tippen = async (x, y, halteMs = 40) => {
    const gem = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, pointerType: 'touch' }
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...gem })
    await warte(halteMs)
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...gem })
    await warte(60)
  }
  /**
   * INS FACH BLUETOOTH — SEIT DEM 06.08.2026 ZWEI GRIFFE STATT EINEM.
   *
   * Der Bereich hat zwei Ebenen: oben vier GRUPPEN, in der Karte die Punkte.
   * Bluetooth ist ein Punkt der Gruppe „Verbindung"; ein `data-fach="bt"` in
   * der Spalte gibt es nicht mehr. Beide Griffe gehen mit einem echten Finger
   * (`tippen`) und nicht mit `.click()` — dieses Werkzeug misst gerade, was
   * eine Beruehrung wirklich trifft.
   */
  const insFachBluetooth = async () => {
    const g = await ev(`(() => { const e = document.querySelector('#eltern-faecher [data-fach="verbindung"]'); if (!e) return null
      const b = e.getBoundingClientRect()
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } })()`)
    if (!g) throw new Error('Gruppe „Verbindung" nicht im Baum')
    await tippen(g.x, g.y)
    await warte(700)
    const z = await ev(`(() => {
      for (const e of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
        const n = e.querySelector('.zeile-name')
        if (!n || n.textContent.trim() !== 'Bluetooth') continue
        const b = e.getBoundingClientRect()
        return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }
      }
      return null })()`)
    if (!z) throw new Error('Punkt „Bluetooth" nicht im Baum')
    await tippen(z.x, z.y)
    await warte(700)
  }

  /** Der echte Weg hinein: den Schriftzug halten, nicht `eltern.auf()` rufen. */
  const hinein = async () => {
    // BIS ZUM 06.08.2026 FUEHRTE DAS ZAHNRAD `#einst-knopf` HINEIN, 800 ms
    // gehalten. Es ist ersatzlos entfallen; hinein fuehrt der Schriftzug
    // `#wappen`, WAPPEN_HALTEN_MS = 1200 ms gehalten. Dieses Werkzeug hat eine
    // echte Druckfunktion und geht deshalb den ECHTEN Weg, nicht den
    // Tastaturweg (tools/admin-weg.mjs).
    await adminAufHalten(ev, tippen, { warteMs: 900 })
  }
  /** Eine Tor-Taste ueber ihre Aufschrift treffen. */
  const taste = async (w) => {
    const r = await ev(`(() => {
      const k = [...document.querySelectorAll('.tor-taste')].find((e) => (e.dataset.taste || e.textContent.trim()) === ${JSON.stringify(w)})
      if (!k) return null
      const b = k.getBoundingClientRect()
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } })()`)
    if (!r) throw new Error(`Tor-Taste „${w}" nicht gefunden`)
    await tippen(r.x, r.y)
  }

  /**
   * DIE MESSUNG EINER LAGE. Alles in EINEM `evaluate`, damit zwischen den
   * Teilmessungen nichts nachrutscht — ein Bild, das eine Zeile spaeter laedt,
   * verschiebt sonst die Haelfte der Rechtecke.
   */
  const messen = () =>
    ev(`(() => {
      const W = 800, H = 480
      const sichtbar = (e) => {
        const s = getComputedStyle(e)
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
        const r = e.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      }
      const name = (e) => {
        const t = e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : '')
        const w = (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40)
        return w ? t + '  „' + w + '"' : t
      }
      // NUR, WAS IM ELTERN-BEREICH LIEGT. Der Rest des Hauses steht darunter
      // und ueberlappt selbstverstaendlich — das waere kein Befund, sondern
      // die Bauart des Vollbildes.
      const bereich = document.getElementById('eltern')
      if (!bereich || !sichtbar(bereich)) return { fehlt: true }
      const ziele = [...bereich.querySelectorAll(${JSON.stringify(ZIELWAHL)})]
        .filter(sichtbar)
        .map((e) => ({ e, r: e.getBoundingClientRect(), n: name(e) }))

      // ── UEBERLAPPUNG ────────────────────────────────────────────────────
      // Zwei Ziele duerfen einander nicht ueberdecken. Ein Ziel, das ein
      // ANDERES ENTHAELT, ist etwas anderes (ein Knopf im Knopf gibt es hier
      // nicht, aber die Regel soll nicht daran haengen) — deshalb wird die
      // gemeinsame Flaeche gemessen und nicht bloss „beruehrt sich".
      const deckung = []
      for (let i = 0; i < ziele.length; i++) for (let k = i + 1; k < ziele.length; k++) {
        const a = ziele[i].r, b = ziele[k].r
        if (ziele[i].e.contains(ziele[k].e) || ziele[k].e.contains(ziele[i].e)) continue
        const bx = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const by = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (bx > ${SCHLUPF} && by > ${SCHLUPF})
          deckung.push({ a: ziele[i].n, b: ziele[k].n, px: Math.round(bx * by), bx: Math.round(bx), by: Math.round(by) })
      }

      // ── UEBER DEN RAND ──────────────────────────────────────────────────
      //
      // WAS IN EINEM ROLLKASTEN LIEGT, ZAEHLT HIER NICHT MIT. Seit dem
      // 06.08.2026 zeigt das WLAN-Fach fuenf Netze in \`.fach-zeilen\`
      // (\`overflow-y: auto\`); die letzten beiden Zeilen stehen rechnerisch
      // bei y=429 und y=515 und damit „ueber dem Schirmrand". Am Bildschirm
      // ist von ihnen nichts zu sehen, sie sind eine Rollbewegung entfernt,
      // und der Kasten selbst steht ganz im Bild. Das ist die ROLLPOSITION
      // und nicht die Anordnung — dieselbe Unterscheidung wie in
      // tools/beruehrziele-neu.mjs („angeschnitten").
      const rollt = (e) => {
        for (let k = e; k && k !== document.body; k = k.parentElement) {
          const s = getComputedStyle(k)
          if (/auto|scroll/.test(s.overflowX + ' ' + s.overflowY)) return true
        }
        return false
      }
      const raus = ziele
        .filter((z) => !rollt(z.e))
        .filter((z) => z.r.left < -${SCHLUPF} || z.r.top < -${SCHLUPF} || z.r.right > W + ${SCHLUPF} || z.r.bottom > H + ${SCHLUPF})
        .map((z) => ({ n: z.n, x: Math.round(z.r.left), y: Math.round(z.r.top), b: Math.round(z.r.width), h: Math.round(z.r.height) }))

      // ── BESCHNITT ───────────────────────────────────────────────────────
      //
      // NICHT JEDER UEBERSTAND IST EIN BESCHNITT, und der erste Anlauf dieses
      // Werkzeugs hat genau daran dreizehn falsche Befunde gemeldet:
      // \`.eltern-titel\` und \`.tor-frage\` setzen \`line-height: 1.1\` bzw.
      // \`1.15\` auf „Baloo 2". Die Schrift ist hoeher als ihre Zeile, also
      // meldet \`scrollHeight\` 5–6 px mehr als \`clientHeight\` — und zu SEHEN
      // ist trotzdem alles, weil \`overflow\` sichtbar ist. Ein Werkzeug, das
      // das als Fehler zaehlt, gewoehnt seinem Leser das Hinsehen ab.
      //
      // AUCH DER ZWEITE ANLAUF WAR FALSCH, und er ist als Warnung hier
      // stehengeblieben: „hat ein Vorfahr \`overflow: hidden\`?" meldete
      // dieselben dreizehn Stellen wieder — der Vorfahr war \`.rahmen\`, der
      // Schirm selbst. JEDE Seite hat irgendwo einen Deckel; die Frage ist
      // nicht, OB einer da ist, sondern ob die Schrift ihn ERREICHT.
      //
      // GEMESSEN WIRD DESHALB DIE SCHRIFT SELBST: \`Range\` ueber den Inhalt
      // gibt das Rechteck der wirklichen Buchstaben (samt Ueberhang der
      // Zeile). Es wird gegen das Rechteck des naechsten abschneidenden
      // Vorfahren gehalten. Nur was ueber DESSEN Kante hinausragt, ist am
      // Schirm wirklich weg.
      const deckel = (e, achse) => {
        for (let k = e; k && k !== document.body; k = k.parentElement) {
          const s = getComputedStyle(k)
          const o = achse === 'x' ? s.overflowX : s.overflowY
          if (o === 'hidden' || o === 'clip') return k
        }
        return document.documentElement
      }
      const beschnitt = []
      for (const e of bereich.querySelectorAll('*')) {
        if (!sichtbar(e)) continue
        // UND DERSELBE DRITTE FEHLSCHLUSS WIE OBEN: Schrift, die in einem
        // ROLLKASTEN unter dessen Kante steht, ist nicht abgeschnitten,
        // sondern noch nicht herangerollt. Sonst meldete jede volle Liste
        // dieses Hauses jede ihrer unteren Zeilen als Beschnitt.
        if (rollt(e)) continue
        const eigen = [...e.childNodes].some((k) => k.nodeType === 3 && k.textContent.trim())
        if (!eigen) continue
        const rg = document.createRange()
        rg.selectNodeContents(e)
        const t = rg.getBoundingClientRect()
        if (t.width === 0 && t.height === 0) continue
        const dx = deckel(e, 'x').getBoundingClientRect()
        const dy = deckel(e, 'y').getBoundingClientRect()
        const links = dx.left - t.left, rechts = t.right - dx.right
        const oben = dy.top - t.top, unten = t.bottom - dy.bottom
        const weg = Math.max(0, links, rechts, oben, unten)
        if (weg > ${SCHLUPF})
          beschnitt.push({
            n: name(e),
            breit: Math.round(Math.max(0, links, rechts)),
            hoch: Math.round(Math.max(0, oben, unten)),
            durch: name(Math.max(links, rechts) > Math.max(oben, unten) ? deckel(e, 'x') : deckel(e, 'y')),
          })
      }

      // ── PASST DIE EINGABE IN IHR FELD ───────────────────────────────────
      //
      // Die Frage, die kein Abstandsmass stellt: „Reicht der Platz fuer eine
      // zweistellige Antwort?" Gemessen wird die WIRKLICHE Breite der Schrift
      // (\`Range.getBoundingClientRect\` ueber den Textknoten) gegen die innere
      // Breite des Feldes — nicht \`scrollWidth\`, denn das Feld ist mittig
      // gesetzt und rundet die Zahl nach beiden Seiten weg.
      const az = document.getElementById('tor-anzeige')
      let eingabefeld = null
      if (az && sichtbar(az) && az.textContent.trim()) {
        const s = getComputedStyle(az)
        const innen = az.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)
        const rg = document.createRange()
        rg.selectNodeContents(az)
        const tb = rg.getBoundingClientRect().width
        eingabefeld = {
          text: az.textContent.trim(),
          textB: Math.round(tb),
          feldB: Math.round(innen),
          luft: Math.round(innen - tb),
          passt: tb <= innen + ${SCHLUPF},
        }
      }

      // ── DIE MELDEZEILE DES FACHES ───────────────────────────────────────
      //
      // NICHT „hat sie die Klasse .falsch" — das waere eine Aussage ueber den
      // Quelltext. Gemessen wird die FARBE, die wirklich am Schirm steht, und
      // sie wird gegen die Farbe der ruhigen Auskunft (var(--muted)) gehalten.
      // Eine Klasse, die im Stilblatt keine Regel hat, sieht sonst aus wie
      // eine Reparatur und ist keine.
      const hw = document.getElementById('fach-hinweis')
      let hinweis = null
      if (hw && sichtbar(hw) && hw.textContent.trim()) {
        const probe = document.createElement('span')
        probe.style.color = 'var(--muted)'
        hw.parentElement.appendChild(probe)
        const ruhig = getComputedStyle(probe).color
        probe.remove()
        const ist = getComputedStyle(hw).color
        hinweis = { text: hw.textContent.trim(), farbe: ist, ruhigeFarbe: ruhig, abgesetzt: ist !== ruhig }
      }

      // ── DER EINE RUECKWEG ───────────────────────────────────────────────
      const rw = document.getElementById('zurueck')
      const rr = rw && sichtbar(rw) ? rw.getBoundingClientRect() : null
      const mitte = rr ? document.elementFromPoint(Math.round(rr.left + rr.width / 2), Math.round(rr.top + rr.height / 2)) : null
      return {
        ziele: ziele.length,
        deckung, raus, beschnitt, eingabefeld, hinweis,
        rueckweg: rr ? { b: Math.round(rr.width), h: Math.round(rr.height), x: Math.round(rr.left), y: Math.round(rr.top) } : null,
        rueckwegTrifft: !!(mitte && rw && (mitte === rw || rw.contains(mitte))),
        rueckwegDavor: mitte && !(rw && (mitte === rw || rw.contains(mitte))) ? name(mitte) : null,
      } })()`)

  const THEMEN = THEMA ? [THEMA] : ['hell', 'dunkel']
  for (const thema of THEMEN) {
    console.log(`\n══ ${thema} ══════════════════════════════════════════════`)
    for (const l of LAGEN) {
      if (NUR && !l.name.includes(NUR)) continue
      for (const s of l.stand) await stand(s)
      await neuLaden()
      await ev(`document.documentElement.setAttribute('data-licht', ${JSON.stringify(thema)})`)
      await hinein()

      if (l.tun === 'ziffern') {
        await taste('4')
        await taste('0')
      } else if (l.tun === 'achtZiffern') {
        for (const z of ['8', '8', '8', '8', '8', '8', '8', '8']) await taste(z)
      } else if (l.tun === 'falsch') {
        await taste('1')
        await taste('2')
        await taste('3')
        await taste('4')
        await taste('weiter')
        await warte(300)
      } else if (l.tun === 'dreiEcken') {
        const lage = await ev(`(() => { const t = document.getElementById('eltern-tor'); if (!t) return null
          const b = t.getBoundingClientRect()
          return { x: b.left, y: b.top, b: b.width, h: b.height } })()`)
        if (lage) {
          const k = 60
          await tippen(lage.x + k, lage.y + k)
          await tippen(lage.x + lage.b - k, lage.y + k)
          await tippen(lage.x + lage.b - k, lage.y + lage.h - k)
        }
      } else if (l.tun === 'suchen') {
        // ZUERST INS FACH BLUETOOTH — jetzt zwei Griffe statt einem, siehe
        // `insFachBluetooth`. Der Griff steht VOR dem Tippen auf #fach-tat,
        // weil dieser Knopf je Seite etwas anderes tut (`eltern.fachTat`).
        await insFachBluetooth()
        // MIT EINEM FINGER, nicht mit `.click()` — und mit Geduld. Die Suche
        // laeuft laut ihrer eigenen Meldung zwoelf Sekunden; wer nach einer
        // halben Sekunde ablichtet, sieht die Lage „es sucht" und haelt sie
        // fuer „es ist nichts passiert". Der erste Anlauf hier hat genau das
        // getan und ein Bild ohne jede Meldung gemacht.
        const k = await ev(`(() => { const e = document.getElementById('fach-tat'); if (!e) return null
          const b = e.getBoundingClientRect()
          return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } })()`)
        if (!k) throw new Error('#fach-tat nicht im Baum')
        await tippen(k.x, k.y)
        // Bis die Meldung von „Suche laeuft" auf ihr Ergebnis umspringt.
        const bis = Date.now() + 20000
        for (;;) {
          const h = await ev(`(() => { const e = document.getElementById('fach-hinweis')
            return e && !e.hidden ? e.textContent : '' })()`)
          if (h && !/Suche läuft/.test(h)) break
          if (Date.now() > bis) throw new Error(`die Suche kam in 20 s zu keinem Ende (Meldung: „${h}")`)
          await warte(400)
        }
      } else if (l.tun === 'verbinden') {
        // AUCH HIER ZUERST INS FACH BLUETOOTH — siehe die Begruendung bei
        // `suchen`. Auf der WLAN-Seite heisst derselbe Knopf ebenfalls
        // „Verbinden" und oeffnet die Bildschirmtastatur, statt eine Meldung
        // zu erzeugen.
        await insFachBluetooth()
        const k = await ev(`(() => { const e = [...document.querySelectorAll('#fach-zeilen button')].find((b) => /Verbinden|Koppeln/.test(b.textContent))
          if (!e) return null
          const b = e.getBoundingClientRect()
          return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } })()`)
        if (!k) throw new Error('kein Knopf „Verbinden"/„Koppeln" im Fach')
        await tippen(k.x, k.y)
        const bis = Date.now() + 20000
        for (;;) {
          const h = await ev(`(() => { const e = document.getElementById('fach-hinweis')
            return e && !e.hidden ? e.textContent : '' })()`)
          if (h) break
          if (Date.now() > bis) throw new Error('„Verbinden" kam in 20 s zu keiner Meldung')
          await warte(400)
        }
      }
      await warte(200)

      const m = await messen()
      console.log(`\n── ${l.name} (${thema}) — ${l.wort} ──`)
      if (m.fehlt) {
        ja(false, `${thema}/${l.name}: der Eltern-Bereich steht gar nicht da`)
        continue
      }
      console.log(`   ${m.ziele} sichtbare Ziele im Bereich`)
      await bild(`${thema}-${l.name}`)

      ja(
        m.deckung.length === 0,
        `${thema}/${l.name}: kein Ziel ueberdeckt ein anderes`,
        m.deckung.length
          ? m.deckung.map((d) => `${d.a} × ${d.b} (${d.bx}x${d.by} px)`).join(' | ')
          : `${(m.ziele * (m.ziele - 1)) / 2} Paare geprueft`,
      )
      ja(
        m.raus.length === 0,
        `${thema}/${l.name}: kein Ziel steht ueber dem Schirmrand`,
        m.raus.length ? m.raus.map((r) => `${r.n} bei ${r.x},${r.y} ${r.b}x${r.h}`).join(' | ') : '800x480',
      )
      ja(
        m.beschnitt.length === 0,
        `${thema}/${l.name}: keine Schrift ist abgeschnitten`,
        m.beschnitt.length
          ? m.beschnitt.map((b) => `${b.n} (+${b.breit}x${b.hoch} px, abgeschnitten von ${b.durch})`).join(' | ')
          : '',
      )
      if (l.hinweis) {
        ja(
          !!m.hinweis && l.hinweis.text.test(m.hinweis.text),
          `${thema}/${l.name}: die Meldung steht am Schirm`,
          m.hinweis ? `„${m.hinweis.text}"` : 'die Meldezeile ist leer oder versteckt',
        )
        if (m.hinweis)
          ja(
            l.hinweis.falsch === m.hinweis.abgesetzt,
            `${thema}/${l.name}: ein Fehlschlag ist von einer Auskunft zu unterscheiden`,
            `${m.hinweis.farbe}${m.hinweis.abgesetzt ? '' : ' — dieselbe Farbe wie „Suche läuft …"'}` +
              ` (ruhig waere ${m.hinweis.ruhigeFarbe})`,
          )
      }
      if (m.eingabefeld)
        ja(
          m.eingabefeld.passt,
          `${thema}/${l.name}: die Eingabe passt in ihr Feld`,
          `„${m.eingabefeld.text}" ist ${m.eingabefeld.textB} px breit, das Feld ${m.eingabefeld.feldB} px` +
            ` (${m.eingabefeld.luft} px Luft)`,
        )
      ja(
        !!m.rueckweg && m.rueckwegTrifft,
        `${thema}/${l.name}: der eine Rueckweg wird getroffen`,
        m.rueckweg
          ? `#zurueck ${m.rueckweg.b}x${m.rueckweg.h} bei ${m.rueckweg.x},${m.rueckweg.y}` +
            (m.rueckwegDavor ? ` — DAVOR LIEGT: ${m.rueckwegDavor}` : '')
          : 'gar nicht sichtbar',
      )
      if (m.rueckweg)
        ja(
          Math.min(m.rueckweg.b, m.rueckweg.h) * MM_JE_PIXEL >= 9,
          `${thema}/${l.name}: der Rueckweg haelt die 9-mm-Marke`,
          `${(Math.min(m.rueckweg.b, m.rueckweg.h) * MM_JE_PIXEL).toFixed(2)} mm`,
        )
    }
  }

  const schlecht = befunde.filter((b) => !b.gut)
  console.log(
    schlecht.length
      ? `\n${schlecht.length} von ${befunde.length} Aussagen halten NICHT.`
      : `\nAlle ${befunde.length} Aussagen halten.`,
  )
  await new Promise((r) => ws.close() ?? r())
  process.exitCode = schlecht.length ? 1 : 0
} finally {
  await chrome?.schliessen()
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  // Geliehen heisst: der ganze Schnappschuss (samt der klebrigen Felder
  // `sperre-` und `bt-`) wird zurueckgelegt; eigene heisst: sie wird beendet.
  await leihe.zurueckgeben()
}
