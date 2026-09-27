/**
 * `GET /api/werke/:schluessel/inhalt` — was hinter einer Kachel liegt.
 *
 * WAS HIER GEPRUEFT WIRD und was nicht: Die drei Wege, die OHNE fremden Dienst
 * auskommen. Spotify und Jellyfin wirklich abzufragen hiesse, den Test an ein
 * Netz und an fremde Zugaenge zu haengen — dann liefe er auf keinem anderen
 * Rechner und waere beim ersten roten Balken abgeschaltet. Die Aufloesung
 * selbst (`titelEinesWerks`) ist ohnehin nicht neu; sie war vorher schon an
 * zwei schreibenden Endpunkten in Betrieb.
 *
 * DIE UNTERSCHEIDUNG DER FEHLERZAHLEN IST DER EIGENTLICHE INHALT:
 *
 *   404  den Schluessel gibt es nicht          -> die Oberflaeche hat Unsinn geschickt
 *   501  Dienst noch nicht gebaut (lokal)      -> ehrlich, statt einer leeren Liste
 *   400  die Anfrage taugt nicht (keineKennung)-> erneut versuchen ist zwecklos
 *   502  der Dienst hat versagt                -> erneut versuchen darf sich lohnen
 *
 * Faellt das zusammen, sieht die Oberflaeche bei jedem Fehler gleich aus und
 * probiert es entweder immer oder nie noch einmal.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { medienSchluessel } from './medien.js'

const LOKAL = { id: 'inhalt-lokal', title: 'Ein lokales Album', artist: 'Pruefung', type: 'library' }
/* ══ DER ORDNER-ZWEIG, MIT ECHTEN DATEIEN ════════════════════════════════════
 *
 * EIN ZWEITES lokales Album und nicht LOKAL erweitert: Fuer LOKAL gibt es
 * bewusst KEINEN Ordner — der Test darueber prueft ja gerade, dass ein
 * fehlender Abspieldienst als 502 durchkommt. Legte man ihm Dateien hin,
 * antwortete der Ordner-Zweig mit 200 und die Fehlerzahl-Unterscheidung, um
 * die es dieser Datei geht, waere still ausgehebelt.
 */
const MIT_ORDNER = {
  id: 'inhalt-ordner',
  title: 'Album mit Dateien',
  artist: 'Pruefung',
  category: 'music',
  type: 'library',
}
// Spotify OHNE Kennung: der Dienst passt, aber es gibt nichts abzufragen.
const OHNE_KENNUNG = { title: 'Spotify ohne Kennung', artist: 'Pruefung', type: 'spotify' }
const RADIO = { id: 'https://stream.invalid/1', title: 'Ein Sender', artist: '', type: 'radio' }

let app: import('express').Express
let medien: string
let albumOrdner: string

