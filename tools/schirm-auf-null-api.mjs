#!/usr/bin/env node
/**
 * KOMM DOCH AUF NULL — zweiter Weg: PUT /api/schirm/helligkeit.
 *
 * Schwesterwerkzeug zu tools/schirm-auf-null.mjs (dort: die alte PHP-Verwaltung).
 * Dieselbe Frage, anderes Tor: welche ZAHL steht am Ende in der Gerätedatei?
 *
 * ══ WAS HIER ANDERS GEMESSEN WIRD ALS IN DEN SPECS ══════════════════════════
 *
 * `schirmhelligkeit.spec.ts` prüft die Formeln, `…integration.spec.ts` den
 * Endpunkt im Prozess. Beide fassen den Rumpf der Anfrage schon fertig geparst
 * an. Hier geht ein WIRKLICHER HTTP-PUT über die Leitung, und zwar mit rohen
 * Rümpfen — damit auch das gemessen wird, was `express.json()` daraus macht:
 * doppelte Schlüssel im JSON, `null`, Arrays, Zahlen ausserhalb des
 * IEEE-Bereichs, Zeichenketten, die `Number()` überraschend annimmt.
 *
 * ══ DIE ZWEITE FRAGE: HÄLT DIE UNTERGRENZE AUCH BEI KLEINEM PANEL ═══════════
 *
 * Die Untergrenze ist nicht eine Zahl, sondern eine RECHNUNG über
 * `max_brightness`. Bei 255 sind 20 % ein Rohwert von 51. Bei einem Panel mit
 * `max_brightness` = 2 ergäbe dieselbe Rechnung gerundet 0 — und 0 ist genau
 * das, was nie herauskommen darf. Deshalb wird hier über mehrere Panelgrössen
 * gefahren und nach dem KLEINSTEN je geschriebenen Rohwert gesucht, nicht nach
 * einem Prozentwert.
 *
 * ══ WAS NICHT ANGEFASST WIRD ════════════════════════════════════════════════
 *
 * Kein echtes Panel, keine Box. Alles in einem Ordner unter /tmp, eigener Port.
 * `--ziel` fragt eine laufende Box NUR LESEND (GET), es wird nie gesetzt.
 *
 *   node tools/schirm-auf-null-api.mjs
 *   node tools/schirm-auf-null-api.mjs --port 9972
 *   node tools/schirm-auf-null-api.mjs --ziel http://192.168.178.169:8200   # nur GET
 *   node tools/schirm-auf-null-api.mjs --gegenprobe   # Untergrenze aushebeln
 */

import { spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const WURZEL = path.resolve(import.meta.dirname, '..')
const BACKEND = path.join(WURZEL, 'src', 'backend-api')

const argv = process.argv.slice(2)
const hat = (n) => argv.includes(n)
const wert = (n, v) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : v
}
const PORT = Number(wert('--port', '9972'))
const ZIEL = wert('--ziel', '')
const GEGENPROBE = hat('--gegenprobe')

const schlafen = (ms) => new Promise((f) => setTimeout(f, ms))

// ── Nur lesend gegen eine echte Box ─────────────────────────────────────────
if (ZIEL) {
  console.log(`NUR LESEND gegen ${ZIEL} — dieses Werkzeug setzt dort nichts.\n`)
  const r = await fetch(`${ZIEL}/api/schirm/helligkeit`)
  const d = await r.json()
  console.log(JSON.stringify(d, null, 2))
  console.log(`\nUntergrenze, die die Box nennt: ${d.min} %`)
  if (d.da) {
    console.log(`Rohwert im Gerät: ${d.roh ?? '(nicht genannt)'}   angezeigt: ${d.prozent} %`)
    if (d.geklemmt) console.log('ACHTUNG: die Box meldet `geklemmt` — der Schirm steht UNTER dem Regelbereich.')
  }
  process.exit(0)
}

// ── Bühne ───────────────────────────────────────────────────────────────────
const ordner = mkdtempSync(path.join(tmpdir(), 'schirm-auf-null-api-'))
const backlight = path.join(ordner, 'backlight')
const konfigPfad = path.join(ordner, 'mupiboxconfig.json')

