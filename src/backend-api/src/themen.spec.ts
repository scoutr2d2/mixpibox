import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MITGELIEFERT,
  THEMEN,
  abweichungen,
  aktivesThema,
  auslieferung,
  auslieferungAlle,
  ergaenzen,
  istMitgeliefert,
  passt,
} from './themen'

describe('MITGELIEFERT', () => {
  it('nennt genau die vier Themen', () => {
    assert.deepEqual([...MITGELIEFERT].sort(), ['MuPi-Brücke', 'MuPiBox Classic', 'New MuPiBox', 'Tiger Mupi'])
  })

  it('hat zu jedem Namen auch einen Inhalt', () => {
    for (const n of MITGELIEFERT) assert.ok(THEMEN[n], n)
  })
})

describe('istMitgeliefert', () => {
  it('erkennt mitgelieferte Themen', () => {
    assert.equal(istMitgeliefert('MuPiBox Classic'), true)
    assert.equal(istMitgeliefert('Tiger Mupi'), true)
  })

  it('erkennt ein eigenes Thema NICHT als mitgeliefert', () => {
    // Sonst liesse sich ein selbst angelegtes nicht mehr loeschen.
    assert.equal(istMitgeliefert('Achims Fassung'), false)
    assert.equal(istMitgeliefert(''), false)
    assert.equal(istMitgeliefert(undefined), false)
  })
})

describe('ergaenzen', () => {
  it('legt alle vier an, wenn gar nichts da ist', () => {
    assert.deepEqual(Object.keys(ergaenzen({})).sort(), [...MITGELIEFERT].sort())
    assert.deepEqual(Object.keys(ergaenzen(null)).sort(), [...MITGELIEFERT].sort())
  })

  it('laesst eine ANGEPASSTE Fassung unangetastet', () => {
    // Wer eines der vier umgestellt und gespeichert hat, behaelt seine Fassung.
    const eigen = { 'MuPiBox Classic': { miniPlayer: 1, eigenes: true } }
    const r = ergaenzen(eigen)
    assert.deepEqual(r['MuPiBox Classic'], { miniPlayer: 1, eigenes: true })
  })

  it('ergaenzt nur, was FEHLT', () => {
    const r = ergaenzen({ 'Tiger Mupi': { x: 1 } })
    assert.deepEqual(r['Tiger Mupi'], { x: 1 })
    assert.ok(r['MuPiBox Classic'])
  })

  it('behaelt eigene Themen', () => {
    const r = ergaenzen({ Eigenes: { a: 1 } })
    assert.deepEqual(r.Eigenes, { a: 1 })
    assert.equal(Object.keys(r).length, MITGELIEFERT.length + 1)
  })

  it('gibt eine NEUE Sammlung zurueck', () => {
    const rein = {}
    const raus = ergaenzen(rein)
    assert.notEqual(rein, raus)
    assert.deepEqual(rein, {})
  })

  it('haendigt Kopien aus, nicht die Vorlage selbst', () => {
    // Sonst veraendert ein Aufrufer die mitgelieferte Fassung fuer alle.
    const a = ergaenzen({}) as Record<string, Record<string, unknown>>
    a['MuPiBox Classic'].miniPlayer = 99
    const b = ergaenzen({}) as Record<string, Record<string, unknown>>
    assert.equal(b['MuPiBox Classic'].miniPlayer, 0)
  })
})

describe('ergaenzen mit bereits Gespeichertem', () => {
  it('nimmt die GESPEICHERTE Fassung, nicht die mitgelieferte', () => {
    // Der Fall, der am Geraet eine skalierte Kachelgroesse gekostet hat: eine
    // Oberflaeche schickt die Themen beim Speichern nicht mit, und die
    // Rettung ueberschrieb die eigene Anpassung.
    const gespeichert = { 'MuPiBox Classic': { bilder: 1.8, eigenes: true } }
    const r = ergaenzen({}, gespeichert)
    assert.deepEqual(r['MuPiBox Classic'], { bilder: 1.8, eigenes: true })
  })

  it('nimmt die mitgelieferte, wenn auch nichts gespeichert ist', () => {
    const r = ergaenzen({}, {})
    // Bis E119 stand hier `aussehen === 'classic'` — das Feld war ein
    // Angular-Relikt und ist mit der Bloecke-Neufassung gefallen. Der
    // Classic-KERN, der wirkt, ist der runde Ring:
    assert.equal((r['MuPiBox Classic'] as Record<string, unknown>).kachelForm, 'rund')
    assert.equal((r['MuPiBox Classic'] as Record<string, unknown>).kachelRand, true)
  })

  it('laesst eine mitgeschickte Fassung immer vorgehen', () => {
    const r = ergaenzen({ 'Tiger Mupi': { neu: 1 } }, { 'Tiger Mupi': { alt: 1 } })
    assert.deepEqual(r['Tiger Mupi'], { neu: 1 })
  })
})

describe('auslieferung', () => {
  it('gibt den Stand aus dem Code zurueck', () => {
    assert.deepEqual(auslieferung('MuPiBox Classic'), THEMEN['MuPiBox Classic'])
  })

  it('gibt eine KOPIE - der Aufrufer darf die Vorlage nicht verbiegen', () => {
    // Sonst haette ein Zurueckholen die Vorlage fuer alle Zeit veraendert.
    const a = auslieferung('New MuPiBox') as Record<string, unknown>
    a.miniPlayer = 99
    assert.equal(THEMEN['New MuPiBox'].miniPlayer, 1)
  })

  it('kennt kein eigenes Thema', () => {
    assert.equal(auslieferung('Meins'), null)
    assert.equal(auslieferung(undefined), null)
  })

  it('auslieferungAlle nennt genau die vier', () => {
    assert.deepEqual(Object.keys(auslieferungAlle()).sort(), [...MITGELIEFERT].sort())
  })
})

