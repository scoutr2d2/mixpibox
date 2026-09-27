import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { antwort, kontext as pruefstand } from '../pruefstand.mjs'
import plugin, { SPIELRAUM_VORGABE, auswaehlen, lrcZerlegen, sucheAdresse } from './index.mjs'

/**
 * Zeugen fuer mixpi-lrclib — ohne Box, ohne Netz.
 *
 * DIE ECHTEN DAUERN DER QUELLE STEHEN HIER DRIN, nicht erfundene. Gemessen am
 * 05.09.2026 mit tools/songtext-quellen-probe.py gegen lrclib.net:
 * "Radiohead - Creep" hat 20 Treffer mit 12 verschiedenen Dauern — 236,0 /
 * 236,2 / 239,0 sind alle die Studiofassung, 259 die Collector's Edition,
 * 292 das Reading Festival, 311 ein Live-Mitschnitt aus Stockholm.
 *
 * DER SCHWERPUNKT LIEGT AUF DEM NICHT-LIEFERN. Ein fehlender Text ist ein
 * Schoenheitsfehler; ein Text, der Wort fuer Wort stimmt und um zweieinhalb
 * Minuten versetzt laeuft, schickt den naechsten Sucher an die Zeitbasis —
 * also an die Stelle, an der der Fehler NICHT ist.
 *
 * Der Text in den Zeitmarken ist bewusst ein Platzhalter: ein Zeuge braucht
 * die Struktur, nicht das Werk (Songtexte sind geschuetzt).
 */

/** So sieht eine Antwort von /api/search aus — Felder echt, Text ersetzt. */
const TREFFER = [
  { id: 1, artistName: 'Radiohead', trackName: 'Creep', albumName: 'Live in Stockholm', duration: 311.0, instrumental: false, syncedLyrics: '[00:20.00]live' },
  { id: 2, artistName: 'Radiohead', trackName: 'Creep', albumName: 'Reading Festival', duration: 292.0, instrumental: false, syncedLyrics: '[00:18.00]reading' },
  { id: 3, artistName: 'Radiohead', trackName: 'Creep', albumName: "Pablo Honey (Collector's)", duration: 259.0, instrumental: false, syncedLyrics: '[00:16.00]collectors' },
  { id: 4, artistName: 'Radiohead', trackName: 'Creep', albumName: 'Pablo Honey', duration: 239.0, instrumental: false, syncedLyrics: '[00:19.16]studio' },
  { id: 5, artistName: 'Radiohead', trackName: 'Creep', albumName: 'Music', duration: 236.2, instrumental: false, syncedLyrics: '[00:19.00]studio-variante' },
]

const ADRESSE = sucheAdresse('Radiohead', 'Creep')

function mitTreffern(treffer, einstellungen = {}) {
  return pruefstand({ antworten: { [ADRESSE]: JSON.stringify(treffer) }, einstellungen })
}

describe('lrcZerlegen', () => {
  it('liest Minuten, Sekunden und Hundertstel', () => {
    const z = lrcZerlegen('[00:12.00]eins\n[01:03.25]zwei')
    assert.deepEqual(z, [
      { zeitMs: 12000, text: 'eins' },
      { zeitMs: 63250, text: 'zwei' },
    ])
  })

  it('wirft Kopfzeilen weg, statt sie bei Sekunde 0 zu zeigen', () => {
    const z = lrcZerlegen('[ar:Wer]\n[ti:Was]\n[length:03:59]\n[00:05.00]los')
    assert.equal(z.length, 1)
    assert.equal(z[0].text, 'los')
  })

  it('macht aus einem Refrain mit zwei Marken zwei Zeilen', () => {
    const z = lrcZerlegen('[00:10.00][01:20.00]kehrt wieder')
    assert.deepEqual(z.map((x) => x.zeitMs), [10000, 80000])
  })

  it('behaelt leere Texte MIT Marke — das sind die Pausen', () => {
    const z = lrcZerlegen('[00:10.00]singt\n[00:14.00]\n[00:20.00]wieder')
    assert.equal(z.length, 3)
    assert.equal(z[1].text, '')
  })

  it('sortiert, auch wenn die Quelle es nicht tut', () => {
    assert.deepEqual(lrcZerlegen('[00:30.00]spaet\n[00:05.00]frueh').map((x) => x.text), ['frueh', 'spaet'])
  })

  it('vertraegt Leeres, ohne zu werfen', () => {
    for (const leer of ['', null, undefined, 'ganz ohne Marke']) {
      assert.deepEqual(lrcZerlegen(leer), [])
    }
  })
})

