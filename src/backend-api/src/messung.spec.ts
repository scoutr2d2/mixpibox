import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type Messung, PUFFER_MAX, ab, anhaengen, istMessung, regel } from './messung'

const m = (art: string, ms: number | null = 100): Messung => ({ art, ms })

describe('istMessung', () => {
  it('nimmt eine gueltige Messung an', () => {
    assert.equal(istMessung({ art: 'Kachel', ms: 120 }), true)
  })

  it('nimmt auch eine ohne beobachtete Reaktion an', () => {
    // null heisst "nichts gesehen" - das ist ein Befund, kein Fehler.
    assert.equal(istMessung({ art: 'Kachel', ms: null }), true)
  })

  it('verwirft Fremdes, statt es zu speichern', () => {
    // Eine kaputte Zeile im Puffer verdirbt jede spaetere Auswertung.
    for (const x of [null, 'text', 42, {}, { art: '' }, { art: '  ', ms: 1 }]) {
      assert.equal(istMessung(x), false, JSON.stringify(x))
    }
  })

  it('verwirft unsinnige Zeiten', () => {
    assert.equal(istMessung({ art: 'K', ms: -5 }), false)
    assert.equal(istMessung({ art: 'K', ms: Number.NaN }), false)
    assert.equal(istMessung({ art: 'K', ms: 'schnell' }), false)
  })
})

describe('anhaengen', () => {
  it('vergibt fortlaufende Nummern', () => {
    const r = anhaengen([], [m('Kachel'), m('Titelzeile')], 1)
    assert.deepEqual(r.puffer.map((x) => x.nr), [1, 2])
    assert.equal(r.naechsteNr, 3)
  })

  it('zaehlt ueber mehrere Sendungen hinweg weiter', () => {
    const a = anhaengen([], [m('A')], 1)
    const b = anhaengen(a.puffer, [m('B')], a.naechsteNr)
    assert.deepEqual(b.puffer.map((x) => x.nr), [1, 2])
  })

  it('vergibt die Nummer selbst, auch wenn die Oberflaeche eine mitschickt', () => {
    // Zwei Fenster (Kiosk + Browser am Schreibtisch) lieferten sonst gleiche
    // Nummern, und der Abholer verlaesst sich auf steigende.
    const r = anhaengen([], [{ art: 'K', ms: 1, nr: 99 }], 1)
    assert.equal(r.puffer[0].nr, 1)
  })

  it('verwirft Fremdes beim Anhaengen', () => {
    const r = anhaengen([], [m('gut'), { kaputt: true } as unknown as Messung], 1)
    assert.equal(r.puffer.length, 1)
    assert.equal(r.puffer[0].art, 'gut')
  })

  it('begrenzt den Puffer und wirft das Aelteste weg', () => {
    let p: Messung[] = []
    let nr = 1
    for (let i = 0; i < PUFFER_MAX + 20; i++) {
      const r = anhaengen(p, [m(`nr${i}`)], nr)
      p = r.puffer
      nr = r.naechsteNr
    }
    assert.equal(p.length, PUFFER_MAX)
    assert.equal(p[p.length - 1].art, `nr${PUFFER_MAX + 19}`)
  })

  it('laesst den uebergebenen Puffer unveraendert', () => {
    const alt: Messung[] = [{ art: 'A', ms: 1, nr: 1 }]
    anhaengen(alt, [m('B')], 2)
    assert.equal(alt.length, 1)
  })
})

describe('ab', () => {
  it('liefert nur das Neue', () => {
    const r = anhaengen([], [m('A'), m('B'), m('C')], 1)
    assert.deepEqual(ab(r.puffer, 1).map((x) => x.art), ['B', 'C'])
  })

  it('liefert alles bei 0', () => {
    const r = anhaengen([], [m('A')], 1)
    assert.equal(ab(r.puffer, 0).length, 1)
  })

  it('liefert nichts, wenn der Abholer schon alles hat', () => {
    const r = anhaengen([], [m('A')], 1)
    assert.equal(ab(r.puffer, 99).length, 0)
  })
})

describe('regel', () => {
  it('leitet aus weniger als drei Werten KEINE Regel ab', () => {
    // Ein Einzelwert sah hier schon einmal nach einem Befund aus und war
    // in Wahrheit der Anlauf.
    const r = regel([100, 120])
    assert.equal(r?.anzahl, 2)
    assert.equal(r?.median, null)
  })

  it('nimmt den Median, nicht den Durchschnitt', () => {
    // 5000 ist ein Ausreisser; der Durchschnitt waere ueber 1000.
    const r = regel([100, 110, 120, 130, 5000])
    assert.equal(r?.median, 120)
  })

  it('nennt ein Band, in dem die Werte liegen', () => {
    const r = regel([100, 110, 120, 130, 140])
    assert.equal(r?.von, 100)
    assert.equal(r?.bis, 140)
  })

  it('laesst Nicht-Messungen aussen vor', () => {
    const r = regel([100, null, 110, null, 120])
    assert.equal(r?.anzahl, 3)
  })

  it('kommt mit gar keinen Werten zurecht', () => {
    const r = regel([null, null])
    assert.equal(r?.anzahl, 0)
    assert.equal(r?.median, null)
  })
})
