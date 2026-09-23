#!/usr/bin/env node
/**
 * DAS LOCH SUCHEN — der Helligkeits-Weg unter Beschuss, an einem ECHTEN
 * Serverprozess.
 *
 * tools/schirmhelligkeit-am-server.mjs prüft, ob der Weg TUT, was er soll.
 * Dieser Lauf hier prüft das Gegenteil: was er NICHT tun darf. Er ist die
 * Gegenprobe zu einem Endpunkt, der als root in eine Gerätedatei schreibt und
 * (bei ausgeschalteter Anmeldung) aus dem ganzen LAN erreichbar ist.
 *
 * WAS GEMESSEN WIRD, und warum jedes davon einzeln:
 *
 *   1. EINSCHUSS  — 30 Nutzlasten in `prozent`: Semikolon, Backtick, $(),
 *      Zeilenumbruch, `..`, absoluter Pfad, Prototyp-Verseuchung. Danach muss
 *      in der Gerätedatei eine nackte Zahl stehen und sonst NICHTS im
 *      Bühnenordner sich geändert haben.
 *   2. NACHBARDATEIEN — bl_power und max_brightness liegen im selben Ordner.
 *      Wenn der Weg jemals eine andere Datei als brightness beschreibt, fällt
 *      es hier auf.
 *   3. SYMLINK — in echtem sysfs sind die Einträge unter /sys/class/backlight
 *      Symlinks. Wohin schreibt der Weg, wenn `brightness` einer ist?
 *   4. ZWEITES GERÄT — ein kaputter Eintrag neben einem guten Panel.
 *   5. NEBENLÄUFIGKEIT — gleichzeitige PUTs. Die Konfiguration der Box muss
 *      danach noch gültiges JSON sein.
 *   6. GROSSER RUMPF — greift die Grenze von 4 kB am Weg wirklich?
 *   7. sudo — mit einem PATH-Doppelgänger von `sudo`: welche Argumente kommen
 *      dort an (steckt eine Shell dazwischen?), und was tut der Server, wenn
 *      sudo sofort scheitert?
 *
 * FAHREN (ändert nichts an dieser Maschine, alles unter /tmp):
 *   node tools/schirm-helligkeit-loch.mjs
 *   node tools/schirm-helligkeit-loch.mjs --port 9943
 *
 * Rückgabewert 0 = kein Loch gefunden, 1 = mindestens eine Aussage falsch.
 */
import { spawn } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = dirname(fileURLToPath(import.meta.url))
const BACKEND = join(HIER, '..', 'src', 'backend-api')
const GERAET = '11-0045'

const args = process.argv.slice(2)
const wert = (name, vorgabe) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : vorgabe
}
const PORT = Number(wert('--port', '9943'))

let gut = 0
let schlecht = 0
const loecher = []
function pruefe(behauptung, bedingung, gesehen) {
  if (bedingung) {
    gut++
    console.log(`  ok    ${behauptung}`)
  } else {
    schlecht++
    loecher.push(behauptung)
    console.log(`  FEHLT ${behauptung}${gesehen === undefined ? '' : `  — gesehen: ${JSON.stringify(gesehen)}`}`)
  }
}
const schlafen = (ms) => new Promise((f) => setTimeout(f, ms))

// ── Die Bühne ──────────────────────────────────────────────────────────────
const ordner = mkdtempSync(join(tmpdir(), 'mupi-loch-'))
const wurzel = join(ordner, 'backlight')
const panel = join(wurzel, GERAET)
const brightness = join(panel, 'brightness')
const blPower = join(panel, 'bl_power')
const maxRoh = join(panel, 'max_brightness')
const konfigPfad = join(ordner, 'mupiboxconfig.json')
/** Was ein Angreifer gern hätte: eine Datei ausserhalb des Panels. */
const beute = join(ordner, 'beute.txt')
const BEUTE_TEXT = 'unangetastet\n'
const schuhe = join(ordner, 'pfad') // PATH-Doppelgänger für sudo
const sudoLog = join(ordner, 'sudo-aufrufe.txt')
/** Je sudo-Aufruf eine eigene Datei — zaehlbar auch bei 40 gleichzeitig. */
const sudoZaehler = join(ordner, 'sudo-zaehler')
/** Marken laufender sudo-Prozesse — daraus wird der HOECHSTSTAND gemessen. */
const sudoLaeuft = join(ordner, 'sudo-laeuft')

