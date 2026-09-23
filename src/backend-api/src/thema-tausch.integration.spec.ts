/**
 * THEMEN TAUSCHEN (E120) — der Weg einer Datei, an einem echten Server.
 *
 * mixpi-thema.spec.ts prueft die REGELN; hier laeuft der Handel: ein Thema
 * geht als Datei HINAUS (GET /api/thema/export/:name), kommt unter neuem
 * Namen HEREIN (POST /api/thema/import), kollidiert beim zweiten Mal (409),
 * ersetzt mit Erlaubnis — und ein kaputtes Dokument prallt am Tor ab, MIT
 * den Saetzen, die die Verwaltung dann zeigt.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, describe, it } from 'node:test'
import request from 'supertest'
import { FORMAT_KENNUNG } from './mixpi-thema'
import { THEMEN_BLOECKE } from './themen'

let app: import('express').Express

describe('Themen tauschen: /api/thema/export + /api/thema/import', () => {
  before(async () => {
    process.env.MUPIBOX_CONFIG = join(mkdtempSync(join(tmpdir(), 'mupi-konfig-')), 'mupiboxconfig.json')
    process.env.MUPIBOX_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'mupi-daten-'))
    app = (await import('./server.js')).app
  })

  it('exportiert ein Mitgeliefertes als mixpi-thema/1 — als Datei, mit den Bloecken aus dem Code', async () => {
    const r = await request(app).get('/api/thema/export/MuPiBox%20Classic').expect(200)
    assert.match(String(r.headers['content-disposition']), /attachment/)
    assert.equal(r.body.format, FORMAT_KENNUNG)
    assert.equal(r.body.name, 'MuPiBox Classic')
    assert.deepEqual(r.body.bloecke, THEMEN_BLOECKE['MuPiBox Classic'])
  })

  it('ein unbekannter Name ist 404 mit Satz', async () => {
    const r = await request(app).get('/api/thema/export/Gibtsnicht').expect(404)
    assert.match(String(r.body.error), /Gibtsnicht/)
  })

  it('Datei-Roundtrip: hinaus, unter neuem Namen herein, wieder hinaus — identische Bloecke', async () => {
    const hinaus = await request(app).get('/api/thema/export/MuPiBox%20Classic').expect(200)
    const dokument = { ...hinaus.body, name: 'Classic Kopie' }
    const rein = await request(app).post('/api/thema/import').send({ dokument }).expect(200)
    assert.equal(rein.body.ok, true)
    assert.equal(rein.body.name, 'Classic Kopie')
    const wieder = await request(app).get('/api/thema/export/Classic%20Kopie').expect(200)
    assert.deepEqual(wieder.body.bloecke, hinaus.body.bloecke)
  })

  it('derselbe Name noch einmal: 409 — mit Erlaubnis: ersetzt', async () => {
    const hinaus = await request(app).get('/api/thema/export/MuPiBox%20Classic').expect(200)
    const dokument = { ...hinaus.body, name: 'Classic Kopie' }
    const konflikt = await request(app).post('/api/thema/import').send({ dokument }).expect(409)
    assert.equal(konflikt.body.name, 'Classic Kopie')
    await request(app).post('/api/thema/import').send({ dokument, ueberschreiben: true }).expect(200)
  })

  it('das Tor lehnt mit Saetzen ab — die Stufe steht dabei', async () => {
    const r = await request(app)
      .post('/api/thema/import')
      .send({
        dokument: {
          format: FORMAT_KENNUNG,
          name: 'Zu frueh',
          bloecke: { farben: { ton: 245 } },
        },
      })
      .expect(400)
    assert.ok(Array.isArray(r.body.fehler))
    // (albumTipp='karte' stand hier, bis E121/4d es einloeste.)
    assert.ok(r.body.fehler.some((f: string) => f.includes('E120')))
  })

  it('die eingespielte Kopie erscheint in GET /api/darstellung unter den Themen', async () => {
    const d = await request(app).get('/api/darstellung').expect(200)
    assert.ok(Object.hasOwn(d.body.themen, 'Classic Kopie'))
    // Und flach traegt sie den Classic-Kern — die Uebersetzung lief serverseitig.
    assert.equal(d.body.themen['Classic Kopie'].kachelForm, 'rund')
    assert.equal(d.body.themen['Classic Kopie'].farbe, 'classic')
    assert.equal(d.body.themen['Classic Kopie'].licht, 'dunkel')
  })
})