describe('abweichungen', () => {
  it('vergleicht NUR die Felder, die das Thema nennt', () => {
    // Ein Thema ist bewusst keine vollstaendige Darstellung. Wer alle Felder
    // vergliche, faende immer Unterschiede und koennte nie „passt" melden.
    const th = { miniPlayer: 0, flipKarte: false }
    const stand = { miniPlayer: 0, flipKarte: false, bilder: 1.8, irgendwas: 'egal' }
    assert.deepEqual(abweichungen(th, stand), [])
  })

  it('nennt die abweichenden Felder sortiert', () => {
    const th = { miniPlayer: 0, flipKarte: false, bezeichnung: true }
    const stand = { miniPlayer: 1, flipKarte: false, bezeichnung: false }
    assert.deepEqual(abweichungen(th, stand), ['bezeichnung', 'miniPlayer'])
  })

  it('behandelt Objekte und Listen richtig', () => {
    // kopfIcons ist ein Objekt, kopfOrdnung eine Liste - ein Vergleich mit
    // === haette beide IMMER als verschieden gemeldet.
    const th = { kopfIcons: { bt: true }, kopfOrdnung: ['bt', 'netz'] }
    assert.deepEqual(abweichungen(th, { kopfIcons: { bt: true }, kopfOrdnung: ['bt', 'netz'] }), [])
    assert.deepEqual(abweichungen(th, { kopfIcons: { bt: true }, kopfOrdnung: ['netz', 'bt'] }), ['kopfOrdnung'])
  })

  it('zaehlt ein fehlendes Feld als Abweichung', () => {
    assert.deepEqual(abweichungen({ miniPlayer: 0 }, {}), ['miniPlayer'])
  })

  it('kommt mit fehlenden Angaben zurecht', () => {
    assert.deepEqual(abweichungen(null, { a: 1 }), [])
    assert.deepEqual(abweichungen({ a: 1 }, null), ['a'])
  })
})

describe('passt', () => {
  it('meldet Uebereinstimmung', () => {
    assert.equal(passt({ miniPlayer: 0 }, { miniPlayer: 0, bilder: 2 }), true)
  })

  it('meldet einen Unterschied', () => {
    assert.equal(passt({ miniPlayer: 0 }, { miniPlayer: 1 }), false)
  })

  it('ein fehlendes Thema passt nie', () => {
    assert.equal(passt(null, { miniPlayer: 0 }), false)
  })
})

describe('aktivesThema', () => {
  it('findet das laufende Thema', () => {
    const themen = { A: { miniPlayer: 0 }, B: { miniPlayer: 1 } }
    assert.equal(aktivesThema(themen, { miniPlayer: 1 }), 'B')
  })

  it('meldet null, sobald von Hand nachgestellt wurde', () => {
    // Das ist ein ehrliches Ergebnis, kein Fehler: es laeuft dann eben kein
    // abgelegtes Thema mehr, sondern etwas Eigenes.
    assert.equal(aktivesThema({ A: { miniPlayer: 0 } }, { miniPlayer: 2 }), null)
  })

  it('nimmt bei mehreren Treffern das AUSSAGEKRAEFTIGERE', () => {
    // Ein Thema mit zwei Feldern passt schnell zufaellig; eines mit vielen
    // beschreibt den Stand wirklich.
    const themen = {
      Duenn: { miniPlayer: 0 },
      Dick: { miniPlayer: 0, flipKarte: false, bezeichnung: true },
    }
    assert.equal(aktivesThema(themen, { miniPlayer: 0, flipKarte: false, bezeichnung: true }), 'Dick')
  })

  it('entscheidet bei Gleichstand nach dem Namen, nicht nach der Reihenfolge', () => {
    // Sonst haenge die Antwort davon ab, wie das Objekt gerade sortiert ist.
    const stand = { miniPlayer: 0 }
    assert.equal(aktivesThema({ Zeta: { miniPlayer: 0 }, Alpha: { miniPlayer: 0 } }, stand), 'Alpha')
    assert.equal(aktivesThema({ Alpha: { miniPlayer: 0 }, Zeta: { miniPlayer: 0 } }, stand), 'Alpha')
  })

  it('ueberspringt kaputte Eintraege statt abzustuerzen', () => {
    const themen = { Kaputt: null, Gut: { miniPlayer: 0 } } as Record<string, unknown>
    assert.equal(aktivesThema(themen, { miniPlayer: 0 }), 'Gut')
  })

  it('kommt mit leeren Angaben zurecht', () => {
    assert.equal(aktivesThema({}, { a: 1 }), null)
    assert.equal(aktivesThema(null, null), null)
  })

  it('erkennt ein mitgeliefertes Thema am echten Auslieferungsstand', () => {
    const stand = { ...THEMEN['MuPiBox Classic'], bilder: 1.8 }
    assert.equal(aktivesThema(auslieferungAlle(), stand), 'MuPiBox Classic')
  })
})
