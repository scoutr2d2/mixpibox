/**
 * Zeugen fuer das BELEGUNGSBUCH (E74).
 *
 * DIE UHR STEHT STILL, bis ein Zeuge sie stellt. Fristen mit echten Sekunden
 * zu pruefen macht Zeugen langsam und unzuverlaessig, und meistens beides
 * ([[tests-duerfen-keine-zahlen-festnageln]] — hier wird die FRIST geprueft,
 * nicht die Zahl dahinter: sie kommt aus FRIST_MS und steht nirgends doppelt).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Belegungsbuch, FRIST_MS } from './belegung'
import type { Strom } from './stroeme'

function pool(n: number): Strom[] {
  return Array.from({ length: n }, (_, i) => ({
    nr: i + 1,
    zweck: 'wiedergabe' as const,
    maschine: 'soloist' as const,
    schluessel: 'spak_' + String(i).repeat(32).slice(0, 32),
    senke: '',
  }))
}

/** Eine Uhr, die nur geht, wenn man sie stellt. */
function uhrwerk(start = 1_000_000) {
  let jetzt = start
  return { lies: () => jetzt, weiter: (ms: number) => (jetzt += ms) }
}

describe('das Belegungsbuch — der Wirt fuehrt Buch', () => {
  it('traegt eine Zuteilung gleich ein', () => {
    const b = new Belegungsbuch()
    const v = b.anfordern(pool(3), 'wiedergabe', 'plugin')
    assert.equal(v.nr, 1)
    assert.equal(b.stand().length, 1)
    assert.equal(b.stand()[0].wer, 'plugin')
  })

  it('zwei Anforderungen bekommen VERSCHIEDENE Stroeme', () => {
    // Der eigentliche Grund, warum das Buch beim Wirt liegt: zwei Plugins
    // wuerden jedes fuer sich denselben freien Strom finden — und beide mit
    // demselben Zugang starten. `pruefen()` nennt genau das schwer.
    const b = new Belegungsbuch()
    const a1 = b.anfordern(pool(4), 'wiedergabe', 'a')
    const a2 = b.anfordern(pool(4), 'wiedergabe', 'b')
    assert.notEqual(a1.nr, a2.nr)
  })

  it('freigeben macht den Strom wieder verfuegbar', () => {
    const b = new Belegungsbuch()
    const v = b.anfordern(pool(2), 'wiedergabe', 'a')
    assert.equal(b.freigeben(v.marke as number), true)
    assert.equal(b.stand().length, 0)
    assert.equal(b.anfordern(pool(2), 'wiedergabe', 'b').nr, v.nr, 'derselbe ist wieder zu haben')
  })

  it('freigeben, was gar nicht belegt war, meldet false statt zu werfen', () => {
    assert.equal(new Belegungsbuch().freigeben(7), false)
  })

  it('DIE NUMMER IST KEIN AUSWEIS — der alte Halter darf den Nachfolger nicht freigeben', () => {
    // Der Fall, an dem der erste Entwurf gescheitert ist: A haelt Strom 1,
    // gibt ihn frei, B bekommt Strom 1. Meldet sich A jetzt mit seiner alten
    // Marke, darf NICHTS passieren.
    const b = new Belegungsbuch()
    const alt = b.anfordern(pool(1), 'wiedergabe', 'alt')
    assert.equal(b.freigeben(alt.marke as number), true)
    const neu = b.anfordern(pool(1), 'wiedergabe', 'neu')
    assert.equal(neu.nr, alt.nr, 'dieselbe Nummer, andere Miete')
    assert.notEqual(neu.marke, alt.marke)

    assert.equal(b.freigeben(alt.marke as number), false, 'die alte Marke greift ins Leere')
    assert.equal(b.lebenszeichen(alt.marke as number), false, 'und ihr Lebenszeichen auch')
    assert.equal(b.stand().length, 1, 'der neue Halter behaelt seinen Strom')
    assert.equal(b.stand()[0].wer, 'neu')
  })

  it('ist alles belegt, gibt es keinen Strom — und keine Marke', () => {
    const b = new Belegungsbuch()
    b.anfordern(pool(1), 'wiedergabe', 'a')
    const v = b.anfordern(pool(1), 'wiedergabe', 'b')
    assert.equal(v.nr, null)
    assert.equal(v.marke, null)
  })

  describe('die Frist — ein abgestuerzter Nehmer blockiert nicht ewig', () => {
    it('eine Belegung faellt nach ihrer Frist weg', () => {
      const u = uhrwerk()
      const b = new Belegungsbuch(u.lies)
      b.anfordern(pool(1), 'wiedergabe', 'abgestuerzt')
      assert.equal(b.stand().length, 1)
      u.weiter(FRIST_MS.wiedergabe + 1)
      assert.equal(b.stand().length, 0, 'die Box haelt sich sonst fuer voll, obwohl sie leer ist')
    })

    it('ein Lebenszeichen verlaengert sie', () => {
      const u = uhrwerk()
      const b = new Belegungsbuch(u.lies)
      const v = b.anfordern(pool(1), 'wiedergabe', 'fleissig')
      // Kurz vor Ablauf melden, dann nochmal fast so lange warten.
      u.weiter(FRIST_MS.wiedergabe - 1)
      assert.equal(b.lebenszeichen(v.marke as number), true)
      u.weiter(FRIST_MS.wiedergabe - 1)
      assert.equal(b.stand().length, 1, 'wer arbeitet, behaelt seinen Strom')
    })

    it('aufraeumen gibt zurueck, WAS es geraeumt hat — sonst verschwindet es still', () => {
      const u = uhrwerk()
      const b = new Belegungsbuch(u.lies)
      b.anfordern(pool(1), 'wiedergabe', 'weg')
      u.weiter(FRIST_MS.wiedergabe + 1)
      const raus = b.aufraeumen()
      assert.equal(raus.length, 1)
      assert.equal(raus[0].wer, 'weg')
    })
  })
})
