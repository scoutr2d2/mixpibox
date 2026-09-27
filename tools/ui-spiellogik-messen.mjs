#!/usr/bin/env node
// WAS: Misst, wieviel SPIEL-ENTSCHEIDUNGSLOGIK heute noch in der Neu-UI
//   (NewDesign/app.js) wohnt - die Zahl, gegen die E95/V abgenommen wird.
//   Zwei Masse:
//     1. Zeilen der bekannten Entscheidungsfunktionen (abspielBefehl & Co —
//        seit E95/V Stufe 3 im Server als `startPlan`, hier also erwartet
//        'nicht gefunden'; genau das ist der Beweis)
//     2. Dienstnamen-Vorkommen in der ganzen Datei (die RATSCHE: sie darf
//        nur sinken, siehe BACKLOG E95/V Nachsatz 2)
//
// AUFRUF:  node tools/ui-spiellogik-messen.mjs
//          node tools/ui-spiellogik-messen.mjs --deckel <zahl>   (Wache)
//
// WARUM ALS WERKZEUG: Die Zahl steht in BACKLOG und im Wissenspaket
//   ([[die-ui-spielt-das-backend-entscheidet]]). Wer sie zitiert, soll sie
//   nachmessen koennen, statt sie zu glauben - sie ist der Beleg dafuer,
//   dass der Umbau die UI wirklich KLEINER macht.
//
// WAS ES NICHT TUT: Es parst kein JavaScript. Es zaehlt ab der Zeile mit der
//   Funktionsdefinition bis zur schliessenden Klammer AUF DERSELBEN EINRUECK-
//   TIEFE. Bei umgebauten Funktionen (Pfeilfunktion, Objektmethode) meldet es
//   'nicht gefunden' statt zu raten - eine fehlende Zeile ist ehrlicher als
//   eine erfundene.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATEI = join(WURZEL, 'NewDesign/app.js')

// Die fuenf Stellen, die der Betreiber-Entscheid vom 30.08.2026 benennt. Sie
// bleiben hier stehen, NACHDEM sie geloescht sind: die Liste ist das Soll,
// gegen das gemessen wird, und ihr Nachfolger im Server heisst `startPlan`.
// Wer sie kuerzt, weil „gibt es ja nicht mehr", nimmt der Ratsche ihre Zaehne.
const FUNKTIONEN = ['abspielBefehl', 'weiterSpielen', 'ardSendungAb', 'spielen', 'albumSpielen']

// Dienstnamen, deren Vorkommen die Ratsche zaehlt. Bewusst roh (Teilwort-
// Treffer erlaubt): 'spotifyGeraet', 'mpvBefehl' und 'ARD_BASIS' sind alle
// Wissen ueber einen Dienst, das nach E95/V ins Backend gehoert.
const DIENSTNAMEN = ['spotify', 'Spotify', 'ARD', 'mpv', 'radio']

const zeilen = readFileSync(DATEI, 'utf8').split('\n')

function messeFunktion(name) {
  const start = zeilen.findIndex((z) => new RegExp(`^\\s*(async\\s+)?function\\s+${name}\\s*\\(`).test(z))
  if (start === -1) return null
  const tiefe = zeilen[start].match(/^\s*/)[0].length
  for (let i = start + 1; i < zeilen.length; i++) {
    if (new RegExp(`^\\s{${tiefe}}\\}`).test(zeilen[i])) return { start: start + 1, laenge: i - start + 1 }
  }
  return null
}

let summe = 0
console.log('── Spiel-Entscheidungslogik in NewDesign/app.js ──')
for (const name of FUNKTIONEN) {
  const t = messeFunktion(name)
  if (!t) {
    console.log(`  ${name.padEnd(16)} nicht gefunden (umgebaut oder entfernt?)`)
    continue
  }
  summe += t.laenge
  console.log(`  ${name.padEnd(16)} ${String(t.laenge).padStart(4)} Zeilen  (ab Zeile ${t.start})`)
}
console.log(`  ${'SUMME'.padEnd(16)} ${String(summe).padStart(4)} Zeilen`)

const text = zeilen.join('\n')
let vorkommen = 0
console.log('')
console.log('── Dienstnamen-Vorkommen (die Ratsche: darf nur SINKEN) ──')
for (const d of DIENSTNAMEN) {
  const n = (text.match(new RegExp(d, 'g')) || []).length
  vorkommen += n
  console.log(`  ${d.padEnd(16)} ${String(n).padStart(4)}`)
}
console.log(`  ${'SUMME'.padEnd(16)} ${String(vorkommen).padStart(4)}`)

const i = process.argv.indexOf('--deckel')
if (i !== -1) {
  const deckel = Number(process.argv[i + 1])
  if (!Number.isFinite(deckel)) {
    console.error('FEHLER: --deckel braucht eine Zahl')
    process.exit(2)
  }
  if (vorkommen > deckel) {
    console.error(`\nRATSCHE GERISSEN: ${vorkommen} Dienstnamen-Vorkommen, erlaubt sind hoechstens ${deckel}.`)
    console.error('Neues Dienstwissen gehoert nach E95/V ins Backend, nicht in die UI.')
    process.exit(1)
  }
  console.log(`\nRatsche haelt: ${vorkommen} <= ${deckel}.`)
}
