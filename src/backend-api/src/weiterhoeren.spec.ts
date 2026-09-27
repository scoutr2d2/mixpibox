import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Gespielt } from './gespielt'
import { medienSchluessel } from './medien'
import {
  anteil,
  FERTIG_ANTEIL,
  folgeWiederfinden,
  fortsetzenMit,
  istDurch,
  istWeiterhoerbar,
  MIN_ANTEIL,
  MIN_POSITION_S,
  nummerVerlaesslich,
  positionMs,
  positionProzent,
  type Stelle,
  stelleAus,
  stelleEinsetzen,
  stelleGiltFuer,
  titelNummer,
  ueberMpv,
  VON_VORN,
  weiterhoerbare,
  zusammenhangAus,
} from './weiterhoeren'

/**
 * Echte Form aus resume.json der Box, gekuerzt.
 *
 * `resumeVersatzGeprueft` STEHT HIER SEIT DEM 02.08.2026 und ist kein
 * Beiwerk: Es ist eine PLAYLIST, und ohne die Marke waere die Nummer die des
 * Stuecks in seinem Album — der Fehler, der ins falsche Kapitel sprang. Ein
 * Eintrag ohne Marke faellt jetzt aus der Reihe; das prueft weiter unten
 * „alte Staende aus der Album-Zaehlweise".
 */
const SPOTIFY: Stelle = {
  type: 'spotify',
  category: 'resume',
  playlistid: '1DYDHYJ98WZbHa2OZ4Dljg',
  artist: 'EUROPA Hörspiele & Kinderlieder',
  title: 'Hello Kitty - Alle Hörspiele',
  resumeVersatzGeprueft: true,
  resumespotifytrack_number: 2,
  resumespotifyprogress_ms: 28273,
  resumespotifyduration_ms: 299600,
}

/** Lokal: mpv meldet PROZENT, nicht Sekunden. */
const LOKAL: Stelle = {
  type: 'library',
  category: 'resume',
  artist: 'WDR',
  title: 'Die Maus',
  resumelocalalbum: 'audiobook',
  resumelocalcurrentTracknr: 3,
  resumelocalprogressTime: 41.5,
}

const RSS: Stelle = {
  type: 'rss',
  category: 'resume',
  id: 'http://feed.example.invalid/podcast.xml',
  artist: 'Kinderfunk',
  title: 'Gute Nacht Geschichten',
  resumerssprogressTime: 55,
}

describe('titelNummer', () => {
  it('liest Spotify und lokale Nummern', () => {
    assert.equal(titelNummer(SPOTIFY), 2)
    assert.equal(titelNummer(LOKAL), 3)
  })

  it('meldet 0, wenn der Dienst keine Nummer nennt', () => {
    assert.equal(titelNummer(RSS), 0)
    assert.equal(titelNummer({ type: 'spotify' }), 0)
  })
})

describe('positionMs / positionProzent', () => {
  it('gibt Millisekunden NUR bei Spotify', () => {
    assert.equal(positionMs(SPOTIFY), 28273)
    assert.equal(positionMs(LOKAL), null)
    assert.equal(positionMs(RSS), null)
  })

  it('gibt Prozent NUR bei mpv-Diensten', () => {
    // DIE FALLE DIESER DATEI: 41,5 ist PROZENT, nicht 41,5 Sekunden.
    assert.equal(positionProzent(LOKAL), 41.5)
    assert.equal(positionProzent(RSS), 55)
    assert.equal(positionProzent(SPOTIFY), null)
  })

  it('klemmt einen unsinnigen Prozentwert auf 0..100', () => {
    assert.equal(positionProzent({ type: 'library', resumelocalprogressTime: 140 }), 100)
    assert.equal(positionProzent({ type: 'library', resumelocalprogressTime: -3 }), null)
  })
})

describe('anteil', () => {
  it('rechnet bei Spotify aus Stelle und Laenge', () => {
    assert.ok(Math.abs((anteil(SPOTIFY) as number) - 28273 / 299600) < 1e-9)
  })

  it('nimmt bei mpv den Prozentwert', () => {
    assert.equal(anteil(LOKAL), 0.415)
  })

  it('meldet null ohne Laenge — statt etwas zu behaupten', () => {
    assert.equal(anteil({ type: 'spotify', resumespotifyprogress_ms: 5000 }), null)
    assert.equal(anteil({ type: 'spotify' }), null)
  })
})

describe('istWeiterhoerbar', () => {
  it('nimmt ein Album, das schon bei Titel 2 steht', () => {
    // Die 28 Sekunden zaehlen ab dem Anfang DIESES Stuecks — bei einem
    // spaeteren Titel sind sie kein Gegenbeweis, sondern der Normalfall.
    assert.equal(istWeiterhoerbar(SPOTIFY), true)
  })

  it('verwirft, wer nur kurz hineingehoert hat', () => {
    assert.equal(
      istWeiterhoerbar({
        ...SPOTIFY,
        resumespotifytrack_number: 1,
        resumespotifyprogress_ms: (MIN_POSITION_S - 5) * 1000,
      }),
      false,
    )
  })

  it('nimmt denselben Fall ab der Schwelle', () => {
    assert.equal(
      istWeiterhoerbar({
        ...SPOTIFY,
        resumespotifytrack_number: 1,
        resumespotifyprogress_ms: MIN_POSITION_S * 1000,
      }),
      true,
    )
  })

  it('verwirft, was praktisch durch ist — aber nur ohne Titelnummer', () => {
    const durch: Stelle = { ...RSS, resumerssprogressTime: FERTIG_ANTEIL * 100 + 1 }
    assert.equal(istWeiterhoerbar(durch), false)
    // Titel 5 kurz vor Schluss heisst NICHT, dass das Album durch ist.
    const spaet: Stelle = { ...SPOTIFY, resumespotifytrack_number: 5, resumespotifyprogress_ms: 299000 }
    assert.equal(istWeiterhoerbar(spaet), true)
    // UND AUCH TITEL 1 NICHT. Genau hier stand einmal `nr <= 1`, und damit fiel
    // ein Album, dessen erster Titel gleich zu Ende ist, aus der Reihe heraus —
    // obwohl in dem Augenblick elf Folgen davor lagen.
    const ersterFastDurch: Stelle = { ...SPOTIFY, resumespotifytrack_number: 1, resumespotifyprogress_ms: 299000 }
    assert.equal(istWeiterhoerbar(ersterFastDurch), true)
  })

  it('misst bei mpv in PROZENT, nicht in Sekunden', () => {
    // 1 % einer Datei ist „gerade erst angefangen" — auch wenn das bei einer
    // Stunde Hoerspiel 36 Sekunden waeren. Ohne Laenge gibt es keine bessere
    // Frage.
    const kaum: Stelle = { ...RSS, resumerssprogressTime: (MIN_ANTEIL * 100) / 2 }
    assert.equal(istWeiterhoerbar(kaum), false)
    assert.equal(istWeiterhoerbar({ ...RSS, resumerssprogressTime: MIN_ANTEIL * 100 }), true)
  })

  it('verwirft, was die Box gar nicht fortsetzen kann', () => {
    // Radio hat keine Stelle — ein Strom laeuft immer „jetzt", es gibt keinen
    // Ort, an den man zurueckkehrt.
    assert.equal(istWeiterhoerbar({ type: 'radio', id: 'http://x.invalid/s.mp3' }), false)
    // JELLYFIN STAND BIS ZUM 06.08.2026 HIER. Es steht jetzt in der Reihe —
    // aber nur mit seinen EIGENEN Feldern: ein `resumelocalcurrentTracknr` an
    // einem Jellyfin-Album ist kein Jellyfin-Stand, sondern ein Feld des
    // klassischen Players an einem Eintrag, den der gar nicht spielen kann.
    assert.equal(istWeiterhoerbar({ type: 'jellyfin-album', id: 'jf-1', resumejellyfincurrentTracknr: 4 }), true)
  })

  it('kommt mit Unsinn zurecht', () => {
    assert.equal(istWeiterhoerbar(null as never), false)
    assert.equal(istWeiterhoerbar({ type: 'spotify' }), false)
  })
})

