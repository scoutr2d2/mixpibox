#!/usr/bin/env node
/**
 * KOMM TROTZDEM DURCH — die Minute und der Lautstaerkeboden unter Beschuss.
 *
 * Zwei Reparaturen haengen an ZWEI Zahlen in der Konfiguration:
 *   `timeout.idlePiShutdown`  wie lange Nichtstun, bevor die Box ausgeht
 *   `mupibox.maxVolume`       wie laut sie hoechstens werden darf
 *
 * Die Verwaltung zeigt Regler mit Grenzen. Die Frage hier ist, ob sich der
 * Wert AN DEN GRENZEN VORBEI setzen laesst — und, wichtiger, was die SKRIPTE
 * dann tun. Denn die Regler sind nicht der Ort, an dem es weh tut: der Ort
 * ist `mupi-lautstaerke.sh` und `idle_shutdown.sh`, und die lesen die Datei.
 *
 * Deshalb zwei Teile:
 *
 *   TEIL 1  ueber die ROUTE. Eigener Server (Port 9982), eigene Konfiguration
 *           unter /tmp. Gefragt wird nicht, was die Antwort sagt, sondern was
 *           HINTERHER IN DER DATEI STEHT.
 *
 *   TEIL 2  DIREKT IN DER DATEI, an der Route vorbei — der Fall, den es auf
 *           einer echten Box gibt (SSH, der alte JSON-Editor im PHP-Admin,
 *           ein halb geschriebenes Update). Hier laufen die ECHTEN Skripte:
 *           `mupi-lautstaerke.sh grenze` und die `hoechstdauer` aus
 *           `idle_shutdown.sh` (geladen mit MUPI_IDLE_NUR_FUNKTIONEN=1).
 *
 * DIE RICHTUNG IST DIE PRUEFUNG, NICHT DIE ZAHL. Bei der Lautstaerke ist ein
 * Fehler nach OBEN gefaehrlich (zu laut am Kinderohr), bei der Abschaltzeit
 * ein Fehler nach UNTEN (Box geht aus, waehrend jemand davor sitzt). Jeder
 * Fall sagt, in welche Richtung er faellt.
 *
 * DIE BOX WIRD NICHT ANGEFASST. Kein Aufruf kennt eine Adresse. Die
 * Lautstaerke DIESER Maschine wird nicht angefasst: benutzt wird nur
 * `grenze`, das rein aus der Konfiguration rechnet und keinen Ton anfasst.
 *
 * AUFRUF
 *   node tools/durchkommen-minute.mjs
 *   node tools/durchkommen-minute.mjs --port 9992
 */

import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const WURZEL = path.join(HIER, '..')
const iPort = process.argv.indexOf('--port')
const PORT = iPort > 0 ? Number(process.argv[iPort + 1]) : 9982

const LAUT = path.join(WURZEL, 'scripts/mupibox/mupi-lautstaerke.sh')
const IDLE = path.join(WURZEL, 'scripts/mupibox/idle_shutdown.sh')

const arbeit = mkdtempSync(path.join(tmpdir(), 'mupi-durchkommen-minute-'))
mkdirSync(path.join(arbeit, 'config'))
const konfigPfad = path.join(arbeit, 'mupiboxconfig.json')

/** Die Vorlage, gekuerzt auf das, was der Server zum Lesen braucht. */
const VORLAGE = JSON.parse(
  readFileSync(path.join(WURZEL, 'config/templates/mupiboxconfig.json'), 'utf8'),
)

let gruen = 0
let rot = 0
const befunde = []
function melde(ok, name, text) {
  if (ok) {
    gruen++
    console.log(`  OK    ${name} — ${text}`)
  } else {
    rot++
    befunde.push(`${name}: ${text}`)
    console.log(`  ROT   ${name} — ${text}`)
  }
}

// ── TEIL 2 ZUERST: DIE SKRIPTE, DENN DORT TUT ES WEH ────────────────────────

/** Was `mupi-lautstaerke.sh` als geltende Obergrenze ausrechnet. */
function grenzeAus(konfig, boden) {
  const p = path.join(arbeit, 'lautkonfig.json')
  writeFileSync(p, JSON.stringify(konfig))
  return execFileSync('bash', [LAUT, 'grenze'], {
    env: {
      ...process.env,
      MUPI_CONFIG: p,
      ...(boden === undefined ? {} : { MUPI_MAXVOL_BODEN: String(boden) }),
    },
    timeout: 10000,
  })
    .toString()
    .trim()
}

