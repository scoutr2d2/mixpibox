/**
 * Die Ablage und die Pruefung beim Eintragen.
 *
 * DER WICHTIGSTE TEST IST DER, DER EINEN EINTRAG ABWEIST, der aussieht wie
 * eine Freigabe: eine nationale Telefonnummer. Sie durchzulassen hiesse, den
 * Eltern eine Freigabe anzuzeigen, die nie greift.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Erlaubt, Nachricht } from './nachrichten'
import { ablageNormalisieren, abweisungBuchen, erlaubtPruefen, leereAblage, listePruefen } from './nachrichten-ablage'

describe('erlaubtPruefen', () => {
  it('nimmt eine Matrix-ID an und schreibt sie klein', () => {
    const u = erlaubtPruefen({ weg: 'matrix', absender: ' @Mama:Server.Example ', name: 'Mama' })
    assert.ok(u.ok)
    assert.equal(u.eintrag.absender, '@mama:server.example')
    assert.equal(u.eintrag.name, 'Mama')
  })

  it('weist einen Matrix-Namen ohne @ und ohne Server ab', () => {
    const u = erlaubtPruefen({ weg: 'matrix', absender: 'mama' })
    assert.ok(!u.ok)
    assert.equal(u.grund, 'matrix')
    assert.ok(u.satz.includes('@mama:server.example'))
  })

  it('WEIST EINE NATIONALE NUMMER AB — statt eine Freigabe vorzutaeuschen', () => {
    const u = erlaubtPruefen({ weg: 'signal', absender: '0170 0000000' })
    assert.ok(!u.ok)
    assert.equal(u.grund, 'signal')
  })

  it('nimmt dieselbe Nummer international an', () => {
    for (const form of ['+49 170 0000000', '0049-170-0000000']) {
      const u = erlaubtPruefen({ weg: 'signal', absender: form })
      assert.ok(u.ok, form)
      assert.equal(u.eintrag.absender, '+491700000000')
    }
  })

  it('weist einen Telegram-@-Namen ab: das ist keine Chat-ID', () => {
    const u = erlaubtPruefen({ weg: 'telegram', absender: '@oma' })
    assert.ok(!u.ok)
    assert.equal(u.grund, 'telegram')
  })

  it('merkt die Dublette — auch in anderer Schreibweise', () => {
    const schon: Erlaubt[] = [{ weg: 'signal', absender: '+491700000000' }]
    const u = erlaubtPruefen({ weg: 'signal', absender: '0049 170 0000000' }, schon)
    assert.ok(!u.ok)
    assert.equal(u.grund, 'doppelt')
  })

  it('weist einen unbekannten Weg ab', () => {
    const u = erlaubtPruefen({ weg: 'whatsapp', absender: '+491700000000' })
    assert.ok(!u.ok)
    assert.equal(u.grund, 'weg')
  })

  it('deckelt den Namen, statt ihn in die Datei zu lassen', () => {
    const u = erlaubtPruefen({ weg: 'telegram', absender: '1', name: 'n'.repeat(200) })
    assert.ok(u.ok)
    assert.equal(u.eintrag.name?.length, 40)
  })
})

describe('listePruefen', () => {
  it('nimmt das Gute und zaehlt das Verworfene', () => {
    const { liste, verworfen } = listePruefen([
      { weg: 'matrix', absender: '@mama:server.example' },
      { weg: 'signal', absender: '0170 0000000' },
      'Unsinn',
      { weg: 'matrix', absender: '@MAMA:server.example' },
    ])
    assert.equal(liste.length, 1)
    assert.equal(verworfen, 3)
  })

  it('macht aus keiner Liste eine leere — und nicht aus Versehen alle', () => {
    assert.deepEqual(listePruefen(undefined).liste, [])
    assert.deepEqual(listePruefen({ weg: 'matrix' }).liste, [])
  })
})

describe('ablageNormalisieren', () => {
  const gut: Nachricht = {
    id: '$1',
    weg: 'matrix',
    absender: '@mama:server.example',
    absenderName: 'Mama',
    text: 'Hallo',
    zeit: 1000,
    gelesen: false,
    gesprochen: false,
  }

  it('WIRFT NIE — eine halbe Datei heisst leere Ablage, nicht Stillstand', () => {
    assert.deepEqual(ablageNormalisieren(null), leereAblage())
    assert.deepEqual(ablageNormalisieren('{kaputt'), leereAblage())
    assert.deepEqual(ablageNormalisieren({ nachrichten: 'nein' }), leereAblage())
  })

  it('behaelt eine ganze Nachricht und wirft eine halbe weg', () => {
    const a = ablageNormalisieren({ nachrichten: [gut, { id: '$2' }, { weg: 'matrix', text: 'x' }] })
    assert.equal(a.nachrichten.length, 1)
    assert.equal(a.nachrichten[0].id, '$1')
  })

  it('nimmt nur bekannte Wege', () => {
    const a = ablageNormalisieren({ nachrichten: [{ ...gut, weg: 'whatsapp' }] })
    assert.equal(a.nachrichten.length, 0)
  })

  it('holt die Marken zurueck — sonst kaeme nach jedem Neustart alles doppelt', () => {
    const a = ablageNormalisieren({ marken: { matrix: 's5', telegram: '12', unfug: 'x' } })
    assert.equal(a.marken.matrix, 's5')
    assert.equal(a.marken.telegram, '12')
    assert.equal((a.marken as Record<string, string>).unfug, undefined)
  })
})

describe('abweisungBuchen', () => {
  it('zaehlt hoch und merkt die letzte Kennung — ohne Text', () => {
    let a = leereAblage()
    a = abweisungBuchen(a, 'matrix', '@fremd:server.example', 5)
    a = abweisungBuchen(a, 'matrix', '@anderer:server.example', 9)
    assert.equal(a.abgewiesen.matrix?.anzahl, 2)
    assert.equal(a.abgewiesen.matrix?.zuletzt, '@anderer:server.example')
    assert.equal(a.abgewiesen.matrix?.wann, 9)
    assert.equal(a.abgewiesen.telegram, undefined)
  })
})