describe('weiterhoerbare', () => {
  // DER VERLAUFSSCHLUESSEL IST NICHT DER MEDIENSCHLUESSEL. Er kommt aus
  // `meldungAusEintrag` und benutzt die ROHEN Namen (`library:WDR|Die Maus`),
  // waehrend `medienSchluessel` normalisiert (`lokal:t:wdr|die maus`). Die
  // erste Fassung dieses Tests verwechselte beide — die Sortierung sah dann
  // aus, als griffe der Verlauf nicht.
  const verlauf: Gespielt[] = [
    { key: 'spotify:1DYDHYJ98WZbHa2OZ4Dljg', anzahl: 3, zuletzt: 2_000 },
    { key: 'library:WDR|Die Maus', anzahl: 1, zuletzt: 9_000 },
  ]

  it('sortiert nach dem Verlauf — zuletzt Angefangenes zuerst', () => {
    const r = weiterhoerbare([SPOTIFY, LOKAL], verlauf)
    assert.deepEqual(
      r.map((z) => z.titel),
      ['Die Maus', 'Hello Kitty - Alle Hörspiele'],
    )
  })

  it('stellt Eintraege ohne Verlaufszeit hinten an, die juengsten davon zuerst', () => {
    // resume.json waechst per push — weiter hinten heisst spaeter eingefuegt.
    const a: Stelle = { ...RSS, id: 'a', title: 'Alt' }
    const b: Stelle = { ...RSS, id: 'b', title: 'Neu' }
    const r = weiterhoerbare([a, b, SPOTIFY], verlauf)
    assert.deepEqual(
      r.map((z) => z.titel),
      ['Hello Kitty - Alle Hörspiele', 'Neu', 'Alt'],
    )
  })

  it('laesst aus, was nicht weiterhoerbar ist', () => {
    const kurz: Stelle = { ...SPOTIFY, resumespotifytrack_number: 1, resumespotifyprogress_ms: 1000 }
    assert.deepEqual(weiterhoerbare([kurz], verlauf), [])
  })

  it('zeigt eine doppelte Stelle nur EINMAL — die hintere gewinnt', () => {
    // /api/addresume der Box haelt zwei Playlists faelschlich fuer denselben
    // Eintrag (beide `id` undefined) und legt deshalb Dubletten an.
    const alt: Stelle = { ...SPOTIFY, resumespotifytrack_number: 2 }
    const neu: Stelle = { ...SPOTIFY, resumespotifytrack_number: 7 }
    const r = weiterhoerbare([alt, neu], verlauf)
    assert.equal(r.length, 1)
    assert.equal(r[0].titelNr, 7)
  })

  it('haelt sich an die Hoechstzahl', () => {
    const viele = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ ...RSS, id: `f${i}` }) as Stelle)
    assert.equal(weiterhoerbare(viele, [], 6).length, 6)
  })

  it('kommt mit leeren Listen zurecht', () => {
    assert.deepEqual(weiterhoerbare([], []), [])
    assert.deepEqual(weiterhoerbare(undefined as never, undefined as never), [])
  })

  it('reicht Stelle und Einheit unveraendert an die Oberflaeche durch', () => {
    const [z] = weiterhoerbare([SPOTIFY], verlauf)
    assert.equal(z.titelNr, 2)
    assert.equal(z.positionMs, 28273)
    assert.equal(z.positionProzent, null)
    assert.equal(z.key, 'spotify:1DYDHYJ98WZbHa2OZ4Dljg')
  })
})

describe('stelleAus', () => {
  const rohSpotify = { type: 'spotify', id: '4aBcDeFgHiJkLmNoPqRsTu', title: 'A', artist: 'B', category: 'audiobook' }
  const rohLokal = { type: 'library', title: 'Die Maus', artist: 'WDR', category: 'audiobook' }

  it('rechnet fuer Spotify in MILLISEKUNDEN', () => {
    const s = stelleAus(rohSpotify, { titelNr: 3, bisher: 28.273, dauer: 299.6 })
    assert.equal(s?.resumespotifyprogress_ms, 28273)
    assert.equal(s?.resumespotifyduration_ms, 299600)
    assert.equal(s?.resumespotifytrack_number, 3)
    assert.equal(s?.category, 'resume')
  })

  it('verschiebt die Titelnummer NICHT', () => {
    // Der Abspieldienst zieht intern wieder eins ab. Wer hier +1 rechnet,
    // startet jedes Mal den Titel danach.
    assert.equal(stelleAus(rohSpotify, { titelNr: 1, bisher: 60, dauer: 200 })?.resumespotifytrack_number, 1)
  })

  it('rechnet fuer mpv in PROZENT und merkt sich die Kategorie', () => {
    const s = stelleAus(rohLokal, { titelNr: 2, bisher: 30, dauer: 120 })
    assert.equal(s?.resumelocalprogressTime, 25)
    assert.equal(s?.resumelocalcurrentTracknr, 2)
    assert.equal(s?.resumelocalalbum, 'audiobook')
    assert.equal(s?.resumespotifyprogress_ms, undefined)
  })

  it('merkt sich NICHTS ohne Laenge, wo Prozent gebraucht wird', () => {
    assert.equal(stelleAus(rohLokal, { titelNr: 1, bisher: 30, dauer: 0 }), null)
  })

  it('merkt sich Radio gar nicht — ein Strom hat keine Stelle', () => {
    assert.equal(stelleAus({ type: 'radio', id: 'http://x.invalid/s' }, { bisher: 90, dauer: 0 }), null)
    // JELLYFIN STAND BIS ZUM 06.08.2026 IN DIESER ZEILE. Am Geraet gemessen
    // war das die Ursache dafuer, dass die beiden Alben der Box .169 nie in
    // der Reihe landeten — und zwar VOR `istWeiterhoerbar`, das dadurch nie
    // etwas zu filtern bekam. Siehe „Jellyfin — ein Album ueber mpv" unten.
    assert.ok(stelleAus({ type: 'jellyfin-album', id: 'jf-1' }, { bisher: 90, dauer: 200 }))
  })

  it('lehnt Unsinn ab, statt eine echte Stelle mit 0 zu ueberschreiben', () => {
    assert.equal(stelleAus(null, { bisher: 10, dauer: 20 }), null)
    assert.equal(stelleAus(rohSpotify, { bisher: Number.NaN, dauer: 20 }), null)
  })
})

