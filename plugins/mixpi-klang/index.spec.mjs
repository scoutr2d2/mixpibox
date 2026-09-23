import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { kontext as pruefstand } from '../pruefstand.mjs'
import plugin from './index.mjs'

/**
 * Tests des Klang-Plugins — ohne Box, ohne Tonstapel, ohne Lautsprecher.
 *
 *     node --test plugins/mixpi-klang/index.spec.mjs
 *
 * DAS PLUGIN RECHNET NICHTS, es BESCHREIBT. Geprueft wird deshalb genau das:
 * welche Glieder aus welchen Einstellungen werden — und, mindestens ebenso
 * wichtig, welche NICHT (ein Glied, das mit Vorgabewerten nichts tut, ist
 * Rechenarbeit in jedem Puffer auf einer 2-GB-Box).
 *
 * Was aus den Gliedern wird, steht nicht hier, sondern in
 * src/backend-api/src/klangkette.spec.ts — dort wird die PipeWire-Kette
 * geprueft. Diese Trennung ist der Grund, warum ein Plugin-Autor kein
 * PipeWire kennen muss.
 */

function kontext(einstellungen = {}) {
  return pruefstand({
    einstellungen: {
      basis: 100,
      hochpass: 0,
      hoehen: 0,
      bass: 0,
      vorpegel: 0,
      kompressor: 0,
      kompSchwelle: -18,
      begrenzer: 0,
      ...einstellungen,
    },
  })
}

describe('Vorgaben — es wirkt nichts, solange niemand etwas einstellt', () => {
  it('haengt mit lauter Vorgaben KEIN Glied ein', () => {
    const { k } = kontext()
    assert.deepEqual(plugin.klangkette(k), [])
  })

  it('sagt im Befinden, dass nichts wirkt — statt „alles in Ordnung"', () => {
    const { k } = kontext()
    const b = plugin.befinden(k)
    assert.equal(b.ok, true)
    assert.match(b.text, /wirkt nichts/, 'sonst sucht der Betreiber an der falschen Stelle')
  })

  it('schreibt nichts ins Journal, wenn nichts eingehaengt ist', () => {
    const { k, protokoll } = kontext()
    plugin.klangkette(k)
    assert.deepEqual(protokoll, [])
  })
})

/**
 * Ein Glied aus der Kette holen.
 *
 * SEIT DER LIVE-REGELUNG LIEFERT DAS PLUGIN IMMER ALLE FUENF GLIEDER, sobald
 * ueberhaupt etwas wirkt — auch die neutralen. Das ist Absicht: der Kern kann
 * Werte nur am laufenden Graphen stellen, wenn dessen Struktur gleich bleibt.
 * Die Tests pruefen deshalb WERTE einzelner Glieder, nicht mehr die Laenge
 * der Liste.
 */
function glied(kette, art, lage) {
  return kette.find((g) => g.art === art && (lage === undefined || g.lage === lage))
}

describe('Alles auf Vorgabe: gar nicht im Weg stehen', () => {
  it('liefert NICHTS, solange kein Regler bewegt wurde', () => {
    // Eine Box, an der niemand etwas eingestellt hat, soll keinen
    // Filterprozess mitschleppen.
    const { k } = kontext()
    assert.deepEqual(plugin.klangkette(k), [])
  })

  it('liefert ALLE fuenf Glieder, sobald EIN Regler wirkt', () => {
    const { k } = kontext({ basis: 50 })
    const kette = plugin.klangkette(k)
    assert.equal(kette.length, 5, 'konstante Struktur ist die Voraussetzung fuers Live-Regeln')
    assert.deepEqual(
      kette.map((g) => g.art),
      ['basis', 'hochpass', 'kuhschwanz', 'kuhschwanz', 'vorpegel'],
    )
  })

  it('haelt die Struktur ueber verschiedene Einstellungen konstant', () => {
    // DER LIVE-FALL: zwei verschiedene Reglerstellungen muessen dieselbe
    // Gliederfolge ergeben, sonst baut der Kern neu und der Ton setzt aus.
    const a = plugin.klangkette(kontext({ basis: 50 }).k).map((g) => g.art + (g.lage ?? ''))
    const b = plugin.klangkette(kontext({ basis: 10, hoehen: 6, vorpegel: -4 }).k).map((g) => g.art + (g.lage ?? ''))
    assert.deepEqual(a, b)
  })
})

