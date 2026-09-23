/**
 * Der Klangwerk-Weg am LAUFENDEN Server — nicht nur die Bausteine.
 *
 * `klangkette.spec.ts` prueft, was aus Gliedern wird; `plugin-wirt.spec.ts`
 * prueft den Worker. Was dazwischen liegt, ist Verdrahtung: erscheint ein
 * Plugin mit dem Recht `klang` ueberhaupt als solches, kommt seine Kette
 * durch den Worker heil im Hauptprozess an, und gibt der Endpunkt zurueck,
 * was die Ton-Seite braucht. Genau dort sitzen die Fehler, die keine
 * Logikpruefung findet.
 *
 * ══ WAS HIER NICHT GEPRUEFT WIRD, UND WARUM ═══════════════════════════════
 * Ob der Ton hinterher WIRKLICH durch die Kette laeuft. Unter `NODE_ENV=test`
 * (so faehrt `npm test`) greift der Umgebungsriegel, der `pactl` und
 * `pipewire -c` stillegt ([[tests-fahren-nichts-herunter]],
 * [[vorschau-wird-geliehen]]) — ohne ihn startete dieser Test einen echten
 * Filterprozess im Tonserver des Entwicklers.
 *
 * Was der Riegel kostet, ist ehrlich zu benennen: `klangwerkNeuAufbauen`
 * kehrt sofort zurueck, also bleibt `an` hier IMMER false. Der Beweis, dass
 * die erzeugte Conf laedt, steht deshalb woanders — sie wurde am 21.08.2026
 * gegen ein echtes PipeWire 1.6.8 geladen (Senke erschien, Ausgangsknoten
 * da, keine Meldung) und mit einem erfundenen Label gegengeprueft (Prozess
 * starb, keine Senke). Am GERAET steht der Nachweis noch aus.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

const PLUGINS = fs.mkdtempSync(path.join(os.tmpdir(), 'mupi-kw-plugins-'))
const KONFIG = fs.mkdtempSync(path.join(os.tmpdir(), 'mupi-kw-konfig-'))
let app: import('express').Express

/** Ein Klang-Plugin, das genau das tut, was mixpi-klang tut — nur kuerzer. */
const KLANG_PLUGIN = `export default {
  klangkette(kontext) {
    const e = kontext.einstellungen ?? {}
    const glieder = []
    const basis = Number(e.basis)
    if (Number.isFinite(basis) && basis < 100) glieder.push({ art: 'basis', breite: basis })
    const hoehen = Number(e.hoehen)
    if (Number.isFinite(hoehen) && hoehen !== 0) {
      glieder.push({ art: 'kuhschwanz', lage: 'hoch', freq: 4000, dB: hoehen })
    }
    return glieder
  },
}
`

/**
 * Eines, das Unsinn liefert — es darf die anderen nicht mitreissen.
 *
 * ES LIEFERT ABSICHTLICH EIN GUELTIGES GLIED DAZU. Mit nur dem krummen waere
 * die Kette ohnehin leer, und der Test unten waere gruen, ohne dass die
 * Pruefung je gegriffen haette (bei der Gegenprobe am 21.08.2026 genau so
 * gemessen: Pruefung entschaerft, Test blieb gruen). Mit dem gueltigen Glied
 * davor prueft er wirklich, dass die GANZE Kette faellt — ein halb
 * uebernommener Filtergraph waere schlimmer als gar keiner.
 */
const KRUMMES_PLUGIN = `export default {
  klangkette() {
    return [
      { art: 'basis', breite: 30 },
      { art: 'faltung', datei: '/etc/shadow' },
    ]
  },
}
`

function pluginAnlegen(kennung: string, quelle: string, rechte: string[], felder: unknown[] = []): void {
  const ordner = path.join(PLUGINS, kennung)
  fs.mkdirSync(ordner, { recursive: true })
  fs.writeFileSync(
    path.join(ordner, 'plugin.json'),
    JSON.stringify({ kennung, name: kennung, fassung: '1.0.0', haupt: 'index.mjs', rechte, felder }),
  )
  fs.writeFileSync(path.join(ordner, 'index.mjs'), quelle)
}

