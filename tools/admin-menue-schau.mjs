#!/usr/bin/env node
/**
 * DAS ADMIN-MENUE MIT SEINEN ZWEI EBENEN — jede Gruppe, jeder Punkt, jeder Rueckweg.
 *
 * ══ WOZU, UND WARUM NICHT EINES DER ACHT VORHANDENEN ═══════════════════════
 *
 * Am 06.08.2026 ist aus FUENF flachen Faechern (WLAN · Bluetooth · Medien ·
 * Anzeige · Box) eine Gliederung mit ZWEI Ebenen geworden: vier Gruppen in der
 * Spalte, elf Punkte in der Karte daneben. Die vorhandenen Werkzeuge messen je
 * einen Teil davon und keines das Neue:
 *
 *   * `eltern-tor-schau.mjs`   misst die Sperre DAVOR. Ob dahinter vier oder
 *     fuenf Knoepfe stehen, ist ihm eine Zahl; ob man von einem Punkt wieder
 *     herauskommt, fragt es gar nicht.
 *   * `eltern-box-schau.mjs`   misst das FACH „Box" — es gibt kein Fach „Box"
 *     mehr, seine drei Inhalte sind drei Punkte der Gruppe „System".
 *   * `eltern-masse-messen.mjs`, `beruehrziele-neu.mjs`   messen Groessen und
 *     Abstaende. Sie kennen keinen Weg und keinen Zustand.
 *   * `eltern-seite-schau.mjs`  misst, was NEBEN dem Bereich liegt.
 *
 * DIE FRAGEN, DIE HIER GESTELLT WERDEN, sind genau die, an denen dieser Umbau
 * scheitern kann, ohne dass eine Zahl der anderen Werkzeuge sich ruehrt:
 *
 *   1. STEHEN VIER GRUPPEN DA, und traegt jede die Punkte, die zu ihr
 *      gehoeren — und KEINEN, hinter dem nichts liegt? (VPN, Hotspot, Account,
 *      QR-Einrichtung haben am Server nichts; ein Reiter dafuer waere eine
 *      Attrappe, die durch Weglassen luegt.)
 *   2. FUEHRT JEDER PUNKT WIRKLICH IRGENDWOHIN? Eine Zeile mit einem Knopf,
 *      hinter dem dieselbe Uebersicht steht, sieht aus wie eine Seite und ist
 *      keine.
 *   3. KOMMT MAN AUS JEDEM PUNKT MIT DEM EINEN RUECKWEG ZURUECK — und zwar
 *      EINE Ebene und nicht gleich hinaus?
 *
 *      HIER STAND, DIESE AUSSAGE GELTE FUER JEDE EBENE. Sie gilt fuer die
 *      Ebenen, die dieses Werkzeug betritt: Unterseite → Uebersicht → hinaus,
 *      und die Rueckfrage der Sperre. DIE MEDIEN GEHEN TIEFER — Uebersicht →
 *      Liste → Blatt → Loeschfrage —, und die letzten beiden hat hier nie
 *      jemand angesehen. Genau dort lag am 06.08.2026 ein Fehler: EIN Tipp
 *      raeumte Loeschfrage UND Blatt zugleich ab. Gefunden hat ihn
 *      tools/admin-nichts-verloren.mjs, das die Bedienungen von VOR dem Umbau
 *      durchgeht statt der Gliederung von heute. Wer die Tiefe der Medien
 *      messen will, nimmt jenes; dieses misst die Gliederung.
 *   4. LIEGT VOR DEM GELOESTEN TOR NICHTS? Nicht „ist es unsichtbar", sondern:
 *      steht keine Zeile im Baum, und geht kein Abruf hinaus. Das wird
 *      gemessen und nicht angenommen.
 *   5. FRAGEN NEUSTART UND AUSSCHALTEN NACH, sagt die Rueckfrage WAS GERADE
 *      LAEUFT, und geht bei „Abbrechen" wirklich KEIN Aufruf hinaus?
 *   6. LIEGEN „Neu starten" UND „Ausschalten" AUSEINANDER? Gemessen als
 *      Abstand ihrer Knoepfe in Millimetern, nicht als Absicht im Stilblatt.
 *   7. SAGEN DIE DIENST-ZEILEN DIE WAHRHEIT? „eingerichtet" und „erreichbar"
 *      sind zwei Fragen, und „nicht pruefbar" ist keine Ablehnung.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei des Baums und NICHTS AN EINER BOX. Ohne `--ziel`
 * startet es seine EIGENE Vorschau auf einem freien Port; eine geliehene
 * bediente den Arbeitsbaum dessen, der sie gestartet hat
 * ([[vorschau-wird-geliehen]]). Neustart und Ausschalten gehen ausschliesslich
 * gegen diese Attrappe, die mitzaehlt und nichts tut.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/admin-menue-schau.mjs
 *   node tools/admin-menue-schau.mjs --ziel http://127.0.0.1:8971/neu/
 *   node tools/admin-menue-schau.mjs --bilder /tmp/admin
 * ENDE 0, wenn jede Aussage haelt.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import WebSocket from 'ws'
import { eigenerBrowser, freierPort, vorschauLeihen } from './leihgabe.mjs'
import { adminAuf } from './admin-weg.mjs'

const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  return i < 0 ? v : argv[i + 1]
}
const MITGEGEBEN = opt('ziel')
const BILDER = opt('bilder')
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/** Der Schirm der Box: 800x480 auf 5 Zoll = 0,1397 mm je Bildpunkt. */
const MM = 0.1397

let fehler = 0
const ja = (b, satz, wie = '') => {
  if (!b) fehler++
  console.log(`${b ? 'ok  ' : 'FEHL'}  ${satz}${wie ? '  — ' + wie : ''}`)
}

