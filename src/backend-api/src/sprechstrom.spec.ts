/**
 * Zeugen fuer den Sprechstrom (Recht `sprechen`, 28.09.2026).
 *
 * Die Route laeuft hier ECHT (Express auf einem freien Port), nur Piper ist
 * gefaelscht: `sprich` liefert eine WAV mit so vielen Tonbytes, wie der Text
 * Zeichen hat. Damit laesst sich nachzaehlen, dass jedes Stueck ankommt, dass
 * der Strom vor dem Ende schon spielt und dass die fertige Datei stimmt.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import express from 'express'
import {
  SPRECH_TEMPO_MAX,
  SPRECH_TEMPO_MIN,
  SPRECH_TEXT_MAX,
  WAV_UNBEKANNT,
  sprechAblegen,
  sprechName,
  sprechRoute,
  sprechSpeicherDeckeln,
  stueckeBilden,
  tempoBiegen,
  wavKopf,
  wavZerlegen,
} from './sprechstrom'

/** Das fmt-Stueck einer Piper-Stimme: PCM, mono, 22050 Hz, 16 Bit. */
function format(rate = 22050): Buffer {
  const f = Buffer.alloc(16)
  f.writeUInt16LE(1, 0)
  f.writeUInt16LE(1, 2)
  f.writeUInt32LE(rate, 4)
  f.writeUInt32LE(rate * 2, 8)
  f.writeUInt16LE(2, 12)
  f.writeUInt16LE(16, 14)
  return f
}

function wav(pcm: Buffer, rate = 22050): Buffer {
  return Buffer.concat([wavKopf(format(rate), pcm.length), pcm])
}

describe('tempoBiegen', () => {
  it('biegt auf die Spanne und laesst Unbrauchbares zur Vorgabe werden', () => {
    assert.equal(tempoBiegen(undefined), 1)
    assert.equal(tempoBiegen('quatsch'), 1)
    assert.equal(tempoBiegen(0.1), SPRECH_TEMPO_MIN)
    assert.equal(tempoBiegen(9), SPRECH_TEMPO_MAX)
    assert.equal(tempoBiegen('1.15'), 1.15)
  })
})

describe('sprechName', () => {
  it('ist fuer denselben Text und dasselbe Tempo derselbe — und sonst nicht', () => {
    assert.equal(sprechName('Der Mond.', 1), sprechName('Der Mond.', 1))
    assert.notEqual(sprechName('Der Mond.', 1), sprechName('Der Mond.', 1.2))
    assert.notEqual(sprechName('Der Mond.', 1), sprechName('Die Sonne.', 1))
    assert.match(sprechName('x', 1), /^[0-9a-f]{32}$/)
  })
})

describe('stueckeBilden', () => {
  it('das erste Stueck ist der erste Satz allein — er bestimmt die Stille nach dem Antippen', () => {
    const s = stueckeBilden('Ein Mond ist ein Satellit. Er kreist um einen Planeten. Die Erde hat einen.')
    assert.equal(s[0], 'Ein Mond ist ein Satellit.')
    assert.equal(s[1], 'Er kreist um einen Planeten. Die Erde hat einen.')
  })

  it('schneidet nicht hinter einer Zahl — „am 1. Mai" ist kein Satzende', () => {
    assert.deepEqual(stueckeBilden('Am 1. Mai ist Feiertag. Dann ist frei.'), [
      'Am 1. Mai ist Feiertag.',
      'Dann ist frei.',
    ])
  })

  it('buendelt bis zum Deckel und teilt zu lange Saetze am Komma', () => {
    const satz = `${'Wort '.repeat(30).trim()}, ${'Wort '.repeat(30).trim()}.`
    const s = stueckeBilden(`Anfang. ${satz}`, 200)
    assert.ok(
      s.every((x) => x.length <= 200),
      s.map((x) => x.length).join(','),
    )
    assert.equal(s.join(' ').replace(/\s+/g, ' '), `Anfang. ${satz}`)
  })

  it('verliert kein Zeichen', () => {
    const text = 'Hunde sind Säugetiere. „Rüde" heißt das Männchen! Warum? Darum… 30.000 Jahre.'
    assert.equal(stueckeBilden(text, 40).join(' '), text)
  })
})

