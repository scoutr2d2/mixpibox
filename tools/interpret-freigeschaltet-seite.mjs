#!/usr/bin/env -S npx tsx
/**
 * WOZU
 *   Die eine Frage, die beim Bau der Freischaltung NICHT gestellt wurde:
 *   Wenn ein Interpret der EIGENEN Bibliothek unter seinem BIBLIOTHEKSNAMEN
 *   mit der Kennung eines anders heissenden Spotify-Treffers freigeschaltet
 *   wird — steht seine Reihe „In deiner Box" danach noch auf SEINER SEITE?
 *
 *   Gemessen wurde bisher nur die REIHE (llmwiki [interpreten-verwaltungsseite]:
 *   „steht danach MIT seinem Werk und an seinem alten Platz in der Reihe").
 *   Das ist die halbe Strecke. Die Kachel fuehrt auf `/api/interpret/:id`, und
 *   dort baut `interpretenseiteBauen` (interpretenseite.ts) die Reihe
 *   „In deiner Box" ueber
 *
 *       normal(artist.name ?? query.name)   ==   werk.interpretSchluessel
 *
 *   Der Spotify-Name geht dabei VOR dem mitgeschickten Bibliotheksnamen. Genau
 *   das ist der haeufigste Fall dieser Box (7 von 16 Namen kennt Spotify nicht
 *   unter dem Bibliotheksnamen) — also genau der Fall, fuer den es die
 *   Freischaltung gibt.
 *
 *   OHNE NETZ UND OHNE BOX. Beide Regeln sind rein; hier wird nur eine
 *   Spotify-Antwort nachgestellt, wie sie `/api/interpret/:id` bekommt.
 *
 * WAS ES AENDERT
 *   NICHTS. Es liest keine Datei der Box, schreibt keine, spricht mit
 *   niemandem. Reine Rechnung.
 *
 * AUFRUF
 *   npx tsx tools/interpret-freigeschaltet-seite.mjs
 *   npx tsx tools/interpret-freigeschaltet-seite.mjs --bibliothek "EUROPA Hörspiele & Kinderlieder" --spotify "EUROPA"
 *
 * RUECKGABE
 *   0  „In deiner Box" steht auf der Seite
 *   1  „In deiner Box" FEHLT — das Werk des Kindes ist von seiner Seite weg
 *   3  ohne tsx gestartet
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

let werkeAus
let interpretenAblageAus
let interpretenReihe
let freischalten
let interpretenseiteBauen
try {
  ;({ werkeAus } = await import('../src/backend-api/src/werke.ts'))
  ;({ interpretenAblageAus, interpretenReihe, freischalten } = await import(
    '../src/backend-api/src/interpreten.ts'
  ))
  ;({ interpretenseiteBauen } = await import('../src/backend-api/src/interpretenseite.ts'))
} catch (fehler) {
  console.error('Die Regeln aus src/backend-api liessen sich nicht laden.')
  console.error('Bitte mit tsx starten:  npx tsx tools/interpret-freigeschaltet-seite.mjs')
  console.error(`(${fehler.message})`)
  process.exit(3)
}

function argument(name, vorgabe) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : vorgabe
}

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  const zeilen = (await readFile(fileURLToPath(import.meta.url), 'utf8')).split('\n')
  console.log(zeilen.slice(1, zeilen.indexOf(' */') + 1).join('\n'))
  process.exit(0)
}

// Der Bibliotheksname ist der, unter dem das Werk in data.json steht; der
// Spotify-Name der des Treffers, dessen Kennung freigeschaltet wurde. Genau
// dass die beiden AUSEINANDERGEHEN, ist der Fall — sonst braeuchte es die
// Freischaltung gar nicht.
const bibliotheksname = argument('bibliothek', 'EUROPA Hörspiele & Kinderlieder')
const spotifyName = argument('spotify', 'EUROPA')
const KENNUNG = argument('id', '1aaaaaaaaaaaaaaaaaaaaa')

const katalog = [
  {
    id: '3nnnnnnnnnnnnnnnnnnnnn',
    type: 'spotify',
    title: 'Bibi Blocksberg Folge 1',
    artist: bibliotheksname,
    category: 'audiobook',
  },
]

const werke = werkeAus(katalog, { verschmelzen: false, zuordnungen: [] })
const ablage = freischalten(interpretenAblageAus({}), {
  id: KENNUNG,
  // SO SCHICKT ES DIE VERWALTUNG: die Kennung des Spotify-Treffers, aber der
  // BIBLIOTHEKSNAME (seiten/interpreten.ts, `zuordnenZu()`).
  name: bibliotheksname,
  quelle: 'suche',
})

const { reihe } = interpretenReihe(werke, ablage, new Map())
const kachel = reihe.find((p) => p.name === bibliotheksname)

console.log('== 1. DIE REIHE (das, was bisher gemessen wurde) ==')
console.log(`  Kacheln: ${reihe.length}`)
console.log(`  „${bibliotheksname}": ${kachel ? `steht drin, ${kachel.anzahl} Werk(e), id ${kachel.id}` : 'FEHLT'}`)

// So antwortet Spotify auf `artists/<id>` — mit SEINEM Namen, nicht mit dem
// der Bibliothek.
const seite = interpretenseiteBauen({
  artist: { name: spotifyName, images: [], genres: [], followers: { total: 1234 } },
  topTracks: [],
  alben: [],
  singles: [],
  sammlungen: [],
  gesamt: { alben: 0, singles: 0, sammlungen: 0 },
  werke,
  // Das schickt die Oberflaeche mit (`&name=…`, NewDesign/app.js).
  name: bibliotheksname,
})

const box = seite.reihen.find((r) => r.id === 'box')
console.log('== 2. DIE SEITE, auf die die Kachel fuehrt ==')
console.log(`  Kopfname:      „${seite.kopf.name}"   (angetippt wurde „${bibliotheksname}")`)
console.log(`  „In deiner Box": ${box ? `${box.eintraege.length} Kachel(n)` : 'FEHLT'}`)
console.log(`  Reihen gesamt: ${seite.reihen.length}`)

if (!box) {
  console.log('')
  console.log('BEFUND: Das Werk der Box ist von der Interpretenseite verschwunden.')
  console.log(`        normal("${spotifyName}") != werk.interpretSchluessel (aus „${bibliotheksname}").`)
  process.exit(1)
}
process.exit(0)