/**
 * Warten, bis ein Plugin bereit ist.
 *
 * ══ OHNE DAS IST DIESE DATEI GRUEN UND PRUEFT NICHTS ══════════════════════
 * Genau so passiert, beim ersten Lauf dieser Datei (21.08.2026): alle
 * Ketten-Tests liefen, BEVOR ein Worker oben war. `klangketten()` gab dann
 * eine leere Liste zurueck — und der Test „sammelt nur Plugins MIT dem Recht
 * ein" war gruen, weil gar nichts gesammelt wurde. Ein falsches Gruen ist
 * schlimmer als ein rotes Ergebnis. Dieselbe Lehre steht schon in
 * plugin-einstellungen.integration.spec.ts.
 *
 * AUCH NACH JEDEM PUT NOETIG: eine Einstellungsaenderung startet den Worker
 * neu, und der neue antwortet nicht sofort.
 */
async function bereit(kennung: string): Promise<void> {
  const bis = Date.now() + 10000
  let stand: { zustand: string; grund?: string } | undefined
  while (Date.now() < bis) {
    const a = await request(app).get('/api/plugins')
    stand = a.body.geladen?.find((s: { kennung: string }) => s.kennung === kennung)
    if (stand && stand.zustand !== 'laedt') break
    await new Promise((f) => setTimeout(f, 50))
  }
  assert.equal(stand?.zustand, 'bereit', `${kennung} — Grund: ${stand?.grund ?? '(keiner gemeldet)'}`)
}

/** Einstellungen setzen UND abwarten, dass das Plugin wieder steht. */
async function einstellen(kennung: string, werte: Record<string, unknown>): Promise<void> {
  await request(app).put(`/api/plugins/${kennung}/einstellungen`).send(werte).expect(200)
  await bereit(kennung)
}

before(async () => {
  // Vor dem Server: `pluginsLaden` laeuft beim Import des Moduls.
  pluginAnlegen(
    'mixpi-pruefklang',
    KLANG_PLUGIN,
    ['klang'],
    [
      { schluessel: 'basis', art: 'zahl', name: 'Stereobasis', vorgabe: 100 },
      { schluessel: 'hoehen', art: 'zahl', name: 'Hoehen', vorgabe: 0 },
    ],
  )
  pluginAnlegen('mixpi-pruefkrumm', KRUMMES_PLUGIN, ['klang'])
  // Und eines OHNE das Recht — es darf im Klangwerk nicht auftauchen.
  //
  // DIE FELDER MUESSEN DIESELBEN SEIN wie beim berechtigten Plugin. Ohne sie
  // filtert `einstellungenNormalisieren` die Werte weg (es nimmt nur, was das
  // Manifest anmeldet), das Plugin liefert eine leere Kette — und der Test
  // waere gruen, ohne die Rechtepruefung je zu beruehren. Genau so war es
  // beim ersten Entwurf; aufgefallen ist es erst, als die Rechtepruefung zur
  // Gegenprobe ENTFERNT wurde und der Test trotzdem gruen blieb.
  pluginAnlegen(
    'mixpi-pruefstumm',
    KLANG_PLUGIN,
    [],
    [
      { schluessel: 'basis', art: 'zahl', name: 'Stereobasis', vorgabe: 100 },
      { schluessel: 'hoehen', art: 'zahl', name: 'Hoehen', vorgabe: 0 },
    ],
  )

  // Wie in plugin-einstellungen.integration.spec.ts: das Konfigurations-
  // verzeichnis umlenken, sonst schreibt der PUT-Weg in den Arbeitsbaum.
  fs.cpSync(path.resolve(import.meta.dirname, '..', 'config'), KONFIG, { recursive: true })
  process.env.MUPIBOX_CONFIG_DIR = KONFIG
  process.env.MUPIBOX_PLUGIN_DIR = PLUGINS
  app = (await import('./server')).app
})

after(async () => {
  // Erst die Worker beenden, dann loeschen — sonst liest ein neu gestarteter
  // Worker seine Einstiegsdatei aus einem geloeschten Ordner.
  const { allesBeenden } = await import('./plugin-wirt')
  await allesBeenden()
  fs.rmSync(PLUGINS, { recursive: true, force: true })
  fs.rmSync(KONFIG, { recursive: true, force: true })
})

