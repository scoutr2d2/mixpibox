// Was verliert die Box, wenn akkuverlauf.json halb geschrieben auf der Karte
// liegt? Und ist diese Datei wirklich die EINZIGE, die nicht atomar
// geschrieben wird? Beides wird hier gemessen, nicht behauptet.
//
// Aufruf: node tools/akkuverlauf-abriss-pruefen.mjs [pfad-zur-echten-datei]
// Ohne Pfad wird eine Datei von der Box erwartet (nur lesend geholt).
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { bereinigen } from '../src/backend-api/src/akkuverlauf.ts'
import { lernen } from '../src/backend-api/src/akkulernen.ts'

const pfad = process.argv[2]
if (!pfad || !fs.existsSync(pfad)) {
  console.error('Bitte eine echte akkuverlauf.json angeben.')
  process.exit(2)
}
const roh = fs.readFileSync(pfad, 'utf8')
const ganz = JSON.parse(roh)
const jetzt = Date.now()
const rein = bereinigen(ganz, jetzt)
console.log(`Datei: ${roh.length} Bytes, ${ganz.length} Punkte, nach bereinigen ${rein.length}`)
const spanneH = (rein[rein.length - 1].t - rein[0].t) / 3_600_000
console.log(`  Spanne: ${spanneH.toFixed(1)} Stunden`)
console.log('  ganz  :', JSON.stringify(lernen(rein, 10000)))

// So laedt der Server (server.ts akkuVerlaufLaden): try/catch, catch -> []
const laden = (text) => {
  try {
    const r = JSON.parse(text)
    return bereinigen(Array.isArray(r) ? r : [], jetzt)
  } catch {
    return []
  }
}

// fs.writeFile heisst: erst auf 0 kuerzen, dann schreiben. Ein Stromausfall
// kann die Datei an JEDER Stelle abschneiden - auch auf Laenge 0.
console.log('\nAbgeschnitten (Stromausfall waehrend fs.writeFile):')
for (const anteil of [1, 0.999, 0.9, 0.5, 0.1, 0]) {
  const stueck = roh.slice(0, Math.floor(roh.length * anteil))
  const reihe = laden(stueck)
  const g = lernen(reihe, 10000)
  console.log(
    `  ${(anteil * 100).toFixed(1).padStart(5)} % -> ${String(reihe.length).padStart(5)} Punkte,` +
      ` kapazitaetMah=${g.kapazitaetMah} rMilliOhm=${g.rMilliOhm} stand=${g.stand}`,
  )
}
// Und der Fall, den ext4 ohne fsync am haeufigsten hinterlaesst: richtige
// Laenge, aber Nullbytes drin.
const nullen = roh.slice(0, Math.floor(roh.length / 2)) + '\0'.repeat(Math.ceil(roh.length / 2))
console.log(`  Nullen-Schwanz -> ${laden(nullen).length} Punkte`)

// Die zweite Behauptung: "die einzige JSON-Datei, die nicht atomar geschrieben
// wird". Nachzaehlen, wer sonst noch ohne tmp+rename schreibt.
const server = '../src/backend-api/src/server.ts'
const roh2 = fs.readFileSync(new URL(server, import.meta.url), 'utf8').split('\n')
console.log('\nSchreibstellen ohne tmp+rename in server.ts:')
roh2.forEach((z, i) => {
  if (/jsonfile\.writeFile|fs\.writeFileSync\(|fs\.writeFile\(/.test(z)) {
    const ziel = z.trim().slice(0, 90)
    console.log(`  ${String(i + 1).padStart(5)}: ${ziel}`)
  }
})
void execFileSync
