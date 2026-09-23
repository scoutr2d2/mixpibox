/**
 * Tests der Songtext-Logik (BACKLOG E84/B2).
 *
 * DIE ECHTEN DAUERN DER QUELLE STEHEN HIER DRIN, nicht erfundene. Gemessen am
 * 05.09.2026 mit `tools/songtext-quellen-probe.py` gegen lrclib.net:
 *
 *   Radiohead - Creep          236,0 / 236,2 / 239,0 (Studio)
 *                              259,0 (Collector's) / 292,0 (Reading Festival)
 *                              311,0 (Live in Stockholm)
 *   Queen - Bohemian Rhapsody  263 bis 415 s ueber 14 Fassungen
 *
 * DER SCHWERPUNKT LIEGT AUF DEM NICHT-ANZEIGEN. Ein fehlender Text ist ein
 * Schoenheitsfehler; ein Text, der Wort fuer Wort stimmt und um zweieinhalb
 * Minuten versetzt laeuft, schickt den naechsten Sucher an die Zeitbasis —
 * also an die Stelle, an der der Fehler NICHT ist. Deshalb pruefen die
 * meisten Faelle hier, dass NICHTS zurueckkommt.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DAUER_SPIELRAUM_S,
  ZEILEN_DECKEL,
  type Fassung,
  fassungWaehlen,
  lrcZerlegen,
  zeileJetzt,
} from './songtext'

// Zeitmarken echt, Text bewusst als Platzhalter — ein Zeuge braucht die
// Struktur, nicht das Werk (Songtexte sind geschuetzt, siehe B2).
const LRC = ['[00:12.00]erste', '[00:15.50]zweite', '[01:03.25]dritte'].join('\n')

test('lrcZerlegen liest Minuten, Sekunden und Hundertstel', () => {
  const zeilen = lrcZerlegen(LRC)
  assert.equal(zeilen.length, 3)
  assert.deepEqual(zeilen[0], { zeitMs: 12_000, text: 'erste' })
  assert.deepEqual(zeilen[1], { zeitMs: 15_500, text: 'zweite' })
  assert.deepEqual(zeilen[2], { zeitMs: 63_250, text: 'dritte' })
})

test('lrcZerlegen wirft die Kopfzeilen weg, statt sie bei Sekunde 0 zu zeigen', () => {
  // [ar:…] sieht aus wie eine Marke und ist eine Angabe UEBER das Stueck.
  const mitKopf = ['[ar:Wer]', '[ti:Was]', '[length:03:59]', '[00:05.00]los'].join('\n')
  const zeilen = lrcZerlegen(mitKopf)
  assert.equal(zeilen.length, 1)
  assert.equal(zeilen[0].text, 'los')
})

test('lrcZerlegen macht aus mehreren Marken an einer Zeile mehrere Zeilen', () => {
  // Im Format ueblich fuer Refrains.
  const refrain = '[00:10.00][01:20.00]kehrt wieder'
  const zeilen = lrcZerlegen(refrain)
  assert.equal(zeilen.length, 2)
  assert.deepEqual(
    zeilen.map((z) => z.zeitMs),
    [10_000, 80_000],
  )
})

test('lrcZerlegen behaelt leere Texte MIT Marke — das sind die Pausen', () => {
  const mitPause = ['[00:10.00]singt', '[00:14.00]', '[00:20.00]singt wieder'].join('\n')
  const zeilen = lrcZerlegen(mitPause)
  assert.equal(zeilen.length, 3)
  assert.equal(zeilen[1].text, '')
})

test('lrcZerlegen sortiert nach Zeit, auch wenn die Quelle es nicht tut', () => {
  const verdreht = ['[00:30.00]spaet', '[00:05.00]frueh'].join('\n')
  assert.deepEqual(
    lrcZerlegen(verdreht).map((z) => z.text),
    ['frueh', 'spaet'],
  )
})

test('lrcZerlegen deckelt die Zeilenzahl — eine Anzeige ist kein Katalog', () => {
  const viel = Array.from({ length: ZEILEN_DECKEL + 50 }, (_, i) => `[00:${String(i % 60).padStart(2, '0')}.00]z`).join('\n')
  assert.equal(lrcZerlegen(viel).length, ZEILEN_DECKEL)
})

test('lrcZerlegen vertraegt Leeres, ohne zu werfen', () => {
  assert.deepEqual(lrcZerlegen(''), [])
  assert.deepEqual(lrcZerlegen(null), [])
  assert.deepEqual(lrcZerlegen(undefined), [])
  assert.deepEqual(lrcZerlegen('ganz ohne Marke'), [])
})

// ── Die Dublettenfalle ────────────────────────────────────────────────────

/** Die echten Fassungen von „Creep", wie LRCLIB sie fuehrt. */
const CREEP: Fassung[] = [
  { dauerSek: 311, synchron: '[00:20.00]live-stockholm' },
  { dauerSek: 292, synchron: '[00:18.00]reading-festival' },
  { dauerSek: 259, synchron: '[00:16.00]collectors' },
  { dauerSek: 239, synchron: '[00:19.16]studio' },
  { dauerSek: 236.2, synchron: '[00:19.00]studio-variante' },
]

