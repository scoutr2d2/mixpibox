/**
 * Zeugen fuer den ANBIETER-SCHALTER (E76).
 *
 * DIE TEUERSTE REGEL ZUERST: fehlt der Schalter, ist der Dienst AN. Eine
 * Aktualisierung, die Bestandsboxen den Ton abdreht, waere der schlimmste
 * Fehler dieses Moduls — deshalb prueft jeder Randfall in diese Richtung.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { abgeschalteteDienste, anbieterAusBefehl, dienstAktiv, verweigerung } from './mixpi-anbieter'

describe('dienstAktiv — nur ein ausdrueckliches false schaltet ab', () => {
  it('fehlt alles, ist alles an', () => {
    for (const k of [undefined, null, {}, { spotify: {} }, 'unsinn', 42]) {
      assert.equal(dienstAktiv(k, 'spotify'), true, String(k))
      assert.equal(dienstAktiv(k, 'jellyfin'), true)
      assert.equal(dienstAktiv(k, 'ard'), true)
    }
  })

  it('false schaltet ab, true und alles andere nicht', () => {
    assert.equal(dienstAktiv({ spotify: { aktiv: false } }, 'spotify'), false)
    assert.equal(dienstAktiv({ spotify: { aktiv: true } }, 'spotify'), true)
    // KEIN BIEGEN VON WERTEN: 0, '', 'false' sind NICHT false. Wer den
    // Schalter setzt, setzt ihn ueber die Verwaltung, und die schreibt einen
    // echten Boolean. Alles andere ist eine kaputte Konfiguration — und die
    // schaltet nach Regel 1 nichts ab.
    assert.equal(dienstAktiv({ spotify: { aktiv: 0 } }, 'spotify'), true)
    assert.equal(dienstAktiv({ spotify: { aktiv: 'false' } }, 'spotify'), true)
  })

  it('ein unbekannter Dienst laesst sich nicht abschalten', () => {
    // Lokale Dateien, Radio, RSS sind Grundfunktion — es gibt keinen Weg,
    // sie versehentlich zu treffen.
    assert.equal(dienstAktiv({ local: { aktiv: false } }, 'local'), true)
    assert.equal(dienstAktiv({}, 'radio'), true)
    assert.equal(dienstAktiv({}, null), true)
  })

  it('jeder Dienst hat seine eigene Gruppe', () => {
    const k = { spotify: { aktiv: false }, jellyfin: { aktiv: true }, ard: {} }
    assert.deepEqual(abgeschalteteDienste(k), ['spotify'])
  })
})

describe('anbieterAusBefehl — positionsgenau, nie per Teilwort', () => {
  it('erkennt die Startverben aller drei Dienste', () => {
    assert.equal(anbieterAusBefehl('/kinderzimmer/spotify/now/spotify:album:abc:1:0'), 'spotify')
    assert.equal(anbieterAusBefehl('/x/jellyfin/http%3A%2F%2Fserver/titel:title:artist:wer'), 'jellyfin')
    assert.equal(anbieterAusBefehl('/x/jfqueue/adresse/titel'), 'jellyfin')
    assert.equal(anbieterAusBefehl('/x/ard/adresse/titel:title:artist:wer'), 'ard')
    assert.equal(anbieterAusBefehl('/x/ardqueue/adresse/titel'), 'ard')
  })

  it('laesst Grundfunktionen in Ruhe', () => {
    for (const p of [
      '/x/musicsearch/library/album/musik:wer:was',
      '/x/queue/library/album/musik:wer:was',
      '/x/radio/http%3A%2F%2Fstrom/sender',
      '/x/rss/adresse/folge',
      '/x/play',
    ]) {
      assert.equal(anbieterAusBefehl(p), null, p)
    }
  })

  it('faellt nicht auf Teilwoerter herein', () => {
    // „ard" steckt im Titel, nicht im Verb — das ist ein RSS-Befehl.
    assert.equal(anbieterAusBefehl('/x/rss/adresse/Leopard%20und%20Co'), null)
    // und „jellyfin" mitten in einem Dateipfad eines lokalen Albums
    assert.equal(anbieterAusBefehl('/x/musicsearch/library/album/musik:jellyfin:die%20quallenband'), null)
  })

  it('Zustands- und Stopbefehle gehen ihn nichts an', () => {
    // Sie erreichen diese Funktion im Betrieb gar nicht (istStartbefehl
    // filtert vorher) — aber auch roh gerufen darf nichts zurueckkommen, was
    // ein /state oder /stop verweigern wuerde.
    assert.equal(anbieterAusBefehl('/x/state'), null)
    assert.equal(anbieterAusBefehl('/x/stop'), null)
    assert.equal(anbieterAusBefehl(undefined), null)
  })
})

describe('die Verweigerung — ein Satz, den man einem Kind vorlesen kann', () => {
  it('traegt Anker, Dienst und Grund', () => {
    const v = verweigerung('ard')
    assert.equal(v.anbieterAus, true)
    assert.equal(v.dienst, 'ard')
    assert.match(v.grund, /ARD Sounds ist gerade abgeschaltet/)
    assert.match(v.grund, /Verwaltung/)
  })
})
