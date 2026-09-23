#!/usr/bin/env node
/*
 * WIRD ES NACH `stop` WIRKLICH STILL? — am Ton gemessen, mehrfach.
 *
 * WARUM DIESES ZWEITE WERKZEUG NEBEN tools/dienstwechsel-am-geraet.mjs:
 * Jenes misst den WECHSEL und entscheidet an EINER Ablesung, ob zwei Maschinen
 * zugleich klingen. Beim Lauf ueber alle neun Paare (05.08.2026) fiel etwas
 * daneben auf, das es gar nicht messen wollte: die Grundlinie EINES Paares —
 * die Ablesung „RUHE", die nach zwei `stop`-Befehlen und sechs Sekunden
 * aufgenommen wird — stand auf 0,3836 statt auf 0,0000. Also lief Spotify nach
 * dem Anhalten weiter.
 *
 * Ein einzelner Ausreisser ist kein Befund. Was er braucht, ist eine
 * Trefferquote — genau die Arbeitsteilung, die llmwiki
 * [[weiterhoeren-am-geraet-messen]] fuer den Wettlauf beschreibt: „Einen
 * Wettlauf zaehlt man nicht an einem Lauf ab."
 *
 * WAS GEMESSEN WIRD, JE RUNDE
 *   1. eine Quelle starten, laufen lassen, Pegel ablesen (Gegenprobe: es MUSS
 *      klingen, sonst beweist die Stille danach nichts)
 *   2. `stop` schicken und die Antwort mitschreiben — das Wort `angehalten`
 *      sagt, wie der Dienst selbst den Ausgang sieht
 *      (bestaetigt | nichts-zu-tun | fehlgeschlagen | frist-abgelaufen)
 *   3. den Pegel danach zweimal ablesen: kurz danach und noch einmal
 *      spaeter. Ein Nachlauf von Sekundenbruchteilen ist kein Fehler; was
 *      nach zehn Sekunden noch klingt, ist einer.
 *
 * DER UNTERSCHIED ZUM VORLAEUFER, DER HIER ZAEHLT: es wird NICHT gewechselt.
 * Damit ist ausgeschlossen, dass ein neuer Start das Bild macht — gemessen
 * wird allein, ob `stop` seine Maschine stillbekommt.
 *
 * WAS ES AN DER BOX AENDERT: startet und haelt an, sonst nichts. Kein
 * POST /api/weiterhoeren, keine Lautstaerke, keine Stummschaltung, kein
 * Ausrollen. Aufnahmen liegen in /tmp.
 *
 * AUFRUF
 *   node tools/stop-wirkt-am-geraet.mjs --dienst spotify --runden 4
 *   node tools/stop-wirkt-am-geraet.mjs --alle --runden 3
 *   node tools/stop-wirkt-am-geraet.mjs --alle --pruefen    # 1 bei Befund
 *
 *   --box 192.168.178.169
 *   --fenster 4    Sekunden je Ablesung. UNTER 3 s IST ES RAUSCHEN: parec
 *                  puffert 64 kB, bevor es das erste Byte schreibt.
 *   --spaet 10     Sekunden zwischen `stop` und der spaeten Ablesung
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const ausfuehren = promisify(execFile)

const args = process.argv.slice(2)
const opt = (name, standard = null) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : standard
}
const flag = (name) => args.includes(name)

const BOX = opt('--box', '192.168.178.169')
const BASIS = `http://${BOX}:8200`
const RAUM = 'current'
const SSH = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=no', `dietpi@${BOX}`]
const FENSTER_S = Math.max(3, Number(opt('--fenster', '4')))
const RUNDEN = Math.max(1, Number(opt('--runden', '3')))
const SPAET_S = Math.max(2, Number(opt('--spaet', '10')))
const PRUEFEN = flag('--pruefen')

/** Ab hier gilt der Mithoerausgang als HOERBAR. Ruhe gemessen: 0,0000–0,0011. */
const STILL = 0.02

const schlaf = (ms) => new Promise((f) => setTimeout(f, ms))

async function json(pfad) {
  const a = await fetch(`${BASIS}${pfad}`, { cache: 'no-store', headers: { accept: 'application/json' } })
  if (!a.ok) throw new Error(`HTTP ${a.status} bei ${pfad}`)
  return a.json()
}

