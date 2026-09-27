#!/usr/bin/env node
/**
 * WIE LANGE BRAUCHT MPV WIRKLICH, BIS DIE WARTESCHLANGE STEHT? — BACKLOG E24/O4.
 *
 * WOZU: Der Weiterhoeren-Weg fuer mpv (lokal und Jellyfin) besteht aus DREI
 * Befehlen mit FESTEN Wartezeiten dazwischen (NewDesign/app.js `weiterSpielen`):
 *
 *     stop -> starte -> warte 2000 ms -> tracknr:N -> warte 1500 ms -> seekpos:P
 *
 * Beide Zahlen sind GERATEN, und der Kommentar sagt es selbst: „die klassische
 * Oberflaeche wartet an derselben Stelle 2000 ms — hier abgeschrieben, nicht
 * neu gewaehlt". Der einzige Messwert in der Naehe steht dagegen
 * (llmwiki mupi-knopf-schnell-ton-langsam: 3890 ms vom Knopf bis zum Ton), er
 * meint aber etwas anderes — „bis man etwas HOERT", inklusive Lautsprecher-
 * puffer. Fuer die Frage „steht die Warteschlange?" hat NIEMAND je gemessen.
 *
 * DIESES WERKZEUG MISST GENAU DAS, und zwar an drei Stellen:
 *
 *     loadlist -> playlist-count steht auf N        (die Warteschlange)
 *     set playlist-pos-1 = N -> gelesen wird N      (`tracknr:` kommt an)
 *     set percent-pos = P   -> gelesen wird ~P      (`seekpos:` kommt an)
 *
 * KEIN TON. mpv laeuft mit `--ao=null`; gemessen wird die Warteschlange, nicht
 * die Wiedergabe. Damit ist der Lauf auch auf einer Box zulaessig, auf der
 * gerade jemand Musik hoert — es entsteht ein ZWEITER mpv mit eigenem Socket,
 * der nichts anfasst und danach beendet wird.
 *
 * WAS DAS ERGEBNIS NICHT SAGT: Der lokale Lauf misst diesen Rechner, nicht den
 * Pi. Er ist eine UNTERGRENZE fuer die Box. Deshalb gibt es `--box`.
 *
 * AUFRUF
 *   npx tsx tools/mpv-anlauf-messen.mjs                 # hier, mit dem echten Aufsatz
 *   npx tsx tools/mpv-anlauf-messen.mjs --titel 20
 *   npx tsx tools/mpv-anlauf-messen.mjs --box 192.168.178.169   # auf dem Geraet
 *
 * Der Box-Lauf schickt sein Messkript ueber die STANDARDEINGABE (`node -`) —
 * auf der Box bleibt keine Datei zurueck. Er spricht mpv unmittelbar in
 * JSON-IPC an, mit denselben Befehlen, die mpv-protokoll.ts erzeugt.
 */

import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const WURZEL = path.join(HIER, '..')
const argv = process.argv.slice(2)
const wort = (n, s) => {
  const i = argv.indexOf(n)
  return i < 0 ? s : String(argv[i + 1] || s)
}
const zahl = (n, s) => {
  const i = argv.indexOf(n)
  if (i < 0) return s
  const z = Number(argv[i + 1])
  return Number.isFinite(z) ? z : s
}

const TITEL = zahl('--titel', 12)
const ZIEL_NR = zahl('--ziel', Math.min(7, TITEL))
const BOX = wort('--box', '')

/**
 * Die geratenen Zahlen — AUS app.js GELESEN, nicht abgeschrieben.
 *
 * SIE STEHEN DORT SEIT COMMIT `1be88f7f` NICHT MEHR (BACKLOG E24/O4): die neue
 * Oberflaeche sieht mit `titelUndStelle` nach, statt nach der Uhr zu warten.
 * Bis zum Gegenlesen am 04.08.2026 fiel dieses Werkzeug darauf nicht herein,
 * sondern rechnete stumm weiter — und meldete `MPV_ANLAUF_MS aus app.js: NaN
 * ms` und `zusammen … ms, wo die Oberflaeche NaN ms fest absitzt`. Ein
 * Messbericht mit NaN darin ist die schlimmste Sorte Ausgabe: er sieht aus wie
 * eine Messung. Deshalb faellt der Lauf hier mit einer ERKLAERUNG, statt eine
 * Vergleichszahl zu erfinden, die es nicht mehr gibt.
 */
