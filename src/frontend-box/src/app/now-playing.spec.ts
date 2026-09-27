import type { CurrentMPlayer } from './current.mplayer'
import type { CurrentSpotify } from './current.spotify'
import {
  rueckkehrZaehler,
  coverJetzt,
  coverFuerLokal,
  coverFuerPlayer,
  meldungUebernehmen,
  naechsterFortschritt,
  taktFuerDauer,
  TAKT_MAX_MS,
  TAKT_MIN_MS,
  KEIN_COVER,
  COVER_STALE_MS,
  type Fortschrittsanker,
  fortschrittJetzt,
  laeuftWeiter,
  toNowPlaying,
  interpretFuerLokal,
} from './now-playing'

describe('toNowPlaying', () => {
  const covers = new Map([['Das Pummeleinhorn|Intro', 'cover.jpg']])

  it('returns null when nothing is playing', () => {
    expect(toNowPlaying(null, null, covers)).toBeNull()
  })

  it('normalizes local mplayer playback (cover lookup + times)', () => {
    const lo = {
      currentPlayer: 'mplayer',
      playing: true,
      currentTrackname: 'Das Pummeleinhorn - Intro',
      album: 'Album',
      path: 'audiobook/Das Pummeleinhorn/Intro',
      timePos: 12,
      duration: 100,
      progressTime: 30,
    } as unknown as CurrentMPlayer
    const np = toNowPlaying(null, lo, covers)
    expect(np?.kind).toBe('local')
    expect(np?.title).toBe('Intro') // "Artist - " prefix stripped
    expect(np?.cover).toBe('cover.jpg')
    expect(np?.playing).toBe(true)
    expect(np?.elapsed).toBe(12)
    expect(np?.duration).toBe(100)
    // AUS elapsed/duration gerechnet (12 von 100), NICHT aus progressTime (30).
    // Der Fixture-Wert 30 steht absichtlich daneben: er zeigt, dass bei
    // brauchbarer Dauer die gerechnete Zahl gewinnt - progressTime ist nur der
    // Rueckfall (siehe Begruendung in now-playing.ts).
    //
    // Dieser Test erwartete bis 2026-07-28 die 30 und war damit falsch. Er ist
    // NIE aufgefallen, weil die Box-Tests gar nicht starteten: `.angular/cache`
    // gehoerte root (EACCES), und danach fehlte der Browser fuer Karma.
    expect(np?.progress).toBe(12)
  })

  it('normalizes spotify playback', () => {
    const sp = {
      is_playing: true,
      progress_ms: 30000,
      item: { name: 'Song', duration_ms: 100000, album: { name: 'Album', images: [{ url: 'sp.jpg' }] } },
    } as unknown as CurrentSpotify
    const np = toNowPlaying(sp, null, covers)
    expect(np?.kind).toBe('spotify')
    expect(np?.title).toBe('Song')
    expect(np?.subtitle).toBe('Album')
    expect(np?.cover).toBe('sp.jpg')
    expect(np?.elapsed).toBe(30)
    expect(np?.duration).toBe(100)
    expect(np?.progress).toBe(30)
  })

  it('lets local take precedence over spotify', () => {
    const sp = {
      is_playing: true,
      item: { name: 'Song', duration_ms: 1000, album: { name: 'A' } },
    } as unknown as CurrentSpotify
    const lo = {
      currentPlayer: 'mplayer',
      playing: true,
      currentTrackname: 'Local',
      path: 'x/y/z',
    } as unknown as CurrentMPlayer
    expect(toNowPlaying(sp, lo, covers)?.kind).toBe('local')
  })

  it('suppresses an endless/absurd duration (radio stream)', () => {
    const lo = {
      currentPlayer: 'mplayer',
      playing: true,
      currentTrackname: 'Radio',
      path: 'radio//',
      duration: 999999,
    } as unknown as CurrentMPlayer
    expect(toNowPlaying(null, lo, covers)?.duration).toBe(0)
  })
})

