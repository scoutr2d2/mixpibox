/**
 * DER RUECKFALL DARF DEN TITELWUNSCH NICHT UMDEUTEN (E117).
 *
 * DER MESSFALL, am Geraet aufgenommen (04.09.2026, Box 192.168.178.62):
 * „101 Meerjungfrauen …", `spotify:14Xy9Ycf6KfXH6nG2r9Zdb`. Kapitel 1 liegt
 * LOKAL, die Kapitel 1..11 liegen bei Spotify — die Anzeige zeigt elf, der
 * lokale Mitschnitt ist EINE Datei. Der Tipp auf Kapitel 3 bestellte korrekt
 * `{"titelNr":3}`, E110 waehlte korrekt Spotify und schrieb das auch ins
 * Protokoll — und die Antwort lautete trotzdem:
 *
 *     {"ergebnis":"ok","dienst":"lokal","gestartetNr":1, titel:[Kapitel 1]}
 *
 * Dazwischen lagen zwei Stellen, die beide schwiegen: der Spotify-Start
 * scheiterte (auf der Box `spotify-anmeldung` — soloist laeuft, ist aber
 * nicht angemeldet, die Box steht in Spotifys Geraeteliste nicht drin), das
 * Ausweichen kam bei der lokalen Quelle an, und `folgeWaehlen` fand fuer
 * Wunsch 3 in einer Ein-Titel-Liste nichts. Aus der -1 wurde `gestartetNr:
 * 1`. Wirkung: JEDER Tipp auf ein beliebiges Kapitel spielte Kapitel 1, die
 * Kapitel 2..11 waren unerreichbar — und die Antwort behauptete dabei, alles
 * sei in Ordnung.
 *
 * WAS HIER GEMESSEN WIRD, ist deshalb nicht „spielt Spotify", sondern die
 * REGEL DAHINTER: eine Quelle, die den ausdruecklichen Titelwunsch nicht
 * fuehrt, sagt nein — damit das Ausweichen zu einer Quelle weitergehen kann,
 * die ihn fuehrt (Test 1), und damit am Ende Stille MIT GRUND steht, wenn es
 * keine solche Quelle gibt (Test 2). Niemals still Kapitel 1.
 *
 * EIGENE DATEI, nicht in spielen.integration.spec.ts: dort steht ein Fake,
 * der JEDEN Startbefehl bestaetigt. Hier muss der Spotify-Weg in einem Test
 * tragen und im anderen gar nicht erst zur Verfuegung stehen — das sind zwei
 * verschiedene Katalog-Lagen, keine zwei Faelle desselben Aufbaus.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { medienSchluessel } from './medien.js'

/** Der Spotify-Zwilling: elf Kapitel, und er fuehrt die Kennung des Werks. */
const MEER_SP = {
  id: '14Xy9Ycf6KfXH6nG2r9Zdb',
  title: '101 Meerjungfrauen',
  artist: 'Bibi Blocksberg',
  type: 'spotify',
  category: 'music',
}
/** Der Mitschnitt: EINE Datei, also ein Titel. Genau die Lage vom Geraet. */
const MEER_LOKAL = {
  type: 'library',
  category: 'audiobook',
  artist: 'Bibi Blocksberg',
  title: '101 Meerjungfrauen',
}
/**
 * Ein Werk OHNE zweite Quelle, ebenfalls mit nur einem Titel — fuer den Fall,
 * in dem das Ausweichen nirgendwo mehr ankommt. Ohne diesen zweiten Katalog-
 * Eintrag liesse sich Test 2 nur messen, indem man Spotify kaputtmacht; ein
 * Werk, das nie eine zweite Quelle hatte, sagt dieselbe Sache ohne Kulisse.
 */
const SOLO_LOKAL = {
  type: 'library',
  category: 'audiobook',
  artist: 'Nur Einmal',
  title: 'Ein Kapitel',
}

const KATALOG = [MEER_SP, MEER_LOKAL, SOLO_LOKAL]

