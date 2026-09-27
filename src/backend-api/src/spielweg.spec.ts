import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Fund } from './plugin-vertrag'
import { spielAnfordern, type Werkzeuge, type ZeitUrteil } from './spielweg'

/**
 * Tests der einzigen Tuer.
 *
 * Alles kommt herein, deshalb steht hier keine Box, kein Worker und keine Uhr.
 * Was hier gruen ist, gilt um 19:31 an einem Sonntag genauso.
 *
 * DIE WICHTIGSTE FRAGE DIESER DATEI ist nicht „spielt es?", sondern: kommt der
 * Abspieldienst je zu Gesicht, wenn die Kinderzeit nein sagt? Deshalb zaehlt
 * jeder Test mit, WIE OFT `anDenSpieler` gerufen wurde.
 */

const frei: ZeitUrteil = { erlaubt: true, grund: 'frei', restMin: 30, fensterBis: '19:30', fensterAb: '07:00' }
const aus: ZeitUrteil = { erlaubt: false, grund: 'aufgebraucht', restMin: 0, fensterBis: '19:30', fensterAb: '07:00' }

const fund: Fund = { titel: { name: 'Folge 1' }, quelle: { art: 'strom', adresse: 'https://example.org/1.mp3' } }

/** Ein Satz Werkzeuge mit Zaehlern. `zeitFolge` gibt je Aufruf das naechste Urteil. */
function werkzeuge(o: Partial<Werkzeuge> & { zeitFolge?: ZeitUrteil[] } = {}) {
  const gerufen = { zeit: 0, aufgeloest: 0, gespielt: 0 }
  const folge = o.zeitFolge ?? [frei, frei]
  const w: Werkzeuge = {
    zeitStand: () => {
      const u = folge[Math.min(gerufen.zeit, folge.length - 1)]
      gerufen.zeit++
      return u
    },
    kannAufloesen: o.kannAufloesen ?? (() => true),
    aufloesen:
      o.aufloesen ??
      (async () => {
        gerufen.aufgeloest++
        return fund
      }),
    anDenSpieler:
      o.anDenSpieler ??
      (async () => {
        gerufen.gespielt++
      }),
    melden: () => {},
  }
  return { w, gerufen }
}

describe('spielAnfordern — der gute Weg', () => {
  it('spielt, wenn die Zeit es erlaubt', async () => {
    const { w, gerufen } = werkzeuge()
    const e = await spielAnfordern({ medienKennung: 'mupibox-podcast:4711', art: 'start' }, w)
    assert.equal(e.art, 'gespielt')
    assert.equal(gerufen.gespielt, 1)
  })
})

describe('spielAnfordern — die Kinderzeit', () => {
  it('weist ab, BEVOR das Plugin ueberhaupt gefragt wird', async () => {
    // Das ist der Punkt: eine abgelaufene Kinderzeit darf keine Anfrage an
    // einen fremden Dienst ausloesen, und die Absage muss sofort dastehen.
    let aufgeloest = 0
    const { w, gerufen } = werkzeuge({
      zeitFolge: [aus],
      aufloesen: async () => {
        aufgeloest++
        return fund
      },
    })
    const e = await spielAnfordern({ medienKennung: 'mupibox-podcast:4711', art: 'start' }, w)
    assert.equal(e.art, 'abgewiesen')
    assert.equal(aufgeloest, 0, 'das Plugin haette gar nicht gefragt werden duerfen')
    assert.equal(gerufen.gespielt, 0)
  })

  it('weist auch ab, wenn die Zeit WAEHREND des Aufloesens ablaeuft', async () => {
    // Zwischen den beiden Fragen liegen bis zu 8 s Netz. Genau dort schlaegt
    // das Zeitfenster zu — ohne die zweite Frage begaenne die Wiedergabe nach
    // dem Zubettgehen.
    const { w, gerufen } = werkzeuge({ zeitFolge: [frei, aus] })
    const e = await spielAnfordern({ medienKennung: 'mupibox-podcast:4711', art: 'start' }, w)
    assert.equal(e.art, 'abgewiesen')
    assert.equal(gerufen.gespielt, 0, 'der Abspieldienst darf nie gerufen worden sein')
    if (e.art === 'abgewiesen') assert.equal(e.urteil.grund, 'aufgebraucht')
  })

  it('gilt fuer `anhaengen` genauso wie fuer `start`', async () => {
    // Der Fehler, den ARD/ardqueue schon einmal gemacht hat: ein Anhaengen,
    // das die Grenze nicht kennt, fuellt die Warteschlange nach Feierabend auf.
    const { w, gerufen } = werkzeuge({ zeitFolge: [aus] })
    const e = await spielAnfordern({ medienKennung: 'mupibox-podcast:4711', art: 'anhaengen' }, w)
    assert.equal(e.art, 'abgewiesen')
    assert.equal(gerufen.gespielt, 0)
  })

  it('reicht den GRUND durch, damit die Box es dem Kind sagen kann', async () => {
    const { w } = werkzeuge({ zeitFolge: [{ ...aus, grund: 'zuSpaet' }] })
    const e = await spielAnfordern({ medienKennung: 'mupibox-podcast:4711', art: 'start' }, w)
    assert.equal(e.art, 'abgewiesen')
    if (e.art === 'abgewiesen') {
      assert.equal(e.urteil.grund, 'zuSpaet')
      assert.equal(e.urteil.fensterAb, '07:00')
    }
  })
})

describe('spielAnfordern — was schiefgehen kann', () => {
  it('macht aus einem scheiternden Plugin ein Ergebnis, keinen Wurf', async () => {
    const { w, gerufen } = werkzeuge({
      aufloesen: async () => {
        throw new Error('Feed nicht erreichbar')
      },
    })
    const e = await spielAnfordern({ medienKennung: 'mupibox-podcast:4711', art: 'start' }, w)
    assert.equal(e.art, 'gescheitert')
    if (e.art === 'gescheitert') assert.match(e.grund, /Feed nicht erreichbar/)
    assert.equal(gerufen.gespielt, 0)
  })

  it('weist Kennungen ab, die keinem Plugin gehoeren', async () => {
    const { w, gerufen } = werkzeuge({ kannAufloesen: () => false })
    const e = await spielAnfordern({ medienKennung: 'mupibox-podcast:4711', art: 'start' }, w)
    assert.equal(e.art, 'gescheitert')
    assert.equal(gerufen.zeit, 0, 'ohne Plugin braucht die Kinderzeit gar nicht gefragt zu werden')
  })

  it('weist Unsinn ab, ohne zu werfen', async () => {
    const { w } = werkzeuge()
    for (const k of ['', 'ohnedoppelpunkt', ':nix', 'MUPI:x']) {
      const e = await spielAnfordern({ medienKennung: k, art: 'start' }, w)
      assert.equal(e.art, 'gescheitert', `"${k}" haette scheitern muessen`)
    }
  })

  it('meldet einen toten Abspieldienst als gescheitert, nicht als gespielt', async () => {
    const { w } = werkzeuge({
      anDenSpieler: async () => {
        throw new Error('502')
      },
    })
    const e = await spielAnfordern({ medienKennung: 'mupibox-podcast:4711', art: 'start' }, w)
    assert.equal(e.art, 'gescheitert')
  })
})