test('fassungWaehlen nimmt die passende Dauer, NICHT den ersten Treffer', () => {
  // Die Liste beginnt mit dem Live-Mitschnitt (311 s). Waer der erste Treffer
  // gut genug, stuende hier "live-stockholm" — und der Text liefe 72 s versetzt.
  const ergebnis = fassungWaehlen(CREEP, 239)
  assert.ok('text' in ergebnis)
  assert.equal(ergebnis.text.fassungDauerSek, 239)
  assert.equal(ergebnis.text.zeilen[0].text, 'studio')
})

test('fassungWaehlen nimmt die GERINGSTE Abweichung, nicht die erste passende', () => {
  // 236,2 und 239 liegen beide im Spielraum von 237; 236,2 ist naeher.
  const ergebnis = fassungWaehlen(CREEP, 237)
  assert.ok('text' in ergebnis)
  assert.equal(ergebnis.text.fassungDauerSek, 236.2)
})

test('fassungWaehlen bleibt LEER, wenn keine Fassung zur Dauer passt', () => {
  // Ein 200-s-Schnitt: die naechste Fassung ist 36 s entfernt. Nichts zeigen.
  const ergebnis = fassungWaehlen(CREEP, 200)
  assert.ok(!('text' in ergebnis))
  assert.equal(ergebnis.grund, 'dauer-passt-nicht')
})

test('fassungWaehlen waehlt NICHT ohne eigene Dauer — Radio hat keine', () => {
  // Genau hier waere der erste Treffer am verlockendsten und am falschesten.
  for (const ohne of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const ergebnis = fassungWaehlen(CREEP, ohne)
    assert.ok(!('text' in ergebnis), `Dauer ${ohne} haette nichts liefern duerfen`)
    assert.equal(ergebnis.grund, 'keine-dauer')
  }
})

test('der Spielraum trennt die Fassungen und vertraegt krumme Angaben', () => {
  // Innerhalb: dieselbe Aufnahme, nur anders ausgezeichnet.
  assert.ok('text' in fassungWaehlen(CREEP, 239 + DAUER_SPIELRAUM_S))
  // Knapp darueber: nichts mehr. Die Grenze ist eine Grenze.
  const drueber = fassungWaehlen([{ dauerSek: 239, synchron: '[00:01.00]x' }], 239 + DAUER_SPIELRAUM_S + 0.5)
  assert.ok(!('text' in drueber))
})

test('instrumental ist eine Auskunft, kein Fehlschlag', () => {
  const ergebnis = fassungWaehlen([{ dauerSek: 100, instrumental: true }], 100)
  assert.ok(!('text' in ergebnis))
  assert.equal(ergebnis.grund, 'instrumental')
})

test('eine Fassung ohne Zeitmarken heisst nicht "nichts gefunden"', () => {
  // Der Unterschied gehoert ins Journal: die Quelle HAT etwas, nur nicht synchron.
  const ergebnis = fassungWaehlen([{ dauerSek: 100, einfach: 'nur text' }], 100)
  assert.ok(!('text' in ergebnis))
  assert.equal(ergebnis.grund, 'ohne-zeitmarken')
})

test('fassungWaehlen vertraegt eine leere Antwort der Quelle', () => {
  for (const leer of [[], null, undefined]) {
    const ergebnis = fassungWaehlen(leer, 100)
    assert.ok(!('text' in ergebnis))
    assert.equal(ergebnis.grund, 'keine-fassung')
  }
})

test('fassungWaehlen ueberspringt Fassungen ohne Dauerangabe', () => {
  // Ohne Dauer laesst sich nicht sagen, ob sie passt — also nicht nehmen.
  const ergebnis = fassungWaehlen([{ synchron: '[00:01.00]x' }], 100)
  assert.ok(!('text' in ergebnis))
  assert.equal(ergebnis.grund, 'dauer-passt-nicht')
})

// ── Die Zeile zur Zeit ────────────────────────────────────────────────────

test('zeileJetzt zeigt vor der ersten Marke NICHTS', () => {
  // Das Vorspiel ist stumm; die erste Zeile gehoert nicht schon bei 0 hin.
  assert.equal(zeileJetzt(lrcZerlegen(LRC), 0), -1)
  assert.equal(zeileJetzt(lrcZerlegen(LRC), 11_999), -1)
})

test('zeileJetzt trifft die Grenze genau', () => {
  const zeilen = lrcZerlegen(LRC)
  assert.equal(zeileJetzt(zeilen, 12_000), 0)
  assert.equal(zeileJetzt(zeilen, 15_499), 0)
  assert.equal(zeileJetzt(zeilen, 15_500), 1)
})

test('zeileJetzt bleibt nach der letzten Marke bei der letzten Zeile', () => {
  const zeilen = lrcZerlegen(LRC)
  assert.equal(zeileJetzt(zeilen, 10_000_000), zeilen.length - 1)
})

test('zeileJetzt vertraegt Leeres und Unsinn', () => {
  assert.equal(zeileJetzt([], 1000), -1)
  assert.equal(zeileJetzt(null, 1000), -1)
  assert.equal(zeileJetzt(lrcZerlegen(LRC), Number.NaN), -1)
})
