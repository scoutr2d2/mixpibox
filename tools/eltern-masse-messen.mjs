#!/usr/bin/env node
/**
 * DIE MASSE DES ELTERN-BEREICHS — ALLE Abstaende, und ob die Spalte rollt.
 *
 * ══ WOZU, UND WARUM NICHT tools/beruehrziele-neu.mjs ═══════════════════════
 * `beruehrziele-neu.mjs` misst die GROESSE jedes Ziels im ganzen Haus und
 * nennt vom Abstand genau EINE Zahl je Schirm: die engste. Das ist fuer den
 * Ueberblick richtig und fuer eine Reparatur zu wenig. Wer die 6 px zwischen
 * zwei `.fach-knopf` aufmacht, will vorher wissen, WELCHE Paare sonst noch
 * unter der 2-mm-Marke liegen — sonst repariert er den engsten Abstand und
 * findet danach den zweitengsten vor.
 *
 * Zweitens beantwortet es die Frage nicht, die an dieser Stelle mit dem
 * Abstand zusammenhaengt: Ein groesserer `gap` macht die Spalte hoeher. Ab
 * wann ROLLT sie? Ein Fach, das man nur durch Rollen erreicht, ist auf einem
 * Beruehrschirm halb da — der Gewinn an Abstand waere dann mit einem
 * schlechteren Fehler bezahlt.
 *
 * ══ DIE PIXELZAEHLUNG, UND WARUM HIER EINE ANDERE ZAHL STEHT ═══════════════
 * `beruehrziele-neu.mjs` rechnet den Abstand als Differenz zweier
 * TASTPUNKT-INDIZES: die letzte getroffene Zeile von A und die erste von B.
 * Liegen zwischen zwei Knoepfen 6 leere Bildpunktzeilen, ist diese Differenz
 * 7 — das Werkzeug meldet dann 0,98 mm, waehrend das Stilblatt `gap: 6px`
 * (0,84 mm) sagt. Beide Zahlen sind richtig und meinen dasselbe.
 *
 * HIER WIRD DIE LEERE LUECKE GEZAEHLT (Differenz minus eins, mindestens 0),
 * weil das die Zahl ist, die man in `gap` schreibt, und zusaetzlich die
 * Zaehlung des anderen Werkzeugs — damit die beiden Berichte vergleichbar
 * bleiben und niemand den Unterschied fuer eine Wirkung haelt.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei des Baums. Eigener Browser (headless) gegen eine
 * Vorschau; `--probe` legt eine Regel NUR im Browser dieses Laufs bei,
 * `--faecher` setzt zusaetzliche Faecher NUR dort ein. Beides ist mit dem
 * Lauf vorbei.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/eltern-masse-messen.mjs --debug-port 9602 http://127.0.0.1:8602/neu/
 *   ... --probe '.eltern-faecher{gap:14px}'   einen Vorschlag nachmessen
 *   ... --faecher 5                           ein fuenftes Fach einsetzen
 *   ... --schirm eltern-tor                   nur dieser Schirm
 *   ... --bild /tmp/eltern                    je Schirm ein PNG
 *   ... --name lang                           dreizeiliger Boxname
 *   ... --alle                                jedes Paar, nicht nur die unter 2 mm
 *   ... --pruefen                             aus dem Bericht wird ein Urteil
 *                                             (Ende 1, wenn eine Marke faellt)
 *   ... --pruefen --faecher 5                 und das auch mit fuenf Faechern
 */
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { eigenerBrowser, freierPort } from './leihgabe.mjs'
import { adminAuf } from './admin-weg.mjs'

const argv = process.argv.slice(2)
const hat = (n) => argv.includes(`--${n}`)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
// KEINE VORGABEADRESSE MEHR. Ohne Argument wird unten eine eigene Vorschau auf
// einem freien Port gestartet; eine feste Zahl hier hiesse, im Zweifel den
// Arbeitsbaum eines fremden Laufs zu messen.
let ZIEL = argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:0/neu/'
const PROBE = typeof opt('probe', null) === 'string' ? opt('probe', null) : null
const FAECHER = Number(opt('faecher', 0)) || 0
const NUR = typeof opt('schirm', null) === 'string' ? opt('schirm') : null
const BILD = typeof opt('bild', null) === 'string' ? opt('bild') : null
const NAME = typeof opt('name', 'mitbox') === 'string' ? opt('name', 'mitbox') : 'mitbox'
const ALLE = hat('alle')
const RECHTECKE = hat('rechtecke')

/** 800x480 auf 5" Waveshare, ohne Skalierung. */
const MM_JE_PIXEL = 0.14
/** 9 mm Groesse, 2 mm Abstand — beides ISO 9241-411. */
const MARKE_MM = 9
const MARKE_PX = MARKE_MM / MM_JE_PIXEL
const ABSTAND_MM = 2
const mmS = (px) => (px * MM_JE_PIXEL).toFixed(2)

// ── Browser: GELIEHEN ueber eigenerBrowser() (tools/leihgabe.mjs) ──────────
// Freier Port, eigenes Profil, Eigentumsnachweis — die Fremdfenster-Falle
// vom 06.08.2026 (belegter Debug-Port, stiller Zweitstart) ist dort geloest.