describe('fortschrittJetzt — zwischen zwei Meldungen weiterzaehlen', () => {
  // Anlass: der Balken lief in Stufen. Nicht wegen des Reglers (step=0.1) und
  // nicht wegen ganzzahliger Prozente, sondern weil die Oberflaeche nur
  // sekuendlich abholt und der CSS-Uebergang danach steht.
  const anker = (p: Partial<Fortschrittsanker> = {}): Fortschrittsanker => ({
    elapsed: 30,
    duration: 180,
    playing: true,
    stamp: 10_000,
    ...p,
  })

  it('zaehlt waehrend der Wiedergabe weiter', () => {
    expect(fortschrittJetzt(anker(), 10_000)).toBeCloseTo((30 / 180) * 100, 6)
    expect(fortschrittJetzt(anker(), 10_500)).toBeCloseTo((30.5 / 180) * 100, 6)
  })

  it('laeuft DURCHGEHEND — kein Stehen, kein Ruckeln zwischen zwei Meldungen', () => {
    // DIE ZUSAGE, die hier festgeschrieben wird (Wunsch des Nutzers,
    // 2026-07-28): "ich moechte gerne einen kontinuierlichen Fortschritt (am
    // Ende oder zu Beginn nehme ich einen Schritt hin)".
    //
    // Nachgestellt wird der Alltag: die Oberflaeche rechnet viermal je Sekunde
    // weiter, waehrend ein neuer Anker nur alle zwei Sekunden eintrifft - und
    // zwar mit etwas Netzunschaerfe, wie er wirklich ankommt. Ueber die ganze
    // Strecke darf der Balken dabei NIE stehenbleiben und NIE zurueckgehen.
    const dauer = 180
    let anker: Fortschrittsanker = { elapsed: 30, duration: dauer, playing: true, stamp: 10_000 }
    const jitter = [0, 120, -80, 150, -40, 90, -110, 60, 0, 130]
    let vorher = fortschrittJetzt(anker, 10_000) as number
    let kleinsterSchritt = Number.POSITIVE_INFINITY
    let groessterSchritt = 0

    for (let takt = 1; takt <= 40; takt++) {
      const jetzt = 10_000 + takt * 250
      // Alle zwei Sekunden trifft eine neue Meldung ein.
      if (takt % 8 === 0) {
        const versatz = jitter[(takt / 8) % jitter.length]
        anker = {
          elapsed: 30 + (jetzt - 10_000 + versatz) / 1000,
          duration: dauer,
          playing: true,
          stamp: jetzt,
        }
      }
      const jetztWert = fortschrittJetzt(anker, jetzt) as number
      const schritt = jetztWert - vorher
      expect(schritt).toBeGreaterThan(0)          // nie stehen, nie zurueck
      kleinsterSchritt = Math.min(kleinsterSchritt, schritt)
      groessterSchritt = Math.max(groessterSchritt, schritt)
      vorher = jetztWert
    }

    // Ein Viertelsekunden-Takt entspricht 0,25/180 = 0,139 % je Schritt.
    // Kein Schritt darf ein Vielfaches davon sein - sonst ruckelt es sichtbar.
    expect(groessterSchritt).toBeLessThan((0.25 / dauer) * 100 * 2)
    expect(kleinsterSchritt).toBeGreaterThan(0)
  })

  it('friert bei Pause ein — sonst laeuft der Balken im Stillstand weiter', () => {
    const a = anker({ playing: false })
    expect(fortschrittJetzt(a, 10_000)).toBeCloseTo((30 / 180) * 100, 6)
    expect(fortschrittJetzt(a, 20_000)).toBeCloseTo((30 / 180) * 100, 6)
  })

  it('laeuft nie ueber das Ende hinaus', () => {
    expect(fortschrittJetzt(anker({ elapsed: 179 }), 70_000)).toBe(100)
  })

  it('gibt null zurueck, wenn nichts zu rechnen ist', () => {
    // Radio hat keine Laenge; ohne Anker gibt es keinen Anfang. In beiden
    // Faellen soll der Aufrufer beim gemeldeten Wert bleiben statt zu raten.
    expect(fortschrittJetzt(null, 10_000)).toBeNull()
    expect(fortschrittJetzt(anker({ duration: 0 }), 10_000)).toBeNull()
    expect(fortschrittJetzt(anker({ duration: -5 }), 10_000)).toBeNull()
  })

  it('geht bei einer rueckwaerts laufenden Uhr nicht zurueck', () => {
    // Ein Sprung der Systemuhr darf den Balken nicht zurueckreissen.
    expect(fortschrittJetzt(anker(), 9_000)).toBeCloseTo((30 / 180) * 100, 6)
  })
})

describe('laeuftWeiter', () => {
  it('erkennt normales Weiterlaufen', () => {
    expect(laeuftWeiter(20, 21)).toBe(true)
    expect(laeuftWeiter(20, 20)).toBe(true)
  })

  it('erkennt Spulen und Titelwechsel als Sprung', () => {
    expect(laeuftWeiter(20, 80)).toBe(false)
    expect(laeuftWeiter(80, 20)).toBe(false)
    expect(laeuftWeiter(95, 2)).toBe(false)
  })
})

