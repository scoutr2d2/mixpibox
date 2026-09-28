/**
 * Zeugen fuer mixpi-kindernachrichten — vor allem fuer die FRISCHE-REGEL, und
 * fuer die Feed-Eigenheiten, die am 28.09.2026 an den echten Feeds gemessen
 * wurden (siehe Kopf von index.mjs). Die vier `*.fixture.xml` daneben tragen
 * die echte FORM der Feeds, gekuerzt auf zwei bis vier Folgen; die Texte
 * darin sind ausgedacht.
 *
 * DIE UHR IST GESTELLT (`uhrStellen`): ohne sie liesse sich die Frische-Regel
 * nur an einem echten Montag pruefen, und ein Zeuge, der vom Kalender
 * abhaengt, ist an sechs Tagen der Woche etwas anderes.
 *
 * GEGEN DIE ECHTEN FEEDS faehrt `node tools/kindernachrichten-probe.mjs`.
 *
 *   node --test plugins/mixpi-kindernachrichten/index.spec.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { fileURLToPath } from 'node:url'
import { antwort, kontext } from '../pruefstand.mjs'
import plugin, { uhrStellen, zwischenspeicherLeeren } from './index.mjs'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const vorlage = (name) => readFileSync(path.join(HIER, `${name}.fixture.xml`), 'utf8')

/** Die festen Feed-Adressen — ABGESCHRIEBEN, nicht importiert: eine
 * geaenderte Tabelle soll hier auffallen, nicht still mitwandern. */
const FEED = {
  maus: 'https://kinder.wdr.de/radio/diemaus/audio/maus-zoom/maus-zoom-106.podcast',
  logo: 'https://www.zdf.de/rss/podcast/audio/zdf/kinder/logo',
  kakadu: 'https://www.kakadu.de/kakadu-104.xml',
  geolino:
    'https://cdn.audiorella.com/podcasts/1688-geolino-spezial-der-wissenspodcast-fur-junge-entdeckerinnen-und-entdecker/feed.rss',
}
const ALLE = Object.fromEntries(Object.entries(FEED).map(([k, a]) => [a, vorlage(k)]))

/** Ein Zeitpunkt in Berliner Sommerzeit. */
const berlin = (text) => Date.parse(`${text}+02:00`)
/** Montag, 28.09.2026, 21 Uhr — beide Nachrichten des Tages sind draussen. */
const MONTAG_ABEND = berlin('2026-09-28T21:00:00')

const mit = (antworten = ALLE, einstellungen = {}) => kontext({ antworten, einstellungen })
const holeGet = (pfad, abfrage = {}) => ({ methode: 'GET', pfad, abfrage, rumpf: null })

/** Ein kleiner Feed fuer die Faelle, die in keinem echten Feed stehen. */
function feedMit(items, kanal = '') {
  return `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Test</title>${kanal}${items.join('')}</channel></rss>`
}
function item({ titel = 'Folge', guid, url = 'https://example.org/a.mp3', typ = 'audio/mpeg', datum, dauer } = {}) {
  return [
    '<item>',
    `<title>${titel}</title>`,
    guid === undefined ? '' : `<guid>${guid}</guid>`,
    url ? `<enclosure url="${url}" type="${typ}" length="1"/>` : '',
    `<pubDate>${datum ?? 'Mon, 28 Sep 2026 06:30:00 GMT'}</pubDate>`,
    dauer ? `<itunes:duration>${dauer}</itunes:duration>` : '',
    '</item>',
  ].join('')
}

beforeEach(() => {
  zwischenspeicherLeeren()
  uhrStellen(() => MONTAG_ABEND)
})
afterEach(() => uhrStellen(null))

