#!/usr/bin/env -S npx tsx
/**
 * WOZU
 *   Die eine Zahl, an der die ganze Verschmelzung haengt: WIE VIELE Werke der
 *   Box gibt es ueberhaupt in mehr als einem Dienst? Solange die Antwort null
 *   ist, waere jeder Abgleich gegen einen leeren Fall gebaut — man haette
 *   Treffverhalten geglaubt, das nie eines hatte.
 *
 *   AM 2026-08-02 GEMESSEN: 22 Eintraege, davon 21 spotify und 1 jellyfin,
 *   KEIN einziger lokaler — Ueberschneidung NULL.
 *   AM 2026-08-03 SCHON WIEDER ANDERS: 26 Eintraege, 24 spotify, 2 jellyfin —
 *   Ueberschneidung ZWEI („Kapelle Petra — HAMM" und „Das Lumpenpack — Die
 *   Zukunft wird groß"). Der Nutzer hatte dazwischen Jellyfin-Inhalte
 *   dazugelegt. GENAU DAFUER gibt es dieses Werkzeug statt einer Zeile
 *   Befehlsgeschichte: die Zahl aendert sich, und dann muss man sie
 *   NACHMESSEN koennen, nicht erinnern. (Der Erkundungsbericht vom 02. nannte
 *   sogar 12 Eintraege — noch ein Grund, nicht zu erinnern.)
 *
 *   WAS DIE BOX DARAUS MACHT, misst das Nachbarwerkzeug:
 *   tools/verschmelzung-probe.mjs — dieselbe Kette wie im Server, vorher und
 *   nachher. Hier steht, WAS doppelt liegt; dort, was daraus wird.
 *
 *   Es meldet drei Dinge:
 *     1. je Dienst die Anzahl der Eintraege
 *     2. die Paare, die Stufe 1 zusammenwerfen wuerde — samt fertigem
 *        Zuordnungsvorschlag fuer `verschmelzung.ts`
 *     3. MEHRDEUTIGE SCHLUESSEL. Zwei Eintraege mit demselben
 *        `medienSchluessel` sind eine Falle mit drei verschiedenen Folgen
 *        (findeIndex verweigert, eintragZuSchluessel nimmt still den ersten,
 *        werkAus liefert doppelte Schluessel) — und `verschmelzeWerke` weist
 *        sie ab, statt ein geratenes Werk zu verschmelzen. Auf der Box
 *        gefunden: zwei Eintraege, dieselbe `playlistid`, verschieden nur in
 *        `category` (music / audiobook).
 *
 *   KEINE ZWEITE WAHRHEIT: die Gruppierung kommt aus `gruppiereTreffer()`
 *   (medien.ts), der Schluessel aus `medienSchluessel()`, die Art aus
 *   `artVon()` — dieselben Funktionen, die auch der Server benutzt. Ein
 *   Werkzeug mit eigener Abgleichregel zeigte irgendwann etwas anderes als die
 *   Box, und man glaubte ihm.
 *
 * WAS ES AENDERT
 *   NICHTS. Ein einziges lesendes `ssh … cat data.json` (oder eine lokale
 *   Datei mit --datei). Kein Schreiben, kein systemctl, kein Deploy.
 *   Das Feld `cover` wird SOFORT nach dem Einlesen weggeworfen: bei Jellyfin
 *   steht der api_key im Klartext darin, und er hat weder in einer Ausgabe
 *   noch in einer Zwischenablage etwas verloren.
 *
 * AUFRUF — MIT tsx, NICHT MIT node
 *   npx tsx tools/quellen-ueberschneidung.mjs             # Box 192.168.178.169
 *   npx tsx tools/quellen-ueberschneidung.mjs --box 192.168.2.5
 *   npx tsx tools/quellen-ueberschneidung.mjs --datei /pfad/data.json
 *   npx tsx tools/quellen-ueberschneidung.mjs --json      # zum Weiterverarbeiten
 *
 *   WARUM tsx: Node kann die Typen inzwischen selbst abstreifen (v26.4.0
 *   getestet), aber NICHT die Importe ohne Endung aufloesen, die der Bestand
 *   ueberall benutzt (`import … from './medien'`). Ein reines `node …`
 *   scheitert deshalb an werke.ts — das Werkzeug faengt das ab und sagt es,
 *   statt einen Stapelauszug hinzuwerfen, den man fuer einen echten Fehler
 *   haelt.
 *
 * RUECKGABE
 *   0  nichts Auffaelliges (eine Ueberschneidung ist NICHT auffaellig — sie
 *      ist das Gesuchte)
 *   1  mindestens ein mehrdeutiger Schluessel
 *   2  data.json nicht lesbar
 *   3  ohne tsx gestartet
 */

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

// DYNAMISCH, damit der Hinweis auf tsx ueberhaupt zum Zuge kommt: ein
// statischer Import scheitert, bevor eine einzige Zeile hier laeuft.
let dienstVon
let gruppiereTreffer
let medienSchluessel
let artVon
try {
  ;({ dienstVon, gruppiereTreffer, medienSchluessel } = await import('../src/backend-api/src/medien.ts'))
  ;({ artVon } = await import('../src/backend-api/src/werke.ts'))
} catch (fehler) {
  console.error('Die Regeln aus src/backend-api liessen sich nicht laden.')
  console.error('Bitte mit tsx starten:  npx tsx tools/quellen-ueberschneidung.mjs')
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
  // Bis zum Ende des Kopfkommentars, nicht bis zu einer festen Zeilenzahl:
  // eine feste Zahl schneidet die Hilfe ab, sobald jemand oben etwas ergaenzt.
  const zeilen = (await readFile(fileURLToPath(import.meta.url), 'utf8')).split('\n')
  console.log(zeilen.slice(1, zeilen.indexOf(' */') + 1).join('\n'))
  process.exit(0)
}

