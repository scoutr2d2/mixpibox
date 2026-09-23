/**
 * WAECHST DIE NEUE OBERFLAECHE, WENN SIE NUR DASTEHT? — Leck-Messung von aussen.
 *
 * WOZU ES DAS GIBT
 * ----------------
 * Am 05.09.2026, 13:37:29 hat der OOM-Killer auf der Box den Kiosk-Renderer
 * erschossen:
 *
 *     Out of memory: Killed process 1277 (WPEWebProcess)
 *     total-vm:76156752kB, anon-rss:1082672kB   (+ 19377 Seiten Swap = 310 MB)
 *
 * Der Prozess war zu dem Zeitpunkt 33 Minuten alt (Box-Start 13:04). 1,37 GB
 * in 33 Minuten sind rund 41 MB/min — das ist kein Anlaufverbrauch, das ist
 * ein Leck. Auf dem Schirm stand danach "renderer process crashed" mit einem
 * "Try again"-Knopf; `cog` selbst hat ueberlebt.
 *
 * WARUM VON AUSSEN UND NICHT AUF DER BOX
 * --------------------------------------
 * Um den Kiosk selbst zu messen, muesste man ihn neu laden — und wer den
 * Kiosk fuer einen Versuch anhaelt, riskiert eine Box ohne Tastatur an einem
 * schwarzen Schirm (Wissenspaket `cog-drm-kiosk-statt-chromium` nennt dafuer
 * eigens ein Sicherheitsnetz). Diese Probe fasst die Box NICHT an: sie ist
 * ein zweiter HTTP-Client wie jeder Browser im Haus und liest dieselbe Seite.
 *
 * DER PREIS DIESER ABKUERZUNG, offen gesagt: gemessen wird in Chromium
 * (Blink), die Box faehrt Cog/WPE (WebKit). Absolute Zahlen sind deshalb NICHT
 * uebertragbar. Was uebertraegt, ist die Frage "haelt die Seite Dinge fest,
 * die sie loslassen muesste" — ein Zaehler, der linear steigt, waehrend
 * niemand etwas anfasst, steigt in beiden Motoren.
 *
 * WAS GEMESSEN WIRD (CDP Performance.getMetrics, alle vier zusammen)
 * -----------------------------------------------------------------
 *   JSHeapUsedSize    JS-Objekte. Steigt bei festgehaltenen Daten.
 *   Nodes             DOM-Knoten. Steigt, wenn Erzeugtes nie entfernt wird.
 *   JSEventListeners  Hoerer. Steigt bei addEventListener ohne Gegenstueck
 *                     (in app.js stehen 137 addEventListener gegen 5 remove).
 *   Documents         Dokumente. Steigt bei Rahmen, die nicht sterben.
 *
 * Ein Leck zeigt sich fast nie in allen vieren — WELCHER Zaehler steigt, sagt,
 * wo zu suchen ist. Deshalb werden alle vier ausgewiesen und nicht summiert.
 *
 * AUFRUF
 * ------
 *     node tools/neu-oberflaeche-speicherprobe.mjs
 *     node tools/neu-oberflaeche-speicherprobe.mjs --box 192.168.178.62
 *     node tools/neu-oberflaeche-speicherprobe.mjs --minuten 15 --abstand 30
 *     node tools/neu-oberflaeche-speicherprobe.mjs --weg /neu/ --json
 *
 * Rein LESEND gegenueber der Box: die Probe laedt die Seite und ruehrt sie
 * nicht an. Sie tippt nichts, sie spielt nichts ab, sie stellt nichts um.
 */

import { createRequire } from 'node:module'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)

// ── Playwright und Chromium finden ─────────────────────────────────────────
// Beides liegt hier NICHT im Baum (kein Chromium installiert, siehe
// Wissenspaket: Admin-Tests loesen das Binary ueber einen Glob auf). Wer die
// Probe auf einem anderen Rechner faehrt, setzt die beiden Umgebungsvariablen.
const PLAYWRIGHT_ORTE = [
  process.env.PLAYWRIGHT_MODUL,
  '/home/achim/.hermes/hermes-agent/node_modules/playwright',
].filter(Boolean)

function playwrightLaden() {
  for (const ort of PLAYWRIGHT_ORTE) {
    try {
      return require(ort)
    } catch {
      /* naechster Ort */
    }
  }
  try {
    return require('playwright')
  } catch {
    return null
  }
}

