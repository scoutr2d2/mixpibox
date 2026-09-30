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
 * Das alles gilt nur OHNE Gast. MIT Gast (die Vorgabe jeder Box) gilt seit
 * E143/5 (Betreiber 29.09.2026, Weg a „nur das Schloss") — unabhaengig vom
 * Start-Modus, deshalb hier mit `fragen` gemessen:
 *
 *   Gast an, Profil mit Passwort   -> sein Schloss; „Ich bin jemand anderes"
 *                                     fuehrt zu „Wer hoert?" SAMT Gast-Kachel
 *   Gast an, Profil ohne Passwort  -> gar kein Fenster, wie bisher
 *   Gast an, Neuladen              -> kein Schloss mehr (die Marke haelt) —
 *                                     nach dem Aufschliessen UND nach einem
 *                                     wortlosen Start, dessen Profil erst
 *                                     spaeter ein Schloss bekommt
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
// SO, WIE DAS ZAHLENFELD ES SCHICKT: `n:` vor den Ziffern (passwortEingabe).
// Nur dann oeffnet das Tippen am Schloss (Fall 8), was hier gesetzt wurde.
const PASSWORT = 'n:2468'

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

  /**
   * MIT DEM FINGER TIPPEN, nicht per `element.click()` (30.09.2026).
   *
   * Bis dahin klickte dieses Werkzeug per JavaScript — und uebersah, dass die
   * Passwortfrage UNTER dem Anmeldefenster lag (z-index 11 gegen 60):
   * `click()` erreicht auch eine verdeckte Taste, ein Kind nicht. Alle
   * Schloss-Faelle waren gruen, und kein geschuetztes Profil kam nach einem
   * Kaltstart hinein. Jetzt wird die MITTE des Ziels gerechnet und dort ein
   * echtes Zeigerereignis abgesetzt — was obenauf liegt, bekommt es.
   */
  async function tippe(ziel) {
    const p = await ev(`(() => { const e = ${ziel}; if (!e) return null
      const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    if (!p) return 'kein Ziel'
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send(ws, 'Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 })
    }
    await warte(120)
    return 'ok'
  }
  /** Liegt das Ziel OBENAUF? Sonst traefe ein Finger etwas anderes. */
  const obenauf = (ziel) =>
    ev(`(() => { const e = ${ziel}; if (!e) return 'kein Ziel'
      const r = e.getBoundingClientRect(); const o = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return o && (o === e || e.contains(o)) ? 'ja' : 'verdeckt von ' + (o ? o.id || o.className : 'nichts') })()`)
  const taste = (z) =>
    `[...document.querySelectorAll('.pw-feld.pw-zahlen .pw-taste')].find((x) => x.textContent.trim() === ${JSON.stringify(z)})`
  const pwKnopf = (wort) => `[...document.querySelectorAll('.pw-schicht button')].find((k) => k.textContent.trim() === ${JSON.stringify(wort)})`
  const AUSWEG = `document.querySelector('.anmelde-andere')`
  const kachelVon = (name) =>
    `[...document.querySelectorAll('#anmelde-schicht .anmelde-reihe > *')].find((k) => k.textContent.includes(${JSON.stringify(name)}))`

  /** Das Zahlen-Passwort eintippen und bestaetigen — Taste fuer Taste, mit dem Finger. */
  async function eintippen() {
    for (const z of PASSWORT.slice(2)) {
      if ((await tippe(taste(z))) !== 'ok') return `Taste ${z} fehlt`
    }
    return tippe(pwKnopf('Fertig'))
  }

  /** Schloss mit Frage: Tasten obenauf, Abbrechen zurueck aufs Schloss, dann der Ausweg. */
  async function schlossPruefen(titel) {
    const t = await obenauf(taste('1'))
    zeile(`${titel}: die Tasten liegen obenauf`, t === 'ja' ? 'ja' : `NEIN (${t})`)
    if (t !== 'ja') melde(`${titel}: die Passwortfrage ist nicht zu treffen — ${t}`)
    await tippe(pwKnopf('Abbrechen'))
    await warte(400)
    const zurueck = await fenster()
    zeile(`${titel}: Abbrechen zeigt das Schloss mit Ausweg`, zurueck === 'schloss' ? 'ja' : `NEIN (${zurueck})`)
    if (zurueck !== 'schloss') melde(`${titel}: nach Abbrechen steht ${zurueck} statt des Schlosses`)
    // Wer sich vertippt hat und abbricht, fragt ueber die Kachel von vorn.
    await tippe(`document.querySelector('#anmelde-schicht .anmelde-reihe > *')`)
    await warte(400)
    const vorn = await fenster()
    zeile(`${titel}: die Kachel fragt von vorn`, vorn === 'schloss+eingabe' ? 'ja' : `NEIN (${vorn})`)
    if (vorn !== 'schloss+eingabe') melde(`${titel}: ein Tipp auf die Kachel oeffnet die Frage nicht (${vorn})`)
    await tippe(pwKnopf('Abbrechen'))
    await warte(400)
    const a = await obenauf(AUSWEG)
    if (a !== 'ja') melde(`${titel}: „Ich bin jemand anderes" ist nicht zu treffen — ${a}`)
    return tippe(AUSWEG)
  }

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
    const ausweg = await schlossPruefen('„letztes"')
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
    const getippt = await tippe(kachelVon('Liam'))
    await warte(900)
    const f5 = await fenster()
    zeile('das EIGENE geschuetzte Profil fragt jetzt auch', getippt === 'ok' && f5.startsWith('schloss') ? 'ja' : `NEIN (${getippt}/${f5})`)
    if (getippt !== 'ok' || !f5.startsWith('schloss')) {
      melde(`die eigene Kachel kam ohne Passwort durch — die Ecke aus E39 steht offen (${getippt}/${f5})`)
    }

    // ══ MIT GAST (E143/5, Weg a) ══════════════════════════════════════════
    //
    // Liam ist aktiv und hat das Probe-Passwort von oben. Der Start-Modus
    // steht auf `fragen` — die Vorgabe, und genau der Wert, mit dem Weg (b)
    // jede Box jeden Morgen fragen liesse. Hier darf er nichts ausrichten.
    await lage('gast-an')
    await lage('start-fragen')
    const gastStand = await holen('/api/profile')
    zeile('Vorbedingung: der Gast ist an', gastStand?.gastAktiv === true ? 'ja' : 'NEIN')
    if (gastStand?.gastAktiv !== true) melde('die Vorschau meldet den Gast nicht als an — die Gast-Faelle messen dann nichts')

    // ── 6. geschuetzt: das Schloss, nicht die Auswahl und nicht nichts ────
    await kaltstart()
    const f6 = await fenster()
    zeile('Gast an, Profil MIT Passwort: sein Schloss', f6.startsWith('schloss') ? 'ja' : `NEIN (${f6})`)
    if (!f6.startsWith('schloss')) melde(`mit Gast und Passwort gehoert das Schloss auf den Schirm, stattdessen: ${f6}`)

    // ── 7. der Ausweg fuehrt zur Auswahl SAMT Gast ────────────────────────
    const ausweg7 = await schlossPruefen('Gast an')
    await warte(700)
    const f7 = await fenster()
    const kacheln7 = await ev(`[...document.querySelectorAll('#anmelde-schicht .anmelde-reihe > *')].map((k) => k.textContent.trim())`)
    const mitGast = Array.isArray(kacheln7) && kacheln7.includes('Gast')
    zeile('„Ich bin jemand anderes": „Wer hoert?" samt Gast', ausweg7 === 'ok' && f7.startsWith('wer-hoert') && mitGast ? 'ja' : `NEIN (${ausweg7}/${f7}/${kacheln7})`)
    if (ausweg7 !== 'ok' || !f7.startsWith('wer-hoert') || !mitGast) {
      melde(`aus dem Schloss fuehrt kein Weg zu „Wer hoert?" mit Gast-Kachel (${ausweg7}/${f7}/${kacheln7})`)
    }

    // ── 8. aufschliessen, dann NEULADEN: kein zweites Schloss ─────────────
    await kaltstart()
    const getippt8 = await eintippen()
    await warte(1200)
    const f8a = await fenster()
    zeile('Gast an, mit dem Finger aufgeschlossen: das Fenster ist weg', getippt8 === 'ok' && f8a === 'nichts' ? 'ja' : `NEIN (${getippt8}/${f8a})`)
    if (getippt8 !== 'ok' || f8a !== 'nichts') melde(`nach dem richtigen Passwort steht noch: ${getippt8}/${f8a}`)
    await send(ws, 'Page.reload')
    await warte(2600)
    const f8 = await fenster()
    zeile('Gast an, Neuladen nach dem Aufschliessen: kein Schloss', f8 === 'nichts' ? 'ja' : `NEIN (${f8})`)
    if (f8 !== 'nichts') melde(`ein gewoehnliches Neuladen zeigte wieder: ${f8} — es haelt sich fuer einen Kaltstart`)

    // ── 9. ungeschuetzt: wortlos wie bisher ───────────────────────────────
    const kalea = await fetch(new URL('/api/profil/aktiv', ZIEL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kennung: 'kalea' }),
    }).catch(() => null)
    if (!kalea?.ok) melde('der Wechsel auf Kalea (ohne Passwort) misslang — Fall 9 bis 11 messen nichts')
    await kaltstart()
    const f9 = await fenster()
    zeile('Gast an, Profil OHNE Passwort: gar kein Fenster', f9 === 'nichts' ? 'ja' : `NEIN (${f9})`)
    if (f9 !== 'nichts') melde(`ein ungeschuetztes Profil mit Gast startet wortlos, stattdessen: ${f9}`)

    // ── 10. Schloss kommt SPAETER dazu, dann Neuladen: nicht fragen ───────
    //
    // Der wortlose Start setzt die Marke. Ohne sie hielte das naechste
    // Neuladen (eine Auslieferung, ein Schloss, das Kalea eben gesetzt hat)
    // sich fuer einen Kaltstart.
    const kaleaPw = await fetch(new URL('/api/profil/passwort', ZIEL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ art: 'zahlen', neu: PASSWORT }),
    }).catch(() => null)
    if (!kaleaPw?.ok) melde('Kaleas Passwort liess sich nicht setzen — Fall 10 und 11 messen nichts')
    await send(ws, 'Page.reload')
    await warte(2600)
    const f10 = await fenster()
    zeile('Gast an, Schloss spaeter gesetzt, Neuladen: kein Schloss', f10 === 'nichts' ? 'ja' : `NEIN (${f10})`)
    if (f10 !== 'nichts') melde(`nach einem wortlosen Start fragte ein Neuladen: ${f10}`)

    // ── 11. DAS GESCHWISTERKIND MIT EIGENEM SCHLOSS ───────────────────────
    //
    // Kaleas Schloss steht, Liam geht ueber den Ausweg und tippt SEINE
    // Kachel — die Frage kommt aus `werWaehlen`, nicht aus dem Start-Schloss.
    // Auch sie lag seit E39 unter „Wer hoert?".
    await kaltstart()
    await schlossPruefen('Kalea')
    await warte(700)
    await tippe(kachelVon('Liam'))
    await warte(700)
    const t11 = await obenauf(taste('1'))
    zeile('„Wer hoert?" → Liam: seine Tasten liegen obenauf', t11 === 'ja' ? 'ja' : `NEIN (${t11})`)
    if (t11 !== 'ja') melde(`die Passwortfrage aus „Wer hoert?" ist nicht zu treffen — ${t11}`)
    await eintippen()
    await warte(2800)
    const wer11 = (await holen('/api/profile'))?.aktiv
    const f11 = await fenster()
    zeile('… richtig getippt: Liam ist dran, kein Fenster', wer11 === 'liam' && f11 === 'nichts' ? 'ja' : `NEIN (${wer11}/${f11})`)
    if (wer11 !== 'liam' || f11 !== 'nichts') melde(`nach Liams Passwort: aktiv ${wer11}, am Schirm ${f11}`)
  }

  console.log(fehler ? `\n  ${fehler} Abweichung(en)` : '\n  ohne Abweichung')
} finally {
  await brw.schliessen()
  vorschauBeenden()
}

process.exit(PRUEFEN && fehler ? 1 : 0)
