/**
 * Zeugen fuer die Jellyfin-Regeln — gegen gefaelschtes Netz, ueber die echten
 * Flaechen (inhalt/aufloesen/http), wie beim ARD-Plugin.
 *
 *   node --test plugins/mixpi-jellyfin/index.spec.mjs
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import plugin from './index.mjs'

const KONFIG = Object.freeze({ jellyfin: { server: 'http://jf:8096/', apiKey: 'k1' } })

/** Ein Kontext, dessen Jellyfin aus einer Tabelle antwortet: Pfadmuster -> Daten. */
function kontextMit(antworten, konfig = KONFIG) {
  const gefragt = []
  const k = {
    protokoll: () => {},
    einstellungen: Object.freeze({}),
    konfig,
    gefragt,
    holen: async (adresse) => {
      gefragt.push(adresse)
      for (const [muster, daten] of antworten) {
        if (adresse.includes(muster)) return { ok: true, json: async () => daten }
      }
      throw new Error(`keine gefaelschte Antwort fuer: ${adresse}`)
    },
  }
  return k
}

function titelRoh(nr, extra = {}) {
  return {
    Id: `t${nr}`,
    Name: `Titel ${nr}`,
    Album: 'Das Album',
    AlbumArtist: 'Die Band',
    RunTimeTicks: 3_000_000_000, // 300 s
    ...extra,
  }
}

describe('der Zugang kommt aus kontext.konfig (E80)', () => {
  it('ohne Eintrag: ehrliche Worte, kein Wurf im befinden', async () => {
    const b = await plugin.befinden(kontextMit([], Object.freeze({})))
    assert.equal(b.ok, false)
    assert.match(b.text, /Kein Server oder kein Schlüssel/)
  })

  it('der End-Schraegstrich des Servers faellt — sonst hiesse es //Items', async () => {
    const k = kontextMit([['/Items?ParentId=', { Items: [titelRoh(1)] }]])
    await plugin.inhalt('a1', k)
    assert.ok(k.gefragt[0].startsWith('http://jf:8096/Items?'), k.gefragt[0])
  })
})

describe('die Titelliste (inhalt)', () => {
  it('DIRECT PLAY: jede Stromadresse traegt static=true — sonst meldet mpv falsche Laengen', async () => {
    const inhalt = await plugin.inhalt('a1', kontextMit([['/Items?ParentId=', { Items: [titelRoh(1), titelRoh(2)] }]]))
    assert.equal(inhalt.folgen.length, 2)
    for (const f of inhalt.folgen) {
      assert.match(f.quelle.adresse, /\/Audio\/t\d\/stream\?static=true&api_key=k1/)
    }
  })

  it('TICKS sind 100-ns-Schritte: 3 Mrd Ticks = 300 s', async () => {
    const inhalt = await plugin.inhalt('a1', kontextMit([['/Items?ParentId=', { Items: [titelRoh(1)] }]]))
    assert.equal(inhalt.folgen[0].dauerSek, 300)
  })

  it('Albumtitel und -interpret kommen vom ersten Titel — kein zweiter Rundlauf', async () => {
    const inhalt = await plugin.inhalt('a1', kontextMit([['/Items?ParentId=', { Items: [titelRoh(1)] }]]))
    assert.equal(inhalt.titel, 'Das Album')
    assert.equal(inhalt.kuenstler, 'Die Band')
  })

  it('die Sortierung bleibt dem SERVER ueberlassen — die Abfrage traegt sie', async () => {
    const k = kontextMit([['/Items?ParentId=', { Items: [] }]])
    await plugin.inhalt('a1', k)
    assert.match(k.gefragt[0], /SortBy=ParentIndexNumber,IndexNumber/)
  })
})

describe('die Suche (http) — zwei Wege, ein Ergebnis', () => {
  const ANTWORTEN = [
    ['/Items?searchTerm=', { Items: [{ Id: 'a1', Name: 'Die Zukunft', AlbumArtist: 'Das Lumpenpack', ChildCount: 12 }] }],
    ['/Artists?searchTerm=', { Items: [{ Id: 'k1' }] }],
    ['/Items?AlbumArtistIds=', { Items: [{ Id: 'a2', Name: 'Noch ein Album', AlbumArtist: 'Das Lumpenpack', ChildCount: 9 }, { Id: 'a1', Name: 'Die Zukunft', AlbumArtist: 'Das Lumpenpack', ChildCount: 12 }] }],
  ]

  it('searchTerm findet nur Namen — der Interpreten-Weg holt den Rest, ohne Dubletten', async () => {
    const a = await plugin.http({ methode: 'GET', pfad: 'suche', abfrage: { q: 'lumpenpack' }, rumpf: null }, kontextMit(ANTWORTEN))
    assert.equal(a.inhalt.treffer.length, 2, 'a1 steht nicht doppelt')
  })

  it('bei ALBEN zaehlt AlbumArtistIds, bei TITELN ArtistIds — sonst fehlen Gastbeitraege', async () => {
    const kAlbum = kontextMit(ANTWORTEN)
    await plugin.http({ methode: 'GET', pfad: 'suche', abfrage: { q: 'x' }, rumpf: null }, kAlbum)
    assert.ok(kAlbum.gefragt.some((u) => u.includes('AlbumArtistIds=')))
    const kTitel = kontextMit([
      ['/Items?searchTerm=', { Items: [] }],
      ['/Artists?searchTerm=', { Items: [{ Id: 'k1' }] }],
      ['/Items?ArtistIds=', { Items: [titelRoh(1)] }],
    ])
    await plugin.http({ methode: 'GET', pfad: 'suche', abfrage: { q: 'x', art: 'titel' }, rumpf: null }, kTitel)
    assert.ok(kTitel.gefragt.some((u) => u.includes('ArtistIds=') && !u.includes('AlbumArtistIds=')))
  })

  it('der VORSCHLAG ist die data.json-Form des Kerns — type jellyfin-album', async () => {
    const a = await plugin.http({ methode: 'GET', pfad: 'suche', abfrage: { q: 'zukunft' }, rumpf: null }, kontextMit(ANTWORTEN))
    const v = a.inhalt.treffer[0].vorschlag
    assert.equal(v.type, 'jellyfin-album')
    assert.equal(v.id, 'a1')
    assert.match(v.cover, /\/Items\/a1\/Images\/Primary\?api_key=k1/)
  })

  it('art?id= nennt die Objektart des Servers — der Kern unterscheidet damit Titel von Alben', async () => {
    const k = kontextMit([['/Items?Ids=a1', { Items: [{ Id: 'a1', Type: 'MusicAlbum' }] }]])
    const a = await plugin.http({ methode: 'GET', pfad: 'art', abfrage: { id: 'a1' }, rumpf: null }, k)
    assert.equal(a.inhalt.art, 'MusicAlbum')
  })

  it('Titel-Treffer sind KEIN Bibliothekseintrag — sie tragen keinen Vorschlag', async () => {
    const k = kontextMit([
      ['/Items?searchTerm=', { Items: [titelRoh(1)] }],
      ['/Artists?searchTerm=', { Items: [] }],
    ])
    const a = await plugin.http({ methode: 'GET', pfad: 'suche', abfrage: { q: 'x', art: 'titel' }, rumpf: null }, k)
    assert.equal(a.inhalt.treffer[0].vorschlag, undefined)
    assert.equal(a.inhalt.treffer[0].dauerMs, 300_000)
  })
})