function chromiumFinden() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN
  const wurzel = join(process.env.HOME || '', '.cache', 'ms-playwright')
  if (!existsSync(wurzel)) return null
  // Die hoechste Fassung gewinnt — ein Glob auf den Ordnernamen, weil die
  // Nummer bei jedem Playwright-Update wechselt.
  const kandidaten = readdirSync(wurzel)
    .filter((n) => n.startsWith('chromium-'))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const k of kandidaten) {
    for (const unter of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = join(wurzel, k, unter)
      if (existsSync(p)) return p
    }
  }
  return null
}

// ── Argumente ──────────────────────────────────────────────────────────────
function argumente(argv) {
  const a = { box: '192.168.178.62', weg: '/neu/', minuten: 8, abstand: 30, anlauf: 60, json: false }
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i]
    if (s === '--box') a.box = argv[++i]
    else if (s === '--weg') a.weg = argv[++i]
    else if (s === '--minuten') a.minuten = Number(argv[++i])
    else if (s === '--abstand') a.abstand = Number(argv[++i])
    else if (s === '--anlauf') a.anlauf = Number(argv[++i])
    else if (s === '--json') a.json = true
    else if (s === '--help' || s === '-h') a.hilfe = true
  }
  return a
}

const HILFE = [
  'Aufruf: node tools/neu-oberflaeche-speicherprobe.mjs [Optionen]',
  '',
  '  --box <adresse>   Box (Vorgabe 192.168.178.62)',
  '  --weg <pfad>      Seite (Vorgabe /neu/)',
  '  --minuten <n>     Messdauer (Vorgabe 8)',
  '  --abstand <s>     Sekunden je Probe (Vorgabe 30)',
  '  --anlauf <s>      Wartezeit vor der ERSTEN Probe (Vorgabe 60)',
  '  --json            Rohdaten statt Tabelle',
].join('\n')

// Steigung ueber alle Proben (kleinste Quadrate) — robuster als
// letzte-minus-erste, weil ein einzelner Ausreisser die Aussage sonst traegt.
function steigungJeMinute(punkte) {
  const n = punkte.length
  if (n < 2) return 0
  const mx = punkte.reduce((s, p) => s + p.t, 0) / n
  const my = punkte.reduce((s, p) => s + p.y, 0) / n
  let oben = 0
  let unten = 0
  for (const p of punkte) {
    oben += (p.t - mx) * (p.y - my)
    unten += (p.t - mx) ** 2
  }
  return unten === 0 ? 0 : (oben / unten) * 60
}

