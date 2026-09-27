/**
 * VIER ENDPUNKTE, DIE OHNE IHRE DATEI GAR NICHTS SCHICKTEN.
 *
 * BEFUND (Gesamtpruefung 2026-08-02): `/api/mupihat`, `/api/data`,
 * `/api/activeresume` und `/api/wlan` waren nach demselben Muster gebaut —
 *
 *     if (fs.existsSync(datei)) { ...lesen und antworten... }
 *
 * — und hatten KEINEN Zweig fuer den Fall, dass die Datei fehlt. Dann lief die
 * Anfrage in kein `res` hinein und blieb offen, bis der Client aufgab. Das ist
 * kein Randfall:
 *
 *   mupihat.json      der MuPiHAT ist Zubehoer; jede Box ohne ihn trifft es
 *   wlan.json         eine frisch eingerichtete Box hat noch kein WLAN gemerkt
 *   active_resume.json bevor zum ersten Mal etwas gemerkt wurde
 *
 * WAS ES KOSTET: NewDesign/app.js fragt `/api/mupihat` im 30-Sekunden-Takt
 * (TAKT_HAT) ohne Zeitgrenze, die Verwaltungsseite mupihat.ts wartet mit
 * `firstValueFrom`. Auf einem Geraet, das tagelang durchlaeuft, sind das 120
 * haengende Abfragen je Stunde, jede mit einem offenen Socket auf beiden
 * Seiten. Gesehen haette man davon nichts — kein Fehler, keine Meldung, nur
 * eine Anzeige, die nie kommt.
 *
 * `[]` UND NICHT 404, weil genau das schon der Lesefehler-Zweig jedes dieser
 * vier Endpunkte liefert. Eine zweite Form fuer denselben Fall waere eine
 * Wahrheit zu viel, und alle Verbraucher pruefen ohnehin auf Inhalt
 * (`BatteryConnected` beim HAT, Laenge bei den Listen).
 *
 * JEDER FALL HAT EINE EIGENE FRIST, und das ist kein Beiwerk: Faellt der Zweig
 * wieder weg, ANTWORTET der Endpunkt nicht — er schweigt. Ohne Frist wartete
 * der Testlauf darauf ewig (die Vorgabe von `node --test` ist unendlich), und
 * aus einem roten Balken wuerde ein haengender Pruefsatz, den irgendwann
 * jemand abschaltet. GEGENGEPROBT (2026-08-02): die alte Form von /api/wlan
 * wieder eingesetzt -> genau dieser eine Fall faellt nach 8 s durch, die
 * anderen drei bleiben gruen.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

let app: import('express').Express

/** Reichlich fuer eine Antwort aus einer Datei, die es nicht gibt — und kurz
 *  genug, dass ein Rueckfall als FEHLER auffaellt statt als Stillstand. */
const FRIST_MS = 8000

describe('Endpunkte ohne ihre Datei', () => {
  before(async () => {
    // ABSICHTLICH LEER: kein active_data.json, kein mupihat.json, kein
    // wlan.json, kein active_resume.json. Genau der Zustand einer Box, an der
    // noch nichts eingerichtet ist.
    process.env.MUPIBOX_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'mupi-leer-'))
    app = (await import('./server.js')).app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
  })

  it('/api/mupihat antwortet auch ohne mupihat.json', { timeout: FRIST_MS }, async () => {
    const r = await request(app).get('/api/mupihat').expect(200)
    // Leer heisst „kein Akku" — die Oberflaeche blendet das Zeichen dann aus,
    // statt einen geratenen Fuellstand zu zeigen.
    assert.deepEqual(r.body, [])
  })

  it('/api/data antwortet auch ohne active_data.json', { timeout: FRIST_MS }, async () => {
    const r = await request(app).get('/api/data').expect(200)
    assert.deepEqual(r.body, [])
  })

  it('/api/activeresume antwortet auch ohne active_resume.json', { timeout: FRIST_MS }, async () => {
    const r = await request(app).get('/api/activeresume').expect(200)
    assert.deepEqual(r.body, [])
  })

  it('/api/wlan antwortet auch ohne wlan.json', { timeout: FRIST_MS }, async () => {
    const r = await request(app).get('/api/wlan').expect(200)
    assert.deepEqual(r.body, [])
  })
})