describe('wavZerlegen / wavKopf', () => {
  it('holt Format und Ton zurueck, auch mit einem LIST-Block vor data', () => {
    const pcm = Buffer.from([1, 2, 3, 4, 5, 6])
    const list = Buffer.concat([Buffer.from('LIST'), Buffer.from([3, 0, 0, 0]), Buffer.from('abc'), Buffer.from([0])])
    const kopf = wavKopf(format(), pcm.length)
    const mitList = Buffer.concat([kopf.subarray(0, 36), list, kopf.subarray(36), pcm])
    const z = wavZerlegen(mitList)
    assert.ok(z)
    assert.deepEqual([...z.pcm], [...pcm])
    assert.ok(z.format.equals(format()))
  })

  it('ein Strom-Kopf mit unbekannter Laenge heisst: bis zum Ende', () => {
    const pcm = Buffer.alloc(100, 7)
    const z = wavZerlegen(Buffer.concat([wavKopf(format(), WAV_UNBEKANNT), pcm]))
    assert.equal(z?.pcm.length, 100)
  })

  it('weist ab, was keine WAV ist', () => {
    assert.equal(wavZerlegen(Buffer.from('<html>kaputt</html>')), null)
  })
})

describe('sprechAblegen', () => {
  let ordner = ''
  beforeEach(() => {
    ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'sprech-'))
  })

  it('legt den Auftrag ab und nennt eine Adresse unter der Basis — gesprochen wird dabei nichts', async () => {
    const q = await sprechAblegen(
      '  Der   Mond. ',
      { tempo: 1.1 },
      { ordner, basis: 'http://127.0.0.1:8200/api/sprechen' },
      'mixpi-klexikon',
    )
    const name = sprechName('Der Mond.', 1.1)
    assert.deepEqual(q, { art: 'strom', adresse: `http://127.0.0.1:8200/api/sprechen/${name}.wav` })
    const auftrag = JSON.parse(fs.readFileSync(path.join(ordner, `${name}.json`), 'utf8'))
    assert.deepEqual(auftrag, { text: 'Der Mond.', tempo: 1.1, plugin: 'mixpi-klexikon' })
    assert.deepEqual(fs.readdirSync(ordner), [`${name}.json`], 'keine .tmp-Leiche, keine .wav')
  })

  it('wirft mit Klartext bei leerem oder zu langem Text', async () => {
    const a = { ordner, basis: 'http://x' }
    await assert.rejects(sprechAblegen('   ', {}, a, 'p'), /kein Text/)
    await assert.rejects(sprechAblegen('a'.repeat(SPRECH_TEXT_MAX + 1), {}, a, 'p'), /zu viel/)
    await assert.rejects(sprechAblegen(42, {}, a, 'p'), /kein Text/)
  })
})

