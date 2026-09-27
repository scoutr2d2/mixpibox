#!/usr/bin/env node
/**
 * TOTE FUNKTIONEN — welche Funktion in einer buendlerlosen Datei ruft niemand?
 *
 * ── WOZU (19.09.2026, AUDIT-2026-09-19 Rang 12) ───────────────────────────
 * `NewDesign/app.js` ist 1,6 MB in EINER Datei, ohne Module, ohne Bauschritt:
 * eine einzige IIFE, die der Kiosk-Browser direkt laedt. Fuer genau diese Form
 * gibt es KEIN Fertigwerkzeug — der Leerbefund des Tages: `knip` urteilt auf
 * EXPORT-Ebene und greift ohne Module gar nicht, `unimported` ist darin
 * aufgegangen. Gefunden wurden die toten Funktionen deshalb bisher VON HAND,
 * und zwar immer wieder dieselben: `wischWort` am 22.08., `hinueberDurchsTor`
 * am 21.08. und noch einmal am 31.08., `sprichImBrowser` am 19.09. Viermal
 * denselben Fund von Hand zu machen ist eine fehlende Wache
 * ([[wiederkehrender-befund-ist-ablauffehler]]).
 *
 * ── WARUM ACORN UND KEINE TEXTSUCHE ───────────────────────────────────────
 * Eine `grep`-Zaehlung von `name(` zaehlt jeden Kommentar mit, der den Namen
 * ZITIERT — und dieser Baum begruendet seine Entscheidungen in Kommentaren,
 * die reihenweise Funktionsnamen nennen. `hinueberDurchsTor` steht in drei
 * Audits und einem Kommentar daneben; eine Textsuche haelt es fuer lebendig.
 * Der Syntaxbaum kennt keine Kommentare, also faellt dieses Problem ganz weg
 * ([[kommentar-und-kompilat-sind-keine-gegenstelle]]).
 *
 * ── DAS KRITERIUM IST DIE SORTE, NIE EINE NAMENSLISTE ──────────────────────
 * Eine Liste von Namen ist beim Schreiben veraltet. Am 19.09.2026 ist das
 * zweimal an einem Tag passiert: `tools/tote-stile-schau.py` stand mit acht
 * handgeschriebenen `marke-`-Namen da und kannte `marke-plugin` nicht, den
 * siebten Dienst, seit Wochen im Baum. Hier steht deshalb NIRGENDS ein
 * Funktionsname. Gefragt wird nach Sorten von KNOTEN und nach Sorten von
 * ZUGRIFF ([[wache-auf-sorte-nicht-auf-pfad]]).
 *
 * WAS ALS DEFINITION ZAEHLT (die Sorte, nicht der Ort):
 *   FunctionDeclaration mit Namen            `function x() {}`
 *   VariableDeclarator mit Funktionswert     `const x = () => {}`
 *   Property mit Funktionswert               `{ x() {} }`, `{ x: () => {} }`
 *   MethodDefinition                         `class Y { x() {} }`
 *   AssignmentExpression auf ein Feld        `a.x = function () {}`
 *
 * WAS ALS AUFRUFSTELLE ZAEHLT:
 *   jedes Identifier-Vorkommen AUSSERHALB des eigenen Rumpfes, und jede
 *   nicht-berechnete Member-Eigenschaft `.x`. Der eigene Rumpf zaehlt NICHT
 *   mit: eine Funktion, die nur sich selbst ruft, ist genauso tot wie eine,
 *   die niemand ruft — nur sieht sie in jeder Zaehlung lebendig aus.
 *
 * ── DIE GRUENDE, DIE FINGER DAVONZULASSEN ─────────────────────────────────
 * (Ohne Zahl in der Ueberschrift: hier stand „DIE SECHS", und beim ersten
 *  hinzugekommenen Topf war sie falsch.)
 * Ein Kandidat ohne Aufrufstelle ist NOCH KEIN Befund. Was nicht zweifelsfrei
 * tot ist, wird in einen eigenen Topf gelegt und NICHT gemeldet — die Toepfe
 * sind bewusst Gruende, nicht Urteile (dieselbe Bauart wie in
 * `tools/tote-stile-schau.py`, und ausdruecklich KEIN zweites Werkzeug
 * daneben: das hier sieht JS-Funktionen, das dort CSS-Namen):
 *
 *   GEGENSTELLE     eine ANDERE Datei desselben Laufraums ruft es. `app.js`
 *                   reicht ueber `window.mupiWellenMessung` Methoden nach
 *                   aussen; `wellen-messseite.html:123` ruft `neuerPegel`.
 *                   In app.js allein sieht die Methode tot aus.
 *   NUR-WACHE       nur ein Werkzeug in `tools/` nennt den Namen. Loeschen
 *                   macht eine Wache rot, nicht die Oberflaeche kaputt —
 *                   beides pruefen. (`wischWort` lebt seit dem 22.08.2026
 *                   nur noch vom generierten Auszug `neu-regelnfns-auszug.js`;
 *                   ein KOMPILAT ist keine Gegenstelle, aber es bricht.)
 *   ZUSAMMENGESETZT ein `praefix${…}` oder `'a' + x` im Code KOENNTE den
 *                   Namen bauen. Eine Literal-Suche findet so etwas NIE —
 *                   derselbe Fall wie `marke-${d}` und `pwf-${i}` auf der
 *                   CSS-Seite. FINGER WEG.
 *   FREMDBESITZ     die Funktion wird auf ein Feld eines Objekts gelegt, das
 *                   dieser Code nicht selbst aufgeschrieben hat
 *                   (`pegelStrom.onmessage = …`). Dann ruft der HALTER —
 *                   Browser, Fremdmodul, Server —, und kein Parser sieht ihn.
 *   SPIEGEL         das Objekt, dem die Methode gehoert, wird irgendwo
 *                   BERECHNET angefasst (`o[x]`), ausgebreitet (`...o`) oder
 *                   gespiegelt (`Object.keys/values/entries/assign/…`,
 *                   `for (… in o)`, `JSON.stringify(o)`). Dann kann der Name
 *                   ueber einen Wert kommen, den kein Parser kennt.
 *   ZEICHENKETTE    der Name steht irgendwo als Zeichenkette. Er koennte ueber
 *                   eine Tabelle von Funktionsnamen gerufen werden.
 *   ALS-SCHLUESSEL  der Name steht anderswo als blanker Objektschluessel.
 *                   DER FALL, DER AM 19.09.2026 GEMESSEN WURDE: das CSS-Token
 *                   `--line` lebt in seinem Erzeuger als Schluessel `line:` —
 *                   jede `--`-Suche geht daran vorbei. Deshalb wird hier nicht
 *                   nur gefragt „wer LIEST das", sondern auch „wer SCHREIBT
 *                   oder ERZEUGT das"; geprueft wird zusaetzlich der Namenskern
 *                   ohne fuehrende `-`/`_`/`$`.
 *   GLOBAL-DYNAMISCH  steht `window[x]`, `globalThis[x]`, `eval(` oder
 *                   `new Function(` in der Datei, ist KEINE Funktion mehr
 *                   beweisbar tot. Dann meldet das Werkzeug gar keinen Befund
 *                   und sagt, warum.
 *
 * ── WAS ES NICHT SIEHT, damit niemand dem Gruen zu viel glaubt ────────────
 *   (a) GEGENSEITIGE REKURSION: zwei tote Funktionen, die nur einander rufen,
 *       decken sich gegenseitig. Der Selbstbezug ist abgezogen, der Ringschluss
 *       zu zweit nicht. Dafuer braeuchte es einen Erreichbarkeitsgraphen ab den
 *       Einsprungpunkten — mehr Maschine, als der erste Nutzen hergibt.
 *   (b) ARGUMENTE: eine Funktion, die als Wert weitergereicht wird
 *       (`setTimeout(x, 0)`), gilt als gerufen. Das ist richtig so, aber es
 *       heisst nicht, dass sie je LAEUFT. Dafuer ist die Laufzeit-Gegenprobe
 *       da (DevTools-Coverage), nicht der Parser.
 *   (c) TOTE ZWEIGE: `if (false) x()` zaehlt als Aufruf.
 *
 * ── DIE RATSCHE: warum die Liste den Laeufer NICHT rot macht ──────────────
 * Die Kandidaten sind ein BESTAND, und ein Bestand, der ab Tag eins rot
 * leuchtet, wird weggeklickt — dann verdeckt er den naechsten echten Fund
 * ([[dauerrote-wache-ist-keine]]). Mehrere der heutigen Kandidaten stehen
 * ausserdem auf ERKLAERTE ABSICHT im Baum (`sprichImBrowser` traegt seinen
 * Grund im JSDoc daneben, `hinueberDurchsTor` seit dem 21.08. in zwei Audits).
 * Geurteilt wird darum ueber eine Ratsche gegen eine eingefrorene Baseline:
 * der Bestand darf schlecht sein, er darf nur nicht SCHLECHTER werden.
 *
 * GEBAUT NACH `tools/shellcheck-ratsche.sh` und `tools/ungerufene-wachen.py`,
 * nicht neu erfunden: dieselben Schalter (`--pruefen` / `--einfrieren`),
 * dieselbe Baseline-Form, derselbe Rang-Vergleich. Eingefroren wird der
 * ZUSTAND JE FUNKTION, nicht die Zahl: faellt eine Funktion tot und wird
 * gleichzeitig eine andere geloescht, bliebe die Summe gleich und genau der
 * Fall, um den es geht, ginge durch.
 *
 *   tot     0  kein Aufrufer, kein Grund, die Finger davonzulassen
 *   unklar  1  kein Aufrufer, aber einer der Gruende oben
 *   (wer gerufen wird, steht gar nicht erst in der Baseline)
 *
 * UNBEKANNT GILT ALS RANG 1: eine Funktion, die neu in den Baum kommt und
 * sofort tot ist, blockt — genau wie ein neues Skript bei der
 * shellcheck-Ratsche sauber sein muss. Wird eine bisher GERUFENE Funktion
 * tot, ist sie in der Baseline ebenfalls unbekannt und blockt damit auch.
 *
 * ── KEIN FALSCH-GRUEN ─────────────────────────────────────────────────────
 * Fehlt acorn, fehlt die Eingabedatei, laesst sie sich nicht parsen, findet
 * der Baum KEINE Definition, oder fehlt der Ratsche die Baseline: Abbruch mit
 * 2 UND Anleitung. Nie gruen. (2 ist in diesem Baum der Abbruch, 1 der Fund.)
 *
 * ACORN liegt hier als DURCHGEREICHTE Abhaengigkeit des Angular-Werkzeugkastens
 * (webpack/terser/espree verlangen es), nicht als eigene. Gemessen am
 * 19.09.2026: 8.18.0 in `node_modules/acorn`. Verschwindet es bei einem
 * `npm ci`, bricht dieses Werkzeug mit Anleitung ab statt still nichts zu
 * pruefen — der Grund, aus dem es hier keine eigene Auflieferung gibt.
 *
 * AUFRUF (aus dem Wurzelverzeichnis)
 *   node tools/tote-funktionen-schau.mjs              Bilanz + alle Toepfe
 *   node tools/tote-funktionen-schau.mjs --lang       jeden Namen einzeln
 *   node tools/tote-funktionen-schau.mjs --datei X    eine andere Datei
 *   node tools/tote-funktionen-schau.mjs --fragen=x --fragen=y
 *                                                     genau diese Namen;
 *                                                     Ende 1, wenn einer LEBT
 *   node tools/tote-funktionen-schau.mjs --pruefen    DAS URTEIL fuer den
 *                                                     Laeufer: gruen beim
 *                                                     eingefrorenen Bestand
 *   node tools/tote-funktionen-schau.mjs --einfrieren Baseline neu schreiben
 * Rueckgabe: 0 = in Ordnung, 1 = Befund/Verschlechterung, 2 = Abbruch.
 * IN EINEN LAEUFER GEHOERT `--pruefen` — ohne Schalter waere der Schritt vom
 * ersten Tag an rot.
 */

