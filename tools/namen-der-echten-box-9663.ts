/**
 * WEN LAESST DIE ECHTE BOX HEREIN? — MIT IHREN WERTEN, MIT DER ECHTEN FORMEL.
 *
 * Die entscheidende Frage bei diesem Riegel ist nicht „haelt er den Angreifer
 * ab", sondern „sperrt er den Besitzer aus". Auf DIESEM Rechner heisst alles
 * anders als auf der Box — ein gruener Lauf hier sagt darum nichts ueber sie.
 *
 * Also: die Werte werden LESEND von 192.168.178.169 geholt (hostname, die
 * Adressen aller Schnittstellen, `mupibox.host` und `mupibox.hostZusatz` aus
 * mupiboxconfig.json) und durch `namenBilden`/`istEigenerName` AUS
 * eigene-namen.ts geschickt — die Funktionen selbst, kein Nachbau. Ein Nachbau
 * wuerde sich selbst messen.
 *
 * An der Box wird NICHTS geaendert, nichts neu gestartet, nichts ausgeliefert.
 *
 *     npx tsx tools/namen-der-echten-box-9663.ts [--box 192.168.178.169]
 *
 * Rueckgabewert 0, wenn jeder Weg, ueber den die Box heute erreicht wird,
 * durchkommt UND jeder fremde Name abprallt.
 */
import { execFileSync } from 'node:child_process'
import { istEigenerName, namenBilden } from '../src/backend-api/src/eigene-namen'

const argv = process.argv.slice(2)
const i = argv.indexOf('--box')
const BOX = i >= 0 && argv[i + 1] ? argv[i + 1] : '192.168.178.169'

function amGeraet(befehl: string): string {
  return execFileSync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new', `dietpi@${BOX}`, befehl],
    { encoding: 'utf8', timeout: 30000 },
  )
}

const rechnername = amGeraet('hostname').trim()
const adressen = amGeraet("ip -o addr show | awk '{print $4}' | cut -d/ -f1")
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean)
const konf = JSON.parse(
  amGeraet(
    'python3 -c \'import json;d=json.load(open("/etc/mupibox/mupiboxconfig.json"));m=d.get("mupibox",{});print(json.dumps({"host":m.get("host") or "","zusatz":m.get("hostZusatz") or ""}))\'',
  ),
) as { host: string; zusatz: string }

const namen = namenBilden({
  rechnername,
  adressen,
  konfigHost: konf.host,
  zusatz: String(konf.zusatz ?? '').split(','),
  netzGelesen: true,
})

console.log(`\nDie echte Box ${BOX}: Rechnername „${rechnername}", Konfigname „${konf.host}"`)
console.log(`Adressen: ${adressen.join(' ')}`)
console.log(`verlaesslich: ${namen.verlaesslich}${namen.grund ? ` (${namen.grund})` : ''}`)
console.log(`Ausweg-Adressen in der Ablehnung: ${namen.erreichbar.join(' · ')}\n`)

let rot = 0
const zeile = (name: string, sollDurch: boolean) => {
  const durch = istEigenerName(name, namen)
  const gut = durch === sollDurch
  if (!gut) rot++
  console.log(`  ${gut ? 'ok  ' : 'ROT '} ${sollDurch ? 'kommt durch' : 'prallt ab  '}: ${name}${gut ? '' : `  — tut es NICHT`}`)
}

// DIE WEGE, UEBER DIE DIE BOX HEUTE WIRKLICH ERREICHT WIRD. Wer hier rot wird,
// hat einen Besitzer ausgesperrt, der es nicht melden kann.
console.log('DIE WEGE DES BESITZERS — jeder einzelne muss durchkommen:')
for (const n of [
  'localhost', // der Kiosk auf der Box selbst
  '127.0.0.1', // Werkzeuge und Skripte auf der Box
  '::1',
  BOX, // ein zweiter Rechner im Heimnetz
  rechnername, // der Rechnername
  `${rechnername}.local`, // mDNS — der Name, den Anleitungen nennen
  `${rechnername}.fritz.box`, // was ein deutscher Heimrouter vergibt
  `${rechnername}.lan`,
  `${rechnername}.home.arpa`,
  konf.host.toLowerCase(), // der Name aus der Verwaltung
  `${konf.host.toLowerCase()}.local`,
  ...adressen.filter((a) => !a.startsWith('fe80')),
]) {
  zeile(n, true)
}

console.log('\nUND WAS ABPRALLEN MUSS:')
for (const n of [
  'boese.example',
  `${rechnername}.boese.example`,
  `${rechnername}.box`, // `.box` ist KAEUFLICH — darf nicht gelten
  `${konf.host.toLowerCase()}.example.com`,
  `${BOX}.boese.example`,
  '192.168.178.170',
  'localhost.boese.example',
]) {
  zeile(n, false)
}

console.log(`\n${rot === 0 ? 'keine rote Zeile.' : `${rot} rot.`}\n`)
process.exit(rot === 0 ? 0 : 1)
