/**
 * DIE STROEME AM SERVER (E72) — die Haelfte, die stroeme.spec.ts nicht prueft.
 *
 * `stroeme.spec.ts` prueft die REGELN gegen erfundene Aufstellungen: rein und
 * schnell. Was sie nicht beweisen kann, ist die VERDRAHTUNG — dass eine Box
 * ohne Angabe ihre heutige Gestalt behaelt, dass ein Schluessel beim Speichern
 * nicht verlorengeht, und vor allem, dass er nicht ueber HTTP hinausgeht.
 *
 * ══ DREI FAELLE TRAGEN DIESEN TEST ═════════════════════════════════════════
 *
 *   1. DIE BOX VON HEUTE. Keine `stroeme` in der Konfiguration — dann muss
 *      genau ein Strom herauskommen, mit dem vorhandenen Schluessel. Die
 *      Einfuehrung der Stroeme darf an einer bestehenden Box NICHTS aendern.
 *   2. DER SCHLUESSEL BLEIBT DRIN. Die Oberflaeche bekommt ihn verdeckt, kann
 *      ihn also beim Speichern nicht mitschicken. Wuerde ein leeres Feld als
 *      „loeschen" gelesen, wuerfe jedes Speichern den Zugang weg — und die
 *      Box spielte nach einem Klick auf „Sichern" nicht mehr.
 *   3. ZWEI STROEME MIT DEMSELBEN ZUGANG. Der teure Fall aus E72: der zweite
 *      nimmt dem ersten die Wiedergabe weg, mitten im Stueck. Es wird
 *      GEMELDET und trotzdem gespeichert — eine Box, die wegen einer
 *      Konfigurationsfrage gar nicht mehr spielt, ist schlimmer.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

const SCHLUESSEL_A = `spak_${'a'.repeat(32)}`
const SCHLUESSEL_B = `spak_${'b'.repeat(32)}`

let verzeichnis: string
let konfigPfad: string
let app: import('express').Express

function konfigSchreiben(spotify: Record<string, unknown>): void {
  writeFileSync(konfigPfad, JSON.stringify({ mupibox: { host: 'MixPiBox' }, spotify }, null, 2))
}

function konfigLesen(): Record<string, any> {
  return JSON.parse(readFileSync(konfigPfad, 'utf8'))
}

describe('Die Stroeme am Server (E72)', () => {
  before(async () => {
    verzeichnis = mkdtempSync(join(tmpdir(), 'mupi-stroeme-'))
    konfigPfad = join(verzeichnis, 'mupiboxconfig.json')
    konfigSchreiben({ engine: 'soloist', soloistApiKey: SCHLUESSEL_A })
    writeFileSync(join(verzeichnis, 'data.json'), '[]')
    writeFileSync(join(verzeichnis, 'active_data.json'), '[]')
    process.env.MUPIBOX_CONFIG = konfigPfad
    process.env.MUPIBOX_CONFIG_DIR = verzeichnis
    process.env.MUPIBOX_LOCK_DIR = verzeichnis
    app = (await import('./server.js')).app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_LOCK_DIR = undefined
  })

  it('FALL 1 — liefert genau einen Strom mit dem vorhandenen Zugang', async () => {
    konfigSchreiben({ engine: 'soloist', soloistApiKey: SCHLUESSEL_A })
    const r = await request(app).get('/api/stroeme').expect(200)
    assert.equal(r.body.stroeme.length, 1)
    assert.equal(r.body.stroeme[0].nr, 1)
    assert.equal(r.body.stroeme[0].zweck, 'wiedergabe')
    assert.equal(r.body.stroeme[0].maschine, 'soloist')
    assert.equal(r.body.stroeme[0].schluesselGesetzt, true)
    assert.equal(r.body.stroeme[0].schluesselForm, true)
    assert.deepEqual(r.body.befunde, [], 'ein einzelner Strom ist nie zu beanstanden')
  })

  it('FALL 1 — nennt den Geraetenamen, unter dem die Box in Spotify erscheint', async () => {
    const r = await request(app).get('/api/stroeme').expect(200)
    assert.equal(r.body.stroeme[0].name, 'MixPiBox Stream 1')
  })

  it('DER ZUGANG GEHT NIE HINAUS — steht in keiner Antwort — weder bei GET noch bei PUT', async () => {
    // Er steht auf dieser Box ohnehin in `ps` (bekannte Grenze). Das ist
    // kein Grund, ihn zusaetzlich ueber HTTP zu verteilen: was man nicht
    // auslesen kann, landet auch nicht versehentlich in einem Protokoll.
    konfigSchreiben({ engine: 'soloist', soloistApiKey: SCHLUESSEL_A })
    const g = await request(app).get('/api/stroeme').expect(200)
    assert.ok(!JSON.stringify(g.body).includes(SCHLUESSEL_A), 'GET gibt den Schluessel heraus')

    const p = await request(app)
      .put('/api/stroeme')
      .send({ stroeme: [{ nr: 1, zweck: 'wiedergabe', maschine: 'soloist', schluessel: '' }] })
      .expect(200)
    assert.ok(!JSON.stringify(p.body).includes(SCHLUESSEL_A), 'PUT gibt den Schluessel heraus')
  })

  it('DER ZUGANG GEHT NIE HINAUS — unterscheidet „gesetzt" von „richtig geformt"', async () => {
    // Am 20.08.2026 stand der Platzhalter SPAK_HIER_EINSETZEN in der
    // Konfiguration: gesetzt, verschieden vom anderen, und trotzdem kein
    // Zugang. Erst die FORM verriet es.
    konfigSchreiben({ engine: 'soloist', soloistApiKey: 'SPAK_HIER_EINSETZEN' })
    const r = await request(app).get('/api/stroeme').expect(200)
    assert.equal(r.body.stroeme[0].schluesselGesetzt, true)
    assert.equal(r.body.stroeme[0].schluesselForm, false, 'ein Platzhalter muss als falsch gelten')
  })

  it('FALL 2 — behaelt den Zugang, wenn die Oberflaeche ihn nicht mitschickt', async () => {
    konfigSchreiben({ engine: 'soloist', soloistApiKey: SCHLUESSEL_A })
    await request(app)
      .put('/api/stroeme')
      .send({ stroeme: [{ nr: 1, zweck: 'wiedergabe', maschine: 'soloist', schluessel: '', senke: 'lautsprecher' }] })
      .expect(200)
    const k = konfigLesen()
    assert.equal(k.spotify.stroeme[0].schluessel, SCHLUESSEL_A, 'der Zugang ist beim Speichern verlorengegangen')
    assert.equal(k.spotify.stroeme[0].senke, 'lautsprecher', 'die Aenderung kam nicht an')
  })

  it('FALL 2 — nimmt einen neuen Zugang an, wenn einer geschickt wird', async () => {
    await request(app)
      .put('/api/stroeme')
      .send({ stroeme: [{ nr: 1, zweck: 'wiedergabe', maschine: 'soloist', schluessel: SCHLUESSEL_B }] })
      .expect(200)
    assert.equal(konfigLesen().spotify.stroeme[0].schluessel, SCHLUESSEL_B)
  })

  it('FALL 3 — meldet es — und speichert trotzdem', async () => {
    const r = await request(app)
      .put('/api/stroeme')
      .send({
        stroeme: [
          { nr: 1, zweck: 'wiedergabe', maschine: 'soloist', schluessel: SCHLUESSEL_A },
          { nr: 2, zweck: 'mitschnitt', maschine: 'soloist', schluessel: SCHLUESSEL_A },
        ],
      })
      .expect(200)
    assert.ok(r.body.befunde.length > 0, 'derselbe Zugang zweimal muss auffallen')
    assert.ok(
      r.body.befunde.some((b: { schwer: boolean }) => b.schwer),
      'das ist ein schwerer Befund: der zweite nimmt dem ersten die Wiedergabe',
    )
    // GEMELDET, NICHT VERBOTEN — die ausdrueckliche Haltung von `pruefen`.
    assert.equal(konfigLesen().spotify.stroeme.length, 2, 'es haette gespeichert werden muessen')
  })

  it('FALL 3 — weist eine Liste ohne brauchbaren Strom ab', async () => {
    await request(app).put('/api/stroeme').send({ stroeme: [{ nr: 0 }] }).expect(400)
    await request(app).put('/api/stroeme').send({ stroeme: 'keine Liste' }).expect(400)
  })
})