import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = join(WURZEL, 'tools', 'tote-funktionen-baseline.txt')

// ── acorn holen, oder mit Anleitung abbrechen ──────────────────────────────
// KEIN try/catch um einen stillen Rueckfall: eine Wache, die bei fehlendem
// Werkzeug gruen ist, prueft nichts und sieht dabei aus, als pruefte sie.
let acorn
try {
  acorn = await import('acorn')
} catch (fehler) {
  console.error('acorn fehlt — ohne Parser kann dieses Werkzeug nichts pruefen.')
  console.error(`  (${fehler.message})`)
  console.error('')
  console.error('acorn liegt hier normalerweise als durchgereichte Abhaengigkeit des')
  console.error('Angular-Werkzeugkastens in node_modules/. Wiederherstellen:')
  console.error('  npm install --prefix src/frontend-admin     (zieht webpack/terser mit)')
  console.error('oder gezielt, ohne globale Installation:')
  console.error('  npm install --no-save acorn')
  process.exit(2)
}

// ── Der Laufraum: welche Dateien teilen sich den Gegenstand ────────────────
//
// WARUM NICHT „DER GANZE BAUM". Namen kollidieren ueber Dateigrenzen hinweg,
// und eine Suche ueber alles spart genau die Funktion aus, die gefunden werden
// soll. Gemessener Fall: `coverFuerLokal` ist in `NewDesign/app.js` seit
// Wochen tot (BACKLOG R2), lebt aber in `src/frontend-box/src/app/now-playing.ts`
// als ANDERE, exportierte Funktion mit eigenen Tests. Wer den Baum durchsucht,
// findet den Angular-Zwilling und haelt die Leiche fuer lebendig.
//
// Der Laufraum ist deshalb: die Dateien, die MIT DIESER im selben Browser
// laufen. Fuer app.js sind das index.html (laedt es), apps.js (davor geladen)
// und wellen-messseite.html (laedt es ebenfalls). NICHT dabei:
//   src/deploy/…                   Auslieferstand, ein KOMPILAT — es beweist
//                                  keine Benutzung, es ist eine Kopie
//   MixPiBox-standalone.html       Schnappschuss vom 31.07.2026, 3,8 MB,
//                                  vollstaendig in sich, laedt app.js nicht
const LAUFRAUM_ENDUNGEN = ['.js', '.mjs', '.html']
const LAUFRAUM_AUSGENOMMEN = new Set(['MixPiBox-standalone.html'])

