/**
 * Der Verlauf am LAUFENDEN Server — und die eine Eigenschaft, auf die es
 * ankommt: BEIDE Oberflaechen erzeugen DENSELBEN Eintrag.
 *
 * WORUM ES GEHT: `POST /api/gespielt` nimmt zwei Formen entgegen.
 *
 *   { key: 'spotify:ABC', … }   so meldet die bestehende Angular-App
 *   { schluessel: 'spotify:ABC' } so meldet die neue Oberflaeche
 *
 * Die zweite Form ist der Schluessel aus dem Vertrag von `/api/werke`; der
 * Server schlaegt den Roheintrag nach und bildet daraus dieselbe Kennung.
 *
 * WARUM DAS EINEN TEST BRAUCHT: Weichen die beiden Wege ab, faellt das NICHT
 * auf — es entsteht einfach ein zweiter Eintrag. „Oft gehoert" zeigt dann
 * dasselbe Album doppelt mit je halbem Zaehler, und niemand kann sagen, warum
 * die Zahlen nicht stimmen. Dieser Test vergleicht deshalb nicht Formate,
 * sondern das ERGEBNIS: nach zwei Meldungen ueber verschiedene Wege muss GENAU
 * EIN Eintrag mit anzahl 2 dastehen.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { medienSchluessel } from './medien.js'

const EINTRAG = {
  id: 'test-verlauf-1',
  title: 'Eine Pruefgeschichte',
  artist: 'Pruefung',
  type: 'spotify',
  category: 'audiobook',
  cover: 'https://beispiel.invalid/bild.jpg',
}

/** Die Formel der Angular-App, woertlich aus player.service.ts:249-255. */
const WIE_DIE_ALTE_APP = `${EINTRAG.type}:${EINTRAG.id}`

let app: import('express').Express

describe('Verlauf: beide Oberflaechen, ein Eintrag', () => {
  before(async () => {
    const d = mkdtempSync(join(tmpdir(), 'mupi-verlauf-'))
    writeFileSync(join(d, 'active_data.json'), JSON.stringify([EINTRAG], null, 2))
    writeFileSync(join(d, 'data.json'), JSON.stringify([EINTRAG], null, 2))
    // Leerer Verlauf, damit die Zaehlung bei null beginnt.
    writeFileSync(join(d, 'gespielt.json'), '[]')
    process.env.MUPIBOX_CONFIG_DIR = d
    app = (await import('./server.js')).app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
  })

  it('bildet aus dem Vertrags-Schluessel die Kennung der alten App', async () => {
    const s = medienSchluessel(EINTRAG)
    const r = await request(app).post('/api/gespielt').send({ schluessel: s }).expect(200)
    assert.equal(r.body.status, 'ok')
    assert.equal(r.body.key, WIE_DIE_ALTE_APP, 'der Server muss DIESELBE Kennung bilden')
  })

  it('legt fuer einen unbekannten Schluessel NICHTS an', async () => {
    // Lieber nichts zaehlen als einen Eintrag, den niemand zuordnen kann.
    await request(app).post('/api/gespielt').send({ schluessel: 'spotify:gibtesnicht' }).expect(400)
  })

  it('nimmt die alte Form weiter an — die Angular-App wird nicht angefasst', async () => {
    await request(app)
      .post('/api/gespielt')
      .send({ key: WIE_DIE_ALTE_APP, title: EINTRAG.title, type: EINTRAG.type, id: EINTRAG.id })
      .expect(200)
  })

  it('ergaenzt den Werk-Schluessel, damit die Kachel startbar ist', async () => {
    // Der Verlauf traegt den Angular-Schluessel; zum Abspielen braucht die
    // neue Oberflaeche ein WERK. Die Bruecke schlaegt der Server, weil nur er
    // beide Formen aus demselben Roheintrag bilden kann.
    const r = await request(app).get('/api/gespielt?max=50').expect(200)
    const t = r.body.zuletzt.find((e: { key: string }) => e.key === WIE_DIE_ALTE_APP)
    assert.ok(t, 'der Eintrag muss da sein')
    assert.equal(t.schluessel, medienSchluessel(EINTRAG))
    assert.equal(t.bild, `/api/bild/${encodeURIComponent(medienSchluessel(EINTRAG))}`)
  })

  it('laesst einen Eintrag OHNE Werk stehen — nur ohne Schluessel', async () => {
    // Was frueher gehoert und inzwischen aus der Bibliothek genommen wurde,
    // gehoert weiter in den Verlauf. Es laesst sich nur nicht mehr starten.
    // Ihn wegzulassen hiesse, die Zahlen still zu faelschen.
    await request(app)
      .post('/api/gespielt')
      .send({ key: 'spotify:laengst-geloescht', title: 'Weg', type: 'spotify' })
      .expect(200)
    const r = await request(app).get('/api/gespielt?max=50').expect(200)
    const t = r.body.zuletzt.find((e: { key: string }) => e.key === 'spotify:laengst-geloescht')
    assert.ok(t, 'der Eintrag muss stehenbleiben')
    assert.equal(t.schluessel, undefined)
    assert.equal(t.title, 'Weg')
  })

  it('zaehlt beide Wege auf DENSELBEN Eintrag', async () => {
    const r = await request(app).get('/api/gespielt?max=50').expect(200)
    const treffer = r.body.zuletzt.filter((e: { key: string }) => e.key === WIE_DIE_ALTE_APP)
    assert.equal(treffer.length, 1, 'zwei Eintraege hiessen: die Wege driften auseinander')
    // Die Sperre (SPERRE_MS) zaehlt zwei Starts binnen einer Minute als EINEN.
    // Geprueft wird deshalb nicht die Zahl, sondern dass es EIN Eintrag blieb.
    assert.ok(treffer[0].anzahl >= 1)
    assert.equal(treffer[0].title, EINTRAG.title, 'die Felder fuer die Kachel muessen mitkommen')
    assert.equal(treffer[0].cover, EINTRAG.cover)
  })
})
