#!/usr/bin/env node
/**
 * WAS DIE BOX BEIM EINSCHALTEN TUT — fragen, weitermachen, oder ans Schloss.
 *
 * ══ WOZU ════════════════════════════════════════════════════════════════
 *
 * Betreiber, 20.09.2026: „ich moechte eine moeglichkeit vom jetzigen modus
 * auf den letztes profil startet automatisch, falls kein passwort
 * eingestellt ist komplett, ansonsten in die passwort abfrage."
 *
 * Drei Verhalten, die sich nur im Browser zeigen — im Modell steht nur eine
 * Zeichenkette:
 *
 *   fragen                      -> „Wer hoert?"
 *   letztes, ohne Passwort      -> gar kein Fenster, die Box ist einfach da
 *   letztes, mit Passwort       -> das Schloss DIESES Profils, nicht „Wer hoert?"
 *
 * ══ UND DIE ECKE, DIE DABEI ZUGEHT ══════════════════════════════════════
 *
 * `POST /api/profil/aktiv` prueft Passwoerter nur bei einem ECHTEN Wechsel.
 * Wer im „Wer hoert?"-Fenster sein EIGENES, schon aktives Profil antippte,
 * kam ohne Passwort hinein — an dem Fenster vorbei, das nach einem Kaltstart
 * genau davor steht. Das stand als offener Rest an E39 im Code und wird hier
 * mitgemessen.
 *
 * ══ EIGENE VORSCHAU, KEINE GELIEHENE ════════════════════════════════════
 *
 * Diese Messung setzt ein PASSWORT und schaltet den Gast ab. Beides bliebe
 * in einer geliehenen Vorschau stehen und traefe den naechsten Lauf
 * ([[vorschau-wird-geliehen]]). Sie startet deshalb ihre eigene auf einem
 * freien Port — wie tools/vorschau-routen-deckung.mjs.
 *
 * ══ KALTSTART HEISST: KEINE SITZUNGS-MARKE ══════════════════════════════
 *
 * Die Oberflaeche unterscheidet den Kaltstart vom gewoehnlichen Neuladen an
 * `sessionStorage`. Ohne Loeschen dieser Marke misst man den zweiten Fall
 * und haelt ihn fuer den ersten.
 *
 * AUFRUF
 *     node tools/start-modus-schau.mjs
 *     node tools/start-modus-schau.mjs --pruefen
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { eigenerBrowser } from './leihgabe.mjs'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PRUEFEN = process.argv.includes('--pruefen')
const PASSWORT = '2468'

let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}
const zeile = (name, wert) => console.log(`  ${String(name).padEnd(52)} ${wert}`)
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

const port = await new Promise((fertig) => {
  const s = net.createServer()
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port
    s.close(() => fertig(p))
  })
})
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
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(ZIEL, { signal: AbortSignal.timeout(1000) })).ok) { bereit = true; break }
  } catch {
    /* noch nicht oben */
  }
  await warte(250)
}
if (!bereit) {
  vorschauBeenden()
  console.error(`\nABBRUCH: die eigene Vorschau auf Port ${port} kam nicht hoch.\n${vorschauAus.slice(-600)}\n`)
  process.exit(2)
}

const holen = async (pfad) => {
  const a = await fetch(new URL(pfad, ZIEL)).catch(() => null)
  return a ? await a.json().catch(() => null) : null
}
const lage = (w) => holen(`/vorschau/${w}`)