function laufraumDateien(dateiRel) {
  const ordner = dirname(dateiRel)
  const voll = join(WURZEL, ordner)
  if (!existsSync(voll)) return []
  return readdirSync(voll)
    .filter((n) => LAUFRAUM_ENDUNGEN.some((e) => n.endsWith(e)))
    .filter((n) => !LAUFRAUM_AUSGENOMMEN.has(n))
    .map((n) => join(ordner, n))
    .filter((p) => p !== dateiRel)
    .sort()
}

// Die Wachen: ein Treffer dort heisst „ein Werkzeug liest das", nicht „die
// Oberflaeche benutzt es". Getrennter Topf, getrennte Folge beim Loeschen.
//
// MIT UNTERVERZEICHNISSEN. `tools/e2e/` sah die erste Fassung nicht — und
// genau dort lag der einzige Treffer fuer `coverFuerLokal`.
//
// OHNE SICH SELBST. Die erste Fassung meldete `sprichImBrowser`,
// `hinueberDurchsTor` und `coverFuerLokal` als NUR-WACHE, und die Wache, die
// sie las, war SIE SELBST: der Kopf dieser Datei nennt alle drei als Beispiel.
// Ein Werkzeug, das seine eigene Begruendung fuer eine Gegenstelle haelt,
// meldet nie wieder einen Befund ([[kommentar-und-kompilat-sind-keine-gegenstelle]]).
const SELBST = relative(WURZEL, fileURLToPath(import.meta.url))

function wachenDateien(ordner = 'tools') {
  const raus = []
  for (const eintrag of readdirSync(join(WURZEL, ordner), { withFileTypes: true })) {
    const p = join(ordner, eintrag.name)
    if (eintrag.isDirectory()) {
      if (eintrag.name === 'node_modules' || eintrag.name.startsWith('.')) continue
      raus.push(...wachenDateien(p))
    } else if (/\.(js|mjs|ts|py|sh)$/.test(eintrag.name) && p !== SELBST) {
      raus.push(p)
    }
  }
  return raus
}

// ── Parsen, mit ehrlichem Abbruch ──────────────────────────────────────────
function parse(quelle, wo) {
  for (const sourceType of ['script', 'module']) {
    try {
      return acorn.parse(quelle, { ecmaVersion: 'latest', sourceType, locations: true })
    } catch (fehler) {
      if (sourceType === 'module') {
        const e = new Error(`${wo}: ${fehler.message}`)
        e.istParserfehler = true
        throw e
      }
    }
  }
  return null
}

function kinder(node) {
  const raus = []
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'type') continue
    const v = node[k]
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === 'string') raus.push(c)
    } else if (v && typeof v.type === 'string') {
      raus.push(v)
    }
  }
  return raus
}

const schluesselName = (knoten) =>
  knoten.type === 'Identifier' ? knoten.name : typeof knoten.value === 'string' ? knoten.value : null

