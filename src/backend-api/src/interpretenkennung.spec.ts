/**
 * Tests der box-eigenen Interpretenkennung (E64b).
 *
 * DIE NAMEN SIND DIE ECHTEN DIESER BOX, nicht erfundene — dieselbe Liste, auf
 * der interpreten.spec.ts steht (gemessen 2026-08-03), plus das Paar aus E45
 * („ARD Sounds" / „Die Maus") und das Paar aus E49 („Die drei ???" gegen „Die
 * drei !!!"). Beide Paare sind der Grund, aus dem es dieses Modul gibt.
 *
 * DER SCHWERPUNKT LIEGT AUF DEM NEIN. Zwei Interpreten unter einer Kennung
 * sind ein stiller, nicht zurueckholbarer Schaden — im Regal des Kindes haengen
 * dann die Aufnahmen eines Fremden unter einem bekannten Namen, und es sieht
 * aus wie Absicht. Ein Interpret unter zwei Kennungen ist dagegen eine
 * sichtbare Kachel zu viel. Deshalb pruefen die meisten Zeugen hier, dass
 * etwas NICHT passiert.
 *
 * DER TEUERSTE DENKBARE AUSGANG waere eine Wanderung, die beim Anlegen still
 * zusammenlegt, was gleich AUSSIEHT — dann waere der Schaden schon in der
 * Ablage, bevor ein Mensch je gefragt wurde. Dieser Fall wird ausdruecklich
 * geprueft.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  anlegen,
  ausNamenWandern,
  istKennungsId,
  KENNUNGSABLAGE_LEER,
  kennungAus,
  kennungFuerNamen,
  kennungFuerVerweis,
  kennungsablageAus,
  nameHinzufuegen,
  namenKarte,
  neueId,
  verweisSetzen,
} from './interpretenkennung'

/** Feste Kennungen fuer die Zeugen — der Zufall gehoert nicht in einen Test. */
function zaehler(start = 1): () => string {
  let n = start
  return () =>
    neueId(() =>
      String(n++)
        .padStart(12, '0')
        .replace(/[^0-9a-f]/g, ''),
    )
}

describe('die Kennung selbst', () => {
  it('sieht aus wie int_ und zwoelf Hexziffern', () => {
    const id = neueId(() => 'abcdef012345')
    assert.equal(id, 'int_abcdef012345')
    assert.ok(istKennungsId(id))
  })

  it('fuellt zu kurz geratenen Zufall auf, statt eine ungueltige Kennung zu liefern', () => {
    // Ungueltig faellt erst beim LESEN auf — dann ist die Verknuepfung schon
    // geschrieben und der Verweis zeigt ins Leere.
    assert.ok(istKennungsId(neueId(() => 'ab')))
  })

  it('wirft weg, was keine Hexziffer ist', () => {
    assert.ok(istKennungsId(neueId(() => 'zz-zz-zz-aaaaaaaaaaaa')))
  })

  it('nimmt nichts an, was nicht dem Muster folgt', () => {
    for (const x of ['int_ABCDEF012345', 'int_kurz', 'abcdef012345', '', null, 42]) {
      assert.equal(istKennungsId(x), false, String(x))
    }
  })
})

