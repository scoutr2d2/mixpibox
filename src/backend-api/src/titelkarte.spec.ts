import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  lokaleKarteAus,
  spurNamePasst,
  spurNummerAus,
  spurVollstaendig,
  titelMischen,
  titelQuellenStempeln,
} from './titelkarte'

describe('spurNummerAus: die NN-Praefixe der Aufnahme', () => {
  it('liest die Nummer aus echten Spurnamen', () => {
    // So legt mixpi-mitschnitt ab (`spurname`): zweistellig, Leerzeichen, Titel.
    assert.equal(spurNummerAus('01 Guten Morgen _ Good Morning (Englisch).flac'), 1)
    assert.equal(spurNummerAus('17 Nicht alleine.mp3'), 17)
    // Dreistellig fuer lange Sendungen.
    assert.equal(spurNummerAus('117 Folge.m4a'), 117)
    // Gross geschriebene Endung ist dieselbe Datei.
    assert.equal(spurNummerAus('02 x.FLAC'), 2)
  })

  it('haelt alles heraus, was keine Spur ist', () => {
    assert.equal(spurNummerAus('playlist.m3u'), null)
    assert.equal(spurNummerAus('cover.jpg'), null)
    // Einstellige Praefixe schreibt die Aufnahme nicht — „3 Fragezeichen.mp3"
    // waere ein Titel, der mit einer Zahl BEGINNT, keine Zaehlung.
    assert.equal(spurNummerAus('3 Fragezeichen.mp3'), null)
    // Nummer 00 gibt es in keiner 1-basierten Zaehlung.
    assert.equal(spurNummerAus('00 kaputt.flac'), null)
    assert.equal(spurNummerAus(''), null)
    assert.equal(spurNummerAus(null), null)
  })
})

describe('lokaleKarteAus: das Verzeichnis als Zeuge', () => {
  it('baut die Karte und laesst Fremddateien liegen', () => {
    const karte = lokaleKarteAus(['02 B.flac', '01 A.flac', 'playlist.m3u', 'cover.jpg'])
    assert.equal(karte.size, 2)
    assert.equal(karte.get(1), '01 A.flac')
    assert.equal(karte.get(2), '02 B.flac')
  })

  it('bei doppelter Nummer gewinnt der erste in sortierter Ordnung', () => {
    // Ein zweiter Mitschnitt derselben Spur darf die Karte nicht kippen —
    // und zwar unabhaengig von der readdir-Reihenfolge.
    const karte = lokaleKarteAus(['01 B neu.flac', '01 A.flac'])
    assert.equal(karte.get(1), '01 A.flac')
  })
})

describe('spurNamePasst: die Gegenprobe gegen fremde Zaehlungen', () => {
  it('DER MESSFALL: die Sanitisierung der Aufnahme ist kein Unterschied', () => {
    // Die Aufnahme ersetzt `/` durch `_` im Dateinamen; die Liste fuehrt den
    // Schraegstrich. Beides ist derselbe Titel.
    assert.equal(
      spurNamePasst('01 Guten Morgen _ Good Morning (Englisch).flac', 'Guten Morgen / Good Morning (Englisch)'),
      true,
    )
  })

  it('ein ganz anderer Name bei gleicher Nummer wird NICHT zugeordnet', () => {
    // Andere Ausgabe, Bonustitel: Nummer 7 der Jellyfin-Liste ist nicht
    // Nummer 7 der Aufnahme-Zaehlung. Dann spielt die Liste, nicht die Datei.
    assert.equal(spurNamePasst('07 Intro.flac', 'Outro'), false)
  })

  it('Enthaltensein genuegt, und Unpruefbares entscheidet die Nummer', () => {
    // Listen haengen gern Zusaetze an („… (Remastered)").
    assert.equal(spurNamePasst('03 Nah.flac', 'Nah (Remastered)'), true)
    // Nur-Zeichen-Namen haben keinen Kern — dann zaehlt die Nummer allein.
    assert.equal(spurNamePasst('05 ???.mp3', 'Titel fuenf'), true)
  })
})