const istFunktion = (n) =>
  n && (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression')

/** Der Namenskern ohne fuehrende `-`/`_`/`$` — siehe Topf ALS-SCHLUESSEL. */
const kern = (name) => name.replace(/^[-_$]+/, '')

// ── Ein Baum, einmal durchgegangen ─────────────────────────────────────────
function lies(quelle, wo, { alsGegenstelle = false } = {}) {
  const ast = parse(quelle, wo)
  const roh = (n) => quelle.slice(n.start, n.end).replace(/\s+/g, ' ')

  const definitionen = []
  const benutztAn = new Map() // name -> [offsets]
  const schluesselAnderswo = new Set()
  const zeichenketten = []
  const zusammensetzungen = [] // literale Bruchstuecke berechneter/gebauter Namen
  const gespiegelteBesitzer = new Set()
  const globalDynamisch = []
  const defStellen = new Set() // offsets der Namensknoten von Definitionen

  const merkeBenutzung = (name, offset) => {
    if (!benutztAn.has(name)) benutztAn.set(name, [])
    benutztAn.get(name).push(offset)
  }

  /** Die literalen Bruchstuecke eines zusammengesetzten Ausdrucks. */
  function bruchstuecke(n, raus = []) {
    if (!n) return raus
    if (n.type === 'TemplateLiteral') {
      for (const q of n.quasis) {
        const t = q.value.cooked ?? q.value.raw ?? ''
        if (t) raus.push(t)
      }
      return raus
    }
    if (n.type === 'BinaryExpression' && n.operator === '+') {
      bruchstuecke(n.left, raus)
      bruchstuecke(n.right, raus)
      if (n.left.type === 'Literal' && typeof n.left.value === 'string') raus.push(n.left.value)
      if (n.right.type === 'Literal' && typeof n.right.value === 'string') raus.push(n.right.value)
      return raus
    }
    return raus
  }

  function gehe(node, besitzer) {
    // ── Definitionen ──────────────────────────────────────────────────────
    if (node.type === 'FunctionDeclaration' && node.id) {
      definitionen.push({ name: node.id.name, art: 'deklaration', besitzer: null, node })
      defStellen.add(node.id.start)
    }
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
      if (istFunktion(node.init)) {
        definitionen.push({ name: node.id.name, art: 'variable', besitzer: null, node })
        defStellen.add(node.id.start)
      }
      if (node.init?.type === 'ObjectExpression') {
        // Die Eigenschaften dieses Objekts gehoeren diesem Namen.
        gehe(node.init, node.id.name)
        for (const k of kinder(node)) if (k !== node.init) gehe(k, besitzer)
        return
      }
    }
    if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && !node.left.computed) {
      const n = schluesselName(node.left.property)
      if (n && istFunktion(node.right)) {
        definitionen.push({ name: n, art: 'feldzuweisung', besitzer: roh(node.left.object), node })
        defStellen.add(node.left.property.start)
      }
      if (n && node.right.type === 'ObjectExpression') {
        gehe(node.right, roh(node.left))
        gehe(node.left, besitzer)
        return
      }
    }
    if (node.type === 'Property' && !node.computed && istFunktion(node.value)) {
      const n = schluesselName(node.key)
      if (n) {
        definitionen.push({ name: n, art: node.method ? 'methode' : 'objektfeld', besitzer, node })
        defStellen.add(node.key.start)
      }
    }
    if ((node.type === 'MethodDefinition' || node.type === 'PropertyDefinition') && !node.computed) {
      const n = schluesselName(node.key)
      if (n && (node.type === 'MethodDefinition' || istFunktion(node.value))) {
        definitionen.push({ name: n, art: 'klassenmethode', besitzer, node })
        defStellen.add(node.key.start)
      }
    }
    if ((node.type === 'ClassDeclaration' || node.type === 'ClassExpression') && node.id) {
      for (const k of kinder(node)) gehe(k, node.id.name)
      return
    }

    // ── Was als BLANKER SCHLUESSEL anderswo steht (Erzeuger-Frage) ────────
    if (node.type === 'Property' && !node.computed && !istFunktion(node.value)) {
      const n = schluesselName(node.key)
      if (n) schluesselAnderswo.add(n)
    }

    // ── Benutzungen ───────────────────────────────────────────────────────
    if (node.type === 'Identifier' && !defStellen.has(node.start)) {
      merkeBenutzung(node.name, node.start)
    }
    if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
      if (!defStellen.has(node.property.start)) merkeBenutzung(node.property.name, node.property.start)
    }

    // ── Zeichenketten ─────────────────────────────────────────────────────
    if (node.type === 'Literal' && typeof node.value === 'string') zeichenketten.push(node.value)
    if (node.type === 'TemplateLiteral') {
      for (const q of node.quasis) zeichenketten.push(q.value.cooked ?? q.value.raw ?? '')
    }

    // ── Dynamik, die jedes Urteil kippt ───────────────────────────────────
    if (node.type === 'MemberExpression' && node.computed) {
      const objekt = roh(node.object)
      gespiegelteBesitzer.add(objekt)
      if (/^(window|globalThis|self|document\.defaultView)$/.test(objekt) && node.property.type !== 'Literal') {
        globalDynamisch.push(`${wo}:${node.loc.start.line}  ${roh(node).slice(0, 70)}`)
      }
      for (const st of bruchstuecke(node.property)) zusammensetzungen.push(st)
    }
    if (node.type === 'SpreadElement' || node.type === 'RestElement') {
      if (node.argument) gespiegelteBesitzer.add(roh(node.argument))
    }
    if (node.type === 'ForInStatement') gespiegelteBesitzer.add(roh(node.right))
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && !node.callee.computed) {
      const objekt = roh(node.callee.object)
      const fn = schluesselName(node.callee.property)
      const spiegelt =
        (objekt === 'Object' &&
          /^(keys|values|entries|assign|fromEntries|getOwnPropertyNames|defineProperty|freeze)$/.test(fn)) ||
        (objekt === 'JSON' && fn === 'stringify') ||
        (objekt === 'Reflect' && /^(ownKeys|get|has)$/.test(fn))
      if (spiegelt) for (const a of node.arguments) gespiegelteBesitzer.add(roh(a))
    }
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'eval') {
      globalDynamisch.push(`${wo}:${node.loc.start.line}  eval(...)`)
    }
    if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'Function') {
      globalDynamisch.push(`${wo}:${node.loc.start.line}  new Function(...)`)
    }
    if (node.type === 'WithStatement') {
      globalDynamisch.push(`${wo}:${node.loc.start.line}  with(...)`)
    }

    for (const k of kinder(node)) gehe(k, besitzer)
  }

  gehe(ast, null)

  // Fuer Gegenstellen ist eine DEFINITION genauso ein Lebenszeichen wie ein
  // Aufruf: dort steht dann eine zweite Fassung, und eine Leiche im Original
  // zu faellen ist eine andere Entscheidung als „niemand ruft es".
  if (alsGegenstelle) for (const d of definitionen) merkeBenutzung(d.name, d.node.start)

  return {
    definitionen,
    benutztAn,
    schluesselAnderswo,
    zeichenketten,
    zusammensetzungen,
    gespiegelteBesitzer,
    globalDynamisch,
  }
}

// ── HTML: die Skriptbloecke parsen, den Rest als Text lesen ────────────────
//
// Die Skriptbloecke sind echter Code und kommen in den Parser. Der HTML-Rest
// wird textlich durchsucht — dort stehen `onclick="x()"` und Datenattribute,
// und ein Treffer heisst vorsichtshalber „lebt". Ein Treffer in einem
// HTML-KOMMENTAR ist dagegen ein Zitat und bekommt seinen eigenen Topf; dieser
// Baum begruendet auch in HTML ausfuehrlich.
function htmlZerlegen(text) {
  const kommentare = []
  const ohneKommentar = text.replace(/<!--[\s\S]*?-->/g, (m) => {
    kommentare.push(m)
    return ' '.repeat(m.length)
  })
  const skripte = []
  const rest = ohneKommentar.replace(
    /<script(?![^>]*\bsrc\s*=)([^>]*)>([\s\S]*?)<\/script>/gi,
    (m, _attr, rumpf) => {
      skripte.push(rumpf)
      return ' '.repeat(m.length)
    },
  )
  return { skripte, rest, kommentar: kommentare.join('\n') }
}

const alsWort = (name) => new RegExp(`(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}(?![\\w$])`)

// ── Die Gegenstellen einsammeln ────────────────────────────────────────────
function gegenstelleLesen(relPfad) {
  const voll = join(WURZEL, relPfad)
  const text = readFileSync(voll, 'utf8')
  const ergebnis = { pfad: relPfad, namen: new Set(), zeichenketten: [], text: '', kommentar: '', kaputt: null }
  const einbauen = (quelle, wo) => {
    try {
      const b = lies(quelle, wo, { alsGegenstelle: true })
      for (const n of b.benutztAn.keys()) ergebnis.namen.add(n)
      for (const n of b.schluesselAnderswo) ergebnis.namen.add(n)
      ergebnis.zeichenketten.push(...b.zeichenketten)
    } catch (fehler) {
      // KEIN STILLES UEBERGEHEN: eine Gegenstelle, die nicht geparst werden
      // kann, wird textlich gelesen — und der Grund wird gemeldet, sonst
      // verschwindet ein Lebenszeichen und eine lebende Funktion gilt als tot.
      ergebnis.kaputt = fehler.message
      ergebnis.text += `\n${quelle}`
    }
  }
  if (relPfad.endsWith('.html')) {
    const { skripte, rest, kommentar } = htmlZerlegen(text)
    skripte.forEach((s, i) => einbauen(s, `${relPfad}#script${i}`))
    ergebnis.text += rest
    ergebnis.kommentar = kommentar
  } else {
    einbauen(text, relPfad)
  }
  return ergebnis
}