describe('Inhalt eines Werks', () => {
  before(async () => {
    const d = mkdtempSync(join(tmpdir(), 'mupi-inhalt-'))
    const liste = [LOKAL, OHNE_KENNUNG, RADIO, MIT_ORDNER]
    writeFileSync(join(d, 'active_data.json'), JSON.stringify(liste, null, 2))
    writeFileSync(join(d, 'data.json'), JSON.stringify(liste, null, 2))
    process.env.MUPIBOX_CONFIG_DIR = d
    // VOR dem Import: `MEDIEN_ORDNER` ist eine Konstante, die beim Laden des
    // Moduls aus der Umgebung gelesen wird. Danach gesetzt kaeme sie zu spaet.
    medien = mkdtempSync(join(tmpdir(), 'mupi-medien-'))
    albumOrdner = join(medien, MIT_ORDNER.category, MIT_ORDNER.artist, MIT_ORDNER.title)
    mkdirSync(albumOrdner, { recursive: true })
    for (const datei of ['01 Erster Titel.mp3', '02 Zweiter Titel.mp3', '03 Dritter Titel.mp3']) {
      writeFileSync(join(albumOrdner, datei), 'x')
    }
    process.env.MUPIBOX_MEDIA_DIR = medien
    app = (await import('./server.js')).app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_MEDIA_DIR = undefined
  })

  it('schickt 404 fuer einen Schluessel, den es nicht gibt', async () => {
    const r = await request(app).get(`/api/werke/${encodeURIComponent('spotify:gibtesnicht')}/inhalt`).expect(404)
    assert.equal(r.body.error, 'nichtGefunden')
  })

  it('meldet beim LOKALEN Album, dass der Abspieldienst nicht da ist', async () => {
    // Im Test laeuft kein Abspieldienst auf 5005 - genau das soll als 502
    // durchkommen und NICHT als leere Liste. Eine leere Liste saehe aus wie
    // „dieses Album hat keine Titel" und schickte den Suchenden zum Dienst
    // statt in den Code.
    const s = medienSchluessel(LOKAL)
    const r = await request(app).get(`/api/werke/${encodeURIComponent(s)}/inhalt`).expect(502)
    assert.ok(['nichtErreichbar', 'zeitUeberschritten', 'keineTitelliste'].includes(r.body.error), r.body.error)
  })

  it('behandelt Radio genauso — es hat gar keine Titelliste', async () => {
    const s = medienSchluessel(RADIO)
    const r = await request(app).get(`/api/werke/${encodeURIComponent(s)}/inhalt`).expect(501)
    assert.equal(r.body.dienst, 'radio')
  })

  it('schickt 400, wenn dem Spotify-Eintrag die Kennung fehlt', async () => {
    // 400 und nicht 502: Hier hat kein Dienst versagt, es gibt schlicht nichts
    // zu fragen. Ein erneuter Versuch waere zwecklos.
    const s = medienSchluessel(OHNE_KENNUNG)
    const r = await request(app).get(`/api/werke/${encodeURIComponent(s)}/inhalt`).expect(400)
    assert.equal(r.body.error, 'keineKennung')
  })

  it('verwechselt den Inhaltsweg nicht mit dem Bildweg', async () => {
    // Beide haengen am selben Schluessel; ein vertippter Pfad darf nicht
    // stillschweigend das Falsche liefern.
    const s = medienSchluessel(RADIO)
    await request(app).get(`/api/bild/${encodeURIComponent(s)}`).expect(404)
    await request(app).get(`/api/werke/${encodeURIComponent(s)}/inhalt`).expect(501)
  })

  /* ══ JEDER LOKALE TITEL BRAUCHT EINE KENNUNG ═══════════════════════════════
   *
   * Betreiber, 11./12.09.2026: „von lokal spielen da geht es noch nicht",
   * danach „klappt noch nicht". Der laufende Titel bekam in der Liste keinen
   * Indikator, weil die Titel dieses Zweigs WEDER `id` NOCH `uri` trugen —
   * `folgeKennung` und `stueckKennung` (app.js) geben dann beide '' zurueck,
   * die Kachel traegt kein `data-spielt`, und `spieltMarkieren()` sieht sie
   * nicht einmal an.
   *
   * GEGEN DIE ROUTE UND NICHT GEGEN DIE FUNKTION, und das ist der ganze Punkt
   * dieser Wache: Zwei Anlaeufe setzten die Kennung an Stellen, die diese
   * Antwort gar nicht bauen (`titelQuellenStempeln` und der /tracklist-Zweig).
   * Beide Male waren Typen sauber und Zeugen gruen — und am Geraet aenderte
   * sich nichts. Ein Test auf der Funktion haette genau diesen Irrtum
   * mitgemacht; nur die Route weiss, wer wirklich antwortet.
   */
  it('gibt jedem Titel des Ordner-Zweigs eine eigene Kennung', async () => {
    const s = medienSchluessel(MIT_ORDNER)
    // `verschmelzen=0`: geprueft wird DIESER Zweig, nicht die Wahl zwischen
    // mehreren Quellen — das Album hat ohnehin nur eine.
    const r = await request(app).get(`/api/werke/${encodeURIComponent(s)}/inhalt?verschmelzen=0`).expect(200)
    const titel = r.body.titel as { id?: unknown; nr?: number; titel?: string }[]
    assert.equal(titel.length, 3, `drei Dateien, drei Titel: ${JSON.stringify(r.body)}`)

    for (const t of titel) {
      assert.equal(typeof t.id, 'string', `Titel ${t.nr} ohne Kennung: ${JSON.stringify(t)}`)
      assert.ok(String(t.id).length > 0, `Titel ${t.nr} mit leerer Kennung`)
    }

    // UND SONST NICHTS: Drei gleiche Kennungen waeren formal „vorhanden" und
    // truegen den Indikator trotzdem auf alle drei Kacheln gleichzeitig.
    const kennungen = new Set(titel.map((t) => String(t.id)))
    assert.equal(kennungen.size, 3, `Kennungen nicht eindeutig: ${[...kennungen].join(' | ')}`)

    // Die Form haelt beide Wege zusammen — der Rueckfall-Zweig (/tracklist)
    // baut dieselbe. Ein Werk, das heute ueber den Ordner und morgen ueber die
    // m3u kommt, behaelt damit die Kennungen seiner Kacheln.
    assert.equal(String(titel[0].id), `${albumOrdner}#1`, 'Kennung ist nicht Pfad#Nummer')
  })
})
