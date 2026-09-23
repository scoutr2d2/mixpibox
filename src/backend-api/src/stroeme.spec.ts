/**
 * Tests der Stroeme (E72).
 *
 * DER FALL, DER DEN GANZEN TEST TRAEGT, ist nicht die Nummerierung, sondern:
 * ZWEI STROEME MIT DEMSELBEN ZUGANG. Ein Spotify-Konto spielt genau einen
 * Strom; der zweite nimmt dem ersten die Wiedergabe weg. Fuer ein Kind heisst
 * das: die Musik hoert mitten im Stueck auf, ohne dass jemand etwas getan hat
 * — und niemand kommt auf die Idee, das in einer Konfigurationsdatei zu suchen.
 *
 * DER ZWEITE FALL IST DER, DER FAST PASSIERT WAERE. Am 20.08.2026 stand eine
 * Weile der PLATZHALTER `SPAK_HIER_EINSETZEN` als zweiter Schluessel in der
 * Konfiguration. Er ist VERSCHIEDEN vom echten — jede Gleichheitspruefung
 * haette „zwei Konten" gemeldet und gruen gezeigt. Verraten hat ihn erst die
 * Laenge: 19 statt 37. Deshalb prueft dieses Modul die FORM, nicht nur die
 * Verschiedenheit.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  datenOrdner,
  geraetename,
  istSchluessel,
  type Belegung,
  klangWort,
  pruefen,
  STROEME_HOECHSTENS,
  type Stroeme,
  vergeben,
  STROEME_LEER,
  stroemeAus,
  stromAus,
  vorgabe,
} from './stroeme'

// Zwei Schluessel in der ECHTEN Form: spak_ und 32 Zeichen. Erfunden, aber
// formgleich — an einem zu kurzen liesse sich die Formpruefung nicht zeigen.
const A = 'spak_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const B = 'spak_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const PLATZHALTER = 'SPAK_HIER_EINSETZEN'

function zwei(schluesselB = B) {
  return stroemeAus({
    stroeme: [
      { nr: 1, zweck: 'wiedergabe', maschine: 'soloist', schluessel: A, senke: 'bluez_output.AA.1' },
      { nr: 2, zweck: 'mitschnitt', maschine: 'soloist', schluessel: schluesselB, senke: 'bluez_output.BB.1' },
    ],
  })
}

describe('der Schluessel', () => {
  it('erkennt die echte Form: spak_ und 32 Zeichen', () => {
    assert.equal(istSchluessel(A), true)
  })

  it('ERKENNT DEN PLATZHALTER — er ist verschieden, aber kein Schluessel', () => {
    // Genau der Fall vom 20.08.2026. Eine Gleichheitspruefung haette gruen
    // gezeigt, weil er sich vom echten unterscheidet.
    assert.equal(istSchluessel(PLATZHALTER), false)
    assert.equal(PLATZHALTER.length, 19, 'die Laenge war das, was ihn verriet')
  })

  it('nimmt nichts an, was nur so aussieht', () => {
    for (const x of ['spak_kurz', `${A}x`, 'nospak_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '', null, 42]) {
      assert.equal(istSchluessel(x), false, String(x))
    }
  })
})

describe('DER FALL, WEGEN DEM ES DIE PRUEFUNG GIBT: derselbe Zugang zweimal', () => {
  it('meldet ihn als SCHWEREN Befund', () => {
    const b = pruefen(zwei(A))
    const treffer = b.filter((x) => x.was.includes('denselben Zugang'))
    assert.equal(treffer.length, 1)
    assert.deepEqual(treffer[0].nr, [1, 2])
    assert.equal(treffer[0].schwer, true)
  })

  it('meldet ihn NICHT, wenn die Zugaenge verschieden sind', () => {
    assert.deepEqual(
      pruefen(zwei()).filter((x) => x.was.includes('denselben Zugang')),
      [],
    )
  })

  it('meldet den Platzhalter, obwohl er verschieden ist', () => {
    // Der eigentliche Wert dieser Pruefung: sie faellt NICHT auf die
    // Verschiedenheit herein.
    const b = pruefen(zwei(PLATZHALTER))
    assert.deepEqual(
      b.filter((x) => x.was.includes('denselben Zugang')),
      [],
      'verschieden sind sie ja',
    )
    const form = b.filter((x) => x.was.includes('Platzhalter'))
    assert.equal(form.length, 1)
    assert.equal(form[0].schwer, true)
    assert.ok(form[0].was.includes('19 Zeichen'), form[0].was)
  })
})

describe('weitere Befunde', () => {
  it('Soloist ohne Schluessel startet nicht', () => {
    const b = pruefen(stroemeAus({ stroeme: [{ nr: 1, maschine: 'soloist', schluessel: '' }] }))
    assert.equal(b.length, 1)
    assert.equal(b[0].schwer, true)
  })

  it('librespot BRAUCHT keinen — das ist kein Mangel', () => {
    const b = pruefen(stroemeAus({ stroeme: [{ nr: 1, maschine: 'librespot', schluessel: '' }] }))
    assert.deepEqual(b, [])
  })

  it('librespot MIT Schluessel ist ein Missverstaendnis, kein Fehler', () => {
    const b = pruefen(stroemeAus({ stroeme: [{ nr: 1, maschine: 'librespot', schluessel: A }] }))
    assert.equal(b.length, 1)
    assert.equal(b[0].schwer, false, 'es spielt trotzdem richtig')
  })

  it('dasselbe Tonziel zweimal ist nicht schwer, aber es gehoert gesagt', () => {
    const a = stroemeAus({
      stroeme: [
        { nr: 1, maschine: 'soloist', schluessel: A, senke: 'gleich' },
        { nr: 2, maschine: 'soloist', schluessel: B, senke: 'gleich' },
      ],
    })
    const b = pruefen(a).filter((x) => x.was.includes('liegt der eine Strom ueber dem anderen'))
    assert.equal(b.length, 1)
    assert.equal(b[0].schwer, false)
  })

  it('eine saubere Aufstellung hat gar keinen Befund', () => {
    assert.deepEqual(pruefen(zwei()), [])
  })
})

describe('der Geraetename', () => {
  it('ist <Boxname> Stream <n> — ohne den Zweck', () => {
    const a = zwei()
    assert.equal(geraetename(a.stroeme[0], 'MixPiBox'), 'MixPiBox Stream 1')
    assert.equal(geraetename(a.stroeme[1], 'MixPiBox'), 'MixPiBox Stream 2')
  })

  it('NENNT DEN MITSCHNITT NICHT BEIM NAMEN', () => {
    // Der Name geht an Spotify. Ein Geraet namens „Mitschnitt" sagt dem Dienst
    // woertlich, was es tut.
    const name = geraetename(zwei().stroeme[1], 'MixPiBox')
    assert.equal(name.toLowerCase().includes('mitschnitt'), false, name)
  })

  it('folgt dem Boxnamen — dort gehoert die Boxnummer hin', () => {
    assert.equal(geraetename(zwei().stroeme[0], 'MixPiBox_2'), 'MixPiBox_2 Stream 1')
  })

  it('erfindet einen Namen, wenn keiner dasteht', () => {
    assert.equal(geraetename(zwei().stroeme[0], ''), 'MuPiBox Stream 1')
  })
})

describe('Einlesen', () => {
  it('sortiert nach Nummer und haelt jede nur einmal', () => {
    const a = stroemeAus({
      stroeme: [
        { nr: 2, schluessel: B },
        { nr: 1, schluessel: A },
        { nr: 2, schluessel: 'zweit' },
      ],
    })
    assert.deepEqual(
      a.stroeme.map((s) => s.nr),
      [1, 2],
    )
    assert.equal(a.stroeme[1].schluessel, B, 'die erste Nummer 2 gilt')
  })

  it('weist einen Strom ohne brauchbare Nummer ab', () => {
    for (const x of [{ nr: 0 }, { nr: -1 }, { nr: 1.5 }, { nr: 'eins' }, {}]) {
      assert.equal(stromAus(x), null, JSON.stringify(x))
    }
  })

  it('erfindet keinen Zweck und keine Maschine', () => {
    const s = stromAus({ nr: 1, zweck: 'zauberei', maschine: 'zauberei' })
    assert.equal(s?.zweck, 'wiedergabe')
    assert.equal(s?.maschine, 'soloist')
  })

  it('ueberlebt Muell', () => {
    for (const x of [null, undefined, 42, 'text', {}, { stroeme: 'nein' }]) {
      assert.deepEqual(stroemeAus(x), STROEME_LEER)
    }
  })
})

describe('die Vorgabe — eine bestehende Box aendert sich NICHT', () => {
  it('ist genau ein Strom fuer die Wiedergabe', () => {
    const a = vorgabe(A)
    assert.equal(a.stroeme.length, 1)
    assert.equal(a.stroeme[0].nr, 1)
    assert.equal(a.stroeme[0].zweck, 'wiedergabe')
    assert.deepEqual(pruefen(a), [], 'und sie hat keinen Befund')
  })

  it('traegt auch eine librespot-Box ohne Schluessel', () => {
    assert.deepEqual(pruefen(vorgabe('', 'librespot')), [])
  })

  it('haelt Zwecke auseinander — der Mitschnitt ist einer, die Wiedergabe der andere', () => {
    // Hieraus las frueher `fuerZweck()` (gefallen am 19.09.2026, Rang 7 —
    // kein Aufrufer ausser diesem Zeugen). Die ZUSICHERUNG bleibt: eine
    // Aufstellung mit zwei Stroemen traegt genau einen Mitschnitt, die
    // Vorgabe einer gewoehnlichen Box keinen.
    assert.equal(zwei().stroeme.filter((s) => s.zweck === 'mitschnitt').length, 1)
    assert.equal(vorgabe(A).stroeme.filter((s) => s.zweck === 'mitschnitt').length, 0)
  })
})

describe('der Datenordner — wo die Anmeldung je Strom liegt', () => {
  it('Strom 1 liegt bei soloist.service, nicht nach seiner Nummer', () => {
    // Die StateDirectory=soloist der Unit macht daraus /var/lib/soloist. Wer
    // hier stur nach Nummer rechnet, zeigt den Kopplungszustand eines Ordners
    // an, den es nicht gibt — und meldet „nicht gekoppelt" fuer den Strom, der
    // als einziger sicher gekoppelt ist.
    assert.equal(datenOrdner(vorgabe(A).stroeme[0]), '/var/lib/soloist')
  })

  it('jeder weitere Strom bekommt seinen Ordner nach der Nummer', () => {
    assert.equal(datenOrdner(zwei().stroeme[1]), '/var/lib/mixpi-strom-2')
  })

  it('zwei Stroeme teilen sich NIE einen Ordner — sonst teilten sie die Anmeldung', () => {
    const a = zwei().stroeme
    assert.notEqual(datenOrdner(a[0]), datenOrdner(a[1]))
  })
})

describe('das Klangwort — was der Strom liefert, und ob es eine Wahl gibt', () => {
  it('Soloist ist verlustfrei und hat NICHTS zu waehlen', () => {
    // Gemessen am 21.08.2026 an der vollstaendigen Schalterliste von
    // `soloist --help`: kein --bitrate, kein --quality, kein --format.
    const k = klangWort(vorgabe(A).stroeme[0])
    assert.equal(k.wort, 'verlustfrei')
    assert.equal(k.waehlbar, false)
  })

  it('librespot nennt die gemessene Zahl, wenn eine mitkommt', () => {
    const s = vorgabe('', 'librespot').stroeme[0]
    assert.equal(klangWort(s, 160).wort, '160 kbps')
    assert.equal(klangWort(s, 320).wort, '320 kbps')
    assert.equal(klangWort(s, 160).waehlbar, true)
  })

  it('librespot ERFINDET keine Zahl, wenn keine gemessen wurde', () => {
    // Der Satz „Ton mit 160 kbps" stand bis zum 21.08.2026 fest in der
    // Vorlage. Er stimmte zufaellig. Eine Zahl ohne Quelle ist keine Angabe.
    const s = vorgabe('', 'librespot').stroeme[0]
    assert.equal(klangWort(s, null).wort, 'kbps unbekannt')
    assert.equal(klangWort(s).wort, 'kbps unbekannt')
    assert.equal(klangWort(s, 0).wort, 'kbps unbekannt')
  })
})

describe('die Hoechstzahl — so viele Konten gibt der Tarif her', () => {
  // MIT `as const`, sonst weitet TypeScript die Literale auf `string` und der
  // Aufbau passt nicht mehr auf `Stroeme`. Aufgefallen erst beim Bau: `tsx`
  // FUEHRT AUS, `tsc` PRUEFT — ein gruener Testlauf ist kein gruener Bau.
  function viele(n: number): Stroeme {
    return {
      stroeme: Array.from({ length: n }, (_, i) => ({
        nr: i + 1,
        zweck: 'wiedergabe' as const,
        maschine: 'soloist' as const,
        // JEDER MIT EIGENEM Zugang — sonst faende `pruefen` schon aus einem
        // anderen Grund etwas, und der Zeuge belegte nicht, was er behauptet.
        schluessel: 'spak_' + String(i).repeat(32).slice(0, 32),
        senke: 'senke' + i,
      })),
    }
  }

  it('fuenf Stroeme mit fuenf Zugaengen sind in Ordnung', () => {
    assert.deepEqual(pruefen(viele(STROEME_HOECHSTENS)), [])
  })

  it('der sechste bekommt einen schweren Befund — und nur er', () => {
    const b = pruefen(viele(STROEME_HOECHSTENS + 1))
    assert.equal(b.length, 1)
    assert.equal(b[0].schwer, true)
    assert.deepEqual(b[0].nr, [6], 'der Befund haengt am ueberzaehligen, nicht an allen')
  })

  it('meldet, verbietet aber nicht — die Liste bleibt vollstaendig', () => {
    // Dieselbe Haltung wie ueberall in pruefen(): eine Box, die wegen einer
    // Konfigurationsfrage gar nicht mehr spielt, ist schlimmer als eine, die
    // falsch spielt und es sagt.
    assert.equal(stroemeAus(viele(7)).stroeme.length, 7)
  })
})

describe('die Vergabe (E74) — wer bekommt einen Strom', () => {
  /** Ein Pool aus n Zugaengen, jeder mit eigenem Schluessel. */
  function pool(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      nr: i + 1,
      zweck: 'wiedergabe' as const,
      maschine: 'soloist' as const,
      schluessel: 'spak_' + String(i).repeat(32).slice(0, 32),
      senke: '',
    }))
  }
  const belegung = (nr: number, fuer: 'wiedergabe' | 'mitschnitt', seit: number): Belegung => ({ nr, fuer, seit })

  describe('Hoeren gewinnt immer', () => {
    it('nimmt den niedrigsten freien Strom', () => {
      const v = vergeben(pool(3), [belegung(1, 'wiedergabe', 10)], 'wiedergabe')
      assert.equal(v.nr, 2)
      assert.equal(v.verdraengt, undefined, 'es musste niemand weichen')
    })

    it('verdraengt einen Mitschnitt, wenn nichts frei ist', () => {
      const v = vergeben(pool(2), [belegung(1, 'wiedergabe', 10), belegung(2, 'mitschnitt', 20)], 'wiedergabe')
      assert.equal(v.nr, 2)
      assert.equal(v.verdraengt, 2)
    })

    it('verdraengt den JUENGSTEN Mitschnitt — die aeltere Aufnahme wird fertig', () => {
      // Der juengste hat am wenigsten Arbeit gesammelt. Die halbe Datei ist
      // ohnehin verloren; es soll moeglichst wenig davon sein.
      const v = vergeben(
        pool(3),
        [belegung(1, 'mitschnitt', 100), belegung(2, 'mitschnitt', 500), belegung(3, 'mitschnitt', 300)],
        'wiedergabe',
      )
      assert.equal(v.verdraengt, 2, 'Strom 2 lief am kuerzesten')
    })

    it('sagt WARUM, wenn alle hoeren — statt eines nackten null', () => {
      const v = vergeben(pool(2), [belegung(1, 'wiedergabe', 10), belegung(2, 'wiedergabe', 20)], 'wiedergabe')
      assert.equal(v.nr, null)
      assert.match(v.grund, /nichts zu verdraengen/)
    })
  })

  describe('der Mitschnitt haelt Platz frei', () => {
    it('nimmt einen, solange danach die Reserve bleibt', () => {
      // Pool 3, nichts belegt: nimmt einen, es blieben 2 frei.
      assert.equal(vergeben(pool(3), [], 'mitschnitt').nr, 1)
    })

    it('nimmt den letzten NICHT — sonst wartet das naechste Kind', () => {
      // Pool 2, einer belegt: nur einer frei. Nehmen hiesse 0 frei.
      const v = vergeben(pool(2), [belegung(1, 'mitschnitt', 10)], 'mitschnitt')
      assert.equal(v.nr, null)
      assert.match(v.grund, /fuers Hoeren frei/)
    })

    it('mit Reserve 0 nimmt er auch den letzten', () => {
      const v = vergeben(pool(2), [belegung(1, 'mitschnitt', 10)], 'mitschnitt', 0)
      assert.equal(v.nr, 2)
    })

    it('mehrere Mitschnitte gleichzeitig — genau darum geht es', () => {
      // Betreiber: „wenn mehr als einer frei ist geht das abarbeiten
      // schneller". Pool 4, Reserve 1: drei duerfen laufen.
      const belegt: Belegung[] = []
      for (let i = 0; i < 9; i++) {
        const v = vergeben(pool(4), belegt, 'mitschnitt')
        if (v.nr === null) break
        belegt.push(belegung(v.nr, 'mitschnitt', i))
      }
      assert.equal(belegt.length, 3, 'drei laufen, der vierte bleibt fuers Hoeren frei')
    })
  })

  // „die Plaetze rechnen sich aus den Hoerern" ist am 19.09.2026 mit
  // `mitschnittPlaetze()` gefallen (AUDIT-2026-09-19 Rang 7). Die Rechnung
  // war richtig und ungefragt: es gibt in diesem Baum keinen Mitschnitt, der
  // nach Plaetzen fragt — kein Endpunkt, kein Aufrufer. Was der Vergabeweg
  // wirklich zusichert (die Reserve bleibt frei), steht unveraendert im
  // Zeugen darueber und wird an `vergeben()` geprueft, nicht an einer
  // Nebenrechnung.

  describe('Randfaelle, die eine Box sonst festfahren', () => {
    it('ohne Pool wird nichts vergeben — mit Grund', () => {
      assert.equal(vergeben([], [], 'wiedergabe').nr, null)
      assert.match(vergeben([], [], 'wiedergabe').grund, /kein Strom eingerichtet/)
    })

    it('eine Belegung auf einer Nummer ausserhalb des Pools blockiert NICHTS', () => {
      // Ein zurueckgebliebener Eintrag (Strom entfernt, Belegung blieb) darf
      // die Box nicht fuer voll halten, waehrend sie leer ist.
      const v = vergeben(pool(2), [belegung(7, 'mitschnitt', 10)], 'wiedergabe')
      assert.equal(v.nr, 1)
    })
  })
})
