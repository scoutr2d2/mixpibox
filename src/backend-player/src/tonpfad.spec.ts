/**
 * Tests fuer tonpfad.ts.
 *
 * KEIN PipeWire, KEIN Prozess, KEINE Box. Gemessen wird gegen
 * `tonpfad.fixture.json` — eine pw-dump-artige Struktur, die die am
 * 31.08.2026 AM GERAET kartierte Lage nachbildet:
 *
 *     spotify (85) --> klangwerk (60) --> klangwerk.ausgang (62) --> alsa_output (47)
 *     entzerrer.ausgang (71) --> klangwerk (60)
 *     spotify (85) --> mixpi-mitschnitt (90)
 *     alsa_output (47) --> mixpi-pegel (92)
 *
 * Die Feldnamen der Kanten (`output-node-id`, `output-port-id`,
 * `input-node-id`, `input-port-id`) sind nicht geraten, sondern gegen das
 * Programm gegengelesen (`strings /usr/bin/pw-dump`), ebenso die
 * Portstruktur gegen eine echte lokale `pw-dump`-Ausgabe.
 *
 * Die Randfaelle entstehen NICHT als zweite Handschrift, sondern durch
 * gezieltes Verbiegen genau dieser einen echten Vorlage — eine erfundene
 * zweite Vorlage koennte in einem Feld danebenliegen, ohne dass es auffiele.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type CuePlan,
  cueBefundAus,
  cuePlanAus,
  EINSPEISE_KLASSE,
  istSpotifyEinspeisung,
  KLANGWERK_SENKE,
  knotenAus,
  linksAus,
  planBeschreiben,
  senkeFinden,
  spotifyKandidaten,
  type TonKnoten,
  trennBefehle,
  verbindBefehle,
} from './tonpfad'
import VORLAGE from './tonpfad.fixture.json'

/** Eine unabhaengige Kopie — kein Test darf einem anderen die Vorlage verbiegen. */
function abschrift(): Record<string, unknown>[] {
  return structuredClone(VORLAGE) as unknown as Record<string, unknown>[]
}

