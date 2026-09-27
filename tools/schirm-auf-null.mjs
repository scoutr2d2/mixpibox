#!/usr/bin/env node
/**
 * KOMM DOCH AUF NULL — der Versuch, den Bildschirm der Box schwarz zu bekommen.
 *
 * WAS DIESES WERKZEUG IST: kein Test der Absicht, sondern eine Messung des
 * Ergebnisses. Es fragt nicht „steht in mupi.php eine 0?", sondern „welche Zahl
 * steht am Ende in der Datei, die das Panel steuert?". Dazwischen liegt echtes
 * PHP, ein echter HTTP-Post (damit $_POST wirklich von PHP geparst wird, mit
 * Arrays, doppelten Feldern und %00), eine echte Shell und ein echtes Glob.
 *
 * ══ WARUM DAS NICHT ANDERS GEHT ═════════════════════════════════════════════
 *
 * Die gefaehrliche Zeile in AdminInterface/www/mupi.php lautet
 *
 *     sudo su - -c 'echo N > /sys/class/backlight/*​/brightness'
 *
 * Daran haengen vier Dinge, die man NICHT lesen kann, sondern ausfuehren muss:
 *
 *   1. PHPs Umgang mit $_POST — `is_numeric`, `(int)`, Arrays, doppelte Felder.
 *      Nachbauen heisst raten. Es laeuft hier echtes PHP.
 *   2. Die Shell. `su - -c` startet die LOGIN-SHELL von root. Auf der Box ist
 *      das /bin/bash (am 07.08.2026 gemessen: `getent passwd root` endet auf
 *      /bin/bash). Das ist load-bearing: **dash expandiert ein Glob im Ziel
 *      einer Umlenkung NICHT** — unter dash schluege die Zeile fehl, statt zu
 *      schreiben. Die Attrappe unten benutzt deshalb bash und nicht sh.
 *   3. Das Glob `*`. Bei GENAU EINEM Treffer schreibt bash brav. Bei ZWEI
 *      Treffern ist es in bash ein Fehler („ambiguous redirect") — die
 *      Helligkeit aendert sich dann gar nicht. Auch das wird hier gemessen.
 *   4. Der Anfangszustand. `if( $new_bn != $tboutput[0] )` vergleicht lose
 *      gegen den IST-Wert; ob eine Box, die schon auf 0 steht, wieder
 *      hochkommt, entscheidet diese Zeile.
 *
 * ══ WAS HIER NICHT ANGEFASST WIRD ═══════════════════════════════════════════
 *
 * KEIN echtes Panel. Der Container bekommt eine Attrappe unter
 * /sys/class/backlight bind-gemountet; die Box (192.168.178.169) wird von
 * diesem Werkzeug NIE beschrieben. `sudo` und `su` sind Attrappen im
 * Container-PATH — es gibt dort keine Rechteausweitung zu holen, und der Rest
 * von mupi.php (Konfiguration schreiben, dietpi-set_hardware, Neustart) wird
 * gar nicht erst ausgeschnitten.
 *
 * ══ DER AUSSCHNITT IST WOERTLICH ════════════════════════════════════════════
 *
 * Der PHP-Block wird ueber ANKERTEXT aus mupi.php geschnitten, nicht ueber
 * Zeilennummern und schon gar nicht abgetippt. Verschiebt sich die Datei,
 * findet der Anker weiter; verschwindet der Anker, sagt das Werkzeug das und
 * misst nicht heimlich etwas anderes.
 *
 * Abgefangen wird ausschliesslich `exec()`, und zwar ueber den
 * Namensraum-Trick: der Ausschnitt steht in `namespace Probe;` und ruft `exec`
 * unqualifiziert auf — PHP nimmt dann zuerst `Probe\exec()`. Am Ausschnitt
 * selbst ist dafuer KEIN Zeichen zu aendern.
 *
 * ══ AUFRUF ══════════════════════════════════════════════════════════════════
 *
 *   node tools/schirm-auf-null.mjs                 # alles
 *   node tools/schirm-auf-null.mjs --port 9971     # eigener Port (Vorgabe)
 *   node tools/schirm-auf-null.mjs --gegenprobe    # baut die 0 wieder ein und
 *                                                  # prueft, dass es rot wird
 *   node tools/schirm-auf-null.mjs --behalten      # Arbeitsordner stehenlassen
 *
 * Rueckgabewert 0 = der Schirm blieb in jedem Fall lesbar. 1 = es gibt einen
 * Weg auf Null (oder tiefer als die Untergrenze).
 */

