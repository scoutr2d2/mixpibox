/**
 * Der Sprechstrom am ECHTEN Server (Recht `sprechen`, 28.09.2026).
 *
 * sprechstrom.spec.ts prueft die Route an einem eigenen Express; ob server.ts
 * sie wirklich einhaengt, den Anschluss an die Plugins reicht und beide auf
 * DENSELBEN Ordner zeigen, sieht man dort nicht. Das ist die Naht, an der
 * jede Seite fuer sich gruen sein kann ([[plugin-kette-reisst-an-sechs-stellen]]).
 *
 * PIPER WIRD NUR VORGETAEUSCHT, und zwar genau so weit, wie der Server beim
 * Laden nachsieht: ein `bin/python` im venv und eine Stimme aus Modell UND
 * Beschreibung. Sprechen kann er damit nicht — die Stimme ist nicht die
 * eingestellte, der Dienst startet also nicht, und die Route muss ehrlich 503
 * sagen statt still eine leere Datei zu liefern.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

// MIT PUNKT-SEGMENT wie am Geraet — siehe plugin-inhalt.integration.spec.ts.
const WURZEL = fs.mkdtempSync(path.join(os.tmpdir(), 'mupi-sprech-'))
const PLUGINS = path.join(WURZEL, '.mupibox', 'plugins')
const SPRECH = path.join(WURZEL, '.mupibox', 'sprech-speicher')
const VENV = path.join(WURZEL, '.mupibox', 'piper-venv')
const STIMMEN = path.join(WURZEL, '.mupibox', 'piper-stimmen')
let app: import('express').Express

const EINTRAG = { type: 'plugin', category: 'other', id: 'mixpi-sprichprobe:mond', title: 'Mond', artist: 'Probe' }
const SCHLUESSEL = encodeURIComponent('plugin:mixpi-sprichprobe:mond')

before(async () => {
  const ordner = path.join(PLUGINS, 'mixpi-sprichprobe')
  fs.mkdirSync(ordner, { recursive: true })
  fs.writeFileSync(
    path.join(ordner, 'plugin.json'),
    JSON.stringify({
      kennung: 'mixpi-sprichprobe',
      name: 'Sprichprobe',
      fassung: '1.0.0',
      haupt: 'index.mjs',
      rechte: ['medienquelle', 'sprechen'],
    }),
  )
  fs.writeFileSync(
    path.join(ordner, 'index.mjs'),
    `export default {
      async inhalt(rest, kontext) {
        if (!kontext.sprechen) throw new Error('kein sprechen im Kontext')
        return {
          titel: 'Mond',
          vollstaendig: true,
          folgen: [
            { kennung: 'a0', name: 'Mond', quelle: await kontext.sprechen('Der Mond. Ein Mond ist ein Satellit.') },
            { kennung: 'a1', name: 'Mond: Wie sieht er aus?', quelle: await kontext.sprechen('Wie sieht er aus? Grau.', { tempo: 1.2 }) },
          ],
        }
      },
    }\n`,
  )

  fs.mkdirSync(path.join(VENV, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(VENV, 'bin', 'python'), '')
  fs.mkdirSync(STIMMEN, { recursive: true })
  fs.writeFileSync(path.join(STIMMEN, 'de_DE-probe-low.onnx'), '')
  fs.writeFileSync(path.join(STIMMEN, 'de_DE-probe-low.onnx.json'), '{}')

  fs.writeFileSync(path.join(WURZEL, 'data.json'), JSON.stringify([EINTRAG], null, 2))
  fs.writeFileSync(path.join(WURZEL, 'active_data.json'), JSON.stringify([EINTRAG], null, 2))
  fs.writeFileSync(path.join(WURZEL, 'resume.json'), '[]')
  fs.writeFileSync(path.join(WURZEL, 'gespielt.json'), '[]')
  fs.writeFileSync(path.join(WURZEL, 'mupiboxconfig.json'), JSON.stringify({ mupibox: {} }))
  process.env.MUPIBOX_CONFIG = path.join(WURZEL, 'mupiboxconfig.json')
  process.env.MUPIBOX_CONFIG_DIR = WURZEL
  process.env.MUPIBOX_LOCK_DIR = WURZEL
  process.env.MUPIBOX_PLUGIN_DIR = PLUGINS
  process.env.MUPIBOX_SPRECH_SPEICHER = SPRECH
  process.env.MUPIBOX_PIPER_VENV = VENV
  process.env.MUPIBOX_PIPER_STIMMEN = STIMMEN
  app = (await import('./server.js')).app
  const { warteBereit } = await import('./plugin-wirt.js')
  await warteBereit('mixpi-sprichprobe', 10_000)
})

after(async () => {
  const { allesBeenden } = await import('./plugin-wirt.js')
  await allesBeenden()
  for (const n of [
    'MUPIBOX_CONFIG',
    'MUPIBOX_CONFIG_DIR',
    'MUPIBOX_LOCK_DIR',
    'MUPIBOX_PLUGIN_DIR',
    'MUPIBOX_SPRECH_SPEICHER',
    'MUPIBOX_PIPER_VENV',
    'MUPIBOX_PIPER_STIMMEN',
  ]) {
    delete process.env[n]
  }
  fs.rmSync(WURZEL, { recursive: true, force: true })
})

describe('Sprechstrom am echten Server', () => {
  let adressen: string[] = []

  it('ein Plugin mit Recht bekommt kontext.sprechen — die Folgen zeigen auf die Route des Servers', async () => {
    const a = await request(app).get(`/api/werke/${SCHLUESSEL}/inhalt`).expect(200)
    assert.equal(a.body.titel.length, 2, JSON.stringify(a.body).slice(0, 300))
    // DIE ADRESSE STEHT KODIERT IM ABSPIELBEFEHL (`plugin/<url>/<titel>`) —
    // so, wie die Box sie an den Abspieler schickt.
    adressen = (a.body.titel as { befehl: string }[]).map((t) =>
      String(decodeURIComponent(t.befehl).match(/http:\/\/127\.0\.0\.1:\d+\/api\/sprechen\/[0-9a-f]{32}\.wav/)?.[0] ?? ''),
    )
    assert.ok(
      adressen.every((x) => x),
      `jede Folge traegt eine Sprech-Adresse: ${JSON.stringify(a.body.titel)}`,
    )
    assert.notEqual(adressen[0], adressen[1], 'zwei Texte, zwei Adressen')
  })

  it('der Auftrag liegt in DEMSELBEN Ordner, aus dem die Route liest', () => {
    for (const adresse of adressen) {
      const name = path.basename(adresse, '.wav')
      const auftrag = JSON.parse(fs.readFileSync(path.join(SPRECH, `${name}.json`), 'utf8'))
      assert.equal(auftrag.plugin, 'mixpi-sprichprobe')
    }
  })

  it('die Route ist eingehaengt und sagt ehrlich 503, wenn Piper nicht sprechen kann', async () => {
    const pfad = new URL(adressen[0]).pathname
    const a = await request(app).get(pfad)
    assert.equal(a.status, 503, `${a.status} ${JSON.stringify(a.body)}`)
    assert.match(String(a.body.error), /kann gerade nicht sprechen/)
    assert.ok(!fs.existsSync(path.join(SPRECH, `${path.basename(pfad, '.wav')}.wav`)), 'keine leere Datei abgelegt')
  })

  it('einen Namen ohne Auftrag spricht sie nicht', async () => {
    await request(app).get(`/api/sprechen/${'a'.repeat(32)}.wav`).expect(404)
  })
})
