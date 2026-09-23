import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sollFremdePauseSenden } from './fremdlage'

describe('sollFremdePauseSenden — E104, die Grenze der Hoeflichkeit', () => {
  it('haelt an, was auf dieser Box spielt', () => {
    assert.equal(sollFremdePauseSenden({ spielt: true, aufDieserBox: true }), true)
  })

  it('beruehrt fremde Geraete nie', () => {
    assert.equal(sollFremdePauseSenden({ spielt: true, aufDieserBox: false }), false)
  })

  it('pausiert nichts, was nicht spielt', () => {
    assert.equal(sollFremdePauseSenden({ spielt: false, aufDieserBox: true }), false)
  })

  it('halbe Antworten loesen NIE eine Pause aus — der Rueckfall ist immer „nichts tun"', () => {
    assert.equal(sollFremdePauseSenden(null), false)
    assert.equal(sollFremdePauseSenden(undefined), false)
    assert.equal(sollFremdePauseSenden({}), false)
    assert.equal(sollFremdePauseSenden({ spielt: 'true', aufDieserBox: true }), false)
    assert.equal(sollFremdePauseSenden({ spielt: true }), false)
    assert.equal(sollFremdePauseSenden('kaputt'), false)
  })
})
