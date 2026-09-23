/**
 * Die Wache des Bloecke-Formats (E119) — drei Fragen, die sonst niemand stellt:
 *
 *   1. DECKUNG: Jedes flache Feld der Whitelist wird von `anwenden()` im
 *      NewDesign wirklich GELESEN. Ein Formatfeld ohne Leser waere ein
 *      Schalter, der nichts tut — die Fehlerklasse, die schon einmal 23
 *      tote Felder angesammelt hat (E118-Inventur: vom Classic-Thema
 *      wirkten 3 von 17 Feldern).
 *   2. ROUNDTRIP: Bloecke -> flach -> Bloecke verliert nichts und erfindet
 *      nichts — sonst zeigte der Export (E120) etwas anderes, als der
 *      Import anwendet.
 *   3. DAS TOR: pruefeThema nimmt die Mitgelieferten an, lehnt Unbekanntes
 *      MIT SATZ ab und nennt bei angekuendigten Feldern die Stufe, statt
 *      den Einsender raten zu lassen.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

// tsx faehrt ESM — __dirname gibt es dort nicht (der Deckungs-describe ist
// beim ersten Lauf genau daran gestorben, als Suite-Fehler mit 19/18-Zaehlung).
const HIER = dirname(fileURLToPath(import.meta.url))
import {
  ANGEKUENDIGT,
  BLOECKE,
  FORMAT_KENNUNG,
  alsDokument,
  pruefeThema,
  vonBloecken,
  zuBloecken,
} from './mixpi-thema'
import { MITGELIEFERT, THEMEN, THEMEN_BLOECKE } from './themen'

describe('Deckung: die Whitelist gegen anwenden() im NewDesign', () => {
  const appJs = readFileSync(join(HIER, '../../../NewDesign/app.js'), 'utf8')
  // Der anwenden-Abschnitt genuegt nicht: Gesten-Felder liest einstellen()
  // weiter unten. Gepruft wird die ganze Datei — es geht um „hat einen
  // Leser", nicht um „wo".

  it('jedes flache Feld der Whitelist hat einen Leser', () => {
    const ohneLeser: string[] = []
    for (const plan of Object.values(BLOECKE)) {
      for (const eintrag of Object.values(plan)) {
        // `skalen.titel` wird als skalenVon(w.skalen) gelesen — der
        // Objektname ist der Leser-Anker.
        const anker = eintrag.flach.split('.')[0]
        if (!new RegExp(`\\b${anker}\\b`).test(appJs)) ohneLeser.push(eintrag.flach)
      }
    }
    assert.deepEqual(ohneLeser, [], `Formatfelder ohne Leser in app.js: ${ohneLeser.join(', ')}`)
  })

  it('licht und farbe wirken SEIT E120 auch beim Themenwechsel sofort', () => {
    // anwenden() reicht w.licht ans data-licht-Attribut und w.farbe an
    // farbeSetzen(_, false) durch — ohne Meldung (Echo-Falle). Faellt eine
    // der Zeilen, ist das Themen-Feld ein Versprechen ohne Draht: die Farbe
    // kaeme erst beim naechsten Start.
    assert.match(appJs, /w\.licht === 'hell' \|\| w\.licht === 'dunkel'/)
    assert.match(appJs, /farbeSetzen\(w\.farbe, false\)/)
  })
})

describe('Roundtrip: Bloecke -> flach -> Bloecke', () => {
  for (const name of MITGELIEFERT) {
    it(`verliert bei „${name}" nichts und erfindet nichts`, () => {
      const hin = vonBloecken(THEMEN_BLOECKE[name])
      const zurueck = zuBloecken(hin)
      assert.deepEqual(zurueck, THEMEN_BLOECKE[name])
    })
  }

  it('die exportierte flache Fassung IST die Uebersetzung der Bloecke', () => {
    for (const name of MITGELIEFERT) {
      assert.deepEqual(THEMEN[name], vonBloecken(THEMEN_BLOECKE[name]), name)
    }
  })

  it('setzt innerhalb eines genannten Blocks AUSDRUECKLICH — der Merge-Vertrag verlangt es', () => {
    // PUT /api/darstellung mischt: Weglassen schaltet nichts ab. Ein Thema,
    // das Namen AUS will, muss bezeichnung:false SCHREIBEN.
    assert.deepEqual(vonBloecken({ kacheln: { namen: false } }), { bezeichnung: false })
  })

  it('kissen.stufe und groesse teilen sich miniPlayer sauber', () => {
    assert.deepEqual(vonBloecken({ kissen: { stufe: 'aus' } }), { miniPlayer: 0, kissenMicro: false })
    assert.deepEqual(vonBloecken({ kissen: { stufe: 'micro', groesse: 2 } }), { miniPlayer: 2, kissenMicro: true })
    assert.deepEqual(vonBloecken({ kissen: { stufe: 'voll' } }), { miniPlayer: 1, kissenMicro: false })
    assert.deepEqual(zuBloecken({ miniPlayer: 0 }), { kissen: { stufe: 'aus' } })
    assert.deepEqual(zuBloecken({ miniPlayer: 2, kissenMicro: true }), { kissen: { stufe: 'micro', groesse: 2 } })
  })

  it('albumTipp ist eine Wahl mit drei Antworten — string gewinnt, der bool-Alias reist mit', () => {
    assert.deepEqual(vonBloecken({ reihen: { albumTipp: 'spielt' } }), { albumTipp: 'spielt', albumTippSpielt: true })
    assert.deepEqual(vonBloecken({ reihen: { albumTipp: 'lanes' } }), { albumTipp: 'lanes', albumTippSpielt: false })
    // E121/4d: die Ueberblend-Karte — der Alias sagt ehrlich "spielt nicht".
    assert.deepEqual(vonBloecken({ reihen: { albumTipp: 'karte' } }), { albumTipp: 'karte', albumTippSpielt: false })
    assert.deepEqual(zuBloecken({ albumTipp: 'karte', albumTippSpielt: false }), { reihen: { albumTipp: 'karte' } })
    // Bestandsdateien von VOR E121 tragen nur den bool.
    assert.deepEqual(zuBloecken({ albumTippSpielt: true }), { reihen: { albumTipp: 'spielt' } })
  })

  it('kissen.streifen loest die statusLeiste-Namenskollision im Format auf', () => {
    assert.deepEqual(vonBloecken({ kissen: { streifen: false } }), { statusLeiste: false })
    assert.deepEqual(zuBloecken({ statusLeiste: true }), { kissen: { streifen: true } })
  })

  it('klemmt Zahlen und wirft Unpassendes weg, statt es durchzureichen', () => {
    assert.deepEqual(vonBloecken({ kacheln: { groesse: 99, form: 'dreieckig', randFarbe: '#abcdef' } }), {
      bilder: 3,
      kachelRandFarbe: '#ABCDEF',
    })
  })
})

describe('Das Tor: pruefeThema', () => {
  for (const name of MITGELIEFERT) {
    it(`nimmt „${name}" als Dokument an`, () => {
      const b = pruefeThema(alsDokument(name, THEMEN[name]))
      assert.deepEqual(b.fehler, [])
      assert.equal(b.ok, true)
      assert.equal(b.name, name)
      assert.deepEqual(b.bloecke, THEMEN_BLOECKE[name])
    })
  }

  it('verlangt die Format-Kennung und einen Namen', () => {
    const b = pruefeThema({ bloecke: {} })
    assert.equal(b.ok, false)
    assert.ok(b.fehler.some((f) => f.includes(FORMAT_KENNUNG)))
    assert.ok(b.fehler.some((f) => f.includes('name')))
  })

  it('lehnt Unbekanntes MIT SATZ ab — Block wie Feld', () => {
    const b = pruefeThema({
      format: FORMAT_KENNUNG,
      name: 'Probe',
      bloecke: { raumschiff: { an: true }, kacheln: { tippfehler: 1 } },
    })
    assert.equal(b.ok, false)
    assert.ok(b.fehler.some((f) => f.includes('raumschiff')))
    assert.ok(b.fehler.some((f) => f.includes('kacheln.tippfehler')))
  })

  it('nennt bei angekuendigten Feldern die Stufe statt „unbekannt"', () => {
    // (Erst kopf.schlummer, dann verhalten.beimVerlassen standen hier als
    // Beispiele — beide sind eingeloest; genau so soll die Liste schrumpfen.)
    const b = pruefeThema({
      format: FORMAT_KENNUNG,
      name: 'Zu frueh',
      bloecke: { farben: { ton: 245 }, leiste: { platz: 'oben' } },
    })
    assert.equal(b.ok, false)
    assert.ok(b.fehler.some((f) => f.includes('farben.ton') && f.includes('E120')))
    assert.ok(b.fehler.some((f) => f.includes('leiste.platz')))
  })

  it('licht kennt genau zwei Worte', () => {
    assert.equal(pruefeThema({ format: FORMAT_KENNUNG, name: 'x', bloecke: { licht: 'dunkel' } }).ok, true)
    const b = pruefeThema({ format: FORMAT_KENNUNG, name: 'x', bloecke: { licht: 'neonpink' } })
    assert.equal(b.ok, false)
    assert.ok(b.fehler.some((f) => f.includes('licht')))
  })

  it('jedes ANGEKUENDIGT-Feld traegt einen nachpruefbaren Grund', () => {
    // Entweder eine Stufe (E12x/BACKLOG) — oder eine dauerhafte Politik mit
    // ihrem Ort (die Schublade: bewusst hart an, app.js). Ein blosses
    // „kommt spaeter" waere keine Auskunft.
    for (const [feld, grund] of Object.entries(ANGEKUENDIGT)) {
      assert.match(grund, /E1(19|20|21)|BACKLOG|app\.js/, `${feld}: Grund ohne Stufe oder Ort`)
      assert.ok(grund.length > 20, `${feld}: Grund ist kein Satz`)
    }
  })
})