describe('stelleEinsetzen', () => {
  const s = (id: string, nr: number): Stelle => ({
    type: 'spotify',
    id,
    category: 'resume',
    resumespotifytrack_number: nr,
    resumespotifyprogress_ms: 60_000,
  })

  it('ersetzt ueber den Medienschluessel und haengt hinten an', () => {
    const liste = [s('a', 1), s('b', 1)]
    const raus = stelleEinsetzen(liste, s('a', 4), medienSchluessel)
    assert.deepEqual(
      raus.map((e) => `${e.id}:${e.resumespotifytrack_number}`),
      ['b:1', 'a:4'],
    )
  })

  it('wirft das AELTESTE heraus, wenn der Deckel erreicht ist', () => {
    const liste = [s('a', 1), s('b', 1), s('c', 1)]
    const raus = stelleEinsetzen(liste, s('d', 1), medienSchluessel, 3)
    assert.deepEqual(
      raus.map((e) => e.id),
      ['b', 'c', 'd'],
    )
  })

  it('laesst fremde Eintraege in der Datei stehen', () => {
    const fremd: Stelle = { type: 'spotify', id: 'x', category: 'audiobook' }
    const raus = stelleEinsetzen([fremd], s('y', 1), medienSchluessel)
    assert.equal(raus.length, 2)
  })

  // ── DER DECKEL ZAEHLT NUR GEMERKTE STELLEN (07.08.2026) ─────────────────
  //
  // Bis heute schnitt der Deckel ueber die GANZE Datei. Bei 6 gemerkten und 6
  // fremden Eintraegen und Deckel 3 blieben 3 Eintraege uebrig — 2 gemerkte
  // und 1 fremder: fuenf fremde weg, und der Deckel fuer die gemerkten gar
  // nicht getroffen. `remove_max_resume.sh` hat denselben Fehler heute
  // abgelegt und beruft sich seither im Klartext auf diese Funktion.
  it('kappt NUR die gemerkten Stellen und laesst fremde Eintraege alle stehen', () => {
    const liste: Stelle[] = []
    for (let i = 0; i < 6; i++) {
      liste.push(s(`r${i}`, 1))
      liste.push({ type: 'spotify', id: `f${i}`, category: 'audiobook' })
    }
    const raus = stelleEinsetzen(liste, s('neu', 1), medienSchluessel, 3)
    assert.equal(
      raus.filter((e) => e.category === 'resume').length,
      3,
      'genau so viele gemerkte Stellen wie der Deckel erlaubt',
    )
    assert.equal(raus.filter((e) => e.category !== 'resume').length, 6, 'kein einziger fremder Eintrag faellt weg')
    // Und es faellt das AELTESTE heraus, nicht irgendetwas.
    assert.deepEqual(
      raus.filter((e) => e.category === 'resume').map((e) => e.id),
      ['r4', 'r5', 'neu'],
    )
  })

  it('ist bei einer REINEN Liste Eintrag fuer Eintrag dasselbe wie vorher', () => {
    // Die Bedingung, unter der die Aenderung oben nichts aendert — und genau
    // so sieht jede resume.json auf einer Box aus (07.08.2026 an .169
    // nachgesehen: gast 9, kalea 7, alle `category: resume`).
    const liste = [s('a', 1), s('b', 1), s('c', 1), s('d', 1)]
    const raus = stelleEinsetzen(liste, s('e', 1), medienSchluessel, 3)
    assert.deepEqual(
      raus.map((e) => e.id),
      ['c', 'd', 'e'],
    )
  })

  it('ein Deckel von 0 heisst NULL gemerkte Stellen, nicht neun', () => {
    const fremd: Stelle = { type: 'spotify', id: 'x', category: 'audiobook' }
    const raus = stelleEinsetzen([s('a', 1), fremd], s('b', 1), medienSchluessel, 0)
    assert.deepEqual(
      raus.map((e) => e.id),
      ['x'],
      'die gemerkten Stellen sind weg, der fremde Eintrag steht',
    )
  })

  it('ein unbrauchbarer Deckel faellt weiter auf 9 zurueck', () => {
    const liste = Array.from({ length: 12 }, (_, i) => s(`w${i}`, 1))
    const raus = stelleEinsetzen(liste, s('neu', 1), medienSchluessel, Number.NaN)
    assert.equal(raus.length, 9)
  })
})

// ══════════════════════════════════════════════════════════════════════════
//  DER BEFUND VOM 02.08.2026: eine Playlist sprang ins falsche Kapitel
// ══════════════════════════════════════════════════════════════════════════
//
// SZENARIO AUS DEM BERICHT, Zeile fuer Zeile nachgebaut: Eine Hoerspiel-
// Playlist mit 300 Kapiteln. Das Kind hoert Kapitel 47. Dieses Stueck ist auf
// SEINEM Album Titel 3 — `item.track_number` aus Spotifys Wiedergabe-Auskunft
// meldet also 3, waehrend fortgesetzt wird ueber `offset.position` IN DER
// PLAYLIST. Gemerkt wurde 3, gelandet ist man bei Kapitel 3.
//
// Diese Tests waren ROT, bevor `zusammenhangAus`/`versatzNr` gebaut wurden.

/** Eine Playlist mit 300 Kapiteln, so wie `titelEinesWerks` sie liefert. */
const KAPITEL = Array.from({ length: 300 }, (_, i) => ({
  uri: `spotify:track:kapitel${i + 1}`,
  versatz: i,
}))

/** Der Roheintrag der Medienliste zu dieser Playlist. */
const HOERSPIELREIHE = {
  type: 'spotify',
  playlistid: '1DYDHYJ98WZbHa2OZ4Dljg',
  title: 'Die grosse Hoerspielreihe',
  artist: 'EUROPA',
  category: 'audiobook',
}

describe('zusammenhangAus — die Position IN DER PLAYLIST', () => {
  it('findet Kapitel 47 an Position 47, nicht an der Album-Nummer 3', () => {
    const z = zusammenhangAus(KAPITEL, 'spotify:track:kapitel47')
    assert.equal(z.versatzNr, 47)
    assert.equal(z.gesamt, 300)
  })

  it('ist 1-BASIERT — der erste Titel ist die 1, nicht die 0', () => {
    // Der Abspieldienst zieht intern wieder eins ab; 0 hiesse „von vorn".
    assert.equal(zusammenhangAus(KAPITEL, 'spotify:track:kapitel1').versatzNr, 1)
  })

  it('meldet 0, wenn das laufende Stueck nicht in der Liste steht', () => {
    // Vom Telefon dazwischengefunkt, oder die Playlist hat sich geaendert.
    assert.equal(zusammenhangAus(KAPITEL, 'spotify:track:fremd').versatzNr, 0)
    assert.equal(zusammenhangAus(KAPITEL, '').versatzNr, 0)
    assert.equal(zusammenhangAus([], 'spotify:track:kapitel3').versatzNr, 0)
  })

  it('zaehlt uebersprungene Titel mit — der Versatz ist die Stelle, nicht der Rang', () => {
    // `titelEinesWerks` laesst gesperrte/entfernte Titel weg, zaehlt den
    // Versatz aber weiter. Wer den Rang im Feld naehme, laege dahinter falsch.
    const mitLuecke = [
      { uri: 'spotify:track:a', versatz: 0 },
      { uri: 'spotify:track:c', versatz: 2 },
    ]
    assert.equal(zusammenhangAus(mitLuecke, 'spotify:track:c').versatzNr, 3)
    assert.equal(zusammenhangAus(mitLuecke, 'spotify:track:a').gesamt, 3)
  })
})

describe('stelleAus mit Zusammenhang — was in resume.json landet', () => {
  it('merkt die PLAYLIST-Position, nicht die Album-Nummer', () => {
    // DER BEFUND: `titelNr: 3` ist, was Spotify meldet (Titel 3 seines Albums).
    // Gemerkt werden muss 47 — sonst startet der Tipp Kapitel 3 der Playlist.
    const z = zusammenhangAus(KAPITEL, 'spotify:track:kapitel47')
    const s = stelleAus(HOERSPIELREIHE, { titelNr: 3, bisher: 92.5, dauer: 600 }, z)
    assert.equal(s?.resumespotifytrack_number, 47)
    assert.equal(s?.resumespotifyprogress_ms, 92500)
    assert.equal(s?.resumeVersatzGeprueft, true)
    assert.equal(s?.resumeGesamtTitel, 300)
  })

  it('merkt bei einer Playlist GAR NICHTS, solange die Position unbekannt ist', () => {
    // Lieber die vorige, richtige Stelle stehen lassen als eine falsche
    // darueberschreiben. Ohne Aufloesung waere `titelNr` die Album-Nummer.
    assert.equal(stelleAus(HOERSPIELREIHE, { titelNr: 3, bisher: 92.5, dauer: 600 }), null)
    assert.equal(stelleAus(HOERSPIELREIHE, { titelNr: 3, bisher: 92.5, dauer: 600 }, { versatzNr: 0, gesamt: 0 }), null)
  })

  it('laesst ein ALBUM auch ohne Aufloesung durch — dort stimmt die Nummer', () => {
    const album = { type: 'spotify', id: '4aBcDeFgHiJkLmNoPqRsTu', title: 'A', artist: 'B' }
    const s = stelleAus(album, { titelNr: 3, bisher: 60, dauer: 200 })
    assert.equal(s?.resumespotifytrack_number, 3)
    assert.equal(s?.resumeVersatzGeprueft, undefined)
  })
})

