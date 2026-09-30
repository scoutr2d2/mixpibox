/**
 * DIE KOPPLUNG UEBER DIE SCHNITTSTELLE (27.09.2026).
 *
 * Die Regeln selbst prueft kopplung.spec.ts; hier nur, dass server.ts sie an
 * den richtigen Stellen ruft — die Sperre VOR allem anderen, die Routen in
 * der richtigen Reihenfolge, und die Ablage ohne Schluessel.
 *
 * WAS HIER NICHT GEHT: „nur an der Box" von aussen pruefen. supertest spricht
 * immer ueber die Rueckschleife; diese Grenze haelt `istRueckschleife`
 * (auth.ts) mit seinen eigenen Zeugen.
 */
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

let app: import('express').Express
let ordner = ''
const APP = { 'x-mixpi-app': 'fernbedienung' }

/** Das erste Ereignis aus /api/box/strom — an einem echten Socket, der Strom endet nie. */
async function stromLesen(): Promise<Record<string, unknown>> {
  const server = app.listen(0)
  await new Promise((fertig) => server.once('listening', fertig))
  const port = (server.address() as AddressInfo).port
  try {
    return await new Promise((fertig, fehler) => {
      const anfrage = http.get({ port, path: '/api/box/strom' }, (res) => {
        let puffer = ''
        res.setEncoding('utf8')
        res.on('data', (s: string) => {
          puffer += s
          const zeile = puffer.split('\n').find((z) => z.startsWith('data: '))
          if (zeile) {
            anfrage.destroy()
            fertig(JSON.parse(zeile.slice(6)))
          }
        })
      })
      anfrage.on('error', () => {})
      setTimeout(() => fehler(new Error('kein Ereignis')), 3000)
    })
  } finally {
    server.close()
  }
}