import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const WURZEL = path.resolve(import.meta.dirname, '..')
const MUPI_PHP = path.join(WURZEL, 'AdminInterface', 'www', 'mupi.php')
const PHP_ABBILD = 'php:8.3-cli'

// ── Argumente ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const hat = (n) => argv.includes(n)
const wert = (n, vorgabe) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : vorgabe
}
const PORT = Number(wert('--port', '9971'))
const GEGENPROBE = hat('--gegenprobe')
const BEHALTEN = hat('--behalten')

// ── Der Ausschnitt: ueber Ankertext, nicht ueber Zeilennummern ──────────────

const ANKER_ANFANG = '// ══ DIE UNTERGRENZE DER BILDSCHIRMHELLIGKEIT'
const ANKER_ENDE = 'if( $data["mupibox"]["physicalDevice"]'
const ANKER_ANZEIGE_ANFANG = '$tbcommand = "cat /sys/class/backlight/*/brightness";'
const ANKER_ANZEIGE_ENDE = 'echo $new_bn;'

/**
 * Schneidet den Block zwischen zwei Ankern heraus — woertlich.
 * Findet ein Anker nicht, wird das gesagt und NICHT geraten.
 */
function schneide(zeilen, anfangEnthaelt, endeEnthaelt, abEnde = 0) {
  const a = zeilen.findIndex((z) => z.includes(anfangEnthaelt))
  if (a < 0) throw new Error(`Anker nicht gefunden: ${anfangEnthaelt}`)
  const e = zeilen.findIndex((z, i) => i > a && z.includes(endeEnthaelt))
  if (e < 0) throw new Error(`Anker nicht gefunden: ${endeEnthaelt}`)
  return zeilen.slice(a, e + abEnde).join('\n')
}

const ALTE_FASSUNG = hat('--alte-fassung')

/**
 * DIE ALTE FASSUNG AUS DER GESCHICHTE, nicht nachgebaut.
 *
 * Der staerkste Beleg dafuer, dass dieses Werkzeug ueberhaupt etwas sieht: es
 * bekommt die Datei vor dem Riegel (`a4c202f1^`) vorgesetzt und muss daran rot
 * werden. Ein Werkzeug, das den echten historischen Fehler nicht findet, findet
 * auch den naechsten nicht.
 */
