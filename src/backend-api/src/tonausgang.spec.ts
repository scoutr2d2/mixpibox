/**
 * Die Regeln der Ausgangswahl — geprüft an den Fällen, in denen ein Fehler
 * still bliebe.
 *
 * Nichts hiervon ruft `pactl`. Was mit dem Prozess zu tun hat, steht in
 * server.ts; hier stehen die Entscheidungen, die man einer laufenden Box nicht
 * ansieht — vor allem die, welcher Name überhaupt in einen Prozessaufruf darf.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ausgaenge,
  ausgangWort,
  istAusgangsname,
  macAusSink,
  sinksAus,
  stroemeAus,
} from './tonausgang'

/* Die echte Ausgabe der Box .169 vom 08.08.2026 — samt der Fehlerzeile, die
 * `pactl` dort auf die Standardausgabe schreibt. Sie ist der Grund, warum
 * `sinksAus` filtert und nicht bloss zerlegt. */
const SINKS = [
  'Failed to load cookie file from cookie: No such file or directory',
  '62\talsa_output.platform-soc_107c000000_sound.stereo-fallback\tPipeWire\ts32le 2ch 48000Hz\tSUSPENDED',
  '40524\tbluez_output.DD_EE_FF_44_55_66.1\tPipeWire\ts24le 2ch 48000Hz\tRUNNING',
].join('\n')

describe('istAusgangsname', () => {
  it('lässt durch, was PipeWire wirklich vergibt', () => {
    assert.equal(istAusgangsname('bluez_output.DD_EE_FF_44_55_66.1'), true)
    assert.equal(istAusgangsname('alsa_output.platform-soc_107c000000_sound.stereo-fallback'), true)
  })

  it('lässt einen fuehrenden Bindestrich NICHT durch', () => {
    // DER GRUND FUER DIESEN RIEGEL: Der Name kommt aus dem Netz und geht in
    // einen Prozessaufruf. `execFile` ohne Shell macht `;` und `&&` wirkungslos
    // — ein Name, der mit `-` beginnt, waere fuer pactl aber eine OPTION, und
    // welche Optionen ein kuenftiges pactl kennt, weiss hier niemand.
    assert.equal(istAusgangsname('-h'), false)
    assert.equal(istAusgangsname('--version'), false)
  })

  it('lässt Leerzeichen, Schrägstriche und Steuerzeichen nicht durch', () => {
    assert.equal(istAusgangsname('a b'), false)
    assert.equal(istAusgangsname('../etc/passwd'), false)
    assert.equal(istAusgangsname('a;b'), false)
    assert.equal(istAusgangsname('a\nb'), false)
    assert.equal(istAusgangsname(''), false)
    assert.equal(istAusgangsname(null), false)
    assert.equal(istAusgangsname('x'.repeat(201)), false)
  })
})

describe('sinksAus', () => {
  it('nimmt die zwei echten Ausgänge und NICHT die Fehlerzeile', () => {
    // Ohne den Filter stuende „Failed to load cookie file…" als Ausgang in der
    // Liste — und am Schirm als waehlbarer Lautsprecher.
    assert.deepEqual(sinksAus(SINKS), [
      { name: 'alsa_output.platform-soc_107c000000_sound.stereo-fallback', laeuft: false },
      { name: 'bluez_output.DD_EE_FF_44_55_66.1', laeuft: true },
    ])
  })

  it('kommt mit leerer Ausgabe zurecht', () => {
    assert.deepEqual(sinksAus(''), [])
    assert.deepEqual(sinksAus(null), [])
  })
})

describe('stroemeAus', () => {
  it('nimmt die Kennungen der laufenden Ströme', () => {
    // SIE WERDEN GEBRAUCHT, weil ein laufender Strom die alte Wahl behaelt:
    // ohne `move-sink-input` hoerte man den Wechsel erst beim naechsten Stueck.
    const t = 'Failed to load cookie file\n71\t40524\t70\tPipeWire\ts16le 2ch 44100Hz\n72\t40524\t70\tPipeWire\t'
    assert.deepEqual(stroemeAus(t), ['71', '72'])
  })

  it('nimmt jeden Strom mit, egal auf welcher Senke', () => {
    const t = '71\t40524\t70\tPipeWire\ts16le 2ch 44100Hz\n90\t77\t88\tPipeWire\ts16le 2ch 44100Hz'
    assert.deepEqual(stroemeAus(t), ['71', '90'])
  })
})

describe('macAusSink', () => {
  it('holt die Adresse aus dem Bluetooth-Ausgang', () => {
    assert.equal(macAusSink('bluez_output.DD_EE_FF_44_55_66.1'), 'DD:EE:FF:44:55:66')
  })
  it('sagt beim eingebauten Ausgang nichts', () => {
    assert.equal(macAusSink('alsa_output.platform-soc_107c000000_sound.stereo-fallback'), null)
    assert.equal(macAusSink(''), null)
  })
})

describe('ausgangWort', () => {
  const BT = [{ mac: 'DD:EE:FF:44:55:66', name: 'Teufel ROCKSTER Cross' }]

  it('nimmt den Namen aus der Bluetooth-Liste', () => {
    assert.deepEqual(ausgangWort('bluez_output.DD_EE_FF_44_55_66.1', BT), {
      wort: 'Teufel ROCKSTER Cross',
      art: 'bluetooth',
    })
  })

  it('lässt die Adresse stehen, wenn das Gerät nicht in der Liste ist', () => {
    // EINE ADRESSE IST HAESSLICH, ABER WAHR. Ein erfundener Name
    // („Lautsprecher 2") waere eine Behauptung ueber ein Geraet, von dem die
    // Box nichts weiss.
    assert.deepEqual(ausgangWort('bluez_output.AA_BB_CC_DD_EE_FF.1', BT), {
      wort: 'AA:BB:CC:DD:EE:FF',
      art: 'bluetooth',
    })
  })

  it('nennt den eingebauten Ausgang beim Namen', () => {
    assert.deepEqual(ausgangWort('alsa_output.platform-soc_107c000000_sound.stereo-fallback', BT), {
      wort: 'Lautsprecher der Box',
      art: 'box',
    })
  })
})

describe('ausgaenge', () => {
  const BT = [{ mac: 'DD:EE:FF:44:55:66', name: 'Teufel ROCKSTER Cross' }]

  it('setzt die Box zuletzt und merkt sich, welcher gewählt ist', () => {
    // SORTIERT: Wer zwei Lautsprecher verbunden hat, will zwischen IHNEN
    // waehlen; die Box selbst ist der Rueckweg und steht deshalb unten.
    const a = ausgaenge(SINKS, 'bluez_output.DD_EE_FF_44_55_66.1', BT)
    assert.deepEqual(
      a.map((x) => [x.wort, x.gewaehlt, x.laeuft]),
      [
        ['Teufel ROCKSTER Cross', true, true],
        ['Lautsprecher der Box', false, false],
      ],
    )
  })

  it('ohne bekannte Vorgabe ist keiner gewählt — statt einen zu raten', () => {
    assert.equal(ausgaenge(SINKS, '', BT).filter((x) => x.gewaehlt).length, 0)
  })

})
