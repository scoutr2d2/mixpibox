#!/usr/bin/env node
/**
 * DER ELTERN-BEREICH ALS SEITE STATT ALS DECKEL — wer liegt wo, wer verdeckt wen.
 *
 * ══ WOZU, UND WARUM NICHT DIE VIER VORHANDENEN ═════════════════════════════
 * Solange `#eltern` ein DECKEL war (`position: fixed; inset: 0`), gab es die
 * Frage nicht: unter dem Deckel liegt nichts, was jemand treffen koennte.
 * Sobald er eine SEITE wird — Leiste links bleibt stehen, Kissen unten bleibt
 * stehen —, stehen drei Dinge nebeneinander, die einander in die Quere kommen
 * koennen, und keines der vorhandenen Werkzeuge sagt WIE VIEL:
 *
 *   * `beruehrziele-neu.mjs` misst die GROESSE jedes Ziels und je Schirm den
 *     EINEN engsten Abstand. Ein Knopf, der zu einem Drittel unter dem Kissen
 *     liegt, meldet dort unveraendert seine volle Groesse.
 *   * `eltern-masse-messen.mjs` misst JEDES Paar und ob die Faecherspalte
 *     rollt — aber nicht, wie viele Bildpunkte das Kissen von der Spalte oder
 *     vom Fach daneben wegnimmt.
 *   * `eltern-form-schau.mjs` misst Ueberlappungen, kennt aber kein `--probe`:
 *     es misst den Baum, wie er ist, nicht einen Vorschlag.
 *   * `verdeckung-messen.mjs` misst Ueberdeckungen im ganzen Haus und ebenfalls
 *     ohne `--probe`.
 *
 * DIE FRAGE, FUER DIE ES GEBAUT WURDE (06.08.2026): Der Betreiber will die Form
 * des Entwurfs — „ich finde den entwurf gut wo nicht alles zu gedeckt ist".
 * Damit sind drei Wege im Rennen (Kissen faehrt ein / Fach endet ueber dem
 * Kissen / Faecher stehen anders), und jeder muss VOR der ersten Dateiaenderung
 * mit Zahlen dastehen.
 *
 * ══ WAS ES MISST ═══════════════════════════════════════════════════════════
 *   LAGE     die Rechtecke von #eltern, Leiste, Kissen, Faecherspalte, Fach,
 *            Zeilenliste und jedem .fach-knopf — als Zahlen, nicht als Absicht
 *   DECKUNG  jede Ueberschneidung zwischen dem Kissen und den Teilen des
 *            Eltern-Bereichs, in Bildpunkten UND als Anteil des Kleineren
 *   GRIFF    wie viele Faecher in die Spalte passen — GERECHNET aus dem
 *            LEBENDEN `--griff` und dem LEBENDEN `gap`, nicht aus einer
 *            abgeschriebenen 64. Genau diese Rechnung stand im Kommentar bei
 *            `.eltern-faecher` zweimal falsch da.
 *   TREFFER  fuer jedes benannte Ziel: trifft ein Finger auf der Mitte WIRKLICH
 *            dieses Ziel — und wenn nicht, WER wird stattdessen getroffen.
 *            Ein Knopf, der dasteht und nicht reagiert, ist eine Attrappe.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei des Baums. Eigener Browser (headless), `--probe` legt
 * die Regel NUR im Browser dieses Laufs bei. Mit dem Lauf ist sie vorbei.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/eltern-seite-messen.mjs --debug-port 9701 http://127.0.0.1:8701/neu/
 *   ... --probe '.eltern{left:88px;bottom:84px}'   ein Vorschlag (mehrfach erlaubt)
 *   ... --faecher 5                                ein fuenftes Fach einsetzen
 *   ... --was W1                                   Ueberschrift des Laufs
 *   ... --bild /tmp/W1.png                         Bildschirmfoto danach
 *   ... --json                                     maschinenlesbar
 */
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { eigenerBrowser } from './leihgabe.mjs'
import { adminAuf } from './admin-weg.mjs'