/** Was `idle_shutdown.sh` als Hoechstdauer liest (in Minuten). */
function dauerAus(konfig) {
  const p = path.join(arbeit, 'idlekonfig.json')
  writeFileSync(p, JSON.stringify(konfig))
  return execFileSync(
    'bash',
    ['-c', `MUPI_IDLE_NUR_FUNKTIONEN=1 . ${JSON.stringify(IDLE)}; hoechstdauer`],
    { env: { ...process.env, CONFIG: p, JQ: (process.env.JQ || "/usr/bin/jq") }, timeout: 10000 },
  )
    .toString()
    .trim()
}

function teil2() {
  console.log('\nTEIL 2 — DIREKT IN DER DATEI, an der Route vorbei\n')

  // Erst pruefen, dass die Skripte ueberhaupt auf unsere Datei sehen. Ohne
  // diese Gegenprobe misst der ganze Teil die Vorgabewerte und ist gruen,
  // ohne irgendetwas gezeigt zu haben.
  const probeL = grenzeAus({ mupibox: { maxVolume: 55 } })
  const probeI = dauerAus({ timeout: { idlePiShutdown: 77 } })
  if (probeL !== '55' || probeI !== '77') {
    melde(
      false,
      'AUFBAU: die Skripte lesen die untergeschobene Datei',
      `grenze=${probeL} (erwartet 55), hoechstdauer=${probeI} (erwartet 77) — der Rest dieses Teils misst nichts`,
    )
    return
  }
  melde(true, 'AUFBAU: die Skripte lesen die untergeschobene Datei', 'grenze=55, hoechstdauer=77')

  // ── LAUTSTAERKE: ein Fehler nach OBEN ist der gefaehrliche ───────────────
  const lautFaelle = [
    ['maxVolume 0 (die Zahl, die die Verwaltung anbietet)', 0, (v) => v === '10', 'Boden 10'],
    ['maxVolume "0" als Zeichenkette', '0', (v) => v === '10', 'Boden 10'],
    ['maxVolume -5', -5, (v) => v === '10', 'Boden 10'],
    ['maxVolume -0.5', -0.5, (v) => v === '10', 'Boden 10'],
    ['maxVolume 0.9 (Bruch unter dem Boden)', 0.9, (v) => v === '10', 'Boden 10'],
    ['maxVolume 200', 200, (v) => v === '100', 'gedeckelt auf 100'],
    ['maxVolume 1e300', 1e300, (v) => Number(v) <= 100, 'hoechstens 100'],
    ['maxVolume "40"', '40', (v) => v === '40', 'unveraendert'],
    ['maxVolume 40.7', 40.7, (v) => v === '40', 'abgeschnitten wie bisher'],
  ]
  for (const [name, wert, gut, was] of lautFaelle) {
    let v
    try {
      v = grenzeAus({ mupibox: { maxVolume: wert } })
    } catch (f) {
      melde(false, name, `Skript geworfen: ${String(f.message).slice(0, 120)}`)
      continue
    }
    melde(gut(v), name, gut(v) ? `Grenze ${v} (${was})` : `Grenze ${v} — erwartet ${was}`)
  }

  // Die Faelle, in denen der Wert UNLESBAR ist. Hier faellt das Skript auf 100
  // zurueck — also auf „keine Obergrenze". Das ist die laute Richtung, und es
  // ist eine bewusste Entscheidung (unveraendert gegenueber frueher). Gemessen
  // wird sie trotzdem, damit sie im Bericht belegt ist statt behauptet.
  for (const [name, wert] of [
    ['maxVolume fehlt', undefined],
    ['maxVolume null', null],
    ['maxVolume true', true],
    ['maxVolume " 5 " (Zahl mit Leerzeichen)', ' 5 '],
    ['maxVolume "+5"', '+5'],
    ['maxVolume "abc"', 'abc'],
  ]) {
    const v = grenzeAus({ mupibox: wert === undefined ? {} : { maxVolume: wert } })
    console.log(
      `  NOTIZ ${name} — Grenze ${v}${v === '100' ? '  (unlesbar → keine Obergrenze, die LAUTE Richtung)' : ''}`,
    )
  }

  // Der Boden ist einstellbar — es ist seine Box. Auch das gemessen.
  melde(
    grenzeAus({ mupibox: { maxVolume: 0 } }, 1) === '1',
    'der Boden ist einstellbar (MUPI_MAXVOL_BODEN=1)',
    `Grenze ${grenzeAus({ mupibox: { maxVolume: 0 } }, 1)}`,
  )

  // ── ABSCHALTZEIT: ein Fehler nach UNTEN ist der gefaehrliche ─────────────
  const idleFaelle = [
    ['idlePiShutdown 0', 0, (v) => v === '0', 'nie ausschalten'],
    ['idlePiShutdown -5', -5, (v) => v === '0', 'nie ausschalten (nicht sofort!)'],
    ['idlePiShutdown 0.5', 0.5, (v) => v === '0', 'nie ausschalten'],
    ['idlePiShutdown "1"', '1', (v) => v === '1', '1 Minute'],
    ['idlePiShutdown "abc"', 'abc', (v) => v === '0', 'nie ausschalten'],
    ['idlePiShutdown null', null, (v) => v === '0', 'nie ausschalten'],
    ['idlePiShutdown true', true, (v) => v === '0', 'nie ausschalten'],
    ['idlePiShutdown " 1 "', ' 1 ', (v) => v === '0', 'nie ausschalten'],
    ['idlePiShutdown 1e-3', 1e-3, (v) => v === '0', 'nie ausschalten'],
    ['idlePiShutdown 999999999', 999999999, (v) => Number(v) >= 1440, 'sehr lange, nicht sofort'],
  ]
  for (const [name, wert, gut, was] of idleFaelle) {
    let v
    try {
      v = dauerAus({ timeout: { idlePiShutdown: wert } })
    } catch (f) {
      melde(false, name, `Skript geworfen: ${String(f.message).slice(0, 120)}`)
      continue
    }
    melde(gut(v), name, gut(v) ? `Dauer ${v} (${was})` : `Dauer ${v} — erwartet ${was}`)
  }
  const ohne = dauerAus({})
  melde(ohne === '0', 'idlePiShutdown fehlt ganz', `Dauer ${ohne} (nie ausschalten)`)
}

