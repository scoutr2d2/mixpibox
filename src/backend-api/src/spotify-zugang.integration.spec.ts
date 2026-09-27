/**
 * `/api/spotify/config` und `/api/spotify/warteschlange` am laufenden Server —
 * BACKLOG E15/S3 und S4.
 *
 * WAS HIER FESTGEHALTEN WIRD, und warum es einen Test braucht statt eines
 * Blicks in den Quelltext: Dieser Weg gab bis zum 04.08.2026 `clientId` und
 * `refreshToken` an JEDEN im Netz heraus, ohne Anmeldung — nicht aus
 * Versehen, sondern weil die Oberflaeche sie brauchte. Wer die Antwort spaeter
 * wieder „vollstaendiger" macht (etwa mit `...config.spotify`, wie es dastand),
 * bricht nichts Sichtbares: die Oberflaeche laeuft weiter, und das Leck ist
 * still zurueck. Genau dagegen steht dieser Test.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

let app: import('express').Express

describe('Spotify-Zugang: was die Box herausgibt (E15/S3+S4)', () => {
  before(async () => {
    const d = mkdtempSync(join(tmpdir(), 'mupi-spzugang-'))
    // Eine EINGERICHTETE Box — nur so kann der Test ueberhaupt zeigen, dass
    // die Geheimnisse nicht herausgehen. Eine leere Konfiguration bestuende
    // die Pruefung aus dem falschen Grund.
    writeFileSync(
      join(d, 'config.json'),
      JSON.stringify({
        spotify: {
          clientId: 'e5e33c0000000000000000000000abcd',
          clientSecret: 'geheimnis-das-nirgends-hin-darf',
          refreshToken: 'AQC8U5-ein-sehr-langes-erneuerungsmerkmal',
          accessToken: 'BQD-kurzlebig',
        },
        'node-sonos-http-api': { server: 'MixPiBox' },
      }),
    )
    writeFileSync(join(d, 'active_data.json'), '[]')
    writeFileSync(join(d, 'data.json'), '[]')
    process.env.MUPIBOX_CONFIG_DIR = d
    app = (await import('./server.js')).app
    // DIE KONFIGURATION WIRD ASYNCHRON GELESEN (server.ts:433, `readJsonFile(…)
    // .then(…)`), und der Import wartet nicht darauf. Ohne dieses Warten
    // antwortet der erste Aufruf mit 500 („Could load spotify config") — und
    // ein Test, der das als Fehlschlag meldet, zeigt auf die falsche Stelle.
    for (let i = 0; i < 50; i++) {
      if ((await request(app).get('/api/spotify/config')).status === 200) break
      await new Promise((weiter) => setTimeout(weiter, 20))
    }
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
  })

  it('nennt den Geraetenamen und ob eingerichtet ist — und sonst NICHTS', async () => {
    const antwort = await request(app).get('/api/spotify/config').expect(200)
    assert.deepEqual(antwort.body, { deviceName: 'MixPiBox', eingerichtet: true })
  })

  it('gibt kein Geheimnis heraus, auch nicht gekuerzt', async () => {
    const antwort = await request(app).get('/api/spotify/config').expect(200)
    const roh = JSON.stringify(antwort.body)
    // Ueber den ROHTEXT gesucht, nicht ueber Feldnamen: ein neues Feld, das
    // dasselbe Geheimnis unter anderem Namen traegt, faellt sonst durch.
    for (const geheim of ['e5e33c', 'geheimnis-das', 'AQC8U5', 'BQD-']) {
      assert.equal(roh.includes(geheim), false, `„${geheim}" steht in der Antwort`)
    }
  })

  it('weist eine Warteschlangen-uri ab, die keine Titel-uri ist', async () => {
    // 400 heisst „die Anfrage war es" und kommt VOR jedem Netzweg — der Test
    // braucht dafuer kein Spotify.
    for (const uri of ['spotify:album:2QqQXuDKNR8HK1cFxf0NhW', 'spotify:user:andrea68', 'https://example.invalid', '']) {
      const antwort = await request(app).post('/api/spotify/warteschlange').send({ uri }).expect(400)
      assert.equal(antwort.body.angehaengt, false)
    }
    await request(app).post('/api/spotify/warteschlange').send({}).expect(400)
  })
})
