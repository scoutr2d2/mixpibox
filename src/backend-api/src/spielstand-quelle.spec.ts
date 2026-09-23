/**
 * Zeugen fuer die QUELLE des Spielstands (E75).
 *
 * KEIN NETZ, KEINE STECKDOSE. Der Draht wird hereingereicht, die Uhr auch —
 * geprueft wird das Zusammensetzen der Haeppchen und der Wechsel zwischen den
 * Quellen, denn genau dort geht es still kaputt.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SPIELSTAND_LEER, type Spielstand } from './spielstand'
import { type Draht, SpielstandQuelle } from './spielstand-quelle'

const WEBAPI_STAND: Spielstand = { ...SPIELSTAND_LEER, aktiv: true, titel: 'aus der Web-API', geraet: 'MixPiBox' }

const VOLLER_STAND = {
  type: 'playback_state',
  status: 'playing',
  is_active: true,
  position: { position_ms: 1000, timestamp_ms: 500_000, speed: 1 },
  item: {
    decorations: {
      identity: { name: 'Black Summer' },
      parent: { entity: { uri: 'spotify:album:AAA', decorations: { identity: { name: 'Unlimited Love' } } } },
      playback: { duration_ms: 232412 },
    },
  },
}

/** Ein Draht, den ein Zeuge von Hand bedient. */
function drahtDoppel() {
  let beiNachricht: ((roh: string) => void) | null = null
  let beiEnde: (() => void) | null = null
  const gesendet: string[] = []
  let offen = true
  const d: Draht = {
    beiNachricht: (cb) => (beiNachricht = cb),
    beiEnde: (cb) => (beiEnde = cb),
    senden: (t) => gesendet.push(t),
    schliessen: () => (offen = false),
  }
  return {
    draht: d,
    gesendet,
    get offen() {
      return offen
    },
    schicken: (o: unknown) => beiNachricht?.(JSON.stringify(o)),
    reissen: () => beiEnde?.(),
  }
}

function quelleMit(dd: ReturnType<typeof drahtDoppel> | null, jetzt = 500_000) {
  let webApiGefragt = 0
  const q = new SpielstandQuelle({
    endpunkt: async () => (dd ? 'ws://127.0.0.1:5033' : null),
    webApi: async () => {
      webApiGefragt++
      return WEBAPI_STAND
    },
    verbinden: async () => {
      if (!dd) throw new Error('kein Draht')
      return dd.draht
    },
    uhr: () => jetzt,
  })
  return { q, gefragt: () => webApiGefragt }
}

describe('ohne Draht bleibt es bei der Web-API', () => {
  it('fragt die Web-API, wenn es keinen Endpunkt gibt', async () => {
    const { q, gefragt } = quelleMit(null)
    assert.equal(await q.verbindenVersuchen(), false)
    assert.equal((await q.jetzt()).titel, 'aus der Web-API')
    assert.equal(q.quelle, 'webapi')
    assert.equal(gefragt(), 1)
  })

  it('meldet `angemeldet` als null, wenn es niemanden zu fragen gibt', async () => {
    const { q } = quelleMit(null)
    assert.equal(q.angemeldet, null)
  })
})

describe('mit Draht wird gepusht', () => {
  it('fragt beim Verbinden nach Anmeldung UND Zustand', async () => {
    // Sonst bliebe der innere Stand leer, bis sich zufaellig etwas aendert —
    // und die Quelle stuende auf `webapi`, obwohl der Draht steht.
    const dd = drahtDoppel()
    const { q } = quelleMit(dd)
    await q.verbindenVersuchen()
    assert.ok(dd.gesendet.some((s) => s.includes('get_auth_state')))
    assert.ok(dd.gesendet.some((s) => s.includes('get_state')))
  })

  it('nimmt den vollen Zustand an und liefert ihn ohne Web-API', async () => {
    const dd = drahtDoppel()
    const { q, gefragt } = quelleMit(dd)
    await q.verbindenVersuchen()
    dd.schicken(VOLLER_STAND)
    const s = await q.jetzt()
    assert.equal(s.titel, 'Black Summer')
    assert.equal(q.quelle, 'websocket')
    assert.equal(gefragt(), 0, 'die Web-API wurde nicht angefasst')
  })

  it('kennt die Anmeldung — die Auskunft, die es bisher nirgends gab', async () => {
    const dd = drahtDoppel()
    const { q } = quelleMit(dd)
    await q.verbindenVersuchen()
    dd.schicken({ type: 'auth_state', logged_in: true, is_active: true, device_name: 'MixPiBox' })
    assert.equal(q.angemeldet, true)
    dd.schicken({ type: 'auth_state', logged_in: false, is_active: false, device_name: 'MixPiBox' })
    assert.equal(q.angemeldet, false)
  })
})

