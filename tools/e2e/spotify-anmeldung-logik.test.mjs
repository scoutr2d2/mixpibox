/**
 * Tests fuer NewDesign/spotify-anmeldung-logik.mjs — die reine PKCE-Logik der
 * eigenstaendigen Spotify-Anmeldeseite (E118/1a).
 *
 * HERKUNFT DER FAELLE: 1:1 aus src/frontend-box/src/app/spotify-auth.spec.ts
 * uebernommen (Karma/Jasmine), bevor die alte Angular-Oberflaeche faellt. Die
 * Faelle sind teuer erkauft (BACKLOG E22): der RFC-7636-Testvektor, der feste
 * Rueckweg als Literal, und JEDE Sorte Zwischenablage am Einfuegefeld.
 *
 * LAEUFT MIT BORDMITTELN: node --test, kein vitest, kein jsdom — dasselbe
 * Muster wie tools/e2e/neu-oberflaeche.test.mjs. WebCrypto und btoa sind in
 * Node global vorhanden.
 *
 * AUFRUF
 *     node --test tools/e2e/spotify-anmeldung-logik.test.mjs
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  EIGENE_KLARTEXT,
  SPOTIFY_KLARTEXT,
  SPOTIFY_RUECKWEG_VORGABE,
  b64url,
  codeChallenge,
  fehlerText,
  parseSpotifyCallback,
  pkcePair,
  refreshTokenBody,
  spotifyAuthUrl,
  sucheAusAdresse,
  tokenExchangeBody,
} from '../../NewDesign/spotify-anmeldung-logik.mjs'

describe('PKCE-Handgriffe', () => {
  test('b64url ist url-sicher und unaufgefuellt', () => {
    assert.equal(b64url(new Uint8Array([0xff, 0xff, 0xff])), '____')
    assert.equal(b64url(new Uint8Array([0x00])), 'AA')
  })

  test('codeChallenge trifft den S256-Testvektor aus RFC 7636', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    assert.equal(await codeChallenge(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  test('pkcePair liefert gueltigen Verifier + passende Challenge', async () => {
    const { verifier, challenge } = await pkcePair()
    assert.ok(verifier.length >= 43 && verifier.length <= 128)
    assert.equal(challenge, await codeChallenge(verifier))
  })

  test('spotifyAuthUrl traegt PKCE + OAuth — und KEIN Geheimnis', () => {
    const url = new URL(spotifyAuthUrl('CID', 'CHAL', 'STATE', 'http://localhost:4200/spotify'))
    assert.equal(url.origin + url.pathname, 'https://accounts.spotify.com/authorize')
    const q = url.searchParams
    assert.equal(q.get('client_id'), 'CID')
    assert.equal(q.get('response_type'), 'code')
    assert.equal(q.get('redirect_uri'), 'http://localhost:4200/spotify')
    assert.equal(q.get('code_challenge_method'), 'S256')
    assert.equal(q.get('code_challenge'), 'CHAL')
    assert.equal(q.get('state'), 'STATE')
    assert.ok(q.get('scope').includes('user-modify-playback-state'))
    assert.ok(q.get('scope').includes('user-library-read'))
    assert.ok(!url.href.includes('secret'))
  })

  test('parseSpotifyCallback liest code/state und error', () => {
    assert.deepEqual(parseSpotifyCallback('?code=AC&state=ST'), { code: 'AC', state: 'ST', error: undefined })
    assert.deepEqual(parseSpotifyCallback('error=access_denied'), {
      code: undefined,
      state: undefined,
      error: 'access_denied',
    })
  })

  test('tokenExchangeBody nutzt PKCE (code_verifier, kein client_secret)', () => {
    const b = new URLSearchParams(tokenExchangeBody('CODE', 'VER', 'CID', 'http://localhost:4200/spotify'))
    assert.equal(b.get('grant_type'), 'authorization_code')
    assert.equal(b.get('code'), 'CODE')
    assert.equal(b.get('code_verifier'), 'VER')
    assert.equal(b.get('client_id'), 'CID')
    assert.equal(b.get('redirect_uri'), 'http://localhost:4200/spotify')
    assert.equal(b.has('client_secret'), false)
  })

  test('refreshTokenBody erneuert nur mit client_id (kein Geheimnis)', () => {
    const b = new URLSearchParams(refreshTokenBody('RT', 'CID'))
    assert.equal(b.get('grant_type'), 'refresh_token')
    assert.equal(b.get('refresh_token'), 'RT')
    assert.equal(b.get('client_id'), 'CID')
    assert.equal(b.has('client_secret'), false)
  })
})

/**
 * DER FESTE RUECKWEG (BACKLOG E22/R1). Kein Geschmack, sondern Spotifys
 * einzige HTTP-Ausnahme: waere hier localhost, https oder ein anderer Port,
 * faende man es erst an der Box — als "Insecure redirect URI", was nach einem
 * TLS-Problem aussieht.
 */
