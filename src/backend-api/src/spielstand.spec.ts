/**
 * Zeugen fuer den SPIELSTAND (E75).
 *
 * DIE VORLAGEN SIND ECHT, nicht erfunden: beide Formen stammen vom 22.08.2026
 * von der Box — Soloists `playback_state` aus `soloist ctl now --json`, die
 * Web-API-Form aus dem Code, der sie bis dahin inline auseinandernahm.
 *
 * DER WICHTIGSTE ZEUGE ist der letzte: BEIDE QUELLEN, EIN TITEL, DASSELBE
 * ERGEBNIS. Zwei Quellen, die sich in einem Feld unterscheiden, faellt am
 * Schirm niemandem auf — bis eine Kachel nicht mehr startet.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SPIELSTAND_LEER, ausSoloist, ausWebApi, grosstesBild, kennungAusUri, positionJetzt } from './spielstand'

const ALBUM_URI = 'spotify:album:2ITVvrNiINKRiW7wA3w6w6'
const ALBUM_ID = '2ITVvrNiINKRiW7wA3w6w6'
const BILD_GROSS = 'https://i.scdn.co/image/ab67616d0000b273000db23d185de8c78efabd92'
const BILD_KLEIN = 'https://i.scdn.co/image/ab67616d00004851000db23d185de8c78efabd92'

/** Wie Soloist es am 22.08.2026 wirklich geliefert hat. */
const SOLOIST_ZUSTAND = {
  type: 'playback_state',
  status: 'playing',
  is_active: true,
  position: { position_ms: 41230, timestamp_ms: 1787386236216, speed: 1.0 },
  context: { uri: 'spotify:album:2ITVvrNiINKRiW7wA3w6w6', entity_type: 'album' },
  item: {
    uri: 'spotify:track:2a5cbTg2UIi784t9E2wT35',
    entity_type: 'track',
    decorations: {
      identity: { name: 'Black Summer' },
      visual_identity: {
        cover: [
          { url: BILD_KLEIN, size: 'small' },
          { url: 'https://i.scdn.co/image/ab67616d00001e02000db23d185de8c78efabd92', size: 'default' },
          { url: BILD_GROSS, size: 'large' },
          { url: BILD_GROSS, size: 'xlarge' },
        ],
      },
      parent: {
        entity: { uri: ALBUM_URI, entity_type: 'album', decorations: { identity: { name: 'Unlimited Love' } } },
      },
      creators: [
        {
          entity: {
            uri: 'spotify:artist:0L8ExT028jH3ddEcZwqJJ5',
            decorations: { identity: { name: 'Red Hot Chili Peppers' } },
          },
        },
      ],
      playback: { duration_ms: 232412 },
    },
  },
}

const SOLOIST_ANMELDUNG = { type: 'auth_state', logged_in: true, is_active: true, device_name: 'MixPiBox' }

/** Dieselbe Wiedergabe, wie die Web-API sie beschreibt. */
const WEBAPI_ZUSTAND = {
  is_playing: true,
  progress_ms: 41230,
  device: { name: 'MixPiBox', type: 'Speaker' },
  context: { uri: 'spotify:album:2ITVvrNiINKRiW7wA3w6w6', type: 'album' },
  item: {
    name: 'Black Summer',
    duration_ms: 232412,
    artists: [{ name: 'Red Hot Chili Peppers' }],
    album: { id: ALBUM_ID, name: 'Unlimited Love', images: [{ url: BILD_GROSS }, { url: BILD_KLEIN }] },
  },
}

describe('kennungAusUri — die Web-API liefert nackt, der WebSocket voll', () => {
  it('schaelt die Kennung aus der URI', () => {
    assert.equal(kennungAusUri(ALBUM_URI), ALBUM_ID)
  })

  it('laesst eine nackte Kennung in Ruhe', () => {
    assert.equal(kennungAusUri(ALBUM_ID), ALBUM_ID)
  })

  it('vertraegt Unsinn', () => {
    for (const x of [null, undefined, 42, {}, '']) assert.equal(kennungAusUri(x), '')
  })
})

describe('grosstesBild — sonst bekommt der Kinderschirm den Daumennagel', () => {
  it('nimmt xlarge vor large vor small', () => {
    assert.equal(
      grosstesBild([
        { url: 'klein', size: 'small' },
        { url: 'gross', size: 'xlarge' },
        { url: 'mittel', size: 'large' },
      ]),
      'gross',
    )
  })

  it('nimmt bei unbekannten Groessen wenigstens das erste mit URL', () => {
    assert.equal(grosstesBild([{ size: 'riesig' }, { url: 'da', size: 'riesig' }]), 'da')
  })

  it('vertraegt Unsinn', () => {
    for (const x of [null, undefined, 'nichts', [], [{}]]) assert.equal(grosstesBild(x), '')
  })
})

