#!/usr/bin/env node
/**
 * WAS EIN DECKEL FREIGIBT, WENN ER ZUR SEITE WIRD.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * `#eltern` ist heute `position: fixed; inset: 0; z-index: 8` — ein DECKEL
 * ueber der ganzen Seite. Der Entwurf (NewDesign/MixPiBox-standalone.html)
 * kennt den Eltern-Bereich dagegen als SEITE in der Inhaltsspalte: die
 * 88-px-Leiste steht daneben, das Mini-Player-Kissen darunter.
 *
 * Der Betreiber hat die Form des Entwurfs gewaehlt („ich finde den entwurf gut
 * wo nicht alles zu gedeckt ist"). Die Massfrage (passen vier Faecher in die
 * kuerzere Flaeche?) beantwortet tools/eltern-masse-messen.mjs. DIESES Werkzeug
 * beantwortet die ANDERE Haelfte, und sie ist die gefaehrlichere:
 *
 *   WAS LIEGT HEUTE UNTER DEM DECKEL UND WIRD DURCH DIE AENDERUNG BEDIENBAR?
 *
 * Jede Flaeche, die frei wird, ist ein Ziel, das vorher niemand erreichen
 * konnte — und damit ein Weg, den vorher niemand pruefen musste. Waehrend das
 * TOR steht (Rechenaufgabe/PIN/Geste) sind das ausgerechnet die Wege, die an
 * der Sperre vorbeifuehren: Kategorie wechseln, Profil wechseln, anhalten.
 *
 * ══ WARUM elementFromPoint UND NICHT DER QUELLTEXT ═════════════════════════
 * Aus dem Quelltext laesst sich ablesen, WELCHE z-index-Stufe wer hat. Was ein
 * Finger trifft, folgt daraus NICHT: `position: fixed` bildet einen eigenen
 * Stapelzusammenhang, `pointer-events`, `hidden`, `transform: translateX(-100%)`
 * (die eingefahrene Leiste!) und `overflow` reden alle mit. Gemessen wird
 * deshalb an Punkten, wie in tools/beruehrziele-neu.mjs und aus demselben
 * Grund ([[attrappe-luegt-durch-weglassen]]).
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * NICHTS an einer Datei des Baums. Die Varianten werden als Stilregel NUR im
 * Browser dieses Laufs eingesetzt und danach wieder abgeraeumt.
 *
 * ══ DIE DREI VARIANTEN ═════════════════════════════════════════════════════
 *   A  heute            .eltern { inset: 0 }                  800x480
 *   B  Leiste bleibt    .eltern { left: 88px }                712x480
 *   C  Form des Entwurfs .eltern { left:88px; bottom:84px }   712x396
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/eltern-deckel-freigabe.mjs --debug-port 9702 http://127.0.0.1:8702/neu/
 *   ... --schirm eltern-tor        nur das Tor (die heikle Lage)
 *   ... --variante C               nur eine Variante
 *   ... --eingefahren              zusaetzlich mit eingefahrener Leiste messen
 *   ... --bild /tmp/deckel         je Lage ein PNG
 *   ... --pruefen                  Urteil statt Bericht (Ende 1 bei Befund)
 */
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { eigenerBrowser, freierPort } from './leihgabe.mjs'
import { adminAuf, WAPPEN_HALTEN_MS } from './admin-weg.mjs'

const argv = process.argv.slice(2)
const hat = (n) => argv.includes(`--${n}`)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
let ZIEL = argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:0/neu/'
const NUR_SCHIRM = typeof opt('schirm', null) === 'string' ? opt('schirm') : null
const NUR_VAR = typeof opt('variante', null) === 'string' ? String(opt('variante')).toUpperCase() : null
const BILD = typeof opt('bild', null) === 'string' ? opt('bild') : null
const MIT_EINGEFAHREN = hat('eingefahren')

const MM_JE_PIXEL = 0.14
const mmS = (px) => (px * MM_JE_PIXEL).toFixed(2)

// ── Browser: GELIEHEN ueber eigenerBrowser() (tools/leihgabe.mjs) ──────────
// Freier Port, eigenes Profil, Eigentumsnachweis — kein selbst gestarteter
// Chromium mehr, der auf einem belegten Port still ein FREMDES Fenster
// fernsteuern koennte (Nacht zum 06.08.2026).

/* EINE LAUFENDE VORSCHAU WIRD NICHT ANGEFASST ([[vorschau-wird-geliehen]]). */
let vorschau = null
try {
  await fetch(new URL('/api/werke', ZIEL), { signal: AbortSignal.timeout(1500) })
} catch {
  const angegeben = new URL(ZIEL).port
  const zielport = angegeben && angegeben !== '0' ? angegeben : String(await freierPort())
  ZIEL = `http://127.0.0.1:${zielport}/neu/`
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', zielport], { stdio: 'ignore' })
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 300))
    try {
      await fetch(new URL('/api/werke', ZIEL), { signal: AbortSignal.timeout(1000) })
      break
    } catch {
      /* noch nicht da */
    }
  }
}

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