/*
 * EINE SCHON LAUFENDE VORSCHAU WIRD NICHT ANGEFASST — sie gehoert dann jemandem,
 * der gerade daran misst ([[vorschau-wird-geliehen]]). Und wenn eine gestartet
 * wird, dann AUF DEM PORT DES ZIELS, nicht auf dem Vorgabeport: sonst steht die
 * Attrappe woanders als die Messung, und der Bericht nennt trotzdem Zahlen.
 *
 * OHNE ADRESSE EINE EIGENE AUF EINEM FREIEN PORT — seit dem 06.08.2026, und
 * das ist keine Kosmetik. Hier stand eine Vorgabeadresse mit fester Portnummer;
 * lief dort schon eine fremde Vorschau, mass dieses Werkzeug DEREN Arbeitsbaum
 * und meldete Zahlen ueber Dateien, die es nie gesehen hat. Als Pruefschritt in
 * tools/rotprobe.py, wo der ganze Sinn darin besteht, eine WEGWERF-Arbeitskopie
 * zu messen, waere jeder Eingriff still gruen geblieben.
 */
let vorschau = null
try {
  await fetch(new URL('/api/werke', ZIEL), { signal: AbortSignal.timeout(1500) })
} catch {
  // `:0` in der Vorgabeadresse heisst „noch keiner" — `new URL(...).port`
  // liefert dafuer die Zeichenkette „0", und die ist wahr. Wer sie nicht
  // abfaengt, startet die Vorschau auf Port 0 und misst nie wieder etwas.
  const angegeben = new URL(ZIEL).port
  const zielport = angegeben && angegeben !== '0' ? angegeben : String(await freierPort())
  ZIEL = `http://127.0.0.1:${zielport}/neu/`
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', zielport], {
    stdio: 'ignore',
  })
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

/*
 * DER DEBUG-PORT IST WAEHLBAR UND WIRD VORHER GEPRUEFT. Chromium mit einem
 * belegten `--remote-debugging-port` zu starten schlaegt NICHT fehl: der zweite
 * Aufruf endet still, und dieses Werkzeug steuerte dann das Fenster eines
 * fremden Laufs fern und meldete dessen Lage als Messung. Genau das ist am
 * 06.08.2026 passiert. Lieber keine Zahl als eine aus einem fremden Fenster.
 *
 * OHNE `--debug-port` FRAGT JETZT DAS BETRIEBSSYSTEM. Hier stand als Vorgabe
 * die feste 9602 — dieselbe Falle eine Ebene tiefer, und als Pruefschritt in
 * tools/rotprobe.py haette sie bei belegtem Port jeden Lauf mit Ende 2
 * abgebrochen: die GRUNDLINIE waere rot, und rotprobe.py haette ueber die
 * Eingriffe zu Recht gar nichts mehr behauptet. Eine Zahl von Hand bleibt
 * moeglich und wird dann wie bisher vorher geprueft.
 */
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
 * Dasselbe Tasten wie in tools/beruehrziele-neu.mjs, und aus demselben Grund:
 * `getBoundingClientRect` kennt die Absicht des Stilblatts, nicht das, was ein
 * Finger traefe. Eine fremde Ebene darueber macht keine Zahl kleiner.
 *
 * NEU IST DIE AUSWERTUNG: nicht das engste Paar, sondern JEDES Paar unter der
 * Marke — und dazu die Geometrie der Spalte.
 */
