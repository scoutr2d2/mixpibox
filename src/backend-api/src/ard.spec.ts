/**
 * Zeugen fuer das, was von ARD im KERN verblieben ist (E79).
 *
 * Bis zum 22.08.2026 standen hier 64 Zeugen fuer das gesamte ARD-Wissen.
 * Die Regeln sind mit der Anbieter-Migration in das Plugin
 * `plugins/mixpi-ardsounds` umgezogen — und ihre Zeugen MIT ihnen
 * (plugins/mixpi-ardsounds/index.spec.mjs, gegen gefaelschte
 * GraphQL-Antworten). Eine Regel ohne Zeugen waere keine Migration,
 * sondern ein Verlust.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { abspielWeg, sendungsKennung } from './ard'

const FOLGE = { kennung: 'f1', titel: 'Der Bär', bild: '', ton: 'https://x.de/pfad/mit/schraegen.mp3' }

describe('ARD: die Befehle an den Abspieldienst', () => {
  it('baut Start und Anhaengen nach dem jellyfin-Muster', () => {
    const { befehl, anhaengen } = abspielWeg(FOLGE, 'Die Maus')
    assert.ok(befehl.startsWith('ard/'))
    assert.ok(anhaengen.startsWith('ardqueue/'))
    assert.equal(befehl.slice(4), anhaengen.slice(9))
  })

  it('der Vorspann-Sprung haengt hinten am Namen — und fehlt, wenn es keinen gibt', () => {
    // OHNE Sprung bleibt der Befehl Zeichen fuer Zeichen der von gestern.
    assert.equal(abspielWeg(FOLGE, 'Die Maus').befehl, abspielWeg(FOLGE, 'Die Maus', 0).befehl)
    assert.ok(!abspielWeg(FOLGE, 'Die Maus').befehl.includes(':ab:'))
    // MIT Sprung steht die Zahl am Ende — BEIDE Befehle tragen sie, sonst
    // uebersprungen nur die erste Folge und die angehaengten nicht.
    const mit = abspielWeg(FOLGE, 'Die Maus', 5.25)
    assert.ok(mit.befehl.endsWith(':ab:5.25'), mit.befehl)
    assert.ok(mit.anhaengen.endsWith(':ab:5.25'), mit.anhaengen)
    // Unsinn faellt weg, statt eine Folge unhoerbar zu machen.
    assert.ok(!abspielWeg(FOLGE, 'X', Number.NaN).befehl.includes(':ab:'))
    assert.ok(!abspielWeg(FOLGE, 'X', -3).befehl.includes(':ab:'))
  })

  it('kodiert die Adresse VOLLSTAENDIG — sonst zerfaellt der Pfad', () => {
    // Der Abspieldienst schneidet am letzten Schraegstrich ab (`path.parse`).
    // Ein roher Schraegstrich in der Adresse verschiebt diese Grenze, und
    // gespielt wuerde ein Bruchstueck.
    const { befehl } = abspielWeg(FOLGE, 'Die Maus')
    const teile = befehl.split('/')
    assert.equal(teile.length, 3, befehl)
    assert.equal(decodeURIComponent(teile[1]), FOLGE.ton)
    assert.equal(teile[2], `${encodeURIComponent(FOLGE.titel)}:title:artist:${encodeURIComponent('Die Maus')}`)
  })

  it('haelt die Trennmarke sauber, auch wenn der Titel Doppelpunkte hat', () => {
    // `:title:artist:` ist die Trennmarke des Abspieldienstes. Ein Titel wie
    // „Folge 3: Der Fall" darf sie nicht nachahmen.
    const { befehl } = abspielWeg({ ...FOLGE, titel: 'Folge 3: Der Fall' }, 'Die Maus')
    assert.ok(befehl.includes(encodeURIComponent('Folge 3: Der Fall')))
    assert.ok(!befehl.includes('Folge 3: Der Fall'))
  })
})

describe('ARD: die Sendungskennung eines Bibliothekseintrags', () => {
  it('findet sie, auch mit Praefix oder altem Feld', () => {
    assert.equal(sendungsKennung({ id: '81889970' }), '81889970')
    assert.equal(sendungsKennung({ id: 'ard-81889970' }), '81889970')
    assert.equal(sendungsKennung({ id: 'ard:81889970' }), '81889970')
    assert.equal(sendungsKennung({ id: 'x', ardSendung: '81889970' }), '81889970')
    assert.equal(sendungsKennung({}), '')
  })
})
