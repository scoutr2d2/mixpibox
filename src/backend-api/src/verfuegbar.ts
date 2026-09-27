/**
 * Traegt ein Spotify-Eintrag der Mediathek noch — oder ist er beim ANBIETER
 * geloescht?
 *
 * WOFUER: am 2026-07-29 blieb die Titelliste eines Eintrags leer, und die
 * Suche dauerte eine Stunde, weil "Playlist bei Spotify geloescht" von aussen
 * genauso aussieht wie "Box kaputt": ein 404 in der Netzwerkkonsole. Die Box
 * prueft ihre Eintraege jetzt selbst und KENNZEICHNET tote — das Kind sieht
 * eine erklaerte Kachel statt einer leeren Liste, und die Verwaltung weiss,
 * welchen Eintrag sie neu verknuepfen muss.
 *
 * REIN: kein Netz, kein Dateizugriff. Der Server holt die Antworten und
 * reicht Status + Koerper herein; hier steht nur die Einstufung. So ist die
 * Regel pruefbar, ohne eine Box zu haben.
 */

/** Worauf sich ein Eintrag bei Spotify bezieht. */
export interface Kennung {
  /** Der Web-API-Sammelpfad: playlists, albums, shows oder audiobooks. */
  art: 'playlists' | 'albums' | 'shows' | 'audiobooks'
  id: string
}

/**
 * Die Spotify-Kennung eines Mediathek-Eintrags.
 *
 * `playlistid` gewinnt vor `id`: ein Eintrag traegt nie beides sinnvoll, aber
 * falls doch, ist die Playlist das, was die Oberflaeche laedt. Eintraege ohne
 * Kennung (etwa "External Playback") liefern null — die kann niemand pruefen,
 * und sie meldet schon der Bereich `spotify` in mupi-check.
 *
 * SHOWS UND HOERBUECHER FIELEN HIER BIS 2026-08-02 DURCH. `media.ts` fuehrt
 * `showid` und `audiobookid` seit jeher, `mupi-check.py` loest sie auf — nur
 * diese Funktion kannte sie nicht. Ein verschwundenes Spotify-Hoerbuch wurde
 * deshalb weder gekennzeichnet noch angeboten, sah auf der Box aber genauso
 * tot aus wie eine geloeschte Playlist.
 */
export function kennungVon(eintrag: {
  type?: string
  playlistid?: string
  id?: string
  showid?: string
  audiobookid?: string
}): Kennung | null {
  if (!String(eintrag?.type || '').startsWith('spotify')) return null
  const pid = String(eintrag.playlistid || '').trim()
  if (pid) return { art: 'playlists', id: pid }
  const sid = String(eintrag.showid || '').trim()
  if (sid) return { art: 'shows', id: sid }
  const hid = String(eintrag.audiobookid || '').trim()
  if (hid) return { art: 'audiobooks', id: hid }
  const aid = String(eintrag.id || '').trim()
  if (aid) return { art: 'albums', id: aid }
  return null
}

/**
 * Die Pruefpfade zu einer Kennung — EIN Stueck genuegt als Lebenszeichen.
 *
 * Der Sammelpfad heisst je Art anders: Alben und Listen haben `tracks`, Shows
 * `episodes`, Hoerbuecher `chapters`. Wer ueberall `tracks` anhaengt, bekommt
 * bei einer LEBENDEN Show einen 404 — und der traegt sogar Spotifys eigene
 * Fehlerform, waere also faelschlich „geloescht".
 *
 * ZWEI PFADE FUER `audiobookid`, UND DAS IST KEINE VORSICHT AUF VERDACHT.
 * Das Feld ist im Bestand DOPPELT belegt, beweisbar am Quelltext:
 *
 *   spotify-browse.ts browseItemToMedia  `item.kind === 'show'` ->
 *       `base.audiobookid = item.id`, dazu die Adresse
 *       `https://open.spotify.com/show/<id>` — es ist eine PODCAST-REIHE.
 *       Der Kommentar dort sagt es woertlich: „a show `audiobookid`
 *       (spotify:show — a podcast series is stored under the audiobook
 *       category)".
 *   server.ts (Suche der Verwaltung)     `art === 'show'` -> `e.audiobookid = x.id`
 *   spotify.service.ts getAudiobookByID  loest DASSELBE Feld ueber
 *       `/api/spotify/audiobook/<id>` auf — dort ist es ein echtes HOERBUCH.
 *
 * Wer sich fuer EINE Deutung entscheidet, bekommt fuer die andere Spotifys
 * eigenen 404 — und `einstufen` macht daraus „geloescht". Genau das ist am
 * 2026-08-02 in diese Datei geraten: `audiobooks/<showId>/chapters` antwortet
 * 404, und damit war jede ueber „meine Shows" aufgenommene Podcast-Reihe
 * faelschlich tot. Auf der Box heisst das: graue Kachel mit roter Schaerpe
 * „nicht mehr da" auf einem Werk, das einwandfrei spielt — und nach drei
 * Laeufen und einem Tag steht es VORAUSGEWAEHLT in der Entfernen-Karte der
 * Verwaltung.
 *
 * Die REIHENFOLGE ist die haeufigere zuerst: beide Aufnahmewege dieses Repos
 * legen eine Show ab, das Hoerbuch kommt nur ueber den alten Weg.
 *
 * `showid` bleibt einpfadig: `media.service.ts` loest es ueber
 * `/api/spotify/show/<id>` auf, es ist dort also eindeutig eine Show. (Die
 * `showid: episode.id`-Stellen in spotify.service.ts bilden Eintraege fuer
 * resume.json, nicht fuer data.json — und geprueft wird nur data.json.)
 */
