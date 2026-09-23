#!/usr/bin/env -S npx tsx
/**
 * WOZU
 *   Die Gegenprobe zu tools/quellen-ueberschneidung.mjs: dort steht, WIE VIELE
 *   Werke doppelt in mehreren Diensten liegen — hier steht, was die
 *   eingeschaltete Verschmelzung daraus WIRKLICH macht. Vorher/nachher an den
 *   echten Daten der Box, ohne die Box anzufassen.
 *
 *   ES LAEUFT DIESELBE KETTE WIE IM SERVER, Funktion fuer Funktion:
 *     werkeAus()                (werke.ts)        Eintraege -> Kacheln
 *     zuordnungenVorschlagen()  (abgleich.ts)     wer ist dasselbe? (Stufe 1)
 *     verschmelzeWerke()        (verschmelzung.ts) Kacheln zusammenlegen
 *   Ein Werkzeug mit eigener Regel zeigte irgendwann etwas anderes als die
 *   Box — und man glaubte ihm. Genau deshalb wird hier NICHTS nachgebaut.
 *
 *   AM 2026-08-03 GEMESSEN (Box 192.168.178.169, nur lesend):
 *     vorher 26 Kacheln, nachher 24 — genau 2 weniger.
 *     jellyfin + spotify  Kapelle Petra — HAMM
 *     jellyfin + spotify  Das Lumpenpack — Die Zukunft wird groß
 *     1 mehrdeutiger Schluessel (spotify:2QqQ…, music + audiobook) — er wird
 *     GEMELDET und uebergangen, nicht still verschmolzen.
 *
 *   WAS MAN HIER SIEHT UND IN DER OBERFLAECHE NICHT: welche Quelle nach dem
 *   Verschmelzen SPIELT (quellen[0]) und welcher Schluessel die IDENTITAET
 *   behaelt. Der zweite Punkt ist der teure: an ihm haengen Verlauf
 *   (gespielt.json), Weiterhoeren (resume.json), Favoriten und die Bildadresse.
 *
 * WAS ES AENDERT
 *   NICHTS. Ein einziges lesendes `ssh … cat data.json` (oder --datei). Kein
 *   Schreiben, kein systemctl, kein Deploy, und es legt auch keine
 *   verschmelzung.json an — das tut nur der Knopf in der Verwaltung.
 *   Das Feld `cover` fliegt SOFORT nach dem Einlesen raus: bei Jellyfin steht
 *   der api_key im Klartext darin.
 *
 * AUFRUF — MIT tsx, NICHT MIT node
 *   npx tsx tools/verschmelzung-probe.mjs                  # Box 192.168.178.169
 *   npx tsx tools/verschmelzung-probe.mjs --box 192.168.2.5
 *   npx tsx tools/verschmelzung-probe.mjs --datei /pfad/data.json
 *   npx tsx tools/verschmelzung-probe.mjs --ablage /pfad/verschmelzung.json
 *   npx tsx tools/verschmelzung-probe.mjs --json
 *
 *   --ablage nimmt eine vorhandene verschmelzung.json mit (Handentscheidungen
 *   und Trennungen). Ohne sie wird gerechnet, als haette noch nie jemand
 *   abgeglichen — also der Zustand VOR dem ersten Knopfdruck.
 *
 *   WARUM tsx: Node kann die Typen inzwischen selbst abstreifen, aber nicht die
 *   Importe ohne Endung aufloesen, die der Bestand ueberall benutzt.
 *
 * RUECKGABE
 *   0  gerechnet (auch wenn es nichts zu verschmelzen gibt)
 *   1  mindestens ein mehrdeutiger Schluessel — er blockiert dort jede Zuordnung
 *   2  data.json nicht lesbar
 *   3  ohne tsx gestartet
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

// DYNAMISCH, damit der Hinweis auf tsx ueberhaupt zum Zuge kommt: ein
// statischer Import scheitert, bevor eine einzige Zeile hier laeuft.
let werkeAus
let zuordnungenVorschlagen
let ablageAus
let verschmelzeWerke
try {
  ;({ werkeAus } = await import('../src/backend-api/src/werke.ts'))
  ;({ zuordnungenVorschlagen, ablageAus } = await import('../src/backend-api/src/abgleich.ts'))
  ;({ verschmelzeWerke } = await import('../src/backend-api/src/verschmelzung.ts'))
} catch (fehler) {
  console.error('Die Regeln aus src/backend-api liessen sich nicht laden.')
  console.error('Bitte mit tsx starten:  npx tsx tools/verschmelzung-probe.mjs')
  console.error(`(${fehler.message})`)
  process.exit(3)
}

const ausfuehren = promisify(execFile)

const BOX = '192.168.178.169'
const BENUTZER = 'dietpi'
const PFAD = '/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/data.json'

function argument(name, vorgabe) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : vorgabe
}
const alsJson = process.argv.includes('--json')

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  const zeilen = (await readFile(fileURLToPath(import.meta.url), 'utf8')).split('\n')
  console.log(zeilen.slice(1, zeilen.indexOf(' */') + 1).join('\n'))
  process.exit(0)
}

