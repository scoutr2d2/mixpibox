#!/usr/bin/env node
/**
 * FINGER-BEDIENUNG — die beruehrungsabhaengigen Bedienungen der neuen
 * Oberflaeche mit ECHTEN Beruehrungen durchgehen, jede mit MAUS-GEGENPROBE.
 *
 * ══ WOZU ES DIESES WERKZEUG GIBT ═══════════════════════════════════════════
 *
 * Am 06.08.2026 meldete der Betreiber vom Geraet zwei Fehler in einem Satz.
 * Beide lagen in Bedienungen, die mit Werkzeugen abgenommen worden waren,
 * welche sie PRINZIPIELL nicht sehen konnten: 51 von 53 treibenden Werkzeugen
 * dieses Baumes benutzen die Maus (Inventur in tools/finger.mjs). Sechs davon
 * geben `pointerType: 'touch'` mit und halten sich deshalb faelschlich fuer
 * nicht blind.
 *
 * Mit der MAUS kommt `pointercancel` NIE. Jede Zeile der Oberflaeche, die
 * daran haengt, ist mit der Maus toter Code — und mit dem Finger die
 * Entscheidung. `element.click()` (220 Vorkommen) erzeugt sogar ueberhaupt
 * keine `pointer*`-Ereignisse.
 *
 * ══ WARUM JEDE AUSSAGE ZWEIMAL GEMESSEN WIRD ═══════════════════════════════
 *
 * EINE FINGER-MESSUNG ALLEIN SAGT NUR „GEHT" ODER „GEHT NICHT". Der
 * UNTERSCHIED zwischen Finger und Maus ist der eigentliche Befund: er
 * unterscheidet „diese Bedienung ist kaputt" von „diese Bedienung ist NUR am
 * Finger kaputt, und deshalb hat sie keines der vorhandenen Werkzeuge je
 * gesehen". Nur die zweite Sorte erklaert, wieso etwas monatelang als
 * abgenommen galt.
 *
 * Deshalb hat jeder Griff hier BEIDE Spalten, und die Erwartung steht als
 * PAAR da: was der Finger tun soll und was die Maus tun soll.
 *
 * ══ DIE SCHALTER DES KIOSKS LAUFEN MIT ═════════════════════════════════════
 *
 * Aus Schaden gelernt: Ohne `--disable-features=OverscrollHistoryNavigation`
 * brachte ein waagerechter Fingerzug den Messbrowser reproduzierbar auf
 * `about:blank` — ein Fehler, den es am Geraet nicht gibt. Die Schalter stehen
 * in tools/finger.mjs (`KIOSK_SCHALTER`), woertlich aus
 * scripts/chromium-autostart.sh.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *
 *   node tools/finger-bedienung.mjs                      eigene Vorschau, 8811
 *   node tools/finger-bedienung.mjs --port 8811
 *   node tools/finger-bedienung.mjs http://127.0.0.1:8811/neu/    geliehene
 *   node tools/finger-bedienung.mjs --nur zahnrad        ein einzelner Griff
 *   node tools/finger-bedienung.mjs --liste              welche es gibt
 *   node tools/finger-bedienung.mjs --spur               das Protokoll dazu
 *
 * ENDE 0, wenn jeder Griff das tut, was in seiner Erwartung steht.
 *
 * ══ WAS ES NICHT SIEHT ═════════════════════════════════════════════════════
 * Steht vollstaendig in tools/finger.mjs: Langdruck-Menue, Doppeltipp-Zoom,
 * Mehrfinger, der Beruehrungstreiber der Box, das Zeitverhalten eines
 * belasteten Pi 5 und die Angular-Oberflaeche hinter jedem Seitenwechsel.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import {
  KIOSK_SCHALTER,
  MITSCHREIBER,
  fingerAufbau,
  fingerBestaetigen,
  mausTippen,
  mausZiehen,
  tippen,
  ziehen,
} from './finger.mjs'
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
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

const MITGEGEBEN = argv.find((a) => a.startsWith('http')) || null
/**
 * VORGABEPORT 8811, NICHT 8299.
 *
 * 8299 ist der Vorgabeport eines guten Dutzends Werkzeuge, und dort haelt in
 * aller Regel eine FREMDE Vorschau aus einem anderen Arbeitsbaum. Zweimal hat
 * das schon eine Messung verdorben (llmwiki `vorschau-wird-geliehen`). 8801
 * ist an tools/finger-probe.mjs vergeben.
 */
