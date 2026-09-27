import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SPALTEN, type Zeile, alsCsv, alsJson, alsPdf, alsXlsx, crc32, spaltenName, zipStore } from './protokollexport'

/** Echte Messwerte vom Gerät (der taktende Eingang, 2026-07-30). */
const ZEILEN: Zeile[] = [
  {
    t: Date.UTC(2026, 6, 30, 0, 7, 24),
    vbus: 5042,
    ibus: 30,
    vbat: 7358,
    ibat: -625,
    temp: 29.5,
    soc: 54,
    limit: 500,
    quelle: 'NICHT ANERKANNT',
    ladezustand: 'lädt nicht',
    regs: { '0x1b': '0x0f', '0x1c': '0x10', '0x20': '0x00' },
  },
  {
    t: Date.UTC(2026, 6, 30, 0, 7, 27),
    vbus: 1546,
    ibus: 0,
    vbat: 7359,
    ibat: -628,
    quelle: 'kein Eingang',
    regs: { '0x1c': '0x00' },
  },
]

describe('SPALTEN', () => {
  it('Register und Spannungen stehen nebeneinander - darum geht es', () => {
    const kopf = SPALTEN.map((s) => s.kopf)
    for (const muss of ['Zeit', 'VBUS mV', 'IBUS mA', 'Quelle', '0x1C', '0x20']) {
      assert.ok(kopf.includes(muss), `${muss} fehlt`)
    }
  })

  it('fehlende Werte werden leer, nicht zu Null', () => {
    // Eine 0 im Bericht läse sich wie eine Messung. Ein leeres Feld nicht.
    const s = SPALTEN.find((x) => x.kopf === 'Grad')
    assert.equal(s?.hol(ZEILEN[1]), '')
    assert.equal(s?.hol(ZEILEN[0]), '29.5')
  })
})

describe('alsCsv', () => {
  it('trennt mit Semikolon und trägt ein BOM', () => {
    // Beides für Excel: ohne Semikolon eine Spalte, ohne BOM "LadegerÃ¤t".
    const csv = alsCsv(ZEILEN)
    assert.ok(csv.startsWith('﻿'))
    assert.ok(csv.split('\r\n')[0].includes('Zeit;VBUS mV'))
  })

  it('eine Zeile je Messung plus Kopf', () => {
    assert.equal(alsCsv(ZEILEN).trim().split('\r\n').length, 3)
  })

  it('schützt Felder mit Semikolon oder Anführungszeichen', () => {
    const csv = alsCsv([{ ...ZEILEN[0], quelle: 'a;b"c' }])
    assert.ok(csv.includes('"a;b""c"'))
  })
})

describe('alsJson', () => {
  it('trägt Kopfdaten, Spaltennamen und Zeilen', () => {
    const j = JSON.parse(alsJson(ZEILEN, { geraet: 'MuPiHAT' }))
    assert.equal(j.geraet, 'MuPiHAT')
    assert.equal(j.zeilen.length, 2)
    assert.ok(j.spalten.includes('0x1C'))
    // Die Rohregister müssen erhalten bleiben - damit lässt sich nachprüfen.
    assert.equal(j.zeilen[0].regs['0x1c'], '0x10')
  })
})

describe('crc32 / zipStore / alsXlsx', () => {
  it('crc32 trifft den bekannten Wert', () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
  })

  it('spaltenName zählt wie Excel', () => {
    assert.equal(spaltenName(0), 'A')
    assert.equal(spaltenName(25), 'Z')
    assert.equal(spaltenName(26), 'AA')
  })

  it('zipStore schreibt die Signaturen an die richtigen Stellen', () => {
    const z = zipStore([{ name: 'a.txt', inhalt: 'hallo' }])
    const v = new DataView(z.buffer, z.byteOffset, z.byteLength)
    assert.equal(v.getUint32(0, true), 0x04034b50) // lokaler Kopf
    // Am Ende steht das Ende-Verzeichnis.
    assert.equal(v.getUint32(z.length - 22, true), 0x06054b50)
  })

  it('alsXlsx ist ein ZIP mit den fünf nötigen Teilen', () => {
    const x = alsXlsx(ZEILEN)
    const text = new TextDecoder('latin1').decode(x)
    for (const teil of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
    ]) {
      assert.ok(text.includes(teil), `${teil} fehlt`)
    }
    assert.equal(new DataView(x.buffer, x.byteOffset).getUint32(0, true), 0x04034b50)
  })

  it('Zahlen kommen als Zahl in die Tabelle, Text als Text', () => {
    const text = new TextDecoder('latin1').decode(alsXlsx(ZEILEN))
    assert.ok(text.includes('<v>5042</v>'), 'VBUS muss eine Zahl sein, sonst rechnet Excel nicht')
    assert.ok(text.includes('inlineStr'), 'Texte brauchen den inlineStr-Weg')
  })
})

describe('alsPdf', () => {
  it('ist ein PDF mit Querverweistabelle', () => {
    const p = new TextDecoder('latin1').decode(alsPdf(ZEILEN))
    assert.ok(p.startsWith('%PDF-1.4'))
    assert.ok(p.includes('xref'))
    assert.ok(p.trimEnd().endsWith('%%EOF'))
  })

  it('schreibt EIN Byte je Zeichen, sonst zerfallen die Umlaute', () => {
    // Mit UTF-8 stand im erzeugten PDF "StÃ¶rungen" - der Betrachter liest
    // WinAnsi, also ein Byte je Zeichen.
    const bytes = alsPdf([{ ...ZEILEN[0], quelle: 'Störung' }])
    const p = new TextDecoder('latin1').decode(bytes)
    assert.ok(p.includes('Störung'), 'Umlaut muss ein einzelnes Byte sein')
    assert.ok(!p.includes('Ã'), 'kein UTF-8-Vorzeichenbyte im PDF')
  })

  it('die Längenangabe zählt Bytes, nicht Zeichen', () => {
    // Strenge Betrachter lehnen die Datei sonst ab.
    const p = new TextDecoder('latin1').decode(alsPdf([{ ...ZEILEN[0], quelle: 'ÄÖÜ' }]))
    const m = /\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(p)
    assert.ok(m, 'kein Datenstrom gefunden')
    assert.equal(Number(m[1]), m[2].length)
  })

  it('der Bericht trägt Befunde UND die Kurve', () => {
    const p = new TextDecoder('latin1').decode(
      alsPdf(ZEILEN, 'Bericht', 'Untertitel', {
        kopfdaten: [['Platine', '3.4.1']],
        befunde: [{ was: 'Netzteil', wert: 'NICHT ANERKANNT', gewicht: 'fehler', bedeutung: 'Der Regler verwirft die Quelle.' }],
      }),
    )
    assert.ok(p.includes('(Befunde) Tj'))
    assert.ok(p.includes('NICHT ANERKANNT'))
    assert.ok(p.includes('(VINDPM 4,3 V) Tj'), 'die Schwelle gehört in die Kurve')
    // Ein Fehler wird als [!] markiert - im PDF gibt es keine Farbe zum Lesen.
    assert.ok(p.includes('[!] Netzteil'))
  })

  it('ohne Zeilen fällt nichts um', () => {
    const p = new TextDecoder('latin1').decode(alsPdf([]))
    assert.ok(p.startsWith('%PDF'))
  })
})
