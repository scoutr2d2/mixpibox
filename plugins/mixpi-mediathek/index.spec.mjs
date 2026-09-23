/**
 * ZEUGEN FUER mixpi-mediathek — ohne Netz, ohne Box.
 *
 * DIE VORLAGE IST ECHT: `ard.fixture.json` ist die auf das Noetige gekuerzte
 * Antwort der ARD vom 20.09.2026 (Suche „Sendung mit der Maus", Werkseite
 * „Klima-Maus Teil 6"). Kein erfundenes JSON — die drei Eigenheiten, an denen
 * dieses Plugin haengt, haette sich niemand ausgedacht: dieselbe Folge liegt
 * DREIMAL in der Trefferliste, die Hoerfassung liegt in DERSELBEN Gruppe wie
 * die normale Fassung, und die groesste angebotene Adresse ist HLS.
 *
 *     node --test plugins/mixpi-mediathek/index.spec.mjs
 */

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import plugin, {
  abgelaufen,
  besteQuelle,
  bildAus,
  nebenfassung,
  nebenspur,
  nurInland,
  sperrgrund,
  sucheAdresse,
  trefferAus,
  videoAdresse,
  videoAus,
  zahlAus,
} from './index.mjs'

const VORLAGE = JSON.parse(readFileSync(new URL('./ard.fixture.json', import.meta.url), 'utf8'))
/**
 * DIE ZWEITE VORLAGE — „Kommissar Wisting", am 20.09.2026 geholt, weil die
 * erste zwei Faelle NICHT zeigt, die auf der Box sofort zuschlugen:
 * `isGeoBlocked: true` bei einer Folge, die aus Deutschland spielt, und DREI
 * Tonsaetze in derselben Gruppe mit VERTAUSCHTER Markierung.
 */
const WISTING = JSON.parse(readFileSync(new URL('./ard-wisting.fixture.json', import.meta.url), 'utf8'))
/** Ein Zeitpunkt, an dem die Vorlage noch verfuegbar war (availableTo 2026-11-03). */
const DAMALS = Date.parse('2026-09-20T12:00:00Z')

/* ── Bilder ──────────────────────────────────────────────────────────────── */

test('bildAus fuellt den Platzhalter {width} — roh gespeichert gibt die ARD 400', () => {
  const src = bildAus(VORLAGE.suche.teasers[0].images)
  ok(src.startsWith('https://'), src)
  ok(!src.includes('{width}'), src)
  ok(src.includes('w=512'), src)
})

test('bildAus nimmt auch ein einzelnes Bildobjekt (Werkseite statt Teaser)', () => {
  const src = bildAus({ src: 'https://example.org/b.jpg?w={width}&ch=1' }, 320)
  strictEqual(src, 'https://example.org/b.jpg?w=320&ch=1')
})

test('bildAus liefert leer statt undefined, wenn es kein Bild gibt', () => {
  strictEqual(bildAus(null), '')
  strictEqual(bildAus({}), '')
})

/* ── Nebenfassungen ──────────────────────────────────────────────────────── */

test('nebenfassung erkennt Audiodeskription und Gebaerdensprache', () => {
  ok(nebenfassung('Klima-Maus Teil 6 (Audiodeskription)'))
  ok(nebenfassung('Klima-Maus Teil 6 (mit Gebärdensprache)'))
  ok(nebenfassung('Klima-Maus Teil 6 (mit Gebaerdensprache)'))
  ok(nebenfassung('Etwas (Hörfassung)'))
})

test('nebenfassung laesst die normale Fassung und Klammern im Titel in Ruhe', () => {
  ok(!nebenfassung('Klima-Maus Teil 6'))
  ok(!nebenfassung('Die Maus (Folge 3)'))
  ok(!nebenfassung(''))
})

/* ── Suchtreffer ─────────────────────────────────────────────────────────── */

