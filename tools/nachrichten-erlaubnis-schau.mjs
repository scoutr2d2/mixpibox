#!/usr/bin/env node
/**
 * DIE ERLAUBNISLISTE MUSS DAS EINZIGE TOR SEIN — bleibt sie es?
 *
 * WOZU: `nachrichten.ts` nimmt Nachrichten von draussen an und legt sie auf
 * einen KINDERSCHIRM. Wer nicht auf der Erlaubnisliste steht, darf dem Kind
 * nicht schreiben — das ist die Bedingung, unter der die Sache gebaut werden
 * durfte (Betreiber, 20.09.2026: feste Erlaubnisliste).
 *
 * WARUM DIE UNIT-TESTS DAS NICHT ABDECKEN: sie pruefen die DREI Wege, die es
 * heute gibt. Der teure Fehler ist der VIERTE — jemand baut `ausWhatsapp`
 * daneben, schreibt sich das `Nachricht`-Objekt selbst zusammen und
 * vergisst die Pruefung. Jeder bestehende Test bleibt gruen, und niemand
 * merkt es, bis ein Fremder auf dem Schirm steht. Das ist dieselbe
 * Fehlerklasse wie „41 Stellen machen es richtig, EINE nicht" — nur dass es
 * die eine Stelle noch gar nicht gibt.
 *
 * DIE WACHE MISST DESHALB DIE SORTE, NICHT DEN PFAD (llmwiki:
 * [[wache-auf-sorte-nicht-auf-pfad]]): sie sucht JEDE exportierte Funktion,
 * deren Name mit `aus` beginnt, statt drei bekannte Namen abzuhaken. Eine
 * Wache, die `ausMatrix`, `ausSignal` und `ausTelegram` aufzaehlt, sagt zum
 * vierten Weg nichts.
 *
 * FUENF REGELN:
 *
 *  1. Es gibt genau EINE Stelle, die `eintragFuer` ruft — das Tor.
 *  2. Jede exportierte `aus…`-Funktion in nachrichten.ts geht durch `fertig(`
 *     (und damit durch das Tor). Keine baut sich eine Nachricht selbst.
 *  3. `fertig` prueft den ABSENDER VOR dem Text: ein Fremder soll nicht
 *     erfahren, ob sein leerer Text etwas ausgeloest haette.
 *  4. Eine leere Erlaubnisliste heisst NIEMAND — es gibt keinen Zweig, der
 *     bei leerer Liste etwas zurueckgibt.
 *  5. Was von einer ABGEWIESENEN Nachricht aufgehoben wird, traegt keinen
 *     Text. Die Box zaehlt, dass jemand geklopft hat; sie wird keine Ablage
 *     fremder Nachrichten.
 *
 * KOMMENTARE ZAEHLEN NICHT MIT. Ein zitierender Kommentar sieht fuer eine
 * Textsuche aus wie ein Aufruf — die Falle [[kommentar-und-kompilat-sind-
 * keine-gegenstelle]]. Vor jeder Suche wird deshalb kommentarbereinigt.
 *
 * Aufruf aus dem Wurzelverzeichnis:  node tools/nachrichten-erlaubnis-schau.mjs
 * Rueckgabe: 0 = alle Regeln halten, 1 = mindestens eine gebrochen.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const KERN = join(WURZEL, 'src/backend-api/src/nachrichten.ts')
const HOLER = join(WURZEL, 'src/backend-api/src/nachrichten-holer.ts')

/** Kommentare weg — Zeilenkommentare und Bloecke. Zeilenzahl bleibt erhalten. */
function ohneKommentare(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (t) => t.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_t, vorn) => vorn)
}

const befunde = []
function regel(name, gilt, satz) {
  if (!gilt) befunde.push(`${name}: ${satz}`)
}

let kern
let holer
try {
  kern = ohneKommentare(readFileSync(KERN, 'utf8'))
  holer = ohneKommentare(readFileSync(HOLER, 'utf8'))
} catch (e) {
  // EINE WACHE, DIE DAS VERSCHWINDEN IHRER QUELLE UEBERLEBT, IST KEINE.
  console.error(`WARNUNG: ${e.message}`)
  console.error('Quelle nicht lesbar — diese Wache urteilt nicht.')
  process.exit(1)
}

