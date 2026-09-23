#!/usr/bin/env node
/**
 * DER HELLIGKEITS-WEG GEGEN EINEN ECHTEN SERVER — ohne Box und ohne dass
 * irgendein Bildschirm dunkel wird.
 *
 * WARUM ES DIESEN LAUF GIBT, obwohl die Formel geprüft ist und der Endpunkt
 * einen Integrationstest hat: hier läuft ein WIRKLICHER Serverprozess auf einem
 * eigenen Port, über echtes HTTP angesprochen, mit einem nachgestellten
 * /sys/class/backlight daneben. Damit wird die eine Sache prüfbar, die weder
 * eine reine Rechnung noch supertest zeigt:
 *
 *   DER WEG NACH DEM NEUSTART. Der Kernel stellt das Hintergrundlicht beim
 *   Hochfahren auf seinen Vorgabewert zurück. Ob die gemerkte Einstellung
 *   danach wirklich wieder im GERÄT landet, entscheidet sich beim Start des
 *   Prozesses — also genau dort, wo ein In-Prozess-Test schon vorbei ist.
 *
 * Und die zweite: dass eine abgelehnte Anfrage nicht nur eine 400 zurückgibt,
 * sondern in der Gerätedatei nichts verändert. Ein Test, der nur die Formel
 * prüft, hätte beides nicht gefunden.
 *
 * FAHREN (ändert nichts an dieser Maschine, alles in einem Ordner unter /tmp):
 *
 *   node tools/schirmhelligkeit-am-server.mjs
 *   node tools/schirmhelligkeit-am-server.mjs --port 9931
 *
 * GEGEN EINE ECHTE BOX, NUR LESEND (setzt nichts, dimmt nichts):
 *
 *   node tools/schirmhelligkeit-am-server.mjs --ziel http://192.168.178.169:8200
 *
 * Rückgabewert 0 = alles grün, 1 = mindestens eine Aussage falsch.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = dirname(fileURLToPath(import.meta.url))
const BACKEND = join(HIER, '..', 'src', 'backend-api')

/** Das Panel der Box, wie am 07.08.2026 an .169 gemessen (nur gelesen). */
const GERAET = '11-0045'
/** Womit der Lauf startet — und was nach dem Start dastehen MUSS. */
const GEMERKT_PROZENT = 30

const args = process.argv.slice(2)
const wert = (name, vorgabe) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : vorgabe
}
const PORT = Number(wert('--port', '9931'))
const ZIEL = wert('--ziel', '')

let gut = 0
let schlecht = 0
function pruefe(behauptung, bedingung, gesehen) {
  if (bedingung) {
    gut++
    console.log(`  ok    ${behauptung}`)
  } else {
    schlecht++
    console.log(`  FEHLT ${behauptung}${gesehen === undefined ? '' : `  — gesehen: ${JSON.stringify(gesehen)}`}`)
  }
}

const schlafen = (ms) => new Promise((f) => setTimeout(f, ms))

async function warteAufServer(basis, sekunden = 40) {
  for (let i = 0; i < sekunden * 10; i++) {
    try {
      const r = await fetch(`${basis}/api/schirm/helligkeit`)
      if (r.ok) return true
    } catch {
      /* noch nicht da */
    }
    await schlafen(100)
  }
  return false
}

// ── NUR LESEN: gegen eine echte Box ────────────────────────────────────────
if (ZIEL) {
  console.log(`Nur lesend gegen ${ZIEL} — es wird nichts gesetzt.`)
  const r = await fetch(`${ZIEL}/api/schirm/helligkeit`)
  const d = await r.json()
  console.log(JSON.stringify(d, null, 2))
  pruefe('GET antwortet mit 200', r.status === 200, r.status)
  pruefe('die Antwort nennt eine Untergrenze > 0', typeof d.min === 'number' && d.min > 0, d.min)
  pruefe(
    'entweder ein Gerät mit Prozentwert oder eine Begründung',
    d.da === true ? typeof d.prozent === 'number' : typeof d.grund === 'string',
    d,
  )
  console.log(`\n${gut} richtig, ${schlecht} falsch.`)
  process.exit(schlecht === 0 ? 0 : 1)
}