describe('rueckkehrZaehler — nicht mitten im Lied zur Liste zurueck', () => {
  // DER FEHLER: der Zaehler wurde nur hochgezaehlt und NIE zurueckgesetzt.
  // Jede voruebergehende "spielt nicht"-Meldung (Start, Titelwechsel,
  // Netzhaenger) brachte ihn naeher an die Schwelle, bis der Player mitten im
  // Lied zuklappte - je laenger gehoert wurde, desto sicherer.

  it('kehrt nach genug Meldungen HINTEREINANDER zurueck', () => {
    let z = 0
    for (let i = 0; i < 10; i++) {
      const r = rueckkehrZaehler(z, true, 10)
      z = r.zaehler
      expect(r.zurueck).toBe(false)
    }
    expect(rueckkehrZaehler(z, true, 10).zurueck).toBe(true)
  })

  it('faengt von vorn an, sobald wieder gespielt wird — DAS ist die Behebung', () => {
    let z = 0
    // Neun Stocker, dann laeuft es wieder.
    for (let i = 0; i < 9; i++) z = rueckkehrZaehler(z, true, 10).zaehler
    expect(z).toBe(9)
    z = rueckkehrZaehler(z, false, 10).zaehler
    expect(z).toBe(0)
    // Und jetzt darf ein einzelner Stocker nicht sofort zurueckfuehren.
    expect(rueckkehrZaehler(z, true, 10).zurueck).toBe(false)
  })

  it('ueberlebt einen langen Hoerabend mit vereinzelten Stockern', () => {
    // Genau der gemeldete Fall: hundert Titelwechsel, dazwischen laeuft es.
    let z = 0
    let zurueck = false
    for (let i = 0; i < 100; i++) {
      let r = rueckkehrZaehler(z, true, 10) // ein Stocker beim Wechsel
      z = r.zaehler
      zurueck = zurueck || r.zurueck
      for (let k = 0; k < 20; k++) {
        r = rueckkehrZaehler(z, false, 10) // dann laeuft es wieder
        z = r.zaehler
        zurueck = zurueck || r.zurueck
      }
    }
    expect(zurueck).toBe(false)
  })

  it('achtet die Schwelle (RSS wartet laenger)', () => {
    let z = 0
    for (let i = 0; i < 100; i++) z = rueckkehrZaehler(z, true, 100).zaehler
    expect(rueckkehrZaehler(z, true, 100).zurueck).toBe(true)
  })
})

describe('coverJetzt — das richtige Bild, weder zu frueh noch nie', () => {
  const basis = {
    liveCover: 'neu.jpg',
    eigenesCover: 'eigen.jpg',
    coverBeiEintritt: 'vorheriges.jpg',
    gestartet: true,
    seit: 1_000_000,
    jetzt: 1_001_000,
    istSpotify: true,
  }

  it('zeigt vor dem Start das eigene Bild — nie das des vorigen Stuecks', () => {
    expect(coverJetzt({ ...basis, gestartet: false })).toBe('eigen.jpg')
  })

  it('nimmt das Live-Bild, sobald es sich vom vorigen unterscheidet', () => {
    expect(coverJetzt(basis)).toBe('neu.jpg')
  })

  it('haelt kurz nach dem Start ein GLEICHES Bild noch zurueck', () => {
    // Es koennte noch die veraltete Meldung des vorigen Stuecks sein.
    const gleich = { ...basis, liveCover: 'vorheriges.jpg' }
    expect(coverJetzt(gleich)).toBe('eigen.jpg')
  })

  it('DER GEMELDETE FEHLER: dasselbe Album nochmal geoeffnet', () => {
    // Live-Bild == Bild beim Eintritt, weil genau dieses Album schon lief.
    // Die alte Regel sperrte deshalb FUER IMMER - und ohne eigenes Cover
    // blieb nur der Platzhalter. Nach Ablauf der Unsicherheit gilt es.
    const gleich = { ...basis, liveCover: 'vorheriges.jpg', jetzt: 1_000_000 + COVER_STALE_MS + 1 }
    expect(coverJetzt(gleich)).toBe('vorheriges.jpg')
    // Und ohne eigenes Cover ist der Unterschied sichtbar:
    expect(coverJetzt({ ...gleich, eigenesCover: null })).toBe('vorheriges.jpg')
    expect(coverJetzt({ ...gleich, eigenesCover: null, jetzt: 1_000_100 })).toBe(KEIN_COVER)
  })

  it('faellt auf den Platzhalter, wenn es nirgends ein Bild gibt', () => {
    expect(coverJetzt({ ...basis, liveCover: null, eigenesCover: null })).toBe(KEIN_COVER)
  })

  it('sperrt nur bei Spotify — Jellyfin und lokal melden sofort richtig', () => {
    const gleich = { ...basis, liveCover: 'vorheriges.jpg', istSpotify: false }
    expect(coverJetzt(gleich)).toBe('eigen.jpg')
  })

  it('kommt ohne bekannten Startzeitpunkt zurecht', () => {
    // seit=0 heisst "unbekannt" - dann nicht ewig sperren.
    const gleich = { ...basis, liveCover: 'vorheriges.jpg', seit: 0 }
    expect(coverJetzt(gleich)).toBe('vorheriges.jpg')
  })
})