describe('alte Staende aus der Album-Zaehlweise', () => {
  /** So sieht ein Eintrag aus, den die klassische Oberflaeche geschrieben hat. */
  const ALT: Stelle = {
    type: 'spotify',
    category: 'resume',
    playlistid: '1DYDHYJ98WZbHa2OZ4Dljg',
    title: 'Die grosse Hoerspielreihe',
    artist: 'EUROPA',
    resumespotifytrack_number: 3,
    resumespotifyprogress_ms: 92_500,
    resumespotifyduration_ms: 600_000,
  }

  it('springt NICHT — ein Stand ohne Marke ist bei einer Playlist wertlos', () => {
    assert.equal(nummerVerlaesslich(ALT), false)
    assert.equal(istWeiterhoerbar(ALT), false)
    assert.deepEqual(weiterhoerbare([ALT], []), [])
  })

  it('nimmt denselben Stand MIT Marke an', () => {
    const neu: Stelle = { ...ALT, resumespotifytrack_number: 47, resumeVersatzGeprueft: true }
    assert.equal(nummerVerlaesslich(neu), true)
    assert.equal(istWeiterhoerbar(neu), true)
    assert.equal(weiterhoerbare([neu], [])[0].titelNr, 47)
  })

  it('laesst ALBEN und mpv-Eintraege unberuehrt — dort gab es die Falle nie', () => {
    const album: Stelle = { ...ALT, playlistid: undefined, id: '4aBcDeFgHiJkLmNoPqRsTu' }
    assert.equal(nummerVerlaesslich(album), true)
    assert.equal(nummerVerlaesslich(LOKAL), true)
    assert.equal(nummerVerlaesslich(RSS), true)
  })
})

describe('fertig gehoert — der letzte Titel, praktisch durch', () => {
  const DURCH: Stelle = {
    type: 'spotify',
    category: 'resume',
    playlistid: '1DYDHYJ98WZbHa2OZ4Dljg',
    title: 'Die grosse Hoerspielreihe',
    artist: 'EUROPA',
    resumeVersatzGeprueft: true,
    resumeGesamtTitel: 300,
    resumespotifytrack_number: 300,
    resumespotifyprogress_ms: 599_000,
    resumespotifyduration_ms: 600_000,
  }

  it('faellt aus der Reihe, wenn der LETZTE Titel praktisch durch ist', () => {
    assert.equal(istDurch(DURCH), true)
    assert.equal(istWeiterhoerbar(DURCH), false)
  })

  it('bleibt drin, solange noch Titel kommen', () => {
    assert.equal(istWeiterhoerbar({ ...DURCH, resumespotifytrack_number: 299 }), true)
  })

  it('bleibt drin, wenn der letzte Titel gerade erst laeuft', () => {
    assert.equal(istWeiterhoerbar({ ...DURCH, resumespotifyprogress_ms: 60_000 }), true)
  })

  it('entscheidet gar nichts ohne die Gesamtzahl — die alte Lage', () => {
    const ohne: Stelle = { ...DURCH, resumeGesamtTitel: undefined }
    assert.equal(istDurch(ohne), false)
    assert.equal(istWeiterhoerbar(ohne), true)
  })
})

describe('die Gesamtzahl bei mpv — sie kommt aus der Warteschlange', () => {
  /** Ein lokales Album, 12 Titel, der letzte laeuft und ist fast durch. */
  const ALBUM = { type: 'library', category: 'music', title: 'HAMM', artist: 'Kapelle Petra' }

  it('merkt sich, wie lang die Warteschlange war', () => {
    // GEMESSEN AM GERAET (2026-08-02): `/local` des Abspieldienstes liefert
    // `currentTracknr` und `totalTracks` im selben Paket wie die Stelle. Bei
    // Spotify stehen beide leer — deshalb ist diese Zahl nur der mpv-Weg.
    const s = stelleAus(ALBUM, { titelNr: 12, gesamt: 12, bisher: 175, dauer: 178 })
    assert.equal(s?.resumeGesamtTitel, 12)
    assert.equal(s?.resumelocalcurrentTracknr, 12)
  })

  it('laesst ein durchgehoertes lokales Album aus der Reihe fallen', () => {
    // DER OFFENE PUNKT VOM 02.08.2026, hier fuer mpv geschlossen: „Titel 12 zu
    // 98 %" war ohne die 12 nicht von „mittendrin" zu unterscheiden.
    const s = stelleAus(ALBUM, { titelNr: 12, gesamt: 12, bisher: 175, dauer: 178 }) as Stelle
    assert.equal(istDurch(s), true)
    assert.equal(istWeiterhoerbar(s), false)
  })

  it('laesst dasselbe Album drin, solange noch Titel kommen', () => {
    const s = stelleAus(ALBUM, { titelNr: 11, gesamt: 12, bisher: 175, dauer: 178 }) as Stelle
    assert.equal(istWeiterhoerbar(s), true)
  })

  it('behauptet ohne gemeldete Zahl weiterhin nichts', () => {
    const s = stelleAus(ALBUM, { titelNr: 12, bisher: 175, dauer: 178 }) as Stelle
    assert.equal(s.resumeGesamtTitel, undefined)
    assert.equal(istDurch(s), false)
  })

  it('nimmt bei Spotify die AUFGELOESTE Zahl, nicht die gemeldete', () => {
    // Sonst entschiede `istDurch` mal so, mal so — je nachdem, welche
    // Oberflaeche zuletzt gemeldet hat. Die Titelliste ist die genauere
    // Auskunft; `stand.gesamt` ist bei Spotify ohnehin immer 0.
    const z = zusammenhangAus(KAPITEL, 'spotify:track:kapitel47')
    const s = stelleAus(HOERSPIELREIHE, { titelNr: 3, gesamt: 7, bisher: 92.5, dauer: 600 }, z)
    assert.equal(s?.resumeGesamtTitel, 300)
  })

  // ── Der verschmolzene Fall (Gegenlesen 2026-08-03) ────────────────────────
  //
  // Eine verschmolzene Kachel traegt die Identitaet des SPOTIFY-Eintrags,
  // gespielt wird aber ueber Jellyfin. Der Server loest den Schluessel auf,
  // bekommt den Spotify-Eintrag — und die Meldung kommt trotzdem von mpv.
  /** Das Spotify-ALBUM, das auf der Box ueber Jellyfin spielt. */
  const VERSCHMOLZEN = { type: 'spotify', category: 'music', id: '0PyuOAMz1lv0z737JcQNOg', title: 'HAMM' }

  it('nimmt bei mpv-Meldung auf einen Spotify-Eintrag die GEMELDETE Zahl', () => {
    // Ohne `titelUri` gibt `zusammenhangFuer` sofort null zurueck — es gibt
    // also keine aufgeloeste Zahl, nur die aus der mpv-Warteschlange.
    const s = stelleAus(VERSCHMOLZEN, { titelNr: 12, gesamt: 12, bisher: 175, dauer: 178 }, null)
    assert.equal(s?.resumeGesamtTitel, 12)
  })

  it('laesst ein ueber Jellyfin durchgehoertes Album aus der Reihe fallen', () => {
    // OHNE DEN RUECKFALL BLIEB ES FUER IMMER STEHEN. Das Kind tippt auf
    // „Weiterhoeren" und landet in den letzten drei Sekunden des Albums.
    const s = stelleAus(VERSCHMOLZEN, { titelNr: 12, gesamt: 12, bisher: 175, dauer: 178 }, null) as Stelle
    assert.equal(istDurch(s), true)
    assert.equal(istWeiterhoerbar(s), false)
  })

  it('laesst dasselbe Album drin, solange noch Titel kommen', () => {
    const s = stelleAus(VERSCHMOLZEN, { titelNr: 5, gesamt: 12, bisher: 175, dauer: 178 }, null) as Stelle
    assert.equal(istWeiterhoerbar(s), true)
  })
})