// ── Aufruf ─────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const LANG = argv.includes('--lang')
const PRUEFEN = argv.includes('--pruefen')
const EINFRIEREN = argv.includes('--einfrieren')
const FRAGEN = argv.filter((a) => a.startsWith('--fragen=')).map((a) => a.slice('--fragen='.length))
{
  const i = argv.indexOf('--fragen')
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) FRAGEN.push(argv[i + 1])
}
let DATEI = 'NewDesign/app.js'
{
  const i = argv.indexOf('--datei')
  if (i >= 0) {
    if (!argv[i + 1]) {
      console.error('--datei ohne Pfad.')
      process.exit(2)
    }
    DATEI = relative(WURZEL, resolve(process.cwd(), argv[i + 1])) || argv[i + 1]
  }
}

function abbruch(...zeilen) {
  for (const z of zeilen) console.error(z)
  process.exit(2)
}

// ── --gegenprobe: haelt die Wache, wenn man sie absichtlich bricht? ────────
//
// WARUM SIE IM WERKZEUG WOHNT UND NICHT IN EINER SITZUNG: eine Gegenprobe, die
// einmal von Hand lief, beweist etwas ueber den Tag, an dem sie lief. Die
// Frage „meldet die Wache eine tote Funktion noch, und laesst sie eine
// ZUSAMMENGESETZT gerufene in Ruhe" muss bei JEDER Aenderung an den Toepfen
// neu beantwortet werden. Vorbild: `tools/untergrenzen-waechter-probe.py`.
//
// ZWEISEITIG, und die zweite Seite ist die wichtigere: ein Treffer beweist
// nichts, solange nicht auch gezeigt ist, dass die Wache SCHWEIGT, wo sie
// schweigen muss. Bleibt eine Gegenprobe gruen, wo sie rot sein muesste, IST
// das der Fund ([[gegenprobe-bleibt-gruen-ist-der-fund]]).
//
// DAS WEGWERFZIEL LIEGT AUSSERHALB DES BAUMS (`os.tmpdir()`), nie darin: der
// Erfolg dieser Probe ist ein Schaden, und eine Nachbarsitzung schreibt in
// dieselben Dateien ([[gegenprobe-loescht-braucht-wegwerfziel]],
// [[dateikopie-toetet-nachbarsitzung]]).
if (argv.includes('--gegenprobe')) {
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, rmSync, mkdirSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')

  const P = 'zzProbe7b3f' // eindeutig genug, dass kein Werkzeug ihn zufaellig nennt
  //
  // DER ERSTE ENTWURF DIESER PROBE WAR SELBST FALSCH, und die Probe hat es
  // gemeldet: dort stand `const tafel = { ZusammenEins: ${P}ZusammenEins }`
  // und `window.${P}Aussen = { ${P}Gegenstelle }`. Beides sind
  // IDENTIFIER-Stellen — die zwei Funktionen waren damit ganz gewoehnlich
  // gerufen und kamen als Kandidaten gar nicht erst vor. Die Probe war rot,
  // ohne dass an der Wache etwas fehlte. Gebraucht wird die Form, die NUR
  // ueber den zusammengesetzten Schluessel erreichbar ist: eine METHODE ohne
  // jede Nennung ihres Namens.
  const rumpf = (gerufen) => `;(() => {
  'use strict'
  function ${P}Tot() { return 1 }
  function ${P}NurSelbst(n) { return n > 0 ? ${P}NurSelbst(n - 1) : 0 }
  function ${P}Gerufen() { return 2 }
  const tafel = {
    ${P}ZusammenEins() { return 3 },
  }
  function los(teil) { return tafel['${P}Zusammen' + teil]() }
  window.${P}Aussen = {
    ${P}Gegenstelle() { return 4 },
  }
  console.log(${P}Gerufen(), los('Eins'))
  ${gerufen ? `console.log(${P}Tot(), ${P}NurSelbst(3))` : ''}
})()
`
  const ordner = mkdtempSync(join(tmpdir(), 'tote-funktionen-gegenprobe-'))
  const berichte = []
  let fehler = 0
  const pruefe = (satz, bedingung) => {
    berichte.push(`  ${bedingung ? 'ok  ' : 'NEIN'} ${satz}`)
    if (!bedingung) fehler++
  }
  try {
    mkdirSync(join(ordner, 'raum'))
    // Die Gegenstelle: eine zweite Datei desselben Laufraums, die ruft.
    writeFileSync(
      join(ordner, 'raum', 'nachbar.html'),
      `<script>window.${P}Aussen.${P}Gegenstelle()</script>`,
      'utf8',
    )
    const frage = (datei, ...namen) => {
      const args = [fileURLToPath(import.meta.url), '--datei', datei, ...namen.map((n) => `--fragen=${P}${n}`)]
      // stderr wird EINGEFANGEN, nicht durchgereicht: der Abbruch-Fall ist
      // eine ERWARTUNG dieser Probe, und seine Anleitung auf dem Schirm des
      // Laeufers sieht aus wie ein Fehler.
      try {
        return {
          code: 0,
          text: execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
        }
      } catch (e) {
        return { code: e.status ?? 99, text: `${e.stdout ?? ''}${e.stderr ?? ''}` }
      }
    }
    const A = join(ordner, 'raum', 'probe.js')

    // ── RICHTUNG 1: niemand ruft sie — sie MUSS im Befund stehen ──────────
    writeFileSync(A, rumpf(false), 'utf8')
    const eins = frage(A, 'Tot', 'NurSelbst')
    pruefe('ungerufene Wegwerf-Funktion wird als TOT gemeldet', /Tot\s+TOT\b/.test(eins.text))
    pruefe('nur-selbstbezuegliche Funktion wird als TOT gemeldet', /NurSelbst\s+TOT\b/.test(eins.text))
    pruefe('Rueckgabe 0, wenn alle gefragten Namen tot sind', eins.code === 0)

    // ── RICHTUNG 2: jetzt ruft sie jemand — sie MUSS verschwinden ─────────
    writeFileSync(A, rumpf(true), 'utf8')
    const zwei = frage(A, 'Tot', 'NurSelbst')
    pruefe('gerufene Funktion verschwindet aus dem Befund', /Tot\s+LEBT\b/.test(zwei.text))
    pruefe('Rueckgabe 1, sobald ein gefragter Name lebt', zwei.code === 1)

    // ── DIE GEGENKONTROLLE: was ZUSAMMENGESETZT gerufen wird, ist KEIN
    //    Befund — und zwar in BEIDEN Richtungen. Ohne sie beweist ein
    //    Treffer nichts: eine Wache, die alles meldet, meldet auch das.
    for (const [wie, datei] of [
      ['ohne Aufruf der Wegwerf-Funktion', rumpf(false)],
      ['mit Aufruf der Wegwerf-Funktion', rumpf(true)],
    ]) {
      writeFileSync(A, datei, 'utf8')
      const d = frage(A, 'ZusammenEins')
      pruefe(`zusammengesetzt gerufene Funktion NICHT als tot gemeldet (${wie})`, /ZUSAMMENGESETZT/.test(d.text))
      pruefe(`  … und auch nicht still uebergangen (${wie})`, !/ZusammenEins\s+TOT\b/.test(d.text))
    }

    // ── UND DIE DRITTE: ein Aufruf aus einer ANDEREN Datei des Laufraums ──
    writeFileSync(A, rumpf(false), 'utf8')
    const vier = frage(A, 'Gegenstelle')
    pruefe('Aufruf aus einer Nachbardatei wird gesehen (GEGENSTELLE)', /GEGENSTELLE/.test(vier.text))

    // ── UND KEIN FALSCH-GRUEN: fehlt die Eingabe, wird abgebrochen ────────
    const fuenf = frage(join(ordner, 'raum', 'gibtsnicht.js'), 'Tot')
    pruefe('fehlende Eingabedatei bricht mit 2 ab statt gruen zu sagen', fuenf.code === 2)
  } finally {
    rmSync(ordner, { recursive: true, force: true })
  }
  console.log('GEGENPROBE tote-funktionen-schau — beide Richtungen plus Gegenkontrolle:')
  for (const z of berichte) console.log(z)
  if (fehler) {
    console.log('')
    console.log(`${fehler} ERWARTUNG(EN) NICHT ERFUELLT — die Wache urteilt nicht mehr, wie sie soll.`)
    process.exit(1)
  }
  console.log(`Alle ${berichte.length} Erwartungen erfuellt.`)
  process.exit(0)
}