// ── TEIL 1: UEBER DIE ROUTE ────────────────────────────────────────────────

async function teil1() {
  console.log(`\nTEIL 1 — ueber die Route, eigener Server auf 127.0.0.1:${PORT}\n`)
  writeFileSync(konfigPfad, JSON.stringify(VORLAGE, null, 2))

  const server = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: path.join(WURZEL, 'src/backend-api'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      MUPIBOX_HTTP_PORT: String(PORT),
      MUPIBOX_NO_AUTO_TLS: '1',
      MUPIBOX_CONFIG_DIR: path.join(arbeit, 'config'),
      MUPIBOX_CONFIG: konfigPfad,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let ausgabe = ''
  server.stdout.on('data', (d) => (ausgabe += d))
  server.stderr.on('data', (d) => (ausgabe += d))

  const basis = `http://127.0.0.1:${PORT}`
  try {
    let oben = false
    for (let i = 0; i < 80 && !oben; i++) {
      try {
        const a = await fetch(`${basis}/api/konfiguration`, { signal: AbortSignal.timeout(2000) })
        oben = a.ok
      } catch {
        /* noch nicht oben */
      }
      if (!oben) await new Promise((f) => setTimeout(f, 500))
    }
    if (!oben) throw new Error(`Server kam auf ${PORT} nicht hoch:\n${ausgabe.slice(-2000)}`)

    async function setzen(id, wert) {
      const a = await fetch(`${basis}/api/konfiguration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aenderungen: { [id]: wert } }),
        signal: AbortSignal.timeout(8000),
      })
      let leib = null
      try {
        leib = await a.json()
      } catch {
        /* egal */
      }
      const datei = JSON.parse(readFileSync(konfigPfad, 'utf8'))
      return {
        status: a.status,
        fehler: leib?.error,
        maxVolume: datei?.mupibox?.maxVolume,
        idle: datei?.timeout?.idlePiShutdown,
      }
    }

    // Die Frage ist NICHT, was die Antwort sagt, sondern was in der Datei steht.
    for (const [name, id, wert, gut, was] of [
      ['maxLautstaerke = -5', 'maxLautstaerke', -5, (r) => r.status === 400, 'abgelehnt'],
      ['maxLautstaerke = 200', 'maxLautstaerke', 200, (r) => r.status === 400, 'abgelehnt'],
      ['maxLautstaerke = "abc"', 'maxLautstaerke', 'abc', (r) => r.status === 400, 'abgelehnt'],
      ['maxLautstaerke = 40.7', 'maxLautstaerke', 40.7, (r) => r.status === 400 || Number.isInteger(Number(r.maxVolume)), 'abgelehnt oder ganzzahlig'],
      ['ausschaltenNach = -5', 'ausschaltenNach', -5, (r) => r.status === 400, 'abgelehnt'],
      ['ausschaltenNach = 99999', 'ausschaltenNach', 99999, (r) => r.status === 400, 'abgelehnt'],
      ['ausschaltenNach = 0.5', 'ausschaltenNach', 0.5, (r) => r.status === 400 || Number.isInteger(Number(r.idle)), 'abgelehnt oder ganzzahlig'],
      ['ausschaltenNach = "1"', 'ausschaltenNach', '1', () => true, '(wird nur berichtet)'],
    ]) {
      let r
      try {
        r = await setzen(id, wert)
      } catch (f) {
        melde(false, `Route: ${name}`, `Anfrage geworfen: ${f.message}`)
        continue
      }
      const ok = gut(r)
      melde(
        ok,
        `Route: ${name}`,
        `HTTP ${r.status}${r.fehler ? ` (${r.fehler})` : ''}; Datei: maxVolume=${JSON.stringify(r.maxVolume)}, idlePiShutdown=${JSON.stringify(r.idle)} — erwartet ${was}`,
      )
    }

    // ── DER ZWEISCHRITT ─────────────────────────────────────────────────────
    // `maxLautstaerke = 0` faellt oben durch — aber nicht an `min`, sondern an
    // der Querpruefung „Startlautstaerke groesser als Hoechstwert"
    // (konfiguration.ts, pruefeKonfiguration). Wer ERST die Startlautstaerke
    // auf 0 setzt, nimmt dieser Pruefung ihren Grund. Genau so geht ein
    // Elternteil vor, das die Box leise haben will: erst leise starten, dann
    // den Deckel runter. Gemessen, nicht vermutet.
    {
      const a = await setzen('startLautstaerke', 0)
      const b = await setzen('maxLautstaerke', 0)
      const grenze = grenzeAus(JSON.parse(readFileSync(konfigPfad, 'utf8')))
      const durch = b.status === 200
      melde(
        // Kein Fehler DIESER Reparatur: das Skript faengt es auf. Rot waere
        // es nur, wenn am Lautsprecher wirklich 0 ankaeme.
        grenze === '10',
        'Zweischritt: erst startLautstaerke 0, dann maxLautstaerke 0',
        `Schritt 1 HTTP ${a.status}, Schritt 2 HTTP ${b.status}${durch ? ' (angenommen!)' : ''}; ` +
          `Datei maxVolume=${JSON.stringify(b.maxVolume)}; das Skript rechnet Grenze ${grenze}` +
          (durch
            ? ' — das Feld zeigt 0, der Lautsprecher kann 10. Zwei Wahrheiten.'
            : ''),
      )
    }

    // DER BEKANNTE OFFENE PUNKT, gemessen statt behauptet: bietet die Route
    // die 0 an, die das Skript hinterher auf 10 hebt?
    {
      const r = await setzen('maxLautstaerke', 0)
      const angenommen = r.status === 200
      const grenze = angenommen ? grenzeAus(JSON.parse(readFileSync(konfigPfad, 'utf8'))) : '—'
      console.log(
        `\n  NOTIZ Route nimmt maxLautstaerke = 0 an: ${angenommen ? 'JA' : 'nein'} (HTTP ${r.status})\n` +
          `        In der Datei steht dann ${JSON.stringify(r.maxVolume)}, das Skript rechnet daraus Grenze ${grenze}.\n` +
          `        Feld und Lautsprecher sagen damit Verschiedenes — genau der offene Punkt aus\n` +
          `        konfiguration.ts:253 (min: 0 statt min: 10). Die Datei gehoert einer\n` +
          `        Parallelsitzung und wurde NICHT angefasst.`,
      )
    }
  } finally {
    server.kill('SIGTERM')
    await new Promise((f) => setTimeout(f, 400))
    server.kill('SIGKILL')
  }
}

console.log('KOMM TROTZDEM DURCH — Minute und Lautstaerkeboden')
try {
  teil2()
  await teil1()
} finally {
  if (!process.argv.includes('--behalten')) rmSync(arbeit, { recursive: true, force: true })
  else console.log(`\nArbeitsverzeichnis: ${arbeit}`)
}
console.log(`\n${gruen} gruen, ${rot} rot`)
if (rot) console.log(`\nBEFUNDE:\n${befunde.map((b) => `  - ${b}`).join('\n')}`)
process.exit(rot === 0 ? 0 : 1)
