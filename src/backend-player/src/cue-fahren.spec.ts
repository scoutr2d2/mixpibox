/**
 * CUE-FAHREN — die Faelle, in denen das stumme Fenster NICHT zustande kommt.
 *
 * Der Schwerpunkt liegt bewusst dort und nicht auf dem Gutfall: Das Cue ist
 * eine Verschoenerung des Maschinenwechsels, keine Vorbedingung. Jeder Weg,
 * auf dem es ausfaellt, muss die Wiedergabe UNBERUEHRT lassen — sonst tauscht
 * man 1-2 s Stille gegen eine stumme Box.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PUFFER_MS, imStummenFenster, planHolen } from './cue-fahren'
import type { CuePlan } from './tonpfad'

/** Ein Graph mit Spotify -> klangwerk, so knapp wie moeglich. */
const DUMP = [
  {
    id: 11,
    type: 'PipeWire:Interface:Node',
    info: { props: { 'node.name': 'spotify', 'media.class': 'Stream/Output/Audio', 'application.name': 'spotify' } },
  },
  { id: 80, type: 'PipeWire:Interface:Node', info: { props: { 'node.name': 'klangwerk', 'media.class': 'Audio/Sink' } } },
  {
    id: 96,
    type: 'PipeWire:Interface:Link',
    info: { 'output-node-id': 11, 'output-port-id': 105, 'input-node-id': 80, 'input-port-id': 106 },
  },
]

const AN = { MIXPI_CUE: '1' } as NodeJS.ProcessEnv
const sofort = async () => {}

/** Ein Schalter-Doppel, das mitschreibt statt zu schalten. */
function schalterDoppel(gewirkt = true) {
  const rufe: string[] = []
  return {
    rufe,
    schalter: {
      stumm: (_p: CuePlan) => {
        rufe.push('stumm')
        return gewirkt ? ({ art: 'gewirkt', befehle: [], fehlschlaege: 0 } as const) : ({ art: 'aus', grund: 'aus' } as const)
      },
      klar: () => {
        rufe.push('klar')
        return { art: 'gewirkt', befehle: [], fehlschlaege: 0 } as const
      },
      istStumm: () => false,
    },
  }
}

describe('planHolen — ein unlesbarer Graph ist kein Grund zu werfen', () => {
  it('gibt null, wenn pw-dump scheitert', async () => {
    const plan = await planHolen({
      dumpLeser: async () => {
        throw new Error('pw-dump: Host is down')
      },
    })
    assert.equal(plan, null)
  })

  it('gibt null, wenn kein Spotify im Graphen steht', async () => {
    assert.equal(await planHolen({ dumpLeser: async () => [] }), null)
  })

  it('findet die Kante im gesunden Graphen', async () => {
    const plan = await planHolen({ dumpLeser: async () => DUMP })
    assert.ok(plan)
    assert.equal(plan.kanten.length, 1)
  })
})

describe('imStummenFenster — die Handlung laeuft IMMER', () => {
  it('ohne MIXPI_CUE: kein pw-dump, kein Schalten, Handlung trotzdem', async () => {
    let gelesen = false
    const { wert, cue } = await imStummenFenster(async () => 'gestartet', {
      umgebung: {} as NodeJS.ProcessEnv,
      dumpLeser: async () => {
        gelesen = true
        return DUMP
      },
      warten: sofort,
    })
    assert.equal(wert, 'gestartet')
    assert.equal(cue.art, 'ohne-fenster')
    // DIE BILLIGE FRAGE ZUERST: ausgeschaltet darf es je Titelwechsel keinen
    // Prozessaufruf kosten.
    assert.equal(gelesen, false, 'pw-dump lief, obwohl das Cue aus ist')
  })

  it('ohne Plan: Handlung laeuft, nur eben hoerbar', async () => {
    const { wert, cue } = await imStummenFenster(async () => 'gestartet', {
      umgebung: AN,
      dumpLeser: async () => [],
      warten: sofort,
    })
    assert.equal(wert, 'gestartet')
    assert.deepEqual(cue, { art: 'ohne-fenster', grund: 'kein Plan' })
  })

  it('wenn der Schalter nicht wirkt: Handlung laeuft, ohne Fenster', async () => {
    const d = schalterDoppel(false)
    const { wert, cue } = await imStummenFenster(async () => 'gestartet', {
      umgebung: AN,
      dumpLeser: async () => DUMP,
      schalter: d.schalter,
      warten: sofort,
    })
    assert.equal(wert, 'gestartet')
    assert.equal(cue.art, 'ohne-fenster')
    // NICHT zurueckverbinden, was nie getrennt wurde.
    assert.deepEqual(d.rufe, ['stumm'])
  })
})

describe('imStummenFenster — das Fenster schliesst sich in jeder Lage', () => {
  it('Gutfall: stumm, Handlung, puffern, klar — in dieser Reihenfolge', async () => {
    const d = schalterDoppel()
    const folge: string[] = []
    let gewartet = -1
    const { cue } = await imStummenFenster(
      async () => {
        folge.push('handlung')
        return 1
      },
      {
        umgebung: AN,
        dumpLeser: async () => DUMP,
        schalter: {
          stumm: (p) => {
            folge.push('stumm')
            return d.schalter.stumm(p)
          },
          klar: () => {
            folge.push('klar')
            return d.schalter.klar()
          },
          istStumm: () => false,
        },
        warten: async (ms) => {
          gewartet = ms
          folge.push('puffern')
        },
      },
    )
    assert.equal(cue.art, 'gefahren')
    assert.deepEqual(folge, ['stumm', 'handlung', 'puffern', 'klar'])
    // Gepuffert wird SOLANGE ES STILL IST — also vor `klar`, und mit der
    // echten Frist, nicht mit einer Test-Null.
    assert.equal(gewartet, PUFFER_MS)
  })

  it('WIRFT DIE HANDLUNG, kommt der Ton trotzdem zurueck — und der Wurf durch', async () => {
    // Die teuerste Zeile dieser Datei. Ohne das `finally` bliebe die Box
    // stumm, waehrend die Anzeige weiterlaeuft: das Kind tippt, und niemand
    // kommt darauf, dass eine Kante fehlt.
    const d = schalterDoppel()
    await assert.rejects(
      () =>
        imStummenFenster(
          async () => {
            throw new Error('Spotify antwortet nicht')
          },
          { umgebung: AN, dumpLeser: async () => DUMP, schalter: d.schalter, warten: sofort },
        ),
      /Spotify antwortet nicht/,
    )
    assert.deepEqual(d.rufe, ['stumm', 'klar'], 'nach dem Wurf wurde nicht zurueckverbunden')
  })
})
