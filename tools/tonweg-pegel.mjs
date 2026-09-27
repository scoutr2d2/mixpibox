#!/usr/bin/env node
/**
 * TONWEG-PEGEL — den Signalweg der Box mit Pegeln an JEDER Station zeigen.
 *
 * ══ WARUM ES DAS GIBT (23.08.2026) ═════════════════════════════════════════
 * Der Betreiber meldete „die Lautstaerke ist stark gedeckelt". Der Regler der
 * Box stand auf ANSCHLAG. Gefunden wurde die Ursache erst, als man den GANZEN
 * Weg nebeneinander sah:
 *
 *     klangwerk 1.00  ->  entzerrer  ->  ueberall  ->  MAX98357A 0.07
 *     ( der Regler )                                   ( -23 dB!  )
 *
 * Der Regler sitzt VORNE, die Daempfung sitzt HINTEN. Wer nur `wpctl
 * get-volume @DEFAULT_AUDIO_SINK@` fragt — und das tut jedes Werkzeug der Box —
 * bekommt 1.00 zurueck und haelt alles fuer in Ordnung.
 *
 * ES IST EINE KETTE, UND EINE KETTE MISST MAN GANZ. Darum dieses Werkzeug.
 *
 * ══ DIE DRITTE STATION, DIE HIER BIS ZUM 20.09.2026 FEHLTE ════════════════
 * Der Betreiber: „ich habe nichts gehoert." Dieses Werkzeug meldete an dem Tag
 * brav `-53 dB` an der Tonkarte — und dachte, damit sei alles gesagt. Es war
 * NICHT alles: Hinter PipeWire liegt noch der ALSA-Mischer der Karte
 * (`amixer -c <n> sget Master`, auf dem MuPiHAT ein softvol), und der stand auf
 * 44 % = -28,8 dB. Zwei Daempfungen hintereinander, von denen dieses Werkzeug
 * nur eine kannte; gehoert hat man erst, als BEIDE oben standen.
 *
 * Eine Kette misst man ganz — auch ueber die Grenze des Tonservers hinaus.
 * Seit heute steht der ALSA-Mischer deshalb in derselben Tabelle.
 *
 * ══ UND WER REGELT, HAT SICH GEAENDERT (04.09.2026) ════════════════════════
 * Bis dahin regelte die VORGABE-Senke (`klangwerk`), und alles dahinter war
 * Durchreiche. Seither traegt die HARDWARE-Senke die Nutzerlautstaerke
 * (`regelnde_senke_name` in mupi-lautstaerke.sh) — die Stufe, hinter der nichts
 * mehr kommt. Dieses Werkzeug nannte trotzdem weiter die Vorgabe-Senke „den
 * Regler" und buchte die Nutzerlautstaerke als „stille Daempfung". Damit meldete
 * es auf jeder normalen Box einen Fehler, den es nicht gab — und verdeckte den,
 * den es gab [llmwiki dauerrote-wache-ist-keine].
 *
 * ══ DIE ZWEITE FALLE: ZWEI ZAEHLWEISEN ═════════════════════════════════════
 * `wpctl` rechnet LINEAR, `pactl` rechnet KUBISCH. Dieselbe Senke heisst bei
 * dem einen 0.07 und bei dem anderen 40 %, denn 0,4³ = 0,064. Wer die beiden
 * Zahlen vergleicht, ohne das zu wissen, sucht einen Fehler, der keiner ist —
 * oder uebersieht einen, der einer ist. Beide Spalten stehen deshalb hier.
 *
 * Aufruf:  node tools/tonweg-pegel.mjs [box]     (Vorgabe: 192.168.178.62)
 */
import { execFileSync } from 'node:child_process'

const BOX = process.argv[2] ?? '192.168.178.62'