const vollPfad = join(WURZEL, DATEI)
if (!existsSync(vollPfad)) {
  abbruch(
    `Eingabedatei fehlt: ${DATEI}`,
    'Ohne Gegenstand kann nichts geprueft werden — gruen waere hier gelogen.',
    'Andere Datei waehlen:  node tools/tote-funktionen-schau.mjs --datei <pfad>',
  )
}

let baum
try {
  baum = lies(readFileSync(vollPfad, 'utf8'), DATEI)
} catch (fehler) {
  abbruch(
    `${DATEI} laesst sich nicht parsen: ${fehler.message}`,
    'Entweder ist die Datei gerade kaputt, oder sie benutzt Syntax, die diese',
    'acorn-Fassung nicht kennt. Beides ist ein Befund — nicht gruen.',
  )
}

// SELBSTPRUEFUNG: findet der Baum keine einzige Funktion, greift die Erkennung
// nicht mehr (andere Schreibweise? falsche Datei?). Gruen waere hier gelogen —
// dieselbe Lehre wie „KEIN EINZIGER WERKZEUGRUF" in ungerufene-wachen.py.
if (!baum.definitionen.length) {
  abbruch(
    `${DATEI}: KEINE EINZIGE Funktionsdefinition gefunden.`,
    'Die Erkennung greift nicht mehr, oder die Datei enthaelt wirklich keine',
    'Funktion. Beides muss ein Mensch ansehen.',
  )
}

// ── Gegenstellen ───────────────────────────────────────────────────────────
const gegenstellen = laufraumDateien(DATEI).map(gegenstelleLesen)
// ── Die Wachen, OHNE ihre Kommentare ───────────────────────────────────────
//
// WARUM DAS SEIN MUSS: `tools/e2e/neu-oberflaeche.test.mjs:1273` nennt
// `coverFuerLokal` in einem erklaerenden Kommentar — kein Aufruf, ein Zitat.
// Die erste Fassung las den Rohtext und hielt das Zitat fuer eine Gegenstelle.
//
// WIE: .js/.mjs/.ts gehen durch denselben Parser wie die Eingabedatei; ein
// Syntaxbaum hat keine Kommentare, und ein Regex ueber Blockkommentare waere
// hier gefaehrlich (ein Backtick in einem Kommentar INNERHALB eines
// Template-Literals reisst jede Textregel ab, [[backticks-beenden-jede-vorlage]]).
// Bei .py/.sh faellt die `#`-Zeile weg — aber NUR die ganze Zeile, und Strings
// bleiben stehen: ein echter Ruf steht dort selbst in einer Zeichenkette
// (`subprocess.run(["bash", "tools/x.sh"])`).
// Laesst sich eine Datei nicht parsen, wird sie ROH gelesen: lieber ein Zitat
// zu viel als ein uebersehener Aufrufer.
function wacheOhneKommentar(pfad, text) {
  if (/\.(js|mjs|ts)$/.test(pfad)) {
    try {
      const b = lies(text, pfad, { alsGegenstelle: true })
      return [...b.benutztAn.keys(), ...b.schluesselAnderswo, ...b.zeichenketten].join('\n')
    } catch {
      return text
    }
  }
  return text
    .split('\n')
    .filter((z) => !z.trimStart().startsWith('#'))
    .join('\n')
}

const wachenText = new Map()
for (const p of wachenDateien()) {
  try {
    wachenText.set(p, wacheOhneKommentar(p, readFileSync(join(WURZEL, p), 'utf8')))
  } catch {
    /* unlesbare Datei ist kein Lebenszeichen */
  }
}

// ── Kandidaten: keine Benutzung AUSSERHALB des eigenen Rumpfes ─────────────
const kandidaten = []
for (const d of baum.definitionen) {
  const stellen = baum.benutztAn.get(d.name) ?? []
  const aussen = stellen.filter((off) => off < d.node.start || off >= d.node.end)
  if (aussen.length) continue
  kandidaten.push({ ...d, nurSelbstbezug: stellen.length > 0, zeile: d.node.loc.start.line })
}

// ── Einordnen ──────────────────────────────────────────────────────────────
const eigeneZeichenketten = baum.zeichenketten
const ZUSAMMENSETZ_MINDESTLAENGE = 3