/** Die Abschrift ohne die Objekte, auf die `passt` zutrifft. */
function ohne(passt: (o: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  return abschrift().filter((o) => !passt(o))
}

const istKnoten = (o: Record<string, unknown>, id: number) => o.type === 'PipeWire:Interface:Node' && o.id === id
const istLink = (o: Record<string, unknown>, id: number) => o.type === 'PipeWire:Interface:Link' && o.id === id

/** Nur fuer die Merkmals-Tests: ein Knoten aus vier Angaben. */
function knoten(teil: Partial<TonKnoten>): TonKnoten {
  return { id: 1, name: '', klasse: EINSPEISE_KLASSE, anwendung: '', programm: '', ...teil }
}

describe('knotenAus / linksAus — die Vorlage wird richtig gelesen', () => {
  it('findet alle Tonknoten, und nur die Knoten', () => {
    const alle = knotenAus(abschrift())
    // Core und Client stehen mit in der Vorlage — sie duerfen nicht mitkommen,
    // und der Client traegt sogar application.name "Spotify".
    assert.deepEqual(
      alle.map((k) => k.id),
      [47, 60, 62, 71, 85, 90, 92],
    )
    const spotify = alle.find((k) => k.id === 85)
    assert.deepEqual(spotify, {
      id: 85,
      name: 'spotify',
      klasse: 'Stream/Output/Audio',
      anwendung: 'Spotify',
      programm: 'soloist',
    })
  })

  it('liest die vier Nummern einer Kante aus `info`, nicht aus `props`', () => {
    const eine = linksAus(abschrift()).find((l) => l.id === 120)
    assert.deepEqual(eine, { id: 120, ausgangKnoten: 85, ausgangPort: 86, eingangKnoten: 60, eingangPort: 63 })
  })

  it('eine Kante mit fehlender Portnummer faellt weg statt halb weiterzureisen', () => {
    // Halb waere schlimmer als gar nicht: trennen ginge, zurueckverbinden nicht.
    const verbogen = abschrift()
    const kante = verbogen.find((o) => istLink(o, 121)) as { info: Record<string, unknown> }
    delete kante.info['input-port-id']
    assert.deepEqual(
      linksAus(verbogen)
        .filter((l) => l.ausgangKnoten === 85)
        .map((l) => l.id),
      [120, 126],
    )
  })

  it('kaputte Eingaben ergeben leere Listen statt eines Wurfs', () => {
    for (const muell of [null, undefined, 42, 'nicht json', {}, [null, 7, 'x']]) {
      assert.deepEqual(knotenAus(muell), [])
      assert.deepEqual(linksAus(muell), [])
      assert.equal(cuePlanAus(muell), null)
    }
  })
})

describe('istSpotifyEinspeisung — der Riegel ist die Klasse, nicht der Name', () => {
  it('erkennt Soloist (Knoten heisst `spotify`) und librespot', () => {
    assert.equal(istSpotifyEinspeisung(knoten({ name: 'spotify', anwendung: 'Spotify', programm: 'soloist' })), true)
    assert.equal(istSpotifyEinspeisung(knoten({ name: 'librespot', anwendung: 'librespot' })), true)
    // Nur EIN Feld muss treffen — das ist der Grund fuer drei Namensplaetze.
    assert.equal(istSpotifyEinspeisung(knoten({ name: 'alsa_playback.librespot', programm: 'librespot' })), true)
    assert.equal(istSpotifyEinspeisung(knoten({ anwendung: 'Spotify (Kinderzimmer)' })), true)
    assert.equal(istSpotifyEinspeisung(knoten({ name: 'spotify.1' })), true)
  })

  it('DIE TEUERSTE VERWECHSLUNG: der Mitschnitt ist keine Einspeisung', () => {
    // mixpi-mitschnitt zapft `spotify` ab und traegt deshalb im Alltag alles
    // Spotify-Aehnliche in seiner Umgebung. Die Klasse rettet: er nimmt AUF.
    assert.equal(
      istSpotifyEinspeisung(knoten({ name: 'mixpi-mitschnitt', klasse: 'Stream/Input/Audio', anwendung: 'Spotify' })),
      false,
    )
    assert.equal(istSpotifyEinspeisung(knoten({ name: 'mixpi-pegel', klasse: 'Stream/Input/Audio' })), false)
    // Und eine Senke, die zufaellig so hiesse, ebenfalls nicht.
    assert.equal(istSpotifyEinspeisung(knoten({ name: 'spotify', klasse: 'Audio/Sink' })), false)
  })

  it('ein Name, der den Kandidaten bloss ENTHAELT, trifft nicht', () => {
    assert.equal(istSpotifyEinspeisung(knoten({ name: 'spotify-mitschnitt' })), false)
    assert.equal(istSpotifyEinspeisung(knoten({ name: 'nicht-spotify' })), false)
    assert.equal(istSpotifyEinspeisung(knoten({ name: 'spotifyd-eigenbau' })), false)
    assert.equal(istSpotifyEinspeisung(knoten({ name: '' })), false)
  })

  it('die eigenen Kettenglieder der Box sind keine Spotify-Einspeisung', () => {
    for (const name of ['klangwerk', 'klangwerk.ausgang', 'entzerrer.ausgang']) {
      assert.equal(istSpotifyEinspeisung(knoten({ name })), false)
    }
  })
})

describe('senkeFinden', () => {
  it('findet `klangwerk` und nimmt den ERSTEN vorhandenen Wunschnamen', () => {
    assert.equal(senkeFinden(abschrift())?.id, 60)
    assert.equal(senkeFinden(abschrift(), ['gibtsnicht', KLANGWERK_SENKE])?.name, 'klangwerk')
    assert.equal(senkeFinden(abschrift(), ['gibtsnicht']), null)
  })

  it('verwechselt die Senke nicht mit ihrem Ausgang', () => {
    // `klangwerk` und `klangwerk.ausgang` sind zwei Knoten; der Zulauf haengt
    // an der Senke, nicht am Ausgang.
    assert.equal(senkeFinden(abschrift())?.klasse, 'Audio/Sink')
  })
})

describe('cueBefundAus — der Alltagsfall', () => {
  it('plant genau die zwei Kanten spotify -> klangwerk', () => {
    const befund = cueBefundAus(abschrift())
    assert.equal(befund.art, 'bereit')
    const plan = (befund as { plan: CuePlan }).plan
    assert.equal(plan.quelle.id, 85)
    assert.equal(plan.senke.id, 60)
    assert.deepEqual(
      plan.kanten.map((k) => k.id),
      [120, 121],
    )
  })

  it('DER MITSCHNITT-ABGRIFF WIRD GESCHONT — der ganze Grund fuer pw-link statt Mute', () => {
    const plan = cuePlanAus(abschrift())
    assert.ok(plan)
    // 126 ist spotify -> mixpi-mitschnitt. Er darf NICHT in `kanten` stehen …
    assert.equal(
      plan.kanten.some((k) => k.id === 126),
      false,
    )
    // … und er muss als bewusst stehen gelassen ausgewiesen sein.
    assert.deepEqual(
      plan.geschont.map((k) => k.id),
      [126],
    )
  })

  it('laesst den mpv-Weg unangetastet', () => {
    const plan = cuePlanAus(abschrift())
    assert.ok(plan)
    // 122/123 sind entzerrer.ausgang -> klangwerk. Sie laufen in DIESELBE
    // Senke; nur der Ausgangsknoten unterscheidet sie. Genau hier wuerde ein
    // Plan, der „alles was ins Klangwerk geht" trennt, den lokalen Ton killen.
    for (const id of [122, 123]) {
      assert.equal(
        plan.kanten.some((k) => k.id === id),
        false,
      )
      assert.equal(
        plan.geschont.some((k) => k.id === id),
        false,
      )
    }
  })

  it('die Befehle: trennen ueber die Link-Nummer, zurueck ueber die PORT-Nummern', () => {
    const plan = cuePlanAus(abschrift())
    assert.ok(plan)
    assert.deepEqual(trennBefehle(plan), [
      { programm: 'pw-link', argumente: ['-d', '120'] },
      { programm: 'pw-link', argumente: ['-d', '121'] },
    ])
    // NICHT ['-d','120'] rueckwaerts und NICHT die Knotennummern 85/60: der
    // Link ist nach dem Trennen als Objekt weg, die Ports ueberleben.
    assert.deepEqual(verbindBefehle(plan), [
      { programm: 'pw-link', argumente: ['86', '63'] },
      { programm: 'pw-link', argumente: ['87', '64'] },
    ])
  })

  it('planBeschreiben nennt Quelle, Senke, Kanten und das Geschonte', () => {
    const plan = cuePlanAus(abschrift())
    assert.ok(plan)
    assert.equal(
      planBeschreiben(plan),
      'spotify (85) -> klangwerk (60): 86->63 (Link 120), 87->64 (Link 121), geschont: 126',
    )
  })
})

describe('cueBefundAus — die Randfaelle', () => {
  it('SPOTIFY SPIELT NICHT: kein Knoten -> sauberes `kein-spotify`, kein Wurf', () => {
    // Der Normalfall, nicht die Ausnahme: der Knoten existiert NUR bei
    // laufender Wiedergabe (die Fehlmessung vom 31.08. mittags).
    const ohneSpotify = ohne((o) => istKnoten(o, 85))
    assert.deepEqual(cueBefundAus(ohneSpotify), { art: 'kein-spotify' })
    assert.equal(cuePlanAus(ohneSpotify), null)
  })

  it('KEINE SENKE: das Klangwerk ist aus -> begruendete Absage, kein geratener Rueckfall', () => {
    const ohneKlangwerk = ohne((o) => istKnoten(o, 60))
    assert.deepEqual(cueBefundAus(ohneKlangwerk), { art: 'keine-senke', gesucht: ['klangwerk'] })
  })

  it('FEHLENDE LINKS: der Knoten steht, fuehrt aber keinen Ton (Soloist in der Pause)', () => {
    const ohneKanten = ohne((o) => istLink(o, 120) || istLink(o, 121))
    const befund = cueBefundAus(ohneKanten)
    assert.equal(befund.art, 'keine-links')
    // Wer es war, gehoert in die Antwort — sonst sucht man am Geraet blind.
    assert.equal((befund as { quelle: TonKnoten }).quelle.id, 85)
    assert.equal((befund as { senke: TonKnoten }).senke.id, 60)
  })

  it('ZWEI KANDIDATEN, EINER SPIELT: der Graph entscheidet, nicht der Name', () => {
    const zwei = abschrift()
    zwei.push({
      id: 99,
      type: 'PipeWire:Interface:Node',
      info: { props: { 'media.class': 'Stream/Output/Audio', 'node.name': 'librespot', 'object.id': 99 } },
    })
    const plan = cuePlanAus(zwei)
    assert.ok(plan)
    // 99 haengt an keiner Kante -> 85 gewinnt, obwohl 99 hoeher sortiert.
    assert.equal(plan.quelle.id, 85)
    assert.deepEqual(
      spotifyKandidaten(zwei).map((k) => k.id),
      [85, 99],
    )
  })

  it('ZWEI KANDIDATEN, BEIDE SPIELEN: lieber gar nichts als die falsche Kante', () => {
    const zwei = abschrift()
    zwei.push({
      id: 99,
      type: 'PipeWire:Interface:Node',
      info: { props: { 'media.class': 'Stream/Output/Audio', 'node.name': 'librespot', 'object.id': 99 } },
    })
    zwei.push({
      id: 140,
      type: 'PipeWire:Interface:Link',
      info: { 'output-node-id': 99, 'output-port-id': 100, 'input-node-id': 60, 'input-port-id': 63 },
    })
    const befund = cueBefundAus(zwei)
    assert.equal(befund.art, 'mehrdeutig')
    assert.deepEqual(
      (befund as { kandidaten: readonly TonKnoten[] }).kandidaten.map((k) => k.id),
      [85, 99],
    )
    assert.equal(cuePlanAus(zwei), null)
  })
})