/** Ein nachgestelltes Panel mit frei wählbarem `max_brightness`. */
function panelBauen(name, maxRoh, roh) {
  const p = path.join(backlight, name)
  mkdirSync(p, { recursive: true })
  writeFileSync(path.join(p, 'brightness'), `${roh}\n`)
  writeFileSync(path.join(p, 'max_brightness'), `${maxRoh}\n`)
  writeFileSync(path.join(p, 'bl_power'), '0\n')
  return p
}
const rohLesen = (name) => readFileSync(path.join(backlight, name, 'brightness'), 'utf8').trim()

writeFileSync(
  konfigPfad,
  JSON.stringify(
    {
      mupibox: { host: 'MuPiBox', startVolume: '40', maxVolume: '100' },
      interfacelogin: { state: false, password: '' },
      timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
    },
    null,
    2,
  ),
)

/**
 * ══ DIE GEGENPROBE ══════════════════════════════════════════════════════════
 *
 * Ein Werkzeug, das nicht rot werden KANN, misst nichts. Diese Erfahrung ist in
 * diesem Lauf teuer bezahlt worden: der erste Versuch der Gegenprobe im
 * Schwesterwerkzeug blieb grün, weil die eingebaute Lücke gar keine war.
 *
 * Hier wird deshalb der Riegel selbst ausgehängt — `rohUntergrenze` liefert
 * dann 0 statt `max(1, …)`, und `prozentZuRoh` darf bis 0 hinunter.
 *
 * AUF EINER KOPIE, NICHT IM BAUM: `src/backend-api/src/schirmhelligkeit.ts`
 * gehört gerade einer anderen Sitzung. Kopiert wird nur `src/` und die
 * Konfiguration; `node_modules` wird verlinkt, nicht dupliziert.
 *
 * WARUM DIE KOPIE IM REPO LIEGT UND NICHT UNTER /tmp (gemessen, nicht
 * vermutet): die Abhängigkeiten dieses Projekts sind in das WURZEL-node_modules
 * hochgezogen — `bcryptjs` liegt in `<wurzel>/node_modules`, nicht in
 * `src/backend-api/node_modules`. Eine Kopie unter /tmp bricht deshalb sofort
 * mit ERR_MODULE_NOT_FOUND ab, und der Lauf sähe dann aus wie ein Befund
 * („kein Gerät gefunden"), obwohl nur der Server nicht startete. Ein Ordner
 * INNERHALB des Baums lässt Node beim Hochlaufen auf `<wurzel>/node_modules`
 * stossen. Der Ordner beginnt mit einem Punkt und wird am Ende gelöscht.
 */
function backendKopieren() {
  const ziel = mkdtempSync(path.join(WURZEL, '.gegenprobe-schirm-'))
  cpSync(path.join(BACKEND, 'src'), path.join(ziel, 'src'), { recursive: true })
  for (const datei of ['package.json', 'tsconfig.json']) {
    try {
      cpSync(path.join(BACKEND, datei), path.join(ziel, datei))
    } catch {
      /* nicht jede Datei muss es geben */
    }
  }
  symlinkSync(path.join(BACKEND, 'node_modules'), path.join(ziel, 'node_modules'), 'dir')

  const regelDatei = path.join(ziel, 'src', 'schirmhelligkeit.ts')
  const alt = readFileSync(regelDatei, 'utf8')
  const neu = alt
    .replace('return Math.max(1, Math.round((PROZENT_MIN / 100) * maxRoh))', 'return 0')
    .replace('return Math.min(PROZENT_MAX, Math.max(PROZENT_MIN, Math.round(prozent)))', 'return Math.round(prozent)')
    .replace('if (g < PROZENT_MIN) {', 'if (false) {')
  if (neu === alt) throw new Error('Gegenprobe: keine der drei Sperren gefunden')
  writeFileSync(regelDatei, neu)
  console.log('GEGENPROBE: rohUntergrenze, klemmeProzent und pruefeProzent auf einer KOPIE ausgehaengt.\n')
  return ziel
}

const LAUFORT = GEGENPROBE ? backendKopieren() : BACKEND

let kind = null

/** Die GANZE Prozessgruppe beenden — siehe `detached` oben. */
function gruppeToeten() {
  if (!kind?.pid) return
  try {
    process.kill(-kind.pid, 'SIGKILL')
  } catch {
    try {
      kind.kill('SIGKILL')
    } catch {
      /* schon tot */
    }
  }
  kind = null
}
function aufraeumen() {
  gruppeToeten()
  rmSync(ordner, { recursive: true, force: true })
  if (GEGENPROBE && LAUFORT !== BACKEND) rmSync(LAUFORT, { recursive: true, force: true })
}
process.on('exit', aufraeumen)
process.on('SIGINT', () => process.exit(130))

