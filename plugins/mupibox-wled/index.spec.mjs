import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { antwort, kontext as pruefstand } from '../pruefstand.mjs'
import plugin from './index.mjs'

/**
 * Tests des WLED-Plugins — ohne Box, ohne Licht, ohne Netz.
 *
 *     node --test plugins/mupibox-wled/index.spec.mjs
 *
 * `geholt` sammelt die abgefragten Adressen. Damit laesst sich pruefen, WAS an
 * das Licht ging — und, mindestens ebenso wichtig, was NICHT.
 */

const ADRESSE = '192.168.178.42'

function kontext(einstellungen = {}, { netz = true } = {}) {
  return pruefstand({
    netz,
    einstellungen: {
      adresse: ADRESSE,
      helligkeit: 128,
      ausBeimAnhalten: true,
      helligkeitFolgtLautstaerke: false,
      ...einstellungen,
    },
    antworten: () => antwort('OK'),
  })
}

describe('Wiedergabe', () => {
  it('schaltet das Licht an, wenn etwas startet', async () => {
    const { k, geholt } = kontext()
    await plugin.ereignis('wiedergabeGestartet', {}, k)
    assert.deepEqual(geholt, [`http://${ADRESSE}/win&T=1&A=128`])
  })

  it('schaltet es aus, wenn angehalten wird', async () => {
    const { k, geholt } = kontext()
    await plugin.ereignis('wiedergabeGestoppt', { verb: 'stop' }, k)
    assert.deepEqual(geholt, [`http://${ADRESSE}/win&T=0`])
  })

  it('laesst es an, wenn der Schalter das sagt', async () => {
    const { k, geholt } = kontext({ ausBeimAnhalten: false })
    await plugin.ereignis('wiedergabeGestoppt', { verb: 'pause' }, k)
    assert.deepEqual(geholt, [], 'es haette nichts schicken duerfen')
  })
})

describe('Kinderzeit', () => {
  it('schaltet aus — OHNE WENN UND ABER', async () => {
    // Auch mit `ausBeimAnhalten: false`. Schlafenszeit ist etwas anderes als
    // „jemand hat angehalten"; ein Licht, das nachts anbleibt, weil irgendwo
    // ein Schalter steht, ist genau der Fall, den Eltern nicht erwarten.
    const { k, geholt, protokoll } = kontext({ ausBeimAnhalten: false })
    await plugin.ereignis('kinderzeitEnde', { grund: 'zuSpaet' }, k)
    assert.deepEqual(geholt, [`http://${ADRESSE}/win&T=0`])
    assert.match(protokoll.join(' '), /zuSpaet/, 'der Grund gehoert ins Journal')
  })
})

describe('Lautstaerke', () => {
  it('folgt ihr nur, wenn es eingeschaltet ist', async () => {
    const { k, geholt } = kontext()
    await plugin.ereignis('lautstaerke', { wert: 50 }, k)
    assert.deepEqual(geholt, [])
  })

  it('rechnet 0..100 auf die eingestellte Helligkeit um', async () => {
    const { k, geholt } = kontext({ helligkeitFolgtLautstaerke: true, helligkeit: 200 })
    await plugin.ereignis('lautstaerke', { wert: 50 }, k)
    assert.deepEqual(geholt, [`http://${ADRESSE}/win&A=100`], 'die Haelfte von 200')
  })

  it('wird nie heller als eingestellt', async () => {
    const { k, geholt } = kontext({ helligkeitFolgtLautstaerke: true, helligkeit: 60 })
    await plugin.ereignis('lautstaerke', { wert: 100 }, k)
    assert.deepEqual(geholt, [`http://${ADRESSE}/win&A=60`])
  })
})

describe('was schiefgehen kann', () => {
  it('tut ohne Adresse gar nichts — und meckert nur EINMAL', async () => {
    // Ein Plugin, das bei jedem Kacheltipp eine Zeile ins Journal schreibt,
    // macht genau das unlesbar, worin man spaeter sucht.
    const { k, geholt, protokoll } = kontext({ adresse: '' })
    for (let i = 0; i < 5; i++) await plugin.ereignis('wiedergabeGestartet', {}, k)
    assert.deepEqual(geholt, [])
    assert.equal(protokoll.length, 1, `es hat ${protokoll.length}-mal gemeckert`)
  })

  it('meldet einen Fehlschlag des Lichts, statt ihn zu schlucken', async () => {
    const { k } = pruefstand({
      einstellungen: { adresse: ADRESSE, helligkeit: 128 },
      antworten: () => antwort('', { ok: false, status: 500 }),
    })
    await assert.rejects(() => plugin.ereignis('wiedergabeGestartet', {}, k), /500/)
  })

  it('biegt eine unsinnige Helligkeit gerade, statt zu werfen', async () => {
    const { k, geholt } = kontext({ helligkeit: 9999 })
    await plugin.ereignis('wiedergabeGestartet', {}, k)
    assert.deepEqual(geholt, [`http://${ADRESSE}/win&T=1&A=255`])
  })

  it('schweigt zu Ereignissen, die es nicht kennt', async () => {
    const { k, geholt } = kontext()
    await plugin.ereignis('irgendwasNeues', {}, k)
    assert.deepEqual(geholt, [])
  })
})

describe('befinden', () => {
  it('nennt die Adresse, wenn sie antwortet', async () => {
    const b = await plugin.befinden(kontext().k)
    assert.equal(b.ok, true)
    assert.match(b.text, /192\.168\.178\.42/)
  })

  it('sagt es, wenn keine Adresse eingestellt ist', async () => {
    const b = await plugin.befinden(kontext({ adresse: '' }).k)
    assert.equal(b.ok, false)
    assert.match(b.text, /keine Adresse/)
  })

  it('macht aus einem unerreichbaren Licht kein geworfenes Versprechen', async () => {
    const { k } = pruefstand({
      einstellungen: { adresse: ADRESSE },
      antworten: () => {
        throw new Error('ECONNREFUSED')
      },
    })
    const b = await plugin.befinden(k)
    assert.equal(b.ok, false)
    assert.match(b.text, /nicht erreichbar/)
  })
})
