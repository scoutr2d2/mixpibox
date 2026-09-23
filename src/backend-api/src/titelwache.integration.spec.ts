/**
 * DIE WACHE GEGEN ADRESSEN IM TITEL — IST SIE AUCH ANGESCHLOSSEN?
 *
 * ══ WOZU EINE ZWEITE PRUEFUNG, wo medien.spec.ts die Regel schon prueft ════
 * Weil das ZWEI verschiedene Fragen sind, und die zweite hier schon einmal
 * teuer war: `titelOhneAdresse` kann richtig rechnen und trotzdem auf keinem
 * Weg liegen, der wirklich schreibt. Genau das ist am 04.08.2026 an anderer
 * Stelle passiert („kopiert ist nicht aufgerufen", Commit 425dc317) — die
 * Funktion war da, geprueft, und wurde von niemandem gerufen.
 *
 * DIE ROUTEN, UM DIE ES GEHT, gehen an `neuerEintrag`/`aenderungAnwenden`
 * VORBEI. Sie legen den Rumpf der Anfrage unveraendert ab:
 *
 *     /api/add    data.push(req.body)
 *     /api/edit   data.splice(i, 1, req.body.data)
 *
 * Das ist der aelteste Schreibweg der Box (die klassische Verwaltung, PHP und
 * Angular) und der einzige, der zu der Zeile passt, die am 04.08.2026 auf der
 * Box .169 in data.json stand:
 *
 *     "EMMA6 - Completehttp://192.168.178.169:8200/assets/images/nocover_mupi.png"
 *
 * DIE URSACHE IST NACH WIE VOR NICHT BELEGT. Im Quelltext steht fuer dieses
 * Bild ueberall der RELATIVE Pfad und nirgends eine absolute Adresse mit der
 * IP der Box; es gibt keine Stelle, auf die man zeigen koennte. Deshalb keine
 * Ursachenreparatur, sondern eine Wache am Weg IN die Datei — und deshalb
 * prueft diese Datei genau das: dass die Wache auf dem Weg liegt.
 *
 * NACHGELESEN WIRD AUF DER PLATTE, nicht in der Antwort. Beide Routen
 * antworten mit `ok`, ganz gleich was sie geschrieben haben (llmwiki
 * server-antwortet-200-auf-alles) — die Antwort ist hier keine Auskunft.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

/** Der echte Wert von der Box .169, Zeichen fuer Zeichen. */
const DRECK = 'EMMA6 - Completehttp://192.168.178.169:8200/assets/images/nocover_mupi.png'
const SAUBER = 'EMMA6 - Complete'

/** Ein Titel, an dem die Wache NICHTS zu suchen hat. */
const HEIL = 'Die drei ??? und der Karpatenhund'

let app: import('express').Express
let verzeichnis = ''
let datenDatei = ''

function bibliothek(): Array<{ title?: string; artist?: string; extra?: number }> {
  return JSON.parse(readFileSync(datenDatei, 'utf8'))
}

describe('Die Wache gegen Adressen im Titel liegt auf dem alten Schreibweg', () => {
  before(async () => {
    verzeichnis = mkdtempSync(join(tmpdir(), 'mupi-titelwache-'))
    datenDatei = join(verzeichnis, 'data.json')
    writeFileSync(datenDatei, '[]')
    writeFileSync(join(verzeichnis, 'active_data.json'), '[]')
    writeFileSync(join(verzeichnis, 'resume.json'), '[]')
    process.env.MUPIBOX_CONFIG_DIR = verzeichnis
    // EIGENE SPERRDATEI JE LAUF: `node --test` startet die Spec-Dateien
    // parallel, und /api/add legt eine Sperre neben data.json. An der
    // gemeinsamen /tmp-Sperre haetten sich zwei Laeufe gegenseitig stumm
    // abgewiesen — und ein stumm abgewiesener Schreibversuch sieht in diesem
    // Test genauso aus wie eine Wache, die nichts findet.
    process.env.MUPIBOX_LOCK_DIR = verzeichnis
    app = (await import('./server.js')).app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_LOCK_DIR = undefined
  })

  it('/api/add schreibt den Titel OHNE die angeklebte Adresse', async () => {
    const r = await request(app)
      .post('/api/add')
      .send({ type: 'spotify', id: 'wache-1', title: DRECK, artist: 'EMMA6', category: 'music' })
    assert.equal(r.status, 200)
    const zeile = bibliothek().find((e) => (e as { id?: string }).id === 'wache-1')
    assert.ok(zeile, `nichts geschrieben: ${readFileSync(datenDatei, 'utf8')}`)
    assert.equal(zeile?.title, SAUBER)
  })

  it('/api/add laesst alles ANDERE unveraendert durch', async () => {
    // Diese Route darf weiterhin schreiben, was ein Formular schickt. Waere
    // hier ploetzlich ein Feld weg, waere die Wache schlimmer als der Fehler,
    // den sie verhindert — die klassische Verwaltung schickt Felder, die die
    // neue gar nicht kennt.
    await request(app)
      .post('/api/add')
      .send({ type: 'spotify', id: 'wache-2', title: HEIL, artist: 'Europa', category: 'audiobook', extra: 42 })
      .expect(200)
    const zeile = bibliothek().find((e) => (e as { id?: string }).id === 'wache-2')
    assert.equal(zeile?.title, HEIL, 'ein heiler Titel darf nicht angefasst werden')
    assert.equal(zeile?.artist, 'Europa')
    assert.equal(zeile?.extra, 42, 'ein unbekanntes Feld darf nicht verschwinden')
  })

  it('/api/edit putzt beim Aendern genauso', async () => {
    const vorher = bibliothek()
    const i = vorher.findIndex((e) => (e as { id?: string }).id === 'wache-2')
    assert.ok(i >= 0, 'der Eintrag aus dem vorigen Fall fehlt')
    await request(app)
      .post('/api/edit')
      .send({ index: i, data: { type: 'spotify', id: 'wache-2', title: DRECK, artist: 'Europa' } })
      .expect(200)
    assert.equal(bibliothek()[i].title, SAUBER)
  })

  it('MACHT EINEN TITEL NIE LEER — auch wenn nur eine Adresse dasteht', async () => {
    // Eine Kachel ohne Beschriftung ist auf der Box nicht wiederzufinden. Der
    // Eintrag ist dann eine Merkwuerdigkeit — aber eine sichtbare, und das ist
    // besser als eine unsichtbare.
    const nur = 'http://192.168.178.169:8200/assets/images/nocover_mupi.png'
    await request(app).post('/api/add').send({ type: 'spotify', id: 'wache-3', title: nur }).expect(200)
    const zeile = bibliothek().find((e) => (e as { id?: string }).id === 'wache-3')
    assert.equal(zeile?.title, nur)
  })
})