const argv = process.argv.slice(2)
const hat = (n) => argv.includes(`--${n}`)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const alle = (n) => argv.reduce((a, x, i) => (x === `--${n}` && argv[i + 1] && !argv[i + 1].startsWith('--') ? [...a, argv[i + 1]] : a), [])

const ZIEL = argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:0/neu/'
const PROBEN = alle('probe')
const FAECHER = Number(opt('faecher', 0)) || 0
/* DIE ZEILEN IM FACH DANEBEN. Der Vorschaustand zeigt EINE Bluetooth-Zeile;
   an der Box stehen dort so viele, wie der Suchlauf findet. Ein Weg, der mit
   einer Zeile aufgeht und mit fuenf etwas unter dem Kissen begraebt, ist keine
   Loesung — deshalb laesst sich die Liste hier fuellen. */
const ZEILEN = Number(opt('zeilen', 0)) || 0
const WAS = typeof opt('was', null) === 'string' ? opt('was') : 'Lauf'
/* DAS TOR STATT DER FLAECHE. Es ist der Schirm, auf dem die Frage „darf ein
   Kind waehrend der Sperre die Leiste bedienen" ueberhaupt entsteht. */
const TOR = typeof opt('tor', null) === 'string' ? opt('tor') : hat('tor') ? 'pin' : null
/* EINEN KNOPF WIRKLICH ANTIPPEN und DANACH messen. „Steht er im Baum" ist
   nicht dieselbe Frage wie „was passiert, wenn ein Kind ihn trifft". */
const TIPPEN = typeof opt('tippen', null) === 'string' ? opt('tippen') : null
const BILD = typeof opt('bild', null) === 'string' ? opt('bild') : null
const JSONAUS = hat('json')

const MM = 0.14
const mm = (px) => (px * MM).toFixed(2)

