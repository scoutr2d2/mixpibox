/**
 * Die Nachrichten-Wege am laufenden Server — Wege, Erlaubnisliste, Vorlesen.
 *
 * ══ DER TEUERSTE TEST IN DIESER DATEI IST DER LETZTE ═══════════════════════
 *
 * `GET /api/config` liefert die GANZE Konfiguration aus, und der Kiosk-Browser
 * liest sie. In der Nachrichten-Gruppe stehen zwei Zugangstoken UND die
 * Matrix-IDs und Telefonnummern der Eltern. Fuer /api/config gab es genau
 * deshalb schon einmal eine Signatur im Wissenspaket
 * (`mupi-api-config-gibt-alles-preis`) — dieser Test ist die Wache dagegen,
 * dass dieselbe Luecke mit neuen Feldern wiederkommt.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

let app: import('express').Express
let ordner: string
let konfigDatei: string

const KONFIG = {
  mupibox: { maxVolume: '100' },
  interfacelogin: { password: '', active: false },
  nachrichten: {
    active: false,
    vorlesen: true,
    erlaubt: [],
    matrixActive: false,
    matrixServer: '',
    matrixToken: 'geheimer-matrix-token',
    matrixRaum: '',
    telegramActive: false,
    telegramToken: 'geheimer-telegram-token',
    signalActive: false,
    signalHost: '127.0.0.1',
    signalPort: '7583',
    signalNummer: '',
  },
}

const konfigJetzt = () => JSON.parse(readFileSync(konfigDatei, 'utf8')) as Record<string, Record<string, unknown>>

describe('Nachrichten an die Box', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-nachrichten-'))
    konfigDatei = join(ordner, 'mupiboxconfig.json')
    writeFileSync(konfigDatei, JSON.stringify(KONFIG, null, 2))
    writeFileSync(join(ordner, 'data.json'), '[]')
    writeFileSync(join(ordner, 'active_data.json'), '[]')
    writeFileSync(
      join(ordner, 'profile.json'),
      JSON.stringify({
        profile: [
          { kennung: 'gast', name: 'Gast', figur: '', angelegt: 1 },
          { kennung: 'kalea', name: 'Kalea', figur: '', angelegt: 2 },
        ],
        aktiv: 'gast',
      }),
    )
    process.env.MUPIBOX_CONFIG_DIR = ordner
    process.env.MUPIBOX_CONFIG = konfigDatei
    const modul = await import('./server.js')
    app = modul.app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_CONFIG = undefined
  })

  it('eine frische Box hat keine Nachrichten und keinen Weg an', async () => {
    const a = await request(app).get('/api/nachrichten').expect(200)
    assert.deepEqual(a.body.nachrichten, [])
    assert.equal(a.body.ungelesen, 0)
    const s = await request(app).get('/api/nachrichten/stand').expect(200)
    assert.equal(s.body.an, false)
    for (const weg of ['matrix', 'signal', 'telegram']) assert.equal(s.body.wege[weg].an, false, weg)
    // Signal ist AUS, also wird gar nicht erst nachgesehen — eine Messung,
    // die niemand bestellt hat, waere eine Verbindung nach draussen.
    assert.equal(s.body.signalDa, null)
  })

  it('WEIST EINE NATIONALE NUMMER AB — mit einem Satz, nicht mit einer Nummer', async () => {
    const a = await request(app)
      .put('/api/nachrichten/erlaubt')
      .send({ erlaubt: [{ weg: 'signal', absender: '0170 0000000', name: 'Papa' }] })
      .expect(400)
    assert.equal(a.body.error, 'signal')
    assert.match(a.body.satz, /international/)
    assert.equal(a.body.zeile, 0)
  })

  it('GANZ ODER GAR NICHT: ein schlechter Eintrag laesst den guten nicht durch', async () => {
    await request(app)
      .put('/api/nachrichten/erlaubt')
      .send({
        erlaubt: [
          { weg: 'matrix', absender: '@mama:server.example' },
          { weg: 'telegram', absender: '@oma' },
        ],
      })
      .expect(400)
    const a = await request(app).get('/api/nachrichten/erlaubt').expect(200)
    assert.deepEqual(a.body.erlaubt, [])
  })

  it('nimmt eine saubere Liste an und schreibt sie in die Konfiguration', async () => {
    await request(app)
      .put('/api/nachrichten/erlaubt')
      .send({
        erlaubt: [
          { weg: 'matrix', absender: '@Mama:Server.Example', name: 'Mama' },
          { weg: 'signal', absender: '+49 170 0000000', name: 'Papa' },
        ],
      })
      .expect(200)
    const a = await request(app).get('/api/nachrichten/erlaubt').expect(200)
    assert.equal(a.body.erlaubt.length, 2)
    assert.equal(a.body.erlaubt[0].absender, '@mama:server.example')
    assert.equal(a.body.erlaubt[1].absender, '+491700000000')
    // Und sie steht wirklich in der Datei, nicht nur im Arbeitsspeicher.
    assert.equal((konfigJetzt().nachrichten.erlaubt as unknown[]).length, 2)
  })

  it('das Vorlesen laesst sich je Profil umstellen — und wieder zuruecknehmen', async () => {
    await request(app).post('/api/profil/aktiv').send({ kennung: 'kalea' }).expect(200)
    assert.equal((await request(app).get('/api/nachrichten').expect(200)).body.vorlesen, true)

    await request(app)
      .post('/api/profil/nachrichten-vorlesen')
      .send({ kennung: 'kalea', wert: false })
      .expect(200)
    assert.equal((await request(app).get('/api/nachrichten').expect(200)).body.vorlesen, false)

    // Der Gast daneben behaelt die Box-Vorgabe — das Feld gehoert dem Kind.
    await request(app).post('/api/profil/aktiv').send({ kennung: 'gast' }).expect(200)
    assert.equal((await request(app).get('/api/nachrichten').expect(200)).body.vorlesen, true)

    // `null` heisst „wieder wie die Box", nicht „aus".
    await request(app).post('/api/profil/aktiv').send({ kennung: 'kalea' }).expect(200)
    await request(app).post('/api/profil/nachrichten-vorlesen').send({ kennung: 'kalea', wert: null }).expect(200)
    assert.equal((await request(app).get('/api/nachrichten').expect(200)).body.vorlesen, true)
  })

  it('weist einen Unsinnswert ab, statt ihn ans Kind zu schreiben', async () => {
    await request(app).post('/api/profil/nachrichten-vorlesen').send({ kennung: 'kalea', wert: 'ja' }).expect(400)
    await request(app).post('/api/profil/nachrichten-vorlesen').send({ kennung: 'niemand', wert: true }).expect(404)
  })

  it('„gelesen" auf eine unbekannte Kennung ist kein Fehler, aber auch keine Aenderung', async () => {
    const a = await request(app).post('/api/nachrichten/gelesen').send({ id: 'gibtsnicht' }).expect(200)
    assert.equal(a.body.geaendert, false)
    await request(app).post('/api/nachrichten/gelesen').send({}).expect(400)
  })

  it('GIBT WEDER TOKEN NOCH ERLAUBNISLISTE UEBER /api/config HERAUS', async () => {
    const a = await request(app).get('/api/config').expect(200)
    const text = JSON.stringify(a.body)
    assert.ok(!text.includes('geheimer-matrix-token'), 'der Matrix-Token steht in /api/config')
    assert.ok(!text.includes('geheimer-telegram-token'), 'der Telegram-Token steht in /api/config')
    assert.ok(!text.includes('@mama:server.example'), 'die Matrix-ID der Mutter steht in /api/config')
    assert.ok(!text.includes('491700000000'), 'die Telefonnummer des Vaters steht in /api/config')
    // Die FORM bleibt: wer die Gruppe erwartet, findet sie — nur leer.
    assert.equal(typeof a.body.nachrichten, 'object')
    assert.deepEqual(a.body.nachrichten.erlaubt, [])
    // Und in der DATEI stehen sie weiterhin — hier wird nur der Weg nach
    // draussen geschlossen, nicht die Einstellung geloescht.
    assert.equal(konfigJetzt().nachrichten.matrixToken, 'geheimer-matrix-token')
  })
})
