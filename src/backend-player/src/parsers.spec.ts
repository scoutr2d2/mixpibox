import assert from 'node:assert/strict'
import { test } from 'node:test'

import parsers = require('./parsers')

test('parseFlag maps yes/no to boolean', () => {
  assert.equal(parsers.pause('yes'), true)
  assert.equal(parsers.pause('YES'), true)
  assert.equal(parsers.pause('no'), false)
  assert.equal(parsers.mute(' yes '), true)
})

test('parseString strips the surrounding quotes', () => {
  assert.equal(parsers.META_TITLE("'Bohemian Rhapsody'"), 'Bohemian Rhapsody')
  assert.equal(parsers.META_ARTIST("'Queen'"), 'Queen')
})

test('numeric parsers coerce correctly', () => {
  assert.equal(parsers.percent_pos('42'), 42)
  assert.equal(parsers.volume('55.5'), 55.5)
  assert.equal(parsers.length('183.7'), 183.7)
})

test('metadata list groups values under known meta props', () => {
  const md = parsers.metadata('Title,Hello World,Artist,Some Band') as Record<string, string>
  assert.equal(md.Title, 'Hello World')
  assert.equal(md.Artist, 'Some Band')
})

test('unknown props are absent (no parser registered)', () => {
  assert.equal(parsers.definitely_not_a_prop, undefined)
})

// ─────────────────────────────────────────────────────────────────────────
// FESTSCHREIBENDE TESTS für den Umbau auf mpv (2026-07)
//
// mpv spricht JSON statt `ANS_<prop>=<value>`. Was hier steht, ist das IST
// des heutigen Stands — damit der Nachfolger dieselben Werte liefert und ein
// Unterschied auffällt, statt sich als "die Anzeige spinnt manchmal" zu
// tarnen. Wo das Verhalten fragwürdig ist, steht MACKE dabei: solche Zeilen
// bitte nicht "reparieren", ohne die Aufrufer zu prüfen.
//
// (Die fünf Tests oben sind älter und englisch; neue Tests im Projekt sind
// deutsch — deshalb der Bruch mitten in der Datei.)
// ─────────────────────────────────────────────────────────────────────────

test('MACKE: parseString schneidet blind vorne und hinten ein Zeichen ab', () => {
  // slice(1,-1) prüft NICHT, ob Anführungszeichen dastehen. Bei mplayer kommt
  // der Wert immer quotiert, in mpv-JSON gibt es sie gar nicht mehr — wer die
  // Funktion 1:1 übernimmt, frisst Buchstaben.
  assert.equal(parsers.META_TITLE('Kapitel'), 'apite')
  assert.equal(parsers.META_TITLE('ab'), '')
  assert.equal(parsers.META_TITLE(''), '')
})

test('unlesbare Zahlen ergeben NaN statt eines Fehlers', () => {
  // Der Wrapper reicht das ungeprüft an die Hörer weiter; angezeigt wird dann
  // "NaN". Für mpv gilt: denselben Weg gehen ODER die Hörer robust machen —
  // aber nicht stillschweigend etwas Drittes tun.
  assert.ok(Number.isNaN(parsers.volume('') as number))
  assert.ok(Number.isNaN(parsers.time_pos('keine Ahnung') as number))
})

test('MACKE: angehängter Unsinn wird abgeschnitten statt abgelehnt', () => {
  assert.equal(parsers.percent_pos('50abc'), 50)
  assert.equal(parsers.speed('1.5x'), 1.5)
})

test('metadata: Kommas im Wert bleiben erhalten', () => {
  const md = parsers.metadata('Title,Teil 1, Teil 2,Artist,Wer') as Record<string, string>
  assert.equal(md.Title, 'Teil 1, Teil 2')
  assert.equal(md.Artist, 'Wer')
})

test('metadata: alles vor dem ersten bekannten Feld wird verworfen', () => {
  const md = parsers.metadata('irgendwas,Title,Echt') as Record<string, string>
  assert.deepEqual({ ...md }, { Title: 'Echt' })
})

test('MACKE: ein WERT, der wie ein Feldname heißt, wird zum Feldnamen', () => {
  // Ein Album namens "Genre" kippt die Zuordnung. Unwahrscheinlich — aber beim
  // Nachbau soll niemand denken, das sei Absicht gewesen.
  const md = parsers.metadata('Title,Genre,Artist,Wer') as Record<string, string>
  assert.equal(md.Title, undefined)
  assert.equal(md.Artist, 'Wer')
})

test('metadata hat keinen Prototyp — __proto__ kann nichts kapern', () => {
  const md = parsers.metadata('Title,x') as Record<string, string>
  assert.equal(Object.getPrototypeOf(md), null)
})

test('die Eigenschaften, die der Player wirklich abfragt, sind alle da', () => {
  // getProps() im Wrapper fragt genau diese ab. Fehlt eine, verschluckt
  // onLine() die Antwort still (kein Parser -> return, kein Ereignis).
  for (const p of ['time_pos', 'length', 'percent_pos', 'volume', 'pause', 'filename', 'path'])
    assert.equal(typeof parsers[p], 'function', p)
})
