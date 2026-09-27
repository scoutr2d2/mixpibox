/**
 * WAS PASSIERT WIRKLICH, WENN `profile.json` UNLESBAR IST?
 *
 * Der gemeldete Fund (07./08.08.2026) behauptet dreierlei:
 *   1. Ein unlesbares `profile.json` macht STILL den Gast zum aktiven Profil.
 *   2. Es steht nirgends etwas darueber im Protokoll.
 *   3. Der naechste Schreibvorgang vernichtet die Datei, aus der man den
 *      Stand haette wiederherstellen koennen.
 *
 * Diese Probe misst alle drei Punkte am ECHTEN Server (nicht am Modell): ein
 * eigenes Konfigurationsverzeichnis, eine mutwillig zerrissene `profile.json`,
 * daneben die Bereiche zweier Kinder — genau die Lage, die die Box im
 * Wohnzimmer heute hat (`profile/gast`, `profile/kalea`, aktiv: `kalea`).
 *
 * SIE SCHREIBT NICHTS AN DER BOX und braucht keinen Port: unter NODE_ENV=test
 * lauscht `server.ts` nicht (`app.listen` haengt an `productionServe`).
 *
 * Lauf:  cd src/backend-api && npx cross-env NODE_ENV=test npx tsx --test ../../tools/profil-kaputt-probe.ts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

let app: import('express').Express
let konf: string
/** Alles, was der Server beim Hochfahren gesagt hat. */
const gesagt: string[] = []

/** Der Stand, wie er auf der Box steht — nur eben zerrissen. */
const HEIL = {
  profile: [
    { kennung: 'gast', name: 'Gast', figur: '', angelegt: 0 },
    { kennung: 'kalea', name: 'Kalea', figur: '', angelegt: 1786085015068 },
  ],
  aktiv: 'kalea',
}

describe('profile.json unlesbar', () => {
  before(async () => {
    konf = mkdtempSync(join(tmpdir(), 'mupi-profil-kaputt-'))
    // ABGESCHNITTEN MITTEN IM SATZ — das, was ein halber Schreibvorgang oder
    // ein Dateisystemschaden hinterlaesst. JSON.parse wirft darauf.
    const heil = JSON.stringify(HEIL, null, 2)
    fs.writeFileSync(join(konf, 'profile.json'), heil.slice(0, Math.floor(heil.length * 0.6)))
    for (const k of ['gast', 'kalea']) {
      fs.mkdirSync(join(konf, 'profile', k), { recursive: true })
      fs.writeFileSync(join(konf, 'profile', k, 'resume.json'), JSON.stringify([{ marke: k }]))
    }

    // MITHOEREN, BEVOR DER SERVER HOCHFAEHRT: der Rueckfall steht im Rumpf des
    // Moduls, er passiert also waehrend `import`.
    const echt = { log: console.log, warn: console.warn, error: console.error, info: console.info }
    for (const art of ['log', 'warn', 'error', 'info'] as const) {
      console[art] = (...a: unknown[]) => {
        gesagt.push(`${art}: ${a.map(String).join(' ')}`)
      }
    }
    process.env.MUPIBOX_CONFIG_DIR = konf
    try {
      app = (await import('../src/backend-api/src/server.js')).app
    } finally {
      Object.assign(console, echt)
    }
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    fs.rmSync(konf, { recursive: true, force: true })
  })

  it('1. der Gast ist danach dran, das Kind ist aus der Liste verschwunden', async () => {
    const a = await request(app).get('/api/profile')
    assert.equal(a.status, 200)
    assert.equal(a.body.aktiv, 'gast', 'aktiv nach dem Rueckfall')
    assert.deepEqual(
      a.body.profile.map((p: { kennung: string }) => p.kennung),
      ['gast'],
      'nur noch der Gast steht in der Liste',
    )
  })

  it('2. beim Hochfahren wurde nichts darueber gesagt', () => {
    const treffer = gesagt.filter((z) => /profil/i.test(z))
    console.log(`  [Probe] Zeilen beim Hochfahren: ${gesagt.length}, davon ueber Profile: ${treffer.length}`)
    for (const z of gesagt) console.log(`  [Probe] ${z.slice(0, 160)}`)
    // Kein assert auf "leer": gemessen wird, WAS dasteht — die Zahl steht oben.
    assert.ok(Array.isArray(treffer))
  })

  it('3. die kaputte Datei liegt nach dem Start noch da (kein Schreiben beim Hochfahren)', () => {
    const jetzt = fs.readFileSync(join(konf, 'profile.json'), 'utf8')
    assert.ok(jetzt.includes('kalea'), 'die Kennung des Kindes steht noch in der Datei')
    assert.ok(!jetzt.trim().endsWith('}') || jetzt.length < 100, 'die Datei ist noch die zerrissene')
  })

  it('4. EIN Aufruf, der schreibt, ueberschreibt sie — und dann ist die Kennung weg', async () => {
    const a = await request(app).post('/api/profil/aktiv').send({ kennung: 'gast' })
    assert.equal(a.status, 200, 'der Gast steht in der Liste, also geht das durch')
    const jetzt = fs.readFileSync(join(konf, 'profile.json'), 'utf8')
    assert.ok(!jetzt.includes('kalea'), 'nach dem Schreiben steht die Kennung des Kindes nicht mehr in der Datei')
  })

  it('5. der BESTAND des Kindes liegt weiter in seinem Ordner', () => {
    const p = join(konf, 'profile', 'kalea', 'resume.json')
    assert.ok(fs.existsSync(p), 'profile/kalea/resume.json')
    assert.match(fs.readFileSync(p, 'utf8'), /kalea/)
  })
})