test('trefferAus wirft die zwei Nebenfassungen weg — aus drei Kacheln wird eine', () => {
  strictEqual(VORLAGE.suche.teasers.length, 3)
  const treffer = trefferAus(VORLAGE.suche, DAMALS)
  strictEqual(treffer.length, 1)
  strictEqual(treffer[0].name, 'Klima-Maus Teil 6')
  strictEqual(treffer[0].sendung, 'Die Maus')
  strictEqual(treffer[0].dauerSek, 1626)
  strictEqual(treffer[0].kinderinhalt, true)
  ok(treffer[0].bild.startsWith('https://'))
})

test('trefferAus zeigt die Nebenfassungen auf Wunsch doch', () => {
  strictEqual(trefferAus(VORLAGE.suche, DAMALS, true).length, 3)
})

test('trefferAus laesst Abgelaufenes liegen', () => {
  const spaeter = Date.parse('2026-12-01T00:00:00Z')
  strictEqual(trefferAus(VORLAGE.suche, spaeter).length, 0)
})

test('trefferAus ueberlebt Muell in der Liste, statt zu werfen', () => {
  const rumpf = { teasers: [null, {}, { id: 'x' }, { longTitle: 'ohne Kennung' }] }
  deepStrictEqual(trefferAus(rumpf, DAMALS), [])
})

/* ── Die Quellenwahl ─────────────────────────────────────────────────────── */

const STREAMS = VORLAGE.seite.widgets[0].mediaCollection.embedded.streams

test('besteQuelle nimmt 540p — die groesste Stufe unter dem Deckel', () => {
  const q = besteQuelle(STREAMS, 960)
  strictEqual(q.breite, 960)
  strictEqual(q.hoehe, 540)
  ok(q.adresse.endsWith('.mp4'), q.adresse)
})

test('besteQuelle nimmt NIE die HLS-Adresse — ein <video> in Chromium kann sie nicht', () => {
  for (const deckel of [360, 960, 1920, 4096]) {
    const q = besteQuelle(STREAMS, deckel)
    ok(!q.adresse.includes('.m3u8'), `${deckel}: ${q.adresse}`)
  }
})

test('besteQuelle nimmt NIE die Hoerfassung — sie liegt in derselben Gruppe', () => {
  // Die Adressen der Audiodeskription in der Vorlage, aus den rohen Daten
  // gezogen statt abgeschrieben: was hier steht, bleibt richtig, wenn die
  // Vorlage einmal erneuert wird.
  const hoerfassung = new Set()
  for (const g of STREAMS) {
    for (const m of g.media ?? []) {
      if ((m.audios ?? []).some((a) => a.kind === 'audio-description')) hoerfassung.add(m.url)
    }
  }
  ok(hoerfassung.size > 0, 'die Vorlage enthaelt keine Hoerfassung mehr')
  for (const deckel of [360, 640, 960, 1280, 1920]) {
    ok(!hoerfassung.has(besteQuelle(STREAMS, deckel).adresse), String(deckel))
  }
})

test('besteQuelle nimmt NIE die Gebaerdensprach-Gruppe', () => {
  const dgs = new Set((STREAMS.find((s) => s.kind === 'sign-language')?.media ?? []).map((m) => m.url))
  ok(dgs.size > 0, 'die Vorlage enthaelt keine DGS-Gruppe mehr')
  ok(!dgs.has(besteQuelle(STREAMS, 1920).adresse))
})

test('besteQuelle nimmt die kleinste Stufe, wenn keine unter den Deckel passt', () => {
  const q = besteQuelle(STREAMS, 200)
  strictEqual(q.breite, 640)
})

test('besteQuelle meldet null statt zu raten, wenn nichts Spielbares dasteht', () => {
  strictEqual(besteQuelle([]), null)
  strictEqual(besteQuelle(null), null)
  strictEqual(
    besteQuelle([{ kind: 'main', media: [{ url: 'https://x/y.m3u8', mimeType: 'application/vnd.apple.mpegurl' }] }]),
    null,
  )
  strictEqual(besteQuelle([{ kind: 'main', media: [{ url: 'file:///etc/passwd', mimeType: 'video/mp4' }] }]), null)
})

/* ── DIE VERTAUSCHTE MARKIERUNG (Wisting) ────────────────────────────────── */

