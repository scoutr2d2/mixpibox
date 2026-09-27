/**
 * ZEUGEN FUER mixpi-mediathekview — ohne Netz, ohne Box.
 *
 * DIE VORLAGE IST ECHT: `mvw.fixture.json` ist die gekuerzte Antwort von
 * mediathekviewweb.de vom 20.09.2026. Kein erfundenes JSON — die vier
 * Eigenheiten, an denen dieses Plugin haengt, haette sich niemand ausgedacht:
 *
 *   1  DIESELBE FOLGE LIEGT UNTER ZWEI SENDERN (KiKA und WDR, gleiche
 *      Datei-UUID, verschiedene Stufen). Deshalb traegt die Kennung den
 *      Sender mit.
 *   2  NEBENFASSUNGEN STEHEN MITTEN DRIN — vier von acht Treffern der Suche
 *      „Sendung mit der Maus" sind Audiodeskription oder Gebaerdensprache.
 *   3  SRF LIEFERT NUR HLS. Ein `<video>` in Chromium spielt das nicht.
 *   4  ZDF NENNT KEINE AUFLOESUNG im Dateinamen, die ARD-Anstalten schon.
 *
 *     node --test plugins/mixpi-mediathekview/index.spec.mjs
 */

import { ok, strictEqual } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import plugin, {
  anfrageBauen,
  besteAdresse,
  eintragFinden,
  hoeheAus,
  istMp4,
  kennungAus,
  kennungLesen,
  nebenfassung,
  stufeAus,
  trefferAus,
  trefferListe,
  videoAus,
  zahlAus,
} from './index.mjs'

const VORLAGE = JSON.parse(readFileSync(new URL('./mvw.fixture.json', import.meta.url), 'utf8'))
const SUCHE = VORLAGE.suche
const SRF = VORLAGE.srf
const ZDF = VORLAGE.zdf

/** Den einen Eintrag der Vorlage holen, der so aussieht. */
function ausSuche(pruefen) {
  const t = SUCHE.result.results.find(pruefen)
  ok(t, 'Vorlage passt nicht mehr zu diesem Zeugen')
  return t
}

/* ══ DIE KENNUNG ══════════════════════════════════════════════════════════ */

test('kennungAus und kennungLesen sind Hin- und Rueckweg', () => {
  const k = kennungAus('WDR', 'Die Sendung mit der Maus', 'Die Sendung vom 20.09.2026')
  const teile = kennungLesen(k)
  strictEqual(teile.sender, 'WDR')
  strictEqual(teile.sendung, 'Die Sendung mit der Maus')
  strictEqual(teile.titel, 'Die Sendung vom 20.09.2026')
})

test('die Kennung uebersteht Umlaute und Doppelpunkte', () => {
  const teile = kennungLesen(kennungAus('ZDF', 'Inga Lindström', 'Rezept für die Liebe: Darum geht’s'))
  strictEqual(teile.titel, 'Rezept für die Liebe: Darum geht’s')
})

test('die Kennung passt durch den Filter des Kerns', () => {
  // `freigabeNormalisieren` in videofreigabe.ts laesst nur diese Zeichen zu.
  const k = kennungAus('ARTE.DE', '360° Reportage', 'Albanien: Die Stimmen der Berge')
  ok(/^[A-Za-z0-9+/=_-]+$/.test(k), `Kennung enthaelt Verbotenes: ${k}`)
})

test('was keine Kennung ist, wird auch nicht zu einer', () => {
  strictEqual(kennungLesen(''), null)
  strictEqual(kennungLesen('nicht base64!'), null)
  // Richtig kodiert, aber nur zwei Teile statt drei.
  strictEqual(kennungLesen(Buffer.from('WDR' + String.fromCharCode(31) + 'Maus').toString('base64url')), null)
  // Drei Teile, aber der Titel fehlt — ohne ihn gibt es keinen Weg zurueck.
  strictEqual(kennungLesen(kennungAus('WDR', 'Maus', '')), null)
})

/* ══ WAS AUSSORTIERT WIRD ═════════════════════════════════════════════════ */

test('Nebenfassungen erkennt man am Titel', () => {
  ok(nebenfassung('Die Sendung vom 20.09.2026 (Audiodeskription)'))
  ok(nebenfassung('Die Sendung vom 20.09.2026 (Gebärdensprache)'))
  ok(!nebenfassung('Die Sendung vom 20.09.2026'))
})

test('die Vorlage enthaelt wirklich vier Nebenfassungen', () => {
  const n = SUCHE.result.results.filter((t) => nebenfassung(t.title)).length
  strictEqual(n, 4, 'Vorlage erneuern und diesen Zeugen nachziehen')
})

test('SRF faellt weg, weil es nur HLS liefert', () => {
  for (const roh of SRF.result.results) {
    ok(!istMp4(roh.url_video), `SRF liefert auf einmal MP4: ${roh.url_video}`)
    strictEqual(trefferAus(roh), null)
  }
})