function alteQuelle() {
  const txt = execFileSync('git', ['show', 'a4c202f1^:AdminInterface/www/mupi.php'], {
    cwd: WURZEL,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  return txt.split('\n')
}

const quelle = ALTE_FASSUNG ? alteQuelle() : readFileSync(MUPI_PHP, 'utf8').split('\n')

// Der ausfuehrbare Block. Dieser Anker steht in BEIDEN Fassungen — die alte
// kennt die Kommentarueberschrift noch nicht.
let block = schneide(quelle, "if( $_POST['displayset'] )", ANKER_ENDE, 0)

// Konstanten und Anzeige gibt es nur in der neuen Fassung; die alte hatte
// beides als von Hand gespiegelte switch-Faelle im HTML.
let konstanten = ''
let anzeigeBlock = ''
if (!ALTE_FASSUNG) {
  konstanten = schneide(quelle, ANKER_ANFANG, "if( $_POST['displayset'] )", 0)
  anzeigeBlock = schneide(quelle, ANKER_ANZEIGE_ANFANG, ANKER_ANZEIGE_ENDE, 1)
  block = `${konstanten}\n${block}`
}

if (GEGENPROBE) {
  // ══ WARUM DIESE MUTATION ZWEI SCHNITTE HAT ═══════════════════════════════
  //
  // Der erste Versuch setzte nur "0 => 0" in die Stufentabelle zurueck — und
  // das Werkzeug blieb GRUEN. GEMESSEN, nicht ueberlegt: die Klemmzeile faengt
  // die 0 ab, BEVOR die Tabelle ueberhaupt befragt wird. Die Tabelle allein
  // haelt hier gar nichts.
  //
  // Das ist der Grund, warum diese Gegenprobe beide Riegel zieht. Es ist
  // zugleich der Beleg dafuer, dass in mupi.php zwei unabhaengige Sperren
  // liegen: es braucht ZWEI falsche Aenderungen, um den Schirm schwarz zu
  // bekommen. Eine allein genuegt nicht — in keine der beiden Richtungen.
  const vorher = block
  block = block.replace('$HELLIGKEIT_STUFEN = array(', '$HELLIGKEIT_STUFEN = array(\n\t0   => 0,')
  if (block === vorher) throw new Error('Gegenprobe: Stufentabelle nicht gefunden')

  const vorKlemme = block
  block = block.replace(/if\(\s*\$gewuenscht\s*<\s*\$HELLIGKEIT_PROZENT_MIN\s*\)/, 'if( false )')
  if (block === vorKlemme) throw new Error('Gegenprobe: Klemmzeile nicht gefunden')

  console.log('GEGENPROBE: "0 => 0" in der Stufentabelle UND die Klemmzeile ausgehaengt.')
  console.log('            (nur eines von beidem genuegt nicht — das ist gemessen)\n')
}
if (ALTE_FASSUNG) {
  console.log('ALTE FASSUNG: der Block aus a4c202f1^ — die Datei, wie sie HEUTE auf der Box liegt.\n')
}

// ── Arbeitsordner ───────────────────────────────────────────────────────────

const ARBEIT = path.join(tmpdir(), `schirm-auf-null-${process.pid}`)
const SYS = path.join(ARBEIT, 'sys')
mkdirSync(path.join(SYS, '11-0045'), { recursive: true })
mkdirSync(path.join(ARBEIT, 'www'), { recursive: true })
mkdirSync(path.join(ARBEIT, 'bin'), { recursive: true })
mkdirSync(path.join(ARBEIT, 'spur'), { recursive: true })

const panel = (name, feld) => path.join(SYS, name, feld)
const setzeRoh = (n, name = '11-0045') => writeFileSync(panel(name, 'brightness'), `${n}\n`)
const liesRoh = (name = '11-0045') => readFileSync(panel(name, 'brightness'), 'utf8').trim()
writeFileSync(panel('11-0045', 'max_brightness'), '255\n')
writeFileSync(panel('11-0045', 'bl_power'), '0\n')
setzeRoh(255)

// ── Die Attrappen fuer sudo und su ──────────────────────────────────────────
//
// `sudo su - -c '<befehl>'` ist die Form, die mupi.php baut. sudo reicht durch,
// su fuehrt den Befehl in einer LOGIN-SHELL aus — auf der Box bash. Beide
// schreiben mit, was sie bekommen haben; die Spur ist die eigentliche Messung
// an der gefaehrlichen Zeile.

writeFileSync(
  path.join(ARBEIT, 'bin', 'sudo'),
  `#!/bin/bash
printf '%s\\n' "$*" >> /spur/sudo.txt
exec "$@"
`,
)
writeFileSync(
  path.join(ARBEIT, 'bin', 'su'),
  `#!/bin/bash
# Attrappe fuer: su - -c '<befehl>'
# Die Login-Shell von root ist auf der Box /bin/bash (gemessen). bash und nicht
# sh, weil dash ein Glob im Ziel einer Umlenkung NICHT expandiert.
while [ $# -gt 0 ]; do
  case "$1" in
    -|-l|--login) shift ;;
    -c) shift; printf '%s\\n' "$1" >> /spur/su.txt; exec /bin/bash -c "$1" ;;
    *) shift ;;
  esac
done
`,
)

// ── Die Sonde ───────────────────────────────────────────────────────────────
//
// Kopf + WOERTLICHER Ausschnitt + Fuss. Am Ausschnitt wird nichts geaendert.

const sonde = `<?php
namespace Probe;

// exec() wird abgefangen, WEIL der Ausschnitt es unqualifiziert aufruft: PHP
// sucht dann zuerst in diesem Namensraum. Der Befehl wird trotzdem WIRKLICH
// ausgefuehrt — gegen die Attrappe unter /sys/class/backlight.
function exec($befehl, &$ausgabe = null, &$code = null) {
    $GLOBALS['PROBE_BEFEHLE'][] = $befehl;
    return \\exec($befehl, $ausgabe, $code);
}

$GLOBALS['PROBE_BEFEHLE'] = [];
$CHANGE_TXT = '';
$change = 0;
$data = ['mupibox' => ['physicalDevice' => ''], 'timeout' => [], 'chromium' => []];

${block}

// ── Fuss: was der Block getan hat, als JSON heraus ──────────────────────────
\\header('Content-Type: application/json');
echo \\json_encode([
    'befehle'   => $GLOBALS['PROBE_BEFEHLE'],
    'change_txt'=> $CHANGE_TXT,
    'new_pct'   => isset($new_pct) ? $new_pct : null,
    'new_bn'    => isset($new_bn) ? $new_bn : null,
]);
`
writeFileSync(path.join(ARBEIT, 'www', 'sonde.php'), sonde)

// Die Anzeige (was der Regler dem Menschen HINSCHREIBT) als eigener Weg.
// Die alte Fassung hat diesen Teil nicht als eigenen Block — dort standen die
// Prozentwerte als zweite, von Hand gespiegelte switch-Liste im HTML.
const anzeige = anzeigeBlock
  ? `<?php
namespace Anzeige;
function exec($befehl, &$ausgabe = null, &$code = null) { return \\exec($befehl, $ausgabe, $code); }
${konstanten}
${anzeigeBlock}
`
  : '<?php echo "-";'
writeFileSync(path.join(ARBEIT, 'www', 'anzeige.php'), anzeige)

// ── Container starten ───────────────────────────────────────────────────────

const NAME = `schirm-auf-null-${process.pid}`
function aufraeumen() {
  try {
    execFileSync('docker', ['rm', '-f', NAME], { stdio: 'ignore' })
  } catch {
    /* war schon weg */
  }
  if (!BEHALTEN) rmSync(ARBEIT, { recursive: true, force: true })
}
process.on('exit', aufraeumen)
process.on('SIGINT', () => process.exit(130))

const docker = spawn(
  'docker',
  [
    'run',
    '--rm',
    '--name',
    NAME,
    '-p',
    `127.0.0.1:${PORT}:${PORT}`,
    '-v',
    `${SYS}:/sys/class/backlight`,
    '-v',
    `${path.join(ARBEIT, 'www')}:/www:ro`,
    '-v',
    `${path.join(ARBEIT, 'bin')}:/attrappen:ro`,
    '-v',
    `${path.join(ARBEIT, 'spur')}:/spur`,
    PHP_ABBILD,
    'sh',
    '-c',
    // Die Attrappen VOR alles andere in den PATH.
    `cp /attrappen/* /usr/local/bin/ && chmod +x /usr/local/bin/sudo /usr/local/bin/su && ` +
      `php -S 0.0.0.0:${PORT} -t /www`,
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)
let dockerFehler = ''
docker.stderr.on('data', (d) => {
  dockerFehler += d.toString()
})

async function warteAufServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/anzeige.php`)
      if (r.ok) return
    } catch {
      /* noch nicht da */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`PHP-Server kam nicht hoch auf ${PORT}.\n${dockerFehler}`)
}

/** Ein roher POST-Rumpf, genau so wie er auf die Leitung geht. */
async function post(rumpf) {
  const r = await fetch(`http://127.0.0.1:${PORT}/sonde.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: rumpf,
  })
  const text = await r.text()
  try {
    return JSON.parse(text)
  } catch {
    return { fehler: text.slice(0, 300) }
  }
}

