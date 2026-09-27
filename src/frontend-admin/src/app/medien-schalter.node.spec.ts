/**
 * Die Medien-Schalter — gepruefte Faelle, an denen ein Fehler STILL bliebe.
 *
 * Der Grund dieser Datei: ein FEHLENDES `verschmelzen` wird als AN angezeigt.
 * Bis 27.09.2026 legte das Umschalten es trotzdem auf `true` — der Schalter
 * blieb beim ersten Tipp an. Ein Test, der nur mit gesetzten Werten prueft,
 * haette das nie gesehen.
 *
 * NICHT für Karma: reine Rechnerei, läuft über `npx tsx --test` (siehe
 * node_specs in tools/pruefen.sh).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { schalterAus, umgelegt } from './medien-schalter'

describe('schalterAus — die Vorgaben der Box', () => {
  it('fehlendes verschmelzen ist AN, fehlende diskografie AUS', () => {
    assert.deepEqual(schalterAus({}), { verschmelzen: true, diskografie: false })
  })

  it('ausdruecklich gesetzte Werte gelten', () => {
    assert.deepEqual(schalterAus({ verschmelzen: false, diskografie: true }), {
      verschmelzen: false,
      diskografie: true,
    })
  })
})

describe('umgelegt — gegen dieselbe Vorgabe, gegen die angezeigt wird', () => {
  it('ein fehlendes verschmelzen (angezeigt AN) geht beim ersten Tipp AUS', () => {
    assert.equal(schalterAus(umgelegt({}, 'verschmelzen')).verschmelzen, false)
  })

  it('zweimal umlegen ist wieder der Ausgangsstand', () => {
    for (const feld of ['verschmelzen', 'diskografie'] as const) {
      const vorher = schalterAus({})[feld]
      assert.equal(schalterAus(umgelegt(umgelegt({}, feld), feld))[feld], vorher)
    }
  })

  it('laesst alle anderen Felder stehen', () => {
    const a = { verschmelzen: false, thema: 'wald', diskografie: true }
    assert.deepEqual(umgelegt(a, 'diskografie'), { verschmelzen: false, thema: 'wald', diskografie: false })
  })
})
