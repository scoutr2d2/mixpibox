/**
 * Tests fuer cue-schalter.ts.
 *
 * KEIN `pw-link`, KEIN Prozess, KEINE Box — und ausdruecklich auch KEINE
 * echte Uhr: der Rueckverbinde-Zwang wird gemessen, indem die Frist von
 * Hand ausgeloest wird. Ein Test, der 5 Sekunden schlaeft, um zu sehen, ob
 * etwas passiert, waere langsam UND schwaecher (er koennte den Ablauf nicht
 * vom Nichtstun unterscheiden, wenn er zu frueh hinsieht).
 *
 * Der Plan kommt aus derselben echten Vorlage wie in tonpfad.spec.ts, damit
 * hier keine zweite, ausgedachte Kartierung entsteht.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  CUE_EIN,
  CUE_FRIST_MS,
  CUE_UMGEBUNGSSCHALTER,
  type CueSchalterGaben,
  cueErlaubt,
  erzeugeCueSchalter,
} from './cue-schalter'
import { type Befehl, type CuePlan, cuePlanAus } from './tonpfad'
import VORLAGE from './tonpfad.fixture.json'

const AN = { [CUE_UMGEBUNGSSCHALTER]: CUE_EIN }

function planAusVorlage(): CuePlan {
  const plan = cuePlanAus(structuredClone(VORLAGE))
  assert.ok(plan, 'die Vorlage muss einen Plan ergeben — sonst misst diese Datei nichts')
  return plan
}

/** Sammelt Befehle statt zu schalten, und haelt die gespannte Uhr fest. */
function pruefstand(zusatz: CueSchalterGaben = {}) {
  const befehle: Befehl[] = []
  const zeilen: string[] = []
  let gespannt: { fn: () => void; ms: number } | null = null
  let geloescht = 0

  const schalter = erzeugeCueSchalter({
    umgebung: AN,
    ausfuehrer: (b) => {
      befehle.push(b)
    },
    protokoll: (t) => {
      zeilen.push(t)
    },
    uhrStellen: (fn, ms) => {
      gespannt = { fn, ms }
      return {
        loeschen: () => {
          geloescht++
          gespannt = null
        },
      }
    },
    ...zusatz,
  })

  return {
    schalter,
    befehle,
    zeilen,
    /** Die Frist ablaufen lassen, ohne zu warten. */
    fristAblaufen(): void {
      const u = gespannt as { fn: () => void; ms: number } | null
      assert.ok(u, 'es war keine Uhr gespannt — genau das waere der gefaehrliche Fehler')
      u.fn()
    },
    uhrGespannt: () => gespannt !== null,
    uhrFrist: () => (gespannt as { ms: number } | null)?.ms,
    geloescht: () => geloescht,
    /** Nur die Argumente, kompakt lesbar. */
    zeilenAls: () => befehle.map((b) => `${b.programm} ${b.argumente.join(' ')}`),
  }
}

describe('cueErlaubt — der Schalter ist eng, mit Absicht', () => {
  it('nur exakt `1` schaltet ein', () => {
    assert.equal(cueErlaubt({ [CUE_UMGEBUNGSSCHALTER]: '1' }), true)
  })

  it('DIE FALLE: alles andere ist AUS — auch das, was nach „an" aussieht', () => {
    // `0` ist der Fall, der zaehlt: wer den Schalter ausmachen will, tippt
    // genau das. Ein „irgendwas gesetzt"-Test waere hier an.
    for (const wert of ['0', 'true', 'ja', 'yes', 'on', '', ' 1', '1 ', 'MIXPI_CUE']) {
      assert.equal(cueErlaubt({ [CUE_UMGEBUNGSSCHALTER]: wert }), false, `Wert ${JSON.stringify(wert)}`)
    }
    assert.equal(cueErlaubt({}), false)
  })
})

describe('stumm/klar OHNE Schalter — die Datei ist dann ein No-Op', () => {
  it('trennt nichts, spannt keine Uhr, schreibt aber eine Zeile', () => {
    const p = pruefstand({ umgebung: {} })
    const ergebnis = p.schalter.stumm(planAusVorlage())

    assert.deepEqual(ergebnis, { art: 'aus', grund: `${CUE_UMGEBUNGSSCHALTER} nicht gesetzt` })
    assert.deepEqual(p.befehle, [], 'ohne Schalter darf KEIN Befehl herausgehen')
    assert.equal(p.uhrGespannt(), false)
    assert.equal(p.schalter.istStumm(), false)
    // Die Zeile ist der Sinn des No-Ops: man sieht, was passiert WAERE.
    assert.equal(p.zeilen.length, 1)
    assert.match(p.zeilen[0], /Cue AUS/)
    assert.match(p.zeilen[0], /spotify \(85\) -> klangwerk \(60\)/)
  })
})