const amGeraet = (befehl) => {
  try {
    return execFileSync('ssh', ['-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes', `dietpi@${BOX}`, befehl], {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return ''
  }
}

/** Linear -> dB. 0 heisst Stille, dafuer gibt es keine Zahl. */
const dB = (v) => (v <= 0 ? '-inf' : (20 * Math.log10(v)).toFixed(1))
/** Linear -> die kubische Prozentzahl, die `pactl` anzeigen wuerde. */
const kubisch = (v) => (Math.cbrt(v) * 100).toFixed(0)

const roh = amGeraet(
  'pw-dump 2>/dev/null | ' +
    'jq -c \'[.[] | select(.type=="PipeWire:Interface:Node") | ' +
    '{id:.id, name:.info.props["node.name"], klasse:.info.props["media.class"], ' +
    'lautstaerke:(.info.params.Props[0].channelVolumes[0] // .info.params.Props[0].volume), ' +
    'stumm:.info.params.Props[0].mute}]\'',
)

let knoten = []
try {
  knoten = JSON.parse(roh.trim() || '[]')
} catch {
  console.error(`Die Box ${BOX} antwortet nicht oder hat kein pw-dump/jq.`)
  process.exit(2)
}

const senken = knoten.filter((k) => /Audio\/Sink|Stream\/Output\/Audio/.test(k.klasse ?? ''))
if (senken.length === 0) {
  console.error('Kein einziger Tonknoten gefunden — laeuft PipeWire?')
  process.exit(2)
}

const vorgabe = amGeraet('pactl get-default-sink 2>/dev/null').trim()

/* ══ DIE REGELNDE STUFE — DIESELBE FRAGE WIE IN mupi-lautstaerke.sh ═════════
 * Nicht die Vorgabe-Senke, sondern die letzte im Weg: Bluetooth, sonst die
 * ALSA-Karte. Abgeschrieben waere die Regel hier eine zweite Wahrheit; gefragt
 * wird deshalb wie dort (`regelnde_senke_name`), nur in einer Zeile. */
const regelnde =
  amGeraet(
    'pw-dump 2>/dev/null | jq -r \'[ .[] | select(.type=="PipeWire:Interface:Node") ' +
      '| select(.info.props["media.class"]=="Audio/Sink") ' +
      '| select(.info.props["node.name"] | test("^(bluez_output|alsa_output)")) ] ' +
      '| sort_by(if (.info.props["node.name"] | startswith("bluez_output")) then 0 else 1 end) ' +
      '| .[0].info.props["node.name"] // empty\'',
  ).trim() || vorgabe

/* ══ UND DIE STUFE HINTER PIPEWIRE ═════════════════════════════════════════
 * Der ALSA-Mischer der Karte. Er gehoert keinem PipeWire-Knoten, taucht in
 * `pw-dump` also gar nicht auf — und genau deshalb hat ihn hier bis zum
 * 20.09.2026 niemand gesehen. Gelesen wird die Karte des MuPiHAT-Verstaerkers
 * ueber ihren NAMEN und nicht ueber eine Nummer: `-c 2` war gestern 2 und ist
 * nach einem Kernel-Update 1. */
const alsaKarte = amGeraet(
  "aplay -l 2>/dev/null | sed -n 's/^card \\([0-9]\\+\\): \\([A-Za-z0-9_]\\+\\).*/\\1 \\2/p' | grep -iv vc4hdmi | head -1",
).trim()
let alsaStufe = null
if (alsaKarte) {
  const [nr, name] = alsaKarte.split(/\s+/)
  const roh2 = amGeraet(`amixer -c ${nr} sget Master 2>/dev/null | grep -o '\\[[0-9]\\+%\\]' | head -1`).trim()
  const prozent = Number((roh2.match(/\d+/) || [])[0])
  if (Number.isFinite(prozent)) {
    // amixer zeigt PROZENT DES REGELWEGS, und der ist bei softvol linear in
    // dB geteilt — die Anzeige daneben (`[-28.80dB]`) ist die Wahrheit. Sie
    // wird deshalb mitgelesen und nicht aus dem Prozentwert gerechnet.
    const dbRoh = amGeraet(`amixer -c ${nr} sget Master 2>/dev/null | grep -o '\\[-\\?[0-9.]\\+dB\\]' | head -1`).trim()
    const db = Number((dbRoh.match(/-?[0-9.]+/) || [])[0])
    alsaStufe = { karte: `${name} (card ${nr})`, prozent, db: Number.isFinite(db) ? db : null }
  }
}

console.log(`\n  DER TONWEG DER BOX ${BOX}\n`)
console.log('  ' + 'Knoten'.padEnd(34) + 'linear'.padStart(8) + 'pactl'.padStart(8) + 'dB'.padStart(9) + '   ')
console.log('  ' + '─'.repeat(62))

const auffaellig = []
for (const k of senken.sort((a, b) => a.id - b.id)) {
  const v = typeof k.lautstaerke === 'number' ? k.lautstaerke : null
  const marke = k.name === vorgabe ? ' *' : '  '
  const stumm = k.stumm ? '  STUMM' : ''
  console.log(
    `${marke}${String(k.id).padEnd(5)}${(k.name ?? '?').padEnd(29)}` +
      (v === null ? '—'.padStart(8) : v.toFixed(2).padStart(8)) +
      (v === null ? '—'.padStart(8) : `${kubisch(v)}%`.padStart(8)) +
      (v === null ? '—'.padStart(9) : `${dB(v)}`.padStart(9)) +
      stumm,
  )
  // Unter 0,5 linear (-6 dB) an einer Station, die NICHT DIE REGELNDE ist, ist
  // eine Daempfung, die niemand bedient — genau der gesuchte Fall. Verglichen
  // wird gegen `regelnde` und nicht gegen die Vorgabe-Senke: die
  // Nutzerlautstaerke steht seit dem 04.09.2026 hinten, und sie als „stille
  // Daempfung" zu melden war der Fehlalarm, den dieses Werkzeug vom
  // 04.09. bis zum 20.09.2026 auf jeder normalen Box erzeugt hat.
  if (v !== null && v < 0.5 && k.name !== regelnde) auffaellig.push({ ...k, v })
}

if (alsaStufe) {
  const wert = alsaStufe.db === null ? '—' : `${alsaStufe.db.toFixed(1)}`
  console.log(
    '  ' +
      `ALSA  ${alsaStufe.karte} · Master`.padEnd(34) +
      '—'.padStart(8) +
      `${alsaStufe.prozent}%`.padStart(8) +
      wert.padStart(9) +
      '   (hinter PipeWire)',
  )
}

console.log(`\n  * = Vorgabe-Senke (${vorgabe || 'unbekannt'}); die NUTZERLAUTSTAERKE traegt ${regelnde || '?'}.\n`)

// ── DIE STUFE HINTER PIPEWIRE ZAEHLT MIT ───────────────────────────────────
// Sie ist kein PipeWire-Knoten und steht deshalb nicht in `auffaellig`; ihre
// Daempfung kommt aber genauso am Lautsprecher an. Am 20.09.2026 war sie die
// ganze Ursache: -28,8 dB, die niemand sah.
let alsaFehlt = 0
if (alsaStufe && alsaStufe.db !== null && alsaStufe.db < -1) {
  alsaFehlt = alsaStufe.db
  console.log(
    `  ── DIE STUFE HINTER PIPEWIRE ───────────────────────────────────\n\n` +
      `  Der ALSA-Mischer der Karte (${alsaStufe.karte}) steht auf ${alsaStufe.prozent} % ` +
      `(${alsaStufe.db.toFixed(1)} dB).\n` +
      `  Kein Regler der Box erreicht ihn: ${'`mupi-lautstaerke.sh`'} fasst ${'`amixer`'} nur an,\n` +
      `  wenn es GAR KEIN PipeWire gibt. Hochziehen und sichern:\n\n` +
      `      amixer -c <n> sset Master 100% && sudo alsactl store\n`,
  )
}

if (auffaellig.length === 0 && alsaFehlt === 0) {
  console.log('  Keine stille Daempfung gefunden: die regelnde Stufe ist die einzige Stellschraube.\n')
  process.exit(0)
}
if (auffaellig.length === 0) process.exit(1)

console.log('  ── STILLE DAEMPFUNG, DIE DER REGLER NICHT ERREICHT ──────────────\n')
for (const k of auffaellig) {
  console.log(`  ${k.name}  steht auf ${k.v.toFixed(2)} (${dB(k.v)} dB).`)
}
const gesamt = auffaellig.reduce((p, k) => p * k.v, 1)
console.log(
  `\n  Zusammen ${dB(gesamt)} dB, die fehlen, WENN der Regler schon am Anschlag steht.\n` +
    '  Das ist die Deckelung, die von vorne nicht zu sehen ist.\n',
)
process.exit(1)