test('besteQuelle nimmt den SENDETON, obwohl die Hoerfassung als „standard" markiert ist', () => {
  // WAS IN DER VORLAGE STEHT, aus den rohen Daten gezogen statt abgeschrieben:
  // die Hoerfassung traegt `standard`, der internationale Ton
  // `audio-description`. Wer nur das Feld liest, greift daneben.
  const streams = WISTING.widgets[0].mediaCollection.embedded.streams
  const alle = streams.flatMap((s) => s.media)
  const hoerfassungAlsStandard = alle.filter(
    (m) => /audiodeskription/i.test(m.url) && (m.audios ?? []).every((a) => a.kind === 'standard'),
  )
  ok(hoerfassungAlsStandard.length > 0, 'die Vorlage zeigt die vertauschte Markierung nicht mehr')

  for (const deckel of [360, 640, 960, 1280, 1920]) {
    const q = besteQuelle(streams, deckel)
    ok(/sendeton/i.test(q.adresse), `${deckel}: ${q.adresse}`)
  }
})

test('nebenspur erkennt die Wortmarken im Dateinamen — und nur die', () => {
  ok(nebenspur('https://x/JOB_1__audiodeskription_960x540.mp4'))
  ok(nebenspur('https://x/etwas_internationalerton_640x360.mp4'))
  ok(nebenspur('https://x/etwas_Hoerfassung.mp4'))
  ok(!nebenspur('https://x/JOB_1__sendeton_960x540.mp4'))
  ok(!nebenspur('https://x/3491739_67546427.mp4'))
  ok(!nebenspur(''))
})

test('die Leiter faellt zurueck, statt nichts zu liefern', () => {
  // NUR Nebenspuren da: dann gilt die Sperrliste nicht mehr. Ein schwarzes
  // Bild waere die schlechtere Antwort als die falsche Tonspur.
  const nur = [
    {
      kind: 'main',
      media: [
        { url: 'https://x/a__audiodeskription_640x360.mp4', mimeType: 'video/mp4', maxHResolutionPx: 640, audios: [{ kind: 'audio-description' }] },
      ],
    },
  ]
  strictEqual(besteQuelle(nur, 960).adresse, 'https://x/a__audiodeskription_640x360.mp4')
})

test('die Vorlage der Maus bleibt unveraendert richtig — das Feld traegt dort sehr wohl', () => {
  const q = besteQuelle(STREAMS, 960)
  strictEqual(q.breite, 960)
  ok(!/audiodeskription/i.test(q.adresse))
})

/* ── Sperren ─────────────────────────────────────────────────────────────── */

test('sperrgrund laesst die Vorlage durch', () => {
  strictEqual(sperrgrund(VORLAGE.seite.widgets[0], DAMALS), null)
})

test('sperrgrund nennt jede Sperre einzeln — ein blosses Nein hilft niemandem', () => {
  strictEqual(sperrgrund({ blockedByFsk: true }, DAMALS), 'durch die FSK gesperrt')
  strictEqual(sperrgrund({ blockedByLoginOnly: true }, DAMALS), 'nur mit ARD-Konto abrufbar')
  strictEqual(sperrgrund({ availableTo: '2020-01-01T00:00:00Z' }, DAMALS), 'nicht mehr in der Mediathek')
  strictEqual(sperrgrund(null, DAMALS), 'nicht gefunden')
})

/* ── DER TEUERSTE FALL: EIN MERKMAL, DAS WIE EINE SPERRE AUSSIEHT ──────────
 *
 * AM GERAET GEMESSEN (20.09.2026, Box .62): die erste Freigabe auf der
 * echten Box scheiterte an `isGeoBlocked: true` — und ein HEAD auf dieselbe
 * MP4-Adresse, aus demselben Wohnzimmer, antwortete 200 video/mp4. Das Feld
 * beschreibt das WERK („gibt es nur im Inland"), nicht den Fragenden.
 *
 * Der Zeuge steht in BEIDE Richtungen da: sperren darf es nicht, mitreisen
 * muss es. Wer die Zeile wieder zur Sperre macht, faellt hier auf. */
test('isGeoBlocked SPERRT NICHT — eine Box in Deutschland spielt es', () => {
  strictEqual(sperrgrund({ geoblocked: true }, DAMALS), null)
  strictEqual(sperrgrund({ mediaCollection: { embedded: { isGeoBlocked: true } } }, DAMALS), null)
})

