/**
 * LOESCHBEFEHL NACHBAUEN — was `rm -r` beim Papierkorb der Medienliste WIRKLICH trifft.
 *
 * Die Kette hat drei Glieder, und jedes davon verformt die Zeichenkette:
 *   1. src/frontend-box/src/app/player.service.ts:233
 *        `deletelocal/${encodeURIComponent(cat)}:${encodeURIComponent(artist)}:${encodeURIComponent(title)}`
 *   2. src/backend-player/src/spotify-control.ts:2178
 *        `path.parse(req.url)` — command.name ist der BASENAME OHNE ENDUNG
 *   3. src/backend-player/src/spotify-control.ts:1737-1739
 *        `decodeURI(x).replace(/:/g,'/')`, dann `decodeURIComponent(...)`,
 *        eingesetzt in `rm -r "…"` und an eine SHELL gegeben.
 *
 * Dieses Werkzeug baut GENAU diese drei Schritte nach und druckt den Befehl,
 * der entstuende. ES FUEHRT NICHTS AUS. Wer die Kette aendert, laesst das hier
 * laufen und sieht sofort, ob ein Werk noch sein eigener Ordner ist.
 *
 *   node tools/loeschbefehl-nachbauen.mjs
 *   node tools/loeschbefehl-nachbauen.mjs "audiobook" "Bibi" "Folge 1"
 */

import path from 'node:path'

const WURZEL = '/home/dietpi/MuPiBox/media'

/** Glied 1: was die Oberflaeche der Box schickt. */
function url(category, artist, title) {
  return `/deletelocal/${encodeURIComponent(category)}:${encodeURIComponent(artist)}:${encodeURIComponent(title)}`
}

/** Glied 2 + 3: was der Abspieldienst daraus macht. */
function befehl(category, artist, title) {
  const command = path.parse(url(category, artist, title))
  if (!command.dir.includes('deletelocal')) return { command, cmd: '(trifft deleteLocal nicht)' }
  const deleteFilePath = decodeURI(command.name).replace(/:/g, '/')
  return { command, cmd: `rm -r "${WURZEL}/${decodeURIComponent(deleteFilePath)}"` }
}

const faelle = process.argv.length > 2
  ? [process.argv.slice(2, 5)]
  : [
      ['audiobook', 'Bibi', 'Folge 1'],
      // Ein Punkt im Titel. `path.parse` haelt alles ab dem letzten Punkt fuer
      // eine DATEIENDUNG und schneidet es aus `name` heraus.
      ['audiobook', 'Benjamin', 'Folge 12. Der Ausflug'],
      ['music', 'Rolf Zuckowski', 'Vol. 2'],
      // Leerer Titel — der Pfad faellt auf den INTERPRETENORDNER zusammen.
      ['audiobook', 'Bibi', ''],
      // Leerer Interpret UND Titel — er faellt auf die ganze KATEGORIE zusammen.
      ['audiobook', '', ''],
      // Ein Schraegstrich im Namen (kommt vor: "AC/DC").
      ['music', 'AC/DC', 'Back in Black'],
      // Ein Anfuehrungszeichen — die Umschliessung in der Shell ist nur `"`.
      ['audiobook', 'Bibi', 'x" ; echo TREFFER ; touch /tmp/beleg ; "'],
    ]

console.log('WURZEL:', WURZEL)
console.log('Nichts wird ausgefuehrt — nur gebaut.\n')

for (const [c, a, t] of faelle) {
  const { command, cmd } = befehl(c, a, t)
  const soll = `${WURZEL}/${c}/${a}/${t}`
  const stimmt = cmd === `rm -r "${soll}"`
  console.log(`  (${JSON.stringify(c)}, ${JSON.stringify(a)}, ${JSON.stringify(t)})`)
  console.log(`      url    : ${url(c, a, t)}`)
  console.log(`      name   : ${JSON.stringify(command.name)}   ext: ${JSON.stringify(command.ext)}`)
  console.log(`      befehl : ${cmd}`)
  console.log(`      ${stimmt ? 'trifft das Werk' : '>>> TRIFFT ETWAS ANDERES ALS DAS WERK <<<'}`)
  console.log()
}
