/**
 * Zeugen fuer das Soloist-Engine-Plugin — samt der aus dem Kern
 * UMGEZOGENEN Verfall-Zeugen (spotify-maschine.spec.ts, E82).
 *
 *   node --test plugins/mixpi-soloist/index.spec.mjs
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import plugin, { bauDatumAus, verfallAus, zwischenspeicherLeeren } from './index.mjs'

beforeEach(() => zwischenspeicherLeeren())

const V_ZEILE = 'soloist 1.3.7.385 build 1787153493 (20260819) (gb24005ef46) (linux/aarch64)'

function kontextMit({ engine = 'soloist', hatSchluessel = true, dienst = 'laeuft', ctl = 'logged in: yes', warnung = null } = {}) {
  const gefragt = []
  return {
    protokoll: () => {},
    einstellungen: Object.freeze({}),
    konfig: Object.freeze({ maschine: { engine, hatSchluessel } }),
    gefragt,
    geraet: {
      dienstZustand: async (u) => {
        gefragt.push(`dienst:${u}`)
        return dienst
      },
      ausfuehren: async (n) => {
        gefragt.push(`befehl:${n}`)
        if (n === 'soloist-fassung') return { ok: true, text: V_ZEILE }
        if (n === 'soloist-anmeldung') return { ok: true, text: ctl }
        return { ok: false, text: '' }
      },
      lesen: async (n) => {
        gefragt.push(`datei:${n}`)
        return warnung
      },
    },
  }
}

describe('die umgezogene Verfall-Rechnung', () => {
  it('das Bau-Datum kommt aus der Klammer der -V-Zeile, nicht aus der Build-Nummer', () => {
    assert.equal(bauDatumAus(V_ZEILE), '20260819')
    assert.equal(bauDatumAus('irgendwas ohne Datum'), null)
    assert.equal(bauDatumAus(null), null)
  })

  it('Alter und Resttage: ein Zeitraum, kein festgenagelter Wert', () => {
    // Zeitraeume pruefen, nicht abgeleitete Zahlen: heute wird MITGEGEBEN,
    // damit der Zeuge nicht mit dem Kalender altert.
    const v = verfallAus('20260801', new Date(Date.UTC(2026, 7, 22)))
    assert.ok(v)
    assert.equal(v.alterTage, 21)
    assert.equal(v.alterTage + v.verfallInTagen, 90, 'Alter + Rest = die 90 Tage von Spotify')
  })

  it('ein abgelaufener Build hat Rest 0, nie negativ', () => {
    const v = verfallAus('20260101', new Date(Date.UTC(2026, 7, 22)))
    assert.equal(v.verfallInTagen, 0)
  })

  it('Unsinn ist null: kaputtes Datum, Zukunftsdatum', () => {
    assert.equal(verfallAus('99999999', new Date()), null)
    assert.equal(verfallAus('20991231', new Date(Date.UTC(2026, 7, 22))), null)
  })
})

describe('die Auskunft (http stand)', () => {
  it('traegt Dienst, Build, Verfall und Anmeldung — und NIE einen Schluessel', async () => {
    const a = await plugin.http({ methode: 'GET', pfad: 'stand', abfrage: {}, rumpf: null }, kontextMit())
    assert.equal(a.inhalt.dienst, 'laeuft')
    assert.equal(a.inhalt.build, V_ZEILE)
    assert.equal(a.inhalt.anmeldung, 'ja')
    assert.equal(a.inhalt.alterTage + a.inhalt.verfallInTagen, 90)
    assert.ok(!JSON.stringify(a.inhalt).includes('spak_'), 'kein spak_ in der Auskunft')
    assert.equal(a.inhalt.hatSchluessel, true, 'nur die AUSSAGE ueber den Schluessel reist')
  })

  it('die Anmeldung wird NUR bei laufendem Dienst gefragt', async () => {
    const k = kontextMit({ dienst: 'steht' })
    const a = await plugin.http({ methode: 'GET', pfad: 'stand', abfrage: {}, rumpf: null }, k)
    assert.equal(a.inhalt.anmeldung, null)
    assert.ok(!k.gefragt.includes('befehl:soloist-anmeldung'), 'kein ctl-Ruf an einen stehenden Dienst')
  })

  it('"logged in: no" heisst nein — die Karte zeigt dann die Verbinde-Anleitung', async () => {
    const a = await plugin.http(
      { methode: 'GET', pfad: 'stand', abfrage: {}, rumpf: null },
      kontextMit({ ctl: 'device id: xyz\nlogged in: no' }),
    )
    assert.equal(a.inhalt.anmeldung, 'nein')
  })
})

describe('das Befinden urteilt nach Wahl UND Spielfaehigkeit', () => {
  it('gewaehlt, laeuft, angemeldet, keine Warnung: gruen', async () => {
    const b = await plugin.befinden(kontextMit())
    assert.equal(b.ok, true)
  })

  it('gewaehlt ohne Schluessel: rot mit klarem Satz — der stumme Zustand', async () => {
    const b = await plugin.befinden(kontextMit({ hatSchluessel: false }))
    assert.equal(b.ok, false)
    assert.match(b.text, /Schlüssel/)
  })

  it('gewaehlt, aber nicht angemeldet: rot, der Satz nennt den Weg', async () => {
    const b = await plugin.befinden(kontextMit({ ctl: 'logged in: no' }))
    assert.equal(b.ok, false)
    assert.match(b.text, /Spotify-App/)
  })

  it('eine Updater-Warnung faerbt auch die NICHT gewaehlte Maschine', async () => {
    const b = await plugin.befinden(kontextMit({ engine: 'librespot', dienst: 'steht', warnung: 'Build verfaellt in 5 Tagen' }))
    assert.equal(b.ok, false)
    assert.match(b.text, /verfaellt/)
  })
})

describe('der Merker', () => {
  it('zwei Fragen kurz nacheinander messen nur EINMAL', async () => {
    const k = kontextMit()
    await plugin.http({ methode: 'GET', pfad: 'stand', abfrage: {}, rumpf: null }, k)
    const davor = k.gefragt.length
    await plugin.http({ methode: 'GET', pfad: 'stand', abfrage: {}, rumpf: null }, k)
    assert.equal(k.gefragt.length, davor)
  })
})
