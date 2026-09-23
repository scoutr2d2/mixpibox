#!/usr/bin/env node
/**
 * ANTWORTET DIE KACHEL, WAEHREND DER FINGER NOCH DRAUFLIEGT?
 *
 * ══ DIE MELDUNG ════════════════════════════════════════════════════════════
 * Betreiber, 04.09.2026: „ich denke man klickt mehrfach wenn nichts passiert
 * auch eine schnelle optische rueckmeldung fehlt."
 *
 * Das ist eine andere Frage als „wie lange dauert der Start" (die misst
 * tools/titeltipp-verzoegerung.py: 596-1340 ms bis Ton). Hier geht es um die
 * Millisekunden VOR jedem Netzverkehr — um das, was ein Knopf tut, wenn man
 * ihn drueckt.
 *
 * ══ DER UNTERSCHIED, um den alles kreist ═══════════════════════════════════
 * Es gibt ZWEI Rueckmeldungen, und sie kommen zu verschiedenen Zeiten:
 *
 *   `:active`   reine CSS-Regel, greift beim AUFSETZEN des Fingers.
 *               Kein Handler, kein Netz, keine Wartezeit — sie ist da,
 *               bevor irgendetwas anderes passiert.
 *   `.laeuft`   setzt der Klick-Handler, und `click` faellt beim LOSLASSEN.
 *               Wer den Finger eine halbe Sekunde liegen laesst, sieht bis
 *               dahin nichts.
 *
 * Eine Oberflaeche, die nur das Zweite hat, fuehlt sich taub an, obwohl sie
 * antwortet. Genau darum geht es in der Meldung.
 *
 * ══ WIE GEMESSEN WIRD ══════════════════════════════════════════════════════
 * Mit einem ECHTEN FINGER (`Input.dispatchTouchEvent`), nicht mit
 * `element.click()`: `:active` entsteht aus der Beruehrung, ein synthetischer
 * Klick erzeugt sie gar nicht. Gelesen wird `getComputedStyle` am sichtbaren
 * Kind (dort sitzen die Regeln des Hauses) — und zwar dreimal:
 *
 *     ruhig   ->   FINGER LIEGT AUF   ->   losgelassen
 *
 * Verglichen werden `transform`, `box-shadow`, `opacity`, `filter` und die
 * Hintergrundfarbe. Was sich zwischen „ruhig" und „Finger liegt auf" aendert,
 * IST die Druckantwort; was sich erst danach aendert, kommt vom Handler.
 *
 * GEMESSEN WIRD DIE BERECHNETE REGEL, nicht das Rechteck. `getBoundingClient-
 * Rect` liefert ohne sichtbares Fenster veraltete Werte [llmwiki
 * vorschau-ohne-pane-luegt-beim-layout] — die Farbe und die Matrix nicht.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei und NICHTS AN EINER BOX. Eigene Vorschau auf freiem
 * Port, eigener Browser ([[vorschau-wird-geliehen]]). Getippt wird kurz und
 * die Kachel spielt in der Attrappe nichts.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/druck-rueckmeldung-schau.mjs
 *   node tools/druck-rueckmeldung-schau.mjs --pruefen   # Ende 1, wenn eine
 *                                                       # Sorte stumm bleibt
 *   node tools/druck-rueckmeldung-schau.mjs http://127.0.0.1:8299/neu/
 */
import WebSocket from 'ws'
import { eigenerBrowser, freierPort, vorschauLeihen } from './leihgabe.mjs'
import { fingerAufbau, fingerBestaetigen } from './finger.mjs'

const PRUEFEN = process.argv.includes('--pruefen')
const ZIEL = process.argv.find((a) => a.startsWith('http')) || `http://127.0.0.1:${await freierPort()}/neu/`

/** Wie lange der Finger liegen bleibt, bevor gelesen wird. Ein Mensch
 *  braucht rund 80-120 ms fuers Antippen; 250 ms sind sicher darueber und
 *  immer noch kein Halten. */
const DRUCK_MS = 250

