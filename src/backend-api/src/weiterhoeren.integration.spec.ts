/**
 * „Weiterhoeren" am LAUFENDEN Server — der ganze Weg einmal herum.
 *
 * WORUM ES GEHT: Die neue Oberflaeche meldet in SEKUNDEN, wo sie steht. In
 * `resume.json` muss daraus je nach Dienst etwas anderes werden
 * (Millisekunden bei Spotify, Prozent bei mpv), und beim Zurueckholen muss
 * genau das wieder herauskommen, was ein Abspielbefehl braucht.
 *
 * WARUM DAS EIN EIGENER TEST IST: Die reinen Regeln sind in
 * weiterhoeren.spec.ts geprueft, aber die teuerste Fehlerklasse dieses
 * Projekts liegt DAZWISCHEN — zwischen zwei Schluesselformen, zwei Dateien und
 * zwei Einheiten. Ein Fehler dort ist nicht sichtbar: die Reihe zeigt Kacheln,
 * sie starten nur an der falschen Stelle. Deshalb wird hier das ERGEBNIS
 * geprueft, nicht die Form.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { medienSchluessel } from './medien.js'

const SPOTIFY = {
  id: 'testWeiterSpotify01',
  title: 'Eine lange Geschichte',
  artist: 'Pruefung',
  type: 'spotify',
  category: 'audiobook',
}

const LOKAL = {
  title: 'Die Maus',
  artist: 'WDR',
  type: 'library',
  category: 'audiobook',
}

const RADIO = {
  id: 'http://stream.example.invalid/kinder.mp3',
  title: 'Kinderradio',
  type: 'radio',
  category: 'other',
}

/**
 * Eine PLAYLIST — der Fall, der am 02.08.2026 ins falsche Kapitel sprang.
 *
 * Sie muss hier stehen, weil sie sich vom Album an genau einer Stelle
 * unterscheidet, die man nicht sieht: `titelNr` ist bei ihr die Nummer im
 * Album des Stuecks, nicht die Abspielposition.
 */
const PLAYLIST = {
  playlistid: 'testWeiterPlaylist01',
  title: 'Die grosse Hoerspielreihe',
  artist: 'EUROPA',
  type: 'spotify',
  category: 'audiobook',
}

let app: import('express').Express
let konfig = ''