describe('coverFuerLokal — das Cover auch bei Jellyfin finden', () => {
  // Die Karte, wie sie die Leiste wirklich baut: "Interpret|Titel" -> Bild.
  const karte = new Map<string, string>([
    ['Kapelle Petra|HAMM', 'hamm.jpg'],
    ['Das Pummeleinhorn|Intro', 'pummel.jpg'],
  ])

  it('DER GEMELDETE FALL: Jellyfin, leerer Pfad, Interpret im Album-Feld', () => {
    // Genau so gemessen (2026-07-28) waehrend "Kapelle Petra" lief:
    //   path = "", album = "Kapelle Petra", currentTrackname = ein Titel.
    // Der alte Schluessel war "|" und traf nie - obwohl das Bild in der Karte
    // stand.
    const lo = { path: '', album: 'Kapelle Petra', currentTrackname: 'Es war nicht alles schlecht' }
    expect(coverFuerLokal(lo, karte)).toBe('hamm.jpg')
  })

  it('findet eine lokale Datei weiterhin ueber den Pfad', () => {
    const lo = { path: 'audiobook/Das Pummeleinhorn/Intro', album: 'Intro' }
    expect(coverFuerLokal(lo, karte)).toBe('pummel.jpg')
  })

  it('der Pfad hat Vorrang vor dem Album-Feld', () => {
    // Wenn beides etwas findet, gewinnt das Genauere.
    const lo = { path: 'audiobook/Das Pummeleinhorn/Intro', album: 'Kapelle Petra' }
    expect(coverFuerLokal(lo, karte)).toBe('pummel.jpg')
  })

  it('liest das Album-Feld auch als ALBUM, nicht nur als Interpret', () => {
    // Die Quellen befuellen es uneinheitlich - beide Bedeutungen muessen gehen.
    const lo = { path: '', album: 'HAMM' }
    expect(coverFuerLokal(lo, karte)).toBe('hamm.jpg')
  })

  it('gibt null, wenn wirklich nichts passt — statt ein fremdes Bild zu zeigen', () => {
    expect(coverFuerLokal({ path: '', album: 'Gibtsnicht' }, karte)).toBe(null)
    expect(coverFuerLokal({ path: '', album: '' }, karte)).toBe(null)
  })

  it('haelt fehlende Angaben aus', () => {
    expect(coverFuerLokal(null, karte)).toBe(null)
    expect(coverFuerLokal({ album: 'Kapelle Petra' }, new Map())).toBe(null)
  })

  it('greift auch ueber toNowPlaying — dort wird es wirklich benutzt', () => {
    const lo = {
      currentPlayer: 'mplayer',
      playing: true,
      path: '',
      album: 'Kapelle Petra',
      currentTrackname: 'Es war nicht alles schlecht',
      timePos: 5,
      duration: 200,
    } as unknown as CurrentMPlayer
    expect(toNowPlaying(null, lo, karte)?.cover).toBe('hamm.jpg')
  })
})

