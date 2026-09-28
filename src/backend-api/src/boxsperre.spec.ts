import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_MIN, mitSperre, sperreAusAnfrage, sperreNormalisieren, sperrStand } from './boxsperre'
import { abbrechen, pruefen, regelnVorgabe } from './kinderzeit'

/**
 * Die Box-Sperre der Eltern (boxsperre.ts) — Regel ohne Uhr und ohne Datei.
 *
 * Die Uhr kommt herein; 2026-09-28 ist ein Montag.
 */
const um = (zeit: string, tag = '2026-09-28') => new Date(`${tag}T${zeit}:00`).getTime()
const MIN = 60_000

describe('Box-Sperre: eine Datei, die nicht passt, sperrt NICHT', () => {
  const jetzt = um('18:00')
  for (const [was, roh] of [
    ['nichts', null],
    ['kein Objekt', 'gesperrt'],
    ['ohne bis', { seit: jetzt }],
    ['bis als Unsinn', { bis: 'morgen' }],
    ['abgelaufen', { bis: jetzt - MIN }],
    ['genau jetzt zu Ende', { bis: jetzt }],
    ['jenseits der Hoechstdauer', { bis: jetzt + (MAX_MIN + 5) * MIN }],
  ] as const) {
    it(was, () => assert.equal(sperreNormalisieren(roh, jetzt), null))
  }

  it('eine gueltige Sperre bleibt eine', () => {
    const s = sperreNormalisieren({ bis: jetzt + 30 * MIN, seit: jetzt }, jetzt)
    assert.deepEqual(s, { bis: jetzt + 30 * MIN, seit: jetzt })
  })

  it('ein unbrauchbares seit kostet die Sperre nicht', () => {
    const s = sperreNormalisieren({ bis: jetzt + 30 * MIN, seit: 'x' }, jetzt)
    assert.equal(s?.bis, jetzt + 30 * MIN)
  })
})

describe('Box-Sperre: aus einer Anfrage', () => {
  const jetzt = um('18:00')

  it('{minuten} zaehlt ab jetzt', () => {
    assert.equal(sperreAusAnfrage({ minuten: 30 }, jetzt).bis, jetzt + 30 * MIN)
  })

  it('{bis} wird uebernommen', () => {
    assert.equal(sperreAusAnfrage({ bis: um('07:00', '2026-09-29') }, jetzt).bis, um('07:00', '2026-09-29'))
  })

  it('wer sperren WILL und sich vertippt, erfaehrt es — statt still nicht zu sperren', () => {
    assert.throws(() => sperreAusAnfrage({}, jetzt), /wie lange/)
    assert.throws(() => sperreAusAnfrage({ minuten: 0 }, jetzt), /Mindestens/)
    assert.throws(() => sperreAusAnfrage({ minuten: 'lang' }, jetzt), /Mindestens/)
    assert.throws(() => sperreAusAnfrage({ bis: jetzt - MIN }, jetzt), /Zukunft/)
  })

  it('laenger als die Hoechstdauer geht nicht — eine vergessene Sperre endet von selbst', () => {
    assert.throws(() => sperreAusAnfrage({ minuten: MAX_MIN + 1 }, jetzt), /Stunden/)
    assert.throws(() => sperreAusAnfrage({ bis: jetzt + (MAX_MIN + 1) * MIN }, jetzt), /Stunden/)
    assert.equal(sperreAusAnfrage({ minuten: MAX_MIN }, jetzt).bis, jetzt + MAX_MIN * MIN)
  })
})

describe('Box-Sperre: was nach aussen geht', () => {
  it('heute: Uhrzeit, Restminuten aufgerundet, nicht morgen', () => {
    const jetzt = um('18:00')
    const st = sperrStand({ bis: um('19:30'), seit: jetzt }, jetzt + 30_000)
    assert.equal(st.aktiv, true)
    assert.equal(st.bisZeit, '19:30')
    assert.equal(st.morgen, false)
    assert.equal(st.restMin, 90, '89,5 Minuten sind 90 — sonst stuende „0 min" eine halbe Minute vor dem Ende')
  })

  it('ueber Mitternacht: morgen', () => {
    const jetzt = um('20:00')
    const st = sperrStand({ bis: um('07:00', '2026-09-29'), seit: jetzt }, jetzt)
    assert.equal(st.bisZeit, '07:00')
    assert.equal(st.morgen, true)
  })

  it('abgelaufen ist nicht aktiv — auch wenn die Sperre noch im Speicher steht', () => {
    const jetzt = um('18:00')
    assert.equal(sperrStand({ bis: jetzt, seit: jetzt - MIN }, jetzt).aktiv, false)
    assert.equal(sperrStand(null, jetzt).aktiv, false)
  })
})

describe('Box-Sperre und Kinderzeit', () => {
  const jetzt = um('18:00')
  const sperre = { bis: jetzt + 30 * MIN, seit: jetzt }

  it('die Sperre gewinnt auch ueber „Kinderzeit aus"', () => {
    const r = regelnVorgabe() // aktiv: false
    const u = mitSperre(pruefen(r, { tag: '2026-09-28', sekunden: 0, bonusMin: 0 }, new Date(jetzt)), sperre, jetzt)
    assert.equal(u.erlaubt, false)
    assert.equal(u.grund, 'gesperrt')
    assert.equal(u.gesperrtBis, '18:30')
  })

  it('ohne Sperre bleibt das Urteil, wie es war', () => {
    const r = regelnVorgabe()
    const vorher = pruefen(r, { tag: '2026-09-28', sekunden: 0, bonusMin: 0 }, new Date(jetzt))
    assert.deepEqual(mitSperre(vorher, null, jetzt), vorher)
    assert.deepEqual(mitSperre(vorher, sperre, jetzt + 31 * MIN), vorher, 'nach dem Ende spielt die Box wieder')
  })

  it('eine laufende Wiedergabe wird SOFORT beendet — ohne Nachsicht und auch bei Kinderzeit aus', () => {
    const r = regelnVorgabe()
    r.nachsichtMin = 5
    const u = mitSperre(pruefen(r, { tag: '2026-09-28', sekunden: 0, bonusMin: 0 }, new Date(jetzt)), sperre, jetzt)
    assert.equal(abbrechen(r, u, 0), true)
  })
})
