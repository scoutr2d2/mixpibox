import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AUSWAHL_LEER,
  AUSWAHL_MAX,
  auswahlFiltern,
  auswahlNormalisieren,
  auswahlStand,
  hatAuswahl,
} from './auswahl'
import { type Eintrag, medienSchluessel } from './medien'
import { ABLAGE_AUSWAHL, BEREICH_ABLAGEN } from './profile'

/**
 * DIE EINTRAEGE SIND DIE DER BOX .169, am 07.08.2026 lesend abgeholt.
 *
 * Keine erfundenen: An erfundenen Daten laesst sich nicht zeigen, dass ein
 * Schluessel einen Medienlauf ueberlebt. „External Playback" steht ausdruecklich
 * dabei — das ist der EINE Eintrag von 28, der keine Dienstkennung traegt und
 * deshalb einen Ersatzschluessel aus Interpret und Titel bekommt.
 */
const HELLO_KITTY: Eintrag = {
  type: 'spotify',
  category: 'audiobook',
  title: 'Hello Kitty - Alle Hörspiele',
  artist: 'EUROPA Hörspiele & Kinderlieder',
  playlistid: '1DYDHYJ98WZbHa2OZ4Dljg',
}
const HAMM_JELLYFIN: Eintrag = {
  type: 'jellyfin-album',
  category: 'music',
  id: '7d9a37e2732ca78bc68eacb3232960c0',
  artist: 'Kapelle Petra',
  title: 'HAMM',
}
const HAMM_SPOTIFY: Eintrag = {
  type: 'spotify',
  category: 'music',
  title: 'HAMM',
  artist: 'Kapelle Petra',
  id: '0l0nQidfDmC4SiTdrpHr4v',
}
const EXTERN: Eintrag = { type: 'spotify', category: 'music', title: 'External Playback', artist: 'Unknown' }
const BOX = [HELLO_KITTY, HAMM_JELLYFIN, HAMM_SPOTIFY, EXTERN]

describe('worauf eine Auswahl steht', () => {
  it('auf dem Schluessel des Dienstes, nicht auf dem Titel', () => {
    assert.equal(medienSchluessel(HELLO_KITTY), 'spotify:1DYDHYJ98WZbHa2OZ4Dljg')
    // DER PUNKT DES GANZEN: Der Titel wird korrigiert (am 04.08. stand in
    // data.json wirklich eine Adresse daran geklebt), die Auswahl bleibt.
    const umbenannt = { ...HELLO_KITTY, title: 'Hello Kitty — alle Folgen', artist: 'EUROPA' }
    assert.equal(medienSchluessel(umbenannt), medienSchluessel(HELLO_KITTY))
    assert.deepEqual(auswahlFiltern([umbenannt], { werke: ['spotify:1DYDHYJ98WZbHa2OZ4Dljg'] }), [umbenannt])
  })

  it('haelt dasselbe Album aus zwei Diensten auseinander', () => {
    // Verschmelzen ist eine ANDERE Frage und passiert NACH dem Filtern. Wer
    // nur die Jellyfin-Fassung freigibt, gibt nicht die Spotify-Fassung frei.
    assert.notEqual(medienSchluessel(HAMM_JELLYFIN), medienSchluessel(HAMM_SPOTIFY))
    const nur = auswahlFiltern(BOX, { werke: [medienSchluessel(HAMM_JELLYFIN)] })
    assert.deepEqual(nur, [HAMM_JELLYFIN])
  })

  it('gibt dem Eintrag ohne Dienstkennung einen Ersatzschluessel', () => {
    // Der EINE von 28. Er steht auf Interpret und Titel und ist damit die
    // einzige Zeile, deren Auswahl ein Umbenennen nicht ueberlebt — bekannt,
    // begruendet und in auswahl.ts aufgeschrieben.
    assert.equal(medienSchluessel(EXTERN), 'spotify:t:unknown|external playback')
  })
})