describe('Weiterhoeren: melden, merken, wiederfinden', () => {
  before(async () => {
    const d = mkdtempSync(join(tmpdir(), 'mupi-weiter-'))
    writeFileSync(join(d, 'active_data.json'), JSON.stringify([SPOTIFY, LOKAL, RADIO, PLAYLIST], null, 2))
    writeFileSync(join(d, 'data.json'), JSON.stringify([SPOTIFY, LOKAL, RADIO, PLAYLIST], null, 2))
    writeFileSync(join(d, 'resume.json'), '[]')
    writeFileSync(join(d, 'gespielt.json'), '[]')
    konfig = join(d, 'mupiboxconfig.json')
    writeFileSync(konfig, JSON.stringify({ mupibox: { resume: 9 } }))
    process.env.MUPIBOX_CONFIG_DIR = d
    process.env.MUPIBOX_CONFIG = konfig
    // DIE SPERRDATEI LIEGT AUSSERHALB des Testverzeichnisses (/tmp/.resume.lock,
    // so benutzen sie /api/addresume und remove_max_resume.sh). Ein Rest aus
    // einem abgebrochenen Lauf wuerde hier ALLES stumm ueberspringen — die
    // Tests waeren gruen, ohne je geschrieben zu haben.
    if (existsSync('/tmp/.resume.lock')) rmSync('/tmp/.resume.lock')
    app = (await import('./server.js')).app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_CONFIG = undefined
  })

  it('macht aus gemeldeten Sekunden MILLISEKUNDEN, wenn es Spotify ist', async () => {
    await request(app)
      .post('/api/weiterhoeren')
      .send({ schluessel: medienSchluessel(SPOTIFY), titelNr: 4, bisher: 92.5, dauer: 600 })
      .expect(200)

    const r = await request(app).get('/api/weiterhoeren').expect(200)
    const z = r.body.weiter.find((e: { titel: string }) => e.titel === SPOTIFY.title)
    assert.ok(z, 'die Stelle muss in der Reihe stehen')
    assert.equal(z.positionMs, 92_500)
    assert.equal(z.positionProzent, null)
    // 1-BASIERT UND UNVERSCHOBEN — der Abspieldienst zieht intern wieder eins ab.
    assert.equal(z.titelNr, 4)
    // Startbar: der Werkschluessel muss dabei sein, sonst fuehrt die Kachel
    // auf nichts.
    assert.equal(z.schluessel, medienSchluessel(SPOTIFY))
  })

  it('macht aus gemeldeten Sekunden PROZENT, wenn mpv spielt', async () => {
    await request(app)
      .post('/api/weiterhoeren')
      .send({ schluessel: medienSchluessel(LOKAL), titelNr: 2, bisher: 30, dauer: 120 })
      .expect(200)

    const r = await request(app).get('/api/weiterhoeren').expect(200)
    const z = r.body.weiter.find((e: { titel: string }) => e.titel === LOKAL.title)
    assert.ok(z)
    assert.equal(z.positionProzent, 25)
    assert.equal(z.positionMs, null)
    assert.equal(z.titelNr, 2)
  })

  it('reicht die gemeldete Warteschlangenlaenge bis in resume.json durch', async () => {
    // WARUM DIESER TEST IM INTEGRATIONSTEIL STEHT: Die Regel selbst ist rein
    // geprueft (weiterhoeren.spec.ts). Was hier haengen kann, ist die
    // DURCHREICHE — `gesamt` muss aus dem Rumpf der Meldung bis in `stelleAus`
    // kommen. Faellt sie unterwegs weg, bleibt ein durchgehoertes Album fuer
    // immer in der Reihe stehen, und kein reiner Test merkt es.
    await request(app)
      .post('/api/weiterhoeren')
      .send({ schluessel: medienSchluessel(LOKAL), titelNr: 2, gesamt: 12, bisher: 30, dauer: 120 })
      .expect(200)

    const roh = JSON.parse(readFileSync(join(process.env.MUPIBOX_CONFIG_DIR as string, 'resume.json'), 'utf8'))
    const e = roh.find((x: { title: string }) => x.title === LOKAL.title)
    assert.equal(e?.resumeGesamtTitel, 12)

    // Und der letzte Titel, praktisch durch, faellt damit aus der Reihe.
    await request(app)
      .post('/api/weiterhoeren')
      .send({ schluessel: medienSchluessel(LOKAL), titelNr: 12, gesamt: 12, bisher: 119, dauer: 120 })
      .expect(200)
    const r = await request(app).get('/api/weiterhoeren').expect(200)
    assert.equal(
      r.body.weiter.some((x: { titel: string }) => x.titel === LOKAL.title),
      false,
      'durchgehoert heisst: nicht mehr in der Weiterhoeren-Reihe',
    )

    // ZURUECK AUF DEN VORIGEN STAND, sonst faellt LOKAL den folgenden Tests
    // weg — sie erwarten es in der Reihe.
    await request(app)
      .post('/api/weiterhoeren')
      .send({ schluessel: medienSchluessel(LOKAL), titelNr: 2, bisher: 30, dauer: 120 })
      .expect(200)
  })

  it('stellt das zuletzt Angefangene nach vorn — die Zeit kommt aus dem Verlauf', async () => {
    // Der Verlauf ist die EINZIGE Stelle mit einem Zeitstempel; resume.json hat
    // keinen. Gemeldet wird hier ueber denselben Weg wie beim Abspielen.
    await request(app)
      .post('/api/gespielt')
      .send({ schluessel: medienSchluessel(SPOTIFY) })
      .expect(200)
    await new Promise((f) => setTimeout(f, 5))
    await request(app)
      .post('/api/gespielt')
      .send({ schluessel: medienSchluessel(LOKAL) })
      .expect(200)

    const r = await request(app).get('/api/weiterhoeren').expect(200)
    assert.equal(r.body.weiter[0].titel, LOKAL.title)
  })

  it('merkt sich fuer Radio GAR NICHTS', async () => {
    // Ein Strom hat keine Stelle. Eine Kachel „weiter" waere ein Versprechen
    // ohne Deckung — 200, weil das kein Fehler ist.
    const r = await request(app)
      .post('/api/weiterhoeren')
      .send({ schluessel: medienSchluessel(RADIO), titelNr: 0, bisher: 300, dauer: 0 })
      .expect(200)
    assert.equal(r.body.status, 'nichtMerkbar')

    const l = await request(app).get('/api/weiterhoeren').expect(200)
    assert.equal(
      l.body.weiter.some((e: { titel: string }) => e.titel === RADIO.title),
      false,
    )
  })

  it('legt fuer einen unbekannten Schluessel nichts an', async () => {
    await request(app).post('/api/weiterhoeren').send({ schluessel: 'spotify:gibtesnicht' }).expect(404)
  })

  it('merkt bei einer PLAYLIST nichts, solange die Position nicht aufloesbar ist', async () => {
    // DER BEFUND VOM 02.08.2026 an seiner teuersten Stelle. Ohne Titelliste
    // bliebe nur `titelNr` — und das ist bei einer Playlist die Nummer des
    // Stuecks in SEINEM Album. Kapitel 47 traegt dort die 3, und der Tipp auf
    // „Weiterhoeren" startete Kapitel 3 der Playlist, mitten drin.
    //
    // HIER IST SIE NICHT AUFLOESBAR, weil in dieser Umgebung kein
    // Spotify-Zugang eingerichtet ist (`webApiToken` wirft sofort, ohne Netz).
    // Genau so verhaelt sich die Box ohne Internet — und genau dann darf
    // nichts geschrieben werden, statt die falsche Zahl abzulegen.
    const r = await request(app)
      .post('/api/weiterhoeren')
      .send({
        schluessel: medienSchluessel(PLAYLIST),
        titelNr: 3,
        titelUri: 'spotify:track:kapitel47',
        bisher: 92.5,
        dauer: 600,
      })
      .expect(200)
    assert.equal(r.body.status, 'nichtAufloesbar')

    const roh = JSON.parse(readFileSync(join(process.env.MUPIBOX_CONFIG_DIR as string, 'resume.json'), 'utf8'))
    assert.equal(
      roh.some((e: { title: string }) => e.title === PLAYLIST.title),
      false,
      'eine Playlist-Stelle ohne aufgeloeste Position darf NICHT in resume.json stehen',
    )

    // Und sie taucht auch nicht in der Reihe auf — es gibt sie ja nicht.
    const l = await request(app).get('/api/weiterhoeren').expect(200)
    assert.equal(
      l.body.weiter.some((e: { titel: string }) => e.titel === PLAYLIST.title),
      false,
    )
  })

  it('zeigt einen ALTEN Playlist-Stand aus resume.json nicht in der Reihe', async () => {
    // Solche Eintraege liegen auf jeder Box: die klassische Oberflaeche
    // schreibt sie bis heute (`saveResumeFiles`), und sie ueberleben jede
    // Aktualisierung. Zahlenmaessig sind sie von richtigen nicht zu
    // unterscheiden — nur die Marke `resumeVersatzGeprueft` trennt sie.
    const datei = join(process.env.MUPIBOX_CONFIG_DIR as string, 'resume.json')
    const roh = JSON.parse(readFileSync(datei, 'utf8'))
    roh.push({
      ...PLAYLIST,
      category: 'resume',
      resumespotifytrack_number: 3,
      resumespotifyprogress_ms: 92_500,
      resumespotifyduration_ms: 600_000,
    })
    writeFileSync(datei, JSON.stringify(roh, null, 4))

    const l = await request(app).get('/api/weiterhoeren').expect(200)
    assert.equal(
      l.body.weiter.some((e: { titel: string }) => e.titel === PLAYLIST.title),
      false,
      'ohne Marke ist die Nummer die Album-Nummer — der Sprung ginge ins falsche Kapitel',
    )

    // GEGENPROBE, damit dieser Test nicht nur deshalb ruhig ist, weil der
    // Eintrag aus einem anderen Grund durchfaellt: mit Marke steht er drin.
    roh[roh.length - 1].resumeVersatzGeprueft = true
    roh[roh.length - 1].resumespotifytrack_number = 47
    writeFileSync(datei, JSON.stringify(roh, null, 4))
    const m = await request(app).get('/api/weiterhoeren').expect(200)
    const z = m.body.weiter.find((e: { titel: string }) => e.titel === PLAYLIST.title)
    assert.ok(z, 'mit Marke muss dieselbe Stelle in der Reihe stehen')
    assert.equal(z.titelNr, 47)

    // Und wieder heraus, damit die folgenden Tests dieselbe Lage vorfinden.
    writeFileSync(datei, JSON.stringify(roh.slice(0, -1), null, 4))
  })

  it('schreibt eine Form, die auch die KLASSISCHE Oberflaeche lesen kann', async () => {
    // resume.json ist eine gemeinsame Ablage. Wer hier eigene Feldnamen
    // erfindet, laesst das schwebende Fenster der alten Oberflaeche ins Leere
    // greifen — und niemand sucht dort, wo nichts geaendert wurde.
    const roh = JSON.parse(readFileSync(join(process.env.MUPIBOX_CONFIG_DIR as string, 'resume.json'), 'utf8'))
    const s = roh.find((e: { title: string }) => e.title === SPOTIFY.title)
    assert.equal(s.category, 'resume')
    assert.equal(s.type, 'spotify')
    assert.equal(s.resumespotifytrack_number, 4)
    assert.equal(s.resumespotifyprogress_ms, 92_500)
    assert.equal(s.resumespotifyduration_ms, 600_000)
    const l = roh.find((e: { title: string }) => e.title === LOKAL.title)
    assert.equal(l.resumelocalprogressTime, 25)
    assert.equal(l.resumelocalcurrentTracknr, 2)
    // Die urspruengliche Kategorie muss erhalten bleiben — der klassische
    // Player findet das Album sonst nicht wieder.
    assert.equal(l.resumelocalalbum, 'audiobook')
  })

  it('ersetzt dieselbe Stelle, statt sie ein zweites Mal anzulegen', async () => {
    await request(app)
      .post('/api/weiterhoeren')
      .send({ schluessel: medienSchluessel(SPOTIFY), titelNr: 6, bisher: 10, dauer: 600 })
      .expect(200)
    const roh = JSON.parse(readFileSync(join(process.env.MUPIBOX_CONFIG_DIR as string, 'resume.json'), 'utf8'))
    assert.equal(roh.filter((e: { title: string }) => e.title === SPOTIFY.title).length, 1)
  })

  it('merkt gar nichts, wenn die Verwaltung „Anzahl 0" eingestellt hat', async () => {
    // Das Feld laesst 0 ausdruecklich zu (konfiguration.ts, min 0). Ein
    // Schalter, an dem ein NEUER Weg vorbeigeht, ist schlimmer als keiner —
    // niemand sucht den Fehler dort, wo nichts geaendert wurde.
    writeFileSync(konfig, JSON.stringify({ mupibox: { resume: 0 } }))
    const vorher = readFileSync(join(process.env.MUPIBOX_CONFIG_DIR as string, 'resume.json'), 'utf8')
    const r = await request(app)
      .post('/api/weiterhoeren')
      .send({ schluessel: medienSchluessel(LOKAL), titelNr: 9, bisher: 60, dauer: 120 })
      .expect(200)
    assert.equal(r.body.status, 'ausgeschaltet')
    assert.equal(readFileSync(join(process.env.MUPIBOX_CONFIG_DIR as string, 'resume.json'), 'utf8'), vorher)
    writeFileSync(konfig, JSON.stringify({ mupibox: { resume: 9 } }))
  })
})
