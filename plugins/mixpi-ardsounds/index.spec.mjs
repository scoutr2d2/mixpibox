/**
 * Zeugen fuer die ARD-REGELN — mit den Regeln aus ard.ts hierher umgezogen
 * (E78/E79). Eine Regel ohne Zeugen waere keine Migration, sondern ein
 * Verlust; jede Messung, die diese Regeln begruendet hat, steht im
 * Kopfkommentar von index.mjs.
 *
 * GEFAELSCHTES NETZ, ECHTE FLAECHEN: geprueft wird ueber `inhalt()`,
 * `aufloesen()` und `http()` — die Wege, die auch die Box nimmt. Der
 * gefaelschte `holen` verzweigt nach dem INHALT der GraphQL-Frage, weil alle
 * Fragen an dieselbe Adresse gehen.
 *
 *   node --test plugins/mixpi-ardsounds/index.spec.mjs
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import plugin, { zwischenspeicherLeeren } from './index.mjs'

/** Ein Kontext, dessen ARD aus einer Tabelle antwortet: Muster -> data. */
function kontextMit(antworten) {
  return {
    protokoll: () => {},
    einstellungen: Object.freeze({}),
    holen: async (_adresse, gaben) => {
      const frage = JSON.parse(gaben.body).query
      for (const [muster, daten] of antworten) {
        if (frage.includes(muster)) return { ok: true, json: async () => ({ data: daten }) }
      }
      throw new Error(`keine gefaelschte Antwort fuer: ${frage.slice(0, 60)}`)
    },
  }
}

const MORGEN = new Date(Date.now() + 86_400_000).toISOString()
const GESTERN = new Date(Date.now() - 86_400_000).toISOString()

function folgeRoh(nr, extra = {}) {
  return {
    id: `f${nr}`,
    title: `Folge ${nr}`,
    titleClean: `Folge ${nr}`,
    duration: 300,
    publishDate: `2026-08-${String(nr).padStart(2, '0')}T06:00:00Z`,
    itemType: 'EPISODE',
    isPublished: true,
    image: { url1X1: 'https://bild.de/{width}.jpg' },
    audios: [{ url: `https://ton.de/f${nr}.mp3`, mimeType: 'audio/mpeg' }],
    audioList: [{ availableTo: MORGEN }],
    ...extra,
  }
}

function sendungMit(folgen) {
  return [
    [
      'programSet(id:$id)',
      { programSet: { id: 's1', title: 'Die Sendung', publicationService: { title: 'WDR' }, items: { nodes: folgen } } },
    ],
  ]
}

