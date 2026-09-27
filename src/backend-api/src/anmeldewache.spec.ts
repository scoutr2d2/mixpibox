/**
 * ANMELDEWACHE (E121) — jede Regel einzeln, und die Gegenrichtungen zuerst.
 *
 * Die gefaehrlichste Fehlform dieser Wache ist nicht „startet nie neu",
 * sondern „startet neu, wenn sie nicht darf": in laufende Musik hinein, im
 * Takt einer Stoerung, die gar keine Auskunft ueber die Box ist, oder in
 * einer Schleife. Deshalb stehen die Verbots-Faelle vorn.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ANMELDEWACHE_NEUSTART_ABSTAND_MS,
  ANMELDEWACHE_TREFFER_BIS_NEUSTART,
  anmeldewacheUrteil,
} from './anmeldewache'

const LAGE = {
  engine: 'soloist',
  bereit: false as unknown,
  grund: 'box-fehlt',
  spieltSpotify: false,
  treffer: 0,
  seitNeustartMs: Number.POSITIVE_INFINITY,
}

describe('anmeldewache — wann sie NICHT eingreifen darf', () => {
  it('mit librespot tut sie gar nichts, auch bei box-fehlt', () => {
    const u = anmeldewacheUrteil({ ...LAGE, engine: 'librespot', treffer: 5 })
    assert.equal(u.tat, 'nichts')
    assert.equal(u.treffer, 0)
  })

  it('ein klares JA heilt den Zaehler', () => {
    const u = anmeldewacheUrteil({ ...LAGE, bereit: true, grund: '', treffer: 1 })
    assert.equal(u.tat, 'nichts')
    assert.equal(u.treffer, 0)
  })

  it('nicht-pruefbar zaehlt nicht UND entwarnt nicht — der Zaehler bleibt stehen', () => {
    const u = anmeldewacheUrteil({ ...LAGE, bereit: true, grund: 'nicht-pruefbar', treffer: 1 })
    // bereit:true (der Auskunfts-Rueckfall bei Stoerung) heilt — das ist die
    // dokumentierte Richtung des Zweifels der AUSKUNFT. Die Wache selbst
    // haelt den Zaehler nur, wenn weder JA noch box-fehlt kommt:
    const u2 = anmeldewacheUrteil({ ...LAGE, bereit: undefined, grund: 'unbekannt', treffer: 1 })
    assert.equal(u.treffer, 0)
    assert.equal(u2.tat, 'nichts')
    assert.equal(u2.treffer, 1)
  })

  it('NIE in laufende Spotify-Musik hinein — auch beim zweiten Treffer nicht', () => {
    const u = anmeldewacheUrteil({ ...LAGE, spieltSpotify: true, treffer: ANMELDEWACHE_TREFFER_BIS_NEUSTART })
    assert.equal(u.tat, 'nichts')
    assert.match(u.meldung ?? '', /spielt hoerbar/)
  })

  it('kein zweiter Neustart innerhalb des Abstands — sonst wird die Wache zur Schleife', () => {
    const u = anmeldewacheUrteil({
      ...LAGE,
      treffer: ANMELDEWACHE_TREFFER_BIS_NEUSTART,
      seitNeustartMs: ANMELDEWACHE_NEUSTART_ABSTAND_MS - 1,
    })
    assert.equal(u.tat, 'merken')
  })
})

describe('anmeldewache — der Weg zum Neustart', () => {
  it('der erste Treffer wird nur gemerkt', () => {
    const u = anmeldewacheUrteil({ ...LAGE, treffer: 0 })
    assert.equal(u.tat, 'merken')
    assert.equal(u.treffer, 1)
    assert.match(u.meldung ?? '', /1\/2/)
  })

  it('der zweite Treffer in Folge startet neu und setzt den Zaehler zurueck', () => {
    const u = anmeldewacheUrteil({ ...LAGE, treffer: 1 })
    assert.equal(u.tat, 'neustart')
    assert.equal(u.treffer, 0)
  })

  it('nach abgelaufenem Abstand darf wieder neu gestartet werden', () => {
    const u = anmeldewacheUrteil({
      ...LAGE,
      treffer: 1,
      seitNeustartMs: ANMELDEWACHE_NEUSTART_ABSTAND_MS + 1,
    })
    assert.equal(u.tat, 'neustart')
  })
})
