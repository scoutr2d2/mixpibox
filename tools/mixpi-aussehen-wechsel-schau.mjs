#!/usr/bin/env node
/**
 * DAS AUSSEHEN BEIM PROFILWECHSEL — in BEIDE Richtungen (E72/T4).
 *
 * ══ WOZU ════════════════════════════════════════════════════════════════
 *
 * Gemeldet: „Kalea hell → Papa dunkel (klappt), zurück nicht". Entschieden
 * (Betreiber, 29.09.2026, E72/T3): Ein Profil OHNE eigenes Aussehen bekommt
 * beim Wechsel die Box-VORGABE — nicht das, was das vorige Profil am Schirm
 * stehen liess.
 *
 * ══ WARUM ES BEIDE RICHTUNGEN BRAUCHT ═══════════════════════════════════
 *
 * Der Hinweg klappte ja. Ein Zeuge, der nur „A hat hell → Schirm ist hell"
 * prueft, waere genau in der gemeldeten Lage gruen. Deshalb laeuft hier die
 * Kette Liam → Kalea → Liam → Kalea: darin steckt A → B → A UND B → A → B.
 * Liam (A) hat ein eigenes Aussehen, Kalea (B) keines.
 *
 * ══ UND WAS DER SERVER DANACH WEISS ═════════════════════════════════════
 *
 * Bis zum 30.09.2026 meldete jeder Seitenaufbau den SPIEGEL aus dem
 * localStorage an das gerade aktive Profil (`lichtStarten`/`farbeStarten`
 * riefen den meldenden Weg). Nach einem Wechsel schrieb die Box also das
 * Aussehen des vorigen Kindes als EIGENES in das neue — Festschreiben, genau
 * die Antwort, die der Betreiber in T3 NICHT gewaehlt hat. Und ein frischer
 * Browser ueberschrieb das eigene Aussehen des aktiven Kindes mit der
 * Vorgabe. Beides wird hier am Server nachgesehen (`eigen`), nicht nur am
 * Schirm.
 *
 * ══ EIGENE VORSCHAU, KEINE GELIEHENE ════════════════════════════════════
 *
 * Die Messung setzt ein Aussehen und wechselt Profile — beides bliebe in einer
 * geliehenen Vorschau stehen ([[vorschau-wird-geliehen]]).
 *
 * AUFRUF
 *     node tools/mixpi-aussehen-wechsel-schau.mjs
 *     node tools/mixpi-aussehen-wechsel-schau.mjs --pruefen
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { eigenerBrowser, freierPort } from './leihgabe.mjs'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PRUEFEN = process.argv.includes('--pruefen')

/** Liams eigenes Aussehen — bewusst NICHT die Vorgabe, sonst saehe man nichts. */
const EIGEN = { licht: 'hell', farbe: 'blau' }
/** Die Vorgabe der Box ohne box-weiten Stand: dunkel, Creme (= KEIN data-farbe). */
const VORGABE = { licht: 'dunkel', farbe: null }

let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}
const zeile = (name, wert) => console.log(`  ${String(name).padEnd(56)} ${wert}`)
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