describe('SPOTIFY_RUECKWEG_VORGABE', () => {
  test('ist das Loopback-LITERAL, nicht der Name localhost', () => {
    const u = new URL(SPOTIFY_RUECKWEG_VORGABE)
    assert.equal(u.protocol, 'http:')
    assert.equal(u.hostname, '127.0.0.1')
    assert.notEqual(u.hostname, 'localhost')
    assert.equal(u.port, '8200')
    assert.equal(u.pathname, '/spotify')
  })
})

/**
 * Das Einfuegefeld (BACKLOG E22/R2) — JEDE Sorte, die aus der Zwischenablage
 * wirklich ankommt. Eine einzige saubere Adresse zu pruefen liesse offen, was
 * bei allem passiert, was Menschen tatsaechlich einfuegen.
 */
describe('sucheAusAdresse — was aus der Zwischenablage kommt', () => {
  const code = (text) => parseSpotifyCallback(sucheAusAdresse(text)).code

  test('nimmt die ganze Adresszeile der Fehlerseite', () => {
    assert.equal(code('http://127.0.0.1:8200/spotify?code=AC&state=ST'), 'AC')
  })

  test('nimmt auch nur den Frageteil — mit und ohne Fragezeichen', () => {
    assert.equal(code('?code=AC&state=ST'), 'AC')
    assert.equal(code('code=AC&state=ST'), 'AC')
  })

  test('wirft ein angehaengtes Bruchstueck weg, statt es in den State zu ziehen', () => {
    const cb = parseSpotifyCallback(sucheAusAdresse('http://127.0.0.1:8200/spotify?code=AC&state=ST#/spotify'))
    assert.equal(cb.code, 'AC')
    // OHNE das Abschneiden stuende hier "ST#/spotify" — die Pruefung schluege
    // fehl, und die Meldung saehe nach einem Angriff aus.
    assert.equal(cb.state, 'ST')
  })

  test('vertraegt Anfuehrungszeichen und spitze Klammern von Chat- und Mailprogrammen', () => {
    assert.equal(code('"http://127.0.0.1:8200/spotify?code=AC"'), 'AC')
    assert.equal(code('<http://127.0.0.1:8200/spotify?code=AC>'), 'AC')
    assert.equal(code('  http://127.0.0.1:8200/spotify?code=AC  '), 'AC')
  })

  test('reicht einen Fehler von Spotify durch, statt ihn zu verschlucken', () => {
    assert.equal(
      parseSpotifyCallback(sucheAusAdresse('http://127.0.0.1:8200/spotify?error=access_denied')).error,
      'access_denied',
    )
  })

  test('findet in Leerem und in einer Adresse OHNE Frageteil keinen Code', () => {
    assert.equal(code(''), undefined)
    assert.equal(code('   '), undefined)
    assert.equal(code('http://127.0.0.1:8200/spotify'), undefined)
  })
})

/**
 * fehlerText — die Uebersetzung in den naechsten Handgriff. Zwei Toepfe (die
 * eigenen Kennungen ohne Status, Spotifys Antworten mit Status); beim
 * Gegenlesen der alten Seite am 04.08.2026 wurde nur einer bedient.
 */
describe('fehlerText — beide Toepfe werden bedient', () => {
  test('eigene Kennungen (ohne HTTP-Status) werden uebersetzt', () => {
    assert.equal(fehlerText(new Error('no_pkce_state')), EIGENE_KLARTEXT.no_pkce_state)
    assert.equal(fehlerText(new Error('state_mismatch')), EIGENE_KLARTEXT.state_mismatch)
    assert.equal(fehlerText(new Error('no_code')), EIGENE_KLARTEXT.no_code)
    assert.equal(fehlerText(new Error('access_denied')), EIGENE_KLARTEXT.access_denied)
  })

  test('Spotifys Tausch-Antworten (mit HTTP-Status) werden uebersetzt', () => {
    assert.equal(fehlerText({ status: 400, error: { error: 'invalid_grant' } }), SPOTIFY_KLARTEXT.invalid_grant)
    assert.equal(fehlerText({ status: 400, error: { error: 'invalid_client' } }), SPOTIFY_KLARTEXT.invalid_client)
  })

  test('Unbekanntes bleibt sichtbar statt verschluckt', () => {
    assert.equal(fehlerText({ status: 500, error: { error_description: 'kaputt' } }), 'HTTP 500 — kaputt')
    assert.equal(fehlerText({ status: 503 }), 'HTTP 503')
    assert.equal(fehlerText(new Error('voellig_neu')), 'voellig_neu')
  })
})