const brw = await eigenerBrowser({ fenster: '800,480' }).catch(async (e) => {
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
  await warte(1200)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  /** Ein KALTSTART: Sitzungs-Marke weg, dann frisch laden. */
  async function kaltstart() {
    await ev(`(() => { try { sessionStorage.clear() } catch (e) {} return 1 })()`)
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2600)
    // Und gleich nach dem Laden nochmal leeren reicht NICHT — die Seite
    // liest sie beim Aufbau. Deshalb steht das Loeschen davor.
  }

  /** Was steht gerade auf dem Schirm? */
  const fenster = () =>
    ev(`(() => {
      const s = document.getElementById('anmelde-schicht')
      if (!s) return 'nichts'
      const frage = (s.querySelector('.anmelde-frage') || {}).textContent || ''
      const eingabe = !!document.querySelector('.pw-blatt, .pw-schicht, [data-pw]')
      return (frage.startsWith('Wer h') ? 'wer-hoert' : 'schloss') + (eingabe ? '+eingabe' : '')
    })()`)

  // ── VORBEDINGUNG: der Gast muss ab sein, sonst gibt es keinen Kaltstart ──
  await lage('gast-aus')
  const stand = await holen('/api/profile')
  if (stand?.gastAktiv !== false) {
    melde('die Vorschau meldet weiter gastAktiv !== false — ohne das zeigt die Oberflaeche nie ein Anmeldefenster')
  }
  zeile('Vorbedingung: der Gast ist abgeschaltet', stand?.gastAktiv === false ? 'ja' : 'NEIN')

  // ── 1. fragen (der Bestand) ──────────────────────────────────────────────
  await lage('start-fragen')
  await kaltstart()
  const f1 = await fenster()
  zeile('Modus „fragen": es kommt „Wer hoert?"', f1.startsWith('wer-hoert') ? 'ja' : `NEIN (${f1})`)
  if (!f1.startsWith('wer-hoert')) melde(`im Modus „fragen" stand nicht die Profilauswahl da, sondern: ${f1}`)

  // ── 2. letztes, ohne Passwort ────────────────────────────────────────────
  await lage('start-letztes')
  await kaltstart()
  const f2 = await fenster()
  zeile('Modus „letztes" ohne Passwort: gar kein Fenster', f2 === 'nichts' ? 'ja' : `NEIN (${f2})`)
  if (f2 !== 'nichts') melde(`ohne Passwort sollte die Box einfach da sein, stattdessen: ${f2}`)

  // ── 3. letztes, MIT Passwort ─────────────────────────────────────────────
  //
  // Das Passwort wird ueber den echten Weg gesetzt (POST /api/profil/passwort
  // gilt dem AKTIVEN Profil) — nicht in die Attrappe hineingeschrieben.
  const gesetzt = await fetch(new URL('/api/profil/passwort', ZIEL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ art: 'zahlen', neu: PASSWORT }),
  }).catch(() => null)
  const jetztGeschuetzt = (await holen('/api/profile'))?.profile?.find((p) => p.kennung !== 'gast')?.geschuetzt
  if (!gesetzt?.ok || !jetztGeschuetzt) {
    melde('das Probe-Passwort liess sich nicht setzen — die Schloss-Messungen fallen aus, statt gruen zu tun')
  } else {
    await kaltstart()
    const f3 = await fenster()
    zeile('Modus „letztes" MIT Passwort: das Schloss, nicht die Auswahl', f3.startsWith('schloss') ? 'ja' : `NEIN (${f3})`)
    if (!f3.startsWith('schloss')) melde(`mit Passwort gehoert die Passwortfrage auf den Schirm, stattdessen: ${f3}`)

    // ── 4. DER AUSWEG ─────────────────────────────────────────────────────
    //
    // Ohne ihn waere die Box in diesem Modus fuer jeden anderen unbenutzbar.
    const ausweg = await ev(`(() => { const b = document.querySelector('.anmelde-andere'); if (!b) return 'kein Knopf'; b.click(); return 'ok' })()`)
    await warte(700)
    const f4 = await fenster()
    zeile('„Ich bin jemand anderes" fuehrt zur Auswahl', ausweg === 'ok' && f4.startsWith('wer-hoert') ? 'ja' : `NEIN (${ausweg}/${f4})`)
    if (ausweg !== 'ok' || !f4.startsWith('wer-hoert')) {
      melde('aus dem Schloss fuehrt kein Weg zurueck zur Profilauswahl — ein Geschwisterkind haengt fest')
    }

    // ── 5. DIE ECKE AUS E39 ───────────────────────────────────────────────
    //
    // Das EIGENE, schon aktive Profil antippen. Bis zum 20.09.2026 ging das
    // ohne Passwort. Jetzt muss das Schloss kommen.
    const getippt = await ev(`(() => {
      const s = document.getElementById('anmelde-schicht'); if (!s) return 'kein Fenster'
      const k = s.querySelector('.anmelde-reihe > *'); if (!k) return 'keine Kachel'
      k.click(); return 'ok' })()`)
    await warte(900)
    const f5 = await fenster()
    zeile('das EIGENE geschuetzte Profil fragt jetzt auch', getippt === 'ok' && f5.startsWith('schloss') ? 'ja' : `NEIN (${getippt}/${f5})`)
    if (getippt !== 'ok' || !f5.startsWith('schloss')) {
      melde(`die eigene Kachel kam ohne Passwort durch — die Ecke aus E39 steht offen (${getippt}/${f5})`)
    }
  }

  console.log(fehler ? `\n  ${fehler} Abweichung(en)` : '\n  ohne Abweichung')
} finally {
  await brw.schliessen()
  vorschauBeenden()
}

process.exit(PRUEFEN && fehler ? 1 : 0)
