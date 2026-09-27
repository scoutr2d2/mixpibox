#!/usr/bin/env node
/**
 * TDZ-SCHATTEN-SCHAU — findet den Namen, der sich selbst totlegt.
 *
 * ══ DER FUND, DER SIE GEBAUT HAT (20.09.2026) ══════════════════════════════
 *
 * In `plugins/mixpi-mitschnitt/index.mjs` stand zweimal `const args` im selben
 * Block: einmal oben fuer den Aufnahmebefehl, einmal dreihundert Zeilen
 * weiter unten fuer die Veredelung. Eine `const` verdeckt den aeusseren Namen
 * ab BLOCKANFANG, nicht erst ab ihrer Zeile — der Start des Spielers griff
 * damit in die Todeszone der unteren Deklaration:
 *
 *     Cannot access 'args' before initialization
 *
 * Der `catch` darum machte daraus den `grund` eines gescheiterten Titels. Zehn
 * Tage lang nahm die Box nichts mehr auf, und es sah aus wie ein Tonproblem.
 *
 * ══ WARUM ALS WACHE UND NICHT ALS ZEUGE ════════════════════════════════════
 *
 * Ein Zeuge haette die Stelle nur getroffen, wenn er `einenAufnehmen` WIRKLICH
 * betritt — mit `spawn`, PipeWire und Spotify dahinter. Die Sorte dagegen ist
 * rein syntaktisch: ein Name, der in seinem Block VOR seiner eigenen
 * Deklaration gelesen wird. Das faellt einem Parser auf, und zwar ueberall im
 * Baum gleichzeitig.
 *
 * GESUCHT WIRD DIE SORTE, NICHT DIE DATEI (Wiki: wache-auf-sorte-nicht-auf-pfad).
 *
 * ══ WAS SIE NICHT SIEHT ════════════════════════════════════════════════════
 *
 * * TypeScript. `acorn` liest kein `.ts`; die Wache haelt `.mjs`/`.js`. Wer
 *   sie auf `src/` ausweiten will, braucht den TS-Parser dazu.
 * * Zugriffe aus geschachtelten Funktionen. `() => args` VOR der Deklaration
 *   ist erst beim AUFRUF ein Fehler, und wann der kommt, weiss kein Parser.
 *   Solche Stellen bleiben still — lieber eine Luecke als eine Wache, der
 *   niemand mehr glaubt.
 *
 * AUFRUF:
 *     node tools/tdz-schatten-schau.mjs            # der ganze Baum
 *     node tools/tdz-schatten-schau.mjs <datei> …  # einzelne Dateien
 *
 * Rueckgabe 0, wenn nichts gefunden; 1 bei Fund; 2, wenn die Wache selbst
 * nicht messen kann (fehlender Parser) — eine Wache, die schweigend nichts
 * tut, ist keine.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let parse
try {
  ;({ parse } = await import('acorn'))
} catch (f) {
  console.error(`tdz-schatten-schau: kein Parser da (${f.message}).`)
  console.error('  npm install  im Wurzelverzeichnis holt `acorn` mit.')
  process.exit(2)
}

/** Die Dateien, die diese Wache liest: verfolgtes JS ohne Fremd- und Baukram. */
function dateienAusGit() {
  const roh = execFileSync('git', ['-C', WURZEL, 'ls-files', '*.mjs', '*.js'], { encoding: 'utf8' })
  return roh
    .split('\n')
    .map((z) => z.trim())
    .filter(Boolean)
    .filter((p) => !p.includes('node_modules/'))
    .filter((p) => !p.startsWith('src/deploy/'))
    .filter((p) => !/(^|\/)(dist|www|build)\//.test(p))
}

const FUNKTIONEN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])

/** Jeder Knoten, der einen eigenen Block aufmacht. */
const BLOECKE = new Set([
  'BlockStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'SwitchStatement',
  'StaticBlock',
])

/** Die Namen, die ein Bindungsmuster einfuehrt. */
function namenAus(muster, raus = []) {
  if (!muster || typeof muster !== 'object') return raus
  switch (muster.type) {
    case 'Identifier':
      raus.push(muster)
      break
    case 'ObjectPattern':
      for (const e of muster.properties) namenAus(e.type === 'RestElement' ? e.argument : e.value, raus)
      break
    case 'ArrayPattern':
      for (const e of muster.elements) if (e) namenAus(e, raus)
      break
    case 'AssignmentPattern':
      namenAus(muster.left, raus)
      break
    case 'RestElement':
      namenAus(muster.argument, raus)
      break
    default:
      break
  }
  return raus
}

function kinder(knoten) {
  const raus = []
  for (const schluessel of Object.keys(knoten)) {
    if (schluessel === 'type' || schluessel === 'start' || schluessel === 'end' || schluessel === 'loc') continue
    const wert = knoten[schluessel]
    if (Array.isArray(wert)) {
      for (const k of wert) if (k && typeof k.type === 'string') raus.push(k)
    } else if (wert && typeof wert.type === 'string') {
      raus.push(wert)
    }
  }
  return raus
}

/**
 * Die `let`/`const`/`class`-Deklarationen, die DIREKT in diesem Block liegen —
 * nicht die aus geschachtelten Bloecken, denn die verdecken hier nichts.
 */
function bindungenDesBlocks(koerper) {
  const raus = new Map()
  for (const satz of koerper) {
    if (satz.type === 'VariableDeclaration' && satz.kind !== 'var') {
      for (const d of satz.declarations) for (const n of namenAus(d.id)) raus.set(n.name, satz.start)
    } else if (satz.type === 'ClassDeclaration' && satz.id) {
      raus.set(satz.id.name, satz.start)
    }
  }
  return raus
}

