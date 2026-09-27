import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { START_VORGABE, startNormalisieren } from './start'

describe('startNormalisieren — im Zweifel wird gefragt', () => {
  it('nimmt die beiden gueltigen Modi an', () => {
    assert.equal(startNormalisieren({ modus: 'fragen' }).modus, 'fragen')
    assert.equal(startNormalisieren({ modus: 'letztes' }).modus, 'letztes')
  })

  it('faellt bei allem anderen auf „fragen" zurueck', () => {
    // DIE RICHTUNG IST DER PUNKT: Ein verunglueckter Wert darf nie dazu
    // fuehren, dass die Box ungefragt in ein Kinderprofil startet. Lieber
    // einmal zu viel gefragt als einmal am Schloss vorbei.
    assert.equal(startNormalisieren({ modus: 'quatsch' }).modus, 'fragen')
    assert.equal(startNormalisieren({ modus: '' }).modus, 'fragen')
    assert.equal(startNormalisieren({ modus: true }).modus, 'fragen')
    assert.equal(startNormalisieren({}).modus, 'fragen')
    assert.equal(startNormalisieren(null).modus, 'fragen')
    assert.equal(startNormalisieren(undefined).modus, 'fragen')
  })

  it('hat „fragen" als Vorgabe — das ist der heutige Zustand jeder Box', () => {
    assert.equal(START_VORGABE.modus, 'fragen')
  })
})
