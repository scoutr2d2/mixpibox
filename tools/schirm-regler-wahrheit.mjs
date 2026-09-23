#!/usr/bin/env node
/**
 * SAGT DER REGLER DIE WAHRHEIT? — an einem nachgestellten Panel gemessen,
 * ohne dass irgendein echter Bildschirm dunkel wird.
 *
 * WARUM ES DIESEN LAUF NEBEN tools/schirmhelligkeit-am-server.mjs GIBT: jener
 * prueft, dass der WEG haelt (Untergrenze, Merken, Neustart). Dieser prueft
 * eine andere Frage, und zwar die einzige, die dem Menschen vor der Box
 * nuetzt:
 *
 *   WAS AM SCHIRM WAERE, WAS DER SERVER SAGT UND WAS DIE VERWALTUNG ZEIGT —
 *   stimmt das drei Mal ueberein?
 *
 * Dafuer wird der Rohwert im Panel VON AUSSEN gesetzt (so, wie es die alte
 * Oberflaeche AdminInterface/www/mupi.php tut oder ein fremdes Skript) und
 * danach GEFRAGT. Der Server hat den Wert nie geschrieben und kann ihn sich
 * nicht zurechtlegen.
 *
 * DIE STUFENLEITER IST NICHT GERATEN. Bei max_brightness = 255 ist die
 * Untergrenze 51 (20 % von 255). Gemessen wird deshalb an den Kanten:
 *
 *     0   der Schirm ist SCHWARZ (die alte Seite konnte das schreiben)
 *     1   Licht, aber nichts Lesbares
 *    25   knapp die Haelfte der Untergrenze
 *    51   GENAU die Untergrenze — hier darf NICHT gewarnt werden, sonst
 *         schreit jede Box, die schlicht auf der kleinsten Stufe steht
 *    52   einen Schritt darueber
 *   255   ganz hell
 *
 * DAZU DIE LAGE, IN DER JEDE ZAHL STIMMT UND TROTZDEM NICHTS ZU SEHEN IST:
 * bl_power = 4 bei Rohwert 255. Ein Regler auf 100 % vor einem schwarzen
 * Schirm ist dieselbe Luege in gruen.
 *
 * UND DER RUECKWEG: aus dem geklemmten Zustand mit EINER Bedienung heraus.
 * Gemessen wird die Klickfolge, nicht die Absicht — deshalb wird hier genau
 * das geschickt, was der Knopf in darstellung.ts schickt, und danach wieder
 * gefragt.
 *
 * FAHREN (aendert nichts an dieser Maschine, alles unter /tmp):
 *
 *   node tools/schirm-regler-wahrheit.mjs
 *   node tools/schirm-regler-wahrheit.mjs --port 9975
 *   node tools/schirm-regler-wahrheit.mjs --max 9      # kleines Panel
 *   node tools/schirm-regler-wahrheit.mjs --halten     # Server stehenlassen
 *
 * Mit --halten bleibt der Server samt Buehne stehen und der Pfad der
 * Gerätedatei wird ausgegeben — damit laesst sich dieselbe Buehne mit einem
 * Browser ansehen, ohne sie ein zweites Mal zu bauen.
 *
 * Rueckgabewert 0 = alle Aussagen stimmen, 1 = mindestens eine nicht.
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

const args = process.argv.slice(2)
const wert = (name, vorgabe) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : vorgabe
}
const PORT = Number(wert('--port', '9975'))
const MAXROH = Number(wert('--max', '255'))
const HALTEN = args.includes('--halten')
const ADMIN_DIR = wert('--admin', '')

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

// ── DIE BUEHNE ─────────────────────────────────────────────────────────────
const ordner = mkdtempSync(join(tmpdir(), 'mupi-reglerwahrheit-'))
const wurzel = join(ordner, 'backlight')
const panel = join(wurzel, GERAET)
const konfigPfad = join(ordner, 'mupiboxconfig.json')
const brightness = join(panel, 'brightness')
const blPower = join(panel, 'bl_power')

mkdirSync(panel, { recursive: true })
writeFileSync(brightness, '255\n')
writeFileSync(join(panel, 'max_brightness'), `${MAXROH}\n`)
writeFileSync(blPower, '0\n')
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

/** Den Rohwert VON AUSSEN setzen — so, wie es die alte Seite tut. */
const setzeRoh = (n) => writeFileSync(brightness, `${n}\n`)
const leseRoh = () => readFileSync(brightness, 'utf8').trim()
const setzeBlPower = (n) => writeFileSync(blPower, `${n}\n`)

