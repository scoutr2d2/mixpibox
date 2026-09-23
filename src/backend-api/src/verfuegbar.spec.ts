import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { einstufen, fortschreiben, kennungVon, pruefPfad, pruefPfade, urteilAus } from './verfuegbar'

describe('kennungVon', () => {
  it('nimmt die Playlist-Kennung eines Spotify-Eintrags', () => {
    assert.deepEqual(kennungVon({ type: 'spotify', playlistid: 'abc123' }), {
      art: 'playlists',
      id: 'abc123',
    })
  })

  it('nimmt die Album-Kennung, wenn keine Playlist da ist', () => {
    assert.deepEqual(kennungVon({ type: 'spotify', id: 'xyz' }), { art: 'albums', id: 'xyz' })
  })

  it('Playlist gewinnt vor Album', () => {
    // Traegt ein Eintrag beides, laedt die Oberflaeche die Playlist.
    assert.equal(kennungVon({ type: 'spotify', playlistid: 'p', id: 'a' })?.art, 'playlists')
  })

  it('kennt Shows und Hoerbuecher', () => {
    // Fielen bis 2026-08-02 still durch: media.ts fuehrt beide Felder, diese
    // Funktion kannte sie nicht - ein verschwundenes Hoerbuch wurde nie
    // gekennzeichnet.
    assert.deepEqual(kennungVon({ type: 'spotify', showid: 's1' }), { art: 'shows', id: 's1' })
    assert.deepEqual(kennungVon({ type: 'spotify', audiobookid: 'h1' }), { art: 'audiobooks', id: 'h1' })
  })

  it('nicht-Spotify und kennungslose Eintraege liefern null', () => {
    // "External Playback" hat keine Kennung - das meldet schon mupi-check.
    assert.equal(kennungVon({ type: 'jellyfin-album', id: 'x' }), null)
    assert.equal(kennungVon({ type: 'spotify' }), null)
    assert.equal(kennungVon({}), null)
  })
})

describe('pruefPfad', () => {
  it('fragt genau EINEN Titel als Lebenszeichen', () => {
    assert.equal(pruefPfad({ art: 'playlists', id: 'p1' }), 'playlists/p1/tracks?limit=1')
  })

  it('Shows haben episodes, nicht tracks', () => {
    // Mit `tracks` antwortet eine LEBENDE Show mit 404, und zwar in Spotifys
    // eigener Fehlerform. Sie waere damit faelschlich "geloescht".
    assert.equal(pruefPfad({ art: 'shows', id: 's1' }), 'shows/s1/episodes?limit=1')
  })
})

describe('pruefPfade — `audiobookid` ist DOPPELT belegt', () => {
  it('fragt bei einem Hoerbuch-Feld BEIDE Deutungen ab', () => {
    // spotify-browse.ts browseItemToMedia legt eine PODCAST-REIHE unter
    // `audiobookid` ab (`spotify:show`), spotify.service.ts getAudiobookByID
    // liest dasselbe Feld als HOERBUCH. Ein einziger Pfad erklaert die jeweils
    // andere Deutung faelschlich fuer tot — auf der Box: graue Kachel mit
    // roter Schaerpe auf einem Werk, das einwandfrei spielt.
    assert.deepEqual(pruefPfade({ art: 'audiobooks', id: 'h1' }), [
      'shows/h1/episodes?limit=1',
      'audiobooks/h1/chapters?limit=1',
    ])
  })

  it('alles andere bleibt einpfadig', () => {
    assert.deepEqual(pruefPfade({ art: 'playlists', id: 'p1' }), ['playlists/p1/tracks?limit=1'])
    assert.deepEqual(pruefPfade({ art: 'albums', id: 'a1' }), ['albums/a1/tracks?limit=1'])
    assert.deepEqual(pruefPfade({ art: 'shows', id: 's1' }), ['shows/s1/episodes?limit=1'])
  })
})

describe('urteilAus', () => {
  it('EIN Lebenszeichen genuegt', () => {
    assert.equal(urteilAus(['geloescht', 'traegt']), 'traegt')
    assert.equal(urteilAus(['traegt']), 'traegt')
  })

  it('geloescht nur, wenn ALLE Pfade Spotifys 404 tragen', () => {
    assert.equal(urteilAus(['geloescht', 'geloescht']), 'geloescht')
    assert.equal(urteilAus(['geloescht']), 'geloescht')
  })

  it('ein unklarer Pfad macht das Ganze unklar', () => {
    // Sonst waere eine Drosselung auf dem zweiten Weg ein Todesurteil.
    assert.equal(urteilAus(['geloescht', 'unklar']), 'unklar')
    assert.equal(urteilAus([]), 'unklar')
  })
})

describe('einstufen', () => {
  it('200 traegt', () => {
    assert.equal(einstufen(200, '{"items":[]}'), 'traegt')
  })

  it('Spotifys eigener 404 heisst geloescht', () => {
    // Genau die Form, die am Geraet kam (Pummeleinhorn, 2026-07-29).
    assert.equal(
      einstufen(404, '{"error": {"status": 404, "message": "Resource not found" } }'),
      'geloescht',
    )
  })

  it('ein FREMDER 404 ist unklar, nicht geloescht', () => {
    // Ein Auffang-Handler dazwischen (Staende passen nicht zusammen) darf
    // niemals Eintraege als tot kennzeichnen.
    assert.equal(einstufen(404, '<!DOCTYPE html><html>...'), 'unklar')
  })

  it('Netzfehler, Token, Drosselung: alles unklar', () => {
    assert.equal(einstufen(0, 'getaddrinfo ENOTFOUND'), 'unklar')
    assert.equal(einstufen(401, '{"error":"token"}'), 'unklar')
    assert.equal(einstufen(429, ''), 'unklar')
    assert.equal(einstufen(500, ''), 'unklar')
  })
})

describe('fortschreiben', () => {
  it('geloescht nimmt auf, traegt nimmt heraus', () => {
    const neu = fortschreiben(new Set(['alt']), [
      { id: 'tot', stand: 'geloescht' },
      { id: 'alt', stand: 'traegt' },
    ])
    assert.deepEqual([...neu].sort(), ['tot'])
  })

  it('unklar laesst den alten Zustand STEHEN', () => {
    // Ein Netzausfall darf weder kennzeichnen noch entwarnen - sonst ist
    // nach dem naechsten Ausfall die ganze Mediathek durchgestrichen (oder
    // ein wirklich toter Eintrag faelschlich wieder heil).
    const neu = fortschreiben(new Set(['tot']), [
      { id: 'tot', stand: 'unklar' },
      { id: 'x', stand: 'unklar' },
    ])
    assert.deepEqual([...neu], ['tot'])
  })

  it('leerer Ausgang bleibt leer, wenn nichts eindeutig ist', () => {
    assert.equal(fortschreiben(new Set(), [{ id: 'a', stand: 'unklar' }]).size, 0)
  })
})
