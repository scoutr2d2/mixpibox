/**
 * Zeugen fuer mixpi-gruppen — ohne Netz, ohne Box, ohne Schluessel.
 *
 * Die Namen stammen aus dem echten Bestand der Box .62 (26.09.2026). Jev wird
 * durch eine Funktion ersetzt, die die Frage LIEST und nach einer festen
 * Tabelle antwortet; so prueft jeder Zeuge auch, was hinausgeht.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { antwort, kontext } from '../pruefstand.mjs'
import plugin, {
  ANBIETER,
  antwortLesen,
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
