import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { antwort, kontext as pruefstand } from '../pruefstand.mjs'
import plugin from './index.mjs'

/**
 * SO PRUEFT MAN EIN MUPIBOX-PLUGIN — OHNE BOX, OHNE WORKER, OHNE NETZ.
 *
 * Das ist die Vorlage fuer eigene Plugins. Der Kontext wird gefaelscht, das
 * `holen` gibt aufgezeichnetes XML zurueck. Damit laeuft der Test in einer
 * Sekunde und auch im Zug ohne Empfang.
 *
 *   node --test plugins/mupibox-podcast/
 *
 * WARUM HIER KEIN ECHTER SERVER STEHT: `kontext.holen` verwehrt Zugriffe auf
 * die eigene Box (127.0.0.1 und die eigenen LAN-Adressen) — ein Testserver auf
 * der Schleife waere also geblockt. Das ist kein Mangel des Pruefstands,
 * sondern der Zaun bei der Arbeit; er ist in
 * src/backend-api/src/plugin-wirt.spec.ts eigens geprueft.
 */

const FEED = `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Die Sendung mit dem &amp; Zeichen</title>
    <item>
      <title><![CDATA[Folge A]]></title>
      <enclosure url="https://example.org/a.mp3" type="audio/mpeg" length="1"/>
      <itunes:duration>30:00</itunes:duration>
      <itunes:image href="https://example.org/a.jpg"/>
    </item>
    <item>
      <title>Folge B</title>
      <enclosure url='https://example.org/b.mp3' type="audio/mpeg"/>
      <itunes:duration>1800</itunes:duration>
    </item>
  </channel>
</rss>`

/**
 * Der Kontext kommt aus dem geteilten Pruefstand — genau dem, den auch das
 * Geruest jedem neuen Plugin mitgibt.
 *
 * DAS WAR FRUEHER EIN HANDGESCHRIEBENES DOPPEL hier in dieser Datei. Es tat
 * dasselbe, kannte aber den Loopback-Riegel nicht: ein Plugin, das versehentlich
 * die eigene Box anruft, waere hier gruen durchgelaufen und erst am Geraet
 * aufgefallen. Wer sein Doppel selbst baut, baut die Riegel nicht mit.
 */
function kontext({ xml = FEED, ok = true, status = 200, netz = true } = {}) {
  return pruefstand({ netz, antworten: () => antwort(xml, { ok, status }) })
}

describe('aufloesen', () => {
  it('nimmt ohne Nummer die NEUESTE Folge — die steht in RSS oben', async () => {
    const { k } = kontext()
    const f = await plugin.aufloesen('https://example.org/feed.xml', k)
    assert.equal(f.titel.name, 'Folge A')
    assert.equal(f.quelle.adresse, 'https://example.org/a.mp3')
    assert.equal(f.quelle.art, 'strom')
  })

  it('holt eine bestimmte Folge ueber "#<nummer>"', async () => {
    const { k, geholt } = kontext()
    const f = await plugin.aufloesen('https://example.org/feed.xml#1', k)
    assert.equal(f.titel.name, 'Folge B')
    // DIE FEED-ADRESSE MUSS UNVERSEHRT BLEIBEN — die Nummer darf nicht
    // mitgeschickt werden, sonst antwortet mancher Anbieter mit 404.
    assert.deepEqual(geholt, ['https://example.org/feed.xml'])
  })

  it('loest CDATA und XML-Entitaeten auf', async () => {
    const { k } = kontext()
    const f = await plugin.aufloesen('https://example.org/feed.xml', k)
    assert.equal(f.titel.kuenstler, 'Die Sendung mit dem & Zeichen')
  })

  it('versteht beide Dauerformen', async () => {
    const { k } = kontext()
    assert.equal((await plugin.aufloesen('https://example.org/feed.xml', k)).titel.dauerSek, 1800)
    assert.equal((await plugin.aufloesen('https://example.org/feed.xml#1', k)).titel.dauerSek, 1800)
  })

  it('nimmt das Folgenbild mit, wenn eins dasteht', async () => {
    const { k } = kontext()
    assert.equal((await plugin.aufloesen('https://example.org/feed.xml', k)).titel.bild, 'https://example.org/a.jpg')
    assert.equal((await plugin.aufloesen('https://example.org/feed.xml#1', k)).titel.bild, undefined)
  })
})

describe('was schiefgehen kann — die Meldung muss beim Richtigen ankommen', () => {
  it('sagt es, wenn das Netz-Recht fehlt', async () => {
    const { k } = kontext({ netz: false })
    await assert.rejects(() => plugin.aufloesen('https://example.org/feed.xml', k), /Recht "netz"/)
  })

  it('nennt den Statuscode, statt an leerem XML zu scheitern', async () => {
    const { k } = kontext({ ok: false, status: 404 })
    await assert.rejects(() => plugin.aufloesen('https://example.org/feed.xml', k), /404/)
  })

  it('meldet einen leeren Feed als leer', async () => {
    const { k } = kontext({ xml: '<rss><channel><title>Leer</title></channel></rss>' })
    await assert.rejects(() => plugin.aufloesen('https://example.org/feed.xml', k), /keine Folgen/)
  })

  it('meldet eine Folgennummer, die es nicht gibt — mit der Anzahl', async () => {
    const { k } = kontext()
    await assert.rejects(() => plugin.aufloesen('https://example.org/feed.xml#9', k), /der Feed hat 2/)
  })

  it('schiebt einen Feed ohne Tondatei dem ANBIETER zu, nicht dem Benutzer', async () => {
    const { k } = kontext({
      xml: '<rss><channel><title>X</title><item><title>Ohne Ton</title></item></channel></rss>',
    })
    await assert.rejects(() => plugin.aufloesen('https://example.org/feed.xml', k), /keine Tondatei im Feed/)
  })

  it('laesst keine nicht-http-Tondatei durch', async () => {
    // Der Kern prueft das noch einmal (fundPruefen), aber ein Plugin, das
    // seinen eigenen Unsinn erkennt, gibt die bessere Meldung.
    const { k } = kontext({
      xml: '<rss><channel><title>X</title><item><title>T</title><enclosure url="file:///etc/shadow"/></item></channel></rss>',
    })
    await assert.rejects(() => plugin.aufloesen('https://example.org/feed.xml', k), /keine http-Adresse/)
  })
})

describe('befinden', () => {
  it('meldet bereit, wenn das Netz-Recht da ist', async () => {
    assert.deepEqual(await plugin.befinden(kontext().k), { ok: true, text: 'bereit' })
  })

  it('meldet den fehlenden Grund, statt einfach false zu sagen', async () => {
    const b = await plugin.befinden(kontext({ netz: false }).k)
    assert.equal(b.ok, false)
    assert.match(b.text, /netz/)
  })
})
