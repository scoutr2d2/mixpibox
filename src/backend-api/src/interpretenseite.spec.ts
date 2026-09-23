import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  bildDurchgereicht,
  bildHerkunftErlaubt,
  bildMittel,
  interpretenseiteBauen,
  type InterpretRohdaten,
} from './interpretenseite'
import type { Werk } from './werke'

/**
 * Die Daten sind ABGELESEN, nicht ausgedacht: `artists/352PojxBglNK0F7TBbCWJm`
 * und seine drei Unterpfade, am 2026-08-02 ueber die Box gemessen (Alin Coen,
 * 5 Alben, 15 Singles, 10 beliebteste Titel, 54.602 Follower). Erfundene
 * Antworten haetten hier genau die Felder, die der Bauer liest — und keins der
 * Felder, an denen er in Wirklichkeit scheitert.
 */
const ALBUM = (id: string, name: string, datum: string, titel = 10) => ({
  id,
  name,
  album_group: 'album',
  album_type: 'album',
  release_date: datum,
  release_date_precision: 'day',
  total_tracks: titel,
  images: [
    { url: `https://i.scdn.co/image/${id}-640`, width: 640, height: 640 },
    { url: `https://i.scdn.co/image/${id}-320`, width: 320, height: 320 },
    { url: `https://i.scdn.co/image/${id}-160`, width: 160, height: 160 },
  ],
})

const ARTIST = {
  id: '352PojxBglNK0F7TBbCWJm',
  name: 'Alin Coen',
  genres: ['german pop', 'german indie', 'german indie pop', 'singer-songwriter'],
  followers: { href: null, total: 54602 },
  popularity: 41,
  images: [
    { url: 'https://i.scdn.co/image/artist-640', width: 640, height: 640 },
    { url: 'https://i.scdn.co/image/artist-320', width: 320, height: 320 },
    { url: 'https://i.scdn.co/image/artist-160', width: 160, height: 160 },
  ],
}

const werk = (teil: Partial<Werk>): Werk => ({
  schluessel: 'spotify:1DFixLWuPkv3KT3TnV35m3',
  art: 'album',
  titel: 'Ein Album',
  bild: '/api/bild/spotify%3A1DFixLWuPkv3KT3TnV35m3',
  kategorie: 'music',
  quellen: [{ dienst: 'spotify', kennung: '1DFixLWuPkv3KT3TnV35m3' }],
  interpretSchluessel: 'alin coen',
  ...teil,
})

const leer: InterpretRohdaten = {
  artist: ARTIST,
  topTracks: [],
  alben: [],
  singles: [],
  sammlungen: [],
  werke: [],
}

describe('Interpretenseite: der Kopf', () => {
  it('nimmt Namen, Genres und Follower — und das MITTLERE Bild', () => {
    const s = interpretenseiteBauen(leer)
    assert.equal(s.kopf.name, 'Alin Coen')
    assert.equal(s.kopf.follower, 54602)
    // Hoechstens zwei Genres: auf 800 px passt keine dritte Angabe in die Zeile.
    assert.deepEqual(s.kopf.genres, ['german pop', 'german indie'])
    assert.equal(s.kopf.bild, `/api/bild/extern?u=${encodeURIComponent('https://i.scdn.co/image/artist-320')}`)
  })

  it('gibt es KEIN Feld „monatliche Hoerer"', () => {
    // Die Web-API kennt sie nicht (open.spotify.com nennt 112.866, die API
    // liefert 54.602 Follower — eine ANDERE Zahl). Wer sie spaeter sucht,
    // findet hier und im Kopf der Datei die Begruendung.
    assert.equal('hoerer' in (interpretenseiteBauen(leer).kopf as object), false)
    assert.equal('monatlich' in (interpretenseiteBauen(leer).kopf as object), false)
  })

  it('haelt den Namen der Kachel, wenn Spotify nicht antwortet', () => {
    // Die Seite erscheint SOFORT mit dem Namen, den die angetippte Kachel
    // schon kennt. Ein leerer Kopf saehe aus, als sei die Box kaputt.
    const s = interpretenseiteBauen({ ...leer, artist: null, name: 'Alin Coen' })
    assert.equal(s.kopf.name, 'Alin Coen')
    assert.equal(s.kopf.bild, null)
    assert.equal(s.kopf.follower, 0)
  })
})