describe('coverFuerPlayer — dasselbe Bild in klein UND gross', () => {
  const karte = new Map<string, string>([['Kapelle Petra|HAMM', 'hamm.jpg']])
  const lokal = { path: '', album: 'Kapelle Petra', currentTrackname: 'Es war nicht alles schlecht' }

  it('DER GEMELDETE FALL: aus der Leiste vergroessert, Jellyfin laeuft', () => {
    // Weg Leiste -> gross: die Wiedergabe laeuft schon, der Eintrag wurde nie
    // uebergeben (kein eigenes Cover). Vorher blieb hier nur das Symbol.
    expect(
      coverFuerPlayer({
        istSpotify: false,
        lokal,
        covers: karte,
        eigenesCover: null,
        gestartet: true,
        seit: 1_000_000,
        jetzt: 1_005_000,
      }),
    ).toBe('hamm.jpg')
  })

  it('klein und gross kommen zum GLEICHEN Bild — das ist der Sinn', () => {
    const klein = coverFuerLokal(lokal, karte)
    const gross = coverFuerPlayer({
      istSpotify: false, lokal, covers: karte, eigenesCover: null,
      gestartet: true, seit: 1_000_000, jetzt: 1_005_000,
    })
    expect(gross).toBe(klein)
  })

  it('nimmt das eigene Bild des Eintrags, wenn aus der Liste geoeffnet', () => {
    expect(
      coverFuerPlayer({
        istSpotify: false, lokal, covers: karte, eigenesCover: 'eigen.jpg',
        gestartet: true, seit: 1_000_000, jetzt: 1_005_000,
      }),
    ).toBe('eigen.jpg')
  })

  it('faellt auf den Platzhalter, wenn wirklich nichts da ist', () => {
    expect(
      coverFuerPlayer({
        istSpotify: false, lokal: { album: 'Gibtsnicht' }, covers: karte,
        eigenesCover: null, gestartet: true, seit: 1_000_000, jetzt: 1_005_000,
      }),
    ).toBe(KEIN_COVER)
  })

  it('laesst den Spotify-Weg unveraendert (samt Sperre gegen das alte Bild)', () => {
    const gemeinsam = {
      istSpotify: true, liveCover: 'vorheriges.jpg', coverBeiEintritt: 'vorheriges.jpg',
      eigenesCover: 'eigen.jpg', gestartet: true, seit: 1_000_000,
    }
    // Kurz nach dem Start noch gesperrt …
    expect(coverFuerPlayer({ ...gemeinsam, jetzt: 1_001_000 })).toBe('eigen.jpg')
    // … danach gilt das Live-Bild.
    expect(coverFuerPlayer({ ...gemeinsam, jetzt: 1_000_000 + COVER_STALE_MS + 1 })).toBe('vorheriges.jpg')
  })

  it('kommt ohne Karte und ohne Meldung zurecht', () => {
    expect(
      coverFuerPlayer({
        istSpotify: false, gestartet: false, seit: 0, jetzt: 1_000,
      }),
    ).toBe(KEIN_COVER)
  })
})

describe('Uebergaenge: klein <-> gross, direkt -> klein', () => {
  // WOFUER (Wunsch des Nutzers, 2026-07-28): "vielleicht sollte man in die
  // Tests noch den Wechsel zu gross mit reinnehmen - klein -> gross -> klein"
  // und "player direkt -> miniplayer".
  //
  // Getestet wird der KERN dieser Wege: welches Bild jede Ansicht bestimmt.
  // Genau dort lag der Fehler - unten ein Bild, oben ein Symbol -, und genau
  // das faellt in einer Navigationspruefung sonst durch alle Maschen.
  const karte = new Map<string, string>([
    ['Kapelle Petra|HAMM', 'hamm.jpg'],
    ['Das Pummeleinhorn|Intro', 'pummel.jpg'],
  ])
  const jellyfinLaeuft = { path: '', album: 'Kapelle Petra', currentTrackname: 'Ein Titel' }
  const zeit = { gestartet: true, seit: 1_000_000, jetzt: 1_005_000 }

  // Die gepruefte Funktion nimmt alle drei Felder OPTIONAL - die Hilfen hier
  // muessen das auch, sonst scheitert schon die Uebersetzung (von Karma
  // gefunden; vitest prueft keine Typen).
  type Lauf = { path?: string; album?: string; currentTrackname?: string }
  const klein = (lo: Lauf) => coverFuerLokal(lo, karte)
  const gross = (lo: Lauf, eigenes: string | null) =>
    coverFuerPlayer({ istSpotify: false, lokal: lo, covers: karte, eigenesCover: eigenes, ...zeit })

  it('KLEIN -> GROSS -> KLEIN: dasselbe Bild, nie der Platzhalter', () => {
    // Aus der Leiste vergroessert wird KEIN Eintrag uebergeben - deshalb null.
    const a = klein(jellyfinLaeuft)
    const b = gross(jellyfinLaeuft, null)
    const c = klein(jellyfinLaeuft)
    expect(a).toBe('hamm.jpg')
    expect(b).toBe('hamm.jpg')
    expect(c).toBe('hamm.jpg')
    for (const bild of [a, b, c]) expect(bild).not.toBe(KEIN_COVER)
  })

  it('DIREKT -> KLEIN: aus der Liste geoeffnet, dann verkleinert', () => {
    // Direkt geoeffnet gibt es das eigene Cover des Eintrags; die Leiste
    // danach findet es ueber die Karte. Beide zeigen etwas, keiner das Symbol.
    const b = gross(jellyfinLaeuft, 'hamm.jpg')
    const a = klein(jellyfinLaeuft)
    expect(b).toBe('hamm.jpg')
    expect(a).toBe('hamm.jpg')
  })

  it('haelt einen Titelwechsel waehrend des Wechselns aus', () => {
    // Zwischen "gross" und "klein" springt die Wiedergabe auf ein anderes
    // Album - beide Ansichten muessen dem folgen, nicht am alten kleben.
    const vorher = gross(jellyfinLaeuft, null)
    const danach = klein({ path: '', album: 'Das Pummeleinhorn', currentTrackname: 'X' })
    expect(vorher).toBe('hamm.jpg')
    expect(danach).toBe('pummel.jpg')
  })

  it('zeigt in BEIDEN Ansichten den Platzhalter, wenn es wirklich nichts gibt', () => {
    // Wichtig fuer die Ehrlichkeit: kein Bild ist eine gueltige Antwort -
    // aber dann in beiden Ansichten dieselbe.
    const unbekannt = { path: '', album: 'Gibtsnicht' }
    expect(klein(unbekannt)).toBe(null)
    expect(gross(unbekannt, null)).toBe(KEIN_COVER)
  })
})

