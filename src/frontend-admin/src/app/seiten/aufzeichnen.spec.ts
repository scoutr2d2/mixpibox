/**
 * Die reinen Regeln der Aufzeichnen-Seite (E126, Stufe 1).
 *
 * Getestet wird OHNE Angular und ohne Http — genau deshalb sind
 * `listeGruppieren` und `eintragZeile` als reine Funktionen exportiert
 * (dasselbe Muster wie `mitschnittVormerkKoerper` auf der Medienseite).
 */
import {
  type MitschnittEintrag,
  type MitschnittLaufend,
  albenBauen,
  eintragZeile,
  fortschrittProzent,
  listeGruppieren,
  fehlendeTitel,
  suchen,
  werkZuAlbum,
} from './aufzeichnen'

const e = (rest: Partial<MitschnittEintrag>): MitschnittEintrag => ({
  uri: 'spotify:track:x',
  name: 'Titel',
  interpret: 'Wer',
  album: 'Album',
  stand: 'offen',
  ...rest,
})

describe('listeGruppieren', () => {
  it('teilt in offen, fehler und fertig — und behaelt die Reihenfolge der Liste', () => {
    const g = listeGruppieren([
      e({ uri: 'a', stand: 'fertig' }),
      e({ uri: 'b', stand: 'offen' }),
      e({ uri: 'c', stand: 'fehler' }),
      e({ uri: 'd', stand: 'offen' }),
    ])
    expect(g.offen.map((x) => x.uri)).toEqual(['b', 'd'])
    expect(g.fehler.map((x) => x.uri)).toEqual(['c'])
    expect(g.fertig.map((x) => x.uri)).toEqual(['a'])
  })

  it('ein UNBEKANNTER Zustand gilt als offen — Neues darf nicht stumm verschwinden', () => {
    const g = listeGruppieren([e({ uri: 'a', stand: 'laeuft' })])
    expect(g.offen.length).toBe(1)
  })

  it('haelt Muell aus, ohne zu werfen', () => {
    // Die Antwort kommt uebers Netz; ein kaputter Eintrag darf die Seite
    // nicht leeren.
    const g = listeGruppieren([null as unknown as MitschnittEintrag, e({ uri: 'a' })])
    expect(g.offen.length).toBe(1)
  })
})

describe('eintragZeile', () => {
  it('nennt Album, Vorrang, Herkunft und Fehlversuche — nur was da ist', () => {
    expect(eintragZeile(e({ album: 'A', vorrang: true, herkunft: 'hand', versuche: 2 }))).toBe(
      'A · Vorrang · von Hand angefordert · 2 Fehlversuche',
    )
    expect(eintragZeile(e({ album: '', versuche: 1 }))).toBe('1 Fehlversuch')
    expect(eintragZeile(e({ album: '' }))).toBe('')
  })
})


describe('albenBauen', () => {
  it('buendelt Titel desselben Albums und behaelt die Reihenfolge', () => {
    const g = albenBauen([
      e({ uri: 'a', album: 'Nah', albumInterpret: 'Alin Coen', name: 'Eins' }),
      e({ uri: 'b', album: 'Anderes', albumInterpret: 'Wer', name: 'Zwei' }),
      e({ uri: 'c', album: 'Nah', albumInterpret: 'Alin Coen', name: 'Drei' }),
    ])
    expect(g.length).toBe(2)
    expect(g[0].album).toBe('Nah')
    expect(g[0].titel.map((t) => t.uri)).toEqual(['a', 'c'])
    expect(g[1].album).toBe('Anderes')
  })

  it('gruppiert nach dem ALBUM-Interpreten, nicht nach den Gaesten des Titels', () => {
    // Genau der Fehler, der im Plugin schon einmal doppelte Ordner erzeugte:
    // `interpret` traegt die Gaeste, `albumInterpret` die Veroeffentlichung.
    const g = albenBauen([
      e({ uri: 'a', album: 'Mission Erde', albumInterpret: 'Team Karacho', interpret: 'Team Karacho, Rola' }),
      e({ uri: 'b', album: 'Mission Erde', albumInterpret: 'Team Karacho', interpret: 'Team Karacho, ANOTHER NGUYEN' }),
    ])
    expect(g.length).toBe(1)
    expect(g[0].titel.length).toBe(2)
  })

  it('laesst Titel ohne Album einzeln stehen', () => {
    const g = albenBauen([e({ uri: 'a', album: '' }), e({ uri: 'b', album: '' })])
    expect(g.length).toBe(2)
  })
})