describe('sprechRoute — echt ueber HTTP', () => {
  let ordner = ''
  let basis = ''
  let server: ReturnType<ReturnType<typeof express>['listen']>
  const gesprochen: { text: string; tempo: number }[] = []
  let sprichWert: (text: string) => Buffer | null = (text) => wav(Buffer.alloc(Buffer.byteLength(text), 1))
  const meldungen: string[] = []

  before(async () => {
    ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'sprech-route-'))
    const app = express()
    app.get(
      '/api/sprechen/:name',
      sprechRoute({
        ordner,
        sprich: async (text, tempo) => {
          gesprochen.push({ text, tempo })
          return sprichWert(text)
        },
        melden: (t) => meldungen.push(t),
      }),
    )
    await new Promise<void>((fertig) => {
      server = app.listen(0, '127.0.0.1', () => fertig())
    })
    basis = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sprechen`
  })
  after(() => server.close())
  beforeEach(() => {
    gesprochen.length = 0
    meldungen.length = 0
    sprichWert = (text) => wav(Buffer.alloc(Buffer.byteLength(text), 1))
  })

  it('spricht Stueck fuer Stueck, liefert eine spielbare WAV und legt sie danach ab', async () => {
    const text = 'Ein Mond ist ein Satellit. Er kreist um einen Planeten. Die Erde hat einen.'
    const q = await sprechAblegen(text, { tempo: 1.2 }, { ordner, basis }, 'test')
    const a = await fetch(q.adresse)
    assert.equal(a.status, 200)
    assert.equal(a.headers.get('content-type'), 'audio/wav')
    const b = Buffer.from(await a.arrayBuffer())
    const z = wavZerlegen(b)
    assert.ok(z, 'der Strom ist eine WAV')
    assert.equal(
      z.pcm.length,
      stueckeBilden(text).reduce((s, t) => s + Buffer.byteLength(t), 0),
    )
    assert.deepEqual(
      gesprochen.map((g) => g.tempo),
      [1.2, 1.2],
      'zwei Stuecke, beide im Tempo des Auftrags',
    )

    // Danach liegt die Datei da — mit richtiger Laenge im Kopf, und ohne Piper.
    await new Promise((r) => setTimeout(r, 50))
    const name = sprechName(text, 1.2)
    const datei = fs.readFileSync(path.join(ordner, `${name}.wav`))
    assert.equal(datei.readUInt32LE(40), z.pcm.length, 'data-Laenge steht im Kopf der Datei')
    gesprochen.length = 0
    const zweiter = await fetch(q.adresse, { headers: { range: 'bytes=0-9' } })
    assert.equal(zweiter.status, 206, 'die Datei ist spulbar')
    assert.equal(gesprochen.length, 0, 'der zweite Abruf rechnet nichts')
  })

  it('spricht NUR abgelegte Auftraege — nie einen Text aus der Anfrage', async () => {
    assert.equal((await fetch(`${basis}/${'0'.repeat(32)}.wav`)).status, 404)
    assert.equal((await fetch(`${basis}/..%2F..%2Fetc%2Fpasswd`)).status, 404)
    assert.equal((await fetch(`${basis}/Hallo%20Welt.wav`)).status, 404)
    assert.equal(gesprochen.length, 0)
  })

  it('antwortet ehrlich 503, wenn Piper schon beim ersten Stueck nicht kann — und speichert nichts', async () => {
    sprichWert = () => null
    const q = await sprechAblegen('Stille. Nichts.', {}, { ordner, basis }, 'test')
    const a = await fetch(q.adresse)
    assert.equal(a.status, 503)
    assert.ok(!fs.existsSync(path.join(ordner, `${sprechName('Stille. Nichts.', 1)}.wav`)))
    assert.match(meldungen.join('\n'), /Stueck 1 von 2 kam nicht/)
  })

  it('bricht der Dienst mitten im Text ab, endet der Strom — gespeichert wird die halbe Datei NICHT', async () => {
    let n = 0
    sprichWert = (text) => (++n === 1 ? wav(Buffer.alloc(Buffer.byteLength(text), 1)) : null)
    const text = 'Erster Satz. Zweiter Satz.'
    const q = await sprechAblegen(text, {}, { ordner, basis }, 'test')
    const a = await fetch(q.adresse)
    assert.equal(a.status, 200)
    await a.arrayBuffer()
    await new Promise((r) => setTimeout(r, 50))
    assert.ok(!fs.existsSync(path.join(ordner, `${sprechName(text, 1)}.wav`)))
  })

  it('ein Stimmwechsel mitten im Text (anderes Format) wird nicht zusammengeklebt', async () => {
    let n = 0
    sprichWert = (text) => wav(Buffer.alloc(Buffer.byteLength(text), 1), ++n === 1 ? 22050 : 16000)
    const q = await sprechAblegen('Eins. Zwei.', {}, { ordner, basis }, 'test')
    await (await fetch(q.adresse)).arrayBuffer()
    assert.match(meldungen.join('\n'), /anderes Format/)
  })
})

describe('sprechSpeicherDeckeln', () => {
  it('raeumt die aeltesten .wav bis unter den Deckel, alte Auftraege und .tmp-Leichen', async () => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'sprech-deckel-'))
    const jetzt = Date.now()
    const anlegen = (name: string, bytes: number, alterMs: number) => {
      const p = path.join(ordner, name)
      fs.writeFileSync(p, Buffer.alloc(bytes))
      const t = new Date(jetzt - alterMs)
      fs.utimesSync(p, t, t)
    }
    anlegen('alt.wav', 600, 3000)
    anlegen('mittel.wav', 600, 2000)
    anlegen('neu.wav', 600, 1000)
    anlegen('frisch.json', 10, 1000)
    anlegen('uralt.json', 10, 61 * 86_400_000)
    anlegen('leiche.wav.1.x.tmp', 10, 2 * 3_600_000)
    const meldungen: string[] = []
    await sprechSpeicherDeckeln(ordner, 1300, 60, (t) => meldungen.push(t), jetzt)
    assert.deepEqual(fs.readdirSync(ordner).sort(), ['frisch.json', 'mittel.wav', 'neu.wav'])
    assert.equal(meldungen.length, 1)
  })
})
