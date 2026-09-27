/**
 * Zeugen fuer spotify-link.ts — wie ein geteilter Text zu einem Link und ein
 * Objekt der Web-API zu einem Treffer wird.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { apiPfad, kurzlinkAus, spotifyLinkLesen, spotifyTreffer } from './spotify-link'

describe('einen geteilten Text lesen', () => {
  it('findet den Link auch mitten im Satz der Spotify-App', () => {
    assert.deepEqual(
      spotifyLinkLesen(
        'Hör dir „Die Reklamation" auf Spotify an: https://open.spotify.com/album/3q6f8bwF1ZWxTGvS0veYi3?si=AbC',
      ),
      { art: 'album', id: '3q6f8bwF1ZWxTGvS0veYi3' },
    )
  })

  it('versteht die Laenderform und die spotify:-Adresse', () => {
    assert.deepEqual(spotifyLinkLesen('https://open.spotify.com/intl-de/artist/0PyuOAMz1lv0z737JcQNOg'), {
      art: 'artist',
      id: '0PyuOAMz1lv0z737JcQNOg',
    })
    assert.deepEqual(spotifyLinkLesen('spotify:track:4Yxsn0N9cLLXBGXPYUlP2y'), {
      art: 'track',
      id: '4Yxsn0N9cLLXBGXPYUlP2y',
    })
  })

  it('nimmt nichts, was kein Spotify-Link einer bekannten Art ist', () => {
    assert.equal(spotifyLinkLesen('https://example.org/album/3q6f8bwF1ZWxTGvS0veYi3'), null)
    assert.equal(spotifyLinkLesen('https://open.spotify.com/user/irgendwer1234'), null)
    assert.equal(spotifyLinkLesen(undefined), null)
  })

  it('erkennt einen Kurzlink, den erst der Server aufloesen kann', () => {
    assert.equal(kurzlinkAus('Hör mal: https://spotify.link/aBcD1234 !'), 'https://spotify.link/aBcD1234')
    assert.equal(spotifyLinkLesen('https://spotify.link/aBcD1234'), null)
  })

  it('kennt den API-Pfad je Art', () => {
    assert.equal(apiPfad('audiobook', 'x'), 'https://api.spotify.com/v1/audiobooks/x?market=DE')
    assert.equal(apiPfad('track', 'y'), 'https://api.spotify.com/v1/tracks/y?market=DE')
  })
})

describe('Treffer in der Form der Suche', () => {
  const album = {
    id: 'a1',
    name: 'Die Reklamation',
    artists: [{ name: 'Wir sind Helden' }],
    images: [{ url: 'https://i/1' }],
    total_tracks: 12,
  }

  it('ein Album traegt `id`', () => {
    const e = spotifyTreffer('album', album)
    assert.equal(e.id, 'a1')
    assert.equal(e.artist, 'Wir sind Helden')
    assert.equal(e.art, 'album')
    assert.equal(e.type, 'spotify')
    assert.equal(e.titelAnzahl, 12)
  })

  it('eine Sendung und ein Hoerbuch tragen `audiobookid` — so legt die Box sie seit jeher ab', () => {
    const e = spotifyTreffer('show', { id: 's1', name: 'Die Maus', publisher: 'WDR', images: [] })
    assert.equal(e.audiobookid, 's1')
    assert.equal(e.artist, 'WDR')
    assert.equal(e.id, undefined)
  })

  it('eine Liste traegt `playlistid` und den Besitzer', () => {
    const e = spotifyTreffer('playlist', {
      id: 'p1',
      name: 'Einschlafen',
      owner: { display_name: 'Jojo' },
      tracks: { total: 20 },
    })
    assert.equal(e.playlistid, 'p1')
    assert.equal(e.besitzer, 'Jojo')
  })

  it('ein einzelner Titel ist nur fuer Listen', () => {
    const e = spotifyTreffer('titel', { id: 't1', name: 'Nur ein Wort', artists: [{ name: 'Wir sind Helden' }], album })
    assert.equal(e.nurFuerListe, true)
    assert.equal(e.schluessel, 'titel:t1')
  })
})