describe('titelMischen: je Titel die beste Quelle', () => {
  const BASIS = '/home/dietpi/MuPiBox/media/music/Alin Coen/Nah'
  const REIHE = ['lokal', 'jellyfin', 'spotify']
  const LISTE = [
    { nr: 1, titel: 'Wer bist du', interpret: 'Alin Coen', befehl: 'jellyfin/adr1/x', anhaengen: 'jfqueue/adr1/x' },
    { nr: 2, titel: 'Nah', interpret: 'Alin Coen', befehl: 'jellyfin/adr2/x', anhaengen: 'jfqueue/adr2/x' },
    { nr: 3, titel: 'Ohne Strom', interpret: 'Alin Coen' },
  ]

  it('lokal gewinnt, wo die Spur liegt — der Rest bleibt beim Dienst', () => {
    const karte = lokaleKarteAus(['01 Wer bist du.flac', '03 Ohne Strom.flac'])
    const raus = titelMischen(LISTE, karte, { basisPfad: BASIS, reihenfolge: REIHE, eigenerDienst: 'jellyfin' })
    assert.equal(raus[0].quelle, 'lokal')
    assert.deepEqual(raus[0].quellen, ['lokal', 'jellyfin'])
    assert.equal(
      raus[0].befehl,
      `datei/${encodeURIComponent(`${BASIS}/01 Wer bist du.flac`)}/${encodeURIComponent('Wer bist du')}:title:artist:${encodeURIComponent('Alin Coen')}`,
    )
    assert.equal(String(raus[0].anhaengen).startsWith('dateiqueue/'), true)
    // Titel 2: keine Spur -> Jellyfin unveraendert.
    assert.equal(raus[1].quelle, 'jellyfin')
    assert.deepEqual(raus[1].quellen, ['jellyfin'])
    assert.equal(raus[1].befehl, 'jellyfin/adr2/x')
    // Titel 3: KEIN eigener Befehl (Jellyfin ohne Stromadresse), aber die
    // Spur liegt da — lokal bedient ihn.
    assert.equal(raus[2].quelle, 'lokal')
    assert.deepEqual(raus[2].quellen, ['lokal'])
    assert.equal(String(raus[2].befehl).startsWith('datei/'), true)
  })

  it('die eingestellte Reihenfolge entscheidet — jellyfin zuerst heisst jellyfin', () => {
    const karte = lokaleKarteAus(['01 Wer bist du.flac'])
    const raus = titelMischen(LISTE, karte, {
      basisPfad: BASIS,
      reihenfolge: ['jellyfin', 'lokal'],
      eigenerDienst: 'jellyfin',
    })
    assert.equal(raus[0].quelle, 'jellyfin')
    assert.equal(raus[0].befehl, 'jellyfin/adr1/x')
    // Die Wahrheit ueber das Vorhandensein bleibt trotzdem stehen.
    assert.deepEqual(raus[0].quellen, ['lokal', 'jellyfin'])
  })

  it('ein Dienst ausserhalb der Reihenfolge reiht sich hinten ein', () => {
    // Die Einstellung kennt nur 'lokal' — ein Titel, den nur Jellyfin hat,
    // spielt trotzdem ueber Jellyfin, statt stumm zu bleiben.
    const raus = titelMischen(LISTE, new Map(), { basisPfad: BASIS, reihenfolge: ['lokal'], eigenerDienst: 'jellyfin' })
    assert.equal(raus[1].quelle, 'jellyfin')
  })

  it('die Namens-Gegenprobe verhindert die falsche Datei', () => {
    const karte = lokaleKarteAus(['02 Etwas voellig anderes.flac'])
    const raus = titelMischen(LISTE, karte, { basisPfad: BASIS, reihenfolge: REIHE, eigenerDienst: 'jellyfin' })
    // Nummer 2 liegt da, heisst aber anders -> Jellyfin spielt.
    assert.equal(raus[1].quelle, 'jellyfin')
    assert.deepEqual(raus[1].quellen, ['jellyfin'])
  })

  it('ohne jede Quelle bleibt der Titel ein Eintrag ohne Abspielweg', () => {
    const raus = titelMischen(LISTE, new Map(), { basisPfad: BASIS, reihenfolge: REIHE, eigenerDienst: 'jellyfin' })
    assert.equal(raus[2].quelle, undefined)
    assert.deepEqual(raus[2].quellen, [])
    assert.equal(raus[2].befehl, undefined)
  })
})

describe('titelQuellenStempeln: Herkunft ohne Mischen', () => {
  it('stempelt den eigenen Dienst und setzt das lokale Haekchen nur als Auskunft', () => {
    const liste = [
      { nr: 1, titel: 'Wer bist du', uri: 'spotify:track:x' },
      { nr: 2, titel: 'Nah', uri: 'spotify:track:y' },
    ]
    const karte = lokaleKarteAus(['01 Wer bist du.flac'])
    const raus = titelQuellenStempeln(liste, karte, 'spotify')
    // Titel 1 liegt lokal -> Haekchen, aber der Weg bleibt Spotify (kein Befehl).
    assert.deepEqual(raus[0].quellen, ['lokal', 'spotify'])
    assert.equal(raus[0].quelle, 'spotify')
    assert.equal(raus[0].befehl, undefined)
    assert.deepEqual(raus[1].quellen, ['spotify'])
    // Der lokal-Fall ist trivial ganz lokal.
    const lokal = titelQuellenStempeln(liste, new Map(), 'lokal')
    assert.equal(lokal[0].quelle, 'lokal')
    assert.deepEqual(lokal[0].quellen, ['lokal'])
  })
})

