/**
 * Die Kette des Start-Gedaechtnisses — GEGEN DIE ROUTEN, nicht gegen die
 * Funktionen.
 *
 * WARUM GEGEN DIE ROUTEN: Die lokale Titel-Kennung wurde zweimal an Stellen
 * repariert, die die echte Antwort gar nicht bauen (Commit 7bb64903, „WIRKT
 * NOCH NICHT") — Typen sauber, Zeugen gruen, am Geraet nichts. Nur die Route
 * weiss, wer wirklich antwortet. Dasselbe gilt fuers Gedaechtnis: ob
 * `/api/spielen` wirklich merkt und `/player/local` wirklich liefert,
 * entscheidet sich hier, nicht in laufendes-werk.spec.ts.
 *
 * DER ABSPIELDIENST IST EINE ATTRAPPE auf einem eigenen Port — und sie folgt
 * dem Vertrag (llmwiki `neue-oberflaeche-ohne-box-ansehen`): `/local`
 * antwortet mit einstellbarem JSON, Befehle mit 200. Eine Attrappe, die dem
 * Vertrag nicht folgt, prueft nichts.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { medienSchluessel } from './medien.js'

const ALBUM = {
  id: 'gedaechtnis-lokal',
  title: 'Album im Gedaechtnis',
  artist: 'Pruefung',
  category: 'music',
  type: 'library',
}

let app: import('express').Express
let attrappe: http.Server
/** Was die Attrappe auf `/local` antwortet — je Fall umgestellt. */
let lokalAntwort: Record<string, unknown> = {}
/** Was die Attrappe an Befehlen gesehen hat — der Beweis, DASS gestartet wurde. */
const gesehen: string[] = []

