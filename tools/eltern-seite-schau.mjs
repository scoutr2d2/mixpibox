#!/usr/bin/env node
/**
 * DER ELTERN-BEREICH ALS SEITE — die Aussagen, die dabei gehalten werden muessen.
 *
 * ══ WOZU, UND WARUM NICHT EINES DER SIEBEN VORHANDENEN ═════════════════════
 *
 * Am 06.08.2026 ist `#eltern` von einem DECKEL (`inset: 0`) zu einer SEITE
 * geworden: die Kategorienleiste links und das Kissen des Mini-Players unten
 * bleiben stehen und BEDIENBAR. Der Satz des Betreibers dazu lautete „ich
 * finde den entwurf gut wo nicht alles zu gedeckt ist".
 *
 * Solange es ein Deckel war, brauchte niemand zu fragen, was darunter liegt.
 * Jetzt schon — und die vorhandenen Werkzeuge beantworten je einen Teil und
 * keines das Ganze:
 *
 *   * `beruehrziele-neu.mjs`  misst GROESSE und den EINEN engsten Abstand je
 *     Schirm. Es weiss nicht, ob `#ich` stillgelegt ist, ob die Leiste
 *     eingefahren dasteht oder ob ein Zustand nach dem Verlassen haengt.
 *   * `eltern-masse-messen.mjs`, `eltern-seite-messen.mjs`  messen Rechtecke
 *     und Abstaende. Sie stellen keine Aussage auf, die rot werden kann.
 *   * `eltern-tor-schau.mjs`  misst die WIRKUNG des Tors, nicht die Lage.
 *   * `eltern-form-schau.mjs`  misst Ueberlappung und Beschnitt INNERHALB des
 *     Bereichs — die Leiste und das Kissen liegen ausserhalb.
 *   * `ich-zeichen-schau.mjs`  misst das Zeichen oben links, aber ohne
 *     offenen Eltern-Bereich.
 *   * `rueckweg-schau.mjs`  misst den einen Rueckweg auf allen Ebenen.
 *
 * DIE FRAGEN, DIE HIER GESTELLT WERDEN, sind genau die, an denen der Umbau
 * scheitern kann, ohne dass irgendeine Zahl der anderen Werkzeuge sich ruehrt:
 *
 *   1. STEHT DIE LEISTE WIRKLICH DA — und zwar auch dann, wenn kurz vorher
 *      gerollt wurde? (Ohne `platzBeimBlaettern.zeigen()` in `eltern.auf()`
 *      geht der Bereich mit EINGEFAHRENER Leiste auf. Dann zeigt der 88-px-
 *      Streifen nicht die vier Kategorien, sondern die BUEHNE — gemessen acht
 *      treffbare Kacheln waehrend einer PIN-Eingabe.)
 *   2. IST DAS KISSEN BEDIENBAR ODER NUR SICHTBAR? `.eltern` ist
 *      undurchsichtig und liegt bei z-index 8; ohne die 9 fuer `#mp` trifft
 *      ein Finger auf jedem der vier Knoepfe `div#eltern-flaeche`.
 *   3. IST „WER HOERT" SICHTBAR STILLGELEGT — oder heimlich tot, oder offen?
 *      Sein Fenster ginge HINTER dem Bereich auf (beide z-index 8), und ein
 *      Profilwechsel ruft `location.reload()`, was die Bremse des Tors aus dem
 *      Seitenspeicher loescht.
 *   4. NIMMT DAS EINGEFAHRENE KISSEN ETWAS WEG? Es schwebt ueber der rechten
 *      unteren Ecke; ohne die Reserve an `.eltern-fach` liegt die vierte
 *      Bluetooth-Zeile darunter, ohne die an `.eltern-tor` faellt die Taste
 *      „0" auf 4,06 mm.
 *   5. UND WENN NICHTS SPIELT? Dann ist `#mp` `hidden` — die Reserve waere ein
 *      leerer Streifen. Dieser Fall ist beim Bauen zuerst vergessen worden und
 *      steht deshalb als eigene Aussage da.
 *   6. BLEIBT ETWAS HAENGEN? Ein Kissen, das auf der Startseite eingefahren
 *      bleibt, und ein graues Zeichen „wer hoert" sehen beide nach Defekt aus.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei des Baums und nichts an der Box. Eigener Browser
 * (`eigenerBrowser()` aus leihgabe.mjs — der Debug-Port kommt vom
 * Betriebssystem; eine Zahl, die man von Hand waehlen kann, ist eine, die man
 * doppelt waehlen kann). Ohne `--ziel` eine EIGENE Vorschau auf einem freien
 * Port; eine geliehene bediente den Arbeitsbaum dessen, der sie gestartet hat
 * ([[vorschau-wird-geliehen]]).
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/eltern-seite-schau.mjs
 *   node tools/eltern-seite-schau.mjs --ziel http://127.0.0.1:8704/neu/
 *   node tools/eltern-seite-schau.mjs --bild /tmp/seite.png
 * ENDE 0, wenn jede Aussage haelt.
 */
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { browserSuchen, eigenerBrowser, freierPort } from './leihgabe.mjs'
import { adminAuf } from './admin-weg.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const MITGEGEBEN = typeof opt('ziel', null) === 'string' ? opt('ziel') : null
const BILD = typeof opt('bild', null) === 'string' ? opt('bild') : null