describe('Interpretenseite: die Reihen und ihre Ordnung', () => {
  it('stellt „In deiner Box" VOR die Spotify-Reihen', () => {
    const s = interpretenseiteBauen({
      ...leer,
      werke: [werk({})],
      topTracks: [{ id: 't1', name: 'Bei Dir', track_number: 3, album: ALBUM('a1', 'Nah', '2019-03-08') }],
      alben: [ALBUM('a2', 'Nichts ist neu', '2021-05-07')],
    })
    // Abweichung vom Vorbild, mit Absicht: das Kind sucht zuerst das Bekannte,
    // und diese Reihe steht ohne einen einzigen Netzabruf da.
    assert.deepEqual(s.reihen.map((r) => r.id), ['box', 'top', 'alben'])
  })

  it('laesst eine leere Reihe ganz weg', () => {
    const s = interpretenseiteBauen(leer)
    assert.deepEqual(s.reihen, [])
    // Kein Ausfall: leer geantwortet ist etwas anderes als nicht geantwortet.
    assert.deepEqual(s.ausfaelle, [])
  })

  it('benennt einen Teilausfall, statt zu schweigen', () => {
    const s = interpretenseiteBauen({ ...leer, topTracks: null, singles: null })
    assert.deepEqual(s.ausfaelle, ['top', 'singles'])
  })

  it('haengt „Sammlungen" hinter „Singles und EPs" — Spotifys eigene Ordnung', () => {
    // GEMESSEN (2026-08-02, ueber die Box): Rolf Zuckowski fuehrt 44
    // Sammlungen — mehr als seine 21 Singles. Sie fehlten hier vollstaendig.
    const s = interpretenseiteBauen({
      ...leer,
      alben: [ALBUM('a1', 'Nah', '2019')],
      singles: [ALBUM('s1', 'Bis bald', '2026')],
      sammlungen: [ALBUM('c1', 'Das Beste', '2015')],
    })
    assert.deepEqual(s.reihen.map((r) => r.id), ['alben', 'singles', 'sammlungen'])
    assert.equal(s.reihen[2].titel, 'Sammlungen')
  })

  it('meldet den Ausfall der Sammlungen wie den der anderen Reihen', () => {
    assert.deepEqual(interpretenseiteBauen({ ...leer, sammlungen: null }).ausfaelle, ['sammlungen'])
  })

  it('sortiert Alben nach Erscheinen, das neueste zuerst', () => {
    const s = interpretenseiteBauen({
      ...leer,
      alben: [ALBUM('a1', 'Nah', '2019-03-08'), ALBUM('a3', 'Alt', '2011'), ALBUM('a2', 'Neu', '2021-05-07')],
    })
    assert.deepEqual(s.reihen[0].eintraege.map((e) => e.titel), ['Neu', 'Nah', 'Alt'])
  })
})