describe('Stereobasis — der Regler gegen die seitliche Abstrahlung', () => {
  it('gibt bei 100 und sonst Vorgaben gar keine Kette heraus', () => {
    const { k } = kontext({ basis: 100 })
    assert.deepEqual(plugin.klangkette(k), [])
  })

  it('verengt bei 50', () => {
    const { k } = kontext({ basis: 50 })
    assert.deepEqual(glied(plugin.klangkette(k), 'basis'), { art: 'basis', breite: 50 })
  })

  it('macht bei 0 Mono', () => {
    const { k } = kontext({ basis: 0 })
    assert.deepEqual(glied(plugin.klangkette(k), 'basis'), { art: 'basis', breite: 0 })
  })

  it('bleibt bei 100 neutral, wenn ein ANDERER Regler die Kette anwirft', () => {
    const { k } = kontext({ basis: 100, hoehen: 5 })
    assert.deepEqual(glied(plugin.klangkette(k), 'basis'), { art: 'basis', breite: 100 })
  })
})

describe('Hochpass', () => {
  it('greift ab 40 Hz', () => {
    const { k } = kontext({ hochpass: 120 })
    assert.deepEqual(glied(plugin.klangkette(k), 'hochpass'), { art: 'hochpass', freq: 120 })
  })

  it('steht bei "aus" auf 20 Hz — gueltig, aber hoerbar nichts', () => {
    // Der Kern verlangt mindestens 20 Hz. 20 liegt unter dem, was die
    // Chassis abstrahlen, also wirkt es nicht — die Struktur bleibt aber.
    const { k } = kontext({ hochpass: 0, hoehen: 5 })
    assert.deepEqual(glied(plugin.klangkette(k), 'hochpass'), { art: 'hochpass', freq: 20 })
  })

  it('wirft die Kette NICHT allein wegen eines Wertes unter 40 an', () => {
    const { k } = kontext({ hochpass: 15 })
    assert.deepEqual(plugin.klangkette(k), [])
  })
})

describe('Kuhschwaenze', () => {
  it('haengt Bass und Hoehen mit den festen Eckfrequenzen ein', () => {
    const kette = plugin.klangkette(kontext({ bass: 3, hoehen: 5 }).k)
    assert.deepEqual(glied(kette, 'kuhschwanz', 'tief'), { art: 'kuhschwanz', lage: 'tief', freq: 100, dB: 3 })
    assert.deepEqual(glied(kette, 'kuhschwanz', 'hoch'), { art: 'kuhschwanz', lage: 'hoch', freq: 4000, dB: 5 })
  })

  it('kann auch senken, nicht nur heben', () => {
    const kette = plugin.klangkette(kontext({ hoehen: -4 }).k)
    assert.equal(glied(kette, 'kuhschwanz', 'hoch').dB, -4)
  })

  it('steht bei 0 dB neutral in der Kette', () => {
    const kette = plugin.klangkette(kontext({ basis: 50 }).k)
    assert.equal(glied(kette, 'kuhschwanz', 'tief').dB, 0)
    assert.equal(glied(kette, 'kuhschwanz', 'hoch').dB, 0)
  })
})

describe('Vorpegel', () => {
  it('daempft, wenn eingestellt', () => {
    const kette = plugin.klangkette(kontext({ vorpegel: -3 }).k)
    assert.deepEqual(glied(kette, 'vorpegel'), { art: 'vorpegel', dB: -3 })
  })

  it('laesst sich NICHT zum Lautmacher umbiegen', () => {
    // Der Kern wiese einen anhebenden Vorpegel ohnehin ab; das Plugin soll
    // ihn gar nicht erst anbieten, sonst faellt bei einer Fehleingabe die
    // ganze Kette aus, statt nur dieser eine Wert.
    const { k } = kontext({ vorpegel: 6 })
    assert.deepEqual(plugin.klangkette(k), [], 'ein positiver Vorpegel wirkt nicht und wirft die Kette nicht an')
  })

  it('steht bei 0 neutral in der Kette', () => {
    const kette = plugin.klangkette(kontext({ basis: 50 }).k)
    assert.equal(glied(kette, 'vorpegel').dB, 0)
  })
})