// ── DIE BÜHNE: ein nachgestelltes /sys/class/backlight ──────────────────────
const ordner = mkdtempSync(join(tmpdir(), 'mupi-schirm-werkzeug-'))
const wurzel = join(ordner, 'backlight')
const panel = join(wurzel, GERAET)
const konfigPfad = join(ordner, 'mupiboxconfig.json')
const brightness = join(panel, 'brightness')

function panelBauen(roh = '255') {
  mkdirSync(panel, { recursive: true })
  writeFileSync(brightness, `${roh}\n`)
  writeFileSync(join(panel, 'max_brightness'), '255\n')
  writeFileSync(join(panel, 'bl_power'), '0\n')
}
const roh = () => readFileSync(brightness, 'utf8').trim()
const konfig = () => JSON.parse(readFileSync(konfigPfad, 'utf8'))

panelBauen('255')
writeFileSync(
  konfigPfad,
  JSON.stringify(
    {
      // MIT gemerktem Wert — genau die Lage nach einem Stromausfall: in der
      // Konfiguration stehen 30 %, im Gerät steht der Kernel-Vorgabewert 255.
      mupibox: { host: 'MuPiBox', startVolume: '40', maxVolume: '100', displayBrightness: String(GEMERKT_PROZENT) },
      interfacelogin: { state: false, password: '' },
      timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
    },
    null,
    2,
  ),
)

console.log(`Bühne: ${ordner}`)
console.log(`Server: http://127.0.0.1:${PORT}  (eigener Port, stört keine laufende Vorschau)\n`)

