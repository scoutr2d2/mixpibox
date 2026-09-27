/**
 * Integrationszeugen fuer die DREI NEUEN FLAECHEN eines Plugins (E77):
 * Icon, Aktion, freie Route — vom HTTP-Ende bis in den Worker und zurueck.
 *
 * GENAU DIESER WEG IST AM 22.08.2026 AM GERAET GESCHEITERT (Icon: 404
 * „Icon-Datei fehlt", obwohl die Datei lag), NACHDEM alle Einzelteile gruen
 * waren: Vertrag geprueft, Wirt geprueft, Route gebaut. Die Naht dazwischen
 * hatte keinen Zeugen — der hier ist er.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

// MIT PUNKT-SEGMENT, wie am Geraet (`/home/dietpi/.mupibox/plugins`): Express'
// sendFile verweigert Punktpfade in der Vorgabe, und ein Test in einem
// punktfreien Temp-Ordner war gruen, waehrend die Box 404 lieferte. Der Zeuge
// bildet die Umgebung nach, in der er etwas beweisen soll.
const PLUGINS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mupi-f-')), '.mupibox', 'plugins')
const KONFIG = fs.mkdtempSync(path.join(os.tmpdir(), 'mupi-f-konfig-'))
let app: import('express').Express

before(async () => {
  const ordner = path.join(PLUGINS, 'mixpi-probe')
  fs.mkdirSync(ordner, { recursive: true })
  fs.writeFileSync(
    path.join(ordner, 'plugin.json'),
    JSON.stringify({
      kennung: 'mixpi-probe',
      name: 'Probe',
      fassung: '1.0.0',
      haupt: 'index.mjs',
      rechte: [],
      sektion: 'streaming/ardsounds',
      icon: 'icon.svg',
      aktionen: [{ kennung: 'winken', name: 'Winken' }],
      konfig: ['jellyfin', 'maschine'],
    }),
  )
  fs.writeFileSync(path.join(ordner, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  fs.writeFileSync(
    path.join(ordner, 'index.mjs'),
    `export default {
      async befinden() { return { ok: true, text: 'gut' } },
      async aktion(kennung) { return { ok: true, text: 'gewunken: ' + kennung } },
      async http(anfrage, kontext) {
        if (anfrage.pfad === 'konfig') return { inhalt: { konfig: kontext.konfig ?? null } }
        if (anfrage.pfad === 'echo') return { inhalt: { pfad: anfrage.pfad, abfrage: anfrage.abfrage, rumpf: anfrage.rumpf } }
        if (anfrage.pfad === 'kaputt') return { status: 500, inhalt: {} }
        if (anfrage.pfad === 'umleitung') return { status: 302, inhalt: {} }
        return { status: 404, inhalt: { fehler: 'kenn ich nicht' } }
      },
    }\n`,
  )

  fs.writeFileSync(
    path.join(KONFIG, 'mupiboxconfig.json'),
    JSON.stringify({ mupibox: { host: 'TestBox' }, jellyfin: { server: 'http://alt:8096', apiKey: 'k1' } }),
  )
  process.env.MUPIBOX_CONFIG = path.join(KONFIG, 'mupiboxconfig.json')
  process.env.MUPIBOX_CONFIG_DIR = KONFIG
  process.env.MUPIBOX_LOCK_DIR = KONFIG
  process.env.MUPIBOX_PLUGIN_DIR = PLUGINS
  app = (await import('./server.js')).app
  // Auf das Plugin warten — der Worker braucht einen Moment.
  const { warteBereit } = await import('./plugin-wirt.js')
  await warteBereit('mixpi-probe', 10_000)
})

after(async () => {
  // Ohne das haelt der Plugin-Worker den Testprozess offen — der Spec hing
  // beim ersten Lauf fuenf Minuten im Timeout, obwohl alle Zeugen durch waren.
  const { allesBeenden } = await import('./plugin-wirt.js')
  await allesBeenden()
  fs.rmSync(PLUGINS, { recursive: true, force: true })
  fs.rmSync(KONFIG, { recursive: true, force: true })
})

describe('die Steckdaten reisen im PluginStand', () => {
  it('GET /api/plugins nennt Sektion, Icon und Aktionen', async () => {
    const antwort = await request(app).get('/api/plugins')
    const p = (antwort.body.geladen as Record<string, unknown>[]).find((x) => x.kennung === 'mixpi-probe')
    assert.ok(p, 'Probe-Plugin nicht geladen')
    assert.equal(p.sektion, 'streaming/ardsounds')
    assert.equal(p.icon, true)
    assert.deepEqual(p.aktionen, [{ kennung: 'winken', name: 'Winken' }])
    const kann = p.kann as Record<string, boolean>
    assert.equal(kann.aktion, true)
    assert.equal(kann.http, true)
  })
})

describe('das Icon kommt als Datei, nicht als Behauptung', () => {
  it('GET /icon liefert das SVG mit Bild-Content-Type', async () => {
    const antwort = await request(app).get('/api/plugins/mixpi-probe/icon')
    assert.equal(antwort.status, 200)
    assert.match(String(antwort.headers['content-type']), /image\/svg/)
    assert.match(antwort.text ?? antwort.body.toString(), /<svg/)
  })

  it('ohne Icon im Manifest: 404, kein Absturz', async () => {
    const antwort = await request(app).get('/api/plugins/gibt-es-nicht/icon')
    assert.equal(antwort.status, 404)
  })
})

describe('die Aktion — nur Angemeldetes erreicht den Worker', () => {
  it('eine angemeldete Aktion laeuft und antwortet in Worten', async () => {
    const antwort = await request(app).post('/api/plugins/mixpi-probe/aktion/winken')
    assert.equal(antwort.status, 200)
    assert.equal(antwort.body.ok, true)
    assert.equal(antwort.body.text, 'gewunken: winken')
  })

  it('eine NICHT angemeldete Aktion ist ein 404 der Route, kein Ruf ins Blaue', async () => {
    const antwort = await request(app).post('/api/plugins/mixpi-probe/aktion/loeschen')
    assert.equal(antwort.status, 404)
  })
})

describe('die Kern-Konfiguration im Kontext (E80)', () => {
  it('das Plugin sieht seine angemeldeten Gruppen — jellyfin von der Platte, maschine BERECHNET', async () => {
    const antwort = await request(app).get('/api/plugins/mixpi-probe/http/konfig')
    assert.equal(antwort.status, 200)
    assert.deepEqual(antwort.body.konfig, {
      jellyfin: { server: 'http://alt:8096', apiKey: 'k1' },
      // E82: `maschine` steht in KEINER Datei — kernKonfigGruppen() rechnet
      // sie aus spotify.engine/soloistApiKey. Die Konfig dieses Specs traegt
      // keine spotify-Gruppe, also die Vorgaben. Wer die Synthese vergisst,
      // sieht hier nur jellyfin — und der Engine-Wechsel unten schlaegt fehl.
      maschine: { engine: 'librespot', hatSchluessel: false },
    })
  })

  it('nach einer Konfig-Aenderung startet der Wirt das Plugin neu — es sieht die NEUEN Werte', async () => {
    // Der Kontext ist eingefroren; ohne den Neustart-Haken saehe das Plugin
    // bis zum Boxneustart die alten Zugangsdaten — der Fehler traete erst
    // auf, wenn jemand den Jellyfin-Server umzieht, und saehe aus wie ein
    // kaputter Server.
    const { kernKonfigAktualisieren, warteBereit } = await import('./plugin-wirt.js')
    fs.writeFileSync(
      path.join(KONFIG, 'mupiboxconfig.json'),
      JSON.stringify({ mupibox: { host: 'TestBox' }, jellyfin: { server: 'http://neu:8096', apiKey: 'k2' } }),
    )
    await kernKonfigAktualisieren({ jellyfin: { server: 'http://neu:8096', apiKey: 'k2' } })
    await warteBereit('mixpi-probe', 10_000)
    const antwort = await request(app).get('/api/plugins/mixpi-probe/http/konfig')
    assert.deepEqual(antwort.body.konfig, { jellyfin: { server: 'http://neu:8096', apiKey: 'k2' } })
  })
})

describe('der Engine-Wechsel erreicht die Plugins (E82)', () => {
  it('PUT /api/spotify/maschine: die berechnete Gruppe wandert, das Plugin startet neu', async () => {
    // GEGENPROBE EINGEBAUT: vor dem Wechsel steht librespot (Zeuge oben).
    // Der PUT schreibt engine=soloist + Schluessel; konfigAendernSicher
    // berechnet die Gruppen NEU und startet jedes Plugin mit `maschine` hart
    // durch. Saehe das Plugin danach noch librespot, waere die Synthese ODER
    // der Neustart tot — genau die lautlose Falle aus der Entwurfspruefung.
    const antwort = await request(app)
      .put('/api/spotify/maschine')
      .send({ engine: 'soloist', schluessel: `spak_${'a'.repeat(32)}` })
    assert.equal(antwort.status, 200, JSON.stringify(antwort.body))
    assert.equal(antwort.body.gewechselt, true)
    const { warteBereit } = await import('./plugin-wirt.js')
    await warteBereit('mixpi-probe', 10_000)
    const konfig = await request(app).get('/api/plugins/mixpi-probe/http/konfig')
    assert.deepEqual(konfig.body.konfig.maschine, { engine: 'soloist', hatSchluessel: true })
  })

  it('GET /api/spotify/maschine ohne Engine-Plugins: volle Form, ehrliche nulls, Hinweis', async () => {
    // Die Engine-Karte dereferenziert m.soloist.anmeldung ohne doppelten
    // Boden — eine geschrumpfte Antwort risse die Karte samt Umschalt-Hebel.
    // In diesem Spec sind mixpi-librespot/-soloist NICHT installiert: genau
    // der Rueckfall-Fall.
    const antwort = await request(app).get('/api/spotify/maschine')
    assert.equal(antwort.status, 200)
    const m = antwort.body
    assert.equal(m.engine, 'soloist')
    assert.equal(m.hatSchluessel, true)
    assert.ok('librespot' in m.laeuft && 'soloist' in m.laeuft)
    assert.deepEqual(m.soloist, { build: null, alterTage: null, verfallInTagen: null, warnung: null, anmeldung: null })
    assert.equal(m.bitrate, null)
    assert.match(String(m.hinweis), /mixpi-librespot und mixpi-soloist/)
  })
})

describe('die freie Route — Pfad, Abfrage und Rumpf kommen an', () => {
  it('GET mit Abfrage', async () => {
    const antwort = await request(app).get('/api/plugins/mixpi-probe/http/echo?tiefe=3')
    assert.equal(antwort.status, 200)
    assert.equal(antwort.body.pfad, 'echo')
    assert.deepEqual(antwort.body.abfrage, { tiefe: '3' })
  })

  it('POST mit JSON-Rumpf', async () => {
    const antwort = await request(app).post('/api/plugins/mixpi-probe/http/echo').send({ gruss: 'hallo' })
    assert.equal(antwort.status, 200)
    assert.deepEqual(antwort.body.rumpf, { gruss: 'hallo' })
  })

  it('der Status des Plugins reist durch (404)', async () => {
    const antwort = await request(app).get('/api/plugins/mixpi-probe/http/nirgends')
    assert.equal(antwort.status, 404)
  })

  it('5xx UND UMLEITUNGEN des Plugins werden zum 502 — nichts sieht aus wie der Kern', async () => {
    for (const pfad of ['kaputt', 'umleitung']) {
      const antwort = await request(app).get(`/api/plugins/mixpi-probe/http/${pfad}`)
      assert.equal(antwort.status, 502, pfad)
    }
  })

  it('DELETE ist keine Verwaltungsflaeche — 405', async () => {
    const antwort = await request(app).delete('/api/plugins/mixpi-probe/http/echo')
    assert.equal(antwort.status, 405)
  })
})
