/**
 * Anmeldung am LAUFENDEN Server geprüft (nicht nur die Bausteine).
 *
 * Wichtig zu wissen: supertest verbindet sich über die Rückschleife, und die
 * lässt das Tor ABSICHTLICH durch — der Kiosk auf der Box darf nie nach einem
 * Passwort gefragt werden. Hier wird deshalb geprüft, was auch über die
 * Rückschleife sichtbar ist: die Anmeldewege selbst und der gemeldete Zustand.
 * Das Abweisen von außen deckt auth.spec.ts ab.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import bcrypt from 'bcryptjs'
import request from 'supertest'

const PASSWORT = 'geheim-fuer-den-test'
let app: import('express').Express

function konfigSchreiben(state: boolean, hash: string): string {
  const d = mkdtempSync(join(tmpdir(), 'mupi-auth-'))
  const p = join(d, 'mupiboxconfig.json')
  writeFileSync(p, JSON.stringify({ interfacelogin: { state, password: hash } }, null, 2))
  return p
}

/**
 * Eine winzige Attrappe der Verwaltungshuelle.
 *
 * Absichtlich NICHT der echte Angular-Bau: geprueft wird hier das Routing des
 * Servers (Huelle vor dem Tor, Rueckfall fuer Unterwege), nicht das Bundle.
 * Zeigte der Test auf den Bauordner, schluege er in einem frischen Abzug fehl,
 * solange niemand vorher gebaut hat — und wuerde damit etwas melden, das gar
 * nicht kaputt ist.
 */
function huelleSchreiben(): string {
  const d = mkdtempSync(join(tmpdir(), 'mupi-admin-huelle-'))
  writeFileSync(join(d, 'index.html'), '<!doctype html><body><mupi-app></mupi-app></body>')
  return d
}

describe('Anmeldung am Server', () => {
  before(async () => {
    // PHP schreibt $2y$ — genau diese Form soll die Box hergeben.
    const hash = bcrypt.hashSync(PASSWORT, 10).replace(/^\$2[ab]\$/, '$2y$')
    process.env.MUPIBOX_CONFIG = konfigSchreiben(true, hash)
    process.env.MUPIBOX_ADMIN_DIR = huelleSchreiben()
    app = (await import('./server.js')).app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG = undefined
  })

  it('meldet, dass eine Anmeldung nötig ist', async () => {
    const r = await request(app).get('/api/auth/state').expect(200)
    assert.equal(r.body.anmeldungNoetig, true)
    assert.equal(r.body.passwortGesetzt, true)
  })

  it('weist ein falsches Passwort ab', async () => {
    const r = await request(app).post('/api/auth/login').send({ password: 'daneben' }).expect(401)
    assert.equal(r.body.ok, false)
    assert.equal(r.headers['set-cookie'], undefined, 'kein Cookie bei Fehlschlag')
  })

  it('weist eine leere Eingabe ab', async () => {
    await request(app).post('/api/auth/login').send({}).expect(401)
    await request(app).post('/api/auth/login').send({ password: '' }).expect(401)
  })

  it('nimmt das richtige Passwort an und setzt ein geschütztes Cookie', async () => {
    const r = await request(app).post('/api/auth/login').send({ password: PASSWORT }).expect(200)
    assert.equal(r.body.angemeldet, true)
    const c = String(r.headers['set-cookie'] ?? '')
    assert.match(c, /mupi_admin=/)
    assert.match(c, /HttpOnly/)
    assert.match(c, /SameSite=Strict/)
  })

  it('meldet nach dem Abmelden ein löschendes Cookie', async () => {
    const an = await request(app).post('/api/auth/login').send({ password: PASSWORT }).expect(200)
    const cookie = String(an.headers['set-cookie']?.[0] ?? '').split(';')[0]
    const ab = await request(app).post('/api/auth/logout').set('Cookie', cookie).expect(200)
    assert.match(String(ab.headers['set-cookie']), /Max-Age=0/)
  })

  it('lässt die Box selbst (Rückschleife) ohne Anmeldung an die API', async () => {
    // Der Kiosk laeuft auf der Box. Verlangte man dort ein Passwort, bliebe
    // sein Bildschirm nach dem Einschalten leer.
    //
    // Geprueft wird NICHT AB­GEWIESEN (kein 401) — nicht "antwortet mit 200":
    // ob ein Endpunkt seine Daten findet, ist eine andere Frage als die, ob
    // das Tor ihn durchlaesst. In der Testumgebung fehlen die Datendateien.
    for (const weg of ['/api/network', '/api/data', '/api/monitor']) {
      const r = await request(app).get(weg)
      assert.notEqual(r.status, 401, `${weg} wurde abgewiesen`)
    }
  })
})

describe('Die Verwaltungsoberflaeche unter /admin', () => {
  it('ist OHNE Anmeldung erreichbar — sonst koennte man sich nie anmelden', async () => {
    // Der Kernpunkt: laege die Huelle hinter dem Tor, antwortete die
    // Anmeldeseite selbst mit 401. Man kaeme nur herein, wenn man schon
    // drin waere.
    const a = await request(app).get('/admin/')
    assert.equal(a.status, 200)
    assert.match(a.text, /<mupi-app>/)
  })

  it('liefert dieselbe Seite fuer Unterwege aus (Neuladen bricht nicht)', async () => {
    const a = await request(app).get('/admin/irgendwas')
    assert.equal(a.status, 200)
    assert.match(a.text, /<mupi-app>/)
  })

  // Hier stand einmal eine Pruefung "und /api/data bleibt 401". Sie war
  // FALSCH, und zwar aus dem Grund, der oben im Dateikopf steht: supertest
  // ruft ueber die Rueckschleife an, und die laesst das Tor absichtlich durch
  // — sonst bliebe der Bildschirm der Box nach dem Einschalten leer. Die
  // Antwort war folgerichtig 200. Dass die Daten von AUSSEN verschlossen
  // bleiben, prueft auth.spec.ts ("schuetzt die gefaehrlichen Wege von
  // aussen"), wo die Adresse frei setzbar ist.
})