const PORT = Number(opt('port', 8811))
const NUR = typeof opt('nur', null) === 'string' ? opt('nur', null) : null
const SPUR = hat('spur')

// ═══════════════════════════════════════════════════════════════════════════
//  DIE GRIFFE
// ═══════════════════════════════════════════════════════════════════════════
//
// Jeder Griff sagt: in welcher LAGE, WAS getan wird (einmal mit dem Finger,
// einmal mit der Maus) und WAS DABEI HERAUSKOMMEN SOLL. Die Wirkung wird als
// Zeichenkette beschrieben, damit „nichts" ein Wert ist und kein Schweigen:
//
//   'eltern'    der Eltern-Bereich steht offen (Faecher sichtbar)
//   'tor'       der Eltern-Bereich steht, aber das Tor davor
//   'fort:/x'   die Seite hat einen vollen Wechsel nach /x angefordert
//   'nichts'    es ist nichts passiert — der Knopf wirkt kaputt
//   'leiste'    die Kategorienleiste ist wieder da (Randwisch)
//
// WARUM DIE ERWARTUNG EIN PAAR IST, steht oben im Kopf.

const GRIFFE = [
  {
    name: 'wappen-kurz',
    lage: 'sperre-aus',
    worum: 'ein kurzer Tipp auf den Schriftzug tut GAR NICHTS',
    // ══ DIE GESCHICHTE DIESER DREI GRIFFE ════════════════════════════════
    // HIER STAND „ein kurzer Tipp aufs Zahnrad oeffnet den Eltern-Bereich"
    // mit `#einst-knopf` und 60 ms, und daneben „langes Halten tut DASSELBE
    // — es gibt keine zweite Geste mehr". Beide Saetze galten am MORGEN des
    // 06.08.2026: Das Zahnrad trug vorher zwei Gesten (kurz -> /settings,
    // 700 ms -> Bereich), deren Grenze unsichtbar war; bei gesetzter Sperre
    // sahen beide Wege Zeichen fuer Zeichen gleich aus, und WELCHEN man
    // erwischt hatte, erfuhr man erst nach der geloesten Aufgabe. Genau das
    // wurde gemeldet als „es öffnet einfach den alten bereich". Die Antwort
    // war zunaechst, dem Zahnrad die zweite Geste zu nehmen.
    //
    // AM ABEND DESSELBEN TAGES IST DAS ZAHNRAD GANZ ENTFALLEN. Der Einstieg
    // ist der Schriftzug `#wappen` unten links, und er kehrt die Erwartung
    // UM: kurz tippen tut nichts, HALTEN oeffnet. Das ist kein Rueckschritt
    // hinter „eine Geste" — es ist dieselbe Regel an einem Knopf, der auf der
    // Startseite eines Kindes liegt und deshalb nicht auf den ersten Tipp
    // aufgehen darf. Sichtbar gemacht wird die Frist durch den Ring.
    finger: async (t) => t.tippenAuf('#wappen', 60),
    maus: async (t) => t.mausAuf('#wappen', 60),
    sollFinger: 'nichts',
    sollMaus: 'nichts',
  },
  {
    name: 'wappen-halten',
    lage: 'sperre-aus',
    worum: 'den Schriftzug ueber die Frist halten oeffnet den Bereich',
    // DIE EINE GESTE, DIE AN DER BOX INS ADMIN-MENUE FUEHRT — mit echten
    // Beruehrungen. Die Frist steht in tools/admin-weg.mjs und stimmt mit
    // WAPPEN_HALTEN_MS in NewDesign/app.js ueberein; der Zuschlag deckt den
    // Abstand zwischen dem letzten Bildschritt und der Frist.
    finger: async (t) => t.tippenAuf('#wappen', WAPPEN_HALTEN_MS + 300),
    maus: async (t) => t.mausAuf('#wappen', WAPPEN_HALTEN_MS + 300),
    sollFinger: 'eltern',
    sollMaus: 'eltern',
  },
  {
    name: 'wappen-zu-kurz',
    lage: 'sperre-aus',
    worum: 'zwei Drittel der Frist reichen NICHT — vorher loslassen bricht ab',
    // DIE GEGENPROBE ZU `wappen-halten`. Ohne sie wuerde ein Knopf, der auf
    // JEDEN Druck aufgeht, gruen melden — und genau das war der Fehler vom
    // Morgen. 800 ms sind mit Absicht keine Kleinigkeit unter 1200: bei
    // 1150 ms mass man den Zuschlag des Werkzeugs, nicht die Frist.
    finger: async (t) => t.tippenAuf('#wappen', 800),
    maus: async (t) => t.mausAuf('#wappen', 800),
    sollFinger: 'nichts',
    sollMaus: 'nichts',
  },
  {
    name: 'wappen-abdrift',
    lage: 'sperre-aus',
    worum: 'ein Finger, der beim Tippen 40 px wandert, loest NICHTS aus',
    // DAS IST KEIN FEHLER DIESER OBERFLAECHE, SONDERN DER BROWSER: Nach rund
    // 16-20 px Weg beansprucht Blink die Beruehrung fuer das Rollen und
    // schickt `pointercancel` — danach unterdrueckt es auch den `click`.
    //
    // ES STEHT TROTZDEM HIER, UND ZWAR ALS ERWARTUNG „nichts": Wer diese
    // Zeile eines Tages rot sieht, hat entweder das Verhalten des Browsers
    // geaendert oder eine Bedienung gebaut, die auf ein storniertes Ziehen
    // reagiert. Beides gehoert bemerkt.
    //
    // GEMESSEN 06.08.2026: Auch die MAUS loest hier nichts aus, aber aus einem
    // ANDEREN Grund — sie bildet ihr Klickziel aus dem gemeinsamen Vorfahren
    // von Nieder und Hoch, und der ist nach 40 px nicht mehr der Knopf. Zwei
    // verschiedene Ursachen, ein gleiches Ergebnis: genau die Lage, in der
    // eine Maus-Messung Sicherheit vortaeuscht, die sie nicht hat.
    finger: async (t) => t.ziehenVon('#wappen', 0, 40, 500),
    maus: async (t) => t.mausZiehenVon('#wappen', 0, 40, 500),
    sollFinger: 'nichts',
    sollMaus: 'nichts',
    sollMausHinweis: 'auch die Maus tut hier nichts — aber aus einem anderen Grund',
  },
  {
    name: 'tor-ziffernfeld',
    lage: 'sperre-rechnen',
    worum: 'die Rechenaufgabe laesst sich mit dem Finger loesen',
    // DAS ZIFFERNFELD IST DIE EINZIGE EINGABE DER OBERFLAECHE. Zwoelf Tasten
    // auf 800x480, und dahinter liegen WLAN, die rohe Mediendatenbank und das
    // Herunterfahren. Wenn hier ein Tipp nicht ankommt, sieht das aus wie eine
    // falsche Antwort — nicht wie ein verlorener Tipp.
    finger: async (t) => t.torLoesen('finger'),
    maus: async (t) => t.torLoesen('maus'),
    sollFinger: 'eltern',
    sollMaus: 'eltern',
  },
  {
    name: 'fach-system',
    lage: 'sperre-aus',
    worum: 'das Fach „System" fuehrt in die klassische Oberflaeche',
    // DER WEG, DEN DER KURZE TIPP AUFS ZAHNRAD FRUEHER DIREKT GING. Seit dem
    // 06.08.2026 liegt er hier, mit einem Pfeil „↗" davor, der vorher ansagt,
    // dass die Oberflaeche verlassen wird. Wenn dieser Griff faellt, ist
    // /settings von der neuen Oberflaeche aus GAR NICHT mehr erreichbar — das
    // ist die eine Aussage, die diese Aenderung tragen muss.
    //
    // DREI GRIFFE STATT ZWEI: hinein (halten), Gruppe „System", und darin die
    // ZEILE „Weitere Einstellungen ↗". Der Sprung ist ein Punkt der Gruppe
    // und nicht die Gruppe selbst (ELTERN_PUNKTE in NewDesign/app.js).
    finger: async (t) => {
      await t.hinein('finger')
      await t.tippenAuf('[data-fach="system"]', 60)
      await warte(300)
      await t.sprungZeile('finger')
    },
    maus: async (t) => {
      await t.hinein('maus')
      await t.mausAuf('[data-fach="system"]', 60)
      await warte(300)
      await t.sprungZeile('maus')
    },
    sollFinger: 'fort:/settings',
    sollMaus: 'fort:/settings',
  },
  {
    name: 'geste-vierte-ecke',
    lage: 'sperre-geste',
    worum: 'der vierte Eckentipp oeffnet den Bereich — und faellt nicht durch',
    // ══ EIN GEMESSENER FEHLER (06.08.2026) ═══════════════════════════════
    // Das Tor der Sorte „geste" geht schon auf `pointerdown` auf;
    // `durchlassen()` versteckt es und malt die Faecher. Danach:
    //   * die MAUS bildet ihr Klickziel aus dem gemeinsamen Vorfahren von
    //     down und up — das ist `#eltern`, und dort passiert nichts;
    //   * der FINGER laesst den Browser das Klickziel im Augenblick der
    //     Zustellung neu treffen — und trifft das frisch gemalte Fach, das
    //     dort jetzt liegt. Gemessen: der vierte Tipp landete in /settings.
    // Wortgleich das, was der Betreiber gemeldet hat („es öffnet einfach den
    // alten bereich") — nur mit dem Finger, und von keinem der vier
    // Tor-Werkzeuge je gesehen.
    finger: async (t) => t.gesteTippen('finger'),
    maus: async (t) => t.gesteTippen('maus'),
    sollFinger: 'eltern',
    sollMaus: 'eltern',
  },
  {
    name: 'randwisch',
    lage: 'sperre-aus',
    worum: 'der Wisch vom linken Rand holt die eingefahrene Leiste zurueck',
    // ══ EIN ZWEITER GEMESSENER FEHLER (06.08.2026) ═══════════════════════
    // `randwisch` (NewDesign/app.js) verlangt 64 px waagerechten Zug. Blink
    // beansprucht die Beruehrung aber schon nach rund 20 px fuers Rollen und
    // schickt `pointercancel`; der Zuhoerer setzt darauf `zeiger = null` und
    // ist weg, bevor die 64 px je erreicht werden koennen. Der `touchmove`-Weg
    // laeuft dabei weiter (gemessen 130 px) — die BERUEHRUNG lebt, nur die
    // `pointer*`-Ereignisse enden.
    //
    // SCHADENSHOEHE BEGRENZT: die Leiste kommt nach 1407 ms von selbst zurueck
    // (llmwiki randwisch-holt-die-leiste-zurueck: „SIE IST EINE ABKUERZUNG,
    // KEIN EINZIGER WEG"). Die Geste ist trotzdem gebaut, dokumentiert und
    // mit tools/leiste-platz-schau.mjs als „ja" abgenommen worden — mit der
    // Maus. Am Geraet hat sie noch nie funktioniert.
    finger: async (t) => t.randwisch('finger'),
    maus: async (t) => t.randwisch('maus'),
    // „nichts" HEISST HIER: DIE LEISTE IST ZURUECK. Der Griff faehrt sie
    // vorher nachweislich ein (und bricht ab, wenn ihm das nicht gelingt);
    // „leiste-bleibt-weg" waere der Fehlschlag.
    sollFinger: 'nichts',
    sollMaus: 'nichts',
  },
]