describe('die FRISCHE-REGEL', () => {
  it('Maus am Montagabend: Montag und Freitag — nicht der 15.09., nicht der Dezember', async () => {
    const { k } = mit()
    const inhalt = await plugin.inhalt('maus', k)
    assert.deepEqual(
      inhalt.folgen.map((f) => f.name),
      ['MausNachrichten vom 28. September 2026', 'MausNachrichten vom 25. September 2026'],
    )
    assert.equal(inhalt.titel, 'MausNachrichten')
    assert.equal(inhalt.kuenstler, 'WDR')
  })

  it('GRENZE: die Freitagsfolge gilt den GANZEN Montag — 3 Kalendertage, nicht 72 Stunden', async () => {
    // 25.09. 09:00 Uhr bis 28.09. 23:59 Uhr sind ueber 86 Stunden.
    uhrStellen(() => berlin('2026-09-28T23:59:00'))
    const inhalt = await plugin.inhalt('maus', mit().k)
    assert.ok(
      inhalt.folgen.some((f) => f.name.includes('25. September')),
      'die Freitagsfolge ist montags noch da',
    )
  })

  it('… und keine Minute des Dienstags — gezaehlt in BERLIN, nicht in UTC', async () => {
    // 00:30 Uhr am Dienstag ist in UTC noch Montag, 22:30 Uhr. Eine Regel in
    // UTC liesse die Freitagsfolge hier noch durch.
    uhrStellen(() => berlin('2026-09-29T00:30:00'))
    const inhalt = await plugin.inhalt('maus', mit().k)
    assert.deepEqual(
      inhalt.folgen.map((f) => f.name),
      ['MausNachrichten vom 28. September 2026'],
    )
  })

  it('die Einstellung zaehlt: 0 heisst nur von heute, 20 reicht bis zum 15.09.', async () => {
    const heute = await plugin.inhalt('maus', mit(ALLE, { frischeTage: 0 }).k)
    assert.equal(heute.folgen.length, 1)
    zwischenspeicherLeeren()
    const lang = await plugin.inhalt('maus', mit(ALLE, { frischeTage: 20 }).k)
    assert.equal(lang.folgen.length, 3, 'der Dezember bleibt draussen')
  })

  it('ein GELEERTES Feld heisst Vorgabe, nicht 0 Tage — Number("") waere 0', async () => {
    const inhalt = await plugin.inhalt('maus', mit(ALLE, { frischeTage: '' }).k)
    assert.equal(inhalt.folgen.length, 2)
  })

  it('LEER STATT WURF: drei Wochen spaeter gibt es keine Nachricht — und das ist ein Ergebnis', async () => {
    uhrStellen(() => berlin('2026-10-20T12:00:00'))
    const { k } = mit()
    for (const schluessel of ['maus', 'logo', 'heute']) {
      const inhalt = await plugin.inhalt(schluessel, k)
      assert.deepEqual(inhalt.folgen, [], `${schluessel} ist leer`)
      assert.ok(inhalt.titel, `${schluessel} hat trotzdem einen Titel`)
    }
  })

  it('hoechstens sieben — eine Nachrichtenkachel ist ein Rueckblick, keine Chronik', async () => {
    const zehn = Array.from({ length: 10 }, (_, i) =>
      item({ titel: `Nr ${i}`, guid: `g${i}`, url: `https://example.org/${i}.mp3` }),
    )
    const inhalt = await plugin.inhalt('logo', mit({ ...ALLE, [FEED.logo]: feedMit(zehn) }).k)
    assert.equal(inhalt.folgen.length, 7)
    assert.equal(inhalt.vollstaendig, false, 'es gab mehr frische, als geliefert wurden')
  })

  it('die Wissens-Podcasts kennen keine Frische: Kakadu ein Jahr spaeter ist noch ganz da', async () => {
    uhrStellen(() => berlin('2027-09-28T12:00:00'))
    const inhalt = await plugin.inhalt('kakadu', mit().k)
    assert.equal(inhalt.folgen.length, 3)
    assert.equal(inhalt.vollstaendig, true)
  })
})

