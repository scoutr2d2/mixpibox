import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { KEIN_STAND, standKennung } from './oberflaeche'

describe('standKennung', () => {
  it('nennt Buendel und Zeit', () => {
    assert.equal(standKennung(['main-abc.js'], 1700000000), 'main-abc.js|1700000000')
  })

  it('sortiert die Buendel, damit die Reihenfolge des Dateisystems nichts aendert', () => {
    // Sonst meldete derselbe Stand mal so, mal so - und die Box laedt neu,
    // ohne dass sich etwas geaendert hat.
    assert.equal(
      standKennung(['b.js', 'a.js'], 5),
      standKennung(['a.js', 'b.js'], 5),
    )
  })

  it('schneidet Bruchteile von Sekunden ab', () => {
    assert.equal(standKennung(['m.js'], 12.9), 'm.js|12')
  })

  it('haengt den Zaehler NICHT an, solange nie ein Neuladen angefordert wurde', () => {
    // Wichtig beim Einbau: haette das neue Feld die Kennung sofort veraendert,
    // haette jede laufende Box einmal grundlos neu geladen.
    assert.equal(standKennung(['m.js'], 7, 0), 'm.js|7')
  })

  it('aendert die Kennung, sobald ein Neuladen angefordert wird', () => {
    const vorher = standKennung(['m.js'], 7, 0)
    const nachher = standKennung(['m.js'], 7, 1)
    assert.notEqual(vorher, nachher)
  })

  it('aendert sie bei jedem weiteren Mal erneut', () => {
    // Zweimal aufraeumen muss zweimal wirken - ein Zaehler, der stehenbleibt,
    // laedt nur beim ersten Mal neu.
    assert.notEqual(standKennung(['m.js'], 7, 1), standKennung(['m.js'], 7, 2))
  })

  it('bleibt gleich, wenn sich nichts geaendert hat', () => {
    assert.equal(standKennung(['m.js'], 7, 3), standKennung(['m.js'], 7, 3))
  })

  it('meldet leer als leer - das heisst unbekannt, nicht neu', () => {
    assert.equal(KEIN_STAND, '')
  })
})