describe('rohes JSON einlesen', () => {
  it('weist eine Kennung ohne gueltige Id ab', () => {
    assert.equal(kennungAus({ id: 'kaputt', namen: [{ name: 'EMMA6' }] }), null)
  })

  it('weist eine Kennung ohne Namen ab — sie waere unauffindbar', () => {
    assert.equal(kennungAus({ id: 'int_000000000001', namen: [] }), null)
    assert.equal(kennungAus({ id: 'int_000000000001', namen: [{ name: '   ' }] }), null)
  })

  it('behaelt bei doppeltem Namen den ersten', () => {
    const k = kennungAus({
      id: 'int_000000000001',
      namen: [{ name: 'Kapelle Petra', stufe: 'hand' }, { name: 'kapelle  petra' }],
    })
    assert.equal(k?.namen.length, 1)
    assert.equal(k?.namen[0].stufe, 'hand')
  })

  it('setzt eine unbekannte Stufe auf wanderung statt sie zu erfinden', () => {
    const k = kennungAus({ id: 'int_000000000001', namen: [{ name: 'EMMA6', stufe: 'zauberei' }] })
    assert.equal(k?.namen[0].stufe, 'wanderung')
  })

  it('laesst eine Kennung leben, die EINEN Namen an eine fruehere verliert', () => {
    // Die Kennung behaelt ihre Dienstverweise — sie zu loeschen naehme mehr
    // weg als der doppelte Name wert ist.
    const a = kennungsablageAus({
      kennungen: [
        { id: 'int_000000000001', namen: [{ name: 'Die Maus' }] },
        {
          id: 'int_000000000002',
          namen: [{ name: 'Die Maus' }, { name: 'ARD Sounds' }],
          verweise: [{ dienst: 'spotify', kennung: '4Yxsn0N9cLLXBGXPYUlP2y' }],
        },
      ],
    })
    assert.equal(a.kennungen.length, 2)
    assert.deepEqual(
      a.kennungen[1].namen.map((n) => n.name),
      ['ARD Sounds'],
    )
    assert.equal(a.kennungen[1].verweise.length, 1)
  })

  it('laesst eine Kennung fallen, deren EINZIGER Name schon vergeben war', () => {
    const a = kennungsablageAus({
      kennungen: [
        { id: 'int_000000000001', namen: [{ name: 'EMMA6' }] },
        { id: 'int_000000000002', namen: [{ name: 'emma6' }] },
      ],
    })
    assert.equal(a.kennungen.length, 1)
    assert.equal(a.kennungen[0].id, 'int_000000000001')
  })

  it('behaelt bei doppelter Id die erste', () => {
    const a = kennungsablageAus({
      kennungen: [
        { id: 'int_000000000001', namen: [{ name: 'Lichterkinder' }] },
        { id: 'int_000000000001', namen: [{ name: 'Das Lumpenpack' }] },
      ],
    })
    assert.equal(a.kennungen.length, 1)
    assert.equal(a.kennungen[0].namen[0].name, 'Lichterkinder')
  })

  it('ueberlebt Muell, ohne etwas zu erfinden', () => {
    for (const x of [null, undefined, 42, 'text', {}, { kennungen: 'nein' }]) {
      assert.deepEqual(kennungsablageAus(x), KENNUNGSABLAGE_LEER)
    }
  })
})

describe('nachschlagen', () => {
  const ablage = kennungsablageAus({
    kennungen: [
      {
        id: 'int_000000000001',
        namen: [{ name: 'Das Pummeleinhorn', stufe: 'hand' }],
        verweise: [{ dienst: 'spotify', kennung: '1vCWHaC5f2uS3yhpwWbIA6', stufe: 'hand' }],
      },
    ],
  })

  it('findet ueber den Namen, auch in anderer Schreibweise', () => {
    assert.equal(kennungFuerNamen(ablage, 'das  pummeleinhorn'), 'int_000000000001')
  })

  it('findet ueber den Dienstverweis — der Weg fuer Aufnahme und Spotify', () => {
    assert.equal(kennungFuerVerweis(ablage, 'Spotify', '1vCWHaC5f2uS3yhpwWbIA6'), 'int_000000000001')
  })

  it('sagt nichts, wo es nichts weiss', () => {
    assert.equal(kennungFuerNamen(ablage, 'Kapelle Petra'), null)
    assert.equal(kennungFuerVerweis(ablage, 'spotify', 'fremd'), null)
    assert.equal(kennungFuerVerweis(ablage, '', ''), null)
  })

  it('haelt die zwei Kosmos-Serien aus E49 auseinander', () => {
    // Genau der Fall, an dem `normal()` scheiterte: beide ergaben `die drei`.
    const a = ausNamenWandern(KENNUNGSABLAGE_LEER, ['Die drei ???', 'Die drei !!!'], zaehler()).ablage
    assert.equal(a.kennungen.length, 2)
    assert.notEqual(kennungFuerNamen(a, 'Die drei ???'), kennungFuerNamen(a, 'Die drei !!!'))
  })
})