async function serverStarten() {
  kind = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: LAUFORT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      MUPIBOX_HTTP_PORT: String(PORT),
      MUPIBOX_BACKLIGHT: backlight,
      MUPIBOX_CONFIG: konfigPfad,
      MUPIBOX_CONFIG_DIR: ordner,
      MUPIBOX_LOCK_DIR: ordner,
      MUPIBOX_TLS_DIR: path.join(ordner, 'tls'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    // EIGENE PROZESSGRUPPE, damit sie auch wieder GANZ weggeht. `npx` startet
    // einen Enkel, der den Port haelt; ein kill auf das Kind laesst ihn als
    // Waise stehen. Der naechste Lauf findet den Port dann besetzt und den
    // Server mit einer laengst geloeschten Buehne — und meldet „kein Panel".
    // Genau das ist hier einmal passiert.
    detached: true,
  })
  const mitschrift = []
  kind.stdout.on('data', (d) => mitschrift.push(String(d)))
  kind.stderr.on('data', (d) => mitschrift.push(String(d)))
  for (let i = 0; i < 600; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/schirm/helligkeit`)
      if (r.ok) {
        // ══ DAS TOR GEGEN EIN FALSCHES ROT ═══════════════════════════════════
        //
        // Ein Server, der das Panel gar nicht findet, beantwortet JEDEN PUT mit
        // 409 und schreibt nie. Der Lauf sähe dann aus wie „nichts wurde je zu
        // dunkel" — die beruhigendste aller Falschmeldungen. Genau das ist in
        // diesem Lauf einmal passiert (die Kopie startete nicht, siehe
        // backendKopieren). Deshalb wird hier nicht auf „antwortet" geprüft,
        // sondern auf „hat ein Gerät".
        const d = await r.json()
        if (d.da !== true) {
          throw new Error(
            `Der Server läuft, findet aber kein Panel (da=${d.da}, grund=${d.grund}).\n` +
              `Ohne Gerät misst dieser Lauf NICHTS. Abbruch statt gruen.\n${mitschrift.join('')}`,
          )
        }
        return mitschrift
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Der Server läuft')) throw e
      /* sonst: noch nicht da */
    }
    await schlafen(100)
  }
  throw new Error(`Server kam nicht hoch.\n${mitschrift.join('')}`)
}

/** PUT mit ROHEM Rumpf — express.json() soll ihn wirklich parsen. */
async function put(rumpf) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/schirm/helligkeit`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: rumpf,
  })
  let d = null
  try {
    d = await r.json()
  } catch {
    d = null
  }
  return { status: r.status, d }
}

// ── Die Fälle ───────────────────────────────────────────────────────────────
//
// Roher JSON-Text, damit auch doppelte Schlüssel und exotische Zahlen so
// ankommen, wie sie geschickt wurden.