const APP = await import('node:fs').then((fs) => fs.readFileSync(path.join(WURZEL, 'NewDesign/app.js'), 'utf8'))
const ANLAUF_MS = zahl('--anlauf', Number((APP.match(/const MPV_ANLAUF_MS = (\d+)/) || [])[1]))
const SPRUNG_MS = zahl('--sprung', Number((APP.match(/const MPV_SPRUNG_MS = (\d+)/) || [])[1]))
if (!Number.isFinite(ANLAUF_MS) || !Number.isFinite(SPRUNG_MS)) {
  console.error(
    [
      'NewDesign/app.js kennt MPV_ANLAUF_MS/MPV_SPRUNG_MS nicht mehr.',
      '',
      'Das ist keine Panne, sondern das Ergebnis: die feste Wartezeit, die dieses',
      'Werkzeug nachgewiesen hat, ist seit Commit 1be88f7f weg (BACKLOG E24/O4).',
      'Die neue Oberflaeche fragt mit `titelUndStelle` nach, statt abzusitzen.',
      '',
      'Wer den Vergleich trotzdem fahren will, nennt die alten Zahlen ausdruecklich:',
      '  node tools/mpv-anlauf-messen.mjs --anlauf 2000 --sprung 1500',
      '',
      'Die KLASSISCHE Oberflaeche hat die Stelle unveraendert — dort sind es vier',
      'feste 2000-ms-Fristen in player.page.ts resumePlayback(). Dieses Werkzeug',
      'misst sie NICHT; es haengt an NewDesign/app.js.',
    ].join('\n'),
  )
  process.exit(2)
}

/** Eine kurze, stille WAV-Datei — ohne ffmpeg, ohne Fremdwerkzeug. */
function stilleWav(sekunden = 1, rate = 8000) {
  const daten = rate * sekunden * 2
  const b = Buffer.alloc(44 + daten)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + daten, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate * 2, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(daten, 40)
  return b
}

const warte = (ms) => new Promise((f) => setTimeout(f, ms))

/**
 * DER LAUF HIER — mit dem ECHTEN Aufsatz (src/backend-player/src/mpv-wrapper.ts).
 *
 * Nicht mit einem nachgebauten IPC-Gespraech: der Aufsatz ist genau das
 * Stueck, das der Abspieldienst benutzt, samt seiner Eigenheiten (er
 * verbindet sich erst, wenn mpv den Socket angelegt hat, und legt Befehle
 * solange auf Halde).
 */
