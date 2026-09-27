import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  LUECKE_MS,
  SENDETAKT_MS,
  MAX_SITZUNGEN,
  MIN_SEKUNDEN,
  SCHLAG_MAX_MS,
  abschliessen,
  anhaengen,
  dienstAus,
  nachDienst,
  nachTag,
  schlagVerarbeiten,
  verlaufNormalisieren,
  type OffeneSitzung,
} from './verlauf'

/** Der Takt der Oberflaeche — 2 s, gemessen in NewDesign/app.js. */
const TAKT = 2000

/** Eine Folge von Herzschlaegen durchspielen. Die Uhr ist ein Argument. */
function laufen(
  schlaege: { key: string; bei: number }[],
): { offen: OffeneSitzung | null; fertig: ReturnType<typeof abschliessen>[] } {
  let offen: OffeneSitzung | null = null
  const fertig: ReturnType<typeof abschliessen>[] = []
  for (const s of schlaege) {
    const r = schlagVerarbeiten(offen, { key: s.key }, s.bei)
    offen = r.offen
    if (r.fertig) fertig.push(r.fertig)
  }
  return { offen, fertig }
}

describe('Mitschnitt: der Dienst am Schluessel', () => {
  it('liest den Dienst aus dem Kopf des Schluessels', () => {
    assert.equal(dienstAus('ard:10378841'), 'ard')
    assert.equal(dienstAus('spotify:2hp3IHxHhTrUt4q2buTKTT'), 'spotify')
    assert.equal(dienstAus('jellyfin:abc'), 'jellyfin')
  })

  it('raet nicht — was keinen brauchbaren Kopf hat, heisst sonstige', () => {
    assert.equal(dienstAus('ohnedoppelpunkt'), 'sonstige')
    assert.equal(dienstAus(':leer'), 'sonstige')
    assert.equal(dienstAus('MIT GROSS UND LEER:x'), 'sonstige')
    assert.equal(dienstAus(null), 'sonstige')
    assert.equal(dienstAus(''), 'sonstige')
  })
})

describe('Mitschnitt: die Dauer ist gemessen, nicht geschaetzt', () => {
  it('zaehlt die Abstaende zwischen den Schlaegen — 30 Schlaege sind eine Minute', () => {
    const schlaege = Array.from({ length: 31 }, (_, i) => ({ key: 'ard:1', bei: 1000 + i * TAKT }))
    const { offen } = laufen(schlaege)
    assert.equal(Math.round(offen!.sekunden), 60)
  })

  it('DIE STILLE ZAEHLT NICHT: vier Stunden Stillstand geben keine vier Stunden', () => {
    // Genau der Fall, um den es geht: Box laeuft, Kind laeuft weg. Nach der
    // Luecke ist Schluss — die Wanduhr haette hier 4 h behauptet.
    const { offen, fertig } = laufen([
      { key: 'ard:1', bei: 0 },
      { key: 'ard:1', bei: TAKT },
      { key: 'ard:1', bei: 4 * 3600_000 }, // vier Stunden spaeter
    ])
    // Die alte Sitzung WURDE geschlossen — sie hat nur nichts hinterlassen,
    // weil zwei Sekunden unter MIN_SEKUNDEN liegen. Genau so soll es sein:
    // ein Fehlgriff gehoert nicht in den Verlauf.
    assert.equal(fertig.length, 0, 'die 2-s-Sitzung wird nicht aufgeschrieben')
    assert.equal(offen!.sekunden, 0, 'die neue faengt bei null an')
    assert.equal(offen!.beginn, 4 * 3600_000)
  })

  it('eine lange Sitzung wird nach der Luecke sehr wohl aufgeschrieben', () => {
    const lang = Array.from({ length: 60 }, (_, i) => ({ key: 'ard:1', bei: i * TAKT }))
    const { fertig } = laufen([...lang, { key: 'ard:1', bei: 60 * TAKT + LUECKE_MS + 1000 }])
    assert.equal(fertig.length, 1)
    assert.equal(fertig[0]!.sekunden, 118, 'die gehoerte Zeit, nicht die Pause danach')
  })

  it('kappt einen einzelnen Abstand — eine haengende Verbindung erfindet keine Minuten', () => {
    const { offen } = laufen([
      { key: 'ard:1', bei: 0 },
      { key: 'ard:1', bei: SCHLAG_MAX_MS + 5000 }, // unter der Luecke, aber lang
    ])
    assert.ok(SCHLAG_MAX_MS + 5000 < LUECKE_MS, 'der Fall liegt wirklich unter der Luecke')
    assert.equal(offen!.sekunden, SCHLAG_MAX_MS / 1000, 'gekappt, nicht voll gutgeschrieben')
  })

  it('eine zurueckspringende Uhr macht die Zeit nicht negativ', () => {
    // Auf der Box stellt sich die Uhr nach dem Start per NTP.
    const { offen } = laufen([
      { key: 'ard:1', bei: 10_000 },
      { key: 'ard:1', bei: 12_000 },
      { key: 'ard:1', bei: 3_000 },
    ])
    assert.ok(offen!.sekunden >= 0)
    assert.equal(offen!.sekunden, 2, 'die zwei echten Sekunden bleiben stehen')
  })

  it('ein Wechsel des Werks schliesst die alte Sitzung ab', () => {
    const lang = Array.from({ length: 20 }, (_, i) => ({ key: 'ard:1', bei: i * TAKT }))
    const { offen, fertig } = laufen([...lang, { key: 'spotify:2', bei: 20 * TAKT }])
    assert.equal(fertig.length, 1)
    assert.equal(fertig[0]!.key, 'ard:1')
    assert.equal(fertig[0]!.dienst, 'ard')
    assert.equal(fertig[0]!.sekunden, 38)
    assert.equal(offen!.key, 'spotify:2')
    assert.equal(offen!.sekunden, 0)
  })
})