describe('die Folgen-Regeln (aus ard.ts umgezogen, E78)', () => {
  it('TON-NACHSICHT: fehlendes mimeType wirft keine spielbare Folge weg', async () => {
    // Gemessen: an ffprobe war die Datei ohne Merkmal ein reines MP3.
    const inhalt = await plugin.inhalt('s1', kontextMit(sendungMit([
      folgeRoh(1, { audios: [{ url: 'https://ton.de/ohne.mp3' }] }),
      folgeRoh(2, { audios: [{ url: 'https://video.de/x.mp4', mimeType: 'video/mp4' }] }),
    ])))
    assert.equal(inhalt.folgen.length, 1, 'ohne Merkmal spielt, video/mp4 nicht')
    assert.equal(inhalt.folgen[0].quelle.adresse, 'https://ton.de/ohne.mp3')
  })

  it('VERWEILDAUER: abgelaufene Folgen fallen, ohne Datum gilt die Folge', async () => {
    const inhalt = await plugin.inhalt('s1', kontextMit(sendungMit([
      folgeRoh(1, { audioList: [{ availableTo: GESTERN }] }),
      folgeRoh(2, { audioList: [] }),
      folgeRoh(3),
    ])))
    assert.deepEqual(inhalt.folgen.map((f) => f.kennung), ['f3', 'f2'])
  })

  it('SPERRLISTE, keine Erlaubnisliste: SECTION spielt, EVENT_LIVESTREAM nie', async () => {
    // Gemessen: bei MausZoom und Herzfunk sind die spielbaren Stuecke
    // SECTION — eine Erlaubnisliste haette die Sendungen stumm eingedampft.
    const inhalt = await plugin.inhalt('s1', kontextMit(sendungMit([
      folgeRoh(1, { itemType: 'SECTION' }),
      folgeRoh(2, { itemType: 'EVENT_LIVESTREAM' }),
      folgeRoh(3, { itemType: 'VOELLIG_NEU' }),
    ])))
    assert.deepEqual(inhalt.folgen.map((f) => f.kennung), ['f3', 'f1'])
  })

  it('ORDNUNG: neueste zuerst ist die Vorgabe, #aelteste dreht um, ohne Datum hinten', async () => {
    const roh = [folgeRoh(1), folgeRoh(3), folgeRoh(2, { publishDate: '' })]
    const neueste = await plugin.inhalt('s1', kontextMit(sendungMit(roh)))
    assert.deepEqual(neueste.folgen.map((f) => f.kennung), ['f3', 'f1', 'f2'])
    const aelteste = await plugin.inhalt('s1#aelteste', kontextMit(sendungMit(roh)))
    assert.deepEqual(aelteste.folgen.map((f) => f.kennung), ['f1', 'f3', 'f2'])
  })

  it('BILD: der {width}-Platzhalter wird gefuellt — roh gespeichert antwortet die Adresse mit 400', async () => {
    const inhalt = await plugin.inhalt('s1', kontextMit(sendungMit([folgeRoh(1)])))
    assert.equal(inhalt.folgen[0].bild, 'https://bild.de/512.jpg')
  })

  it('LEER IST EIN ERGEBNIS: alles abgelaufen ist kein Fehler', async () => {
    const inhalt = await plugin.inhalt('s1', kontextMit(sendungMit([folgeRoh(1, { audioList: [{ availableTo: GESTERN }] })])))
    assert.equal(inhalt.folgen.length, 0)
    assert.equal(inhalt.titel, 'Die Sendung')
  })

  it('der KUENSTLER ist die Anstalt — ohne sie der Dienstname', async () => {
    const mit = await plugin.inhalt('s1', kontextMit(sendungMit([])))
    assert.equal(mit.kuenstler, 'WDR')
  })
})