function buehneBauen() {
  mkdirSync(panel, { recursive: true })
  // Ein voriger Durchgang kann die Datei auf 0444 gestellt haben („gehoert
  // root"). Ohne das hier scheitert der naechste Aufbau mit EACCES.
  try {
    chmodSync(brightness, 0o644)
  } catch {
    /* gibt es noch nicht */
  }
  writeFileSync(brightness, '255\n')
  writeFileSync(maxRoh, '255\n')
  writeFileSync(blPower, '0\n')
  writeFileSync(beute, BEUTE_TEXT)
  writeFileSync(
    konfigPfad,
    `${JSON.stringify(
      {
        mupibox: { host: 'MuPiBox', startVolume: '40', maxVolume: '100', displayBrightness: '60' },
        interfacelogin: { state: false, password: '' },
        timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
      },
      null,
      2,
    )}\n`,
  )
}
const lies = (p) => {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}
const roh = () => (lies(brightness) ?? '').trim()
const konfigText = () => lies(konfigPfad) ?? ''

/** Jede Datei unter dem Bühnenordner mit Größe und Inhalt — für den Vergleich. */
function abzug(dir = ordner, raus = {}) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    let s
    try {
      s = statSync(p)
    } catch {
      raus[p] = '<kaputter Verweis>'
      continue
    }
    if (s.isDirectory()) abzug(p, raus)
    else raus[p] = lies(p)
  }
  return raus
}

// ── Server starten/stoppen ─────────────────────────────────────────────────
let kind = null
let mitschrift = []
async function serverStarten(zusatz = {}) {
  mitschrift = []
  kind = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: BACKEND,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      MUPIBOX_HTTP_PORT: String(PORT),
      MUPIBOX_BACKLIGHT: wurzel,
      MUPIBOX_CONFIG: konfigPfad,
      MUPIBOX_CONFIG_DIR: ordner,
      MUPIBOX_LOCK_DIR: ordner,
      MUPIBOX_TLS_DIR: join(ordner, 'tls'),
      ...zusatz,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  kind.stdout.on('data', (d) => mitschrift.push(String(d)))
  kind.stderr.on('data', (d) => mitschrift.push(String(d)))
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(`${basis}/api/schirm/helligkeit`)).ok) return true
    } catch {
      /* noch nicht da */
    }
    await schlafen(100)
  }
  return false
}
async function serverStoppen() {
  if (!kind) return
  kind.kill('SIGTERM')
  await schlafen(400)
  kind.kill('SIGKILL')
  kind = null
  await schlafen(200)
}

const basis = `http://127.0.0.1:${PORT}`
const get = async () => {
  const r = await fetch(`${basis}/api/schirm/helligkeit`, { cache: 'no-store' })
  return { status: r.status, d: await r.json().catch(() => null) }
}
const setzRoh = async (rumpf) => {
  const r = await fetch(`${basis}/api/schirm/helligkeit`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: rumpf,
  })
  return { status: r.status, d: await r.json().catch(() => null) }
}
const setz = (prozent) => setzRoh(JSON.stringify({ prozent }))

async function aufraeumen(code) {
  await serverStoppen()
  try {
    chmodSync(brightness, 0o644)
  } catch {
    /* egal */
  }
  rmSync(ordner, { recursive: true, force: true })
  console.log(`\n${gut} richtig, ${schlecht} falsch.`)
  if (loecher.length) {
    console.log('\nWas nicht stimmt:')
    for (const l of loecher) console.log(`  * ${l}`)
  }
  process.exit(code)
}

/**
 * Ein `sudo`-Doppelgänger auf dem PATH.
 *
 * Er MUSS sich wie root benehmen (also auch in eine 0444-Datei schreiben
 * können), sonst misst man den eigenen Doppelgänger statt des Servers. Alles,
 * was nicht `-n tee <pfad>` ist (etwa setting_update.sh), geht stillschweigend
 * durch — der Prüfgegenstand ist der Helligkeitsweg.
 */
