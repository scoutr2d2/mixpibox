/**
 * DER BEFEHL, DER DEN WLAN-ADAPTER WECHSELT.
 *
 * ══ WARUM ES DIESEN TEST GIBT ══════════════════════════════════════════════
 *
 * Weil die Route ein halbes Jahr lang NICHTS getan und dabei Erfolg gemeldet
 * hat. Am 21.08.2026 am Geraet gemessen — ZWEI Huerden hintereinander:
 *
 *     $ sh -c "ifdown wlan1"
 *     sh: 1: ifdown: not found                     rc=127
 *     $ /sbin/ifdown wlan0
 *     failed to open lockfile …/ifstate.wlan0: Permission denied
 *
 * Erst der PATH (der Server laeuft als `dietpi`, /sbin fehlt darin), dahinter
 * die Rechte (die Sperrdatei gehoert root). `sudo` raeumt beides weg. Der
 * Befehl scheiterte also sofort — und niemand sah es, weil `2>/dev/null` die
 * Meldung wegwarf und der Rueckruf `() => undefined` hiess.
 *
 * ZWEI FEHLER, EINE URSACHE: ein Befehl ohne Rechte und ein Rueckruf, der
 * nicht hinsieht. Der zweite ist der schlimmere — er macht den ersten
 * unsichtbar. Der Betreiber probierte es und fragte danach:
 * „warum erreiche ich die box auf der anderen ip nicht obwohl ich umgestellt
 * habe". Er hatte umgestellt; es war nur nichts passiert.
 *
 * ══ WAS HIER GEPRUEFT WIRD ═════════════════════════════════════════════════
 *
 * Der Befehlstext, nicht seine Wirkung — die braucht zwei Funkadapter und
 * eine Box. Aber genau die drei Eigenschaften, deren Fehlen den Fehler
 * ausgemacht hat, lassen sich am Text festmachen:
 *
 *   1. Rechte: jeder ifup/ifdown mit `sudo -n`.
 *   2. Die REIHENFOLGE: erst das Ziel hoch, dann das alte hinlegen. Wer sie
 *      dreht und dabei danebengreift, sperrt sich aus der Box aus.
 *   3. Der RUECKFALL: kommt das Ziel nicht hoch, muss das alte zurueck.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { wechselHatStattgefunden, wlanUmschaltBefehl } from './server.js'

describe('Der Umschaltbefehl fuer den WLAN-Adapter', () => {
  const b = wlanUmschaltBefehl('wlan1', 'wlan0')

  it('ruft ifup und ifdown MIT sudo — sonst gibt es sie im PATH gar nicht', () => {
    // Die eine Zeile, an der alles hing. `ifdown` ohne sudo ist auf dieser
    // Box `not found`, nicht „permission denied" — der Server laeuft als
    // dietpi und /sbin fehlt in dessen PATH.
    for (const teil of ['ifup', 'ifdown']) {
      const ohneSudo = new RegExp(`(^|[;&|]\\s*)${teil}\\b`)
      assert.ok(!ohneSudo.test(b), `${teil} wird ohne sudo aufgerufen`)
    }
    assert.match(b, /sudo -n ifup wlan1\b/)
    assert.match(b, /sudo -n ifdown wlan0\b/)
  })

  it('wirft die Fehlermeldung NICHT weg', () => {
    // `2>/dev/null` war der Grund, warum der Fehler unsichtbar blieb. Die
    // Meldung IST hier die Diagnose.
    assert.ok(!b.includes('2>/dev/null'), 'die Fehlerausgabe wird verworfen')
    assert.match(b, /2>&1/, 'die Ausgabe muss eingesammelt werden')
  })

  it('faehrt ERST das Ziel hoch und legt DANN das alte hin', () => {
    // Andersherum stuende die Box ohne Netz da, sobald das Ziel nicht kommt —
    // und niemand kaeme mehr an sie heran, um es zu richten.
    const hoch = b.indexOf('sudo -n ifup wlan1')
    const runter = b.indexOf('sudo -n ifdown wlan0')
    assert.ok(hoch >= 0 && runter > hoch, 'das alte Geraet wird zu frueh hingelegt')
  })

  it('dreht zurueck, wenn das Ziel keine Adresse bekommt', () => {
    assert.match(b, /ip -br addr show wlan1/, 'es wird nicht geprueft, ob das Ziel oben ist')
    const sonst = b.slice(b.indexOf('else'))
    assert.match(sonst, /sudo -n ifup wlan0\b/, 'ohne Rueckfall bleibt die Box ohne Netz')
  })

  it('sagt in beiden Ausgaengen, was geschehen ist', () => {
    // Ein Ausgang, der nur im Erfolgsfall etwas sagt, ist im Fehlerfall
    // stumm — und genau dann sucht jemand.
    assert.match(b, /UMGESCHALTET/)
    assert.match(b, /ZURUECKGEDREHT/)
  })

  it('setzt die Namen ein, die es bekommt', () => {
    const r = wlanUmschaltBefehl('wlan0', 'wlan1')
    assert.match(r, /sudo -n ifup wlan0\b/)
    assert.match(r, /sudo -n ifdown wlan1\b/)
  })

  it('schreibt die Wahl nur fest, wenn der Wechsel BELEGT ist', () => {
    // Eine ABSICHT festzuschreiben statt eines ERGEBNISSES waere hier
    // besonders teuer: die Box legte beim naechsten Start eine Schnittstelle
    // hin, weil jemand einmal auf einen Knopf gedrueckt hat, dessen Wirkung
    // ausblieb — genau der Fehler, der diesem Umbau vorausging.
    assert.equal(wechselHatStattgefunden('UMGESCHALTET auf wlan1'), true)
    assert.equal(wechselHatStattgefunden('ZURUECKGEDREHT: wlan1 kam nicht hoch'), false)
    assert.equal(wechselHatStattgefunden('ifdown: not found'), false)
    assert.equal(wechselHatStattgefunden(''), false)
    for (const x of [null, undefined, 0, {}, ['UMGESCHALTET']]) {
      assert.equal(wechselHatStattgefunden(x), false, String(x))
    }
  })

  it('das Wort im Befehl und das gesuchte Wort sind dasselbe', () => {
    // Sonst schreibt die Route nie fest, ohne dass es jemand merkt: der
    // Wechsel wirkt, ueberlebt aber keinen Neustart. Beides steht in
    // server.ts, aber an zwei Stellen.
    assert.ok(wechselHatStattgefunden(b.match(/echo "([^"]*UMGESCHALTET[^"]*)"/)?.[1] ?? ''))
  })
})
