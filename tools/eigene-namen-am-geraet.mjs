#!/usr/bin/env node
/**
 * WELCHE NAMEN LAESST DER RIEGEL AUF DER ECHTEN BOX DURCH?
 *
 * ══ WOZU ══════════════════════════════════════════════════════════════════
 * tools/eigene-namen-riegel.mjs misst den Riegel an einem echten Serverprozess
 * — aber auf DIESEM Rechner, mit DESSEN Namen. Die Frage, an der alles haengt,
 * ist eine andere: WIRD DER BETREIBER AUSGESPERRT? Das entscheidet sich an
 * den Werten, die auf der BOX stehen, und nirgends sonst.
 *
 * Dieses Werkzeug holt genau drei Auskuenfte von der Box — LESEND, ohne etwas
 * anzufassen, ohne Neustart, ohne Auslieferung —
 *   1. `hostname`
 *   2. die Adressen aller Schnittstellen
 *   3. `mupibox.host` und `mupibox.hostZusatz` aus /etc/mupibox/mupiboxconfig.json
 * und laesst DIESELBE Formel darueber laufen, die im Backend haengt
 * (`namenBilden` aus src/backend-api/src/eigene-namen.ts — nicht eine zweite
 * Fassung davon, sonst misst es sich selbst).
 *
 * Herausgegeben wird die Liste der Namen, unter denen die Box antwortet, und
 * — als Gegenprobe — eine Liste von Namen, die abprallen.
 *
 * ══ AUFRUF ════════════════════════════════════════════════════════════════
 *     npx tsx tools/eigene-namen-am-geraet.mjs [--box dietpi@192.168.178.169]
 *     npx tsx tools/eigene-namen-am-geraet.mjs --aus-datei <ordner>   (ohne SSH)
 *
 * `tsx`, weil die Formel aus dem TypeScript des Backends kommt (s.u.).
 *
 * Ohne erreichbare Box endet es mit 2 und sagt das — es erfindet nichts.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (n, v) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : v
}
const BOX = opt('box', 'dietpi@192.168.178.169')
const AUS_DATEI = opt('aus-datei', null)

/**
 * DIE FORMEL DES BACKENDS — GELADEN, NICHT NACHGEBAUT.
 *
 * Ein Nachbau wuerde sich selbst messen statt den Riegel: er kann richtig sein
 * und trotzdem etwas anderes sagen als das, was auf der Box laeuft. Deshalb
 * kommt hier die Datei selbst herein — und deshalb braucht dieses Werkzeug
 * `tsx` (siehe Aufruf oben).
 */
const { namenBilden, istEigenerName } = await import(
  `file://${join(WURZEL, 'src/backend-api/src/eigene-namen.ts')}`
)

function amGeraet(befehl) {
  const r = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', BOX, befehl], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ssh ${BOX}: ${r.stderr.trim() || `Rueckgabe ${r.status}`}`)
  return r.stdout
}

let rechnername = ''
let adressen = []
let konfigHost = ''
let hostZusatz = ''

try {
  if (AUS_DATEI) {
    rechnername = readFileSync(join(AUS_DATEI, 'hostname'), 'utf8').trim()
    adressen = readFileSync(join(AUS_DATEI, 'adressen'), 'utf8').split('\n').filter(Boolean)
    const k = JSON.parse(readFileSync(join(AUS_DATEI, 'mupiboxconfig.json'), 'utf8'))
    konfigHost = String(k?.mupibox?.host ?? '')
    hostZusatz = String(k?.mupibox?.hostZusatz ?? '')
  } else {
    rechnername = amGeraet('hostname').trim()
    // `ip -o -4 addr` und `-6`: eine Zeile je Adresse, ohne Werkzeug auf der
    // Box zu installieren. Nur lesend.
    adressen = amGeraet("ip -o addr | awk '{print $4}' | cut -d/ -f1")
      .split('\n')
      .map((z) => z.trim())
      .filter(Boolean)
    const k = JSON.parse(amGeraet('cat /etc/mupibox/mupiboxconfig.json'))
    konfigHost = String(k?.mupibox?.host ?? '')
    hostZusatz = String(k?.mupibox?.hostZusatz ?? '')
  }
} catch (e) {
  console.error(`Die Box ist nicht zu erreichen — es wird NICHTS behauptet.\n  ${e.message}`)
  console.error(`\nOhne SSH: die drei Auskuenfte in einen Ordner legen (hostname, adressen,`)
  console.error(`mupiboxconfig.json) und mit --aus-datei <ordner> aufrufen.`)
  process.exit(2)
}