// ── 1. EIN TOR ────────────────────────────────────────────────────────────
const tore = (kern.match(/eintragFuer\(/g) ?? []).length
// Die Definition zaehlt mit: `export function eintragFuer(` ist einer der
// Treffer. Genau ZWEI heisst also: Definition plus ein einziger Aufruf.
regel('R1', tore === 2, `\`eintragFuer\` kommt ${tore}-mal vor (erwartet: Definition + genau 1 Aufruf).`)

// ── 2. JEDE aus…-FUNKTION GEHT DURCH `fertig` ─────────────────────────────
const funktionen = [...kern.matchAll(/export function (aus[A-Z]\w*)\s*\(/g)].map((m) => m[1])
regel('R2a', funktionen.length >= 3, `nur ${funktionen.length} \`aus…\`-Funktionen gefunden — liest die Wache die richtige Datei?`)
for (const name of funktionen) {
  const anfang = kern.indexOf(`export function ${name}`)
  const naechste = kern.indexOf('\nexport ', anfang + 1)
  const rumpf = kern.slice(anfang, naechste === -1 ? kern.length : naechste)
  regel('R2b', rumpf.includes('fertig('), `\`${name}\` geht NICHT durch \`fertig(\` — die Erlaubnisliste wird umgangen.`)
  regel(
    'R2c',
    !/gelesen:\s*false/.test(rumpf),
    `\`${name}\` baut sich eine Nachricht selbst zusammen (\`gelesen: false\` im Rumpf) statt \`fertig(\` zu benutzen.`,
  )
}

// ── 3. ABSENDER VOR TEXT ──────────────────────────────────────────────────
const fertigAnfang = kern.indexOf('function fertig(')
const fertigRumpf = kern.slice(fertigAnfang, kern.indexOf('\nexport ', fertigAnfang))
const posTor = fertigRumpf.indexOf('eintragFuer(')
const posLeer = fertigRumpf.indexOf("grund: 'leer'")
regel('R3', posTor > 0 && posLeer > posTor, 'die Text-Pruefung steht VOR der Absender-Pruefung — ein Fremder erfaehrt damit, ob sein Text angekommen waere.')

// ── 4. LEERE LISTE HEISST NIEMAND ─────────────────────────────────────────
const eintragAnfang = kern.indexOf('export function eintragFuer')
const eintragRumpf = kern.slice(eintragAnfang, kern.indexOf('\nexport ', eintragAnfang + 1))
regel(
  'R4',
  !/liste\.length\s*(===?\s*0|<)/.test(eintragRumpf) && !/!liste\.length/.test(eintragRumpf),
  '`eintragFuer` fragt nach der LAENGE der Liste — eine leere Liste darf nie „alle" heissen.',
)

// ── 5. VON EINEM ABGEWIESENEN BLEIBT KEIN TEXT ────────────────────────────
for (const [datei, text] of [
  ['nachrichten.ts', kern],
  ['nachrichten-holer.ts', holer],
]) {
  for (const stelle of text.matchAll(/abgewiesen[^\n]*\{([^}]*)\}/g)) {
    // `text:` UND NICHT `text` — der Grund `'kein-text'` traegt das Wort
    // selbst, und eine Suche danach meldete jede richtige Abweisung als
    // Fehler. Gesucht ist ein FELD, kein Wort.
    regel('R5', !/\btext\s*:/.test(stelle[1]), `in ${datei} traegt ein Abweisungs-Eintrag ein \`text\`-Feld — der Text eines Fremden wird aufgehoben.`)
  }
  for (const stelle of text.matchAll(/grund:\s*'(unbekannt|leer|kein-text)'[^\n]*/g)) {
    regel('R5', !/\btext\s*:/.test(stelle[0]), `in ${datei} wandert ein Text in eine Abweisung: ${stelle[0].trim().slice(0, 80)}`)
  }
}

if (befunde.length) {
  console.log('── Die Erlaubnisliste als einziges Tor ──')
  for (const b of befunde) console.log(`  ${b}`)
  console.log(`\n${befunde.length} LUECKE(N).`)
  process.exit(1)
}
console.log('── Die Erlaubnisliste als einziges Tor ──')
console.log(`  ${funktionen.length} Wege geprueft (${funktionen.join(', ')}), 5 Regeln.`)
console.log('\nKEINE LUECKE.')