async function hier(ueberNetz = 0) {
  const require = createRequire(path.join(WURZEL, 'x.js'))
  const createPlayer = require('./src/backend-player/src/mpv-wrapper')

  const ordner = mkdtempSync(path.join(tmpdir(), 'mupi-mpv-'))
  const dateien = []
  for (let i = 1; i <= TITEL; i++) {
    const f = path.join(ordner, `titel-${String(i).padStart(2, '0')}.wav`)
    writeFileSync(f, stilleWav(2))
    dateien.push(f)
  }

  /*
   * DER JELLYFIN-FALL, NACHGESTELLT.
   *
   * Auf der Box .169 liegt KEINE einzige lokale Mediendatei (nachgesehen am
   * 04.08.2026: /media ist leer, data.json fuehrt 22 Spotify-, 2 Jellyfin- und
   * 1 ARD-Eintrag). Was dort ueber mpv laeuft, kommt also IMMER ueber das
   * Netz — und genau dafuer sind die 2000/1500 ms gedacht. Ein Lauf mit
   * lokalen Dateien beantwortet die Frage deshalb nur zur Haelfte.
   *
   * `--netz <ms>` schiebt einen Server dazwischen, der vor dem ersten Byte
   * wartet. Damit laesst sich sehen, WELCHER der drei Schritte ueberhaupt auf
   * das Netz wartet — und welcher nicht.
   */
  let server = null
  let quellen = dateien
  if (ueberNetz > 0) {
    const http = await import('node:http')
    const fs = await import('node:fs')
    // DIE OFFENEN UHREN WERDEN MITGEZAEHLT. Ohne das feuerte eine noch
    // laufende Verzoegerung, NACHDEM der Ordner geloescht war, und riss den
    // Lauf mit ENOENT ab — beim ersten Anlauf am 04.08.2026 genau so passiert.
    const uhren = new Set()
    server = http.createServer((req, res) => {
      const nr = Number((req.url.match(/(\d+)/) || [])[1] || 1)
      const u = setTimeout(() => {
        uhren.delete(u)
        try {
          const b = fs.readFileSync(dateien[Math.min(nr, dateien.length) - 1])
          res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': b.length })
          res.end(b)
        } catch {
          res.destroy()
        }
      }, ueberNetz)
      uhren.add(u)
    })
    server.alleUhrenAus = () => {
      for (const u of uhren) clearTimeout(u)
      uhren.clear()
    }
    await new Promise((f) => server.listen(0, '127.0.0.1', f))
    const port = server.address().port
    quellen = dateien.map((_f, i) => `http://127.0.0.1:${port}/titel-${i + 1}.wav`)
  }

  const liste = path.join(ordner, 'album.m3u')
  writeFileSync(liste, `${quellen.join('\n')}\n`)

  // `--ao=null`: kein Ton. Gemessen wird die Warteschlange.
  const player = createPlayer({ argumente: ['--ao=null'] })
  const gelesen = { zahl: null, pos: null, prozent: null }
  player.on('playlist_count', (v) => {
    gelesen.zahl = Number(v)
  })
  player.on('playlist_pos', (v) => {
    gelesen.pos = Number(v)
  })
  player.on('percent_pos', (v) => {
    gelesen.prozent = Number(v)
  })

  try {
    await new Promise((f, d) => {
      player.once('bereit', f)
      player.once('error', d)
      setTimeout(() => d(new Error('mpv wurde nicht bereit')), 10000)
    })

    /** Warten, bis eine Bedingung stimmt — und sagen, wie lange es dauerte. */
    const bis = async (pruefen, frist = 15000) => {
      const start = Date.now()
      while (Date.now() - start < frist) {
        player.getProps(['playlist_count', 'playlist_pos', 'percent_pos'])
        await warte(5)
        if (pruefen()) return Date.now() - start
      }
      return null
    }

    player.playList(liste)
    const stehtNach = await bis(() => gelesen.zahl === TITEL)

    player.titelPos(ZIEL_NR)
    const sprungNach = await bis(() => gelesen.pos === ZIEL_NR)

    player.seekPercent(40)
    const seekNach = await bis(() => gelesen.prozent !== null && gelesen.prozent >= 30)

    /*
     * DIE GEGENPROBE: DIESELBE FOLGE, WIE app.js SIE WIRKLICH SCHICKT.
     *
     * Oben wird jeder Schritt abgewartet — das misst, was moeglich WAERE. Hier
     * wird stur nach der Uhr geschickt, wie `weiterSpielen` es tut:
     *
     *     loadlist -> warte MPV_ANLAUF_MS -> titelPos -> warte MPV_SPRUNG_MS -> seek
     *
     * Und dann die einzige Frage, auf die es ankommt: KAM DER SPRUNG AN?
     * Nachgesehen wird kurz danach (300 ms), nicht mit unendlicher Geduld —
     * denn die Oberflaeche sieht auch nicht nach.
     */
    gelesen.zahl = null
    gelesen.pos = null
    gelesen.prozent = null
    player.playList(liste)
    await warte(ANLAUF_MS)
    player.titelPos(ZIEL_NR)
    await warte(SPRUNG_MS)
    player.seekPercent(70)
    const nachschau = await bis(() => gelesen.prozent !== null && gelesen.prozent >= 60, 300)
    const wieApp = { gelandet: nachschau !== null, prozent: gelesen.prozent, titel: gelesen.pos }

    return { stehtNach, sprungNach, seekNach, wieApp }
  } finally {
    try {
      player.quit?.()
    } catch {
      /* egal */
    }
    try {
      player.stop?.()
    } catch {
      /* egal */
    }
    await warte(200)
    if (server) {
      server.alleUhrenAus()
      server.closeAllConnections?.()
      server.close()
    }
    rmSync(ordner, { recursive: true, force: true })
  }
}