test('trefferListe laesst genau die brauchbaren uebrig', () => {
  const liste = trefferListe(SUCHE)
  strictEqual(liste.length, 4)
  ok(!liste.some((t) => nebenfassung(t.name)))
  // Dieselbe Folge unter zwei Sendern bleibt zweimal stehen — und traegt
  // ZWEI verschiedene Kennungen, sonst zeigte eine auf die falsche Stufe.
  const zwanzigster = liste.filter((t) => t.name.includes('20.09.2026'))
  strictEqual(zwanzigster.length, 2)
  strictEqual(new Set(zwanzigster.map((t) => t.kennung)).size, 2)
})

test('anzahl deckelt die Liste', () => {
  strictEqual(trefferListe(SUCHE, 2).length, 2)
})

/* ══ DIE STUFENWAHL ═══════════════════════════════════════════════════════ */

test('hoeheAus liest, was dasteht — und erfindet nichts', () => {
  strictEqual(hoeheAus('https://x/y_AVC-720.mp4'), 720)
  strictEqual(hoeheAus('https://x/y_AVC-360.mp4'), 360)
  strictEqual(hoeheAus('https://x/y_960x540.mp4'), 540)
  strictEqual(hoeheAus('https://x/260920_1900_wet_3360k_p36v17.mp4'), 0)
  strictEqual(hoeheAus(''), 0)
})

test('die gewaehlte Stufe hat auch einen Namen', () => {
  // SIE WAR EINMAL `undefined`, und den Zeugen fiel es nicht auf, weil sie
  // den Namen nur in den beiden anderen Zweigen lasen. Der Name steht in der
  // Antwort an den Kern und ist das, was eine Messung am Geraet benennt.
  const wdr = ausSuche((t) => t.channel === 'WDR' && t.title === 'Die Sendung mit der Maus vom 20.09.2026')
  strictEqual(besteAdresse(wdr, 720).stufe, 'mittel')
  strictEqual(besteAdresse(wdr, 540).stufe, 'klein')
  strictEqual(besteAdresse(wdr, 1080).stufe, 'gross')
  strictEqual(besteAdresse(wdr, 200).stufe, 'klein')
})

test('die groesste Stufe unter dem Deckel gewinnt', () => {
  const wdr = ausSuche((t) => t.channel === 'WDR' && t.title === 'Die Sendung mit der Maus vom 20.09.2026')
  strictEqual(besteAdresse(wdr, 720).hoehe, 720)
  strictEqual(besteAdresse(wdr, 540).hoehe, 360)
  strictEqual(besteAdresse(wdr, 1080).hoehe, 1080)
})

test('gibt es keine unter dem Deckel, gilt die kleinste ueberhaupt', () => {
  const wdr = ausSuche((t) => t.channel === 'WDR' && t.title === 'Die Sendung mit der Maus vom 20.09.2026')
  // Lieber ein zu grosses Bild als gar keins — dieselbe Regel wie nebenan.
  strictEqual(besteAdresse(wdr, 200).hoehe, 360)
})

test('KiKA hat eine 540er-Stufe, die WDR nicht hat', () => {
  const kika = ausSuche((t) => t.channel === 'KiKA' && t.title.includes('20.09.2026'))
  strictEqual(besteAdresse(kika, 720).hoehe, 540)
})

test('nennt der Dateiname keine Hoehe, gilt die mittlere Stufe', () => {
  const zdf = ZDF.result.results[0]
  const gewaehlt = besteAdresse(zdf, 720)
  strictEqual(gewaehlt.stufe, 'mittel')
  strictEqual(gewaehlt.hoehe, 0)
  strictEqual(gewaehlt.adresse, zdf.url_video)
})

test('stufe schlaegt den Deckel — damit man am Geraet messen kann', () => {
  const wdr = ausSuche((t) => t.channel === 'WDR' && t.title === 'Die Sendung mit der Maus vom 20.09.2026')
  strictEqual(besteAdresse(wdr, 540, 'gross').hoehe, 1080)
  strictEqual(besteAdresse(wdr, 1080, 'klein').hoehe, 360)
  strictEqual(stufeAus('GROSS'), 'gross')
  strictEqual(stufeAus('riesig'), '')
})

/* ══ DER WEG ZURUECK ══════════════════════════════════════════════════════ */

test('eintragFinden trifft den Sender, nicht nur den Titel', () => {
  // Beide Sender fuehren die Folge, aber unter verschiedenen Titeln; der
  // strenge Vergleich auf allen drei Teilen ist genau deshalb noetig.
  const kika = ausSuche((t) => t.channel === 'KiKA' && t.title.includes('20.09.2026'))
  const teile = kennungLesen(kennungAus(kika.channel, kika.topic, kika.title))
  const gefunden = eintragFinden(SUCHE, teile)
  strictEqual(gefunden.channel, 'KiKA')
  strictEqual(gefunden.url_video, kika.url_video)
})