const MESSEN_JS = String.raw`
(() => {
  const WAHL = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [tabindex]:not([tabindex="-1"])'
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
  const trifft = (e, x, y) => {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false
    const g = document.elementFromPoint(x, y)
    return !!g && (g === e || e.contains(g))
  }
  const benennen = (e) => {
    const teile = [e.tagName.toLowerCase()]
    if (e.id) teile.push('#' + e.id)
    const kl = (e.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    if (kl.length) teile.push('.' + kl.join('.'))
    const s = e.getAttribute('aria-label') || (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)
    return teile.join('') + (s ? '  „' + s + '"' : '')
  }
  /*
   * WIE VIEL EINES ZIELS GERADE SICHTBAR IST — und zwar NICHT nur gegen den
   * Schirm, sondern auch gegen jeden Rollkasten darueber.
   *
   * GEFUNDEN AM 06.08.2026 im WLAN-Fach: Die vierte Netz-Zeile steht ganz im
   * 800x480-Schirm, ihr Rollkasten (.fach-zeilen) hoert aber frueher auf. Der
   * "Verbinden"-Knopf wurde mit 94x30 getastet statt 108x66 und stand als
   * 4,20-mm-Befund im Bericht. Das ist die ROLLPOSITION und nicht die
   * GESTALTUNG: eine Zeile weiterrollen, und er ist ganz da. Ohne diese
   * Unterscheidung meldete jede volle Liste dieses Hauses einen
   * Gestaltungsfehler, und die echten Befunde gingen darin unter.
   * (Dieselbe Ergaenzung steht in tools/beruehrziele-neu.mjs, wo sie
   * "angeschnitten" heisst.)
   */
  const sichtkasten = (e) => {
    let kl = 0, ko = 0, kre = innerWidth - 1, ku = innerHeight - 1
    for (let a = e.parentElement; a; a = a.parentElement) {
      const st = getComputedStyle(a)
      if (!/auto|scroll|hidden|clip/.test(st.overflowX + ' ' + st.overflowY)) continue
      const ra = a.getBoundingClientRect()
      kl = Math.max(kl, ra.left); ko = Math.max(ko, ra.top)
      kre = Math.min(kre, ra.right); ku = Math.min(ku, ra.bottom)
    }
    return { kl, ko, kre, ku }
  }
  const tasten = (e) => {
    const r = e.getBoundingClientRect()
    const k = sichtkasten(e)
    const l = Math.max(k.kl, r.left), o = Math.max(k.ko, r.top)
    const re0 = Math.min(k.kre, r.right), u0 = Math.min(k.ku, r.bottom)
    if (re0 <= l || u0 <= o) return null
    let sx = Math.round((l + re0) / 2), sy = Math.round((o + u0) / 2)
    if (!trifft(e, sx, sy)) {
      let gefunden = false
      for (let i = 1; i <= 5 && !gefunden; i++)
        for (let j = 1; j <= 5 && !gefunden; j++) {
          const x = Math.round(l + ((re0 - l) * i) / 6), y = Math.round(o + ((u0 - o) * j) / 6)
          if (trifft(e, x, y)) { sx = x; sy = y; gefunden = true }
        }
      if (!gefunden) return null
    }
    const ZUGABE = 40
    const lauf = (dx, dy, grenze) => { let n = 0; while (n < grenze && trifft(e, sx + dx * (n + 1), sy + dy * (n + 1))) n++; return n }
    const li = lauf(-1, 0, Math.ceil(r.width) + ZUGABE)
    const re = lauf(1, 0, Math.ceil(r.width) + ZUGABE)
    const ob = lauf(0, -1, Math.ceil(r.height) + ZUGABE)
    const un = lauf(0, 1, Math.ceil(r.height) + ZUGABE)
    return { l: sx - li, r: sx + re, o: sy - ob, u: sy + un, breite: li + re + 1, hoehe: ob + un + 1 }
  }

  const ziele = [...document.querySelectorAll(WAHL)].filter(sichtbar)
  const gemessen = []
  for (const e of ziele) {
    const t = tasten(e)
    if (!t) continue   /* nicht treffbar — hat keinen Abstand zu irgendetwas */
    const r = e.getBoundingClientRect()
    // ANGESCHNITTEN heisst: das Ziel ist groesser gebaut, als hier zu sehen
    // ist — der Rollkasten oder der Schirmrand schneidet ab. Die gemessene
    // Zahl bleibt stehen (sie ist richtig), sie zaehlt nur nicht als
    // Gestaltungsfehler.
    const kk = sichtkasten(e)
    const angeschnitten =
      r.left < kk.kl - 0.5 || r.top < kk.ko - 0.5 || r.right > kk.kre + 0.5 || r.bottom > kk.ku + 0.5
    gemessen.push({ name: benennen(e), k: t, rechteckB: Math.round(r.width), rechteckH: Math.round(r.height), klein: Math.min(t.breite, t.hoehe), angeschnitten })
    /* Der CSS-Kasten daneben — nicht statt der getasteten Flaeche, sondern
       zusaetzlich: wo die beiden auseinandergehen, liegt eine fremde Ebene
       darauf, und genau das ist die Auskunft, die man beim Aufmachen einer
       Luecke braucht. */
    gemessen[gemessen.length - 1].kasten = { l: Math.round(r.left), o: Math.round(r.top), r: Math.round(r.right), u: Math.round(r.bottom) }
  }

  /* ALLE PAARE. Die LEERE Luecke (Differenz der Tastpunkt-Indizes minus eins)
     ist die Zahl, die im Stilblatt steht; 'roh' ist die Zaehlung von
     tools/beruehrziele-neu.mjs, damit die Berichte vergleichbar bleiben. */
  const paare = []
  for (let i = 0; i < gemessen.length; i++)
    for (let j = i + 1; j < gemessen.length; j++) {
      const a = gemessen[i].k, b = gemessen[j].k
      const rohX = Math.max(0, Math.max(a.l - b.r, b.l - a.r))
      const rohY = Math.max(0, Math.max(a.o - b.u, b.o - a.u))
      const leerX = Math.max(0, rohX - 1), leerY = Math.max(0, rohY - 1)
      paare.push({
        a: gemessen[i].name, b: gemessen[j].name,
        leer: Math.round(Math.hypot(leerX, leerY)),
        roh: Math.round(Math.hypot(rohX, rohY)),
        achse: leerX === 0 && leerY > 0 ? 'senkrecht' : leerY === 0 && leerX > 0 ? 'waagerecht' : leerX === 0 && leerY === 0 ? 'beruehrt/ueberlappt' : 'diagonal',
      })
    }
  paare.sort((x, y) => x.leer - y.leer)

  /* DIE SPALTE: rollt sie? Und steht das LETZTE Fach ganz im Bild?
     Zwei verschiedene Fragen — eine Spalte kann rollbar sein, ohne dass beim
     Laden etwas fehlt, und ein Fach kann angeschnitten sein, ohne dass
     'overflow' anspricht. */
  const sp = document.getElementById('eltern-faecher')
  const fl = document.querySelector('.eltern-flaeche')
  const knoepfe = [...document.querySelectorAll('.fach-knopf')]
  const spalte = sp ? (() => {
    const sr = sp.getBoundingClientRect()
    const st = getComputedStyle(sp)
    const letzte = knoepfe.length ? knoepfe[knoepfe.length - 1].getBoundingClientRect() : null
    return {
      anzahl: knoepfe.length,
      breite: Math.round(sr.width),
      sichtHoehe: Math.round(sp.clientHeight),
      inhaltHoehe: Math.round(sp.scrollHeight),
      rollt: sp.scrollHeight > sp.clientHeight + 1,
      fehltPx: Math.max(0, sp.scrollHeight - sp.clientHeight),
      gap: st.rowGap,
      knopfHoehe: knoepfe.length ? Math.round(knoepfe[0].getBoundingClientRect().height) : 0,
      letztesGanzImBild: letzte ? letzte.bottom <= sr.bottom + 0.5 : null,
      letztesFehlt: letzte ? Math.max(0, Math.round(letzte.bottom - sr.bottom)) : 0,
      flaecheHoehe: fl ? Math.round(fl.getBoundingClientRect().height) : null,
      flaecheOben: fl ? Math.round(fl.getBoundingClientRect().top) : null,
    }
  })() : null

  /* DAS FACH DANEBEN ROLLT AUCH — und wer der Spalte links Luft aus dem
     Fachkopf herausnimmt, nimmt sie DORT weg. Ohne diese Zahl saehe eine
     Abhilfe gut aus, die nur den Fehler ueber die Trennlinie schiebt. */
  const zl = document.getElementById('fach-zeilen')
  const zeilen = zl ? {
    anzahl: zl.querySelectorAll('.fach-zeile').length,
    sichtHoehe: Math.round(zl.clientHeight),
    inhaltHoehe: Math.round(zl.scrollHeight),
    rollt: zl.scrollHeight > zl.clientHeight + 1,
    fehltPx: Math.max(0, zl.scrollHeight - zl.clientHeight),
  } : null

  /* DIE LAGE DES BEREICHS SELBST — fuer den Formvergleich mit dem Entwurf.
     Deckt '#eltern' die 88-px-Leiste zu, oder steht sie daneben? */
  const el = document.getElementById('eltern')
  const leiste = document.querySelector('.leiste') || document.getElementById('leiste')
  const lage = el ? (() => {
    const r = el.getBoundingClientRect()
    const lr = leiste ? leiste.getBoundingClientRect() : null
    /* Ein Punkt MITTEN AUF der Leiste: wer wird dort getroffen? Das ist die
       einzige ehrliche Antwort auf 'ist die Leiste noch bedienbar'. */
    const probe = lr ? document.elementFromPoint(Math.round(lr.left + lr.width / 2), Math.round(lr.top + lr.height / 2)) : null
    return {
      eltern: { l: Math.round(r.left), o: Math.round(r.top), b: Math.round(r.width), h: Math.round(r.height) },
      leiste: lr ? { l: Math.round(lr.left), o: Math.round(lr.top), b: Math.round(lr.width), h: Math.round(lr.height) } : null,
      aufDerLeiste: probe ? benennen(probe) : null,
      katsTreffbar: [...document.querySelectorAll('.kat')].filter((k) => {
        const kr = k.getBoundingClientRect()
        const g = document.elementFromPoint(Math.round(kr.left + kr.width / 2), Math.round(kr.top + kr.height / 2))
        return !!g && (g === k || k.contains(g))
      }).length,
      katsGesamt: document.querySelectorAll('.kat').length,
      /* DER MINI-PLAYER GEHOERT ZUM FORMVERGLEICH. Im Entwurf steht der
         Eltern-Bereich IN der Inhaltsspalte — und das Kissen steht in
         derselben Spalte darunter. Bleibt es stehen, kann ein Kind waehrend
         der Einstellungen anhalten und weiterschalten. Heute deckt
         inset:0 es zu. (Keine Schraegstrich-Anfuehrer: Vorlagenzeichenkette.) */
      mp: (() => {
        const m = document.getElementById('mp')
        if (!m || m.hidden) return null
        const r = m.getBoundingClientRect()
        const g = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
        return { l: Math.round(r.left), o: Math.round(r.top), b: Math.round(r.width), h: Math.round(r.height), daraufLiegt: g ? benennen(g) : null }
      })(),
    }
  })() : null

  return { ziele: gemessen, paare, spalte, zeilen, lage }
})()
`