/**
 * DER LAUF AUF DER BOX — ohne eine Datei dort zu hinterlassen.
 *
 * Das Messkript geht ueber die Standardeingabe an `node -`. Es spricht mpv
 * unmittelbar in JSON-IPC an; die drei Befehle sind woertlich die aus
 * mpv-protokoll.ts (`loadlist`, `set_property playlist-pos-1`,
 * `set_property percent-pos`).
 *
 * DIE TITEL SIND DIE DER BOX. Erzeugt wird nichts — gesucht wird im
 * Medienordner nach vorhandenen Dateien, und die Liste entsteht in /tmp und
 * wird am Ende geloescht. Kein Ton (`--ao=null`), kein Eingriff in den
 * laufenden Dienst (eigener Socket).
 */
async function aufDerBox(adresse) {
  const skript = `
const { spawn, execSync } = require('node:child_process')
const net = require('node:net'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const TITEL = ${TITEL}, ZIEL = ${ZIEL_NR}
const warte = (ms) => new Promise((f) => setTimeout(f, ms))

// VORHANDENE Dateien der Box suchen — es wird nichts erzeugt und nichts
// abgespielt (--ao=null).
let dateien = []
for (const wo of ['/media', '/home/dietpi/MuPiBox/media', '/mnt']) {
  try {
    dateien = execSync('find ' + wo + ' -maxdepth 6 -type f \\\\( -name "*.mp3" -o -name "*.m4a" -o -name "*.ogg" -o -name "*.wav" \\\\) 2>/dev/null | head -' + TITEL, { encoding: 'utf8' })
      .trim().split('\\n').filter(Boolean)
  } catch {}
  if (dateien.length >= 2) break
}
if (dateien.length < 2) { console.log(JSON.stringify({ fehler: 'keine Mediendateien gefunden' })); process.exit(0) }
const n = dateien.length
const liste = path.join(os.tmpdir(), 'mupi-messung-' + process.pid + '.m3u')
fs.writeFileSync(liste, dateien.join('\\n') + '\\n')
const sock = path.join(os.tmpdir(), 'mupi-messung-' + process.pid + '.sock')

const proc = spawn('mpv', ['--idle=yes','--no-video','--no-terminal','--ao=null','--msg-level=all=warn','--input-ipc-server=' + sock], { stdio: 'ignore' })
const gelesen = { zahl: null, pos: null, prozent: null }
let s = null, id = 0
const schicke = (befehl) => { if (s) s.write(JSON.stringify({ command: befehl, request_id: ++id }) + '\\n') }
const offen = new Map()
const frage = (name, mpvName) => { offen.set(++id, name); s.write(JSON.stringify({ command: ['get_property', mpvName], request_id: id }) + '\\n') }

async function main() {
  for (let i = 0; i < 100 && !s; i++) {
    await warte(50)
    try { s = await new Promise((f, d) => { const c = net.createConnection(sock); c.on('connect', () => f(c)); c.on('error', d) }) } catch {}
  }
  if (!s) { console.log(JSON.stringify({ fehler: 'mpv-Socket nicht erreichbar' })); proc.kill('SIGKILL'); return }
  let rest = ''
  s.setEncoding('utf8')
  s.on('data', (st) => {
    rest += st
    const zeilen = rest.split('\\n'); rest = zeilen.pop()
    for (const z of zeilen) {
      if (!z.trim()) continue
      let m; try { m = JSON.parse(z) } catch { continue }
      if (m.request_id && offen.has(m.request_id)) { gelesen[offen.get(m.request_id)] = m.data; offen.delete(m.request_id) }
    }
  })
  const bis = async (pruefen, frist = 15000) => {
    const start = Date.now()
    while (Date.now() - start < frist) {
      frage('zahl', 'playlist-count'); frage('pos', 'playlist-pos-1'); frage('prozent', 'percent-pos')
      await warte(5)
      if (pruefen()) return Date.now() - start
    }
    return null
  }
  schicke(['loadlist', liste, 'replace'])
  const stehtNach = await bis(() => Number(gelesen.zahl) === n)
  const ziel = Math.min(ZIEL, n)
  schicke(['set_property', 'playlist-pos-1', ziel])
  const sprungNach = await bis(() => Number(gelesen.pos) === ziel)
  schicke(['set_property', 'percent-pos', 40])
  const seekNach = await bis(() => Number(gelesen.prozent) >= 30)
  console.log(JSON.stringify({ titel: n, stehtNach, sprungNach, seekNach }))
  proc.kill('SIGKILL')
  try { fs.unlinkSync(liste) } catch {}
  try { fs.unlinkSync(sock) } catch {}
}
main().then(() => process.exit(0), (e) => { console.log(JSON.stringify({ fehler: String(e.message || e) })); proc.kill('SIGKILL'); process.exit(0) })
`
  const aus = await new Promise((f) => {
    const k = execFile(
      'ssh',
      ['-o', 'ConnectTimeout=6', '-o', 'BatchMode=yes', `dietpi@${adresse}`, 'node -'],
      { timeout: 120000 },
      (_e, o, err) => f({ o: String(o || ''), err: String(err || '') }),
    )
    k.stdin.end(skript)
  })
  const zeile = aus.o.trim().split('\n').pop() || ''
  try {
    return JSON.parse(zeile)
  } catch {
    return { fehler: `unlesbare Antwort: ${zeile.slice(0, 120)} ${aus.err.slice(0, 120)}` }
  }
}