/** Die Sorten, die ein Kind antippt — Wahl der Kachel, dann das SICHTBARE
 *  Kind, an dem die Regeln des Hauses haengen ('' = das Element selbst). */
const SORTEN = [
  { name: 'Raster-Kachel', wahl: '#raster > .kachel', kind: '.kachel-bild' },
  { name: 'Lane: Album', wahl: '#raster .lane-kachel:not(.stueck)', kind: '.lane-bild' },
  { name: 'Lane: Titel', wahl: '#raster .lane-kachel.stueck', kind: '.lane-bild' },
  { name: 'Weiterhoeren', wahl: '.weiter-kachel', kind: '.weiter-bild' },
  { name: 'Zurueck', wahl: '#zurueck', kind: '' },
]

const leihe = await vorschauLeihen(ZIEL)
const brw = await eigenerBrowser({ fenster: '800,480' }).catch(async (e) => {
  await leihe.zurueckgeben()
  console.error(`  Browser kam nicht hoch — Messung nicht moeglich: ${e.message}`)
  process.exit(2)
})
if (!brw) {
  await leihe.zurueckgeben()
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
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
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

let stumm = 0
try {
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  // ERST DEN FINGER EINSCHALTEN, DANN LADEN — und das ist keine Formsache.
  // `Emulation.setTouchEmulationEnabled` wirkt auf `window.ontouchstart` erst
  // beim naechsten Aufbau der Seite. In der umgekehrten Reihenfolge meldet
  // `fingerBestaetigen` brav `ontouchstart: false`, und wer das nicht liest,
  // misst eine Seite, die gar keinen Beruehrungsschirm zu haben glaubt — der
  // erste Lauf dieses Werkzeugs am 04.09.2026 tat genau das und meldete drei
  // Sorten als „stumm", die es gar nicht sind.
  await fingerAufbau(ws, send)
  for (const l of ['voll', 'verschmolzen-an']) await fetch(new URL(`/vorschau/${l}`, ZIEL)).catch(() => {})
  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2500)
  // OHNE DIESE BESTAETIGUNG MISST DIE PROBE DAS NICHTS: kommt die Beruehrung
  // gar nicht an, sieht „keine Druckantwort" genauso aus wie eine fehlende
  // CSS-Regel. finger.mjs prueft das mit einem eigenen Testziel.
  const w = await fingerBestaetigen(ws, send).catch(() => null)
  if (!w || !w.taugt) {
    console.error(`  Der Finger kommt in dieser Umgebung nicht an (${JSON.stringify(w)}) — `
      + 'hier wuerde das Nichts gemessen.')
    process.exit(2)
  }

  /** Die Regeln, an denen man eine Druckantwort erkennt. */
  const LESEN = `(el) => { const s = getComputedStyle(el); return [
      s.transform, s.boxShadow, s.opacity, s.filter, s.backgroundColor].join(' | ') }`

  /* ══ DAS MESSGERAET AN EIN BEKANNTES SIGNAL HALTEN ═══════════════════════
   *
   * PFLICHT, BEVOR IRGENDEIN „stumm" ETWAS BEDEUTET [llmwiki
   * messinstrument-gegen-bekanntes-signal]. Hier wird ein Knopf eingehaengt,
   * der beim Druck seine Farbe UND seine Matrix wechselt — unuebersehbar.
   * Liest die Messung IHN als stumm, misst sie nicht die Oberflaeche,
   * sondern sich selbst: dann greift `:active` unter dem synthetischen
   * Finger dieser Umgebung gar nicht, und jedes „stumm" weiter unten waere
   * eine Falschmeldung.
   */
  const eichen = async (id) => {
    await ev(`(() => {
        const s = document.createElement('style')
        s.textContent = '#${id}{position:fixed;left:8px;top:8px;width:80px;height:80px;'
          + 'z-index:99999;background:#111;transform:none}'
          + '#${id}:active,#${id}.gedrueckt{background:#f0f;transform:scale(0.5)}'
        s.id = '${id}-stil'
        document.head.appendChild(s)
        const b = document.createElement('button')
        b.id = '${id}'
        ${id === 'eich-zeiger'
          ? `b.addEventListener('pointerdown', () => b.classList.add('gedrueckt'));
             b.addEventListener('pointerup', () => b.classList.remove('gedrueckt'));`
          : ''}
        document.body.appendChild(b)
        window.__ziel = b
        return true })()`)
    const ruhig = await ev(`(${LESEN})(window.__ziel)`)
    await send(ws, 'Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 48, y: 48, radiusX: 12, radiusY: 12, force: 1, id: 1 }],
    })
    await warte(DRUCK_MS)
    const gedrueckt = await ev(`(${LESEN})(window.__ziel)`)
    await send(ws, 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await ev(`(() => { for (const x of ['${id}', '${id}-stil']) {
        const e = document.getElementById(x); if (e) e.remove() } return true })()`)
    return gedrueckt !== ruhig
  }

  const aktivGeht = await eichen('eich-aktiv')
  const zeigerGeht = await eichen('eich-zeiger')
  console.log(`  Eichung  :active ${aktivGeht ? 'greift' : 'greift NICHT'}`
    + `   pointerdown-Klasse ${zeigerGeht ? 'greift' : 'greift NICHT'}`)
  if (!aktivGeht && !zeigerGeht) {
    console.error('  MESSGERAET TAUGT NICHT: Selbst ein Knopf, der beim Druck die Farbe')
    console.error('  wechselt, liest sich unveraendert — auf BEIDEN Wegen. Jedes „stumm"')
    console.error('  weiter unten waere erfunden.')
    process.exit(2)
  }
  if (!aktivGeht) {
    console.log('  ACHTUNG: `:active` ist unter diesem synthetischen Finger nicht messbar.')
    console.log('  Eine Sorte, die NUR eine `:active`-Regel hat, erscheint unten faelschlich')
    console.log('  als stumm. Verlaesslich gemessen wird hier nur der Zeiger-Weg.')
  }
  console.log()

  /** Kachel suchen, ihre Mitte nehmen, das sichtbare Kind bestimmen. */
  const zielSetzen = (wahl, kind) => `(() => {
      const k = document.querySelector(${JSON.stringify(wahl)})
      if (!k) return null
      const kind = ${JSON.stringify(kind)} ? k.querySelector(${JSON.stringify(kind)}) : k
      if (!kind) return null
      window.__ziel = kind
      // HERANROLLEN, SONST MISST MAN NICHT. Die Weiterhoeren-Reihe steht ganz
      // oben und rutscht aus dem Bild, sobald eine Lane aufklappt — der Finger
      // traefe dann einen Punkt bei y = -405, und „nicht getroffen" saehe aus
      // wie ein Ergebnis.
      try { k.scrollIntoView({ block: 'center', inline: 'center' }) } catch {}
      const r = k.getBoundingClientRect()
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2)
      // WAS LIEGT WIRKLICH AN DIESEM PUNKT? Ohne diese Frage sieht „kein
      // Druck" genauso aus wie „der Finger hat die Kachel nie getroffen" —
      // weil sie aus dem Sichtfenster gerollt ist oder etwas darueber liegt.
      const oben = (x >= 0 && y >= 0 && x < innerWidth && y < innerHeight)
        ? document.elementFromPoint(x, y) : null
      return { x, y, breit: Math.round(r.width), hoch: Math.round(r.height),
               imBild: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight,
               trifft: !!(oben && k.contains(oben)),
               gesperrt: !!(k.disabled || getComputedStyle(k).pointerEvents === 'none') }
    })()`

  /* ERST EINE LANE AUFKLAPPEN — sonst gibt es die Sorte gar nicht.
   *
   * UND ZWAR EINE, DIE WIRKLICH AUFKLAPPT: die erste Kachel im Raster kann
   * ein Werk sein, das sofort spielt. Dann steht keine Lane da, die Sorte
   * meldet „nicht auf dem Schirm", und das liest sich wie ein Ergebnis. Das
   * Messwerk kommt deshalb vom Server (art=album), nicht aus dem Raster. */
  // DIE LAGE VOR DEM LADEN STELLEN — ohne `voll` fuehrt die Attrappe keine
  // Alben, und ohne Alben gibt es keine Lane, in der Titel stehen koennten.
  for (const l of ['voll', 'verschmolzen-an']) await fetch(new URL(`/vorschau/${l}`, ZIEL)).catch(() => {})
  const werke = (await (await fetch(new URL('/api/werke?verschmelzen=1', ZIEL))).json()).werke || []
  // DASSELBE MESSWERK WIE IN tools/titeltipp-mehrfach-probe.mjs, und aus
  // demselben Grund: Nicht jedes `art: album` der Attrappe klappt eine
  // Titelliste auf. Eines mit MEHREREN Quellen tut es nachweislich — waehlte
  // man blind das erste, stuende hier „gibt es hier nicht", und das laese
  // sich wie ein Befund.
  const album = werke.find((w) => w.art === 'album' && (w.quellen || []).length > 1)
    || werke.find((w) => w.art === 'album') || werke[0]
  const laneAufklappen = () => ev(`(() => {
      const suche = () => [...document.querySelectorAll('#raster > .kachel')]
        .find((k) => ((k.querySelector('.kachel-titel') || {}).textContent || '')
          === ${JSON.stringify(String((album || {}).titel || ''))})
      let k = suche()
      if (!k) {
        for (const r of [...document.querySelectorAll('#raster > .kachel')]) {
          if (!r.querySelector('.regal-zahl')) continue
          r.click(); k = suche(); if (k) break
        }
      }
      if (k) k.click()
      return !!k })()`)
  await laneAufklappen()
  await warte(2000)

  console.log(`  Druckantwort je Sorte, Finger liegt ${DRUCK_MS} ms auf`)
  console.log()
  console.log(`  ${'Sorte'.padEnd(16)} ${'Groesse'.padEnd(10)} ${'Aufsetzen'.padEnd(15)} ${'wer traegt den Druck'.padEnd(27)} Loslassen`)
  console.log('  ' + '─'.repeat(94))

  for (const s of SORTEN) {
    const lage = await ev(zielSetzen(s.wahl, s.kind))
    if (!lage) {
      console.log(`  ${s.name.padEnd(16)} ${'—'.padEnd(10)} gibt es hier nicht`)
      continue
    }
    // ZWEI LAGEN, DIE KEIN BEFUND SIND, und die getrennt gehoeren: ein
    // gesperrter Knopf SOLL nicht nachgeben (`#zurueck` auf der Startseite
    // traegt `pointer-events: none` — ein Druck wuerde etwas versprechen,
    // was es nicht gibt), und was der Finger gar nicht trifft, sagt ueber
    // seine Regeln nichts.
    if (lage.gesperrt) {
      console.log(`  ${s.name.padEnd(16)} ${`${lage.breit}x${lage.hoch}`.padEnd(10)} gesperrt — soll nicht nachgeben`)
      continue
    }
    if (!lage.imBild || !lage.trifft) {
      console.log(`  ${s.name.padEnd(16)} ${`${lage.breit}x${lage.hoch}`.padEnd(10)} `
        + `NICHT GETROFFEN bei ${lage.x},${lage.y}` + (lage.imBild ? ' (etwas liegt darueber)' : ' (ausserhalb)'))
      continue
    }
    const ruhig = await ev(`(${LESEN})(window.__ziel)`)
    await send(ws, 'Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: lage.x, y: lage.y, radiusX: 12, radiusY: 12, force: 1, id: 1 }],
    })
    await warte(DRUCK_MS)
    const gedrueckt = await ev(`(${LESEN})(window.__ziel)`)
    // WER HAT DEN DRUCK BEKOMMEN — die Frage, die ein blosses „stumm" offen
    // laesst. Traegt eine ANDERE Kachel die Klasse, hat der Finger nicht die
    // gemeinte getroffen (ein Knopf obenauf), und das ist ein ganz anderer
    // Befund als „es gibt keine Regel".
    const wer = await ev(`(() => { const g = document.querySelector('.gedrueckt')
        return g ? (g.className || g.tagName) : (document.querySelector(':active') ? ':active' : '—') })()`)
    await send(ws, 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await warte(120)
    const danach = await ev(`(${LESEN})(window.__ziel)`)

    const beimDruck = gedrueckt !== ruhig
    const beimLoslassen = danach !== gedrueckt
    if (!beimDruck) stumm++
    console.log(
      `  ${s.name.padEnd(16)} ${`${lage.breit}x${lage.hoch}`.padEnd(10)} ` +
        `${(beimDruck ? 'JA' : 'nein — stumm').padEnd(15)} ` +
        `${String(wer).slice(0, 26).padEnd(27)} ${beimLoslassen ? 'aendert sich' : 'unveraendert'}`,
    )
    // Zwischen zwei Sorten muss das Aufleuchten des Handlers abklingen,
    // sonst liest die naechste Sorte den Nachhall der vorigen als „ruhig".
    await warte(1600)
  }

  /* ══ WER ROLLT, DRUECKT NICHT — die Gegenrichtung ═══════════════════════
   *
   * SIE GEHOERT ZWINGEND DAZU. Eine Kachel, die beim Aufsetzen nachgibt und
   * dann waehrend des Rollens dunkel stehenbleibt, hat aus der Rueckmeldung
   * eine Luege gemacht: Sie verspricht einen Tipp, den es nie gab. Gemessen
   * wird mit einer echten Zugbewegung, nicht mit einem Ereignis von Hand. */
  console.log()
  // ERNEUT AUFKLAPPEN: Die Messungen oben sind echte TIPPS (Aufsetzen und
  // Loslassen) — der auf die Raster-Kachel hat die Lane inzwischen wieder
  // zugemacht. Ohne diese Zeile misst die Rollprobe das Nichts und sagt es
  // brav.
  await laneAufklappen()
  await warte(1800)
  const zug = await ev(zielSetzen('#raster .lane-kachel.stueck', '.lane-bild'))
  if (zug && zug.trifft) {
    await send(ws, 'Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: zug.x, y: zug.y, radiusX: 12, radiusY: 12, force: 1, id: 1 }],
    })
    await warte(60)
    const beimAufsetzen = await ev(`document.querySelectorAll('.gedrueckt').length`)
    for (let i = 1; i <= 6; i++) {
      await warte(25)
      await send(ws, 'Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: zug.x - i * 8, y: zug.y, radiusX: 12, radiusY: 12, force: 1, id: 1 }],
      })
    }
    const beimRollen = await ev(`document.querySelectorAll('.gedrueckt').length`)
    await send(ws, 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await warte(120)
    const danach = await ev(`document.querySelectorAll('.gedrueckt').length`)
    const gut = Number(beimAufsetzen) >= 1 && Number(beimRollen) === 0 && Number(danach) === 0
    if (!gut) stumm++
    console.log(`  ${gut ? 'gut ' : 'ROT '} Rollen         beim Aufsetzen ${beimAufsetzen} gedrueckt, `
      + `nach 48 px Zug ${beimRollen}, nach dem Loslassen ${danach}`
      + (gut ? '' : ' — eine Kachel bleibt gedrueckt stehen, ohne dass getippt wurde'))
  } else {
    console.log('  ohne Titel-Kachel laesst sich das Rollen nicht messen')
  }

  console.log()
  if (stumm) {
    console.log(`  ${stumm} Sorte(n) antworten dem Finger NICHT, solange er aufliegt.`)
    console.log('  Wer dort tippt, sieht bis zum Loslassen nichts — und tippt noch einmal.')
  } else {
    console.log('  Jede Sorte antwortet, waehrend der Finger aufliegt.')
  }
  await send(ws, 'Browser.close').catch(() => {})
  ws.close()
} finally {
  await brw.schliessen().catch(() => {})
  await leihe.zurueckgeben().catch(() => {})
}
process.exit(PRUEFEN && stumm ? 1 : 0)