describe('„In deiner Box" haelt auch den BIBLIOTHEKSNAMEN, nicht nur Spotifys', () => {
  // DER HAEUFIGSTE FALL DIESER BOX, seit es die Freischaltung gibt: ein
  // Interpret der eigenen Bibliothek, den Spotify unter DIESEM Namen nicht
  // kennt — sieben von sechzehn (tools/interpreten-erkennung.mjs, 2026-08-03).
  // Die Verwaltung schickt deshalb die Kennung des Spotify-Treffers MIT dem
  // Bibliotheksnamen (llmwiki [interpreten-verwaltungsseite]).
  //
  // Hier verglich der Bauer nur `normal(artist.name)`. Die Kachel stand also
  // mit ihrem Werk in der Reihe — und auf ihrer Seite fehlte das Werk.
  // Nachgestellt mit tools/interpret-freigeschaltet-seite.mjs (ohne Box).
  const EIGENES = werk({
    schluessel: 'spotify:1DFixLWuPkv3KT3TnV35m3',
    titel: 'Bibi Blocksberg Folge 1',
    // normal('EUROPA Hörspiele & Kinderlieder') — der Schluessel des Regals.
    interpretSchluessel: 'europa horspiele kinderlieder',
  })
  const SPOTIFY = { ...ARTIST, name: 'EUROPA' }

  it('zeigt das eigene Werk, wenn Spotify den Interpreten ANDERS nennt', () => {
    const s = interpretenseiteBauen({
      ...leer,
      artist: SPOTIFY,
      name: 'EUROPA Hörspiele & Kinderlieder',
      werke: [EIGENES],
    })
    assert.deepEqual(s.reihen.map((r) => r.id), ['box'])
    assert.deepEqual(s.reihen[0].eintraege.map((e) => e.titel), ['Bibi Blocksberg Folge 1'])
  })

  it('zeigt es KEIN ZWEITES MAL, wenn beide Namen auf dasselbe Werk zeigen', () => {
    // Der gewoehnliche Fall: Spotify heisst wie die Bibliothek. Beide
    // Schluessel sind derselbe, und die Reihe hat trotzdem eine Kachel.
    const s = interpretenseiteBauen({
      ...leer,
      artist: ARTIST,
      name: 'Alin Coen',
      werke: [werk({})],
    })
    assert.equal(s.reihen[0].eintraege.length, 1)
  })

  it('holt KEINE fremden Werke dazu, wenn gar kein Name mitgeschickt wurde', () => {
    // Ohne `name` darf sich nichts aendern — `normal('')` ist leer, und ein
    // leerer Schluessel wuerde sonst auf Werke ohne Interpret passen.
    const s = interpretenseiteBauen({ ...leer, artist: SPOTIFY, werke: [EIGENES] })
    assert.deepEqual(s.reihen, [])
  })

  it('zeigt auch das MEHRNAMEN-Werk — Kreis und Seite geben dieselbe Antwort', () => {
    // "Du schaffst das schon" gehoert "Team Karacho, ANOTHER NGUYEN". Die
    // Reihe zaehlt es seit dem 12.09.2026 dem Kreis "Team Karacho" zu
    // (interpretenReihe, Schritt 1b) — fehlte es hier, tippte das Kind auf
    // einen markierten Kreis, und das laufende Album waere dahinter nicht
    // zu finden.
    const kombi = werk({
      schluessel: 'spotify:5PvQvJNQ9lEPYPWcs42nHb',
      titel: 'Du schaffst das schon',
      interpret: 'Team Karacho, ANOTHER NGUYEN',
      interpretSchluessel: 'team karacho, another nguyen',
    })
    const s = interpretenseiteBauen({
      ...leer,
      artist: { ...ARTIST, name: 'Team Karacho' },
      name: 'Team Karacho',
      werke: [kombi],
    })
    assert.deepEqual(s.reihen.map((r) => r.id), ['box'])
    assert.deepEqual(s.reihen[0].eintraege.map((e) => e.titel), ['Du schaffst das schon'])
  })
})