describe('Kopplung der Handy-App ueber die Schnittstelle', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mixpi-kopplung-'))
    writeFileSync(join(ordner, 'active_data.json'), JSON.stringify([]))
    writeFileSync(join(ordner, 'data.json'), JSON.stringify([]))
    process.env.MUPIBOX_CONFIG_DIR = ordner
    process.env.MUPIBOX_LOCK_DIR = ordner
    app = (await import('./server.js')).app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_LOCK_DIR = undefined
  })

  let schluessel = ''
  let id = ''
  let code = ''

  it('sperrt die App ohne Schluessel — aber nicht den Browser', async () => {
    const r = await request(app).get('/api/profile').set(APP).expect(403)
    assert.equal(r.body.error, 'nichtGekoppelt')
    await request(app).get('/api/profile').expect(200)
  })

  it('laesst die App die Box finden und nach ihrer Kopplung fragen', async () => {
    await request(app).get('/api/box').set(APP).expect(200)
    const s = await request(app).get('/api/kopplung/status').set(APP).expect(200)
    assert.equal(s.body.gekoppelt, false)
  })

  it('koppelt nur mit dem Code, den die Box gerade zeigt', async () => {
    const zu = await request(app).post('/api/kopplung/koppeln').set(APP).send({ code: '000000' }).expect(403)
    assert.equal(zu.body.error, 'kopplung_keins')

    const f = await request(app).post('/api/kopplung/fenster').expect(200)
    assert.match(f.body.code, /^\d{6}$/)
    const falsch = f.body.code === '000000' ? '111111' : '000000'
    const r1 = await request(app).post('/api/kopplung/koppeln').set(APP).send({ code: falsch }).expect(403)
    assert.equal(r1.body.error, 'kopplung_falsch')

    const r2 = await request(app)
      .post('/api/kopplung/koppeln')
      .set(APP)
      .send({ code: f.body.code, name: 'Achims Honor' })
      .expect(200)
    schluessel = r2.body.schluessel
    id = r2.body.id
    code = f.body.code
    assert.match(schluessel, /^[0-9a-f]{64}$/)
  })

  it('wer mit demselben Code zu spaet kommt, liest, dass ein anderes Geraet schneller war', async () => {
    const r = await request(app).post('/api/kopplung/koppeln').set(APP).send({ code }).expect(403)
    assert.equal(r.body.error, 'kopplung_vergeben')
    assert.match(r.body.hinweis, /anderes Gerät/)
  })

  it('beweist ohne Schluessel, dass sie dieses Handy kennt — und gibt dabei nichts heraus', async () => {
    const frage = '0123456789abcdef'.repeat(2)
    // OHNE x-mixpi-schluessel: die App fragt eine Adresse, der sie noch nicht traut.
    const r = await request(app).post('/api/kopplung/beweis').set(APP).send({ frage }).expect(200)
    const abdruck = createHash('sha256').update(schluessel, 'utf8').digest()
    const erwartet = createHmac('sha256', abdruck).update(`mixpi-kopplung-beweis:${frage}`, 'utf8').digest('hex')
    assert.deepEqual(r.body.beweise, [erwartet])
    assert.equal(JSON.stringify(r.body).includes(schluessel), false)
    assert.equal(JSON.stringify(r.body).includes(abdruck.toString('hex')), false)
    const unsinn = await request(app).post('/api/kopplung/beweis').set(APP).send({ frage: 'x' }).expect(400)
    assert.equal(unsinn.body.error, 'frageUngueltig')
  })

  it('mit Schluessel ist die App drin — und die Ablage kennt ihn nicht', async () => {
    await request(app).get('/api/profile').set(APP).set('x-mixpi-schluessel', schluessel).expect(200)
    const s = await request(app).get('/api/kopplung/status').set(APP).set('x-mixpi-schluessel', schluessel)
    assert.equal(s.body.gekoppelt, true)
    assert.equal(s.body.name, 'Achims Honor')
    assert.equal(readFileSync(join(ordner, 'kopplung.json'), 'utf8').includes(schluessel), false)
  })

  it('das Admin-Menue der Box sieht das Handy und kann es entfernen', async () => {
    const g = await request(app).get('/api/kopplung/geraete').expect(200)
    assert.deepEqual(
      g.body.geraete.map((x: { name: string }) => x.name),
      ['Achims Honor'],
    )
    await request(app).post(`/api/kopplung/geraete/${id}/entfernen`).expect(200)
    await request(app).get('/api/profile').set(APP).set('x-mixpi-schluessel', schluessel).expect(403)
  })

  it('der Debug-Schalter an der Box laesst Apps ohne Kopplung zu — und wieder nicht', async () => {
    await request(app).post('/api/kopplung/ohne').send({ an: true }).expect(200)
    await request(app).get('/api/profile').set(APP).expect(200)
    await request(app).post('/api/kopplung/ohne').send({ an: false }).expect(200)
    await request(app).get('/api/profile').set(APP).expect(403)
  })

  it('die App bittet um den Code — der Strom traegt die Bitte zum Schirm, den Code NICHT', async () => {
    await request(app).post('/api/kopplung/anfrage').set(APP).send({ name: 'Achims Honor' }).expect(200)
    const e = await stromLesen()
    const bitte = e.anfrage as { id: string; name: string }
    assert.equal(bitte.name, 'Achims Honor')
    assert.equal(JSON.stringify(e).match(/\d{6}/), null, 'kein sechsstelliger Code im Strom')

    // Der Schirm oeffnet das Fenster FUER die Bitte — danach ist sie erledigt.
    const f = await request(app).post('/api/kopplung/fenster').send({ anfrage: bitte.id }).expect(200)
    assert.match(f.body.code, /^\d{6}$/)
    assert.equal((await stromLesen()).anfrage, null)
    await request(app).post('/api/kopplung/koppeln').set(APP).send({ code: f.body.code }).expect(200)
  })

  it('bremst eine zweite Bitte desselben Handys binnen 30 s', async () => {
    const r = await request(app).post('/api/kopplung/anfrage').set(APP).send({}).expect(429)
    assert.equal(r.body.error, 'zuOft')
  })
})