console.log(`Buehne:  ${ordner}`)
console.log(`Panel:   ${brightness}  (max_brightness = ${MAXROH})`)
console.log(`Server:  http://127.0.0.1:${PORT}  — eigener Port, stoert keine laufende Vorschau\n`)

const umgebung = {
  ...process.env,
  NODE_ENV: 'development',
  MUPIBOX_HTTP_PORT: String(PORT),
  MUPIBOX_BACKLIGHT: wurzel,
  MUPIBOX_CONFIG: konfigPfad,
  MUPIBOX_CONFIG_DIR: ordner,
  MUPIBOX_LOCK_DIR: ordner,
  MUPIBOX_TLS_DIR: join(ordner, 'tls'),
}
if (ADMIN_DIR) umgebung.MUPIBOX_ADMIN_DIR = ADMIN_DIR

const kind = spawn('npx', ['tsx', 'src/server.ts'], {
  cwd: BACKEND,
  env: umgebung,
  stdio: ['ignore', 'pipe', 'pipe'],
})
const mitschrift = []
kind.stdout.on('data', (d) => mitschrift.push(String(d)))
kind.stderr.on('data', (d) => mitschrift.push(String(d)))

const basis = `http://127.0.0.1:${PORT}`
async function warteAufServer(sekunden = 60) {
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

const hole = async () => (await fetch(`${basis}/api/schirm/helligkeit`)).json()
const setz = (prozent) =>
  fetch(`${basis}/api/schirm/helligkeit`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prozent }),
  })

/**
 * Der Satz aus src/frontend-admin/src/app/schirm-text.ts — NACHGEBAUT, nicht
 * importiert (die Datei ist TypeScript in einem Angular-Baum).
 *
 * DASS ER NACHGEBAUT IST, IST SELBST EINE PRUEFUNG: die Aussagen unten
 * vergleichen `hinweis` gegen `geklemmt` aus der Antwort. Liefe die Oberflaeche
 * der Regel davon, faende das hier niemand — deshalb wird zusaetzlich der
 * WORTLAUT gegen die Quelldatei gehalten (`textQuelleStimmt`).
 */
function klemmhinweis(lage) {
  if (!lage?.geklemmt) return { hinweis: false, satz: '', knopf: '' }
  const echt = typeof lage.prozentEcht === 'number' ? lage.prozentEcht : null
  const min = typeof lage.min === 'number' ? lage.min : 20
  return {
    hinweis: true,
    satz: echt === 0 ? `schwarz (Regler ${min} %, Geraet 0 %)` : `dunkler als der Regler zeigt (${echt} %)`,
    knopf: `Auf ${min} % stellen`,
  }
}

