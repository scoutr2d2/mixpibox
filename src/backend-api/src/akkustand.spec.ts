import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { feinerStand, profilAus, prozentAusSpannung, ruhespannung } from './akkustand'

/** Achims Pack: ENERpower Li-Ion 7,2 V / 10 Ah / 72 Wh, 2S2P. */
const ENERPOWER = { v_100: 8000, v_75: 7700, v_50: 7300, v_25: 6900, v_0: 6000 }

/** Die Konfiguration, wie sie auf der Box steht. */
const CONFIG = {
  battery_types: [
    { name: 'Ansmann 2S1P', config: { v_100: '8100', v_75: '7800', v_50: '7400', v_25: '7000', v_0: '6700' } },
    {
      name: 'ENERpower 2S2P 10.000mAh',
      config: { v_100: '8000', v_75: '7700', v_50: '7300', v_25: '6900', v_0: '6000' },
    },
    {
      name: 'USB-C mode (no battery)',
      config: { v_100: '1', v_75: '1', v_50: '1', v_25: '1', v_0: '1' },
    },
  ],
  selected_battery: 'ENERpower 2S2P 10.000mAh',
}

describe('profilAus', () => {
  it('findet das eingestellte Profil', () => {
    assert.deepEqual(profilAus(CONFIG), ENERPOWER)
  })

  it('findet es auch bei ungenauem Namen', () => {
    // Am Geraet stand "USB-C mode", die Liste fuehrt "USB-C mode (no battery)" -
    // ein exakter Vergleich fiel still durch, und niemand sah es.
    assert.deepEqual(profilAus({ ...CONFIG, selected_battery: 'enerpower 2s2p 10.000mAh' }), ENERPOWER)
    assert.deepEqual(profilAus({ ...CONFIG, selected_battery: 'ENERpower 2S2P' }), ENERPOWER)
  })

  it('das USB-C-Profil ist keine Kurve', () => {
    // Alle Punkte auf 1: daraus laesst sich nichts interpolieren. Dann ist
    // die grobe Stufe des Treibers die ehrlichere Antwort.
    assert.equal(profilAus({ ...CONFIG, selected_battery: 'USB-C mode' }), null)
  })

  it('ohne Liste oder ohne Treffer: nichts', () => {
    assert.equal(profilAus({}), null)
    assert.equal(profilAus(null), null)
    assert.equal(profilAus({ ...CONFIG, selected_battery: 'gibtesnicht' }), null)
  })
})

describe('prozentAusSpannung', () => {
  it('trifft die Stuetzpunkte genau', () => {
    assert.equal(prozentAusSpannung(8000, ENERPOWER), 100)
    assert.equal(prozentAusSpannung(7700, ENERPOWER), 75)
    assert.equal(prozentAusSpannung(7300, ENERPOWER), 50)
    assert.equal(prozentAusSpannung(6900, ENERPOWER), 25)
    assert.equal(prozentAusSpannung(6000, ENERPOWER), 0)
  })

  it('interpoliert dazwischen - das ist der ganze Zweck', () => {
    // Genau hier war der Treiber blind: 7300 bis 7699 mV war alles "50%".
    assert.equal(prozentAusSpannung(7500, ENERPOWER), 63)
    assert.equal(prozentAusSpannung(7400, ENERPOWER), 56)
    assert.equal(prozentAusSpannung(7600, ENERPOWER), 69)
  })

  it('rechnet STUECKWEISE, nicht linear ueber alles', () => {
    // Waere es linear von 6000..8000, ergaebe 7000 mV genau 50 %. Die Kurve
    // sagt aber 31 % - der flache Mittelteil traegt viel mehr Kapazitaet als
    // der steile untere Ast. Genau dieser Unterschied ist die Verbesserung.
    const linear = Math.round(((7000 - 6000) / (8000 - 6000)) * 100)
    assert.equal(linear, 50)
    assert.equal(prozentAusSpannung(7000, ENERPOWER), 31)
  })

  it('ausserhalb wird begrenzt, nicht extrapoliert', () => {
    assert.equal(prozentAusSpannung(8400, ENERPOWER), 100)
    assert.equal(prozentAusSpannung(5000, ENERPOWER), 0)
  })
})

describe('ruhespannung', () => {
  it('hebt beim Entladen an', () => {
    // Am Geraet gemessen: 7438 mV bei -623 mA. Unter Last liegt die
    // Klemmenspannung tiefer als in Ruhe.
    assert.equal(Math.round(ruhespannung(7438, -623)), 7482)
  })

  it('senkt beim Laden', () => {
    assert.equal(Math.round(ruhespannung(8100, 1500)), 7995)
  })

  it('ist gedeckelt - der Widerstand ist geschaetzt', () => {
    assert.ok(ruhespannung(7400, -20000) - 7400 <= 250)
    assert.ok(ruhespannung(7400, 20000) - 7400 >= -250)
  })

  it('ohne Strom aendert sich nichts', () => {
    assert.equal(ruhespannung(7400, 0), 7400)
  })
})

describe('feinerStand', () => {
  it('der echte Stand vom Geraet wird feiner', () => {
    // Der Treiber sagte "50%" - tatsaechlich sind es gut zwei Drittel des
    // Weges zur naechsten Stufe.
    // 7438 mV unter 623 mA Last -> rund 7482 mV in Ruhe; das liegt 45 % des
    // Weges von der 50-%- zur 75-%-Stuetzstelle, also 61 %.
    const p = feinerStand({ Vbat: 7438, Ibat: -623 }, CONFIG)
    assert.equal(p, 61)
  })

  it('ohne brauchbares Profil lieber nichts sagen', () => {
    assert.equal(feinerStand({ Vbat: 7438, Ibat: -623 }, { ...CONFIG, selected_battery: 'USB-C mode' }), null)
  })

  it('unsinnige Spannungen ergeben nichts', () => {
    assert.equal(feinerStand({ Vbat: 0 }, CONFIG), null)
    assert.equal(feinerStand({}, CONFIG), null)
    assert.equal(feinerStand([], CONFIG), null)
  })
})