describe('Reihenfolge — erst mischen, dann entzerren, zuletzt daempfen', () => {
  it('haelt die Reihenfolge ein, egal wie die Felder stehen', () => {
    const { k } = kontext({ vorpegel: -3, hoehen: 5, basis: 40, bass: 2, hochpass: 120 })
    assert.deepEqual(
      plugin.klangkette(k).map((g) => g.art),
      ['basis', 'hochpass', 'kuhschwanz', 'kuhschwanz', 'vorpegel'],
    )
  })

  it('mischt VOR dem Entzerren — sonst entzerrt man einen Kanal, der gleich verrechnet wird', () => {
    const { k } = kontext({ basis: 40, hoehen: 5 })
    const arten = plugin.klangkette(k).map((g) => g.art)
    assert.ok(arten.indexOf('basis') < arten.indexOf('kuhschwanz'))
  })
})

describe('Krumme Eingaben — ein Versehen darf den Klang nicht abschalten', () => {
  it('deckelt masslose dB-Werte, statt die Kette scheitern zu lassen', () => {
    // Der Kern weist ueber ±24 dB ab. Kaeme eine 500 durch, fiele die GANZE
    // Kette aus — auch die Stereobasis, die nichts damit zu tun hat.
    const kette = plugin.klangkette(kontext({ hoehen: 500 }).k)
    assert.equal(kette.find((g) => g.lage === 'hoch').dB, 12)
  })

  it('nimmt bei Buchstaben die Vorgabe', () => {
    const { k } = kontext({ basis: 'ganz schmal', hoehen: 'laut' })
    assert.deepEqual(plugin.klangkette(k), [])
  })

  it('kommt ohne Einstellungen ueberhaupt zurecht', () => {
    const { k } = pruefstand({ einstellungen: {} })
    assert.deepEqual(plugin.klangkette(k), [])
  })

  it('deckelt eine masslose Stereobasis auf 100 statt sie zu verbreitern', () => {
    const { k } = kontext({ basis: 300 })
    assert.deepEqual(plugin.klangkette(k), [], 'ueber 100 gibt es nicht — 100 heisst „nichts tun"')
  })
})

describe('Journal', () => {
  it('meldet EINMAL, was haengt', () => {
    const { k, protokoll } = kontext({ basis: 50, hoehen: 5 })
    plugin.klangkette(k)
    assert.equal(protokoll.length, 1)
    assert.match(protokoll[0], /Basis 50/)
  })

  it('schweigt beim WIEDERHOLTEN Ruf mit denselben Werten', () => {
    // Beim Live-Regeln wird klangkette() vielfach je Sekunde gerufen. Ein
    // Protokoll je Ruf machte das Journal unlesbar — und genau dort sucht
    // man spaeter nach Ursachen.
    const { k, protokoll } = kontext({ basis: 50 })
    plugin.klangkette(k)
    plugin.klangkette(k)
    plugin.klangkette(k)
    assert.equal(protokoll.length, 1, 'nur die AENDERUNG gehoert ins Journal')
  })
})

describe('Dynamik — Kompressor und Begrenzer', () => {
  it('laufen bei Vorgabe NICHT mit', () => {
    // Anders als die fuenf Filter: die LADSPA-Bausteine laden eine fremde
    // .so, belegen Speicher und rechnen. Einen Kompressor auf 1:1 mitlaufen
    // zu lassen waere Aufwand fuer nichts.
    const kette = plugin.klangkette(kontext({ basis: 50 }).k)
    assert.equal(glied(kette, 'kompressor'), undefined)
    assert.equal(glied(kette, 'begrenzer'), undefined)
  })

  it('haengt den Kompressor ein, sobald ein Verhaeltnis steht', () => {
    const k = glied(plugin.klangkette(kontext({ kompressor: 3 }).k), 'kompressor')
    assert.equal(k.verhaeltnis, 3)
    assert.equal(k.schwelle, -18)
  })

  it('holt mit makeup auf — sonst wird nur alles leiser', () => {
    // Wer komprimiert, will die leisen Stellen NAEHER heran. Ohne Aufholen
    // fuehlt sich der Regler an, als taete er nichts.
    const k = glied(plugin.klangkette(kontext({ kompressor: 4 }).k), 'kompressor')
    assert.ok(k.makeup > 0, `makeup war ${k.makeup}`)
    assert.ok(k.makeup <= 12, 'aber nicht masslos')
  })

  it('ignoriert ein Verhaeltnis unter 1,5 — das taete ohnehin nichts', () => {
    const kette = plugin.klangkette(kontext({ kompressor: 1 }).k)
    assert.deepEqual(kette, [], 'und wirft die Kette auch nicht an')
  })

  it('haengt den Begrenzer ein und uebernimmt die Decke', () => {
    const b = glied(plugin.klangkette(kontext({ begrenzer: -2 }).k), 'begrenzer')
    assert.equal(b.grenze, -2)
  })

  it('nimmt die Schwelle mit, aber nur wenn der Kompressor laeuft', () => {
    const aus = plugin.klangkette(kontext({ kompSchwelle: -25 }).k)
    assert.deepEqual(aus, [], 'eine Schwelle allein wirft nichts an')
    const an = glied(plugin.klangkette(kontext({ kompressor: 3, kompSchwelle: -25 }).k), 'kompressor')
    assert.equal(an.schwelle, -25)
  })

  it('stehen HINTER den Filtern — erst entzerren, dann die Dynamik fassen', () => {
    const arten = plugin
      .klangkette(kontext({ basis: 50, hoehen: 5, kompressor: 3, begrenzer: -2 }).k)
      .map((g) => g.art)
    assert.ok(arten.indexOf('kuhschwanz') < arten.indexOf('kompressor'))
    assert.ok(arten.indexOf('kompressor') < arten.indexOf('begrenzer'), 'der Begrenzer ist die LETZTE Instanz')
  })
})

