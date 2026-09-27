import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LEDS,
  QUELLEN,
  REVISIONEN,
  befunde,
  ladezustandAus,
  quelleAus,
  revisionHinweise,
  standAusGrenze,
  stoerungen,
  taktet,
} from './hatdiagnose'

/** Echte Registerwerte vom Gerät (2026-07-29/30). */
const TAKTEND_A = { s1: 0x10, f0: 0x00, f1: 0x00 } // "nicht anerkannt"
const TAKTEND_B = { s1: 0x00, f0: 0x00, f1: 0x00 } // "kein Eingang"
const LAEDT = { s0: 0x8f, s1: 0x67, f0: 0x00, f1: 0x00 } // DCP + Schnellladung

describe('quelleAus / ladezustandAus', () => {
  it('liest die echten Werte vom Gerät', () => {
    // 0x67 = 0b0110_0111 -> CHG_STAT 011 (Schnellladung), VBUS_STAT 0011 (DCP)
    assert.equal(quelleAus(0x67), 0x3)
    assert.equal(ladezustandAus(0x67), 0x3)
    // 0x10 = 0b0001_0000 -> VBUS_STAT 1000 = nicht anerkannt, CHG_STAT 000
    assert.equal(quelleAus(0x10), 0x8)
    assert.equal(ladezustandAus(0x10), 0x0)
  })

  it('ohne Register keine Aussage', () => {
    assert.equal(quelleAus(undefined), null)
    assert.equal(ladezustandAus(undefined), null)
  })
})

describe('stoerungen', () => {
  it('am Gerät waren BEIDE Fehlerregister leer - also nichts kaputt', () => {
    assert.deepEqual(stoerungen(0x00, 0x00), [])
  })

  it('benennt gesetzte Bits', () => {
    assert.ok(stoerungen(0x80, 0x00).includes('Eingangsspannung zu hoch'))
    assert.ok(stoerungen(0x00, 0x80).includes('Chip zu heiß (Abschaltung)'))
  })

  it('mehrere gleichzeitig', () => {
    assert.equal(stoerungen(0xc0, 0x40).length, 3)
  })
})

describe('taktet', () => {
  it('EIN Registersatz kann kein Takten zeigen', () => {
    // Genau die Falle: wer einmal liest, erwischt 0x8 oder 0x0 und hält es
    // für den Dauerzustand.
    assert.equal(taktet([TAKTEND_A]), false)
  })

  it('erkennt den Wechsel über die Reihe', () => {
    assert.equal(taktet([TAKTEND_A, TAKTEND_A, TAKTEND_B, TAKTEND_A]), true)
  })

  it('ein stabiler Eingang taktet nicht', () => {
    assert.equal(taktet([LAEDT, LAEDT, LAEDT]), false)
  })
})

describe('befunde', () => {
  it('der Fehlerfall vom Gerät: Netzteil wird verworfen', () => {
    const b = befunde({
      reihe: [TAKTEND_A, TAKTEND_B, TAKTEND_A],
      vbusMv: [5042, 1546, 1379, 5044],
      limitMa: 500,
    })
    const netz = b.find((x) => x.was === 'Netzteil')
    assert.equal(netz?.gewicht, 'fehler')
    assert.ok(netz?.wert.includes('NICHT ANERKANNT'))
    assert.ok(netz?.bedeutung?.includes('20 W'))

    // Der Spannungseinbruch wird eigenständig erkannt.
    assert.equal(b.find((x) => x.was === 'Eingangsspannung')?.gewicht, 'fehler')
    // Und keine Störung - es ist eben NICHT defekt.
    assert.equal(b.find((x) => x.was === 'Störungen')?.wert, 'keine')
  })

  it('der gute Fall vom Gerät: es lädt', () => {
    const b = befunde({ reihe: [LAEDT, LAEDT], vbusMv: [4965, 4970], limitMa: 2230, tempC: 61 })
    assert.equal(b.find((x) => x.was === 'Netzteil')?.gewicht, 'ok')
    assert.equal(b.find((x) => x.was === 'Ladevorgang')?.wert, 'Schnellladung')
    assert.equal(b.find((x) => x.was === 'Eingangsspannung')?.gewicht, 'ok')
    assert.equal(b.find((x) => x.was === 'Eingangsstrom-Grenze')?.gewicht, 'ok')
  })

  it('500 mA wird als "kein Vertrag" benannt', () => {
    const b = befunde({ reihe: [TAKTEND_A], limitMa: 500 })
    assert.equal(b.find((x) => x.was === 'Eingangsstrom-Grenze')?.gewicht, 'warnung')
  })

  it('über der Hardware-Grenze von 2,2 A wird gewarnt', () => {
    const b = befunde({ reihe: [LAEDT], limitMa: 2700 })
    const g = b.find((x) => x.was === 'Eingangsstrom-Grenze')
    assert.equal(g?.gewicht, 'warnung')
    assert.ok(g?.bedeutung?.includes('Kühlkörper'))
  })

  it('eine echte Störung schlägt alles andere', () => {
    const b = befunde({ reihe: [{ s1: 0x67, f0: 0x00, f1: 0x80 }] })
    assert.equal(b[0].was, 'Störungen')
    assert.equal(b[0].gewicht, 'fehler')
  })

  it('Temperatur: 61 Grad beim Laden ist in Ordnung, 90 nicht', () => {
    assert.equal(
      befunde({ reihe: [LAEDT], tempC: 61 }).find((x) => x.was.startsWith('Temperatur'))?.gewicht,
      'ok',
    )
    assert.equal(
      befunde({ reihe: [LAEDT], tempC: 90 }).find((x) => x.was.startsWith('Temperatur'))?.gewicht,
      'fehler',
    )
  })
})