describe('Nachrichten von heute', () => {
  it('je Quelle die neueste frische Folge: erst die Maus, dann logo! — mit der Quelle im Namen', async () => {
    const inhalt = await plugin.inhalt('heute', mit().k)
    assert.equal(inhalt.titel, 'Nachrichten von heute')
    assert.deepEqual(
      inhalt.folgen.map((f) => f.name),
      ['MausNachrichten vom 28. September 2026', 'logo! – Montag, 28. September'],
    )
  })

  it('die Quelle kommt nur davor, wenn der Titel sie nicht schon nennt — auch klein geschrieben', async () => {
    // Die Maus schrieb sich am 15.09.2026 „Mausnachrichten".
    const maus = feedMit([item({ titel: 'Mausnachrichten vom 28. September 2026', guid: 'm1' })])
    const thema = feedMit([item({ titel: 'Warum Biber D&#228;mme bauen', guid: 'l1' })])
    const inhalt = await plugin.inhalt('heute', mit({ ...ALLE, [FEED.maus]: maus, [FEED.logo]: thema }).k)
    assert.deepEqual(
      inhalt.folgen.map((f) => f.name),
      ['Mausnachrichten vom 28. September 2026', 'logo! – Warum Biber Dämme bauen'],
    )
  })

  it('ist die Maus alt und logo! frisch, kommt nur logo!', async () => {
    uhrStellen(() => berlin('2026-10-02T18:00:00'))
    const logo = feedMit([
      item({ titel: 'Donnerstag, 1. Oktober', guid: 'l', datum: 'Thu, 01 Oct 2026 19:50:00 +0200' }),
    ])
    const inhalt = await plugin.inhalt('heute', mit({ ...ALLE, [FEED.logo]: logo }).k)
    assert.deepEqual(
      inhalt.folgen.map((f) => f.name),
      ['logo! – Donnerstag, 1. Oktober'],
    )
  })

  it('die beiden Feeds gehen GLEICHZEITIG hinaus — nacheinander kosteten sie zusammen die Frist', async () => {
    let laufend = 0
    let hoechstens = 0
    const { k, geholt } = kontext({
      antworten: async (adresse) => {
        laufend++
        hoechstens = Math.max(hoechstens, laufend)
        await new Promise((fertig) => setTimeout(fertig, 20))
        laufend--
        return antwort(ALLE[adresse])
      },
    })
    await plugin.inhalt('heute', k)
    assert.equal(hoechstens, 2)
    assert.deepEqual([...geholt].sort(), [FEED.logo, FEED.maus].sort(), 'und NUR die beiden Nachrichtenfeeds')
  })

  it('eine Quelle weg ist eine kuerzere Liste; beide weg ist ein Fehler mit Grund', async () => {
    const ohneLogo = { ...ALLE, [FEED.logo]: antwort('', { ok: false, status: 503 }) }
    const inhalt = await plugin.inhalt('heute', mit(ohneLogo).k)
    assert.deepEqual(
      inhalt.folgen.map((f) => f.name),
      ['MausNachrichten vom 28. September 2026'],
    )
    assert.equal(inhalt.vollstaendig, false)

    zwischenspeicherLeeren()
    const ohneBeide = { ...ohneLogo, [FEED.maus]: antwort('', { ok: false, status: 500 }) }
    await assert.rejects(
      () => plugin.inhalt('heute', mit(ohneBeide).k),
      /Keine Nachrichtenquelle erreichbar.*HTTP 500.*HTTP 503/,
    )
  })

  it('ein frischer TRAILER verdraengt die Nachrichten nicht — der Maus-Feed vom 31.08.2026', async () => {
    const maus = feedMit([
      item({
        titel: 'Trailer - Die Maus am Morgen',
        guid: 't',
        datum: 'Mon, 28 Sep 2026 18:00:00 GMT',
        dauer: '00:01:18',
      }),
      item({ titel: 'Kurz und ohne Namen', guid: 'k', datum: 'Mon, 28 Sep 2026 17:00:00 GMT', dauer: '45' }),
      item({ titel: 'MausNachrichten vom 28. September 2026', guid: 'n', dauer: '00:05:29' }),
    ])
    const { k } = mit({ ...ALLE, [FEED.maus]: maus })
    const heute = await plugin.inhalt('heute', k)
    assert.equal(heute.folgen[0].name, 'MausNachrichten vom 28. September 2026')
    const nur = await plugin.inhalt('maus', k)
    assert.deepEqual(
      nur.folgen.map((f) => f.kennung),
      ['n'],
    )
  })

  it('die Kennungen tragen die Quelle davor und sind eindeutig', async () => {
    const inhalt = await plugin.inhalt('heute', mit().k)
    assert.deepEqual(
      inhalt.folgen.map((f) => f.kennung),
      ['maus:/00000000000000000000000000000928', 'logo:https://www.zdf.de/uri/00000000-0000-4000-8000-000000000928'],
    )
  })
})

