#!/usr/bin/env node
/**
 * ZEIGT DIE PLAKETTE AM PLAYER-COVER, WELCHE QUELLE GERADE SPIELT? (E108)
 *
 * Betreiber (31.08.2026): „ich häte gerne auch ein indikator im player oder
 * coverbild welche quelle gerade spielt." Gebaut als `#gr-quelle` am Cover
 * des grossen Players (index.html), gefuellt von `quelleSetzen()` aus
 * `laufendeQuelle()` (app.js) — drei Stufen: `titel[].quelle` der laufenden
 * Folgenliste, dann Spotify-Wiedergabe, dann der `currentType`-Rueckfall.
 *
 * ══ DIE DREI MESSUNGEN, UND WARUM GENAU DIESE ═════════════════════════════
 *
 *   1. SPOTIFY-LAGE ohne jeden Tipp -> `marke-spotify`. Das ist Stufe 2 der
 *      Logik (np.art), die auch fuer FREMDE Spotify-Wiedergabe gilt.
 *   2. ARD-SENDUNG spielen (derselbe Weg wie in
 *      tools/marke-titelwechsel-je-dienst.mjs, Fall 4) -> `marke-ard` aus
 *      `laufendeFolgen[nr-1].quelle` — der /api/spielen-Stub stempelt seit
 *      E108 je Titel die Quelle, wie der echte Server. Danach rueckt
 *      `/vorschau/mpv-weiter` die Warteschlange vor: die Plakette muss
 *      SITZEN BLEIBEN (sie wird je Titel nachgeschlagen, nicht eingefroren).
 *   3. GEGENPROBE `mpv-fremd`: eine fremde mpv-Warteschlange, deren Werk die
 *      Oberflaeche nicht zuordnen kann und deren Attrappe kein `currentType`
 *      meldet -> die Plakette VERSCHWINDET. Ohne diesen Fall bliebe offen,
 *      ob sie bei Unwissen raet.
 *
 * WAS DIESE VORSCHAU NICHT KANN (ehrlich): den `currentType`-Rueckfall
 * (Stufe 3) misst hier niemand — die /player/local-Attrappe fuehrt das Feld
 * nicht. Am Geraet liefert der Abspieldienst es immer; der Rueckfall ist
 * Code-gedeckt (laufendeQuelle, QUELLE_JE_TYP inkl. 'datei' -> lokal).
 *
 * AENDERT NICHTS AN DER BOX: eigener headless-Browser gegen die Vorschau,
 * die geliehene Lage geht im `finally` zurueck (tools/leihgabe.mjs).
 *
 * AUFRUF
 *     node tools/quellen-plakette-schau.mjs
 *     node tools/quellen-plakette-schau.mjs --pruefen   # Ende 1 bei Abweichung
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')

const warte = (ms) => new Promise((r) => setTimeout(r, ms))
const stellen = (was) => fetch(new URL(`/vorschau/${was}`, ZIEL)).then((r) => r.json())

let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}
const zeile = (n, w) => console.log(`  ${String(n).padEnd(44)} ${w}`)

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

try {
  await warte(1200)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  // JE FALL EIN FRISCHER SEITENAUFBAU (wie in der Vorlage-Wache): der
  // Browser startet auf about:blank, und `laufendeFolgen` ist
  // Sitzungsgedaechtnis — ohne Navigation truege Messung 2 das Gedaechtnis
  // von Messung 1.
  const neuLaden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2500)
  }

  // GEMESSEN WIRD DAS ELEMENT, NICHT DIE HUELLE: `anzeigeMalen` fuellt alle
  // Anzeigeorte auch verdeckt (der Kommentar dort erklaert, warum) — die
  // Plakette ist also messbar, ohne den grossen Player zu oeffnen.
  const plakette = () =>
    ev(`(() => {
      const q = document.getElementById('gr-quelle')
      if (!q) return null
      return { da: !q.hidden, dienst: q.dataset.dienst || '', klasse: q.className, wort: q.getAttribute('aria-label') || '' }
    })()`)

  const tippeRaster = (titel) =>
    ev(`(() => {
      const k = [...document.querySelectorAll('#raster > .kachel')]
        .find((e) => ((e.querySelector('.kachel-titel') || {}).textContent || '') === ${JSON.stringify(titel)})
      if (!k) return false
      k.click()
      return true
    })()`)

  // ── 1. SPOTIFY-LAGE: die Plakette ohne jeden Tipp ────────────────────────
  // `spotify` ist die Stellschraube fuer „Spotify spielt" — `spielt` waere
  // die mpv-Lage (MixPi singt) und misst hier nichts.
  for (const l of ['voll', 'mpv-eigen', 'kontext-standard', 'spotify']) await stellen(l)
  await neuLaden()
  await warte(2000)
  const s = await plakette()
  zeile('Spotify-Lage: Plakette', s ? `${s.da ? 'da' : 'VERSTECKT'} — ${s.dienst || '—'} (${s.wort})` : 'FEHLT IM DOM')
  if (!s) melde('kein #gr-quelle im grossen Player — die Plakette wurde nie gebaut')
  else if (!s.da || s.dienst !== 'spotify' || !s.klasse.includes('marke-spotify'))
    melde(`Spotify-Wiedergabe traegt nicht marke-spotify (da=${s?.da}, dienst=${s?.dienst})`)

  // ── 2. ARD-SENDUNG: quelle je Titel aus laufendeFolgen ───────────────────
  for (const l of ['voll', 'spielt', 'mpv-eigen', 'kontext-standard', 'mpv-erste']) await stellen(l)
  await neuLaden()
  if (!(await tippeRaster('MausHörspiel kurz'))) {
    if (await tippeRaster('Die Maus')) {
      await warte(900)
      await tippeRaster('MausHörspiel kurz')
    }
  }
  await warte(2000)
  const auf = await ev(`document.querySelectorAll('#raster > .lane .lane-kachel.stueck').length`)
  if (!auf) melde('die Folgen-Lane der Maus-Sendung ist nicht aufgegangen — Messung 2 ohne Grundlage')
  else {
    await ev(`document.querySelector('#raster > .lane .lane-kachel.stueck').click()`)
    await warte(3000)
    const a = await plakette()
    zeile('ARD gestartet: Plakette', a ? `${a.da ? 'da' : 'VERSTECKT'} — ${a.dienst || '—'}` : 'FEHLT IM DOM')
    if (!a || !a.da || a.dienst !== 'ard' || !a.klasse.includes('marke-ard'))
      melde(`ARD-Folge traegt nicht marke-ard (da=${a?.da}, dienst=${a?.dienst})`)
    await stellen('mpv-weiter')
    await warte(2500)
    const b = await plakette()
    zeile('nach mpv-weiter: Plakette', b ? `${b.da ? 'da' : 'VERSTECKT'} — ${b.dienst || '—'}` : 'FEHLT IM DOM')
    if (!b || !b.da || b.dienst !== 'ard')
      melde(`nach dem Titelwechsel verliert die Plakette die Quelle (da=${b?.da}, dienst=${b?.dienst})`)
  }

  // ── 3. GEGENPROBE: fremde mpv-Warteschlange -> kein Raten ────────────────
  await stellen('mpv-fremd')
  await warte(2500)
  const f = await plakette()
  zeile('mpv-fremd: Plakette', f ? `${f.da ? 'DA' : 'versteckt'} — ${f.dienst || '—'}` : 'FEHLT IM DOM')
  if (!f) melde('kein #gr-quelle im DOM (Gegenprobe)')
  else if (f.da)
    melde(`bei unbekannter Wiedergabe raet die Plakette (${f.dienst}) statt zu verschwinden`)

  console.log(fehler ? `\n  ${fehler} Abweichung(en).` : '\n  Die Plakette sagt an allen drei Stellen die Wahrheit.')
} finally {
  await brw.schliessen().catch(() => {})
  await leihe.zurueckgeben()
}
if (PRUEFEN && fehler) process.exit(1)
