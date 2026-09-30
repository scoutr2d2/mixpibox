/**
 * Zeugen fuer mixpi-gruppen — ohne Netz, ohne Box, ohne Schluessel.
 *
 * Die Namen stammen aus dem echten Bestand der Box .62 (26.09.2026). Jev wird
 * durch eine Funktion ersetzt, die die Frage LIEST und nach einer festen
 * Tabelle antwortet; so prueft jeder Zeuge auch, was hinausgeht.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import { setTimeout as warten } from 'node:timers/promises'
import { antwort, kontext } from '../pruefstand.mjs'
import plugin, {
  ANBIETER,
  ablageSchreiben,
  antwortLesen,
  dienstAus,
  frageRumpf,
  hauptVon,
  kandidaten,
  laufAbwarten,
  namenAus,
  paarSchluessel,
  speicherLeeren,
  starten,
  woerter,
  zugang,
  zwischenname,
} from './index.mjs'

const BESTAND = [
  { type: 'ard', artist: 'Die Maus', title: 'MausZoom – Kindernachrichten' },
  { type: 'spotify', artist: 'Die Maus', title: 'Gute Nacht mit der Maus' },
  { type: 'library', artist: 'Die Maus, Eva mit Gitarre, Der Elefant', title: 'Ohrwürmer und Kinderlieder' },
  { type: 'library', artist: 'Leo Lausemaus', title: 'Folge 100_ Es ist doch ein Geheimnis!' },
  { type: 'spotify', artist: 'EUROPA Hörspiele & Kinderlieder', title: 'Hello Kitty - Alle Hörspiele' },
  { type: 'library', artist: 'Hello Kitty Hörspiele', title: 'Folge 12_ Fans und Freunde' },
  { type: 'library', artist: 'Die Schlümpfe', title: 'Die Hits der Schlümpfe' },
  { type: 'library', artist: 'Die drei !!!', title: 'Verliebte Fälle' },
  { type: 'spotify', artist: "Gabby's Dollhouse", title: 'Folge 40' },
  { type: 'library', artist: 'Gabby’s Dollhouse Deutschland', title: 'Der Glitzerweg' },
]

/** Jevs Urteil je Paar — was nicht drinsteht, ist „verschieden". */
const URTEIL = {
  [paarSchluessel('Die Maus', 'Die Maus, Eva mit Gitarre, Der Elefant')]: { wahl: 'mitwirkung', verschieden: 0.2 },
  [paarSchluessel('EUROPA Hörspiele & Kinderlieder', 'Hello Kitty Hörspiele')]: { wahl: 'dieselbe', verschieden: 0.4 },
  [paarSchluessel("Gabby's Dollhouse", 'Gabby’s Dollhouse Deutschland')]: { wahl: 'dieselbe', verschieden: 0.05 },
}