describe('der Leser — die gemessenen Eigenheiten', () => {
  it('&amp; IN DER TONADRESSE wird zu & — der GEOlino-Fall', async () => {
    const inhalt = await plugin.inhalt('geolino', mit().k)
    const adresse = inhalt.folgen[0].quelle.adresse
    assert.equal(
      adresse,
      'https://ais.audiorella.com/podcasts/1688-geolino-spezial-der-wissenspodcast-fur-junge-entdeckerinnen-und-entdecker/251652-new-episode.mp3?v=2&awCollectionId=julephosting_693058f7a1bae&awEpisodeId=251652',
    )
    assert.doesNotMatch(adresse, /&amp;/)
  })

  it('Entitaeten in EINEM Durchgang: aus &amp;lt; wird &lt;, nicht <', async () => {
    const feed = feedMit([item({ titel: 'A &amp;lt; B &#x26; C', guid: 'x' })])
    const inhalt = await plugin.inhalt('kakadu', mit({ ...ALLE, [FEED.kakadu]: feed }).k)
    assert.equal(inhalt.folgen[0].name, 'A &lt; B & C')
  })

  it('alle drei Dauerformate: Sekunden (logo!), mm:ss (Kakadu), hh:mm:ss (Maus, GEOlino)', async () => {
    const { k } = mit()
    assert.equal((await plugin.inhalt('logo', k)).folgen[0].dauerSek, 632)
    assert.equal((await plugin.inhalt('kakadu', k)).folgen[0].dauerSek, 26 * 60 + 18)
    assert.equal((await plugin.inhalt('maus', k)).folgen[0].dauerSek, 5 * 60 + 29)
    assert.equal((await plugin.inhalt('geolino', k)).folgen[0].dauerSek, 24 * 60 + 8)
  })

  it('eine Dauer, die keine ist, bleibt leer — keine erfundene Zahl auf der Kachel', async () => {
    const feed = feedMit([
      item({ guid: 'a', url: 'https://example.org/a.mp3', dauer: 'etwa zehn Minuten' }),
      item({ guid: 'b', url: 'https://example.org/b.mp3', dauer: '0' }),
    ])
    const inhalt = await plugin.inhalt('kakadu', mit({ ...ALLE, [FEED.kakadu]: feed }).k)
    assert.deepEqual(
      inhalt.folgen.map((f) => f.dauerSek),
      [undefined, undefined],
    )
  })

  it('Titel: Leerzeichen am Ende weg (logo!), Zahlentitaeten aufgeloest (Maus)', async () => {
    const logo = await plugin.inhalt('logo', mit().k)
    assert.equal(logo.folgen[0].name, 'Montag, 28. September')
    zwischenspeicherLeeren()
    const maus = await plugin.inhalt('maus', mit(ALLE, { frischeTage: 400 }).k)
    assert.equal(maus.folgen.at(-1).name, 'Warum Biber Dämme bauen')
  })

  it('Bilder: das der Folge, sonst das des Kanals — und http wird https (logo!)', async () => {
    const { k } = mit()
    const logo = await plugin.inhalt('logo', k)
    assert.equal(logo.folgen[0].bild, 'https://module.zdf.de/podcasts/logo_podcast_1400.jpg')
    const kakadu = await plugin.inhalt('kakadu', k)
    assert.match(kakadu.folgen[0].bild, /bild-fledermaeuse/, 'die Folge hat ein eigenes')
    assert.match(kakadu.folgen[2].bild, /kakadu-podcast-100/, 'diese nicht — also das Kanalbild')
    const geolino = await plugin.inhalt('geolino', k)
    assert.match(geolino.folgen[0].bild, /1688_cover\.jpg\?v=2$/, 'die Abfrage bleibt dran')
  })

  it('JEDE Folge traegt eine Kennung — ohne sie uebergeht der Kern sie STILL', async () => {
    uhrStellen(() => berlin('2026-09-28T21:00:00'))
    const { k } = mit(ALLE, { frischeTage: 400 })
    for (const schluessel of ['maus', 'logo', 'kakadu', 'geolino', 'heute']) {
      const inhalt = await plugin.inhalt(schluessel, k)
      assert.ok(inhalt.folgen.length > 0, `${schluessel} hat Folgen`)
      for (const f of inhalt.folgen)
        assert.ok(String(f.kennung ?? '').trim(), `${schluessel}: "${f.name}" ohne Kennung`)
      const kennungen = inhalt.folgen.map((f) => f.kennung)
      assert.equal(new Set(kennungen).size, kennungen.length, `${schluessel}: Kennungen eindeutig`)
    }
  })

  it('ohne guid ist die Tonadresse die Kennung; ohne Ton gibt es keine Folge', async () => {
    const feed = feedMit([
      item({ titel: 'Ohne guid', url: 'https://example.org/ohne.mp3' }),
      item({ titel: 'Leere guid', guid: '  ', url: 'https://example.org/leer.mp3' }),
      item({ titel: 'Ohne Anhang', guid: 'x', url: '' }),
      item({ titel: 'Ein Video', guid: 'v', url: 'https://example.org/v.mp4', typ: 'video/mp4' }),
    ])
    const inhalt = await plugin.inhalt('kakadu', mit({ ...ALLE, [FEED.kakadu]: feed }).k)
    assert.deepEqual(
      inhalt.folgen.map((f) => [f.name, f.kennung]),
      [
        ['Ohne guid', 'https://example.org/ohne.mp3'],
        ['Leere guid', 'https://example.org/leer.mp3'],
      ],
    )
  })

  it('Wissen: neueste zuerst, #aelteste umgekehrt', async () => {
    const { k } = mit()
    const neu = await plugin.inhalt('kakadu', k)
    const alt = await plugin.inhalt('kakadu#aelteste', k)
    assert.match(neu.folgen[0].name, /Fledermäuse/)
    assert.deepEqual(
      alt.folgen.map((f) => f.kennung),
      neu.folgen.map((f) => f.kennung).reverse(),
    )
  })

  it('eine Antwort ohne RSS ist ein Fehler, kein leerer Feed', async () => {
    const html = '<!doctype html><html><body>Wartungsarbeiten</body></html>'
    await assert.rejects(() => plugin.inhalt('logo', mit({ ...ALLE, [FEED.logo]: html }).k), /keinen RSS-Feed/)
  })
})