// ── Die Faelle ──────────────────────────────────────────────────────────────
//
// Jeder Fall ist ein ROHER Rumpf, damit Arrays, doppelte Felder und %00
// wirklich von PHP geparst werden und nicht von einer Bequemlichkeit hier.
// `erwartetRoh` ist der Rohwert, der danach in der Datei stehen SOLL.

const STUFE_MIN = 51 // 20 % von 255 — die kleinste angebotene Stufe
const VOLL = 255

const faelle = [
  // ── die geradeaus-Versuche auf Null ──
  ['newbrightness=0', STUFE_MIN, 'die nackte 0'],
  ['newbrightness=%20%200%20', STUFE_MIN, '0 mit Leerzeichen drumherum'],
  ['newbrightness=0.0', STUFE_MIN, '0.0'],
  ['newbrightness=00', STUFE_MIN, 'fuehrende Null'],
  ['newbrightness=-0', STUFE_MIN, 'negative Null'],
  ['newbrightness=%2B0', STUFE_MIN, 'plus Null'],
  ['newbrightness=0.4', STUFE_MIN, '0.4 — (int) macht 0 daraus'],
  ['newbrightness=1e-9', STUFE_MIN, 'Exponent, winzig'],
  ['newbrightness=0e0', STUFE_MIN, '0e0'],
  ['newbrightness=.0', STUFE_MIN, '.0 ohne fuehrende Ziffer'],
  ['newbrightness=-5', STUFE_MIN, 'negativ'],
  ['newbrightness=-2147483648', STUFE_MIN, 'kleinster 32-Bit-Wert'],
  ['newbrightness=19', STUFE_MIN, 'knapp unter der Grenze'],
  ['newbrightness=19.9999', STUFE_MIN, 'knapp unter der Grenze, gebrochen'],

  // ── was PHP anders parst, als man denkt ──
  ['newbrightness[]=20&newbrightness[]=0', VOLL, 'Array — (int) darauf ist in PHP 8 ein Fehler'],
  // GEMESSEN: PHP nimmt bei doppeltem Feld das LETZTE. Der Wert ist damit 0 —
  // und 0 wird geklemmt, nicht abgewiesen. 51, nicht 255.
  ['newbrightness=20&newbrightness=0', STUFE_MIN, 'doppeltes Feld — PHP nimmt das LETZTE'],
  ['newbrightness=0&newbrightness=20', STUFE_MIN, 'doppeltes Feld andersherum'],
  ['newbrightness=%00', VOLL, 'nur ein NUL-Byte'],
  // GEMESSEN: trim() raeumt in PHP von Haus aus auch "\0" und "\n" weg
  // (Vorgabeliste " \t\n\r\0\x0B"). Aus "0\0" wird also "0", und das ist
  // numerisch. Ergebnis 51 — die Untergrenze, nicht 0 und nicht 255.
  ['newbrightness=0%00', STUFE_MIN, '0 mit angehaengtem NUL — trim frisst das NUL'],
  ['newbrightness=%000', STUFE_MIN, 'NUL vor der 0 — trim frisst es ebenso'],
  ['newbrightness=0abc', VOLL, '(int) waere 0 — is_numeric sagt nein'],
  ['newbrightness=hell', VOLL, 'gar keine Zahl'],
  ['newbrightness=', VOLL, 'leerer Wert'],
  ['', VOLL, 'Feld fehlt ganz'],
  ['newbrightness=0x33', VOLL, 'Hex-Schreibweise'],
  ['newbrightness=0b0', VOLL, 'Binaer-Schreibweise'],
  ['newbrightness=%D9%A2%D9%A0', VOLL, 'arabisch-indische Ziffern 20'],
  ['newbrightness=NaN', VOLL, 'NaN'],
  ['newbrightness=INF', VOLL, 'INF'],
  ['newbrightness=-INF', VOLL, '-INF'],
  ['newbrightness=99999999999999999999', VOLL, 'ueber den Zahlenbereich hinaus'],
  ['newbrightness=%0A0', STUFE_MIN, 'Zeilenumbruch vor der 0 — trim frisst ihn'],
  ['newbrightness=0%0A', STUFE_MIN, '0 mit Zeilenumbruch — trim frisst ihn'],
  ['newbrightness[0]=0', VOLL, 'Array mit Schluessel'],

  // ── Einschleusung: aus der Shell-Zeile ausbrechen ──
  ['newbrightness=0%3B+sudo+reboot', VOLL, 'Semikolon und ein zweiter Befehl'],
  ["newbrightness=0'+%3B+echo+0+>+/sys/class/backlight/11-0045/brightness+%3B+'", VOLL, 'aus den Hochkommata ausbrechen'],
  ['newbrightness=%24(echo+0)', VOLL, 'Befehlsersetzung'],
  ['newbrightness=%60echo+0%60', VOLL, 'Befehlsersetzung mit Backticks'],

  // ── die Gegenrichtung: tut der Regler ueberhaupt noch etwas? ──
  ['newbrightness=20', STUFE_MIN, 'Untergrenze — muss 51 setzen'],
  ['newbrightness=40', 102, '40 %'],
  ['newbrightness=60', 153, '60 %'],
  ['newbrightness=80', 204, '80 %'],
  ['newbrightness=100', VOLL, 'voll'],
  // GEMESSEN, UND DIE REIHENFOLGE IST DER GRUND: geklemmt wird VOR dem Blick in
  // die Stufentabelle. 5 wird deshalb erst zu 20 und dann zu 51 — es faellt
  // nicht in den „keine Stufe"-Zweig. Wer 5 schickt, will es dunkel und bekommt
  // das Dunkelste, was noch lesbar ist. Genau so ist es gemeint.
  ['newbrightness=5', STUFE_MIN, '5 — erst geklemmt auf 20, dann Stufe'],
  ['newbrightness=30', VOLL, '30 — ueber der Grenze, aber keine Stufe: voll'],
]

