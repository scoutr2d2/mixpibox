import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  blockBauen,
  blockErsetzen,
  blockLesen,
  farbeGueltig,
  farbenPruefen,
  MARKE_AUF,
  MARKE_ZU,
  nameGueltig,
  ohneBlock,
  SELEKTOR,
} from './farbthema'

/** Ein Themenblatt, wie es auf der Box liegt (Auszug aus blue.css). */
const BLAU = `/*
BG body{--ion-background-color: #44afe2;
FG --ion-color-light: #054b61;
*/

body{
\t--ion-color-light: #054b61 !important;
}
`

describe('nameGueltig', () => {
  it('nimmt die Schreibweise aus app.css — auch mit Grossbuchstaben', () => {
    // --rowBg, --accentInk, --pillInk stehen SO in app.css. CSS-Variablen sind
    // gross/klein-empfindlich; wer sie kleinschriebe, faerbte nichts.
    for (const n of ['--bg', '--rowBg', '--accentInk', '--mp-akzent', '--weiter-blau']) {
      assert.equal(nameGueltig(n), true, n)
    }
  })

  it('weist alles zurueck, was aus dem Block ausbrechen koennte', () => {
    for (const n of ['bg', '--', '--a b', '--a;color:red', '--a}', '', 42, null]) {
      assert.equal(nameGueltig(n as unknown), false, String(n))
    }
  })
})

describe('farbeGueltig', () => {
  it('nimmt genau #RRGGBB', () => {
    assert.equal(farbeGueltig('#FFF7EC'), true)
    assert.equal(farbeGueltig('#fff7ec'), true)
  })

  it('nimmt keine Kurzform, keinen Namen, keine Funktion', () => {
    // Die Kurzform waere eine zweite Schreibweise fuer dieselbe Farbe, und
    // `red` bzw. `rgb(...)` liessen sich nicht in einem Farbfeld anzeigen.
    for (const w of ['#FFF', 'red', 'rgb(1,2,3)', 'url(x)', '#FFF7EC;color:red', '']) {
      assert.equal(farbeGueltig(w), false, w)
    }
  })
})

describe('farbenPruefen', () => {
  it('laesst Gueltiges durch und normiert auf Grossbuchstaben', () => {
    assert.deepEqual(farbenPruefen({ '--bg': '#aabbcc' }), { '--bg': '#AABBCC' })
  })

  it('wirft Ungueltiges still weg, statt alles abzulehnen', () => {
    assert.deepEqual(farbenPruefen({ '--bg': '#AABBCC', boese: 'red', '--x': 'nope' }), {
      '--bg': '#AABBCC',
    })
  })

  it('vertraegt Unsinn statt zu werfen', () => {
    for (const r of [null, undefined, 'x', 42, ['--bg']]) {
      assert.deepEqual(farbenPruefen(r as unknown), {})
    }
  })
})

describe('blockBauen', () => {
  it('schreibt !important — ohne das wirkt nichts', () => {
    // GEMESSEN: das Blatt wird VOR app.css eingebunden, bei gleicher
    // Spezifitaet gewinnt das spaetere. Ohne !important bleibt der Wert liegen.
    const b = blockBauen({ '--bg': '#123456' })
    assert.match(b, /--bg: #123456 !important;/)
  })

  it('faehrt NICHT ueber den dunklen Stand', () => {
    // :root mit !important wuerde :root[data-licht='dunkel'] erschlagen.
    const b = blockBauen({ '--bg': '#123456' })
    assert.ok(b.includes(SELEKTOR), b)
    assert.ok(!b.includes('\n:root {'), b)
  })

  it('sortiert, damit gleiche Auswahl gleiche Datei ergibt', () => {
    assert.equal(
      blockBauen({ '--ink': '#111111', '--bg': '#222222' }),
      blockBauen({ '--bg': '#222222', '--ink': '#111111' }),
    )
  })

  it('ist bei leerer Auswahl leer', () => {
    assert.equal(blockBauen({}), '')
  })
})

describe('ohneBlock / blockLesen', () => {
  it('holt zurueck, was hineingeschrieben wurde', () => {
    const farben = { '--bg': '#123456', '--ink': '#654321' }
    const datei = blockErsetzen(BLAU, farben)
    assert.deepEqual(blockLesen(datei), farben)
  })

  it('laesst den von Hand gepflegten Teil unberuehrt', () => {
    const datei = blockErsetzen(BLAU, { '--bg': '#123456' })
    assert.ok(datei.includes('--ion-color-light: #054b61 !important;'))
    assert.equal(ohneBlock(datei).trimEnd(), BLAU.trimEnd())
  })

  it('findet in einer Datei ohne Block nichts', () => {
    assert.deepEqual(blockLesen(BLAU), {})
    assert.equal(ohneBlock(BLAU), BLAU)
  })

  it('raeumt eine abgeschnittene Datei auf, statt Reste zu sammeln', () => {
    // Ein Schreibvorgang, der mittendrin abbrach: Anfangsmarke da, Ende fehlt.
    const halb = `${BLAU}\n${MARKE_AUF}\n${SELEKTOR} {\n  --bg: #123456 !imp`
    assert.equal(ohneBlock(halb).trimEnd(), BLAU.trimEnd())
  })
})

describe('blockErsetzen', () => {
  it('haengt bei mehrfachem Speichern KEINEN zweiten Block an', () => {
    // Der Fehler, der beim ersten Anlauf dastand: die Datei wuchs bei jedem
    // Klick, und nur der letzte Block wirkte.
    let d = blockErsetzen(BLAU, { '--bg': '#111111' })
    d = blockErsetzen(d, { '--bg': '#222222' })
    d = blockErsetzen(d, { '--bg': '#333333' })
    assert.equal(d.split(MARKE_AUF).length - 1, 1)
    assert.equal(d.split(MARKE_ZU).length - 1, 1)
    assert.deepEqual(blockLesen(d), { '--bg': '#333333' })
  })

  it('nimmt den Block bei leerer Auswahl wieder heraus', () => {
    const d = blockErsetzen(blockErsetzen(BLAU, { '--bg': '#111111' }), {})
    assert.deepEqual(blockLesen(d), {})
    assert.ok(!d.includes(MARKE_AUF))
    assert.ok(d.includes('--ion-color-light'))
  })

  it('endet mit der Endmarke und genau einem Zeilenumbruch', () => {
    // Wichtig fuer das naechste Schreiben: `ohneBlock` schneidet an der Marke,
    // und eine Datei, die mit halben Umbruechen endet, sammelt Leerzeilen an.
    const d = blockErsetzen(BLAU, { '--bg': '#111111' })
    assert.ok(d.endsWith(`${MARKE_ZU}\n`), JSON.stringify(d.slice(-60)))
    assert.ok(!d.endsWith('\n\n'))
  })

  it('kommt mit einer leeren Datei zurecht', () => {
    // wall-e.css ist am Geraet 0 Bytes gross.
    const d = blockErsetzen('', { '--bg': '#111111' })
    assert.deepEqual(blockLesen(d), { '--bg': '#111111' })
    assert.equal(blockErsetzen('', {}), '')
  })
})