// ── Die Schirme ────────────────────────────────────────────────────────────
const SCHIRME = [
  {
    name: 'eltern-tor',
    was: 'PIN-Tor vor dem Eltern-Bereich',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('sperre-pin')
      await h.neuLaden()
      await h.langHalten()
      if (!(await h.ev(`!document.getElementById('eltern-tor').hidden`))) throw new Error('das Tor ging nicht auf')
    },
  },
  {
    name: 'eltern-flaeche',
    was: 'Eltern-Bereich mit Faechern und Zeilen',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('sperre-aus')
      await h.neuLaden()
      await h.langHalten()
      if (!(await h.ev(`!document.getElementById('eltern-flaeche').hidden`))) throw new Error('die Flaeche ging nicht auf')
    },
  },
]

// ── Lauf ───────────────────────────────────────────────────────────────────
const berichte = []
let abbruch = 0
try {
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  // 800x480 GENAU. `--window-size` allein liess dem Sichtfenster nur 337 px.
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
  const langHalten = async (ms = 900) => {
    // HIER STAND EIN GRIFF ANS ZAHNRAD `#einst-knopf`. Es ist am 06.08.2026
    // ersatzlos entfallen; hinein fuehrt der Schriftzug `#wappen`. Dieser Weg
    // ist der TASTATURWEG und prueft das Halten NICHT — tools/admin-weg.mjs.
    await adminAuf(ev, { warteMs: 900 })
  }
  const h = { ev, stand, neuLaden, langHalten }

  /* DEN BOXNAMEN AUSDRUECKLICH SETZEN. Er ist Zustand der VORSCHAU und
     ueberlebt jedes Neuladen — wer vorher `/vorschau/name-lang` gestellt hat,
     misst sonst weiter mit dem dreizeiligen Namen, ohne es zu wissen. */
  await stand(`name-${NAME}`)

  /*
   * ── `--reihe` — VIELE VORSCHLAEGE IN EINEM BROWSER ────────────────────────
   *
   * Jeder Vorschlag einzeln waere ein eigener Lauf: eigener Browser, eigenes
   * Laden, eigenes langes Halten — rund 12 s je Zeile, und zwischen zwei
   * Laeufen kann sich der Zustand der Vorschau aendern, ohne dass es jemand
   * merkt ([[vorschau-wird-geliehen]]). Hier wird der Schirm EINMAL aufgebaut
   * und dann eine Regel nach der anderen eingesetzt und wieder abgeraeumt.
   * Alle Zeilen der Tabelle stammen damit garantiert aus derselben Lage.
   *
   * Jede Zeile wird zweimal gemessen — mit VIER und mit FUENF Faechern. Die
   * zweite Zahl ist die eigentliche Frage: eine Luecke, die vier Faecher
   * traegt und beim fuenften ins Rollen kippt, ist keine Loesung, sondern eine
   * Verschiebung des Fehlers auf den naechsten, der ein Fach dazustellt.
   */
  const ABHILFEN = [
    { was: 'heute (keine Regel)', css: '' },
    { was: 'gap 14px', css: '.eltern-faecher{gap:14px}' },
    { was: 'gap 15px', css: '.eltern-faecher{gap:15px}' },
    { was: 'gap 16px', css: '.eltern-faecher{gap:16px}' },
    { was: 'gap 20px', css: '.eltern-faecher{gap:20px}' },
    { was: 'schmalere Knoepfe (120px)', css: '.eltern-faecher{flex:0 0 120px;width:120px}' },
    { was: 'schmaler + gap 15px', css: '.eltern-faecher{flex:0 0 120px;width:120px;gap:15px}' },
    { was: 'Trennstrich statt Luft', css: '.fach-knopf + .fach-knopf{border-top:2px solid var(--line2)}' },
    { was: 'Knopf 56px hoch, gap 16px', css: '.eltern-faecher{gap:16px}.fach-knopf{flex:0 0 56px;height:56px}' },
    { was: 'Knopf 64px hoch, gap 16px', css: '.eltern-faecher{gap:16px}.fach-knopf{flex:0 0 64px;height:64px}' },
    /* DIE BEIDEN NAECHSTEN KAUFEN PLATZ AN ANDERER STELLE EIN — und beide
       muessen deshalb an der GESAMTEN engsten Luecke gemessen werden, nicht
       nur an der zwischen zwei Faechern. Die 16 px der Kopfzeile sind kein
       Weissraum, sondern der Abstand zu `#zurueck`, und ein Fehlgriff DORT
       oeffnet die alte Oberflaeche. */
    { was: 'gap 15px + Kopf 12 statt 16 Luft', css: '.eltern-faecher{gap:15px}.eltern-kopf{flex:0 0 calc(var(--griff) + 12px);height:calc(var(--griff) + 12px)}' },
    { was: 'gap 15px + unten 8 statt 12 Polster', css: '.eltern-faecher{gap:15px}.eltern{padding-bottom:8px}' },
    { was: 'gap 15px + unten 4 statt 12 Polster', css: '.eltern-faecher{gap:15px}.eltern{padding-bottom:4px}' },
    /* DIE ZWEITE ENGE STELLE DER FLAECHE: „Suchen" im Fachkopf und
       „Verbinden" in der ersten Zeile stehen 6 px auseinander. Das ist nicht
       der `gap` der Spalte, sondern das 6-px-Polster von `.fach-zeile`. */
    { was: 'Fachkopf 8px Luft nach unten', css: '.fach-kopf{margin-bottom:8px}' },
    { was: 'gap 15px + Fachkopf 8px Luft', css: '.eltern-faecher{gap:15px}.fach-kopf{margin-bottom:8px}' },
  ]
  if (hat('reihe')) {
    const s = SCHIRME.find((x) => x.name === 'eltern-flaeche')
    await s.hin(h)
    const zeilen = []
    for (const a of ABHILFEN) {
      for (const n of [4, 5, 6]) {
        await ev(`(() => {
          document.getElementById('masse-probe')?.remove()
          if (${JSON.stringify(a.css)}) {
            const st = document.createElement('style'); st.id = 'masse-probe'
            st.textContent = ${JSON.stringify(a.css)}; document.head.appendChild(st)
          }
          /* Auf die Grundzahl zurueckstellen, dann auffuellen — sonst
             sammelten sich die Klone ueber die Zeilen hinweg an und die
             Tabelle maesse etwas anderes, als in ihrer Spalte steht. */
          const sp = document.getElementById('eltern-faecher')
          const k = [...sp.querySelectorAll('.fach-knopf')]
          for (const x of k) if (x.dataset.probeKlon) x.remove()
          const rest = [...sp.querySelectorAll('.fach-knopf')]
          while (sp.querySelectorAll('.fach-knopf').length < ${n}) {
            const kl = rest[rest.length - 1].cloneNode(true)
            kl.classList.remove('hier'); kl.dataset.probeKlon = '1'
            const w = kl.querySelector('span')
            if (w) w.textContent = 'Fach ' + (sp.querySelectorAll('.fach-knopf').length + 1)
            kl.setAttribute('aria-label', 'Fach ' + (sp.querySelectorAll('.fach-knopf').length + 1) + ' — Probe')
            sp.appendChild(kl)
          }
          return true })()`)
        await warte(220)
        const m = await ev(MESSEN_JS)
        const faecher = m.ziele.filter((z) => /\.fach-knopf/.test(z.name))
        const kleinste = faecher.length ? Math.min(...faecher.map((z) => z.klein)) : 0
        const paare = m.paare.filter((p) => /\.fach-knopf/.test(p.a) && /\.fach-knopf/.test(p.b))
        const engst = paare.length ? Math.min(...paare.map((p) => p.leer)) : 0
        /* DIE ENGSTE LUECKE DES GANZEN SCHIRMS, nicht nur die zwischen zwei
           Faechern — sonst sieht ein Vorschlag gut aus, der die Luft der
           Spalte aus der Kopfzeile oder aus dem Fach daneben herausnimmt. */
        const gesamt = m.paare.length ? m.paare[0] : null
        zeilen.push({ was: a.was, n, kleinste, engst, gesamt, spalte: m.spalte })
      }
    }
    console.log('ABHILFEN FUER DIE 6 PIXEL — je Vorschlag mit 4, 5 und 6 Faechern')
    console.log('Marken: Ziel >= 9,00 mm (64,3 px), Abstand >= 2,00 mm (14,3 px leere Luft)\n')
    console.log('| Vorschlag | Faecher | kleinstes Ziel | Luecke Faecher | engste Luecke im Schirm | Spalte | letztes Fach |')
    console.log('|---|---|---|---|---|---|---|')
    for (const z of zeilen) {
      const s2 = z.spalte
      const g = z.gesamt
      console.log(
        `| ${z.was} | ${z.n} | ${mmS(z.kleinste)} mm ${z.kleinste >= MARKE_PX ? '✓' : '✗'} | ` +
          `${mmS(z.engst)} mm (${z.engst} px) ${z.engst * MM_JE_PIXEL >= ABSTAND_MM ? '✓' : '✗'} | ` +
          (g
            ? `${mmS(g.leer)} mm ${g.leer * MM_JE_PIXEL >= ABSTAND_MM ? '✓' : '✗'} ${g.a.replace(/\s+„.*$/, '')} ↔ ${g.b.replace(/\s+„.*$/, '')} | `
            : '— | ') +
          `${s2.inhaltHoehe} in ${s2.sichtHoehe} px ${s2.rollt ? `ROLLT (${s2.fehltPx} px)` : 'passt'} | ` +
          `${s2.letztesGanzImBild ? 'ganz im Bild' : `${s2.letztesFehlt} px fehlen`} |`,
      )
    }
    await ev(`document.getElementById('masse-probe')?.remove()`)
    await brw.schliessen()
    if (vorschau) vorschau.kill()
    process.exit(0)
  }

  for (const s of SCHIRME) {
    if (NUR && s.name !== NUR) continue
    try {
      await s.hin(h)
    } catch (e) {
      console.error(`  ${s.name}: NICHT ERREICHT — ${e.message}`)
      abbruch++
      continue
    }
    if (PROBE) {
      const da = await ev(`(() => {
        document.getElementById('masse-probe')?.remove()
        const s = document.createElement('style')
        s.id = 'masse-probe'
        s.textContent = ${JSON.stringify(PROBE)}
        document.head.appendChild(s)
        return document.getElementById('masse-probe') !== null })()`)
      if (!da) throw new Error('die Probe-Regel liess sich nicht einsetzen')
      await warte(250)
    }
    /*
     * ZUSAETZLICHE FAECHER — die Frage „und wenn ein fuenftes dazukommt?".
     * Geklont wird der LETZTE vorhandene Knopf samt seiner Klassen; die
     * Beschriftung wird durchnummeriert, damit im Bericht zu sehen ist,
     * welches Fach fehlt. Es aendert NewDesign/ nicht — der Klon lebt im
     * Browser dieses Laufs.
     */
    if (FAECHER > 0) {
      const n = await ev(`(() => {
        const sp = document.getElementById('eltern-faecher')
        if (!sp) return -1
        const k = [...sp.querySelectorAll('.fach-knopf')]
        // -2 heisst „das Tor steht davor", -1 heisst „offen und trotzdem
        // leer". Warum die beiden auseinandergehalten werden, steht drueben
        // in der Auswertung — hier ist nur der Befund.
        if (!k.length) {
          const tor = document.getElementById('eltern-tor')
          const zu = tor && !tor.hidden && getComputedStyle(tor).display !== 'none' && tor.getClientRects().length > 0
          return zu ? -2 : -1
        }
        while (sp.querySelectorAll('.fach-knopf').length < ${FAECHER}) {
          const kl = k[k.length - 1].cloneNode(true)
          kl.classList.remove('hier')
          const w = kl.querySelector('span')
          if (w) w.textContent = 'Fach ' + (sp.querySelectorAll('.fach-knopf').length + 1)
          kl.setAttribute('aria-label', 'Fach ' + (sp.querySelectorAll('.fach-knopf').length + 1) + ' — Probe')
          sp.appendChild(kl)
        }
        return sp.querySelectorAll('.fach-knopf').length })()`)
      /*
       * KEIN FACH DA IST ZWEIERLEI, und die beiden duerfen nicht dieselbe
       * Antwort bekommen — gefunden am 06.08.2026:
       *
       *   * DAS TOR STEHT NOCH DAVOR (-2). Dann liegt hinter der Sperre
       *     nichts zu klonen, und das ist richtig so: `--faecher` betrifft
       *     den Schirm `eltern-tor` gar nicht. Weitermessen.
       *   * DER BEREICH IST OFFEN UND TROTZDEM LEER (-1). DAS waere ein
       *     Befund und bleibt ein Abbruch.
       *
       * BIS HEUTE WARF BEIDES DENSELBEN FEHLER, und weil er die ganze
       * Schleife abbrach, endete der in diesem Kopf dokumentierte Aufruf
       * `--pruefen --faecher 5` mit „es wurde gar nicht vollstaendig gemessen
       * — kein Urteil". Der Schirm, um den es bei `--faecher` ueberhaupt geht
       * (`eltern-flaeche`), kam nie an die Reihe: `eltern-tor` steht davor.
       * Wer die Zeile als Beleg las, las eine, die nichts behauptet — und der
       * Fall „traegt die Spalte ein fuenftes Fach?" war ungeprueft, waehrend
       * er als geprueft galt.
       */
      if (n === -2) {
        console.error(`  ${s.name}: das Tor steht davor — hier gibt es keine Faecher, --faecher gilt fuer diesen Schirm nicht.`)
      } else if (n < 0) {
        throw new Error(`${s.name}: der Bereich ist offen und hat trotzdem kein Fach zum Klonen`)
      } else {
        await warte(250)
      }
    }
    const m = await ev(MESSEN_JS)
    if (!m) {
      console.error(`  ${s.name}: die Messung gab nichts zurueck`)
      abbruch++
      continue
    }
    berichte.push({ ...s, ...m })
    if (BILD) {
      const d = await send(ws, 'Page.captureScreenshot', { format: 'png' })
      const pfad = `${BILD}-${s.name}.png`
      await writeFile(pfad, Buffer.from(d.data, 'base64'))
      console.error(`  Bild: ${pfad}`)
    }
  }
} catch (e) {
  console.error(`ABBRUCH: ${e.message}`)
  abbruch++
} finally {
  await brw.schliessen()
  if (vorschau) vorschau.kill()
}

