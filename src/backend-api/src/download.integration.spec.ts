/**
 * EIN LOKALES ALBUM HERUNTERLADEN — `GET /api/werke/:schluessel/download` (E126).
 *
 * DER FALL, DER DIESE ZEUGEN AUSGELOEST HAT (27.09.2026, Handy-App an Box .62):
 * `/api/werke` meldete 28 Werke mit lokaler Quelle, die Download-Route gab
 * fuer 8 davon 409 „nichtLokal". Das waren genau die VERSCHMOLZENEN: deren
 * Schluessel ist der des Spotify-Eintrags, und die Route suchte nur in der
 * unverschmolzenen Liste — dort fand sich unter `spotify:…` allein die
 * Spotify-Haelfte.
 *
 * `zip` WIRD GEFAELSCHT: auf dem Entwicklerrechner ist es nicht installiert,
 * auf der Box schon. Ein Stummel im PATH gibt einen ZIP-Kopf und die Liste
 * der Dateien aus — so sieht der Test auch, AUS WELCHEM ORDNER gepackt wurde.
 */
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { medienSchluessel } from './medien.js'

const LOKAL_NAH = { type: 'library', category: 'music', artist: 'Alin Coen', title: 'Nah' }
const SPOTIFY_NAH = { type: 'spotify', category: 'music', id: 'nah-album-kennung', title: 'Nah', artist: 'Alin Coen' }
const LOKAL_ALLEIN = { type: 'library', category: 'audiobook', artist: 'Team Karacho', title: 'Du schaffst das schon' }
const NUR_SPOTIFY = { type: 'spotify', category: 'music', id: 'nur-spotify', title: 'Irgendwas', artist: 'Jemand' }
const KATALOG = [LOKAL_NAH, SPOTIFY_NAH, LOKAL_ALLEIN, NUR_SPOTIFY]

let app: import('express').Express
let verzeichnis = ''
let altPfad = ''

/** Die Antwort als Rohbytes — supertest wuerde ein ZIP sonst als Text lesen. */
function holen(schluessel: string) {
  return request(app)
    .get(`/api/werke/${encodeURIComponent(schluessel)}/download`)
    .buffer(true)
    .parse((res, fertig) => {
      const teile: Buffer[] = []
      res.on('data', (d: Buffer) => teile.push(d))
      res.on('end', () => fertig(null, Buffer.concat(teile)))
    })
}

describe('Download eines lokalen Albums', () => {
  before(async () => {
    verzeichnis = mkdtempSync(join(tmpdir(), 'mupi-download-'))
    writeFileSync(join(verzeichnis, 'data.json'), JSON.stringify(KATALOG, null, 2))
    writeFileSync(join(verzeichnis, 'active_data.json'), JSON.stringify(KATALOG, null, 2))
    // WIE AUF DER BOX: der Spotify-Eintrag FUEHRT, der lokale haengt dran.
    writeFileSync(
      join(verzeichnis, 'verschmelzung.json'),
      JSON.stringify({
        zuordnungen: [
          { schluessel: medienSchluessel(SPOTIFY_NAH), auch: [medienSchluessel(LOKAL_NAH)], stufe: 'locker' },
        ],
        getrennt: [],
      }),
    )
    const medien = join(verzeichnis, 'media')
    mkdirSync(join(medien, 'music', 'Alin Coen', 'Nah'), { recursive: true })
    writeFileSync(join(medien, 'music', 'Alin Coen', 'Nah', '01 Nah.mp3'), 'ton')
    mkdirSync(join(medien, 'audiobook', 'Team Karacho', 'Du schaffst das schon'), { recursive: true })
    writeFileSync(join(medien, 'audiobook', 'Team Karacho', 'Du schaffst das schon', '01.mp3'), 'ton')

    const bin = join(verzeichnis, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'zip'), '#!/bin/sh\nprintf "PK\\003\\004"\nls -1\n')
    chmodSync(join(bin, 'zip'), 0o755)
    altPfad = process.env.PATH ?? ''
    process.env.PATH = `${bin}:${altPfad}`

    process.env.MUPIBOX_CONFIG_DIR = verzeichnis
    process.env.MUPIBOX_LOCK_DIR = verzeichnis
    process.env.MUPIBOX_MEDIA_DIR = medien
    app = (await import('./server.js')).app
  })

  after(() => {
    process.env.PATH = altPfad
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_LOCK_DIR = undefined
    process.env.MUPIBOX_MEDIA_DIR = undefined
  })

  it('packt ein nur lokales Werk aus SEINEM Ordner', async () => {
    const r = await holen(medienSchluessel(LOKAL_ALLEIN)).expect(200)
    assert.match(String(r.headers['content-disposition']), /Team Karacho - Du schaffst das schon\.zip/)
    const text = (r.body as Buffer).toString('latin1')
    assert.ok(text.startsWith('PK\u0003\u0004'), 'ZIP-Kopf')
    assert.match(text, /01\.mp3/)
  })

  it('liefert auch die VERSCHMOLZENE Kachel, deren Schluessel Spotify gehoert', async () => {
    const r = await holen(medienSchluessel(SPOTIFY_NAH)).expect(200)
    assert.match((r.body as Buffer).toString('latin1'), /01 Nah\.mp3/, 'gepackt aus dem lokalen Ordner')
  })

  it('weist ein Werk ohne Platte weiterhin ab', async () => {
    const r = await request(app).get(`/api/werke/${encodeURIComponent(medienSchluessel(NUR_SPOTIFY))}/download`)
    assert.equal(r.status, 409)
    assert.equal(r.body.error, 'nichtLokal')
  })

  it('kennt ein erfundenes Werk nicht', async () => {
    const r = await request(app).get('/api/werke/lokal%3Agibtsnicht/download')
    assert.equal(r.status, 404)
  })
})