describe('Interpretenseite: Entdopplung', () => {
  it('zeigt ein Album, das in der Box liegt, nicht noch einmal bei „Alben"', () => {
    // Die Kennung muss AUSSEHEN wie eine Spotify-Kennung (22 Zeichen), sonst
    // gibt es nichts zu vergleichen — dieselbe Regel wie `interpretTaugt`.
    const s = interpretenseiteBauen({
      ...leer,
      werke: [
        werk({
          schluessel: 'spotify:1DFixLWuPkv3KT3TnV35m3',
          titel: 'Nah',
          quellen: [{ dienst: 'spotify', kennung: '1DFixLWuPkv3KT3TnV35m3' }],
        }),
      ],
      alben: [ALBUM('1DFixLWuPkv3KT3TnV35m3', 'Nah', '2019-03-08'), ALBUM('4aawyAB9vmqN3uQ7FjRGTy', 'Neu', '2021')],
    })
    assert.deepEqual(s.reihen.map((r) => r.id), ['box', 'alben'])
    assert.deepEqual(s.reihen[1].eintraege.map((e) => e.kennung), ['4aawyAB9vmqN3uQ7FjRGTy'])
  })

  it('faellt nicht auf dieselbe Playlist in zwei Kategorien herein', () => {
    // GEMESSEN an der Box (2026-08-02): 2QqQXuDKNR8HK1cFxf0NhW steht zweimal
    // in /api/werke — einmal `music`, einmal `audiobook`, gleicher Schluessel.
    const doppelt = werk({ schluessel: 'spotify:2QqQXuDKNR8HK1cFxf0NhW', titel: 'Jojo' })
    const s = interpretenseiteBauen({ ...leer, werke: [doppelt, { ...doppelt, kategorie: 'audiobook' }] })
    assert.equal(s.reihen[0].eintraege.length, 1)
  })

  it('wirft gleichnamige Fassungen INNERHALB einer Reihe weg, nicht ueber die Reihen hinweg', () => {
    const s = interpretenseiteBauen({
      ...leer,
      alben: [ALBUM('a1', 'Nah', '2019'), ALBUM('a9', 'NAH', '2015')],
      singles: [ALBUM('s1', 'Nah', '2020')],
    })
    // In „Alben" bleibt die neuere Fassung stehen …
    assert.deepEqual(s.reihen[0].eintraege.map((e) => e.kennung), ['a1'])
    // … die gleichnamige Single ist eine ANDERE Veroeffentlichung und bleibt.
    assert.deepEqual(s.reihen[1].eintraege.map((e) => e.kennung), ['s1'])
  })
})

describe('Interpretenseite: „50 von 308" — was abgeschnitten ist, wird gesagt', () => {
  // Spotify gibt je Abruf hoechstens 50 heraus. GEMESSEN (2026-08-02, ueber
  // die Durchreiche der Box): Die drei ??? 308 Alben, Bibi Blocksberg 241,
  // Rolf Zuckowski 53 — alle drei mit 50 geliefert. Eine Reihe mit 50 Kacheln
  // und ohne Zahl behauptet „das ist alles", und genau dieser Irrtum eine
  // Ebene tiefer war der Anlass fuer diese Seite.
  const viele = (n: number) => Array.from({ length: n }, (_, i) => ALBUM(`a${i}`, `Folge ${n - i}`, `20${10 + (i % 15)}`))

  it('nennt die Gesamtzahl, wenn Spotify mehr fuehrt, als geholt wurde', () => {
    const s = interpretenseiteBauen({ ...leer, alben: viele(50), gesamt: { alben: 308 } })
    assert.equal(s.reihen[0].gesamt, 308)
    assert.equal(s.reihen[0].eintraege.length, 50)
  })

  it('schweigt, wenn alles da ist — auch bei genau gleicher Zahl', () => {
    const s = interpretenseiteBauen({ ...leer, alben: viele(5), gesamt: { alben: 5 } })
    assert.equal('gesamt' in s.reihen[0], false)
  })

  it('zaehlt das GEHOLTE, nicht das Uebriggebliebene', () => {
    // Zwei gleichnamige Fassungen: die Entdopplung wirft eine weg. Das ist
    // kein Verlust und darf keine Meldung „1 von 2" ausloesen — sonst stuende
    // die Zahl bei jedem Interpreten da, bei dem Spotify doppelt fuehrt.
    const s = interpretenseiteBauen({
      ...leer,
      alben: [ALBUM('a1', 'Nah', '2019'), ALBUM('a2', 'NAH', '2015')],
      gesamt: { alben: 2 },
    })
    assert.equal(s.reihen[0].eintraege.length, 1)
    assert.equal('gesamt' in s.reihen[0], false)
  })

  it('behauptet nichts, wenn keine Gesamtzahl mitkam', () => {
    // Der Schalter „Ganze Diskografie" ist aus: dann gibt es gar keine
    // Antwort, aus der eine Zahl kaeme.
    const s = interpretenseiteBauen({ ...leer, alben: viele(3) })
    assert.equal('gesamt' in s.reihen[0], false)
  })

  it('gilt fuer jede der drei Veroeffentlichungsreihen', () => {
    const s = interpretenseiteBauen({
      ...leer,
      alben: viele(50),
      singles: [ALBUM('s1', 'Eins', '2024')],
      sammlungen: viele(50).map((a, i) => ({ ...a, id: `c${i}`, name: `Sammlung ${i}` })),
      gesamt: { alben: 308, singles: 1, sammlungen: 44 },
    })
    const nach = new Map(s.reihen.map((r) => [r.id, r.gesamt]))
    assert.equal(nach.get('alben'), 308)
    assert.equal(nach.get('singles'), undefined)
    assert.equal(nach.get('sammlungen'), undefined) // 44 < 50 geholt: vollstaendig
  })
})