export function pruefPfade(k: Kennung): string[] {
  if (k.art === 'shows') return [`shows/${k.id}/episodes?limit=1`]
  if (k.art === 'audiobooks') return [`shows/${k.id}/episodes?limit=1`, `audiobooks/${k.id}/chapters?limit=1`]
  return [`${k.art}/${k.id}/tracks?limit=1`]
}

/**
 * Der ERSTE Pruefpfad — fuer Aufrufer, die nur einen brauchen.
 *
 * Bleibt bestehen, damit Werkzeuge und Tests nicht umgeschrieben werden
 * muessen; die Pruefung im Server geht ueber `pruefPfade`.
 */
export function pruefPfad(k: Kennung): string {
  return pruefPfade(k)[0]
}

/**
 * Aus mehreren Antworten EIN Urteil.
 *
 * EIN Lebenszeichen genuegt: antwortet auch nur ein Pfad mit 200, gibt es den
 * Eintrag. „Geloescht" verlangt dagegen, dass ALLE befragten Pfade Spotifys
 * eigenen 404 tragen — bleibt einer unklar, ist das Ganze unklar. Andersherum
 * waere ein einzelner Ausfall (429 auf dem zweiten Pfad) ein Todesurteil.
 */
export function urteilAus(staende: ReadonlyArray<Stand>): Stand {
  if (!staende.length) return 'unklar'
  if (staende.includes('traegt')) return 'traegt'
  return staende.every((s) => s === 'geloescht') ? 'geloescht' : 'unklar'
}

/**
 * Was sagt Spotifys Antwort ueber den Eintrag?
 *
 *   'traegt'    — es gibt ihn, Titel sind abrufbar
 *   'geloescht' — Spotify selbst kennt die Kennung nicht mehr (404).
 *                 Daran kann die Box nichts heilen; nur die Verwaltung
 *                 (neu verknuepfen oder entfernen).
 *   'unklar'    — alles andere: Netz weg, Token abgelaufen, 429, 5xx.
 *                 WICHTIG: unklar ist KEIN geloescht. Wer bei einem
 *                 Netzausfall alles als tot kennzeichnete, haette nach dem
 *                 naechsten Ausfall eine durchgestrichene Mediathek.
 */
export type Stand = 'traegt' | 'geloescht' | 'unklar'

export function einstufen(status: number, koerper: string): Stand {
  if (status === 200) return 'traegt'
  if (status === 404) {
    // Spotifys eigene 404-Form — nicht die eines Auffang-Handlers dazwischen.
    return /resource not found|non existing id/i.test(koerper || '') ? 'geloescht' : 'unklar'
  }
  return 'unklar'
}

/**
 * Den neuen Stand aus altem Stand und frischen Ergebnissen bilden.
 *
 * Nur EINDEUTIGE Ergebnisse aendern etwas: 'geloescht' nimmt auf, 'traegt'
 * nimmt heraus (ein Eintrag kann zurueckkommen — etwa nach Neu-Verknuepfen),
 * 'unklar' laesst den ALTEN Zustand stehen. So ueberlebt die Kennzeichnung
 * einen Netzausfall in beide Richtungen.
 */
export function fortschreiben(
  alt: ReadonlySet<string>,
  ergebnisse: ReadonlyArray<{ id: string; stand: Stand }>,
): Set<string> {
  const neu = new Set(alt)
  for (const e of ergebnisse) {
    if (e.stand === 'geloescht') neu.add(e.id)
    else if (e.stand === 'traegt') neu.delete(e.id)
  }
  return neu
}

/* c8 ignore next 3 */
declare const module: { exports: unknown } | undefined
if (typeof module !== 'undefined')
  module.exports = { kennungVon, pruefPfad, pruefPfade, urteilAus, einstufen, fortschreiben }
