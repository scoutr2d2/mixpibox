/**
 * `/api/jellyfin/strom/:kennung` am LAUFENDEN Server — der Tonweg ohne
 * Schluessel in der Adresse (BACKLOG E15/S2).
 *
 * WARUM MIT ECHTEM SERVER UND NICHT NUR MIT DER REINEN LOGIK: Die Regeln
 * stehen in jellyfin-durchreiche.ts und sind dort einzeln geprueft. Was hier
 * dazukommt, ist die NAHT — und in ihr liegen genau die Fehler, die ein
 * Einheitentest nicht sieht:
 *
 *   * Kommt der ZUGANG ueberhaupt an? Er steht serverseitig nirgends in der
 *     Konfiguration, sondern nur in den Coveradressen der Medienliste. Wer die
 *     Naht falsch legt, bekommt einen Weg, der 503 sagt, obwohl alles da ist.
 *   * Geht die BEREICHSANFRAGE hin und die Bereichsantwort zurueck? Fehlt sie,
 *     spielt die Box weiter und kann nur nicht mehr springen — das Fortsetzen
 *     an der gemerkten Stelle waere STILL kaputt.
 *   * Steht der Schluessel wirklich nicht mehr in der Adresse? Das ist der
 *     ganze Zweck, und es ist nur an der Naht zu sehen.
 *
 * DER JELLYFIN-SERVER IST EIN ECHTER (node:http auf 127.0.0.1), kein
 * Attrappenobjekt. Attrappen luegen durch Weglassen: eine, die `X-Emby-Token`
 * gar nicht erst betrachtet, haette den Fall „Zugang vergessen" nie gemeldet.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

const KENNUNG = '7d9a37e2732ca78bc68eacb3232960c0'
const SCHLUESSEL = 'TESTSCHLUESSEL-KEIN-ECHTER'
/** 64 Byte „Ton" — gross genug fuer einen echten Bereichsabruf. */
const TON = Buffer.from(Array.from({ length: 64 }, (_, i) => i))

let app: import('express').Express
let jellyfin: http.Server
/** Was der Jellyfin-Server bei der letzten Anfrage gesehen hat. */
let gesehen: { pfad: string; token: string | undefined; range: string | undefined }

