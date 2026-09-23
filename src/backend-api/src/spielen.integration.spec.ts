/**
 * DIE SPIELFUNKTION AM STUECK (E95/V) — vom Wunsch bis zur Leitung.
 *
 * WOZU ES DIESE DATEI GIBT: Mit Stufe 2 schickt die Oberflaeche nur noch
 * `POST /api/spielen`; die Wahrheiten, die vorher NEUN UI-Werkzeuge an der
 * /player-Leitung massen (stop VOR dem Start, die Plattenform im
 * musicsearch-Befehl, die gemerkte Stelle IM Spotify-Startbefehl, der
 * tracknr/seekpos-Nachlauf, die Kinderzeit als Tor), waeren sonst nur noch
 * am lebenden Geraet pruefbar. Hier laeuft der ECHTE server.ts gegen einen
 * ABSPIELDIENST-FAKE: gemessen wird, was auf der Leitung zu :5005 ankommt —
 * dieselbe Frage wie bei den UI-Werkzeugen, nur eine Schicht tiefer, wo die
 * Entscheidung seit E95/V wohnt.
 *
 * WAS HIER FEHLT UND WO ES STEHT: Der ARD-/Plugin-Weg (Liste holen, ganze
 * Sendung anhaengen) braucht den Plugin-Wirt samt Netz und bleibt dem
 * Geraetebeweis ueberlassen (BACKLOG E95/V Stufe 2; die Folgen-Wahl selbst
 * ist rein und liegt in spielfunktion.spec.ts bei `folgeWaehlen`).
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

/** Der Messfall von E105/E106: Aufnahme mit Komma-Interpret und
 *  Schraegstrich-Sanitisierung, verschmolzen mit dem Spotify-Zwilling. */
const MORGEN_LOKAL = {
  type: 'library',
  category: 'audiobook',
  artist: 'Team Karacho, Rola',
  title: 'Guten Morgen _ Good Morning (Englisch)',
}
const MORGEN_SP = {
  id: '6wMxUeU6oFEBQEFeqMsWGi',
  title: 'Guten Morgen / Good Morning (Englisch)',
  artist: 'Team Karacho, Rola',
  type: 'spotify',
  category: 'music',
}
/** Ein Werk, das NUR Spotify hat — fuer das Anbieter-Sieb (alle Quellen aus). */
const SOLO_SP = {
  id: '53tvjWbVNZKd3CvpENkzOC',
  title: 'Greatest Hits',
  artist: 'Red Hot Chili Peppers',
  type: 'spotify',
  category: 'music',
}
/**
 * DIE BOX MIT FREMD GEMOUNTETEN MEDIEN (E111): ein lokaler Eintrag, zu dem es
 * unter `MUPIBOX_MEDIA_DIR` KEINEN Ordner gibt. Der Server sieht dann kein
 * Verzeichnis, faellt in `inhaltFuerEintrag` auf die playlist.m3u des
 * Abspieldienstes zurueck — und deren Titel tragen keinen Befehl. Genau der
 * Fall, den der Rueckfall auffangen muss; ohne ihn spielte diese Box nichts.
 */
const NUR_M3U = {
  type: 'library',
  category: 'audiobook',
  artist: 'Fremd Gemountet',
  title: 'Ohne Ordner',
}
/** Die Spuren, die als ECHTE Dateien im Medienordner angelegt werden — die
 *  Nummern sind die Identitaet (titelkarte.ts), die Namen die Gegenprobe. */
const MORGEN_DATEIEN = ['01 Guten Morgen _ Good Morning (Englisch).flac', '02 Zweites Stueck.flac']

const KATALOG = [MORGEN_SP, MORGEN_LOKAL, SOLO_SP, NUR_M3U]

let app: import('express').Express
let verzeichnis = ''
let fake: http.Server
/** Was der Abspieldienst-Fake gesehen hat, in Reihenfolge. */
let leitung: string[] = []
/** Was `/local` melden soll — je Test verstellbar. */
let lokalStand: Record<string, unknown> = {}

/** Warten, bis auf der Leitung etwas Bestimmtes ankam — oder die Frist faellt.
 *  Der Nachlauf (tracknr/seekpos) laeuft NACH der HTTP-Antwort weiter; wer
 *  sofort misst, misst den Anlauf (llmwiki einmal-hinsehen-ist-keine-messung). */