// ── Die Messung, im Browser ────────────────────────────────────────────────
/*
 * DREI FRAGEN AN DENSELBEN SCHIRM:
 *
 *  1. WER WIRD AN EINEM PUNKT GETROFFEN? Fuer eine Liste benannter Stellen
 *     (Kategorien, Zeichen „wer hoert", Rueckweg, Kissen, Kopfzeile) und
 *     zusaetzlich fuer ein Raster von 16x10 ueber den ganzen Schirm — die
 *     Rasterzahl sagt, WIE VIEL Flaeche der Deckel abgibt, ohne dass jemand
 *     vorher die richtige Stelle erraten muss.
 *
 *  2. WELCHE BEDIENELEMENTE SIND TREFFBAR? Dieselbe Auswahl wie in
 *     beruehrziele-neu.mjs, aber nicht auf Groesse geprueft, sondern nur auf
 *     „wird in der eigenen Mitte getroffen". Der Unterschied zwischen zwei
 *     Varianten IST die Antwort auf die Frage dieses Werkzeugs.
 *
 *  3. WO LIEGT WAS? Die Rechtecke von `#eltern`, `#zurueck`, `#ich`,
 *     `.leiste` und `.mp` — fuer die Frage, ob der Rueckweg nach dem Umbau
 *     ueber dem Bereich steht oder daneben, und ob er dem Zeichen „wer hoert"
 *     auf dem Kopf sitzt.
 */
