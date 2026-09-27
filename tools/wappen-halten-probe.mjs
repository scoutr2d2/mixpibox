#!/usr/bin/env node
/**
 * DER SCHRIFTZUG, GEHALTEN — die eine Geste, die an der Box ins Admin-Menue
 * fuehrt, mit ECHTEN BERUEHRUNGEN nachgemessen.
 *
 * ══ WARUM ES DIESES WERKZEUG GIBT ══════════════════════════════════════════
 *
 * Am Morgen des 06.08.2026 meldete der Betreiber vom Geraet: „es öffnet
 * einfach den alten bereich". Ursache waren ZWEI unsichtbare Gesten auf EINEM
 * Knopf — dem Zahnrad `#einst-knopf`: kurz tippen ging in die alte
 * Oberflaeche, 700 ms Halten oeffnete den Eltern-Bereich. Der naheliegende
 * Griff, die Frist von 700 auf 400 ms zu senken, wurde damals VERWORFEN: eine
 * unsichtbare Grenze bleibt eine unsichtbare Grenze, egal wo sie liegt.
 *
 * Am Abend desselben Tages ist das Zahnrad ERSATZLOS ENTFALLEN. Der Einstieg
 * ist der Schriftzug unten links (`#wappen`, aus einem `<div>` wurde ein
 * `<button>`); er traegt genau EINE Geste, und ein Ring (`#wappen-ring`, aus
 * `--wappen-fuell` 0..1) macht die Frist SICHTBAR. Das ist die fehlende
 * Haelfte des Befunds vom Morgen.
 *
 * ══ WARUM NICHT EINES DER VIERUNDDREISSIG ANDEREN ══════════════════════════
 *
 * Vierunddreissig Werkzeuge oeffneten den Bereich ueber das Zahnrad. Sie sind
 * am 06.08.2026 auf den gemeinsamen Weg (tools/admin-weg.mjs) gezogen worden,
 * und die MEISTEN nehmen dort den TASTATURWEG: Enter auf `#wappen`. Der ist
 * eine echte Bedienung — eine Tastatur kennt keine Haltegeste —, aber er geht
 * an der Frist, am Ring und am Abbrechen VORBEI.
 *
 * WAER DIESES WERKZEUG NICHT DA, WAERE DIE GESTE UNGEPRUEFT. Es steht deshalb
 * in `WAPPEN_HALTEN.pruefer` (tools/admin-weg.mjs) namentlich drin.
 *
 * ══ WARUM ECHTE BERUEHRUNGEN UND NICHT `Input.dispatchMouseEvent` ══════════
 *
 * `pointerType: 'touch'` faerbt nur das erzeugte PointerEvent ein. Es erzeugt
 * keinen Touch-Punkt, keine Gestenerkennung von Blink, kein `touch-action`,
 * keinen Bildlauf-Klau — und damit auch kein `pointercancel`. Genau die
 * Fehlerklasse, die der Betreiber mit dem Finger in zwei Minuten gefunden hat,
 * ist mit der Maus unsichtbar (siehe tools/finger-probe.mjs).
 *
 * ══ WAS BEHAUPTET WIRD ═════════════════════════════════════════════════════
 *   1. Die volle Frist gehalten OEFFNET den Bereich.
 *   2. Zwei Drittel der Frist oeffnen ihn NICHT.
 *   3. Der Ring FUELLT SICH waehrend des Haltens (`--wappen-fuell` waechst).
 *   4. Nach dem Oeffnen ist der Ring WEG und `--wappen-fuell` geraeumt.
 *   5. Loslassen vor der Frist bricht ab UND raeumt den Ring weg.
 *   6. Ein Finger, der beim Halten ZITTERT, bricht NICHT ab.
 *   7. `pointercancel` (touchCancel) bricht ab.
 *   8. Der Ring faengt die Beruehrung NICHT ab (`pointer-events: none`).
 *   9. Der Schriftzug ist seit dem Umbau ein BERUEHRZIEL — Groesse und
 *      Abstand zur letzten Kategorie stehen als Zahlen da (Punkt 0).
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei und NICHTS AN EINER BOX. Ohne Adresse startet es seine
 * eigene Vorschau auf einem freien Port ([[vorschau-wird-geliehen]]).
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/wappen-halten-probe.mjs
 *   node tools/wappen-halten-probe.mjs --ziel http://127.0.0.1:9101/neu/
 *   node tools/wappen-halten-probe.mjs --bilder /tmp/wappen
 * ENDE 0, wenn jede Aussage haelt.
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { WAPPEN_HALTEN_MS, WAPPEN_MITTE_JS } from './admin-weg.mjs'
import { fingerAufbau, fingerBestaetigen } from './finger.mjs'
import { eigenerBrowser, freierPort } from './leihgabe.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const MITGEGEBEN = typeof opt('ziel', null) === 'string' ? opt('ziel') : argv.find((a) => a.startsWith('http')) || null
const BILDER = typeof opt('bilder', null) === 'string' ? opt('bilder') : null

const warte = (ms) => new Promise((r) => setTimeout(r, ms))
let fehler = 0
const ja = (gut, satz, dazu = '') => {
  if (!gut) fehler++
  console.log(`${gut ? 'ok  ' : 'NEIN'}  ${satz}${dazu ? `  — ${dazu}` : ''}`)
}

/**
 * DER ZUSCHLAG AUF DIE FRIST.
 *
 * `elternEinstieg` prueft im Takt von `requestAnimationFrame`; zwischen dem
 * Erreichen der Frist und dem naechsten Bildschritt liegen bis zu 16 ms, und
 * die Ereigniskette vom CDP-Befehl bis zum Zuhoerer kostet noch einmal etwas.
 * 300 ms decken beides mit Abstand und sind trotzdem weit von den 800 ms
 * entfernt, mit denen der Gegenfall misst.
 */