describe('fortsetzenMit — die Stelle in der Einheit der Maschine, die gleich spielt', () => {
  /** Ein Spotify-Stand: Millisekunden UND Dauer, daraus faellt der Anteil ab. */
  const AUS_SPOTIFY = { positionMs: 92_500, positionProzent: null, anteil: 92_500 / 240_000 }
  /** Ein mpv-Stand: nur Prozent. Die Laenge des Titels steht nirgends. */
  const AUS_MPV = { positionMs: null, positionProzent: 41.5, anteil: 0.415 }

  it('reicht Millisekunden an Spotify durch', () => {
    assert.deepEqual(fortsetzenMit(AUS_SPOTIFY, 'spotify'), { positionMs: 92_500, positionProzent: null })
  })

  it('reicht Prozent an mpv durch', () => {
    assert.deepEqual(fortsetzenMit(AUS_MPV, 'lokal'), { positionMs: null, positionProzent: 41.5 })
  })

  it('RECHNET Spotify-Millisekunden in Prozent um, wenn ueber Jellyfin gespielt wird', () => {
    // GENAU DER FALL, um den es geht: „Das Lumpenpack" traegt die Identitaet
    // des Spotify-Eintrags, gespielt wird ueber Jellyfin. 92,5 s von 240 s
    // sind 38,5 % — keine Schaetzung, beide Zahlen stehen in resume.json.
    assert.deepEqual(fortsetzenMit(AUS_SPOTIFY, 'jellyfin'), { positionMs: null, positionProzent: 38.5 })
  })

  it('SCHICKT KEINE MILLISEKUNDEN IN EIN seekpos:', () => {
    // Der Fehler, den diese Funktion verhindert. `seekpos:92500` ist fuer mpv
    // „ganz ans Ende" — das Kind bekaeme den naechsten Titel statt seiner
    // Stelle. [resume-lokal-ist-prozent-nicht-sekunden]
    const raus = fortsetzenMit(AUS_SPOTIFY, 'jellyfin')
    assert.ok(raus.positionProzent !== null && raus.positionProzent <= 100)
    assert.equal(raus.positionMs, null)
  })

  it('macht aus einem mpv-Stand KEINE Millisekunden — die Laenge kennt niemand', () => {
    // Lieber von vorn als an einer erfundenen Stelle. Das Kind hoert eine
    // Folge noch einmal, statt in einer fremden Minute zu landen.
    assert.deepEqual(fortsetzenMit(AUS_MPV, 'spotify'), { positionMs: null, positionProzent: null })
  })

  it('gibt bei Radio und Unbekanntem gar nichts her', () => {
    assert.deepEqual(fortsetzenMit(AUS_SPOTIFY, 'radio'), { positionMs: null, positionProzent: null })
    assert.deepEqual(fortsetzenMit(AUS_SPOTIFY, ''), { positionMs: null, positionProzent: null })
  })

  it('vertraegt eine leere Zeile', () => {
    assert.deepEqual(fortsetzenMit(null, 'jellyfin'), { positionMs: null, positionProzent: null })
    assert.deepEqual(fortsetzenMit({ positionMs: null, positionProzent: null, anteil: null }, 'spotify'), {
      positionMs: null,
      positionProzent: null,
    })
  })

  it('deckelt einen krummen Anteil auf 100 Prozent', () => {
    assert.equal(fortsetzenMit({ positionMs: null, positionProzent: null, anteil: 7 }, 'jellyfin').positionProzent, 100)
  })

  it('weiss, welcher Dienst ueber mpv laeuft', () => {
    // Die Trennung, an der die Einheit haengt — sie steht an EINER Stelle.
    assert.equal(ueberMpv('lokal'), true)
    assert.equal(ueberMpv('jellyfin'), true)
    assert.equal(ueberMpv('rss'), true)
    assert.equal(ueberMpv('spotify'), false)
    assert.equal(ueberMpv('radio'), false)
  })
})