async function spielerBefehl(pfad) {
  const t0 = Date.now()
  try {
    const a = await fetch(`${BASIS}/player/${RAUM}/${pfad}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    let koerper = null
    try {
      koerper = await a.json()
    } catch {
      /* manche Antworten sind leer */
    }
    return { ok: a.ok, status: a.status, ms: Date.now() - t0, koerper }
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, fehler: String(e) }
  }
}

/** Ein Skript auf der Box laufen lassen — ueber base64, damit zwischen fish,
 *  ssh und bash nichts dreimal ausgelegt wird. */
async function ueberSsh(skript) {
  const b64 = Buffer.from(skript, 'utf8').toString('base64')
  const { stdout } = await ausfuehren('ssh', [...SSH, `echo ${b64} | base64 -d | bash`], {
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
  })
  return stdout
}

/** Nur der Pegel am Mithoerausgang — mpv wird hier NICHT angefasst. */
async function pegel() {
  const roh = await ueberSsh(`
export XDG_RUNTIME_DIR=/run/user/1000
python3 - <<'PY'
import array, json, subprocess
senke = ''
for z in subprocess.run(['pactl', 'get-default-sink'], capture_output=True, text=True).stdout.splitlines():
    z = z.strip()
    if z and ' ' not in z and '.' in z:
        senke = z
subprocess.run(
    ['bash', '-c',
     'timeout ${FENSTER_S}s parec --device=%s.monitor --format=s16le --rate=22050 '
     '--channels=1 --raw > /tmp/mupi-stopwirkt.raw 2>/dev/null' % senke],
    check=False,
)
try:
    d = open('/tmp/mupi-stopwirkt.raw', 'rb').read()
except Exception:
    d = b''
a = array.array('h')
a.frombytes(d[: len(d) // 2 * 2])
print('ERGEBNIS ' + json.dumps({
    'senke': senke,
    'rahmen': len(a),
    'spitze': (max(abs(x) for x in a) / 32768.0) if len(a) else -1.0,
}))
PY
`)
  const zeile = roh.split('\n').find((z) => z.startsWith('ERGEBNIS '))
  if (!zeile) throw new Error(`keine Ablesung von der Box:\n${roh.slice(0, 400)}`)
  return JSON.parse(zeile.slice(9))
}

/**
 * DIE ZEITLEISTE DES VERSTUMMENS — und warum ein Spitzenwert dafuer nicht reicht.
 *
 * Ein Spitzenwert ueber vier Sekunden sagt „irgendwann in diesen vier Sekunden
 * war es laut". Er unterscheidet NICHT zwischen „nach 0,3 s war Ruhe" (in
 * Ordnung) und „es lief die ganzen vier Sekunden durch" (der gemeldete Fehler).
 * Genau daran waere der erste Anlauf am 05.08.2026 fast vorbeigelaufen: die
 * Ablesung direkt nach `stop` stand auf 0,3960, und das sah nach Befund aus —
 * war aber der Nachlauf von Sekundenbruchteilen.
 *
 * DESHALB LAEUFT HIER ALLES AUF DER BOX, in EINEM Skript: die Aufnahme wird
 * gestartet, `stop` geht von DORT hinaus (localhost, kein Netzweg dazwischen),
 * und der Zeitpunkt wird IN der Aufnahme festgehalten. Aus der Ferne waere der
 * Abstand zwischen „ich schicke stop" und „die Aufnahme laeuft schon" nicht
 * genauer als der Rundlauf des Netzes — und gemessen wird ein Nachlauf, der
 * kuerzer ist als der.
 *
 * Die Aufnahme wird in Scheiben von 250 ms zerlegt. Verstummt ist es, wenn
 * DREI Scheiben in Folge unter der Schwelle liegen (eine einzelne stille
 * Scheibe gibt es auch mitten in einem Hoerspiel — zwischen zwei Saetzen).
 */
async function verstummenMessen(vorlaufS, dauerS) {
  const roh = await ueberSsh(`
export XDG_RUNTIME_DIR=/run/user/1000
python3 - <<'PY'
import array, json, subprocess, time, urllib.request

senke = ''
for z in subprocess.run(['pactl', 'get-default-sink'], capture_output=True, text=True).stdout.splitlines():
    z = z.strip()
    if z and ' ' not in z and '.' in z:
        senke = z

RATE = 22050
p = subprocess.Popen(
    ['bash', '-c',
     'timeout ${dauerS}s parec --device=%s.monitor --format=s16le --rate=%d '
     '--channels=1 --raw > /tmp/mupi-verlauf.raw 2>/dev/null' % (senke, RATE)],
)
t_start = time.time()
time.sleep(${vorlaufS})

# stop VON DER BOX AUS - der Rundlauf ueber das Netz waere hier laenger als
# das, was gemessen werden soll. (KEINE BACKTICKS in diesem Skript: es steht
# in einer JS-Vorlagenzeichenkette und wuerde sie beenden.)
t_stop = time.time()
antwort = ''
try:
    with urllib.request.urlopen('http://127.0.0.1:8200/player/current/stop', timeout=10) as a:
        antwort = a.read().decode('utf8', 'replace')[:200]
except Exception as e:
    antwort = 'FEHLER ' + str(e)
t_stop_fertig = time.time()

p.wait()
try:
    d = open('/tmp/mupi-verlauf.raw', 'rb').read()
except Exception:
    d = b''
a = array.array('h')
a.frombytes(d[: len(d) // 2 * 2])

SCHEIBE = RATE // 4          # 250 ms
scheiben = []
for i in range(0, len(a), SCHEIBE):
    st = a[i:i + SCHEIBE]
    scheiben.append(round((max(abs(x) for x in st) / 32768.0) if len(st) else -1.0, 4))

print('ERGEBNIS ' + json.dumps({
    'senke': senke,
    'abStopS': round(t_stop - t_start, 3),
    'stopDauerS': round(t_stop_fertig - t_stop, 3),
    'antwort': antwort,
    'scheibeMs': 250,
    'scheiben': scheiben,
}))
PY
`)
  const zeile = roh.split('\n').find((z) => z.startsWith('ERGEBNIS '))
  if (!zeile) throw new Error(`keine Ablesung von der Box:\n${roh.slice(0, 400)}`)
  return JSON.parse(zeile.slice(9))
}

/** Ab welcher Sekunde NACH `stop` war drei Scheiben lang Ruhe? null = nie. */
function stillAb(m) {
  const abIdx = Math.round((m.abStopS * 1000) / m.scheibeMs)
  let ruhe = 0
  for (let i = abIdx; i < m.scheiben.length; i++) {
    ruhe = m.scheiben[i] <= STILL ? ruhe + 1 : 0
    if (ruhe === 3) return ((i - 2 - abIdx) * m.scheibeMs) / 1000
  }
  return null
}

// ── Was auf dieser Box zu starten ist ─────────────────────────────────────

function spotifyBefehl(w) {
  const q = (w.quellen || []).find((x) => x.dienst === 'spotify')
  if (!q) return null
  const id = String(q.kennung || '').split(':').pop()
  const typ = { album: 'album', playlist: 'playlist', show: 'show' }[w.art]
  // Siehe tools/dienstwechsel-am-geraet.mjs: der Eintrag „External Playback"
  // traegt `t:unknown|external playback` und ist kein Album.
  if (!typ || !/^[A-Za-z0-9]{22}$/.test(id)) return null
  return `spotify/now/spotify:${typ}:${encodeURIComponent(id)}:0:0`
}

async function quellenSuchen() {
  const d = await json('/api/werke?verschmelzen=0')
  const werke = d.werke || []
  const q = {}
  const sp = werke.find((w) => spotifyBefehl(w))
  if (sp) q.spotify = { werk: sp, dienst: 'spotify' }
  const jf = werke.find((w) => (w.quellen || []).some((x) => x.dienst === 'jellyfin') && w.art === 'album')
  if (jf) q.jellyfin = { werk: jf, dienst: 'jellyfin' }
  const ard = werke.find((w) => (w.quellen || []).some((x) => x.dienst === 'ard'))
  if (ard) q.ard = { werk: ard, dienst: 'ard' }
  return q
}

/** Starten wie die Oberflaeche: erst `stop`, dann der Befehl. */
async function starten(eintrag) {
  if (eintrag.dienst === 'spotify') {
    await spielerBefehl('stop')
    return spielerBefehl(spotifyBefehl(eintrag.werk))
  }
  const d = await json(`/api/werke/${encodeURIComponent(eintrag.werk.schluessel)}/inhalt?verschmelzen=0`)
  const titel = (d.titel || []).filter((t) => t.befehl)
  if (!titel.length) throw new Error(`keine abspielbaren Titel bei ${eintrag.werk.schluessel}`)
  await spielerBefehl('stop')
  return spielerBefehl(titel[0].befehl)
}

// ── Eine Runde ────────────────────────────────────────────────────────────

async function runde(eintrag, nr) {
  await starten(eintrag)
  await schlaf(6000)
  const vor = await pegel()
  const lief = vor.spitze > STILL

  const m = await verstummenMessen(2, SPAET_S + 3)
  const wort = (() => {
    try {
      return String(JSON.parse(m.antwort).angehalten || '(Feld fehlt)')
    } catch {
      return `(keine Auskunft: ${m.antwort.slice(0, 40)})`
    }
  })()
  const still = stillAb(m)
  const abIdx = Math.round((m.abStopS * 1000) / m.scheibeMs)
  const bild = m.scheiben
    .slice(Math.max(0, abIdx - 4))
    .map((s) => (s <= STILL ? '.' : s < 0.1 ? '-' : '#'))
    .join('')

  console.log(
    `  Runde ${nr}  Vorlauf ${vor.spitze.toFixed(4)}${lief ? '' : ' ⚠ lief nicht'}` +
      `   stop ${(m.stopDauerS * 1000).toFixed(0)} ms -> ${wort.padEnd(16)}` +
      `   still nach ${still === null ? 'NIE' : `${still.toFixed(2)} s`}`,
  )
  console.log(`            |${bild}   (250 ms je Zeichen, ab 1 s VOR dem stop)`)
  return { nr, lief, wort, still, stillGeworden: still !== null }
}

// ── Hauptlauf ─────────────────────────────────────────────────────────────

const quellen = await quellenSuchen()
const gewaehlt = flag('--alle')
  ? Object.keys(quellen)
  : [opt('--dienst', 'spotify')].filter((d) => Object.hasOwn(quellen, d))

if (!gewaehlt.length) {
  console.log(`Box ${BOX} — messbare Dienste: ${Object.keys(quellen).join(', ') || '(keine)'}`)
  console.log('  --dienst <name> | --alle')
  process.exit(2)
}

console.log(`Box ${BOX}   Fenster ${FENSTER_S}s   spaet nach ${SPAET_S}s   hoerbar ab ${STILL}`)

const alle = []
try {
  for (const d of gewaehlt) {
    console.log(`\n── ${d} ${'─'.repeat(Math.max(0, 54 - d.length))}`)
    for (let i = 1; i <= RUNDEN; i++) alle.push({ dienst: d, ...(await runde(quellen[d], i)) })
  }
} finally {
  await spielerBefehl('stop')
}

console.log(`\n══ ZUSAMMENFASSUNG ${'═'.repeat(42)}`)
for (const d of gewaehlt) {
  const r = alle.filter((x) => x.dienst === d && x.lief)
  const schlecht = r.filter((x) => !x.stillGeworden)
  const zeiten = r.filter((x) => x.still !== null).map((x) => x.still)
  console.log(
    `  ${d.padEnd(10)} ${schlecht.length} von ${r.length} Runden klangen nach ${SPAET_S}s noch` +
      (zeiten.length ? `   still nach ${Math.min(...zeiten).toFixed(2)}–${Math.max(...zeiten).toFixed(2)} s` : ''),
  )
  const woerter = [...new Set(alle.filter((x) => x.dienst === d).map((x) => x.wort))]
  console.log(`             gemeldet: ${woerter.join(', ')}`)
}

if (PRUEFEN && alle.some((x) => x.lief && !x.stillGeworden)) process.exit(1)
