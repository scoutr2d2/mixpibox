import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { maschinenWahlPruefen } from './spotify-maschine'

describe('maschinenWahlPruefen', () => {
  it('librespot geht immer — auch ohne Schluessel', () => {
    // Der Rueckweg darf an NICHTS haengen. Genau dafuer gibt es ihn.
    assert.equal(maschinenWahlPruefen('librespot', false).ok, true)
    assert.equal(maschinenWahlPruefen('librespot', true).ok, true)
  })

  it('soloist ohne Schluessel wird ABGELEHNT, nicht angenommen', () => {
    // engine=soloist ohne Schluessel hiesse: soloist scheitert an der
    // Anmeldung UND librespot steht wegen der Condition — eine stumme Box.
    const u = maschinenWahlPruefen('soloist', false)
    assert.equal(u.ok, false)
    assert.ok(u.grund?.includes('spak_'), u.grund)
  })

  it('soloist mit Schluessel geht', () => {
    assert.deepEqual(maschinenWahlPruefen('soloist', true), { ok: true, engine: 'soloist' })
  })

  it('alles andere faellt ab — samt dem, was wahr aussieht', () => {
    for (const kaputt of ['', ' ', 'SOLOIST', 'mpv', null, undefined, 42, {}]) {
      assert.equal(maschinenWahlPruefen(kaputt, true).ok, false, String(kaputt))
    }
  })
})

/*
 * DIE VERFALL-ZEUGEN SIND MIT DER RECHNUNG UMGEZOGEN (E82):
 * plugins/mixpi-soloist/index.spec.mjs — dieselben Faelle, dieselbe -V-Zeile.
 */