const port = await freierPort()
const ZIEL = `http://127.0.0.1:${port}/neu/`
const kind = spawn(process.execPath, [path.join(WURZEL, 'tools', 'neu-vorschau.mjs'), '--port', String(port)], {
  cwd: WURZEL,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let vorschauAus = ''
kind.stdout.on('data', (d) => (vorschauAus += d))
kind.stderr.on('data', (d) => (vorschauAus += d))
const vorschauBeenden = () => {
  if (!kind.killed) kind.kill('SIGTERM')
}
process.on('exit', vorschauBeenden)
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { vorschauBeenden(); process.exit(130) })

let bereit = false
for (let i = 0; i < 60 && !bereit; i++) {
  try {
    bereit = (await fetch(ZIEL, { signal: AbortSignal.timeout(1000) })).ok
  } catch {
    /* noch nicht oben */
  }
  if (!bereit) await warte(250)
}
if (!bereit) {
  vorschauBeenden()
  console.error(`\nABBRUCH: die eigene Vorschau auf Port ${port} kam nicht hoch.\n${vorschauAus.slice(-600)}\n`)
  process.exit(2)
}

const api = async (pfad, verb = 'GET', rumpf) => {
  const a = await fetch(new URL(pfad, ZIEL), {
    method: verb,
    headers: rumpf ? { 'content-type': 'application/json' } : {},
    body: rumpf ? JSON.stringify(rumpf) : undefined,
  }).catch(() => null)
  return a ? await a.json().catch(() => null) : null
}

const brw = await eigenerBrowser({ fenster: '800,480' }).catch((e) => {
  vorschauBeenden()
  console.error(`  Browser kam nicht hoch — Messung nicht moeglich: ${e.message}`)
  process.exit(2)
})
if (!brw) {
  vorschauBeenden()
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

try {
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  /** Was am Schirm steht — gelesen am <html>, nicht im Speicher. */
  const schirm = () =>
    ev(`({ licht: document.documentElement.getAttribute('data-licht'),
           farbe: document.documentElement.getAttribute('data-farbe') })`)

  /**
   * Warten, bis die NEUE Seite steht UND ihr Aussehen geholt hat. Ein fester
   * Schlaf allein misst im Zweifel den Einzeiler von index.html (den Spiegel)
   * statt der Antwort des Servers — deshalb danach noch einmal lesen und
   * verlangen, dass es sich nicht mehr bewegt.
   */
  async function aufgebaut() {
    for (let i = 0; i < 40; i++) {
      const da = await ev(`!window.__mixpiVorher && document.readyState === 'complete'`).catch(() => false)
      if (da) break
      await warte(150)
    }
    await warte(2200)
    const a = await schirm()
    await warte(900)
    const b = await schirm()
    return JSON.stringify(a) === JSON.stringify(b) ? b : { ...b, unruhig: true }
  }

  /** Ueber den ECHTEN Weg wechseln: Zeichen oben links, Kachel antippen (werWaehlen, Neuladen). */
  async function wechseln(name) {
    await ev(`window.__mixpiVorher = 1`)
    await ev(`document.getElementById('ich').click()`)
    await warte(600)
    const getippt = await ev(`(() => {
      for (const k of document.querySelectorAll('#ich-leute .ich-kachel'))
        if (k.textContent.includes(${JSON.stringify(name)})) { k.click(); return true }
      return false })()`)
    if (!getippt) melde(`die Kachel „${name}" war nicht zu finden — der Wechsel fand nicht statt`)
    return aufgebaut()
  }

  const gleich = (ist, soll) => ist && ist.licht === soll.licht && ist.farbe === soll.farbe && !ist.unruhig
  const zeig = (x) => (x ? `licht=${x.licht} farbe=${x.farbe ?? 'creme'}${x.unruhig ? ' (unruhig)' : ''}` : 'nichts')

  /** Ein Schritt der Kette: wer ist dran, wie sieht es aus, was weiss der Server? */
  async function schritt(titel, ist, soll, wer) {
    const stand = await api('/api/profile')
    if (stand?.aktiv !== wer) melde(`${titel}: aktiv ist „${stand?.aktiv}", erwartet „${wer}"`)
    const ok = gleich(ist, soll)
    zeile(titel, ok ? `ja (${zeig(ist)})` : `NEIN (${zeig(ist)}, erwartet ${zeig(soll)})`)
    if (!ok) melde(`${titel}: am Schirm ${zeig(ist)}, erwartet ${zeig(soll)}`)
    const aus = await api('/api/profil/aussehen')
    if (wer === 'kalea' && aus?.eigen !== false) {
      melde(`${titel}: Kalea hat jetzt ein EIGENES Aussehen (${aus?.licht}/${aus?.farbe}) — die Box hat den Spiegel festgeschrieben`)
    }
    if (wer === 'liam' && (aus?.licht !== EIGEN.licht || aus?.farbe !== EIGEN.farbe)) {
      melde(`${titel}: Liams eigenes Aussehen am Server ist jetzt ${aus?.licht}/${aus?.farbe} — ueberschrieben`)
    }
  }

  // ── AUSGANGSLAGE: Liam ist dran und hat ein EIGENES Aussehen ─────────────
  //
  // Gesetzt ueber denselben Rumpf, den der Licht-Schalter und der
  // Farbsatz-Waehler schicken (`aussehenMelden`). Der Eltern-Bereich selbst
  // laesst sich nicht fernsteuern ([[eltern-bereich-fernsteuern-geht-nicht]]).
  // Liam ist die Vorgabe einer frischen Vorschau (`lage.profil`); Schritt 0
  // prueft es nach, statt es hier umzustellen.
  const gesetzt = await api('/api/profil/aussehen', 'POST', EIGEN)
  if (!gesetzt?.ok) melde('Liams Aussehen liess sich nicht setzen — die Kette misst dann nichts')

  // Ein FRISCHER Browser: kein Spiegel, keine Sitzung.
  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await schritt('0. frischer Browser, Liam (eigen): sein Aussehen', await aufgebaut(), EIGEN, 'liam')

  // ── A → B → A ─────────────────────────────────────────────────────────────
  await schritt('1. Liam → Kalea (ohne eigenes): die Vorgabe', await wechseln('Kalea'), VORGABE, 'kalea')
  await schritt('2. Kalea → Liam: wieder sein eigenes', await wechseln('Liam'), EIGEN, 'liam')
  // ── … → B → A → B ─────────────────────────────────────────────────────────
  await schritt('3. Liam → Kalea, zweites Mal: wieder die Vorgabe', await wechseln('Kalea'), VORGABE, 'kalea')

  // ── NEULADEN OHNE WECHSEL laesst den Spiegel stehen ───────────────────────
  //
  // Daran haengen die Messwerkzeuge, die hell/dunkel per localStorage stellen
  // (eltern-muster-schau, farbsatz-am-schirm, …). Und der Server darf davon
  // nichts erfahren: ein Neuladen ist keine Wahl.
  await ev(`localStorage.setItem('mupibox_neu_licht_v1', 'hell'); window.__mixpiVorher = 1; location.reload()`)
  await schritt('4. Kalea, Spiegel von Hand auf hell, Neuladen: bleibt', await aufgebaut(), { licht: 'hell', farbe: null }, 'kalea')

  // ── KALTSTART NACH EINEM WECHSEL VON AUSSEN ───────────────────────────────
  //
  // Die Handy-App schaltet um, waehrend der Kiosk aus ist: der Spiegel gehoert
  // dann einem anderen Kind als dem, mit dem die Box aufwacht.
  await wechseln('Liam')
  await api('/api/profil/aktiv', 'POST', { kennung: 'kalea' })
  await ev(`sessionStorage.clear()`)
  await send(ws, 'Page.navigate', { url: `${ZIEL}?kalt=${Date.now()}` })
  await schritt('5. Kaltstart als Kalea mit Liams Spiegel: die Vorgabe', await aufgebaut(), VORGABE, 'kalea')

  console.log(fehler ? `\n  ${fehler} Abweichung(en)` : '\n  ohne Abweichung')
} finally {
  await brw.schliessen()
  vorschauBeenden()
}

process.exit(PRUEFEN && fehler ? 1 : 0)