const MESSEN_JS = String.raw`
(() => {
  const WAHL = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [tabindex]:not([tabindex="-1"])'
  const benennen = (e) => {
    if (!e) return null
    const teile = [e.tagName.toLowerCase()]
    if (e.id) teile.push('#' + e.id)
    const kl = (e.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    if (kl.length) teile.push('.' + kl.join('.'))
    return teile.join('')
  }
  /* WESSEN EBENE IST DAS? Nach oben durch die Vorfahren bis zu einer der
     bekannten Flaechen — „div.kat-liste" allein sagt nichts darueber, ob die
     Leiste bedienbar ist. */
  const EBENEN = ['eltern', 'zurueck', 'ich', 'ich-fenster', 'leiste', 'mp', 'kopf', 'buehne', 'gross', 'album-gross', 'meldung']
  const ebeneVon = (e) => {
    for (let x = e; x && x !== document.documentElement; x = x.parentElement) {
      if (x.id && EBENEN.includes(x.id)) return x.id
      const kl = x.getAttribute && x.getAttribute('class')
      if (kl) for (const k of kl.split(/\s+/)) if (EBENEN.includes(k)) return k
    }
    return '(seite)'
  }
  const treffer = (x, y) => {
    const t = document.elementFromPoint(x, y)
    return t ? { was: benennen(t), ebene: ebeneVon(t) } : { was: null, ebene: null }
  }
  const kasten = (sel) => {
    const e = typeof sel === 'string' ? (document.getElementById(sel) || document.querySelector(sel)) : sel
    if (!e) return null
    const r = e.getBoundingClientRect()
    if (r.width < 1 && r.height < 1) return null
    return { l: Math.round(r.left), o: Math.round(r.top), r: Math.round(r.right), u: Math.round(r.bottom), b: Math.round(r.width), h: Math.round(r.height) }
  }

  /* ── 1a. BENANNTE STELLEN ────────────────────────────────────────────── */
  const stellen = []
  const stelle = (name, x, y) => stellen.push({ name, x, y, ...treffer(x, y) })
  const mitte = (sel, name) => {
    const k = kasten(sel)
    if (!k) return stellen.push({ name: name || String(sel), x: null, y: null, was: '(nicht im Baum)', ebene: null })
    stelle(name || String(sel), Math.round((k.l + k.r) / 2), Math.round((k.o + k.u) / 2))
  }
  mitte('ich', 'Zeichen „wer hoert" (#ich, z 5)')
  mitte('zurueck', 'der eine Rueckweg (#zurueck, z 9)')
  mitte('leiste', 'Leiste, Mitte (z 3)')
  mitte('wappen-fassung', 'Wappen in der Leiste')
  const kats = [...document.querySelectorAll('.kat')]
  kats.forEach((k, i) => {
    const r = k.getBoundingClientRect()
    stelle('Kategorie ' + (i + 1) + ' „' + (k.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 12) + '"',
      Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
  })
  mitte('mp', 'Kissen (Mini-Player, z 5)')
  mitte('mp-spiel', 'Kissen: anhalten/weiter')
  mitte('mp-vor', 'Kissen: weiterschalten')
  mitte('mp-laut', 'Kissen: lauter')
  /* HIER STAND eine Stichprobe auf der Mitte von #einst-knopf, dem Zahnrad in
     der Kopfzeile. Es ist am 06.08.2026 ersatzlos entfallen; der Weg ins
     Admin-Menue ist der Schriftzug unten links (#wappen, oben schon in der
     Liste unter wappen-fassung).
     (KEINE GEGENHAKEN IN DIESEM BLOCK — er steht in einem String, der an den
      Browser geht; ein Gegenhaken beendet ihn, und der Rest wird zu Code.) */
  mitte('bt-knopf', 'Bluetooth-Zeichen')
  /* HIER STAND eine Stichprobe auf der Mitte von #licht-knopf, dem Mond in der
     Kopfzeile. Er ist am 07.08.2026 entfallen (Betreiber: hell/dunkel raus aus
     dem Band oben); hell/dunkel steht jetzt im Admin-Menue unter Darstellung.
     WEG UND NICHT STEHENGELASSEN: mitte() traegt fehlende Elemente still als
     „(nicht im Baum)" ein. Das ist fuer die Deckung genau richtig — aber eine
     Zeile, die dauerhaft nichts misst, sieht in der Liste aus wie eine
     Messung, und beim naechsten Lesen zaehlt sie jemand mit.
     (KEINE GEGENHAKEN IN DIESEM BLOCK — er steht in einem String, der an den
      Browser geht; ein Gegenhaken beendet ihn, und der Rest wird zu Code.) */

  /* ── 1b. DAS RASTER ─────────────────────────────────────────────────── */
  /* 16 x 10 Punkte = 160 Stichproben. Es geht nicht um die einzelne Stelle,
     sondern um den ANTEIL: wie viel Schirm gehoert dem Deckel? */
  const raster = {}
  for (let ix = 0; ix < 16; ix++)
    for (let iy = 0; iy < 10; iy++) {
      const x = Math.round((ix + 0.5) * (innerWidth / 16))
      const y = Math.round((iy + 0.5) * (innerHeight / 10))
      const e = ebeneVon(document.elementFromPoint(x, y) || document.body)
      raster[e] = (raster[e] || 0) + 1
    }

  /* ── 2. TREFFBARE BEDIENELEMENTE ────────────────────────────────────── */
  const sichtbar = (e) => {
    const s = getComputedStyle(e)
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false
    if (e.disabled === true || e.getAttribute('aria-disabled') === 'true') return false
    if (s.pointerEvents === 'none') return false
    const r = e.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false
    return true
  }
  const trifftSich = (e) => {
    const r = e.getBoundingClientRect()
    const l = Math.max(0, r.left), o = Math.max(0, r.top)
    const re = Math.min(innerWidth - 1, r.right), u = Math.min(innerHeight - 1, r.bottom)
    if (re <= l || u <= o) return false
    for (let i = 1; i <= 3; i++)
      for (let j = 1; j <= 3; j++) {
        const x = Math.round(l + ((re - l) * i) / 4), y = Math.round(o + ((u - o) * j) / 4)
        const g = document.elementFromPoint(x, y)
        if (g && (g === e || e.contains(g))) return true
      }
    return false
  }
  const treffbar = []
  for (const e of [...document.querySelectorAll(WAHL)].filter(sichtbar))
    if (trifftSich(e)) treffbar.push(benennen(e) + (e.getAttribute('aria-label') ? '  „' + e.getAttribute('aria-label') + '"' : ''))

  /* ── 3. RECHTECKE ───────────────────────────────────────────────────── */
  const lagen = {}
  for (const s of ['eltern', 'zurueck', 'ich', 'leiste', 'mp', 'kopf', 'eltern-faecher', 'eltern-flaeche', 'eltern-tor', 'ich-fenster'])
    lagen[s] = kasten(s)
  lagen['.eltern-kopf'] = kasten('.eltern-kopf')
  lagen['.eltern-titel'] = kasten('.eltern-titel')
  lagen['.eltern-unter'] = kasten('.eltern-unter')
  lagen['.eltern-karte'] = kasten('.eltern-karte')

  /* ── 4. UEBERDECKEN SICH RUECKWEG UND ZEICHEN? ──────────────────────── */
  const ueber = (a, b) => {
    if (!a || !b) return null
    const x = Math.min(a.r, b.r) - Math.max(a.l, b.l)
    const y = Math.min(a.u, b.u) - Math.max(a.o, b.o)
    return { x: Math.round(x), y: Math.round(y), ueberlappt: x > 0 && y > 0, luftX: x < 0 ? -x : 0 }
  }
  const paare = {
    'zurueck/ich': ueber(lagen.zurueck, lagen.ich),
    'zurueck/eltern': ueber(lagen.zurueck, lagen.eltern),
    'ich/eltern': ueber(lagen.ich, lagen.eltern),
    'eltern/leiste': ueber(lagen.eltern, lagen.leiste),
    'eltern/mp': ueber(lagen.eltern, lagen.mp),
    /* DIE UEBERSCHRIFT GEGEN DEN RUECKWEG — die Zahl aus
       [[rueckweg-verdeckt-die-ueberschrift]]. Der Einzug von .eltern-kopf
       rechnet mit --zurueck-links und setzt dabei stillschweigend voraus,
       dass .eltern bei x 0 beginnt. Faengt der Bereich bei 88 an, wandert
       die Ueberschrift um 88 px mit — die 12 px Luft werden zu 100. */
    'zurueck/titel': ueber(lagen.zurueck, lagen['.eltern-titel']),
    'zurueck/unter': ueber(lagen.zurueck, lagen['.eltern-unter']),
  }

  /* ── 5. DIE SPALTE ROLLT? (die Massfrage, hier nur als Begleitzahl) ─── */
  const sp = document.getElementById('eltern-faecher')
  const spalte = sp ? {
    faecher: document.querySelectorAll('.fach-knopf').length,
    sicht: Math.round(sp.clientHeight), inhalt: Math.round(sp.scrollHeight),
    rollt: sp.scrollHeight > sp.clientHeight + 1,
    fehlt: Math.max(0, sp.scrollHeight - sp.clientHeight),
  } : null

  return { stellen, raster, treffbar, lagen, paare, spalte,
           platzMachen: document.body.classList.contains('platz-machen') }
})()
`

