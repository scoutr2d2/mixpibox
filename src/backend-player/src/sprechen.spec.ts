import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'

import { bereitAus, SPRECH_TEXT_MAX, sprechAdresse, sprechBereitAdresse, sprechTextAus } from './sprechen'

/*
 * VON JEDER SORTE EINE — nicht „stelle ich den Fall?", sondern „welche SORTEN
 * gibt es?". Die Sorten sind hier: mit und ohne Lautstaerke-Anhaengsel,
 * mehrteilig, mit Umlauten, mit Abfrage, kaputt kodiert, gar kein Sprechbefehl.
 * Der ZWEITE Test ist der wichtigste — genau die Sorte fiel bisher stumm aus.
 */

test('die schlichte Form wird verstanden', () => {
  assert.equal(sprechTextAus('/current/say/Hallo'), 'Hallo')
  assert.equal(sprechTextAus('/current/say/Hallo%20Welt'), 'Hallo Welt')
})

test('OHNE Lautstaerke-Anhaengsel — die Sorte, die frueher stumm blieb', () => {
  // Der alte Zweig prueft `path.parse(url).dir.includes('say/')`. Genau das
  // war der Fehler: der Schraegstrich am Ende fehlt, die Pruefung ist falsch,
  // die Box blieb still. Der Test haelt diesen Nachweis fest.
  assert.equal(path.parse('/current/say/Hallo').dir.includes('say/'), false)
  assert.equal(path.parse('/current/say/Hallo/40').dir.includes('say/'), true)
  // Und die neue Zerlegung kommt mit beiden zurecht:
  assert.equal(sprechTextAus('/current/say/Hallo'), 'Hallo')
  assert.equal(sprechTextAus('/current/say/Hallo/40'), 'Hallo')
})

test('die angehaengte Lautstaerke gehoert nicht zum Text', () => {
  assert.equal(sprechTextAus('/current/say/Benjamin%20Bl%C3%BCmchen/40'), 'Benjamin Blümchen')
  assert.equal(sprechTextAus('/spotifyid42/say/Bibi%20und%20Tina/100'), 'Bibi und Tina')
})

test('steht die Zahl allein, ist sie der Text', () => {
  // „/say/40" soll die Zahl sprechen duerfen statt ins Leere zu laufen —
  // sonst waere ein Album namens „99" nicht vorlesbar.
  assert.equal(sprechTextAus('/current/say/40'), '40')
  assert.equal(sprechTextAus('/current/say/99'), '99')
})

test('die alte mehrteilige Form wird zu Leerzeichen', () => {
  // Der Vorlaeufer machte `nameTTS.replace(/\//g, ' ')` — dasselbe Ergebnis.
  assert.equal(sprechTextAus('/current/say/Hallo/Welt'), 'Hallo Welt')
  assert.equal(sprechTextAus('/current/say/Drei/Fragezeichen/40'), 'Drei Fragezeichen')
})

test('eine Abfrage haengt nicht am Text', () => {
  assert.equal(sprechTextAus('/current/say/Hallo?x=1'), 'Hallo')
  assert.equal(sprechTextAus('/current/say/Hallo/40#anker'), 'Hallo')
})

test('kaputte Prozentfolge macht nicht stumm', () => {
  // Lieber das Rohe sprechen als gar nichts — eine Box, bei der nichts
  // passiert, halten Kinder fuer kaputt.
  assert.equal(sprechTextAus('/current/say/Hall%oo'), 'Hall%oo')
})

test('was kein Sprechbefehl ist, gibt null', () => {
  for (const p of ['/current/play', '/current/stop', '/state', '', '/', '/current/say', null, 42, undefined]) {
    assert.equal(sprechTextAus(p as unknown), null, String(p))
  }
})

test('zu lange Texte werden gekappt, nicht abgelehnt', () => {
  // Der Server weist alles ueber 300 Zeichen mit 400 ab. Ein abgeschnittener
  // Titel ist besser als eine Fehlermeldung, die niemand sieht.
  const lang = 'a'.repeat(500)
  assert.equal(sprechTextAus(`/current/say/${lang}`)?.length, SPRECH_TEXT_MAX)
})

test('die Adresse zeigt auf die Schleife, nicht ins Netz', () => {
  const a = sprechAdresse('Hallo Welt', 8200)
  assert.equal(a, 'http://127.0.0.1:8200/api/vorlesen/sprich?text=Hallo%20Welt')
  // Kein Google mehr, und kein Rechnername, der ein WLAN braucht.
  assert.ok(!a.includes('google'))
  assert.ok(a.startsWith('http://127.0.0.1:'))
})

/*
 * BEREITSCHAFT — hier gilt: Attrappen luegen durch WEGLASSEN. Die Frage ist
 * nicht „stelle ich den guten Fall?", sondern „welche SORTEN von Antwort gibt
 * es?". Sorten: alles da / Programm da, aber keine Stimme / Programm fehlt,
 * Stimmen da / gar nichts / kaputte Antwort.
 */
test('bereit ist nur, wo Programm UND Stimme da sind', () => {
  assert.deepEqual(bereitAus({ bereit: true, stimmen: [{ id: 'de_DE-ramona-low' }] }), {
    bereit: true,
    stimmen: 1,
  })
})

test('Piper da, aber keine einzige Stimme — das ist NICHT bereit', () => {
  // Die Sorte, die man beim ersten Anlauf vergisst: `bereit` meldet nur, dass
  // das Programm existiert. Ohne .onnx-Datei kann es trotzdem nicht sprechen,
  // und die Box bliebe still, waehrend das Protokoll „bereit" behauptet.
  assert.deepEqual(bereitAus({ bereit: true, stimmen: [] }), { bereit: false, stimmen: 0 })
})

test('Stimmen da, aber Piper fehlt — auch NICHT bereit', () => {
  assert.deepEqual(bereitAus({ bereit: false, stimmen: [{ id: 'de_DE-ramona-low' }] }), {
    bereit: false,
    stimmen: 1,
  })
})

test('kaputte oder fehlende Antwort gilt als nicht bereit, statt zu werfen', () => {
  for (const a of [null, undefined, {}, 'nein', 42, { bereit: 'ja', stimmen: 'viele' }]) {
    assert.equal(bereitAus(a).bereit, false, String(a))
  }
})

test('die Bereitschaftsadresse zeigt auf denselben Server wie das Sprechen', () => {
  assert.equal(sprechBereitAdresse(8200), 'http://127.0.0.1:8200/api/vorlesen')
  assert.ok(sprechAdresse('x', 8200).startsWith(sprechBereitAdresse(8200)))
})

test('Sonderzeichen werden kodiert, nicht durchgereicht', () => {
  // Ein „&" im Titel („Bibi & Tina") wuerde sonst die Abfrage zerlegen und
  // den halben Titel verschlucken.
  assert.equal(sprechAdresse('Bibi & Tina', 8200), 'http://127.0.0.1:8200/api/vorlesen/sprich?text=Bibi%20%26%20Tina')
  assert.ok(sprechAdresse('Blümchen', 8200).includes('Bl%C3%BCmchen'))
})