describe('spurVollstaendig: der Titel ist das kleinste Teil - auch bei der Vollstaendigkeit', () => {
  it('liest das Urteil der Aufnahme aus dem Dateinamen', () => {
    // Betreiber 31.08.2026: „wenn titel komplett dann ist er abspiel bereit."
    // Die Aufnahme haengt unter 97 % den Zusatz an (unvollstaendigZusatz).
    assert.equal(spurVollstaendig('01 Guten Morgen.flac'), true)
    assert.equal(spurVollstaendig('03 Ferien (unvollstaendig 87%).flac'), false)
    assert.equal(spurVollstaendig('12 Lied (unvollstaendig 5%).mp3'), false)
    // Ein Titel, der zufaellig so heisst, ist keine Abbruchmeldung.
    assert.equal(spurVollstaendig('04 Unvollstaendige Liebe.flac'), true)
    assert.equal(spurVollstaendig(''), true)
  })

  it('ein abgebrochener Titel spielt NICHT, solange eine andere Quelle ihn ganz hat', () => {
    const liste = [{ nr: 1, titel: 'Wer bist du', interpret: 'X', befehl: 'jellyfin/a/x', anhaengen: 'jfqueue/a/x' }]
    const halb = lokaleKarteAus(['01 Wer bist du (unvollstaendig 62%).flac'])
    const raus = titelMischen(liste, halb, {
      basisPfad: '/media/X/A',
      reihenfolge: ['lokal', 'jellyfin'],
      eigenerDienst: 'jellyfin',
    })
    assert.equal(raus[0].quelle, 'jellyfin')
    assert.deepEqual(raus[0].quellen, ['jellyfin'])
    // Und die Herkunfts-Auskunft luegt auch nicht: kein lokales Haekchen.
    const gestempelt = titelQuellenStempeln(liste, halb, 'spotify')
    assert.deepEqual(gestempelt[0].quellen, ['spotify'])
  })
})

describe('titelMischen: ein Spotify-Titel traegt uri statt befehl (E108 Stufe 3)', () => {
  // AM GERAET GEMESSEN (04.09.2026, „101 Meerjungfrauen"): Spotify-Titel
  // fuehren `uri: spotify:track:…` und NIE einen `befehl` — Spotify wird bis
  // heute als ganzes Album gestartet. Wer titelMischen fuer Spotify aufrief,
  // bekam deshalb fuer JEDEN Titel `quellen: []`, auch fuer die, die lokal
  // vorliegen. Das Mischen war dort nicht abgeschaltet, es lieferte Unsinn.
  const BASIS = '/home/dietpi/MuPiBox/media/audiobook/Ruby/101 Meerjungfrauen'
  const REIHE = ['lokal', 'jellyfin', 'spotify']
  const LISTE = [
    { nr: 1, titel: 'Kapitel 1', interpret: 'Ruby', uri: 'spotify:track:aaa' },
    { nr: 2, titel: 'Kapitel 2', interpret: 'Ruby', uri: 'spotify:track:bbb' },
    { nr: 3, titel: 'Kapitel 3', interpret: 'Ruby', uri: 'spotify:track:ccc' },
  ]

  it('erkennt Spotify als Quelle — sonst faende der Mitschnitt nie einen Partner', () => {
    const karte = lokaleKarteAus(['01 Kapitel 1.flac', '02 Kapitel 2.flac'])
    const raus = titelMischen(LISTE, karte, { basisPfad: BASIS, reihenfolge: REIHE, eigenerDienst: 'spotify' })
    // Die beiden mitgeschnittenen Kapitel: lokal gewinnt, MIT spielbarem Befehl.
    assert.deepEqual(raus[0].quellen, ['lokal', 'spotify'])
    assert.equal(raus[0].quelle, 'lokal')
    assert.equal(String(raus[0].befehl).startsWith('datei/'), true)
    assert.deepEqual(raus[1].quellen, ['lokal', 'spotify'])
    // Und das noch nicht aufgenommene bleibt bei Spotify — NICHT leer.
    assert.deepEqual(raus[2].quellen, ['spotify'])
    assert.equal(raus[2].quelle, 'spotify')
  })

  it('OHNE die uri-Erkennung waere die Liste leer — der Beweis der alten Lage', () => {
    // Ein Titel ganz ohne Handhabe (weder befehl noch uri) und ohne lokale
    // Spur hat wirklich keine Quelle. Das ist der Fall, den `spielVersuch`
    // aussortiert — und der zeigt, dass die Regel nicht einfach alles
    // durchwinkt.
    const raus = titelMischen([{ nr: 9, titel: 'Nichts', interpret: 'Ruby' }], lokaleKarteAus([]), {
      basisPfad: BASIS,
      reihenfolge: REIHE,
      eigenerDienst: 'spotify',
    })
    assert.deepEqual(raus[0].quellen, [])
  })
})