const kind = spawn('npx', ['tsx', 'src/server.ts'], {
  cwd: BACKEND,
  env: {
    ...process.env,
    // NICHT 'test' — sonst hört der Server gar nicht zu, und genau das
    // Zuhören ist hier der Prüfgegenstand.
    NODE_ENV: 'development',
    MUPIBOX_HTTP_PORT: String(PORT),
    MUPIBOX_BACKLIGHT: wurzel,
    MUPIBOX_CONFIG: konfigPfad,
    MUPIBOX_CONFIG_DIR: ordner,
    MUPIBOX_LOCK_DIR: ordner,
    MUPIBOX_TLS_DIR: join(ordner, 'tls'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const mitschrift = []
kind.stdout.on('data', (d) => mitschrift.push(String(d)))
kind.stderr.on('data', (d) => mitschrift.push(String(d)))

const basis = `http://127.0.0.1:${PORT}`
let fertig = false
async function aufraeumen(code) {
  if (fertig) return
  fertig = true
  kind.kill('SIGTERM')
  await schlafen(300)
  kind.kill('SIGKILL')
  rmSync(ordner, { recursive: true, force: true })
  process.exit(code)
}

try {
  if (!(await warteAufServer(basis))) {
    console.log('Der Server ist nicht hochgekommen. Mitschrift:')
    console.log(mitschrift.join('').slice(-3000))
    await aufraeumen(1)
  }

  // ── 1. Der Weg nach dem Neustart ────────────────────────────────────────
  console.log('1. Nach dem Start steht die GEMERKTE Helligkeit im Gerät')
  const erwartet = String(Math.round((GEMERKT_PROZENT / 100) * 255))
  pruefe(`Rohwert ist ${erwartet} (${GEMERKT_PROZENT} % von 255), nicht der Kernel-Vorgabewert 255`, roh() === erwartet, roh())

  // ── 2. Auskunft ─────────────────────────────────────────────────────────
  console.log('\n2. GET /api/schirm/helligkeit')
  const g = await (await fetch(`${basis}/api/schirm/helligkeit`)).json()
  pruefe('findet das Gerät', g.da === true && g.geraet === GERAET, g)
  pruefe(`zeigt ${GEMERKT_PROZENT} %`, g.prozent === GEMERKT_PROZENT, g.prozent)
  pruefe('nennt Untergrenze, Obergrenze und Schrittweite', g.min > 0 && g.max === 100 && g.schritt > 0, g)
  // `gemerktProzent`, nicht `gemerkt`: der Name trug frueher hier eine
  // Prozentzahl und im PUT einen Wahrheitswert. Siehe server.ts ueber dem GET.
  pruefe('sagt, was gemerkt ist', g.gemerktProzent === GEMERKT_PROZENT, g.gemerktProzent)
  pruefe('sagt, dass hier NICHT geklemmt wird', g.geklemmt === false, g)
  pruefe('nennt den echten, ungeklemmten Wert', g.prozentEcht === GEMERKT_PROZENT, g.prozentEcht)

  // ── 3. Setzen ───────────────────────────────────────────────────────────
  console.log('\n3. PUT setzt das Gerät UND merkt es sich')
  const setz = async (prozent) =>
    fetch(`${basis}/api/schirm/helligkeit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prozent }),
    })
  let r = await setz(40)
  pruefe('40 % -> 200', r.status === 200, r.status)
  pruefe('im Gerät steht der Rohwert 102, nicht die Prozentzahl', roh() === '102', roh())
  pruefe('in der Konfiguration steht "40" als Zeichenkette', konfig().mupibox.displayBrightness === '40', konfig().mupibox)
  pruefe('der Rest der Konfiguration ist unversehrt', konfig().mupibox.startVolume === '40' && konfig().timeout.idleDisplayOff === '10')
  r = await setz(100)
  pruefe('100 % ist wirklich ganz hell (255)', roh() === '255', roh())

  // ── 4. DIE SPERRE ───────────────────────────────────────────────────────
  console.log('\n4. Die Untergrenze — und dass dabei nichts geschrieben wird')
  await setz(60)
  const vorher = roh()
  for (const p of [0, 1, 19, -100, '0', 'hell', null, true]) {
    const a = await setz(p)
    pruefe(`${JSON.stringify(p)} wird abgelehnt (400)`, a.status === 400, a.status)
    pruefe(`… und das Gerät steht unverändert auf ${vorher}`, roh() === vorher, roh())
  }
  pruefe('auch gemerkt wurde nichts', konfig().mupibox.displayBrightness === '60', konfig().mupibox.displayBrightness)

  // ── 5. Hardware ohne Hintergrundlicht ───────────────────────────────────
  console.log('\n5. Eine Box ohne regelbares Hintergrundlicht (HDMI-Monitor)')
  rmSync(panel, { recursive: true, force: true })
  const ohne = await fetch(`${basis}/api/schirm/helligkeit`)
  const od = await ohne.json()
  pruefe('GET antwortet trotzdem mit 200', ohne.status === 200, ohne.status)
  pruefe('sagt da:false und nennt den Grund', od.da === false && typeof od.grund === 'string', od)
  const ablehnung = await setz(50)
  pruefe('PUT bekommt 409 (die Anfrage war in Ordnung, die Hardware kann es nicht)', ablehnung.status === 409, ablehnung.status)
  pruefe('der Server läuft danach weiter', (await fetch(`${basis}/api/schirm/helligkeit`)).status === 200)
  panelBauen('255')

  console.log(`\n${gut} richtig, ${schlecht} falsch.`)
  if (schlecht > 0) {
    console.log('\nMitschrift des Servers (Ende):')
    console.log(mitschrift.join('').slice(-2000))
  }
  await aufraeumen(schlecht === 0 ? 0 : 1)
} catch (err) {
  console.log(`Abbruch: ${err?.stack || err}`)
  console.log(mitschrift.join('').slice(-2000))
  await aufraeumen(1)
}