test('nurInland erkennt beide Schreibweisen und reist als Merkmal mit', () => {
  ok(nurInland({ geoblocked: true }))
  ok(nurInland({ mediaCollection: { embedded: { isGeoBlocked: true } } }))
  ok(!nurInland({}))
  ok(!nurInland(null))
  const inland = structuredClone(VORLAGE.seite)
  inland.widgets[0].mediaCollection.embedded.isGeoBlocked = true
  const v = videoAus(inland, DAMALS)
  strictEqual(v.ok, true)
  strictEqual(v.nurInland, true)
  // Ohne das Merkmal steht das Feld GAR NICHT da (statt `false`) — so wie
  // jedes andere freiwillige Feld dieses Plugins.
  strictEqual(videoAus(VORLAGE.seite, DAMALS).nurInland, undefined)
})

test('abgelaufen gilt nur mit Datum — ohne Datum bleibt der Eintrag', () => {
  strictEqual(abgelaufen('', DAMALS), false)
  strictEqual(abgelaufen('unfug', DAMALS), false)
  strictEqual(abgelaufen('2020-01-01T00:00:00Z', DAMALS), true)
  strictEqual(abgelaufen('2099-01-01T00:00:00Z', DAMALS), false)
})

/* ── Die ganze Werkseite ─────────────────────────────────────────────────── */

test('videoAus liefert Adresse, Name, Sendung, Dauer und Bild', () => {
  const v = videoAus(VORLAGE.seite, DAMALS)
  strictEqual(v.ok, true)
  strictEqual(v.name, 'Klima-Maus Teil 6')
  strictEqual(v.sendung, 'Die Maus')
  strictEqual(v.dauerSek, 1626)
  strictEqual(v.kinderinhalt, true)
  strictEqual(v.quelle.breite, 960)
  ok(v.quelle.adresse.startsWith('https://'))
  ok(v.bild.startsWith('https://'))
  ok(v.beschreibung.length > 20)
})

test('videoAus meldet den Grund, statt zu werfen', () => {
  deepStrictEqual(videoAus({ widgets: [] }, DAMALS), { ok: false, grund: 'nicht gefunden' })
  const gesperrt = structuredClone(VORLAGE.seite)
  gesperrt.widgets[0].blockedByLoginOnly = true
  strictEqual(videoAus(gesperrt, DAMALS).grund, 'nur mit ARD-Konto abrufbar')
})

test('videoAus meldet, wenn es die Seite gibt, aber keine spielbare Fassung', () => {
  const ohne = structuredClone(VORLAGE.seite)
  ohne.widgets[0].mediaCollection.embedded.streams = []
  strictEqual(videoAus(ohne, DAMALS).grund, 'keine abspielbare Fassung gefunden')
})

/* ── Adressen und Zahlen ─────────────────────────────────────────────────── */

test('sucheAdresse und videoAdresse gehen an die ARD und kodieren, was sie bekommen', () => {
  const s = sucheAdresse('Maus & Elefant', 5)
  ok(s.startsWith('https://api.ardmediathek.de/page-gateway/widgets/ard/search/vod?'), s)
  ok(s.includes('searchString=Maus+%26+Elefant'), s)
  ok(s.includes('pageSize=5'), s)
  const v = videoAdresse('Y3JpZDovL3dkci5kZS9hLWI=')
  ok(v.includes('Y3JpZDovL3dkci5kZS9hLWI%3D'), v)
  ok(v.includes('mcV6=true'), v)
})

test('zahlAus haelt sich an die Grenzen und an die Vorgabe', () => {
  strictEqual(zahlAus(undefined, 12, 1, 24), 12)
  strictEqual(zahlAus('abc', 12, 1, 24), 12)
  strictEqual(zahlAus('99', 12, 1, 24), 24)
  strictEqual(zahlAus('0', 12, 1, 24), 1)
  strictEqual(zahlAus('7', 12, 1, 24), 7)
})

/* ── Die Flaeche ─────────────────────────────────────────────────────────── */