describe('fortschrittProzent', () => {
  const l = (rest: Partial<MitschnittLaufend>): MitschnittLaufend => ({
    uri: 'x',
    name: 'T',
    interpret: 'W',
    sekunden: 0,
    ...rest,
  })

  it('rechnet Sekunden gegen die Solldauer', () => {
    expect(fortschrittProzent(l({ sekunden: 60, dauerMs: 120_000 }))).toBe(50)
  })

  it('OHNE Solldauer gibt es keinen Fortschritt — null, kein geratener Balken', () => {
    expect(fortschrittProzent(l({ sekunden: 60 }))).toBeNull()
    expect(fortschrittProzent(l({ sekunden: 60, dauerMs: 0 }))).toBeNull()
    expect(fortschrittProzent(null)).toBeNull()
  })

  it('deckelt bei 100 — die Rohaufnahme laeuft weiter, waehrend geschnitten wird', () => {
    expect(fortschrittProzent(l({ sekunden: 300, dauerMs: 120_000 }))).toBe(100)
  })
})


describe('suchen', () => {
  it('ohne Begriff kommt alles zurueck', () => {
    const alle = [e({ uri: 'a' }), e({ uri: 'b' })]
    expect(suchen(alle, '').length).toBe(2)
    expect(suchen(alle, '   ').length).toBe(2)
  })

  it('findet in Titel, Album und Interpret — ohne Ruecksicht auf Gross und Klein', () => {
    const alle = [
      e({ uri: 'a', name: 'Segelflieger', album: 'Nah', interpret: 'Alin Coen' }),
      e({ uri: 'b', name: 'Conni Teil 6', album: 'Weltkindertag', interpret: 'Conni' }),
    ]
    expect(suchen(alle, 'segel').map((x) => x.uri)).toEqual(['a'])
    expect(suchen(alle, 'NAH').map((x) => x.uri)).toEqual(['a'])
    expect(suchen(alle, 'conni').map((x) => x.uri)).toEqual(['b'])
    expect(suchen(alle, 'gibtsnicht').length).toBe(0)
  })
})