/** WAS ES GEBEN MUSS — und ausdruecklich, was es NICHT geben darf. */
const SOLL = [
  // „Funk an und aus" ist am 07.08.2026 dazugekommen — Bluetooth, WLAN und
  // Flugmodus als Schalter. Es ist KEIN Reiter aus der Liste DARF_NICHT
  // darunter: hinter jedem der drei liegt ein Endpunkt (server.ts, /api/funk).
  // „VPN" ist am 13.09.2026 dazugekommen — E30 hat /api/vpn* gebracht, damit
  // ist es aus DARF_NICHT herausgewandert (die Hausregel selbst: „sie kommen
  // dazu, wenn es etwas dahinter gibt, und keinen Tag frueher").
  ['verbindung', 'Verbindung', ['WLAN', 'Bluetooth', 'Funk an und aus', 'VPN']],
  // „Klang" ist am 21.08.2026 dazugekommen (Betreiber: „ich denke es passt in
  // medien") — die Begruendung steht bei ELTERN_PUNKTE in app.js. Die Liste
  // hier hinkte bis zum 13.09.2026 hinterher und meldete den Punkt als
  // Fehler: eine dauerrote Wache, die den naechsten echten Fund verdeckt.
  ['medien', 'Medien', ['Suchen und verwalten', 'Dienste', 'Klang']],
  // „Player" ist am 07.08.2026 dazugekommen — Titel und Album des laufenden
  // Stuecks. Er ist NICHT aus Geschmack entstanden, sondern weil „Indikatoren"
  // mit sieben Zeilen die Karte MITTEN IM KNOPF der sechsten enden liess; die
  // Rechnung steht bei ELTERN_PUNKTE in app.js. Damit hat „Darstellung" als
  // erste Gruppe VIER Punkte — die Aussage „KEIN Knopf endet mitten im
  // Kartenrand" weiter unten misst genau das nach.
  // „Gesten" ist am 21.08.2026 als fuenfter Punkt dazugekommen (Begruendung
  // bei ELTERN_PUNKTE in app.js: Bedienung, nicht Verhalten) — auch er stand
  // bis zum 13.09.2026 nicht in dieser Liste.
  ['anzeige', 'Darstellung', ['Indikatoren', 'Farbe und Form', 'Player', 'Verhalten', 'Gesten']],
  // „Kinder" ist am 07.08.2026 dazugekommen — anlegen, umbenennen, loeschen
  // (Wunsch des Betreibers vom 06.08.: „ein bereich um konten anzulegen bzw zu
  // verwalten"). Dass der fuenfte Punkt in die Karte PASST, ist gemessen:
  // tools/kinder-platz-messen.mjs. Was auf der Seite passiert, misst
  // tools/kinder-seite-schau.mjs; hier zaehlt nur, dass sie in der Gliederung
  // steht und irgendwohin fuehrt.
  // „Akku" ist am 07.08.2026 dazugekommen — die Lade- und Entladekurve
  // (Wunsch des Betreibers vom selben Tag: „ein kleinen battie bereich und
  // mupihat status mit graph wann geladen und wann entladen so wie bei
  // android"). Er steht GLEICH NACH „Info", weil er dessen Kaestchen „Akku"
  // ausklappt; die Begruendung samt der verschobenen Zeile steht bei
  // ELTERN_PUNKTE in app.js. Was auf der Seite passiert, misst
  // tools/akkukurve-schau.mjs — hier zaehlt nur, dass er in der Gliederung
  // steht, seinen ZUSTAND in der Unterzeile traegt und irgendwohin fuehrt.
  //
  // MIT IHM SIND ES SIEBEN PUNKTE, UND DIE KARTE ROLLT. Das ist erlaubt und
  // gemessen: die letzte Zeile (seit dem 14.08.2026 „Plugins") steht angeschnitten
  // da und sagt damit genau, dass es weitergeht. Die Aussage „KEIN Knopf endet
  // mitten im Kartenrand" weiter unten misst, dass dabei kein KNOPF halbiert
  // wird — eine angeschnittene Zeile sieht man an, einen zu 86 Prozent
  // dastehenden Knopf nicht.
  //
  // „KNOPF ZUM AUSSCHALTEN" IST DER SIEBTE (07.08.2026). Er steht NEBEN „Neu
  // laden und neu starten", weil beide vom Ausschalten handeln: dort tut man
  // es, hier stellt man ein, wie lange der Knopf am Gehaeuse dafuer gehalten
  // werden muss. Er ist kein eigener Schirm aus Platzgruenden, sondern weil
  // auf jener Seite keine vierte Zeile mehr hinpasst — die Rechnung dazu
  // steht bei `stromMalen` in app.js.
  [
    'system',
    'System',
    [
      'Info',
      // „Leistung" ist am 20.08.2026 dazugekommen (E58: „performance tab …
      // in graph form") und steht NEBEN „Info", nicht darin — die Begruendung
      // bei ELTERN_PUNKTE in app.js. Bis zum 13.09.2026 fehlte sie hier.
      'Leistung',
      'Akku',
      'Sperre vor diesem Bereich',
      'Neu laden und neu starten',
      'Knopf zum Ausschalten',
      'Benutzer',
      // „PLUGINS" STATT „Weitere Einstellungen ↗" (14.08.2026). Jene Zeile
      // fuehrte auf `/settings` und damit — ueber die Auffangroute von
      // app.routes.ts, NICHT ueber die alte PHP-Oberflaeche — in die
      // Uebersicht der Angular-Verwaltung. Sie ist auf Wunsch des Betreibers
      // entfallen; an derselben Stelle steht jetzt ein Punkt, der ein eigenes
      // Fach hat (tools/plugin-fach-schau.mjs misst es).
      //
      // DIE ZAHL BLEIBT SIEBEN, also auch die Aussage ueber das Rollen
      // darunter: getauscht, nicht hinzugefuegt.
      'Plugins',
    ],
  ],
]
/**
 * DIE DREI, FUER DIE ES AM SERVER NICHTS GIBT.
 *
 * Sie stehen in der Gliederung des Betreibers und NICHT in der Oberflaeche —
 * nachgesehen mit einem grep ueber src/backend-api: keine Route, kein Dienst,
 * keine Konfiguration. Diese Liste ist die Wache dagegen, dass eines Tages
 * jemand „nur mal einen Reiter" dazustellt.
 *
 * VPN STAND HIER BIS ZUM 13.09.2026 — und ist nicht gestrichen, sondern nach
 * SOLL umgezogen: E30 (12.09.2026) hat /api/vpn* samt Dienst gebracht, das
 * Fach auf der Box kam am Tag darauf. Der Weg einer Zeile von dieser Liste
 * in jene ist genau der vorgesehene.
 */
const DARF_NICHT = ['Hotspot', 'Account', 'QR']

// ── Vorschau: eigene oder mitgegebene ──────────────────────────────────────
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
// keine, startet vorschauLeihen dort selbst eine und beendet sie am Ende.
// Beides samt der Messungen dahinter: tools/leihgabe.mjs.
const leihe = await vorschauLeihen(ZIEL)
console.log(`ZIEL: ${ZIEL}${leihe.eigene ? '  (eigene Vorschau)' : '  (mitgegeben)'}`)

