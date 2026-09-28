/**
 * BOX-SPERRE AM LAUFENDEN SERVER (28.09.2026) — nicht nur die Regel.
 *
 * Geprueft wird, was ein Kind an der Box erlebt: waehrend der Sperre weist
 * JEDER Startweg ab (Proxy, `POST /api/spielen`), Anhalten geht weiter durch,
 * der Stand der Kinderzeit nennt den Grund — auch wenn die Kinderzeit selbst
 * aus ist. Und die Sperre steht in einer Datei, damit ein Neustart sie nicht
 * aufhebt.
 *
 * DAS TOR SIEHT DIESER TEST NICHT: supertest kommt ueber die Rueckschleife,
 * und die laesst das Tor durch (auth.integration.spec.ts). Dass das LESEN vor
 * dem Tor und das SETZEN dahinter steht, prueft der letzte Fall an der
 * Reihenfolge in der Quelle — Express entscheidet nach Reihenfolge, nicht
 * nach Absicht (llmwiki zum Wartungsmodus, server.ts).
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

let app: import('express').Express
let ordner: string

describe('Box-Sperre am Server', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mixpi-boxsperre-'))
    writeFileSync(join(ordner, 'active_data.json'), '[]')
    writeFileSync(join(ordner, 'data.json'), '[]')
    // EINE KAPUTTE DATEI VOM LETZTEN LAUF: sie darf die Box beim Start NICHT
    // sperren (eine Grenze darf nicht aussperren).
    writeFileSync(join(ordner, 'mixpi-boxsperre.json'), '{ "bis": "irgendwann"')
    process.env.MUPIBOX_CONFIG_DIR = ordner
    app = (await import('./server.js')).app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
  })

  it('eine kaputte Datei sperrt beim Start nicht', async () => {
    const r = await request(app).get('/api/boxsperre').expect(200)
    assert.equal(r.body.aktiv, false)
  })

  it('ohne Dauer: 400 mit einem Satz, und nichts ist gesperrt', async () => {
    const r = await request(app).post('/api/boxsperre').send({}).expect(400)
    assert.match(r.body.satz, /wie lange/)
    assert.equal((await request(app).get('/api/boxsperre')).body.aktiv, false)
  })

  it('sperren: der Stand nennt das Ende, und es steht in der Datei', async () => {
    const r = await request(app).post('/api/boxsperre').send({ minuten: 30 }).expect(200)
    assert.equal(r.body.aktiv, true)
    assert.match(r.body.bisZeit, /^\d\d:\d\d$/)
    assert.ok(r.body.restMin >= 29 && r.body.restMin <= 30)
    const datei = JSON.parse(readFileSync(join(ordner, 'mixpi-boxsperre.json'), 'utf8'))
    assert.equal(datei.bis, r.body.bis, 'ein Neustart liest dieselbe Sperre wieder')
  })

  it('die Kinderzeit sagt „gesperrt" — obwohl sie selbst aus ist', async () => {
    const r = await request(app).get('/api/kinderzeit/stand').expect(200)
    assert.equal(r.body.aktiv, false, 'Kinderzeit ist in diesem Lauf nie eingeschaltet worden')
    assert.equal(r.body.erlaubt, false)
    assert.equal(r.body.grund, 'gesperrt')
    assert.match(r.body.gesperrtBis, /^\d\d:\d\d$/)
  })

  it('jeder Startweg weist ab: der Proxy …', async () => {
    const r = await request(app).get('/player/current/play').expect(403)
    assert.equal(r.body.kinderzeit, true)
    assert.equal(r.body.grund, 'gesperrt')
  })

  it('… und POST /api/spielen', async () => {
    const r = await request(app).post('/api/spielen').send({ schluessel: 'gibt-es-nicht' })
    // Der Schluessel ist erfunden — kaeme die Sperre nicht zuerst, stuende
    // hier 404. 403 mit Grund heisst: die Sperre hat gefragt, bevor gesucht
    // wurde.
    assert.equal(r.status, 403, JSON.stringify(r.body))
    assert.equal(r.body.grund, 'gesperrt')
  })

  it('ANHALTEN geht weiter durch — eine Sperre, die das Ausschalten verhindert, waere schlimmer als keine', async () => {
    const r = await request(app).get('/player/current/stop')
    // Einen Abspieldienst gibt es im Test nicht (502) — entscheidend ist,
    // dass die Sperre den Befehl NICHT abgefangen hat.
    assert.notEqual(r.status, 403)
  })

  it('aufheben: nicht mehr gesperrt, Datei weg, Starten wieder erlaubt', async () => {
    const r = await request(app).delete('/api/boxsperre').expect(200)
    assert.equal(r.body.aktiv, false)
    assert.equal(existsSync(join(ordner, 'mixpi-boxsperre.json')), false)
    const st = await request(app).get('/api/kinderzeit/stand').expect(200)
    assert.equal(st.body.erlaubt, true)
    assert.notEqual(st.body.grund, 'gesperrt')
  })

  it('Lesen steht VOR dem Tor, Setzen und Aufheben DAHINTER', () => {
    const quelle = readFileSync(new URL('./server.ts', import.meta.url), 'utf8')
    const tor = quelle.indexOf('app.use(torBauen(')
    const lesen = quelle.indexOf("app.get('/api/boxsperre'")
    const setzen = quelle.indexOf("app.post('/api/boxsperre'")
    const aufheben = quelle.indexOf("app.delete('/api/boxsperre'")
    assert.ok(tor > 0 && lesen > 0 && setzen > 0 && aufheben > 0, 'alle vier Stellen muessen sich finden lassen')
    assert.ok(lesen < tor, 'der Kiosk muss den Pausen-Schirm auch bei eingeschalteter Anmeldung erfahren')
    assert.ok(setzen > tor, 'sonst sperrt jeder im WLAN die Box ohne Passwort')
    assert.ok(aufheben > tor, 'sonst hebt jedes Kind mit einem Tablet die Sperre auf')
  })
})
