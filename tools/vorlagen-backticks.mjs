/**
 * KEIN BACKTICK IN EINER ANGULAR-VORLAGE — und zwar nachweisbar.
 *
 * WOZU: Die Vorlagen der Verwaltung stehen in Template-Literalen
 * (`template: \`…\``). Ein Backtick darin beendet die Zeichenkette mitten im
 * HTML. Der Uebersetzer meckert dabei NICHT zwangslaeufig: alles nach dem
 * Backtick wird zu TypeScript, und wenn das zufaellig durchgeht, hat man eine
 * halbe Seite. Genau das ist am 03.08.2026 passiert — ein Backtick in einem
 * HTML-Kommentar auf der Medienseite, und ihr Suchbestand fiel von 28
 * Eintraegen auf 4. Nichts wurde rot; die Datei wurde nur still kuerzer.
 *
 * Die Regel stand bis dahin nur im Wiki (backticks-in-angular-vorlagen) und in
 * der Anweisung an den Menschen. Eine Regel ohne Pruefung ist eine Bitte.
 *
 * WIE GEPRUEFT WIRD, und warum so: Ein Backtick laesst sich nicht suchen — er
 * ist ja das Zeichen, das die Vorlage BEENDET, also gibt es ihn nach dem
 * Ausschneiden per Definition nicht mehr. Geprueft wird deshalb, ob direkt
 * hinter dem Ende der Vorlage das steht, was dort stehen MUSS: das Ende der
 * Eigenschaft (Komma, dann die naechste Eigenschaft oder die schliessende
 * Klammer des Decorators). Steht dort HTML oder Prosa, hat ein Backtick zu
 * frueh geschlossen.
 *
 * ZUSAETZLICH wird der Fall „Vorlage laeuft bis zum Dateiende" gemeldet: dann
 * gibt es gar keinen schliessenden Backtick mehr.
 *
 * WAS ES AENDERT: nichts. Es liest nur.
 *
 * AUFRUF
 *     node tools/vorlagen-backticks.mjs            # Bericht, Code 1 bei Befund
 *     node --test tools/vorlagen-backticks.test.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = join(HIER, '..')

/** Wo Angular-Bauteile liegen. Beide Oberflaechen, nicht nur die Verwaltung. */
const ORTE = ['src/frontend-admin/src/app']

/**
 * DIE ZWEI LITERALE EINES BAUTEILS. `styles:` kam am 06.09.2026 dazu — an
 * genau diesem Fall gescheitert: ein Kommentar im Stil-Block nannte eine
 * CSS-Eigenschaft in Backticks, das Literal endete dort, und der Bau warf acht
 * unverstaendliche TypeScript-Fehler („No value exists in scope for the
 * shorthand property 'max'"). Die Wache stand daneben und meldete gruen — sie
 * kannte nur `template:`. Eine Wache, die die halbe Gefahr kennt, ist
 * gefaehrlicher als keine: man verlaesst sich auf sie.
 */
const ANFAENGE = ['template: `', 'styles: `']

/**
 * Was direkt hinter einer HEIL geschlossenen Vorlage stehen darf.
 *
 * Nach dem schliessenden Backtick folgt im Decorator-Objekt entweder ein Komma
 * oder gleich das Ende — beides moeglicherweise nach Leerraum. Alles andere
 * ist Text, der eigentlich noch INNERHALB der Vorlage stehen sollte.
 */
const DANACH_ERLAUBT = /^\s*(,|\}\s*\))/

/** Alle .ts-Dateien unterhalb eines Verzeichnisses, ohne Tests. */
function dateienUnter(wurzel) {
  const raus = []
  for (const e of readdirSync(wurzel, { withFileTypes: true })) {
    const p = join(wurzel, e.name)
    if (e.isDirectory()) raus.push(...dateienUnter(p))
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) raus.push(p)
  }
  return raus
}

/**
 * Eine Quelle pruefen. Pure — nimmt Text, gibt Befunde.
 *
 * Getrennt vom Dateilesen, damit die Pruefung einen erfundenen Fall
 * durchschicken kann: sonst zeigt sie nur, dass die heutigen Dateien in
 * Ordnung sind, und nicht, dass sie einen Fehler auch faende.
 */
export function befundeIn(quelle, name = '<text>') {
  const raus = []
  // JE LITERAL-ART EIGENE Suche: `template:` und `styles:` koennen in einer
  // Datei beide vorkommen, und ein Fehler in einem sagt nichts ueber das andere.
  for (const ANFANG of ANFAENGE) {
    let ab = 0
    for (;;) {
      const anfang = quelle.indexOf(ANFANG, ab)
      if (anfang < 0) break
      const von = anfang + ANFANG.length
      const bis = quelle.indexOf('`', von)
      const zeile = quelle.slice(0, anfang).split('\n').length
      const was = ANFANG.startsWith('styles') ? 'Der Stil-Block' : 'Die Vorlage'
      if (bis < 0) {
        raus.push({ datei: name, zeile, grund: `${was} wird nie geschlossen.` })
        break
      }
      const danach = quelle.slice(bis + 1, bis + 60)
      if (!DANACH_ERLAUBT.test(danach)) {
        raus.push({
          datei: name,
          zeile: quelle.slice(0, bis).split('\n').length,
          grund:
            `Ein Backtick beendet ${was.toLowerCase()} zu frueh. Dahinter steht: ` +
            JSON.stringify(danach.slice(0, 40)),
        })
      }
      ab = bis + 1
    }
  }
  return raus
}

export function alleBefunde() {
  const raus = []
  for (const ort of ORTE) {
    for (const p of dateienUnter(join(WURZEL, ort))) {
      raus.push(...befundeIn(readFileSync(p, 'utf8'), relative(WURZEL, p)))
    }
  }
  return raus
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const b = alleBefunde()
  for (const x of b) console.log(`${x.datei}:${x.zeile}  ${x.grund}`)
  console.log(b.length === 0 ? 'Keine Backticks in Vorlagen.' : `${b.length} Befund(e).`)
  process.exitCode = b.length === 0 ? 0 : 1
}