describe('stumm/klar MIT Schalter', () => {
  it('trennt genau die geplanten Kanten — ueber die Link-Nummern', () => {
    const p = pruefstand()
    const ergebnis = p.schalter.stumm(planAusVorlage())

    assert.equal(ergebnis.art, 'gewirkt')
    assert.deepEqual(p.zeilenAls(), ['pw-link -d 120', 'pw-link -d 121'])
    assert.equal(p.schalter.istStumm(), true)
    assert.equal(p.uhrFrist(), CUE_FRIST_MS)
  })

  it('`klar()` verbindet ueber die PORT-Nummern zurueck und loescht die Uhr', () => {
    const p = pruefstand()
    p.schalter.stumm(planAusVorlage())
    p.befehle.length = 0

    const ergebnis = p.schalter.klar()
    assert.equal(ergebnis.art, 'gewirkt')
    assert.deepEqual(p.zeilenAls(), ['pw-link 86 63', 'pw-link 87 64'])
    assert.equal(p.schalter.istStumm(), false)
    assert.equal(p.geloescht(), 1, 'eine erledigte Uhr muss weg, sonst feuert sie ins Leere')
  })

  it('`klar()` ohne laufendes Cue tut nichts — aus jeder Lage aufrufbar', () => {
    const p = pruefstand()
    assert.deepEqual(p.schalter.klar(), { art: 'nichts-zu-tun', grund: 'es laeuft kein Cue' })
    assert.deepEqual(p.befehle, [])
    // Und zweimal `klar()` nach einem Cue verbindet nicht zweimal.
    p.schalter.stumm(planAusVorlage())
    p.schalter.klar()
    p.befehle.length = 0
    assert.equal(p.schalter.klar().art, 'nichts-zu-tun')
    assert.deepEqual(p.befehle, [])
  })

  it('ein Plan ohne Kante schaltet nicht und spannt keine Uhr', () => {
    const p = pruefstand()
    const leer: CuePlan = { ...planAusVorlage(), kanten: [] }
    assert.deepEqual(p.schalter.stumm(leer), { art: 'nichts-zu-tun', grund: 'der Plan hat keine Kante' })
    assert.deepEqual(p.befehle, [])
    assert.equal(p.uhrGespannt(), false)
  })
})

describe('DER RUECKVERBINDE-ZWANG — der Grund, warum es diese Datei gibt', () => {
  it('nach Ablauf der Frist wird zurueckverbunden, OHNE dass jemand `klar()` ruft', () => {
    const p = pruefstand()
    p.schalter.stumm(planAusVorlage())
    p.befehle.length = 0

    // Der Aufrufer ist hier weg — abgestuerzt, haengend, egal.
    p.fristAblaufen()

    assert.deepEqual(p.zeilenAls(), ['pw-link 86 63', 'pw-link 87 64'])
    assert.equal(p.schalter.istStumm(), false, 'nach dem Zwang darf kein Cue mehr als laufend gelten')
    assert.ok(p.zeilen.some((z) => /RUECKVERBINDE-ZWANG/.test(z)))
  })

  it('EIN AUSFUEHRER, DER WIRFT, KIPPT DEN ZWANG NICHT', () => {
    // Der gefaehrlichste Ablauf: `pw-link` fehlt (ENOENT). Wuerde der Wurf
    // aus `stumm()` herausfliegen, waere die Uhr nie gespannt — und getrennt
    // waere im Ernstfall trotzdem schon etwas.
    const p = pruefstand({
      ausfuehrer: () => {
        throw new Error('spawn pw-link ENOENT')
      },
    })
    const ergebnis = p.schalter.stumm(planAusVorlage())

    assert.equal(ergebnis.art, 'gewirkt')
    assert.equal(
      (ergebnis as { fehlschlaege: number }).fehlschlaege,
      2,
      'beide Kanten werden versucht, nicht nur die erste',
    )
    assert.equal(p.uhrGespannt(), true, 'die Uhr MUSS trotz Wurf gespannt sein')

    // Und der Zwang laeuft auch dann durch, wenn das Zurueckverbinden wirft.
    p.fristAblaufen()
    assert.equal(p.schalter.istStumm(), false)
  })

  it('DIE FRIST IST ABSOLUT: ein zweites `stumm()` schiebt sie NICHT nach hinten', () => {
    const p = pruefstand()
    p.schalter.stumm(planAusVorlage())
    p.befehle.length = 0

    const zweites = p.schalter.stumm(planAusVorlage())
    assert.deepEqual(zweites, { art: 'nichts-zu-tun', grund: 'es laeuft bereits ein Cue' })
    assert.deepEqual(p.befehle, [], 'nicht ein zweites Mal trennen')
    assert.equal(p.geloescht(), 0, 'die alte Uhr darf nicht ersetzt werden — sonst waere die Frist gleitend')

    p.fristAblaufen()
    assert.equal(p.schalter.istStumm(), false)
  })

  it('erst merken, dann trennen: die Uhr steht schon, bevor der erste Befehl herausgeht', () => {
    // Gemessen ueber die Reihenfolge: der Ausfuehrer sieht beim ERSTEN Befehl
    // bereits ein laufendes Cue. Waere es umgekehrt, gaebe es ein Fenster,
    // in dem die Kante weg ist und niemand sie zurueckholt.
    const beobachtet: boolean[] = []
    let schalter: ReturnType<typeof erzeugeCueSchalter>
    const p = pruefstand({
      ausfuehrer: () => {
        beobachtet.push(schalter.istStumm())
      },
    })
    schalter = p.schalter
    schalter.stumm(planAusVorlage())
    assert.deepEqual(beobachtet, [true, true])
  })
})
