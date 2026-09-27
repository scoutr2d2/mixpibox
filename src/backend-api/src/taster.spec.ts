/**
 * Tests für den Austaster.
 *
 * Was hier geprüft wird, ist die Deutung — nicht das Lesen der Leitung. Die
 * gefährliche Stelle ist die Haltedauer: Sie entscheidet, wann der Ring auf
 * dem Schirm voll ist, und ein Ring, der eine andere Schwelle behauptet als
 * die, bei der das Skript abschaltet, ist schlimmer als keiner.
 *
 * DIE BRUCHZAHL HAT EIGENE FÄLLE. „2.25" ist der Wert, der die Box schon
 * einmal beim kürzesten Antippen heruntergefahren hat (Wissenspaket:
 * `mupi-haltedauer-bruchzahl`), und er kommt hier in BEIDEN Formen vor, als
 * Zahl und als Zeichenkette — weil genau diese Unterscheidung der zweite Teil
 * desselben Fehlers war.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  HALTEDAUER_STUFEN,
  HALTEDAUER_VORGABE,
  haltedauerAusKonfig,
  haltedauerSekunden,
  KONFIG_PFAD_HALTEDAUER,
  lageBilden,
  standDeuten,
} from './taster'

describe('haltedauerSekunden', () => {
  it('lässt die vier Stufen durch, als Zeichenkette wie als Zahl', () => {
    for (const stufe of HALTEDAUER_STUFEN) {
      assert.equal(haltedauerSekunden(String(stufe)), stufe, `"${stufe}" als Text`)
      assert.equal(haltedauerSekunden(stufe), stufe, `${stufe} als Zahl`)
    }
  })

  it('verwirft die Bruchzahl in BEIDEN Formen — der Fehler, der die Box abschaltete', () => {
    // Der historische Fall. Weder 2.25 noch 2 darf herauskommen: das eine
    // liesse sich nicht zählen, das andere wäre eine stillschweigend
    // geänderte Einstellung. Beides ist die Vorgabe wert, nicht mehr.
    assert.equal(haltedauerSekunden('2.25'), HALTEDAUER_VORGABE)
    assert.equal(haltedauerSekunden(2.25), HALTEDAUER_VORGABE)
    assert.equal(haltedauerSekunden('2.5'), HALTEDAUER_VORGABE)
    assert.equal(haltedauerSekunden(2.5), HALTEDAUER_VORGABE)
  })

  it('verwirft, was unter der Untergrenze liegt — 1 s ist die Dauer eines Versehens', () => {
    assert.equal(haltedauerSekunden('0'), HALTEDAUER_VORGABE)
    assert.equal(haltedauerSekunden('1'), HALTEDAUER_VORGABE)
    assert.equal(haltedauerSekunden(0), HALTEDAUER_VORGABE)
    assert.equal(haltedauerSekunden(-3), HALTEDAUER_VORGABE)
  })

  it('verwirft, was über der Obergrenze liegt — ab 6 s schneidet die Platine hart', () => {
    // Stünden 10 s in der Konfiguration, nähme der HAT bei 6 s den Strom weg,
    // bevor das Skript sein poweroff erreicht. Der Ring dürfte eine solche
    // Schwelle also nie anzeigen, denn sie tritt nie ein.
    assert.equal(haltedauerSekunden('6'), HALTEDAUER_VORGABE)
    assert.equal(haltedauerSekunden('10'), HALTEDAUER_VORGABE)
    assert.equal(haltedauerSekunden(6), HALTEDAUER_VORGABE)
  })

  it('verwirft Leeres, Fehlendes und Unsinn', () => {
    for (const roh of ['', '   ', 'zwei', null, undefined, {}, [], true, Number.NaN]) {
      assert.equal(haltedauerSekunden(roh), HALTEDAUER_VORGABE, `${JSON.stringify(roh)}`)
    }
  })

  it('nimmt umgebende Leerzeichen hin — sie stehen in von Hand bearbeiteten Dateien', () => {
    assert.equal(haltedauerSekunden(' 3 '), 3)
    assert.equal(haltedauerSekunden('\t4\n'), 4)
  })

  it('die Vorgabe ist selbst eine gültige Stufe', () => {
    // Sonst ergäbe der Rückfall einen Wert, den das Skript ablehnen würde —
    // und Ring und Skript lägen genau im Fehlerfall auseinander.
    assert.ok((HALTEDAUER_STUFEN as readonly number[]).includes(HALTEDAUER_VORGABE))
  })
})

describe('standDeuten', () => {
  it('0 ist gedrückt, 1 ist los — die Leitung ist invertiert', () => {
    assert.equal(standDeuten('0'), 'gedrueckt')
    assert.equal(standDeuten('1'), 'los')
  })

  it('nimmt den Zeilenumbruch hin, den die Wache schreibt', () => {
    // Die Wache schreibt f"{stand}\n"; die Datei ist 2 Bytes groß. Ohne trim
    // wäre JEDE Deutung null und der Ring erschiene nie.
    assert.equal(standDeuten('0\n'), 'gedrueckt')
    assert.equal(standDeuten('1\n'), 'los')
  })

  it('sagt null, wenn niemand die Leitung liest — und behauptet NICHT "los"', () => {
    // Der wichtigste Fall überhaupt: fehlende Wache heißt kaputter
    // Ausschalter. Würde hier 'los' herauskommen, sagte die Anzeige genau
    // dann etwas Beruhigendes, wenn nichts in Ordnung ist.
    for (const roh of [null, undefined, '', '   ', 'x', '2', '01']) {
      assert.equal(standDeuten(roh), null, `${JSON.stringify(roh)}`)
    }
  })
})

describe('haltedauerAusKonfig', () => {
  // Die Form der echten Box (.79, 31.08.2026): `shim` führt die ANSCHLÜSSE,
  // die Haltedauer steht bei den ZEITEN. Wer sie im `shim` sucht, findet
  // nichts und merkt es nicht.
  const wieAufDerBox = {
    shim: { poweroffPin: '4', triggerPin: '17', cutPin: '27', ledPin: '13' },
    timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '4' },
  }

  it('liest die Haltedauer unter timeout — dort, wo off_trigger.sh sie liest', () => {
    assert.equal(haltedauerAusKonfig(wieAufDerBox), 4)
  })

  it('lässt sich von einem shim.pressDelay NICHT ablenken', () => {
    // Stünde je eine zweite Zahl im shim-Abschnitt, gälte trotzdem die, die
    // das Skript liest. Eine Anzeige, die der falschen folgt, wäre wieder
    // genau der Fehler vom 31.08.2026.
    const beide = { shim: { pressDelay: '2' }, timeout: { pressDelay: '5' } }
    assert.equal(haltedauerAusKonfig(beide), 5)
  })

  it('fällt auf die Vorgabe zurück, wenn der Abschnitt ganz fehlt', () => {
    assert.equal(haltedauerAusKonfig({ shim: { triggerPin: '17' } }), HALTEDAUER_VORGABE)
    assert.equal(haltedauerAusKonfig({}), HALTEDAUER_VORGABE)
    assert.equal(haltedauerAusKonfig(null), HALTEDAUER_VORGABE)
    assert.equal(haltedauerAusKonfig('kaputt'), HALTEDAUER_VORGABE)
  })

  it('der Pfad ist der, den die Deckungswache gegen das Skript hält', () => {
    assert.equal(KONFIG_PFAD_HALTEDAUER, 'timeout.pressDelay')
  })
})

describe('lageBilden', () => {
  it('setzt beide Teile zusammen und rechnet in Millisekunden', () => {
    const k = (p: string) => ({ timeout: { pressDelay: p } })
    assert.deepEqual(lageBilden('0\n', k('2')), { stand: 'gedrueckt', haltedauerMs: 2000 })
    assert.deepEqual(lageBilden('1\n', k('5')), { stand: 'los', haltedauerMs: 5000 })
  })

  it('trägt die Lücken einzeln — eine fehlende Wache verdirbt die Haltedauer nicht', () => {
    assert.deepEqual(lageBilden(null, { timeout: { pressDelay: '4' } }), { stand: null, haltedauerMs: 4000 })
    assert.deepEqual(lageBilden('0', {}), {
      stand: 'gedrueckt',
      haltedauerMs: HALTEDAUER_VORGABE * 1000,
    })
  })
})