function sudoDoppelgaenger(traegt = true) {
  mkdirSync(schuhe, { recursive: true })
  const p = join(schuhe, 'sudo')
  writeFileSync(
    p,
    [
      '#!/bin/sh',
      // Je Aufruf eine EIGENE Datei: zwei Shells, die gleichzeitig an dieselbe
      // Datei anhängen, verlieren Zeilen — und dann zählt man zu wenige
      // root-Prozesse und hält einen Ansturm für harmloser, als er ist.
      `mkdir -p ${JSON.stringify(sudoZaehler)} ${JSON.stringify(sudoLaeuft)}`,
      `: > ${JSON.stringify(sudoZaehler)}/$$-$(date +%s%N)`,
      // Solange dieser Prozess LEBT, liegt seine Marke da. Damit laesst sich
      // von aussen nicht nur zaehlen, WIE VIELE root-Prozesse es insgesamt
      // gab, sondern wie viele GLEICHZEITIG liefen — und nur das ist die
      // Frage bei einem Endpunkt ohne Anmeldung.
      `marke=${JSON.stringify(sudoLaeuft)}/$$; : > "$marke"`,
      `trap 'rm -f "$marke"' EXIT`,
      'sleep 0.3',
      `for a in "$@"; do printf 'ARG %s\\n' "$a" >> ${JSON.stringify(sudoLog)}; done`,
      'if [ "$1" = "-n" ] && [ "$2" = "tee" ]; then',
      // Wie root: schreiben DARF er, aber die Rechte der Datei bleiben danach,
      // wie sie waren — sonst misst der nächste Durchgang den Doppelgänger
      // statt den Server (die Datei wäre plötzlich für jeden schreibbar).
      traegt
        ? '  m=$(stat -c %a "$3"); chmod u+w "$3"; cat > "$3"; chmod "$m" "$3"; exit 0'
        : '  echo "sudo: a password is required" >&2; exit 1',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
  )
  chmodSync(p, 0o755)
  writeFileSync(sudoLog, '')
  for (const d of [sudoZaehler, sudoLaeuft]) {
    rmSync(d, { recursive: true, force: true })
    mkdirSync(d, { recursive: true })
  }
  return { PATH: `${schuhe}:${process.env.PATH}` }
}

buehneBauen()
console.log(`Bühne: ${ordner}`)
console.log(`Server: ${basis}\n`)

try {
  // ══ LAUF A — der normale Weg (die Datei ist schreibbar, kein sudo nötig) ══
  if (!(await serverStarten(sudoDoppelgaenger(true)))) {
    console.log('Der Server ist nicht hochgekommen:')
    console.log(mitschrift.join('').slice(-3000))
    await aufraeumen(1)
  }

  console.log('1. EINSCHUSS — was aus der Anfrage in einen Pfad oder eine Shell wandern könnte')
  await setz(60)
  const vorAbzug = abzug()
  const nutzlasten = [
    '60; touch /tmp/mupi-loch-beweis',
    '60`touch /tmp/mupi-loch-beweis`',
    '60$(touch /tmp/mupi-loch-beweis)',
    '60\n255',
    '60 && echo x',
    '60|tee /tmp/mupi-loch-beweis',
    '../../../../etc/passwd',
    '/etc/passwd',
    `${ordner}/beute.txt`,
    '../beute.txt',
    '..',
    './',
    'brightness',
    'bl_power',
    '../../../beute.txt\0',
    '0x40',
    '4e1',
    '  60  ',
    '+60',
    '60%',
    'Infinity',
    '-Infinity',
    'NaN',
    '1e400',
    '9007199254740993',
    -0,
    0,
    19,
    100.4,
    101,
    true,
    null,
    [60],
    { valueOf: 60 },
  ]
  let abgelehnt = 0
  let fuenfhundert = 0
  for (const n of nutzlasten) {
    const a = await setz(n)
    if (a.status >= 500) fuenfhundert++
    if (a.status === 400) abgelehnt++
    // Angenommen werden darf NUR, was auch als Zahl 20..100 lesbar ist.
    const zahl = Number(n)
    const erlaubt =
      typeof n !== 'object' && n !== null && n !== true && Number.isFinite(zahl) && zahl >= 19.5 && zahl <= 100.4
    if (a.status === 200 && !erlaubt) {
      pruefe(`${JSON.stringify(n)} wird NICHT angenommen`, false, a)
    }
  }
  console.log(`     ${nutzlasten.length} Nutzlasten: ${abgelehnt} mit 400 abgelehnt, ${fuenfhundert} mit 5xx`)
  // Die meisten dieser Nutzlasten SIND Unsinn. Kaeme kaum eine 400 zurueck,
  // waere die Pruefung selbst kaputt und der Rest des Abschnitts wertlos —
  // dann wuerde hier gemessen, dass ein Endpunkt nichts tut.
  pruefe('der weitaus groesste Teil wird ueberhaupt abgelehnt', abgelehnt >= nutzlasten.length - 8, abgelehnt)
  pruefe('keine einzige Nutzlast erzeugt einen 5xx', fuenfhundert === 0, fuenfhundert)
  pruefe('der Server lebt noch', (await get()).status === 200)
  pruefe(
    'in der Gerätedatei steht danach eine nackte Zahl',
    /^\d+$/.test(roh()) && Number(roh()) >= 51 && Number(roh()) <= 255,
    roh(),
  )
  pruefe('kein Beweisstück in /tmp entstanden', !lies('/tmp/mupi-loch-beweis'))

  console.log('\n2. NACHBARDATEIEN — nur brightness darf sich geändert haben')
  const nachAbzug = abzug()
  const geaendert = Object.keys(nachAbzug).filter((p) => nachAbzug[p] !== vorAbzug[p])
  const neuDazu = Object.keys(nachAbzug).filter((p) => !(p in vorAbzug))
  pruefe('bl_power ist unverändert 0', lies(blPower) === '0\n', lies(blPower))
  pruefe('max_brightness ist unverändert 255', lies(maxRoh) === '255\n', lies(maxRoh))
  pruefe('die Beutedatei ist unangetastet', lies(beute) === BEUTE_TEXT, lies(beute))
  pruefe(
    'geändert wurden nur brightness und die Konfiguration',
    geaendert.every((p) => p === brightness || p.startsWith(konfigPfad)),
    geaendert,
  )
  pruefe(
    'es sind keine unerwarteten Dateien entstanden',
    neuDazu.every((p) => p.startsWith(konfigPfad) || p.startsWith(join(ordner, 'tls'))),
    neuDazu,
  )

  console.log('\n3. SYMLINK — in echtem sysfs sind die Einträge Verweise')
  unlinkSync(brightness)
  symlinkSync(beute, brightness)
  const symAntwort = await setz(80)
  const beuteDanach = lies(beute)
  console.log(
    `     brightness -> beute.txt, PUT 80 % => ${symAntwort.status}, beute.txt = ${JSON.stringify(beuteDanach)}`,
  )
  pruefe(
    'ein Symlink in der Gerätedatei wird VERFOLGT (bekannt, nur mit root im Backlight-Ordner erreichbar)',
    beuteDanach === '204\n',
    beuteDanach,
  )
  try {
    unlinkSync(brightness)
  } catch {
    /* egal */
  }
  writeFileSync(brightness, '204\n')
  writeFileSync(beute, BEUTE_TEXT)

  console.log('\n4. ZWEITES GERÄT — ein kaputter Eintrag neben einem guten Panel')
  const kaputt = join(wurzel, '10-0045')
  mkdirSync(kaputt, { recursive: true })
  // Kein max_brightness: genau der Fall „Eintrag da, aber nichts zu regeln".
  const mitKaputt = await get()
  pruefe('ein kaputter Nachbar-Eintrag nimmt dem echten Panel nicht die Sicht', mitKaputt.d?.da === true, mitKaputt.d)
  // Und derselbe Fall mit einem Eintrag, der NUR eine Datei ist.
  rmSync(kaputt, { recursive: true, force: true })
  writeFileSync(join(wurzel, '09-0045'), 'kein Ordner\n')
  const mitDatei = await get()
  pruefe('eine Datei im Backlight-Ordner nimmt dem Panel nicht die Sicht', mitDatei.d?.da === true, mitDatei.d)
  rmSync(join(wurzel, '09-0045'), { force: true })

  console.log('\n5. NEBENLÄUFIGKEIT — gleichzeitige Schreiber auf mupiboxconfig.json')
  // 5a) Nur der Helligkeitsweg gegen sich selbst.
  await setz(60)
  for (let runde = 0; runde < 4; runde++) {
    await Promise.all([...Array(16)].map((_, i) => setz(i % 2 === 0 ? 100 : 40)))
    await schlafen(120)
  }
  const pruefeKonfigHeil = (was) => {
    let ok = true
    let fehler = ''
    try {
      const k = JSON.parse(konfigText())
      ok = typeof k?.mupibox?.startVolume === 'string' && typeof k?.timeout?.idleDisplayOff === 'string'
    } catch (e) {
      ok = false
      fehler = String(e?.message ?? e)
    }
    pruefe(was, ok, fehler || konfigText().slice(-140))
    return ok
  }
  pruefeKonfigHeil('die Konfiguration bleibt gültiges JSON, wenn nur die Helligkeit gleichzeitig schreibt')
  // Und schärfer: der Inhalt muss GENAU eine der beiden erwarteten Fassungen
  // sein. Ein Gemisch aus zwei Schreibern parst womöglich noch (die Fassungen
  // unterscheiden sich nur um ein Zeichen) und ist trotzdem falsch.
  const erwartet = ['100', '40'].map(
    (p) =>
      `${JSON.stringify(
        {
          mupibox: { host: 'MuPiBox', startVolume: '40', maxVolume: '100', displayBrightness: p },
          interfacelogin: { state: false, password: '' },
          timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
        },
        null,
        4,
      )}\n`,
  )
  pruefe(
    'und sie ist Zeichen für Zeichen eine der beiden erwarteten Fassungen',
    erwartet.includes(konfigText()),
    `${konfigText().length} Bytes (erwartet ${erwartet.map((e) => e.length).join('/')}): ${JSON.stringify(konfigText())}`,
  )

  // 5b) DER TEURE FALL: der Helligkeitsweg gegen einen ANDEREN Schreiber
  // derselben Datei. Beide legen sie über denselben Zwischennamen `.neu` an.
  // Hier unterscheiden sich die Fassungen um hunderte Bytes — ein Gemisch ist
  // dann kein gültiges JSON mehr, und das ist die ZENTRALE Konfiguration.
  const langerName = `Box-${'n'.repeat(400)}`
  const konfigSetzen = (name) =>
    fetch(`${basis}/api/konfiguration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then((r) => r.status)
  let kaputtNach = 0
  for (let runde = 0; runde < 12 && kaputtNach === 0; runde++) {
    await Promise.all([
      konfigSetzen(runde % 2 === 0 ? langerName : 'MuPiBox'),
      setz(100),
      setz(40),
      konfigSetzen(runde % 2 === 0 ? 'MuPiBox' : langerName),
      setz(60),
    ])
    try {
      JSON.parse(konfigText())
    } catch {
      kaputtNach = runde + 1
    }
  }
  pruefe(
    'die Konfiguration überlebt den Helligkeitsweg NEBEN einem anderen Schreiber',
    kaputtNach === 0,
    kaputtNach ? `zerstört in Runde ${kaputtNach}: …${konfigText().slice(-160)}` : undefined,
  )
  if (kaputtNach) {
    buehneBauen()
    await schlafen(100)
  }
  pruefe('es liegt keine halbe Datei .neu herum', !lies(`${konfigPfad}.neu`), lies(`${konfigPfad}.neu`)?.slice(0, 60))

  console.log('\n6. GROSSER RUMPF — greift die Grenze von 4 kB an diesem Weg?')
  // Am Weg stand einmal `express.json({ limit: '4kb' })`. Das war wirkungslos:
  // ein globales app.use(express.json()) hat den Rumpf laengst gelesen, und
  // ein zweiter Aufbau steigt aus, wenn schon einer geparst hat. Es gilt also
  // die GLOBALE Grenze (100 kB) — hier festgehalten, damit niemand die 4 kB
  // wieder hinschreibt und sich darauf verlaesst.
  const dickAntwort = await setzRoh(JSON.stringify({ prozent: 60, fuellung: 'x'.repeat(60000) }))
  const sehrDick = await setzRoh(JSON.stringify({ prozent: 60, fuellung: 'x'.repeat(200000) }))
  console.log(`     60 kB Rumpf => ${dickAntwort.status}, 200 kB Rumpf => ${sehrDick.status}`)
  pruefe('es gilt die globale Grenze: 60 kB kommen durch …', dickAntwort.status === 200, dickAntwort.status)
  pruefe('… und ueber 100 kB wird abgewiesen (413)', sehrDick.status === 413, sehrDick.status)

  await serverStoppen()

  // ══ LAUF B — die Datei gehört „root": der sudo-Weg ═══════════════════════
  console.log('\n7. sudo — die Datei gehört „root", der zweite Weg muss tragen')
  buehneBauen()
  const umgebung = sudoDoppelgaenger(true)
  chmodSync(brightness, 0o444)
  if (!(await serverStarten(umgebung))) {
    console.log('Der Server ist nicht hochgekommen (Lauf B):')
    console.log(mitschrift.join('').slice(-3000))
    await aufraeumen(1)
  }
  // Beim Start hat helligkeitBeimStart schon einmal geschrieben — der Zähler
  // wird deshalb HIER auf null gesetzt, nicht vor dem Start.
  const startAufrufe = readdirSync(sudoZaehler).length
  console.log(`     beim Start des Servers: ${startAufrufe} sudo-Aufruf(e) (helligkeitBeimStart)`)
  // Erst wenn der Start wirklich durch ist, wird gezaehlt — sonst faellt sein
  // Aufruf in die Messung des naechsten PUT.
  await schlafen(800)
  writeFileSync(sudoLog, '')
  for (const d of [sudoZaehler, sudoLaeuft]) {
    rmSync(d, { recursive: true, force: true })
    mkdirSync(d, { recursive: true })
  }
  const sudoAntwort = await setz(40)
  await schlafen(250)
  const log = lies(sudoLog) ?? ''
  const argzeilen = log.split('\n').filter((z) => z.startsWith('ARG '))
  console.log(`     sudo bekam: ${JSON.stringify(argzeilen)}`)
  pruefe('der sudo-Weg trägt (200)', sudoAntwort.status === 200, sudoAntwort)
  pruefe('ein PUT löst genau EINEN sudo-Aufruf aus', argzeilen.length === 3, argzeilen)
  pruefe('darunter kein -c und keine Shell', !log.includes('ARG -c') && !/ARG .*sh$/.test(log), argzeilen)
  pruefe('der Pfad zeigt auf brightness des gefundenen Panels', argzeilen[2] === `ARG ${brightness}`, argzeilen[2])
  pruefe('der Wert steht danach in der Datei', lies(brightness)?.trim() === '102', lies(brightness))

  console.log('\n   … und wie viele Prozesse ein Ansturm auslöst')
  for (const d of [sudoZaehler, sudoLaeuft]) {
    rmSync(d, { recursive: true, force: true })
    mkdirSync(d, { recursive: true })
  }
  let hoechststand = 0
  const wache = setInterval(() => {
    try {
      hoechststand = Math.max(hoechststand, readdirSync(sudoLaeuft).length)
    } catch {
      /* der Ordner wird gerade neu gebaut */
    }
  }, 20)
  const sturm = Promise.all([...Array(40)].map(() => setz(60)))
  const antworten = await sturm
  clearInterval(wache)
  await schlafen(500)
  const aufrufe = readdirSync(sudoZaehler).length
  console.log(`     40 gleichzeitige PUTs => ${aufrufe} sudo-Prozesse, höchstens ${hoechststand} davon gleichzeitig`)
  pruefe(
    'alle 40 bekommen eine Antwort',
    antworten.every((a) => a.status === 200),
    antworten.map((a) => a.status),
  )
  pruefe(
    'nie mehr als EIN root-Prozess gleichzeitig (sonst ist der Regler ein Hebel zum Prozesse-Erzeugen)',
    hoechststand <= 1,
    hoechststand,
  )

  await serverStoppen()

  // ══ LAUF C — sudo scheitert sofort ═══════════════════════════════════════
  console.log('\n8. sudo scheitert sofort (keine passwortlose Erlaubnis) — überlebt der Server das?')
  buehneBauen()
  chmodSync(brightness, 0o444)
  if (!(await serverStarten(sudoDoppelgaenger(false)))) {
    console.log('Der Server ist nicht hochgekommen (Lauf C):')
    console.log(mitschrift.join('').slice(-3000))
    await aufraeumen(1)
  }
  const scheitern = []
  for (let i = 0; i < 25; i++) scheitern.push(await setz(60).catch((e) => ({ status: 0, d: String(e) })))
  const fuenfhundert2 = scheitern.filter((a) => a.status === 500).length
  console.log(`     25 Versuche => Antworten: ${JSON.stringify([...new Set(scheitern.map((a) => a.status))])}`)
  pruefe('jeder Versuch bekommt eine 500 (statt eines Abbruchs)', fuenfhundert2 === 25, fuenfhundert2)
  const lebt = await get().catch(() => ({ status: 0 }))
  pruefe('der Server lebt danach noch', lebt.status === 200, lebt.status)
  pruefe(
    'keine unbehandelte Ausnahme in der Mitschrift',
    !/uncaughtException|EPIPE|Unhandled/i.test(mitschrift.join('')),
    mitschrift.join('').match(/(uncaughtException|EPIPE|Unhandled)[^\n]*/i)?.[0],
  )

  await aufraeumen(schlecht === 0 ? 0 : 1)
} catch (err) {
  console.log(`Abbruch: ${err?.stack || err}`)
  console.log(mitschrift.join('').slice(-2000))
  await aufraeumen(1)
}
