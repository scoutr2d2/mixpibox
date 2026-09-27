/**
 * Zeugen fuer laufendes-werk.ts — die Server-Antwort auf „was laeuft gerade?".
 *
 * WAS HIER SCHARF IST: die ABLEHNUNGEN. Eine Auskunft zu viel markiert die
 * falsche Kachel, und genau davor steht die Hausregel „lieber keine Marke als
 * eine an der falschen" (app.js, GEMERKT-Speicher; E112-Commit). Deshalb
 * pruefen mehrere Faelle ausdruecklich auf null.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  type GemerkterStart,
  laufendeAuskunft,
  titelZumMerken,
} from './laufendes-werk.js'

const ALBUM: GemerkterStart = {
  werk: 'lokal:t:pruefung|ein lokales album',
  quelle: 'lokal',
  maschine: 'mpv',
  titel: [
    { nr: 1, id: '/medien/music/Pruefung/Album#1', uri: '', name: 'Erster Titel', quelle: 'lokal' },
    { nr: 2, id: '/medien/music/Pruefung/Album#2', uri: '', name: 'Zweiter Titel', quelle: 'lokal' },
    { nr: 3, id: '/medien/music/Pruefung/Album#3', uri: '', name: 'Dritter: Titel', quelle: 'jellyfin' },
  ],
}

describe('laufendeAuskunft', () => {
  it('nennt Werk UND Titel, wenn Nummer und Name zur gemerkten Liste passen', () => {
    const a = laufendeAuskunft(ALBUM, {
      currentPlayer: 'mpv',
      currentTracknr: 2,
      currentTrackname: 'Zweiter Titel',
    })
    assert.ok(a)
    assert.equal(a.werk, ALBUM.werk)
    assert.equal(a.titelNr, 2)
    assert.equal(a.titelId, '/medien/music/Pruefung/Album#2')
    assert.equal(a.titelName, 'Zweiter Titel')
  })

  it('vergleicht Namen als Kern — Satzzeichen und Schreibung trennen nicht', () => {
    // mpv meldet den Befehls-Namen, der Doppelpunkt wurde beim Befehl-Bauen
    // ersetzt (cleanTrackTitle-Familie). Der Kern macht beide gleich.
    const a = laufendeAuskunft(ALBUM, {
      currentPlayer: 'mpv',
      currentTracknr: 3,
      currentTrackname: 'dritter  titel',
    })
    assert.ok(a)
    assert.equal(a.titelNr, 3)
    // Die Quelle des TITELS reist mit — in der Mischliste wechselt die
    // Plakette am Player-Cover mit dem Titel (laufendeQuelle, app.js).
    assert.equal(a.titelQuelle, 'jellyfin')
  })

  it('gibt NULL, wenn der gemeldete Name der gemerkten Liste widerspricht', () => {
    // Jemand hat direkt am Abspieldienst (Port 5005) etwas anderes gestartet:
    // Nummer 2 existiert, aber dort laeuft ein fremdes Stueck.
    const a = laufendeAuskunft(ALBUM, {
      currentPlayer: 'mpv',
      currentTracknr: 2,
      currentTrackname: 'Ein voellig anderes Hoerspiel',
    })
    assert.equal(a, null)
  })

  it('nennt nur das Werk, solange die Nummer noch fehlt (Startaugenblick)', () => {
    const a = laufendeAuskunft(ALBUM, {
      currentPlayer: 'mpv',
      currentTracknr: '',
      currentTrackname: '',
    })
    assert.ok(a)
    assert.equal(a.titelNr, null)
    assert.equal(a.titelId, '')
  })

  it('nennt nur das Werk, wenn die Nummer aus der Liste faellt', () => {
    const a = laufendeAuskunft(ALBUM, {
      currentPlayer: 'mpv',
      currentTracknr: 7,
      currentTrackname: 'Erster Titel',
    })
    assert.ok(a)
    assert.equal(a.titelNr, null)
  })

  it('haelt das Werk bei der Uebergabe an Spotify (E108) — ohne Titel', () => {
    // Eine lokal beginnende Strecke wechselt mitten im Album die Maschine;
    // das WERK bleibt dasselbe, die Stueckadresse liefert /player/state.
    const a = laufendeAuskunft(ALBUM, { currentPlayer: 'spotify' })
    assert.ok(a)
    assert.equal(a.werk, ALBUM.werk)
    assert.equal(a.titelNr, null)
  })

  it('gibt NULL, wenn mpv spielt, aber die MASCHINE Spotify gemerkt ist', () => {
    // Diese Richtung gibt es vom Server aus nicht — dann hat jemand anders
    // gestartet, und dessen Werk kennt dieses Gedaechtnis nicht.
    const a = laufendeAuskunft(
      { werk: 'spotify:4aBcDeF', quelle: 'spotify', maschine: 'spotify', titel: [] },
      { currentPlayer: 'mpv', currentTracknr: 1, currentTrackname: 'Irgendwas' },
    )
    assert.equal(a, null)
  })

  it('E108-Mischweg: Quelle spotify, Maschine mpv — der Titel wird trotzdem genannt', () => {
    // AM GERAET GEFUNDEN (12.09.2026, "Mission Erde" nach der Dubletten-
    // Bereinigung): das verschmolzene Werk startet ueber die Quelle
    // `spotify`, die Strecke spielt aber lokal ueber mpv. Ein Urteil, das
    // an der QUELLE verwirft, verwarf genau den Start, den es benennen
    // sollte — die Kachel blieb ohne Rahmen. Verglichen wird die MASCHINE.
    const a = laufendeAuskunft(
      {
        werk: 'spotify:38EnlK9R5vIKyMnIXZ8Ipy',
        quelle: 'spotify',
        maschine: 'mpv',
        titel: [{ nr: 1, id: '/medien/music/Team Karacho/Mission Erde#1', uri: '', name: 'Titelsong', quelle: 'lokal' }],
      },
      { currentPlayer: 'mpv', currentTracknr: 1, currentTrackname: 'Titelsong' },
    )
    assert.ok(a)
    assert.equal(a.titelNr, 1)
    assert.equal(a.titelId, '/medien/music/Team Karacho/Mission Erde#1')
  })

  it('traegt beim Ein-Befehl-Start (leere Liste) nur das Werk', () => {
    const a = laufendeAuskunft(
      { werk: 'radio:https://stream.example/1', quelle: 'radio', maschine: 'mpv', titel: [] },
      { currentPlayer: 'mplayer', currentTracknr: 1, currentTrackname: 'Ein Sender' },
    )
    assert.ok(a)
    assert.equal(a.werk, 'radio:https://stream.example/1')
    assert.equal(a.titelNr, null)
  })

  it('gibt NULL ohne gemerkten Start — raten ist keine Auskunft', () => {
    assert.equal(laufendeAuskunft(null, { currentPlayer: 'mpv' }), null)
    assert.equal(laufendeAuskunft(undefined, { currentPlayer: 'mpv' }), null)
  })

  it('gibt NULL ohne Meldung des Abspieldiensts', () => {
    assert.equal(laufendeAuskunft(ALBUM, null), null)
  })
})

describe('titelZumMerken', () => {
  it('zieht nr, id, uri, Namen und Quelle aus einer /inhalt-Titelliste', () => {
    const t = titelZumMerken([
      { nr: 1, titel: 'Erster', id: 'a#1', befehl: 'datei/x', quelle: 'lokal' },
      { nr: 2, titel: 'Zweiter', uri: 'spotify:track:xyz' },
    ])
    assert.deepEqual(t, [
      { nr: 1, id: 'a#1', uri: '', name: 'Erster', quelle: 'lokal' },
      { nr: 2, id: '', uri: 'spotify:track:xyz', name: 'Zweiter', quelle: '' },
    ])
  })

  it('zaehlt fehlende Nummern selbst — dieselbe Ordnung wie die Schlange', () => {
    const t = titelZumMerken([{ titel: 'A' }, { titel: 'B' }])
    assert.deepEqual(
      t.map((x) => x.nr),
      [1, 2],
    )
  })

  it('macht aus Nicht-Listen eine leere Liste', () => {
    assert.deepEqual(titelZumMerken(null), [])
    assert.deepEqual(titelZumMerken('quatsch'), [])
  })
})