const faelle = [
  ['{"prozent":0}', 'die nackte 0'],
  ['{"prozent":"0"}', '0 als Zeichenkette'],
  ['{"prozent":-0}', 'negative Null'],
  ['{"prozent":"-0"}', 'negative Null als Zeichenkette'],
  ['{"prozent":0.4}', '0.4 — rundet auf 0'],
  ['{"prozent":0.5}', '0.5 — rundet auf 1'],
  ['{"prozent":1e-9}', 'winziger Exponent'],
  ['{"prozent":5e-324}', 'kleinste darstellbare Zahl'],
  ['{"prozent":-1}', 'negativ'],
  ['{"prozent":-2147483648}', 'sehr negativ'],
  ['{"prozent":19}', 'knapp unter der Grenze'],
  ['{"prozent":19.4}', 'knapp unter, rundet ab'],
  ['{"prozent":19.5}', 'knapp unter, rundet AUF 20'],
  ['{"prozent":20,"prozent":0}', 'doppelter Schluessel — JSON nimmt den letzten'],
  ['{"prozent":null}', 'null'],
  ['{"prozent":true}', 'true'],
  ['{"prozent":false}', 'false'],
  ['{"prozent":[]}', 'leeres Array'],
  ['{"prozent":[0]}', 'Array mit 0'],
  ['{"prozent":{}}', 'Objekt'],
  ['{"prozent":""}', 'leere Zeichenkette'],
  ['{"prozent":" "}', 'nur ein Leerzeichen'],
  ['{"prozent":"  0  "}', '0 mit Leerzeichen'],
  ['{"prozent":"0x0"}', 'Hex-Null'],
  ['{"prozent":"0b0"}', 'Binaer-Null'],
  ['{"prozent":"0o0"}', 'Oktal-Null'],
  ['{"prozent":"1e-9"}', 'Exponent als Zeichenkette'],
  ['{"prozent":"0abc"}', 'Zahl mit Anhang'],
  ['{"prozent":"２０"}', 'Ziffern in voller Breite'],
  ['{"prozent":"-Infinity"}', 'minus unendlich als Zeichenkette'],
  ['{"prozent":1e400}', 'ueber IEEE hinaus — JSON macht Infinity daraus'],
  ['{"prozent":-1e400}', 'minus ueber IEEE hinaus'],
  ['{}', 'Feld fehlt'],
  ['{"Prozent":0}', 'falsch geschriebenes Feld'],
  ['{"prozent":0,"roh":0}', 'zusaetzlich ein roher Wunsch'],
  ['{"roh":0}', 'nur ein roher Wunsch — gibt es diesen Weg?'],
  ['{"prozent":20}', 'die Untergrenze selbst'],
  ['{"prozent":"20"}', 'Untergrenze als Zeichenkette'],
  ['{"prozent":100}', 'voll'],
]

// ── Lauf ────────────────────────────────────────────────────────────────────

console.log(`Server auf 127.0.0.1:${PORT} — eigener Port, eigene Buehne, keine Box.`)
console.log(`Buehne: ${ordner}\n`)

/**
 * DIE PANELGRÖSSEN. Nicht Kosmetik: die Untergrenze ist eine Rechnung über
 * max_brightness, und bei kleinen Werten rundet sie. Genau dort entsteht die 0,
 * wenn `rohUntergrenze` ihren `Math.max(1, …)` verlöre.
 */
const PANELS = [
  { name: '11-0045', max: 255, minErwartet: 51 },
  { name: '11-0045', max: 100, minErwartet: 20 },
  { name: '11-0045', max: 9, minErwartet: 2 },
  { name: '11-0045', max: 7, minErwartet: 1 },
  { name: '11-0045', max: 4, minErwartet: 1 },
  { name: '11-0045', max: 3, minErwartet: 1 },
  { name: '11-0045', max: 2, minErwartet: 1 },
]

const rot = []
let kleinsterRoh = Number.POSITIVE_INFINITY
let gesamtFaelle = 0

for (const panel of PANELS) {
  rmSync(backlight, { recursive: true, force: true })
  panelBauen(panel.name, panel.max, panel.max)
  if (kind) {
    gruppeToeten()
    await schlafen(500)
  }
  await serverStarten()

  let schlimmster = { roh: Number.POSITIVE_INFINITY, was: '' }
  for (const [rumpf, was] of faelle) {
    writeFileSync(path.join(backlight, panel.name, 'brightness'), `${panel.max}\n`)
    const { status } = await put(rumpf)
    const nachher = Number(rohLesen(panel.name))
    gesamtFaelle++
    if (Number.isFinite(nachher) && nachher < schlimmster.roh) schlimmster = { roh: nachher, was, status }
    if (nachher < 1) {
      rot.push({ panel: panel.max, was, rumpf, nachher, status })
    } else if (nachher < panel.minErwartet) {
      rot.push({ panel: panel.max, was, rumpf, nachher, status, unterErwartet: true })
    }
  }
  kleinsterRoh = Math.min(kleinsterRoh, schlimmster.roh)
  const anteil = ((schlimmster.roh / panel.max) * 100).toFixed(0)
  console.log(
    `max_brightness=${String(panel.max).padStart(3)}  kleinster je geschriebener Rohwert: ${String(schlimmster.roh).padStart(3)} (${anteil} %)  — erwartete Untergrenze ${panel.minErwartet}`,
  )
}

