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
  mixpiLeersenken,
  sinksAus,
  stroemeAus,
} from './tonausgang'

/* Die echte Ausgabe der Box .169 vom 08.08.2026 — samt der Fehlerzeile, die
 * `pactl` dort auf die Standardausgabe schreibt. Sie ist der Grund, warum
 * `sinksAus` filtert und nicht bloss zerlegt. */
const SINKS = [
  'Failed to load cookie file from cookie: No such file or directory',
  '62\talsa_output.platform-soc_107c000000_sound.stereo-fallback\tPipeWire\ts32le 2ch 48000Hz\tSUSPENDED',
  '40524\tbluez_output.7C_96_D2_89_35_CC.1\tPipeWire\ts24le 2ch 48000Hz\tRUNNING',
].join('\n')

describe('istAusgangsname', () => {
  it('lässt durch, was PipeWire wirklich vergibt', () => {
    assert.equal(istAusgangsname('bluez_output.7C_96_D2_89_35_CC.1'), true)
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
      { name: 'bluez_output.7C_96_D2_89_35_CC.1', laeuft: true },
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

  it('lässt Ströme in einer geschonten Senke stehen', () => {
    // DER FALL: Der Mitschnitt parkt seinen Aufnahme-Strom absichtlich still
    // in der Leersenke (Kennung 77). Ein Elternteil wechselt auf Bluetooth —
    // ohne Schonliste wanderte der stumme Strom mit und toente ploetzlich
    // auf dem Lautsprecher, und die Aufnahme griffe den falschen Weg ab.
    const t = ['71\t40524\t70\tPipeWire\ts16le 2ch 44100Hz', '90\t77\t88\tPipeWire\ts16le 2ch 44100Hz'].join('\n')
    assert.deepEqual(stroemeAus(t, new Set(['77'])), ['71'])
  })

  it('ohne Schonliste wandert alles — wie bisher', () => {
    const t = '71\t40524\t70\tPipeWire\ts16le 2ch 44100Hz\n90\t77\t88\tPipeWire\ts16le 2ch 44100Hz'
    assert.deepEqual(stroemeAus(t), ['71', '90'])
    assert.deepEqual(stroemeAus(t, new Set()), ['71', '90'])
  })
})

describe('mixpiLeersenken', () => {
  it('findet die Kennung der Leersenke — und nur ihre', () => {
    // Die Senkenliste einer Box mit ausgerollter Leersenke: die zwei echten
    // Ausgaenge bleiben draussen, `mixpi-mitschnitt` (Kennung 77) faellt
    // unter die Schonung. Kennungen statt Namen, weil die Stromliste die
    // Senke nur als Nummer traegt.
    const t = [
      'Failed to load cookie file from cookie: No such file or directory',
      '62\talsa_output.platform-soc_107c000000_sound.stereo-fallback\tPipeWire\ts32le 2ch 48000Hz\tSUSPENDED',
      '77\tmixpi-mitschnitt\tPipeWire\tfloat32le 2ch 48000Hz\tIDLE',
      '40524\tbluez_output.7C_96_D2_89_35_CC.1\tPipeWire\ts24le 2ch 48000Hz\tRUNNING',
    ].join('\n')
    assert.deepEqual(mixpiLeersenken(t), new Set(['77']))
  })

  it('der Entzerrer ist KEINE mixpi-Senke und wandert weiter mit', () => {
    // `entzerrer` ist gewachsener Bestand ohne mixpi-Praefix — seine Stroeme
    // sollen dem Ausgangswechsel weiter folgen.
    const t = '80\tentzerrer\tPipeWire\tfloat32le 2ch 48000Hz\tRUNNING'
    assert.deepEqual(mixpiLeersenken(t), new Set())
  })

  it('kommt mit leerer Ausgabe zurecht', () => {
    assert.deepEqual(mixpiLeersenken(''), new Set())
    assert.deepEqual(mixpiLeersenken(null), new Set())
  })
})

describe('macAusSink', () => {
  it('holt die Adresse aus dem Bluetooth-Ausgang', () => {
    assert.equal(macAusSink('bluez_output.7C_96_D2_89_35_CC.1'), '7C:96:D2:89:35:CC')
  })
  it('sagt beim eingebauten Ausgang nichts', () => {
    assert.equal(macAusSink('alsa_output.platform-soc_107c000000_sound.stereo-fallback'), null)
    assert.equal(macAusSink(''), null)
  })
})

describe('ausgangWort', () => {
  const BT = [{ mac: '7C:96:D2:89:35:CC', name: 'Teufel ROCKSTER Cross' }]

  it('nimmt den Namen aus der Bluetooth-Liste', () => {
    assert.deepEqual(ausgangWort('bluez_output.7C_96_D2_89_35_CC.1', BT), {
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
  const BT = [{ mac: '7C:96:D2:89:35:CC', name: 'Teufel ROCKSTER Cross' }]

  it('setzt die Box zuletzt und merkt sich, welcher gewählt ist', () => {
    // SORTIERT: Wer zwei Lautsprecher verbunden hat, will zwischen IHNEN
    // waehlen; die Box selbst ist der Rueckweg und steht deshalb unten.
    const a = ausgaenge(SINKS, 'bluez_output.7C_96_D2_89_35_CC.1', BT)
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

  it('mixpi-Senken stehen NICHT im Angebot — wer sie wählte, parkte alles dauerhaft im Stummen', () => {
    // Seit der Schonung laesst der Rueckwechsel Leersenken liegen; eine
    // waehlbare Leersenke waere damit eine Einbahnstrasse in die Stille
    // (Befund der Ableger-Pruefung, 22.08.2026).
    const mit = `${String(SINKS)}\n77\tmixpi-mitschnitt\tmodule-null-sink.c\ts16le 2ch 44100Hz\tIDLE`
    const a = ausgaenge(mit, '', BT)
    assert.equal(
      a.some((x) => x.name.startsWith('mixpi-')),
      false,
    )
    assert.equal(a.length, 2, 'die echten Ausgaenge bleiben')
  })
})
