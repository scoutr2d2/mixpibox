import assert from 'node:assert/strict'
import fs, { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { Punkt } from './systemverlauf'
import { BYTES_JE_PUNKT, MAX_PUNKTE, MESS_MS } from './systemverlauf'
import {
  anhaengenAn,
  ladenVon,
  mussVerdichten,
  reiheLesen,
  UEBERHANG,
  verdichten,
  zeileAus,
} from './systemverlaufablage'

const T0 = 1_800_000_000_000
// Ein Schritt ist ein MESSTAKT, keine feste Minute.
const p = (m: number, c = 13): Punkt => ({ t: T0 + m * MESS_MS, c, m: 35, g: 46.9, l: 53 })

let ordner = ''
const wo = (name: string) => join(ordner, name)

before(() => {
  ordner = mkdtempSync(join(tmpdir(), 'systemverlauf-'))
})
after(() => {
  rmSync(ordner, { recursive: true, force: true })
})

describe('zeileAus', () => {
  it('eine Zeile je Punkt, mit Umbruch', () => {
    const z = zeileAus(p(0))
    assert.ok(z.endsWith('\n'))
    assert.equal(z.split('\n').length, 2)
    assert.deepEqual(JSON.parse(z), p(0))
  })

  it('eine Zeile bleibt unter den BYTES_JE_PUNKT, mit denen die Rechnung arbeitet', () => {
    // Die Rechnung in systemverlauf.ts (`aufwandAnhaengen`) setzt
    // BYTES_JE_PUNKT an. Waere die Zeile in Wahrheit laenger, waere die ganze
    // Kartenrechnung zu guenstig — und eine zu guenstige Rechnung ist der
    // Grund, warum jemand spaeter eine kaputte Karte in der Hand haelt.
    // Der SCHLIMMSTE Fall: dreistellige Werte ueberall, Last ueber 16.
    const voll = zeileAus({ t: 1_800_000_000_000, c: 100, m: 100, g: 100.5, l: 1600 })
    assert.ok(Buffer.byteLength(voll) <= BYTES_JE_PUNKT, `${Buffer.byteLength(voll)} Bytes: ${voll}`)
    // Der gewoehnliche Fall liegt darunter — die Rechnung ist also nicht nur
    // nicht zu guenstig, sie ist leicht zu teuer. So herum ist es richtig.
    assert.ok(Buffer.byteLength(zeileAus(p(0))) < BYTES_JE_PUNKT)
  })
})

describe('reiheLesen', () => {
  it('liest eine gewoehnliche Reihe', () => {
    const g = reiheLesen([p(0), p(1), p(2)].map(zeileAus).join(''))
    assert.equal(g.punkte.length, 3)
    assert.equal(g.verworfen, 0)
  })

  it('EINE HALB GESCHRIEBENE ZEILE kostet einen Punkt, nicht die Reihe', () => {
    // Das ist der Grund fuer das Format. Bei EINEM JSON-Wert je Datei waere
    // an dieser Stelle alles weg.
    const text = `${zeileAus(p(0))}${zeileAus(p(1))}{"t":18000000006,"c":1`
    const g = reiheLesen(text)
    assert.equal(g.punkte.length, 2)
    assert.equal(g.verworfen, 1)
  })

  it('NULLBYTES aus einem Stromausfall kosten genau ihre Zeile', () => {
    // ext4 gibt fuer einen zugewiesenen, aber nie geschriebenen Block Nullen
    // zurueck. Genau dieses Fenster behandelt mupibox-sicherung.py bei
    // data.json und akkuverlauf.json als Sonderfall — hier ist es einer.
    const text = `${zeileAus(p(0))}\0\0\0\0\0\n${zeileAus(p(2))}`
    const g = reiheLesen(text)
    assert.equal(g.punkte.length, 2)
    assert.equal(g.verworfen, 1)
  })

  it('leere Zeilen sind KEIN Verwurf', () => {
    // Eine Datei, die mit \n endet, hat immer eine leere letzte Zeile. Wuerde
    // sie zaehlen, meldete jede gesunde Datei einen Fehler.
    assert.deepEqual(reiheLesen(`${zeileAus(p(0))}\n\n`), { punkte: [p(0)], verworfen: 0 })
    assert.deepEqual(reiheLesen(''), { punkte: [], verworfen: 0 })
  })

  it('gueltiges JSON, das kein Punkt ist, faellt ebenfalls heraus', () => {
    const g = reiheLesen('{"hallo":1}\n[1,2,3]\nnull\n')
    assert.equal(g.punkte.length, 0)
    assert.equal(g.verworfen, 3)
  })
})

describe('ladenVon', () => {
  it('eine FEHLENDE Datei ist kein Fehler — beim ersten Start gibt es sie nicht', () => {
    assert.deepEqual(ladenVon(wo('gibtsnicht.jsonl')), { punkte: [], verworfen: 0, zeilen: 0 })
  })

  it('eine UNLESBARE Datei ist kein Fehler — die Reihe faengt neu an', () => {
    // Eine Messreihe darf nie der Grund sein, warum der Server nicht hochkommt.
    const pfad = wo('unfug.jsonl')
    fs.writeFileSync(pfad, 'das hier ist gar kein JSON\nund das auch nicht\n')
    const s = ladenVon(pfad)
    assert.deepEqual(s.punkte, [])
    assert.equal(s.verworfen, 2)
    assert.equal(s.zeilen, 2)
  })

  it('ein VERZEICHNIS statt einer Datei wirft nicht', () => {
    assert.deepEqual(ladenVon(ordner).punkte, [])
  })

  it('zaehlt die Zeilen der Datei — daran haengt die Verdichtung', () => {
    const pfad = wo('zaehlen.jsonl')
    fs.writeFileSync(pfad, `${[p(0), p(1)].map(zeileAus).join('')}kaputt\n`)
    assert.equal(ladenVon(pfad).zeilen, 3)
  })
})

describe('anhaengenAn', () => {
  it('haengt an, statt neu zu schreiben — der fruehere Inhalt bleibt stehen', () => {
    const pfad = wo('anhaengen.jsonl')
    anhaengenAn(pfad, [p(0), p(1)])
    anhaengenAn(pfad, [p(2)])
    const s = ladenVon(pfad)
    assert.equal(s.punkte.length, 3)
    assert.deepEqual(
      s.punkte.map((x) => x.t),
      [p(0).t, p(1).t, p(2).t],
    )
  })

  it('gibt zurueck, was es geschrieben hat — die Zahl fuer die Messung', () => {
    const pfad = wo('bytes.jsonl')
    const bytes = anhaengenAn(pfad, [p(0), p(1)])
    assert.equal(bytes, fs.statSync(pfad).size)
  })

  it('nichts anzuhaengen legt auch keine Datei an', () => {
    const pfad = wo('leer.jsonl')
    assert.equal(anhaengenAn(pfad, []), 0)
    assert.equal(fs.existsSync(pfad), false)
  })
})

describe('mussVerdichten', () => {
  it('erst UEBER dem Ring plus Ueberhang', () => {
    assert.equal(mussVerdichten(MAX_PUNKTE), false)
    assert.equal(mussVerdichten(MAX_PUNKTE + UEBERHANG), false)
    assert.equal(mussVerdichten(MAX_PUNKTE + UEBERHANG + 1), true)
  })

  it('der Ueberhang ist ein Tag, im jeweiligen Messtakt', () => {
    // EIN TAG, in Punkten des jeweiligen Taktes.
    assert.equal(UEBERHANG * MESS_MS, 86_400_000)
  })
})

describe('verdichten', () => {
  it('kuerzt die Datei auf die uebergebene Reihe', () => {
    const pfad = wo('verdichten.jsonl')
    anhaengenAn(pfad, [p(0), p(1), p(2), p(3)])
    verdichten(pfad, [p(2), p(3)])
    const s = ladenVon(pfad)
    assert.equal(s.zeilen, 2)
    assert.equal(s.punkte[0].t, p(2).t)
  })

  it('laesst KEINE Nebendatei liegen', () => {
    const pfad = wo('neben.jsonl')
    anhaengenAn(pfad, [p(0)])
    verdichten(pfad, [p(0)])
    assert.equal(fs.existsSync(`${pfad}.neu`), false)
  })

  it('nach dem Verdichten wird weiter ANGEHAENGT, nicht ueberschrieben', () => {
    const pfad = wo('weiter.jsonl')
    anhaengenAn(pfad, [p(0), p(1)])
    verdichten(pfad, [p(1)])
    anhaengenAn(pfad, [p(2)])
    assert.equal(ladenVon(pfad).punkte.length, 2)
  })

  it('eine leere Reihe leert die Datei, statt sie stehen zu lassen', () => {
    const pfad = wo('leeren.jsonl')
    anhaengenAn(pfad, [p(0)])
    verdichten(pfad, [])
    assert.equal(fs.statSync(pfad).size, 0)
    assert.deepEqual(ladenVon(pfad).punkte, [])
  })
})

describe('UEBERLAUF DES RINGSPEICHERS — der ganze Weg', () => {
  it('die Datei waechst ueber den Ring hinaus und wird EINMAL gekuerzt', () => {
    // Klein nachgestellt (Ring 100, Ueberhang 20), weil der echte Fall eine
    // Woche dauert. Gemessen wird, dass die Datei zwischendurch groesser
    // sein DARF als der Ring — das ist der Preis des Anhaengens — und dass
    // nach dem Verdichten genau der Ring dasteht.
    const pfad = wo('ring.jsonl')
    const ring = 100
    const ueberhang = 20
    let reihe: Punkt[] = []
    let zeilen = 0
    let verdichtungen = 0
    for (let i = 0; i < 500; i++) {
      const punkt = p(i)
      reihe = [...reihe, punkt].slice(-ring)
      anhaengenAn(pfad, [punkt])
      zeilen++
      if (mussVerdichten(zeilen, ring, ueberhang)) {
        verdichten(pfad, reihe)
        zeilen = reihe.length
        verdichtungen++
      }
    }
    const s = ladenVon(pfad)
    assert.ok(s.zeilen <= ring + ueberhang, `${s.zeilen} Zeilen`)
    assert.equal(s.punkte[s.punkte.length - 1].t, p(499).t)
    // 500 Punkte, alle 21 Punkte einmal verdichtet -> weniger als 20 Mal
    // die ganze Datei geschrieben, statt 500 Mal.
    assert.ok(verdichtungen > 0 && verdichtungen < 25, `${verdichtungen} Verdichtungen`)
  })
})