async function hauptlauf() {
  const arg = argumente(process.argv.slice(2))
  if (arg.hilfe) {
    console.log(HILFE)
    return 0
  }

  const pw = playwrightLaden()
  if (!pw) {
    console.error('Playwright nicht gefunden. PLAYWRIGHT_MODUL auf den Modulordner setzen.')
    return 2
  }
  const binary = chromiumFinden()
  if (!binary) {
    console.error('Kein Chromium gefunden. CHROME_BIN setzen.')
    return 2
  }

  const adresse = 'http://' + arg.box + ':8200' + arg.weg
  const proben = Math.max(2, Math.floor((arg.minuten * 60) / arg.abstand) + 1)

  if (!arg.json) {
    console.log('# ' + adresse)
    console.log('# ' + proben + ' Proben, alle ' + arg.abstand + ' s (' + arg.minuten + ' min)')
    console.log('# Chromium: ' + binary)
    console.log('')
  }

  const browser = await pw.chromium.launch({ executablePath: binary, headless: true })
  const messwerte = []
  try {
    const seite = await browser.newPage({ viewport: { width: 800, height: 480 } })
    const fehler = []
    seite.on('pageerror', (e) => fehler.push(String(e && e.message ? e.message : e)))
    seite.on('console', (m) => {
      if (m.type() === 'error') fehler.push('console: ' + m.text())
    })

    await seite.goto(adresse, { waitUntil: 'load', timeout: 60000 })
    const cdp = await seite.context().newCDPSession(seite)
    await cdp.send('Performance.enable')

    // DER ANLAUF SIEHT AUS WIE EIN ZUSTAND. Gemessen am 05.09.2026: in der
    // ersten Minute nach dem Laden gingen die Knoten 1008 -> 3160 -> 1710 ->
    // 1683 und die Dokumente 4 -> 1. Wer da schon misst, bekommt "+172
    // Knoten/min" gemeldet und meldet einen Anlauf als Leck. Erst warten,
    // dann messen — und die Wartezeit AUSWEISEN, damit ein spaeterer Leser
    // sieht, was aus der Rechnung herausgehalten wurde.
    if (arg.anlauf > 0) {
      if (!arg.json) console.log('  (Anlauf: ' + arg.anlauf + ' s werden verworfen)')
      await new Promise((r) => setTimeout(r, arg.anlauf * 1000))
    }

    const beginn = Date.now()
    for (let i = 0; i < proben; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, arg.abstand * 1000))
      const { metrics } = await cdp.send('Performance.getMetrics')
      const w = Object.fromEntries(metrics.map((m) => [m.name, m.value]))
      const punkt = {
        t: (Date.now() - beginn) / 1000,
        heapMB: (w.JSHeapUsedSize || 0) / 1048576,
        knoten: w.Nodes || 0,
        hoerer: w.JSEventListeners || 0,
        dokumente: w.Documents || 0,
      }
      messwerte.push(punkt)
      if (!arg.json) {
        console.log(
          '  [' +
            String(i + 1).padStart(2) +
            '/' +
            proben +
            ']  ' +
            String(Math.round(punkt.t)).padStart(4) +
            ' s   Heap ' +
            punkt.heapMB.toFixed(1).padStart(6) +
            ' MB   Knoten ' +
            String(punkt.knoten).padStart(6) +
            '   Hoerer ' +
            String(punkt.hoerer).padStart(6) +
            '   Dok ' +
            punkt.dokumente,
        )
      }
    }

    if (arg.json) {
      console.log(JSON.stringify({ adresse, messwerte, fehler }, null, 2))
      return 0
    }

    const felder = [
      ['Heap (MB)', 'heapMB', 'MB/min', 1],
      ['DOM-Knoten', 'knoten', 'Knoten/min', 30],
      ['Hoerer', 'hoerer', 'Hoerer/min', 20],
      ['Dokumente', 'dokumente', 'Dok/min', 0.5],
    ]
    const dauerMin = (messwerte[messwerte.length - 1].t - messwerte[0].t) / 60
    console.log('')
    console.log('── Steigung ueber ' + dauerMin.toFixed(1) + ' min ─────────────────────')
    let verdaechtig = 0
    for (const [name, feld, einheit, schwelle] of felder) {
      const punkte = messwerte.map((m) => ({ t: m.t, y: m[feld] }))
      const s = steigungJeMinute(punkte)
      const erst = messwerte[0][feld]
      const letzt = messwerte[messwerte.length - 1][feld]
      const marke = s > schwelle ? '  <<< STEIGT' : ''
      if (s > schwelle) verdaechtig++
      console.log(
        '  ' +
          name.padEnd(12) +
          String(Math.round(erst)).padStart(7) +
          ' -> ' +
          String(Math.round(letzt)).padStart(7) +
          '   ' +
          (s >= 0 ? '+' : '') +
          s.toFixed(1) +
          ' ' +
          einheit +
          marke,
      )
    }

    console.log('')
    if (verdaechtig === 0) {
      console.log('  Nichts steigt im LEERLAUF. Das schliesst ein Leck nicht aus — es sagt,')
      console.log('  dass die ruhende Seite keines hat. Der naechste Schritt ist Bedienung:')
      console.log('  dieselbe Probe, waehrend Musik laeuft und Kacheln getippt werden.')
    } else {
      console.log('  ' + verdaechtig + ' Zaehler steigen, ohne dass jemand die Seite anfasst.')
      console.log('  Welcher steigt, sagt wo zu suchen ist: Knoten -> Erzeugtes wird nie')
      console.log('  entfernt; Hoerer -> addEventListener ohne Gegenstueck; Heap allein')
      console.log('  -> festgehaltene Daten (Puffer, Zwischenspeicher, Verlaufslisten).')
    }
    if (fehler.length) {
      console.log('')
      console.log('  Fehler der Seite (' + fehler.length + '):')
      for (const f of [...new Set(fehler)].slice(0, 8)) console.log('    ' + f)
    }
  } finally {
    await browser.close()
  }
  return 0
}

hauptlauf().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