describe('aufloesen', () => {
  it('ohne # die erste Folge der Liste, mit #n die n-te (ab 0)', async () => {
    const { k } = mit()
    const erste = await plugin.aufloesen('kakadu', k)
    assert.match(erste.titel.name, /Fledermäuse/)
    assert.equal(erste.titel.kuenstler, 'Kakadu')
    assert.equal(erste.quelle.art, 'strom')
    const dritte = await plugin.aufloesen('kakadu#2', k)
    assert.match(dritte.titel.name, /Müll/)
    assert.equal(dritte.titel.dauerSek, 10 * 60 + 56)
    const logo = await plugin.aufloesen('heute#1', k)
    assert.equal(logo.titel.name, 'logo! – Montag, 28. September')
    assert.equal(logo.titel.kuenstler, 'logo!')
    assert.match(logo.quelle.adresse, /260928_1950_sendung_log/)
  })

  it('#n folgt derselben Liste wie inhalt() — auch mit #aelteste', async () => {
    const { k } = mit()
    const liste = await plugin.inhalt('geolino#aelteste', k)
    const zweite = await plugin.aufloesen('geolino#aelteste#1', k)
    assert.equal(zweite.quelle.adresse, liste.folgen[1].quelle.adresse)
  })

  it('eine ALTE Nachricht wird nicht aufgeloest — mit einem Satz fuer Eltern', async () => {
    uhrStellen(() => berlin('2026-10-20T12:00:00'))
    await assert.rejects(() => plugin.aufloesen('logo', mit().k), {
      message: 'Keine aktuelle Folge von logo! — die neueste ist vom 28.09.2026, aelter als 3 Tage.',
    })
    await assert.rejects(
      () => plugin.aufloesen('heute', mit().k),
      /Keine aktuelle Nachricht — MausNachrichten zuletzt am 28\.09\.2026, logo! zuletzt am 28\.09\.2026; aelter als 3 Tage zaehlt nicht\./,
    )
  })

  it('eine Nummer hinter dem Ende sagt, wie viele es gibt', async () => {
    await assert.rejects(
      () => plugin.aufloesen('maus#5', mit().k),
      /Folge 5 gibt es nicht — MausNachrichten hat gerade 2 aktuelle Folgen/,
    )
  })

  it('NUR DIE FESTEN FEEDS: eine Adresse als Schluessel wird nie gefragt', async () => {
    const { k, geholt } = mit()
    await assert.rejects(() => plugin.aufloesen('https://boese.example/feed.xml', k), /Unbekannte Quelle/)
    await assert.rejects(() => plugin.inhalt('quatsch', k), /bekannt sind: heute, maus, logo, kakadu, geolino/)
    assert.deepEqual(geholt, [])
  })
})