// ── Ausgabe ────────────────────────────────────────────────────────────────
console.log(`MASSE DES ELTERN-BEREICHS — 800x480, ${MM_JE_PIXEL} mm/px`)
console.log(`Marken: ${MARKE_MM} mm Groesse, ${ABSTAND_MM} mm Abstand (ISO 9241-411 = ${MARKE_PX.toFixed(1)} / ${(ABSTAND_MM / MM_JE_PIXEL).toFixed(1)} px)`)
if (PROBE) console.log(`MIT PROBE-REGEL — das ist NICHT der Stand von app.css: ${PROBE}`)
if (FAECHER) console.log(`MIT ${FAECHER} FAECHERN — geklont, nicht gebaut. NewDesign/ ist unveraendert.`)
if (NAME !== 'mitbox') console.log(`BOXNAME: ${NAME} — nicht der Regelfall`)
console.log('')

for (const b of berichte) {
  console.log(`── ${b.name} ${'─'.repeat(Math.max(0, 52 - b.name.length))}`)
  console.log(`   ${b.was}`)
  const klein = b.ziele.filter((z) => z.klein < MARKE_PX && !z.angeschnitten)
  const schnitt = b.ziele.filter((z) => z.klein < MARKE_PX && z.angeschnitten)
  console.log(
    `   ${b.ziele.length} treffbare Ziele, davon ${klein.length} unter ${MARKE_MM} mm` +
      (schnitt.length ? ` (+${schnitt.length} nur angeschnitten — Rollposition, nicht Gestaltung)` : ''),
  )
  for (const z of klein) console.log(`     ✗ ${mmS(z.klein).padStart(6)} mm  ${z.name}`)
  for (const z of schnitt)
    console.log(`     ~ ${mmS(z.klein).padStart(6)} mm  ${z.name}  (gebaut ${z.rechteckB}x${z.rechteckH}, angeschnitten)`)

  if (RECHTECKE) {
    console.log('   RECHTECKE (getastet | CSS-Kasten), y-Kanten fuer das Nachrechnen von Luecken:')
    for (const z of [...b.ziele].sort((x, y) => x.k.o - y.k.o || x.k.l - y.k.l)) {
      console.log(
        `     x ${String(z.k.l).padStart(3)}–${String(z.k.r).padStart(3)}  y ${String(z.k.o).padStart(3)}–${String(z.k.u).padStart(3)}` +
          `  | CSS x ${String(z.kasten.l).padStart(3)}–${String(z.kasten.r).padStart(3)} y ${String(z.kasten.o).padStart(3)}–${String(z.kasten.u).padStart(3)}  ${z.name}`,
      )
    }
  }
  const eng = b.paare.filter((p) => p.leer * MM_JE_PIXEL < ABSTAND_MM)
  const zeigen = ALLE ? b.paare : eng
  console.log(`   ${eng.length} Paare unter ${ABSTAND_MM} mm (von ${b.paare.length} Paaren insgesamt)`)
  for (const p of zeigen.slice(0, ALLE ? 40 : 200)) {
    console.log(`     ${mmS(p.leer).padStart(6)} mm (${String(p.leer).padStart(2)} px leer, ${p.roh} px roh, ${p.achse})`)
    console.log(`            ${p.a}`)
    console.log(`            ${p.b}`)
  }

  if (b.spalte && b.spalte.anzahl === 0) {
    // Steht das Tor davor, ist die Spalte leer — das ist kein Befund, sondern
    // die Reihenfolge (Bereich sichtbar, Tor davor, Faecher erst danach).
    console.log('   SPALTE .eltern-faecher: leer — das Tor steht noch davor.')
  } else if (b.spalte) {
    const s = b.spalte
    console.log(`   SPALTE .eltern-faecher: ${s.anzahl} Faecher zu ${s.knopfHoehe} px, gap ${s.gap}, Breite ${s.breite} px`)
    console.log(`     Flaeche .eltern-flaeche ist ${s.flaecheHoehe} px hoch (beginnt bei y=${s.flaecheOben})`)
    console.log(`     Sichthoehe ${s.sichtHoehe} px, Inhalt ${s.inhaltHoehe} px  →  ${s.rollt ? `ROLLT (${s.fehltPx} px stehen unten heraus)` : 'rollt nicht'}`)
    console.log(`     letztes Fach ganz im Bild: ${s.letztesGanzImBild ? 'ja' : `NEIN (${s.letztesFehlt} px fehlen)`}`)
  }
  if (b.zeilen && b.zeilen.anzahl) {
    const z = b.zeilen
    console.log(
      `   FACH DANEBEN .fach-zeilen: ${z.anzahl} Zeilen, Sichthoehe ${z.sichtHoehe} px, Inhalt ${z.inhaltHoehe} px  →  ` +
        (z.rollt ? `ROLLT (${z.fehltPx} px)` : 'rollt nicht'),
    )
  }
  if (b.lage) {
    const l = b.lage
    console.log(`   LAGE #eltern: links ${l.eltern.l}, oben ${l.eltern.o}, ${l.eltern.b}x${l.eltern.h} px`)
    if (l.leiste) console.log(`     Leiste: links ${l.leiste.l}, ${l.leiste.b}x${l.leiste.h} px — auf ihrer Mitte liegt: ${l.aufDerLeiste}`)
    console.log(`     Kategorien treffbar: ${l.katsTreffbar} von ${l.katsGesamt}`)
    if (l.mp) console.log(`     Mini-Player: links ${l.mp.l}, oben ${l.mp.o}, ${l.mp.b}x${l.mp.h} px — auf seiner Mitte liegt: ${l.mp.daraufLiegt}`)
    else console.log('     Mini-Player: nicht da (nichts laeuft)')
  }
  console.log('')
}
if (abbruch) console.log(`${abbruch} Schirm(e) konnten NICHT gemessen werden — die Zahlen oben sind unvollstaendig.`)