describe('das Recht "klang" kommt ueberhaupt durch den Vertrag', () => {
  it('laedt ein Plugin mit dem neuen Recht, statt es abzuweisen', async () => {
    await bereit('mixpi-pruefklang')
    const a = await request(app).get('/api/plugins')
    const p = a.body.geladen.find((x: { kennung: string }) => x.kennung === 'mixpi-pruefklang')
    assert.ok(p, 'das Plugin fehlt in der Liste — dann wurde das Recht abgewiesen')
    assert.deepEqual(p.rechte, ['klang'])
  })

  it('meldet, dass es eine Klangkette liefern kann', async () => {
    await bereit('mixpi-pruefklang')
    const a = await request(app).get('/api/plugins')
    const p = a.body.geladen.find((x: { kennung: string }) => x.kennung === 'mixpi-pruefklang')
    assert.equal(p.kann.klangkette, true, 'ohne das findet der Server die Kette nie')
  })
})

describe('GET /api/ton/klangwerk', () => {
  it('sagt, dass es Klang-Plugins gibt — sonst zeigt die Ton-Seite den Abschnitt nicht', async () => {
    const a = await request(app).get('/api/ton/klangwerk').expect(200)
    assert.equal(a.body.gibt, true)
  })

  it('liefert die Felder, aus denen die Ton-Seite ihre Regler baut', async () => {
    const a = await request(app).get('/api/plugins/mixpi-pruefklang/einstellungen').expect(200)
    assert.equal(a.body.felder.length, 2)
    assert.equal(a.body.felder[0].schluessel, 'basis')
    // Die VORGABE gilt, solange niemand etwas eingetragen hat — sonst stuende
    // in den Reglern eine leere Zeile statt der 100.
    assert.equal(a.body.werte.basis, 100)
  })
})

describe('die Kette kommt aus dem Worker heil im Kern an', () => {
  it('sammelt nur Plugins MIT dem Recht ein', async () => {
    // mixpi-pruefstumm hat dieselbe klangkette(), aber kein Recht — es darf
    // nicht mitrechnen. Sonst waere das Recht eine Beschriftung.
    const { klangketten } = await import('./plugin-wirt')
    await einstellen('mixpi-pruefstumm', { basis: 50 })
    const ketten = await klangketten()
    assert.equal(
      ketten.some((k) => k.kennung === 'mixpi-pruefstumm'),
      false,
      'ein Plugin ohne das Recht "klang" hat im Signalweg nichts verloren',
    )
  })

  it('liefert die Glieder, die aus den Einstellungen folgen', async () => {
    const { klangketten } = await import('./plugin-wirt')
    await einstellen('mixpi-pruefklang', { basis: 50, hoehen: 5 })
    const ketten = await klangketten()
    const meine = ketten.find((k) => k.kennung === 'mixpi-pruefklang')
    assert.ok(meine, 'die Kette kam nicht an')
    assert.deepEqual(meine.kette, [
      { art: 'basis', breite: 50 },
      { art: 'kuhschwanz', lage: 'hoch', freq: 4000, dB: 5, guete: 1 },
    ])
  })

  it('WIRFT EIN KRUMMES PLUGIN HERAUS, ohne die anderen mitzureissen', async () => {
    // Der wichtigste Test der Datei. Eine Kette, die PipeWire nicht laden
    // kann, laesst den Filterprozess sterben — waere der Ton schon dorthin
    // geroutet, stuende ein Kind vor einer stummen Box. Also darf ein
    // krummes Plugin die Kette der uebrigen nicht verhindern.
    const { klangketten } = await import('./plugin-wirt')
    await bereit('mixpi-pruefkrumm')
    await einstellen('mixpi-pruefklang', { basis: 50, hoehen: 5 })
    const ketten = await klangketten()
    assert.equal(
      ketten.some((k) => k.kennung === 'mixpi-pruefkrumm'),
      false,
      'die krumme Kette haette abgewiesen werden muessen',
    )
    assert.equal(
      ketten.some((k) => k.kennung === 'mixpi-pruefklang'),
      true,
      'das gesunde Plugin wurde mit hinausgeworfen — ein Plugin darf die anderen nicht mitreissen',
    )
  })

  it('liefert nichts, wenn alle Regler auf Vorgabe stehen', async () => {
    const { klangketten } = await import('./plugin-wirt')
    await einstellen('mixpi-pruefklang', { basis: 100, hoehen: 0 })
    const ketten = await klangketten()
    assert.equal(
      ketten.some((k) => k.kennung === 'mixpi-pruefklang'),
      false,
      'eine leere Kette gehoert nicht in den Signalweg',
    )
  })
})