describe('anlegen', () => {
  it('legt an und gibt die Kennung zurueck', () => {
    const e = anlegen(KENNUNGSABLAGE_LEER, 'Der kleine Major Tom', 'hand', zaehler())
    assert.equal(e.ok, true)
    assert.equal(e.id, 'int_000000000001')
  })

  it('legt NICHTS Neues an, wenn der Name schon jemandem gehoert', () => {
    const erst = anlegen(KENNUNGSABLAGE_LEER, 'Prinzessin Lillifee', 'hand', zaehler()).ablage
    const e = anlegen(erst, 'prinzessin lillifee', 'hand', zaehler(9))
    assert.equal(e.ok, false)
    assert.equal(e.id, 'int_000000000001', 'die vorhandene Kennung kommt zurueck')
    assert.equal(e.ablage.kennungen.length, 1)
  })

  it('weist einen Namen ab, aus dem kein Schluessel wird', () => {
    for (const x of ['', '   ', null]) {
      assert.equal(anlegen(KENNUNGSABLAGE_LEER, x, 'hand', zaehler()).ok, false)
    }
  })
})

describe('einen zweiten Namen anhaengen — hier sitzt die Regel aus E49', () => {
  const grund = kennungsablageAus({
    kennungen: [
      { id: 'int_000000000001', namen: [{ name: 'ARD Sounds', stufe: 'hand' }] },
      { id: 'int_000000000002', namen: [{ name: 'Die Maus', stufe: 'hand' }] },
    ],
  })

  it('VERWEIGERT das Zusammenlegen, wenn eine Maschine es will', () => {
    for (const stufe of ['erkannt', 'wanderung'] as const) {
      const e = nameHinzufuegen(grund, 'int_000000000001', 'Die Maus', stufe)
      assert.equal(e.ok, false, stufe)
      assert.equal(e.id, 'int_000000000002', 'es sagt, wem der Name gehoert')
      assert.deepEqual(e.ablage, grund, 'und ruehrt die Ablage nicht an')
    }
  })

  it('erlaubt es einem Menschen — und raeumt die alte Stelle', () => {
    const e = nameHinzufuegen(grund, 'int_000000000001', 'Die Maus', 'hand')
    assert.equal(e.ok, true)
    assert.equal(kennungFuerNamen(e.ablage, 'Die Maus'), 'int_000000000001')
    // Die alte Kennung hatte nur diesen einen Namen und faellt weg — sonst
    // stuende sie unauffindbar in der Ablage.
    assert.equal(e.ablage.kennungen.length, 1)
  })

  it('haelt die Herkunft fest, statt sie zu gluetten', () => {
    const e = nameHinzufuegen(grund, 'int_000000000001', 'Die Maus', 'hand')
    const eintrag = e.ablage.kennungen[0].namen.find((n) => n.name === 'Die Maus')
    assert.equal(eintrag?.stufe, 'hand')
  })

  it('meldet ok, wenn der Name schon an dieser Kennung haengt', () => {
    const e = nameHinzufuegen(grund, 'int_000000000001', 'ard sounds', 'erkannt')
    assert.equal(e.ok, true)
    assert.equal(e.ablage.kennungen[0].namen.length, 1, 'aber legt ihn nicht doppelt ab')
  })

  it('weist eine Kennung ab, die es nicht gibt', () => {
    const e = nameHinzufuegen(grund, 'int_00000000ffff', 'EMMA6', 'hand')
    assert.equal(e.ok, false)
    assert.deepEqual(e.ablage, grund)
  })
})

