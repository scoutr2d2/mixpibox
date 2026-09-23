/**
 * DER SERVERSEITIGE QUELLEN-RUECKFALL BEI `/inhalt` — und der Schalter, wenn
 * die Abfrage ihn gar nicht mitschickt.
 *
 * DER FALL, DER DAS AUFGEDECKT HAT (mixpibox.local, gemessen 29.08.2026):
 * „Quarks Science Cops" liegt als Spotify-HOERBUCH UND als ARD-Sendung in der
 * Bibliothek, verschmolzen mit Stufe „locker". Spotify sortiert vor ARD
 * (`QUELLEN_REIHENFOLGE` kennt ARD gar nicht, `rang()` sortiert Unbekanntes
 * ans Ende) und ist damit die BEVORZUGTE Quelle — genau die, die an dem Tag
 * mit „Spotify 404" ausfiel. `GET /inhalt` auf dem Fuehrer antwortete mit
 * demselben 404, obwohl die ARD-Folgenliste vollstaendig dastand. Die
 * Oberflaeche meldete „Die Folgen ließen sich nicht laden." — fuer ein Werk,
 * das spielbereit war.
 *
 * ZWEI ZUSAGEN STEHEN HIER, UND BEIDE SIND NEU:
 *
 *   1. Scheitert die bevorzugte Quelle eines verschmolzenen Werks, probiert
 *      der SERVER die naechste aus `werk.quellen`, bevor er aufgibt — statt
 *      den Fehler der einen Quelle durchzureichen, waehrend die Box laengst
 *      wusste, dass es eine zweite gibt. Nur OHNE `quelle=`-Wunsch: wer
 *      ausdruecklich nach einer bestimmten Quelle fragt, bekommt sie oder
 *      ihren Fehler — kein Ausweichen, das er nicht angefordert hat.
 *   2. Fehlt `verschmelzen` in der Abfrage GANZ (wie beim Oeffnen der
 *      Folgen-Lane, app.js `folgenOeffnen` — sie schickt den Schalter bis
 *      heute nie mit), gilt der Schalter aus der DARSTELLUNG
 *      (`aktuell.verschmelzen`, dieselbe Ablage wie `GET /api/darstellung`),
 *      nicht mehr automatisch „aus".
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import nock from 'nock'
import request from 'supertest'
import { medienSchluessel } from './medien.js'

/** Dieselben Kennungen wie am Geraet gemessen — kein Zufall, leichter zu belegen. */
const SPOTIFY_HOERBUCH = {
  type: 'spotify',
  category: 'audiobook',
  showid: '0rQTpxXFmKsC8vu6O56KNk',
  title: 'Quarks Science Cops',
  artist: 'Quarks',
}
const ARD_SENDUNG = {
  type: 'ard',
  category: 'audiobook',
  id: '83030960',
  title: 'Quarks Science Cops',
  artist: 'Quarks',
}
/**
 * DIE „NAH"-KONSTELLATION (E95 Stufe 1, Betreiber-Messfall 29.08.2026): ein
 * lokaler Mitschnitt, dessen `playlist.m3u` nur einen TEIL des Albums traegt,
 * UND dieselbe Spotify-Ausgabe daneben. `lokal` steht in `QUELLEN_REIHENFOLGE`
 * vorn — ohne die Wahlfunktion (`waehleInhalt`, verschmelzung.ts) waere die
 * lokale Teilliste der erste und damit einzige Versuch.
 */
const LOKAL_NAH = {
  type: 'library',
  category: 'music',
  artist: 'Alin Coen',
  title: 'Nah',
}
const SPOTIFY_NAH = {
  type: 'spotify',
  category: 'music',
  id: 'nah-album-kennung',
  title: 'Nah',
  artist: 'Alin Coen',
}
const KATALOG = [SPOTIFY_HOERBUCH, ARD_SENDUNG, LOKAL_NAH, SPOTIFY_NAH]
const SCHLUESSEL_SPOTIFY = medienSchluessel(SPOTIFY_HOERBUCH)
const SCHLUESSEL_ARD = medienSchluessel(ARD_SENDUNG)
const SCHLUESSEL_LOKAL_NAH = medienSchluessel(LOKAL_NAH)
const SCHLUESSEL_SPOTIFY_NAH = medienSchluessel(SPOTIFY_NAH)

const inhalt = (abfrage = '') =>
  request(app).get(`/api/werke/${encodeURIComponent(SCHLUESSEL_SPOTIFY)}/inhalt${abfrage}`)
