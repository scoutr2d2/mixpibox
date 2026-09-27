/**
 * SAGT DER KNOPF DIE WAHRHEIT? — die Systemaktionen am laufenden Server.
 *
 * ══ WARUM DAS NICHT MIT EINER REINEN PRÜFUNG GEHT ═════════════════════════
 *
 * system.spec.ts nagelt die TABELLE fest — welche Aktionen es gibt, was sie
 * aufrufen, welche uns mitnehmen. Was dort grundsätzlich nicht sichtbar wird,
 * ist die Frage, um die es hier geht: WANN geht die Antwort hinaus, vor oder
 * nach dem Befehl? Das entscheidet die Route in server.ts, und ein Fehler dort
 * ist in jeder Tabellenprüfung grün.
 *
 * DER FALL, DER DAS NÖTIG MACHTE. `drehung-zurueck` ruft
 * /opt/mupibox-tools/bootwache.py. Diese Datei liegt auf der Box gar nicht
 * (nachgesehen am 08.08.2026). Trotzdem antwortete der Endpunkt `ok: true` —
 * die Antwort ging VOR dem `execFile` hinaus, und der Fehlschlag landete
 * ausschließlich in `console.error`. Ausgerechnet der Knopf, den man drückt,
 * WEIL man nichts mehr sieht, meldete zuverlässig Erfolg und tat nichts.
 *
 * WARUM AUSGERECHNET DIESE AKTION GEPRÜFT WIRD UND NICHT „Neustart":
 * Weil sie die einzige ist, deren Auslösen hier nichts kaputt macht. Ein Test,
 * der POST /api/system/herunterfahren schickt, wäre auf dem Arbeitsplatz
 * harmlos (sudo scheitert ohne Terminal) und auf der Box ein ausgeschaltetes
 * Gerät mitten im Prüflauf. Deshalb steht unten der Riegel `aufDerBox`.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, describe, it } from 'node:test'
import request from 'supertest'
import { AKTIONEN } from './system.js'

let app: import('express').Express

/**
 * Läuft dieser Prüflauf auf einer echten MuPiBox?
 *
 * Dann werden die Aktionen NICHT ausgelöst. Die Route ist dieselbe, die
 * `shutdown.sh` aufruft; ein Prüflauf, der die Box abschaltet, hat sich seine
 * eigene Grundlage weggenommen. Erkennungsmerkmal ist das Verzeichnis, in dem
 * die Skripte der Installation liegen — auf dem Arbeitsplatz gibt es das nicht.
 */
const aufDerBox = existsSync('/usr/local/bin/mupibox')

describe('Systemaktionen am laufenden Server', () => {
  before(async () => {
    const ordner = mkdtempSync(join(tmpdir(), 'mupi-sysaktion-'))
    const konfigPfad = join(ordner, 'mupiboxconfig.json')
    writeFileSync(
      konfigPfad,
      JSON.stringify({
        mupibox: { host: 'MuPiBox', startVolume: '40', maxVolume: '100' },
        interfacelogin: { state: false, password: '' },
        timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
      }),
    )
    process.env.MUPIBOX_CONFIG = konfigPfad
    process.env.MUPIBOX_CONFIG_DIR = ordner
    app = (await import('./server.js')).app
  })

  it('weist eine unbekannte Aktion ab, ohne irgendetwas auszuführen', async () => {
    const r = await request(app).post('/api/system/toString').expect(400)
    assert.equal(r.body.ok, false)
  })

  it('meldet KEINEN Erfolg, wenn der gerufene Befehl fehlschlägt', {
    skip: aufDerBox ? 'auf der Box würde das die Aktion wirklich auslösen' : false,
  }, async () => {
    // Der Aufruf scheitert hier auf zwei Arten, und beide sind recht: die
    // Datei fehlt (wie auf der Box), oder `sudo` findet kein Terminal für die
    // Passwortfrage (wie auf dem Arbeitsplatz). Geprüft wird nicht der Grund,
    // sondern dass er ÜBERHAUPT bis zum Anrufer kommt.
    const r = await request(app).post('/api/system/drehung-zurueck')
    assert.equal(r.status, 500, 'ein fehlgeschlagener Befehl darf nicht 200 sein')
    assert.equal(r.body.ok, false)
    assert.match(r.body.error, /Bildschirm-Drehung/)
    assert.ok(
      typeof r.body.meldung === 'string' && r.body.meldung.length > 0,
      'ohne Meldung steht der Betreiber genauso im Dunkeln wie vorher',
    )
  })

  it('sagt der Oberfläche an jeder Aktion, ob sie den Server mitnimmt', async () => {
    // OHNE DAS KANN DIE VERWALTUNG DIE 500 NICHT VON EINEM ERWARTETEN ABRISS
    // UNTERSCHEIDEN. Sie behandelt heute jeden Fehlschlag einer
    // `einschneidend`-Aktion als „ausgelöst, die Box ist gleich weg" — für
    // Neustart und Herunterfahren richtig, für `drehung-zurueck` genau die
    // alte Lüge, nur eine Etage höher.
    const r = await request(app).get('/api/system').expect(200)
    const je = Object.fromEntries(
      (r.body.aktionen as { id: string; nimmtUnsMit: boolean }[]).map((a) => [a.id, a.nimmtUnsMit]),
    )
    assert.equal(je['drehung-zurueck'], false)
    assert.equal(je['medien-neu'], false)
    assert.equal(je['neustart'], true)
    assert.equal(je['herunterfahren'], true)
  })

  it('wartet auf genau die Aktionen, die uns nicht mitnehmen', () => {
    // Der Riegel gegen die Wiederkehr: fiele jemandem ein, `nimmtUnsMit` auch
    // an `drehung-zurueck` zu setzen, wäre die Lüge zurück — und der Test
    // oben liefe nicht mehr in die 500, sondern in ein grünes 200.
    assert.equal(AKTIONEN['drehung-zurueck'].nimmtUnsMit, false)
    assert.equal(AKTIONEN['medien-neu'].nimmtUnsMit, false)
  })
})