describe('Interpretenseite: der Weg zum Ton', () => {
  it('gibt beliebten Titeln Albumkennung und 1-basierte Nummer mit — keinen fertigen Befehl', () => {
    // `spotify:track:` taugt NICHT als context_uri (spotify-control.ts setzt
    // fuer alles ausser `episode` eines). Gestartet wird ueber das Album.
    // Den Befehl baut die OBERFLAECHE — zwei Stellen, die
    // `spotify:album:<id>:<nr>:0` formen, waeren zwei Stellen fuer die
    // +1-Falle.
    const s = interpretenseiteBauen({
      ...leer,
      topTracks: [{ id: 't1', name: 'Bei Dir', track_number: 3, album: ALBUM('a1', 'Nah', '2019') }],
    })
    const e = s.reihen[0].eintraege[0]
    assert.equal(e.albumKennung, 'a1')
    assert.equal(e.titelNr, 3)
    assert.equal('befehl' in (e as object), false)
  })

  it('laesst einen beliebten Titel ohne Album weg', () => {
    // Ohne Albumkennung gaebe es keinen Weg zum Ton — eine Kachel, die nichts
    // startet, ist ein Versprechen ohne Deckung.
    const s = interpretenseiteBauen({
      ...leer,
      topTracks: [{ id: 't1', name: 'Ohne', track_number: 1, album: {} }],
    })
    assert.deepEqual(s.reihen, [])
  })

  it('gibt eigenen Werken ihren Werkschluessel mit', () => {
    // Damit startet die Oberflaeche ueber `spielen()` — denselben Weg wie im
    // Raster, samt Sonderfall Jellyfin-Album. Ein zweiter Befehlsbauer je
    // Dienst waere die Alternative gewesen.
    const s = interpretenseiteBauen({ ...leer, werke: [werk({ schluessel: 'jellyfin:7d9a', quellen: [{ dienst: 'jellyfin', kennung: '7d9a' }] })] })
    assert.equal(s.reihen[0].eintraege[0].schluessel, 'jellyfin:7d9a')
  })
})

