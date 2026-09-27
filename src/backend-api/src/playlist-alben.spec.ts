import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type PlaylistTrackInfo, decomposePlaylist } from './playlist-alben.js'

/**
 * MITGEWANDERT MIT DER REGEL. Die Zerlegung lag bis zum 01.08.2026 in der
 * klassischen Oberflaeche; mit ihr sind diese Pruefungen umgezogen, damit die
 * Regel ihren Beweis nicht verliert. Von Jasmine (`expect(...).toEqual`) auf
 * den Node-Testlaeufer umgeschrieben — das ist alles, was sich geaendert hat.
 */
describe('decomposePlaylist', () => {
  const mk = (name: string, offset: number, albumId: string, albumTotal: number): PlaylistTrackInfo => ({
    name,
    offset,
    // Die Stueck-Kennung reist DURCH die Zerlegung — die neue Oberflaeche
    // erkennt am `uri` den laufenden Titel wieder. Sie gehoert deshalb auch
    // in die Probe: ein Feld, das der Bausatz nur durchreicht, faellt sonst
    // still weg, sobald jemand das Mixtape umbaut.
    uri: `spotify:track:${albumId}${offset}`,
    albumId,
    albumName: `Album ${albumId}`,
    albumTotal,
    albumCover: `c${albumId}`,
    albumArtist: 'A',
  })

  it('turns a run covering (nearly) all of an album into a complete album, no mixtape', () => {
    const tracks = Array.from({ length: 16 }, (_, i) => mk(`t${i}`, i, 'X', 18)) // 16/18 ≥ 80%
    const d = decomposePlaylist(tracks)
    assert.equal(d.albums.length, 1)
    assert.deepEqual(d.albums[0].id, 'X')
    assert.deepEqual(d.albums[0].trackCount, 16)
    assert.deepEqual(d.albums[0].firstOffset, 0)
    assert.equal(d.mixtape.length, 0)
  })

  it('puts loose tracks (too few of an album) into the mixtape, offsets preserved', () => {
    const d = decomposePlaylist([mk('a', 0, 'X', 18), mk('b', 1, 'X', 18)]) // 2/18
    assert.equal(d.albums.length, 0)
    // Jeder Mixtape-Titel traegt SEIN eigenes Cover: die Stuecke stammen aus
    // verschiedenen Alben, ein gemeinsames Bild gibt es also nicht.
    // Dieser Test kannte das Feld bis 2026-07-28 nicht und war damit falsch -
    // aufgefallen ist es nie, weil die Box-Tests gar nicht starteten
    // (`.angular/cache` gehoerte root, danach fehlte der Browser).
    assert.deepEqual(d.mixtape, [
      { nr: 1, name: 'a', offset: 0, uri: 'spotify:track:X0', cover: 'cX' },
      { nr: 2, name: 'b', offset: 1, uri: 'spotify:track:X1', cover: 'cX' },
    ])
  })

  it('splits a mixed playlist into complete albums + a renumbered mixtape', () => {
    const tracks = [
      ...Array.from({ length: 10 }, (_, i) => mk(`x${i}`, i, 'X', 10)), // complete X
      mk('loose1', 10, 'Y', 12), // 1/12 → mixtape
      mk('loose2', 11, 'Z', 5), // 1/5 → mixtape
      ...Array.from({ length: 8 }, (_, i) => mk(`w${i}`, 12 + i, 'W', 8)), // complete W
    ]
    const d = decomposePlaylist(tracks)
    assert.deepEqual(d.albums.map((a) => a.id), ['X', 'W'])
    assert.deepEqual(d.mixtape.map((m) => m.offset), [10, 11]) // original playlist offsets kept
    assert.deepEqual(d.mixtape.map((m) => m.nr), [1, 2]) // but renumbered 1..N
  })

  it('does not merge non-contiguous runs of the same album into a false complete album', () => {
    const tracks = [
      mk('x0', 0, 'X', 4),
      mk('x1', 1, 'X', 4),
      mk('y', 2, 'Y', 4),
      mk('x2', 3, 'X', 4),
      mk('x3', 4, 'X', 4),
    ]
    const d = decomposePlaylist(tracks) // X twice as 2-track runs, never combined to 4/4
    assert.equal(d.albums.length, 0)
    assert.equal(d.mixtape.length, 5)
  })

  it('falls back to the run length when total_tracks is unknown, honouring the min-tracks floor', () => {
    assert.equal(decomposePlaylist(Array.from({ length: 3 }, (_, i) => mk(`t${i}`, i, 'X', 0))).albums.length, 1)
    assert.equal(decomposePlaylist([mk('a', 0, 'Y', 0), mk('b', 1, 'Y', 0)]).albums.length, 0) // 2 < min 3
  })

  it('sends album-less tracks to the mixtape', () => {
    const d = decomposePlaylist([mk('a', 0, '', 0), mk('b', 1, '', 0)])
    assert.equal(d.albums.length, 0)
    assert.equal(d.mixtape.length, 2)
  })
})
