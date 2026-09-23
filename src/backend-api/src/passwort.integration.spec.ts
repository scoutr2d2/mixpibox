/**
 * DAS PROFIL-PASSWORT AM ENDPUNKT — der ganze Weg, wie ihn die Box geht.
 *
 * Was die reinen Tests (profile.spec.ts) nicht sehen koennen, steht hier:
 * dass der SERVER die Regeln durchsetzt und nicht die Oberflaeche —
 * curl kann jeder, und genau dagegen ist das Schloss gebaut:
 *
 *   1. Wechsel auf ein geschuetztes Profil: ohne Passwort 401 (mit `art`,
 *      damit die Oberflaeche die richtige Eingabe zeigt), falsch 403,
 *      richtig 200.
 *   2. ABMELDEN IST IMMER FREI: der Wechsel zum Gast verlangt nie ein
 *      Passwort — sonst hielte ein Kind das naechste als Geisel.
 *   3. Das eigene Schloss aendern/entfernen verlangt das alte Passwort.
 *   4. Der Gast bekommt keines (400).
 *   5. KEIN ABDRUCK NACH DRAUSSEN: auf der Platte steht der bcrypt-Hash,
 *      in keiner Antwort steht er je — die Leck-Gegenprobe am echten Rohr.
 *   6. Der Eltern-Ausweg: `PUT /api/profile` mit `passwort: null` entfernt
 *      das Schloss; ein Eintrag OHNE das Feld laesst es stehen.
 *
 * EIGENER LAUF, EIGENES VERZEICHNIS — wie profile.integration.spec.ts:
 * server.ts richtet sich beim Laden des Moduls ein.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, describe, it } from 'node:test'
import request from 'supertest'

let app: import('express').Express
let ordner: string

const KANON = 'n:2580'
const KANON_NEU = 'f:1-4-2'

describe('Profil-Passwort am Endpunkt', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mixpi-passwort-'))
    writeFileSync(join(ordner, 'active_data.json'), JSON.stringify([]))
    writeFileSync(join(ordner, 'data.json'), JSON.stringify([]))
    writeFileSync(
      join(ordner, 'profile.json'),
      JSON.stringify({ profile: [{ kennung: 'kalea', name: 'Kalea', angelegt: 1 }], aktiv: 'gast' }),
    )
    process.env.MUPIBOX_CONFIG_DIR = ordner
    const modul = await import('./server.js')
    app = modul.app
  })

  it('der Gast bekommt kein Schloss (400)', async () => {
    const r = await request(app).post('/api/profil/passwort').send({ art: 'zahlen', neu: KANON })
    assert.equal(r.status, 400)
    assert.equal(r.body.error, 'gastOhnePasswort')
  })

  it('das eigene Profil bekommt eines — und die Antwort traegt keinen hash', async () => {
    // Erst zu Kalea (ungeschuetzt = frei), dann Schloss dran.
    await request(app).post('/api/profil/aktiv').send({ kennung: 'kalea' }).expect(200)
    const r = await request(app).post('/api/profil/passwort').send({ art: 'zahlen', neu: KANON })
    assert.equal(r.status, 200)
    const kalea = r.body.profile.find((p: { kennung: string }) => p.kennung === 'kalea')
    assert.equal(kalea.geschuetzt, true)
    assert.equal(kalea.passwortArt, 'zahlen')
    assert.ok(!JSON.stringify(r.body).includes('hash'), 'hash steht in der Antwort')
    // Auf der PLATTE steht er sehr wohl — sonst waere nichts gespeichert.
    assert.ok(readFileSync(join(ordner, 'profile.json'), 'utf8').includes('$2'), 'kein bcrypt-Abdruck auf Platte')
  })

  it('eine zu kurze oder unbekannte Eingabe faellt vorher durch (400)', async () => {
    assert.equal((await request(app).post('/api/profil/passwort').send({ art: 'zahlen', neu: 'ab', alt: KANON })).status, 400)
    assert.equal((await request(app).post('/api/profil/passwort').send({ art: 'raten', neu: KANON, alt: KANON })).status, 400)
  })

  it('ABMELDEN IST IMMER FREI: zum Gast geht es ohne Passwort', async () => {
    const r = await request(app).post('/api/profil/aktiv').send({ kennung: 'gast' })
    assert.equal(r.status, 200)
    assert.equal(r.body.aktiv, 'gast')
  })

  it('zurueck zu Kalea: ohne Passwort 401 mit art, falsch 403, richtig 200', async () => {
    const ohne = await request(app).post('/api/profil/aktiv').send({ kennung: 'kalea' })
    assert.equal(ohne.status, 401)
    assert.equal(ohne.body.error, 'passwortNoetig')
    assert.equal(ohne.body.art, 'zahlen')

    const falsch = await request(app).post('/api/profil/aktiv').send({ kennung: 'kalea', passwort: 'n:0000' })
    assert.equal(falsch.status, 403)
    assert.equal(falsch.body.error, 'passwortFalsch')

    const richtig = await request(app).post('/api/profil/aktiv').send({ kennung: 'kalea', passwort: KANON })
    assert.equal(richtig.status, 200)
    assert.equal(richtig.body.aktiv, 'kalea')
  })

  it('aendern verlangt das alte: ohne/falsch 403, mit richtig 200 und neuer Art', async () => {
    const ohneAlt = await request(app).post('/api/profil/passwort').send({ art: 'farben', neu: KANON_NEU })
    assert.equal(ohneAlt.status, 403)
    assert.equal(ohneAlt.body.error, 'altFalsch')

    const r = await request(app).post('/api/profil/passwort').send({ art: 'farben', neu: KANON_NEU, alt: KANON })
    assert.equal(r.status, 200)
    const kalea = r.body.profile.find((p: { kennung: string }) => p.kennung === 'kalea')
    assert.equal(kalea.passwortArt, 'farben')
  })

  it('der Eltern-Ausweg: PUT ohne Feld laesst das Schloss, passwort:null entfernt es', async () => {
    // Ein Eintrag OHNE das Feld — Umbenennen darf das Schloss nicht kosten.
    const bleibt = await request(app)
      .put('/api/profile')
      .send({ profile: [{ kennung: 'kalea', name: 'Kalea-Luna', angelegt: 1 }] })
    assert.equal(bleibt.status, 200)
    let kalea = bleibt.body.profile.find((p: { kennung: string }) => p.kennung === 'kalea')
    assert.equal(kalea.geschuetzt, true, 'Umbenennen hat das Schloss gekostet')

    const weg = await request(app)
      .put('/api/profile')
      .send({ profile: [{ kennung: 'kalea', name: 'Kalea-Luna', angelegt: 1, passwort: null }] })
    assert.equal(weg.status, 200)
    kalea = weg.body.profile.find((p: { kennung: string }) => p.kennung === 'kalea')
    assert.equal(kalea.geschuetzt, false, 'passwort:null muss das Schloss entfernen')
  })

  it('entfernen mit dem alten Passwort — danach ist der Wechsel wieder frei', async () => {
    // Schloss wieder dran (wir sind Kalea), dann sauber entfernen.
    await request(app).post('/api/profil/passwort').send({ art: 'muster', neu: 'm:0-4-8' }).expect(200)
    const falsch = await request(app).delete('/api/profil/passwort').send({ alt: 'm:8-4-0' })
    assert.equal(falsch.status, 403)
    const r = await request(app).delete('/api/profil/passwort').send({ alt: 'm:0-4-8' })
    assert.equal(r.status, 200)
    const kalea = r.body.profile.find((p: { kennung: string }) => p.kennung === 'kalea')
    assert.equal(kalea.geschuetzt, false)
    // Und der Beweis im Verhalten: abmelden, wieder anmelden — ohne Passwort.
    await request(app).post('/api/profil/aktiv').send({ kennung: 'gast' }).expect(200)
    await request(app).post('/api/profil/aktiv').send({ kennung: 'kalea' }).expect(200)
  })
})
