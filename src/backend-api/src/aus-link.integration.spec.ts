/**
 * EIN GETEILTER SPOTIFY-LINK ALS TREFFER — `GET /api/medien/aus-link` (27.09.2026).
 *
 * Spotify wird mit nock gefaelscht: erst der Token, dann das Objekt. Geprueft
 * wird, was aus welcher Link-Art wird — vor allem die beiden, die NICHT
 * dasselbe uebernehmen, was geteilt wurde (Titel → Album, Interpret → Alben).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import nock from 'nock'
import request from 'supertest'

let app: import('express').Express

const ALBUM = {
  id: '3q6f8bwF1ZWxTGvS0veYi3',
  name: 'Die Reklamation',
  artists: [{ name: 'Wir sind Helden' }],
  images: [{ url: 'https://i.scdn.co/image/abc' }],
  total_tracks: 12,
}

function spotify(pfad: string | RegExp, antwort: Record<string, unknown>) {
  nock('https://accounts.spotify.com').post('/api/token').reply(200, { access_token: 'stummel', expires_in: 3600 })
  nock('https://api.spotify.com').get(pfad).query(true).reply(200, antwort)
}

const ausLink = (text: string) => request(app).get(`/api/medien/aus-link?url=${encodeURIComponent(text)}`)

describe('Geteilter Spotify-Link', () => {
  before(async () => {
    const ordner = mkdtempSync(join(tmpdir(), 'mixpi-aus-link-'))
    // „Die Reklamation" steht schon da — der Treffer muss es sagen.
    const bestand = [{ type: 'spotify', id: ALBUM.id, title: ALBUM.name, artist: 'Wir sind Helden', category: 'music' }]
    writeFileSync(join(ordner, 'data.json'), JSON.stringify(bestand))
    writeFileSync(join(ordner, 'active_data.json'), JSON.stringify(bestand))
    writeFileSync(
      join(ordner, 'config.json'),
      JSON.stringify({
        spotify: { clientId: 'stummel-kennung', refreshToken: 'stummel-merkmal' },
        'node-sonos-http-api': { server: 'MixPiBox' },
      }),
    )
    process.env.MUPIBOX_CONFIG_DIR = ordner
    process.env.MUPIBOX_LOCK_DIR = ordner
    app = (await import('./server.js')).app
    for (let i = 0; i < 50; i++) {
      if ((await request(app).get('/api/spotify/config')).status === 200) break
      await new Promise((weiter) => setTimeout(weiter, 20))
    }
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_LOCK_DIR = undefined
    nock.cleanAll()
  })

  it('ein Album aus dem Satz der Spotify-App — in der Form der Suche, und „schon da"', async () => {
    spotify(`/v1/albums/${ALBUM.id}`, ALBUM)
    const r = await ausLink(`Hör dir das an: https://open.spotify.com/album/${ALBUM.id}?si=x`).expect(200)
    assert.equal(r.body.art, 'album')
    const t = r.body.treffer[0]
    assert.equal(t.id, ALBUM.id)
    assert.equal(t.title, 'Die Reklamation')
    assert.equal(t.schluessel, `spotify:${ALBUM.id}`)
    assert.equal(t.schonDa, true)
  })

  it('ein einzelner Titel wird zu SEINEM Album — mit Hinweis', async () => {
    spotify('/v1/tracks/4Yxsn0N9cLLXBGXPYUlP2y', { id: '4Yxsn0N9cLLXBGXPYUlP2y', name: 'Nur ein Wort', album: ALBUM })
    const r = await ausLink('https://open.spotify.com/track/4Yxsn0N9cLLXBGXPYUlP2y').expect(200)
    assert.equal(r.body.treffer[0].id, ALBUM.id)
    assert.equal(r.body.treffer[0].nurFuerListe, undefined)
    assert.match(r.body.hinweise[0], /einzelner Titel/)
  })

  it('ein Interpret bringt seine Alben zur Auswahl', async () => {
    nock('https://accounts.spotify.com').post('/api/token').reply(200, { access_token: 'stummel', expires_in: 3600 })
    nock('https://api.spotify.com')
      .get('/v1/artists/0PyuOAMz1lv0z737JcQNOg')
      .query(true)
      .reply(200, { id: '0PyuOAMz1lv0z737JcQNOg', name: 'Wir sind Helden' })
      .get('/v1/artists/0PyuOAMz1lv0z737JcQNOg/albums')
      .query(true)
      .reply(200, { items: [ALBUM, { ...ALBUM, id: 'zweitesAlbum000000000', name: 'Soundso' }] })
    const r = await ausLink('https://open.spotify.com/artist/0PyuOAMz1lv0z737JcQNOg').expect(200)
    assert.deepEqual(
      r.body.treffer.map((t: { title: string }) => t.title),
      ['Die Reklamation', 'Soundso'],
    )
  })

  it('ein Hoerbuch wird `show` mit `audiobookid`, wie die Box es ablegt', async () => {
    spotify('/v1/audiobooks/hoerbuch0000000000000', {
      id: 'hoerbuch0000000000000',
      name: 'Der kleine Prinz',
      publisher: 'Hörverlag',
      images: [],
    })
    const r = await ausLink('https://open.spotify.com/audiobook/hoerbuch0000000000000').expect(200)
    assert.equal(r.body.treffer[0].audiobookid, 'hoerbuch0000000000000')
    assert.equal(r.body.treffer[0].art, 'show')
  })

  it('kein Link, keine Frage an Spotify', async () => {
    const r = await ausLink('Guck mal, ein Hund').expect(400)
    assert.equal(r.body.error, 'keinSpotifyLink')
  })
})