/* DIE WISCHGESTE, GEMESSEN STATT GELESEN.
 *
 * Sie haengt mit `capture: true` am `document` und nicht an einer Flaeche —
 * ein Deckel darueber kann sie deshalb GAR NICHT abfangen. Das ist eine
 * Behauptung ueber Ereignisse, und Behauptungen ueber Ereignisse gehoeren
 * ausgeloest, nicht gelesen. Gezogen wird von x=6 nach x=90 auf derselben
 * Hoehe — 84 px, also ueber der 64-px-Marke, und schnurgerade. */
const WISCH_JS = String.raw`
(() => {
  const vorher = document.body.classList.contains('platz-machen')
  const y = 300
  const p = (art, x) => document.dispatchEvent(new PointerEvent(art, {
    bubbles: true, cancelable: true, pointerId: 7, clientX: x, clientY: y, isPrimary: true,
  }))
  p('pointerdown', 6)
  p('pointermove', 40)
  p('pointermove', 90)
  p('pointerup', 90)
  return { vorher, nachher: document.body.classList.contains('platz-machen') }
})()
`

// ── Die Schirme ────────────────────────────────────────────────────────────
const SCHIRME = [
  {
    name: 'eltern-tor',
    was: 'das TOR steht (PIN) — die heikle Lage',
    sperre: 'sperre-pin',
    pruefen: `!document.getElementById('eltern-tor').hidden`,
  },
  {
    name: 'eltern-flaeche',
    was: 'der Bereich ist offen (Sperre aus)',
    sperre: 'sperre-aus',
    pruefen: `!document.getElementById('eltern-flaeche').hidden`,
  },
]

const VARIANTEN = [
  { kurz: 'A', was: 'heute — inset: 0 (Deckel)', css: '' },
  { kurz: 'B', was: 'Leiste bleibt — left: 88px', css: '.eltern{left:88px}' },
  { kurz: 'C', was: 'Form des Entwurfs — left: 88px; bottom: 84px', css: '.eltern{left:88px;bottom:84px}' },
  /* W2 AUS DEM AUFTRAG: die Flaeche behaelt die volle Hoehe, nur die rechte
     Haelfte endet ueber dem Kissen. Hier gehoert eine Zahl her, die man dem
     Vorschlag nicht ansieht: das Kissen liegt bei z-index 5, `.eltern` bei 8.
     Wo sie sich ueberlappen, gewinnt der Bereich — das Kissen waere dann
     SICHTBAR (es liegt ja darunter nicht mehr) oder eben tot. Gemessen statt
     gedacht. */
  { kurz: 'W2', was: 'volle Hoehe, nur die Karte endet ueber dem Kissen', css: '.eltern{left:88px}.eltern-flaeche{padding-bottom:84px}' },
]