/** Dieselbe Anfrage, aber auf dem FUEHRER der Nah-Zuordnung (lokal). */
const inhaltNah = (abfrage = '') =>
  request(app).get(`/api/werke/${encodeURIComponent(SCHLUESSEL_LOKAL_NAH)}/inhalt${abfrage}`)

let app: import('express').Express
let verzeichnis = ''

/** Die Gruppierung von Hand — genau die Form, die `abgleich.ts` auch vorschlagen wuerde. */
function verschmelzungSchreiben(gruppiert: boolean) {
  writeFileSync(
    join(verzeichnis, 'verschmelzung.json'),
    JSON.stringify({
      zuordnungen: gruppiert
        ? [
            { schluessel: SCHLUESSEL_SPOTIFY, auch: [SCHLUESSEL_ARD], stufe: 'locker' },
            { schluessel: SCHLUESSEL_LOKAL_NAH, auch: [SCHLUESSEL_SPOTIFY_NAH], stufe: 'locker' },
          ]
        : [],
      getrennt: [],
    }),
  )
}

/**
 * `aktuell.verschmelzen` in der box-weiten darstellung.json — oder gar keine
 * Datei (`'keine'` LOESCHT eine aus einem frueheren Testfall aktiv, statt sie
 * bloss stehenzulassen).
 */
function darstellungSchreiben(an: boolean | 'keine') {
  const pfad = join(verzeichnis, 'darstellung.json')
  if (an === 'keine') {
    if (existsSync(pfad)) rmSync(pfad)
    return
  }
  writeFileSync(pfad, JSON.stringify({ aktuell: { verschmelzen: an }, themen: {} }))
}

/** Die ARD-Antwort, die der Plugin-Stummel gleich zurueckgibt. */
function ardAntwortSetzen(folgen: unknown[]) {
  writeFileSync(
    join(verzeichnis, 'plugin-antwort.json'),
    JSON.stringify({ titel: 'Quarks Science Cops', kuenstler: 'Quarks', vollstaendig: true, folgen }),
  )
}

/**
 * Spotify faelschen: erst der Token, dann die Titelliste — 404, wie am
 * Geraet gemessen. Beide Interceptoren werden GENAU EINMAL gebraucht (ein
 * Versuch je Testfall) und danach verworfen.
 */
function spotifyStub404() {
  nock('https://accounts.spotify.com')
    .post('/api/token')
    .reply(200, { access_token: 'stummel-merkmal', expires_in: 3600 })
  nock('https://api.spotify.com')
    // AUCH DER SHOW-PFAD, seit 11.09.2026. Hier stand nur
    // `/v1/albums/…/tracks` — und seit `spotifyTitelPfad()` (medien.ts, mit
    // Commit „Spotify-Podcasts liefern zum ersten Mal ihre Folgen")
    // unterscheidet der Server nach ART: ein Eintrag mit `showid` geht auf
    // `/v1/shows/<id>/episodes`, nicht auf den Albumpfad.
    //
    // `SPOTIFY_HOERBUCH` oben TRAEGT eine `showid` — absichtlich, es sind die
    // am Geraet gemessenen Kennungen. Die Attrappe wurde beim Umbau nicht
    // mitgezogen, und nock antwortete mit „No match for request" statt mit
    // 404. Der Test verglich dann eine nock-Fehlermeldung mit „Spotify 404"
    // und fiel — ohne dass am Server irgendetwas kaputt gewesen waere.
    .get(/\/v1\/(albums|shows)\/[^/]+\/(tracks|episodes)/)
    .query(true)
    .reply(404, 'Not Found')
}

/**
 * Spotify ERFOLGREICH, mit `anzahlTitel` Stuecken — die Gegenseite der Nah-
 * Konstellation. Der Token-Interceptor darf ungenutzt bleiben: sobald ein
 * frueherer Testfall (z.B. (a)) bereits erfolgreich einen Token geholt hat,
 * bedient `webApiToken()` sich aus dem Zwischenspeicher, ohne erneut zu
 * fragen — `nock` beschwert sich nicht ueber uebrige, nie abgerufene Mocks.
 */