describe('revisionHinweise', () => {
  it('sagt AUSDRÜCKLICH, dass die Chip-Kennung den Platinenstand nicht verrät', () => {
    const h = revisionHinweise({ teil: 0x08 })
    assert.ok(h[0].bedeutung?.includes('NICHT zur Bestimmung des Platinenstands'))
  })

  it('über 5,5 V am Eingang beweist USB-PD', () => {
    const h = revisionHinweise({ maxVbusMv: 9000 })
    assert.equal(h.find((x) => x.was === 'USB-PD')?.gewicht, 'ok')
  })

  it('5 V allein beweist gar nichts', () => {
    assert.equal(revisionHinweise({ maxVbusMv: 5044 }).find((x) => x.was === 'USB-PD'), undefined)
  })

  it('500 mA sagt etwas über das Netzteil, nicht über die Platine', () => {
    const h = revisionHinweise({ limitMa: 500 })
    const g = h.find((x) => x.was === 'Ausgehandelte Eingangsgrenze')
    assert.equal(g?.gewicht, 'warnung')
    assert.ok(g?.bedeutung?.includes('nicht über die Platine'))
  })
})

describe('Datenblatt-Daten', () => {
  it('die vier LEDs sind vollständig', () => {
    assert.deepEqual(
      LEDS.map((l) => l.name),
      ['PWR', 'STATUS', 'PLUG', 'CAP_MIS'],
    )
    // Der entscheidende Hinweis für die Fehlersuche.
    assert.ok(LEDS[0].hinweis?.includes('NICHT vorgesehen'))
  })

  it('die Platinenstände decken 2.0 bis 3.4.1 ab', () => {
    const staende = REVISIONEN.map((r) => r.stand)
    assert.ok(staende.includes('2.0'))
    assert.ok(staende.includes('3.2'))
    assert.ok(staende.includes('3.4.1'))
    // Das Erratum von 3.0 darf nicht verlorengehen - es kann Hardware kosten.
    assert.ok(REVISIONEN.find((r) => r.stand === '3.0')?.aenderungen.some((a) => a.includes('ERRATUM')))
  })

  it('die Quellen-Tabelle kennt den Fehlerfall', () => {
    assert.equal(QUELLEN[0x8], 'NICHT ANERKANNT')
  })
})

describe('standAusGrenze — die Revision aus der Eingangsgrenze', () => {
  it('erkennt die 2.2 an ihren 1780 mA', () => {
    // Am Gerät gemessen; die Änderungsliste nennt für 2.2 genau 1,75 A.
    assert.match(standAusGrenze(1780)!.stand, /2\.2/)
  })

  it('erkennt die 3.x an ihren 2230 mA', () => {
    // Datenblatt S. 15: "limited to 2.2A".
    assert.match(standAusGrenze(2230)!.stand, /3\.x/)
  })

  it('sagt bei 500 mA GAR NICHTS statt etwas Falsches', () => {
    // Das ist der ausgehandelte Wert eines schwachen Netzteils - er sagt
    // etwas über die QUELLE, nicht über die Platine.
    assert.equal(standAusGrenze(500), null)
    assert.equal(standAusGrenze(900), null)
  })

  it('benennt einen unbekannten Wert als solchen', () => {
    const r = standAusGrenze(3000)
    assert.match(r!.stand, /kein bekannter/)
    assert.match(r!.warum, /überschrieben/)
  })

  it('nennt in jeder Aussage die Quelle der Zahl', () => {
    for (const ma of [1780, 2230, 3000]) {
      assert.match(standAusGrenze(ma)!.warum, /Änderungsliste|Datenblatt|dokumentierten/)
    }
  })
})
