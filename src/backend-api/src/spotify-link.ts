/**
 * SPOTIFY-LINKS LESEN UND ZU TREFFERN MACHEN (27.09.2026).
 *
 * Betreiber: „kann man an die app was senden?" — Links zu Alben, Titeln und
 * Interpreten sollen aus der Musik-App an die Box gehen und dort in die
 * Bibliothek kommen. Die Handy-App nimmt den geteilten Text entgegen und
 * fragt die Box (`GET /api/medien/aus-link`); hier steht, wie die Box den
 * Link liest und was sie daraus macht.
 *
 * DIE TREFFER HABEN GENAU DIE FORM DER SUCHE (`/api/medien/suche`): die
 * Suche baut ihre Spotify-Treffer seit diesem Tag ebenfalls hier
 * (`spotifyTreffer`). Zwei Stellen, die dasselbe Feld je Art verschieden
 * belegen, waeren der Anfang von zwei Wahrheiten ueber `audiobookid`.
 *
 * REIN: kein Netz, keine Ablage. Holen und Einreihen stehen in server.ts.
 */

/** Was ein Link meint. `episode` und `track` zeigen auf etwas Groesseres. */
export type LinkArt = 'album' | 'playlist' | 'show' | 'audiobook' | 'episode' | 'track' | 'artist'

const ARTEN: readonly LinkArt[] = ['album', 'playlist', 'show', 'audiobook', 'episode', 'track', 'artist']

/**
 * Den ersten Spotify-Link in einem geteilten Text finden.
 *
 * GETEILT WIRD SELTEN NUR DER LINK: die Spotify-App schickt „Hör dir … auf
 * Spotify an: https://open.spotify.com/album/<id>?si=…". Erkannt werden
 *   https://open.spotify.com/[intl-xx/]<art>/<id>[?…]
 *   spotify:<art>:<id>
 * Kurzlinks (`spotify.link/…`) gibt `kurzlinkAus` zurueck — die loest erst
 * der Server auf, weil sie eine Weiterleitung brauchen.
 */
export function spotifyLinkLesen(text: unknown): { art: LinkArt; id: string } | null {
  const s = String(text ?? '')
  const web = /https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?([a-z]+)\/([A-Za-z0-9]{10,40})/i.exec(s)
  const uri = /spotify:([a-z]+):([A-Za-z0-9]{10,40})/i.exec(s)
  const m = web ?? uri
  if (!m) return null
  const art = m[1].toLowerCase() as LinkArt
  if (!ARTEN.includes(art)) return null
  return { art, id: m[2] }
}

/** Ein Kurzlink der Spotify-App (`https://spotify.link/<x>`) — oder null. */
export function kurzlinkAus(text: unknown): string | null {
  const m = /https:\/\/spotify\.link\/[A-Za-z0-9]{4,40}/.exec(String(text ?? ''))
  return m ? m[0] : null
}

/** Welcher API-Pfad zu welcher Link-Art gehoert. */
export function apiPfad(art: LinkArt, id: string): string {
  const pfad = {
    album: 'albums',
    playlist: 'playlists',
    show: 'shows',
    audiobook: 'audiobooks',
    episode: 'episodes',
    track: 'tracks',
    artist: 'artists',
  }[art]
  return `https://api.spotify.com/v1/${pfad}/${encodeURIComponent(id)}?market=DE`
}

/**
 * Ein Objekt der Spotify-Web-API als Treffer — in der Form der Suche.
 *
 * `art` ist die ART DES TREFFERS (album|playlist|show|titel), nicht die des
 * Links: ein Hoerbuch und ein Podcast werden beide `show` mit `audiobookid`,
 * so legt die Box sie seit jeher ab.
 *
 * Ohne `schluessel` und `schonDa` — die haengen an `medienSchluessel` und
 * am Bestand und gehoeren deshalb in server.ts.
 */
export function spotifyTreffer(
  art: 'album' | 'playlist' | 'show' | 'titel',
  x: Record<string, any>,
  ersatzInterpret = '',
): Record<string, unknown> {
  const namen = (liste: unknown) =>
    ((Array.isArray(liste) ? liste : []) as Record<string, unknown>[])
      .map((y) => y?.name)
      .filter(Boolean)
      .join(', ')
  const e: Record<string, unknown> = {
    dienst: 'spotify',
    art,
    type: 'spotify',
    title: x.name,
    artist:
      art === 'album' || art === 'titel'
        ? namen(x.artists) || ersatzInterpret
        : (x.publisher ?? x.owner?.display_name ?? namen(x.authors) ?? ''),
    cover: x.images?.[0]?.url ?? x.album?.images?.[0]?.url ?? '',
    titelAnzahl: x.total_tracks ?? x.tracks?.total ?? x.total_episodes ?? x.total_chapters,
  }
  if (art === 'titel') {
    // Einzelne Stuecke sind KEINE Bibliothekseintraege - sie tragen ihre uri
    // fuer den Listenbau und nennen ihr Album zur Einordnung.
    e.uri = x.uri
    e.album = x.album?.name ?? ''
    e.dauerMs = x.duration_ms
    e.schluessel = `titel:${x.id}`
    e.nurFuerListe = true
  } else if (art === 'album') {
    e.id = x.id
  } else if (art === 'playlist') {
    e.playlistid = x.id
    // Bei einer Liste ist `owner.display_name` der SPOTIFY-BENUTZER, nicht der
    // Interpret - und der ist als Beschriftung wertlos ("Prace.de+
    // juliusspotify", "Jojo"). Die Suche holt den wirklichen Interpreten
    // danach aus den Titeln (server.ts, „Den wahren Interpreten der LISTEN
    // nachschlagen"); bis dahin bleibt der Besitzer als Notnagel stehen.
    e.besitzer = x.owner?.display_name ?? ''
  } else {
    e.audiobookid = x.id
  }
  return e
}