describe('die Verwaltungsflaeche', () => {
  it('angebot: heute zuerst, dann die vier — jeder mit dem FERTIGEN data.json-Eintrag', async () => {
    const a = await plugin.http(holeGet('angebot'), mit().k)
    assert.equal(a.inhalt.suche, false)
    assert.equal(a.inhalt.gesamt, 5)
    assert.deepEqual(
      a.inhalt.werke.map((w) => w.kennung),
      ['heute', 'maus', 'logo', 'kakadu', 'geolino'].map((s) => `mixpi-kindernachrichten:${s}`),
    )
    // type 'plugin' und die VOLLE Medienkennung in id: nur so erkennt
    // dienstVon() den generischen Weg (E87). Das Kanalbild von logo! kam
    // ueber http und steht hier als https.
    assert.deepEqual(a.inhalt.werke[2].vorschlag, {
      type: 'plugin',
      category: 'other',
      id: 'mixpi-kindernachrichten:logo',
      title: 'logo!',
      artist: 'ZDF',
      cover: 'https://module.zdf.de/podcasts/logo_podcast_1400.jpg',
    })
    const heute = a.inhalt.werke[0]
    assert.equal(heute.vorschlag.title, 'Nachrichten von heute')
    assert.match(heute.vorschlag.cover, /maus-nachrichten/, 'heute traegt das Bild der Maus')
    for (const w of a.inhalt.werke) {
      assert.equal(w.vorschlag.type, 'plugin')
      assert.equal(w.vorschlag.id, w.kennung)
      assert.ok(w.titel && w.hinweis && w.bild, `${w.kennung}: titel, hinweis, bild`)
    }
  })

  it('die Kennung im Vorschlag zerlegt sich am ERSTEN Doppelpunkt in Plugin und Rest', async () => {
    const a = await plugin.http(holeGet('angebot'), mit().k)
    const id = a.inhalt.werke[0].vorschlag.id
    const i = id.indexOf(':')
    assert.equal(id.slice(0, i), 'mixpi-kindernachrichten')
    assert.equal(id.slice(i + 1), 'heute')
  })

  it('angebot?q= filtert — und GEOlino sagt, dass es Werbung enthaelt', async () => {
    const a = await plugin.http(holeGet('angebot', { q: 'werbung' }), mit().k)
    assert.deepEqual(
      a.inhalt.werke.map((w) => w.titel),
      ['GEOlino Spezial'],
    )
    assert.match(a.inhalt.werke[0].hinweis, /WERBUNG/)
  })

  it('angebot ohne Netz: die gemessenen Bilder aus der Tabelle, kein leeres Angebot', async () => {
    const { k } = kontext({ netz: false })
    const a = await plugin.http(holeGet('angebot'), k)
    assert.equal(a.inhalt.gesamt, 5)
    assert.ok(a.inhalt.werke.every((w) => w.vorschlag.cover?.startsWith('https://')))
  })

  it('suche liefert DASSELBE Angebot UNGEFILTERT — das Plugin hat keine Suche', async () => {
    // tools/plugin-kette-probe.mts fragt mit „hörspiel"; eine gefilterte
    // Antwort waere leer, und die Kette hiesse gerissen, obwohl sie traegt.
    const s = await plugin.http(holeGet('suche', { q: 'hörspiel' }), mit().k)
    assert.equal(s.inhalt.gesamt, 5)
    assert.equal(s.inhalt.werke[0].vorschlag.id, 'mixpi-kindernachrichten:heute')
  })

  it('quelle/<schluessel> zeigt die Liste mit Datum und dem Stand des Feeds', async () => {
    const q = await plugin.http(holeGet('quelle/maus'), mit().k)
    assert.equal(q.status ?? 200, 200)
    assert.equal(q.inhalt.frischeTage, 3)
    assert.equal(q.inhalt.stand[0].imFeed, 4)
    assert.equal(q.inhalt.stand[0].frisch, 2)
    assert.equal(q.inhalt.folgen.length, 2)
    assert.equal(q.inhalt.folgen[1].datum, '2026-09-25T07:00:29.000Z')
    assert.equal(q.inhalt.leer, null)
  })

  it('quelle/ einer leeren Kachel sagt, WARUM sie leer ist', async () => {
    uhrStellen(() => berlin('2026-10-20T12:00:00'))
    const q = await plugin.http(holeGet('quelle/logo'), mit().k)
    assert.deepEqual(q.inhalt.folgen, [])
    assert.match(q.inhalt.leer, /die neueste ist vom 28\.09\.2026/)
  })

  it('nur GET; eine unbekannte Quelle und ein unbekannter Pfad sind 404', async () => {
    const { k, geholt } = mit()
    assert.equal((await plugin.http({ methode: 'POST', pfad: 'angebot', abfrage: {}, rumpf: {} }, k)).status, 405)
    assert.equal((await plugin.http(holeGet('quelle/https:%2F%2Fboese.example'), k)).status, 404)
    assert.equal((await plugin.http(holeGet('quatsch'), k)).status, 404)
    assert.deepEqual(geholt, [])
  })

  it('ein Feed, der nicht antwortet, kommt als 502 MIT GRUND zurueck — nicht als Wurf', async () => {
    // Der Wirt nimmt ein 502 mit `fehler` an (httpAntwortPruefen in
    // plugin-vertrag.ts). Ein Wurf kaeme auch als 502 an, schriebe aber bei
    // jedem kurz stummen Feed einen Stapel ins Journal.
    const kaputt = { ...ALLE, [FEED.logo]: antwort('', { ok: false, status: 503 }) }
    assert.deepEqual(await plugin.http(holeGet('quelle/logo'), mit(kaputt).k), {
      status: 502,
      inhalt: { fehler: 'logo! antwortete mit HTTP 503' },
    })
    const { k } = kontext({ netz: false })
    const ohneNetz = await plugin.http(holeGet('quelle/maus'), k)
    assert.equal(ohneNetz.status, 502)
    assert.match(ohneNetz.inhalt.fehler, /Recht `netz`/)
  })
})

