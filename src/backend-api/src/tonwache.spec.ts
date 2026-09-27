import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type Block, folgeWechsel, pegelAus, uebergaenge } from './tonwache'

/** Bloecke im 50-ms-Takt aus einer Pegelfolge bauen. */
const folge = (pegel: readonly number[], ab = 1000, takt = 50): Block[] =>
  pegel.map((p, i) => ({ zeit: ab + i * takt, pegel: p }))

const LAUT = 0.4
const STILL = 0.001

describe('uebergaenge', () => {
  it('erkennt einsetzenden Ton', () => {
    // 150 ms Ton noetig = 4 Bloecke à 50 ms (0, 50, 100, 150)
    const u = uebergaenge(folge([STILL, STILL, LAUT, LAUT, LAUT, LAUT]), false)
    assert.equal(u.length, 1)
    assert.equal(u[0].an, true)
  })

  it('erkennt verstummenden Ton', () => {
    const u = uebergaenge(folge([LAUT, STILL, STILL, STILL, STILL, STILL, STILL, STILL, STILL, STILL, STILL]), true)
    assert.equal(u.length, 1)
    assert.equal(u[0].an, false)
  })

  it('meldet den BEGINN der Stille, nicht deren Bestaetigung', () => {
    // Sonst zaehlt man die eigene Entprellung zur Reaktionszeit und macht die
    // Box um 400 ms langsamer, als sie ist.
    const b = folge([LAUT, STILL, STILL, STILL, STILL, STILL, STILL, STILL, STILL, STILL, STILL], 1000)
    const u = uebergaenge(b, true)
    assert.equal(u[0].zeit, 1050) // der erste STILLE Block, nicht der zehnte
  })

  it('haelt eine kurze Pause im Hoerspiel NICHT fuer einen Stopp', () => {
    // Ohne Entprellung waere jede Atempause ein "gestoppt".
    const u = uebergaenge(folge([LAUT, STILL, STILL, LAUT, LAUT, LAUT]), true)
    assert.deepEqual(u, [])
  })

  it('haelt einen einzelnen Knackser NICHT fuer Wiedergabe', () => {
    const u = uebergaenge(folge([STILL, LAUT, STILL, STILL, STILL]), false)
    assert.deepEqual(u, [])
  })

  it('erkennt mehrere Wechsel nacheinander', () => {
    const p = [
      LAUT, LAUT,
      ...Array(10).fill(STILL),
      ...Array(6).fill(LAUT),
    ]
    const u = uebergaenge(folge(p), true)
    assert.deepEqual(u.map((x) => x.an), [false, true])
  })

  it('meldet nichts, wenn sich nichts aendert', () => {
    assert.deepEqual(uebergaenge(folge([LAUT, LAUT, LAUT]), true), [])
    assert.deepEqual(uebergaenge(folge([STILL, STILL, STILL]), false), [])
  })

  it('kommt mit gar keinen Bloecken zurecht', () => {
    assert.deepEqual(uebergaenge([], false), [])
  })
})

describe('folgeWechsel', () => {
  const w = [
    { zeit: 900, an: false },
    { zeit: 1200, an: false },
    { zeit: 1500, an: true },
  ]

  it('nimmt den ersten Wechsel NACH dem Klick', () => {
    const r = folgeWechsel(1000, w)
    assert.equal(r?.ms, 200)
    assert.equal(r?.an, false)
  })

  it('ignoriert, was VOR dem Klick geschah - das kann nicht seine Folge sein', () => {
    const r = folgeWechsel(1300, w)
    assert.equal(r?.ms, 200) // der bei 1500, nicht der bei 1200
    assert.equal(r?.an, true)
  })

  it('schreibt einen viel spaeteren Wechsel NICHT mehr dem Klick zu', () => {
    // Sonst bekommt irgendwann jedes Verstummen einen alten Klick zugeordnet,
    // und es entstehen Zahlen, die niemand nachpruefen kann.
    assert.equal(folgeWechsel(1000, [{ zeit: 20000, an: false }], 8000), null)
  })

  it('meldet null, wenn gar nichts folgte', () => {
    assert.equal(folgeWechsel(9999, w), null)
  })
})

describe('pegelAus', () => {
  it('nimmt die Spitze, nicht den Mittelwert', () => {
    // Ein kurzer Einsatz soll sofort zaehlen; ein Mittelwert verschluckt ihn.
    const p = pegelAus(Int16Array.from([0, 0, 0, 16384, 0, 0]))
    assert.ok(p > 0.49 && p < 0.51, `Spitze erwartet, war ${p}`)
  })

  it('rechnet negative Ausschlaege mit', () => {
    assert.ok(pegelAus(Int16Array.from([-16384])) > 0.49)
  })

  it('meldet Stille als 0', () => {
    assert.equal(pegelAus(Int16Array.from([0, 0, 0])), 0)
  })
})