async function katalogLesen() {
  const datei = argument('datei', '')
  if (datei) return JSON.parse(await readFile(datei, 'utf8'))
  const box = argument('box', BOX)
  // NUR LESEND. BatchMode: lieber ein Fehler als eine Passwortfrage, die in
  // einem Skript ewig haengenbleibt.
  const { stdout } = await ausfuehren('ssh', [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=8',
    `${BENUTZER}@${box}`,
    `cat ${PFAD}`,
  ])
  return JSON.parse(stdout)
}

let roh
try {
  roh = await katalogLesen()
} catch (fehler) {
  console.error(`data.json nicht lesbar: ${fehler.message}`)
  process.exit(2)
}

// SOFORT: das Cover fliegt raus, bevor irgendetwas anderes passiert.
const liste = (Array.isArray(roh) ? roh : []).map(({ cover, ...rest }) => rest)

let ablage = { zuordnungen: [], getrennt: [] }
const ablagePfad = argument('ablage', '')
if (ablagePfad) {
  try {
    ablage = ablageAus(JSON.parse(await readFile(ablagePfad, 'utf8')))
  } catch (fehler) {
    console.error(`Ablage nicht lesbar, es wird ohne gerechnet: ${fehler.message}`)
  }
}

// DIE KETTE, genau wie im Server.
const vorher = werkeAus(liste, { verschmelzen: false })
const { vorschlaege, mehrdeutig, uebergangen } = zuordnungenVorschlagen(vorher, { getrennt: ablage.getrennt })
// Die abgelegten ZUERST: sie sind die aeltere Behauptung, und
// `verschmelzeWerke` laesst die erste gelten (Fall 4 dort).
const zuordnungen = [...ablage.zuordnungen, ...vorschlaege]
const nachher = verschmelzeWerke(vorher, zuordnungen)

const verschmolzen = nachher
  .filter((w) => w.auchSchluessel?.length)
  .map((w) => ({
    titel: w.titel,
    interpret: w.interpret ?? '',
    // DIE IDENTITAET — daran haengen Verlauf, Weiterhoeren und Favoriten.
    schluessel: w.schluessel,
    auch: w.auchSchluessel,
    stufe: w.stufe,
    // quellen[0] IST die Quelle, mit der gespielt wird (bevorzugteQuelle).
    spielt: w.quellen[0]?.dienst,
    quellen: w.quellen.map((q) => q.dienst),
  }))

if (alsJson) {
  console.log(
    JSON.stringify(
      { vorher: vorher.length, nachher: nachher.length, verschmolzen, mehrdeutig, uebergangen, zuordnungen },
      null,
      2,
    ),
  )
} else {
  console.log(`\nKacheln vorher ${vorher.length}  ->  nachher ${nachher.length}  (${vorher.length - nachher.length} weniger)\n`)
  if (verschmolzen.length) {
    console.log(`Zusammengelegt: ${verschmolzen.length}`)
    for (const v of verschmolzen) {
      console.log(`  ${v.interpret} — ${v.titel}`)
      console.log(`    Quellen ${v.quellen.join(' + ')}, spielt ueber ${v.spielt} (${v.stufe})`)
      console.log(`    Identitaet bleibt ${v.schluessel}`)
      console.log(`    geht darin auf: ${v.auch.join(', ')}`)
    }
  } else {
    console.log('Zusammengelegt: nichts.')
  }
  if (uebergangen.length) {
    console.log(`\nUebergangen: ${uebergangen.length}`)
    for (const u of uebergangen) {
      console.log(`  [${u.grund}] ${u.interpret ?? ''} — ${u.titel}`)
      for (const s of u.schluessel) console.log(`    ${s}`)
    }
  }
  if (mehrdeutig.length) {
    console.log(`\nMehrdeutige Schluessel: ${mehrdeutig.length}`)
    for (const m of mehrdeutig) {
      console.log(`  ${m.schluessel}  ${m.anzahl}x  ${m.interpret ?? ''} — ${m.titel}`)
      console.log(`    Kategorien: ${m.kategorien.join(', ')}`)
    }
    // Der WEG steht mit dabei: „Doppelte" ist seit dem 03.08.2026 keine Seite
    // der Kopfleiste mehr, sondern haengt unter „Medien". Ein Hinweis, der
    // einen Namen nennt, den man in der Leiste nicht findet, ist keiner.
    console.log('    -> jede Zuordnung darauf wird abgewiesen. In der Verwaltung')
    console.log('       unter Medien › Doppelte die ueberzaehlige Zeile entfernen.')
  }
  console.log('')
}

process.exit(mehrdeutig.length ? 1 : 0)