describe('die Browse-Regeln (aus ard.ts umgezogen, E79)', () => {
  // Der 15-min-Speicher des Plugins ueberlebt zwischen Zeugen — ohne das
  // Leeren bekaeme der Kinderbezug-Zeuge die Sammlungen des vorigen.
  beforeEach(() => zwischenspeicherLeeren())

  const SAMMLUNGEN = [
    ['editorialCollections', {
      editorialCollections: { nodes: [
        { id: '1', title: 'Geschichten für Kinder von 3 bis 6', numberOfElements: 5, document: { teasers: [] } },
        { id: '2', title: 'Krimis ab 16 Jahren', numberOfElements: 9, document: null },
        { id: '3', title: 'Autos, Autos, Autos | ARD Retro', numberOfElements: 7, document: null },
        { id: '4', title: 'Hörspiele für Kinder', numberOfElements: 3, document: null },
        { id: '5', title: 'Leere Sammlung', numberOfElements: 0, document: null },
      ] },
    }],
  ]

  it('ALTERSFENSTER stehen im Titel — von/bis, „ab N Jahren", „Kinder ab N"', async () => {
    const a = await plugin.http({ methode: 'GET', pfad: 'sammlungen', abfrage: {}, rumpf: null }, kontextMit(SAMMLUNGEN))
    const je = Object.fromEntries(a.inhalt.sammlungen.map((s) => [s.id, s.fenster]))
    assert.deepEqual(je['1'], { von: 3, bis: 6 })
    assert.deepEqual(je['2'], { von: 16, bis: null })
    assert.equal(je['3'], null)
  })

  it('MIT ALTER wird gesiebt: passendes Fenster ODER Kinderbezug — 321 von 323 tragen keins', async () => {
    const a = await plugin.http({ methode: 'GET', pfad: 'sammlungen', abfrage: { alter: '5' }, rumpf: null }, kontextMit(SAMMLUNGEN))
    const ids = a.inhalt.sammlungen.map((s) => s.id)
    assert.ok(ids.includes('1'), 'Fenster 3-6 passt fuer 5')
    assert.ok(ids.includes('4'), 'Kinderbezug am Titel')
    assert.ok(!ids.includes('2'), 'ab 16 passt nicht')
    assert.ok(!ids.includes('3'), 'Autos|Retro hat weder Fenster noch Kinderbezug')
    assert.ok(!ids.includes('5'), 'leere Sammlungen sind ein Versprechen ohne Deckung')
    assert.equal(a.inhalt.gefiltert, true)
    assert.equal(a.inhalt.gesamt, 4, 'gesamt zaehlt die brauchbaren VOR dem Sieben')
  })

  it('NACHLAUF: wer 7 ist, hoert „3 bis 6" noch — zwei Jahre Toleranz', async () => {
    const a7 = await plugin.http({ methode: 'GET', pfad: 'sammlungen', abfrage: { alter: '7' }, rumpf: null }, kontextMit(SAMMLUNGEN))
    assert.ok(a7.inhalt.sammlungen.some((s) => s.id === '1'))
    const a9 = await plugin.http({ methode: 'GET', pfad: 'sammlungen', abfrage: { alter: '9' }, rumpf: null }, kontextMit(SAMMLUNGEN))
    assert.ok(!a9.inhalt.sammlungen.some((s) => s.id === '1'), 'mit 9 ist es vorbei')
  })

  it('KINDERBEZUG schuetzt vor falschen Freunden', async () => {
    // Kinderwunsch/Kinderschutz sind KEINE Kinderinhalte — gemessen an echten
    // Sammlungstiteln.
    const boese = [['editorialCollections', { editorialCollections: { nodes: [
      { id: '9', title: 'Kinderwunsch und Realität', numberOfElements: 3, document: null },
    ] } }]]
    const a = await plugin.http({ methode: 'GET', pfad: 'sammlungen', abfrage: { alter: '5' }, rumpf: null }, kontextMit(boese))
    assert.equal(a.inhalt.sammlungen.length, 0)
  })

  it('der VORSCHLAG ist die eine Stelle der data.json-Form — Kennung, NIE die Tonadresse', async () => {
    const regal = [['editorialCategory', { editorialCategory: { programSets: { nodes: [
      { id: '77', title: 'Sendung X', publicationService: { title: 'BR' }, image: { url1X1: 'https://b.de/{width}.jpg' } },
    ] } } }]]
    const a = await plugin.http({ methode: 'GET', pfad: 'kategorie/42914714', abfrage: {}, rumpf: null }, kontextMit(regal))
    assert.deepEqual(a.inhalt.sendungen[0].vorschlag, {
      type: 'ard', category: 'audiobook', id: '77', title: 'Sendung X', artist: 'BR', cover: 'https://b.de/512.jpg',
    })
    assert.equal(a.inhalt.fuerKinder, true)
  })
})

