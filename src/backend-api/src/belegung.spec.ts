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
    const v = b.anfordern(pool(3), 'mitschnitt', 'plugin')
    assert.equal(v.nr, 1)
    assert.equal(b.stand().length, 1)
    assert.equal(b.stand()[0].wer, 'plugin')
  })

  it('zwei Anforderungen bekommen VERSCHIEDENE Stroeme', () => {
    // Der eigentliche Grund, warum das Buch beim Wirt liegt: zwei Plugins
    // wuerden jedes fuer sich denselben freien Strom finden — und beide mit
    // demselben Zugang starten. `pruefen()` nennt genau das schwer.
    const b = new Belegungsbuch()
    const a1 = b.anfordern(pool(4), 'mitschnitt', 'a')
    const a2 = b.anfordern(pool(4), 'mitschnitt', 'b')
    assert.notEqual(a1.nr, a2.nr)
  })

  it('freigeben macht den Strom wieder verfuegbar', () => {
    const b = new Belegungsbuch()
    const v = b.anfordern(pool(2), 'mitschnitt', 'a')
    assert.equal(b.freigeben(v.marke as number), true)
    assert.equal(b.stand().length, 0)
    assert.equal(b.anfordern(pool(2), 'mitschnitt', 'b').nr, v.nr, 'derselbe ist wieder zu haben')
  })

  it('freigeben, was gar nicht belegt war, meldet false statt zu werfen', () => {
    assert.equal(new Belegungsbuch().freigeben(7), false)
  })

  it('DIE NUMMER IST KEIN AUSWEIS — der Verdraengte darf den Nachfolger nicht freigeben', () => {
    // Der Fall, an dem der erste Entwurf gescheitert ist: Arbeiter haelt
    // Strom 1, wird verdraengt, das Kind bekommt Strom 1. Meldet sich der
    // Arbeiter jetzt mit seiner alten Marke, darf NICHTS passieren.
    const b = new Belegungsbuch()
    const arbeiter = b.anfordern(pool(1), 'mitschnitt', 'arbeiter', 0)
    const kind = b.anfordern(pool(1), 'wiedergabe', 'kind')
    assert.equal(kind.nr, arbeiter.nr, 'dieselbe Nummer, andere Miete')
    assert.notEqual(kind.marke, arbeiter.marke)

    assert.equal(b.freigeben(arbeiter.marke as number), false, 'die alte Marke greift ins Leere')
    assert.equal(b.stand().length, 1, 'das Kind haelt seinen Strom')
    assert.equal(b.stand()[0].wer, 'kind')
  })

  describe('die Verdraengung', () => {
    it('nimmt dem juengsten Mitschnitt den Eintrag weg', () => {
      const u = uhrwerk()
      const b = new Belegungsbuch(u.lies)
      b.anfordern(pool(2), 'mitschnitt', 'alt')
      u.weiter(60_000)
      const jung = b.anfordern(pool(2), 'mitschnitt', 'jung', 0)
      u.weiter(60_000)

      const v = b.anfordern(pool(2), 'wiedergabe', 'kind')
      assert.equal(v.verdraengt, jung.nr)
      // UND ER IST WIRKLICH RAUS, nicht nur gemeldet: sonst haelt ihn ein
      // Halbzustand doppelt belegt.
      assert.equal(b.stand().filter((e) => e.wer === 'jung').length, 0)
      assert.equal(b.stand().filter((e) => e.wer === 'alt').length, 1, 'die aeltere Aufnahme laeuft weiter')
    })

    it('der Verdraengte erfaehrt es am Lebenszeichen', () => {
      // Das ist der Weg, auf dem ein laufender Arbeiter merkt, dass er weichen
      // soll — ohne dass ihn jemand aktiv abschiessen muss.
      const b = new Belegungsbuch()
      const m = b.anfordern(pool(1), 'mitschnitt', 'arbeiter', 0)
      assert.equal(b.lebenszeichen(m.marke as number), true)
      b.anfordern(pool(1), 'wiedergabe', 'kind')
      assert.equal(b.lebenszeichen(m.marke as number), false, 'er ist nicht mehr eingetragen')
    })
  })

  describe('die Frist — ein abgestuerzter Nehmer blockiert nicht ewig', () => {
    it('eine Mitschnitt-Belegung faellt nach ihrer Frist weg', () => {
      const u = uhrwerk()
      const b = new Belegungsbuch(u.lies)
      b.anfordern(pool(1), 'mitschnitt', 'abgestuerzt', 0)
      assert.equal(b.stand().length, 1)
      u.weiter(FRIST_MS.mitschnitt + 1)
      assert.equal(b.stand().length, 0, 'die Box haelt sich sonst fuer voll, obwohl sie leer ist')
    })

    it('ein Lebenszeichen verlaengert sie', () => {
      const u = uhrwerk()
      const b = new Belegungsbuch(u.lies)
      const v = b.anfordern(pool(1), 'mitschnitt', 'fleissig', 0)
      // Kurz vor Ablauf melden, dann nochmal fast so lange warten.
      u.weiter(FRIST_MS.mitschnitt - 1)
      assert.equal(b.lebenszeichen(v.marke as number), true)
      u.weiter(FRIST_MS.mitschnitt - 1)
      assert.equal(b.stand().length, 1, 'wer arbeitet, behaelt seinen Strom')
    })

    it('Hoeren haelt laenger als Mitschneiden — ein Nachmittag ist kein Titel', () => {
      const u = uhrwerk()
      const b = new Belegungsbuch(u.lies)
      b.anfordern(pool(2), 'wiedergabe', 'kind')
      b.anfordern(pool(2), 'mitschnitt', 'arbeiter', 0)
      u.weiter(FRIST_MS.mitschnitt + 1)
      const bleibt = b.stand()
      assert.equal(bleibt.length, 1)
      assert.equal(bleibt[0].fuer, 'wiedergabe')
    })

    it('aufraeumen gibt zurueck, WAS es geraeumt hat — sonst verschwindet es still', () => {
      const u = uhrwerk()
      const b = new Belegungsbuch(u.lies)
      b.anfordern(pool(1), 'mitschnitt', 'weg', 0)
      u.weiter(FRIST_MS.mitschnitt + 1)
      const raus = b.aufraeumen()
      assert.equal(raus.length, 1)
      assert.equal(raus[0].wer, 'weg')
    })
  })
})
