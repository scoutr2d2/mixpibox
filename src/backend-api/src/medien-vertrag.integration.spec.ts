/**
 * DER VERTRAG VON `POST /api/medien` — flach, nicht verpackt.
 *
 * ══ WARUM ES DIESEN ZEUGEN GIBT (23.08.2026, am Geraet gefunden) ═══════════
 * Der ARD-Aufnehmen-Knopf der Verwaltung schickte den Eintrag seit jeher in
 * `{ eintrag: {...} }` verpackt. Die Route liest `req.body` DIREKT
 * (`neuerEintrag(req.body)`), also kam HTTP 400 „unvollstaendig" zurueck —
 * und der Knopf hat NIE einen Eintrag angelegt.
 *
 * ES GAB DAFUER KEINEN ZEUGEN, und das war kein Zufall: die Verwaltung prueft
 * ihre Aufrufe gegen eine ATTRAPPE (HttpTestingController), und eine Attrappe
 * nimmt jede Form an. Sie kann gar nicht merken, dass die Form falsch ist.
 * Gefunden wurde es erst, als derselbe Fehler in zwei neue Knoepfe kopiert
 * war und die Probe am Geraet ihn dreifach zeigte.
 *
 * ══ WAS DIESER ZEUGE FESTHAELT ═════════════════════════════════════════════
 * BEIDE Richtungen. Dass die flache Form geht, ist die halbe Aussage; die
 * andere Haelfte ist, dass die verpackte NICHT geht. Ohne sie koennte jemand
 * die Route „reparieren", indem er beide Formen annimmt — und dann steht
 * wieder nirgends, welche gilt.
 *
 * Der Gegenpart in der Verwaltung ist `tools/verwaltung-vertrag-probe.mjs`:
 * es liest die Aufrufe der Seiten und haelt sie gegen genau diesen Vertrag.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

const WURZEL = fs.mkdtempSync(path.join(os.tmpdir(), 'mupi-mv-'))
let app: import('express').Express

/** Ein gueltiger Eintrag — flach, so wie die Route ihn haben will. */
const FLACH = {
  type: 'spotify',
  category: 'audiobook',
  id: '4aawyAB9vmqN3uQ7FjRGTy',
  title: 'Die Zukunft wird groß',
  artist: 'Das Lumpenpack',
}

before(async () => {
  fs.writeFileSync(path.join(WURZEL, 'data.json'), '[]')
  fs.writeFileSync(path.join(WURZEL, 'active_data.json'), '[]')
  fs.writeFileSync(path.join(WURZEL, 'resume.json'), '[]')
  fs.writeFileSync(path.join(WURZEL, 'gespielt.json'), '[]')
  fs.writeFileSync(path.join(WURZEL, 'mupiboxconfig.json'), JSON.stringify({ mupibox: { resume: 9 } }))
  process.env.MUPIBOX_CONFIG = path.join(WURZEL, 'mupiboxconfig.json')
  process.env.MUPIBOX_CONFIG_DIR = WURZEL
  process.env.MUPIBOX_LOCK_DIR = WURZEL
  app = (await import('./server.js')).app
})

after(() => {
  process.env.MUPIBOX_CONFIG_DIR = undefined
  process.env.MUPIBOX_LOCK_DIR = undefined
  fs.rmSync(WURZEL, { recursive: true, force: true })
})

describe('POST /api/medien nimmt den Eintrag FLACH', () => {
  it('flach: HTTP 200 und der Schluessel kommt zurueck', async () => {
    const a = await request(app).post('/api/medien').send(FLACH)
    assert.equal(a.status, 200)
    assert.equal(a.body.ok, true)
    assert.equal(a.body.schluessel, 'spotify:4aawyAB9vmqN3uQ7FjRGTy')
  })

  it('VERPACKT in `eintrag`: HTTP 400 — genau der Fehler des ARD-Knopfes', async () => {
    /* Die andere Haelfte der Aussage. Wer die Route „grosszuegiger" macht und
     * beide Formen annimmt, macht diesen Zeugen rot — und das ist gewollt:
     * dann steht wieder nirgends, welche Form gilt, und der naechste Knopf
     * raet wieder. */
    const a = await request(app).post('/api/medien').send({ eintrag: FLACH })
    assert.equal(a.status, 400)
    assert.equal(a.body.error, 'unvollstaendig')
  })

  it('ohne `type` oder ohne `title` ebenfalls 400 — daran erkennt man die verpackte Form', async () => {
    // `{ eintrag: … }` ist fuer die Route schlicht ein Objekt OHNE type und
    // OHNE title. Deshalb dieselbe Meldung.
    assert.equal((await request(app).post('/api/medien').send({ title: 'Ohne Typ' })).status, 400)
    assert.equal((await request(app).post('/api/medien').send({ type: 'spotify', id: 'x' })).status, 400)
  })

  it('ein PLUGIN-Eintrag geht flach genauso durch (E87)', async () => {
    const a = await request(app)
      .post('/api/medien')
      .send({ type: 'plugin', category: 'audiobook', id: 'mixpi-archive:faust', title: 'Faust', artist: 'Goethe' })
    assert.equal(a.status, 200)
    assert.equal(a.body.schluessel, 'plugin:mixpi-archive:faust')
  })

  it('zweimal dasselbe: 409, nicht stillschweigend doppelt', async () => {
    const a = await request(app).post('/api/medien').send(FLACH)
    assert.equal(a.status, 409)
    assert.equal(a.body.error, 'schonVorhanden')
  })
})

describe('PATCH /api/medien/:schluessel traegt die Marke (E89)', () => {
  const EINTRAG = { type: 'library', category: 'audiobook', title: 'Stummel', artist: 'Wer' }
  const SCHLUESSEL = 'lokal:t:wer|stummel'

  it('legt mit Marke an und gibt sie zurueck', async () => {
    const a = await request(app).post('/api/medien').send({ ...EINTRAG, unvollstaendig: true })
    assert.equal(a.status, 200)
    const liste = await request(app).get('/api/medien').expect(200)
    const e = (liste.body.eintraege as Record<string, unknown>[]).find((x) => x.title === 'Stummel')
    assert.ok(e, 'der Eintrag fehlt in der Liste')
    assert.equal(e.unvollstaendig, true)
  })

  it('DIE MARKE LAESST SICH WIEDER ABRAEUMEN — sonst bliebe sie fuer immer', async () => {
    // Genau dieser Weg laeuft am Ende eines sauberen Mitschnitts.
    const a = await request(app)
      .patch(`/api/medien/${encodeURIComponent(SCHLUESSEL)}`)
      .send({ unvollstaendig: false })
    assert.equal(a.status, 200)
    const liste = await request(app).get('/api/medien').expect(200)
    const e = (liste.body.eintraege as Record<string, unknown>[]).find((x) => x.title === 'Stummel')
    assert.ok(e, 'der Eintrag fehlt in der Liste')
    assert.equal(e.unvollstaendig, undefined, 'geloescht, nicht auf false gesetzt')
  })

  it('und wieder setzen geht auch — ein Album, das weiterwaechst', async () => {
    const a = await request(app)
      .patch(`/api/medien/${encodeURIComponent(SCHLUESSEL)}`)
      .send({ unvollstaendig: true })
    assert.equal(a.status, 200)
    const liste = await request(app).get('/api/medien').expect(200)
    const e = (liste.body.eintraege as Record<string, unknown>[]).find((x) => x.title === 'Stummel')
    assert.ok(e, 'der Eintrag fehlt in der Liste')
    assert.equal(e.unvollstaendig, true)
  })
})