// ── Lauf ────────────────────────────────────────────────────────────────────

const ERLAUBTE_ZEILE = /^echo (51|102|153|204|255) > \/sys\/class\/backlight\/\*\/brightness$/

const rot = []
const zeilen = []

await warteAufServer()

console.log(`PHP-Sonde laeuft auf 127.0.0.1:${PORT} (Attrappe statt Panel, Box unberuehrt)\n`)
console.log('FALL                                              gesendet -> Rohwert   erwartet')
console.log('─'.repeat(96))

for (const [rumpfRoh, erwartetRoh, was] of faelle) {
  // Jeder Fall startet bei VOLL, damit die Zeile `$new_bn != $tboutput[0]`
  // nicht zufaellig zuschlaegt.
  setzeRoh(VOLL)
  const rumpf = rumpfRoh ? `displayset=Submit&${rumpfRoh}` : 'displayset=Submit'
  const antwort = await post(rumpf)
  const nachher = Number(liesRoh())
  const ok = nachher === erwartetRoh
  const zuDunkel = Number.isFinite(nachher) && nachher < STUFE_MIN

  zeilen.push({ was, rumpf: rumpfRoh || '(nichts)', nachher, erwartetRoh, ok, zuDunkel, antwort })
  if (zuDunkel || !ok) rot.push({ was, rumpf: rumpfRoh, nachher, erwartetRoh, zuDunkel })

  const marke = zuDunkel ? 'SCHWARZ' : ok ? '  ok   ' : ' ABWEICHUNG'
  console.log(`${marke} ${was.padEnd(42).slice(0, 42)} ${String(rumpfRoh || '(nichts)').slice(0, 24).padEnd(24)} ${String(nachher).padStart(4)}   ${erwartetRoh}`)
}