describe('DIE HAEPPCHEN — sie ergaenzen, sie ersetzen nicht', () => {
  async function mitVollemStand() {
    const dd = drahtDoppel()
    const { q } = quelleMit(dd)
    await q.verbindenVersuchen()
    dd.schicken(VOLLER_STAND)
    return { dd, q }
  }

  it('volume_changed loescht den Titel NICHT', async () => {
    // Der Fall, der einen Schirm nach dem ersten Lautstaerkeknopf leer macht.
    const { dd, q } = await mitVollemStand()
    dd.schicken({ type: 'volume_changed', volume: 30 })
    assert.equal((await q.jetzt()).titel, 'Black Summer')
  })

  it('playback_changed aendert nur den Status', async () => {
    const { dd, q } = await mitVollemStand()
    dd.schicken({ type: 'playback_changed', status: 'paused' })
    const s = await q.jetzt()
    assert.equal(s.spielt, false)
    assert.equal(s.titel, 'Black Summer', 'der Titel bleibt')
    assert.equal(s.dauerMs, 232412, 'und die Dauer auch')
  })

  it('track_changed tauscht den Titel, laesst den Status stehen', async () => {
    const { dd, q } = await mitVollemStand()
    dd.schicken({
      type: 'track_changed',
      item: { decorations: { identity: { name: 'Aquatic Mouth Dance' }, playback: { duration_ms: 1000 } } },
    })
    const s = await q.jetzt()
    assert.equal(s.titel, 'Aquatic Mouth Dance')
    assert.equal(s.spielt, true, 'es spielt weiter')
  })

  it('device_changed gehoert zur ANMELDUNG, nicht zum Zustand', async () => {
    const { dd, q } = await mitVollemStand()
    dd.schicken({ type: 'auth_state', logged_in: true, is_active: true, device_name: 'MixPiBox' })
    assert.equal((await q.jetzt()).aufDieserBox, true)
    dd.schicken({ type: 'device_changed', is_active: false, device_name: 'MixPiBox' })
    const s = await q.jetzt()
    assert.equal(s.aufDieserBox, false, 'jemand anders hat uebernommen')
    assert.equal(s.titel, 'Black Summer', 'der Zustand bleibt unangetastet')
    assert.equal(q.angemeldet, true, 'abgemeldet ist etwas anderes als nicht aktiv')
  })

  it('Unsinn im Rahmen wird abgewiesen, nicht geworfen', async () => {
    const { dd, q } = await mitVollemStand()
    dd.schicken('kein objekt')
    assert.equal(q.aufnehmen('{kaputt'), false)
    assert.equal((await q.jetzt()).titel, 'Black Summer')
  })
})

describe('DER WECHSEL IM BETRIEB — darauf kam es dem Betreiber an', () => {
  it('faellt der Draht, uebernimmt die Web-API sofort', async () => {
    const dd = drahtDoppel()
    const { q, gefragt } = quelleMit(dd)
    await q.verbindenVersuchen()
    dd.schicken(VOLLER_STAND)
    assert.equal(q.quelle, 'websocket')

    dd.reissen()

    assert.equal(q.quelle, 'webapi')
    assert.equal((await q.jetzt()).titel, 'aus der Web-API')
    assert.equal(gefragt(), 1)
  })

  it('DER ALTE STAND WIRD VERGESSEN, nicht weitergemeldet', async () => {
    // Am 22.08.2026 war Soloists Draht zehn Minuten weg, waehrend gekoppelt
    // wurde. Eine Box, die in dieser Zeit ihren letzten bekannten Titel
    // weitermeldet, zeigt etwas, das laengst vorbei ist.
    const dd = drahtDoppel()
    const { q } = quelleMit(dd)
    await q.verbindenVersuchen()
    dd.schicken(VOLLER_STAND)
    dd.schicken({ type: 'auth_state', logged_in: true, is_active: true, device_name: 'MixPiBox' })
    dd.reissen()
    assert.equal(q.angemeldet, null, 'auch die Anmeldung ist nicht mehr zu erfahren')
  })

  it('und kommt er zurueck, wird wieder gepusht', async () => {
    const dd = drahtDoppel()
    const { q } = quelleMit(dd)
    await q.verbindenVersuchen()
    dd.reissen()
    assert.equal(await q.verbindenVersuchen(), true)
    dd.schicken(VOLLER_STAND)
    assert.equal(q.quelle, 'websocket')
    assert.equal((await q.jetzt()).titel, 'Black Summer')
  })

  it('ein zweiter Versuch bei stehendem Draht baut nicht doppelt auf', async () => {
    const dd = drahtDoppel()
    const { q } = quelleMit(dd)
    await q.verbindenVersuchen()
    const vorher = dd.gesendet.length
    assert.equal(await q.verbindenVersuchen(), true)
    assert.equal(dd.gesendet.length, vorher, 'kein zweites get_state')
  })
})

describe('die Position laeuft weiter, ohne dass ein Ereignis kommt', () => {
  it('rechnet die verstrichene Zeit dazu', async () => {
    const dd = drahtDoppel()
    // Uhr steht fuenf Sekunden nach dem Zeitstempel des Zustands.
    const { q } = quelleMit(dd, 505_000)
    await q.verbindenVersuchen()
    dd.schicken(VOLLER_STAND)
    assert.equal((await q.jetzt()).positionMs, 6000, '1000 ms Stand + 5000 ms verstrichen')
  })
})