describe('auswaehlen — die Dublettenfalle', () => {
  it('nimmt die passende Dauer, NICHT den ersten Treffer', () => {
    // Die Liste beginnt mit dem Live-Mitschnitt (311 s). Waere der erste
    // Treffer gut genug, liefe der Text 72 Sekunden versetzt.
    assert.equal(auswaehlen(TREFFER, 239)?.id, 4)
  })

  it('nimmt die GERINGSTE Abweichung, nicht die erste passende', () => {
    // 236,2 und 239 liegen beide im Spielraum von 237; 236,2 ist naeher.
    assert.equal(auswaehlen(TREFFER, 237)?.id, 5)
  })

  it('gibt NICHTS zurueck, wenn keine Fassung passt', () => {
    // Ein 200-s-Schnitt: die naechste Fassung ist 36 s entfernt.
    assert.equal(auswaehlen(TREFFER, 200), null)
  })

  it('waehlt NICHT ohne eigene Dauer — Radio hat keine', () => {
    for (const ohne of [0, -1, Number.NaN, undefined]) {
      assert.equal(auswaehlen(TREFFER, ohne), null, `Dauer ${ohne}`)
    }
  })

  it('ueberspringt Instrumentales — dort gibt es nichts zu singen', () => {
    const nur = [{ id: 9, duration: 239, instrumental: true, syncedLyrics: '[00:01.00]x' }]
    assert.equal(auswaehlen(nur, 239), null)
  })

  it('nimmt unsynchronen Text, wenn nichts Synchrones passt', () => {
    // Fuer das Vollbild zum Selberlesen — mehr laesst sich daraus nicht machen.
    const nur = [{ id: 10, duration: 239, plainLyrics: 'nur text', syncedLyrics: null }]
    assert.equal(auswaehlen(nur, 239)?.id, 10)
  })

  it('SYNCHRON schlaegt unsynchron, auch wenn der andere naeher liegt', () => {
    // Mitlaufen ist mehr wert als eine Sekunde bei einer gerundeten Laenge.
    const beides = [
      { id: 11, duration: 239.0, plainLyrics: 'nur text', syncedLyrics: null },
      { id: 12, duration: 241.0, syncedLyrics: '[00:01.00]x' },
    ]
    assert.equal(auswaehlen(beides, 239)?.id, 12)
  })

  it('der Dauer-Riegel gilt AUCH fuer unsynchronen Text', () => {
    // DER HOERSPIEL-FALL, gemessen: LRCLIB hat zu "Bibi Blocksberg — Die neue
    // Schule" 20 Treffer, alle ohne Zeitmarken und alle ohne Bezug zur Folge.
    // Ein Riegel nur fuer den synchronen Weg zeigte dort einen fremden Text.
    const fremd = [{ id: 13, duration: 205, plainLyrics: 'irgendein Lied', syncedLyrics: null }]
    assert.equal(auswaehlen(fremd, 2400), null)
  })

  it('folgt dem eingestellten Spielraum in beide Richtungen', () => {
    // Enger eingestellt: die 236,2-Fassung faellt bei 239 heraus.
    assert.equal(auswaehlen(TREFFER, 239, 1)?.id, 4)
    // Weiter eingestellt: bei 250 s kommt die Collector's Edition (259 s) in
    // Reichweite — mit der Vorgabe von 5 s ist dort nichts nah genug.
    assert.equal(auswaehlen(TREFFER, 250, 10)?.id, 3)
    assert.equal(auswaehlen(TREFFER, 250, SPIELRAUM_VORGABE), null)
  })
})

describe('sucheAdresse', () => {
  it('fragt nach Interpret UND Titel, ohne Album', () => {
    const a = sucheAdresse('Nena', '99 Luftballons')
    assert.ok(a.startsWith('https://lrclib.net/api/search?'))
    assert.ok(a.includes('artist_name=Nena'))
    assert.ok(a.includes('track_name=99+Luftballons'))
    // Das Album wird BEWUSST nicht mitgeschickt: bei lokaler Wiedergabe kennt
    // die Box es oft nicht, und /api/get riegelt genau darauf ab.
    assert.ok(!a.includes('album'))
  })

  it('kodiert Sonderzeichen, statt die Adresse zu zerreissen', () => {
    const a = sucheAdresse('AC/DC', 'Highway to Hell')
    assert.ok(a.includes('AC%2FDC'))
  })
})