const ZUSCHLAG = 300
/**
 * DIE ZAHL FUER DEN GEGENFALL — 800 UND NICHT 1150.
 *
 * 1150 ms maessen den Zuschlag dieses Werkzeugs und nicht die Frist: ein
 * bisschen Verzoegerung in der Kette, und der Fall kippte, ohne dass sich an
 * der Oberflaeche etwas geaendert haette. 800 ms sind ausserdem die Zahl, ab
 * der ein Griff laut tools/finger-probe.mjs zuverlaessig HAELT — der Fall
 * sagt also nicht „zu kurz zum Messen", sondern „lange genug fuer einen
 * Menschen und trotzdem zu kurz fuer diesen Knopf".
 */
const ZU_KURZ_MS = 800

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
  const p = await freierPort()
  ZIEL = `http://127.0.0.1:${p}/neu/`
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(p)], { cwd: WURZEL, stdio: 'ignore' })
  vorschau.unref()
  let gestorben = null
  vorschau.on('exit', (c) => {
    gestorben = c
  })
  const bis = Date.now() + 10000
  for (;;) {
    if (gestorben !== null) throw new Error(`tools/neu-vorschau.mjs endete sofort (${gestorben}) — Port ${p} belegt`)
    try {
      await fetch(`http://127.0.0.1:${p}/api/werke`)
      break
    } catch {
      if (Date.now() > bis) throw new Error('tools/neu-vorschau.mjs kam nicht hoch')
      await warte(150)
    }
  }
}
console.log(`ZIEL: ${ZIEL}${vorschau ? '  (eigene Vorschau)' : '  (mitgegeben)'}`)
console.log(`FRIST: ${WAPPEN_HALTEN_MS} ms (WAPPEN_HALTEN_MS, tools/admin-weg.mjs)\n`)

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

const browser = await eigenerBrowser({ fenster: '800,480' })
if (!browser) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