function einordnen(k) {
  const name = k.name
  const wort = alsWort(name)
  const wortKern = alsWort(kern(name))

  // 0. Auf ein FREMDES Objekt gelegt — das schlaegt alles andere, weil es
  //    definitionsgemaess gilt und nicht von einem Namenstreffer abhaengt.
  //
  // DER FALL, DER DIE ERSTE FASSUNG FALSCH-ROT MACHTE: `pegelStrom.onmessage`
  // und `pegelStrom.onerror` haben in der ganzen Datei keine Aufrufstelle —
  // sie werden vom BROWSER gerufen, sobald die EventSource etwas liefert.
  // Beides sah nach einem Befund aus und war lebender Code am heissen Pfad.
  //
  // DAS MERKMAL IST DIE SORTE, NICHT DER NAME: hier steht bewusst KEINE
  // `on…`-Regel. Eine Funktion, die auf ein Feld eines Objekts gelegt wird,
  // das dieser Code nicht selbst aufgeschrieben hat, kann jeder rufen, der
  // dieses Objekt haelt — Browser, Fremdmodul, Server. Wer das beweisen
  // wollte, braeuchte eine Entweich-Analyse; die kann dieses Werkzeug nicht,
  // und was es nicht beweisen kann, meldet es nicht.
  // Am 19.09.2026 nachgemessen: in app.js gibt es genau ZWEI solche Stellen,
  // und beide sind Browser-Rueckrufe. Die Regel kostet also nichts.
  //
  // WARUM ZUERST UND NICHT WEITER UNTEN: `pegelStrom.onerror` landete in der
  // ersten Fassung im Topf GEGENSTELLE, weil `NewDesign/apps.js` irgendwo
  // ebenfalls ein `onerror` hat. Das Urteil (Finger weg) war richtig, der
  // GRUND war Zufall — bei so gewoehnlichen Namen trifft die Namenssuche in
  // der Nachbardatei fast immer, und eine Wache, die den richtigen Ausgang
  // aus einem falschen Grund nimmt, taeuscht beim naechsten Lesen.
  if (k.art === 'feldzuweisung') {
    return { topf: 'FREMDBESITZ', warum: `auf ${k.besitzer} gelegt — der Halter ruft, nicht diese Datei` }
  }

  // 1. Lebt in einer anderen Datei desselben Laufraums?
  for (const g of gegenstellen) {
    if (g.namen.has(name)) return { topf: 'GEGENSTELLE', warum: g.pfad }
    if (wort.test(g.text)) return { topf: 'GEGENSTELLE', warum: `${g.pfad} (HTML ausserhalb <script>)` }
  }

  // 2. Eine Wache liest es — Loeschen macht sie rot, nicht die Oberflaeche kaputt.
  for (const [p, t] of wachenText) if (wort.test(t)) return { topf: 'NUR-WACHE', warum: p }

  // 3. Nur in einem HTML-Kommentar der Gegenstellen — ein Zitat, keine Gegenstelle.
  for (const g of gegenstellen) {
    if (wort.test(g.kommentar)) return { topf: 'NUR-KOMMENTAR', warum: `${g.pfad} (HTML-Kommentar)` }
  }

  // 4. Koennte der Name ZUSAMMENGESETZT entstehen?
  for (const st of baum.zusammensetzungen) {
    if (st.length < ZUSAMMENSETZ_MINDESTLAENGE) continue
    if (name.startsWith(st) && name.length > st.length) return { topf: 'ZUSAMMENGESETZT', warum: `Praefix '${st}'` }
    if (name.endsWith(st) && name.length > st.length) return { topf: 'ZUSAMMENGESETZT', warum: `Endung '${st}'` }
  }

  // 5. Wird das besitzende Objekt gespiegelt oder berechnet angefasst?
  if (k.besitzer && baum.gespiegelteBesitzer.has(k.besitzer)) {
    return { topf: 'SPIEGEL', warum: `${k.besitzer} wird berechnet/gespiegelt angefasst` }
  }

  // 6. Steht der Name irgendwo als Zeichenkette?
  const alleKetten = [eigeneZeichenketten, ...gegenstellen.map((g) => g.zeichenketten)]
  for (const ketten of alleKetten) {
    for (const s of ketten) if (s.includes(name)) return { topf: 'ZEICHENKETTE', warum: `'${s.slice(0, 40)}'` }
  }

  // 7. Steht er anderswo als blanker Objektschluessel? (Erzeuger-Frage)
  if (baum.schluesselAnderswo.has(name)) return { topf: 'ALS-SCHLUESSEL', warum: `${name}:` }
  const k2 = kern(name)
  if (k2 !== name && baum.schluesselAnderswo.has(k2)) return { topf: 'ALS-SCHLUESSEL', warum: `${k2}: (Namenskern)` }
  if (k2 !== name) {
    for (const ketten of alleKetten) for (const s of ketten) if (wortKern.test(s)) {
      return { topf: 'ALS-SCHLUESSEL', warum: `Namenskern '${k2}' in '${s.slice(0, 30)}'` }
    }
  }

  // 8. Macht die Datei ueberhaupt dynamische globale Zugriffe?
  if (baum.globalDynamisch.length && (k.art === 'deklaration' || k.art === 'variable')) {
    return { topf: 'GLOBAL-DYNAMISCH', warum: baum.globalDynamisch[0] }
  }

  return { topf: 'TOT', warum: k.nurSelbstbezug ? 'nur Selbstbezug im eigenen Rumpf' : 'kein Aufrufer, kein Gegengrund' }
}

for (const k of kandidaten) Object.assign(k, einordnen(k))
kandidaten.sort((a, b) => a.zeile - b.zeile)

const tot = kandidaten.filter((k) => k.topf === 'TOT')
const zustand = (k) => (k.topf === 'TOT' ? 'tot' : 'unklar')
const RANG = { tot: 0, unklar: 1 }
const RANG_UNBEKANNT = 1

// ── --fragen: genau diese Namen ────────────────────────────────────────────
if (FRAGEN.length) {
  let lebt = 0
  for (const name of FRAGEN) {
    const treffer = kandidaten.filter((k) => k.name === name)
    const defs = baum.definitionen.filter((d) => d.name === name)
    if (!defs.length) {
      console.log(`  ${name.padEnd(28)} GIBT ES NICHT in ${DATEI}`)
      lebt++
      continue
    }
    if (!treffer.length) {
      const stellen = baum.benutztAn.get(name) ?? []
      const aussen = stellen.filter((o) => defs.every((d) => o < d.node.start || o >= d.node.end))
      console.log(`  ${name.padEnd(28)} LEBT — ${aussen.length} Aufrufstelle(n) in ${DATEI}`)
      lebt++
      continue
    }
    for (const t of treffer) console.log(`  ${name.padEnd(28)} ${t.topf.padEnd(16)} ${t.warum}`)
    if (treffer.some((t) => t.topf !== 'TOT')) lebt++
  }
  process.exit(lebt ? 1 : 0)
}

// ── --einfrieren ───────────────────────────────────────────────────────────
const baselineZeile = (k) => `${zustand(k)} ${DATEI}:${k.name}`

if (EINFRIEREN) {
  const heute = new Date().toISOString().slice(0, 10)
  const alt = existsSync(BASELINE)
    ? readFileSync(BASELINE, 'utf8')
        .split('\n')
        .filter((z) => z.trim() && !z.trimStart().startsWith('#'))
        .filter((z) => !z.split(' ')[1]?.startsWith(`${DATEI}:`))
    : []
  const zeilen = [
    '# TOTE-FUNKTIONEN-BASELINE — je Zeile: <zustand> <datei>:<funktion>',
    '#',
    '#   tot     kein Aufrufer, kein Gegengrund (Rang 0)',
    '#   unklar  kein Aufrufer, aber ein Grund, die Finger davonzulassen (Rang 1)',
    '#',
    '# Wer GERUFEN wird, steht hier gar nicht. Ein Name, der hier fehlt, gilt als',
    '# Rang 1 — eine neu tote Funktion blockt damit, ohne zweite Regel.',
    '# Die Ratsche blockt, wenn ein Rang SINKT. Der Bestand darf schlecht sein,',
    '# er darf nur nicht schlechter werden.',
    `# Eingefroren am ${heute}. Neu: node tools/tote-funktionen-schau.mjs --einfrieren`,
    ...alt,
    ...kandidaten.map(baselineZeile),
  ]
  writeFileSync(BASELINE, `${zeilen.join('\n')}\n`, 'utf8')
  console.log(
    `Baseline eingefroren: ${kandidaten.length} Kandidaten in ${DATEI} — ` +
      `${tot.length} tot, ${kandidaten.length - tot.length} unklar.`,
  )
  console.log(`  ${relative(WURZEL, BASELINE)}`)
  process.exit(0)
}