describe('songtext — der ganze Weg', () => {
  it('liefert die Zeilen der passenden Fassung', async () => {
    const { k, geholt, protokoll } = mitTreffern(TREFFER)
    const r = await plugin.songtext({ interpret: 'Radiohead', titel: 'Creep', dauerSek: 239 }, k)
    assert.deepEqual(r.zeilen, [{ zeitMs: 19160, text: 'studio' }])
    assert.deepEqual(geholt, [ADRESSE])
    assert.ok(protokoll.some((z) => z.includes('239')), protokoll.join(' | '))
  })

  it('bleibt LEER, wenn keine Fassung zur Dauer passt', async () => {
    const { k, protokoll } = mitTreffern(TREFFER)
    const r = await plugin.songtext({ interpret: 'Radiohead', titel: 'Creep', dauerSek: 200 }, k)
    assert.deepEqual(r.zeilen, [])
    // Der Grund gehoert ins Journal — nicht auf den Schirm des Kindes.
    assert.ok(protokoll.some((z) => z.includes('keiner passt')), protokoll.join(' | '))
  })

  it('fragt das Netz GAR NICHT, wenn die Dauer fehlt', async () => {
    // Ohne Dauer waere jede Wahl geraten; dann ist auch die Anfrage unnoetig.
    const { k, geholt } = mitTreffern(TREFFER)
    const r = await plugin.songtext({ interpret: 'Radiohead', titel: 'Creep', dauerSek: 0 }, k)
    assert.deepEqual(r.zeilen, [])
    assert.deepEqual(geholt, [])
  })

  it('fragt das Netz GAR NICHT ohne Interpret oder Titel', async () => {
    const { k, geholt } = mitTreffern(TREFFER)
    assert.deepEqual((await plugin.songtext({ interpret: '', titel: 'Creep', dauerSek: 239 }, k)).zeilen, [])
    assert.deepEqual((await plugin.songtext({ interpret: 'Radiohead', titel: '', dauerSek: 239 }, k)).zeilen, [])
    assert.deepEqual(geholt, [])
  })

  it('macht aus einer leeren Trefferliste eine leere Antwort — kein Wurf', async () => {
    // DER HOERSPIEL-FALL, und er ist der haeufigste: LRCLIB kennt die Folge
    // schlicht nicht (in der Stichprobe 0 von 5). Das ist ein Ergebnis, kein
    // Fehler — ein Kind soll keine Fehlermeldung sehen.
    const hoerspiel = sucheAdresse('Bibi Blocksberg', 'Die neue Schule')
    const { k } = pruefstand({ antworten: { [hoerspiel]: '[]' } })
    const r = await plugin.songtext({ interpret: 'Bibi Blocksberg', titel: 'Die neue Schule', dauerSek: 2400 }, k)
    assert.deepEqual(r.zeilen, [])
  })

  it('liefert unsynchronen Text als "absaetze", nicht als "zeilen"', async () => {
    // Die Trennung ist der Punkt: aus `absaetze` kann die Oberflaeche gar
    // keine mitlaufende Anzeige bauen, und genau das ist beabsichtigt.
    const nurText = [{ id: 20, duration: 239, plainLyrics: 'erste\nzweite\n\ndritte', syncedLyrics: null }]
    const { k, protokoll } = mitTreffern(nurText)
    const r = await plugin.songtext({ interpret: 'Radiohead', titel: 'Creep', dauerSek: 239 }, k)
    assert.equal(r.zeilen, undefined)
    assert.deepEqual(r.absaetze, ['erste', 'zweite', '', 'dritte'])
    assert.ok(protokoll.some((z) => z.includes('OHNE Zeitmarken')), protokoll.join(' | '))
  })

  it('nimmt einen 404 als Auskunft, nicht als Fehler', async () => {
    const { k } = pruefstand({ antworten: { [ADRESSE]: () => antwort('', { ok: false, status: 404 }) } })
    const r = await plugin.songtext({ interpret: 'Radiohead', titel: 'Creep', dauerSek: 239 }, k)
    assert.deepEqual(r.zeilen, [])
  })

  it('wirft bei einem echten Serverfehler', async () => {
    // 500 ist etwas anderes als "kenne ich nicht" — das darf nicht als
    // "kein Text" durchgehen, sonst sieht ein Ausfall aus wie ein Hoerspiel.
    const { k } = pruefstand({ antworten: { [ADRESSE]: () => antwort('', { ok: false, status: 500 }) } })
    await assert.rejects(
      () => plugin.songtext({ interpret: 'Radiohead', titel: 'Creep', dauerSek: 239 }, k),
      /500/,
    )
  })

  it('sagt es, wenn die Antwort kein JSON ist', async () => {
    const { k } = pruefstand({ antworten: { [ADRESSE]: '<html>Fehlerseite</html>' } })
    await assert.rejects(
      () => plugin.songtext({ interpret: 'Radiohead', titel: 'Creep', dauerSek: 239 }, k),
      /nicht mit JSON/,
    )
  })

  it('sagt klar, wenn das Recht "netz" fehlt', async () => {
    const { k } = pruefstand({ netz: false })
    await assert.rejects(
      () => plugin.songtext({ interpret: 'Radiohead', titel: 'Creep', dauerSek: 239 }, k),
      /Recht "netz"/,
    )
  })

  it('folgt dem eingestellten Spielraum', async () => {
    const { k } = mitTreffern(TREFFER, { dauerSpielraum: 25 })
    // Mit 25 s Spielraum kommt bei 257 s die Collector's Edition in Reichweite.
    const r = await plugin.songtext({ interpret: 'Radiohead', titel: 'Creep', dauerSek: 257 }, k)
    assert.deepEqual(r.zeilen, [{ zeitMs: 16000, text: 'collectors' }])
  })
})

describe('befinden', () => {
  it('nennt den Spielraum, damit man ihn ohne Quelltext sieht', () => {
    const { k } = pruefstand({ einstellungen: { dauerSpielraum: 3 } })
    const b = plugin.befinden(k)
    assert.equal(b.ok, true)
    assert.ok(b.text.includes('3'))
  })

  it('sagt, was fehlt, statt nur "ok" zu melden', () => {
    const { k } = pruefstand({ netz: false })
    const b = plugin.befinden(k)
    assert.equal(b.ok, false)
    assert.ok(b.text.includes('netz'))
  })
})
