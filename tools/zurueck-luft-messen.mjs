#!/usr/bin/env node
/**
 * WIEVIEL LUFT HAT DER EINE RUECKWEG-KNOPF — und wem kommt er zu nahe?
 *
 * ══ WOZU, UND WARUM NEBEN tools/beruehrziele-neu.mjs ══════════════════════
 *
 * `beruehrziele-neu.mjs` misst die GROESSE jedes Ziels und nennt je Schirm den
 * EINEN engsten Abstand. Damit ist der Befund gefunden worden, um den es hier
 * geht (E8/T2, 05.08.2026):
 *
 *     engster Abstand: 0.14 mm (1 px) — unter 2 mm
 *        zwischen button#zurueck.zurueck  „Zurück"
 *        und      button.fach-knopf       „WLAN — öffnet die bisherige Oberfläche"
 *
 * Fuer die REPARATUR reicht diese eine Zeile nicht. `#zurueck` ist der einzige
 * Knopf der Oberflaeche, der `position: fixed` ueber ALLEM liegt (z-index 9) —
 * er hat keine Nachbarn in einer Reihe, sondern LANDET auf dem, was gerade
 * darunter aufgeht. Wer ihn vergroessert, ohne zu wissen, wer wo liegt, macht
 * aus 1 px Abstand eine Ueberdeckung. Genau diese Sorte Fehler ist am
 * 04.08.2026 durch vier gruene Pruefdurchgaenge gerutscht
 * ([[rueckweg-verdeckt-die-ueberschrift]]) — dort lag er auf einer
 * UEBERSCHRIFT, und eine Ueberschrift ist kein Bedienelement.
 *
 * DIESES WERKZEUG NENNT DESHALB DIE RECHTECKE, nicht nur die eine Zahl: jeden
 * Nachbarn unter 4 mm, mit seiner Lage, der Richtung und dem, was fehlt. Und
 * es unterscheidet zwei Faelle, die in einer einzelnen Millimeterzahl gleich
 * aussehen:
 *
 *   ZU NAH        die Rechtecke beruehren sich nicht, liegen aber unter den
 *                 2 mm der ISO 9241-411 — ein Fehlgriff loest den Nachbarn aus.
 *   UEBERDECKT    die Rechtecke ueberschneiden sich. Der Nachbar ist dann an
 *                 dieser Stelle GAR NICHT zu treffen, und keine Zahl wird
 *                 kleiner — das Ziel meldet weiterhin seine volle Groesse.
 *
 * ══ WAS ES AENDERT ════════════════════════════════════════════════════════
 * Nichts an der Box. Eigener headless-Browser gegen die Vorschau; die
 * geliehene Lage wird im `finally` zurueckgelegt (tools/leihgabe.mjs).
 *
 * ══ ZWEI DINGE, DIE ES ABSICHTLICH NICHT TUT ══════════════════════════════
 *   * Es misst NICHT die Groesse — das tut beruehrziele-neu.mjs, und zwei
 *     Antworten auf dieselbe Frage laufen auseinander.
 *   * Es zaehlt einen AUSGEGRAUTEN Rueckweg nicht mit. Auf der Startseite steht
 *     er mit `disabled` und `pointer-events: none` da (ausgegraut statt weg,
 *     damit man ihn nicht jedes Mal neu sucht); dort ist er kein Ziel und kann
 *     keinem zu nahe kommen.
 *
 * AUFRUF
 *     node tools/zurueck-luft-messen.mjs
 *     node tools/zurueck-luft-messen.mjs http://127.0.0.1:8392/neu/
 *     node tools/zurueck-luft-messen.mjs --pruefen   # Ende 1 bei zu nah oder ueberdeckt
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'
import { adminAuf } from './admin-weg.mjs'

const argv = process.argv.slice(2)
const ZIEL = argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = argv.includes('--pruefen')

/** 800x480 auf 5" Waveshare, ohne Skalierung — dieselbe Zahl wie ueberall. */
const MM_JE_PIXEL = 0.14
/** 2 mm zwischen zwei Zielen, ISO 9241-411. */
const ABSTAND_MM = 2
/** Wer weiter weg ist, steht gar nicht erst in der Liste. */
const ZEIGEN_MM = 4

const mm = (px) => px * MM_JE_PIXEL
const mmS = (px) => mm(px).toFixed(2)
const warte = (ms) => new Promise((r) => setTimeout(r, ms))
const stellen = (was) => fetch(new URL(`/vorschau/${was}`, ZIEL)).then((r) => r.json())

let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}

/**
 * DER ABSTAND ZWEIER RECHTECKE, und die Ueberschneidung als NEGATIVE Zahl.
 *
 * Ueber beide Achsen zugleich: Zwei Rechtecke, die sich waagerecht ueberlappen
 * und senkrecht 1 px auseinanderliegen, haben Abstand 1 — nicht 0 und nicht
 * die Diagonale. Liegen sie diagonal versetzt, zaehlt die Diagonale.
 *
 * KEINE BACKTICKS IN DIESEM BLOCK — er steht in einem Schablonenliteral.
 */