describe('coverFuerPlayer — die Fallen des Ersatz-Mediums', () => {
  // AM GERAET GEMESSEN (2026-07-28), Jellyfin lief, Player aus der Leiste
  // geoeffnet:  [GROSS] 177px nocover_mupi.png  /  [LEISTE] 44px das echte Bild.
  // Ursache: die Seite baut beim Oeffnen aus der Leiste ein Ersatz-Medium mit
  //   { type: 'spotify', cover: '../assets/images/nocover_mupi.png' }
  // - also einen falschen Typ UND den Platzhalter als "eigenes Cover".
  const karte = new Map<string, string>([['Kapelle Petra|HAMM', 'hamm.jpg']])
  const lokal = { path: '', album: 'Kapelle Petra', currentTrackname: 'Ein Titel' }

  it('behandelt den Platzhalter NICHT als eigenes Bild', () => {
    expect(
      coverFuerPlayer({
        istSpotify: false, lokal, covers: karte,
        eigenesCover: '../assets/images/nocover_mupi.png',
        gestartet: true, seit: 1_000_000, jetzt: 1_005_000,
      }),
    ).toBe('hamm.jpg')
  })

  it('glaubt dem laufenden Dienst, nicht dem behaupteten Typ', () => {
    // Genau der gemessene Fall: type sagt spotify, gespielt wird Jellyfin.
    expect(
      coverFuerPlayer({
        istSpotify: true, liveCover: null, lokal, covers: karte,
        eigenesCover: '../assets/images/nocover_mupi.png',
        gestartet: true, seit: 1_000_000, jetzt: 1_005_000,
      }),
    ).toBe('hamm.jpg')
  })

  it('laesst echte Spotify-Wiedergabe unangetastet', () => {
    // Ohne lokale Meldung bleibt es der Spotify-Weg.
    expect(
      coverFuerPlayer({
        istSpotify: true, liveCover: 'spotify.jpg', coverBeiEintritt: 'altes.jpg',
        lokal: null, covers: karte, eigenesCover: null,
        gestartet: true, seit: 1_000_000, jetzt: 1_005_000,
      }),
    ).toBe('spotify.jpg')
  })
})


describe('meldungUebernehmen — warum die grosse Ansicht sprang', () => {
  // IM BROWSER GEMESSEN (2026-07-28): klein ruhig, gross 6 Ruecksprünge in
  // 12 Sekunden. Ursache: zwei Schreiber. Der 250-ms-Takt rechnet vorwaerts,
  // die eintreffende Meldung setzte danach den ROHEN - also aelteren - Wert.

  it('nimmt eine Meldung, die weiter ist', () => {
    expect(meldungUebernehmen(10, 10.4)).toBe(true)
    expect(meldungUebernehmen(10, 10)).toBe(true)
  })

  it('nimmt eine Meldung NICHT, die nur knapp hinterherhinkt — das ist der Fehler', () => {
    // Genau der gemessene Fall: hochgerechnet 10,2 %, gemeldet 10,0 %.
    expect(meldungUebernehmen(10.2, 10.0)).toBe(false)
    expect(meldungUebernehmen(50, 48.5)).toBe(false)
  })

  it('folgt einem ECHTEN Ruecksprung — Titelwechsel oder Zurueckspulen', () => {
    // Dort SOLL der Balken springen, sonst klebt er am alten Titel.
    expect(meldungUebernehmen(80, 2)).toBe(true)
    expect(meldungUebernehmen(50, 20)).toBe(true)
  })

  it('haelt Unsinn aus', () => {
    expect(meldungUebernehmen(10, Number.NaN)).toBe(false)
  })
})