describe('auswahlNormalisieren', () => {
  it('nimmt beide Formen an — die blanke Liste und den Stand', () => {
    assert.deepEqual(auswahlNormalisieren(['a', 'b']).werke, ['a', 'b'])
    assert.deepEqual(auswahlNormalisieren({ werke: ['a', 'b'] }).werke, ['a', 'b'])
  })

  it('macht aus Unsinn eine LEERE Auswahl und nicht einen Fehler', () => {
    for (const roh of [null, undefined, 0, 'x', { werke: 'x' }, { werke: { a: 1 } }]) {
      assert.deepEqual(auswahlNormalisieren(roh).werke, [], String(roh))
    }
  })

  it('wirft nur die kaputten Zeilen weg, nicht die ganze Datei', () => {
    const a = auswahlNormalisieren(['spotify:a', 42, null, { x: 1 }, '', '   ', 'spotify:b'])
    assert.deepEqual(a.werke, ['spotify:a', 'spotify:b'])
  })

  it('entfernt Doppelte und behaelt die Reihenfolge', () => {
    assert.deepEqual(auswahlNormalisieren(['b', 'a', 'b', ' a ']).werke, ['b', 'a'])
  })

  it('deckelt die Laenge, statt eine zu lange Eingabe abzulehnen', () => {
    const viele = Array.from({ length: AUSWAHL_MAX + 50 }, (_, i) => `spotify:${i}`)
    assert.equal(auswahlNormalisieren(viele).werke.length, AUSWAHL_MAX)
  })

  it('wirft masslos lange Schluessel weg', () => {
    assert.deepEqual(auswahlNormalisieren(['x'.repeat(5000), 'spotify:a']).werke, ['spotify:a'])
  })
})

describe('leer heisst ALLES — die Regel, die nichts verschwinden laesst', () => {
  it('ohne Auswahl bleibt die Liste unveraendert', () => {
    assert.equal(hatAuswahl(AUSWAHL_LEER), false)
    // DASSELBE OBJEKT, nicht einmal eine Kopie: Das ist der Normalfall jeder
    // heute laufenden Box, und er soll nicht einmal einen Durchlauf kosten.
    assert.equal(auswahlFiltern(BOX, AUSWAHL_LEER), BOX)
    assert.equal(auswahlFiltern(BOX, null), BOX)
    assert.equal(auswahlFiltern(BOX, undefined), BOX)
    assert.equal(auswahlFiltern(BOX, { werke: [] }), BOX)
  })

  it('eine Box ohne jede Auswahl zeigt nach dem Umbau genau dasselbe', () => {
    // Die Forderung „NICHTS VERSCHWINDET STILL", als Aussage.
    const vorher = BOX.map(medienSchluessel)
    const nachher = auswahlFiltern(BOX, auswahlNormalisieren(null)).map(medienSchluessel)
    assert.deepEqual(nachher, vorher)
  })

  it('erst eine gefuellte Auswahl filtert', () => {
    const a = auswahlNormalisieren(['spotify:1DYDHYJ98WZbHa2OZ4Dljg'])
    assert.equal(hatAuswahl(a), true)
    assert.deepEqual(auswahlFiltern(BOX, a), [HELLO_KITTY])
  })

  it('ein Schluessel ohne Medium filtert nichts heraus, was da ist', () => {
    // Das ist der Fall „Medium geloescht" UND der Fall „Box offline, kurze
    // Liste". In beiden bleibt der Rest sichtbar.
    const a = auswahlNormalisieren(['spotify:1DYDHYJ98WZbHa2OZ4Dljg', 'spotify:gibtesnicht'])
    assert.deepEqual(auswahlFiltern(BOX, a), [HELLO_KITTY])
  })
})

describe('auswahlStand — damit ein leeres Regal sagen kann, warum', () => {
  it('unterscheidet „nichts gewaehlt" von „nichts davon da"', () => {
    assert.deepEqual(auswahlStand(BOX, AUSWAHL_LEER), { gewaehlt: 0, vorrat: 4, sichtbar: 4 })
    assert.deepEqual(auswahlStand(BOX, { werke: ['spotify:weg'] }), { gewaehlt: 1, vorrat: 4, sichtbar: 0 })
    assert.deepEqual(auswahlStand([], AUSWAHL_LEER), { gewaehlt: 0, vorrat: 0, sichtbar: 0 })
  })

  it('zaehlt den Normalfall richtig', () => {
    const a = { werke: [medienSchluessel(HAMM_SPOTIFY), medienSchluessel(HELLO_KITTY)] }
    assert.deepEqual(auswahlStand(BOX, a), { gewaehlt: 2, vorrat: 4, sichtbar: 2 })
  })
})

describe('die Auswahl gehoert dem Profil', () => {
  it('steht in BEREICH_ABLAGEN — nicht danebengestellt', () => {
    // WOGEGEN DIESE ZEILE STEHT: An `BEREICH_ABLAGEN` haengen der Umzug beim
    // Start, das Anlegen des Bereichs, das Beiseitelegen beim Loeschen und die
    // Deckung der Sicherung. Eine Ablage daneben ist die naechste Erbschaft —
    // in der Nacht zum 07.08.2026 dreimal aufgelaufen.
    assert.ok((BEREICH_ABLAGEN as readonly string[]).includes(ABLAGE_AUSWAHL))
    assert.equal(ABLAGE_AUSWAHL, 'auswahl.json')
  })
})
