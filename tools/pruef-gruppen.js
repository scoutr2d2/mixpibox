/**
 * Prueft, dass keine Mini-Player-Bauform hinter den Reitern verschwindet.
 *
 * Die Bauformen stehen in EINER Liste, die Reiter in einer ZWEITEN. Wer eine
 * neue Bauform hinzufuegt und die Gruppe vergisst, bekommt keinen Fehler — die
 * Karte ist einfach nicht mehr erreichbar, und das faellt erst auf, wenn sie
 * jemand sucht. Genau das faengt diese Pruefung ab.
 *
 * Aufruf: node tools/pruef-gruppen.js
 */
const fs = require('node:fs')
const path = require('node:path')

const datei = path.join(__dirname, '..', 'src/frontend-admin/src/app/seiten/darstellung.ts')
const src = fs.readFileSync(datei, 'utf8')

const gruppenBlock = /bauformGruppen = \[([\s\S]*?)\n {2}\]/.exec(src)
const listenBlock = /varianten = \[([\s\S]*?)\n {2}\]/.exec(src)
if (!gruppenBlock || !listenBlock) {
  console.error('Bauformen oder Gruppen nicht gefunden — wurde umbenannt?')
  process.exit(2)
}

const inGruppen = [...gruppenBlock[1].matchAll(/ids: \[([^\]]+)\]/g)].flatMap((m) =>
  (m[1].match(/'([^']+)'/g) ?? []).map((s) => s.slice(1, -1)),
)
const karten = [...listenBlock[1].matchAll(/id: '([^']+)'/g)].map((m) => m[1])

const fehlen = karten.filter((v) => !inGruppen.includes(v))
const doppelt = inGruppen.filter((v, i) => inGruppen.indexOf(v) !== i)
const geister = inGruppen.filter((v) => !karten.includes(v))

console.log(`Bauformen: ${karten.length}, in Gruppen: ${inGruppen.length}`)
if (fehlen.length) console.error(`In KEINER Gruppe (unerreichbar): ${fehlen.join(', ')}`)
if (doppelt.length) console.error(`In MEHREREN Gruppen: ${doppelt.join(', ')}`)
if (geister.length) console.error(`Gruppe nennt eine Bauform, die es nicht gibt: ${geister.join(', ')}`)

const heil = !fehlen.length && !doppelt.length && !geister.length
console.log(heil ? 'Jede Bauform ist genau einmal erreichbar.' : 'FEHLER siehe oben.')
process.exit(heil ? 0 : 1)
