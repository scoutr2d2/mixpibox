/**
 * Eine Playlist in ALBEN zerlegen — die eine Stelle, an der diese Regel steht.
 *
 * WOZU: Eine Spotify-Playlist enthaelt nur Titel. Wer sie so anzeigt, bekommt
 * bei einer Hoerspiel-Sammlung dreihundert Kapitel in einer Reihe. Was ein
 * Kind sucht, sind aber die ALBEN — und die stehen in der Playlist als
 * zusammenhaengende Laeufe gleicher `albumId` darin, nur unbenannt.
 *
 * WARUM IM BACKEND UND NICHT IN DER OBERFLAECHE: Die Regel lag bis zum
 * 01.08.2026 in `src/frontend-box/src/app/spotify-browse.ts`, also NUR in der
 * klassischen App. Die neue Oberflaeche haette sie ein zweites Mal gebraucht —
 * und zwei Kopien derselben Regel laufen auseinander, sobald jemand eine
 * anfasst. Dazu kommt: Die Oberflaeche darf `api.spotify.com` gar nicht mehr
 * selbst fragen (llmwiki spotify-web-api-nicht-mehr-aus-dem-browser), die
 * Titel holt ohnehin der Server. Die Regel gehoert dorthin, wo die Daten
 * herkommen.
 *
 * BEIDE OBERFLAECHEN FRAGEN JETZT DENSELBEN ENDPUNKT
 * (`GET /api/werke/<schluessel>/alben`). Diese Datei ist der alleinige
 * Besitzer der Regel.
 *
 * DIE REGEL SELBST, unveraendert uebernommen samt ihrer Tests: Ein Lauf
 * gleicher albumId gilt als ALBUM, wenn er mindestens 3 Titel hat UND
 * mindestens 80 % der Albumlaenge abdeckt. Alles andere wandert ins
 * „Mixtape" — lose Titel, die zu keinem vollstaendigen Album gehoeren.
 */
export interface PlaylistTrackInfo {
  name: string
  offset: number // 0-based position in the playlist (for spotify:playlist offset play)
  /**
   * Die Spotify-Kennung des Stuecks (`spotify:track:…`).
   *
   * WOZU: Die neue Oberflaeche markiert in der Lane dauerhaft den Titel, der
   * GERADE laeuft. Der Beweis dafuer ist `item.uri` aus der Wiedergabe-
   * Auskunft — ein Vergleich ueber Titel und Nummer waere Raterei (llmwiki
   * weiterhoeren-playlist-position: `track_number` ist die ALBUM-Nummer).
   * Diese Zerlegung braucht die Kennung selbst nicht; sie reicht sie nur
   * durch, genau wie `albumCover`.
   */
  uri?: string
  albumId: string
  albumName: string
  albumTotal: number // album.total_tracks (0/unknown → fall back to the run length)
  albumCover: string
  albumArtist: string
}

export interface DecomposedAlbum {
  id: string
  name: string
  artist: string
  cover: string
  trackCount: number // how many of the album's tracks are in the playlist
  firstOffset: number // playlist offset of the album's first track
}

export interface MixtapeTrack {
  nr: number
  name: string
  offset: number
  /** Die Spotify-Kennung des Stuecks — siehe `PlaylistTrackInfo.uri`. */
  uri?: string
  /** Artwork of the album this loose track came from. Without it the flip list
   *  falls back to the local trackcover endpoint, which is empty for Spotify
   *  content - every mixtape entry then shows the MuPiBox placeholder. */
  cover?: string
}

export interface PlaylistDecomposition {
  albums: DecomposedAlbum[]
  mixtape: MixtapeTrack[]
}

/**
 * Decompose playlist tracks (in playlist order) into complete albums + a mixtape.
 * A consecutive run of the same albumId counts as COMPLETE when it has at least
 * `minAlbumTracks` tracks AND covers at least `completeFraction` of the album's
 * total_tracks — otherwise its tracks fall into the mixtape.
 */
export function decomposePlaylist(
  tracks: PlaylistTrackInfo[],
  opts: { minAlbumTracks?: number; completeFraction?: number } = {},
): PlaylistDecomposition {
  const minAlbumTracks = opts.minAlbumTracks ?? 3
  const frac = opts.completeFraction ?? 0.8
  const albums: DecomposedAlbum[] = []
  const mixtape: MixtapeTrack[] = []
  let i = 0
  while (i < tracks.length) {
    const albumId = tracks[i].albumId
    // Always consume at least the current track (j = i + 1); extend the run only
    // for a real, matching albumId — an empty albumId is a 1-track loose run
    // (a plain `j = i` would never advance for a falsy id → infinite loop).
    let j = i + 1
    while (j < tracks.length && !!albumId && tracks[j].albumId === albumId) j++
    const run = tracks.slice(i, j)
    const total = run[0]?.albumTotal || run.length
    const complete = !!albumId && run.length >= minAlbumTracks && run.length >= Math.ceil(total * frac)
    if (complete) {
      albums.push({
        id: albumId,
        name: run[0].albumName,
        artist: run[0].albumArtist,
        cover: run[0].albumCover,
        trackCount: run.length,
        firstOffset: run[0].offset,
      })
    } else {
      for (const t of run)
        mixtape.push({ nr: mixtape.length + 1, name: t.name, offset: t.offset, uri: t.uri, cover: t.albumCover })
    }
    i = j
  }
  return { albums, mixtape }
}
