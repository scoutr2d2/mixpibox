#!/usr/bin/env -S npx tsx
/**
 * WOZU
 *   Die eine Frage, an der die Interpreten-Reihe haengt: WELCHE Interpreten
 *   der echten Bibliothek erkennt die Regel — und welche nicht?
 *
 *   Sie faehrt BEIDE Regeln gegen dieselben Daten und stellt sie nebeneinander:
 *
 *     ALT  `istInterpret` aus NewDesign/app.js: Namensvergleich mit
 *          `trim().toLowerCase()`, Kennung optional (`{ja:true, id:null}` war
 *          moeglich — die Kachel stand dann da und fuehrte auf nichts).
 *     NEU  `interpretAusTreffern` aus src/backend-api/src/interpreten.ts:
 *          Vergleich mit `namensSchluessel` (NFKC + Kleinschreibung +
 *          Leerzeichen zusammenfassen) und KENNUNG PFLICHT.
 *
 *   Ohne diese Gegenueberstellung weiss niemand, ob die neue Regel BESSER ist
 *   oder nur ANDERS. Genau das ist die Frage, die der Benutzer gestellt hat.
 *
 *   UND SIE HAT SICH SOFORT AUSGEZAHLT. Der erste Entwurf verglich mit
 *   `normal()` (medien.ts). GEMESSEN am 2026-08-03 gegen die echte Box:
 *   `normal()` gewann KEINEN richtigen Treffer dazu und genau EINEN falschen —
 *   "🩵Jojo 🩵" wurde zu "jojo" und traf damit Spotifys Saengerin "JoJo".
 *   Ausgerechnet der Fall, um dessentwillen es dieses Feature gibt. Die Regel
 *   wurde daraufhin geaendert, nicht der Messwert.
 *
 *   ES ZEIGT AUSSERDEM die Ablage-Wirkung: mit `--ablage <datei>` wird die
 *   Reihe so gebaut, wie der Server sie bauen wuerde (`interpretenReihe`) —
 *   samt Freischaltungen und Ablehnungen. Damit laesst sich vor dem Ausrollen
 *   pruefen, was ein „nein" fuer „Jojo" wirklich bewirkt.
 *
 *   KEINE ZWEITE WAHRHEIT: `werkeAus`, `normal` und `interpretAusTreffern`
 *   kommen aus src/backend-api — dieselben Funktionen, die auch der Server
 *   benutzt. Ein Werkzeug mit eigener Regel zeigte irgendwann etwas anderes
 *   als die Box, und man glaubte ihm.
 *
 * WAS ES AENDERT
 *   NICHTS. Ein lesendes `ssh … cat data.json` und je Interpret EIN lesender
 *   GET auf die Durchreiche der Box (`/api/spotify/web/search`). Kein
 *   Schreiben, kein systemctl, kein Deploy.
 *   Das Feld `cover` fliegt SOFORT nach dem Einlesen weg: bei Jellyfin steht
 *   der api_key im Klartext darin.
 *
 * AUFRUF — MIT tsx, NICHT MIT node
 *   npx tsx tools/interpreten-erkennung.mjs                  # Box 192.168.178.169
 *   npx tsx tools/interpreten-erkennung.mjs --box 192.168.2.5
 *   npx tsx tools/interpreten-erkennung.mjs --datei /pfad/data.json
 *   npx tsx tools/interpreten-erkennung.mjs --ablage config/interpreten.json
 *   npx tsx tools/interpreten-erkennung.mjs --json           # zum Weiterverarbeiten
 *
 *   WARUM tsx: Node kann die Typen inzwischen selbst abstreifen, aber NICHT
 *   die Importe ohne Endung aufloesen, die der Bestand ueberall benutzt
 *   (`import … from './medien'`). Ein reines `node …` scheitert an werke.ts —
 *   das Werkzeug faengt das ab und sagt es, statt einen Stapelauszug
 *   hinzuwerfen, den man fuer einen echten Fehler haelt.
 *
 * RUECKGABE
 *   0  gelaufen
 *   1  mindestens ein Interpret faellt zwischen den Regeln auseinander
 *   2  data.json nicht lesbar
 *   3  ohne tsx gestartet
 *   4  die Durchreiche der Box antwortet nicht (dann ist NICHTS gemessen)
 */

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