// ── Lauf ───────────────────────────────────────────────────────────────────
const berichte = []
try {
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const stand = async (was) => {
    await fetch(new URL(`/vorschau/${was}`, ZIEL)).catch(() => null)
    await warte(150)
  }
  const neuLaden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
  }
  const langHalten = async () => {
    // HIER STAND EIN GRIFF ANS ZAHNRAD `#einst-knopf`. Es ist am 06.08.2026
    // ersatzlos entfallen; hinein fuehrt der Schriftzug `#wappen`. Dieser Weg
    // ist der TASTATURWEG und prueft das Halten NICHT — tools/admin-weg.mjs.
    await adminAuf(ev, { warteMs: 900 })
  }
  const regelSetzen = async (css) => {
    await ev(`(() => {
      let s = document.getElementById('probe-deckel')
      if (!s) { s = document.createElement('style'); s.id = 'probe-deckel'; document.head.appendChild(s) }
      s.textContent = ${JSON.stringify(css)}
      return true })()`)
    await warte(220)
  }

  await stand('name-mitbox')

  for (const s of SCHIRME) {
    if (NUR_SCHIRM && s.name !== NUR_SCHIRM) continue
    await stand('voll')
    await stand(s.sperre)
    await neuLaden()
    await langHalten()
    if (!(await ev(s.pruefen))) throw new Error(`${s.name}: ging nicht auf`)

    for (const v of VARIANTEN) {
      if (NUR_VAR && v.kurz !== NUR_VAR) continue
      await regelSetzen(v.css)
      const m = await ev(MESSEN_JS)
      berichte.push({ schirm: s, variante: v, eingefahren: false, m })
      if (BILD) {
        const d = await send(ws, 'Page.captureScreenshot', { format: 'png' })
        await writeFile(`${BILD}-${s.name}-${v.kurz}.png`, Buffer.from(d.data, 'base64'))
      }
      /* DIE WISCHGESTE — nur einmal je Lage, und danach zurueckgesetzt.
         Sie ist ein Ereignis und veraendert den Zustand, deshalb steht sie
         hinter der Messung und nicht davor. */
      const w = await ev(WISCH_JS)
      berichte[berichte.length - 1].wisch = w

      /* DIE EINGEFAHRENE LEISTE. `eltern.auf()` ruft `platzBeimBlaettern.zeigen()`
         NICHT (der grosse Player tut es, app.js Z. 9142) — die Lage ist also
         erreichbar, und in Variante B/C zeigt der freigegebene Streifen dann
         auf eine Leiste, die per `translateX(-100%)` draussen steht. */
      if (MIT_EINGEFAHREN) {
        await ev(`document.body.classList.add('platz-machen'); true`)
        await warte(300)
        const m2 = await ev(MESSEN_JS)
        berichte.push({ schirm: s, variante: v, eingefahren: true, m: m2 })
        if (BILD) {
          const d = await send(ws, 'Page.captureScreenshot', { format: 'png' })
          await writeFile(`${BILD}-${s.name}-${v.kurz}-eingefahren.png`, Buffer.from(d.data, 'base64'))
        }
        await ev(`document.body.classList.remove('platz-machen'); true`)
        await warte(300)
      }
    }
    await regelSetzen('')
  }

  /* ══ SONDERFRAGEN ═══════════════════════════════════════════════════════
   *
   * Vier Dinge lassen sich nicht an einem Punkt ablesen, weil sie EREIGNISSE
   * sind oder eine zweite Ebene brauchen. Sie laufen deshalb einzeln, auf dem
   * Schirm mit offener Flaeche, und jedes raeumt hinter sich auf.
   *
   *  S1 KOMMT DIE OBERFLAECHE UEBERHAUPT IN DIE EINGEFAHRENE LAGE, waehrend
   *     der Eltern-Bereich offen ist? `eltern.auf()` ruft — anders als der
   *     grosse Player (app.js Z. 9142) — `platzBeimBlaettern.zeigen()` NICHT.
   *     Wenn die Lage erreichbar ist, zeigt der freigegebene 88-px-Streifen
   *     in Variante B/C nicht auf die Leiste, sondern auf die BUEHNE.
   *  S2 DIE WISCHGESTE. Sie haengt mit `capture: true` am `document` — ein
   *     Deckel kann sie gar nicht abfangen. Behauptung ueber Ereignisse
   *     gehoert ausgeloest, nicht gelesen.
   *  S3 DAS FENSTER „WER HOERT" (z 8) UEBER DEM ELTERN-BEREICH (z 8).
   *     Gleiche Stufe, und dann entscheidet die BAUREIHENFOLGE: `#ich-fenster`
   *     steht in index.html Z. 199, `#eltern` in Z. 750 — der spaetere gewinnt.
   *  S4 DIE MELDUNG (z 10) liegt ueber allem. Bleibt das so?
   */
  const sonder = {}
  await stand('voll')
  await stand('sperre-aus')
  await neuLaden()

  /* S0 — DER WEG, DEN EIN FINGER WIRKLICH NIMMT.
   *
   * S1 stellt die Frage von innen: kommt die Oberflaeche in die eingefahrene
   * Lage, WENN der Bereich schon offen ist? Unter dem heutigen Deckel kann ein
   * Finger die Buehne gar nicht rollen — die Frage waere damit theoretisch.
   * S0 stellt sie in der Reihenfolge, die es an der Box gibt:
   *   erst blaettern (Leiste faehrt ein), dann INNERHALB der Ruhezeit den
   *   Schriftzug halten (bis 06.08.2026: 700 ms aufs Zahnrad).
   * `eltern.auf()` ruft `platzBeimBlaettern.zeigen()` nicht (der grosse Player
   * tut es, app.js Z. 9142) — der Zustand wandert also mit hinein. */
  /* DIE UHR IST KURZ: RUHE_BIS_ZURUECK_MS = 1400 (app.js Z. 340), mit offener
     Lane RUHE_MIT_LANE_MS = 4000 (Z. 385). Der Griff dauert 1200 ms
     — das Fenster ist also da, aber sehr schmal. Deshalb wird hier NICHT
     gewartet: rollen, sofort greifen, und im selben Augenblick nachsehen, in
     dem der Bereich aufgeht. Wer erst 900 ms Hoeflichkeit einlegt, misst
     zuverlaessig, dass es nicht passiert — und das waere eine Attrappe. */
  await ev(`document.getElementById('buehne').dispatchEvent(new Event('scroll')); true`)
  const s0vor = await ev(`document.body.classList.contains('platz-machen')`)
  /* DER GRIFF IST HIER DAS GEMESSENE, nicht nur der Weg hinein — deshalb wird
     WIRKLICH GEHALTEN und nicht der Tastaturweg genommen. Bis zum 06.08.2026
     hing der Griff am Zahnrad `#einst-knopf` und dauerte 700 ms; seit dem
     Wegfall des Zahnrads haengt er am Schriftzug `#wappen` und dauert
     WAPPEN_HALTEN_MS = 1200 ms (tools/admin-weg.mjs). DIE UHR IST DIESELBE
     GEBLIEBEN: 1400 ms bis die Leiste von selbst zurueckkommt. Das Fenster ist
     damit von 700 auf 200 ms geschrumpft — wenn dieser Abschnitt kippt, ist
     das ein Befund ueber die Oberflaeche und keiner ueber das Werkzeug. */
  await ev(`(() => { const k = document.getElementById('wappen')
    k.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true })()`)
  await warte(WAPPEN_HALTEN_MS + 40)
  const s0auf = await ev(`(() => { const k = document.getElementById('wappen')
    k.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    return { platzMachen: document.body.classList.contains('platz-machen'),
             elternOffen: !document.getElementById('eltern').hidden } })()`)
  sonder.s0 = {
    vorDemOeffnen: s0vor,
    beimOeffnen: s0auf.platzMachen,
    elternOffen: s0auf.elternOffen,
  }
  await warte(600)
  /* UND WIE LANGE BLEIBT ES SO? Die Uhr laeuft weiter — die Leiste faehrt
     mitten im Eltern-Bereich wieder aus, ohne dass jemand etwas getan hat. */
  for (let i = 0; i < 12 && (await ev(`document.body.classList.contains('platz-machen')`)); i++) await warte(500)
  sonder.s0.nachDemWarten = await ev(`document.body.classList.contains('platz-machen')`)
  sonder.s0.elternDanach = await ev(`!document.getElementById('eltern').hidden`)

  if (!(await ev(`!document.getElementById('eltern').hidden`))) await langHalten()

  // S1 + S2 — in Variante C, weil dort am meisten frei wird; `--variante`
  // stellt sie um, denn dieselben Fragen gehoeren AUCH an den heutigen Deckel
  // (S2 vor allem: dass der Randwisch ihn schon heute durchschlaegt, ist ein
  // Befund ueber den STAND und nicht ueber den Vorschlag).
  const sonderVar = (VARIANTEN.find((v) => v.kurz === NUR_VAR) || VARIANTEN[2]).css
  await regelSetzen(sonderVar)
  sonder.s1 = await ev(String.raw`
    (() => {
      const vor = document.body.classList.contains('platz-machen')
      /* EIN ECHTES ROLLEREIGNIS AN DER BUEHNE — derselbe Weg, den ein Finger
         nimmt. Kein Zugriff auf platzBeimBlaettern: das Ding liegt in einem
         Verschluss, und ein Werkzeug, das an die Innereien greift, misst
         etwas anderes als die Oberflaeche tut. */
      document.getElementById('buehne').dispatchEvent(new Event('scroll', { bubbles: false }))
      return { vor, nach: document.body.classList.contains('platz-machen') }
    })()`)
  await warte(300)
  sonder.s2 = await ev(WISCH_JS)
  await warte(300)
  sonder.s2lage = await ev(String.raw`
    (() => {
      const l = document.querySelector('.leiste').getBoundingClientRect()
      return { platzMachen: document.body.classList.contains('platz-machen'), leisteBreite: Math.round(l.width) }
    })()`)

  // S3 — das Fenster „wer hoert" ueber dem Eltern-Bereich
  sonder.s3 = await ev(String.raw`
    (() => {
      const ich = document.getElementById('ich')
      const r = ich.getBoundingClientRect()
      /* GETIPPT WIRD, NICHT AUFGERUFEN: ich.auf() liegt im Verschluss. Der
         Tipp geht ueber elementFromPoint — also genau den Weg eines Fingers,
         und er beweist damit gleichzeitig, dass das Zeichen erreichbar IST. */
      const ziel = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
      const erreicht = !!ziel && (ziel === ich || ich.contains(ziel))
      if (erreicht) ziel.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return { erreicht, zielWar: ziel ? ziel.tagName.toLowerCase() + (ziel.id ? '#' + ziel.id : '') : null }
    })()`)
  await warte(700)
  sonder.s3lage = await ev(String.raw`
    (() => {
      const f = document.getElementById('ich-fenster')
      const e = document.getElementById('eltern')
      const b = document.getElementById('ich-blatt')
      const kasten = (x) => { const r = x.getBoundingClientRect(); return { l: Math.round(r.left), o: Math.round(r.top), b: Math.round(r.width), h: Math.round(r.height) } }
      const punkt = (x, y) => { const t = document.elementFromPoint(x, y); return t ? (t.id ? '#' + t.id : t.tagName.toLowerCase() + '.' + (t.getAttribute('class') || '').split(/\s+/)[0]) : null }
      const br = b ? b.getBoundingClientRect() : null
      return {
        fensterOffen: !f.hidden, elternOffen: !e.hidden,
        fenster: f.hidden ? null : kasten(f), blatt: br && br.width ? kasten(b) : null,
        /* DREI PUNKTE, DIE DIE FRAGE BEANTWORTEN: mitten im Blatt (gehoert es
           dem Fenster oder dem Eltern-Bereich?), im freien Streifen links, und
           auf dem Rueckweg. */
        imBlatt: br && br.width ? punkt(Math.round(br.left + br.width / 2), Math.round(br.top + br.height / 2)) : null,
        imStreifen: punkt(44, 300),
        aufRueckweg: punkt(129, 33),
        /* WAS SCHLIESST DER RUECKWEG ALS NAECHSTES? Aus dem Baum gelesen wie
           rueckwegLage() es tut — die Funktion selbst liegt im Verschluss. */
        lage: { ichFenster: !!document.getElementById('ich-fenster').getClientRects().length,
                eltern: !!document.getElementById('eltern').getClientRects().length },
      }
    })()`)
  // wieder zumachen
  await ev(`document.getElementById('zurueck').click(); true`)
  await warte(500)
  sonder.s3danach = await ev(String.raw`
    (() => ({ fensterOffen: !document.getElementById('ich-fenster').hidden,
              elternOffen: !document.getElementById('eltern').hidden }))()`)

  // S4 — die Meldung
  sonder.s4 = await ev(String.raw`
    (() => {
      const m = document.getElementById('meldung')
      document.getElementById('meldung-text').textContent = 'Probe'
      m.hidden = false
      const punkt = (x, y) => { const t = document.elementFromPoint(x, y); return t ? (t.id ? '#' + t.id : t.tagName.toLowerCase() + '.' + (t.getAttribute('class') || '').split(/\s+/)[0]) : null }
      const r = m.getBoundingClientRect()
      const erg = { kasten: { l: Math.round(r.left), o: Math.round(r.top), b: Math.round(r.width), h: Math.round(r.height) },
                    mitte: punkt(400, 240), imStreifen: punkt(44, 300), aufRueckweg: punkt(129, 33), imKissen: punkt(400, 440) }
      m.hidden = true
      return erg
    })()`)

  await regelSetzen('')
  berichte.sonder = sonder
  ws.close()
} finally {
  try {
    await brw.schliessen()
  } catch {
    /* schon weg */
  }
  if (vorschau) {
    try {
      vorschau.kill('SIGKILL')
    } catch {
      /* schon weg */
    }
  }
}