const MESSEN_JS = String.raw`
(() => {
  const WAHL = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [tabindex]:not([tabindex="-1"])'
  const z = document.getElementById('zurueck')
  if (!z) return { da: false, grund: 'kein #zurueck im Baum' }
  const zs = getComputedStyle(z)
  if (zs.display === 'none' || zs.visibility === 'hidden' || Number(zs.opacity) === 0)
    return { da: false, grund: 'unsichtbar' }
  if (z.disabled === true || zs.pointerEvents === 'none')
    return { da: false, grund: 'ausgegraut (kein Ziel)' }
  const zr = z.getBoundingClientRect()

  const sichtbar = (e) => {
    const s = getComputedStyle(e)
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
    if (e.disabled === true || e.getAttribute('aria-disabled') === 'true') return false
    if (s.pointerEvents === 'none') return false
    const r = e.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false
    return true
  }
  const luecke = (a, b) => {
    const dx = Math.max(0, Math.max(a.left - b.right, b.left - a.right))
    const dy = Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom))
    if (dx === 0 && dy === 0) {
      // UEBERSCHNEIDUNG: als negative Zahl, damit sie in derselben Spalte
      // steht und trotzdem nie mit „beruehrt sich gerade" verwechselt wird.
      const ux = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const uy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      return ux > 0 && uy > 0 ? -Math.min(ux, uy) : 0
    }
    return Math.sqrt(dx * dx + dy * dy)
  }
  const wort = (e) =>
    (e.getAttribute('aria-label') || (e.textContent || '').trim() || e.id || '').slice(0, 46)
  const wer = (e) =>
    e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
    (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '')

  // LIEGT DER NACHBAR UEBERHAUPT OBEN? Der Eltern-Bereich ist eine volle
  // Ebene ueber der ganzen Seite; die Kategorienleiste darunter steht
  // weiterhin im Baum und ist 16 px vom Rueckweg entfernt — als NACHBAR ist
  // sie trotzdem keiner, sie ist nicht zu treffen. Wer das nicht trennt, sucht
  // einen zu engen Abstand an einer Stelle, an der gar nichts zu tippen ist.
  // (KEINE BACKTICKS IN DIESEM BLOCK — genau hier hat dieses Werkzeug beim
  //  ersten Lauf sein Schablonenliteral beendet. Dieselbe Falle steht in drei
  //  Nachbarwerkzeugen und war abgeschrieben schneller wiederholt als gelesen.)
  const obenauf = (e) => {
    const r = e.getBoundingClientRect()
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2)
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return true
    const g = document.elementFromPoint(x, y)
    return !!g && (g === e || e.contains(g) || g.contains(e))
  }

  const nachbarn = [...document.querySelectorAll(WAHL)]
    .filter((e) => e !== z && sichtbar(e))
    .map((e) => {
      const r = e.getBoundingClientRect()
      return {
        wer: wer(e), wort: wort(e), obenauf: obenauf(e),
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        abstand: Math.round(luecke(zr, r) * 100) / 100,
      }
    })
    .sort((a, b) => a.abstand - b.abstand)

  return {
    da: true,
    zurueck: { x: Math.round(zr.left), y: Math.round(zr.top), w: Math.round(zr.width), h: Math.round(zr.height) },
    ziele: nachbarn.length,
    nachbarn,
  }
})()`

