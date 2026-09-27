/**
 * Die Sperre um resume.json — gilt sie auch fuer das SCHREIBEN?
 *
 * WORUM ES GEHT: `/tmp/.resume.lock` ist die einzige Verabredung zwischen
 * allen, die an resume.json schreiben — der klassischen Oberflaeche
 * (/api/addresume), der neuen (POST /api/weiterhoeren) und dem root-Skript
 * remove_max_resume.sh. Eine Sperre, die nur das LESEN umschliesst, ist keine:
 * zwischen Lesen und Schreiben liegt bei einer vollen resume.json auf einer
 * SD-Karte genug Zeit, dass ein zweiter Schreiber die alte Fassung liest und
 * hinterher darueber schreibt.
 *
 * DAS SZENARIO IST AUF DIESER BOX ECHT: die neue Oberflaeche laeuft auf dem
 * Bildschirm der Box, die klassische gleichzeitig im Browser eines Telefons.
 * Beide merken sich beim Umschalten eine Stelle. Verliert eine davon, ist der
 * Schaden unsichtbar — die Kachel steht da, sie startet nur an der falschen
 * Stelle oder von vorn.
 *
 * EIGENE SPERRDATEI JE LAUF (MUPIBOX_LOCK_DIR): `node --test` startet die
 * Spec-Dateien parallel; an der gemeinsamen /tmp-Sperre haetten sich zwei
 * Laeufe gegenseitig alles stumm uebersprungen.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

/**
 * Ein Fuellstand, der das Schreiben spuerbar macht.
 *
 * WARUM UEBERHAUPT FUELLEN: Die Luecke zwischen „Sperre weg" und „geschrieben"
 * ist so gross wie ein Lese- und ein Schreibvorgang. Bei einer leeren Datei
 * sind das Mikrosekunden, und der Fehler ginge im Test unter, obwohl er auf
 * der Box (SD-Karte, ~9 gemerkte Stellen plus Bilder-URLs) breit genug ist.
 * Diese Fuellung stellt die Luecke her, sie erfindet sie nicht.
 */
function fuellung(anzahl: number): unknown[] {
  const raus: unknown[] = []
  for (let i = 0; i < anzahl; i++) {
    raus.push({
      id: `fuell-${i}`,
      title: `Fuelltitel ${i}`,
      artist: 'Fuellung',
      type: 'spotify',
      category: 'resume',
      cover: `https://i.scdn.co/image/${'a'.repeat(300)}${i}`,
      resumespotifytrack_number: 1,
      resumespotifyprogress_ms: 1000,
      resumespotifyduration_ms: 600000,
    })
  }
  return raus
}

const EINS = { id: 'sperre-eins', title: 'Der erste Schreiber', type: 'spotify', category: 'resume' }
const ZWEI = { id: 'sperre-zwei', title: 'Der zweite Schreiber', type: 'spotify', category: 'resume' }

let app: import('express').Express
let verzeichnis = ''
let resumeDatei = ''
let sperre = ''

function stellen(): Array<{ id?: string }> {
  return JSON.parse(readFileSync(resumeDatei, 'utf8'))
}

describe('resume.json: die Sperre muss Lesen UND Schreiben umschliessen', () => {
  before(async () => {
    verzeichnis = mkdtempSync(join(tmpdir(), 'mupi-resume-sperre-'))
    resumeDatei = join(verzeichnis, 'resume.json')
    sperre = join(verzeichnis, '.resume.lock')
    writeFileSync(join(verzeichnis, 'data.json'), '[]')
    writeFileSync(join(verzeichnis, 'active_data.json'), '[]')
    writeFileSync(resumeDatei, JSON.stringify(fuellung(1200), null, 4))
    process.env.MUPIBOX_CONFIG_DIR = verzeichnis
    process.env.MUPIBOX_LOCK_DIR = verzeichnis
    app = (await import('./server.js')).app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_LOCK_DIR = undefined
  })

  it('verliert keinen Eintrag, wenn zwei Oberflaechen gleichzeitig merken', async () => {
    const vorher = stellen().length

    // Der zweite Schreiber kommt in die Luecke: nach dem Lesen des ersten,
    // vor dessen Schreiben. 3 ms sind genau dafuer gewaehlt — frueher traefe
    // er die Sperre in jedem Fall, spaeter waere der erste laengst fertig.
    const a = request(app).post('/api/addresume').send(EINS)
    await new Promise((f) => setTimeout(f, 3))
    const b = request(app).post('/api/addresume').send(ZWEI)
    const [ra, rb] = await Promise.all([a, b])

    assert.equal(ra.status, 200)
    assert.equal(rb.status, 200)

    const jetzt = stellen()
    const ids = new Set(jetzt.map((e) => e.id))
    // ABGEWIESEN ist in Ordnung — die Oberflaeche versucht es beim naechsten
    // Merktakt wieder. STILL UEBERSCHRIEBEN ist es nicht.
    if (ra.text === 'ok') assert.ok(ids.has(EINS.id), 'der erste Eintrag darf nicht wieder verschwinden')
    if (rb.text === 'ok') assert.ok(ids.has(ZWEI.id), 'der zweite Eintrag darf nicht wieder verschwinden')
    assert.ok(
      ra.text === 'ok' || rb.text === 'ok',
      'einer von beiden muss durchgekommen sein, sonst prueft dieser Test nichts',
    )
    assert.ok(jetzt.length >= vorher, 'es darf nichts aus der Fuellung verlorengehen')
  })

  it('laesst keine Sperre stehen, wenn es fertig ist', async () => {
    await request(app).post('/api/addresume').send(EINS).expect(200)
    assert.equal(existsSync(sperre), false, 'eine liegengebliebene Sperre legt das Merken fuer immer still')
  })

  it('schreibt gar nichts, solange die Sperre eines anderen liegt', async () => {
    writeFileSync(sperre, '')
    const vorher = readFileSync(resumeDatei, 'utf8')
    const r = await request(app)
      .post('/api/addresume')
      .send({ ...ZWEI, title: 'Darf nicht durchkommen' })
    assert.equal(r.status, 200)
    assert.equal(r.text, 'locked')
    assert.equal(readFileSync(resumeDatei, 'utf8'), vorher)
    // Und die FREMDE Sperre bleibt liegen — wer sie nicht gesetzt hat, nimmt
    // sie auch nicht weg.
    assert.equal(existsSync(sperre), true)
    writeFileSync(resumeDatei, vorher)
    const { rmSync } = await import('node:fs')
    rmSync(sperre)
  })
})
