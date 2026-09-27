import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LEISE_PROZENT, istSprache, stroemeLesen, zuDaempfen } from './daempfen'

/** Echte Ausgabe der Box (gekuerzt), damit der Leser nicht geraten ist. */
const ECHT = `Sink Input #69
	Driver: PipeWire
	Volume: front-left: 65536 / 100% / 0.00 dB,   front-right: 65536 / 100% / 0.00 dB
		application.name = "PipeWire ALSA [librespot]"
		media.name = "ALSA Playback"
Sink Input #70
	Volume: front-left: 32768 /  50% / -6.02 dB,   front-right: 32768 /  50% / -6.02 dB
		application.name = "Chromium"
		media.name = "Playback"
`

describe('stroemeLesen', () => {
  it('liest Nummer, Name und Lautstaerke aus echter Ausgabe', () => {
    const s = stroemeLesen(ECHT)
    assert.equal(s.length, 2)
    assert.deepEqual(s[0], { id: 69, name: 'PipeWire ALSA [librespot]', prozent: 100 })
    assert.deepEqual(s[1], { id: 70, name: 'Chromium', prozent: 50 })
  })

  it('verwirft einen Eintrag NICHT, nur weil ein Feld fehlt', () => {
    // Das Format hat je nach PipeWire-Fassung mehr oder weniger Felder.
    const s = stroemeLesen('Sink Input #5\n\tDriver: PipeWire\n')
    assert.equal(s.length, 1)
    assert.equal(s[0].id, 5)
  })

  it('kommt mit leerer Eingabe zurecht', () => {
    assert.deepEqual(stroemeLesen(''), [])
    assert.deepEqual(stroemeLesen(undefined as unknown as string), [])
  })
})

describe('istSprache', () => {
  it('erkennt den Kiosk-Browser als Sprachausgabe', () => {
    // Die Ansage kommt aus Chromium - wer sie mitdaempft, erreicht nichts.
    assert.equal(istSprache('Chromium'), true)
    assert.equal(istSprache('chrome'), true)
  })

  it('erkennt die Musikdienste NICHT als Sprache', () => {
    assert.equal(istSprache('PipeWire ALSA [librespot]'), false)
    assert.equal(istSprache('mpv'), false)
  })

  it('kommt mit fehlendem Namen zurecht', () => {
    assert.equal(istSprache(''), false)
    assert.equal(istSprache(undefined as unknown as string), false)
  })
})

describe('zuDaempfen', () => {
  it('daempft die Musik, aber nicht die Sprache', () => {
    const s = stroemeLesen(ECHT)
    const d = zuDaempfen(s)
    assert.deepEqual(d.map((x) => x.id), [69])
  })

  it('daempft nur sanft - die Ansage folgt selbst der Box-Lautstaerke', () => {
    // 20 % waren zu tief: zusammen mit einer Sprache auf voller Lautstaerke
    // ergab das leise Musik und eine bruellende Ansage.
    assert.ok(LEISE_PROZENT >= 40, `zu tief: ${LEISE_PROZENT}`)
    assert.ok(LEISE_PROZENT < 70, `keine Daempfung mehr: ${LEISE_PROZENT}`)
  })

  it('laesst einen ohnehin leisen Strom in Ruhe', () => {
    // Sonst wird beim Wiederherstellen ein falscher Wert gesetzt.
    const d = zuDaempfen([{ id: 1, name: 'mpv', prozent: LEISE_PROZENT }])
    assert.deepEqual(d, [])
  })

  it('fasst die namenlosen Verbindungs-Stroeme der Tonkette NIE an', () => {
    // klangwerk.ausgang und entzerrer.ausgang sind sink-inputs OHNE
    // application.name (tonpfad.fixture.json, Knoten 62/71). Wer sie
    // daempft, senkt die ganze Kette statt einer Quelle — und beim
    // Wiederherstellen stuende sie schief (05.09.2026).
    const d = zuDaempfen([
      { id: 62, name: '', prozent: 100 },
      { id: 71, name: '', prozent: 100 },
      { id: 1, name: 'mpv', prozent: 100 },
    ])
    assert.deepEqual(d.map((x) => x.id), [1])
  })

  it('daempft mehrere Musikstroeme zugleich', () => {
    const d = zuDaempfen([
      { id: 1, name: 'mpv', prozent: 100 },
      { id: 2, name: 'PipeWire ALSA [librespot]', prozent: 80 },
      { id: 3, name: 'Chromium', prozent: 100 },
    ])
    assert.deepEqual(d.map((x) => x.id), [1, 2])
  })

  it('merkt sich die ALTE Lautstaerke je Strom', () => {
    // Beim Wiederherstellen muss jeder Strom seinen eigenen Wert
    // zurueckbekommen - pauschal 100 % waere bei einem leiser gestellten
    // Dienst schlicht falsch.
    const d = zuDaempfen([{ id: 7, name: 'mpv', prozent: 65 }])
    assert.equal(d[0].prozent, 65)
  })
})
