/**
 * Das Nachtfenster — dieselben Faelle wie `nachtmodusGilt` der
 * Aufnahme-Erweiterung, damit die zweite Fassung nicht still abweicht.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { nachtfensterGilt } from './nachtfenster'

const um = (h: number, m = 0) => new Date(2026, 8, 27, h, m)

describe('nachtfensterGilt', () => {
  it('ohne Schalter nie', () => {
    assert.equal(nachtfensterGilt({ nachtVon: '22:00', nachtBis: '06:00' }, um(23)), false)
    assert.equal(nachtfensterGilt({}, um(23)), false)
    assert.equal(nachtfensterGilt(null, um(23)), false)
  })

  it('ueber Mitternacht: Anfang zaehlt dazu, Ende nicht', () => {
    const e = { nachtmodus: true, nachtVon: '22:00', nachtBis: '06:00' }
    assert.equal(nachtfensterGilt(e, um(23)), true)
    assert.equal(nachtfensterGilt(e, um(3)), true)
    assert.equal(nachtfensterGilt(e, um(12)), false)
    assert.equal(nachtfensterGilt(e, um(21, 59)), false)
    assert.equal(nachtfensterGilt(e, um(22, 0)), true)
    assert.equal(nachtfensterGilt(e, um(6, 0)), false)
  })

  it('am Tag innerhalb eines Tages', () => {
    const e = { nachtmodus: true, nachtVon: '09:00', nachtBis: '11:00' }
    assert.equal(nachtfensterGilt(e, um(10)), true)
    assert.equal(nachtfensterGilt(e, um(12)), false)
  })

  it('ohne Zeitfenster sofort, mit unlesbarer Zeit nie', () => {
    assert.equal(nachtfensterGilt({ nachtmodus: true }, um(14)), true)
    assert.equal(nachtfensterGilt({ nachtmodus: true, nachtVon: '', nachtBis: '' }, um(14)), true)
    assert.equal(nachtfensterGilt({ nachtmodus: true, nachtVon: '22', nachtBis: '06:00' }, um(23)), false)
    assert.equal(nachtfensterGilt({ nachtmodus: true, nachtVon: '25:00', nachtBis: '06:00' }, um(23)), false)
  })
})