async function leitungBis(pruefe: () => boolean, fristMs = 6000): Promise<void> {
  const ende = Date.now() + fristMs
  while (!pruefe() && Date.now() < ende) await new Promise((r) => setTimeout(r, 50))
}

describe('POST /api/spielen — die Leitung zum Abspieldienst', () => {
  before(async () => {
    verzeichnis = mkdtempSync(join(tmpdir(), 'mupi-spielen-'))
    writeFileSync(join(verzeichnis, 'data.json'), JSON.stringify(KATALOG, null, 2))
    writeFileSync(join(verzeichnis, 'active_data.json'), JSON.stringify(KATALOG, null, 2))
    // Der Darstellungs-Schalter, den auch die Route liest
    // (verschmelzenAusDarstellung: `aktuell.verschmelzen`): verschmolzen wird.
    writeFileSync(join(verzeichnis, 'darstellung.json'), JSON.stringify({ aktuell: { verschmelzen: true } }))
    // DIE HAND-ZUORDNUNG, wie sie der Betreiber am 30.08.2026 gesetzt hat:
    // Aufnahme und Spotify-Fassung tragen VERSCHIEDENE Titel (`/` wurde `_`),
    // der automatische Abgleich legt sie deshalb NIE zusammen — genau der
    // E105-Fall. Ohne diese Datei testete alles hier ein unverschmolzenes
    // Werk und waere aus dem falschen Grund gruen.
    writeFileSync(
      join(verzeichnis, 'verschmelzung.json'),
      JSON.stringify({
        zuordnungen: [
          { schluessel: medienSchluessel(MORGEN_SP), auch: [medienSchluessel(MORGEN_LOKAL)], stufe: 'hand' },
        ],
      }),
    )
    // Der Anbieter-Schalter liest eine EIGENE Datei ueber eine EIGENE
    // Umgebungsvariable (mupiboxConfigPath) — nicht den Config-Ordner.
    writeFileSync(join(verzeichnis, 'mupiboxconfig.json'), JSON.stringify({}))
    process.env.MUPIBOX_CONFIG = join(verzeichnis, 'mupiboxconfig.json')

    /* ══ ECHTE DATEIEN, KEIN DOPPELGAENGER (E111) ═════════════════════════
     *
     * Seit E111 ist das VERZEICHNIS die Wahrheit ueber die lokale Titelliste
     * (server.ts, `inhaltFuerEintrag`) — und der Ton spielt seither dieselbe
     * Liste, die die Anzeige zeigt. Wer diesen Weg messen will, braucht
     * Dateien auf der Platte: ein Fake fuer `readdir` waere ein zweiter
     * Ordner-Begriff neben dem echten und ginge genau dann auseinander, wenn
     * es darauf ankommt. Zwei leere Dateien kosten nichts; gelesen wird
     * ohnehin nur der NAME (Nummer, Titel, Endung).
     *
     * Die Umgebungsvariable muss VOR dem Import von server.js stehen:
     * `MEDIEN_ORDNER` ist dort eine Modul-Konstante.
     */
    const medien = join(verzeichnis, 'medien')
    const albumOrdner = join(medien, MORGEN_LOKAL.category, MORGEN_LOKAL.artist, MORGEN_LOKAL.title)
    mkdirSync(albumOrdner, { recursive: true })
    for (const datei of MORGEN_DATEIEN) writeFileSync(join(albumOrdner, datei), '')
    // Fuer NUR_M3U wird BEWUSST kein Ordner angelegt — das ist der Messfall.
    process.env.MUPIBOX_MEDIA_DIR = medien

    fake = http.createServer((req, res) => {
      const pfad = String(req.url ?? '')
      leitung.push(pfad)
      res.setHeader('content-type', 'application/json')
      if (pfad === '/local') return res.end(JSON.stringify(lokalStand))
      // Die Titelliste des lokalen Albums (E108): dieselbe Form wie der
      // echte Abspieldienst (`GET /tracklist?a=<pfad>` liest die m3u).
      if (pfad.startsWith('/tracklist')) {
        return res.end(
          JSON.stringify({
            tracks: [
              { nr: 1, name: 'Guten Morgen _ Good Morning (Englisch)' },
              { nr: 2, name: 'Zweites Stueck' },
            ],
          }),
        )
      }
      // `stop` bestaetigt sofort — die Atempausen-Frage haengt am Feld
      // `angehalten`, nicht an einer echten Wartezeit (E24/O2).
      if (pfad === '/current/stop') return res.end(JSON.stringify({ status: 'ok', angehalten: 'bestaetigt' }))
      // Ein Sprung WIRKT im Fake: die Stelle springt auf das Ziel. Ohne das
      // fasste der Nachlauf neunmal nach (sprungAngekommen bliebe falsch),
      // und der Test misst dann sein eigenes Nachfassen statt des Weges.
      const sprung = /^\/current\/seekpos:(\d+(?:\.\d+)?)/.exec(pfad)
      if (sprung) {
        const dauer = Number(lokalStand.duration) || 0
        lokalStand = { ...lokalStand, timePos: (dauer * Number(sprung[1])) / 100 }
      }
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

  it('spielt die verschmolzene Kachel LOKAL — der Titelbefehl samt Komma auf der Leitung', async () => {
    // UEBERSETZT AUF DEN NEUEN WEG (E111), Aussage unveraendert: Sonderzeichen
    // kommen KODIERT auf der Leitung an. Bis E111 mass dieser Fall die
    // Plattenform im `musicsearch`-Album-Befehl; seither spielt die lokale
    // Quelle Titel fuer Titel (`datei/…`), damit Ton und Anzeige dieselbe
    // Liste benutzen — die E106-Kette (%2C fuer das Komma im Interpreten,
    // `_` statt `/` aus der Sanitisierung der Aufnahme) laeuft dieselbe
    // Strecke, nur durch ein anderes Verb.
    leitung = []
    lokalStand = { currentPlayer: '', duration: null, timePos: null }
    const r = await request(app)
      .post('/api/spielen')
      .send({ schluessel: medienSchluessel(MORGEN_SP) })
      .expect(200)
    assert.equal(r.body.ergebnis, 'ok')
    assert.equal(r.body.dienst, 'lokal')
    // ERST anhalten, DANN starten.
    const stop = leitung.indexOf('/current/stop')
    const start = leitung.findIndex((p) => p.startsWith('/current/datei/'))
    assert.ok(stop >= 0, `kein stop auf der Leitung: ${leitung.join(' | ')}`)
    assert.ok(start > stop, `Start kam nicht nach dem stop: ${leitung.join(' | ')}`)
    // (a) DER ALBUM-BEFEHL IST WEG — er las die playlist.m3u und damit eine
    // andere Liste als die angezeigte. Genau das war der gemeldete Fehler.
    assert.ok(
      !leitung.some((p) => p.startsWith('/current/musicsearch/')),
      `der m3u-Weg lief trotzdem: ${leitung.join(' | ')}`,
    )
    // Der Startbefehl zeigt auf die ERSTE Datei des Ordners, und zwar mit
    // Komma (%2C) und sanitisiertem Titel — Zeichen fuer Zeichen kodiert.
    assert.ok(
      leitung[start].includes('Team%20Karacho%2C%20Rola'),
      `Komma-Kodierung fehlt: ${decodeURIComponent(leitung[start])} / ${leitung[start]}`,
    )
    assert.ok(
      leitung[start].includes('01%20Guten%20Morgen%20_%20Good%20Morning%20(Englisch).flac'),
      `die erste Spur fehlt im Startbefehl: ${leitung[start]}`,
    )
    // Der Anzeigename hinter dem Pfad traegt denselben Interpreten — die
    // Buchfuehrung des Abspieldienstes liest ihn (`:title:artist:`).
    assert.ok(leitung[start].endsWith(':title:artist:Team%20Karacho%2C%20Rola'), `Schwanz falsch: ${leitung[start]}`)

    // (b) DER REST DER LISTE WIRD ANGEHAENGT, nicht neu gestartet: nur so
    // zaehlt mpv dieselbe Warteschlange, die die Anzeige zeigt.
    await leitungBis(() => leitung.some((p) => p.startsWith('/current/dateiqueue/')))
    const anhaengen = leitung.find((p) => p.startsWith('/current/dateiqueue/'))
    assert.ok(anhaengen, `kein dateiqueue auf der Leitung: ${leitung.join(' | ')}`)
    assert.ok(leitung.indexOf(anhaengen) > start, `angehaengt wurde vor dem Start: ${leitung.join(' | ')}`)
    assert.ok(anhaengen.includes('02%20Zweites%20Stueck.flac'), `die zweite Spur fehlt: ${anhaengen}`)
  })

  it('E111: OHNE Ordner bleibt der m3u-Weg — die Box mit fremden Medien spielt weiter', async () => {
    // DIE PFLICHT-ABSICHERUNG des Umbaus. Zu NUR_M3U gibt es keinen Ordner
    // unter MUPIBOX_MEDIA_DIR (fremder Mount, andere Ablage); die Titelliste
    // kommt dann vom Abspieldienst aus der playlist.m3u und traegt KEINE
    // Befehle. Ohne Rueckfall endete das in „keine-titel" und die Box bliebe
    // stumm — obwohl `musicsearch/library` dort seit jeher spielt.
    leitung = []
    lokalStand = { currentPlayer: '', duration: null, timePos: null }
    const r = await request(app)
      .post('/api/spielen')
      .send({ schluessel: medienSchluessel(NUR_M3U) })
      .expect(200)
    assert.equal(r.body.ergebnis, 'ok')
    assert.equal(r.body.dienst, 'lokal')
    const start = leitung.find((p) => p.startsWith('/current/musicsearch/'))
    assert.ok(start, `kein musicsearch-Rueckfall: ${leitung.join(' | ')}`)
    assert.ok(
      start.includes('album/audiobook:Fremd%20Gemountet:Ohne%20Ordner'),
      `Plattenform des Rueckfalls falsch: ${start}`,
    )
    // Und KEIN datei-Befehl: es gibt keine Datei, auf die er zeigen koennte.
    assert.ok(
      !leitung.some((p) => p.startsWith('/current/datei/') || p.startsWith('/current/dateiqueue/')),
      `ein Dateibefehl ohne Ordner: ${leitung.join(' | ')}`,
    )
  })

  it('Weiterhoeren mit gemerktBei=spotify: die Nummernraum-Regel schickt EINEN Spotify-Befehl mit Stelle', async () => {
    leitung = []
    lokalStand = { currentPlayer: 'mplayer', duration: 200, timePos: 30 }
    const r = await request(app)
      .post('/api/spielen')
      .send({ schluessel: medienSchluessel(MORGEN_SP), titelNr: 4, positionMs: 92500, gemerktBei: 'spotify' })
      .expect(200)
    // Das Werk fuehrt LOKAL, gemerkt wurde bei SPOTIFY — der lokale
    // Mitschnitt traegt oft nur einen Teil, Titel 4 seiner Liste waere ein
    // anderes Lied. Die gemerkte Quelle gewinnt (versuchsQuellen, Regel 3).
    assert.equal(r.body.dienst, 'spotify')
    const start = leitung.find((p) => p.startsWith('/current/spotify/now/'))
    assert.ok(start, `kein Spotify-Start: ${leitung.join(' | ')}`)
    // Titelnummer und Millisekunden stehen IM Startbefehl (ein Sprung nach
    // vorn wirkt bei laufender Spotify-Wiedergabe nicht) …
    assert.ok(start.endsWith(`:${MORGEN_SP.id}:4:92500`), `Stelle fehlt im Startbefehl: ${start}`)
    // … und es folgt KEIN tracknr/seekpos-Nachlauf — der waere der stille
    // Weg, eine fremde Wiedergabe zu treffen.
    await new Promise((r2) => setTimeout(r2, 400))
    assert.ok(
      !leitung.some((p) => p.includes('tracknr:') || p.includes('seekpos:')),
      `unerwarteter Nachlauf: ${leitung.join(' | ')}`,
    )
  })

  it('Weiterhoeren auf mpv: nach der Antwort folgen tracknr und seekpos — in dieser Reihenfolge', async () => {
    leitung = []
    // Der Fake meldet eine offene Datei mit frischer Stelle — der Nachlauf
    // darf sofort springen (die Belege stehen an spielenTitelUndStelle).
    lokalStand = { currentPlayer: 'mplayer', totalTracks: 3, duration: 200, timePos: 1 }
    const r = await request(app)
      .post('/api/spielen')
      .send({ schluessel: medienSchluessel(MORGEN_SP), titelNr: 2, positionProzent: 40 })
      .expect(200)
    // Ohne gemerktBei bleibt die fuehrende Quelle: lokal, also der mpv-Weg.
    assert.equal(r.body.dienst, 'lokal')
    await leitungBis(() => leitung.some((p) => p.includes('seekpos:40')))
    const tracknr = leitung.findIndex((p) => p.includes('tracknr:2'))
    const seek = leitung.findIndex((p) => p.includes('seekpos:40'))
    assert.ok(tracknr >= 0, `kein tracknr: ${leitung.join(' | ')}`)
    assert.ok(seek > tracknr, `seekpos kam nicht nach tracknr: ${leitung.join(' | ')}`)
  })

  it('die Kinderzeit ist ein Tor: gesperrt heisst 403 mit Urteil, und die Leitung bleibt still', async () => {
    // PUT nimmt die REGELN (regelnNormalisieren), nicht den ganzen Satz —
    // und alle Tage `frei: false` sperrt UNABHAENGIG von der Uhrzeit des
    // Testlaufs (tests-duerfen-keine-zahlen-festnageln gilt auch fuer Uhren).
    const gesperrt = {
      aktiv: true,
      nachsichtMin: 5,
      tage: Object.fromEntries(
        ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'].map((t) => [t, { frei: false, ab: '', bis: '', minuten: 0 }]),
      ),
    }
    await request(app).put('/api/kinderzeit').send(gesperrt).expect(200)
    try {
      leitung = []
      const r = await request(app)
        .post('/api/spielen')
        .send({ schluessel: medienSchluessel(MORGEN_SP) })
        .expect(403)
      assert.equal(r.body.kinderzeit, true)
      assert.equal(r.body.grund, 'tagGesperrt')
      assert.ok(!leitung.some((p) => p.startsWith('/current/')), `Leitung nicht still: ${leitung.join(' | ')}`)
    } finally {
      // Zurueck auf die Vorgabe: Kinderzeit aus, die Box verhaelt sich wie vorher.
      await request(app).put('/api/kinderzeit').send({ aktiv: false }).expect(200)
    }
  })

  it('der Anbieter-Schalter verweigert erst, wenn ALLE Quellen aus sind — mit dem Satz zum Anschalten', async () => {
    writeFileSync(join(verzeichnis, 'mupiboxconfig.json'), JSON.stringify({ spotify: { aktiv: false } }))
    try {
      leitung = []
      const r = await request(app)
        .post('/api/spielen')
        .send({ schluessel: medienSchluessel(SOLO_SP) })
        .expect(403)
      assert.equal(r.body.anbieterAus, true)
      assert.equal(r.body.dienst, 'spotify')
      assert.ok(!leitung.some((p) => p.startsWith('/current/')), `Leitung nicht still: ${leitung.join(' | ')}`)
      // Das VERSCHMOLZENE Werk spielt weiter — das Sieb laesst lokal durch.
      leitung = []
      lokalStand = { currentPlayer: '', duration: null, timePos: null }
      const zwei = await request(app)
        .post('/api/spielen')
        .send({ schluessel: medienSchluessel(MORGEN_SP) })
        .expect(200)
      assert.equal(zwei.body.dienst, 'lokal')
    } finally {
      writeFileSync(join(verzeichnis, 'mupiboxconfig.json'), JSON.stringify({}))
    }
  })

  it('ein unbekannter Schluessel ist 404 — nicht raten, nicht irgendwas spielen', async () => {
    leitung = []
    await request(app).post('/api/spielen').send({ schluessel: 'gibtsnicht:xyz' }).expect(404)
    assert.equal(leitung.filter((p) => p.startsWith('/current/')).length, 0)
  })

  it('der Kennung-Wunsch (Stufe 3) spielt ein Katalog-Album OHNE Bibliothekseintrag — mit Stelle im Startbefehl', async () => {
    // Die Interpretenseite: Alben und Singles kommen direkt aus dem
    // Spotify-Katalog, einen Schluessel gibt es nicht. Die Tore gelten
    // trotzdem — derselbe spielVersuch, dieselbe Leitung.
    leitung = []
    lokalStand = { currentPlayer: '', duration: null, timePos: null }
    const r = await request(app)
      .post('/api/spielen')
      .send({ kennung: { dienst: 'spotify', art: 'album', id: '4uLU6hMCjMI75M1A2tKUQC' }, titelNr: 5 })
      .expect(200)
    assert.equal(r.body.ergebnis, 'ok')
    assert.equal(r.body.dienst, 'spotify')
    const start = leitung.find((p) => p.startsWith('/current/spotify/now/'))
    assert.ok(start, `kein Spotify-Start: ${leitung.join(' | ')}`)
    assert.ok(start.endsWith(':4uLU6hMCjMI75M1A2tKUQC:5:0'), `Nummer fehlt im Startbefehl: ${start}`)
    assert.ok(leitung.indexOf('/current/stop') < leitung.indexOf(start), 'stop kam nicht vor dem Start')
  })

  it('der Kennung-Wunsch respektiert den Anbieter-Schalter und weist Unbekanntes mit 400 ab', async () => {
    writeFileSync(join(verzeichnis, 'mupiboxconfig.json'), JSON.stringify({ spotify: { aktiv: false } }))
    try {
      leitung = []
      const r = await request(app)
        .post('/api/spielen')
        .send({ kennung: { dienst: 'spotify', art: 'album', id: '4uLU6hMCjMI75M1A2tKUQC' } })
        .expect(403)
      assert.equal(r.body.anbieterAus, true)
      assert.ok(!leitung.some((p) => p.startsWith('/current/')), `Leitung nicht still: ${leitung.join(' | ')}`)
    } finally {
      writeFileSync(join(verzeichnis, 'mupiboxconfig.json'), JSON.stringify({}))
    }
    // Ein Wunsch, den es nicht gibt (fremder Dienst, fehlende Id), ist ein
    // Aufruferfehler — 400, nicht raten.
    await request(app)
      .post('/api/spielen')
      .send({ kennung: { dienst: 'deezer', art: 'album', id: 'x' } })
      .expect(400)
    await request(app)
      .post('/api/spielen')
      .send({ kennung: { dienst: 'spotify', art: 'album', id: '' } })
      .expect(400)
  })

  it('E108: die eingestellte Reihenfolge dreht die Bevorzugung — spotify zuerst heisst spotify', async () => {
    // Betreiber: „eine moeglichkeit die abspiel logic einzustellen wie
    // beispielsweise erstlokal--> jellyfin-->clouddienst". Dasselbe Werk wie
    // im ersten Fall — nur die Einstellung unterscheidet die beiden Laeufe;
    // ohne sie spielte hier lokal (der erste Test misst genau das).
    writeFileSync(
      join(verzeichnis, 'mupiboxconfig.json'),
      JSON.stringify({ abspielen: { reihenfolge: ['spotify', 'lokal'] } }),
    )
    try {
      leitung = []
      lokalStand = { currentPlayer: '', duration: null, timePos: null }
      const r = await request(app)
        .post('/api/spielen')
        .send({ schluessel: medienSchluessel(MORGEN_SP) })
        .expect(200)
      assert.equal(r.body.dienst, 'spotify')
      assert.ok(
        leitung.some((p) => p.startsWith('/current/spotify/now/')),
        `kein Spotify-Start: ${leitung.join(' | ')}`,
      )
      assert.ok(
        !leitung.some((p) => p.startsWith('/current/musicsearch/')),
        `die lokale Quelle spielte trotz Einstellung: ${leitung.join(' | ')}`,
      )
    } finally {
      writeFileSync(join(verzeichnis, 'mupiboxconfig.json'), JSON.stringify({}))
    }
  })

  it('E108: /inhalt stempelt die Herkunft je Titel — der lokale Gewinner traegt quelle lokal', async () => {
    // Ohne Abfrageteil gilt der Darstellungs-Schalter (an) — der Rueckfall
    // holt alle Kandidaten: lokal antwortet ueber den Fake (/tracklist),
    // Spotify hat hier kein Netz und faellt aus. Der Gewinner ist die lokale
    // Liste, und JEDER Titel sagt seine Herkunft (die Plakette liest sie).
    const r = await request(app)
      .get(`/api/werke/${encodeURIComponent(medienSchluessel(MORGEN_SP))}/inhalt`)
      .expect(200)
    assert.equal(r.body.dienst, 'lokal')
    assert.ok(Array.isArray(r.body.titel) && r.body.titel.length === 2, `Titelliste fehlt: ${JSON.stringify(r.body)}`)
    for (const t of r.body.titel) {
      assert.equal(t.quelle, 'lokal')
      assert.deepEqual(t.quellen, ['lokal'])
    }
  })
})