describe('suchen, befinden, aktion', () => {
  it('suchen: passende Quellen, ohne Netz', async () => {
    const { k, geholt } = mit()
    assert.deepEqual(await plugin.suchen('maus', k), [
      { name: 'Nachrichten von heute', kuenstler: 'WDR und ZDF' },
      { name: 'MausNachrichten', kuenstler: 'WDR' },
    ])
    assert.deepEqual(await plugin.suchen('Kinderfragen', k), [{ name: 'Kakadu', kuenstler: 'Deutschlandfunk Kultur' }])
    assert.deepEqual(await plugin.suchen('hörspiel', k), [])
    assert.deepEqual(await plugin.suchen('   ', k), [])
    assert.deepEqual(geholt, [])
  })

  it('befinden: ein Satz — erreichbar, und die neueste Nachricht', async () => {
    const b = await plugin.befinden(mit().k)
    assert.deepEqual(b, { ok: true, text: '4 von 4 Quellen erreichbar; neueste Nachricht: logo! vom 28.09.' })
  })

  it('befinden fragt die Feeds, nicht den Speicher', async () => {
    const { k, geholt } = mit()
    await plugin.inhalt('maus', k)
    await plugin.befinden(k)
    assert.equal(geholt.filter((a) => a === FEED.maus).length, 2)
  })

  it('befinden: eine Quelle weg ist nicht ok — und sie steht mit Grund im Satz', async () => {
    const b = await plugin.befinden(mit({ ...ALLE, [FEED.geolino]: antwort('', { ok: false, status: 503 }) }).k)
    assert.equal(b.ok, false)
    assert.match(b.text, /^3 von 4 Quellen erreichbar/)
    assert.match(b.text, / — nicht erreichbar: GEOlino Spezial antwortete mit HTTP 503$/)
  })

  it('befinden sagt es, wenn die neueste Nachricht zu alt ist', async () => {
    uhrStellen(() => berlin('2026-10-20T12:00:00'))
    const b = await plugin.befinden(mit().k)
    assert.match(b.text, /logo! vom 28\.09\. — aelter als 3 Tage, „Nachrichten von heute" bleibt leer/)
  })

  it('aktion pruefen: Antwortzeit je Quelle; eine fremde Aktion wird abgewiesen', async () => {
    const a = await plugin.aktion('pruefen', mit().k)
    assert.equal(a.ok, true)
    for (const name of ['MausNachrichten', 'logo!', 'Kakadu', 'GEOlino Spezial']) {
      assert.match(a.text, new RegExp(`${name.replace('!', '\\!')} \\d+ ms`))
    }
    assert.equal((await plugin.aktion('loeschen', mit().k)).ok, false)
  })

  it('ohne das Recht netz: ein Satz, kein Absturz', async () => {
    const { k } = kontext({ netz: false })
    assert.equal((await plugin.befinden(k)).ok, false)
    assert.equal((await plugin.aktion('pruefen', k)).ok, false)
    await assert.rejects(() => plugin.inhalt('maus', k), /Recht `netz`/)
  })
})

describe('Speicher und Frist', () => {
  it('15 Minuten gemerkt: der zweite Ruf fragt nicht nochmal, der nach 16 Minuten schon', async () => {
    const { k, geholt } = mit()
    await plugin.inhalt('kakadu', k)
    await plugin.inhalt('kakadu#aelteste', k)
    assert.equal(geholt.length, 1)
    uhrStellen(() => MONTAG_ABEND + 16 * 60_000)
    await plugin.inhalt('kakadu', k)
    assert.equal(geholt.length, 2)
  })

  it('zwei gleichzeitige Rufe teilen sich EINEN Abruf', async () => {
    const { k, geholt } = mit()
    await Promise.all([plugin.inhalt('maus', k), plugin.inhalt('heute', k)])
    assert.equal(geholt.filter((a) => a === FEED.maus).length, 1)
  })

  it('ein haengender Feed wird nach 6 s aufgegeben — mit Satz, VOR der Frist des Wirts (8 s)', async () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const { k } = kontext({ antworten: () => new Promise(() => {}) })
      const versuch = plugin.inhalt('logo', k)
      mock.timers.tick(6000)
      await assert.rejects(versuch, /logo! antwortet nicht innerhalb von 6 s/)
    } finally {
      mock.timers.reset()
    }
  })
})