/*
 * ── `--pruefen` — AUS DEM BERICHT WIRD EIN URTEIL ──────────────────────────
 *
 * WOZU DAS NOETIG WAR (06.08.2026): Dieses Werkzeug hat die 15 px zwischen
 * zwei `.fach-knopf` erst ausgemessen und dann belegt — aber ein Bericht
 * bewacht nichts. Wer morgen `gap` auf 8 stellt, weil das Bild „luftiger"
 * aussehen soll, bekommt eine schoene Tabelle und kein rotes Ergebnis.
 *
 * DIE MARKEN SIND BEIDE ISO 9241-411: 9 mm Groesse, 2 mm Abstand. Geprueft
 * werden ausdruecklich BEIDE, weil sie gegeneinander stehen — mehr Abstand ist
 * am billigsten durch kleinere Knoepfe zu haben, und das waere ein Rueckschritt
 * mit gruenem Ergebnis.
 *
 * UND DIE SPALTE DARF NICHT ROLLEN. Ein Fach, das man nur durch Rollen
 * erreicht, ist auf einem Beruehrschirm halb da; der Gewinn an Abstand waere
 * dann mit einem schlechteren Fehler bezahlt. Fuer die Frage „und beim
 * fuenften Fach?" gibt es `--faecher 5`.
 */