function spotifyAlbumErfolgStub(id: string, anzahlTitel: number) {
  nock('https://accounts.spotify.com')
    .post('/api/token')
    .reply(200, { access_token: 'stummel-merkmal', expires_in: 3600 })
  nock('https://api.spotify.com')
    .get(`/v1/albums/${id}/tracks`)
    .query(true)
    .reply(200, {
      items: Array.from({ length: anzahlTitel }, (_, i) => ({
        name: `Titel ${i + 1}`,
        artists: [{ name: 'Alin Coen' }],
        uri: `spotify:track:nah${i + 1}`,
        album: { name: 'Nah', images: [] },
        duration_ms: 200_000,
      })),
    })
}

/**
 * DER LOKALE MITSCHNITT, mit `anzahlTitel` Stuecken — der Abspieldienst
 * (`PLAYER_PROXY_HOST`/`PORT`, Vorgabe `127.0.0.1:5005`, server.ts) laeuft im
 * Test nicht wirklich; `nock` ersetzt ihn genau wie sonst Spotify. Derselbe
 * Pfad, den `inhaltFuerEintrag()` aus `category/artist/title` zusammensetzt:
 * `music/Alin Coen/Nah`.
 */
function lokalTracklistStub(anzahlTitel: number) {
  nock('http://127.0.0.1:5005')
    .get('/tracklist')
    .query(true)
    .reply(200, {
      tracks: Array.from({ length: anzahlTitel }, (_, i) => ({ nr: i + 1, name: `Aufgezeichnet ${i + 1}` })),
    })
}