/** 9 mm bei 0,14 mm/px. Dieselbe Marke wie im ganzen Haus. */
const MARKE_PX = 64.3
/** 2 mm nach ISO 9241-411 — 14,29 px. 14 waeren 1,96 und damit daneben. */
const ABSTAND_PX = 14.29
const mm = (px) => (px * 0.14).toFixed(2)

const befunde = []
const ja = (gut, wort, dazu = '') => {
  befunde.push({ gut, wort })
  console.log(`${gut ? 'ok  ' : 'NEIN'}  ${wort}${dazu ? `  — ${dazu}` : ''}`)
}
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

if (!browserSuchen()) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

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
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(p)], {
    cwd: WURZEL,
    stdio: 'ignore',
  })
  vorschau.unref()
  let gestorben = null
  vorschau.on('exit', (c) => {
    gestorben = c
  })
  const bis = Date.now() + 10000
  for (;;) {
    if (gestorben !== null) throw new Error(`tools/neu-vorschau.mjs endete sofort (${gestorben}) — Port ${p} war belegt`)
    try {
      await fetch(`http://127.0.0.1:${p}/api/werke`)
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

/* ══ DIE MESSUNG IM BROWSER ═══════════════════════════════════════════════
 * TREFFEN heisst hier durchgaengig `elementFromPoint` auf der Mitte — nicht
 * „steht es im Baum". Ein Knopf, der dasteht und nicht reagiert, ist eine
 * Attrappe, und genau diese Sorte ist an dieser Oberflaeche mehrfach durch
 * gruene Zahlen gerutscht. */
const LAGE_JS = String.raw`
(() => {
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect()
    return { l: Math.round(r.left), o: Math.round(r.top), r: Math.round(r.right), u: Math.round(r.bottom), b: Math.round(r.width), h: Math.round(r.height) } }
  const sicht = (e) => { if (!e) return false; const s = getComputedStyle(e)
    return s.display !== 'none' && s.visibility !== 'hidden' && e.getClientRects().length > 0 }
  const benennen = (e) => { if (!e) return 'nichts'
    const t = [e.tagName.toLowerCase()]; if (e.id) t.push('#' + e.id)
    const k = (e.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    if (k.length) t.push('.' + k.join('.'))
    const s = e.getAttribute('aria-label') || (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)
    return t.join('') + (s ? '  „' + s + '"' : '') }
  const trifft = (e) => { if (!sicht(e)) return { ok: false, statt: 'unsichtbar' }
    const r = e.getBoundingClientRect()
    const x = Math.round(Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2)))
    const y = Math.round(Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2)))
    const g = document.elementFromPoint(x, y)
    const ok = !!g && (g === e || e.contains(g))
    return { ok, statt: ok ? null : benennen(g) } }
  const q = (s) => document.querySelector(s)

  /* JEDES ZIEL, DAS EIN FINGER AUF DIESEM SCHIRM WIRKLICH TRIFFT. Die Liste
     kommt aus dem Baum und nicht aus einer gepflegten Aufzaehlung — wer ein
     Bedienelement hinzufuegt, bekommt es hier von allein mitgemessen. */
  const alle = [...document.querySelectorAll('button, [role="button"], a[href], input, select')]
    .filter(sicht)
    .map((e) => ({ n: benennen(e), ...R(e), t: trifft(e), aus: e.disabled === true || e.getAttribute('aria-disabled') === 'true' }))
  const treffbar = alle.filter((z) => z.t.ok)
  /* ── RAGT ETWAS UEBER DEN SCHIRM? ────────────────────────────────────────
   * 800x480 ist kein Vorschlag. Ein Ziel, das darueber hinauslaeuft, meldet
   * weiter seine vollen 66 px und ist trotzdem kleiner — der Schirm schneidet
   * es ab. GEMESSEN so passiert: mit der alten Breitenformel des eingefahrenen
   * Kissens endet „Naechster Titel" bei x 803, und von seinen 66 px bleiben
   * 63 = 8,82 mm. Die Rechteckmasse allein sehen davon nichts, und genau
   * deshalb steht diese Zeile hier und nicht in einer Zusammenfassung. */
  const ueberDenRand = treffbar.filter((z) => z.r > 800.5 || z.u > 480.5 || z.l < -0.5 || z.o < -0.5)

  /* DER ENGSTE ABSTAND ZWISCHEN ZWEI TREFFBAREN ZIELEN. Ueberlappung zaehlt
     als 0 — sie ist der schlimmere Fall und darf nicht als „kein Abstand
     gefunden" durchgehen. */
  let eng = null
  for (let i = 0; i < treffbar.length; i++) for (let j = i + 1; j < treffbar.length; j++) {
    const a = treffbar[i], b = treffbar[j]
    const dx = Math.max(a.l - b.r, b.l - a.r, 0)
    const dy = Math.max(a.o - b.u, b.o - a.u, 0)
    const d = (dx > 0 && dy > 0) ? Math.hypot(dx, dy) : Math.max(dx, dy)
    if (!eng || d < eng.d) eng = { d, a: a.n, b: b.n }
  }

  /* ── DECKT DAS KISSEN EIN FREMDES ZIEL? ─────────────────────────────────
   * Die Liste der treffbaren Ziele oben kann das NICHT beantworten, und das
   * ist eine Falle, in die diese Datei schon gelaufen ist: Ein Knopf unter dem
   * Kissen liegt, ist nicht mehr treffbar — er FAELLT AUS der Liste heraus
   * und damit aus jeder Abstands- und Groessenrechnung. Der Schirm meldet
   * dann brav „kein Paar unter 2 mm", weil das engste Paar gar nicht mehr
   * mitgezaehlt wird. Deshalb wird die Ueberdeckung getrennt gemessen, in
   * Bildpunkten und gegen JEDES sichtbare Ziel ausserhalb des Kissens. */
  const kis = q('#mp')
  const kisR = kis && sicht(kis) ? kis.getBoundingClientRect() : null
  /* NUR, WAS IM ELTERN-BEREICH LIEGT. Die Buehne dahinter deckt das Kissen
     ebenfalls — aber sie liegt unter einer undurchsichtigen Flaeche und ist
     ohnehin nicht zu sehen. Sie mitzuzaehlen ergaebe bei jedem Lauf vier
     Kacheln als Befund, und eine Meldung, die immer kommt, liest niemand. */
  const bereich = q('#eltern')
  const kissenDeckt = !kisR || !bereich ? [] : [...bereich.querySelectorAll('button, [role="button"], a[href]')]
    .filter((e) => sicht(e) && !kis.contains(e))
    .map((e) => {
      const r = e.getBoundingClientRect()
      /* NUR DER SICHTBARE TEIL ZAEHLT — der Rest des Knopfes ist gar nicht da.
         GEFUNDEN 06.08.2026 im WLAN-Fach: die vierte und fuenfte Netz-Zeile
         liegen im Rollkasten .fach-zeilen UNTERHALB seiner Unterkante. Ihre
         Rechtecke ragen bis y=460 und ueberlappen das Kissen rechnerisch um
         4644 px — am Bildschirm ist von ihnen dort nichts zu sehen, und ein
         Finger trifft sie auch nicht. Ohne diese Einschraenkung wird die
         Aussage rot, sobald eine Liste voll genug ist, um zu rollen, und
         zwar bei JEDER solchen Liste. Dieselbe Ergaenzung steht in
         tools/beruehrziele-neu.mjs und tools/eltern-masse-messen.mjs. */
      let kl = 0, ko = 0, kre = innerWidth, ku = innerHeight
      for (let a = e.parentElement; a; a = a.parentElement) {
        const st = getComputedStyle(a)
        if (!/auto|scroll|hidden|clip/.test(st.overflowX + ' ' + st.overflowY)) continue
        const ra = a.getBoundingClientRect()
        kl = Math.max(kl, ra.left); ko = Math.max(ko, ra.top)
        kre = Math.min(kre, ra.right); ku = Math.min(ku, ra.bottom)
      }
      const l = Math.max(r.left, kl), o = Math.max(r.top, ko)
      const re = Math.min(r.right, kre), u = Math.min(r.bottom, ku)
      if (re <= l || u <= o) return null
      const bx = Math.min(re, kisR.right) - Math.max(l, kisR.left)
      const by = Math.min(u, kisR.bottom) - Math.max(o, kisR.top)
      return bx > 0.5 && by > 0.5 ? { n: benennen(e), px: Math.round(bx * by) } : null
    })
    .filter(Boolean)

  const sp = q('#eltern-faecher')
  const knoepfe = [...document.querySelectorAll('.fach-knopf')]
  return JSON.stringify({
    klassen: [...document.body.classList],
    offen: { eltern: !!q('#eltern') && !q('#eltern').hidden, tor: !!q('#eltern-tor') && !q('#eltern-tor').hidden,
             flaeche: !!q('#eltern-flaeche') && !q('#eltern-flaeche').hidden,
             ichFenster: !!q('#ich-fenster') && !q('#ich-fenster').hidden, mp: !!q('#mp') && !q('#mp').hidden },
    eltern: R(q('#eltern')), leiste: R(q('.leiste')), kissen: sicht(q('#mp')) ? R(q('#mp')) : null,
    faecher: R(sp), fach: R(q('.eltern-fach')), zeilen: R(q('#fach-zeilen')),
    // DER LETZTE KNOPF, NICHT DER KASTEN. Die Spalte ist ein Flex-Kind und
    // wird auf die volle Hoehe gedehnt — ihr Unterrand liegt IMMER am
    // Schirmboden und sagt nichts darueber, wo die Knoepfe aufhoeren. Genau
    // daran ist die Aussage ueber die Beschriftung zuerst gescheitert: sie
    // meldete 45 px Ueberlappung, wo 38 px Luft waren.
    // (KEINE BACKTICKS IN DIESEM BLOCK — er steht in einem Template-String,
    //  der an den Browser geht; ein Gegenhaken beendet ihn, und der Rest wird
    //  zu Code. Genau das ist hier eben passiert.)
    letztesFach: knoepfe.length ? R(knoepfe[knoepfe.length - 1]) : null,
    zurueck: R(q('#zurueck')), ich: R(q('#ich')), titel: R(q('.eltern-titel')),
    ichAus: !!q('#ich') && q('#ich').disabled === true,
    ichTrifft: trifft(q('#ich')),
    ichDurchsichtig: q('#ich') ? Number(getComputedStyle(q('#ich')).opacity) : 1,
    /* DER WEG HINEIN — bis zum 06.08.2026 hiess dieses Feld zahnrad und mass
       q('#einst-knopf'). Der Satz galt damals so: Das Zahnrad stand in der
       Kopfzeile, und wenn das Tor davor lag, durfte es nicht zu treffen sein,
       sonst zieht ein Kind das Tor beliebig oft neu auf. DIE FRAGE IST
       DIESELBE GEBLIEBEN, nur ist der Knopf jetzt der Schriftzug unten links
       (#wappen). Das Zahnrad ist ersatzlos entfallen. */
    einstieg: trifft(q('#wappen')),
    kats: [...document.querySelectorAll('.kat')].map((e) => ({ n: benennen(e), ...R(e), t: trifft(e) })),
    mpKnoepfe: [...document.querySelectorAll('#mp .mp-knopf')].map((e) => ({ n: benennen(e), ...R(e), t: trifft(e) })),
    fachKnoepfe: knoepfe.map((e) => ({ n: benennen(e), ...R(e), t: trifft(e) })),
    spalte: sp ? { sicht: Math.round(sp.clientHeight), inhalt: Math.round(sp.scrollHeight),
                   rollt: sp.scrollHeight > sp.clientHeight + 1,
                   letztesGanz: knoepfe.length ? Math.max(...knoepfe.map((e) => e.getBoundingClientRect().bottom)) <= sp.getBoundingClientRect().bottom + 0.5 : null } : null,
    treffbar: treffbar.map((z) => ({ n: z.n, b: z.b, h: z.h })),
    ueberDenRand: ueberDenRand.map((z) => z.n + '  bis x ' + z.r + ' / y ' + z.u),
    kissenDeckt,
    zuKlein: treffbar.filter((z) => Math.min(z.b, z.h) < ${MARKE_PX}).map((z) => z.n + ' ' + z.b + 'x' + z.h),
    eng,
  })
})()
`

const browser = await eigenerBrowser({ fenster: '800,480' })
if (!browser) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}
let ws = null
try {
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
  const laden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
  }
  /** Der Weg hinein ist der des Fingers: 700 ms Halten auf dem Zahnrad. */
  const hinein = async () => {
    // HIER STAND EIN GRIFF ANS ZAHNRAD `#einst-knopf`. Es ist am 06.08.2026
    // ersatzlos entfallen; hinein fuehrt der Schriftzug `#wappen`. Dieser Weg
    // ist der TASTATURWEG und prueft das Halten NICHT — tools/admin-weg.mjs.
    await adminAuf(ev, { warteMs: 900 })
  }
  const lage = async () => JSON.parse(await ev(LAGE_JS))

  // ══ 1. DIE OFFENE FLAECHE ════════════════════════════════════════════════
  console.log('\n── DIE OFFENE FLAECHE (Sperre aus, etwas spielt) ───────────')
  await stand('voll')
  await stand('sperre-aus')
  await laden()
  await hinein()
  let d = await lage()
  if (!d.offen.flaeche) throw new Error('die Eltern-Flaeche ging nicht auf — alles Weitere waere Unsinn')

  // BERICHTIGT AM ABEND DES 06.08.2026 — und der alte Satz steht mit, weil er
  // acht Stunden lang richtig war:
  //   „ER IST EINE SEITE, KEIN DECKEL: #eltern beginnt bei x 88 und ist 712
  //    breit." Er galt, seit der Betreiber nach drei Bildern die Form des
  //   Entwurfs gewaehlt hatte („nicht alles zu gedeckt").
  // DANN HAT ER ES UMGEDREHT: „ich denke wir können das admin menü doch screen
  // füllend machen." Gemessen wird jetzt das Gegenteil — und ZWEISEITIG, nicht
  // bloss „ist irgendwie da": x 0, volle 800x480. Eine Aussage, die nur nach
  // der Anwesenheit fragt, waere bei JEDER Form gruen und damit wertlos.
  ja(d.eltern && d.eltern.l === 0 && d.eltern.b === 800 && d.eltern.h === 480,
     'ER FUELLT DEN SCHIRM: #eltern steht bei x 0 und ist 800x480',
     d.eltern ? `${d.eltern.l},${d.eltern.o} ${d.eltern.b}x${d.eltern.h}` : '—')
  ja(!!d.leiste && d.leiste.b === 88 && !d.klassen.includes('platz-machen'),
     'DIE LEISTE STEHT DA (88 px breit, nicht eingefahren)',
     d.leiste ? `${d.leiste.b} px, Klassen: ${d.klassen.join(' ') || '—'}` : '—')
  // HIER STAND „ALLE VIER KATEGORIEN SIND ZU TREFFEN" — die Kehrseite der
  // Seitenform: die Leiste blieb daneben stehen und blieb bedienbar. Mit dem
  // Vollbild liegt sie DARUNTER, und getroffen wird `#eltern`. Das ist kein
  // Verlust, sondern die Form, die der Betreiber gewaehlt hat; gemessen wird
  // deshalb, dass sie wirklich ZUGEDECKT ist und nicht bloss unsichtbar.
  ja(d.kats.length === 4 && d.kats.every((k) => !k.t.ok), 'DIE KATEGORIEN SIND ZUGEDECKT, nicht bloss unsichtbar',
     d.kats.map((k) => (k.t.ok ? '✗ trifft noch' : '✓ ' + k.t.statt)).join(' '))
  ja(d.klassen.includes('eltern-offen'), 'DER EIGENE ZUSTAND STEHT: body.eltern-offen')
  ja(d.klassen.includes('kissen-da'), 'UND DER MERKER FUER DAS KISSEN: body.kissen-da')
  // ══ HIER STANDEN FUENF AUSSAGEN UEBER DAS EINGEFAHRENE KISSEN ═══════════
  //
  // Sie waren richtig und sind es nicht mehr: „DAS KISSEN IST EINGEFAHREN UND
  // STEHT RECHTS", „ES UEBERLAPPT DIE FAECHERSPALTE NICHT", „ALLE VIER
  // KISSENKNOEPFE SIND ZU TREFFEN", „UND ES LIEGT AUF KEINEM PUNKT DER KARTE",
  // „UND AUF KEINEM FREMDEN BEDIENELEMENT". Sie bewachten eine Form, in der das
  // Kissen einfuhr, auf z-index 9 stieg und BEDIENBAR blieb — anhalten und
  // lauter, waehrend jemand in den Einstellungen ist.
  //
  // DER BETREIBER WILL ES NICHT (06.08.2026 abends): „nimm noch auf das der
  // player nicht angezeigt wird im admin menu."
  //
  // GEMESSEN WIRD JETZT DAS GEGENTEIL, und zwar SCHAERFER als „ist nicht zu
  // sehen": `display: none` nimmt das Kissen aus dem Baum. Ein Knopf, der
  // dasteht und nicht reagiert, waere die Attrappe, vor der die alten Aussagen
  // schuetzten; einer, den es nicht gibt, kann nicht getroffen werden. Genau
  // das wird geprueft — nicht die Sichtbarkeit, sondern die Abwesenheit.
  ja(!d.kissen, 'DAS KISSEN IST GAR NICHT DA — nicht bloss unsichtbar',
     d.kissen ? `steht bei ${d.kissen.l},${d.kissen.o} ${d.kissen.b}x${d.kissen.h}` : 'nicht im Baum')
  ja(d.mpKnoepfe.length === 0 || d.mpKnoepfe.every((k) => !k.t.ok),
     'UND KEINER SEINER KNOEPFE IST ZU TREFFEN',
     d.mpKnoepfe.length ? d.mpKnoepfe.map((k) => (k.t.ok ? '✗ trifft' : '✓ ' + k.t.statt)).join(' ') : 'keine im Baum')
  ja(!!d.spalte && !d.spalte.rollt && d.spalte.letztesGanz !== false,
     'DIE FAECHERSPALTE ROLLT NICHT, das letzte Fach steht ganz im Bild',
     d.spalte ? `Sicht ${d.spalte.sicht} px, Inhalt ${d.spalte.inhalt} px` : '—')
  ja(d.fachKnoepfe.every((k) => k.t.ok), 'JEDES FACH IST ZU TREFFEN',
     d.fachKnoepfe.map((k) => (k.t.ok ? '✓' : '✗ ' + k.t.statt)).join(' '))

  // ── Das Zeichen „wer hoert" ────────────────────────────────────────────
  ja(d.ichAus, 'DAS ZEICHEN „WER HOERT" IST STILLGELEGT (disabled)')
  ja(d.ichDurchsichtig < 0.6, 'UND ES IST ZU SEHEN, DASS ES STILLIEGT (gedaempft, keine Attrappe)',
     `opacity ${d.ichDurchsichtig}`)
  ja(!d.ichTrifft.ok, 'EIN FINGER AUF IHM TRIFFT ES NICHT', d.ichTrifft.statt || '')
  await ev(`document.getElementById('ich').click()`)
  await warte(500)
  let n = await lage()
  ja(!n.offen.ichFenster && n.offen.flaeche,
     'EIN KLICK DARAUF OEFFNET KEIN FENSTER HINTER DEM BEREICH',
     `ich-fenster offen: ${n.offen.ichFenster}, eltern offen: ${n.offen.eltern}`)

  // ── Die drei harten Bedingungen des Auftrags ──────────────────────────
  ja(d.zuKlein.length === 0, `KEIN TREFFBARES ZIEL UNTER 9 mm (${d.treffbar.length} Ziele)`,
     d.zuKlein.join(', '))
  ja(d.ueberDenRand.length === 0, 'UND KEINES RAGT UEBER DEN 800x480-SCHIRM', d.ueberDenRand.join(', '))
  ja(!!d.eng && d.eng.d >= ABSTAND_PX, `KEIN PAAR UNTER 2 mm`,
     d.eng ? `engstes ${mm(d.eng.d)} mm zwischen ${d.eng.a} und ${d.eng.b}` : '—')

  // ── Der eine Rueckweg und die Ueberschrift ────────────────────────────
  // HIER STAND „DER EINZUG DER UEBERSCHRIFT WIRD VOM RAND DES BEREICHS
  // GERECHNET" — der waagerechte Abstand zwischen `#zurueck` und
  // `.eltern-titel`. Die Aussage hatte einen teuren Anlass: der erste Anlauf
  // schrieb den Einzug als „64 + 12" hin und lag um 96 px daneben, weil der
  // Rueckweg nicht am Rand steht; die Ueberschrift lag MITTEN AUF dem Knopf.
  //
  // SEIT DEM 06.08.2026 ABENDS STEHT DIE BESCHRIFTUNG UNTEN LINKS („wenn wir
  // admin menu die beschriftung unten links hinnemnen"). Ein waagerechter
  // Abstand zum Rueckweg sagt darueber nichts mehr — gemessen wurde zuletzt
  // -146 px, und das ist kein Fehler, sondern eine Frage, die es nicht gibt.
  //
  // WAS SIE SCHUETZTE, GILT WEITER: dass die Schrift nicht unter einem
  // Bedienelement liegt. Gemessen wird das jetzt dort, wo sie WIRKLICH steht —
  // senkrecht gegen das unterste Fach, statt waagerecht gegen den Rueckweg.
  const luft = d.titel && d.letztesFach ? d.titel.o - d.letztesFach.u : -1
  ja(luft >= 8,
     'DIE BESCHRIFTUNG UNTEN LINKS LIEGT UNTER DER SPALTE, nicht auf ihr',
     `Luft zwischen letztem Fach und .eltern-titel: ${luft} px (${mm(luft)} mm)`)
  // HIER STAND: „RUECKWEG UND KISSEN TEILEN SICH z-index 9 UND BERUEHREN
  // EINANDER NICHT". Die Aussage war noetig, solange das Kissen im Bereich auf
  // dieselbe Stufe stieg wie der Rueckweg — eine Stufe dazwischen gibt es
  // nicht, und wer eines von beiden verschiebt, musste es wissen. Seit das
  // Kissen im Admin-Menue GAR NICHT MEHR DA IST (06.08.2026 abends), gibt es
  // nichts mehr, was sich mit dem Rueckweg eine Stufe teilen koennte.
  //
  // SIE FAELLT NICHT ERSATZLOS WEG: Was sie eigentlich schuetzte, war der
  // Rueckweg — dass ihn nichts ueberlagert. Genau das wird jetzt direkt
  // gemessen, statt ueber den Umweg eines zweiten Elements.
  ja(!!d.zurueck && d.zurueckTrifft !== false,
     'DER RUECKWEG IST FREI — nichts liegt auf ihm',
     d.zurueck ? `x ${d.zurueck.l}..${d.zurueck.r}, y ${d.zurueck.o}..${d.zurueck.u}` : 'nicht da')

  if (BILD) {
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(BILD, Buffer.from(s.data, 'base64'))
    console.log(`   Bild: ${BILD}`)
  }

  // ══ 2. NACH DEM VERLASSEN — bleibt etwas haengen? ════════════════════════
  console.log('\n── NACH DEM VERLASSEN ──────────────────────────────────────')
  await ev(`document.getElementById('zurueck').click()`)
  await warte(600)
  n = await lage()
  ja(!n.offen.eltern, 'der Bereich ist zu')
  ja(!n.klassen.includes('eltern-offen'), 'DER ZUSTAND IST ZURUECKGELEGT: body.eltern-offen ist weg',
     `Klassen: ${n.klassen.join(' ') || '—'}`)
  ja(!n.ichAus, 'DAS ZEICHEN „WER HOERT" IST WIEDER FREI — ein grau gebliebener Knopf waere schlimmer als ein nie grauer')
  ja(!!n.kissen && n.kissen.b > 400, 'DAS KISSEN IST WIEDER AUSGEFAHREN',
     n.kissen ? `${n.kissen.b} px breit` : 'nicht da')

  // ══ 3. DAS STEHENDE TOR ══════════════════════════════════════════════════
  console.log('\n── DAS STEHENDE TOR (PIN) ──────────────────────────────────')
  await stand('sperre-pin')
  await laden()
  await hinein()
  d = await lage()
  if (!d.offen.tor) throw new Error('das Tor ging nicht auf')
  // FRUEHER: „DIE LEISTE BLEIBT AUCH AM TOR BEDIENBAR — der Betreiber wollte
  // ‚nicht alles zugedeckt'." Das war die Kehrseite der Seitenform, und es war
  // ausdruecklich geprueft worden, dass ein Kategoriewechsel dabei HARMLOS ist
  // (er zeichnet nur das Raster hinter dem Tor neu). Mit dem Vollbild ist die
  // Frage weg: es gibt dort nichts mehr zu bedienen.
  ja(d.kats.length === 4 && d.kats.every((k) => !k.t.ok),
     'AM TOR IST DIE LEISTE EBENFALLS ZUGEDECKT',
     'die Frage, ob ein Kategoriewechsel am Tor schadet, stellt sich seit dem Vollbild nicht mehr')
  // FRUEHER: „UND DAS KISSEN AUCH: anhalten und lauter sind der Grund fuer
  // diese Form." Am Tor war das die staerkste Aussage der ganzen Datei — sie
  // sagte, dass man die Musik anhalten kann, OHNE die Sperre zu loesen. Seit
  // dem Wunsch des Betreibers, den Player im Admin-Menue gar nicht zu zeigen,
  // gilt sie nicht mehr, und die Folge gehoert ausgesprochen: WER AM TOR
  // STEHT, KANN DIE MUSIK NICHT ANHALTEN. Er muss erst hinaus (ein Tipp auf
  // den Rueckweg) und findet das Kissen dann wieder.
  ja(d.mpKnoepfe.length === 0 || d.mpKnoepfe.every((k) => !k.t.ok),
     'AM TOR IST DAS KISSEN EBENFALLS WEG — anhalten geht erst nach dem Verlassen',
     d.mpKnoepfe.length ? d.mpKnoepfe.map((k) => (k.t.ok ? '✗ trifft' : '✓')).join(' ') : 'keine im Baum')
  ja(d.ichAus && !d.ichTrifft.ok,
     'ABER „WER HOERT" IST AUCH HIER STILLGELEGT — ueber ihn fuehrt der Weg an der Bremse des Tors vorbei (Profilwechsel ruft location.reload)')
  // BIS ZUM 06.08.2026 STAND HIER: „DAS ZAHNRAD IST NICHT ZU TREFFEN — das
  // Tor laesst sich von aussen nicht neu aufziehen." Der Satz galt, weil das
  // Zahnrad `#einst-knopf` in der Kopfzeile der Weg hinein war. Es ist
  // ersatzlos entfallen; der Weg ist jetzt der Schriftzug `#wappen` unten
  // links. DIE AUSSAGE IST DIESELBE und wird hier nur auf den neuen Knopf
  // gerichtet — sonst waere sie beim Umbau still verschwunden.
  ja(!d.einstieg.ok, 'DER EINSTIEG #wappen IST NICHT ZU TREFFEN — das Tor laesst sich von aussen nicht neu aufziehen',
     d.einstieg.statt || '')
  ja(d.zuKlein.length === 0, `KEIN TREFFBARES ZIEL UNTER 9 mm (${d.treffbar.length} Ziele)`, d.zuKlein.join(', '))
  ja(d.ueberDenRand.length === 0, 'UND KEINES RAGT UEBER DEN 800x480-SCHIRM', d.ueberDenRand.join(', '))
  ja(!!d.eng && d.eng.d >= ABSTAND_PX, 'KEIN PAAR UNTER 2 mm',
     d.eng ? `engstes ${mm(d.eng.d)} mm zwischen ${d.eng.a} und ${d.eng.b}` : '—')
  // UND DIE ZAHL, DIE DAS ENGSTE PAAR NICHT SIEHT: Ein Ziffernfeld, das unter
  // das Kissen geraet, verliert seine bedeckten Tasten AUS der Liste der
  // treffbaren — der engste Abstand wird dadurch scheinbar groesser. Gemessen
  // ohne die Reserve am Tor: „0" faellt auf 4,06 mm, „Letzte Ziffer loeschen"
  // auf 5,18 mm, und `#mp-zurueck` ueberlappt die Loeschtaste mit 0,00 mm.
  ja(d.kissenDeckt.length === 0, 'UND DAS KISSEN DECKT KEINE TASTE DES TORS',
     d.kissenDeckt.map((k) => `${k.n} (${k.px} px)`).join(', '))

  // ══ 4. ES SPIELT NICHTS — die Reserve muss mitgehen ══════════════════════
  //
  // DIESER FALL IST BEIM BAUEN ZUERST VERGESSEN WORDEN und steht deshalb als
  // eigene Aussage da: Ohne Wiedergabe ist `#mp` `hidden`. Bliebe die Reserve
  // von 84 bzw. 94 px stehen, saehe man einen leeren Streifen unter der Karte
  // und ein Tor, das sichtbar zu hoch steht.
  console.log('\n── ES SPIELT NICHTS ────────────────────────────────────────')
  // DER UEBERGANG WIRD GEFAHREN, NICHT GESTELLT — und auch das ist an der
  // Rotprobe aufgefallen: Wer die Seite gleich mit „still" laedt, hat den
  // Merker `kissen-da` nie gesetzt, und dann haelt die Aussage darunter auch
  // ohne die Zeile, die sie bewachen soll. Also erst mit laufendem Stueck
  // hinein (Merker steht), dann die Wiedergabe enden lassen — das ist auch
  // die Lage, die es an der Box wirklich gibt: das Kind hoert auf, waehrend
  // ein Erwachsener in den Einstellungen steht.
  await stand('voll')
  await stand('sperre-aus')
  await laden()
  await hinein()
  const vorherMerker = await ev(`document.body.classList.contains('kissen-da')`)
  ja(vorherMerker === true, 'vor dem Uebergang steht der Merker (sonst prueft dieser Abschnitt nichts)')
  await stand('still')
  // Der Takt von `mpMalen` kommt aus zwei Uhren (1000 ms /local, 2000 ms
  // /state) — zwei volle Runden abwarten, sonst misst man die alte Antwort.
  await warte(3000)
  d = await lage()
  ja(!d.offen.mp, 'das Kissen ist weg (nichts spielt)')
  ja(!d.klassen.includes('kissen-da'), 'DER MERKER body.kissen-da IST WEG', `Klassen: ${d.klassen.join(' ') || '—'}`)
  ja(!!d.fach && !!d.eltern && d.eltern.u - d.fach.u <= 12,
     'DIE KARTE REICHT WIEDER BIS UNTEN — kein reservierter Platz fuer etwas, das nicht da ist',
     d.fach && d.eltern ? `Karte endet bei y ${d.fach.u}, der Bereich bei ${d.eltern.u}` : '—')
  ja(!!d.spalte && !d.spalte.rollt, 'die Faecherspalte rollt auch dann nicht')
  ja(d.zuKlein.length === 0, `KEIN TREFFBARES ZIEL UNTER 9 mm (${d.treffbar.length} Ziele)`, d.zuKlein.join(', '))

  // ══ 5. VORHER GEROLLT — faehrt die Leiste trotzdem aus? ══════════════════
  //
  // DER WEG, DEN EIN FINGER NIMMT: rollen, dann sofort aufs Zahnrad halten.
  // Ohne `platzBeimBlaettern.zeigen()` in `eltern.auf()` bleibt `platz-machen`
  // stehen, und der freigegebene 88-px-Streifen zeigt dann nicht die
  // Kategorien, sondern die BUEHNE mit spielbaren Kacheln.
  console.log('\n── VORHER GEROLLT, DANN HINEIN ─────────────────────────────')
  await stand('voll')
  await stand('sperre-pin')
  await laden()
  /* ── IM AUGENBLICK DES OEFFNENS GEMESSEN, NICHT DANACH ────────────────────
   *
   * DER ERSTE ANLAUF DIESES ABSCHNITTS WAR EINE ATTRAPPE, und er ist genau
   * daran aufgefallen, dass die Rotprobe ihn nicht rot bekam: Gemessen wurde
   * `platz-machen` erst NACH dem 700-ms-Halten plus zweimal 900 ms Warten.
   * In dieser Zeit war laengst die Uhr von `platzBeimBlaettern` abgelaufen
   * (RUHE_BIS_ZURUECK_MS = 1400) und hatte die Leiste von selbst zurueckgeholt.
   * Der Abschnitt meldete also gruen, ganz gleich ob `eltern.auf()` sie
   * zurueckholt oder nicht — er mass die Uhr, nicht die Zeile.
   *
   * JETZT SIEHT EIN BEOBACHTER ZU. Er haelt fest, welche Klassen der Koerper
   * in dem Augenblick trug, in dem `#eltern` aufging. Und der Griff aufs
   * Zahnrad faengt SOFORT nach dem Rollen an, damit der ganze Vorgang in die
   * 1400 ms passt — sonst prueft die Messung wieder die Uhr. */
  await ev(`(() => {
    window.__beimOeffnen = null
    const e = document.getElementById('eltern')
    new MutationObserver(() => {
      if (!e.hidden && !window.__beimOeffnen) window.__beimOeffnen = [...document.body.classList]
    }).observe(e, { attributes: true, attributeFilter: ['hidden'] })
    const b = document.getElementById('buehne')
    if (b) { b.scrollTop = 120; b.dispatchEvent(new Event('scroll', { bubbles: true })) }
    return document.body.classList.contains('platz-machen') })()`)
  const eingefahren = await ev(`document.body.classList.contains('platz-machen')`)
  // HIER STAND EIN GRIFF ANS ZAHNRAD `#einst-knopf`. Es ist am 06.08.2026
  // ersatzlos entfallen; hinein fuehrt der Schriftzug `#wappen`. Dieser Weg
  // ist der TASTATURWEG und prueft das Halten NICHT — tools/admin-weg.mjs.
  // ER IST HIER SOGAR DER BESSERE: der Abschnitt muss in die 1400 ms von
  // `platzBeimBlaettern` passen, und ein 1200-ms-Halten passte nicht mehr.
  await adminAuf(ev, { warteMs: 250 })
  const beimOeffnen = await ev(`window.__beimOeffnen`)
  ja(eingefahren === true, 'die Leiste war vor dem Griff an den Einstieg WIRKLICH eingefahren (sonst prueft dieser Abschnitt nichts)')
  ja(Array.isArray(beimOeffnen), 'der Bereich ging in dieser Runde wirklich auf', String(beimOeffnen))
  ja(Array.isArray(beimOeffnen) && !beimOeffnen.includes('platz-machen'),
     'IM AUGENBLICK DES OEFFNENS IST SIE ZURUECKGEHOLT — kein 88-px-Streifen mit Kacheln waehrend der PIN-Eingabe',
     `Klassen beim Aufgehen: ${(beimOeffnen || []).join(' ') || '—'}`)
  await warte(900)
  d = await lage()
  // FRUEHER: „und die vier Kategorien stehen dort, nicht die Buehne" — beim
  // Seitenlayout der Nachweis, dass die zurueckgeholte Leiste auch WIRKLICH
  // die Leiste war. Im Vollbild deckt `#eltern` beides zu; was zaehlt, ist,
  // dass DER BEREICH dort steht und nicht ein 88-px-Streifen mit Kacheln.
  ja(d.eltern && d.eltern.l === 0 && d.eltern.b === 800,
     'und der Bereich deckt von x 0 an alles zu — kein Streifen mit Kacheln',
     d.eltern ? `${d.eltern.l},${d.eltern.o} ${d.eltern.b}x${d.eltern.h}` : '—')
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen()
  vorschau?.kill()
}

const schlecht = befunde.filter((b) => !b.gut)
console.log(`\n${befunde.length - schlecht.length} von ${befunde.length} Aussagen halten.`)
if (schlecht.length) {
  console.log('NICHT gehalten:')
  for (const b of schlecht) console.log(`  * ${b.wort}`)
}
process.exit(schlecht.length ? 1 : 0)