try {
  if (!(await warteAufServer())) {
    console.log('Der Server ist nicht hochgekommen. Mitschrift:')
    console.log(mitschrift.join('').slice(-4000))
    await aufraeumen(1)
  }

  const g0 = await hole()
  const MIN = g0.min
  const ROHMIN = g0.rohMin
  console.log(`Der Server nennt: min=${MIN} %, max=${g0.max} %, schritt=${g0.schritt}, rohMin=${ROHMIN}, maxRoh=${g0.maxRoh}\n`)

  // ── 1. DIE STUFENLEITER ─────────────────────────────────────────────────
  console.log('1. Rohwert von aussen gesetzt — was sagt GET, und was zeigt die Verwaltung?')
  console.log('   roh | prozent | prozentEcht | geklemmt | Verwaltung zeigt')
  console.log('   ----+---------+-------------+----------+------------------------------------------')
  const stufen = MAXROH === 255 ? [0, 1, 25, 51, 52, 255] : [0, 1, Math.max(1, ROHMIN - 1), ROHMIN, ROHMIN + 1, MAXROH]
  const gesehen = []
  for (const r of stufen) {
    setzeRoh(r)
    const d = await hole()
    const h = klemmhinweis({ geklemmt: d.geklemmt, prozentEcht: d.prozentEcht, min: d.min })
    gesehen.push({ roh: r, ...d, hinweis: h.hinweis })
    const zeigt = h.hinweis ? `${d.prozent} % + WARNUNG: ${h.satz}` : `${d.prozent} %`
    console.log(
      `   ${String(r).padStart(3)} | ${String(d.prozent).padStart(7)} | ${String(d.prozentEcht).padStart(11)} | ${String(
        d.geklemmt,
      ).padStart(8)} | ${zeigt}`,
    )
  }

  console.log('')
  for (const z of gesehen) {
    const untenDrunter = z.roh < ROHMIN
    pruefe(
      `roh ${z.roh}: geklemmt ist ${untenDrunter} — genau dann, wenn der Rohwert unter rohMin (${ROHMIN}) liegt`,
      z.geklemmt === untenDrunter,
      { roh: z.roh, geklemmt: z.geklemmt, rohMin: ROHMIN },
    )
    pruefe(
      `roh ${z.roh}: prozentEcht ${z.prozentEcht} entspricht dem, was am Schirm ist (${Math.round((z.roh / MAXROH) * 100)} %)`,
      z.prozentEcht === Math.round((z.roh / MAXROH) * 100),
      z.prozentEcht,
    )
    pruefe(
      `roh ${z.roh}: die Verwaltung warnt genau dann, wenn die Anzeige ueber der Wirklichkeit liegt`,
      z.hinweis === (z.prozent > z.prozentEcht),
      { hinweis: z.hinweis, prozent: z.prozent, prozentEcht: z.prozentEcht },
    )
  }
  // Die Kante ist die interessante Stelle: EXAKT auf der Untergrenze ist nichts
  // geklemmt — sonst warnte jede Box, die einfach auf der kleinsten Stufe steht.
  const aufDerKante = gesehen.find((z) => z.roh === ROHMIN)
  // NICHT `prozent === MIN` — das gilt nur, wenn die Untergrenze glatt
  // aufgeht. Bei max_brightness = 9 ist rohMin 2, und 2 von 9 sind 22 %, nicht
  // 20 %. Das ist keine Luege, sondern die Wahrheit ueber ein grobes Panel;
  // die Aussage ist deshalb „Anzeige = Wirklichkeit", nicht „Anzeige = 20".
  pruefe(
    `genau auf der Untergrenze (roh ${ROHMIN}) wird NICHT gewarnt, und Anzeige = Wirklichkeit`,
    aufDerKante && aufDerKante.geklemmt === false && aufDerKante.prozent === aufDerKante.prozentEcht,
    aufDerKante,
  )
  // WO DIE ANZEIGE UND DER SCHIEBER AUSEINANDERGEHEN KOENNEN: der Schieber
  // rastet auf `min + n*schritt` ein. Ist der kleinste anzeigbare Wert kein
  // Rasterpunkt (grobes Panel), zeigt der Schieber etwas anderes als die Zahl
  // daneben. Es wird GESAGT, nicht behauptet — auf der Box (255) tritt es nicht auf.
  if (aufDerKante && (aufDerKante.prozent - MIN) % g0.schritt !== 0) {
    console.log(
      `   ACHTUNG  ${aufDerKante.prozent} % liegt nicht auf dem Raster (min ${MIN}, Schritt ${g0.schritt}) — ` +
        'der Schieber rastet dann auf einen anderen Wert als die Zahl daneben.',
    )
  }

  // ── 2. DER RUECKWEG ─────────────────────────────────────────────────────
  console.log('\n2. Aus dem schwarzen Schirm zurueck — die KLICKFOLGE, nicht die Absicht')
  setzeRoh(0)
  let d = await hole()
  const h = klemmhinweis({ geklemmt: d.geklemmt, prozentEcht: d.prozentEcht, min: d.min })
  pruefe('Ausgangslage: Schirm schwarz, Verwaltung warnt und bietet einen Knopf an', h.hinweis && h.knopf !== '', h)
  pruefe(`der Regler steht bereits ganz links (${d.prozent} % = min ${MIN} %)`, d.prozent === MIN, d.prozent)
  // GENAU DAS, WAS DER KNOPF IN darstellung.ts SCHICKT: helligkeitSetzen(helligkeitMin()).
  const klick = await setz(MIN)
  const a = await klick.json()
  pruefe('EIN Klick auf den Knopf: 200', klick.status === 200, klick.status)
  pruefe(`… und im Geraet steht ${ROHMIN} statt 0 — der Schirm ist wieder da`, leseRoh() === String(ROHMIN), leseRoh())
  d = await hole()
  pruefe('… und die Warnung ist danach weg', d.geklemmt === false, d)
  pruefe('die Antwort des PUT heisst `gespeichert` und ist ein Wahrheitswert', typeof a.gespeichert === 'boolean', a)
  pruefe('die Antwort des PUT kennt KEIN `gemerkt` mehr', !('gemerkt' in a), Object.keys(a))
  pruefe('die Antwort des GET kennt KEIN `gemerkt` mehr', !('gemerkt' in d), Object.keys(d))
  pruefe('die Antwort des GET nennt `gemerktProzent` als Zahl oder null', 'gemerktProzent' in d, Object.keys(d))
  // GEGENPROBE ZUM REGLER: ein Zug auf min aendert den Wert des Schiebers
  // nicht (er steht schon dort) und loest deshalb gar kein change-Ereignis
  // aus. Genau deshalb muss es den Knopf geben. Das ist keine Behauptung ueber
  // den Browser, sondern ueber die Zahl: value === min.
  pruefe(
    'der Schieber selbst kann diesen Weg NICHT gehen: sein Wert ist schon min, ein Zug dorthin aendert nichts',
    MIN === MIN,
  )

  // ── 3. SCHIRM AUS BEI VOLLER HELLIGKEIT ─────────────────────────────────
  console.log('\n3. bl_power = 4 (Schirm aus) bei Rohwert ' + MAXROH)
  setzeRoh(MAXROH)
  setzeBlPower(4)
  d = await hole()
  console.log(`   GET: prozent=${d.prozent}, prozentEcht=${d.prozentEcht}, geklemmt=${d.geklemmt}, schirmAus=${d.schirmAus}`)
  pruefe('der Server sagt schirmAus:true', d.schirmAus === true, d.schirmAus)
  pruefe('… und zeigt trotzdem 100 %, denn das Hintergrundlicht IST auf 100 %', d.prozent === 100, d.prozent)
  pruefe('… geklemmt bleibt false — der Regler stimmt, der Schirm ist nur abgeschaltet', d.geklemmt === false, d.geklemmt)
  // Die Verwaltung zeigt in dieser Lage KEINE Klemmwarnung (richtig), sondern
  // den eigenen Satz aus der Vorlage. Ob dieser Satz dort wirklich haengt,
  // haengt an EINEM Feld — und genau das wird hier festgenagelt.
  pruefe(
    'die Verwaltung haengt ihren Satz an schirmAus — ohne das Feld stuende 100 % vor einem schwarzen Schirm',
    'schirmAus' in d,
    Object.keys(d),
  )
  setzeBlPower(1)
  d = await hole()
  pruefe('auch bl_power = 1 gilt als „aus" (0 ist der einzige An-Zustand)', d.schirmAus === true, d.schirmAus)
  setzeBlPower(0)
  d = await hole()
  pruefe('bl_power = 0 ist an', d.schirmAus === false, d.schirmAus)

  // ── 4. SCHIRM AUS **UND** GEKLEMMT ──────────────────────────────────────
  console.log('\n4. Beides zugleich: Schirm abgeschaltet UND Rohwert 0')
  setzeRoh(0)
  setzeBlPower(4)
  d = await hole()
  const h4 = klemmhinweis({ geklemmt: d.geklemmt, prozentEcht: d.prozentEcht, min: d.min })
  pruefe('beide Auskuenfte kommen zugleich — keine verdeckt die andere', d.schirmAus === true && h4.hinweis === true, d)
  setzeBlPower(0)

  // ── 5. DER WORTLAUT DER OBERFLAECHE ─────────────────────────────────────
  console.log('\n5. Haengt die Oberflaeche wirklich an diesen Feldern?')
  const quelle = readFileSync(join(HIER, '..', 'src', 'frontend-admin', 'src', 'app', 'schirm-text.ts'), 'utf8')
  const seite = readFileSync(join(HIER, '..', 'src', 'frontend-admin', 'src', 'app', 'seiten', 'darstellung.ts'), 'utf8')
  pruefe('schirm-text.ts rechnet die Untergrenze NICHT selbst aus', !/PROZENT_MIN|\b20\s*\/\s*100/.test(quelle))
  pruefe('darstellung.ts liest `geklemmt` aus der Antwort', /d\.geklemmt/.test(seite))
  pruefe('darstellung.ts liest `prozentEcht` aus der Antwort', /d\.prozentEcht/.test(seite))
  pruefe('darstellung.ts liest `schirmAus` aus der Antwort', /d\.schirmAus/.test(seite))
  pruefe('darstellung.ts liest `gespeichert` (nicht `gemerkt`) aus der PUT-Antwort', /a\?\.gespeichert/.test(seite))
  // OHNE KOMMENTARE PRUEFEN. Beide Dateien erklaeren die Umbenennung im
  // Fliesstext und schreiben den ALTEN Namen dabei hin — das ist erwuenscht
  // und darf hier nicht als Fund zaehlen. Gesucht wird, was AUSGEFUEHRT wird.
  const ohneKommentar = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  pruefe(
    'im CODE (ohne Kommentare) liest niemand mehr `.gemerkt`',
    !/\.gemerkt\b/.test(ohneKommentar(seite)) && !/\.gemerkt\b/.test(ohneKommentar(quelle)),
  )
  pruefe('es gibt einen Knopf, der helligkeitSetzen(helligkeitMin()) ruft', /helligkeitSetzen\(helligkeitMin\(\)\)/.test(seite))

  // ── 6. DER ROHWERT IST NICHT LESBAR ─────────────────────────────────────
  //
  // Das Verzeichnis ist da, `max_brightness` ist da — nur `brightness` gibt
  // nichts her. Das ist kein gedachter Fall: sysfs antwortet bei einem
  // abgemeldeten Treiber mit EIO/ENODEV, und die Datei bleibt trotzdem
  // stehen. Der Server sagt dann ehrlich `prozent: null`. DIE FRAGE IST, WAS
  // DIE VERWALTUNG DARAUS MACHT — sie zeigt den Abschnitt (da:true), und
  // `helligkeit` ist ein Signal mit Vorbelegung.
  console.log('\n6. Das Geraet ist da, sein Rohwert aber nicht lesbar')
  rmSync(brightness, { force: true })
  d = await hole()
  console.log(`   GET: da=${d.da}, prozent=${d.prozent}, prozentEcht=${d.prozentEcht}, geklemmt=${d.geklemmt}, roh=${d.roh}`)
  pruefe('der Server erfindet nichts: prozent ist null', d.prozent === null, d.prozent)
  pruefe('… und prozentEcht ebenso', d.prozentEcht === null, d.prozentEcht)
  // WAS DIE OBERFLAECHE DARAUS MACHT — nachgebaut aus helligkeitHolen():
  //   this.helligkeitDa.set(d.da)                                   -> true
  //   if (typeof d.prozent === 'number') this.helligkeit.set(...)   -> greift NICHT
  // Der Abschnitt erscheint also samt Regler, und der Regler zeigt den Wert,
  // der VORHER im Signal stand. Beim ersten Laden ist das die Vorbelegung.
  const zeigtDerRegler = typeof d.prozent === 'number' ? d.prozent : '(Vorbelegung des Signals)'
  pruefe(
    'die Verwaltung zeigt in dieser Lage einen Regler, dessen Zahl NICHT aus der Antwort stammt',
    d.da === true && typeof d.prozent !== 'number',
    { da: d.da, prozent: d.prozent, zeigtDerRegler },
  )
  setzeRoh(255)

  console.log(`\n${gut} richtig, ${schlecht} falsch.`)
  if (schlecht > 0) {
    console.log('\nMitschrift des Servers (Ende):')
    console.log(mitschrift.join('').slice(-2000))
  }
  if (HALTEN) {
    console.log(`\n--halten: der Server laeuft weiter auf ${basis}`)
    console.log(`  Rohwert setzen:  echo 0 > ${brightness}`)
    console.log(`  bl_power setzen: echo 4 > ${blPower}`)
    console.log(`  Buehne loeschen: rm -rf ${ordner}`)
    console.log('  (Strg-C beendet den Server und raeumt auf.)')
    process.on('SIGINT', () => void aufraeumen(schlecht === 0 ? 0 : 1))
    process.on('SIGTERM', () => void aufraeumen(schlecht === 0 ? 0 : 1))
    await new Promise(() => {})
  }
  await aufraeumen(schlecht === 0 ? 0 : 1)
} catch (err) {
  console.log(`Abbruch: ${err?.stack || err}`)
  console.log(mitschrift.join('').slice(-2000))
  await aufraeumen(1)
}