describe('taktFuerDauer — bei kurzen Titeln feiner takten', () => {
  // DER ANLASS (Nutzer, 2026-07-28): "es springt deutlicher bei kurzen Titeln
  // auf der langen Leiste". Der Balken misst in PROZENT: eine Sekunde ist bei
  // 2 Minuten 0,83 %, bei 10 Minuten nur 0,17 % - fuenfmal so grosse Schritte.

  it('taktet bei kurzen Titeln schneller als bei langen', () => {
    expect(taktFuerDauer(60)).toBeLessThan(taktFuerDauer(240))
  })

  it('haelt einen Schritt bei rund einem Zehntelprozent', () => {
    // 120 s -> 120 ms je Schritt -> 0,1 % je Schritt.
    expect(taktFuerDauer(120)).toBe(120)
    expect(taktFuerDauer(200)).toBe(200)
  })

  it('wird nie traeger als bisher und nie hektischer als noetig', () => {
    expect(taktFuerDauer(3600)).toBe(TAKT_MAX_MS)
    expect(taktFuerDauer(10)).toBe(TAKT_MIN_MS)
  })

  it('faellt ohne brauchbare Dauer auf den bisherigen Takt zurueck', () => {
    expect(taktFuerDauer(0)).toBe(TAKT_MAX_MS)
    expect(taktFuerDauer(Number.NaN)).toBe(TAKT_MAX_MS)
    expect(taktFuerDauer(-5)).toBe(TAKT_MAX_MS)
  })
})

describe('naechsterFortschritt — nie rueckwaerts, ausser es ist echt', () => {
  it('geht vorwaerts mit', () => {
    expect(naechsterFortschritt(10, 10.4)).toBe(10.4)
  })

  it('haelt den knappen Rueckzieher auf — GENAU der gemessene Fall', () => {
    // Im Browser gemessen: 23,343 dann 23,076 - ein Rueckzieher von 0,267 %,
    // weil die eintreffende Meldung einen Moment alt war.
    expect(naechsterFortschritt(23.343, 23.076)).toBe(23.343)
  })

  it('folgt einem echten Sprung', () => {
    expect(naechsterFortschritt(80, 2)).toBe(2)
  })

  it('haelt Unsinn aus', () => {
    expect(naechsterFortschritt(10, Number.NaN)).toBe(10)
  })
})


describe('coverFuerPlayer — aus der Leiste geoeffnet, waehrend Spotify laeuft', () => {
  // IM BROWSER GEMESSEN (2026-07-28): die Leiste zeigte das Spotify-Cover, die
  // grosse Ansicht den Platzhalter. Ursache war der eigene Schutz: beim
  // Oeffnen aus der Leiste ist das "Bild beim Eintritt" DASSELBE wie das
  // laufende, also hielt die Sperre gegen das VORIGE Stueck genau das
  // richtige Bild zurueck.
  const gemeinsam = {
    istSpotify: true, liveCover: 'laeuft.jpg', coverBeiEintritt: 'laeuft.jpg',
    eigenesCover: '../assets/images/nocover_mupi.png',
    gestartet: true, seit: 1_000_000, jetzt: 1_001_000, lokal: null,
  }

  it('zeigt bei schon laufender Wiedergabe SOFORT das laufende Bild', () => {
    expect(coverFuerPlayer({ ...gemeinsam, extern: true })).toBe('laeuft.jpg')
  })

  it('haelt ohne "extern" weiterhin zurueck — der Schutz bleibt, wo er hingehoert', () => {
    // Hat DIESE Seite die Wiedergabe gestartet, kann die Meldung noch vom
    // vorigen Stueck sein. Dann gilt der Schutz wie bisher.
    expect(coverFuerPlayer({ ...gemeinsam, extern: false })).toBe(KEIN_COVER)
  })

  it('nimmt auch bei extern nichts Erfundenes, wenn es kein Bild gibt', () => {
    expect(coverFuerPlayer({ ...gemeinsam, extern: true, liveCover: null })).toBe(KEIN_COVER)
  })
})