// ── Die Bilanz ─────────────────────────────────────────────────────────────
const toepfe = {}
for (const k of kandidaten) toepfe[k.topf] = (toepfe[k.topf] || 0) + 1
const bilanz =
  `BILANZ ${DATEI}: ${baum.definitionen.length} Funktionsdefinitionen, ` +
  `${kandidaten.length} ohne Aufrufstelle, davon ${tot.length} ohne Gegengrund. ` +
  `Gegenstellen: ${gegenstellen.map((g) => g.pfad.replace(/^.*\//, '')).join(', ') || 'keine'}.`

// ── --pruefen: die Ratsche ─────────────────────────────────────────────────
if (PRUEFEN) {
  if (!existsSync(BASELINE)) {
    abbruch(
      `Baseline fehlt: ${relative(WURZEL, BASELINE)}`,
      'Die Ratsche kann ohne eingefrorenen Bestand nichts vergleichen.',
      'Einmal einfrieren:  node tools/tote-funktionen-schau.mjs --einfrieren',
      'Danach den vollen Bericht lesen:  node tools/tote-funktionen-schau.mjs',
    )
  }
  const frueher = new Map()
  try {
    for (const zeile of readFileSync(BASELINE, 'utf8').split('\n')) {
      if (!zeile.trim() || zeile.trimStart().startsWith('#')) continue
      const teile = zeile.trim().split(/\s+/)
      if (teile.length !== 2 || !(teile[0] in RANG)) throw new Error(`unlesbare Zeile: ${JSON.stringify(zeile)}`)
      frueher.set(teile[1], teile[0])
    }
  } catch (fehler) {
    abbruch(
      `Baseline unlesbar (${relative(WURZEL, BASELINE)}): ${fehler.message}`,
      'Neu einfrieren:  node tools/tote-funktionen-schau.mjs --einfrieren',
    )
  }
  if (!frueher.size) {
    abbruch(
      `Baseline enthaelt keinen Eintrag (${relative(WURZEL, BASELINE)}).`,
      'Neu einfrieren:  node tools/tote-funktionen-schau.mjs --einfrieren',
    )
  }

  const schlechter = []
  const besser = []
  for (const k of kandidaten) {
    const schluessel = `${DATEI}:${k.name}`
    const war = frueher.get(schluessel)
    const rangWar = war === undefined ? RANG_UNBEKANNT : RANG[war]
    const ist = zustand(k)
    if (RANG[ist] < rangWar) {
      schlechter.push(
        `${schluessel}:${k.zeile} — ${war === undefined ? 'ist neu ohne Aufrufer' : `war \`${war}\``}, ` +
          `ist jetzt \`${ist}\` (${k.warum})`,
      )
    } else if (RANG[ist] > rangWar) {
      besser.push(`${schluessel} — war \`${war}\`, ist jetzt \`${ist}\``)
    }
  }
  const jetztNamen = new Set(kandidaten.map((k) => `${DATEI}:${k.name}`))
  for (const [schluessel, war] of frueher) {
    if (!schluessel.startsWith(`${DATEI}:`)) continue
    if (!jetztNamen.has(schluessel)) besser.push(`${schluessel} — war \`${war}\`, wird jetzt gerufen oder ist weg`)
  }

  console.log(bilanz)
  console.log(
    `RATSCHE: ${frueher.size} Eintraege eingefroren in ${relative(WURZEL, BASELINE)}; ` +
      `${schlechter.length} schlechter, ${besser.length} besser.`,
  )
  const kaputteGegenstellen = gegenstellen.filter((g) => g.kaputt)
  for (const g of kaputteGegenstellen) console.log(`  HINWEIS: ${g.pfad} nur textlich gelesen (${g.kaputt})`)
  if (besser.length && !schlechter.length) {
    for (const z of besser) console.log(`  besser: ${z}`)
    console.log('  Baseline nachziehen:  node tools/tote-funktionen-schau.mjs --einfrieren')
  }
  if (!schlechter.length) {
    console.log('Die Ratsche haelt: der eingefrorene Bestand ist nicht schlechter geworden.')
    process.exit(0)
  }
  console.log('')
  for (const z of schlechter) console.log(`  SCHLECHTER: ${z}`)
  console.log('')
  console.log(`${schlechter.length} VERSCHLECHTERUNG(EN).`)
  console.log('Entweder ruft die Funktion wieder jemand, oder sie faellt — oder der')
  console.log('Bestand ist bewusst so:  node tools/tote-funktionen-schau.mjs --einfrieren')
  process.exit(1)
}

// ── Der ehrliche Bericht ───────────────────────────────────────────────────
console.log(bilanz)
if (baum.globalDynamisch.length) {
  console.log('')
  console.log('ACHTUNG — DYNAMISCHER GLOBALER ZUGRIFF IN DIESER DATEI:')
  for (const z of baum.globalDynamisch.slice(0, 5)) console.log(`  ${z}`)
  console.log('  Solange das dasteht, ist KEINE freie Funktion beweisbar tot.')
}
for (const g of gegenstellen) {
  if (g.kaputt) console.log(`HINWEIS: ${g.pfad} nur textlich gelesen (${g.kaputt}) — Lebenszeichen ungenau.`)
}
console.log('')
const reihenfolge = [
  'TOT',
  'NUR-WACHE',
  'GEGENSTELLE',
  'NUR-KOMMENTAR',
  'ZUSAMMENGESETZT',
  'SPIEGEL',
  'FREMDBESITZ',
  'ZEICHENKETTE',
  'ALS-SCHLUESSEL',
  'GLOBAL-DYNAMISCH',
]
for (const topf of reihenfolge) {
  const drin = kandidaten.filter((k) => k.topf === topf)
  if (!drin.length) continue
  const kopf =
    topf === 'TOT'
      ? `── ${topf} (${drin.length}) — Kandidaten, kein Urteil ──`
      : `── ${topf} (${drin.length}) — FINGER WEG, Grund daneben ──`
  console.log(kopf)
  for (const k of drin) {
    const zeile = `  ${DATEI}:${String(k.zeile).padEnd(6)} ${k.name.padEnd(26)} ${k.art.padEnd(15)}`
    console.log(LANG || topf === 'TOT' ? `${zeile} ${k.warum}` : zeile)
  }
  console.log('')
}
console.log('Dies ist eine BEFUNDLISTE, kein Urteil: mehrere Eintraege stehen auf')
console.log('erklaerte Absicht im Baum. Das URTEIL faellt die Ratsche:')
console.log('  node tools/tote-funktionen-schau.mjs --pruefen')
process.exit(0)