describe('werkZuAlbum', () => {
  const w = (schluessel: string, titel: string, interpret: string) => ({ schluessel, titel, interpret })

  it('findet ueber Titel und Interpret, ohne Ruecksicht auf Gross und Klein', () => {
    const werke = [w('k1', 'Nah', 'Alin Coen'), w('k2', 'Anderes', 'Wer')]
    const g = albenBauen([e({ album: 'nah', albumInterpret: 'ALIN COEN' })])[0]
    expect(werkZuAlbum(werke, g)?.schluessel).toBe('k1')
  })

  it('nimmt den Albumnamen allein NUR, wenn er eindeutig ist', () => {
    const eindeutig = [w('k1', 'Nah', 'Alin Coen')]
    const g = albenBauen([e({ album: 'Nah', albumInterpret: 'Anders geschrieben' })])[0]
    expect(werkZuAlbum(eindeutig, g)?.schluessel).toBe('k1')

    // Zwei Alben gleichen Namens: lieber nichts als das falsche Cover.
    const doppelt = [w('k1', 'Nah', 'A'), w('k2', 'Nah', 'B')]
    expect(werkZuAlbum(doppelt, g)).toBeNull()
  })

  it('ohne Albumnamen gibt es keine Zuordnung', () => {
    const g = albenBauen([e({ album: '', uri: 'x' })])[0]
    expect(werkZuAlbum([w('k1', '', '')], g)).toBeNull()
  })

  // ══ DER ZWILLINGS-BEFUND (05.09.2026, Box .62) ═══════════════════════════
  // „Folge 13" stand DREIMAL in der Mediathek: als Spotify-Werk (18 Titel)
  // und zweimal lokal (je 7, die Aufnahmen). Wer die lokale Fassung trifft,
  // sieht 7 Titel als „alles" und bietet nichts zum Nachladen an.
  it('bevorzugt bei Namens-Zwillingen die Fassung MIT Dienst-Quelle', () => {
    const lokal = { ...w('lok', 'Folge 13', 'Hello Kitty'), quellen: [{ dienst: 'lokal' }] }
    const spotify = { ...w('spo', 'Folge 13', 'Hello Kitty'), quellen: [{ dienst: 'spotify' }] }
    const g = albenBauen([e({ album: 'Folge 13', albumInterpret: 'Hello Kitty' })])[0]
    // Die lokale steht ABSICHTLICH zuerst: genau die Reihenfolge, in der
    // der Fehler am Geraet auftrat (find nahm den ersten Treffer).
    expect(werkZuAlbum([lokal, spotify], g)?.schluessel).toBe('spo')
  })

  it('laesst lokale Zwillinge auch in der Albumnamen-Runde nicht als Konkurrenz zaehlen', () => {
    const g = albenBauen([e({ album: 'Folge 13', albumInterpret: 'ganz anders geschrieben' })])[0]
    const werke = [
      { ...w('lok1', 'Folge 13', 'Hello Kitty'), quellen: [{ dienst: 'lokal' }] },
      { ...w('lok2', 'Folge 13', 'Hello Kitty Hörspiele'), quellen: [{ dienst: 'lokal' }] },
      { ...w('spo', 'Folge 13', 'Hello Kitty!'), quellen: [{ dienst: 'spotify' }] },
    ]
    expect(werkZuAlbum(werke, g)?.schluessel).toBe('spo')
  })

  it('bleibt bei MEHREREN Dienst-Fassungen gleichen Namens beim „lieber nichts"', () => {
    const g = albenBauen([e({ album: 'Nah', albumInterpret: 'wieder anders' })])[0]
    const werke = [
      { ...w('s1', 'Nah', 'A'), quellen: [{ dienst: 'spotify' }] },
      { ...w('j1', 'Nah', 'B'), quellen: [{ dienst: 'jellyfin' }] },
    ]
    expect(werkZuAlbum(werke, g)).toBeNull()
  })
})

describe('fehlendeTitel', () => {
  it('nennt genau die Titel, die noch nicht in der Liste stehen', () => {
    const inhalt = [
      { nr: 1, titel: 'Eins', uri: 'spotify:track:a' },
      { nr: 2, titel: 'Zwei', uri: 'spotify:track:b' },
      { nr: 3, titel: 'Drei', uri: 'spotify:track:c' },
    ]
    const fehlt = fehlendeTitel(inhalt, new Set(['spotify:track:b']))
    expect(fehlt.map((t) => t.uri)).toEqual(['spotify:track:a', 'spotify:track:c'])
  })

  it('laesst Titel OHNE Spotify-Adresse weg — man koennte sie gar nicht vormerken', () => {
    const inhalt = [{ nr: 1, titel: 'Lokal', uri: '' }, { nr: 2, titel: 'Falsch', uri: 'jellyfin:1' }]
    expect(fehlendeTitel(inhalt, new Set()).length).toBe(0)
  })

  it('haelt Muell aus', () => {
    expect(fehlendeTitel(null as never, new Set()).length).toBe(0)
  })
})

describe('werkZuAlbum — Schreibweisen der Mediathek', () => {
  const w = (schluessel: string, titel: string, interpret: string) => ({ schluessel, titel, interpret })

  it('findet trotz ersetzter Sonderzeichen (Doppelpunkt wird im Ordner zu Unterstrich)', () => {
    const werke = [w('k1', 'Folge 12_ Fans und Freunde', 'Hello Kitty Hörspiele')]
    const g = albenBauen([e({ album: 'Folge 12: Fans und Freunde', albumInterpret: 'Hello Kitty Hörspiele' })])[0]
    expect(werkZuAlbum(werke, g)?.schluessel).toBe('k1')
  })

  it('findet trotz vertauschter Interpreten-Reihenfolge', () => {
    const werke = [w('k1', '101 Wichtel', 'Ruby van der Bogen, 101 fabelhafte Freunde')]
    const g = albenBauen([e({ album: '101 Wichtel', albumInterpret: '101 fabelhafte Freunde, Ruby van der Bogen' })])[0]
    expect(werkZuAlbum(werke, g)?.schluessel).toBe('k1')
  })
})