// ── Bericht ────────────────────────────────────────────────────────────────
const rahmen = (t) => {
  console.log('')
  console.log('═'.repeat(78))
  console.log(t)
  console.log('═'.repeat(78))
}
let befunde = 0

for (const s of SCHIRME) {
  if (NUR_SCHIRM && s.name !== NUR_SCHIRM) continue
  const dieses = berichte.filter((b) => b.schirm.name === s.name)
  if (!dieses.length) continue
  rahmen(`${s.name} — ${s.was}`)

  // ── Die Rechtecke ──
  const a = dieses.find((b) => b.variante.kurz === 'A' && !b.eingefahren)
  for (const b of dieses) {
    const l = b.m.lagen
    console.log('')
    console.log(`── ${b.variante.kurz}  ${b.variante.was}${b.eingefahren ? '   [Leiste EINGEFAHREN]' : ''}`)
    const k = (n, x) => (x ? `${n}: ${x.l},${x.o}  ${x.b}x${x.h}` : `${n}: —`)
    console.log(`   ${k('#eltern', l.eltern)}   ${k('.leiste', l.leiste)}   ${k('#mp', l.mp)}`)
    console.log(`   ${k('#zurueck', l.zurueck)}   ${k('#ich', l.ich)}`)
    if (b.m.spalte)
      console.log(
        `   Faecherspalte: ${b.m.spalte.faecher} Faecher, ${b.m.spalte.inhalt} px in ${b.m.spalte.sicht} px` +
          (b.m.spalte.rollt ? `  →  ROLLT, ${b.m.spalte.fehlt} px fehlen` : '  →  passt'),
      )

    // Raster-Anteile
    const r = Object.entries(b.m.raster).sort((x, y) => y[1] - x[1])
    console.log(`   Flaeche (160 Stichproben): ` + r.map(([k2, v]) => `${k2} ${v}`).join(', '))

    // Benannte Stellen
    console.log('   getroffen an:')
    for (const st of b.m.stellen) {
      if (st.x === null) continue
      const frei = st.ebene !== 'eltern'
      console.log(`     ${frei ? 'FREI ' : 'zu   '} ${st.name.padEnd(38)} → ${st.ebene}  (${st.was})`)
    }

    // Was ist NEU treffbar gegenueber A?
    if (a && b !== a) {
      const neu = b.m.treffbar.filter((t) => !a.m.treffbar.includes(t))
      const weg = a.m.treffbar.filter((t) => !b.m.treffbar.includes(t))
      console.log(`   NEU treffbar gegenueber A (${neu.length}):`)
      for (const n of neu) console.log(`     + ${n}`)
      if (weg.length) {
        console.log(`   NICHT MEHR treffbar gegenueber A (${weg.length}):`)
        for (const n of weg) console.log(`     - ${n}`)
      }
      if (s.name === 'eltern-tor' && neu.length) befunde++
    }

    // Rueckweg gegen Zeichen
    const p = b.m.paare['zurueck/ich']
    if (p) console.log(`   #zurueck gegen #ich: ${p.ueberlappt ? `UEBERLAPPT um ${p.x} px` : `${p.luftX} px Luft (${mmS(p.luftX)} mm)`}`)
    const pt = b.m.paare['zurueck/titel']
    if (pt) console.log(`   #zurueck gegen .eltern-titel: ${pt.ueberlappt ? `UEBERDECKT um ${pt.x} px` : `${pt.luftX} px Luft (${mmS(pt.luftX)} mm)`}`)
    const pe = b.m.paare['zurueck/eltern']
    if (pe) console.log(`   #zurueck gegen #eltern: ${pe.ueberlappt ? `liegt DARUEBER (${pe.x}x${pe.y} px Ueberdeckung)` : 'steht DANEBEN'}`)

    if (b.wisch)
      console.log(
        `   Randwisch von x 6 nach x 90: platz-machen ${b.wisch.vorher} → ${b.wisch.nachher}` +
          (b.wisch.vorher === b.wisch.nachher ? '  (nichts passiert — war nicht eingefahren)' : '  (die Leiste kam zurueck)'),
      )
  }
}

