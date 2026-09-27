/**
 * Spotify-Anmeldung (Authorization Code + PKCE) — die REINE Logik.
 *
 * HERKUNFT: 1:1 aus der alten Angular-Oberflaeche portiert
 * (src/frontend-box/src/app/spotify-auth.ts, dort unit-getestet), im Zuge von
 * E118/1a: die Anmeldeseite /spotify wird eigenstaendig, damit die alte App
 * fallen kann. Die Regeln hier sind teuer erkauft (BACKLOG E22, R1-R4) —
 * wer eine aendert, lese zuerst die Kommentare.
 *
 * EIN ES-MODUL, KEIN IIFE wie app.js: diese Datei wird von ZWEI Seiten
 * gebraucht — von spotify-anmeldung.html im Browser und von
 * tools/e2e/spotify-anmeldung-logik.test.mjs unter node --test. Ein Export
 * ist hier der Testzugang, kein Stilbruch.
 *
 * KEIN GEHEIMNIS, NIRGENDS: PKCE ist der geheimnislose Anmeldefluss. Es gibt
 * kein client_secret, weder im Browser noch in der Konfiguration.
 */

export const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'

/**
 * DER RUECKWEG. Eine feste Adresse — ausdruecklich NICHT die, unter der die
 * Seite gerade offen ist (BACKLOG E22/R1).
 *
 * WARUM FEST: Spotify vergleicht redirect_uri ZEICHENGENAU mit dem Dashboard.
 * Ein Rueckweg aus window.location.origin wandert mit der Adresse mit — vom
 * Laptop HTTP und nicht Loopback (abgelehnt), ueber 8443 mit Zeugnis-Warnung,
 * in fremdem WLAN mit neuer IP (neuer Dashboard-Eintrag).
 *
 * WARUM AUSGERECHNET DIESE: Spotify hat 2025 HTTP-Rueckwege abgeschafft — mit
 * genau einer Ausnahme, dem IP-LITERAL http://127.0.0.1:PORT. Der Name
 * localhost ist ausdruecklich NICHT erlaubt. Diese Adresse braucht kein
 * Zeugnis, laeuft nie ab und ist in jedem Netz dieselbe.
 *
 * DASS DORT (am Laptop/Handy) NIEMAND LAUSCHT, ist der Trick, kein Mangel:
 * der Browser zeigt eine Fehlerseite, der Code steht in der Adresszeile und
 * wird von Hand zurueckgereicht (E22/R2, sucheAusAdresse).
 */
export const SPOTIFY_RUECKWEG_VORGABE = 'http://127.0.0.1:8200/spotify'

/* Leserechte + Steuerung (Steuern braucht Premium). user-library-read traegt
 * die gespeicherten Alben und Podcasts der Verwaltung. */
export const SPOTIFY_SCOPE = [
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-read-private',
  'streaming',
].join(' ')

/** base64url OHNE Auffuellung (RFC 7636 verlangt url-sicher, unaufgefuellt). */
export function b64url(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** PKCE code_challenge = base64url(sha256(verifier)) (S256). Async: WebCrypto. */
export async function codeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return b64url(new Uint8Array(digest))
}

/** Ein frisches {verifier, challenge}-Paar. Der Verifier (43-128 Zeichen)
 *  bleibt fuer den Tausch weggelegt; nur die Challenge geht zu Spotify. */
export async function pkcePair() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(64)))
  return { verifier, challenge: await codeChallenge(verifier) }
}

/** Ein Zufalls-State (CSRF-Wache, kommt auf der Rueckleitung zurueck). */
export function randomState() {
  return b64url(crypto.getRandomValues(new Uint8Array(16)))
}

/** Die Spotify-Freigabe-Adresse, zu der der Browser springt. */
export function spotifyAuthUrl(clientId, challenge, state, redirectUri, scope = SPOTIFY_SCOPE) {
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  })
  return SPOTIFY_AUTH_URL + '?' + q.toString()
}

/** Den Frageteil der Rueckleitung lesen (?code=...&state=... oder ?error=...). */
export function parseSpotifyCallback(search) {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return { code: q.get('code') || undefined, state: q.get('state') || undefined, error: q.get('error') || undefined }
}