if (hat('liste')) {
  for (const g of GRIFFE) console.log(`  ${g.name.padEnd(20)} ${g.worum}`)
  process.exit(0)
}

// ═══════════════════════════════════════════════════════════════════════════
//  Aufbau
// ═══════════════════════════════════════════════════════════════════════════
if (!browserSuchen()) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

let vorschau = null
let ZIEL = MITGEGEBEN

/** DIE EIGENE VORSCHAU WIRD BEENDET, auch wenn der Lauf abbricht. */
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

let fehler = 0
const zeilen = []

let chrome = null
try {
  // DIE SCHALTER DES KIOSKS SIND KEINE VERZIERUNG — siehe finger.mjs.
  chrome = await eigenerBrowser({ zusatz: KIOSK_SCHALTER })
  if (!chrome) throw new Error('kein Browser erreichbar')
  const ws = new WebSocket(await chrome.seite(), { perMessageDeflate: false })
  await new Promise((r) => ws.once('open', r))
  await send(ws, 'Page.enable')
  await send(ws, 'Runtime.enable')
  await fingerAufbau(ws, send)
  await send(ws, 'Runtime.addBinding', { name: 'fingerMeld' })
  await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: MITSCHREIBER })

  let protokoll = []
  ws.on('message', (r) => {
    const x = JSON.parse(r)
    if (x.method === 'Runtime.bindingCalled' && x.params.name === 'fingerMeld') {
      try {
        protokoll.push(JSON.parse(x.params.payload))
      } catch {
        /* ein zerschnittener Eintrag sagt nichts — er faellt weg */
      }
    }
  })

  const ev = async (js) => {
    const r = await send(ws, 'Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Fehler in der Seite')
    return r.result.value
  }

  const lage = async (w) => {
    await fetch(new URL(`/vorschau/${w}`, ZIEL))
  }
  const neuLaden = async () => {
    await send(ws, 'Page.navigate', { url: ZIEL })
    await warte(700)
    // ── DER SITZUNGSSPEICHER WIRD AUSDRUECKLICH GELEERT ──────────────────
    //
    // EIN NEULADEN LOESCHT IHN NICHT, und das ist kein Versehen der
    // Oberflaeche, sondern ihre Absicht: die gemeinsame Freigabe
    // (`mupibox_eltern_freigabe`) soll einen Seitenwechsel ueberleben, sonst
    // waere sie zwecklos. Fuer eine MESSUNG heisst das: ohne diese Zeile
    // traegt der erste Griff seine geloeste Aufgabe in den zweiten hinueber,
    // dort steht dann gar kein Tor mehr — und das Ergebnis sieht wie ein
    // Befund ueber die Sperre aus. Genau darauf ist der erste Lauf dieses
    // Werkzeugs hereingefallen.
    await send(ws, 'Runtime.evaluate', {
      expression: 'try { sessionStorage.clear() } catch {}',
      returnByValue: true,
    })
    await send(ws, 'Page.navigate', { url: ZIEL })
    await warte(700)
    protokoll = []
  }

  // ── DIE MITTE EINES ELEMENTS, UND OB ES DORT AUCH OBENAUF LIEGT ─────────
  //
  // ZWEI MESSFALLEN, DIE ES SCHON ERWISCHT HAT, sind hier verriegelt:
  //   1. Ein Element, das im Baum steht, aber verdeckt ist. Der Tipp geht dann
  //      an den Deckel, und das Ergebnis („es passiert nichts") sieht wie ein
  //      Befund ueber die Bedienung aus.
  //   2. Ein Element ausserhalb des Sichtfelds. Beides bricht hier LAUT ab,
  //      statt eine Aussage zu erfinden.
  const mitte = async (wahl) => {
    const r = await ev(`(() => {
      const e = document.querySelector(${JSON.stringify(wahl)})
      if (!e) return null
      const b = e.getBoundingClientRect()
      if (b.width < 1 || b.height < 1) return null
      const x = Math.round(b.left + b.width / 2), y = Math.round(b.top + b.height / 2)
      const o = document.elementFromPoint(x, y)
      return { x, y, obenauf: !!(o && (o === e || e.contains(o))), tag: o ? (o.id || o.tagName) : '' }
    })()`)
    if (!r) throw new Error(`${wahl}: steht nicht (sichtbar) im Baum`)
    if (!r.obenauf) throw new Error(`${wahl}: an ${r.x}/${r.y} liegt „${r.tag}" darueber — der Tipp traefe das Falsche`)
    return r
  }

  /**
   * WAS IST PASSIERT? — die Wirkung, nicht das Vorhandensein.
   *
   * DER SEITENWECHSEL WIRD AM PFAD ABGELESEN, NICHT AM PROTOKOLL. Der erste
   * Anlauf las ihn aus dem `beforeunload` — und der meldet `location.pathname`
   * der NOCH stehenden alten Seite. Jeder Wechsel sah damit aus wie „nach
   * /neu/", also wie „nichts passiert". Der Pfad NACH dem Wechsel ist die
   * ehrliche Auskunft, auch wenn die Vorschau dort mit 404 antwortet: gemessen
   * wird, wohin die Oberflaeche gegangen ist, nicht was sie dort vorfand.
   *
   * HTTP 200 beweist hier gar nichts — deshalb steht kein einziger Statuscode
   * in dieser Funktion.
   */
  const grundPfad = new URL(ZIEL).pathname
  const wirkung = async () => {
    const s = await ev(`(() => {
      const b = document.getElementById('eltern')
      const tor = document.getElementById('eltern-tor')
      const fl = document.getElementById('eltern-flaeche')
      return JSON.stringify({
        pfad: location.pathname,
        bereich: !!(b && !b.hidden),
        tor: !!(tor && !tor.hidden),
        flaeche: !!(fl && !fl.hidden),
        eingefahren: document.body.classList.contains('platz-machen'),
      })
    })()`)
    const x = JSON.parse(s)
    if (x.pfad !== grundPfad) return `fort:${x.pfad}`
    if (x.bereich && x.tor) return 'tor'
    if (x.bereich && x.flaeche) return 'eltern'
    // DIE LEISTE IST NUR BEIM RANDWISCH EINE AUSSAGE, und dort wurde sie
    // vorher ausdruecklich eingefahren — sonst bricht der Griff ab. „nichts"
    // heisst deshalb dort: sie ist ZURUECK.
    return x.eingefahren ? 'leiste-bleibt-weg' : 'nichts'
  }

  // ── DIE HANDGRIFFE, die die Griffe oben benutzen ────────────────────────
  const t = {
    tippenAuf: async (wahl, ms) => {
      const m = await mitte(wahl)
      await tippen(ws, send, m.x, m.y, ms)
      await warte(350)
    },
    mausAuf: async (wahl, ms) => {
      const m = await mitte(wahl)
      await mausTippen(ws, send, m.x, m.y, ms)
      await warte(350)
    },
    ziehenVon: async (wahl, dx, dy, ms) => {
      const m = await mitte(wahl)
      await ziehen(ws, send, m.x, m.y, m.x + dx, m.y + dy, { ms })
      await warte(350)
    },
    mausZiehenVon: async (wahl, dx, dy, ms) => {
      const m = await mitte(wahl)
      await mausZiehen(ws, send, m.x, m.y, m.x + dx, m.y + dy, { ms })
      await warte(350)
    },
    /**
     * HINEIN — der Einstieg, ueber die volle Frist GEHALTEN.
     *
     * Bis zum 06.08.2026 war das ein 60-ms-Tipp aufs Zahnrad `#einst-knopf`.
     * Es ist ersatzlos entfallen. Die Frist kommt aus tools/admin-weg.mjs,
     * damit sie hier nicht ein zweites Mal steht.
     */
    hinein: async (mittel) => {
      await (mittel === 'finger' ? t.tippenAuf : t.mausAuf)('#wappen', WAPPEN_HALTEN_MS + 300)
      await warte(400)
    },
    /**
     * DIE ZEILE „Weitere Einstellungen ↗" in der aufgeschlagenen Gruppe.
     *
     * Sie traegt kein `data-`-Merkmal — die Punkte werden ueber ihren Namen
     * gebaut (ELTERN_PUNKTE). Deshalb wird sie ueber ihre Aufschrift gesucht,
     * und WENN SIE FEHLT, wird das laut: ohne sie ist die alte Oberflaeche
     * von hier aus nicht mehr erreichbar.
     */
    sprungZeile: async (mittel) => {
      const da = await ev(`(() => { const k = [...document.querySelectorAll('#fach-zeilen button')]
        .find((x) => (x.textContent || '').includes('Weitere Einstellungen'))
        if (!k) return null
        k.id = k.id || 'mess-sprung-settings'
        return '#' + k.id })()`)
      if (!da) throw new Error('die Zeile „Weitere Einstellungen ↗" steht nicht in der Gruppe System')
      await (mittel === 'finger' ? t.tippenAuf : t.mausAuf)(da, 60)
    },
    /** Das Tor mit der Rechenaufgabe loesen — Ziffer fuer Ziffer, echt getippt. */
    torLoesen: async (mittel) => {
      const auf = mittel === 'finger' ? t.tippenAuf : t.mausAuf
      await t.hinein(mittel)
      const frage = await ev(`(document.getElementById('tor-frage')||{}).textContent || ''`)
      const z = String(frage).match(/(\d+)\s*[x×*]\s*(\d+)/)
      if (!z) throw new Error(`kein Tor mit Rechenaufgabe da (Frage: „${frage}")`)
      for (const zi of String(Number(z[1]) * Number(z[2])).split('')) {
        await auf(`[data-taste="${zi}"]`, 60)
      }
      await auf('[data-taste="weiter"]', 60)
      await warte(400)
    },
    /**
     * Die vier Ecken des Tors, im Uhrzeigersinn.
     *
     * IN DIE ECKE, NICHT AUF EINEN PUNKT: Die Geste misst Ecken der
     * TOR-FLAECHE (`gesteEcke`), und deren Kantenlaenge folgt der Groesse des
     * Tors. 12 px vom Rand liegt sicher darin, ohne die Flaeche zu verlassen.
     */
    gesteTippen: async (mittel) => {
      const auf = mittel === 'finger' ? tippen : mausTippen
      await t.hinein(mittel)
      const r = JSON.parse(
        await ev(`(() => {
          const e = document.getElementById('eltern-tor')
          if (!e || e.hidden) return 'null'
          const b = e.getBoundingClientRect()
          return JSON.stringify({ l: Math.round(b.left), t: Math.round(b.top),
                                  r: Math.round(b.right), b: Math.round(b.bottom) })
        })()`),
      )
      if (!r) throw new Error('kein Tor da — die Lage „geste" hat nicht gegriffen')
      const d = 12
      const ecken = [
        [r.l + d, r.t + d],
        [r.r - d, r.t + d],
        [r.r - d, r.b - d],
        [r.l + d, r.b - d],
      ]
      for (const [x, y] of ecken) {
        await auf(ws, send, x, y, 60)
        await warte(220)
      }
      await warte(400)
    },
    /**
     * Der Wisch vom linken Rand — erst die Leiste einfahren, dann zurueckholen.
     *
     * OHNE DAS EINFAHREN MISST DER GRIFF NICHTS: `randwisch` steigt bei
     * `!eingefahren` aus. Eingefahren wird sie ueber das Rollen der Buehne,
     * also genau so, wie es im Betrieb passiert.
     */
    randwisch: async (mittel) => {
      // EINGEFAHREN WIRD SO, WIE ES IM BETRIEB PASSIERT: durch ein
      // Rollereignis der Buehne. Die Klasse `platz-machen` von Hand zu setzen
      // genuegt NICHT — `randwisch` fragt `platzBeimBlaettern.eingefahren`,
      // und das ist ein Feld, keine Klasse. Der erste Anlauf setzte nur die
      // Klasse, der Wisch stieg still aus, und das sah wie ein Befund aus.
      await ev(`(() => {
        const b = document.getElementById('buehne')
        if (b) { b.scrollTop = Math.max(1, b.scrollTop + 40); b.dispatchEvent(new Event('scroll')) }
      })()`)
      await warte(250)
      const drin = await ev(`document.body.classList.contains('platz-machen')`)
      if (!drin) throw new Error('die Leiste liess sich nicht einfahren — der Wisch waere ohne Aussage')
      const y = 240
      if (mittel === 'finger') await ziehen(ws, send, 6, y, 146, y, { ms: 380, schritte: 14 })
      else await mausZiehen(ws, send, 6, y, 146, y, { ms: 380, schritte: 14 })
      // ── KURZ WARTEN, UND ZWAR SEHR KURZ ─────────────────────────────────
      //
      // EINE MESSFALLE MIT ANSAGE: Die Leiste kommt nach rund 1400 ms VON
      // SELBST zurueck (`platzBeimBlaettern.frist`). Wer laenger wartet, misst
      // die Uhr und nicht die Geste — und bekommt „gruen" fuer eine Bedienung,
      // die gar nicht gegriffen hat. Genau darauf ist der erste Lauf dieses
      // Werkzeugs hereingefallen: mit 500 ms Nachlauf war der Wisch scheinbar
      // auch mit dem Finger in Ordnung, obwohl das Protokoll ein
      // `pointercancel` nach 65 ms zeigte.
      await warte(120)
    },
  }

  // ── DER AUFBAU WIRD BESTAETIGT, BEVOR ETWAS BEHAUPTET WIRD ──────────────
  await neuLaden()
  const b = await fingerBestaetigen(ws, send)
  console.log(
    `Messeinrichtung: ontouchstart=${b.ontouchstart} maxTouchPoints=${b.maxTouchPoints} ` +
      `pointer:coarse=${b.grob} Sichtfeld=${b.breite}x${b.hoehe}`,
  )
  if (!b.taugt) throw new Error('der Browser hat KEINEN Beruehrungsschirm — jede Messung waere wertlos')
  console.log(`Ziel: ${ZIEL}\n`)

  for (const g of GRIFFE) {
    if (NUR && g.name !== NUR) continue
    const ergebnis = {}
    for (const mittel of ['finger', 'maus']) {
      await lage(g.lage)
      await neuLaden()
      try {
        await g[mittel](t)
        ergebnis[mittel] = await wirkung()
      } catch (e) {
        ergebnis[mittel] = `ABBRUCH: ${e.message}`
      }
      if (SPUR) {
        console.log(`    ── ${g.name} / ${mittel} ──`)
        for (const e of protokoll.slice(0, 40))
          console.log(`       ${String(e.ms).padStart(5)}ms ${e.art.padEnd(14)} ${e.zeiger.padEnd(6)} ${e.ziel}`)
      }
    }
    const fOk = ergebnis.finger === g.sollFinger
    const mOk = ergebnis.maus === g.sollMaus
    const gut = fOk && mOk
    if (!gut) fehler++
    const merk = ergebnis.finger !== ergebnis.maus ? '  ← FINGER UND MAUS GEHEN AUSEINANDER' : ''
    zeilen.push({ name: g.name, gut, ...ergebnis, soll: `${g.sollFinger} / ${g.sollMaus}` })
    console.log(
      `${gut ? 'ok  ' : 'NEIN'}  ${g.name.padEnd(20)} Finger: ${String(ergebnis.finger).padEnd(22)} ` +
        `Maus: ${String(ergebnis.maus).padEnd(22)} soll: ${g.sollFinger} / ${g.sollMaus}${merk}`,
    )
    if (!gut) console.log(`        ${g.worum}`)
  }
} finally {
  await chrome?.aufraeumen?.()
  vorschau?.kill()
}

console.log(
  fehler
    ? `\n${fehler} von ${zeilen.length} Griffen tun nicht, was sie sollen`
    : `\nalle ${zeilen.length} Griffe tun, was sie sollen`,
)
process.exitCode = fehler ? 1 : 0