let werkeAus
let normal
let interpretAusTreffern
let interpretenAblageAus
let interpretenReihe
let zuPruefen
try {
  ;({ normal } = await import('../src/backend-api/src/medien.ts'))
  ;({ werkeAus } = await import('../src/backend-api/src/werke.ts'))
  ;({ interpretAusTreffern, interpretenAblageAus, interpretenReihe, zuPruefen } = await import(
    '../src/backend-api/src/interpreten.ts'
  ))
} catch (fehler) {
  console.error('Die Regeln aus src/backend-api liessen sich nicht laden.')
  console.error('Bitte mit tsx starten:  npx tsx tools/interpreten-erkennung.mjs')
  console.error(`(${fehler.message})`)
  process.exit(3)
}

const ausfuehren = promisify(execFile)

const BOX = '192.168.178.169'
const PORT = 8200
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

const box = argument('box', BOX)

/** data.json holen — von der Box oder aus einer Datei. NUR LESEND. */
async function katalogLesen() {
  const datei = argument('datei', '')
  if (datei) return JSON.parse(await readFile(datei, 'utf8'))
  // BatchMode: lieber ein Fehler als eine Passwortfrage, die in einem Skript
  // ewig haengenbleibt.
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
const werke = werkeAus(liste, { verschmelzen: false })

/** Die Ablage — optional. Ohne sie wird die reine Automatik gemessen. */
let ablage = interpretenAblageAus({})
const ablageDatei = argument('ablage', '')
if (ablageDatei) {
  try {
    ablage = interpretenAblageAus(JSON.parse(await readFile(ablageDatei, 'utf8')))
  } catch (fehler) {
    console.error(`Ablage nicht lesbar (${ablageDatei}): ${fehler.message} — es wird ohne sie gemessen.`)
  }
}

/**
 * Die Interpreten der Bibliothek — dieselbe Gruppierung wie in der Reihe.
 *
 * ALLE, nicht nur die unentschiedenen: gemessen werden soll ja gerade, was die
 * Automatik VON SICH AUS saehe. `zuPruefen` waere die Liste, die der SERVER im
 * Betrieb abfragt (er spart die entschiedenen); sie wird unten nur mitgezaehlt.
 */
const jeSchluessel = new Map()
for (const w of werke) {
  const k = w.interpretSchluessel
  if (!k) continue
  if (!jeSchluessel.has(k)) jeSchluessel.set(k, { schluessel: k, name: w.interpret ?? '', werke: [] })
  jeSchluessel.get(k).werke.push(w)
}

/** Eine Suche ueber die DURCHREICHE der Box — nie direkt zu api.spotify.com. */
async function suchen(name) {
  const adresse = `http://${box}:${PORT}/api/spotify/web/search?q=${encodeURIComponent(name)}&type=artist&limit=8`
  const antwort = await fetch(adresse, { signal: AbortSignal.timeout(10_000) })
  if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`)
  const d = await antwort.json()
  return (d?.artists?.items ?? [])
}

/**
 * DIE ALTE REGEL, Zeile fuer Zeile aus NewDesign/app.js (`istInterpret`).
 *
 * SIE WIRD HIER NACHGEBAUT UND NICHT IMPORTIERT — und das ist die eine
 * Ausnahme von „keine zweite Wahrheit". app.js ist eine Browserdatei ohne
 * Ausfuhr; sie zu laden hiesse, das ganze Modul samt `document` mitzubringen.
 * Damit sie nicht auseinanderlaeuft, steht sie hier VOLLSTAENDIG und in
 * derselben Reihenfolge — und sie verschwindet, sobald app.js auf
 * /api/interpreten umgestellt ist.
 */
function altesUrteil(name, treffer) {
  const schluessel = String(name || '').trim().toLowerCase()
  if (!schluessel) return { ja: false, id: null }
  const genau = treffer.find((a) => String(a.name || '').trim().toLowerCase() === schluessel)
  return { ja: !!genau, id: genau ? String(genau.id || '') : null }
}

const zeilen = []
let netzFehler = 0
for (const p of jeSchluessel.values()) {
  let treffer = null
  let fehler = ''
  try {
    treffer = await suchen(p.name)
  } catch (e) {
    fehler = e.message
    netzFehler++
  }
  const alt = treffer ? altesUrteil(p.name, treffer) : { ja: true, id: null }
  const neu = interpretAusTreffern(p.name, treffer)
  zeilen.push({
    name: p.name,
    schluessel: p.schluessel,
    werke: p.werke.length,
    fehler,
    // Wie Spotify den Namen wirklich schreibt — daran sieht man, WORAN der
    // strenge Vergleich gescheitert ist (Gross-/Kleinschreibung, Satzzeichen).
    // Der lockere Vergleich (`normal`) steht hier BEWUSST: er zeigt, wen eine
    // grosszuegigere Regel getroffen HAETTE. Genau daran ist der Jojo-Fall
    // aufgefallen — der Name in der Spalte ist dann ein anderer Mensch.
    spotifyLocker: treffer ? (treffer.find((a) => normal(a.name) === normal(p.name))?.name ?? '') : '',
    alt: { ja: alt.ja, id: alt.id || null },
    neu: { ja: neu.ja, id: neu.id },
    // Wo die beiden auseinanderfallen — das ist die eigentliche Ausbeute.
    unterschied:
      alt.ja !== neu.ja ? (neu.ja ? 'neu erkennt zusaetzlich' : 'neu verwirft') : (alt.id || null) !== neu.id ? 'Kennung' : '',
  })
}

if (netzFehler === zeilen.length && zeilen.length > 0) {
  console.error(`Die Durchreiche auf http://${box}:${PORT} antwortet nicht — es ist NICHTS gemessen.`)
  process.exit(4)
}

// Die Reihe, wie der Server sie bauen wuerde.
const erkannt = new Map(zeilen.map((z) => [z.schluessel, { ja: z.neu.ja, id: z.neu.id }]))
const { reihe, versteckt } = interpretenReihe(werke, ablage, erkannt)
const offen = zuPruefen(werke, ablage)

const auseinander = zeilen.filter((z) => z.unterschied)

if (alsJson) {
  console.log(
    JSON.stringify(
      { box, eintraege: liste.length, werke: werke.length, interpreten: zeilen, reihe, versteckt, offen },
      null,
      2,
    ),
  )
} else {
  const j = (b) => (b ? 'ja ' : 'nein')
  console.log(`Bibliothek: ${liste.length} Eintraege, ${werke.length} Werke, ${jeSchluessel.size} Interpreten`)
  console.log(`Ablage:     ${ablage.frei.length} freigeschaltet, ${ablage.abgelehnt.length} abgelehnt`)
  console.log(`Der Server muesste je Start ${offen.length} Namen bei Spotify nachschlagen (die uebrigen sind entschieden).`)
  console.log('')
  console.log('Name                             W   alt   neu   Kennung                 locker traefe')
  console.log('─'.repeat(104))
  for (const z of zeilen) {
    const name = z.name.length > 30 ? `${z.name.slice(0, 29)}…` : z.name.padEnd(30)
    const locker = z.spotifyLocker && z.spotifyLocker !== z.name ? z.spotifyLocker : ''
    console.log(
      `${name} ${String(z.werke).padStart(3)}   ${j(z.alt.ja)}   ${j(z.neu.ja)}   ${(z.neu.id ?? z.alt.id ?? '—').padEnd(22)}  ${z.fehler ? `(Suche fehlgeschlagen: ${z.fehler})` : locker}`,
    )
  }
  console.log('')
  // Die Spalte ganz rechts ist die WARNUNG, nicht der Vorschlag: dort steht,
  // wen ein grosszuegigerer Vergleich getroffen haette. Steht dort ein
  // anderer Mensch, waere das ein Fehlgriff gewesen.
  const lockerAnders = zeilen.filter((z) => !z.neu.ja && z.spotifyLocker)
  if (lockerAnders.length) {
    console.log('EIN LOCKERER VERGLEICH (`normal`) HAETTE ZUSAETZLICH GETROFFEN — und das waere falsch:')
    for (const z of lockerAnders) console.log(`  ${z.name}  ->  Spotifys "${z.spotifyLocker}"`)
    console.log('')
  }
  if (auseinander.length) {
    console.log('WO DIE REGELN AUSEINANDERFALLEN:')
    for (const z of auseinander) console.log(`  ${z.name}: ${z.unterschied}`)
  } else {
    console.log('Beide Regeln urteilen auf dieser Bibliothek GLEICH — der Unterschied liegt allein in der Ablage.')
  }
  console.log('')
  console.log(`REIHE (${reihe.length}):`)
  for (const p of reihe) {
    console.log(`  ${p.name}${p.anzahl ? ` (${p.anzahl} Werk${p.anzahl === 1 ? '' : 'e'})` : ' — ohne eigene Werke'}`)
    console.log(`      Kennung ${p.id ?? '—'}   Herkunft ${p.herkunft}   Bild ${p.bild ?? '—'}`)
  }
  if (versteckt.length) {
    console.log('')
    console.log(`NICHT IN DER REIHE (${versteckt.length}):`)
    for (const p of versteckt) console.log(`  ${p.name} — ${p.grund}`)
  }
}

process.exit(auseinander.length ? 1 : 0)