/** Aus dem gesendeten Zustand die beiden Namen zurueckholen. */
function namenAusZustand(state) {
  return [...state.matchAll(/Name [AB]: „(.*)"$/gm)].map((m) => m[1])
}

function jev(gesendet) {
  return (adresse, gaben) => {
    const rumpf = JSON.parse(gaben.body)
    gesendet.push({ adresse, gaben, rumpf })
    const [a, b] = namenAusZustand(rumpf.state)
    const u = URTEIL[paarSchluessel(a, b)] ?? { wahl: 'verschieden', verschieden: 0.97 }
    const rest = (1 - u.verschieden) / 2
    return antwort(
      JSON.stringify({
        answers: {
          zuordnung: {
            type: 'choice',
            choice: u.wahl,
            probabilities: { dieselbe: rest, mitwirkung: rest, verschieden: u.verschieden },
            confidence: 0.9,
          },
        },
        usage: { cost: 0.000001 },
      }),
    )
  }
}

const EINST = { openrouterSchluessel: 'sk-or-test', schwelle: 0.7 }

beforeEach(() => speicherLeeren())

describe('Woerter und Namen', () => {
  it("liest Gabby’s und Gabby's als dasselbe Wort", () => {
    assert.deepEqual([...woerter('Gabby’s Dollhouse')], [...woerter("Gabby's Dollhouse")])
  })

  it('wirft Fuellworte weg — sonst waeren „Die Schlümpfe" und „Die drei !!!" ein Paar', () => {
    assert.deepEqual([...woerter('Die drei !!!')], ['drei'])
    assert.equal(woerter('Die Schlümpfe - Alle Hörspiele').has('die'), false)
  })

  it('zaehlt Eintraege und Dienste je Name', () => {
    const maus = namenAus(BESTAND).find((n) => n.name === 'Die Maus')
    assert.equal(maus.anzahl, 2)
    assert.deepEqual(maus.dienste, ['ard', 'spotify'])
  })
})

describe('Kandidaten', () => {
  const paare = kandidaten(namenAus(BESTAND)).map((p) => paarSchluessel(p.a.name, p.b.name))

  it('findet die Maus ueber verschiedene Dienste', () => {
    assert.ok(paare.includes(paarSchluessel('Die Maus', 'Die Maus, Eva mit Gitarre, Der Elefant')))
  })

  it('findet Hello Kitty ueber den TITEL, obwohl der Name nichts teilt', () => {
    assert.ok(paare.includes(paarSchluessel('EUROPA Hörspiele & Kinderlieder', 'Hello Kitty Hörspiele')))
  })

  it('laesst Leo Lausemaus und die Maus in Ruhe — ein Wortteil ist kein Wort', () => {
    assert.equal(
      paare.some((p) => p.includes('leo lausemaus')),
      false,
    )
  })

  it('bildet kein Paar nur aus Fuellworten', () => {
    assert.equal(paare.includes(paarSchluessel('Die Schlümpfe', 'Die drei !!!')), false)
  })

  it('haelt den Deckel ein', () => {
    assert.equal(kandidaten(namenAus(BESTAND), 1).length, 1)
  })
})

describe('Anzeigename', () => {
  it('nimmt den mit mehr Eintraegen, bei Gleichstand den kuerzeren', () => {
    const a = { name: 'Die Maus, Eva mit Gitarre, Der Elefant', anzahl: 1 }
    const b = { name: 'Die Maus', anzahl: 1 }
    assert.equal(hauptVon(a, b), b)
    assert.equal(hauptVon({ ...a, anzahl: 5 }, b).anzahl, 5)
  })
})

describe('die Frage an Jev', () => {
  it('ist eine Auswahl mit genau den drei vorgegebenen Antworten', () => {
    const [a, b] = namenAus(BESTAND)
    const r = frageRumpf(a, b, 'typesafe/jev-latest')
    assert.equal(r.model, 'typesafe/jev-latest')
    assert.equal(r.questions.zuordnung.type, 'choice')
    assert.deepEqual(Object.keys(r.questions.zuordnung.criteria).sort(), ['dieselbe', 'mitwirkung', 'verschieden'])
    assert.match(r.state, /Name A: „Die Maus"/)
  })

  it('rechnet die Sicherheit als Gegenteil von „verschieden"', () => {
    const r = antwortLesen({
      answers: {
        zuordnung: { choice: 'dieselbe', probabilities: { dieselbe: 0.5, mitwirkung: 0.3, verschieden: 0.2 } },
      },
    })
    assert.equal(r.wahl, 'dieselbe')
    assert.ok(Math.abs(r.sicherheit - 0.8) < 1e-9)
  })

  it('wirft bei einer Antwort ohne gueltige Wahl, statt sie als „verschieden" zu lesen', () => {
    assert.throws(() => antwortLesen({ answers: { zuordnung: { choice: 'vielleicht' } } }))
    assert.throws(() => antwortLesen({}))
  })
})

describe('Zugang', () => {
  it('verlangt einen Schluessel', () => {
    assert.match(zugang({}).fehler, /OpenRouter-Schluessel/)
  })

  it('nimmt bei typesafe den TypeSafe-Schluessel und das Modell ohne Praefix', () => {
    const z = zugang({ anbieter: 'typesafe', typesafeSchluessel: 'ts', openrouterSchluessel: 'or' })
    assert.equal(z.schluessel, 'ts')
    assert.equal(z.adresse, ANBIETER.typesafe.adresse)
    assert.equal(z.modell, 'jev-latest')
  })

  it('weist einen unbekannten Anbieter ab', () => {
    assert.match(zugang({ anbieter: 'chatgpt', openrouterSchluessel: 'x' }).fehler, /gibt es nicht/)
  })
})

describe('der Durchlauf', () => {
  it('fragt jedes Kandidatenpaar per POST mit Schluessel und zeigt nur, was ueber der Schwelle liegt', async () => {
    const gesendet = []
    const { k } = kontext({ antworten: jev(gesendet), einstellungen: EINST })
    const r = await starten(k, { eintraege: BESTAND })
    assert.equal(r.ok, true, r.text)
    await laufAbwarten()

    const n = kandidaten(namenAus(BESTAND)).length
    assert.equal(gesendet.length, n)
    for (const g of gesendet) {
      assert.equal(g.adresse, ANBIETER.openrouter.adresse)
      assert.equal(g.gaben.method, 'POST')
      assert.equal(g.gaben.headers.authorization, 'Bearer sk-or-test')
    }

    const s = (await plugin.http({ methode: 'GET', pfad: 'stand' }, k)).inhalt
    const gezeigt = s.vorschlaege.map((v) => v.paar)
    assert.deepEqual(gezeigt, [
      paarSchluessel("Gabby's Dollhouse", 'Gabby’s Dollhouse Deutschland'),
      paarSchluessel('Die Maus', 'Die Maus, Eva mit Gitarre, Der Elefant'),
    ])
    assert.equal(s.unsicher, 1, 'Hello Kitty liegt mit 0,6 unter 0,7 und wird nur gezaehlt')
    assert.equal(s.vorschlaege[1].haupt.name, 'Die Maus', 'der Name mit mehr Eintraegen stiftet die Gruppe')
  })

  it('fragt beim zweiten Mal nichts, was schon beantwortet ist', async () => {
    const gesendet = []
    const { k } = kontext({ antworten: jev(gesendet), einstellungen: EINST })
    await starten(k, { eintraege: BESTAND })
    await laufAbwarten()
    const erstes = gesendet.length
    const r = await starten(k, { eintraege: BESTAND })
    await laufAbwarten()
    assert.equal(gesendet.length, erstes)
    assert.match(r.text, /0 Paare/)
  })

  it('laesst ein entschiedenes Paar verschwinden — und „offen" holt es zurueck', async () => {
    const { k } = kontext({ antworten: jev([]), einstellungen: EINST })
    await starten(k, { eintraege: BESTAND })
    await laufAbwarten()
    const paar = paarSchluessel("Gabby's Dollhouse", 'Gabby’s Dollhouse Deutschland')
    await plugin.http({ methode: 'POST', pfad: 'entscheiden', rumpf: { paar, urteil: 'abgelehnt' } }, k)
    let s = (await plugin.http({ methode: 'GET', pfad: 'stand' }, k)).inhalt
    assert.equal(
      s.vorschlaege.some((v) => v.paar === paar),
      false,
    )
    assert.equal(s.abgelehnt, 1)
    await plugin.http({ methode: 'POST', pfad: 'entscheiden', rumpf: { paar, urteil: 'offen' } }, k)
    s = (await plugin.http({ methode: 'GET', pfad: 'stand' }, k)).inhalt
    assert.equal(
      s.vorschlaege.some((v) => v.paar === paar),
      true,
    )
  })

  it('holt alle Neins auf einmal zurueck, laesst ein Ja aber stehen', async () => {
    const { k } = kontext({ antworten: jev([]), einstellungen: EINST })
    await starten(k, { eintraege: BESTAND })
    await laufAbwarten()
    const gabby = paarSchluessel("Gabby's Dollhouse", 'Gabby’s Dollhouse Deutschland')
    const maus = paarSchluessel('Die Maus', 'Die Maus, Eva mit Gitarre, Der Elefant')
    await plugin.http({ methode: 'POST', pfad: 'entscheiden', rumpf: { paar: gabby, urteil: 'abgelehnt' } }, k)
    await plugin.http({ methode: 'POST', pfad: 'entscheiden', rumpf: { paar: maus, urteil: 'angenommen' } }, k)
    const r = await plugin.http(
      { methode: 'POST', pfad: 'entscheiden', rumpf: { alle: 'abgelehnt', urteil: 'offen' } },
      k,
    )
    assert.equal(r.inhalt.zurueck, 1)
    const s = (await plugin.http({ methode: 'GET', pfad: 'stand' }, k)).inhalt
    assert.deepEqual(
      s.vorschlaege.map((v) => v.paar),
      [gabby],
    )
    assert.equal(s.angenommen, 1)
  })

  it('bricht nach einer Fehlerkette ab, statt jedes Paar gegen eine Wand zu fragen', async () => {
    let n = 0
    const viele = Array.from({ length: 30 }, (_, i) => ({
      type: 'library',
      artist: `Team Karacho, Gast ${i}`,
      title: 'x',
    }))
    const { k } = kontext({
      antworten: () => {
        n++
        return antwort('{"error":"Insufficient credits"}', { ok: false, status: 402 })
      },
      einstellungen: EINST,
    })
    await starten(k, { eintraege: viele })
    await laufAbwarten()
    assert.ok(n < kandidaten(namenAus(viele)).length, `nur ${n} Fragen`)
    const befinden = await plugin.befinden(k)
    assert.equal(befinden.ok, false)
    assert.match(befinden.text, /kein Guthaben/)
  })

  it('startet ohne Schluessel gar nicht erst', async () => {
    const { k, geholt } = kontext({ antworten: {}, einstellungen: {} })
    const r = await starten(k, { eintraege: BESTAND })
    assert.equal(r.ok, false)
    assert.equal(geholt.length, 0)
  })

  it('startet ohne das Recht netz nicht', async () => {
    const { k } = kontext({ netz: false, einstellungen: EINST })
    assert.equal((await starten(k, { eintraege: BESTAND })).ok, false)
  })
})

/* ── Gleichzeitig: kein Klick geht verloren (AUDIT-2026-09-28 §1b Rang 2) ── */

const ordner = []
after(async () => {
  for (const o of ordner) await rm(o, { recursive: true, force: true })
})

/**
 * Ein Datenordner auf der PLATTE. Nur dort gab es den Verlust — im Speicher
 * teilen sich Worker und Klick ohnehin dasselbe Objekt, und die alten Zeugen
 * liefen alle so. Deshalb hat keiner von ihnen den Fehler gesehen.
 */
async function neuerOrdner() {
  const o = await mkdtemp(join(tmpdir(), 'mixpi-gruppen-'))
  ordner.push(o)
  return o
}

async function platte(o) {
  return JSON.parse(await readFile(join(o, 'gruppen.json'), 'utf8'))
}

/**
 * Eine Frist je Zeuge dieses Blocks: ein Wettlauf, den eine Sabotage
 * wieder aufreisst, darf als FAIL-Zeile enden, nicht als stehender Lauf.
 */
const FRIST = { timeout: 10_000 }

/** Zwoelf Namen mit gemeinsamen Woertern — 66 Paare, genug fuer mehrere Zwischenstaende. */
const VIELE = Array.from({ length: 12 }, (_, i) => ({ type: 'library', artist: `Team Karacho, Gast ${i}`, title: 'x' }))

/**
 * Jev mit Schranke: jede Frage wartet, bis `los()` — und ab der Frage Nummer
 * `halt` noch einmal, bis `weiter()`. So klickt der Zeuge MITTEN im Lauf und
 * liest die Platte, waehrend der Lauf steht: ohne Uhr und ohne Glueck.
 */
function jevMitSchranke(gesendet, halt = Number.POSITIVE_INFINITY) {
  const antworte = jev(gesendet)
  let los, weiter, angekommen
  const erst = new Promise((r) => {
    los = r
  })
  const dann = new Promise((r) => {
    weiter = r
  })
  const ersteFrage = new Promise((r) => {
    angekommen = r
  })
  let n = 0
  return {
    antworten: async (adresse, gaben) => {
      angekommen()
      await erst
      if (++n >= halt) await dann
      return antworte(adresse, gaben)
    },
    ersteFrage,
    los: () => los(),
    weiter: () => weiter(),
  }
}

describe('Gleichzeitig: kein Klick geht verloren', () => {
  it('eine Entscheidung waehrend des Durchlaufs ueberlebt den naechsten Zwischenstand des Workers', FRIST, async () => {
    const j = jevMitSchranke([], 26)
    const { k } = kontext({ antworten: j.antworten, einstellungen: { ...EINST, hoechstensPaare: 40 } })
    const o = await neuerOrdner()
    k.datenOrdner = o
    const paar = paarSchluessel('Team Karacho, Gast 0', 'Team Karacho, Gast 1')

    assert.equal((await starten(k, { eintraege: VIELE })).ok, true)
    try {
      await j.ersteFrage
      const r = await plugin.http({ methode: 'POST', pfad: 'entscheiden', rumpf: { paar, urteil: 'abgelehnt' } }, k)
      assert.equal(r.status ?? 200, 200, 'waehrend des Laufs wird niemand abgewiesen')
      j.los()

      // Warten, bis der Worker einen Zwischenstand MIT Antworten geschrieben
      // hat. Der ist sicher NACH dem Klick entstanden: bis `los()` war keine
      // einzige Frage beantwortet.
      let d = await platte(o)
      for (let i = 0; i < 500 && Object.keys(d.antworten).length === 0; i++) {
        await warten(10)
        d = await platte(o)
      }
      assert.ok(Object.keys(d.antworten).length > 0, 'kein Zwischenstand geschrieben — Vorbedingung des Zeugen fehlt')
      assert.equal(
        d.lauf.fertig,
        null,
        'der Lauf muss noch stehen, sonst prueft das den Schluss statt des Zwischenstands',
      )
      assert.equal(
        d.entscheidungen[paar]?.urteil,
        'abgelehnt',
        'der Zwischenstand des Workers hat den Klick ueberschrieben',
      )
      assert.equal((await plugin.http({ methode: 'GET', pfad: 'stand' }, k)).inhalt.abgelehnt, 1)

      j.weiter()
      await laufAbwarten()
      d = await platte(o)
      assert.ok(d.lauf.fertig)
      assert.equal(d.entscheidungen[paar]?.urteil, 'abgelehnt', 'der Schlussstand hat den Klick ueberschrieben')
    } finally {
      // AUCH WENN ES ROT WIRD, die Schranken oeffnen: sonst bleibt der Lauf
      // stehen, `laufend` bleibt gesetzt, und jeder spaetere Zeuge wartet
      // ewig — aus einem lesbaren FAIL wird ein Haenger ohne Zeile.
      j.los()
      j.weiter()
      await laufAbwarten()
    }
  })

  it('zwei Klicks zugleich kommen beide an', FRIST, async () => {
    const { k } = kontext({ antworten: jev([]), einstellungen: EINST })
    k.datenOrdner = await neuerOrdner()
    const gabby = paarSchluessel("Gabby's Dollhouse", 'Gabby’s Dollhouse Deutschland')
    const maus = paarSchluessel('Die Maus', 'Die Maus, Eva mit Gitarre, Der Elefant')
    await Promise.all([
      plugin.http({ methode: 'POST', pfad: 'entscheiden', rumpf: { paar: gabby, urteil: 'abgelehnt' } }, k),
      plugin.http({ methode: 'POST', pfad: 'entscheiden', rumpf: { paar: maus, urteil: 'angenommen' } }, k),
    ])
    const d = await platte(k.datenOrdner)
    assert.deepEqual(Object.keys(d.entscheidungen).sort(), [gabby, maus].sort())
  })

  it('zwei Starts zugleich ergeben EINEN Durchlauf, nicht zwei bezahlte', FRIST, async () => {
    const gesendet = []
    const { k } = kontext({ antworten: jev(gesendet), einstellungen: EINST })
    k.datenOrdner = await neuerOrdner()
    const r = await Promise.all([starten(k, { eintraege: BESTAND }), starten(k, { eintraege: BESTAND })])
    await laufAbwarten()
    await laufAbwarten()
    assert.deepEqual(
      r.map((x) => x.text.startsWith('Gestartet')).sort(),
      [false, true],
      r.map((x) => x.text).join(' | '),
    )
    assert.equal(gesendet.length, kandidaten(namenAus(BESTAND)).length, 'jedes Paar genau einmal gefragt')
  })

  it('meldet einen Zwischenstand, der nicht geschrieben wurde, statt ihn zu verschlucken', FRIST, async () => {
    const j = jevMitSchranke([])
    const { k, protokoll } = kontext({ antworten: j.antworten, einstellungen: { ...EINST, hoechstensPaare: 25 } })
    const o = await neuerOrdner()
    k.datenOrdner = o
    await starten(k, { eintraege: VIELE })
    try {
      await j.ersteFrage
      // Den Ordner durch eine DATEI ersetzen: dann scheitern mkdir und
      // Schreiben auch unter root — ein chmod haelt root nicht auf.
      await rm(o, { recursive: true, force: true })
      await writeFile(o, 'kein Ordner')
    } finally {
      j.los()
      await laufAbwarten()
    }
    assert.ok(
      protokoll.some((z) => /^Zwischenstand nach \d+ Antworten nicht geschrieben: /.test(z)),
      `Protokoll: ${protokoll.join(' | ') || '(leer)'}`,
    )
  })
})

describe('Zwischendatei', () => {
  it('heisst je Aufruf anders', () => {
    const z = '/irgendwo/gruppen.json'
    assert.notEqual(zwischenname(z), zwischenname(z))
  })

  it('vierzig Schreiber zugleich: jeder kommt durch, die Datei ist ganz, keine Leiche bleibt', FRIST, async () => {
    const k = { datenOrdner: await neuerOrdner() }
    // GROSS GENUG, dass ein Schreibvorgang NICHT in einem Zug durchgeht
    // (llmwiki vierzehn-kopien-und-die-abweichung-ist-der-fehler) — Node
    // schreibt in Stuecken zu 512 KiB.
    const fuellung = 'x'.repeat(1_500_000)
    const r = await Promise.allSettled(Array.from({ length: 40 }, (_, nr) => ablageSchreiben(k, { nr, fuellung })))
    assert.deepEqual(
      r.filter((x) => x.status === 'rejected').map((x) => String(x.reason)),
      [],
    )
    const d = await platte(k.datenOrdner)
    assert.equal(d.fuellung.length, fuellung.length)
    assert.deepEqual(await readdir(k.datenOrdner), ['gruppen.json'])
  })
})

describe('Dienst eines Eintrags', () => {
  it('teilt ein wie dienstVon() im Kern — „Spotify" gross geschrieben ist spotify', async () => {
    // DER KERN IST DIE QUELLE, keine Tabelle hier: eine Tabelle waere die
    // naechste Kopie, die still veraltet. Node liest medien.ts ohne Bauschritt
    // (Type-Stripping); die Datei importiert nichts.
    const { dienstVon, pluginKennungAus } = await import('../../src/backend-api/src/medien.ts')
    const faelle = [
      { type: 'Spotify' },
      { type: 'SPOTIFY' },
      { type: 'spotify' },
      { type: 'Jellyfin' },
      { type: 'jellyfinAudio' },
      { type: 'Library' },
      { type: 'local' },
      { type: 'Radio' },
      { type: 'rss' },
      { type: 'ARD' },
      { type: 'plugin', id: 'mixpi-archive:faust1teil' },
      { type: 'Plugin', id: ' mixpi-archive:faust1teil ' },
      { type: 'plugin', id: 'ohne-doppelpunkt' },
      { type: 'plugin', id: ':nur-rest' },
      { type: 'plugin', id: 'nur-kennung:' },
      { type: 'plugin' },
      { type: 'podcast' },
      { type: '' },
      {},
      null,
    ]
    for (const e of faelle) {
      const kern = dienstVon(e)
      const erwartet = kern === 'plugin' ? (pluginKennungAus(e)?.split(':')[0] ?? 'plugin') : kern
      assert.equal(dienstAus(e), erwartet, JSON.stringify(e))
    }
    assert.equal(dienstAus({ type: 'Spotify' }), 'spotify')
  })
})

describe('Verbindung pruefen', () => {
  it('stellt genau eine Frage und nennt die Antwort', async () => {
    const gesendet = []
    const { k } = kontext({ antworten: jev(gesendet), einstellungen: EINST })
    const r = await plugin.aktion('verbindung', k)
    assert.equal(r.ok, true, r.text)
    assert.equal(gesendet.length, 1)
    assert.match(r.text, /openrouter\/typesafe\/jev-latest antwortet/)
  })
})
