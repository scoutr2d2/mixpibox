/**
 * Die Regeln aus `dauer-text.ts` — geprüft an den Fällen, in denen ein Fehler
 * STILL bliebe.
 *
 * Der ganze Grund dieser Datei ist EIN Unterschied: „ich weiß es nicht" darf
 * nicht aussehen wie „es ist null". Beide alten Formatierer machten genau
 * diesen Fehler, und beide sahen dabei aus, als funktionierten sie — „0 min"
 * und „0 s" sind plausible Anzeigen. Ein Test, der nur `dauerText(600)` prüft,
 * hätte sie jahrelang durchgewunken.
 *
 * NICHT für Karma: reine Rechnerei, läuft über `npx tsx --test` (siehe
 * node_specs in tools/pruefen.sh). Die Verdrahtung in den beiden Seiten
 * steht daneben in `seiten/laufzeit-anzeige.spec.ts` — die prüft, dass die
 * Seiten diese Regeln auch WIRKLICH benutzen.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { dauerText, istDauer, textOderUnbekannt, UNBEKANNT } from './dauer-text'

describe('istDauer — null ist eine Auskunft, fehlend ist keine', () => {
  it('lässt 0 und positive Zahlen durch', () => {
    assert.equal(istDauer(0), true)
    assert.equal(istDauer(1), true)
    assert.equal(istDauer(268344), true)
  })

  it('weist ab, was keine Dauer ist', () => {
    assert.equal(istDauer(-1), false)
    assert.equal(istDauer(Number.NaN), false)
    assert.equal(istDauer(Number.POSITIVE_INFINITY), false)
    // `Math.max(...[])` ergibt genau das. Im Server steht heute ein
    // `uebrig.length ?` davor — der Wert kann also nur aus einer FREMDEN
    // Antwort kommen, und genau dagegen steht der Wächter.
    assert.equal(istDauer(Number.NEGATIVE_INFINITY), false)
    assert.equal(istDauer(undefined), false)
    assert.equal(istDauer(null), false)
    assert.equal(istDauer('42'), false)
  })
})

describe('dauerText — die gröbste Einheit, die noch etwas sagt', () => {
  it('nennt Sekunden, Minuten, Stunden, Tage', () => {
    assert.equal(dauerText(0), '0 s')
    assert.equal(dauerText(42), '42 s')
    assert.equal(dauerText(89), '89 s')
    assert.equal(dauerText(600), '10 min')
    assert.equal(dauerText(7200), '2 h')
    assert.equal(dauerText(259200), '3 Tage')
  })

  /**
   * DER FALL, WEGEN DEM ES DIESE DATEI GIBT. Vor dem 19.09.2026 stand hier
   * überall „0 s" — `Math.max(0, Number(x) || 0)` machte aus jedem dieser
   * fünf Werte eine glatte Null.
   */
  it('sagt „unbekannt", wo es nichts zu sagen gibt — statt „0 s"', () => {
    assert.equal(dauerText(-5), UNBEKANNT)
    assert.equal(dauerText(Number.NaN), UNBEKANNT)
    assert.equal(dauerText(Number.NEGATIVE_INFINITY), UNBEKANNT)
    assert.equal(dauerText(undefined), UNBEKANNT)
    assert.equal(dauerText(null), UNBEKANNT)
  })

  /**
   * UND SONST NICHTS: die Null selbst bleibt eine Auskunft. Ein Wächter, der
   * auch die 0 verschluckte, wäre der gegenteilige Fehler und liefe hier auf.
   */
  it('behält die echte Null als Auskunft', () => {
    assert.equal(dauerText(0), '0 s')
    assert.notEqual(dauerText(0), UNBEKANNT)
  })
})

describe('textOderUnbekannt — den Satz des Servers nehmen, nicht nachrechnen', () => {
  it('gibt den fertigen Satz UNVERÄNDERT weiter', () => {
    assert.equal(textOderUnbekannt('3 Tage, 2 h'), '3 Tage, 2 h')
    assert.equal(textOderUnbekannt('1 Tag, 0 h'), '1 Tag, 0 h')
    assert.equal(textOderUnbekannt('2 min'), '2 min')
    // Auch das Wort des Servers selbst geht durch, nicht in eine zweite Runde.
    assert.equal(textOderUnbekannt(UNBEKANNT), UNBEKANNT)
  })

  it('sagt „unbekannt", wenn gar kein Satz kam', () => {
    assert.equal(textOderUnbekannt(undefined), UNBEKANNT)
    assert.equal(textOderUnbekannt(null), UNBEKANNT)
    assert.equal(textOderUnbekannt(''), UNBEKANNT)
    assert.equal(textOderUnbekannt('   '), UNBEKANNT)
  })

  /**
   * UND SONST NICHTS: eine Zahl ist kein Satz. Käme hier `268344` an — weil
   * jemand das falsche Feld verdrahtet hat —, soll „unbekannt" dastehen und
   * nicht die nackte Sekundenzahl.
   */
  it('nimmt keine Zahl für einen Satz', () => {
    assert.equal(textOderUnbekannt(268344), UNBEKANNT)
    assert.equal(textOderUnbekannt(0), UNBEKANNT)
  })
})
