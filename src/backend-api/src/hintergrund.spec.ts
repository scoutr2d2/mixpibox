/**
 * Hintergrundbilder (E144): erkannt am Inhalt, benannt nach dem Inhalt,
 * und eine fremde Themendatei kann keinen vorhandenen Namen kapern.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  alsDatenAdresse,
  anhaengePruefen,
  bildArt,
  bildBenennen,
  bildNamenUmschreiben,
  datenAdresseLesen,
  GROESSTE_BYTES,
  istBildName,
} from './hintergrund'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9])
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1])
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')

describe('hintergrund.ts', () => {
  it('erkennt die Art an den ersten Bytes', () => {
    assert.equal(bildArt(PNG), 'png')
    assert.equal(bildArt(JPG), 'jpg')
    assert.equal(bildArt(WEBP), 'webp')
    assert.equal(bildArt(SVG), null)
  })

  it('benennt nach dem Inhalt — gleicher Inhalt, gleicher Name', () => {
    const a = bildBenennen(PNG)
    assert.ok(a && istBildName(a.name) && a.name.endsWith('.png'))
    assert.equal(bildBenennen(new Uint8Array(PNG))?.name, a?.name)
    assert.notEqual(bildBenennen(JPG)?.name, a?.name)
  })

  it('lehnt Leeres, Fremdes und Uebergrosses ab', () => {
    assert.equal(bildBenennen(new Uint8Array()), null)
    assert.equal(bildBenennen(SVG), null)
    const gross = new Uint8Array(GROESSTE_BYTES + 1)
    gross.set(JPG)
    assert.equal(bildBenennen(gross), null)
  })

  it('data:-Adresse hin und zurueck', () => {
    const n = bildBenennen(JPG)?.name as string
    const url = alsDatenAdresse(n, JPG)
    assert.match(url, /^data:image\/jpeg;base64,/)
    assert.deepEqual(datenAdresseLesen(url), JPG)
    assert.equal(datenAdresseLesen('data:image/svg+xml;base64,PHN2Zz4='), null)
    assert.equal(datenAdresseLesen('https://example.org/x.jpg'), null)
  })

  it('Anhaenge werden NEU benannt — ein mitgebrachter Name wird nicht geglaubt', () => {
    const gelogen = '0000000000000000.jpg'
    const b = anhaengePruefen({ [gelogen]: alsDatenAdresse(gelogen, JPG) })
    assert.deepEqual(b.fehler, [])
    assert.equal(b.bilder.length, 1)
    assert.notEqual(b.bilder[0].name, gelogen)
    assert.equal(b.bilder[0].name, bildBenennen(JPG)?.name)
    const umgeschrieben = bildNamenUmschreiben(
      { hintergrund: { art: 'bild', bild: gelogen } },
      new Map([[gelogen, b.bilder[0].name]]),
    )
    assert.deepEqual(umgeschrieben, { hintergrund: { art: 'bild', bild: b.bilder[0].name } })
  })

  it('Anhaenge: kaputte Namen, fremde Inhalte und zu viele werden mit Satz abgelehnt', () => {
    assert.equal(anhaengePruefen(undefined).fehler.length, 0)
    assert.ok(anhaengePruefen({ '../x.jpg': alsDatenAdresse('a.jpg', JPG) }).fehler[0].includes('Bildname'))
    const n = '1111111111111111.png'
    assert.ok(anhaengePruefen({ [n]: 'data:image/png;base64,PHN2Zz4=' }).fehler[0].includes('JPEG'))
    const drei = Object.fromEntries(['a', 'b', 'c'].map((c) => [`${c.repeat(16)}.png`, alsDatenAdresse('x.png', PNG)]))
    assert.ok(anhaengePruefen(drei).fehler[0].includes('hoechstens'))
  })
})
