#!/usr/bin/env node
/**
 * DIE FUNKSCHALTER IM ADMIN-MENUE — vier Lagen, und in dreien darf man nicht.
 *
 * ══ WOZU, UND WARUM KEINES DER VORHANDENEN WERKZEUGE ═══════════════════════
 *
 * Seit dem 07.08.2026 liegt unter „Verbindung" die Seite „Funk an und aus":
 * Bluetooth, WLAN und Flugmodus als Schalter. Sie ist die einzige Seite dieses
 * Bereichs, auf der ein Fehlgriff die Box UNERREICHBAR macht — nicht „stoert",
 * sondern unerreichbar, ohne dass ein Neustart hilft, weil beim naechsten Start
 * dieselbe Lage gilt.
 *
 *   * `admin-menue-schau.mjs` geht die GLIEDERUNG durch: steht der Punkt da,
 *     fuehrt er irgendwohin, kommt man zurueck. Es kennt keinen Zustand von
 *     `/api/funk` und stellt keinen ein.
 *   * `admin-doppeltipp-probe.mjs` misst den Doppeltipp auf der Seite „Neu
 *     laden und neu starten" — mit fest verdrahteten Namen jener Seite.
 *   * `beruehrziele-neu.mjs` misst Groessen. Ob ein Knopf DASTEHEN DARF, ist
 *     ihm keine Frage.
 *
 * ══ DIE FRAGEN, AN DENEN DIESE SEITE SCHEITERN KANN ════════════════════════
 *
 *   1. OHNE ZWEITEN WEG STEHT KEIN KNOPF DA — sondern der Grund als Satz. Das
 *      ist der ALLTAGSFALL dieser Box (alles laeuft ueber wlan0). Ein Knopf,
 *      der 409 kassiert, ist schlechter als keiner: er verspricht etwas, sagt
 *      nein, und wer ihn drueckt, sucht den Fehler bei sich.
 *   2. MIT KABEL DARF ER DASTEHEN, und die Rueckfrage NENNT die Adresse und
 *      sagt dazu, dass eine ueber WLAN gefuehrte Sitzung trotzdem abreisst.
 *   3. AUF DEM SCHIRM DER BOX darf er dastehen — dann MUSS die Anfrage
 *      `vorOrt: true` mitschicken. Ohne das Feld lehnt der echte Server ab
 *      (funk.ts, `vonDerBox`), und der Knopf waere eine Attrappe.
 *   4. EINSCHALTEN FRAGT NIE NACH.
 *   5. BLUETOOTH FRAGT NIE NACH — es kappt keinen Weg zur Box.
 *   6. DER NACHLAUF. Der Aus-Weg antwortet SOFORT und schaltet erst 600 ms
 *      spaeter (server.ts, `ausPlanen(…, 600)`). Gibt die Oberflaeche die
 *      Knoepfe gleich wieder frei, steht ein Schirm da, auf dem alles noch
 *      „an" ist — der zweite Tipp ging in ein Geraet, das gerade abschaltet.
 *      GEMESSEN WIRD: waehrenddessen ist jeder Knopf gesperrt, und ein
 *      zweiter Tipp schickt KEINEN zweiten Aufruf hinaus.
 *   7. DER DOPPELTIPP AUF DIESELBE STELLE. „WLAN · Ausschalten" ist die ZWEITE
 *      Zeile der Seite, „Ja, WLAN ausschalten" die ZWEITE der Rueckfrage —
 *      dieselbe Rechnung, an der am 06.08.2026 ein `POST /api/reboot`
 *      hinausging, ohne dass jemand die Frage gesehen hatte.
 *   8. UND DIE ZEILEN STEHEN IM BILD. Drei Zeilen zu 78 px, gemessen und
 *      nicht gerechnet — samt der Frage, ob ein Knopf im Kartenrand endet.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei des Baums und NICHTS AN EINER BOX. Es faehrt
 * ausschliesslich gegen die Attrappe in tools/neu-vorschau.mjs, die die drei
 * Lagen stellen kann und die 600 ms nachstellt. AN EINER ECHTEN BOX WAERE
 * DIESE MESSUNG NICHT ZU MACHEN: der erste erfolgreiche Tipp beendet die
 * Sitzung, in der gemessen wird.
 *
 * Ohne `--ziel` startet es seine EIGENE Vorschau auf einem freien Port; eine
 * geliehene bediente den Arbeitsbaum dessen, der sie gestartet hat
 * ([[vorschau-wird-geliehen]]).
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/funk-schalter-schau.mjs
 *     node tools/funk-schalter-schau.mjs --ziel http://127.0.0.1:9401/neu/
 *     node tools/funk-schalter-schau.mjs --bild /tmp/funk
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
const BILDER = opt('bild')
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

let fehl = 0
const ja = (b, satz, zusatz = '') => {
  if (!b) fehl++
  console.log(`${b ? 'ok  ' : 'FEHL'}  ${satz}${zusatz ? '  — ' + zusatz : ''}`)
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
// keine, startet vorschauLeihen dort selbst eine und beendet sie am Ende.
// Beides samt der Messungen dahinter: tools/leihgabe.mjs.
const leihe = await vorschauLeihen(ZIEL)
console.log(`ZIEL: ${ZIEL}${leihe.eigene ? '  (eigene Vorschau)' : '  (mitgegeben)'}`)

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
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const stand = async (w) => {
    await fetch(new URL(`/vorschau/${w}`, ZIEL)).catch(() => null)
    await warte(120)
  }
  /** Was an `POST /api/funk/...` hereinkam — die Attrappe schreibt es mit. */
  const rufe = async () => {
    const a = await fetch(new URL('/vorschau/funk-rufe', ZIEL)).catch(() => null)
    return a ? (await a.json()).rufe : []
  }
  const rufeLeeren = () => fetch(new URL('/vorschau/funk-rufe-leeren', ZIEL)).catch(() => null)
  const bild = async (name) => {
    if (!BILDER) return
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(join(BILDER, `${name}.png`), Buffer.from(s.data, 'base64'))
    console.log(`      Bild: ${join(BILDER, `${name}.png`)}`)
  }
  const laden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
  }

  /**
   * DEN WEG BIS AUF DIE FUNK-SEITE FAHREN — wie ein Finger, nicht ueber den
   * Zustand. Wer `eltern.fach = 'funk'` setzte, misse eine Seite, die auch
   * unerreichbar sein duerfte.
   */
  const hinFunk = async () => {
    await adminAuf(ev, { warteMs: 1100 })
    await ev(`document.querySelector('#eltern-faecher [data-fach="verbindung"]').click()`)
    await warte(700)
    const ok = await ev(`(() => {
      for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
        const n = z.querySelector('.zeile-name')
        if (n && n.textContent.trim().startsWith('Funk')) { z.click(); return true }
      }
      return false })()`)
    await warte(900)
    return ok === true
  }

  /** Die Zeilen der Karte, so wie sie DASTEHEN: Name, Unterzeile, Knopf. */
  const zeilen = async () =>
    JSON.parse(
      await ev(`JSON.stringify((() => {
        const f = document.getElementById('fach-zeilen')
        const fr = f.getBoundingClientRect()
        const teil = (b) => Math.max(0, Math.min(b.bottom, fr.bottom) - Math.max(b.top, fr.top))
        return {
          kopf: (document.getElementById('fach-name')||{}).textContent || '',
          unter: (document.getElementById('eltern-unter')||{}).textContent || '',
          hinweis: (() => { const h = document.getElementById('fach-hinweis'); return h && !h.hidden ? h.textContent : '' })(),
          hinweisRot: (() => { const h = document.getElementById('fach-hinweis'); return !!(h && !h.hidden && h.classList.contains('falsch')) })(),
          sicht: Math.round(fr.height),
          inhalt: Math.round(f.scrollHeight),
          zeilen: [...f.querySelectorAll('.fach-zeile')].map((z) => {
            const k = z.querySelector('.zeile-tat')
            const kr = k ? k.getBoundingClientRect() : null
            return {
              name: (z.querySelector('.zeile-name')||{}).textContent || '',
              unter: (z.querySelector('.zeile-unter')||{}).textContent || '',
              knopf: k ? k.textContent : null,
              gesperrt: k ? !!k.disabled : null,
              hoch: Math.round(z.getBoundingClientRect().height),
              knopfHoch: kr ? Math.round(kr.height) : null,
              knopfSicht: kr ? Math.round(teil(kr)) : null,
            }
          }),
          leer: (() => { const p = document.querySelector('#fach-zeilen .fach-leer'); return p ? p.textContent : '' })(),
        }
      })())`),
    )

  /** Einen Knopf in einer Zeile antippen — ueber den Namen der Zeile. */
  const tippen = async (name, warten = 700) => {
    const ok = await ev(`(() => {
      for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
        const n = z.querySelector('.zeile-name')
        if (!n || !n.textContent.trim().startsWith(${JSON.stringify(name)})) continue
        const k = z.querySelector('.zeile-tat')
        if (!k || k.disabled) return false
        k.click(); return true
      }
      return false })()`)
    if (warten) await warte(warten)
    return ok === true
  }

  // ══════════════════════════════════════════════════════════════════════
  //  LAGE 1 — NUR WLAN. Der Alltagsfall dieser Box: kein Knopf darf da sein.
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ LAGE „NUR WLAN" — kein zweiter Weg ═══════════════════════')
  await stand('funk-zurueck')
  await stand('sperre-aus')
  await laden()
  ja(await hinFunk(), 'die Seite „Funk an und aus" ist ueber die Uebersicht erreichbar')
  let m = await zeilen()
  ja(m.kopf === 'Funk an und aus', 'die Karte traegt ihren Namen', m.kopf)
  ja(
    m.zeilen.map((z) => z.name).join(' · ') === 'Bluetooth · WLAN · Flugmodus',
    'drei Zeilen, in dieser Reihenfolge',
    m.zeilen.map((z) => z.name).join(' · '),
  )
  console.log(`      Karte: ${m.sicht} px Sicht, ${m.inhalt} px Inhalt${m.inhalt > m.sicht + 1 ? ' — sie rollt' : ''}`)
  ja(
    m.zeilen.every((z) => z.hoch >= 66),
    'jede Zeile haelt die 9-mm-Marke',
    m.zeilen.map((z) => z.hoch + ' px').join(' · '),
  )
  // DIE FRAGE, DIE 26 GRUENE AUSSAGEN AM 06.08.2026 NICHT GESTELLT HABEN.
  const halb = m.zeilen.filter((z) => z.knopfHoch && z.knopfSicht > 0 && z.knopfSicht < z.knopfHoch - 1)
  ja(
    halb.length === 0,
    'kein Knopf endet mitten im Kartenrand',
    halb.map((z) => `${z.name}: ${z.knopfSicht}/${z.knopfHoch}`).join(', ') || 'keiner',
  )

  const wlanZeile = () => m.zeilen.find((z) => z.name === 'WLAN')
  const flugZeile = () => m.zeilen.find((z) => z.name === 'Flugmodus')
  ja(wlanZeile().knopf === null, 'WLAN hat KEINEN Knopf — der Grund steht statt seiner da', wlanZeile().knopf ?? '—')
  ja(
    /nur am WLAN/.test(wlanZeile().unter) && /unerreichbar/.test(wlanZeile().unter),
    'und der Grund ist der des Servers, wortwoertlich',
    wlanZeile().unter,
  )
  ja(flugZeile().knopf === null, 'Flugmodus hat KEINEN Knopf', flugZeile().knopf ?? '—')
  ja(
    m.zeilen.find((z) => z.name === 'Bluetooth').knopf === 'Ausschalten',
    'Bluetooth dagegen SCHON — es kappt keinen Weg zur Box',
    m.zeilen.find((z) => z.name === 'Bluetooth').knopf ?? '—',
  )
  await bild('1-nicht-erlaubt')

  // ── BLUETOOTH: schlicht, ohne Rueckfrage, genau ein Aufruf ─────────────
  await rufeLeeren()
  ja(await tippen('Bluetooth', 900), 'Bluetooth laesst sich antippen')
  m = await zeilen()
  ja(
    m.zeilen.map((z) => z.name).join(' · ') === 'Bluetooth · WLAN · Flugmodus',
    'und es kam KEINE Rueckfrage — die Seite steht noch',
    m.zeilen.map((z) => z.name).join(' · '),
  )
  let r = await rufe()
  ja(
    r.length === 1 && r[0].was === 'bluetooth' && r[0].an === false,
    'genau EIN Aufruf, und der richtige',
    r.map((x) => `${x.was} an=${x.an}`).join(', ') || 'keiner',
  )
  ja(
    m.zeilen.find((z) => z.name === 'Bluetooth').knopf === 'Einschalten',
    'der Schalter steht danach auf „Einschalten"',
    m.zeilen.find((z) => z.name === 'Bluetooth').knopf ?? '—',
  )
  // ── EINSCHALTEN FRAGT NIE NACH ────────────────────────────────────────
  await rufeLeeren()
  ja(await tippen('Bluetooth', 900), 'und wieder einschalten geht auch')
  m = await zeilen()
  ja(
    m.zeilen.map((z) => z.name).join(' · ') === 'Bluetooth · WLAN · Flugmodus' &&
      m.zeilen.find((z) => z.name === 'Bluetooth').knopf === 'Ausschalten',
    'EINSCHALTEN FRAGT NIE NACH — keine Rueckfrage, und der Stand kippt zurueck',
    m.zeilen.find((z) => z.name === 'Bluetooth').knopf ?? '—',
  )

  // ══════════════════════════════════════════════════════════════════════
  //  LAGE 2 — KABEL. Erlaubt, und die Rueckfrage nennt die Adresse.
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ LAGE „KABEL" — es gibt einen zweiten Weg ═════════════════')
  await stand('funk-zurueck')
  await stand('funk-kabel')
  await laden()
  await hinFunk()
  m = await zeilen()
  ja(wlanZeile().knopf === 'Ausschalten', 'jetzt steht der Knopf da', wlanZeile().knopf ?? '—')
  ja(flugZeile().knopf === 'Einschalten', 'und der Flugmodus auch', flugZeile().knopf ?? '—')
  await bild('2-erlaubt')

  await rufeLeeren()
  ja(await tippen('WLAN', 400), '„Ausschalten" oeffnet die Rueckfrage')
  m = await zeilen()
  ja(m.kopf === 'WLAN ausschalten?', 'sie fragt nach', m.kopf)
  ja(
    m.zeilen.length === 2 && m.zeilen[0].knopf === 'Abbrechen',
    'oben der Abbruch, unten die Tat',
    m.zeilen.map((z) => z.name).join(' · '),
  )
  // ══ DER DOPPELTIPP ═══════════════════════════════════════════════════
  // „WLAN · Ausschalten" ist die ZWEITE Zeile der Seite, „Ja, WLAN
  // ausschalten" die ZWEITE der Rueckfrage — genau die Rechnung, aus der am
  // 06.08.2026 ein ungewollter Neustart wurde.
  ja(
    m.zeilen[1].gesperrt === true,
    'und die scharfe Zeile ist im ersten Augenblick GESPERRT (Doppeltipp)',
    m.zeilen[1].gesperrt ? 'gesperrt' : 'offen',
  )
  ja(
    (await rufe()).length === 0,
    'bis hierher ist KEIN Aufruf hinausgegangen',
    (await rufe()).map((x) => x.was).join(', ') || 'keiner',
  )
  ja(
    /192\.168\.178\.169/.test(m.zeilen[1].unter) && /eth0/.test(m.zeilen[1].unter),
    'die Rueckfrage NENNT die Adresse, unter der es weitergeht',
    m.zeilen[1].unter,
  )
  ja(
    /reißt trotzdem ab|reisst trotzdem ab/.test(m.zeilen[1].unter),
    'und sagt dazu, dass diese Sitzung ueber WLAN trotzdem abreisst',
    m.zeilen[1].unter,
  )
  ja(
    /Spotify/.test(m.zeilen[0].unter) && /Jellyfin/.test(m.zeilen[0].unter),
    'sie BENENNT, was danach nicht mehr geht',
    m.zeilen[0].unter,
  )
  await bild('3-rueckfrage-wlan')

  // ── ABBRECHEN SCHICKT NICHTS HINAUS ───────────────────────────────────
  ja(await tippen('Das hört danach auf', 700), '„Abbrechen" laesst sich tippen')
  m = await zeilen()
  ja(m.kopf === 'Funk an und aus', 'und fuehrt auf die Seite zurueck', m.kopf)
  ja((await rufe()).length === 0, 'ein Abbruch schickt KEINEN Aufruf hinaus', String((await rufe()).length))

  // ══════════════════════════════════════════════════════════════════════
  //  DER NACHLAUF — die 600 ms, in denen der Schalter luegt.
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ DER NACHLAUF NACH DEM ABSCHALTEN ═════════════════════════')
  await rufeLeeren()
  await tippen('WLAN', 900) // Rueckfrage auf; 900 ms > 700 ms Frist
  m = await zeilen()
  ja(m.zeilen[1].gesperrt === false, 'nach 700 ms ist die scharfe Zeile scharf', m.zeilen[1].gesperrt ? 'noch aus' : 'scharf')
  // JETZT TIPPEN UND SOFORT NACHSEHEN — innerhalb der 600 ms des Servers.
  await tippen('Ja, WLAN ausschalten', 0)
  await warte(300)
  m = await zeilen()
  ja(
    m.zeilen.every((z) => z.knopf === null || z.gesperrt === true),
    'waehrend des Nachlaufs ist JEDER Knopf gesperrt',
    m.zeilen.map((z) => `${z.name}:${z.knopf ?? '—'}${z.gesperrt ? ' (aus)' : ''}`).join(' · '),
  )
  ja(m.hinweis !== '' && !m.hinweisRot, 'und am Schirm steht ruhig, was gerade laeuft', m.hinweis || '—')
  // DIE ZEILE ZEIGT SCHON DEN ANGEFORDERTEN ZUSTAND. Nicht, um schneller
  // auszusehen, sondern damit in den zwei Sekunden Nachlauf nicht „Läuft ·
  // Ausschalten" dasteht, waehrend abgeschaltet wird. Der Knopf traegt
  // dabei „…" — es ist keine Einladung, es ist eine Auskunft.
  ja(
    /^Aus\./.test(wlanZeile().unter),
    'die WLAN-Zeile behauptet NICHT mehr „an"',
    wlanZeile().unter || '—',
  )
  await bild('4-nachlauf')
  // ── UND EIN ZWEITER TIPP GEHT INS LEERE ───────────────────────────────
  const nochmal = await tippen('WLAN', 0)
  await warte(200)
  ja(nochmal === false, 'ein zweiter Tipp findet keinen offenen Knopf')
  await warte(3200) // Nachlauf (2500 ms) plus Abruf
  r = await rufe()
  ja(
    r.filter((x) => x.was === 'wlan').length === 1,
    'am Ende ist GENAU EIN Aufruf hinausgegangen — keine Einbahnstrasse',
    r.map((x) => `${x.was} an=${x.an}`).join(', ') || 'keiner',
  )
  m = await zeilen()
  ja(wlanZeile().knopf === 'Einschalten', 'und der Schalter steht jetzt auf „Einschalten"', wlanZeile().knopf ?? '—')

  // ══════════════════════════════════════════════════════════════════════
  //  LAGE 3 — VOR ORT. Erlaubt, aber `vorOrt: true` MUSS mitgehen.
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ LAGE „VOR ORT" — der Schirm der Box selbst ═══════════════')
  await stand('funk-zurueck')
  await stand('funk-vorort')
  await laden()
  await hinFunk()
  m = await zeilen()
  ja(wlanZeile().knopf === 'Ausschalten', 'der Knopf darf hier dastehen', wlanZeile().knopf ?? '—')
  await rufeLeeren()
  await tippen('WLAN', 900)
  m = await zeilen()
  ja(
    /nur hier/.test(m.zeilen[1].unter) && /keinen zweiten Weg/.test(m.zeilen[1].unter),
    'die Rueckfrage sagt, dass Wiedereinschalten auch NUR hier geht',
    m.zeilen[1].unter,
  )
  await bild('5-vor-ort')
  await tippen('Ja, WLAN ausschalten', 0)
  await warte(3400)
  r = await rufe()
  ja(
    r.length === 1 && r[0].was === 'wlan' && r[0].an === false && r[0].vorOrt === true,
    'und die Anfrage schickt `vorOrt: true` MIT — sonst antwortet der Server 409',
    r.map((x) => `${x.was} an=${x.an} vorOrt=${x.vorOrt}`).join(', ') || 'keiner',
  )

  // ══════════════════════════════════════════════════════════════════════
  //  LAGE 4 — FLUGMODUS AN. Der Weg zurueck steht auf demselben Schirm.
  // ══════════════════════════════════════════════════════════════════════
  // DIE LAGE IST HIER „VOR ORT", UND ZWAR NOTWENDIG: Im Flugmodus ist das
  // WLAN aus. Eine Verwaltung aus dem Netz SIEHT diesen Schirm gar nicht —
  // wer ihn sieht, steht vor der Box. Mit `nur-wlan` gemessen praegte man
  // eine Lage, die es nicht geben kann.
  console.log('\n══ LAGE „FLUGMODUS AN" ══════════════════════════════════════')
  await stand('funk-zurueck')
  await stand('funk-vorort')
  await stand('funk-flug')
  await laden()
  await hinFunk()
  m = await zeilen()
  ja(flugZeile().knopf === 'Beenden', 'der Weg zurueck steht auf DEMSELBEN Schirm', flugZeile().knopf ?? '—')
  ja(/Funkstille/.test(flugZeile().unter), 'und die Zeile sagt, was gerade gilt', flugZeile().unter)
  ja(/Funkstille/.test(m.unter), 'die Unterzeile des Bereichs sagt es auch', m.unter)
  await bild('6-flug-an')
  await rufeLeeren()
  ja(await tippen('Flugmodus', 1200), '„Beenden" laesst sich tippen')
  m = await zeilen()
  ja(
    m.kopf === 'Funk an und aus',
    'ZURUECKNEHMEN FRAGT NICHT NACH — es kommt keine Rueckfrage',
    m.kopf,
  )
  r = await rufe()
  ja(
    r.length === 1 && r[0].was === 'flug' && r[0].an === false,
    'genau EIN Aufruf, und `an: false` heisst „Flugmodus aus"',
    r.map((x) => `${x.was} an=${x.an}`).join(', ') || 'keiner',
  )
  ja(flugZeile().knopf === 'Einschalten', 'und der Schalter steht wieder auf „Einschalten"', flugZeile().knopf ?? '—')

  // ── DIE RUECKFRAGE DES FLUGMODUS BENENNT, WAS AUFHOERT ────────────────
  console.log('\n══ DIE RUECKFRAGE DES FLUGMODUS ═════════════════════════════')
  await stand('funk-zurueck')
  await stand('funk-kabel')
  await laden()
  await hinFunk()
  await rufeLeeren()
  await tippen('Flugmodus', 900)
  m = await zeilen()
  ja(m.kopf === 'Flugmodus einschalten?', 'sie fragt nach', m.kopf)
  const s = m.zeilen[0].unter + ' ' + m.zeilen[1].unter
  ja(/Spotify/.test(s), 'sie nennt Spotify', /Spotify/.test(s) ? 'ja' : 'nein')
  ja(/Jellyfin/.test(s), 'sie nennt Jellyfin', /Jellyfin/.test(s) ? 'ja' : 'nein')
  ja(/Verwaltung/.test(s), 'sie nennt die Verwaltung', /Verwaltung/.test(s) ? 'ja' : 'nein')
  ja(/auf der Box liegt/.test(s), 'und dass nur lokale Medien bleiben', /auf der Box liegt/.test(s) ? 'ja' : 'nein')
  ja(/Beenden/.test(s), 'und sie nennt den Weg zurueck auf demselben Schirm', m.zeilen[1].unter)
  await bild('7-rueckfrage-flug')

  console.log(`\n${fehl === 0 ? 'ALLES GRUEN' : `${fehl} AUSSAGE(N) GEFALLEN`}`)
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen?.()
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await leihe.zurueckgeben()
}
process.exit(fehl === 0 ? 0 : 1)