describe('/api/jellyfin/strom — Jellyfin-Ton ueber die Box', () => {
  before(async () => {
    jellyfin = http.createServer((req, res) => {
      gesehen = {
        pfad: req.url ?? '',
        token: req.headers['x-emby-token'] as string | undefined,
        range: req.headers.range as string | undefined,
      }
      // Ohne Zugang antwortet ein echter Jellyfin mit 401. Die Attrappe tut
      // dasselbe — sonst saehe „Zugang vergessen" wie Erfolg aus.
      if (gesehen.token !== SCHLUESSEL) {
        res.writeHead(401).end()
        return
      }
      // Der BILDweg (E15/S1) haengt am selben Zugang und wird deshalb hier mit
      // beantwortet — ein zweiter Attrappenserver waere eine zweite Wahrheit.
      if ((req.url ?? '').includes('/Images/')) {
        res.setHeader('Content-Type', 'image/jpeg')
        res.writeHead(200).end(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
        return
      }
      // Der Verraeter-Kopf: er darf NICHT beim Aufrufer ankommen.
      res.setHeader('X-Powered-By', 'Jellyfin')
      res.setHeader('Set-Cookie', 'sitzung=geheim')
      res.setHeader('Content-Type', 'audio/flac')
      res.setHeader('Accept-Ranges', 'bytes')
      const bereich = /bytes=(\d+)-(\d*)/.exec(gesehen.range ?? '')
      if (bereich) {
        const ab = Number(bereich[1])
        const bis = bereich[2] ? Number(bereich[2]) : TON.length - 1
        const teil = TON.subarray(ab, bis + 1)
        res.setHeader('Content-Range', `bytes ${ab}-${bis}/${TON.length}`)
        res.setHeader('Content-Length', String(teil.length))
        res.writeHead(206).end(teil)
        return
      }
      res.setHeader('Content-Length', String(TON.length))
      res.writeHead(200).end(TON)
    })
    await new Promise<void>((fertig) => jellyfin.listen(0, '127.0.0.1', fertig))
    const port = (jellyfin.address() as { port: number }).port
    const server = `http://127.0.0.1:${port}`

    // Die Medienliste ist die EINZIGE Stelle, an der der Zugang serverseitig
    // steht — er steckt in der Coveradresse (jellyfinZugangAusListe).
    const eintraege = [
      {
        type: 'jellyfin-album',
        category: 'music',
        id: KENNUNG,
        title: 'HAMM',
        artist: 'Kapelle Petra',
        cover: `${server}/Items/${KENNUNG}/Images/Primary?api_key=${SCHLUESSEL}`,
      },
    ]
    const d = mkdtempSync(join(tmpdir(), 'mupi-jfstrom-'))
    writeFileSync(join(d, 'active_data.json'), JSON.stringify(eintraege, null, 2))
    writeFileSync(join(d, 'data.json'), JSON.stringify(eintraege, null, 2))
    process.env.MUPIBOX_CONFIG_DIR = d
    app = (await import('./server.js')).app
  })

  after(async () => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    await new Promise<void>((fertig) => jellyfin.close(() => fertig()))
  })

  it('liefert den Ton — und fragt Jellyfin OHNE Schluessel in der Adresse', async () => {
    const antwort = await request(app).get(`/api/jellyfin/strom/${KENNUNG}`).expect(200)
    assert.equal(antwort.headers['content-type'], 'audio/flac')
    assert.equal(Buffer.compare(antwort.body as Buffer, TON), 0)
    // DER ZWECK DER GANZEN UEBUNG: kein api_key mehr im Weg.
    assert.equal(gesehen.pfad.includes('api_key'), false)
    assert.ok(gesehen.pfad.includes('static=true'), 'DIRECT PLAY, sonst meldet mpv eine falsche Laenge')
    assert.equal(gesehen.token, SCHLUESSEL, 'der Zugang geht als Kopfzeile mit')
  })

  it('reicht den Bereichsabruf durch — sonst kann mpv nicht springen', async () => {
    const antwort = await request(app)
      .get(`/api/jellyfin/strom/${KENNUNG}`)
      .set('Range', 'bytes=8-15')
      .expect(206)
    assert.equal(gesehen.range, 'bytes=8-15')
    assert.equal(antwort.headers['content-range'], `bytes 8-15/${TON.length}`)
    assert.equal(Buffer.compare(antwort.body as Buffer, TON.subarray(8, 16)), 0)
  })

  it('gibt weiter, was mpv braucht — und behaelt fuer sich, wer der Server ist', async () => {
    const antwort = await request(app).get(`/api/jellyfin/strom/${KENNUNG}`).expect(200)
    assert.equal(antwort.headers['accept-ranges'], 'bytes')
    assert.equal(antwort.headers['content-length'], String(TON.length))
    // NICHT `undefined` geprueft, sondern „nicht Jellyfins Wert": diese
    // Kopfzeile setzt Express selbst („Express"). Waere hier undefined
    // erwartet, pruefte der Test eine Eigenheit von Express statt der
    // Durchreiche — und schlueg fehl, ohne dass etwas leckt.
    assert.notEqual(antwort.headers['x-powered-by'], 'Jellyfin')
    assert.equal(antwort.headers['set-cookie'], undefined)
    // Ein Vermittler, der Tonbroecken behaelt, macht aus jedem Sprung eine
    // falsche Antwort.
    assert.equal(antwort.headers['cache-control'], 'no-store')
  })

  it('weist alles ab, was keine Jellyfin-Kennung ist — der Weg traegt den Schluessel der Box', async () => {
    await request(app).get('/api/jellyfin/strom/kurz').expect(400)
    await request(app).get(`/api/jellyfin/strom/${encodeURIComponent('../../System/Configuration')}`).expect(400)
    await request(app).get(`/api/jellyfin/strom/${KENNUNG}0`).expect(400)
  })

  it('liefert das Cover ueber die Kennung — ohne Schluessel in der Adresse (E15/S1)', async () => {
    const antwort = await request(app).get(`/api/bild/jellyfin/${KENNUNG}`).expect(200)
    assert.equal(antwort.headers['content-type'], 'image/jpeg')
    assert.equal(gesehen.pfad.includes('api_key'), false)
    assert.equal(gesehen.token, SCHLUESSEL)
    // Nur echte Bilder — sonst laege fremdes HTML unter der EIGENEN Herkunft
    // der Box, genau die Luecke, die eine Anmeldung verhindern soll.
    assert.equal(antwort.headers['x-content-type-options'], 'nosniff')
  })

  it('verwechselt den Bildweg nicht mit dem Werkschluessel-Weg', async () => {
    // `/api/bild/:schluessel` ist EIN Pfadstueck; `/api/bild/jellyfin/<k>` sind
    // zwei. Faellt die Reihenfolge der Wege um, landet die Kennung als
    // Werkschluessel und beantwortet jede Kachel mit 404.
    await request(app).get('/api/bild/jellyfin/kurz').expect(404)
  })

  it('meldet 502, wenn Jellyfin schweigt — und nicht 200 mit Stille', async () => {
    // Die Kennung ist gueltig, aber der Server ist zu. So sieht es aus, wenn
    // der Jellyfin-Rechner aus ist; ein 200 mit leerem Koerper waere ein Titel,
    // der „spielt" und nichts sagt.
    await new Promise<void>((fertig) => jellyfin.close(() => fertig()))
    await request(app).get(`/api/jellyfin/strom/${KENNUNG}`).expect(502)
    await new Promise<void>((fertig) => jellyfin.listen(0, '127.0.0.1', fertig))
  })
})