describe('ausSoloist — die neue Quelle', () => {
  const s = ausSoloist(SOLOIST_ZUSTAND, SOLOIST_ANMELDUNG)

  it('liest Titel, Interpret und Album aus den decorations', () => {
    assert.equal(s.titel, 'Black Summer')
    assert.equal(s.interpret, 'Red Hot Chili Peppers')
    assert.equal(s.album, 'Unlimited Love')
  })

  it('DIE ALBUMKENNUNG TRAEGT KEIN PRAEFIX — daran haengt das Quick Add', () => {
    assert.equal(s.albumId, ALBUM_ID)
    assert.ok(!s.albumId.includes(':'), 'mit spotify:album: davor startet die Kachel nichts')
  })

  it('nimmt das grosse Bild', () => {
    assert.equal(s.bild, BILD_GROSS)
  })

  it('weiss OHNE NAMENSVERGLEICH, dass es diese Box ist', () => {
    // Das ist der eigentliche Gewinn gegenueber der Web-API: dort wird der
    // Geraetename mit dem Boxnamen verglichen, hier sagt es die Quelle selbst.
    assert.equal(s.aufDieserBox, true)
    const fremd = ausSoloist(SOLOIST_ZUSTAND, { ...SOLOIST_ANMELDUNG, is_active: false })
    assert.equal(fremd.aufDieserBox, false, 'auch wenn der Name derselbe bleibt')
  })

  it('die juengere Auskunft gewinnt — auth_state vor playback_state', () => {
    // `device_changed` frischt auth_state auf, ohne dass ein neuer
    // playback_state kommen muesste.
    const s2 = ausSoloist({ ...SOLOIST_ZUSTAND, is_active: true }, { ...SOLOIST_ANMELDUNG, is_active: false })
    assert.equal(s2.aufDieserBox, false)
  })

  it('paused ist aktiv, aber spielt nicht', () => {
    const p = ausSoloist({ ...SOLOIST_ZUSTAND, status: 'paused' }, SOLOIST_ANMELDUNG)
    assert.equal(p.aktiv, true)
    assert.equal(p.spielt, false)
  })

  it('vertraegt Unsinn statt eines Zustands', () => {
    for (const x of [null, undefined, {}, 'nichts', 42]) {
      const leer = ausSoloist(x, null)
      assert.equal(leer.aktiv, false)
      assert.equal(leer.titel, '')
    }
  })
})

describe('ausWebApi — der Grundweg, unveraendert', () => {
  const w = ausWebApi(WEBAPI_ZUSTAND, 'MixPiBox')

  it('liest dieselben Felder wie bisher', () => {
    assert.equal(w.titel, 'Black Summer')
    assert.equal(w.albumId, ALBUM_ID)
    assert.equal(w.bild, BILD_GROSS, 'images[0] ist bei Spotify das groesste')
  })

  it('erkennt die eigene Box am Namen, ohne Ruecksicht auf Gross-/Kleinschreibung', () => {
    assert.equal(ausWebApi(WEBAPI_ZUSTAND, 'mixpibox').aufDieserBox, true)
    assert.equal(ausWebApi(WEBAPI_ZUSTAND, 'Wohnzimmer').aufDieserBox, false)
  })

  it('vertraegt Unsinn', () => {
    assert.deepEqual(ausWebApi(null, 'MixPiBox'), { ...SPIELSTAND_LEER, aufDieserBox: false })
  })
})

describe('positionJetzt — der Balken darf zwischen zwei Ereignissen nicht stehenbleiben', () => {
  const POS = { position_ms: 41230, timestamp_ms: 1_000_000, speed: 1.0 }

  it('rechnet die verstrichene Zeit dazu', () => {
    // Fuenf Sekunden nach dem Stempel muss der Balken fuenf Sekunden weiter
    // sein — sonst springt er beim naechsten Ereignis.
    assert.equal(positionJetzt(POS, 232412, 1_005_000), 46230)
  })

  it('OHNE Uhr bleibt der rohe Wert stehen — fuer Zeugen', () => {
    assert.equal(positionJetzt(POS, 232412), 41230)
  })

  it('speed 0 heisst angehalten — dann steht er mit Recht', () => {
    assert.equal(positionJetzt({ ...POS, speed: 0 }, 232412, 1_099_000), 41230)
  })

  it('laeuft nie ueber das Ende hinaus', () => {
    assert.equal(positionJetzt(POS, 232412, 9_000_000), 232412)
  })

  it('geht nie rueckwaerts — auch nicht bei verstellter Uhr', () => {
    // Die Box holt ihre Zeit per RTC/NTP nach; ein Stempel aus der Zukunft ist
    // dort kein erfundener Fall.
    assert.equal(positionJetzt(POS, 232412, 999_000), 41230)
  })

  it('ohne Stempel wird nicht geraten', () => {
    assert.equal(positionJetzt({ position_ms: 500 }, 232412, 9_000_000), 500)
  })
})

describe('DER ZEUGE, AUF DEN ES ANKOMMT: beide Quellen, ein Titel', () => {
  it('liefern denselben Spielstand', () => {
    // Zwei Quellen, die sich in EINEM Feld unterscheiden, faellt am Schirm
    // niemandem auf — bis eine Kachel nicht mehr startet oder das Bild
    // ploetzlich unscharf ist. Deshalb Feld fuer Feld.
    const vonSoloist = ausSoloist(SOLOIST_ZUSTAND, SOLOIST_ANMELDUNG)
    const vonWebApi = ausWebApi(WEBAPI_ZUSTAND, 'MixPiBox')
    assert.deepEqual(vonSoloist, vonWebApi)
  })
})
