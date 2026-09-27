/**
 * DER GESTALTER (E144) an einem echten Server: Bild hinein, Thema mit Bild
 * hinaus und wieder herein, Thema direkt anwenden — und das Zusammenfuehren
 * laesst stehen, was das Thema nicht nennt.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, describe, it } from 'node:test'
import request from 'supertest'
import { alsDatenAdresse, bildBenennen } from './hintergrund'
import { FORMAT_KENNUNG } from './mixpi-thema'

let app: import('express').Express

// Ein echtes 1x1-PNG — der Server prueft am Inhalt, nicht an der Endung.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

describe('Gestalter: /api/gestalter/* und /api/thema/anwenden', () => {
  before(async () => {
    process.env.MUPIBOX_CONFIG = join(mkdtempSync(join(tmpdir(), 'mupi-konfig-')), 'mupiboxconfig.json')
    process.env.MUPIBOX_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'mupi-daten-'))
    app = (await import('./server.js')).app
  })

  it('ein Bild hochladen: benannt nach dem Inhalt, ausgeliefert, aufgelistet', async () => {
    const r = await request(app)
      .post('/api/gestalter/hintergrund')
      .set('Content-Type', 'application/octet-stream')
      .send(PNG)
      .expect(200)
    assert.equal(r.body.name, bildBenennen(new Uint8Array(PNG))?.name)
    const bild = await request(app).get(`/api/gestalter/hintergrund/${r.body.name}`).expect(200)
    assert.match(String(bild.headers['content-type']), /image\/png/)
    assert.match(String(bild.headers['cache-control']), /immutable/)
    const liste = await request(app).get('/api/gestalter/hintergruende').expect(200)
    assert.ok(liste.body.namen.includes(r.body.name))
  })

  it('kein Bild -> 400 mit Satz; kaputter Name -> 404', async () => {
    const r = await request(app)
      .post('/api/gestalter/hintergrund')
      .set('Content-Type', 'image/png')
      .send(Buffer.from('<svg/>'))
      .expect(400)
    assert.match(String(r.body.error), /JPEG/)
    await request(app).get('/api/gestalter/hintergrund/..%2F..%2Fdarstellung.json').expect(404)
  })

  it('anwenden: legt das Thema auf das Profil und LAESST den Rest stehen', async () => {
    await request(app)
      .put('/api/darstellung')
      .send({ aktuell: { kachelForm: 'eckig', uhrzeit: true }, themen: {} })
      .expect(200)
    const r = await request(app)
      .post('/api/thema/anwenden')
      .send({
        dokument: {
          format: FORMAT_KENNUNG,
          name: 'Entwurf',
          bloecke: { titelband: { an: true, text: 'Emmas Box' }, kissen: { platz: 'oben' } },
        },
      })
      .expect(200)
    assert.equal(r.body.ok, true)
    const d = await request(app).get('/api/darstellung').expect(200)
    assert.equal(d.body.aktuell.titelBandAn, true)
    assert.equal(d.body.aktuell.titelBandText, 'Emmas Box')
    assert.equal(d.body.aktuell.mpPlatz, 'oben')
    assert.equal(d.body.aktuell.kachelForm, 'eckig', 'was das Thema nicht nennt, bleibt')
    assert.equal(d.body.aktuell.uhrzeit, true)
    // Nicht abgelegt: anwenden ist kein Speichern unter einem Namen.
    assert.equal(Object.hasOwn(d.body.themen, 'Entwurf'), false)
  })

  it('anwenden: das Tor lehnt mit Saetzen ab', async () => {
    const r = await request(app)
      .post('/api/thema/anwenden')
      .send({ dokument: { format: FORMAT_KENNUNG, name: 'x', bloecke: { hintergrund: { bild: '../x' } } } })
      .expect(400)
    assert.ok(r.body.fehler.some((f: string) => f.includes('hintergrund.bild')))
  })

  it('das Bild reist mit: Import legt es ab (NEU benannt), Export legt es wieder bei', async () => {
    const gelogen = '0000000000000000.png'
    const dokument = {
      format: FORMAT_KENNUNG,
      name: 'Mit Bild',
      bloecke: { hintergrund: { art: 'bild', bild: gelogen, schleier: 0.3 } },
      anhaenge: { [gelogen]: alsDatenAdresse(gelogen, new Uint8Array(PNG)) },
    }
    await request(app).post('/api/thema/import').send({ dokument }).expect(200)
    const echt = bildBenennen(new Uint8Array(PNG))?.name as string
    const d = await request(app).get('/api/darstellung').expect(200)
    assert.equal(d.body.themen['Mit Bild'].hgBild, echt, 'der Block zeigt auf den gerechneten Namen')
    await request(app).get(`/api/gestalter/hintergrund/${echt}`).expect(200)
    await request(app).get(`/api/gestalter/hintergrund/${gelogen}`).expect(404)

    const hinaus = await request(app).get('/api/thema/export/Mit%20Bild').expect(200)
    assert.equal(hinaus.body.bloecke.hintergrund.bild, echt)
    assert.ok(String(hinaus.body.anhaenge?.[echt]).startsWith('data:image/png;base64,'))
  })

  it('wegraeumen', async () => {
    const echt = bildBenennen(new Uint8Array(PNG))?.name as string
    await request(app).delete(`/api/gestalter/hintergrund/${echt}`).expect(200)
    await request(app).get(`/api/gestalter/hintergrund/${echt}`).expect(404)
    await request(app).delete(`/api/gestalter/hintergrund/${echt}`).expect(404)
  })
})
