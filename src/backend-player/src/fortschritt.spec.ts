import assert from 'node:assert/strict'
import { test } from 'node:test'

import * as parsers2 from './fortschritt'
import { richtig, spieltWirklich, startpunktAus, veraltet, TOLERANZ_MS } from './fortschritt'

const START = { seit: 1_000_000, ab: 0 }

test('glaubwuerdige Meldung bleibt unangetastet', () => {
  assert.equal(richtig(4800, START, 1_005_000), 4800)
})

test('faengt den GEMESSENEN Fall: 105 s Position, 0,9 s nach dem Start', () => {
  // Genau der Ruecksprung, den die Box zeigte. Statt 105 s gilt die selbst
  // gezaehlte Zeit - die Leiste bleibt vorn und schnellt nicht zurueck.
  assert.equal(richtig(105_010, START, 1_000_900), 900)
})

test('rechnet bei Wiederaufnahme ab der gemerkten Stelle', () => {
  const wieder = { seit: 1_000_000, ab: 60_000 }
  assert.equal(richtig(63_000, wieder, 1_003_000), 63_000)
  assert.equal(richtig(200_000, wieder, 1_003_000), 63_000)
})

test('ist nachsichtig genug fuer Netz- und Rundungsunschaerfe', () => {
  assert.equal(richtig(7000, START, 1_005_000), 7000)
  assert.equal(veraltet(7000, START, 1_005_000), false)
  // Knapp jenseits der Nachsicht wird korrigiert.
  assert.equal(veraltet(5000 + TOLERANZ_MS + 100, START, 1_005_000), true)
})

test('glaubt der Meldung, solange kein Start bekannt ist', () => {
  // Nach einem Neustart des Dienstes weiss niemand, wann gestartet wurde.
  assert.equal(richtig(105_000, { seit: 0, ab: 0 }, 1_000_900), 105_000)
  assert.equal(richtig(105_000, null, 1_000_900), 105_000)
})

test('haelt Unsinn aus', () => {
  assert.equal(richtig(Number.NaN, START, 1_005_000), 0)
  assert.equal(richtig(-5, START, 1_005_000), 0)
})

test('laesst eine rueckwaerts laufende Uhr in Ruhe', () => {
  assert.equal(richtig(4800, START, 999_000), 4800)
})

test('laeuft im Dauerbetrieb weiter mit', () => {
  // Eine Minute nach dem Start ist eine Minute Position richtig.
  assert.equal(richtig(60_000, START, 1_060_000), 60_000)
})

test('spielt: eine "spielt nicht"-Meldung kurz nach dem Start ist veraltet', () => {
  // Gemessen: 0,2 s nach dem Start meldete Spotify false, 1,4 s spaeter true.
  // Der Abspiel-Knopf sprang dadurch kurz auf "abspielen", obwohl gespielt
  // wurde - in BEIDEN Ansichten, weil beide dieselbe Quelle lesen.
  assert.equal(spieltWirklich(false, START, 1_000_200), true)
})

test('spielt: nach der Nachlaufzeit gilt die Meldung wieder', () => {
  // Wer wirklich pausiert hat, soll das auch sehen.
  assert.equal(spieltWirklich(false, START, 1_000_000 + TOLERANZ_MS + 1), false)
})

test('spielt: ohne bekannten Start wird nichts beschoenigt', () => {
  assert.equal(spieltWirklich(false, { seit: 0, ab: 0 }, 1_000_200), false)
  assert.equal(spieltWirklich(false, null, 1_000_200), false)
})

test('spielt: eine "spielt"-Meldung wird nie angezweifelt', () => {
  assert.equal(spieltWirklich(true, null, 1_000_200), true)
  assert.equal(spieltWirklich(true, START, 9_999_999), true)
})

test('veraltet: die GANZE Antwort ist erkennbar von vorher', () => {
  // Gemessen: 0,2 s nach dem Wechsel meldete Spotify noch Titel, Dauer UND
  // Kontext des vorigen Stuecks. Der Kontext ist der verlaessliche Beweis -
  // wir wissen, was wir befohlen haben.
  assert.equal(
    parsers2.zustandVeraltet('spotify:playlist:ALT', 'spotify:playlist:NEU:1:0', START, 1_000_200),
    true,
  )
})

test('veraltet: stimmt der Kontext, ist die Antwort frisch', () => {
  assert.equal(
    parsers2.zustandVeraltet('spotify:playlist:NEU', 'spotify:playlist:NEU:1:0', START, 1_000_200),
    false,
  )
})

test('veraltet: nach der Nachlaufzeit gilt eine Abweichung als ECHT', () => {
  // Dann hat jemand woanders etwas gestartet - das ist kein Nachlauf mehr,
  // und die Box darf es nicht wegdefinieren.
  assert.equal(
    parsers2.zustandVeraltet('spotify:playlist:ALT', 'spotify:playlist:NEU:1:0', START, 1_000_000 + TOLERANZ_MS + 1),
    false,
  )
})

test('veraltet: ohne bekannten Start oder ohne Angaben wird nichts behauptet', () => {
  assert.equal(parsers2.zustandVeraltet('a', 'b', { seit: 0, ab: 0 }, 1_000_200), false)
  assert.equal(parsers2.zustandVeraltet('', 'b', START, 1_000_200), false)
  assert.equal(parsers2.zustandVeraltet('a', '', START, 1_000_200), false)
})

test('startpunktAus: das letzte Glied ist MILLISEKUNDEN, nicht Sekunden', () => {
  // GENAU DER FEHLER, den es hier gab: bis 2026-08-02 nahm der Verteiler den
  // Wert mal 1000. Aus einem Fortsetzen bei 1:32 wurden damit ueber 25
  // Stunden, und `richtig()` liess von da an jede Meldung durch.
  assert.deepEqual(startpunktAus('spotify:album:4aBc:2:92500', 1_000_000), { seit: 1_000_000, ab: 92_500 })
})

test('startpunktAus: „von vorn" ist 0', () => {
  assert.deepEqual(startpunktAus('spotify:playlist:XYZ:0:0', 7), { seit: 7, ab: 0 })
})

test('startpunktAus: Unfug ergibt 0, nicht NaN', () => {
  // Ein NaN in `ab` machte jeden Vergleich in `richtig()` falsch, und zwar
  // stumm.
  assert.equal(startpunktAus('spotify:episode:ABC', 5).ab, 0)
  assert.equal(startpunktAus('', 5).ab, 0)
  assert.equal(startpunktAus(null, 5).ab, 0)
})

test('startpunktAus: der gemessene Ruecksprung wird damit weiter gefangen', () => {
  // Ende zu Ende: Startbefehl mit Stelle, dann eine unmoegliche Meldung.
  const s = startpunktAus('spotify:album:4aBc:2:60000', 1_000_000)
  assert.equal(richtig(63_000, s, 1_003_000), 63_000)
  assert.equal(richtig(500_000, s, 1_003_000), 63_000)
})