describe('Bilder gehen ueber die Box, nie ueber das CDN', () => {
  it('reicht eine Netzadresse durch /api/bild/extern', () => {
    assert.equal(
      bildDurchgereicht('https://i.scdn.co/image/ab6761610000e5eb'),
      `/api/bild/extern?u=${encodeURIComponent('https://i.scdn.co/image/ab6761610000e5eb')}`,
    )
  })

  it('gibt bei allem, was nicht von Spotifys Bildauslieferung kommt, null', () => {
    // Ohne diese Schranke waere `/api/bild/extern` ein offener Vermittler:
    // jeder im Netz koennte die Box beliebige Server abfragen lassen.
    for (const k of [
      '',
      '   ',
      'javascript:alert(1)',
      'data:image/png;base64,AA',
      '/etc/passwd',
      'http://i.scdn.co/image/abc', // http, nicht https
      'https://scdn.co.angreifer.de/image/abc',
      'https://i.scdn.co.angreifer.de/image/abc',
      'https://192.168.178.169:8200/api/data',
      'https://evil.com/image/abc',
    ]) {
      assert.equal(bildDurchgereicht(k), null, k)
      assert.equal(bildHerkunftErlaubt(k), false, k)
    }
  })

  it('laesst die beiden Formen durch, die an der Box wirklich vorkommen', () => {
    assert.equal(bildHerkunftErlaubt('https://i.scdn.co/image/ab6761610000e5eb66b9'), true)
    assert.equal(bildHerkunftErlaubt('https://image-cdn-fa.spotifycdn.com/image/abc'), true)
    assert.equal(bildHerkunftErlaubt('https://mosaic.scdn.co/640/abc'), true)
  })

  it('nimmt aus 640/320/160 das mittlere und faellt sonst auf das erste zurueck', () => {
    assert.equal(bildMittel(ARTIST.images), `/api/bild/extern?u=${encodeURIComponent('https://i.scdn.co/image/artist-320')}`)
    assert.equal(bildMittel([{ url: 'https://i.scdn.co/image/nur-eins' }]), `/api/bild/extern?u=${encodeURIComponent('https://i.scdn.co/image/nur-eins')}`)
    assert.equal(bildMittel([]), null)
    assert.equal(bildMittel(undefined), null)
  })
})

/* ══ E45 — DER INTERPRET GEHOERT DER BOX ══════════════════════════════════
 *
 * Betreiber, 19.08.2026: „baue die interpreten so um das es meta interpreten
 * der box sind nicht nur von Spotify … falls Spotify wegbricht soll es immer
 * noch interpeten geben können … wichtig ist mir auch das die service tags
 * dort angezeigt werden."
 */
