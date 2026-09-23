/**
 * Die Pruefung zu tools/vorlagen-backticks.mjs.
 *
 * ZWEI ZUSAGEN, und die zweite ist die wichtigere:
 *   1. Heute steht in keiner Vorlage ein Backtick.
 *   2. Wenn morgen einer darin steht, wird es gemeldet. Ohne einen erfundenen
 *      Fall zeigt Punkt 1 nur, dass der Baum sauber ist — nicht, dass das
 *      Werkzeug etwas taugt.
 *
 * AUFRUF
 *     node --test tools/vorlagen-backticks.test.mjs
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { alleBefunde, befundeIn } from './vorlagen-backticks.mjs'

/** Eine heile Vorlage, so wie die Seiten sie schreiben. */
const HEIL = [
  '@Component({',
  '  template: `',
  '    <h1>Medien</h1>',
  '    <!-- Ein Kommentar ohne Backtick, mit einem Pfad: scripts/x.sh -->',
  '    <button>Aufnehmen</button>',
  '  `,',
  '})',
].join('\n')

describe('befundeIn', () => {
  test('laesst eine heile Vorlage in Ruhe', () => {
    assert.deepEqual(befundeIn(HEIL), [])
  })

  test('meldet den Backtick im HTML-Kommentar — der echte Fall vom 03.08.2026', () => {
    // So sah es aus: ein Dateiname in Backticks, mitten in einer Begruendung.
    // Der Uebersetzer blieb still, die Seite verlor drei Viertel ihrer
    // Sucheintraege.
    const kaputt = HEIL.replace('scripts/x.sh', '`scripts/x.sh`')
    const b = befundeIn(kaputt, 'medien.ts')
    assert.equal(b.length, 1)
    assert.equal(b[0].datei, 'medien.ts')
    assert.match(b[0].grund, /zu frueh/)
  })

  test('meldet eine Vorlage, die nie geschlossen wird', () => {
    const b = befundeIn('@Component({\n  template: `\n    <h1>Ohne Ende</h1>\n')
    assert.equal(b.length, 1)
    assert.match(b[0].grund, /nie geschlossen/)
  })

  test('nennt die Zeile, in der es schiefgeht', () => {
    const kaputt = HEIL.replace('scripts/x.sh', '`scripts/x.sh`')
    assert.equal(befundeIn(kaputt)[0].zeile, 4)
  })

  test('kommt mit mehreren Bauteilen in einer Datei zurecht', () => {
    assert.deepEqual(befundeIn(`${HEIL}\n${HEIL}`), [])
  })
})

describe('der Stil-Block (seit 06.09.2026)', () => {
  test('findet den Backtick im styles-Literal — der Fall, an dem der Bau starb', () => {
    // Genau die Zeile, an der die Hand-Verschmelzung scheiterte: ein Kommentar
    // im styles-Literal nannte eine CSS-Eigenschaft in Backticks. Der Bau warf
    // acht unverstaendliche TypeScript-Fehler, die Wache meldete gruen.
    const quelle = [
      '@Component({',
      '  styles: `',
      '    /* die `max-width` haelt sie im Rahmen */',
      '    select { max-width: 20rem; }',
      '  `,',
      '  template: `<p>heil</p>`,',
      '})',
    ].join('\n')
    const b = befundeIn(quelle, 'probe.ts')
    assert.equal(b.length, 1, 'der Stil-Block muss beanstandet werden')
    assert.match(b[0].grund, /stil-block/i)
  })

  test('laesst einen heilen Stil-Block in Ruhe', () => {
    const quelle = '@Component({\n  styles: `select { max-width: 20rem; }`,\n  template: `<p>ok</p>`,\n})'
    assert.deepEqual(befundeIn(quelle, 'probe.ts'), [])
  })
})

describe('der ganze Baum', () => {
  test('keine Vorlage traegt einen Backtick', () => {
    const b = alleBefunde()
    assert.deepEqual(
      b,
      [],
      `Backtick in einer Vorlage:\n${b.map((x) => `  ${x.datei}:${x.zeile} ${x.grund}`).join('\n')}`,
    )
  })
})