describe('Mitschnitt: was gar nicht erst aufgeschrieben wird', () => {
  it('Durchblaettern erzeugt keine Zeilen — zu kurz faellt weg', () => {
    assert.equal(abschliessen({ beginn: 0, ende: 1, sekunden: 1, key: 'ard:1', dienst: 'ard' }), null)
    assert.equal(abschliessen(null), null)
    const gerade = abschliessen({
      beginn: 0,
      ende: 1,
      sekunden: MIN_SEKUNDEN,
      key: 'ard:1',
      dienst: 'ard',
    })
    assert.equal(gerade?.sekunden, MIN_SEKUNDEN, 'ab der Grenze wird es behalten')
  })

  it('anhaengen deckelt und wirft die ALTEN weg, nicht die neuen', () => {
    let liste = Array.from({ length: MAX_SITZUNGEN }, (_, i) => ({
      beginn: i,
      ende: i,
      sekunden: 10,
      key: `ard:${i}`,
      dienst: 'ard',
    }))
    liste = anhaengen(liste, { beginn: 99999, ende: 99999, sekunden: 10, key: 'ard:neu', dienst: 'ard' })
    assert.equal(liste.length, MAX_SITZUNGEN)
    assert.equal(liste[liste.length - 1].key, 'ard:neu', 'das Neueste steht hinten')
    assert.equal(liste[0].key, 'ard:1', 'das Aelteste ist gefallen')
  })
})

describe('Mitschnitt: welcher Dienst wie lange', () => {
  const s = [
    { beginn: 1000, ende: 2000, sekunden: 600, key: 'ard:1', dienst: 'ard' },
    { beginn: 5000, ende: 6000, sekunden: 300, key: 'ard:2', dienst: 'ard' },
    { beginn: 9000, ende: 9500, sekunden: 1200, key: 'spotify:1', dienst: 'spotify' },
  ]

  it('zaehlt je Dienst zusammen, der laengste zuerst', () => {
    const d = nachDienst(s)
    assert.deepEqual(d, [
      { dienst: 'spotify', sekunden: 1200, anzahl: 1 },
      { dienst: 'ard', sekunden: 900, anzahl: 2 },
    ])
  })

  it('achtet auf den Zeitraum — eine Sitzung zaehlt, wo sie BEGANN', () => {
    const d = nachDienst(s, 4000, 10000)
    assert.deepEqual(d.map((x) => x.dienst), ['spotify', 'ard'])
    assert.equal(d.find((x) => x.dienst === 'ard')!.sekunden, 300, 'die erste liegt davor')
  })

  it('zaehlt je Tag, das Neueste zuerst', () => {
    const tag = (ms: number) => (ms < 5000 ? '2026-08-14' : '2026-08-15')
    assert.deepEqual(nachTag(s, tag), [
      { tag: '2026-08-15', sekunden: 1500, anzahl: 2 },
      { tag: '2026-08-14', sekunden: 600, anzahl: 1 },
    ])
  })
})