function zeigen(wo, e) {
  console.log(`\n${wo}`)
  if (e.fehler) {
    console.log(`  FEHLER: ${e.fehler}`)
    return
  }
  const ms = (v) => (v === null ? 'NICHT erreicht' : `${v} ms`)
  console.log(`  Warteschlange steht (loadlist -> playlist-count)   ${ms(e.stehtNach)}   gewartet wird ${ANLAUF_MS} ms`)
  console.log(`  Titelsprung kommt an (playlist-pos-1)              ${ms(e.sprungNach)}   gewartet wird ${SPRUNG_MS} ms`)
  console.log(`  Sprung in den Titel kommt an (percent-pos)         ${ms(e.seekNach)}`)
  const summe = (e.stehtNach ?? 0) + (e.sprungNach ?? 0) + (e.seekNach ?? 0)
  console.log(`  ── zusammen ${summe} ms, wo die Oberflaeche ${ANLAUF_MS + SPRUNG_MS} ms fest absitzt`)
  if (e.wieApp) {
    console.log(
      `  Gegenprobe (stur nach der Uhr wie app.js): Sprung ${e.wieApp.gelandet ? 'KAM AN' : 'kam NICHT an'}` +
        `  — Titel ${e.wieApp.titel}, Stelle ${e.wieApp.prozent === null ? '(keine)' : `${Math.round(e.wieApp.prozent)} %`}`,
    )
  }
}

// WOHER die Zahlen kommen, gehoert in den Bericht: „aus app.js" waere gelogen,
// sobald sie ueber --anlauf/--sprung von Hand hereingereicht wurden.
const HERKUNFT = argv.includes('--anlauf') || argv.includes('--sprung') ? 'von der Kommandozeile' : 'aus app.js'
console.log(`MPV_ANLAUF_MS ${HERKUNFT}: ${ANLAUF_MS} ms    MPV_SPRUNG_MS: ${SPRUNG_MS} ms`)

if (BOX) {
  zeigen(`Auf der Box ${BOX} (echte Mediendateien, kein Ton):`, await aufDerBox(BOX))
} else {
  zeigen(`Hier — ${TITEL} stille Titel als DATEI (echter mpv-Aufsatz):`, await hier(0))
  const netz = zahl('--netz', 1500)
  zeigen(`Hier — dieselben Titel ueber HTTP, Server antwortet erst nach ${netz} ms:`, await hier(netz))
  console.log('\n  Das ist eine UNTERGRENZE fuer die Box — dieser Rechner ist kein Pi.')
  console.log('  Auf der Box .169 liegt KEINE lokale Mediendatei; was dort ueber mpv')
  console.log('  laeuft, kommt ueber das Netz (Jellyfin). Der zweite Lauf ist der naehere.')
}
console.log('')