// ── Was GET über einen schon dunklen Schirm sagt ────────────────────────────
rmSync(backlight, { recursive: true, force: true })
panelBauen('11-0045', 255, 0)
// DIE KONFIGURATION ZURUECKSETZEN. Die 273 Anfragen oben haben bei jedem
// angenommenen PUT ein displayBrightness hineingeschrieben — die Buehne waere
// sonst nicht mehr die Lage einer Box im Feld, sondern eine, die sich etwas
// gemerkt hat. Dann misst dieser Abschnitt den falschen Zweig.
writeFileSync(
  konfigPfad,
  JSON.stringify({
    mupibox: { host: 'MuPiBox', startVolume: '40', maxVolume: '100' },
    interfacelogin: { state: false, password: '' },
    timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
  }),
)
gruppeToeten()
await schlafen(500)
await serverStarten()
// ══ HIER MUSS GEWARTET WERDEN, UND ZWAR AUS EINEM GRUND ═══════════════════
//
// `helligkeitBeimStart()` wird im Server mit `void` abgeschickt — der Port
// hört also schon zu, bevor am Gerät irgendetwas geschehen ist. Wer direkt
// nach der ersten erfolgreichen Antwort misst, liest den Wert VON VORHER und
// hält das für einen Befund. Genau das ist in diesem Lauf passiert: das
// Werkzeug meldete „wird nicht angehoben", während der Server es sehr wohl
// tat. Deshalb wird bis zur Änderung gewartet, mit einer Frist.
console.log('\nDer Start des Servers bei Rohwert 0 im Geraet:')
let nachStart = Number(rohLesen('11-0045'))
for (let i = 0; i < 100 && nachStart === 0; i++) {
  await schlafen(100)
  nachStart = Number(rohLesen('11-0045'))
}
console.log(`   Gerät steht nach dem Start auf: ${nachStart}`)
console.log('   (die Konfiguration dieser Buehne hat KEIN displayBrightness — wie jede echte Box)')

// ══ DER SCHIRM WIRD HINTER DEM SERVER HERUNTERGEDREHT ════════════════════
//
// Beim Start hebt der Server einen zu dunklen Schirm inzwischen an — dieser
// Abschnitt kaeme sonst gar nicht mehr an die Lage heran, die er messen soll.
// Sie entsteht aber weiterhin im BETRIEB: die alte /var/www/mupi.php schreibt
// mit einem POST eine 0 direkt in dieselbe Datei, ohne den Server zu fragen.
// Genau das wird hier nachgestellt.
writeFileSync(path.join(backlight, '11-0045', 'brightness'), '0\n')
const g = await (await fetch(`http://127.0.0.1:${PORT}/api/schirm/helligkeit`)).json()
console.log('\nEin Schirm, den jemand im Betrieb auf Rohwert 0 gedreht hat — was sagt GET?')
console.log(
  `   prozent=${g.prozent}  prozentEcht=${g.prozentEcht}  geklemmt=${g.geklemmt}  roh=${g.roh}  rohMin=${g.rohMin}`,
)
if (g.geklemmt !== true) rot.push({ was: 'GET verschweigt, dass der Schirm unter dem Regelbereich steht', nachher: g.prozent })


// ── Urteil ──────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(90)}`)
console.log(`${gesamtFaelle} Anfragen ueber ${PANELS.length} Panelgroessen. Kleinster je geschriebener Rohwert: ${kleinsterRoh}`)
if (rot.length === 0) {
  console.log('GRUEN — kein PUT brachte den Rohwert auf 0, bei keiner Panelgroesse.')
  if (nachStart === 0) {
    console.log('\nROT: ein Schirm, der schon auf 0 steht, wird beim Start NICHT angehoben.')
    console.log('     Genau diese Box holt am Geraet niemand mehr zurueck — und systemd-backlight')
    console.log('     traegt die 0 ueber jeden Neustart. Siehe helligkeitBeimStart() in server.ts.')
    process.exit(1)
  }
  console.log(`Ein Schirm auf Rohwert 0 wurde beim Start auf ${nachStart} angehoben — die Box holt sich selbst zurueck.`)
  process.exit(0)
}
console.log(`ROT — ${rot.length} Faelle:`)
for (const r of rot.slice(0, 30)) {
  console.log(`   max=${r.panel} ${r.was} (${r.rumpf}) -> Rohwert ${r.nachher}, HTTP ${r.status}`)
}
process.exit(1)
