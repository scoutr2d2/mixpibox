#!/usr/bin/env node
/**
 * GESTALTER-KATALOG-DECKUNG — kann der Gestalter jedes Formatfeld stellen?
 *
 * ══ WARUM (BACKLOG E144, 27.09.2026) ═══════════════════════════════════════
 * Der Gestalter (NewDesign/gestalter/) baut seine Regler aus zwei Quellen:
 * WELCHE Felder und Werte es gibt, sagt das Format (mixpi-thema.ts, als
 * Abschrift format.mjs); WO ein Feld im Gestalter steht, sagt katalog.mjs.
 * Kommt ein Feld ins Format und niemand traegt es im Katalog ein, laesst sich
 * ein Thema damit nur noch per Datei bauen — still, niemand sucht einen
 * Regler, von dem er nicht weiss, dass es ihn geben muesste.
 *
 * GEPRUEFT WIRD in beide Richtungen und dazu, was beim Ziehen zaehlt:
 *   1. jedes Formatfeld ist im Katalog angeboten;
 *   2. jedes angebotene Feld gibt es im Format;
 *   3. jedes angebotene Feld hat eine Beschriftung (WORTE);
 *   4. jede Zone, die ein Element nennt, gibt es;
 *   5. ANDOCKEN IST UMKEHRBAR: fuer jedes bewegliche Element und jede
 *      seiner Zonen liest `lesen()` nach `setzen()` dieselbe Zone zurueck,
 *      und die gesetzten Werte bestehen das Format-Tor;
 *   6. die Farbsaetze im Katalog sind dieselben wie FARB_SAETZE in app.js.
 *
 *   node tools/gestalter-katalog-deckung.mjs            Bericht, Rueckgabe 0/1
 *   node tools/gestalter-katalog-deckung.mjs --pruefen  dasselbe (fuer pruefen.sh)
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const G = join(WURZEL, 'NewDesign/gestalter')

const format = await import(pathToFileURL(join(G, 'format.mjs')).href)
const katalog = await import(pathToFileURL(join(G, 'katalog.mjs')).href)

const fehler = []

const formatFelder = new Set(['licht'])
for (const [block, plan] of Object.entries(format.BLOECKE)) {
  for (const f of Object.keys(plan)) formatFelder.add(`${block}.${f}`)
}
const angeboten = new Set(katalog.angeboteneFelder())

for (const f of formatFelder) if (!angeboten.has(f)) fehler.push(`1. Formatfeld ohne Platz im Gestalter: ${f}`)
for (const f of angeboten) if (!formatFelder.has(f)) fehler.push(`2. Gestalter bietet an, Format kennt es nicht: ${f}`)
for (const f of angeboten) if (!katalog.WORTE[f]) fehler.push(`3. ohne Beschriftung (WORTE): ${f}`)

for (const e of katalog.ELEMENTE) {
  for (const z of e.zonen) if (!katalog.ZONEN[z]) fehler.push(`4. ${e.id}: Zone „${z}" gibt es nicht`)
  if (e.fest) continue
  for (const z of e.zonen) {
    if (katalog.ZONEN[z]?.gesperrt) continue
    const b = {}
    e.setzen(b, z)
    const zurueck = e.lesen(b)
    if (zurueck !== z) fehler.push(`5. ${e.id}: setzen("${z}") liest „${zurueck}" zurueck`)
    const tor = format.pruefeThema({ format: format.FORMAT_KENNUNG, name: 'Probe', bloecke: b })
    if (!tor.ok) fehler.push(`5. ${e.id} in ${z}: Tor lehnt ab — ${tor.fehler.join('; ')}`)
    e.entfernen(b)
    if (e.lesen(b) !== null) fehler.push(`5. ${e.id}: nach entfernen() steht es noch in „${e.lesen(b)}"`)
  }
}

const appJs = readFileSync(join(WURZEL, 'NewDesign/app.js'), 'utf8')
const block = appJs.match(/const FARB_SAETZE = \[([\s\S]*?)\n {2}\]/)
if (!block) fehler.push('6. FARB_SAETZE in app.js nicht gefunden — umgebaut?')
else {
  const imApp = [...block[1].matchAll(/\{ id: '([a-z]+)', wort: '([^']+)' \}/g)].map((m) => `${m[1]}=${m[2]}`)
  const imKatalog = katalog.FARB_SAETZE.map((s) => `${s.id}=${s.wort}`)
  if (imApp.join(',') !== imKatalog.join(','))
    fehler.push(`6. Farbsaetze weichen ab:\n     app.js:  ${imApp.join(', ')}\n     katalog: ${imKatalog.join(', ')}`)
}

if (fehler.length) {
  for (const f of fehler) console.log(f)
  console.log(`\n${fehler.length} Abweichung(en). Katalog: NewDesign/gestalter/katalog.mjs`)
  process.exit(1)
}
console.log(
  `Gestalter-Katalog: alle ${formatFelder.size} Formatfelder stellbar, ${katalog.ELEMENTE.length} Elemente, Andocken umkehrbar, Farbsaetze gleich.`,
)
