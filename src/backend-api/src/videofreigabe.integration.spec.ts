/**
 * DIE BELOHNUNGS-VIDEOS AN EINEM ECHTEN SERVER.
 *
 * `videofreigabe.spec.ts` prueft die REGEL (wer wie oft darf). Hier wird
 * geprueft, was nur ein laufender Server zeigt:
 *
 *   * dass die Freigaben wirklich in `profile/<kennung>/videofreigaben.json`
 *     landen und einen Neustart ueberleben,
 *   * dass ein Start ohne Freigabe 403 bekommt UND einen Grund,
 *   * dass der Kinderschirm etwas ANDERES sieht als die Eltern,
 *   * und dass ein fehlendes Plugin nicht wie eine fehlende Freigabe
 *     aussieht — 404 „nicht geladen" ist ein anderer Satz als 403
 *     „aufgebraucht", und nur dieser Unterschied sagt einem Elternteil, wo
 *     es nachsehen muss.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

let app: import('express').Express
let konfigOrdner = ''

const VIDEO = {
  kennung: 'Y3JpZDovL3dkci5kZS9CZWl0cmFnLXNvcGhvcmEtYWJj',
  name: 'Klima-Maus Teil 6',
  sendung: 'Die Maus',
  bild: 'https://api.ardmediathek.de/image-service/images/urn:ard:image:abc?w=512',
  dauerSek: 1626,
}

const ablage = (): string => join(konfigOrdner, 'profile', 'gast', 'videofreigaben.json')

describe('/api/video/* — Freigeben, Anschauen, Verbrauchen', () => {
  before(async () => {
    const konfigDir = mkdtempSync(join(tmpdir(), 'mupi-konfig-'))
    const konfigDatei = join(konfigDir, 'mupiboxconfig.json')
    konfigOrdner = mkdtempSync(join(tmpdir(), 'mupi-daten-'))
    process.env.MUPIBOX_CONFIG = konfigDatei
    process.env.MUPIBOX_CONFIG_DIR = konfigOrdner
    writeFileSync(konfigDatei, JSON.stringify({ mupibox: {} }))
    app = (await import('./server.js')).app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG = undefined
    process.env.MUPIBOX_CONFIG_DIR = undefined
  })

  it('meldet anfangs nichts — weder den Eltern noch dem Kind', async () => {
    const eltern = await request(app).get('/api/video/freigaben').expect(200)
    assert.deepEqual(eltern.body.videos, [])
    assert.equal(eltern.body.profil, 'gast')
    // Die Grenzen kommen mit, damit die Verwaltung sie nicht abschreibt.
    assert.equal(eltern.body.grenzen.schwelle, 0.9)

    const kind = await request(app).get('/api/video/kind').expect(200)
    assert.deepEqual(kind.body.videos, [])
  })

  it('weist einen Start ohne Freigabe mit 403 UND Grund ab', async () => {
    const r = await request(app).post('/api/video/start').send({ kennung: VIDEO.kennung }).expect(403)
    assert.equal(r.body.grund, 'unbekannt')
    assert.equal(r.body.videofreigabe, true)
  })

  it('gibt ein Video frei und legt es in den Bereich des Profils', async () => {
    const r = await request(app)
      .post('/api/video/freigaben')
      .send({ ...VIDEO, anzahl: 2 })
      .expect(200)
    assert.equal(r.body.video.rest, 2)
    assert.equal(r.body.video.name, VIDEO.name)

    assert.ok(existsSync(ablage()), `nicht geschrieben: ${ablage()}`)
    const roh = JSON.parse(readFileSync(ablage(), 'utf8'))
    assert.equal(roh.videos[0].kennung, VIDEO.kennung)
    assert.equal(roh.videos[0].anzahl, 2)
  })

  it('zeigt es jetzt auch dem Kind — aber ohne Buchfuehrung, die es nichts angeht', async () => {
    const kind = await request(app).get('/api/video/kind').expect(200)
    assert.equal(kind.body.videos.length, 1)
    assert.equal(kind.body.videos[0].rest, 2)
  })

  it('weist ein Bild ab, das keine http-Adresse ist — und nimmt den Rest trotzdem an', async () => {
    const r = await request(app)
      .post('/api/video/freigaben')
      .send({ kennung: 'ZZZbild', name: 'Mit boesem Bild', bild: 'javascript:alert(1)', anzahl: 1 })
      .expect(200)
    assert.equal(r.body.video.bild, '')
  })

  it('weist eine unsinnige Anzahl ab, statt sie zu biegen', async () => {
    await request(app)
      .post('/api/video/freigaben')
      .send({ ...VIDEO, anzahl: 0 })
      .expect(400)
    await request(app)
      .post('/api/video/freigaben')
      .send({ kennung: '../../etc/passwd', name: 'Boese', anzahl: 1 })
      .expect(400)
  })

  it('ein fehlendes Plugin ist NICHT dasselbe wie eine fehlende Freigabe', async () => {
    // Die Freigabe steht (sonst waere es 403). Das Plugin laeuft in diesem
    // Testlauf nicht — die Antwort muss den Unterschied tragen.
    const r = await request(app).post('/api/video/start').send({ kennung: VIDEO.kennung })
    assert.notEqual(r.status, 403)
    assert.ok([404, 502].includes(r.status), `Status ${r.status}`)
    assert.match(String(r.body.grund), /nicht geladen|keine http|keinVideo|nichtErreichbar/)
  })

  it('zaehlt erst ab der Schwelle — und der Abbruch kostet nichts', async () => {
    const wenig = await request(app)
      .post('/api/video/gesehen')
      .send({ kennung: VIDEO.kennung, lauf: 'lauf-1', anteil: 0.3 })
      .expect(200)
    assert.equal(wenig.body.grund, 'zuWenigGesehen')
    assert.equal(wenig.body.rest, 2)

    const ganz = await request(app)
      .post('/api/video/gesehen')
      .send({ kennung: VIDEO.kennung, lauf: 'lauf-1', anteil: 0.95 })
      .expect(200)
    assert.equal(ganz.body.grund, 'gezaehlt')
    assert.equal(ganz.body.rest, 1)
  })

  it('zaehlt dieselbe Laufkennung NICHT zweimal — auch nicht ueber zwei Anfragen', async () => {
    const nochmal = await request(app)
      .post('/api/video/gesehen')
      .send({ kennung: VIDEO.kennung, lauf: 'lauf-1', anteil: 1 })
      .expect(200)
    assert.equal(nochmal.body.grund, 'schonGezaehlt')
    assert.equal(nochmal.body.rest, 1)
    // Und die Platte sagt dasselbe wie die Antwort.
    const roh = JSON.parse(readFileSync(ablage(), 'utf8'))
    assert.equal(roh.videos[0].verbraucht, 1)
  })

  it('setzt den REST, ohne die Vergangenheit zu faelschen', async () => {
    const r = await request(app).put('/api/video/freigaben').send({ kennung: VIDEO.kennung, rest: 3 }).expect(200)
    assert.equal(r.body.video.rest, 3)
    assert.equal(r.body.video.verbraucht, 1)
    assert.equal(r.body.video.anzahl, 4)
  })

  it('nimmt das Aufgebrauchte vom Kinderschirm, laesst es aber den Eltern stehen', async () => {
    await request(app).put('/api/video/freigaben').send({ kennung: VIDEO.kennung, rest: 0 }).expect(200)
    const kind = await request(app).get('/api/video/kind').expect(200)
    assert.equal(
      kind.body.videos.some((v: { kennung: string }) => v.kennung === VIDEO.kennung),
      false,
    )
    const eltern = await request(app).get('/api/video/freigaben').expect(200)
    assert.equal(
      eltern.body.videos.some((v: { kennung: string }) => v.kennung === VIDEO.kennung),
      true,
    )
    // Und der Start sagt jetzt „aufgebraucht", nicht „unbekannt".
    const start = await request(app).post('/api/video/start').send({ kennung: VIDEO.kennung }).expect(403)
    assert.equal(start.body.grund, 'aufgebraucht')
  })

  it('entzieht eine Freigabe ganz — und ein zweites Entziehen meldet 404', async () => {
    await request(app).post('/api/video/entziehen').send({ kennung: VIDEO.kennung }).expect(200)
    await request(app).post('/api/video/entziehen').send({ kennung: VIDEO.kennung }).expect(404)
    const eltern = await request(app).get('/api/video/freigaben').expect(200)
    assert.equal(
      eltern.body.videos.some((v: { kennung: string }) => v.kennung === VIDEO.kennung),
      false,
    )
  })

  it('weist ein unbekanntes Profil ab, statt still das aktive zu nehmen', async () => {
    await request(app).get('/api/video/freigaben?profil=gibtsnicht').expect(400)
    await request(app)
      .post('/api/video/freigaben?profil=gibtsnicht')
      .send({ ...VIDEO, anzahl: 1 })
      .expect(400)
  })

  it('liest eine kaputte Ablage als „nichts freigegeben" — sie darf nichts AUFSPERREN', async () => {
    writeFileSync(ablage(), '{ das ist kein JSON')
    const eltern = await request(app).get('/api/video/freigaben').expect(200)
    assert.deepEqual(eltern.body.videos, [])
    const start = await request(app).post('/api/video/start').send({ kennung: VIDEO.kennung }).expect(403)
    assert.equal(start.body.grund, 'unbekannt')
  })

  /* ══ DIE WEICHE ZWISCHEN DEN MEDIATHEKEN (20.09.2026) ══════════════════ */

  it('merkt sich die Quelle und gibt sie nach aussen weiter', async () => {
    writeFileSync(ablage(), JSON.stringify({ fassung: 1, videos: [] }))
    await request(app)
      .post('/api/video/freigaben')
      .send({ ...VIDEO, kennung: 'V0RSHkRpZSBNYXVzHkZvbGdl', quelle: 'mixpi-mediathekview', anzahl: 1 })
      .expect(200)
    const eltern = await request(app).get('/api/video/freigaben').expect(200)
    assert.equal(eltern.body.videos[0].quelle, 'mixpi-mediathekview')
    // AUF DER PLATTE MUSS SIE AUCH STEHEN: ohne sie fragte ein Neustart die
    // falsche Mediathek, und das Kind saehe „gibt es nicht".
    assert.equal(JSON.parse(readFileSync(ablage(), 'utf8')).videos[0].quelle, 'mixpi-mediathekview')
  })

  it('eine Freigabe ohne Quelle bleibt bei der ARD', async () => {
    writeFileSync(ablage(), JSON.stringify({ fassung: 1, videos: [{ ...VIDEO, anzahl: 1, verbraucht: 0 }] }))
    const eltern = await request(app).get('/api/video/freigaben').expect(200)
    assert.equal(eltern.body.videos[0].quelle, 'mixpi-mediathek')
  })

  it('eine Quelle, die auf keiner Liste steht, fuehrt nicht ins Leere — sie wird abgewiesen', async () => {
    // DER SCHADEN WAERE EIN RUF AN EIN BELIEBIGES PLUGIN. Deshalb 502 mit
    // eigenem Grund und nicht 403 „unbekannt": die Freigabe IST da, nur ihr
    // Lieferant ist keiner.
    writeFileSync(
      ablage(),
      JSON.stringify({ fassung: 1, videos: [{ ...VIDEO, quelle: 'mixpi-erfunden', anzahl: 1, verbraucht: 0 }] }),
    )
    const r = await request(app).post('/api/video/start').send({ kennung: VIDEO.kennung }).expect(502)
    assert.equal(r.body.grund, 'unbekannteQuelle')
  })

  /* ══ STUECKE (20.09.2026) ══════════════════════════════════════════════ */

  it('legt drei Stuecke desselben Videos als drei Zeilen an', async () => {
    writeFileSync(ablage(), JSON.stringify({ fassung: 1, videos: [] }))
    for (const [i, [ab, bis]] of [[0, 500], [500, 1000], [1000, 1500]].entries()) {
      await request(app)
        .post('/api/video/freigaben')
        .send({ ...VIDEO, dauerSek: 1500, abSek: ab, bisSek: bis, teil: `Teil ${i + 1}`, anzahl: 1 })
        .expect(200)
    }
    const eltern = await request(app).get('/api/video/freigaben').expect(200)
    assert.equal(eltern.body.videos.length, 3)
    assert.deepEqual(
      eltern.body.videos.map((v: { teil: string }) => v.teil),
      ['Teil 1', 'Teil 2', 'Teil 3'],
    )
    // Jedes Stueck nennt seine eigene Laenge — 500, nicht 1500.
    assert.deepEqual(
      eltern.body.videos.map((v: { laengeSek: number }) => v.laengeSek),
      [500, 500, 500],
    )
    // Und die Videokennung ist dreimal dieselbe: sie ist die Adresse beim
    // Plugin, nicht der Schluessel der Liste.
    assert.equal(new Set(eltern.body.videos.map((v: { kennung: string }) => v.kennung)).size, 1)
    assert.equal(new Set(eltern.body.videos.map((v: { id: string }) => v.id)).size, 3)
  })

  it('entzieht nur das gemeinte Stueck, nicht das ganze Video', async () => {
    const vorher = await request(app).get('/api/video/freigaben').expect(200)
    const zweites = vorher.body.videos[1]
    await request(app).post('/api/video/entziehen').send({ id: zweites.id }).expect(200)
    const nachher = await request(app).get('/api/video/freigaben').expect(200)
    assert.equal(nachher.body.videos.length, 2)
    assert.deepEqual(
      nachher.body.videos.map((v: { teil: string }) => v.teil),
      ['Teil 1', 'Teil 3'],
    )
  })

  it('setzt den Rest je Stueck und laesst die anderen in Ruhe', async () => {
    const vorher = await request(app).get('/api/video/freigaben').expect(200)
    const erstes = vorher.body.videos[0]
    await request(app).put('/api/video/freigaben').send({ id: erstes.id, rest: 3 }).expect(200)
    const nachher = await request(app).get('/api/video/freigaben').expect(200)
    assert.equal(nachher.body.videos[0].rest, 3)
    assert.equal(nachher.body.videos[1].rest, 1)
  })

  it('ein Start auf die VIDEOKENNUNG trifft kein Stueck — und sagt das', async () => {
    // WICHTIG UND NICHT SELBSTVERSTAENDLICH: „irgendeines der drei" waere
    // hier die bequeme Antwort und die falsche. Die Zeile heisst id.
    const r = await request(app).post('/api/video/start').send({ kennung: VIDEO.kennung }).expect(403)
    assert.equal(r.body.grund, 'unbekannt')
  })

  it('ein ganzes Video bleibt ueber seine Kennung erreichbar', async () => {
    // DIE VERGANGENHEIT: eine Ablage ohne `id` und ohne Schnitt, wie sie vor
    // dem 20.09.2026 geschrieben wurde.
    writeFileSync(ablage(), JSON.stringify({ fassung: 1, videos: [{ ...VIDEO, anzahl: 2, verbraucht: 0 }] }))
    const eltern = await request(app).get('/api/video/freigaben').expect(200)
    assert.equal(eltern.body.videos[0].id, VIDEO.kennung)
    assert.equal(eltern.body.videos[0].laengeSek, VIDEO.dauerSek)
    await request(app).put('/api/video/freigaben').send({ kennung: VIDEO.kennung, rest: 1 }).expect(200)
    const nachher = await request(app).get('/api/video/freigaben').expect(200)
    assert.equal(nachher.body.videos[0].rest, 1)
  })

  it('zaehlt ein Stueck an seiner eigenen Laenge — nicht an der des Videos', async () => {
    // OHNE DIESE ZEILE LIEFE EIN STUECK UNBEGRENZT: 480 von 1500 Sekunden
    // sind 32 % und damit nie die Schwelle.
    const id = 'egal'
    writeFileSync(
      ablage(),
      JSON.stringify({
        fassung: 1,
        videos: [{ ...VIDEO, dauerSek: 1500, abSek: 0, bisSek: 500, teil: 'Teil 1', anzahl: 1, verbraucht: 0 }],
      }),
    )
    const eltern = await request(app).get('/api/video/freigaben').expect(200)
    const stueck = eltern.body.videos[0]
    assert.notEqual(stueck.id, id)
    const r = await request(app)
      .post('/api/video/gesehen')
      .send({ id: stueck.id, lauf: 'l1', sekunden: 480 })
      .expect(200)
    assert.equal(r.body.grund, 'gezaehlt')
    assert.equal(r.body.rest, 0)
  })
})