// ── Die gefaehrliche Zeile selbst ───────────────────────────────────────────
let spur = ''
try {
  spur = readFileSync(path.join(ARBEIT, 'spur', 'su.txt'), 'utf8')
} catch {
  spur = ''
}
const spurZeilen = spur.split('\n').filter(Boolean)
const boese = spurZeilen.filter((z) => !ERLAUBTE_ZEILE.test(z))
console.log(`\nAn die Shell gingen ${spurZeilen.length} Zeilen; davon ausserhalb des erlaubten Musters: ${boese.length}`)
for (const z of boese.slice(0, 5)) console.log(`   AUSSERHALB: ${z}`)

// ── Sonderfall 1: eine Box, die schon auf 0 steht ───────────────────────────
setzeRoh(0)
await post('displayset=Submit&newbrightness=20')
const zurueck = Number(liesRoh())
console.log(`\nEine Box, die schon auf Rohwert 0 steht, kommt mit einem Submit auf: ${zurueck}`)
if (zurueck < STUFE_MIN) rot.push({ was: 'Box auf 0 kommt nicht zurueck', nachher: zurueck, zuDunkel: true })

// ── Sonderfall 2: eine Box auf 0, und jemand schickt wieder 0 ───────────────
setzeRoh(0)
await post('displayset=Submit&newbrightness=0')
const nullAufNull = Number(liesRoh())
console.log(`Eine Box auf 0, die noch einmal newbrightness=0 bekommt, steht danach auf: ${nullAufNull}`)
if (nullAufNull < STUFE_MIN) rot.push({ was: 'Box auf 0 bleibt bei newbrightness=0 auf 0', nachher: nullAufNull, zuDunkel: true })