const so = berichte.sonder
if (so) {
  rahmen(`SONDERFRAGEN — gemessen in Variante ${NUR_VAR || 'C'}, Flaeche offen`)
  console.log('')
  console.log('S0  Der Weg, den ein Finger nimmt: erst blaettern, dann aufs Zahnrad halten.')
  console.log(`    Leiste eingefahren vor dem Oeffnen: ${so.s0.vorDemOeffnen}`)
  console.log(`    ... und im Augenblick des Oeffnens noch: ${so.s0.beimOeffnen}   (Eltern offen: ${so.s0.elternOffen})`)
  console.log(`    nach dem Warten (bis 6 s): ${so.s0.nachDemWarten}  — die Uhr laeuft im Eltern-Bereich weiter`)
  console.log('')
  console.log('S1  Kommt die Oberflaeche in die EINGEFAHRENE Lage, waehrend der Bereich offen ist?')
  console.log(`    ein Rollereignis an der Buehne: platz-machen ${so.s1.vor} → ${so.s1.nach}`)
  console.log('')
  console.log('S2  Der Randwisch (x 6 → 90) mit offenem Eltern-Bereich:')
  console.log(`    platz-machen ${so.s2.vorher} → ${so.s2.nachher};  Leiste danach ${so.s2lage.leisteBreite} px breit`)
  console.log('')
  console.log('S3  Das Fenster „wer hoert" ueber dem Eltern-Bereich (beide z 8):')
  console.log(`    Zeichen erreichbar: ${so.s3.erreicht} (getroffen: ${so.s3.zielWar})`)
  console.log(`    danach: Fenster offen ${so.s3lage.fensterOffen}, Eltern offen ${so.s3lage.elternOffen}`)
  console.log(`    Blatt ${so.s3lage.blatt ? `${so.s3lage.blatt.l},${so.s3lage.blatt.o} ${so.s3lage.blatt.b}x${so.s3lage.blatt.h}` : '—'}`)
  console.log(`    getroffen mitten im Blatt: ${so.s3lage.imBlatt}`)
  console.log(`    getroffen im freien Streifen (44,300): ${so.s3lage.imStreifen}`)
  console.log(`    getroffen auf dem Rueckweg (129,33): ${so.s3lage.aufRueckweg}`)
  console.log(`    rueckwegLage waere: ichFenster ${so.s3lage.lage.ichFenster}, eltern ${so.s3lage.lage.eltern}`)
  console.log(`    nach EINEM Tipp auf den Rueckweg: Fenster ${so.s3danach.fensterOffen}, Eltern ${so.s3danach.elternOffen}`)
  console.log('')
  console.log('S4  Die Meldung (z 10):')
  console.log(`    Kasten ${so.s4.kasten.l},${so.s4.kasten.o} ${so.s4.kasten.b}x${so.s4.kasten.h}`)
  console.log(`    Mitte ${so.s4.mitte} | Streifen ${so.s4.imStreifen} | Rueckweg ${so.s4.aufRueckweg} | Kissen ${so.s4.imKissen}`)
}

rahmen('WAS DARAUS FOLGT')
console.log('Die Zahlen stehen oben. Die Bewertung gehoert in den Bericht des Laufs,')
console.log('nicht in dieses Werkzeug — es misst und urteilt nicht ueber Absichten.')

if (hat('pruefen')) {
  console.log('')
  console.log(befunde ? `BEFUND: ${befunde} Variante(n) geben waehrend des TORS Ziele frei.` : 'kein Befund')
  process.exit(befunde ? 1 : 0)
}