let app: import('express').Express
let verzeichnis = ''
let fake: http.Server
/** Was der Abspieldienst-Fake gesehen hat, in Reihenfolge. */
let leitung: string[] = []

describe('E117 — ein Titelwunsch, den die Quelle nicht fuehrt', () => {
  before(async () => {
    verzeichnis = mkdtempSync(join(tmpdir(), 'mupi-e117-'))
    writeFileSync(join(verzeichnis, 'data.json'), JSON.stringify(KATALOG, null, 2))
    writeFileSync(join(verzeichnis, 'active_data.json'), JSON.stringify(KATALOG, null, 2))
    writeFileSync(join(verzeichnis, 'darstellung.json'), JSON.stringify({ aktuell: { verschmelzen: true } }))
    // HAND-ZUORDNUNG: Mitschnitt und Spotify-Fassung tragen verschiedene
    // Kategorien (`audiobook` gegen `music`) — der automatische Abgleich legt
    // sie nicht zusammen. Ohne diese Datei traegt das Werk nur EINE Quelle,
    // und Test 1 waere aus dem falschen Grund gruen.
    writeFileSync(
      join(verzeichnis, 'verschmelzung.json'),
      JSON.stringify({
        zuordnungen: [{ schluessel: medienSchluessel(MEER_SP), auch: [medienSchluessel(MEER_LOKAL)], stufe: 'hand' }],
      }),
    )
    writeFileSync(join(verzeichnis, 'mupiboxconfig.json'), JSON.stringify({}))
    process.env.MUPIBOX_CONFIG = join(verzeichnis, 'mupiboxconfig.json')

    // ECHTE DATEIEN, wie in spielen.integration.spec.ts begruendet: das
    // VERZEICHNIS ist seit E111 die Wahrheit ueber die lokale Titelliste. Je
    // Werk genau EINE Spur — das ist der Messfall, nicht eine Sparmassnahme.
    const medien = join(verzeichnis, 'medien')
    for (const w of [MEER_LOKAL, SOLO_LOKAL]) {
      const ordner = join(medien, w.category, w.artist, w.title)
      mkdirSync(ordner, { recursive: true })
      writeFileSync(join(ordner, '01 Kapitel 1.flac'), '')
    }
    process.env.MUPIBOX_MEDIA_DIR = medien

    fake = http.createServer((req, res) => {
      const pfad = String(req.url ?? '')
      leitung.push(pfad)
      res.setHeader('content-type', 'application/json')
      if (pfad === '/local') return res.end(JSON.stringify({ currentPlayer: '', duration: null, timePos: null }))
      if (pfad === '/current/stop') return res.end(JSON.stringify({ status: 'ok', angehalten: 'bestaetigt' }))
      // KEINE /tracklist-Antwort mit Inhalt: gaebe der Fake hier eine
      // zweielfige m3u-Liste zurueck, haette die lokale Quelle ploetzlich
      // Titel, die es auf der Platte nicht gibt — und der Messfall waere weg.
      if (pfad.startsWith('/tracklist')) return res.end(JSON.stringify({ tracks: [] }))
      res.end(JSON.stringify({ status: 'ok' }))
    })
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r))
    process.env.PLAYER_PROXY_PORT = String((fake.address() as AddressInfo).port)
    process.env.MUPIBOX_CONFIG_DIR = verzeichnis
    process.env.MUPIBOX_LOCK_DIR = verzeichnis
    app = (await import('./server.js')).app
  })

  after(async () => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_LOCK_DIR = undefined
    process.env.MUPIBOX_CONFIG = undefined
    process.env.MUPIBOX_MEDIA_DIR = undefined
    process.env.PLAYER_PROXY_PORT = undefined
    await new Promise((r) => fake.close(r))
  })

  it('Kapitel 3 bei 1 lokalem und 11 Anbieter-Titeln: es startet Kapitel 3, nicht Kapitel 1', async () => {
    leitung = []
    const r = await request(app)
      .post('/api/spielen')
      .send({ schluessel: medienSchluessel(MEER_SP), titelNr: 3 })
      .expect(200)

    // DIE ZEILE, DIE DEN FEHLER VOM GERAET FESTHAELT. Vor E117 stand hier
    // `dienst: 'lokal'` und `gestartetNr: 1`: die lokale Quelle nahm den
    // Wunsch entgegen, konnte ihn nicht erfuellen und startete stillschweigend
    // ihren einzigen Titel. Jetzt sagt sie nein, und das Ausweichen kommt bei
    // der Quelle an, die elf Kapitel fuehrt.
    assert.equal(r.body.ergebnis, 'ok')
    assert.equal(r.body.gestartetNr, 3, `Kapitel ${r.body.gestartetNr} statt 3 gestartet (dienst=${r.body.dienst})`)
    assert.notEqual(r.body.dienst, 'lokal', 'die Ein-Titel-Quelle hat den Wunsch wieder angenommen')

    // Und auf der Leitung: der Spotify-Start traegt die DREI. Ohne diese
    // Gegenprobe koennte `gestartetNr` stimmen, waehrend etwas anderes spielt
    // — genau die Sorte Zwei-Wahrheiten-Fehler, aus der E110 entstand.
    const start = leitung.find((p) => p.startsWith('/current/spotify/now/'))
    assert.ok(start, `kein Spotify-Start auf der Leitung: ${leitung.join(' | ')}`)
    assert.ok(start.includes(`:${MEER_SP.id}:3:`), `Kapitel 3 fehlt im Startbefehl: ${start}`)

    // KEIN lokaler Titelbefehl: die lokale Quelle darf nicht angespielt und
    // dann ueberholt worden sein — das haette man auf der Box gehoert.
    assert.ok(
      !leitung.some((p) => p.startsWith('/current/datei/')),
      `die lokale Quelle hat trotzdem gestartet: ${leitung.join(' | ')}`,
    )
  })

  it('gibt es die Nummer NIRGENDS, endet es in Stille MIT Grund — nicht in Kapitel 1', async () => {
    // Das Werk hat nur die lokale Quelle mit einem Titel. Es gibt kein
    // Ausweichen mehr, und genau dann muss die Absage bis nach oben
    // durchschlagen: ein 502 mit lesbarem Grund ist fuer die Oberflaeche
    // etwas, das sie dem Kind sagen kann. Ein „ok" auf Kapitel 1 ist es nicht.
    leitung = []
    const r = await request(app)
      .post('/api/spielen')
      .send({ schluessel: medienSchluessel(SOLO_LOKAL), titelNr: 3 })
      .expect(502)

    assert.equal(r.body.ergebnis, 'geht-nicht')
    assert.equal(r.body.grund, 'titel-nicht-in-quelle')
    // NICHTS wurde gestartet. Der Fehler war nicht nur die falsche Auskunft,
    // sondern der falsche TON — hier darf kein Titelbefehl hinausgehen.
    assert.ok(
      !leitung.some((p) => p.startsWith('/current/datei/')),
      `es wurde doch etwas gestartet: ${leitung.join(' | ')}`,
    )
  })

  it('OHNE Titelwunsch bleibt alles, wie es war — die Album-Kachel spielt von vorn', async () => {
    // DIE GRENZE DER REGEL, und sie ist der Grund fuer `titelNr >= 1`. Ein
    // Tipp auf die Kachel schickt keine Nummer; die Absage darf dort nicht
    // greifen, sonst verstummte eine Box, die vorher Ton hatte — die Sorte
    // Umbau-Schaden, vor der E111 im selben Modul ausdruecklich warnt.
    leitung = []
    const r = await request(app)
      .post('/api/spielen')
      .send({ schluessel: medienSchluessel(SOLO_LOKAL) })
      .expect(200)

    assert.equal(r.body.ergebnis, 'ok')
    assert.equal(r.body.dienst, 'lokal')
    assert.equal(r.body.gestartetNr, 1)
    assert.ok(
      leitung.some((p) => p.startsWith('/current/datei/')),
      `kein lokaler Start: ${leitung.join(' | ')}`,
    )
  })
})