/** Ein Kontext, der nicht ins Netz geht, sondern die Vorlage zurueckgibt. */
function kontextMit(antworten) {
  const gerufen = []
  return {
    gerufen,
    protokoll() {},
    einstellungen: {},
    async holen(adresse) {
      gerufen.push(adresse)
      const treffer = antworten.find(([muster]) => adresse.includes(muster))
      if (!treffer) return { ok: false, status: 404, async json() { return {} } }
      return { ok: true, status: 200, async json() { return treffer[1] } }
    },
  }
}

test('http suche liefert die entdoppelte Trefferliste', async () => {
  const kontext = kontextMit([['search/vod', VORLAGE.suche]])
  const a = await plugin.http({ methode: 'GET', pfad: 'suche', abfrage: { begriff: 'Maus' } }, kontext)
  strictEqual(a.status ?? 200, 200)
  strictEqual(a.inhalt.treffer.length, 1)
  ok(kontext.gerufen[0].includes('searchString=Maus'))
})

test('http suche weist einen zu kurzen Begriff ab, OHNE ins Netz zu gehen', async () => {
  const kontext = kontextMit([])
  const a = await plugin.http({ methode: 'GET', pfad: 'suche', abfrage: { begriff: 'a' } }, kontext)
  strictEqual(a.status, 400)
  strictEqual(kontext.gerufen.length, 0)
})

test('http video/<kennung> liefert die MP4-Adresse', async () => {
  const kontext = kontextMit([['pages/ard/item', VORLAGE.seite]])
  const a = await plugin.http({ methode: 'GET', pfad: 'video/abc', abfrage: {} }, kontext)
  strictEqual(a.status ?? 200, 200)
  strictEqual(a.inhalt.quelle.breite, 960)
})

test('http video/<kennung> nimmt den Breiten-Deckel aus der Abfrage an', async () => {
  const kontext = kontextMit([['pages/ard/item', VORLAGE.seite]])
  const a = await plugin.http({ methode: 'GET', pfad: 'video/abc', abfrage: { breite: '1280' } }, kontext)
  strictEqual(a.inhalt.quelle.breite, 1280)
})

test('http video/<kennung> meldet 404 mit Grund, wenn die ARD sperrt', async () => {
  const gesperrt = structuredClone(VORLAGE.seite)
  gesperrt.widgets[0].blockedByLoginOnly = true
  const a = await plugin.http({ methode: 'GET', pfad: 'video/abc', abfrage: {} }, kontextMit([['item', gesperrt]]))
  strictEqual(a.status, 404)
  strictEqual(a.inhalt.grund, 'nur mit ARD-Konto abrufbar')
})

test('http meldet 502 statt zu werfen, wenn die ARD nicht antwortet', async () => {
  const a = await plugin.http({ methode: 'GET', pfad: 'suche', abfrage: { begriff: 'Maus' } }, kontextMit([]))
  strictEqual(a.status, 502)
  ok(String(a.inhalt.fehler).includes('404'))
})

test('http kennt nur GET und nur zwei Pfade', async () => {
  const kontext = kontextMit([['search/vod', VORLAGE.suche]])
  strictEqual((await plugin.http({ methode: 'POST', pfad: 'suche', abfrage: {} }, kontext)).status, 405)
  strictEqual((await plugin.http({ methode: 'GET', pfad: 'unfug', abfrage: {} }, kontext)).status, 404)
  strictEqual(kontext.gerufen.length, 0)
})

test('ohne das Recht netz sagen befinden und aktion es, statt zu werfen', async () => {
  const leer = { protokoll() {}, einstellungen: {} }
  strictEqual((await plugin.befinden(leer)).ok, false)
  strictEqual((await plugin.aktion('pruefen', leer)).ok, false)
  strictEqual((await plugin.aktion('unfug', leer)).ok, false)
})

test('die Aktion pruefen nennt Antwortzeit und Trefferzahl', async () => {
  const a = await plugin.aktion('pruefen', kontextMit([['search/vod', VORLAGE.suche]]))
  strictEqual(a.ok, true)
  ok(/ms/.test(a.text), a.text)
})