describe('Dienste — der Interpret als Komposition', () => {
  it('nennt im Kopf jeden Dienst, aus dem die Box etwas von ihm hat', () => {
    const s = interpretenseiteBauen({
      ...leer,
      werke: [
        werk({ schluessel: 'ard:1', quellen: [{ dienst: 'ard', kennung: '1' }] }),
        werk({ schluessel: 'lokal:2', quellen: [{ dienst: 'lokal', kennung: '2' }] }),
        werk({ schluessel: 'ard:3', quellen: [{ dienst: 'ard', kennung: '3' }] }),
      ],
    })
    // Ohne Dubletten, in der Reihenfolge des ersten Auftretens.
    assert.deepEqual(s.kopf.dienste, ['ard', 'lokal'])
  })

  it('haengt jeder Box-Kachel ihre eigenen Dienste an — verschmolzen also mehrere', () => {
    const s = interpretenseiteBauen({
      ...leer,
      werke: [
        werk({
          schluessel: 'lokal:zwei',
          quellen: [
            { dienst: 'lokal', kennung: 'zwei' },
            { dienst: 'spotify', kennung: '2DFixLWuPkv3KT3TnV35m3' },
          ],
        }),
      ],
    })
    assert.deepEqual(s.reihen[0].eintraege[0].dienste, ['lokal', 'spotify'])
    assert.deepEqual(s.kopf.dienste, ['lokal', 'spotify'])
  })

  it('behauptet KEINEN Dienst, wenn die Box nichts von ihm hat', () => {
    // Der Freigeschaltete ohne eigene Werke: Spotify kennt ihn, die Box hat
    // nichts. Ein Zeichen waere eine Aussage ueber Bestand, den es nicht gibt.
    const s = interpretenseiteBauen({ ...leer })
    assert.deepEqual(s.kopf.dienste, [])
  })

  it('entdoppelt gegen die Diskografie AUCH bei verschmolzenen Werken', () => {
    // DER FALL, DER VORHER DURCHFIEL: nach dem Verschmelzen steht die
    // BEVORZUGTE Quelle (lokal) vorn, die Spotify-Kennung dahinter. Wer nur
    // quellen[0] las, fand keine Kennung — und dasselbe Album stand zweimal
    // auf der Seite, einmal unter „In deiner Box", einmal unter „Alben".
    const s = interpretenseiteBauen({
      ...leer,
      werke: [
        werk({
          schluessel: 'lokal:pumme',
          titel: 'Pummeleinhorn',
          quellen: [
            { dienst: 'lokal', kennung: 'pumme' },
            { dienst: 'spotify', kennung: 'spotify:album:3DFixLWuPkv3KT3TnV35m3' },
          ],
        }),
      ],
      alben: [
        { id: '3DFixLWuPkv3KT3TnV35m3', name: 'Pummeleinhorn', release_date: '2019', total_tracks: 12, images: [] },
      ],
    })
    const alben = s.reihen.find((r) => r.id === 'alben')
    assert.equal(alben, undefined, 'das Album steht schon in der Box und darf nicht doppelt erscheinen')
  })
})

describe('Ohne Spotify — die Seite traegt trotzdem', () => {
  it('nimmt das Cover des eigenen Werks als Gesicht, wenn Spotify keines liefert', () => {
    const s = interpretenseiteBauen({
      ...leer,
      artist: null,
      name: 'Die Maus',
      // Der Schluessel muss zum Namen passen — sonst gehoert das Werk gar
      // nicht zu diesem Interpreten (schluesselDerBox).
      werke: [
        werk({
          schluessel: 'ard:1',
          bild: '/api/bild/ard%3A1',
          quellen: [{ dienst: 'ard', kennung: '1' }],
          interpretSchluessel: 'die maus',
        }),
      ],
    })
    assert.equal(s.kopf.name, 'Die Maus')
    assert.equal(s.kopf.bild, '/api/bild/ard%3A1')
    assert.deepEqual(s.kopf.dienste, ['ard'])
    assert.equal(s.reihen[0].id, 'box')
  })

  it('laesst ein echtes Interpretenbild vorgehen', () => {
    // Das Werk-Cover ist der RUECKFALL, nicht die Vorgabe.
    const s = interpretenseiteBauen({
      ...leer,
      werke: [werk({ bild: '/api/bild/eigen' })],
    })
    // Spotify-Bilder reisen ueber die Box (`/api/bild/extern`), nie roh.
    assert.match(String(s.kopf.bild), /^\/api\/bild\/extern\?u=/)
  })

  it('meldet KEINEN Ausfall, wenn gar nicht gefragt wurde', () => {
    // Der Weg ohne Kennung (`/api/interpret/-`): der Server reicht leere
    // Listen herein, nicht `null`. Sonst stuende auf der Seite eines
    // ARD-Interpreten „eine Reihe ließ sich nicht laden" — ueber einen
    // Dienst, den niemand angerufen hat.
    const s = interpretenseiteBauen({
      ...leer,
      artist: null,
      name: 'Die Maus',
      werke: [
        werk({ schluessel: 'ard:1', quellen: [{ dienst: 'ard', kennung: '1' }], interpretSchluessel: 'die maus' }),
      ],
    })
    assert.deepEqual(s.ausfaelle, [])
    assert.equal(s.reihen.length, 1, 'nur die Box-Reihe — keine leeren Spotify-Reihen')
  })
})