describe('Serverseitiger Quellen-Rueckfall bei /api/werke/:schluessel/inhalt', () => {
  before(async () => {
    verzeichnis = mkdtempSync(join(tmpdir(), 'mupi-inhalt-rueckfall-'))
    writeFileSync(join(verzeichnis, 'data.json'), JSON.stringify(KATALOG, null, 2))
    writeFileSync(join(verzeichnis, 'active_data.json'), JSON.stringify(KATALOG, null, 2))
    writeFileSync(
      join(verzeichnis, 'config.json'),
      JSON.stringify({
        spotify: { clientId: 'stummel-kennung', clientSecret: 'stummel-geheimnis', refreshToken: 'stummel-merkmal' },
        'node-sonos-http-api': { server: 'MixPiBox' },
      }),
    )
    verschmelzungSchreiben(true)
    process.env.MUPIBOX_CONFIG_DIR = verzeichnis
    // Eigene Sperrdatei je Lauf — `node --test` startet Spec-Dateien parallel.
    process.env.MUPIBOX_LOCK_DIR = verzeichnis

    // Derselbe Plugin-Stummel wie in ard.integration.spec.ts, an derselben
    // Naht (E78): der SERVER holt die Folgen nicht mehr selbst, sondern ueber
    // einen Worker, den `nock` nicht faelschen kann.
    const plugins = join(verzeichnis, '.mupibox', 'plugins', 'mixpi-ardsounds')
    mkdirSync(plugins, { recursive: true })
    writeFileSync(
      join(plugins, 'plugin.json'),
      JSON.stringify({ kennung: 'mixpi-ardsounds', name: 'Stummel', fassung: '1.0.0', haupt: 'index.mjs', rechte: [] }),
    )
    writeFileSync(
      join(plugins, 'index.mjs'),
      `import { readFileSync } from 'node:fs'
export default {
  async inhalt() {
    return JSON.parse(readFileSync(${JSON.stringify(join(verzeichnis, 'plugin-antwort.json'))}, 'utf8'))
  },
}\n`,
    )
    process.env.MUPIBOX_PLUGIN_DIR = join(verzeichnis, '.mupibox', 'plugins')
    ardAntwortSetzen([
      { kennung: 'f1', name: 'Folge 1', quelle: { art: 'strom', adresse: 'https://ardstub.invalid/f1.mp3' } },
    ])

    app = (await import('./server.js')).app
    const { warteBereit } = await import('./plugin-wirt.js')
    await warteBereit('mixpi-ardsounds', 10_000)

    // Die Konfiguration wird ASYNCHRON gelesen (server.ts, `readJsonFile(…)
    // .then(…)`) — ohne dieses Warten antwortet der erste Versuch, bevor
    // `config.spotify` steht, und der Spotify-Zweig scheiterte aus dem
    // falschen Grund («nicht eingerichtet» statt am Stub-404).
    for (let i = 0; i < 50; i++) {
      if ((await request(app).get('/api/spotify/config')).status === 200) break
      await new Promise((weiter) => setTimeout(weiter, 20))
    }
  })

  after(async () => {
    const { allesBeenden } = await import('./plugin-wirt.js')
    await allesBeenden()
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_LOCK_DIR = undefined
    process.env.MUPIBOX_PLUGIN_DIR = undefined
    nock.cleanAll()
  })

  it('(a) Hoerbuch-Fall: der Fuehrer (Spotify) scheitert, die Antwort kommt aus der zweiten Quelle (ARD)', async () => {
    darstellungSchreiben(false)
    spotifyStub404()
    const r = await inhalt('?verschmelzen=1').expect(200)
    assert.equal(r.body.dienst, 'ard')
    assert.equal(r.body.titel[0].titel, 'Folge 1')
  })

  it('(b) `quelle=spotify` erzwingt genau die scheiternde Quelle — KEIN Rueckfall', async () => {
    darstellungSchreiben(false)
    spotifyStub404()
    const r = await inhalt('?verschmelzen=1&quelle=spotify').expect(502)
    assert.equal(r.body.error, 'Spotify 404')
  })

  it('(c) `verschmelzen=0` explizit: das alte Verhalten — der Fuehrer allein, kein Gruppenwissen', async () => {
    darstellungSchreiben(false)
    spotifyStub404()
    const r = await inhalt('?verschmelzen=0').expect(502)
    assert.equal(r.body.error, 'Spotify 404')
  })

  it('(d1) Query fehlt GANZ, Schalter in der Darstellung AN: wirkt wie `verschmelzen=1`', async () => {
    darstellungSchreiben(true)
    spotifyStub404()
    const r = await inhalt().expect(200)
    assert.equal(r.body.dienst, 'ard')
  })

  it('(d2) Query fehlt GANZ, Schalter in der Darstellung AUS: wirkt wie `verschmelzen=0`', async () => {
    darstellungSchreiben(false)
    spotifyStub404()
    const r = await inhalt().expect(502)
    assert.equal(r.body.error, 'Spotify 404')
  })

  it('(d3) Query fehlt GANZ, gar keine darstellung.json: Vorgabe AN, wie `verschmelzen=1`', async () => {
    // ══ DIESER ZEUGE STAND AUF DEM KOPF (bis 11.09.2026) ═══════════════════
    //
    // Er hiess „Vorgabe AUS" und erwartete 502. Das war bis zum 06.09.2026
    // richtig — an dem Tag hat der Betreiber die Vorgabe umgedreht („ich
    // würde default immer verschmolzen machen da wir ja auch so intern
    // arbeiten"), `verschmelzenAusDarstellung()` in server.ts prueft seither
    // `!== false`: nur ein AUSDRUECKLICH gespeichertes `false` schaltet ab,
    // ein fehlender Schluessel bekommt das Hausverhalten.
    //
    // Der Zeuge wurde dabei nicht mitgezogen und war seither rot. Das ist
    // teurer als es aussieht: eine dauerhaft rote Suite erzieht dazu, Rot zu
    // ueberlesen — und dann faellt der naechste, echte Fund nicht mehr auf.
    //
    // WAS ER JETZT FESTHAELT, ist die Kehrseite derselben Entscheidung und
    // deshalb weiter pruefenswert: „nie entschieden" darf nicht wie „aus"
    // wirken. Der Unterschied zu (d2) ist genau das ausdrueckliche `false`.
    darstellungSchreiben('keine')
    spotifyStub404()
    const r = await inhalt().expect(200)
    assert.equal(r.body.dienst, 'ard')
  })

  it('(e) NAH-KONSTELLATION (E95 Stufe 1): lokal UND spotify erfolgreich, aber lokal hat nur 3 von 12 Titeln — die vollere gewinnt', async () => {
    // GENAU DER MESSFALL, DER STUFE 1 AUSGELOEST HAT: lokal steht in
    // `QUELLEN_REIHENFOLGE` vorn und antwortet auch mit 200 — anders als in
    // den Faellen oben (a)/(d1) scheitert hier NIEMAND. Vor `waehleInhalt()`
    // waere die lokale (unvollstaendige) Antwort trotzdem gewonnen, weil sie
    // als ERSTE erfolgreich war.
    darstellungSchreiben(false)
    lokalTracklistStub(3)
    spotifyAlbumErfolgStub(SPOTIFY_NAH.id, 12)
    const r = await inhaltNah('?verschmelzen=1').expect(200)
    assert.equal(r.body.dienst, 'spotify')
    assert.equal(r.body.titel.length, 12)
  })
})