if (hat('pruefen')) {
  console.log('── PRUEFUNG ────────────────────────────────────────────')
  let schlecht = 0
  const sagen = (gut, wort) => {
    if (!gut) schlecht++
    console.log(`${gut ? 'ok  ' : 'NEIN'}  ${wort}`)
  }
  if (!berichte.length || abbruch) {
    console.log('NEIN  es wurde gar nicht vollstaendig gemessen — kein Urteil')
    process.exitCode = 1
  } else {
    for (const b of berichte) {
      const klein = b.ziele.filter((z) => z.klein < MARKE_PX && !z.angeschnitten)
      sagen(klein.length === 0, `${b.name}: kein Ziel unter ${MARKE_MM} mm (${b.ziele.length} gemessen)`)
      const eng = b.paare.filter((p) => p.leer * MM_JE_PIXEL < ABSTAND_MM)
      sagen(
        eng.length === 0,
        `${b.name}: kein Paar unter ${ABSTAND_MM} mm (${b.paare.length} Paare)` +
          (eng.length ? ` — engstes ${mmS(eng[0].leer)} mm zwischen ${eng[0].a} und ${eng[0].b}` : ''),
      )
      if (b.spalte && b.spalte.anzahl > 0) {
        sagen(
          !b.spalte.rollt && b.spalte.letztesGanzImBild,
          `${b.name}: die Faecherspalte rollt nicht (${b.spalte.anzahl} Faecher, ` +
            `${b.spalte.inhaltHoehe} in ${b.spalte.sichtHoehe} px)`,
        )
      }
    }
    console.log(schlecht ? `\n${schlecht} Aussagen halten NICHT.` : '\nAlle Aussagen halten.')
    process.exitCode = schlecht ? 1 : 0
  }
}
