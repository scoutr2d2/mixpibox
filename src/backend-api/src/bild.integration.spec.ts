/**
 * Der Bildweg am LAUFENDEN Server — und vor allem die eine Unterscheidung,
 * die man sonst nicht sieht.
 *
 * WORUM ES GEHT: `/api/bild/:schluessel` antwortet in zwei Faellen verschieden,
 * und beide sehen im Browser zunaechst gleich aus („kein Cover"):
 *
 *   * NIE EINES HINTERLEGT  -> 404. Die Kachel zeigt dann ihren eigenen
 *     Rueckfall, den eingefaerbten Kasten mit dem Anfangsbuchstaben. Der
 *     unterscheidet die Kacheln voneinander.
 *   * HINTERLEGT, KAM NICHT -> 302 auf das Maskottchen. Hier ist wirklich
 *     etwas schiefgegangen.
 *
 * WARUM DAS EINEN TEST BRAUCHT: Der Unterschied ist eine Zahl (404 gegen 302).
 * Faellt er zurueck — etwa weil jemand beide Zweige wieder auf dieselbe
 * Funktion legt —, sieht die Oberflaeche NICHT kaputt aus. Sie zeigt nur
 * ueberall dasselbe Maskottchen und verdeckt die Buchstaben. Genau so war es
 * vorher, und es ist niemandem aufgefallen.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { medienSchluessel } from './medien.js'

// EINE Datenadresse mit falschem Typ ist der einzige Weg, „hinterlegt, kam
// nicht" OHNE Netz auszuloesen: Der Server prueft den Typ und lehnt alles ab,
// was kein Bild ist (sonst laege fremdes HTML unter der eigenen Herkunft der
// Box). Ein http-Ziel taete es auch, haenge den Test aber an eine Zeitgrenze.
const KEIN_BILDTYP = 'data:text/html,<b>kein Bild</b>'

const EINTRAEGE = [
  { id: 'test-ohne-cover', title: 'Ohne Cover', artist: 'Pruefung', type: 'library' },
  { id: 'test-mit-kaputt', title: 'Kaputtes Cover', artist: 'Pruefung', type: 'library', cover: KEIN_BILDTYP },
  // Der Fall, der erst AM GERAET auffiel: spotify.service.ts traegt bei
  // Eintraegen ohne Bild den alten Platzhalter als Cover ein.
  {
    id: 'test-platzhalter',
    title: 'Platzhalter als Cover',
    artist: 'Pruefung',
    type: 'library',
    cover: '../assets/images/nocover_mupi.png',
  },
]

let app: import('express').Express

describe('Bildweg: nie eines hinterlegt gegen kam nicht an', () => {
  before(async () => {
    // EIGENES Verzeichnis statt ./config: Das mitgelieferte
    // active_data.json gehoert root (und auf der Box dem Dienst). Ein Test,
    // der daran ruehrt, ueberschreibt den Arbeitsstand von jemandem - und
    // scheitert hier schlicht an den Rechten.
    const d = mkdtempSync(join(tmpdir(), 'mupi-bild-'))
    writeFileSync(join(d, 'active_data.json'), JSON.stringify(EINTRAEGE, null, 2))
    writeFileSync(join(d, 'data.json'), JSON.stringify(EINTRAEGE, null, 2))
    process.env.MUPIBOX_CONFIG_DIR = d
    app = (await import('./server.js')).app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
  })

  it('schickt 404, wenn zum Werk nie ein Cover hinterlegt war', async () => {
    const s = medienSchluessel(EINTRAEGE[0])
    await request(app).get(`/api/bild/${encodeURIComponent(s)}`).expect(404)
  })

  it('behandelt den alten Platzhalter wie GAR KEIN Cover', async () => {
    // Sonst bekaeme die Kachel statt ihres Anfangsbuchstabens wieder
    // nocover_mupi.png zu sehen - und der ganze Unterschied waere fuer
    // genau die Eintraege wirkungslos, bei denen er zaehlt.
    const s = medienSchluessel(EINTRAEGE[2])
    await request(app).get(`/api/bild/${encodeURIComponent(s)}`).expect(404)
  })

  it('schickt 404 fuer einen Schluessel, den es gar nicht gibt', async () => {
    await request(app).get(`/api/bild/${encodeURIComponent('spotify:gibtesnicht')}`).expect(404)
  })

  it('lenkt auf das Maskottchen um, wenn ein Cover hinterlegt ist, aber nicht taugt', async () => {
    const s = medienSchluessel(EINTRAEGE[1])
    const r = await request(app).get(`/api/bild/${encodeURIComponent(s)}`).expect(302)
    assert.equal(r.headers.location, '/neu/bilder/mixpi-kein-bild.png')
  })

  it('laesst das Ersatzbild NICHT zwischenspeichern', async () => {
    // Sonst verdeckte es ein spaeter nachgetragenes Cover einen ganzen Tag -
    // die lange Speicherfrist gilt nur fuer echte Cover.
    const s = medienSchluessel(EINTRAEGE[1])
    const r = await request(app).get(`/api/bild/${encodeURIComponent(s)}`).expect(302)
    assert.match(String(r.headers['cache-control']), /no-store/)
  })

  it('weist eine Datenadresse ab, die gar kein Bild ist', async () => {
    // Dieselbe Antwort wie oben, aber aus anderem Grund geprueft: Eine
    // text/html-Datenadresse duerfte NIE als Inhalt durchgereicht werden -
    // das waere fremdes HTML unter der eigenen Herkunft der Box.
    const s = medienSchluessel(EINTRAEGE[1])
    const r = await request(app).get(`/api/bild/${encodeURIComponent(s)}`)
    assert.notEqual(r.status, 200, 'darf den Inhalt nicht ausliefern')
    assert.ok(!String(r.headers['content-type'] ?? '').includes('text/html'))
  })
})
