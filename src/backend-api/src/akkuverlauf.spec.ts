import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MIN_ABSTAND_MS,
  abschnitte,
  anhaengen,
  ausduennen,
  bereinigen,
  hochrechnen,
  aufkleberKapazitaet,
  kapazitaetAus,
  punktAus,
  spanne,
} from './akkuverlauf'

const T0 = 1_800_000_000_000
const min = (n: number) => T0 + n * 60_000
/** Ein Punkt, kurz geschrieben: Minute, Prozent, Strom. */
const p = (m: number, proz: number, i: number) => ({ t: min(m), v: 7400, i, p: proz })

describe('punktAus', () => {
  it('nimmt den FEINEN Ladestand, wenn die Box einen liefert', () => {
    const q = punktAus({ Vbat: 7438, Ibat: -623, Bat_SOC: '50%', Bat_SOC_fein: 61 }, T0)
    assert.deepEqual(q, { t: T0, v: 7438, i: -623, p: 61 })
  })

  it('faellt sonst auf die grobe Stufe zurueck', () => {
    assert.equal(punktAus({ Vbat: 7438, Ibat: -623, Bat_SOC: '50%' }, T0)?.p, 50)
  })

  it('lieber eine LUECKE als eine erfundene Null', () => {
    // Eine 0 in der Reihe saehe spaeter aus wie ein leerer Akku.
    assert.equal(punktAus({ Vbat: 0, Bat_SOC: '50%' }, T0), null)
    assert.equal(punktAus({ Vbat: 7400 }, T0), null)
    assert.equal(punktAus([], T0), null)
    assert.equal(punktAus(null, T0), null)
  })
})

describe('anhaengen', () => {
  it('haengt an', () => {
    assert.equal(anhaengen([], p(0, 50, -600)).length, 1)
  })

  it('verwirft, was zu dicht am letzten liegt', () => {
    // Der Abfragetakt der Oberflaeche darf die Aufzeichnung nicht bestimmen.
    const r = anhaengen([p(0, 50, -600)], { t: min(0) + 1000, v: 7400, i: -600, p: 50 })
    assert.equal(r.length, 1)
  })

  it('nimmt es nach dem Mindestabstand an', () => {
    const r = anhaengen([p(0, 50, -600)], { t: min(0) + MIN_ABSTAND_MS, v: 7400, i: -600, p: 50 })
    assert.equal(r.length, 2)
  })

  it('haelt die Obergrenze und wirft die aeltesten weg', () => {
    let r = [p(0, 100, -600), p(1, 99, -600), p(2, 98, -600)]
    r = anhaengen(r, p(3, 97, -600), { maxPunkte: 3, minAbstandMs: 0 })
    assert.equal(r.length, 3)
    assert.equal(r[0].p, 99)
    assert.equal(r[2].p, 97)
  })

  it('ein Punkt aus der Vergangenheit landet nicht in der Reihe', () => {
    // Nach einem Zeitsprung (die Box hat keine gepufferte Uhr) waere die
    // Reihe sonst durcheinander und jede Kurve Unsinn.
    const r = anhaengen([p(10, 50, -600)], p(1, 50, -600))
    assert.equal(r.length, 1)
  })
})

describe('bereinigen', () => {
  it('wirft Punkte aus der Zukunft weg und sortiert', () => {
    const roh = [p(5, 50, -600), p(1, 55, -600), { t: min(99999), v: 7400, i: 0, p: 50 }]
    const r = bereinigen(roh, min(10))
    assert.equal(r.length, 2)
    assert.ok(r[0].t < r[1].t)
  })
})

describe('spanne', () => {
  it('gibt nur die letzten Stunden', () => {
    const reihe = [p(0, 90, -600), p(60, 80, -600), p(120, 70, -600)]
    assert.equal(spanne(reihe, 1, min(120)).length, 2)
  })
})

