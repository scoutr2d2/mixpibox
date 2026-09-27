/**
 * DER WEG VOM FARBFELD IN DIE FESTE DATEI — an einem echten Server.
 *
 * `farbthema.spec.ts` prueft die REGELN (Block bauen, lesen, ersetzen).
 * Hier wird geprueft, was nur ein laufender Server zeigt — SEIT E118/1c auf
 * dem NEUEN Weg: PUT schreibt in EINE feste Datei (mixpi-farben.css neben
 * der uebrigen Konfiguration), GET /farben.css liefert sie aus, und ein
 * fehlendes Blatt ist der neutrale Zustand (200, leer), kein Fehler.
 *
 * WAS MIT 1c GEFALLEN IST — und deshalb hier NICHT mehr steht: der
 * Themenname aus mupibox.theme, die themes/<name>.css als Ziel, die
 * .vor-farben-Sicherung (die Datei gehoert ganz dem Waehler), der
 * sudo-Verweis-Nachzug samt verweis-Feld und die 409-Antworten (es gibt
 * keinen Zustand „kein Farbthema eingestellt" mehr). Die alte Fassung
 * dieser Spec traegt der Loeschungs-Commit von E118/1e.
 *
 * WAS BLEIBT: die MIGRATIONS-BRUECKE. Eine Bestandsbox traegt ihre Farben
 * noch im Block der alten Themendatei; solange die neue Datei fehlt, liest
 * GET /api/farbthema sie von dort — NUR lesend.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

let app: import('express').Express
let konfigOrdner = ''
let themenDir = ''
let konfigDatei = ''

const farbenDatei = (): string => join(konfigOrdner, 'mixpi-farben.css')

describe('/api/farbthema + /farben.css (feste Datei seit E118/1c)', () => {
  before(async () => {
    themenDir = mkdtempSync(join(tmpdir(), 'mupi-themen-'))
    const konfigDir = mkdtempSync(join(tmpdir(), 'mupi-konfig-'))
    konfigDatei = join(konfigDir, 'mupiboxconfig.json')
    konfigOrdner = mkdtempSync(join(tmpdir(), 'mupi-daten-'))
    process.env.MUPIBOX_THEMES_DIR = themenDir
    process.env.MUPIBOX_CONFIG = konfigDatei
    process.env.MUPIBOX_CONFIG_DIR = konfigOrdner
    writeFileSync(konfigDatei, JSON.stringify({ mupibox: {} }))
    app = (await import('./server.js')).app
  })

  after(() => {
    process.env.MUPIBOX_THEMES_DIR = undefined
    process.env.MUPIBOX_CONFIG = undefined
    process.env.MUPIBOX_CONFIG_DIR = undefined
  })

  it('meldet zunaechst keine eigenen Farben — und /farben.css ist ein LEERES Blatt, kein 404', async () => {
    const g = await request(app).get('/api/farbthema').expect(200)
    assert.deepEqual(g.body.farben, {})
    // Der neutrale Zustand haengt an keiner Datei: 200 mit leerem text/css.
    // Ein 404 hiesse eine rote Konsolenzeile an jedem frischen Geraet.
    const blatt = await request(app).get('/farben.css').expect(200)
    assert.match(String(blatt.headers['content-type']), /text\/css/)
    assert.equal(blatt.text, '')
  })

  it('schreibt in die FESTE Datei — mit !important und ohne den dunklen Stand zu treffen', async () => {
    const r = await request(app)
      .put('/api/farbthema')
      .send({ farben: { '--bg': '#123456', '--ink': '#654321' } })
      .expect(200)
    assert.equal(r.body.ok, true)
    assert.deepEqual(r.body.farben, { '--bg': '#123456'.toUpperCase(), '--ink': '#654321'.toUpperCase() })

    const inhalt = readFileSync(farbenDatei(), 'utf8')
    // GEMESSEN am Geraet (tools/farbwaehler-wirkung.mjs): ohne !important
    // bleibt der Wert wirkungslos, weil app.css spaeter kommt.
    assert.match(inhalt, /--bg: #123456 !important;/)
    // Und ohne das :not(...) waere der dunkle Stand erschlagen.
    assert.match(inhalt, /:root:not\(\[data-licht='dunkel'\]\)/)
  })

  it('liefert /farben.css genau das, was geschrieben wurde', async () => {
    const blatt = await request(app).get('/farben.css').expect(200)
    assert.match(blatt.text, /--bg: #123456 !important;/)
    // Frisch bei jedem Abruf: der Waehler stoesst nach dem Speichern ein
    // Neuladen an, und das muss die neue Datei sehen.
    assert.equal(blatt.headers['cache-control'], 'no-store')
  })

  it('liest zurueck, was es geschrieben hat', async () => {
    const r = await request(app).get('/api/farbthema').expect(200)
    assert.deepEqual(r.body.farben, { '--bg': '#123456', '--ink': '#654321' })
  })

  it('sammelt bei mehrfachem Speichern keine Bloecke an', async () => {
    await request(app)
      .put('/api/farbthema')
      .send({ farben: { '--bg': '#ABCDEF' } })
      .expect(200)
    const inhalt = readFileSync(farbenDatei(), 'utf8')
    assert.equal(inhalt.split('ANFANG (erzeugt)').length - 1, 1)
    assert.deepEqual((await request(app).get('/api/farbthema')).body.farben, { '--bg': '#ABCDEF' })
  })

  it('wirft Unsinn weg, statt alles abzulehnen', async () => {
    const r = await request(app)
      .put('/api/farbthema')
      .send({ farben: { '--bg': '#001122', boese: 'red', '--x': 'javascript:1' } })
      .expect(200)
    assert.deepEqual(r.body.farben, { '--bg': '#001122' })
  })

  it('nimmt den Block bei leerer Auswahl wieder heraus', async () => {
    await request(app).put('/api/farbthema').send({ farben: {} }).expect(200)
    const inhalt = readFileSync(farbenDatei(), 'utf8')
    assert.ok(!inhalt.includes('ANFANG (erzeugt)'), inhalt)
    const blatt = await request(app).get('/farben.css').expect(200)
    assert.ok(!blatt.text.includes('ANFANG (erzeugt)'))
  })

  it('holt Farben einer BESTANDSBOX aus dem alten Themen-Block — nur solange die neue Datei fehlt', async () => {
    // Die Migrations-Bruecke (altFarbthemaLesen): mupibox.theme zeigt auf
    // eine Themendatei mit Waehler-Block; die neue Ablage gibt es noch
    // nicht. GET muss die Farben liefern, damit der Waehler einer
    // aktualisierten Box nicht leer aufmacht. NUR LESEND: /farben.css
    // bleibt leer, bis wirklich gespeichert wird.
    const { rmSync } = await import('node:fs')
    rmSync(farbenDatei(), { force: true })
    writeFileSync(konfigDatei, JSON.stringify({ mupibox: { theme: 'AltesThema' } }))
    writeFileSync(
      join(themenDir, 'AltesThema.css'),
      [
        '/* ── MuPiBox: Farben der neuen Oberflaeche — ANFANG (erzeugt) ── */',
        ":root:not([data-licht='dunkel']) {",
        '  --bg: #0F0F0F !important;',
        '}',
        '/* ── MuPiBox: Farben der neuen Oberflaeche — ENDE ── */',
      ].join('\n'),
    )
    const g = await request(app).get('/api/farbthema').expect(200)
    assert.deepEqual(g.body.farben, { '--bg': '#0F0F0F' })
    assert.equal(existsSync(farbenDatei()), false, 'GET darf nichts anlegen')
    // Der naechste Speichervorgang legt die neue Ablage an — ab dann ist
    // der Alt-Weg bedeutungslos, auch wenn die Themendatei liegen bleibt.
    await request(app)
      .put('/api/farbthema')
      .send({ farben: { '--bg': '#101010' } })
      .expect(200)
    assert.deepEqual((await request(app).get('/api/farbthema')).body.farben, { '--bg': '#101010' })
  })

  it('ein Themenname mit .. kann nichts mehr anrichten — er wird schlicht nicht gelesen', async () => {
    // Der Name kommt aus einer Datei, die auch von Hand bearbeitet wird.
    // Seit 1c ist er nur noch fuer die Migrations-Bruecke von Belang, und
    // die weist ihn ab: GET faellt auf „keine Farben" zurueck, PUT schreibt
    // ohnehin an die feste Adresse.
    const { rmSync } = await import('node:fs')
    rmSync(farbenDatei(), { force: true })
    writeFileSync(konfigDatei, JSON.stringify({ mupibox: { theme: '../../../tmp/entlaufen' } }))
    const g = await request(app).get('/api/farbthema').expect(200)
    assert.deepEqual(g.body.farben, {})
    await request(app)
      .put('/api/farbthema')
      .send({ farben: { '--bg': '#000000' } })
      .expect(200)
    assert.match(readFileSync(farbenDatei(), 'utf8'), /--bg: #000000 !important;/)
  })
})