function koerperVon(knoten) {
  if (knoten.type === 'SwitchStatement') return knoten.cases.flatMap((c) => c.consequent)
  if (Array.isArray(knoten.body)) return knoten.body
  return []
}

/**
 * Sucht in einer Datei nach Lesezugriffen, die VOR der eigenen Deklaration im
 * selben Block stehen. `tiefe` zaehlt Funktionsgrenzen: nur Zugriffe auf
 * derselben Tiefe wie die Bindung sind sicher ein Fehler.
 */
function funde(quelle, pfad) {
  let baum
  try {
    baum = parse(quelle, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  } catch (f) {
    return [{ pfad, zeile: f.loc?.line ?? 0, name: '', text: `nicht lesbar: ${f.message}`, parserFehler: true }]
  }
  const raus = []

  function gehen(knoten, kette, tiefe) {
    /* JEDE GRENZE BEKOMMT IHREN EIGENEN BEREICH — sonst entstehen Tote.
     *
     * Erste Fassung kannte nur Bloecke. Dann las sie `for (const w of jf) { …w… }`
     * gegen ein spaeteres `const w` der umgebenden Funktion und meldete einen
     * Fehler, den es nicht gibt (gemessen an tools/stelle-je-dienst-am-geraet.mjs,
     * 20.09.2026). Parameter, Schleifenkoepfe und `catch`-Namen binden genauso.
     * Ihr Beginn ist `-1`: sie stehen VOR allem in ihrem Bereich.
     */
    if (FUNKTIONEN.has(knoten.type)) {
      tiefe += 1
      const eigene = new Map()
      for (const p of knoten.params) for (const n of namenAus(p)) eigene.set(n.name, -1)
      if (knoten.id) eigene.set(knoten.id.name, -1)
      kette = [...kette, { bindungen: eigene, tiefe }]
    }
    if (knoten.type === 'CatchClause' && knoten.param) {
      const eigene = new Map()
      for (const n of namenAus(knoten.param)) eigene.set(n.name, -1)
      kette = [...kette, { bindungen: eigene, tiefe }]
    }
    const kopf = knoten.type === 'ForStatement' ? knoten.init : knoten.left
    if (/^For(In|Of)?Statement$/.test(knoten.type) && kopf?.type === 'VariableDeclaration' && kopf.kind !== 'var') {
      const eigene = new Map()
      for (const d of kopf.declarations) for (const n of namenAus(d.id)) eigene.set(n.name, -1)
      kette = [...kette, { bindungen: eigene, tiefe }]
    }
    if (BLOECKE.has(knoten.type)) {
      const eigene = bindungenDesBlocks(koerperVon(knoten))
      kette = [...kette, { bindungen: eigene, tiefe }]
    }

    if (knoten.type === 'Identifier') {
      for (let i = kette.length - 1; i >= 0; i--) {
        const treffer = kette[i].bindungen.get(knoten.name)
        if (treffer === undefined) continue
        if (kette[i].tiefe === tiefe && knoten.start < treffer) {
          raus.push({
            pfad,
            zeile: knoten.loc.start.line,
            name: knoten.name,
            text: `\`${knoten.name}\` wird gelesen, bevor die eigene Deklaration im selben Block steht`,
          })
        }
        break
      }
      return
    }

    // Nicht jeder Identifier ist ein Zugriff: Eigenschaftsnamen, Beschriftungen
    // und die Namen der Deklaration selbst sind keine Lesevorgaenge.
    const ueberspringen = new Set()
    if (knoten.type === 'MemberExpression' && !knoten.computed) ueberspringen.add(knoten.property)
    if (knoten.type === 'Property' && !knoten.computed) ueberspringen.add(knoten.key)
    if (knoten.type === 'PropertyDefinition' && !knoten.computed) ueberspringen.add(knoten.key)
    if (knoten.type === 'MethodDefinition' && !knoten.computed) ueberspringen.add(knoten.key)
    if (knoten.type === 'VariableDeclarator') for (const n of namenAus(knoten.id)) ueberspringen.add(n)
    if (knoten.type === 'LabeledStatement' || knoten.type === 'BreakStatement' || knoten.type === 'ContinueStatement') {
      ueberspringen.add(knoten.label)
    }
    if (FUNKTIONEN.has(knoten.type)) {
      if (knoten.id) ueberspringen.add(knoten.id)
      for (const p of knoten.params) for (const n of namenAus(p)) ueberspringen.add(n)
    }
    if (knoten.type === 'ClassDeclaration' || knoten.type === 'ClassExpression') {
      if (knoten.id) ueberspringen.add(knoten.id)
    }
    if (knoten.type === 'ImportSpecifier' || knoten.type === 'ImportDefaultSpecifier') return
    if (knoten.type === 'ImportNamespaceSpecifier' || knoten.type === 'ExportSpecifier') return

    for (const k of kinder(knoten)) {
      if (ueberspringen.has(k)) continue
      gehen(k, kette, tiefe)
    }
  }

  gehen(baum, [], 0)
  return raus
}

const wunsch = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const dateien = wunsch.length ? wunsch : dateienAusGit()

let gefunden = 0
let unlesbar = 0
for (const pfad of dateien) {
  let quelle
  try {
    quelle = readFileSync(resolve(WURZEL, pfad), 'utf8')
  } catch {
    continue
  }
  for (const f of funde(quelle, pfad)) {
    if (f.parserFehler) {
      unlesbar += 1
      continue
    }
    gefunden += 1
    console.log(`${f.pfad}:${f.zeile}: ${f.text}`)
  }
}

console.log(
  `BILANZ: ${dateien.length} Dateien gelesen, ${gefunden} Fund${gefunden === 1 ? '' : 'e'}` +
    (unlesbar ? `, ${unlesbar} nicht parsebar (uebergangen)` : ''),
)
process.exit(gefunden ? 1 : 0)
