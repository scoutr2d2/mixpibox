/**
 * Die Abbildung Titel → Vormerk-Koerper (E-Aufnahmen, Betreiber: „mir fehlt
 * noch die verwaltung sowie anstoßen ... ggf direkt an den alben zum
 * klicken").
 *
 * GEPRUEFT WIRD NUR DIE REINE FUNKTION, nicht der ganze Klick-Ablauf: sie
 * entscheidet, welche Titel den Mitschnitt ueberhaupt erreichen, und genau
 * das ist der Teil, den ein falscher Handgriff leise falsch machen kann -
 * ein Titel ohne Spotify-Kennung, der trotzdem verschickt wird, oder ein
 * Album, dessen Name am Titel haengen bleibt statt am Album.
 *
 * EXPORTIERT AUS `medien.ts` UND NICHT NACHGEBAUT (Muster aus
 * `schnellwahl.spec.ts`, das `SCHNELL_NICHT_KLICKBAR` genauso teilt): ein
 * Test gegen eine zweite Fassung der Regel bliebe gruen, waehrend die Seite
 * etwas anderes tut.
 */
import { mitschnittVormerkKoerper } from './medien'

describe('mitschnittVormerkKoerper', () => {
  const album = { titel: 'Ein Album', interpret: 'Die Band' }

  it('bildet einen Titel mit Spotify-Kennung vollstaendig ab', () => {
    const { koerper, uebersprungen } = mitschnittVormerkKoerper(
      [{ titel: 'Erster Titel', interpret: 'Die Band', dauerMs: 123456, uri: 'spotify:track:abc' }],
      album,
    )
    expect(uebersprungen).toBe(0)
    expect(koerper).toEqual([
      {
        uri: 'spotify:track:abc',
        name: 'Erster Titel',
        interpret: 'Die Band',
        album: 'Ein Album',
        albumKuenstler: 'Die Band',
        dauerMs: 123456,
      },
    ])
  })

  it('uebergeht Titel OHNE Spotify-Kennung und zaehlt sie nur', () => {
    // Der serverseitige Quellen-Ruckfall (/api/werke/:schluessel/inhalt)
    // kann bei quelle=spotify trotzdem einen Titel ohne `uri` liefern, wenn
    // Spotify selbst keinen Kandidaten fuer diesen einen Titel stellt.
    const { koerper, uebersprungen } = mitschnittVormerkKoerper(
      [
        { titel: 'Mit Kennung', uri: 'spotify:track:eins' },
        { titel: 'Ohne Kennung' },
        { titel: 'Leere Kennung', uri: '' },
      ],
      album,
    )
    expect(uebersprungen).toBe(2)
    expect(koerper.length).toBe(1)
    expect(koerper[0].name).toBe('Mit Kennung')
  })

  it('nennt Album und Album-Kuenstler der ZEILE, nicht des Titels', () => {
    // Genau das ist der Sinn von `album`/`albumKuenstler` im Vertrag: der
    // Mitschnitt soll wissen, zu welchem Album auf der Box der Titel
    // gehoert - unabhaengig davon, was Spotify selbst als Album fuehrt.
    const { koerper } = mitschnittVormerkKoerper(
      [{ titel: 'Titel', interpret: 'Anderer Interpret (Feature)', uri: 'spotify:track:xyz' }],
      { titel: 'Zeilentitel auf der Box', interpret: 'Zeileninterpret auf der Box' },
    )
    expect(koerper[0].album).toBe('Zeilentitel auf der Box')
    expect(koerper[0].albumKuenstler).toBe('Zeileninterpret auf der Box')
    expect(koerper[0].interpret).toBe('Anderer Interpret (Feature)')
  })

  it('laesst dauerMs und kategorie weg, wenn sie fehlen', () => {
    const { koerper } = mitschnittVormerkKoerper([{ titel: 'Titel', uri: 'spotify:track:xyz' }], album)
    expect('dauerMs' in koerper[0]).toBe(false)
    expect('kategorie' in koerper[0]).toBe(false)
  })

  it('nimmt die Kategorie der Zeile mit, wenn sie gesetzt ist', () => {
    const { koerper } = mitschnittVormerkKoerper([{ titel: 'Titel', uri: 'spotify:track:xyz' }], {
      ...album,
      kategorie: 'audiobook',
    })
    expect(koerper[0].kategorie).toBe('audiobook')
  })

  it('laesst albumKuenstler weg, wenn die Zeile keinen Interpreten traegt', () => {
    const { koerper } = mitschnittVormerkKoerper([{ titel: 'Titel', uri: 'spotify:track:xyz' }], {
      titel: 'Album ohne Interpret',
      interpret: '',
    })
    expect('albumKuenstler' in koerper[0]).toBe(false)
  })

  it('gibt bei einer leeren Titelliste eine leere Liste und null Uebersprungene zurueck', () => {
    const { koerper, uebersprungen } = mitschnittVormerkKoerper([], album)
    expect(koerper).toEqual([])
    expect(uebersprungen).toBe(0)
  })
})