/**
 * Aus einer EINGEFUEGTEN Adresse den Frageteil herausloesen (BACKLOG E22/R2).
 *
 * Der Rueckweg zeigt auf 127.0.0.1; am Laptop/Handy lauscht dort nichts, der
 * Browser zeigt eine Fehlerseite — aber der Code steht in der Adresszeile.
 * Der Benutzer kopiert sie und fuegt sie ein. Was alles ankommt:
 *   - die ganze Adresse            http://127.0.0.1:8200/spotify?code=...&state=...
 *   - nur der Frageteil            ?code=...&state=...  oder  code=...&state=...
 *   - mit Bruchstueck              ...?code=...#/spotify (hinter # steht nichts Nuetzliches)
 *   - in Anfuehrungszeichen oder spitzen Klammern (Chat- und Mailprogramme)
 *
 * ERST das Bruchstueck abschneiden, DANN den Frageteil suchen: andersherum
 * landete ein # hinter dem Code mit im State, und die Pruefung schluege fehl —
 * mit einer Meldung, die nach Angriff aussieht.
 */
export function sucheAusAdresse(text) {
  const roh = (text ?? '')
    .trim()
    .replace(/^[<"']+/, '')
    .replace(/[>"']+$/, '')
  if (!roh) return ''
  const ohneBruch = roh.split('#')[0]
  const frage = ohneBruch.indexOf('?')
  return frage >= 0 ? ohneBruch.slice(frage + 1) : ohneBruch
}

/** POST-Koerper (x-www-form-urlencoded) fuer den Code-Tausch — PKCE, also
 *  code_verifier statt client_secret. */
export function tokenExchangeBody(code, verifier, clientId, redirectUri) {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  }).toString()
}

/** POST-Koerper fuer die Erneuerung (oeffentlicher Client: client_id, kein Geheimnis). */
export function refreshTokenBody(refreshToken, clientId) {
  return new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  }).toString()
}

/**
 * Fehler in Worten, die den naechsten Handgriff nennen.
 *
 * Zwei Toepfe, weil es zwei Herkuenfte sind (aus der alten Seite uebernommen,
 * dort am 04.08.2026 gegengelesen):
 *   - SPOTIFYS Antworten am Tausch-Endpunkt kommen als HTTP-Status mit
 *     {error: {error: kennung}} — invalid_grant heisst dabei meist NICHT
 *     "abgelaufen", sondern doppelt eingeloest oder Rueckweg nicht
 *     zeichengenau gleich.
 *   - die EIGENEN Kennungen (no_pkce_state, state_mismatch, no_code,
 *     access_denied) wirft der Ablauf hier selbst, ohne HTTP-Status.
 */
export const SPOTIFY_KLARTEXT = {
  invalid_grant:
    'Spotify hat den Code nicht angenommen. Das heißt meist NICHT „abgelaufen": am häufigsten wurde derselbe Code schon einmal eingelöst, oder die Redirect-URI von oben stimmt nicht Zeichen für Zeichen mit der im Spotify-Dashboard überein. Am schnellsten: „Angefangene Anmeldung verwerfen" und noch einmal von vorn.',
  invalid_client:
    'Spotify kennt diese Client-ID nicht. Bitte die Client-ID aus dem Spotify-Dashboard prüfen (nicht das Secret — PKCE braucht keins).',
}

export const EIGENE_KLARTEXT = {
  no_pkce_state:
    'Dieser Tab hat die Anmeldung nicht begonnen. Bitte im SELBEN Tab zurückgehen, in dem „Mit Spotify verbinden" gedrückt wurde — oder die Anmeldung hier neu starten.',
  state_mismatch:
    'Die eingefügte Adresse gehört zu einer anderen Anmeldung. Bitte die Adresse der ZULETZT geöffneten Fehlerseite einfügen.',
  no_code: 'In der eingefügten Adresse steht kein „code=". Bitte die ganze Adresszeile der Fehlerseite kopieren.',
  access_denied: 'Die Freigabe wurde bei Spotify abgelehnt.',
}

/**
 * Einen Fehler (geworfene Kennung ODER HTTP-Antwort) in einen Satz uebersetzen.
 * e ist entweder ein Error mit einer Kennung als message, oder ein Objekt
 * { status, error: { error, error_description } } aus einer fetch-Antwort.
 */
export function fehlerText(e) {
  const s = e && typeof e === 'object' ? e.status : undefined
  if (s) {
    const grund = e.error
    const uebersetzt = grund && grund.error ? SPOTIFY_KLARTEXT[grund.error] : undefined
    if (uebersetzt) return uebersetzt
    const text = grund && (grund.error_description || grund.error)
    return text ? 'HTTP ' + s + ' — ' + text : 'HTTP ' + s
  }
  const m = String((e && e.message) ?? e)
  return EIGENE_KLARTEXT[m] ?? m
}