// ══ Die ARD Audiothek — eine rollende Folgenliste (05.08.2026) ══════════════
//
// Gemeldet als „die angespielten tracks landen nicht in weiterhoeren". Sie
// landeten nicht, weil `ard` in dieser Datei ueberhaupt nicht vorkam. Was
// beim Anschliessen zu bedenken war, ist NICHT die Schwelle oder die Einheit
// (die sind dieselben wie bei RSS), sondern die IDENTITAET der Folge: Hinter
// einer ARD-Kachel steht keine feste Titelliste. Kommt eine Folge dazu und
// ist „neueste zuerst" eingestellt, ruecken alle anderen um eins nach hinten —
// eine gemerkte Nummer zeigt danach in eine fremde Folge.
describe('ARD — eine gemerkte Stelle traegt die FOLGE, nicht bloss die Nummer', () => {
  /** Der Roheintrag, wie ihn `ard.ts eintragAus()` in data.json legt. */
  const SENDUNG = {
    type: 'ard',
    category: 'audiobook',
    id: '81889970',
    title: 'MausZoom — Kindernachrichten',
    artist: 'WDR',
    cover: 'https://api.ardaudiothek.de/bild/81889970_512.jpg',
  }

  /** Was die Oberflaeche meldet: mpv zaehlt seine Warteschlange. */
  const STAND = { titelNr: 7, gesamt: 30, bisher: 249, dauer: 600 }

  it('merkt Folge, Nummer und Prozent — und die Gesamtzahl fuer „durch"', () => {
    const s = stelleAus(SENDUNG, STAND, { versatzNr: 7, gesamt: 30, folge: '16657073' })
    assert.equal(s?.resumeardfolge, '16657073')
    assert.equal(s?.resumeardcurrentTracknr, 7)
    // 249 von 600 Sekunden sind 41,5 Prozent — mpv rechnet in Prozent, nicht
    // in Millisekunden (llmwiki resume-lokal-ist-prozent-nicht-sekunden).
    assert.equal(s?.resumeardprogressTime, 41.5)
    assert.equal(s?.resumeGesamtTitel, 30)
    assert.equal(positionProzent(s as Stelle), 41.5)
    assert.equal(titelNummer(s as Stelle), 7)
  })

  it('merkt GAR NICHTS, solange die Folge unbekannt ist', () => {
    // Dieselbe Entscheidung wie bei der Spotify-Playlist: Lieber die vorige,
    // richtige Stelle stehen lassen als eine schreiben, die morgen in eine
    // andere Folge zeigt.
    assert.equal(stelleAus(SENDUNG, STAND), null)
    assert.equal(stelleAus(SENDUNG, STAND, { versatzNr: 7, gesamt: 30 }), null)
    assert.equal(stelleAus(SENDUNG, STAND, { versatzNr: 7, gesamt: 30, folge: '   ' }), null)
  })

  it('DIE TONADRESSE STEHT IN KEINEM FELD DER STELLE', () => {
    /*
     * DAS IST DIE ACHSE DES GANZEN ARD-MODULS, und hier waere sie am
     * leichtesten zu unterlaufen: `stelleAus` baut die Stelle als `{...roh}`,
     * also aus dem Roheintrag. Traegt der eines Tages eine Tonadresse — weil
     * jemand sie „zum Nachschlagen" in data.json legt —, stuende sie ab diesem
     * Augenblick in resume.json und ueber die Netz-Skripte auch in
     * offline_resume.json. Gemessen am 04.08.2026: Folge 16657073 lief am
     * 2026-06-29 ab und antwortete mit 404, WAEHREND die Schnittstelle sie
     * weiter auflistete. Eine festgeschriebene Adresse waere eine gemerkte
     * Stelle mit Verfallsdatum, und auffallen wuerde sie erst, wenn ein Kind
     * drueckt.
     *
     * DER TEST PRUEFT DEN GANZEN EINTRAG, nicht die drei neuen Felder: Die
     * Frage ist nicht „habe ich sie in `resumeardfolge` geschrieben?", sondern
     * „kann sie IRGENDWO herauskommen?".
     */
    const mitAdresse = { ...SENDUNG, abspielbefehl: 'ard/https%3A%2F%2Fwdr.de%2Ff.mp3/Folge:title:artist:WDR' }
    const s = stelleAus(mitAdresse, STAND, { versatzNr: 7, gesamt: 30, folge: '16657073' })
    assert.ok(s)
    const alsText = JSON.stringify(s)
    assert.ok(!/https?:\/\/[^"]*\.mp3/i.test(alsText), `Tonadresse in der Stelle: ${alsText}`)
    // Und die Sendungskennung ist trotzdem da — ohne sie faende die Box das
    // Werk nicht wieder.
    assert.equal(s?.id, '81889970')
  })

  it('kommt in die Reihe — mit Folge, ohne sie nicht', () => {
    const mit = stelleAus(SENDUNG, STAND, { versatzNr: 7, gesamt: 30, folge: '16657073' }) as Stelle
    assert.equal(nummerVerlaesslich(mit), true)
    assert.equal(istWeiterhoerbar(mit), true)
    const zeile = weiterhoerbare([mit], [])[0]
    assert.equal(zeile.typ, 'ard')
    assert.equal(zeile.titelNr, 7)
    assert.equal(zeile.positionProzent, 41.5)
    // DIE KENNUNG REIST MIT — die Oberflaeche sucht sie in der frisch geholten
    // Liste wieder, statt auf `titelNr` zu vertrauen.
    assert.equal(zeile.folge, '16657073')

    // Ein Stand aus der Zeit vor dem 05.08.2026 traegt keine Folge. Er ist
    // nicht ungenau, er ist unbrauchbar — und faellt deshalb aus der Reihe.
    const alt: Stelle = { ...SENDUNG, category: 'resume', resumeardcurrentTracknr: 7, resumeardprogressTime: 41.5 }
    assert.equal(nummerVerlaesslich(alt), false)
    assert.equal(istWeiterhoerbar(alt), false)
    assert.deepEqual(weiterhoerbare([alt], []), [])
  })

  it('faellt aus der Reihe, wenn die LETZTE Folge praktisch durch ist', () => {
    const durch = stelleAus(
      SENDUNG,
      { titelNr: 30, gesamt: 30, bisher: 594, dauer: 600 },
      { versatzNr: 30, gesamt: 30, folge: '16660000' },
    ) as Stelle
    assert.equal(anteil(durch), 0.99)
    assert.equal(istDurch(durch), true)
    assert.equal(istWeiterhoerbar(durch), false)
  })

  it('laeuft ueber mpv und bekommt seine Stelle in PROZENT', () => {
    assert.equal(ueberMpv('ard'), true)
    const zeile = { positionMs: null, positionProzent: 41.5, anteil: 0.415 }
    assert.deepEqual(fortsetzenMit(zeile, 'ard'), { positionMs: null, positionProzent: 41.5 })
    // Und eine bei SPOTIFY gemerkte Stelle, die ueber die ARD gespielt wird,
    // wird umgerechnet statt durchgereicht — sonst kaeme `seekpos:92500`
    // heraus, und mpv nimmt alles ueber 100 als „ganz ans Ende".
    assert.deepEqual(fortsetzenMit({ positionMs: 92_500, positionProzent: null, anteil: 0.25 }, 'ard'), {
      positionMs: null,
      positionProzent: 25,
    })
  })

  it('GILT NUR FUER DIE ARD — spielt eine andere Quelle, faengt es von vorn an', () => {
    /*
     * BEFUND BEIM GEGENLESEN (06.08.2026). `verschmelzung.ts` begruendet, warum
     * `ard` nicht in QUELLEN_REIHENFOLGE steht, mit genau diesem Fall: „Eine
     * verschmolzene Kachel, deren bevorzugte Quelle wechselt, verloere ihre
     * Stelle STILL: die Zeile bliebe stehen, der Tipp finge von vorn an."
     * Nur TAT der Code das nicht — `fortsetzenMit` nimmt der Stelle bei einem
     * Quellenwechsel die POSITION, aber die TITELNUMMER reiste unveraendert
     * mit. Aus „Folge 7 der ARD-Sendung" wurde „Kapitel 7 des Spotify-Werks".
     *
     * ERREICHBAR OHNE FEHLBEDIENUNG: `abgleich.ts` schlaegt die Zuordnung von
     * sich aus vor, weil eine ARD-Sendung und ein Spotify-Hoerbuch gleichen
     * Titels in EINE Gruppe fallen (ard.spec.ts). Der Erwachsene nimmt an — es
     * IST dieselbe Sendung. Nur nicht dieselbe Folgenreihe.
     */
    const mit = stelleAus(SENDUNG, STAND, { versatzNr: 7, gesamt: 30, folge: '16657073' }) as Stelle
    const zeile = weiterhoerbare([mit], [])[0]
    assert.equal(zeile.folge, '16657073')

    assert.equal(stelleGiltFuer(zeile, 'ard'), true)
    assert.equal(stelleGiltFuer(zeile, 'spotify'), false)
    assert.equal(stelleGiltFuer(zeile, 'lokal'), false)
    assert.equal(stelleGiltFuer(zeile, 'jellyfin'), false)

    // Eine Zeile OHNE Folgenkennung ist keine ARD-Stelle und bleibt unberuehrt
    // — ein verschmolzenes Album zaehlt seine Spuren in beiden Welten gleich.
    assert.equal(stelleGiltFuer({ positionMs: 1, positionProzent: null, anteil: null } as never, 'spotify'), true)
    assert.equal(stelleGiltFuer(null, 'spotify'), true)

    // Und was dann herausgeht, ist NICHTS: keine Nummer, keine Stelle — und
    // seit dem 06.08.2026 auch keine FOLGE mehr.
    //
    // DAS WAR EINE LUECKE, und sie wurde erst mit dem Folgentitel gefaehrlich:
    // `VON_VORN` raeumte Nummer und Position weg, `folge` blieb stehen. Solange
    // niemand sie las, war das folgenlos. Der Folgentitel wird GELESEN — er
    // steht auf der Kachel. Eine Kachel, auf der „Der Schneemann taut" steht
    // waehrend die Box ein Spotify-Hoerbuch von vorn anfaengt, ist eine
    // Anzeige, die luegt.
    const vonVorn = { ...zeile, ...VON_VORN }
    assert.equal(vonVorn.titelNr, 0)
    assert.equal(vonVorn.positionMs, null)
    assert.equal(vonVorn.positionProzent, null)
    assert.equal(vonVorn.anteil, null)
    assert.equal(vonVorn.folge, undefined)
    assert.equal(vonVorn.folgeTitel, undefined)
    // Und in der Antwort taucht keines der beiden Felder mehr auf: `undefined`
    // faellt bei `JSON.stringify` heraus, ein leerer String wuerde bleiben.
    const alsText = JSON.stringify(vonVorn)
    assert.ok(!alsText.includes('folge'), alsText)
  })
})

// ══ DER FOLGENTITEL — Rueckfall UND Beschriftung (06.08.2026) ═══════════════
//
// ZWEI DINGE AUF EINMAL, und das ist Absicht statt Sparsamkeit: Derselbe Name
// beantwortet „welche Folge war das?" (wenn die Kennung nicht mehr trifft) und
// „was soll auf der Kachel stehen?" (bisher „Titel 3"). Ihn zweimal zu
// beschaffen hiesse, zwei Wahrheiten ueber dieselbe Folge zu fuehren.
describe('ARD — der Folgentitel als Rueckfall, wenn die Kennung nicht mehr trifft', () => {
  const SENDUNG = {
    type: 'ard',
    category: 'audiobook',
    id: '81889970',
    title: 'Die Maus zum Hören',
    artist: 'Die Maus',
  }
  const STAND = { titelNr: 7, gesamt: 30, bisher: 249, dauer: 600 }

  /** Die Liste, wie `/inhalt` sie frisch geholt hat. */
  const LISTE = [
    { kennung: '16600001', titel: 'Fälschung' },
    { kennung: '16600002', titel: 'Der Schneemann taut' },
    { kennung: '16600003', titel: 'Wie kommt der Strom in die Steckdose?' },
  ]

  it('merkt den Titel mit — aber NICHT als Pflichtfeld', () => {
    const mit = stelleAus(SENDUNG, STAND, {
      versatzNr: 7,
      gesamt: 30,
      folge: '16657073',
      folgeTitel: 'Der Schneemann taut',
    })
    assert.equal(mit?.resumeardfolgentitel, 'Der Schneemann taut')

    // OHNE Titel wird trotzdem gemerkt — sonst fiele eine brauchbare Stelle
    // wegen einer Kosmetik weg. Die KENNUNG bleibt Pflicht.
    const ohne = stelleAus(SENDUNG, STAND, { versatzNr: 7, gesamt: 30, folge: '16657073' })
    assert.equal(ohne?.resumeardfolge, '16657073')
    assert.equal(ohne?.resumeardfolgentitel, undefined)
    assert.equal(istWeiterhoerbar(ohne as Stelle), true)

    // Und ein leerer Titel legt kein leeres Feld an.
    const leer = stelleAus(SENDUNG, STAND, { versatzNr: 7, gesamt: 30, folge: '16657073', folgeTitel: '  ' })
    assert.equal(leer?.resumeardfolgentitel, undefined)
  })

  /* ══ E46 — DAS BILD DER FOLGE ═════════════════════════════════════════
   *
   * Betreiber, 19.08.2026: „beim weiterspielen ist beim mauszoom nicht das
   * richtige bild." Die Plakette trug den richtigen Folgennamen, das Bild
   * darunter das Sendungscover — die Zeile kannte gar kein Folgenbild.
   */
  it('merkt das Bild der Folge — und legt ohne Bild kein leeres Feld an', () => {
    const mit = stelleAus(SENDUNG, STAND, {
      versatzNr: 7,
      gesamt: 30,
      folge: '16657073',
      folgeBild: 'https://api.ardaudiothek.de/image/folge-7',
    })
    assert.equal(mit?.resumeardfolgenbild, 'https://api.ardaudiothek.de/image/folge-7')

    // Ohne Bild wird die Stelle trotzdem gemerkt — wie beim Titel: eine
    // brauchbare Stelle faellt nicht wegen einer Kosmetik weg.
    const ohne = stelleAus(SENDUNG, STAND, { versatzNr: 7, gesamt: 30, folge: '16657073' })
    assert.equal(ohne?.resumeardfolgenbild, undefined)
    assert.equal(istWeiterhoerbar(ohne as Stelle), true)

    const leer = stelleAus(SENDUNG, STAND, { versatzNr: 7, gesamt: 30, folge: '16657073', folgeBild: '  ' })
    assert.equal(leer?.resumeardfolgenbild, undefined)
  })

  it('reicht das Folgenbild in die Zeile durch', () => {
    const mit = stelleAus(SENDUNG, STAND, {
      versatzNr: 7,
      gesamt: 30,
      folge: '16657073',
      folgeBild: 'https://api.ardaudiothek.de/image/folge-7',
    }) as Stelle
    assert.equal(weiterhoerbare([mit], [])[0].folgeBild, 'https://api.ardaudiothek.de/image/folge-7')
  })

  it('VON_VORN raeumt das Folgenbild mit weg — wie Folge und Titel', () => {
    // GEGENPROBE zur Falle, die beim Folgentitel schon einmal zuschlug: eine
    // Kachel, die von vorn anfaengt, darf nicht das Gesicht der Folge tragen,
    // die gerade NICHT mehr gilt.
    const zeile = weiterhoerbare(
      [
        stelleAus(SENDUNG, STAND, {
          versatzNr: 7,
          gesamt: 30,
          folge: '16657073',
          folgeTitel: 'Der Schneemann taut',
          folgeBild: 'https://api.ardaudiothek.de/image/folge-7',
        }) as Stelle,
      ],
      [],
    )[0]
    assert.equal(zeile.folgeBild, 'https://api.ardaudiothek.de/image/folge-7')
    const vonVorn = { ...zeile, ...VON_VORN }
    assert.equal(vonVorn.folgeBild, undefined)
    assert.equal(vonVorn.folgeTitel, undefined)
    assert.equal(vonVorn.folge, undefined)
  })

  it('reicht ihn in die Zeile durch — und nur bei der ARD', () => {
    const mit = stelleAus(SENDUNG, STAND, {
      versatzNr: 7,
      gesamt: 30,
      folge: '16657073',
      folgeTitel: 'Der Schneemann taut',
    }) as Stelle
    assert.equal(weiterhoerbare([mit], [])[0].folgeTitel, 'Der Schneemann taut')
    // Eine Spotify-Zeile bekommt KEIN leeres Feld — das waere eine Auskunft,
    // die keine ist.
    assert.equal(weiterhoerbare([SPOTIFY], [])[0].folgeTitel, undefined)
  })

  it('DIE KENNUNG GEWINNT — auch wenn ein Titel woanders auch passt', () => {
    assert.equal(folgeWiederfinden(LISTE, { kennung: '16600003', titel: 'Fälschung', nr: 1 }), 3)
  })

  it('DER TITEL IST DER RUECKFALL — und das ist der gemessene Fall', () => {
    /*
     * AM 04.08.2026 GEMESSEN: Folge 16657073 antwortete mit 404, WAEHREND die
     * Schnittstelle sie weiter auflistete. Die Audiothek setzt Folgen unter
     * neuer Kennung wieder ein — dann steht dieselbe Folge in der Liste, und
     * ohne diesen Rueckfall bekaeme das Kind „Diese Folge gibt es nicht mehr"
     * fuer eine Folge, die dasteht.
     */
    assert.equal(folgeWiederfinden(LISTE, { kennung: '16657073', titel: 'Der Schneemann taut' }), 2)
    // Ohne Kennung genauso — eine Stelle darf auch nur den Titel tragen.
    assert.equal(folgeWiederfinden(LISTE, { titel: 'Fälschung' }), 1)
    // Gross- und Kleinschreibung und Satzzeichen trennen nicht: die Audiothek
    // schreibt einen wieder eingesetzten Titel nicht immer Zeichen fuer Zeichen
    // gleich.
    assert.equal(folgeWiederfinden(LISTE, { titel: 'wie kommt der strom in die steckdose' }), 3)
  })

  it('DIE POSITION IST DER SCHIEDSRICHTER — aber nur bei doppelten Titeln', () => {
    const doppelt = [
      { kennung: 'a', titel: 'Teil 1' },
      { kennung: 'b', titel: 'Teil 1' },
      { kennung: 'c', titel: 'Teil 2' },
    ]
    // Zweimal derselbe Titel, und die gemerkte Nummer zeigt auf den zweiten.
    assert.equal(folgeWiederfinden(doppelt, { kennung: 'weg', titel: 'Teil 1', nr: 2 }), 2)
    // Ohne Nummer ist nichts entscheidbar — dann NICHTS, wie bisher.
    assert.equal(folgeWiederfinden(doppelt, { kennung: 'weg', titel: 'Teil 1' }), 0)
    // Und eine Nummer, die auf keinen der Kandidaten zeigt, entscheidet nicht:
    // sie gehoert dann zu einer anderen Folge und waere ein Fehlgriff.
    assert.equal(folgeWiederfinden(doppelt, { kennung: 'weg', titel: 'Teil 1', nr: 3 }), 0)
  })

  it('IM ZWEIFEL NICHTS — die Position allein entscheidet NIE', () => {
    // Der Kern der ganzen Regel: Eine gemerkte Nummer ohne Kennung und ohne
    // Titel darf nichts treffen. Genau daraus entstand die rollende Falle
    // (llmwiki ard-folgenliste-rollt).
    assert.equal(folgeWiederfinden(LISTE, { nr: 2 }), 0)
    assert.equal(folgeWiederfinden(LISTE, { kennung: 'weg', nr: 2 }), 0)
    assert.equal(folgeWiederfinden(LISTE, { kennung: 'weg', titel: 'Gibt es nicht', nr: 2 }), 0)
    assert.equal(folgeWiederfinden(LISTE, null), 0)
    assert.equal(folgeWiederfinden([], { kennung: '16600001' }), 0)
  })

  it('INTERPRET UND LAENGE SPIELEN NICHT MIT — sie wurden gemessen und trugen NICHTS bei', () => {
    /*
     * An den 30 Folgen der Maus-Sendung gezaehlt (04.08.2026): EIN Interpret
     * („Die Maus") und EINE Laenge (3606000 ms) fuer alle dreissig, aber
     * dreissig verschiedene Titel. Eine Pruefung, die nie nein sagen kann, ist
     * keine — sie erzeugte nur das Gefuehl, mehrfach abgesichert zu sein.
     *
     * DER TEST HAELT DIE SIGNATUR FEST: Was hier hereingeht, ist Kennung,
     * Titel, Nummer. Wer Interpret oder Laenge nachtraegt, muss diese Zeile
     * anfassen und dabei die Messung lesen.
     */
    const mitBallast = [
      { kennung: 'a', titel: 'Fälschung', interpret: 'Die Maus', dauerMs: 3_606_000 },
      { kennung: 'b', titel: 'Der Schneemann taut', interpret: 'Die Maus', dauerMs: 3_606_000 },
    ]
    // Ein FALSCHER Interpret aendert nichts — er wird gar nicht angesehen.
    assert.equal(folgeWiederfinden(mitBallast, { titel: 'Der Schneemann taut' }), 2)
  })
})

// ══ JELLYFIN — gemessen am Geraet, und es waren ZWEI Tore (06.08.2026) ══════
//
// Auf der Box .169 liegen zwei Jellyfin-Alben; keines landete je in der Reihe.
// Naheliegend war die Aufzaehlung in `istWeiterhoerbar` — sie war aber nur das
// ZWEITE Tor. Gemessen (tools/stelle-je-dienst-am-geraet.mjs, „HAMM", 12 s
// gespielt): `POST /api/weiterhoeren` antwortete `{"status":"nichtMerkbar"}`,
// resume.json blieb bytegleich, 0 Eintraege mit `type: jellyfin*`. Es wurde gar
// nichts geschrieben, was `istWeiterhoerbar` haette filtern koennen — `stelleAus`
// fiel fuer `jellyfin` unten auf `return null` durch.
describe('Jellyfin — ein Album ueber mpv bekommt seine Stelle gemerkt', () => {
  const ALBUM = {
    type: 'jellyfin-album',
    category: 'music',
    id: '7d9a37e2c0b14e2f9c3a1d5e8b7f4a60',
    title: 'HAMM',
    artist: 'Kapelle Petra',
  }
  /** Am Geraet gemessen: Titel 2, rund 15 s von rund 200 s (Box .169, „HAMM"). */
  const STAND = { titelNr: 2, gesamt: 4, bisher: 15, dauer: 200 }

  it('DAS ERSTE TOR: `stelleAus` schreibt jetzt eine Stelle — vorher NICHTS', () => {
    const s = stelleAus(ALBUM, STAND)
    assert.ok(s, 'ohne die Reparatur gibt stelleAus hier null — der Server antwortet nichtMerkbar')
    assert.equal(s?.resumejellyfincurrentTracknr, 2)
    // PROZENT wie lokal und RSS — ein Jellyfin-Album laeuft ueber mpv.
    assert.equal(s?.resumejellyfinprogressTime, 7.5)
    assert.equal(s?.resumeGesamtTitel, 4)
    assert.equal(positionProzent(s as Stelle), 7.5)
    assert.equal(titelNummer(s as Stelle), 2)
    // Und ausdruecklich KEIN `resumelocalalbum`: der klassische Player suchte
    // damit ein Verzeichnis auf der SD-Karte, das es nicht gibt.
    assert.equal(s?.resumelocalalbum, undefined)
  })

  it('DAS ZWEITE TOR: die Stelle kommt auch in die Reihe', () => {
    const s = stelleAus(ALBUM, STAND) as Stelle
    assert.equal(nummerVerlaesslich(s), true)
    assert.equal(istWeiterhoerbar(s), true)
    const zeile = weiterhoerbare([s], [])[0]
    assert.equal(zeile.typ, 'jellyfin-album')
    assert.equal(zeile.titelNr, 2)
    assert.equal(zeile.positionProzent, 7.5)
    // KEINE Folgenkennung — die gibt es nur bei der ARD, und `stelleGiltFuer`
    // darf eine Jellyfin-Stelle deshalb nicht einkassieren.
    assert.equal(zeile.folge, undefined)
    assert.equal(stelleGiltFuer(zeile, 'spotify'), true)
  })

  it('fortgesetzt wird in PROZENT — mpv kann nichts anderes', () => {
    const s = stelleAus(ALBUM, STAND) as Stelle
    const zeile = weiterhoerbare([s], [])[0]
    assert.equal(ueberMpv('jellyfin'), true)
    assert.deepEqual(fortsetzenMit(zeile, 'jellyfin'), { positionMs: null, positionProzent: 7.5 })
  })

  it('faellt aus der Reihe, wenn der LETZTE Titel praktisch durch ist', () => {
    // Ohne `resumeGesamtTitel` bliebe ein durchgehoertes Album fuer immer
    // stehen — derselbe Punkt wie beim lokalen Album (02.08.2026).
    const durch = stelleAus(ALBUM, { titelNr: 4, gesamt: 4, bisher: 198, dauer: 200 }) as Stelle
    assert.equal(istDurch(durch), true)
    assert.equal(istWeiterhoerbar(durch), false)
  })

  it('merkt NICHTS ohne brauchbare Laenge — ein Prozentwert braucht einen Nenner', () => {
    assert.equal(stelleAus(ALBUM, { titelNr: 2, gesamt: 4, bisher: 15, dauer: 0 }), null)
  })
})
