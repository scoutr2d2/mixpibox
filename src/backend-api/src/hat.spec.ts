import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hatAktiv, hatMisst } from './hat'

/** Ein echter Stand vom Geraet (Pi 5 am Akku, 2026-07-29). */
const ECHT = {
  Charger_Status: 'Not Charging',
  Vbat: 7472,
  Vbus: 0,
  Ibat: -623,
  IBus: 0,
  Temp: 29,
  BatteryConnected: 1,
  Bat_SOC: '50%',
  Bat_Stat: 'OK',
}

describe('hatMisst', () => {
  it('erkennt eine echte Messung', () => {
    assert.equal(hatMisst(ECHT), true)
  })

  it('die LEERE Liste ist keine Messung', () => {
    // Genau das stand am Geraet in /tmp/mupihat.json, waehrend der
    // Leser-Dienst wegen des fehlenden Moduls smbus2 gescheitert war.
    // Ein Symbol auf dieser Grundlage waere gelogen.
    assert.equal(hatMisst([]), false)
    assert.equal(hatMisst({}), false)
    assert.equal(hatMisst(null), false)
    assert.equal(hatMisst(undefined), false)
  })

  it('unsinnige Spannungen zaehlen nicht', () => {
    // Kein Pack, sondern Messfehler oder ein Baustein ohne Akku.
    assert.equal(hatMisst({ ...ECHT, Vbat: 0 }), false)
    assert.equal(hatMisst({ ...ECHT, Vbat: 1500 }), false)
    assert.equal(hatMisst({ ...ECHT, Vbat: 24000 }), false)
    assert.equal(hatMisst({ ...ECHT, Vbat: 'kaputt' }), false)
  })

  it('ein fast leerer 2S-Pack zaehlt sehr wohl', () => {
    // Gerade DANN will man das Symbol sehen.
    assert.equal(hatMisst({ ...ECHT, Vbat: 6100, Bat_SOC: '5%' }), true)
  })
})

describe('hatAktiv', () => {
  it('gesetzter Schalter genuegt, auch ohne Messung', () => {
    // Eine Box, die den Schalter bewusst an hat, verliert nichts.
    assert.equal(hatAktiv(true, []), true)
  })

  it('eine echte Messung genuegt, auch ohne Schalter', () => {
    // Der eigentliche Zweck: der Schalter steht in ZWEI Dateien und laeuft
    // auseinander - die Platine luegt nicht.
    assert.equal(hatAktiv(false, ECHT), true)
    assert.equal(hatAktiv(undefined, ECHT), true)
  })

  it('ohne beides kein Symbol', () => {
    assert.equal(hatAktiv(false, []), false)
    assert.equal(hatAktiv(undefined, undefined), false)
  })
})
