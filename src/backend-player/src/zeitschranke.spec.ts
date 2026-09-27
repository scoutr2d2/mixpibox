import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mitZeitschranke } from './zeitschranke'

/*
 * VON JEDER SORTE EINE — und die Sorten sind hier nicht die Ausgaenge, sondern
 * die ZEITPUNKTE. Ein Wettlauf hat drei Stellen, an denen etwas eintreffen
 * kann: VOR der Frist, NACH der Frist, und gar nicht. Eine Attrappe, die nur
 * „schnell" und „langsam" kennt, verschweigt genau den Fall, der diese Datei
 * noetig gemacht hat: die Antwort, die NACH dem Ablauf doch noch kommt.
 *
 * Die Zeiten sind absichtlich klein, aber nicht winzig: unter etwa 20 ms wird
 * ein Test auf einer belasteten Maschine launisch.
 */

const nach = <T>(ms: number, wert: T) => new Promise<T>((f) => setTimeout(() => f(wert), ms))
const scheitertNach = (ms: number, was: unknown) =>
  new Promise<never>((_f, d) => setTimeout(() => d(was), ms))

test('das Versprechen kommt VOR der Frist an — der Wert kommt durch', async () => {
  const a = await mitZeitschranke(nach(20, 'angehalten'), 500)
  assert.deepEqual(a, { art: 'fertig', wert: 'angehalten' })
})

test('das Versprechen kommt gar nicht — die Frist entscheidet', async () => {
  // Ein Versprechen, das NIE fertig wird. Genau die gemessene Lage: ein Wirt,
  // der die Verbindung annimmt und schweigt, laeuft auch nach 201 s noch
  // (04.08.2026, tools/pause-zeitschranke-messen.mjs).
  const a = await mitZeitschranke(new Promise<string>(() => {}), 40)
  assert.deepEqual(a, { art: 'abgelaufen' })
})

test('eine Ablehnung wird GEMELDET, nicht geworfen', async () => {
  const a = await mitZeitschranke(scheitertNach(20, new Error('WebapiError 502')), 500)
  assert.equal(a.art, 'gescheitert')
  assert.equal((a as { fehler: Error }).fehler.message, 'WebapiError 502')
})

test('DIE SORTE, DERENTWEGEN ES DIESE DATEI GIBT: die Antwort kommt NACH der Frist', async () => {
  // Zuerst laeuft die Frist ab, DANN antwortet Spotify doch noch. Der Ausgang
  // darf sich nachtraeglich nicht mehr aendern — sonst haette der Aufrufer
  // laengst 200 geantwortet und bekaeme hinterher eine zweite Wahrheit.
  const spaet = nach(80, 'doch-noch')
  const a = await mitZeitschranke(spaet, 20)
  assert.deepEqual(a, { art: 'abgelaufen' })
  await spaet
  // Und danach immer noch dasselbe Ergebnis — es gibt kein zweites `fertig()`.
  assert.deepEqual(a, { art: 'abgelaufen' })
})

test('eine ABLEHNUNG nach der Frist bringt den Prozess nicht um', async () => {
  // Seit Node 15 beendet eine `unhandledRejection` den Prozess mit Code 1.
  // Ein Abspieldienst, den ein Netzfehler umbringt, waere schlimmer als der
  // Fehler, der hier repariert wird — deshalb wird die zweite Hand SOFORT
  // angelegt und nicht erst nach dem Rennen.
  const abgelehnt: unknown[] = []
  const wache = (grund: unknown) => abgelehnt.push(grund)
  process.on('unhandledRejection', wache)
  try {
    const a = await mitZeitschranke(scheitertNach(30, new Error('ETIMEDOUT')), 10)
    assert.deepEqual(a, { art: 'abgelaufen' })
    // Lange genug stehenbleiben, dass die Ablehnung wirklich eintrifft und
    // Node seine Runde gedreht hat.
    await nach(60, null)
    assert.deepEqual(abgelehnt, [])
  } finally {
    process.off('unhandledRejection', wache)
  }
})

test('KOSTET NICHTS, WENN ES SCHNELL GEHT — die Frist wird nicht abgesessen', async () => {
  // Das ist der ganze Unterschied zur festen Atempause in der Oberflaeche:
  // 1500 ms sind hier eine OBERGRENZE, keine Wartezeit. Im Alltag kostet der
  // Rundlauf zu Spotify 76 bis 93 ms (Box .169, 04.08.2026).
  const start = Date.now()
  await mitZeitschranke(nach(10, 'flott'), 1500)
  const gebraucht = Date.now() - start
  assert.ok(gebraucht < 400, `haette sofort zurueckkommen muessen, brauchte aber ${gebraucht} ms`)
})

test('Frist 0 heisst „gar nicht warten“ — das Verhalten von vorher', async () => {
  // Ein Rueckweg, ohne den Quelltext zu aendern: wer die Frist auf 0 stellt,
  // bekommt genau den Stand vor dieser Reparatur (sofort antworten, die Pause
  // laeuft im Hintergrund weiter).
  const a = await mitZeitschranke(nach(50, 'egal'), 0)
  assert.deepEqual(a, { art: 'abgelaufen' })
})
