/**
 * DER WARTUNGSMODUS AM LAUFENDEN SERVER — an/aus/kaputt.
 *
 * Der Zustand ist eine Datei in /tmp (fluechtig mit Absicht: ein Neustart
 * beendet die Wartung, ein vergessener Modus kann die Box nicht dauerhaft
 * sperren). Genau deshalb wird hier die HALB GESCHRIEBENE Datei mitgeprueft:
 * der Kiosk fragt diesen Endpunkt im Takt, und eine unlesbare Datei darf
 * niemals als "aktiv" durchgehen — sonst sperrt ein Schreibfehler die Kinder
 * aus, bis jemand /tmp aufraeumt.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, describe, it } from 'node:test'
import request from 'supertest'

let app: import('express').Express
let wartungsDatei: string

describe('Wartungsmodus', () => {
  before(async () => {
    const ordner = mkdtempSync(join(tmpdir(), 'mupi-wartung-'))
    const konfigPfad = join(ordner, 'mupiboxconfig.json')
    writeFileSync(
      konfigPfad,
      JSON.stringify({
        mupibox: { host: 'MuPiBox', startVolume: '40', maxVolume: '100' },
        interfacelogin: { state: false, password: '' },
        timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
      }),
    )
    process.env.MUPIBOX_CONFIG = konfigPfad
    process.env.MUPIBOX_CONFIG_DIR = ordner
    wartungsDatei = join(ordner, 'wartung.json')
    process.env.MIXPI_WARTUNG_DATEI = wartungsDatei
    app = (await import('./server.js')).app
  })

  it('ist ohne Datei aus', async () => {
    const r = await request(app).get('/api/wartung').expect(200)
    assert.equal(r.body.aktiv, false)
  })

  it('laesst sich einschalten und meldet seither', async () => {
    const an = await request(app).post('/api/wartung').send({ aktiv: true }).expect(200)
    assert.equal(an.body.aktiv, true)
    const r = await request(app).get('/api/wartung').expect(200)
    assert.equal(r.body.aktiv, true)
    assert.ok(r.body.seit, 'seit fehlt — die Verwaltung soll zeigen koennen, wie lange schon')
    // Und die Datei traegt wirklich das, was der naechste GET liest.
    assert.ok(readFileSync(wartungsDatei, 'utf8').includes('seit'))
  })

  it('laesst sich ausschalten, auch zweimal', async () => {
    await request(app).post('/api/wartung').send({ aktiv: false }).expect(200)
    const r = await request(app).get('/api/wartung').expect(200)
    assert.equal(r.body.aktiv, false)
    // Nochmal aus, obwohl schon aus: kein Fehler — der Schalter ist idempotent.
    await request(app).post('/api/wartung').send({ aktiv: false }).expect(200)
  })

  it('weist Unfug ab, ohne den Zustand anzufassen', async () => {
    await request(app).post('/api/wartung').send({ aktiv: 'ja' }).expect(400)
    await request(app).post('/api/wartung').send({}).expect(400)
    const r = await request(app).get('/api/wartung').expect(200)
    assert.equal(r.body.aktiv, false)
  })

  it('behandelt eine halb geschriebene Datei als AUS, nicht als Sperre', async () => {
    writeFileSync(wartungsDatei, '{kaputt')
    const r = await request(app).get('/api/wartung').expect(200)
    assert.equal(r.body.aktiv, false)
  })
})