describe('Mitschnitt: was von der Platte kommt, ist Verdacht', () => {
  it('wirft Unsinn heraus, statt ihn in die Statistik zu lassen', () => {
    const raus = verlaufNormalisieren([
      { beginn: 1, ende: 2, sekunden: 10, key: 'ard:1' },
      { beginn: 'gestern', ende: 2, sekunden: 10, key: 'ard:2' },
      { beginn: 3, ende: 4, sekunden: -5, key: 'ard:3' },
      { beginn: 5, ende: 6, sekunden: 10, key: '' },
      null,
      'kaputt',
    ])
    assert.equal(raus.length, 1)
    assert.equal(raus[0].key, 'ard:1')
    assert.equal(raus[0].dienst, 'ard', 'der Dienst wird nachgetragen, wenn er fehlt')
  })

  it('vertraegt eine kaputte Datei ohne zu werfen', () => {
    assert.deepEqual(verlaufNormalisieren(null), [])
    assert.deepEqual(verlaufNormalisieren({ nicht: 'eine Liste' }), [])
  })
})

describe('SENDETAKT_MS gegen den echten Sender (E74)', () => {
  // DIE ZAHL GEHOERT NICHT DIESEM MODUL. Gesetzt wird sie in NewDesign/app.js
  // als `TAKT_MERKEN`; hier steht nur eine Kopie, und Kopien laufen
  // auseinander. Genau so entstand E74: der Kopfkommentar behauptete zwei
  // Sekunden, der Sender schickte alle sechzig, und dazwischen zaehlte der
  // Verlauf ein Sechstel der Hoerzeit.
  const APP = new URL('../../../NewDesign/app.js', import.meta.url)

  it('stimmt mit TAKT_MERKEN in NewDesign/app.js ueberein', () => {
    const quelle = readFileSync(APP, 'utf8')
    const treffer = quelle.match(/const\s+TAKT_MERKEN\s*=\s*(\d+)/)
    assert.ok(treffer, 'TAKT_MERKEN nicht gefunden — wurde es umbenannt?')
    assert.equal(
      Number(treffer[1]),
      SENDETAKT_MS,
      'der Sender meldet in einem anderen Takt, als dieses Modul annimmt — genau der Fehler aus E74',
    )
  })

  it('die Luecke ist LAENGER als der Sendetakt — sonst zerschneidet jede Meldung die Sitzung', () => {
    // Das ist die Bedingung, deren Verletzung E74 war. Sie steht hier als
    // Verhaeltnis und nicht als Zahl: wer den Takt aendert, soll sie mitziehen
    // muessen, nicht raten.
    assert.ok(LUECKE_MS > SENDETAKT_MS, `${LUECKE_MS} muss groesser sein als ${SENDETAKT_MS}`)
  })

  it('ein einzelner Abstand darf einen vollen Sendetakt gutschreiben', () => {
    // Weniger waere Unterschlagung: der normale Abstand IST der Sendetakt.
    assert.ok(SCHLAG_MAX_MS >= SENDETAKT_MS, `${SCHLAG_MAX_MS} darf nicht unter ${SENDETAKT_MS} liegen`)
    assert.ok(SCHLAG_MAX_MS < LUECKE_MS, 'aber unter der Luecke bleiben')
  })

  it('eine Stunde Hoeren zaehlt als rund eine Stunde, nicht als zehn Minuten', () => {
    // Der Fall aus E74, in einer Zeile: 60 Meldungen im Sendetakt.
    let offen = null
    let summe = 0
    for (let i = 0; i <= 60; i++) {
      const r = schlagVerarbeiten(offen, { key: 'spotify:1', titel: 'T', artist: 'A' }, i * SENDETAKT_MS)
      if (r.fertig) summe += r.fertig.sekunden
      offen = r.offen
    }
    if (offen) summe += offen.sekunden
    assert.ok(summe >= 3400, `eine Stunde muss als rund 3600 s zaehlen, gezaehlt wurden ${summe}`)
  })
})
