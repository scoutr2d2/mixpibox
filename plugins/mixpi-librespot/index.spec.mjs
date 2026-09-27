/**
 * Zeugen fuer das librespot-Engine-Plugin — gegen ein gefaelschtes Geraet.
 *
 *   node --test plugins/mixpi-librespot/index.spec.mjs
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import plugin, { zwischenspeicherLeeren } from './index.mjs'

beforeEach(() => zwischenspeicherLeeren())

/** Ein Kontext mit gefaelschtem Geraet; zaehlt, was gefragt wurde. */
function kontextMit({ engine = 'librespot', dienst = 'laeuft', umgebung = null } = {}) {
  const gefragt = []
  return {
    protokoll: () => {},
    einstellungen: Object.freeze({}),
    konfig: Object.freeze({ maschine: { engine, hatSchluessel: false } }),
    gefragt,
    geraet: {
      dienstZustand: async (u) => {
        gefragt.push(`dienst:${u}`)
        return dienst
      },
      ausfuehren: async (n) => {
        gefragt.push(`befehl:${n}`)
        return { ok: false, text: '' }
      },
      lesen: async (n) => {
        gefragt.push(`datei:${n}`)
        return umgebung
      },
    },
  }
}

const ENV = 'export LIBRESPOT_NAME="MuPiBox"\nexport LIBRESPOT_BITRATE="160"\nexport LIBRESPOT_BACKEND=alsa\n'

describe('die Auskunft (http stand)', () => {
  it('Bitrate wird aus der Unit-Umgebung GELESEN, nicht behauptet', async () => {
    const a = await plugin.http({ methode: 'GET', pfad: 'stand', abfrage: {}, rumpf: null }, kontextMit({ umgebung: ENV }))
    assert.equal(a.inhalt.bitrate, 160)
    assert.equal(a.inhalt.dienst, 'laeuft')
  })

  it('ohne Umgebungsdatei ist die Bitrate ehrlich null', async () => {
    const a = await plugin.http({ methode: 'GET', pfad: 'stand', abfrage: {}, rumpf: null }, kontextMit())
    assert.equal(a.inhalt.bitrate, null)
  })

  it('gewaehlt kommt aus der berechneten Gruppe maschine — engine=soloist heisst: nicht gewaehlt', async () => {
    const a = await plugin.http({ methode: 'GET', pfad: 'stand', abfrage: {}, rumpf: null }, kontextMit({ engine: 'soloist' }))
    assert.equal(a.inhalt.gewaehlt, false)
  })
})

describe('das Befinden urteilt nach der WAHL, nicht nur nach dem Dienst', () => {
  it('gewaehlt und laeuft: gruen', async () => {
    const b = await plugin.befinden(kontextMit({ umgebung: ENV }))
    assert.equal(b.ok, true)
    assert.match(b.text, /Gewählte Maschine/)
    assert.match(b.text, /160 kbps/)
  })

  it('gewaehlt, aber der Dienst steht: rot — genau der stumme Zustand', async () => {
    const b = await plugin.befinden(kontextMit({ dienst: 'steht' }))
    assert.equal(b.ok, false)
  })

  it('NICHT gewaehlt und steht: gruen — so soll es sein, Soloist spielt', async () => {
    const b = await plugin.befinden(kontextMit({ engine: 'soloist', dienst: 'steht' }))
    assert.equal(b.ok, true)
    assert.match(b.text, /Nicht gewählt/)
  })

  it('ohne Recht geraetestand: ehrliche Worte, kein Wurf', async () => {
    const k = kontextMit()
    delete k.geraet
    const b = await plugin.befinden(k)
    assert.equal(b.ok, false)
    assert.match(b.text, /geraetestand/)
  })
})

describe('der Merker (die Karte pollt im 3-s-Takt)', () => {
  it('zwei Fragen kurz nacheinander messen nur EINMAL', async () => {
    const k = kontextMit({ umgebung: ENV })
    await plugin.http({ methode: 'GET', pfad: 'stand', abfrage: {}, rumpf: null }, k)
    const davor = k.gefragt.length
    await plugin.http({ methode: 'GET', pfad: 'stand', abfrage: {}, rumpf: null }, k)
    assert.equal(k.gefragt.length, davor, 'die zweite Frage lief aus dem Merker')
  })

  it('die Aktion "pruefen" misst IMMER frisch', async () => {
    const k = kontextMit({ umgebung: ENV })
    await plugin.http({ methode: 'GET', pfad: 'stand', abfrage: {}, rumpf: null }, k)
    const davor = k.gefragt.length
    await plugin.aktion('pruefen', k)
    assert.ok(k.gefragt.length > davor, 'pruefen darf nicht aus dem Merker antworten')
  })
})