describe('abschnitte', () => {
  it('trennt Laden von Entladen', () => {
    const reihe = [p(0, 30, 1500), p(1, 40, 1500), p(2, 50, 1500), p(3, 49, -700), p(4, 48, -700)]
    const a = abschnitte(reihe)
    assert.equal(a.length, 2)
    assert.equal(a[0].art, 'laden')
    assert.deepEqual([a[0].vonProzent, a[0].bisProzent], [30, 50])
    assert.equal(a[1].art, 'entladen')
  })

  it('erkennt Ruhe als eigenen Abschnitt', () => {
    const a = abschnitte([p(0, 80, 0), p(1, 80, 5), p(2, 80, -3)])
    assert.equal(a.length, 1)
    assert.equal(a[0].art, 'ruhe')
  })

  it('ein einzelner Ausreisser beendet nichts', () => {
    // Der Strom schwankt bei jedem Titelwechsel. Ohne diese Beruhigung
    // zerfiele eine Nacht am Ladegeraet in hundert Schnipsel.
    const reihe = [p(0, 30, 1500), p(1, 40, 1500), p(2, 45, 0), p(3, 50, 1500), p(4, 55, 1500)]
    const a = abschnitte(reihe)
    assert.equal(a.length, 2)
    assert.ok(a.every((x) => x.art === 'laden'))
  })

  it('eine leere Reihe ergibt nichts', () => {
    assert.deepEqual(abschnitte([]), [])
  })
})

describe('hochrechnen', () => {
  it('rechnet die Restzeit beim Entladen', () => {
    // 10 Ah, 50 % voll, 600 mA -> gut acht Stunden.
    assert.equal(hochrechnen(p(0, 50, -600), 10000), 500)
  })

  it('rechnet die Zeit bis voll beim Laden', () => {
    // 10 Ah, 50 % voll, 2000 mA -> zweieinhalb Stunden.
    assert.equal(hochrechnen(p(0, 50, 2000), 10000), 150)
  })

  it('bei Ruhe oder ohne Kapazitaet: keine Aussage', () => {
    assert.equal(hochrechnen(p(0, 50, 0), 10000), null)
    assert.equal(hochrechnen(p(0, 50, -600), null), null)
    assert.equal(hochrechnen(undefined, 10000), null)
  })
})

describe('kapazitaetAus', () => {
  it('liest die Kapazitaet aus dem Profilnamen', () => {
    assert.equal(kapazitaetAus('ENERpower 2S2P 10.000mAh'), 10000)
    assert.equal(kapazitaetAus('Ansmann 2600 mAh'), 2600)
  })

  it('ohne Zahl im Namen: nichts, statt zu raten', () => {
    assert.equal(kapazitaetAus('Ansmann 2S1P'), null)
    assert.equal(kapazitaetAus(undefined), null)
  })
})

describe('aufkleberKapazitaet', () => {
  it('die eingetragene Zahl schlaegt den Namens-Behelf', () => {
    assert.equal(
      aufkleberKapazitaet({ selected_battery: 'ENERpower 2S2P 10.000mAh', battery_capacity_mah: 9500 }),
      9500,
    )
  })

  it('ohne Zahl gilt der Name, ohne beides nichts', () => {
    assert.equal(aufkleberKapazitaet({ selected_battery: 'ENERpower 2S2P 10.000mAh' }), 10000)
    assert.equal(aufkleberKapazitaet({ selected_battery: 'Ansmann 2S1P' }), null)
    assert.equal(aufkleberKapazitaet(null), null)
  })

  it('Unsinn zaehlt nicht als Aufkleber (unter 100, ueber 100000, NaN)', () => {
    assert.equal(aufkleberKapazitaet({ selected_battery: 'Ansmann 2S1P', battery_capacity_mah: 5 }), null)
    assert.equal(aufkleberKapazitaet({ selected_battery: 'Ansmann 2S1P', battery_capacity_mah: 999999 }), null)
    assert.equal(aufkleberKapazitaet({ selected_battery: 'Custom', battery_capacity_mah: 'zehn' }), null)
  })
})

describe('ausduennen', () => {
  it('rafft auf die gewuenschte Zahl', () => {
    const reihe = Array.from({ length: 1000 }, (_, i) => p(i, 100 - i / 10, -600))
    assert.equal(ausduennen(reihe, 100).length, 100)
  })

  it('behaelt IMMER den letzten Punkt - er ist der aktuelle Stand', () => {
    const reihe = Array.from({ length: 1000 }, (_, i) => p(i, 100 - i / 10, -600))
    const d = ausduennen(reihe, 7)
    assert.equal(d[d.length - 1].t, reihe[reihe.length - 1].t)
  })

  it('kurze Reihen bleiben unangetastet', () => {
    const reihe = [p(0, 50, -600), p(1, 49, -600)]
    assert.deepEqual(ausduennen(reihe, 100), reihe)
  })
})