describe('Dienstverweise', () => {
  const grund = kennungsablageAus({
    kennungen: [
      { id: 'int_000000000001', namen: [{ name: 'Die Maus' }] },
      { id: 'int_000000000002', namen: [{ name: 'EMMA6' }] },
    ],
  })

  it('haengt Aufnahme und Spotify an dieselbe Kennung', () => {
    let a = verweisSetzen(grund, 'int_000000000001', 'spotify', '4Yxsn0N9cLLXBGXPYUlP2y').ablage
    a = verweisSetzen(a, 'int_000000000001', 'aufnahme', 'music/Die Sendung mit der Maus').ablage
    assert.equal(kennungFuerVerweis(a, 'spotify', '4Yxsn0N9cLLXBGXPYUlP2y'), 'int_000000000001')
    assert.equal(kennungFuerVerweis(a, 'aufnahme', 'music/Die Sendung mit der Maus'), 'int_000000000001')
  })

  it('laesst denselben Verweis NICHT an zwei Kennungen haengen', () => {
    // Sonst entschiede `verweisKarte` nach Reihenfolge, also nach Zufall.
    let a = verweisSetzen(grund, 'int_000000000001', 'spotify', 'gleich').ablage
    a = verweisSetzen(a, 'int_000000000002', 'spotify', 'gleich').ablage
    assert.equal(kennungFuerVerweis(a, 'spotify', 'gleich'), 'int_000000000002')
    assert.equal(a.kennungen[0].verweise.length, 0, 'die alte Stelle ist geraeumt')
  })

  it('weist unvollstaendige Angaben ab', () => {
    assert.equal(verweisSetzen(grund, 'int_000000000001', '', 'x').ok, false)
    assert.equal(verweisSetzen(grund, 'int_000000000001', 'spotify', '').ok, false)
    assert.equal(verweisSetzen(grund, 'int_00000000ffff', 'spotify', 'x').ok, false)
  })
})

describe('Wanderung aus dem Bestand', () => {
  const echte = [
    'EMMA6',
    'Kapelle Petra',
    'Lichterkinder',
    'Das Pummeleinhorn',
    'Red Hot Chili Peppers',
    'Das Lumpenpack',
    'Kleine Prinzessin',
    'Prinzessin Lillifee',
    'Der kleine Major Tom',
    'EUROPA Hörspiele & Kinderlieder',
    'kidsclubedutainment',
    '𝓛𝓮𝓸𝓷𝓲𝓮♡',
    '🩵Jojo 🩵',
  ]

  it('gibt jedem Namen der Box eine Kennung', () => {
    const { ablage, angelegt } = ausNamenWandern(KENNUNGSABLAGE_LEER, echte, zaehler())
    assert.equal(angelegt.length, echte.length)
    for (const n of echte) assert.ok(kennungFuerNamen(ablage, n), n)
  })

  it('LEGT NICHTS ZUSAMMEN — auch nicht, was gleich aussieht', () => {
    // Der teuerste denkbare Ausgang: die Wanderung entscheidet still, was ein
    // Mensch entscheiden soll. „ARD Sounds" und „Die Maus" sind derselbe
    // Interpret — die Wanderung darf das nicht wissen.
    const { ablage } = ausNamenWandern(KENNUNGSABLAGE_LEER, ['ARD Sounds', 'Die Maus'], zaehler())
    assert.equal(ablage.kennungen.length, 2)
    assert.notEqual(kennungFuerNamen(ablage, 'ARD Sounds'), kennungFuerNamen(ablage, 'Die Maus'))
  })

  it('traegt wanderung als Herkunft, nicht hand', () => {
    const { ablage } = ausNamenWandern(KENNUNGSABLAGE_LEER, ['EMMA6'], zaehler())
    assert.equal(ablage.kennungen[0].namen[0].stufe, 'wanderung')
  })

  it('laeuft zweimal ohne Dubletten', () => {
    const erst = ausNamenWandern(KENNUNGSABLAGE_LEER, echte, zaehler()).ablage
    const zweit = ausNamenWandern(erst, echte, zaehler(100))
    assert.equal(zweit.angelegt.length, 0)
    assert.equal(zweit.ablage.kennungen.length, echte.length)
  })

  it('uebersteht Muell in der Namensliste', () => {
    const { ablage } = ausNamenWandern(KENNUNGSABLAGE_LEER, [null, '', '   ', 'EMMA6', 42], zaehler())
    assert.equal(ablage.kennungen.length, 1)
  })
})

describe('die Karten', () => {
  it('namenKarte fuehrt jeden Namen auf seine Kennung', () => {
    const a = kennungsablageAus({
      kennungen: [
        {
          id: 'int_000000000001',
          namen: [{ name: 'ARD Sounds' }, { name: 'Die Maus' }],
        },
      ],
    })
    const karte = namenKarte(a)
    assert.equal(karte.size, 2)
    assert.equal(karte.get('ard sounds'), 'int_000000000001')
  })

  it('vertraegt eine leere Ablage', () => {
    assert.equal(namenKarte(null).size, 0)
    assert.equal(namenKarte(KENNUNGSABLAGE_LEER).size, 0)
  })
})