// ══ DIESES WERKZEUG MISST EINE VORSCHAU, NICHT EINE BOX ═══════════════════
//
// Am 14.08.2026 wurde es gegen `http://192.168.178.57:8200/neu/` gefahren und
// meldete zwoelf Beanstandungen samt Absturz. KEINE davon kam aus der
// Oberflaeche: die festen Wartezeiten (`warte(800)` nach einem Gruppenwechsel)
// sind auf eine Vorschau auf demselben Rechner geschnitten. Ueber WLAN zu
// einem Raspberry laufen sie ab, bevor gezeichnet ist — und was danach
// gemessen wird, ist der Schirm von vorher.
//
// Ausserdem stellt es LAGEN (`/vorschau/…`) und drueckt am Ende wirklich auf
// „Box ausschalten". An einer echten Box waere das keine Messung, sondern ein
// Eingriff.
//
// Es bricht deshalb NICHT ab — wer weiss, was er tut, darf —, aber es sagt es.
if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(ZIEL)) {
  console.log('')
  console.log('  ⚠ ZIEL ist keine Vorschau auf diesem Rechner.')
  console.log('    Die Wartezeiten hier sind darauf geschnitten; ueber das Netz misst dieses')
  console.log('    Werkzeug den Schirm von vorher und meldet Fehler, die es nicht gibt.')
  console.log('    Und es DRUECKT auf „Box ausschalten" — an einem echten Geraet ist das')
  console.log('    kein Messen. Fuer die Box: tools/plugin-fach-schau.mjs.')
  console.log('')
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

/**
 * DER MITSCHREIBER FUER `fetch` — die Frage „geht ein Abruf hinaus?" laesst
 * sich am Schirm nicht ansehen.
 *
 * Zwei Aussagen haengen daran: dass vor dem geloesten Tor NICHTS abgerufen
 * wird, und dass ein „Abbrechen" in der Ausschalt-Rueckfrage KEINEN Aufruf
 * hinterlaesst. Beides sieht ohne Mitschreiber genau richtig aus.
 */
const MITSCHREIBER = `(() => {
  if (window.__rufe) return true
  window.__rufe = []
  const echt = window.fetch
  window.fetch = function (u, o) {
    try {
      window.__rufe.push({
        pfad: String(typeof u === 'string' ? u : (u && u.url) || ''),
        art: (o && o.method) || 'GET',
      })
    } catch { /* ein Abruf, den wir nicht lesen koennen, wird nicht gezaehlt */ }
    return echt.apply(this, arguments)
  }
  return true
})()`

const browser = await eigenerBrowser({ fenster: '800,480' }).catch(async (e) => {
  // Scheitert der Browserstart, ist das finally unten noch nicht erreicht —
  // die geliehene Vorschau muss trotzdem zurueck.
  await leihe.zurueckgeben()
  console.error(`  Browser kam nicht hoch — Messung nicht moeglich: ${e.message}`)
  process.exit(2)
})
if (!browser) {
  await leihe.zurueckgeben()
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}
let ws = null
try {
  if (BILDER) await mkdir(BILDER, { recursive: true })
  ws = new WebSocket(await browser.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  })

  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const stand = async (w) => {
    await fetch(new URL(`/vorschau/${w}`, ZIEL)).catch(() => null)
    await warte(120)
  }
  const laden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
    await ev(MITSCHREIBER)
  }
  const bild = async (name) => {
    if (!BILDER) return
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(join(BILDER, `${name}.png`), Buffer.from(s.data, 'base64'))
    console.log(`      Bild: ${join(BILDER, `${name}.png`)}`)
  }
  const hinein = async () => {
    // HIER STAND EIN GRIFF ANS ZAHNRAD `#einst-knopf`. Es ist am 06.08.2026
    // ersatzlos entfallen; hinein fuehrt der Schriftzug `#wappen`. Dieser Weg
    // ist der TASTATURWEG und prueft das Halten NICHT — tools/admin-weg.mjs.
    await adminAuf(ev, { warteMs: 1100 })
  }
  /**
   * DIE RECHENAUFGABE LOESEN — sie steht am Schirm, also wird sie GELESEN.
   *
   * Nicht aus `eltern.aufgabe` abgegriffen: dass die Zahl DASTEHT, ist ein
   * Teil der Sperre. Wer sie aus dem Zustand naehme, misse eine Aufgabe, die
   * auch unsichtbar sein duerfte.
   */
  const rechnen = async () => {
    const f = await ev(`(document.getElementById('tor-frage')||{}).textContent || ''`)
    const m = String(f).match(/(\d+)\s*×\s*(\d+)/)
    if (!m) return false
    for (const z of String(Number(m[1]) * Number(m[2])))
      await ev(`document.querySelector('#tor-feld [data-taste="${z}"]').click()`)
    await ev(`document.querySelector('#tor-feld .tor-weiter').click()`)
    await warte(900)
    return true
  }

  /** Eine Gruppe in der Spalte antippen — ueber `data-fach`, nicht ueber Text. */
  const gruppe = async (id) => {
    await ev(`document.querySelector('#eltern-faecher [data-fach="${id}"]').click()`)
    await warte(800)
  }
  /**
   * EINE ZEILE ANTIPPEN — ueber den NAMEN, wie ein Mensch, und nicht ueber die
   * Nummer. Eine Zeile, die woanders hinrutscht, soll die Aussage nicht still
   * auf eine andere umlenken.
   *
   * ZWEI SORTEN ZEILE, und beide werden getroffen: In einer Unterseite ist der
   * Knopf IN der Zeile (`.zeile-tat`), in einer Uebersicht IST die Zeile der
   * Knopf (`.fach-sprung`). Wer nur `.zeile-tat` sucht, misst die Uebersicht
   * als „nicht anklickbar" — sie waere es aber, und der Bericht loege.
   */
  const zeile = async (name) => {
    const ok = await ev(`(() => {
      for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
        const n = z.querySelector('.zeile-name')
        if (!n || !n.textContent.trim().startsWith(${JSON.stringify(name)})) continue
        const k = z.querySelector('.zeile-tat')
        if (k) { k.click(); return true }
        if (z.tagName === 'BUTTON') { z.click(); return true }
      }
      return false })()`)
    await warte(800)
    return ok === true
  }
  /** Der EINE Rueckweg oben links — derselbe Knopf, den ein Finger traefe. */
  const zurueck = async () => {
    await ev(`document.getElementById('zurueck').click()`)
    await warte(600)
  }
  /**
   * DIE ZWEI FRAGEN AN JEDE SEITE MIT FESTER ZEILENZAHL — an EINER Stelle.
   *
   * Sie wurden zuerst nur an den Uebersichten gestellt und haben dort einen
   * echten Fehler gefunden (ein Knopf zu 86 %). Danach zeigten die
   * Bildschirmfotos denselben Fehler auf der Seite „Sperre" und auf „Farbe und
   * Form" — dieselbe Ursache, andere Seite. Eine Aussage, die nur an einer
   * Stelle gilt, findet den Fehler einmal und laesst ihn zweimal stehen.
   *
   * NICHT FUER OFFENE LISTEN. WLAN, Bluetooth und die Mediensuche zeigen so
   * viele Zeilen, wie es gerade gibt — zwoelf Netze rollen immer, und an
   * welcher Stelle der Rand dabei faellt, ist niemandes Entscheidung. Die
   * Regel gilt fuer Seiten, deren Zeilenzahl im Code steht.
   */
  const kartePruefen = async (wo) => {
    const m = JSON.parse(
      await ev(`JSON.stringify((() => {
        const f = document.getElementById('fach-zeilen')
        const fr = f.getBoundingClientRect()
        const zeilen = [...f.querySelectorAll('.fach-zeile')].map((z) => {
          const r = z.getBoundingClientRect()
          const k = z.querySelector('.zeile-tat')
          const kr = k ? k.getBoundingClientRect() : null
          const teil = (a, b) => Math.max(0, Math.min(b.bottom, fr.bottom) - Math.max(b.top, fr.top))
          return {
            n: (z.querySelector('.zeile-name')||{}).textContent || '',
            zeilePx: Math.round(teil(0, r)),
            knopfTeil: kr && kr.height ? teil(0, kr) / kr.height : null,
          }
        })
        return { sicht: Math.round(fr.height), inhalt: Math.round(f.scrollHeight), zeilen }
      })())`),
    )
    console.log(`      ${wo}: ${m.sicht} px Sicht, ${m.inhalt} px Inhalt${m.inhalt > m.sicht + 1 ? ' — rollt' : ''}`)
    const weg = m.zeilen.filter((z) => z.zeilePx < 10)
    ja(
      weg.length === 0,
      `   ${wo}: von jeder Zeile sind mindestens 10 px zu sehen`,
      weg.map((z) => z.n).join(', ') || '—',
    )
    const heikel = m.zeilen.filter((z) => z.knopfTeil !== null && z.knopfTeil > 1 / 3 && z.knopfTeil < 0.95)
    ja(
      heikel.length === 0,
      `   ${wo}: jeder Knopf steht GANZ da oder nur als Schnipsel`,
      heikel.map((z) => `${z.n} ${Math.round(z.knopfTeil * 100)} %`).join(', ') || '—',
    )
  }

  /** Was gerade am Schirm steht — Ueberschrift, Zeilen, Spalte. */
  const lage = async () =>
    JSON.parse(
      await ev(`JSON.stringify({
        bereich: !document.getElementById('eltern').hidden,
        flaeche: !document.getElementById('eltern-flaeche').hidden,
        tor: !document.getElementById('eltern-tor').hidden,
        kopf: (document.getElementById('fach-name')||{}).textContent || '',
        unter: (document.getElementById('eltern-unter')||{}).textContent || '',
        tat: (() => { const k = document.getElementById('fach-tat'); return k && !k.hidden ? k.textContent : '' })(),
        gruppen: [...document.querySelectorAll('#eltern-faecher .fach-knopf')].map((k) => k.textContent.trim()),
        hier: (document.querySelector('#eltern-faecher .fach-knopf.hier')||{}).textContent || '',
        zeilen: [...document.querySelectorAll('#fach-zeilen .fach-zeile')].map((z) => ({
          name: (z.querySelector('.zeile-name')||{}).textContent || '',
          unter: (z.querySelector('.zeile-unter')||{}).textContent || '',
          knopf: (z.querySelector('.zeile-tat')||{}).textContent || '',
          sprung: z.tagName === 'BUTTON',
          hoch: Math.round(z.getBoundingClientRect().height),
        })),
        trenner: [...document.querySelectorAll('#fach-zeilen .fach-trenner')].map((t) => t.textContent),
      })`),
    )

  // ══ 1. VOR DEM TOR LIEGT NICHTS ═════════════════════════════════════════
  //
  // ZWEI AUSSAGEN UND NICHT EINE. „Unsichtbar" ist zu wenig: ein Stilfehler,
  // der die Flaeche wieder aufdeckt, zeigte sonst alles, was hinter der Sperre
  // liegt. Und ein Abruf, der schon hinausgegangen ist, hat die Auskunft der
  // Box bereits geholt, ob sie jemand sieht oder nicht.
  console.log('\n══ DAS TOR STEHT DAVOR ══════════════════════════════════════')
  await stand('voll')
  await stand('sperre-pin')
  await laden()
  await hinein()
  const vor = await lage()
  ja(
    vor.bereich && vor.tor && !vor.flaeche,
    'das Tor steht, die Flaeche nicht',
    `Tor ${vor.tor}, Flaeche ${vor.flaeche}`,
  )
  ja(vor.gruppen.length === 0, 'KEINE Gruppe im Baum — weggeraeumt, nicht zugedeckt', `${vor.gruppen.length} Gruppen`)
  ja(vor.zeilen.length === 0, 'KEINE Zeile im Baum', `${vor.zeilen.length} Zeilen`)
  const rufeVor = JSON.parse(await ev(`JSON.stringify(window.__rufe || [])`))
  /* `/api/darstellung` STEHT NICHT IN DIESER LISTE, und das ist eine
   * Feststellung und keine Ausnahme: Es wird vom TAKT der Seite selbst geholt
   * (`anwenden()`), damit Kachelgroesse, Form und Kopfzeile stimmen — auf der
   * Startseite, vor jedem Tor, auch wenn niemand jemals ins Admin-Menue geht.
   * Es ist damit keine Auskunft HINTER der Sperre, sondern das Aussehen DAVOR.
   * Beim ersten Lauf stand es hier mit drin und machte die Aussage rot; sie
   * abzuschwaechen waere falsch gewesen, sie zu berichtigen ist richtig.
   *
   * WAS WIRKLICH HINTER DER SPERRE LIEGT und deshalb hier steht: die Netze der
   * Nachbarschaft mit Namen, die gekoppelten Geraete, die halbe Bibliothek des
   * Kindes, die Dienste-Zugaenge, die Adresse und die Zahlen der Box. */
  /* SEIT DEM 06.08.2026 STEHEN `konfiguration` UND `spotify/config` MIT IN
   * DIESER LISTE. Unter „Medien → Dienste" liegen zwei Einrichtungsseiten; sie
   * holen den geschriebenen Stand der Zugaenge (Serveradresse, Client-ID, und
   * ob ein Schluessel hinterlegt ist). Das ist Auskunft ueber die Zugaenge der
   * Box und gehoert hinter dieselbe Sperre wie die Netze der Nachbarschaft. */
  const verboten = rufeVor.filter((r) =>
    /\/api\/(netzwerk|bluetooth|medien|musikdienste|spotify\/bereit|spotify\/config|konfiguration|dienste|system|mupihat)/.test(
      r.pfad,
    ),
  )
  ja(
    verboten.length === 0,
    'und KEIN Abruf hinter die Sperre, solange das Tor steht',
    verboten.map((r) => r.art + ' ' + r.pfad).join(', ') || 'keiner',
  )
  await bild('0-tor')

  // ══ 2. DIE VIER GRUPPEN UND IHRE PUNKTE ═════════════════════════════════
  console.log('\n══ VIER GRUPPEN, ELF PUNKTE ═════════════════════════════════')
  await stand('sperre-aus')
  await laden()
  await hinein()
  const auf = await lage()
  ja(auf.flaeche && !auf.tor, 'ohne Sperre steht die Flaeche sofort da', `Tor ${auf.tor}`)
  ja(
    auf.gruppen.join(' · ') === SOLL.map((s) => s[1]).join(' · '),
    'VIER Gruppen in der Spalte, in der Reihenfolge der Gliederung',
    auf.gruppen.join(' · '),
  )
  ja(auf.hier === 'Verbindung', 'und „Verbindung" ist aufgeschlagen', auf.hier)

  for (const [id, wort, punkte] of SOLL) {
    console.log(`\n── Gruppe „${wort}" ──────────────────────────────────────`)
    await gruppe(id)
    const u = await lage()
    // BERICHTIGT AM 06.08.2026 ABENDS. Hier stand `u.kopf === wort` — „die
    // Karte traegt die Ueberschrift ‚Verbindung'". Der Betreiber hat genau
    // diese Ueberschrift streichen lassen („das wiederholen des namens
    // verbindung im ‚kasten' ist nicht nötig"), und damit fiel nicht nur diese
    // Aussage, sondern auch die ueber den Rueckweg weiter unten — die benutzte
    // den Kopf als ERKENNUNGSMERKMAL fuer die Ebene.
    //
    // DAS WAR DER EIGENTLICHE FEHLER, und er ist aelter als die Streichung:
    // Ein Nebenprodukt der Gestaltung als Beweis fuer den Zustand zu nehmen
    // heisst, dass jede Aenderung an der Gestaltung eine Aussage ueber die
    // BEDIENUNG umwirft. Gemessen wird jetzt die Unterzeile — sie ist der Weg
    // („Verbindung" auf der Uebersicht, „Verbindung · WLAN" darunter) und
    // damit die einzige Angabe, die es GIBT, weil sie etwas sagt.
    ja(u.unter === wort && u.kopf === '', `die Uebersicht der Gruppe „${wort}" steht (ohne doppelte Ueberschrift)`,
       `Unterzeile „${u.unter}", Kopf „${u.kopf}"`)
    ja(u.hier === wort, 'und die Spalte hebt sie hervor', u.hier)
    ja(u.tat === '', 'die Uebersicht hat KEINEN Knopf im Kopf (26 px mehr fuer die Zeilen)', u.tat || '—')
    ja(
      u.zeilen.map((z) => z.name).join(' · ') === punkte.join(' · '),
      `${punkte.length} Punkte, und genau die`,
      u.zeilen.map((z) => z.name).join(' · '),
    )
    ja(
      u.zeilen.every((z) => z.sprung),
      'jede Zeile der Uebersicht IST der Knopf — kein inneres Ziel zum Anschneiden',
      u.zeilen.map((z) => (z.sprung ? '·' : z.name)).join(' '),
    )
    ja(
      u.zeilen.every((z) => z.unter.trim() !== ''),
      'jede Zeile sagt in der Unterzeile, was dahinter steht',
      u.zeilen.map((z) => z.unter.slice(0, 24)).join(' | '),
    )
    const boese = u.zeilen.filter((z) => DARF_NICHT.some((w) => z.name.includes(w)))
    ja(
      boese.length === 0,
      'und kein Punkt, hinter dem es am Server nichts gibt',
      boese.map((z) => z.name).join(', ') || 'keiner',
    )
    await bild(`1-gruppe-${id}`)

    /* ══ WAS VON DER LETZTEN ZEILE ZU SEHEN IST — DIE FRAGE, DIE FEHLTE ═══
     *
     * Rollen ist in der Karte erlaubt, solange die naechste Zeile ANGESCHNITTEN
     * dasteht — das ist die Hausregel und wird hier nicht neu verhandelt. Was
     * NICHT erlaubt ist, ist ein halber KNOPF: „eine Karte, die mitten im Knopf
     * endete" war am 06.08.2026 schon einmal ein echter Befund, den 26 gruene
     * Aussagen nicht sahen, weil keine von ihnen nach dem angeschnittenen ZIEL
     * fragte (app.css, `.fach-kopf.ohne-tat`).
     *
     * DIE MARKE: Ein Knopf ist entweder GANZ zu sehen oder GAR NICHT. Alles
     * dazwischen verspricht ein Ziel, von dem niemand weiss, ob es traegt —
     * und ein halb sichtbarer Knopf ist beim Tippen genau so gross, wie er
     * aussieht, also unter der 9-mm-Marke.
     */
    const schnitt = JSON.parse(
      await ev(`JSON.stringify((() => {
        const f = document.getElementById('fach-zeilen')
        const fr = f.getBoundingClientRect()
        const halbe = []
        for (const z of f.querySelectorAll('.fach-zeile')) {
          const k = z.querySelector('.zeile-tat')
          if (!k) continue
          const r = k.getBoundingClientRect()
          const sicht = Math.max(0, Math.min(r.bottom, fr.bottom) - Math.max(r.top, fr.top))
          if (sicht > 0.5 && sicht < r.height - 0.5)
            halbe.push(((z.querySelector('.zeile-name')||{}).textContent||'') + ': ' + Math.round(sicht) + ' von ' + Math.round(r.height) + ' px')
        }
        return { sicht: Math.round(fr.height), inhalt: Math.round(f.scrollHeight), rollt: f.scrollHeight > f.clientHeight + 1, halbe }
      })())`),
    )
    console.log(
      `      Karte: ${schnitt.sicht} px Sicht, ${schnitt.inhalt} px Inhalt${schnitt.rollt ? ' — sie rollt' : ''}`,
    )
    const zuKlein = u.zeilen.filter((z) => z.hoch * MM < 9)
    ja(
      zuKlein.length === 0,
      'jede Zeile haelt die 9-mm-Marke',
      zuKlein.map((z) => `${z.name} ${(z.hoch * MM).toFixed(2)} mm`).join(', ') ||
        `${u.zeilen[0].hoch} px = ${(u.zeilen[0].hoch * MM).toFixed(2)} mm`,
    )
    ja(
      schnitt.halbe.length === 0,
      'KEIN Knopf endet mitten im Kartenrand — ganz zu sehen oder gar nicht',
      schnitt.halbe.join(' | ') || 'keiner',
    )

    // ── JEDER PUNKT FUEHRT WIRKLICH IRGENDWOHIN, UND DER RUECKWEG ZURUECK ──
    for (const name of punkte) {
      // Der Sprung in die alte Oberflaeche wird NICHT gefahren: er verlaesst
      // diese Seite, und ein Werkzeug, das dabei die Seite wechselt, misst
      // danach eine andere.
      if (name.includes('↗')) {
        console.log(`      „${name}" ist ein Sprung in die bisherige Oberflaeche — nicht gefahren`)
        continue
      }
      const traf = await zeile(name)
      const s = await lage()
      ja(traf && s.kopf !== wort, `„${name}" fuehrt auf eine eigene Seite`, `Ueberschrift „${s.kopf}"`)
      // EIN BILD JE UNTERSEITE, und zwar von JEDER. Zwei echte Befunde dieses
      // Umbaus haben nicht die Messungen gefunden, sondern ein Blick auf ein
      // Bild — ein Knopf, der zu 86 % dastand, und ein Absatz, der aussah wie
      // das Ende der Seite. Bilder kosten Millisekunden.
      await bild(
        `4-${id}-${name
          .replace(/[^a-zA-Z]+/g, '-')
          .toLowerCase()
          .slice(0, 20)}`,
      )
      // WLAN, Bluetooth und die Mediensuche sind OFFENE Listen — siehe
      // `kartePruefen`. Alles Uebrige hat eine Zeilenzahl, die im Code steht.
      if (!['WLAN', 'Bluetooth', 'Suchen und verwalten'].includes(name)) await kartePruefen(name)
      ja(s.hier === wort, '   und die Spalte bleibt auf der Gruppe stehen', s.hier)
      await zurueck()
      const z = await lage()
      ja(
        z.bereich && z.unter === wort && z.kopf === '',
        '   der EINE Rueckweg fuehrt EINE Ebene zurueck',
        `„${z.kopf}", Bereich ${z.bereich}`,
      )
    }
  }

  /* ══ DAS BLUETOOTH-ZEICHEN FUEHRT INS BLUETOOTH-FACH ══════════════════════
   *
   * DIESE AUSSAGE HAT BEIM UMBAU EINEN ECHTEN FEHLER GEFUNDEN, und zwar einen,
   * der seit dem 06.08.2026 im ausgelieferten Stand stand: `eltern.auf()`
   * setzte das gewuenschte Fach VOR `raeumen()` — und `raeumen()` setzt es
   * zurueck. Der Tipp aufs Bluetooth-Zeichen der Kopfzeile landete also im
   * WLAN-Fach. Der Kommentar daneben behauptete, `raeumen()` sei schon
   * gelaufen; er stand zwei Zeilen ueber dem Aufruf.
   *
   * WARUM ES NIEMAND SAH: Kein Werkzeug fragte, WELCHES Fach nach dem Zeichen
   * offensteht — nur, ob der Bereich aufgeht. Das tat er. Die Beschwerde des
   * Betreibers („wenn ich auf den bluetooth indicator klicke erscheint das
   * alte bluetooth menu nicht das neue") war damit halb behoben: die alte
   * Oberflaeche kam nicht mehr, das richtige Fach aber auch nicht.
   */
  console.log('\n══ DAS BLUETOOTH-ZEICHEN ════════════════════════════════════')
  await stand('sperre-aus')
  await stand('bt-verbunden')
  await laden()
  const bt = await ev(`(() => { const k = document.getElementById('bt-knopf')
    if (!k || k.hidden) return 'kein Zeichen'
    k.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    k.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    k.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 'ok' })()`)
  await warte(1200)
  if (bt !== 'ok') {
    console.log(`      das Bluetooth-Zeichen steht nicht am Schirm (${bt}) — uebersprungen`)
  } else {
    const z = await lage()
    ja(z.kopf === 'Bluetooth', 'ein Tipp aufs Bluetooth-Zeichen landet in der GERAETELISTE', z.kopf)
    ja(z.hier === 'Verbindung', 'und die Spalte steht auf „Verbindung"', z.hier)
    await zurueck()
    // Uebersicht heisst: Unterzeile traegt die Gruppe, Kopf ist LEER (siehe
    // die Begruendung weiter oben — der Kopf ist seit dem 06.08. kein
    // Erkennungsmerkmal mehr).
    ja((await lage()).unter === 'Verbindung' && (await lage()).kopf === '',
       'der Rueckweg fuehrt von dort in die Uebersicht', '')
  }

  // ══ 3. DER RUECKWEG VERLAESST DEN BEREICH — ABER ERST GANZ UNTEN ════════
  //
  // MIT GESETZTER SPERRE UND NICHT OHNE, und das war beim ersten Lauf ein
  // Befund an diesem Werkzeug selbst: Bei `sperre-aus` traegt die Zeile „Keine
  // Sperre" GAR KEINEN Knopf (`wort: ''` — die gewaehlte Art hat nichts zu
  // tun), der Griff ging also ins Leere und die Rueckfrage stand nie. Die
  // Aussage ueber den Rueckweg braucht die tiefste Ebene, also braucht sie
  // eine Sperre, die noch nicht „aus" ist.
  console.log('\n══ DER RUECKWEG, GANZ HINUNTER ══════════════════════════════')
  await stand('sperre-rechnen')
  await laden()
  await hinein()
  ja(await rechnen(), 'die Rechenaufgabe steht am Schirm und laesst sich loesen', '')
  await gruppe('system')
  await zeile('Sperre vor diesem Bereich')
  await zeile('Keine Sperre')
  const rf = await lage()
  ja(rf.kopf === 'Sperre abschalten?', 'die Rueckfrage vor „keine Sperre" steht', rf.kopf)
  await zurueck()
  ja((await lage()).kopf === 'Sperre', 'ein Tipp raeumt die Rueckfrage ab', '')
  await zurueck()
  ja((await lage()).unter === 'System' && (await lage()).kopf === '',
     'der naechste die Uebersicht der Gruppe', '')
  await zurueck()
  const raus = await lage()
  ja(!raus.bereich, 'und erst der dritte den ganzen Bereich', `Bereich ${raus.bereich}`)
  // DREI EBENEN SIND HIER DIE TIEFSTEN — UND NICHT DIE TIEFSTEN DES BEREICHS.
  // Die Medien haben vier (Uebersicht, Liste, Blatt, Loeschfrage). Die
  // Aussage darueber steht in tools/admin-nichts-verloren.mjs und nicht hier:
  // dieses Werkzeug beschreibt die Gliederung, jenes die Bedienungen.
  console.log('      (die vier Ebenen der Medien misst tools/admin-nichts-verloren.mjs)')

  // ══ 4. NEUSTART UND AUSSCHALTEN ═════════════════════════════════════════
  console.log('\n══ NEU STARTEN UND AUSSCHALTEN ══════════════════════════════')
  // DIE SPERRE ZURUECK AUF „aus". Der Abschnitt darueber hat sie auf „rechnen"
  // gestellt; ohne diese Zeile stuende ab hier bei jedem `hinein()` das Tor,
  // und ALLE folgenden Aussagen fielen mit derselben Ursache. Beim ersten Lauf
  // waren das zwoelf rote Zeilen fuer EINEN vergessenen Schalter.
  await stand('sperre-aus')
  await stand('strom-zaehler-weg')
  await stand('spielt')
  await laden()
  await hinein()
  await gruppe('system')
  await zeile('Neu laden und neu starten')
  const st = await lage()
  ja(st.kopf === 'Neu laden und neu starten', 'die Seite steht', st.kopf)
  ja(
    st.zeilen.map((z) => z.name).join(' · ') === 'Oberfläche neu laden · Box neu starten · Box ausschalten',
    'drei Zeilen, und die harmlose steht OBEN',
    st.zeilen.map((z) => z.name).join(' · '),
  )
  ja(st.trenner.length === 1, 'ein Abstandhalter zwischen den beiden gefaehrlichen', st.trenner.join('') || '—')

  /* ══ UND „AUSSCHALTEN" IST AUCH ZU SEHEN ═══════════════════════════════
   *
   * BEIM ERSTEN BAU WAR ES DAS NICHT (Bild 2-strom.png): der Abstandhalter
   * stand als Letztes im Bild, „Box ausschalten" lag vollstaendig darunter,
   * und nichts am Schirm sagte, dass es weitergeht — der Absatz sah aus wie
   * das Ende der Seite. Ein Ziel, von dem NICHTS zu sehen ist, ist auf einem
   * Beruehrschirm nicht vorhanden; das ist dieselbe Regel, die in der
   * Faecherspalte das sechste Fach verbietet.
   *
   * DIE MARKE SIND 10 PX, und sie ist nicht gegriffen: im Fach „Box" standen
   * 15 px der Zeile „Weitere Einstellungen ↗" da und galten ausdruecklich als
   * genug (app.css, `.fach-kopf.ohne-tat`). Weniger als 10 px ist ein Rand
   * und keine Zeile. */
  const sichtbar = JSON.parse(
    await ev(`JSON.stringify((() => {
      const f = document.getElementById('fach-zeilen')
      const fr = f.getBoundingClientRect()
      return [...f.querySelectorAll('.fach-zeile')].map((z) => {
        const r = z.getBoundingClientRect()
        return {
          n: (z.querySelector('.zeile-name')||{}).textContent || '',
          px: Math.round(Math.max(0, Math.min(r.bottom, fr.bottom) - Math.max(r.top, fr.top))),
        }
      })
    })())`),
  )
  ja(
    sichtbar.every((z) => z.px >= 10),
    'von JEDER der drei Zeilen sind mindestens 10 px zu sehen — auch von „Ausschalten"',
    sichtbar.map((z) => `${z.n}: ${z.px} px`).join(' | '),
  )

  /* ══ UND DER ANSCHNITT SIEHT AUCH WIE EINER AUS ════════════════════════
   *
   * DIESE SEITE ROLLT, und das laesst sich nicht wegbauen: drei Zeilen zu
   * 78 px, ein Abstandhalter zu 40 px und zwei gaps sind 298 px in 235. Was
   * sich sehr wohl entscheiden laesst, ist WIE VIEL vom letzten Knopf dasteht.
   *
   * DIE REGEL, IN EINER ZAHL: entweder GANZ (mindestens 95 %) oder als
   * SCHNIPSEL (hoechstens ein Drittel). Dazwischen liegt der Fall, der schon
   * zweimal durchgerutscht ist — ein Knopf zu 86 %, der ganz aussieht und
   * keiner ist.
   *
   * WARUM EIN DRITTEL ZUGELASSEN IST UND NICHT NULL: Ein angeschnittener
   * Knopf ist die einzige Auskunft am Schirm, dass es weitergeht. Und ein
   * Fehlgriff darauf kostet hier NICHTS — er oeffnet die Rueckfrage, nicht
   * das Ausschalten. Genau dafuer steht die Rueckfrage da. */
  const anschnitt = JSON.parse(
    await ev(`JSON.stringify((() => {
      const f = document.getElementById('fach-zeilen')
      const fr = f.getBoundingClientRect()
      return [...f.querySelectorAll('.fach-zeile')].map((z) => {
        const k = z.querySelector('.zeile-tat')
        if (!k) return null
        const r = k.getBoundingClientRect()
        const sicht = Math.max(0, Math.min(r.bottom, fr.bottom) - Math.max(r.top, fr.top))
        return { n: (z.querySelector('.zeile-name')||{}).textContent || '', teil: r.height ? sicht / r.height : 0 }
      }).filter(Boolean)
    })())`),
  )
  const heikel = anschnitt.filter((k) => k.teil > 1 / 3 && k.teil < 0.95)
  ja(
    heikel.length === 0,
    'jeder Knopf steht GANZ da oder nur als Schnipsel — nichts dazwischen',
    anschnitt.map((k) => `${k.n}: ${Math.round(k.teil * 100)} %`).join(' | '),
  )
  await bild('2-strom')

  // ── DER ABSTAND, IN MILLIMETERN UND NICHT ALS ABSICHT ─────────────────
  const abstand = JSON.parse(
    await ev(`JSON.stringify((() => {
      const k = [...document.querySelectorAll('#fach-zeilen .fach-zeile')].map((z) => {
        const n = (z.querySelector('.zeile-name')||{}).textContent || ''
        const b = z.querySelector('.zeile-tat')
        return { n, r: b ? b.getBoundingClientRect() : null }
      })
      const a = k.find((x) => x.n.startsWith('Box neu starten'))
      const b = k.find((x) => x.n.startsWith('Box ausschalten'))
      if (!a || !b || !a.r || !b.r) return null
      return { luecke: Math.round(b.r.top - a.r.bottom) }
    })())`),
  )
  ja(
    abstand && abstand.luecke * MM >= 2,
    'zwischen „Neu starten" und „Ausschalten" liegen mindestens 2 mm',
    abstand ? `${abstand.luecke} px = ${(abstand.luecke * MM).toFixed(2)} mm` : 'nicht gefunden',
  )

  /* ══ 4b. DER KNOPF AM GEHAEUSE ══════════════════════════════════════════
   *
   * WAS HIER GEMESSEN WIRD, IST NICHT „steht die Seite", sondern die zwei
   * Aussagen, an denen sie haengt:
   *
   *   DIE ZAHL AM SCHIRM IST DIE DER BOX. Die Seite holt sie aus
   *   `/api/konfiguration`; stuende dort eine Voreinstellung aus dem Kopf der
   *   Oberflaeche, waere das an genau dieser Stelle teuer — wer „2 Sekunden"
   *   liest, obwohl 5 gelten, haelt zu kurz, haelt dann laenger, und bei
   *   sechs Sekunden nimmt die Platine den Strom weg.
   *
   *   DER SATZ ZUM HARTEN AUS STEHT DA. Eine nackte Zahl sagt einem
   *   Elternteil nichts, und die Obergrenze 5 sieht ohne ihn nach Willkuer
   *   aus. Genau danach hat der Betreiber gefragt.
   */
  console.log('\n══ DER KNOPF AM GEHAEUSE ════════════════════════════════════')
  await zurueck()
  await zeile('Knopf zum Ausschalten')
  const kn = await lage()
  ja(kn.kopf === 'Knopf zum Ausschalten', 'die Seite steht', kn.kopf)
  ja(kn.zeilen.length === 1, 'genau EINE Zeile — hier wird eine Zahl gestellt, nichts getan',
     kn.zeilen.map((z) => z.name).join(' · '))
  const kz = kn.zeilen[0] || {}
  ja(
    /Jetzt 2 Sekunden\./.test(kz.unter || ''),
    'die Unterzeile nennt den Stand der Box und nicht eine Vorgabe',
    kz.unter || '—',
  )
  ja(
    /muss der Knopf gehalten werden, bis die Box herunterfährt/.test(kz.unter || ''),
    'und sie sagt, WAS dabei passiert',
    kz.unter || '—',
  )
  ja(kz.knopf === '3 Sekunden', 'der Knopf traegt den NAECHSTEN Wert, nicht den jetzigen', kz.knopf || '—')
  ja(
    kn.trenner.length === 1 && /ab 6 Sekunden/.test(kn.trenner.join(' ')),
    'der Absatz sagt, dass ab 6 Sekunden die Platine hart abschaltet',
    kn.trenner.join(' ') || '—',
  )
  await bild('7-knopf')

  // ── WEITERSCHALTEN: 2 → 3, UND DIE BOX WEISS ES DANACH ────────────────
  await zeile('Halten zum Ausschalten')
  await warte(400)
  const kn2 = await lage()
  ja(
    /Jetzt 3 Sekunden\./.test((kn2.zeilen[0] || {}).unter || ''),
    'ein Tipp stellt 3 Sekunden ein — und die Zeile sagt es',
    (kn2.zeilen[0] || {}).unter || '—',
  )
  ja(
    (kn2.zeilen[0] || {}).knopf === '4 Sekunden',
    'und der Knopf zeigt den naechsten Wert',
    (kn2.zeilen[0] || {}).knopf || '—',
  )
  // DER RUNDLAUF ENDET BEI DER UNTERGRENZE UND NICHT BEI NULL. Dreimal
  // weiter (4, 5, dann wieder 2) — und die 2 ist der Punkt: ein Knopf, der
  // ueber 1 auf 0 liefe, baute in vier Tipps die Sackgasse.
  await zeile('Halten zum Ausschalten')
  await warte(400)
  await zeile('Halten zum Ausschalten')
  await warte(400)
  await zeile('Halten zum Ausschalten')
  await warte(400)
  const kn3 = await lage()
  ja(
    /Jetzt 2 Sekunden\./.test((kn3.zeilen[0] || {}).unter || ''),
    'nach 5 kommt wieder 2 und NICHT 1 oder 0',
    (kn3.zeilen[0] || {}).unter || '—',
  )
  await zurueck()
  await zeile('Neu laden und neu starten')

  // ── DIE RUECKFRAGE SAGT, WAS GERADE LAEUFT ────────────────────────────
  await zeile('Box ausschalten')
  const frage = await lage()
  await bild('5-ausschalten-frage')
  ja(frage.kopf === 'Box ausschalten?', 'sie fragt nach', frage.kopf)
  const satz = (frage.zeilen[0] || {}).unter || ''
  ja(/läuft|angehalten/.test(satz), 'und sie sagt, was gerade mit der Musik passiert', satz)
  ja(
    (frage.zeilen[0] || {}).knopf === 'Abbrechen' && /^Ja,/.test((frage.zeilen[1] || {}).name || ''),
    'oben der Abbruch, unten die Tat',
    frage.zeilen.map((z) => z.name).join(' · '),
  )

  // ── ABBRECHEN SCHICKT NICHTS HINAUS ───────────────────────────────────
  await zeile('Das passiert jetzt')
  const nachAbbruch = JSON.parse(await ev(`JSON.stringify(window.__rufe || [])`)).filter((r) =>
    /\/api\/(reboot|shutdown)/.test(r.pfad),
  )
  ja(nachAbbruch.length === 0, 'ein Abbruch schickt KEINEN Aufruf hinaus', `${nachAbbruch.length} Aufrufe`)
  ja((await lage()).kopf === 'Neu laden und neu starten', 'und fuehrt auf die Seite zurueck', '')

  // ── UND EIN „JA" SCHICKT GENAU EINEN ──────────────────────────────────
  await zeile('Box ausschalten')
  await zeile('Ja, Box ausschalten')
  await warte(600)
  const rufe = await (await fetch(new URL('/vorschau/strom-rufe', ZIEL))).json()
  ja(
    rufe.rufe.length === 1 && rufe.rufe[0] === '/api/shutdown',
    'ein „Ja" schickt GENAU EINEN Aufruf, und den richtigen',
    rufe.rufe.join(', ') || 'keinen',
  )
  const danach = await lage()
  ja(
    /fährt herunter/i.test(
      danach.zeilen.map((z) => z.unter).join(' ') +
        (await ev(`(document.getElementById('fach-hinweis')||{}).textContent||''`)),
    ),
    'und der Schirm sagt, dass sie herunterfaehrt',
    await ev(`(document.getElementById('fach-hinweis')||{}).textContent||''`),
  )
  ja(
    await ev(`[...document.querySelectorAll('#fach-zeilen .zeile-tat')].every((k) => k.disabled)`),
    'die Knoepfe bleiben danach gesperrt — ein zweiter Druck bessert nichts',
    '',
  )

  // ══ 5. DIE DIENST-ZEILEN ════════════════════════════════════════════════
  console.log('\n══ DIE DIENSTE — EINGERICHTET UND ERREICHBAR ════════════════')
  await stand('sperre-aus')
  for (const [was, erwartet] of [
    ['ok', /Eingerichtet und erreichbar/],
    ['leer', /Nicht eingerichtet/],
    ['spotify-weg', /antwortet gerade nicht/],
    ['unpruefbar', /nicht zu prüfen/],
  ]) {
    await stand(`musikdienste-${was}`)
    await laden()
    await hinein()
    await gruppe('medien')
    await zeile('Dienste')
    const d = await lage()
    const sp = (d.zeilen.find((z) => z.name === 'Spotify') || {}).unter || ''
    ja(erwartet.test(sp), `„${was}": die Spotify-Zeile sagt es`, sp)
    if (was === 'ok') {
      ja(
        (d.zeilen.find((z) => z.name === 'Auf der Box') || {}).knopf === '',
        'und „Auf der Box" hat KEINEN Knopf — dort ist nichts einzurichten',
        (d.zeilen.find((z) => z.name === 'Auf der Box') || {}).knopf || '—',
      )
      await bild('3-dienste')
    }
  }
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen()
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await leihe.zurueckgeben()
}

console.log(`\n${fehler === 0 ? 'ALLES GRUEN' : `${fehler} AUSSAGE(N) GEFALLEN`}`)
process.exit(fehler === 0 ? 0 : 1)