describe('die Radiosender (E84)', () => {
  beforeEach(() => zwischenspeicherLeeren())

  /** Ein roher permanentLivestreams-Knoten, wie ihn die ARD liefert. */
  function senderRoh(nr, extra = {}) {
    return {
      id: `s${nr}`,
      title: `Sender ${nr}`,
      image: { url1X1: 'https://bild.de/{width}.jpg' },
      // ECHTE REIHENFOLGE: die ARD nennt MP3 zuerst, HLS danach.
      audios: [
        { url: `https://strom.de/${nr}.mp3`, mimeType: 'audio/mp3' },
        { url: `https://strom.de/${nr}.m3u8`, mimeType: 'application/vnd.apple.mpegurl' },
      ],
      publicationService: { title: 'BR' },
      ...extra,
    }
  }
  const senderMit = (knoten) => [['permanentLivestreams', { permanentLivestreams: { nodes: knoten } }]]
  const holen = (abfrage, knoten) =>
    plugin.http({ methode: 'GET', pfad: 'sender', abfrage, rumpf: null }, kontextMit(senderMit(knoten)))

  it('DIE SPERRE BLEIBT: Sender kommen aus permanentLivestreams, NICHT aus den Folgenlisten', async () => {
    // Der Zeuge, der nicht kippen darf. Wer die Sender dadurch einbaut, dass
    // er EVENT_LIVESTREAM in folgenAus() durchlaesst, macht diesen Test rot.
    const inhalt = await plugin.inhalt('s1', kontextMit(sendungMit([
      folgeRoh(1, { itemType: 'EVENT_LIVESTREAM' }),
      folgeRoh(2),
    ])))
    assert.equal(inhalt.folgen.length, 1, 'der Livestream gehoert NICHT in die Folgenliste')
    assert.equal(inhalt.folgen[0].name, 'Folge 2')
  })

  it('der VORSCHLAG ist `radio` und traegt die ADRESSE in `id` — nicht die Kennung', async () => {
    // Begruendung im Kopf von senderVorschlagAus: artVon() bildet dienst 'ard'
    // unbedingt auf 'show' ab, und eine Show ist ein Sender nicht.
    const a = await holen({}, [senderRoh(1)])
    assert.deepEqual(a.inhalt.sender[0].vorschlag, {
      type: 'radio',
      category: 'music',
      id: 'https://strom.de/1.mp3',
      title: 'Sender 1',
      artist: 'BR',
      cover: 'https://bild.de/512.jpg',
    })
  })

  it('MP3 vor HLS: genommen wird die Adresse, die mpv ohne Umweg spielt', async () => {
    const a = await holen({}, [senderRoh(1)])
    assert.equal(a.inhalt.sender[0].adresse, 'https://strom.de/1.mp3')
  })

  it('OHNE TON KEIN SENDER — eine Kachel, die beim Druck nichts tut, ist schlimmer als keine', async () => {
    const a = await holen({}, [senderRoh(1, { audios: [] }), senderRoh(2)])
    assert.equal(a.inhalt.sender.length, 1)
    assert.equal(a.inhalt.sender[0].titel, 'Sender 2')
  })

  it('nur HLS zaehlt nicht als Ton — mimeType application/… faellt durch tonAus', async () => {
    const nurHls = senderRoh(1, { audios: [{ url: 'https://strom.de/1.m3u8', mimeType: 'application/vnd.apple.mpegurl' }] })
    const a = await holen({}, [nurHls, senderRoh(2)])
    assert.equal(a.inhalt.sender.length, 1, 'ein Sender ohne MP3 wird nicht angeboten')
  })

  it('SUCHE siebt ueber Titel UND Anstalt, ohne q kommt alles', async () => {
    const knoten = [senderRoh(1), senderRoh(2, { publicationService: { title: 'WDR' } })]
    const alle = await holen({}, knoten)
    assert.equal(alle.inhalt.sender.length, 2)
    assert.equal(alle.inhalt.gesamt, 2)
    const wdr = await holen({ q: 'wdr' }, knoten)
    assert.equal(wdr.inhalt.sender.length, 1)
    assert.equal(wdr.inhalt.sender[0].herausgeber, 'WDR')
    // `gesamt` bleibt die Gesamtzahl, damit die Seite „1 von 2" sagen kann.
    assert.equal(wdr.inhalt.gesamt, 2)
  })

  it('BILD: der {width}-Platzhalter wird auch beim Sender gefuellt', async () => {
    const a = await holen({}, [senderRoh(1)])
    assert.equal(a.inhalt.sender[0].bild, 'https://bild.de/512.jpg')
  })

  it('LEER IST EIN ERGEBNIS: keine Sender ist kein Fehler', async () => {
    const a = await holen({}, [])
    assert.equal(a.inhalt.sender.length, 0)
    assert.equal(a.inhalt.gesamt, 0)
  })
})
