#!/usr/bin/env node
/**
 * WOZU
 *   Seit der Mehrbenutzer-Vorbereitung (02.08.2026) traegt jeder
 *   profilgebundene Speicherschluessel einen BESITZER. Die Formel dafuer
 *
 *       mupibox_p_<kennung>_<schluessel>
 *
 *   steht an DREI Stellen, weil drei Programme sie brauchen:
 *     1. src/backend-api/src/profile.ts        speicherName()
 *     2. NewDesign/app.js                      speicher.name()
 *     3. src/frontend-box/.../favoriten.service.ts   name()
 *
 *   LAUFEN SIE AUSEINANDER, MERKT ES NIEMAND. Kein Absturz, keine Meldung:
 *   ein Kind sieht auf der einen Seite seine Sachen und auf der anderen die
 *   des Geschwisters. Dieselbe Fehlerklasse wie
 *   [darstellung-feld-faellt-still-heraus] und wie die Dienst-Zeichen der
 *   Kacheln, gegen die tools/dienst-marken-schau.mjs steht — dies hier ist
 *   dessen Geschwister.
 *
 *   ZWEITENS: der Schluessel `mupibox_favorites_v1` lag frueher an SECHS
 *   Stellen im Quelltext der klassischen Oberflaeche. Jede davon ist beim
 *   Umzug eine Gelegenheit, eine zu vergessen. Deshalb prueft dieses Werkzeug
 *   auch, dass KEIN Speicherschluessel in mehr als einer Datei steht.
 *
 *   ES HAELT KEINE EIGENE KOPIE DER FORMEL. Es liest alle drei am Quelltext
 *   und vergleicht sie GEGENEINANDER. Eine eigene Kopie waere die vierte
 *   Wahrheit und genau der Fehler, den es verhindern soll.
 *
 *   AUSNAHMEN STEHEN IM QUELLTEXT, NICHT HIER. Ein Schluessel, der absichtlich
 *   in zwei Dateien vorkommt (hell/dunkel steht in index.html VOR app.js, um
 *   das Aufblitzen zu vermeiden), traegt in der Nachbarschaft den Vermerk
 *
 *       NAMENSRAUM-AUSNAHME: <Grund>
 *
 *   Damit steht der Grund dort, wo jemand ihn liest, wenn er die Zeile
 *   anfasst — und nicht in einer Liste in diesem Werkzeug, die als erstes
 *   veraltet.
 *
 * WAS ES AENDERT
 *   NICHTS. Es liest vier Dateien und schreibt auf die Konsole.
 *
 * AUFRUF
 *   node tools/namensraum-schau.mjs            Bericht, immer Ende 0
 *   node tools/namensraum-schau.mjs --pruefen  still, Ende 1 bei Befund
 *                                              (haengt in tools/pruefen.sh)
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const pruefen = process.argv.includes('--pruefen')

/** Die drei Stellen, an denen die Formel gebaut wird. */
const FORMELN = [
  ['Backend  profile.ts', 'src/backend-api/src/profile.ts'],
  ['Neue Oberflaeche  app.js', 'NewDesign/app.js'],
  // (Die klassische favoriten.service.ts fiel mit E118/1e.)
]

/**
 * Wo gesucht wird — VERZEICHNISSE, keine Dateiliste.
 *
 * DAS WAR DER ERSTE ENTWURF UND SOFORT FALSCH: eine feste Liste von Dateien
 * uebersieht genau die Datei, die jemand neu anfasst. Die Gegenprobe hat es
 * bewiesen — ein roher `localStorage.getItem('mupibox_favorites_v1')` in
 * home.page.ts blieb unbemerkt, weil die Datei nicht auf der Liste stand.
 * Eine Pruefung, die nur prueft, woran man ohnehin denkt, prueft nichts.
 */
const BAEUME = ['NewDesign', 'src/frontend-admin/src', 'src/backend-api/src']

/** Was nie mitgelesen wird. */
const AUS = /node_modules|\.angular|\/www\/|\/dist\/|\/bilder\//

/**
 * Tests bleiben draussen.
 *
 * Ein Test, der einen Speicherschluessel WOERTLICH nennt, ist genau richtig —
 * er schreibt fest, wie der Name lautet. Ihn als „steht in zwei Dateien" zu
 * melden hiesse, das Festschreiben zu bestrafen und damit abzugewoehnen.
 * Gemeint ist die Doppelung im BETRIEB, nicht die in der Pruefung.
 */
const TEST = /\.(spec|test)\.(ts|js|mjs)$/

function lies(pfad) {
  try {
    return readFileSync(join(WURZEL, pfad), 'utf8')
  } catch {
    return null
  }
}

/** Alle Quelldateien unter BAEUME — rekursiv, ohne Gebautes und Fremdes. */
function dateien() {
  const aus = []
  const gehe = (verzeichnis) => {
    let eintraege
    try {
      eintraege = readdirSync(join(WURZEL, verzeichnis), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of eintraege) {
      const p = `${verzeichnis}/${e.name}`
      if (AUS.test(`/${p}/`)) continue
      if (e.isDirectory()) gehe(p)
      else if (/\.(ts|js|mjs|html)$/.test(e.name) && !TEST.test(e.name)) aus.push(p)
    }
  }
  for (const b of BAEUME) gehe(b)
  return aus
}

/**
 * Kommentare unkenntlich machen, ZEILENTREU.
 *
 * NOETIG, WEIL ES BEIM ERSTEN LAUF SOFORT ZUSCHLUG: profile.ts erklaert seine
 * Formel im Kopfkommentar mit einem Beispiel, und das Werkzeug las das
 * Beispiel statt des Codes und meldete „die Formel ist an 2 Stellen
 * VERSCHIEDEN". Ein Werkzeug, das an guter Dokumentation scheitert, erzieht
 * dazu, die Dokumentation wegzulassen.
 *
 * Ersetzt wird durch Leerzeichen statt geloescht, damit Zeilennummern und
 * damit die Nachbarschaftssuche nach dem Ausnahmevermerk stimmen.
 */
function ohneKommentare(text) {
  const leer = (m) => m.replace(/[^\n]/g, ' ')
  return text
    .replace(/\/\*[\s\S]*?\*\//g, leer) // /* … */ und /** … */
    .replace(/<!--[\s\S]*?-->/g, leer) // HTML
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, v) => v + leer(m.slice(v.length))) // // … (nicht in http://)
}

