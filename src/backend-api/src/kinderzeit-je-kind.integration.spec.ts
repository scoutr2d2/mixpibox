/**
 * EIGENE KINDERZEIT-REGELN JE KIND — der Weg, den die Verwaltung braucht.
 *
 * ══ DIE LUECKE (README 3.9 bis zum 25.09.2026) ═══════════════════════════════
 *
 * Der Server fuehrt seit dem 02.08.2026 eine Hausregel (`standard`) und
 * Ausnahmen je Kind (`je.<kennung>`). Die Verwaltung schrieb trotzdem nur die
 * Hausregel, und zwei Dinge fehlten ihr dafuer am Server:
 *
 *   1. ZU SEHEN, OB EIN KIND EIGENE REGELN HAT. `GET /api/kinderzeit?profil=`
 *      antwortet mit einem blanken Regeln-Objekt — eigene und geerbte Regeln
 *      sehen gleich aus. Wer daraus eine Tabelle baut und speichert, friert
 *      still eine Kopie der Hausregel fuer dieses Kind ein.
 *   2. EIGENE REGELN WIEDER ABZULEGEN. `PUT` kann nur setzen; ein Eintrag in
 *      `je` verschwand bis dahin allein mit dem Kind.
 *
 * Dafuer gibt es `GET /api/kinderzeit/satz` und `DELETE /api/kinderzeit`.
 *
 * GEPRUEFT WIRD, WAS DIE BOX DANACH UEBER DAS KIND SAGT (`/stand`, `?profil=`),
 * nicht nur, was in der Datei steht.
 *
 * EIGENER LAUF, EIGENES VERZEICHNIS: server.ts liest `MUPIBOX_CONFIG_DIR`
 * einmal beim Laden des Moduls; `node --test` gibt jeder Testdatei einen
 * eigenen Prozess.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

let app: import('express').Express
let ordner: string

/** Eine Regel, an der man sie wiedererkennt: Montag frei mit `minuten`. */
const regel = (minuten: number, aktiv = true) => ({
  aktiv,
  nachsichtMin: 0,
  tage: { mo: { frei: true, ab: '', bis: '', minuten } },
})

describe('Kinderzeit: eigene Regeln je Kind — sehen, setzen, wieder ablegen', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-kz-je-kind-'))
    writeFileSync(join(ordner, 'active_data.json'), '[]')
    writeFileSync(join(ordner, 'data.json'), '[]')
    writeFileSync(
      join(ordner, 'profile.json'),
      JSON.stringify({
        profile: [
          { kennung: 'gast', name: 'Gast', figur: '', angelegt: 1 },
          { kennung: 'kalea', name: 'Kalea', figur: '', angelegt: 2 },
          { kennung: 'liam', name: 'Liam', figur: '', angelegt: 3 },
        ],
        aktiv: 'kalea',
      }),
    )
    process.env.MUPIBOX_CONFIG_DIR = ordner
    const modul = await import('./server.js')
    app = modul.app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
  })

  it('ohne Ausnahmen: der Satz nennt nur die Hausregel', async () => {
    await request(app).put('/api/kinderzeit').send(regel(60)).expect(200)
    const s = await request(app).get('/api/kinderzeit/satz').expect(200)
    assert.equal(s.body.standard.tage.mo.minuten, 60)
    assert.deepEqual(s.body.je, {}, 'noch hat kein Kind eigene Regeln')
  })

  it('eine eigene Regel fuer Liam steht im Satz — und nur er hat sie', async () => {
    await request(app).put('/api/kinderzeit?profil=liam').send(regel(15)).expect(200)
    const s = await request(app).get('/api/kinderzeit/satz').expect(200)
    assert.deepEqual(Object.keys(s.body.je), ['liam'])
    assert.equal(s.body.je.liam.tage.mo.minuten, 15)
    assert.equal(s.body.standard.tage.mo.minuten, 60, 'die Hausregel bleibt, wie sie war')
    // Kalea erbt weiter — der Satz sagt es, die Einzelabfrage allein koennte es nicht.
    const k = await request(app).get('/api/kinderzeit?profil=kalea').expect(200)
    assert.equal(k.body.tage.mo.minuten, 60)
  })

  it('eine eigene Regel kann ein Kind von der Begrenzung ausnehmen', async () => {
    await request(app).put('/api/kinderzeit?profil=kalea').send(regel(0, false)).expect(200)
    const st = await request(app).get('/api/kinderzeit/stand?profil=kalea').expect(200)
    assert.equal(st.body.aktiv, false, 'fuer Kalea gilt keine Spielzeit')
    const sl = await request(app).get('/api/kinderzeit/stand?profil=liam').expect(200)
    assert.equal(sl.body.aktiv, true, 'fuer Liam weiterhin')
  })

  it('DELETE legt Liams eigene Regel ab — danach gilt fuer ihn die Hausregel', async () => {
    const d = await request(app).delete('/api/kinderzeit?profil=liam').expect(200)
    assert.equal(d.body.tage.mo.minuten, 60, 'die Antwort ist, was jetzt fuer ihn gilt')
    const r = await request(app).get('/api/kinderzeit?profil=liam').expect(200)
    assert.equal(r.body.tage.mo.minuten, 60)
    const datei = JSON.parse(readFileSync(join(ordner, 'kinderzeit.json'), 'utf8'))
    assert.equal(Object.hasOwn(datei.je ?? {}, 'liam'), false, 'und auf der Platte steht sie nicht mehr')
    assert.equal(Object.hasOwn(datei.je ?? {}, 'kalea'), true, 'Kaleas Ausnahme bleibt unberuehrt')
  })

  it('eine spaetere Aenderung der Hausregel erreicht das Kind ohne eigene Regel wieder', async () => {
    await request(app).put('/api/kinderzeit').send(regel(45)).expect(200)
    const r = await request(app).get('/api/kinderzeit?profil=liam').expect(200)
    assert.equal(r.body.tage.mo.minuten, 45)
  })

  it('DELETE ohne eigene Regel ist harmlos und antwortet mit der Hausregel', async () => {
    const d = await request(app).delete('/api/kinderzeit?profil=liam').expect(200)
    assert.equal(d.body.tage.mo.minuten, 45)
  })

  it('die Hausregel selbst laesst sich nicht loeschen', async () => {
    const d = await request(app).delete('/api/kinderzeit').expect(400)
    assert.equal(d.body.error, 'hausregelBleibt')
    const s = await request(app).get('/api/kinderzeit/satz').expect(200)
    assert.equal(s.body.standard.tage.mo.minuten, 45)
  })

  it('ein unbekanntes Kind wird abgewiesen', async () => {
    const d = await request(app).delete('/api/kinderzeit?profil=niemand').expect(400)
    assert.equal(d.body.error, 'unbekanntesProfil')
  })
})