const leihe = await vorschauLeihen(ZIEL)
const brw = await eigenerBrowser()
if (!brw) {
  console.log('  kein Browser gefunden — uebersprungen')
  await leihe.zurueckgeben()
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

try {
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  // 800x480 GENAU. Ohne diese Zeile gibt headless 800x337 her, und auf einem
  // Schirm, den es nicht gibt, liegen die Knoepfe woanders.
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const warteAuf = async (e, ms = 8000) => {
    const bis = Date.now() + ms
    while (Date.now() < bis) {
      if (await ev(e)) return true
      await warte(150)
    }
    return false
  }
  const neuLaden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warteAuf(`!!document.getElementById('zustand')`)
    await warte(600)
  }
  /** Das Zahnrad lange halten — so kommt man in den Eltern-Bereich. */
  const langHalten = async () => {
    // HIER STAND EIN GRIFF ANS ZAHNRAD `#einst-knopf`. Es ist am 06.08.2026
    // ersatzlos entfallen; hinein fuehrt der Schriftzug `#wappen`. Dieser Weg
    // ist der TASTATURWEG und prueft das Halten NICHT — tools/admin-weg.mjs.
    await adminAuf(ev, { warteMs: 700 })
  }

  const SCHIRME = [
    {
      name: 'eltern-flaeche',
      was: 'Eltern-Bereich mit Faechern — hier stand der 1-px-Abstand',
      hin: async () => {
        await stellen('voll')
        await stellen('sperre-aus')
        await neuLaden()
        await langHalten()
        if (!(await ev(`!document.getElementById('eltern-flaeche').hidden`)))
          throw new Error('die Eltern-Flaeche ging nicht auf')
      },
    },
    {
      name: 'eltern-tor',
      was: 'PIN-Tor — der Rueckweg neben dem Tastenfeld',
      hin: async () => {
        await stellen('voll')
        await stellen('sperre-pin')
        await neuLaden()
        await langHalten()
        if (!(await ev(`!document.getElementById('eltern-tor').hidden`)))
          throw new Error('das Tor ging nicht auf (steht die Sperre?)')
      },
    },
    {
      name: 'interpret',
      was: 'Interpretenseite — der Rueckweg ueber den Reihen',
      hin: async () => {
        await stellen('voll')
        await stellen('sperre-aus')
        await stellen('spielt')
        await neuLaden()
        const r = await ev(`(() => {
          const k = document.querySelector('#leute-reihe .leute-kachel')
          if (!k) return false
          k.click(); return true })()`)
        if (!r) throw new Error('keine Interpretenkachel im Bild')
        await warte(1200)
      },
    },
    {
      name: 'player',
      was: 'grosser Player — der Rueckweg ueber dem Cover',
      hin: async () => {
        await stellen('voll')
        await stellen('spielt')
        await neuLaden()
        const r = await ev(`(() => {
          const a = document.querySelector('.mp-bild'); if (!a) return false
          a.click(); return true })()`)
        if (!r) throw new Error('kein Mini-Player im Bild')
        await warte(900)
      },
    },
  ]

  for (const s of SCHIRME) {
    console.log(`\n── ${s.name} ${'─'.repeat(Math.max(0, 40 - s.name.length))}`)
    console.log(`   ${s.was}`)
    let d
    try {
      await s.hin()
      d = await ev(MESSEN_JS)
    } catch (e) {
      melde(`${s.name}: ${e.message}`)
      continue
    }
    if (!d || !d.da) {
      console.log(`   kein Rueckweg als Ziel (${(d && d.grund) || 'unbekannt'}) — nichts zu messen`)
      continue
    }
    console.log(
      `   #zurueck ${d.zurueck.w}x${d.zurueck.h} bei ${d.zurueck.x},${d.zurueck.y}` +
        `  (${mmS(Math.min(d.zurueck.w, d.zurueck.h))} mm)   ${d.ziele} weitere Ziele im Bild`,
    )
    const nah = d.nachbarn.filter((n) => mm(n.abstand) < ZEIGEN_MM && n.obenauf)
    if (!nah.length) {
      // DER NAECHSTE, DER WIRKLICH EINER IST. `d.nachbarn[0]` waere unter
      // Umstaenden ein Ziel unter einer deckenden Ebene — das ist keiner.
      const erster = d.nachbarn.find((n) => n.obenauf)
      console.log(
        erster
          ? `   naechster erreichbarer Nachbar ${mmS(erster.abstand)} mm (${erster.wer}) — ueber ${ZEIGEN_MM} mm`
          : `   kein erreichbares Ziel in der Naehe`,
      )
      continue
    }
    for (const n of nah) {
      const ueber = n.abstand < 0
      const marke = ueber ? '✗✗' : mm(n.abstand) < ABSTAND_MM ? ' ✗' : '  '
      const zahl = ueber
        ? `UEBERDECKT um ${Math.abs(n.abstand)} px`
        : `${mmS(n.abstand).padStart(5)} mm (${n.abstand} px)`
      console.log(`   ${marke} ${zahl.padEnd(26)} ${n.rect.w}x${n.rect.h} bei ${n.rect.x},${n.rect.y}  ${n.wer}`)
      console.log(`        ${' '.repeat(26)} „${n.wort}"`)
      if (ueber) melde(`${s.name}: #zurueck UEBERDECKT ${n.wer} „${n.wort}" um ${Math.abs(n.abstand)} px`)
      else if (mm(n.abstand) < ABSTAND_MM)
        melde(`${s.name}: nur ${mmS(n.abstand)} mm zwischen #zurueck und ${n.wer} „${n.wort}" (${ABSTAND_MM} mm gefordert)`)
    }
  }

  console.log('')
  console.log(fehler ? `  ${fehler} FEHLER` : `  der Rueckweg haelt ueberall ${ABSTAND_MM} mm Abstand und ueberdeckt nichts`)
} finally {
  await brw.schliessen()
  await leihe.zurueckgeben()
}

process.exit(PRUEFEN && fehler ? 1 : 0)