describe('die Aufholung des Kompressors (Betreiberfund 23.08.2026)', () => {
  /* „die lautstaerke ist stark gedeckelt" — am Geraet gemessen (pw-dump der
   * laufenden Kette): Schwelle -18 dB, Verhaeltnis 3, Makeup 5 dB.
   *
   * Die alte Regel war `min(12, verhaeltnis * 1,5)` und ignorierte die
   * SCHWELLE — dabei entscheidet die mit, wie viel ueberhaupt weggenommen
   * wird. */
  const kompressorAus = (kompressor, kompSchwelle) =>
    plugin.klangkette({
      protokoll: () => {},
      einstellungen: Object.freeze({ basis: 100, kompressor, kompSchwelle, begrenzer: 0 }),
    })

  const makeupVon = async (verh, schwelle) => {
    const glieder = await kompressorAus(verh, schwelle)
    return glieder.find((g) => g.art === 'kompressor')?.makeup
  }

  it('DER GEMESSENE FALL: -18 dB bei 3:1 braucht 12 dB, nicht 5', async () => {
    // Ausgang = -18 + (0 - -18)/3 = -12 dB. Es fehlen 12, aufgeholt wurden 5.
    assert.equal(await makeupVon(3, -18), 12)
  })

  it('die Aufholung stellt die Einheit bei 0 dBFS wieder her', async () => {
    // |Schwelle| * (1 - 1/Verhaeltnis) — nachgerechnet, nicht geraten.
    for (const [verh, schwelle] of [
      [2, -18],
      [3, -12],
      [4, -8],
    ]) {
      const noetig = Math.abs(schwelle) * (1 - 1 / verh)
      assert.equal(await makeupVon(verh, schwelle), Math.round(noetig), `${verh}:1 ab ${schwelle} dB`)
    }
  })

  it('DIE SCHWELLE ZAEHLT MIT — bei gleichem Verhaeltnis, anderer Schwelle', async () => {
    // Genau das konnte die alte Regel nicht: sie gab fuer beide 5 dB.
    const flach = await makeupVon(3, -6)
    const tief = await makeupVon(3, -18)
    assert.notEqual(flach, tief, 'zwei Schwellen duerfen nicht dieselbe Aufholung ergeben')
    assert.ok(tief > flach, 'die tiefere Schwelle nimmt mehr weg und braucht mehr zurueck')
  })

  it('DER DECKEL VON 12 dB BLEIBT — mehr hiesse Rauschen aus den kleinen Chassis', async () => {
    // -30 bei 6:1 braeuchte rechnerisch 25 dB. Die Grenze ist eine bewusste
    // Entscheidung; die Spitzen faengt ohnehin der Begrenzer.
    assert.equal(await makeupVon(6, -30), 12)
  })

  it('ohne Kompressor gibt es kein Glied — und nichts aufzuholen', async () => {
    const glieder = await kompressorAus(0, -18)
    assert.equal(
      glieder.find((g) => g.art === 'kompressor'),
      undefined,
    )
  })
})