// ── Der Interpret in der Naht (Vorarbeit E84/B2, Songtexte) ────────────────
//
// WARUM DIESE ZEUGEN SCHARF SIND: ein falscher Interpret ist schlimmer als
// keiner. LRCLIB fuehrt dieselbe Nummer vielfach; wer mit einem falschen Namen
// sucht, bekommt entweder nichts (harmlos) oder eine fremde Fassung, deren
// Zeitmarken um bis zu zweieinhalb Minuten danebenliegen (llmwiki
// `lrclib-fuehrt-dieselbe-nummer-vielfach`). Deshalb pruefen die letzten
// beiden Faelle ausdruecklich, dass NICHTS zurueckkommt.
describe('interpretFuerLokal', () => {
  it('nimmt den Interpreten aus dem Pfad einer lokalen Datei', () => {
    expect(interpretFuerLokal({ path: 'audiobook/Kapelle Petra/HAMM' })).toBe('Kapelle Petra')
  })

  it('nimmt das Praefix vor " - ", wenn kein Pfad da ist', () => {
    // Genau der Teil, den cleanTrackTitle fuer den Titel wegschneidet.
    expect(interpretFuerLokal({ currentTrackname: 'Rolf Zuckowski - Der Bewegungsbaer' })).toBe(
      'Rolf Zuckowski',
    )
  })

  it('liest bei Jellyfin den Interpreten aus dem album-Feld', () => {
    // Gemessen und in coverFuerLokal dokumentiert: Jellyfin meldet path LEER,
    // album traegt den INTERPRETEN, currentTrackname den blanken Titel.
    expect(
      interpretFuerLokal({ path: '', album: 'Kapelle Petra', currentTrackname: 'Es war nicht alles schlecht' }),
    ).toBe('Kapelle Petra')
  })

  it('bevorzugt den Pfad vor dem album-Feld — album ist mehrdeutig', () => {
    expect(
      interpretFuerLokal({ path: 'music/Nena/99 Luftballons', album: '99 Luftballons' }),
    ).toBe('Nena')
  })

  it('gibt LEER zurueck, wenn es nichts Belastbares gibt', () => {
    expect(interpretFuerLokal({})).toBe('')
    expect(interpretFuerLokal(null)).toBe('')
    expect(interpretFuerLokal(undefined)).toBe('')
  })

  it('raet NICHT aus einem Titel ohne Trennzeichen', () => {
    // "Laterne Laterne" ist ein Titel, kein Interpret. Wer ihn als Namen
    // weiterreicht, sucht bei LRCLIB nach einem Kuenstler, den es nicht gibt.
    expect(interpretFuerLokal({ currentTrackname: 'Laterne Laterne' })).toBe('')
  })

  it('faellt nicht auf einen Bindestrich ohne Leerzeichen herein', () => {
    // "Mecki-Messer" ist ein Wort mit Bindestrich, kein "Interpret - Titel".
    expect(interpretFuerLokal({ currentTrackname: 'Mecki-Messer' })).toBe('')
  })
})

describe('toNowPlaying — Interpret', () => {
  const covers = new Map<string, string>()

  it('traegt den Interpreten bei Spotify aus artists[0]', () => {
    const sp = {
      is_playing: true,
      progress_ms: 1000,
      item: { name: 'Creep', duration_ms: 239000, artists: [{ name: 'Radiohead' }] },
    } as unknown as CurrentSpotify
    expect(toNowPlaying(sp, null, covers)?.artist).toBe('Radiohead')
  })

  it('nimmt bei mehreren Interpreten den ersten', () => {
    const sp = {
      is_playing: true,
      item: { name: 'X', duration_ms: 1000, artists: [{ name: 'A' }, { name: 'B' }] },
    } as unknown as CurrentSpotify
    expect(toNowPlaying(sp, null, covers)?.artist).toBe('A')
  })

  it('bleibt leer, wenn Spotify keinen Interpreten meldet', () => {
    const sp = { is_playing: true, item: { name: 'X', duration_ms: 1000 } } as unknown as CurrentSpotify
    expect(toNowPlaying(sp, null, covers)?.artist).toBe('')
  })

  it('traegt den Interpreten bei lokaler Wiedergabe', () => {
    const lo = {
      currentPlayer: 'mplayer',
      playing: true,
      currentTrackname: 'Kapelle Petra - HAMM',
      path: 'audiobook/Kapelle Petra/HAMM',
      timePos: 5,
      duration: 100,
    } as unknown as CurrentMPlayer
    const np = toNowPlaying(null, lo, covers)
    expect(np?.artist).toBe('Kapelle Petra')
    // Der Titel bleibt unberuehrt — das Praefix gehoert dorthin NICHT.
    expect(np?.title).toBe('HAMM')
  })
})