describe('Start-Gedaechtnis ueber die Routen', () => {
  before(async () => {
    const d = mkdtempSync(join(tmpdir(), 'mupi-gedaechtnis-'))
    writeFileSync(join(d, 'active_data.json'), JSON.stringify([ALBUM], null, 2))
    writeFileSync(join(d, 'data.json'), JSON.stringify([ALBUM], null, 2))
    process.env.MUPIBOX_CONFIG_DIR = d

    const medien = mkdtempSync(join(tmpdir(), 'mupi-gedaechtnis-medien-'))
    const ordner = join(medien, ALBUM.category, ALBUM.artist, ALBUM.title)
    mkdirSync(ordner, { recursive: true })
    for (const datei of ['01 Erster Titel.mp3', '02 Zweiter Titel.mp3', '03 Dritter Titel.mp3']) {
      writeFileSync(join(ordner, datei), 'x')
    }
    process.env.MUPIBOX_MEDIA_DIR = medien

    attrappe = http.createServer((req, res) => {
      const pfad = req.url || ''
      gesehen.push(pfad)
      res.setHeader('content-type', 'application/json')
      if (pfad === '/local') {
        res.end(JSON.stringify(lokalAntwort))
        return
      }
      res.end(JSON.stringify({ ok: true }))
    })
    await new Promise<void>((r) => attrappe.listen(0, '127.0.0.1', r))
    // VOR dem Import: der Port wird beim Laden des Moduls gelesen.
    process.env.PLAYER_PROXY_PORT = String((attrappe.address() as AddressInfo).port)

    app = (await import('./server.js')).app
  })

  after(async () => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_MEDIA_DIR = undefined
    process.env.PLAYER_PROXY_PORT = undefined
    await new Promise<void>((r) => attrappe.close(() => r()))
  })

  it('traegt ohne gemerkten Start kein laeuft-Feld — raten ist keine Auskunft', async () => {
    lokalAntwort = { currentPlayer: 'mpv', playing: true, currentTracknr: 1, currentTrackname: 'Irgendwas' }
    const r = await request(app).get('/player/local').expect(200)
    assert.equal(r.body.currentPlayer, 'mpv', 'die Player-Antwort muss durchgereicht werden')
    assert.ok(!('laeuft' in r.body), `kein Start gemerkt, trotzdem laeuft: ${JSON.stringify(r.body.laeuft)}`)
  })

  it('merkt den Start aus /api/spielen und nennt danach Werk UND Titel', async () => {
    const s = medienSchluessel(ALBUM)
    // Die Kennungen, die auch die Kacheln bekommen — aus derselben Route.
    const inhalt = await request(app).get(`/api/werke/${encodeURIComponent(s)}/inhalt?verschmelzen=0`).expect(200)
    const titel = inhalt.body.titel as { nr: number; titel: string; id?: string }[]
    assert.equal(titel.length, 3, `drei Dateien, drei Titel: ${JSON.stringify(inhalt.body)}`)

    lokalAntwort = { currentPlayer: '', playing: false }
    const start = await request(app).post('/api/spielen').send({ schluessel: s }).expect(200)
    assert.equal(start.body.ergebnis, 'ok', JSON.stringify(start.body))
    assert.ok(
      gesehen.some((p) => p.startsWith('/current/datei')),
      `der Abspieldienst muss einen datei-Befehl gesehen haben: ${gesehen.join(' | ')}`,
    )

    // mpv spielt inzwischen Titel 2 der Schlange.
    lokalAntwort = {
      currentPlayer: 'mpv',
      playing: true,
      currentTracknr: 2,
      currentTrackname: titel[1].titel,
    }
    const r = await request(app).get('/player/local').expect(200)
    assert.ok(r.body.laeuft, `nach dem Start muss eine Zuordnung da sein: ${JSON.stringify(r.body)}`)
    assert.equal(r.body.laeuft.werk, s)
    assert.equal(r.body.laeuft.titelNr, 2)
    // DIESELBE Kennung wie die Kachel: beide kommen aus /inhalt.
    assert.equal(r.body.laeuft.titelId, String(titel[1].id))
  })

  it('ueberlebt, was die Seite nicht ueberlebt: die Zuordnung braucht kein zweites /api/spielen', async () => {
    // Das Neuladen des Kiosks ist serverseitig UNSICHTBAR — es gibt schlicht
    // keinen Abruf, den die Seite dabei ausliesse. Der Beweis ist deshalb:
    // ein weiterer /player/local-Abruf (wie ihn die frisch geladene Seite als
    // ersten macht) traegt die Zuordnung immer noch.
    const s = medienSchluessel(ALBUM)
    const r = await request(app).get('/player/local').expect(200)
    assert.equal(r.body.laeuft?.werk, s)
  })

  it('raeumt das Gedaechtnis, wenn ein fremder Startbefehl am Proxy vorbeikommt', async () => {
    const fremd = await request(app).get('/player/current/radio/https%3A%2F%2Ffremd.example%2F1/Fremder Sender')
    assert.ok(fremd.status < 500, `der Proxy muss den Befehl durchreichen: ${fremd.status}`)
    const r = await request(app).get('/player/local').expect(200)
    assert.ok(!('laeuft' in r.body), `fremder Start, trotzdem laeuft: ${JSON.stringify(r.body.laeuft)}`)
  })

  it('blankes play (Fortsetzen nach Pause) raeumt NICHT', async () => {
    // Erst wieder einen eigenen Start merken …
    const s = medienSchluessel(ALBUM)
    lokalAntwort = { currentPlayer: '', playing: false }
    await request(app).post('/api/spielen').send({ schluessel: s }).expect(200)
    // … dann Pause aufheben, wie es die Oberflaeche tut (`spielerBefehl('play')`).
    await request(app).get('/player/current/play')
    lokalAntwort = { currentPlayer: 'mpv', playing: true, currentTracknr: 1, currentTrackname: '' }
    const r = await request(app).get('/player/local').expect(200)
    assert.equal(r.body.laeuft?.werk, s, 'das Fortsetzen darf die Marke nicht kosten')
  })

  it('raeumt das Gedaechtnis beim Stop ueber den Proxy', async () => {
    await request(app).get('/player/current/stop')
    const r = await request(app).get('/player/local').expect(200)
    assert.ok(!('laeuft' in r.body), `nach Stop, trotzdem laeuft: ${JSON.stringify(r.body.laeuft)}`)
  })
})