const namen = namenBilden({
  rechnername,
  adressen,
  konfigHost,
  zusatz: hostZusatz.split(','),
})

console.log('══ WAS AUF DER BOX STEHT ════════════════════════════════════════════════\n')
console.log(`  hostname               ${rechnername}`)
console.log(`  Adressen               ${adressen.join(', ')}`)
console.log(`  mupibox.host           ${konfigHost || '(leer)'}`)
console.log(`  mupibox.hostZusatz     ${hostZusatz || '(nicht gesetzt)'}`)

console.log('\n══ DARAUS FOLGT ═════════════════════════════════════════════════════════\n')
console.log(`  ableitbar (verlaesslich): ${namen.verlaesslich ? 'ja' : `NEIN — ${namen.grund}`}`)
if (!namen.verlaesslich) {
  console.log('  → der Namensteil des Riegels bleibt AUS. Die Box ist erreichbar wie bisher.')
}
console.log(`\n  Namen, die genau so gelten (${namen.namen.size}):`)
for (const n of [...namen.namen].sort()) console.log(`      ${n}`)
console.log(`\n  Marken, die unter jeder reservierten Heimnetz-Endung gelten:`)
for (const m of [...namen.stamm].sort()) console.log(`      ${m}.local, ${m}.lan, ${m}.fritz.box, ${m}.home.arpa, …`)
console.log(`\n  Was in einer Fehlermeldung als Ausweg genannt wuerde:`)
for (const e of namen.erreichbar) console.log(`      ${e}`)

console.log('\n══ DIE PROBE: WER KOMMT DURCH, WER NICHT ════════════════════════════════\n')
const marke = (rechnername.split('.')[0] || 'mupibox').toLowerCase()
const konfMarke = (konfigHost.split('.')[0] || '').toLowerCase()
const FAELLE = [
  ...adressen.map((a) => [a, true, 'eine Adresse der Box']),
  ['localhost', true, 'der Kiosk auf der Box'],
  ['127.0.0.1', true, 'Werkzeuge auf der Box'],
  [marke, true, 'der Rechnername'],
  [`${marke}.local`, true, 'der mDNS-Name'],
  [`${marke}.fritz.box`, true, 'was ein Fritz!Box-Router vergibt'],
  [`${marke}.lan`, true, 'was andere Router vergeben'],
  ...(konfMarke ? [[konfMarke, true, 'der Name aus der Verwaltung']] : []),
  ...(konfMarke ? [[`${konfMarke}.local`, true, 'und dessen mDNS-Form']] : []),
  ['boese.example', false, 'DER NAMENSTAUSCH'],
  [`${marke}.boese.example`, false, 'die eigene Marke unter kaeuflicher Endung'],
  [`${marke}.box`, false, '.box ist eine echte, kaeufliche Endung'],
  ['192.0.2.7', false, 'eine fremde Adresse'],
]
let falsch = 0
for (const [name, soll, wozu] of FAELLE) {
  const ist = istEigenerName(name, namen)
  const ok = ist === soll
  if (!ok) falsch++
  console.log(`  ${ok ? 'ok  ' : 'NEIN'} ${(ist ? 'kommt durch' : 'prallt ab  ').padEnd(12)} ${name.padEnd(34)} ${wozu}`)
}
console.log(`\n${falsch === 0 ? 'Keine Zeile rot.' : `${falsch} Zeile(n) ROT.`}`)
process.exit(falsch === 0 ? 0 : 1)