/**
 * Die Formel aus einem Quelltext ziehen und auf ihre GESTALT bringen.
 *
 * Aus `mupibox_p_${kennungPruefen(k) ? k : GAST}_${schluessel}` wird
 * `mupibox_p_${}_${}`. Verglichen wird die Gestalt, nicht der Ausdruck darin:
 * wie eine Seite an ihre Kennung kommt, ist ihre Sache — WORAUS der Name
 * besteht, ist es nicht.
 */
function gestalt(text) {
  // Von `mupibox_p_` bis zum schliessenden Backtick derselben Zeile.
  const treffer = text.match(/`mupibox_p_[^`]*`/)
  if (!treffer) return null
  return treffer[0].replace(/\$\{[^}]*\}/g, '${}')
}

/** Wie der Gast heisst — auch das muss ueberall dasselbe sein. */
function gastWort(text) {
  const m = text.match(/GAST\s*=\s*'([^']+)'/)
  return m ? m[1] : null
}

const befunde = []
const zeilen = []

// ── 1. Die Formel an allen drei Stellen ────────────────────────────────────
const gefunden = []
for (const [name, pfad] of FORMELN) {
  const text = lies(pfad)
  if (text === null) {
    befunde.push(`${name}: Datei fehlt (${pfad})`)
    continue
  }
  const g = gestalt(ohneKommentare(text))
  const w = gastWort(ohneKommentare(text))
  if (!g) {
    befunde.push(`${name}: baut keinen Namen mit mupibox_p_ — hat jemand die Kapsel entfernt?`)
    continue
  }
  gefunden.push({ name, gestalt: g, gast: w })
  zeilen.push(`  ${g}   ${w ? `Gast '${w}'` : 'kein GAST'}   ${name}`)
}

const gestalten = new Set(gefunden.map((e) => e.gestalt))
if (gestalten.size > 1) {
  befunde.push(`die Formel ist an ${gestalten.size} Stellen VERSCHIEDEN: ${[...gestalten].join('  vs.  ')}`)
}
const gaeste = new Set(gefunden.filter((e) => e.gast).map((e) => e.gast))
if (gaeste.size > 1) {
  befunde.push(`der Gast heisst verschieden: ${[...gaeste].join(', ')}`)
}

// ── 2. Kein Speicherschluessel in mehr als einer Datei ──────────────────────
//
// Gesucht werden Zeichenketten der Form 'mupibox_…' bzw. "mupibox_…" — so
// heissen alle Schluessel dieses Projekts, in beiden Oberflaechen.
const wo = new Map()
for (const pfad of dateien()) {
  const text = lies(pfad)
  if (text === null) continue
  // GESUCHT WIRD IM CODE, DER VERMERK IM ROHTEXT: der Schluessel muss ein
  // echter Schluessel sein (kein Beispiel im Kommentar), der Ausnahmegrund
  // steht dagegen genau dort — in einem Kommentar daneben.
  const roh = text.split('\n')
  ohneKommentare(text).split('\n').forEach((zeile, i) => {
    for (const m of zeile.matchAll(/['"`](mupibox_[a-z0-9_]+)['"`]/g)) {
      const schluessel = m[1]
      // Ein Vermerk in der Nachbarschaft (fuenf Zeilen davor bis drei danach)
      // erklaert eine gewollte Doppelung. Der Grund steht damit im Quelltext.
      const nahe = roh.slice(Math.max(0, i - 5), i + 4).join('\n')
      const ausnahme = /NAMENSRAUM-AUSNAHME/.test(nahe)
      if (!wo.has(schluessel)) wo.set(schluessel, { dateien: new Set(), ausnahme: false })
      const e = wo.get(schluessel)
      e.dateien.add(pfad)
      if (ausnahme) e.ausnahme = true
    }
  })
}

const doppelt = []
for (const [schluessel, e] of [...wo].sort()) {
  if (e.dateien.size > 1 && !e.ausnahme) {
    doppelt.push(`${schluessel} steht in ${e.dateien.size} Dateien: ${[...e.dateien].join(', ')}`)
  }
}
befunde.push(...doppelt)

// ── Ausgabe ────────────────────────────────────────────────────────────────
if (pruefen) {
  if (befunde.length) {
    console.error('Namensraum:')
    for (const b of befunde) console.error(`  ${b}`)
    process.exit(1)
  }
  process.exit(0)
}

console.log('\nDie Formel des Namensraums')
console.log('──────────────────────────────────────────────────────')
for (const z of zeilen) console.log(z)
console.log(`\nSpeicherschluessel gefunden: ${wo.size}`)
for (const [schluessel, e] of [...wo].sort()) {
  const mark = e.dateien.size > 1 ? (e.ausnahme ? ' (Ausnahme im Quelltext vermerkt)' : '  << in mehreren Dateien!') : ''
  console.log(`  ${schluessel}${mark}`)
}
console.log('\n──────────────────────────────────────────────────────')
if (befunde.length) {
  console.log('BEFUNDE:')
  for (const b of befunde) console.log(`  ${b}`)
} else {
  console.log('Alles in Ordnung.')
}
console.log()