test('ein anderer Sender findet nichts', () => {
  const kika = ausSuche((t) => t.channel === 'KiKA' && t.title.includes('20.09.2026'))
  strictEqual(eintragFinden(SUCHE, { sender: 'BR', sendung: kika.topic, titel: kika.title }), null)
})

test('bei zwei gleichen Eintraegen gewinnt der neueste', () => {
  const einer = ausSuche((t) => t.channel === 'WDR' && t.title === 'Die Sendung mit der Maus vom 20.09.2026')
  const alt = { ...einer, timestamp: 1, url_video: 'https://alt/x_AVC-720.mp4' }
  const rumpf = { result: { results: [alt, einer] } }
  const teile = kennungLesen(kennungAus(einer.channel, einer.topic, einer.title))
  strictEqual(eintragFinden(rumpf, teile).url_video, einer.url_video)
})

test('videoAus meldet den Grund, statt zu werfen', () => {
  const aus = videoAus(null, { sender: 'WDR', sendung: 'Maus', titel: 'Folge' })
  strictEqual(aus.ok, false)
  strictEqual(aus.grund, 'nicht mehr in der Mediathek')
})

test('videoAus liefert dem Kern Adresse, Name und Dauer', () => {
  const wdr = ausSuche((t) => t.channel === 'WDR' && t.title === 'Die Sendung mit der Maus vom 20.09.2026')
  const teile = kennungLesen(kennungAus(wdr.channel, wdr.topic, wdr.title))
  const video = videoAus(wdr, teile, 720)
  strictEqual(video.ok, true)
  strictEqual(video.name, wdr.title)
  strictEqual(video.sender, 'WDR')
  strictEqual(video.dauerSek, Math.floor(wdr.duration))
  ok(video.quelle.adresse.endsWith('_AVC-720.mp4'))
  // Die Kennung der Antwort muss die sein, unter der der Kern Buch fuehrt.
  strictEqual(video.kennung, kennungAus(wdr.channel, wdr.topic, wdr.title))
})

/* ══ DIE ANFRAGE UND DIE FLAECHE ══════════════════════════════════════════ */

test('die Anfrage laesst Ankuendigungen weg', () => {
  const a = anfrageBauen(['title'], 'Maus', 7)
  strictEqual(a.future, false)
  strictEqual(a.size, 7)
  strictEqual(a.queries[0].fields[0], 'title')
})

test('zahlAus haelt sich an die Grenzen', () => {
  strictEqual(zahlAus('5', 12, 1, 24), 5)
  strictEqual(zahlAus('999', 12, 1, 24), 24)
  strictEqual(zahlAus('nichts', 12, 1, 24), 12)
})

test('nur GET, und nur die beiden Wege', async () => {
  const kontext = { holen: async () => ({ ok: true, json: async () => SUCHE }) }
  strictEqual((await plugin.http({ methode: 'POST', pfad: 'suche' }, kontext)).status, 405)
  strictEqual((await plugin.http({ methode: 'GET', pfad: 'quatsch' }, kontext)).status, 404)
  strictEqual((await plugin.http({ methode: 'GET', pfad: 'suche', abfrage: { begriff: 'a' } }, kontext)).status, 400)
  strictEqual((await plugin.http({ methode: 'GET', pfad: 'video/nicht-base64!' }, kontext)).status, 400)
})

test('die Suche reicht die Treffer durch', async () => {
  const kontext = { holen: async () => ({ ok: true, json: async () => SUCHE }) }
  const a = await plugin.http({ methode: 'GET', pfad: 'suche', abfrage: { begriff: 'Maus' } }, kontext)
  strictEqual(a.status ?? 200, 200)
  strictEqual(a.inhalt.treffer.length, 4)
})

test('ein fehlender Eintrag wird 404, ein kaputter Dienst 502', async () => {
  const leer = { holen: async () => ({ ok: true, json: async () => ({ result: { results: [] } }) }) }
  const k = kennungAus('WDR', 'Maus', 'Folge')
  const a = await plugin.http({ methode: 'GET', pfad: `video/${k}` }, leer)
  strictEqual(a.status, 404)
  const kaputt = { holen: async () => ({ ok: false, status: 503 }) }
  const b = await plugin.http({ methode: 'GET', pfad: `video/${k}` }, kaputt)
  strictEqual(b.status, 502)
})

test('ohne das Recht netz sagt das Plugin, was fehlt', async () => {
  const a = await plugin.befinden({})
  strictEqual(a.ok, false)
  const b = await plugin.aktion('pruefen', {})
  strictEqual(b.ok, false)
  const c = await plugin.aktion('unbekannt', { holen: async () => ({}) })
  strictEqual(c.ok, false)
})
