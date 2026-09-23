/**
 * Die Abholwege — an Antworten geprueft, die den echten nachgebildet sind.
 *
 * WAS HIER NICHT GEHT: gegen einen echten Homeserver messen. Was hier geht
 * und wichtiger ist: die vier Stellen, an denen ein Abholweg still falsch
 * laeuft — die Marke (`since`/`offset`), die Frist, die Zeilenteilung im
 * TCP-Strom und die Frage, ob eine ABGEWIESENE Nachricht die Marke
 * weiterschiebt.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Erlaubt } from './nachrichten'
import {
  FRIST_MS,
  matrixAdresse,
  matrixAuswerten,
  POLL_MS,
  signalZeile,
  telegramAdresse,
  telegramAuswerten,
  zeilenSchneiden,
} from './nachrichten-holer'

const LISTE: Erlaubt[] = [
  { weg: 'matrix', absender: '@mama:server.example', name: 'Mama' },
  { weg: 'telegram', absender: '4711', name: 'Oma' },
  { weg: 'signal', absender: '+491700000000', name: 'Papa' },
]

describe('Matrix-Adresse', () => {
  const k = { server: 'https://matrix.example.org/', token: 'x', raum: '!r:server.example' }

  it('haengt den Schraegstrich des Servers nicht doppelt an', () => {
    assert.ok(matrixAdresse(k).startsWith('https://matrix.example.org/_matrix/client/v3/sync?'))
  })

  it('LAESST `since` BEIM ERSTEN MAL WEG — sonst kommt das Archiv', () => {
    assert.ok(!matrixAdresse(k).includes('since='))
    assert.ok(matrixAdresse(k, 's123').includes('since=s123'))
  })

  it('nimmt den Raum in den Filter, wenn einer genannt ist', () => {
    const filter = JSON.parse(new URL(matrixAdresse(k)).searchParams.get('filter') ?? '{}')
    assert.deepEqual(filter.room.rooms, ['!r:server.example'])
    assert.equal(filter.room.timeline.limit, 20)
  })

  it('laesst den Raumfilter weg, wenn keiner genannt ist', () => {
    const filter = JSON.parse(new URL(matrixAdresse({ ...k, raum: '' })).searchParams.get('filter') ?? '{}')
    assert.equal(filter.room.rooms, undefined)
  })

  it('DIE FRIST IST LAENGER ALS DER LONG POLL — sonst Dauerabbruch', () => {
    assert.ok(FRIST_MS > POLL_MS)
  })
})

describe('Matrix-Antwort', () => {
  const antwort = {
    next_batch: 's456',
    rooms: {
      join: {
        '!r:server.example': {
          timeline: {
            events: [
              {
                type: 'm.room.message',
                event_id: '$1',
                sender: '@mama:server.example',
                origin_server_ts: 1000,
                content: { msgtype: 'm.text', body: 'Hallo' },
              },
              {
                type: 'm.room.message',
                event_id: '$2',
                sender: '@fremd:server.example',
                origin_server_ts: 1001,
                content: { msgtype: 'm.text', body: 'Hallo Kind' },
              },
              { type: 'm.room.member', sender: '@mama:server.example' },
            ],
          },
        },
      },
    },
  }

  it('nimmt die erlaubte, zaehlt die fremde und laesst den Beitritt liegen', () => {
    const a = matrixAuswerten(antwort, LISTE)
    assert.equal(a.nachrichten.length, 1)
    assert.equal(a.nachrichten[0].text, 'Hallo')
    assert.equal(a.abgewiesen.length, 1)
    assert.equal(a.abgewiesen[0].grund, 'unbekannt')
  })

  it('HEBT DEN TEXT DES FREMDEN NICHT AUF — nur dass jemand geklopft hat', () => {
    const a = matrixAuswerten(antwort, LISTE)
    assert.ok(!JSON.stringify(a.abgewiesen).includes('Hallo Kind'))
  })

  it('reicht die Marke weiter', () => {
    assert.equal(matrixAuswerten(antwort, LISTE).marke, 's456')
  })

  it('faellt bei Unsinn nicht um', () => {
    assert.deepEqual(matrixAuswerten(null, LISTE).nachrichten, [])
    assert.deepEqual(matrixAuswerten({ rooms: 'nein' }, LISTE).nachrichten, [])
  })
})

describe('Telegram', () => {
  it('setzt den Offset nur, wenn es einen gibt', () => {
    assert.ok(!telegramAdresse({ token: 't' }).includes('offset='))
    assert.ok(telegramAdresse({ token: 't' }, 9).includes('offset=9'))
  })

  it('fragt nur nach Nachrichten, nicht nach allem', () => {
    const erlaubt = JSON.parse(new URL(telegramAdresse({ token: 't' })).searchParams.get('allowed_updates') ?? '[]')
    assert.deepEqual(erlaubt, ['message', 'edited_message'])
  })

  it('rechnet die Frist in SEKUNDEN — Telegram zaehlt so', () => {
    assert.equal(new URL(telegramAdresse({ token: 't' })).searchParams.get('timeout'), String(POLL_MS / 1000))
  })

  it('DIE MARKE GEHT AUCH BEI EINEM FREMDEN WEITER — sonst steht der Weg still', () => {
    const a = telegramAuswerten(
      {
        ok: true,
        result: [
          { update_id: 5, message: { message_id: 1, from: { id: 999 }, chat: { id: 999 }, date: 1, text: 'hi' } },
        ],
      },
      LISTE,
    )
    assert.equal(a.nachrichten.length, 0)
    assert.equal(a.abgewiesen.length, 1)
    assert.equal(a.marke, '6')
  })

  it('sagt es, wenn Telegram ablehnt', () => {
    const a = telegramAuswerten({ ok: false, description: 'Unauthorized' }, LISTE)
    assert.equal(a.fehler, 'Unauthorized')
  })

  it('setzt keine Marke, wenn nichts kam', () => {
    assert.equal(telegramAuswerten({ ok: true, result: [] }, LISTE).marke, undefined)
  })
})

describe('Signal-Strom', () => {
  it('SCHNEIDET NUR GANZE ZEILEN — der Rest bleibt liegen', () => {
    const a = zeilenSchneiden('{"a":1}\n{"b":2}\n{"c":')
    assert.deepEqual(a.zeilen, ['{"a":1}', '{"b":2}'])
    assert.equal(a.rest, '{"c":')
  })

  it('setzt eine zerrissene Zeile ueber zwei Pakete wieder zusammen', () => {
    const eins = zeilenSchneiden('{"me')
    const zwei = zeilenSchneiden(`${eins.rest}thod":"x"}\n`)
    assert.deepEqual(zwei.zeilen, ['{"method":"x"}'])
    assert.equal(zwei.rest, '')
  })

  it('nimmt eine Nachricht aus einer receive-Meldung', () => {
    const zeile = JSON.stringify({
      jsonrpc: '2.0',
      method: 'receive',
      params: {
        envelope: {
          source: '+491700000000',
          sourceName: 'Papa',
          timestamp: 5000,
          dataMessage: { message: 'Bin gleich da.', timestamp: 5000 },
        },
      },
    })
    const a = signalZeile(zeile, LISTE)
    assert.equal(a?.nachrichten[0].text, 'Bin gleich da.')
  })

  it('geht an Antworten auf eigene Rufe vorbei', () => {
    assert.equal(signalZeile('{"jsonrpc":"2.0","id":"1","result":0}', LISTE), null)
  })

  it('WIRFT DIE VERBINDUNG BEI EINER KAPUTTEN ZEILE NICHT WEG', () => {
    assert.equal(signalZeile('{kaputt', LISTE), null)
  })
})