/** data.json holen — von der Box oder aus einer Datei. */
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

/**
 * Welche Kennungsfelder der Eintrag TRAEGT — nicht, welches gewinnt.
 *
 * Die Vorrangregel steht in `medienSchluessel()` und wird hier bewusst NICHT
 * nachgebaut; sie ein zweites Mal hinzuschreiben waere genau der Fehler, den
 * tools/verfuegbarkeit-abgleich.py schon einmal aufgedeckt hat (id vor
 * playlistid an der einen Stelle, umgekehrt an der anderen). Aufgezaehlt wird
 * nur, was dasteht — bei einem mehrdeutigen Schluessel sieht man daran sofort,
 * WORUEBER die beiden Eintraege kollidieren.
 */
const KENNUNGSFELDER = ['id', 'playlistid', 'showid', 'audiobookid', 'spotify_url']

const eintraege = liste.map((e, nr) => ({
  nr,
  dienst: dienstVon(e),
  art: artVon(e),
  schluessel: medienSchluessel(e),
  title: String(e.title ?? ''),
  artist: String(e.artist ?? ''),
  category: String(e.category ?? ''),
  felder: KENNUNGSFELDER.filter((f) => String(e[f] ?? '').trim()),
}))

// 1. Je Dienst zaehlen.
const jeDienst = {}
for (const e of eintraege) jeDienst[e.dienst] = (jeDienst[e.dienst] ?? 0) + 1

// 2. Was Stufe 1 zusammenwerfen wuerde. `gruppiereTreffer` verlangt dieselbe
//    `art`, gleichen normalisierten Titel und einen lose passenden Interpreten
//    — und niemals zwei Treffer DESSELBEN Dienstes.
const gruppiert = gruppiereTreffer(eintraege)
const gruppen = new Map()
for (const t of gruppiert) {
  if (!gruppen.has(t.gruppe)) gruppen.set(t.gruppe, [])
  gruppen.get(t.gruppe).push(t)
}
const ueberschneidungen = [...gruppen.values()]
  .filter((g) => g.length > 1)
  .map((g) => ({
    dienste: [...new Set(g.map((t) => t.dienst))].sort(),
    titel: g[0].title,
    interpret: g[0].artist,
    // Fertig fuer config/verschmelzung.json. `locker` ist die Stufe, die
    // `gruppiereTreffer` verkoerpert — sie MITZUSCHREIBEN ist Pflicht, damit
    // die Verwaltung spaeter sagen kann, wer die Zusammenfassung behauptet.
    zuordnung: { schluessel: g[0].schluessel, auch: g.slice(1).map((t) => t.schluessel), stufe: 'locker' },
  }))

// 3. Mehrdeutige Schluessel.
const proSchluessel = new Map()
for (const e of eintraege) {
  if (!proSchluessel.has(e.schluessel)) proSchluessel.set(e.schluessel, [])
  proSchluessel.get(e.schluessel).push(e)
}
const mehrdeutig = [...proSchluessel.entries()].filter(([, e]) => e.length > 1)

if (alsJson) {
  console.log(
    JSON.stringify(
      {
        anzahl: eintraege.length,
        jeDienst,
        ueberschneidungen,
        mehrdeutig: mehrdeutig.map(([s, e]) => ({ schluessel: s, eintraege: e })),
      },
      null,
      2,
    ),
  )
} else {
  console.log(`\n${eintraege.length} Eintraege\n`)
  for (const [d, n] of Object.entries(jeDienst).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${d.padEnd(10)} ${n}`)
  }

  console.log(`\nUeberschneidung zwischen Diensten: ${ueberschneidungen.length}`)
  if (!ueberschneidungen.length) {
    console.log('  keine — es gibt derzeit nichts zu verschmelzen.')
    console.log('  (Zum Pruefen eines Treffverhaltens muss ein Fall von Hand entstehen:')
    console.log('   dasselbe Album zusaetzlich im anderen Dienst aufnehmen.)')
  }
  for (const u of ueberschneidungen) {
    console.log(`  ${u.dienste.join(' + ')}  ${u.interpret} — ${u.titel}`)
    console.log(`    ${JSON.stringify(u.zuordnung)}`)
  }

  console.log(`\nMehrdeutige Schluessel: ${mehrdeutig.length}`)
  for (const [s, e] of mehrdeutig) {
    console.log(`  ${s}`)
    for (const x of e) {
      console.log(
        `    Zeile ${x.nr}  category=${x.category}  felder=${x.felder.join(',') || '—'}  ${x.artist} — ${x.title}`,
      )
    }
    console.log('    -> findeIndex() gibt -1, eintragZuSchluessel() nimmt still den ersten,')
    console.log('       verschmelzeWerke() weist jede Zuordnung darauf ab.')
  }
  console.log('')
}

process.exit(mehrdeutig.length ? 1 : 0)