let ws = null
try {
  if (BILDER) await mkdir(BILDER, { recursive: true })
  ws = new WebSocket(await browser.seite(), { perMessageDeflate: false })
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  // 800x480 AUSDRUECKLICH. Ohne diese Zeile bekommt das Fenster die Groesse
  // ABZUEGLICH der Browserleisten — gemessen 800x337 statt 800x480. Die
  // Kategorienleiste steht dann anders, und der Abstand zwischen der letzten
  // Kategorie und dem Wappen war einmal scheinbar -18 px (eine Ueberlappung,
  // die es nicht gibt). Eine Geometrie ohne feste Schirmgroesse misst das
  // Fenster und nicht die Oberflaeche.
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  await fingerAufbau(ws, send)

  const ev = async (e) => {
    const r = await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Fehler in der Seite')
    return r.result.value
  }
  const bild = async (name) => {
    if (!BILDER) return null
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    const p = join(BILDER, `${name}.png`)
    await writeFile(p, Buffer.from(s.data, 'base64'))
    console.log(`      Bild: ${p}`)
    return p
  }

  /**
   * DIE SEITE FRISCH — und die Freigabe des Tors weg.
   *
   * Sie steht in `localStorage` und gilt zwei Minuten. Ein vorheriger Lauf
   * (auch der eines anderen Werkzeugs) faende den Bereich sonst schon offen,
   * und jeder Fall dieser Datei meldete gruen, ohne etwas gemessen zu haben.
   */
  const laden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(1800)
    await ev(`(() => { try { localStorage.clear(); sessionStorage.clear() } catch (_) {} return true })()`)
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2000)
    const da = await ev(`!!document.getElementById('wappen')`)
    if (!da) throw new Error('#wappen steht nicht im Baum — siehe tools/admin-weg.mjs')
  }

  /** Steht der Admin-Bereich offen? Ueber das WIRKLICHE Rechteck, nicht `hidden`. */
  const offen = () =>
    ev(`(() => { const e = document.getElementById('eltern'); if (!e) return false
      const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 })()`)

  /**
   * WIE VOLL IST DER RING — UND MALT ER AUCH ETWAS?
   *
   * `da` (steht das Rechteck?) und `fuell` (waechst die Eigenschaft?) reichen
   * NICHT, und das ist am 06.08.2026 gemessen worden: `.wappen-ring` griff
   * nach `var(--akzent)`, und die Farbe heisst in diesem Stilblatt `--accent`.
   * Ein Verlauf mit einer unbekannten Eigenschaft ist an der berechneten
   * Stelle ungueltig — der Browser warf die ganze Erklaerung weg und
   * `background-image` stand auf `none`. Der Ring hatte die richtige Groesse,
   * `--wappen-fuell` wuchs sauber von 0 auf 1, UND ES WAR NICHTS ZU SEHEN.
   *
   * Deshalb wird hier die WIRKLICH BERECHNETE Farbe gelesen, samt dem Winkel,
   * den der Verlauf daraus gemacht hat. Ein Ring, der nichts malt, ist genau
   * die Sorte Attrappe, die durch gruene Zahlen rutscht — und er ist der
   * ganze Sinn dieser Aenderung.
   */
  const ring = () =>
    ev(`(() => {
      const k = document.getElementById('wappen')
      const r = document.getElementById('wappen-ring')
      if (!k || !r) return null
      const s = getComputedStyle(r)
      const b = r.getBoundingClientRect()
      const bg = s.backgroundImage || 'none'
      const g = bg.match(/([0-9.]+)deg/)
      return { da: !r.hidden && b.width > 0,
               fuell: Number(k.style.getPropertyValue('--wappen-fuell') || -1),
               malt: bg !== 'none' && bg.indexOf('rgb') >= 0,
               grad: g ? Number(g[1]) : -1,
               bg: bg.slice(0, 60),
               zeiger: s.pointerEvents } })()`)

  // ── Die Beruehrung, aufgeteilt: aufsetzen, halten, abheben ──────────────
  // Der Ring muss WAEHREND des Haltens gelesen werden. Deshalb wird hier nicht
  // `tippen()` aus finger.mjs benutzt, sondern die drei Schritte einzeln.
  const punkt = (x, y) => ({ x: Math.round(x), y: Math.round(y), radiusX: 12, radiusY: 12, force: 1, id: 1 })
  const auf = (x, y) => send(ws, 'Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [punkt(x, y)] })
  const bewegen = (x, y) => send(ws, 'Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [punkt(x, y)] })
  const ab = () => send(ws, 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const abbruch = () => send(ws, 'Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })

  const mitte = async () => {
    const m = await ev(WAPPEN_MITTE_JS)
    if (!m) throw new Error('#wappen nicht im Baum — siehe tools/admin-weg.mjs')
    return m
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  0. DAS WAPPEN IST JETZT EIN BERUEHRZIEL — es war vorher keines
  // ═══════════════════════════════════════════════════════════════════════
  //
  // BIS ZUM 06.08.2026 WAR DER SCHRIFTZUG EIN `<div>`. Er stand da und tat
  // nichts; die Marken fuer Beruehrziele (9 mm Groesse, 2 mm Abstand, ISO
  // 9241-411) galten fuer ihn nicht, weil er keines war. Seit er ein
  // `<button>` ist, gelten sie — und das ist die eine Folge dieses Umbaus,
  // die man an keiner Geste sieht.
  //
  // WER DAS URTEIL FAELLT, IST NICHT DIESES WERKZEUG. Die 9-mm-Marke wird von
  // tools/beruehrziele-neu.mjs und tools/tor-bei-offener-leiste.mjs gemessen,
  // und dort ist sie ROT (7,56 mm). Hier stehen die Zahlen, weil sie ZU DIESEM
  // KNOPF gehoeren und ein Umbau der Leiste sie beide auf einmal verschiebt —
  // wer die Frist aendert, sieht dann gleich, was er sonst noch bewegt hat.
  console.log('══ 0. Das Wappen als Beruehrziel ══')
  await laden()
  {
    const g = await ev(`(() => {
      const k = document.getElementById('wappen')
      const kats = [...document.querySelectorAll('.kat')]
      if (!k || !kats.length) return null
      const r = k.getBoundingClientRect()
      const l = kats[kats.length - 1].getBoundingClientRect()
      return { b: Math.round(r.width), h: Math.round(r.height),
               klein: Math.min(r.width, r.height),
               luecke: r.top - l.bottom,
               kat: (kats[kats.length - 1].textContent || '').trim() } })()`)
    if (!g) throw new Error('#wappen oder die Kategorien stehen nicht im Baum')
    const mm = (px) => (px * 0.14).toFixed(2)
    console.log(`    #wappen ${g.b}x${g.h} px — schmalere Seite ${mm(g.klein)} mm (Marke 9 mm)`)
    console.log(`    Luecke zur letzten Kategorie „${g.kat}": ${Math.round(g.luecke)} px = ${mm(g.luecke)} mm (Marke 2 mm)`)
    // DIESE MARKE HAELT, UND SIE GEHOERT HIERHER: kein anderes Werkzeug fragt
    // nach genau diesem Paar. Ein Kind, das „Radio" antippen will und den
    // Schriftzug erwischt, faengt eine Haltegeste an, von der es nichts weiss.
    ja(
      g.luecke * 0.14 >= 2,
      'der Abstand zur letzten Kategorie haelt die 2-mm-Marke',
      `${mm(g.luecke)} mm`,
    )
    // UND DIE 9-mm-MARKE HAELT NICHT. Sie steht hier ohne eigenes Urteil, weil
    // sonst zwei Werkzeuge dieselbe Zeile rot faerben; gemeldet wird sie
    // trotzdem, damit sie beim Lesen dieser Datei nicht fehlt.
    if (g.klein * 0.14 < 9) {
      console.log(`    HINWEIS: ${mm(g.klein)} mm liegen UNTER der 9-mm-Marke.`)
      console.log('             Das Urteil dazu faellt tools/beruehrziele-neu.mjs.')
      console.log(`             Der Knopf steht ${Math.round(g.luecke)} px unter „${g.kat}"; auf 65 px`)
      console.log('             Hoehe bliebe von der Luecke weniger als die 2-mm-Marke.')
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  1. DIE VOLLE FRIST OEFFNET — und der Ring fuellt sich dabei
  // ═══════════════════════════════════════════════════════════════════════
  console.log('══ 1. Die volle Frist gehalten ══')
  await laden()
  {
    const m = await mitte()
    console.log(`    #wappen: ${m.breite}x${m.hoehe} px, Mitte ${m.x},${m.y}`)
    const vorher = await offen()
    ja(vorher === false, 'vor dem Griff ist der Bereich ZU (sonst misst dieser Lauf nichts)')
    // DAS BILD IM RUHEZUSTAND — es gehoert zum naechsten dazu. Ob der Ring
    // etwas taugt, sagt kein Zahlenwert; das sagt nur der Vergleich der
    // beiden Bilder, und dafuer muss es beide geben.
    await bild('leiste-ruhe')

    await auf(m.x, m.y)
    // Drei Proben ueber die Frist verteilt. Sie muessen WACHSEN — ein Ring,
    // der auf einem Wert steht, waere eine Attrappe, und genau davor warnt
    // der Kommentar im Stilblatt (keine Animation ueber feste Dauer).
    const proben = []
    for (const anteil of [0.25, 0.55, 0.85]) {
      await warte(WAPPEN_HALTEN_MS * (anteil - (proben.length ? [0.25, 0.55][proben.length - 1] : 0)))
      proben.push(await ring())
    }
    const daBeimHalten = proben.every((p) => p && p.da)
    ja(daBeimHalten, 'der Ring STEHT DA, waehrend gehalten wird', proben.map((p) => (p ? (p.da ? 'da' : 'weg') : '—')).join(' '))
    const werte = proben.map((p) => (p ? p.fuell : -1))
    ja(
      werte[0] > 0 && werte[1] > werte[0] && werte[2] > werte[1],
      'und er FUELLT SICH — --wappen-fuell waechst ueber die Frist',
      werte.map((w) => w.toFixed(2)).join(' -> '),
    )
    // UND ER MALT AUCH ETWAS. Ohne diese Zeile meldet ein Ring gruen, dessen
    // Verlauf der Browser als ungueltig weggeworfen hat (siehe `ring()`).
    ja(
      proben.every((p) => p && p.malt),
      'und er MALT WIRKLICH — der Kegelverlauf hat eine berechnete Farbe',
      proben[0] ? proben[0].bg : '—',
    )
    const grade = proben.map((p) => (p ? p.grad : -1))
    ja(
      grade[0] > 0 && grade[1] > grade[0] && grade[2] > grade[1],
      'und der GEMALTE Winkel waechst mit — nicht nur die Eigenschaft',
      grade.map((g) => `${g}°`).join(' -> '),
    )
    // DER RING LIEGT UEBER DEM SCHRIFTZUG. Ohne `pointer-events: none` finge
    // er die Beruehrung ab, die ihn erzeugt hat — der Knopf ginge nie auf,
    // und die Ursache saehe nach „das Halten wird nicht erkannt" aus.
    const zeiger = proben[proben.length - 1]?.zeiger
    ja(zeiger === 'none', 'und er faengt die Beruehrung NICHT ab (pointer-events: none)', String(zeiger))
    const wer = await ev(
      `(() => { const e = document.elementFromPoint(${m.x}, ${m.y}); return e ? (e.id ? '#' + e.id : e.tagName) : 'nichts' })()`,
    )
    ja(wer !== '#wappen-ring', 'auf der Mitte des Knopfes liegt nicht der Ring', String(wer))
    await bild('halten-mitten-drin')

    await warte(WAPPEN_HALTEN_MS * 0.15 + ZUSCHLAG)
    ja(await offen(), 'DIE VOLLE FRIST OEFFNET DEN BEREICH', `${WAPPEN_HALTEN_MS} ms + ${ZUSCHLAG} ms Zuschlag`)
    await ab()
    await warte(300)
    const nachher = await ring()
    ja(nachher && !nachher.da, 'und danach ist der Ring WEG', nachher ? (nachher.da ? 'steht noch da' : 'weg') : '—')
    ja(nachher && nachher.fuell === -1, 'und --wappen-fuell ist geraeumt, nicht auf 1 stehengeblieben', String(nachher?.fuell))
    await bild('bereich-offen')
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  2. ZU KURZ GEHALTEN — der Gegenfall, ohne den Fall 1 nichts sagt
  // ═══════════════════════════════════════════════════════════════════════
  console.log(`\n══ 2. Nur ${ZU_KURZ_MS} ms gehalten ══`)
  await laden()
  {
    const m = await mitte()
    await auf(m.x, m.y)
    await warte(ZU_KURZ_MS)
    await ab()
    await warte(600)
    ja(!(await offen()), `${ZU_KURZ_MS} ms oeffnen den Bereich NICHT`, `Frist ${WAPPEN_HALTEN_MS} ms`)
    const r = await ring()
    ja(r && !r.da, 'und das Loslassen RAEUMT DEN RING WEG', r ? (r.da ? 'steht noch da' : 'weg') : '—')
    ja(r && r.fuell === -1, 'und --wappen-fuell bleibt nicht auf halbem Weg stehen', String(r?.fuell))
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  3. EIN FINGER, DER ZITTERT — er darf nicht bestraft werden
  // ═══════════════════════════════════════════════════════════════════════
  //
  // EIN MENSCH HAELT NICHT STILL, und ein Elternteil mit einem Kind auf dem
  // Arm schon gar nicht. Bricht der Griff bei 4 px Zittern ab, ist die
  // Bedienung an der Box unbrauchbar — und in keiner Maus-Messung zu sehen,
  // denn eine Maus zittert nicht.
  console.log('\n══ 3. Ein Finger, der beim Halten zittert ══')
  await laden()
  {
    const m = await mitte()
    await auf(m.x, m.y)
    const n = Math.round((WAPPEN_HALTEN_MS + ZUSCHLAG) / 40)
    for (let i = 1; i <= n; i++) {
      await warte(40)
      const d = (i % 2 === 0 ? 1 : -1) * 4
      await bewegen(m.x + d, m.y + d)
    }
    ja(await offen(), 'ein Zittern von 4 px bricht den Griff NICHT ab')
    await ab()
    await warte(200)
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  4. `pointercancel` — der Abbruch, den nur ein Finger erzeugt
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Blink beansprucht eine Beruehrung fuers Rollen und storniert sie. Am
  // Geraet passiert das, wenn der Finger beim Halten abrutscht. Hier wird es
  // ausdruecklich erzeugt (`touchCancel`) statt abgewartet — was gemessen
  // werden soll, ist die REAKTION darauf und nicht Blinks Schwelle.
  console.log('\n══ 4. Die Beruehrung wird storniert ══')
  await laden()
  {
    const m = await mitte()
    await auf(m.x, m.y)
    await warte(Math.round(WAPPEN_HALTEN_MS * 0.5))
    const vorher = await ring()
    ja(vorher && vorher.da, 'der Ring stand da, als storniert wurde (sonst misst dieser Fall nichts)')
    await abbruch()
    await warte(WAPPEN_HALTEN_MS + ZUSCHLAG)
    ja(!(await offen()), 'pointercancel BRICHT AB — der Bereich geht nicht auf')
    const r = await ring()
    ja(r && !r.da, 'und der Ring ist danach weg', r ? (r.da ? 'steht noch da' : 'weg') : '—')
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  5. WAS DIE BERUEHRUNG WIRKLICH WAR
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Ohne diese Zeile koennte die ganze Datei gruen melden, waehrend Blink in
  // Wahrheit Mausereignisse geschickt hat — dann waere kein einziger der
  // Faelle oben eine Aussage ueber einen FINGER.
  const f = await fingerBestaetigen(ws, send)
  console.log(`\nFinger: ontouchstart ${f.ontouchstart}, ${f.breite}x${f.hoehe}, grob ${f.grob}`)
  ja(f.taugt === true, 'gemessen wurde mit ECHTEN Beruehrungen, nicht mit der Maus', JSON.stringify(f))

  console.log(`\n${fehler === 0 ? 'ALLES GRUEN' : `${fehler} Aussage(n) halten NICHT`}`)
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen()
  vorschau?.kill()
}
process.exit(fehler === 0 ? 0 : 1)