// Browser GELIEHEN ueber eigenerBrowser() (tools/leihgabe.mjs): freier Port,
// eigenes Profil, Eigentumsnachweis — die Fremdfenster-Falle vom 06.08.2026
// ist dort einmal geloest statt in jedem Geschwister-Werkzeug wiederholt.
const brw = await eigenerBrowser()
if (!brw) {
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

const MESSEN_JS = String.raw`
(() => {
  const rund = (r) => ({ l: Math.round(r.left), o: Math.round(r.top), r: Math.round(r.right), u: Math.round(r.bottom), b: Math.round(r.width), h: Math.round(r.height) })
  const kasten = (sel) => { const e = document.querySelector(sel); if (!e) return null
    const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return null
    const k = rund(e.getBoundingClientRect()); k.sel = sel; return k }
  const benennen = (e) => {
    if (!e) return null
    const t = [e.tagName.toLowerCase()]
    if (e.id) t.push('#' + e.id)
    const kl = (e.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    if (kl.length) t.push('.' + kl.join('.'))
    const s = e.getAttribute('aria-label') || (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)
    return t.join('') + (s ? '  „' + s + '"' : '')
  }
  /* TREFFEN heisst: elementFromPoint auf der Mitte liefert das Ziel selbst
     oder etwas darin. Nicht „steht es im Baum". */
  const treffer = (e) => {
    const r = e.getBoundingClientRect()
    const x = Math.round(Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2)))
    const y = Math.round(Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2)))
    const g = document.elementFromPoint(x, y)
    return { ok: !!g && (g === e || e.contains(g)), statt: g && !(g === e || e.contains(g)) ? benennen(g) : null, x, y }
  }
  const schnitt = (a, b) => {
    if (!a || !b) return null
    const bx = Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l))
    const by = Math.max(0, Math.min(a.u, b.u) - Math.max(a.o, b.o))
    if (bx <= 0 || by <= 0) return { px: 0, b: 0, h: 0 }
    return { px: bx * by, b: bx, h: by, anteil: Math.round((100 * bx * by) / Math.max(1, Math.min(a.b * a.h, b.b * b.h))) }
  }

  const teile = {}
  for (const [n, s] of [
    ['eltern', '#eltern'], ['leiste', '.leiste'], ['kissen', '#mp'],
    ['faecher', '#eltern-faecher'], ['fach', '.eltern-fach'], ['zeilen', '#fach-zeilen'],
    ['kopf', '.eltern-kopf'], ['zurueck', '#zurueck'], ['ich', '#ich'],
  ]) teile[n] = kasten(s)

  const knoepfe = [...document.querySelectorAll('.fach-knopf')].map((e) => ({ ...rund(e.getBoundingClientRect()), name: benennen(e), t: treffer(e) }))
  const kats = [...document.querySelectorAll('.kat')].map((e) => ({ ...rund(e.getBoundingClientRect()), name: benennen(e), t: treffer(e) }))
  const kissenKnoepfe = [...document.querySelectorAll('#mp button')].map((e) => ({ ...rund(e.getBoundingClientRect()), name: benennen(e), t: treffer(e) }))
  /* DIE KNOEPFE IN DEN ZEILEN — „Koppeln", „Verbinden", „Trennen". Sie sind
     die Ziele, die als erste unter ein Kissen geraten, das ueber dem Fach
     schwebt: sie stehen ganz rechts und wandern mit jeder weiteren Zeile
     tiefer. */
  const zeilenKnoepfe = [...document.querySelectorAll('#fach-zeilen button')].map((e, i) => ({ ...rund(e.getBoundingClientRect()), name: 'Zeile ' + (i + 1) + ': ' + benennen(e), t: treffer(e) }))
  const sonst = [['zurueck', '#zurueck'], ['ich', '#ich']].map(([n, s]) => {
    const e = document.querySelector(s); if (!e) return null
    return { was: n, ...rund(e.getBoundingClientRect()), name: benennen(e), t: treffer(e) }
  }).filter(Boolean)

  /* DIE RECHNUNG AUS DEM LEBENDEN STILBLATT, nicht aus einer abgeschriebenen
     Zahl. --griff und gap werden hier ABGEFRAGT — genau die beiden Werte
     hat der Kommentar bei .eltern-faecher zweimal falsch angenommen. */
  const sp = document.getElementById('eltern-faecher')
  const griff = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--griff')) || 0
  const spSt = sp ? getComputedStyle(sp) : null
  const gap = spSt ? parseFloat(spSt.rowGap) || 0 : 0
  /* WIE VIELE REIHEN STEHEN WIRKLICH DA. Die Tabelle darunter rechnet mit
     EINER Spalte — das ist die heutige Form. Wer die Faecher in zwei Spalten
     oder eine Reihe stellt, bekaeme von ihr eine falsche Auskunft; deshalb
     steht daneben, was GEMESSEN dasteht: die Zahl verschiedener Oberkanten
     und die belegte Hoehe von der ersten Oberkante bis zur letzten Unterkante. */
  const oberkanten = [...new Set(knoepfe.map((k) => k.o))].sort((a, b) => a - b)
  const belegt = knoepfe.length ? Math.max(...knoepfe.map((k) => k.u)) - Math.min(...knoepfe.map((k) => k.o)) : 0
  const letzteGanzImBild = sp && knoepfe.length ? Math.max(...knoepfe.map((k) => k.u)) <= sp.getBoundingClientRect().bottom + 0.5 : null
  const spalte = sp ? {
    anzahl: knoepfe.length,
    reihen: oberkanten.length,
    belegt: Math.round(belegt),
    letzteGanzImBild,
    griff, gap,
    knopfHoehe: knoepfe.length ? knoepfe[0].h : 0,
    sichtHoehe: Math.round(sp.clientHeight),
    inhaltHoehe: Math.round(sp.scrollHeight),
    rollt: sp.scrollHeight > sp.clientHeight + 1,
    fehltPx: Math.max(0, sp.scrollHeight - sp.clientHeight),
    /* passt n mal griff + (n-1) mal gap in die Sichthoehe? */
    passen: (() => { const h = sp.clientHeight; const out = {}
      for (let n = 3; n <= 7; n++) out[n] = { braucht: Math.round(n * griff + (n - 1) * gap), hat: Math.round(h), passt: n * griff + (n - 1) * gap <= h + 0.5 }
      return out })(),
    /* WIE VIELE PASSEN, wenn das Kissen mitgerechnet wird — ein Fach, das
       unter dem Kissen liegt, ist NICHT da, auch wenn die Spalte nicht rollt. */
  } : null

  const kis = teile.kissen
  const deckung = {
    faecher: schnitt(kis, teile.faecher),
    fach: schnitt(kis, teile.fach),
    zeilen: schnitt(kis, teile.zeilen),
    eltern: schnitt(kis, teile.eltern),
    knoepfe: knoepfe.map((k) => ({ name: k.name, s: schnitt(kis, k) })).filter((x) => x.s && x.s.px > 0),
  }
  const zeilenL = document.getElementById('fach-zeilen')
  const zeilen = zeilenL ? { anzahl: zeilenL.querySelectorAll('.fach-zeile').length, sichtHoehe: Math.round(zeilenL.clientHeight), inhaltHoehe: Math.round(zeilenL.scrollHeight), rollt: zeilenL.scrollHeight > zeilenL.clientHeight + 1 } : null

  return JSON.stringify({ teile, knoepfe, kats, kissenKnoepfe, zeilenKnoepfe, sonst, spalte, deckung, zeilen })
})()
`

let ws = null
try {
  ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const stand = async (w) => {
    await fetch(new URL(`/vorschau/${w}`, ZIEL)).catch(() => null)
    await warte(150)
  }

  await stand('voll')
  await stand(TOR ? `sperre-${TOR}` : 'sperre-aus')
  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2200)

  // HIER STAND EIN GRIFF ANS ZAHNRAD `#einst-knopf`. Es ist am 06.08.2026
  // ersatzlos entfallen; hinein fuehrt der Schriftzug `#wappen`. Dieser Weg
  // ist der TASTATURWEG und prueft das Halten NICHT — tools/admin-weg.mjs.
  await adminAuf(ev, { warteMs: 900 })

  const wer = TOR ? 'eltern-tor' : 'eltern-flaeche'
  const auf = await ev(`!document.getElementById('${wer}').hidden`)
  if (!auf) throw new Error(`${wer} ging nicht auf`)

  if (FAECHER) {
    await ev(`(() => { const sp = document.getElementById('eltern-faecher')
      const v = sp.querySelector('.fach-knopf'); if (!v) return false
      while (sp.querySelectorAll('.fach-knopf').length < ${FAECHER}) {
        const k = v.cloneNode(true); k.classList.remove('hier'); sp.appendChild(k) }
      return true })()`)
    await warte(150)
  }
  if (ZEILEN) {
    await ev(`(() => { const zl = document.getElementById('fach-zeilen')
      const v = zl.querySelector('.fach-zeile'); if (!v) return false
      while (zl.querySelectorAll('.fach-zeile').length < ${ZEILEN}) zl.appendChild(v.cloneNode(true))
      return true })()`)
    await warte(150)
  }
  if (PROBEN.length) {
    await ev(`(() => { const s = document.createElement('style')
      s.id = 'probe-seite'; s.textContent = ${JSON.stringify(PROBEN.join('\n'))}
      document.head.appendChild(s); return true })()`)
    await warte(400)
  }

  if (TIPPEN) {
    const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(TIPPEN)})
      if (!e) return 'nicht da'
      const b = e.getBoundingClientRect()
      const x = Math.round(b.left + b.width / 2), y = Math.round(b.top + b.height / 2)
      const g = document.elementFromPoint(x, y)
      const getroffen = !!g && (g === e || e.contains(g))
      if (getroffen) e.click()
      return getroffen ? 'getippt' : 'verdeckt: ' + (g ? g.tagName.toLowerCase() + (g.id ? '#' + g.id : '') : 'nichts') })()`)
    console.log(`   TIPP auf ${TIPPEN}: ${r}`)
    await warte(700)
    const sichtbar = await ev(`[...document.querySelectorAll('[id]')].filter((e) => !e.hidden && ['ich-fenster','eltern','eltern-tor','eltern-flaeche','gross','album-gross','mp-laut-fenster'].includes(e.id)).map((e) => e.id).join(', ')`)
    console.log(`   danach offen: ${sichtbar}`)
    const obenAufMitte = await ev(`(() => { const g = document.elementFromPoint(400, 240); return g ? g.tagName.toLowerCase() + (g.id ? '#' + g.id : '') + '.' + (g.className || '').toString().split(' ')[0] : 'nichts' })()`)
    console.log(`   auf der Schirmmitte liegt: ${obenAufMitte}`)
  }

  const roh = await ev(MESSEN_JS)
  const d = JSON.parse(roh)

  if (BILD) {
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(BILD, Buffer.from(s.data, 'base64'))
  }

  if (JSONAUS) {
    console.log(JSON.stringify({ was: WAS, proben: PROBEN, faecher: FAECHER || 4, ...d }, null, 2))
  } else {
    const R = (k) => (k ? `${k.l},${k.o}  ${k.b}x${k.h}  (rechts ${k.r}, unten ${k.u})` : '—')
    console.log(`\n══ ${WAS} ══  ${FAECHER || 4} Faecher`)
    if (PROBEN.length) for (const p of PROBEN) console.log(`   PROBE: ${p}`)
    console.log('\n── LAGE ────────────────────────────────────────────────')
    for (const [n, k] of Object.entries(d.teile)) console.log(`   ${n.padEnd(9)} ${R(k)}`)
    const sp = d.spalte
    if (sp) {
      console.log('\n── DIE SPALTE, GERECHNET AUS DEM LEBENDEN STILBLATT ────')
      console.log(`   --griff ${sp.griff} px, gap ${sp.gap} px, Knopfhoehe gemessen ${sp.knopfHoehe} px`)
      console.log(`   Sichthoehe ${sp.sichtHoehe} px, Inhalt ${sp.inhaltHoehe} px  →  ${sp.rollt ? `ROLLT (${sp.fehltPx} px fehlen)` : 'rollt nicht'}`)
      console.log(`   GEMESSEN: ${sp.anzahl} Faecher in ${sp.reihen} Reihen, belegt ${sp.belegt} px; letztes Fach ganz im Bild: ${sp.letzteGanzImBild ? 'ja' : 'NEIN'}`)
      console.log(`   Die Tabelle rechnet mit EINER Spalte — bei zwei Spalten oder einer Reihe gilt die Zeile „GEMESSEN" darueber:`)
      for (const [n, p] of Object.entries(sp.passen)) console.log(`   ${n} Faecher brauchen ${String(p.braucht).padStart(3)} px in ${p.hat} px  ${p.passt ? '✓' : '✗ es fehlen ' + (p.braucht - p.hat) + ' px'}`)
    }
    console.log('\n── DECKUNG DURCH DAS KISSEN ────────────────────────────')
    for (const [n, s] of Object.entries(d.deckung)) {
      if (n === 'knoepfe') continue
      console.log(`   ${n.padEnd(9)} ${s && s.px ? `${s.b}x${s.h} = ${s.px} px (${s.anteil}% des Kleineren)` : 'keine'}`)
    }
    if (d.deckung.knoepfe.length) for (const k of d.deckung.knoepfe) console.log(`   FACH   ${k.name}  ${k.s.b}x${k.s.h} px`)
    else console.log('   FACH   kein .fach-knopf wird vom Kissen beruehrt')
    console.log('\n── TRIFFT EIN FINGER, WAS ER SIEHT ─────────────────────')
    const zeile = (x) => `   ${x.t.ok ? 'ok  ' : 'NEIN'}  ${String(x.b + 'x' + x.h).padEnd(8)} ${mm(Math.min(x.b, x.h)).padStart(5)} mm  ${x.name}${x.t.ok ? '' : `\n            statt dessen: ${x.t.statt}`}`
    for (const x of [...d.kats, ...d.sonst, ...d.knoepfe, ...d.kissenKnoepfe, ...d.zeilenKnoepfe]) console.log(zeile(x))
    if (d.zeilen) console.log(`\n   Zeilenliste: ${d.zeilen.anzahl} Zeilen, Sicht ${d.zeilen.sichtHoehe} px, Inhalt ${d.zeilen.inhaltHoehe} px → ${d.zeilen.rollt ? 'ROLLT' : 'rollt nicht'}`)
    if (BILD) console.log(`\n   Bild: ${BILD}`)
  }
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await brw.schliessen()
}