// ── Sonderfall 3: ZWEI Panels — was macht das Glob? ─────────────────────────
mkdirSync(path.join(SYS, '09-0045'), { recursive: true })
writeFileSync(panel('09-0045', 'brightness'), '255\n')
writeFileSync(panel('09-0045', 'max_brightness'), '255\n')
setzeRoh(255)
await post('displayset=Submit&newbrightness=20')
const zweiPanels = { erstes: liesRoh('09-0045'), zweites: liesRoh('11-0045') }
console.log(`\nMit ZWEI Eintraegen unter /sys/class/backlight setzt der Glob-Weg: 09-0045=${zweiPanels.erstes}, 11-0045=${zweiPanels.zweites}`)
console.log('   (bash bricht eine Umlenkung mit mehrdeutigem Glob ab — der Regler tut dann NICHTS)')
rmSync(path.join(SYS, '09-0045'), { recursive: true, force: true })

// ── Die Anzeige: was schreibt der Regler dem Menschen hin? ──────────────────
console.log('\nWas die Seite ANZEIGT, wenn die Box schon dunkel steht:')
for (const roh of anzeigeBlock ? [0, 1, 25, 50, 51, 102, 255] : []) {
  setzeRoh(roh)
  const r = await fetch(`http://127.0.0.1:${PORT}/anzeige.php`)
  const t = (await r.text()).trim()
  console.log(`   Rohwert ${String(roh).padStart(3)}  ->  Anzeige ${t} %`)
}

// ── Urteil ──────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(96)}`)
if (GEGENPROBE) {
  if (rot.length === 0) {
    console.log('GEGENPROBE FEHLGESCHLAGEN: die 0 war eingebaut und das Werkzeug blieb gruen.')
    console.log('Dieses Werkzeug misst nichts. Nicht glauben, was es sonst sagt.')
    process.exit(2)
  }
  console.log(`GEGENPROBE BESTANDEN: mit eingebauter 0 wurde es an ${rot.length} Stellen rot.`)
  process.exit(0)
}
if (rot.length === 0) {
  console.log('GRUEN — kein gesendeter Wert brachte den Rohwert unter die Untergrenze.')
  process.exit(0)
}
console.log(`ROT — ${rot.length} Faelle brachten den Schirm unter die Untergrenze oder wichen ab:`)
for (const r of rot) console.log(`   ${r.zuDunkel ? 'SCHWARZ' : 'ABWEICHUNG'}  ${r.was}  (${r.rumpf ?? ''}) -> ${r.nachher}, erwartet ${r.erwartetRoh}`)
process.exit(1)
