/**
 * Was hier geprueft wird, sind nicht Feinheiten — es sind die Auflagen.
 *
 * E28 verlangt, dass der Mitschnitt niemandem PASSIERT. Ein Test, der nur
 * beweist, dass Aufnehmen funktioniert, wenn man es einschaltet, prueft die
 * unwichtige Haelfte. Die wichtige ist: er bleibt aus, solange ihn niemand
 * ausdruecklich und zweifach eingeschaltet hat — auch nach einer
 * Neuinstallation, auch fuer Dienste, die es heute noch nicht gibt.
 *
 * Lauf:  node --test plugins/mixpi-mitschnitt/index.spec.mjs
 */
import { deepStrictEqual, match, ok, strictEqual } from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { listeSchreiben, mitListe } from './ablage.mjs'
import mitschnitt, {
  annahmeUrteil,
  mitschnittBefund,
  DIENSTE,
  albumOrdner,
  m3uInhalt,
  neueBehalten,
  spurname,
  dateiname,
  erlaubt,
  festschreibenAnfrage,
  istNeuerTitel,
  kanonischesAus,
  knacksSchnitt,
  kennungAnfragen,
  knotenSuchen,
  pegelFenster,
  quelleAnfrage,
  rohOrtWaehlen,
  saeubern,
  MASCHINEN_KNOTEN,
  schnittstelle,
  spotifyQuellSchluessel,
  spurpfade,
  unvollstaendigZusatz,
  mitKanonischem,
  urteil,
  verschmelzungFestschreiben,
  vollstaendigkeit,
  versatzAusGroesse,
  titelAus,
} from './index.mjs'
import { LISTE_LEER, abschliessen, beginnen, scheitern, vormerken } from './liste.mjs'

describe('erlaubt — die Wache', () => {
  it('der Auslieferungszustand schneidet nicht mit', () => {
    // Weder Einstellungen noch Datei: genau so kommt eine frische Box an.
    strictEqual(erlaubt({}, 'spotify').ja, false)
    strictEqual(erlaubt(undefined, 'spotify').ja, false)
    strictEqual(erlaubt(null, 'spotify').ja, false)
  })

  it('EIN Haken genuegt nicht — beide muessen stehen', () => {
    strictEqual(erlaubt({ spotify: true }, 'spotify').ja, false, 'Dienst an, Rechtslage nicht bestaetigt')
    strictEqual(erlaubt({ verstanden: true }, 'spotify').ja, false, 'bestaetigt, aber Dienst aus')
    strictEqual(erlaubt({ verstanden: true, spotify: true }, 'spotify').ja, true)
  })

  it('nennt den Grund, und zuerst die Rechtslage', () => {
    // Wer den Dienstschalter umlegt, ohne zu bestaetigen, soll GENAU das
    // lesen — nicht "spotify ist nicht eingeschaltet", obwohl es das ist.
    const u = erlaubt({ spotify: true }, 'spotify')
    ok(u.grund.includes('Rechtslage'), `Grund war: ${u.grund}`)
  })

  it('ein Dienst, den es noch nicht gibt, ist AUS — auch mit beiden Haken', () => {
    // DAS ist die Auflage "fuer jeden neu hinzukommenden Dienst". Sie haelt
    // nur, weil DIENSTE eine Erlaubnisliste ist. Wer sie zur Sperrliste
    // umbaut, bringt diesen Test zu Fall — und das ist der Zweck.
    strictEqual(erlaubt({ verstanden: true, deezer: true }, 'deezer').ja, false)
    strictEqual(erlaubt({ verstanden: true, amazon: true }, 'amazon').ja, false)
  })

  it('ohne erkannten Dienst wird nicht mitgeschnitten', () => {
    // So sieht es aus, wenn der Spieler nicht antwortet: dienst = ''.
    strictEqual(erlaubt({ verstanden: true, spotify: true }, '').ja, false)
  })

  it('die Erlaubnisliste enthaelt heute genau Spotify', () => {
    deepStrictEqual(DIENSTE, ['spotify'])
  })

  it('nur echtes true zaehlt, nicht was wahr AUSSIEHT', () => {
    // Aus einem JSON-Formular kommt schnell "true" oder 1. Bei einer
    // Funktion, die Konten kosten kann, ist "sieht wahr aus" zu wenig.
    strictEqual(erlaubt({ verstanden: 'true', spotify: 'true' }, 'spotify').ja, false)
    strictEqual(erlaubt({ verstanden: 1, spotify: 1 }, 'spotify').ja, false)
  })
})

describe('saeubern und dateiname', () => {
  it('wirft aus, was einen Pfad zerlegen wuerde', () => {
    strictEqual(saeubern('AC/DC'), 'AC_DC')
    strictEqual(saeubern('../../etc/passwd'), '.._.._etc_passwd')
    ok(!saeubern('a<b>c:d"e|f?g*h').match(/[<>:"|?*]/))
  })

  it('faellt nie auf einen leeren Namen zurueck', () => {
    strictEqual(saeubern(''), 'Unbekannt')
    strictEqual(saeubern(null), 'Unbekannt')
    strictEqual(saeubern('   '), 'Unbekannt')
  })

  it('der Zeitstempel steht vorn, damit der Ordner von selbst sortiert', () => {
    const n = dateiname('Lied', 'Band', '2026-08-16 20-45-03')
    ok(n.startsWith('2026-08-16 20-45-03 '), n)
    ok(n.endsWith('.flac'), n)
  })

  it('zwei Mitschnitte desselben Titels ueberschreiben einander nicht', () => {
    const a = dateiname('Lied', 'Band', '2026-08-16 20-45-03')
    const b = dateiname('Lied', 'Band', '2026-08-16 21-10-00')
    ok(a !== b)
  })
})

describe('knotenSuchen', () => {
  // Wortlaut aus `pw-cli ls Node` auf der Box, 16.08.2026.
  const echt = `	id 37, type PipeWire:Interface:Node/3
 		node.name = "entzerrer"
 		media.class = "Audio/Sink"
	id 76, type PipeWire:Interface:Node/3
 		node.name = "alsa_playback.librespot"
 		media.class = "Stream/Output/Audio"
	id 83, type PipeWire:Interface:Node/3
 		node.name = "bluez_output.00_9E_C8_61_1A_EA.1"`

  it('findet den librespot-Knoten mit seiner Nummer', () => {
    deepStrictEqual(knotenSuchen(echt, 'librespot'), { id: 76, name: 'alsa_playback.librespot' })
  })

  it('meldet nichts, wenn der Knoten fehlt — und das ist der Normalfall', () => {
    // Spielt Spotify nicht, ist der Knoten WEG. Am Geraet gesehen: null
    // Treffer, und ein pw-link darauf sagt "No such file or directory".
    const ohne = echt.split('\n').filter((z) => !z.includes('librespot')).join('\n')
    strictEqual(knotenSuchen(ohne, 'librespot'), null)
  })

  it('vertraegt Leerlauf statt zu werfen', () => {
    strictEqual(knotenSuchen('', 'librespot'), null)
    strictEqual(knotenSuchen(null, 'librespot'), null)
    strictEqual(knotenSuchen('voelliger Unsinn ohne id', 'librespot'), null)
  })
})

describe('versatzAusGroesse — wo in der Aufnahme sind wir?', () => {
  it('rechnet Bytes in Sekunden um, ohne den WAV-Kopf mitzuzaehlen', () => {
    // 48000 * 2 Kanaele * 2 Byte = 192000 Byte je Sekunde, plus 44 Byte Kopf.
    strictEqual(versatzAusGroesse(44), 0)
    strictEqual(versatzAusGroesse(192_000 + 44), 1)
    strictEqual(versatzAusGroesse(10 * 192_000 + 44), 10)
  })

  it('geht bei Unsinn nicht ins Negative', () => {
    // Eine gerade erst angelegte Datei ist kleiner als ihr Kopf.
    strictEqual(versatzAusGroesse(0), 0)
    strictEqual(versatzAusGroesse(20), 0)
    strictEqual(versatzAusGroesse(null), 0)
    strictEqual(versatzAusGroesse(undefined), 0)
  })
})

describe('istNeuerTitel — nur ein ANDERER Titel schneidet', () => {
  it('erkennt den Wechsel', () => {
    strictEqual(istNeuerTitel({ uri: 'spotify:track:a' }, { uri: 'spotify:track:b' }), true)
    strictEqual(istNeuerTitel(null, { uri: 'spotify:track:a' }), true, 'der erste Titel ist auch ein Wechsel')
  })

  it('Pause, Fortsetzen und Spulen sind KEIN Wechsel', () => {
    // Alle drei liefern denselben Titel mit anderer Position. Wer darauf
    // schneidet, zerlegt ein Lied in Bruchstuecke.
    const a = { uri: 'spotify:track:a', fortschrittMs: 1000 }
    const b = { uri: 'spotify:track:a', fortschrittMs: 90_000 }
    strictEqual(istNeuerTitel(a, b), false)
  })

  it('ohne Kennung wird nicht geschnitten', () => {
    // Antwortet der Spieler nicht, ist das kein Titelende — sonst schnitte
    // jede Netzhaenger-Sekunde ein neues Stueck.
    strictEqual(istNeuerTitel({ uri: 'spotify:track:a' }, {}), false)
    strictEqual(istNeuerTitel({ uri: 'spotify:track:a' }, null), false)
  })
})

describe('schnittstelle — der Takt merkt es zu spaet', () => {
  it('zieht ab, wie weit der neue Titel schon laeuft', () => {
    // Aufnahme steht bei 100 s, der neue Titel laeuft schon 2,5 s:
    // der Schnitt gehoert auf 97,5 s.
    strictEqual(schnittstelle(100, 2500), 97.5)
  })

  it('ohne Fortschritt bleibt der Versatz stehen', () => {
    strictEqual(schnittstelle(100, 0), 100)
    strictEqual(schnittstelle(100, null), 100)
  })

  it('geht nie hinter den Anfang der Aufnahme', () => {
    // Beim ersten Titel laeuft der Fortschritt weiter als die Aufnahme alt
    // ist — ein negativer Schnitt waere fuer ffmpeg ein Fehler.
    strictEqual(schnittstelle(3, 90_000), 0)
  })
})

describe('knacksSchnitt — dieselben Faelle wie im SpotifyRecorder', () => {
  // Diese Tests sind WOERTLICH die aus tests/declick_test.py des
  // Schwesterprojekts, nur in JS. Genau darin liegt ihr Wert: sie pruefen
  // nicht meine Uebersetzung gegen meine Vorstellung, sondern gegen das
  // Original, das an echtem Material eingestellt wurde.
  const S = 0.0 // Stille
  const K = 0.4 // Knackser
  const M = 0.3 // Musik
  const L = (...laeufe) => laeufe.flatMap(([wert, ms]) => Array(Math.floor(ms / 10)).fill(wert))

  it('Knackser -> Stille -> Musik: Schnitt vor der Musik', () => {
    // 440 ms bis zum Musikeinsatz, minus 20 ms Vorlauf.
    ok(Math.abs(knacksSchnitt(L([K, 40], [S, 400], [M, 800])) - 0.42) < 0.011)
  })

  it('Musik ab Sekunde 0 bleibt UNANGETASTET', () => {
    // Der wichtigste Fall: lieber ein Knackser zu viel als ein abgeschnittener
    // Liedanfang.
    strictEqual(knacksSchnitt(L([M, 1200])), 0)
  })

  it('langer Anfangston ist Musik, kein Knackser', () => {
    strictEqual(knacksSchnitt(L([K, 400], [S, 300], [M, 500])), 0)
  })

  it('Impuls ohne Stille dahinter: kein Schnitt', () => {
    strictEqual(knacksSchnitt(L([K, 40], [M, 1200])), 0)
  })

  it('spaeter Impuls (>200 ms) ist Musik', () => {
    strictEqual(knacksSchnitt(L([S, 300], [K, 40], [S, 300], [M, 500])), 0)
  })

  it('nur Stille nach dem Impuls: kein Schnitt', () => {
    strictEqual(knacksSchnitt(L([K, 40], [S, 1200])), 0)
  })

  it('alles still: kein Schnitt', () => {
    strictEqual(knacksSchnitt(L([S, 1000])), 0)
  })

  it('leere Eingabe wirft nicht', () => {
    strictEqual(knacksSchnitt([]), 0)
    strictEqual(knacksSchnitt(null), 0)
  })

  it('ein zu tiefer Schnitt wird verweigert', () => {
    // Ueber 800 ms — da schnitte man Musik weg.
    strictEqual(knacksSchnitt(L([K, 40], [S, 900], [M, 300])), 0)
  })

  it('Doppel-Knackser zaehlt als EIN Impuls', () => {
    ok(Math.abs(knacksSchnitt(L([K, 20], [S, 30], [K, 20], [S, 400], [M, 500])) - 0.45) < 0.011)
  })
})

describe('pegelFenster', () => {
  it('rechnet den Pegel je Fenster', () => {
    // Ein Fenster bei 48000 Hz und 10 ms sind 480 Proben je Kanal.
    const still = Buffer.alloc(480 * 2 * 2)
    strictEqual(pegelFenster(still).length, 1)
    ok(pegelFenster(still)[0] < 0.01)

    const laut = Buffer.alloc(480 * 2 * 2)
    for (let i = 0; i < 480 * 2; i++) laut.writeInt16LE(16384, i * 2)
    ok(Math.abs(pegelFenster(laut)[0] - 0.5) < 0.01)
  })

  it('vertraegt ein kaputtes Bruchstueck', () => {
    deepStrictEqual(pegelFenster(Buffer.from([1])), [])
    deepStrictEqual(pegelFenster(Buffer.alloc(0)), [])
  })
})

describe('urteil — was nicht abgelegt werden darf', () => {
  it('Stille wird verworfen, auch wenn die Datei gross ist', () => {
    strictEqual(urteil(-60, -70, 200).ok, false)
    strictEqual(urteil(-60, -70, 200).wort, 'still')
  })

  it('leise ist kein Grund zum Wegwerfen', () => {
    strictEqual(urteil(-12, -38, 200).ok, true)
    strictEqual(urteil(-12, -38, 200).wort, 'leise')
  })

  it('normale Musik ist ok', () => {
    strictEqual(urteil(-1.5, -14, 200).wort, 'ok')
  })

  it('zu kurz wird verworfen, egal wie laut', () => {
    strictEqual(urteil(-1, -10, 5).ok, false)
  })
})

describe('vollstaendigkeit — E28/N4: was vollstaendig AUSSIEHT', () => {
  it('rechnet gegen die Solldauer des Spielers', () => {
    strictEqual(vollstaendigkeit(180, 180_000), 1)
    strictEqual(vollstaendigkeit(90, 180_000), 0.5)
  })

  it('behauptet nichts, wenn die Solldauer fehlt', () => {
    // Ohne Anhaltspunkt lieber keine Aussage als eine falsche.
    strictEqual(vollstaendigkeit(180, null), null)
    strictEqual(vollstaendigkeit(180, 0), null)
    strictEqual(vollstaendigkeit(180, undefined), null)
  })
})

describe('der Riegel gegen halbe Aufnahmen (20.08.2026)', () => {
  /*
   * WAS HIER GEPRUEFT WIRD, ist die ENTSCHEIDUNG „ablegen oder verwerfen",
   * ausgedrueckt in denselben zwei Funktionen, die `stueckAblegen` benutzt.
   * Am Geraet sah der Fehler so aus (Journal vom 20.08., woertlich):
   *
   *     ACHTUNG unvollstaendig: "Chaos im Museum - Teil ..."
   *     KACHEL ANGELEGT: ...
   *     fuer kalea sichtbar gemacht
   *
   * Erkannt und trotzdem angelegt. Ein Kind tippt die Kachel an und hoert
   * mitten im Satz Stille — es meldet das nicht, es tippt sie nie wieder an.
   */
  const wirdVerworfen = (dauerSek, sollMs) => {
    const anteil = vollstaendigkeit(dauerSek, sollMs)
    return anteil !== null && unvollstaendigZusatz(anteil) !== ''
  }

  it('verwirft ein halbes Hoerspiel', () => {
    strictEqual(wirdVerworfen(90, 180_000), true, '50 % ist kein Puffer, sondern ein Bruchstueck')
    strictEqual(wirdVerworfen(150, 180_000), true, '83 % — mitten im Satz zu Ende')
  })

  it('behaelt, was ganz ist — auch mit Rundungsverlust', () => {
    strictEqual(wirdVerworfen(180, 180_000), false)
    strictEqual(wirdVerworfen(178, 180_000), false, '99 % ist Rundung, kein Abbruch')
    strictEqual(wirdVerworfen(175, 180_000), false, '97 % ist die Grenze und liegt drin')
  })

  it('verwirft NICHT, wenn es nichts zu beurteilen gibt', () => {
    // Ohne Solldauer vom Spieler weiss niemand, ob das Stueck ganz ist. Ein
    // Verwurf auf Verdacht waere schlimmer als ein Stueck ohne Urteil — das
    // traefe jede Quelle, die keine Laenge meldet.
    strictEqual(wirdVerworfen(180, null), false)
    strictEqual(wirdVerworfen(180, 0), false)
    strictEqual(wirdVerworfen(180, undefined), false)
  })

  it('die Grenze gilt JE TITEL, nicht je Album', () => {
    // Ein Album, dessen letzter Titel abbricht, behaelt seine ganzen Stuecke:
    // jeder Titel wird einzeln beurteilt.
    const album = [
      { dauer: 180, soll: 180_000 },
      { dauer: 200, soll: 200_000 },
      { dauer: 40, soll: 190_000 },
    ]
    const behalten = album.filter((x) => !wirdVerworfen(x.dauer, x.soll))
    strictEqual(behalten.length, 2, 'nur der abgebrochene faellt weg')
  })
})

describe('unvollstaendigZusatz — der Abbruch muss SICHTBAR sein', () => {
  it('haengt den Anteil an den Dateinamen', () => {
    strictEqual(unvollstaendigZusatz(0.5), ' (unvollstaendig 50%)')
    strictEqual(unvollstaendigZusatz(0.83), ' (unvollstaendig 83%)')
  })

  it('schweigt bei einem ganzen Titel', () => {
    strictEqual(unvollstaendigZusatz(1), '')
    strictEqual(unvollstaendigZusatz(0.99), '', 'ein Prozent Rundung ist kein Abbruch')
    strictEqual(unvollstaendigZusatz(null), '', 'ohne Solldauer wird nichts behauptet')
  })

  it('sagt nie 0 Prozent', () => {
    // "(unvollstaendig 0%)" laese sich wie ein Fehler der Anzeige.
    ok(!unvollstaendigZusatz(0.001).includes('0%'))
  })
})

describe('rohOrtWaehlen — E28/N2: die Karte schonen', () => {
  it('nimmt den Arbeitsspeicher, wenn er es traegt', () => {
    const w = rohOrtWaehlen(1024, '/home/dietpi/mitschnitt')
    strictEqual(w.imSpeicher, true)
    strictEqual(w.ort, '/dev/shm')
  })

  it('weicht auf die Karte aus, wenn der Speicher knapp ist — und sagt warum', () => {
    // Lieber auf der Karte aufnehmen als den Speicher der ganzen Box fuellen.
    const w = rohOrtWaehlen(200, '/home/dietpi/mitschnitt')
    strictEqual(w.imSpeicher, false)
    strictEqual(w.ort, '/home/dietpi/mitschnitt')
    ok(w.grund.includes('200'), w.grund)
  })

  it('nimmt die Karte, wenn der Speicherort gar nicht lesbar ist', () => {
    const w = rohOrtWaehlen(-1, '/home/dietpi/mitschnitt')
    strictEqual(w.imSpeicher, false)
    ok(w.grund.includes('nicht lesbar'), w.grund)
  })
})

describe('Ablage im Medienordner — damit die Box es abspielt', () => {
  it('baut den Pfad, den der Abspieldienst sucht', () => {
    // LEERZEICHEN BLEIBEN. `saeubern` wirft nur heraus, was einen Pfad
    // zerlegen wuerde; Ordnernamen bleiben dadurch lesbar, und der
    // Abspieldienst bekommt sie ohnehin URL-kodiert.
    strictEqual(
      albumOrdner('audiobook', 'Hello Kitty Hörspiele', 'Folge 13', '/m'),
      '/m/audiobook/Hello Kitty Hörspiele/Folge 13',
    )
  })

  it('faellt auf brauchbare Werte zurueck statt einen kaputten Pfad zu bauen', () => {
    strictEqual(albumOrdner('', '', '', '/m'), '/m/music/Unbekannt/Ohne Album')
  })

  it('die Tracknummer steht vorn und ist aufgefuellt', () => {
    // Sonst sortiert 10 vor 2, und das Album spielt in falscher Reihenfolge.
    strictEqual(spurname(2, 'Lied'), '02 Lied.flac')
    strictEqual(spurname(10, 'Lied'), '10 Lied.flac')
  })

  it('ohne Nummer bleibt der blosse Titel', () => {
    strictEqual(spurname(null, 'Lied'), 'Lied.flac')
    strictEqual(spurname(0, 'Lied'), 'Lied.flac')
  })

  it('KEIN Zeitstempel — zweimal dasselbe Stueck ist dieselbe Datei', () => {
    // Der Unterschied zum Archivnamen: hier soll ein ALBUM entstehen, nicht
    // eine Sammlung von Aufnahmen desselben Titels.
    strictEqual(spurname(3, 'Lied'), spurname(3, 'Lied'))
  })
})

describe('neueBehalten — welche Aufnahme bleibt', () => {
  it('vollstaendig schlaegt unvollstaendig, auch wenn sie kuerzer ist', () => {
    strictEqual(neueBehalten({ dauer: 200, anteil: 0.4 }, { dauer: 180, anteil: 1 }), true)
    strictEqual(neueBehalten({ dauer: 180, anteil: 1 }, { dauer: 200, anteil: 0.4 }), false)
  })

  it('bei gleicher Vollstaendigkeit gewinnt die laengere', () => {
    strictEqual(neueBehalten({ dauer: 100, anteil: 1 }, { dauer: 180, anteil: 1 }), true)
    strictEqual(neueBehalten({ dauer: 180, anteil: 1 }, { dauer: 100, anteil: 1 }), false)
  })

  it('bei Gleichstand bleibt die alte liegen', () => {
    // Neu ist kein Wert an sich, und jedes Ueberschreiben kostet die Karte.
    strictEqual(neueBehalten({ dauer: 180, anteil: 1 }, { dauer: 180, anteil: 1 }), false)
  })

  it('ohne Vorgaengerin wird immer geschrieben', () => {
    strictEqual(neueBehalten(null, { dauer: 30, anteil: 0.2 }), true)
  })
})

describe('m3uInhalt', () => {
  it('schreibt absolute Pfade in Albumreihenfolge', () => {
    const t = m3uInhalt('/m/a/b', ['03 C.flac', '01 A.flac', '02 B.flac'])
    deepStrictEqual(t.split('\n').filter(Boolean), [
      '#EXTM3U',
      '/m/a/b/01 A.flac',
      '/m/a/b/02 B.flac',
      '/m/a/b/03 C.flac',
    ])
  })

  it('nimmt nur Tondateien auf, nicht die Playlist selbst', () => {
    const t = m3uInhalt('/m', ['01 A.flac', 'playlist.m3u', '.cover.jpg'])
    strictEqual(t.split('\n').filter(Boolean).length, 2)
  })
})

/* ══ DER PLATZHALTER IST KEIN TITEL (20.08.2026) ═══════════════════════════
 *
 * Gemeldet: „es legt jetzt was an man kann es aber nicht abspielen und es läd
 * auch kein cover." Am Geraet lag danach eine 129-Sekunden-Datei unter
 * Unbekannt/Ohne Album/Unbenannt.flac — ohne Tags, ohne Cover, und ohne
 * Eintrag in der Profil-Auswahl, also unsichtbar fuer das Abspielen.
 *
 * DER RUMPF UNTEN IST WOERTLICH DAS, WAS spotify-control.js SCHICKT, wenn
 * nichts laeuft oder eine andere Maschine spielt. `item` ist da — ein Stueck
 * ist es nicht.
 */
describe('titelAus — ein leeres item ist kein Titel', () => {
  const PLATZHALTER = {
    item: { album: { name: '', total_tracks: '' }, name: '', track_number: '' },
    currently_playing_type: '',
  }

  it('gibt beim Platzhalter des Abspieldienstes null', () => {
    strictEqual(titelAus(PLATZHALTER), null)
  })

  it('gibt auch ohne item null', () => {
    strictEqual(titelAus({}), null)
    strictEqual(titelAus(null), null)
    strictEqual(titelAus(undefined), null)
  })

  /* DIE GEGENPROBE, ohne die der Test nichts wert waere: derselbe Rumpf MIT
   * Identitaet muss durchkommen. Ein Riegel, der alles abweist, wuerde die
   * Aufnahme ganz abschalten — und der erste Test bliebe trotzdem gruen. */
  it('laesst einen ECHTEN Titel durch — an der Kennung erkannt, nicht am Namen', () => {
    const echt = titelAus({
      item: { ...PLATZHALTER.item, uri: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh' },
    })
    ok(echt, 'mit uri muss ein Titel entstehen')
    strictEqual(echt.uri, 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh')

    // `id` statt `uri` — dieselbe Identitaetsregel wie in istNeuerTitel.
    ok(titelAus({ item: { id: '4iV5W9uYEdYUVa79Axb7Rh', name: 'Etwas' } }))
  })

  it('ein Titel OHNE Kennung, aber mit Namen, zaehlt nicht', () => {
    // Genau der Fall, der die Halde erzeugt haette: Name ohne Identitaet.
    strictEqual(titelAus({ item: { name: 'Irgendwas', album: { name: 'Album' } } }), null)
  })

  /* W2 (29.08.2026): der Mitschnitt soll seine Spotify-Quelle FESTSCHREIBEN
   * koennen statt sie der Heuristik der Verwaltung zu ueberlassen — dafuer
   * muss `titelAus` den Kontext (`context.uri`/`context.type`) mitnehmen,
   * genau wie server.ts es fuer denselben Zweck liest (spielstand.ts,
   * weiterhoeren.ts). */
  it('nimmt context.uri und context.type mit, wenn der Zustand sie nennt', () => {
    const t = titelAus({
      item: { uri: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh', album: { name: 'Steil II' } },
      context: { uri: 'spotify:album:6nrRcXYZ0000000000000', type: 'album' },
    })
    strictEqual(t.kontextUri, 'spotify:album:6nrRcXYZ0000000000000')
    strictEqual(t.kontextArt, 'album')
  })

  it('nimmt die ALBUM-Kennung mit — sie und nicht der Kontext bestimmt die Quelle (20.09.2026)', () => {
    const t = titelAus({
      item: {
        uri: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh',
        album: { name: 'Steil II', uri: 'spotify:album:6nrRcXYZ0000000000000' },
      },
    })
    strictEqual(t.albumUri, 'spotify:album:6nrRcXYZ0000000000000')
  })

  it('faellt auf album.id zurueck und bleibt sonst null', () => {
    strictEqual(titelAus({ item: { uri: 'spotify:track:X', album: { id: 'ABC' } } }).albumUri, 'ABC')
    strictEqual(titelAus({ item: { uri: 'spotify:track:X', album: { name: 'Ohne Kennung' } } }).albumUri, null)
  })

  it('bleibt bei null ohne Kontext — Radio, Kuenstler-Autoplay und Aehnliches', () => {
    const t = titelAus({ item: { uri: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh' } })
    strictEqual(t.kontextUri, null)
    strictEqual(t.kontextArt, null)
  })
})

describe('spotifyQuellSchluessel — die Spotify-Quelle exakt, nicht geraten (29.08.2026, W2)', () => {
  it('bildet spotify:<id> aus einem Album-Kontext', () => {
    strictEqual(
      spotifyQuellSchluessel({ kontextArt: 'album', kontextUri: 'spotify:album:6nrRcXYZ0000000000000' }),
      'spotify:6nrRcXYZ0000000000000',
    )
  })

  it('nimmt das ALBUM DES STUECKS, auch ohne jeden Kontext (20.09.2026)', () => {
    // Der Betreiber-Fall: „Ohrwuermer und Kinderlieder" wurde nicht von einer
    // Album-Kachel aus gespielt, also gab es keinen Kontext, aus dem hier je
    // ein Schluessel entstand — und damit keine zweite Quelle zum Auffuellen.
    // Das Stueck nennt sein Album selbst.
    strictEqual(
      spotifyQuellSchluessel({ albumUri: 'spotify:album:0sTjN1YO9XfCOkJx9VXVVV' }),
      'spotify:0sTjN1YO9XfCOkJx9VXVVV',
    )
    // Und es SCHLAEGT den Kontext: der Ordner gehoert dem Album.
    strictEqual(
      spotifyQuellSchluessel({
        albumUri: 'spotify:album:0sTjN1YO9XfCOkJx9VXVVV',
        kontextArt: 'playlist',
        kontextUri: 'spotify:playlist:37i9dQZF1DX5Ejj0EkURtP',
      }),
      'spotify:0sTjN1YO9XfCOkJx9VXVVV',
    )
  })

  it('gibt null bei Playlist und Sendung — sie sind keine Album-Quelle (20.09.2026)', () => {
    // Frueher lieferten beide einen Schluessel, weil medienSchluessel() aus
    // allen dreien `spotify:<id>` bildet. Verbunden wird hier aber immer ein
    // ORDNER, und der gehoert einem ALBUM; `verschmelzeWerke()` weist ein Paar
    // mit verschiedener `art` still ab (Fall 2). Auf der Box lagen vier solche
    // toten Zuordnungen — Begruendung bei SPOTIFY_KONTEXT_ARTEN.
    strictEqual(
      spotifyQuellSchluessel({ kontextArt: 'playlist', kontextUri: 'spotify:playlist:37i9dQZF1DX5Ejj0EkURtP' }),
      null,
    )
    strictEqual(spotifyQuellSchluessel({ kontextArt: 'show', kontextUri: 'spotify:show:4rOoJ6Egrf8K2IrywzwOMk' }), null)
  })

  it('gibt null bei einer Art ohne eigene Kachel — hier wird nicht geraten', () => {
    // Kuenstler-Radio & Co: es gibt keine einzelne Bibliothekskachel, der man
    // die Aufnahme zuordnen koennte.
    strictEqual(spotifyQuellSchluessel({ kontextArt: 'artist', kontextUri: 'spotify:artist:0TnOYISbd1XYRBk9myaseg' }), null)
  })

  it('gibt null ohne Kontext', () => {
    strictEqual(spotifyQuellSchluessel({}), null)
    strictEqual(spotifyQuellSchluessel(null), null)
    strictEqual(spotifyQuellSchluessel({ kontextArt: 'album', kontextUri: '' }), null)
  })
})

describe('festschreibenAnfrage — was an die Verschmelzung zu schicken ist (29.08.2026, W2)', () => {
  it('nennt die Spotify-Quelle als schluessel und die neue Kachel als auch', () => {
    const a = festschreibenAnfrage(
      { kontextArt: 'album', kontextUri: 'spotify:album:6nrRcXYZ0000000000000' },
      'lokal:t:das lumpenpack|steil ii',
    )
    deepStrictEqual(a, { schluessel: 'spotify:6nrRcXYZ0000000000000', auch: 'lokal:t:das lumpenpack|steil ii' })
  })

  it('gibt null ohne Spotify-Quelle — dann bleibt es bei der Heuristik', () => {
    strictEqual(festschreibenAnfrage({}, 'lokal:t:a|b'), null)
  })

  it('gibt null ohne Kachelschluessel', () => {
    strictEqual(festschreibenAnfrage({ kontextArt: 'album', kontextUri: 'spotify:album:X' }, ''), null)
    strictEqual(festschreibenAnfrage({ kontextArt: 'album', kontextUri: 'spotify:album:X' }, undefined), null)
  })

  it('gibt null, wenn Quelle und Kachel zufaellig gleich waeren', () => {
    strictEqual(festschreibenAnfrage({ kontextArt: 'album', kontextUri: 'spotify:album:X' }, 'spotify:X'), null)
  })
})

/* ══ DIE QUELLE SELBST (20.09.2026) ═════════════════════════════════════════
 *
 * Eine Zuordnung auf einen Schluessel OHNE Eintrag ist wirkungslos
 * (`verschmelzeWerke()` uebergeht ihn). Deshalb legt der Mitschnitt die
 * Spotify-Fassung jetzt mit an — erst damit hat `/inhalt` zwei Kandidaten und
 * `waehleInhalt` etwas zu waehlen.
 */
describe('quelleAnfrage — der Spotify-Eintrag, ohne den die Zuordnung leer laeuft', () => {
  const TITEL = {
    albumUri: 'spotify:album:0sTjN1YO9XfCOkJx9VXVVV',
    album: 'Ohrwuermer und Kinderlieder mit Eva und dem Elefanten',
    albumKuenstler: 'Die Maus, Eva mit Gitarre, Der Elefant',
    kuenstler: 'Die Maus',
    bild: 'https://i.scdn.co/image/abc',
  }

  it('baut einen vollstaendigen Album-Eintrag aus dem laufenden Stueck', () => {
    deepStrictEqual(quelleAnfrage(TITEL, 'audiobook'), {
      type: 'spotify',
      category: 'audiobook',
      title: 'Ohrwuermer und Kinderlieder mit Eva und dem Elefanten',
      artist: 'Die Maus, Eva mit Gitarre, Der Elefant',
      id: '0sTjN1YO9XfCOkJx9VXVVV',
      spotify_url: 'https://open.spotify.com/album/0sTjN1YO9XfCOkJx9VXVVV',
      cover: 'https://i.scdn.co/image/abc',
    })
  })

  it('nimmt die Kategorie der KACHEL, nicht eine eigene Meinung', () => {
    // Verschiedene Kategorien liesse `KATEGORIE_TRENNT` (abgleich.ts) gar
    // nicht zusammen — das Paar waere still wieder wirkungslos.
    strictEqual(quelleAnfrage(TITEL, 'music').category, 'music')
    strictEqual(quelleAnfrage(TITEL, '').category, 'music')
  })

  it('nimmt den ALBUM-Interpreten, faellt aber auf den des Stuecks zurueck', () => {
    strictEqual(quelleAnfrage({ ...TITEL, albumKuenstler: '' }, 'music').artist, 'Die Maus')
    strictEqual(quelleAnfrage({ ...TITEL, albumKuenstler: '', kuenstler: '' }, 'music').artist, 'Unbekannt')
  })

  it('gibt null ohne Kennung und null ohne Albumnamen — ein Eintrag ohne beides ist keiner', () => {
    strictEqual(quelleAnfrage({ album: 'Nur ein Name' }, 'music'), null)
    strictEqual(quelleAnfrage({ albumUri: 'spotify:album:X' }, 'music'), null)
    strictEqual(quelleAnfrage(null, 'music'), null)
  })

  it('nimmt auch den Album-KONTEXT, wenn der Zustand kein album.uri mitschickt', () => {
    const o = quelleAnfrage(
      { kontextArt: 'album', kontextUri: 'spotify:album:6nrRcXYZ0000000000000', album: 'Steil II' },
      'music',
    )
    strictEqual(o.id, '6nrRcXYZ0000000000000')
  })

  it('nimmt einen PLAYLIST-Kontext NICHT — sonst stuende die Playlist als Album da', () => {
    strictEqual(
      quelleAnfrage({ kontextArt: 'playlist', kontextUri: 'spotify:playlist:X', album: 'Folge 4' }, 'music'),
      null,
    )
  })
})

/**
 * DER ZUORDNUNGS-SCHREIBWEG, GEMOCKT (29.08.2026, W2).
 *
 * `verschmelzungFestschreiben` geht wie `kennungVerknuepfen` UEBER DEN SERVER
 * (`serverSchicken`) — kein Dateizugriff, den ein Test ohne Netz nachstellen
 * koennte. `serverSchicken` selbst spricht `node:http` DIREKT an (ein
 * Mock von `http.request` erreicht es nachweislich nicht: ESM loest den
 * benannten Import `request as anfrage` eingebauter Module beim Einlesen auf,
 * nicht bei jedem Aufruf neu — `mock.method(http, 'request', …)` liess diesen
 * Bezeichner unveraendert, nachgemessen). Der Schreibweg wird deshalb ueber
 * das vierte, injizierbare Argument von `verschmelzungFestschreiben`
 * gemockt — eine AUSTAUSCHBARE ABHAENGIGKEIT statt eines Modul-Mocks.
 */
describe('verschmelzungFestschreiben — der Zuordnungs-Schreibweg, gemockt (29.08.2026, W2)', () => {
  /** Ein Fake fuer `serverSchicken`: antwortet immer gleich, merkt sich jeden Aufruf. */
  function fakeServer(status, inhalt) {
    const aufrufe = []
    const schicken = async (pfad, methode, rumpf) => {
      aufrufe.push({ pfad, methode, rumpf })
      return { status, inhalt }
    }
    schicken.aufrufe = aufrufe
    return schicken
  }

  it('schickt Pfad, Methode und Rumpf — denselben Weg wie POST /api/medien', async () => {
    const schicken = fakeServer(200, { zuordnungen: [], getrennt: [] })
    const protokoll = []
    await verschmelzungFestschreiben(
      { kontextArt: 'album', kontextUri: 'spotify:album:6nrRcXYZ0000000000000' },
      'lokal:t:das lumpenpack|steil ii',
      (z) => protokoll.push(z),
      schicken,
    )
    strictEqual(schicken.aufrufe.length, 1)
    strictEqual(schicken.aufrufe[0].pfad, '/api/verschmelzung/festschreiben')
    strictEqual(schicken.aufrufe[0].methode, 'POST')
    deepStrictEqual(schicken.aufrufe[0].rumpf, {
      schluessel: 'spotify:6nrRcXYZ0000000000000',
      auch: 'lokal:t:das lumpenpack|steil ii',
    })
    ok(
      protokoll.some((z) => z.includes('festgeschrieben')),
      'der Erfolg muss protokolliert werden',
    )
  })

  it('legt ZUERST die Quelle an und schreibt DANN die Zuordnung fest — und sonst nichts (20.09.2026)', async () => {
    // Der Betreiber-Fall: ohne den Eintrag zeigt `verschmelzeWerke()` auf
    // einen Schluessel, den es nicht gibt, und die Zuordnung wirkt nicht.
    const schicken = fakeServer(200, {})
    const protokoll = []
    await verschmelzungFestschreiben(
      {
        albumUri: 'spotify:album:0sTjN1YO9XfCOkJx9VXVVV',
        album: 'Ohrwuermer und Kinderlieder mit Eva und dem Elefanten',
        albumKuenstler: 'Die Maus, Eva mit Gitarre, Der Elefant',
      },
      'lokal:t:die maus eva mit gitarre der elefant|ohrwurmer und kinderlieder',
      (z) => protokoll.push(z),
      schicken,
      'audiobook',
    )
    strictEqual(schicken.aufrufe.length, 2, 'genau zwei Aufrufe — Quelle, dann Zuordnung')
    strictEqual(schicken.aufrufe[0].pfad, '/api/medien')
    strictEqual(schicken.aufrufe[0].rumpf.id, '0sTjN1YO9XfCOkJx9VXVVV')
    strictEqual(schicken.aufrufe[0].rumpf.category, 'audiobook')
    strictEqual(schicken.aufrufe[1].pfad, '/api/verschmelzung/festschreiben')
    deepStrictEqual(schicken.aufrufe[1].rumpf, {
      schluessel: 'spotify:0sTjN1YO9XfCOkJx9VXVVV',
      auch: 'lokal:t:die maus eva mit gitarre der elefant|ohrwurmer und kinderlieder',
    })
    ok(protokoll.some((z) => z.includes('Quelle angelegt')))
  })

  it('ein 409 auf die Quelle ist KEIN Fehler — ab dem zweiten Stueck der Normalfall', async () => {
    const schicken = fakeServer(409, { error: 'schonVorhanden' })
    const protokoll = []
    await verschmelzungFestschreiben(
      { albumUri: 'spotify:album:X', album: 'Steil II', albumKuenstler: 'Das Lumpenpack' },
      'lokal:t:das lumpenpack|steil ii',
      (z) => protokoll.push(z),
      schicken,
      'music',
    )
    // Die Zuordnung wird TROTZDEM geschickt: dass der Eintrag schon stand,
    // heisst nicht, dass er verbunden ist.
    strictEqual(schicken.aufrufe.length, 2)
    strictEqual(
      protokoll.filter((z) => z.includes('Quelle nicht angelegt')).length,
      0,
      'ein 409 darf nicht als Fehlschlag im Protokoll stehen',
    )
  })

  it('ruft den Server GAR NICHT ohne verwertbare Spotify-Quelle', async () => {
    // Kuenstler-Radio & Co (siehe spotifyQuellSchluessel) — hier gibt es
    // nichts festzuschreiben, also wird auch nichts geschickt.
    const schicken = fakeServer(200, {})
    await verschmelzungFestschreiben(
      { kontextArt: 'artist', kontextUri: 'spotify:artist:X' },
      'lokal:t:a|b',
      () => {},
      schicken,
    )
    strictEqual(schicken.aufrufe.length, 0)
  })

  it('meldet einen fehlgeschlagenen Schreibversuch, wirft aber nicht — die Aufnahme darf daran nicht scheitern', async () => {
    const schicken = fakeServer(500, { error: 'schreibenFehlgeschlagen' })
    const protokoll = []
    await verschmelzungFestschreiben(
      { kontextArt: 'album', kontextUri: 'spotify:album:X' },
      'lokal:t:a|b',
      (z) => protokoll.push(z),
      schicken,
    )
    strictEqual(schicken.aufrufe.length, 1)
    ok(protokoll.some((z) => z.includes('nicht festgeschrieben')))
  })

  it('faengt einen werfenden Schreibversuch ab und meldet ihn, statt die Aufnahme abzubrechen', async () => {
    const schicken = async () => {
      throw new Error('ECONNREFUSED')
    }
    const protokoll = []
    await verschmelzungFestschreiben(
      { kontextArt: 'album', kontextUri: 'spotify:album:X' },
      'lokal:t:a|b',
      (z) => protokoll.push(z),
      schicken,
    )
    ok(protokoll.some((z) => z.includes('fehlgeschlagen')))
  })

  it('ruft bei einem zweiten, gleichlautenden Aufruf ERNEUT auf — die IDEMPOTENZ liegt in handVerbinden, nicht hier', async () => {
    // Der Mitschnitt ruft `verschmelzungFestschreiben` bei JEDEM Stueck
    // desselben Albums erneut auf (kachelAnlegen laeuft je Stueck). Dass ein
    // zweiter Aufruf mit denselben zwei Schluesseln die Ablage nicht wachsen
    // laesst, ist Sache von `handVerbinden` (abgleich.spec.ts) — diese
    // Funktion schickt einfach wieder denselben Rumpf.
    const schicken = fakeServer(200, { zuordnungen: [], getrennt: [] })
    const titel = { kontextArt: 'album', kontextUri: 'spotify:album:X' }
    await verschmelzungFestschreiben(titel, 'lokal:t:a|b', () => {}, schicken)
    await verschmelzungFestschreiben(titel, 'lokal:t:a|b', () => {}, schicken)
    strictEqual(schicken.aufrufe.length, 2)
    deepStrictEqual(schicken.aufrufe[0].rumpf, schicken.aufrufe[1].rumpf)
  })
})

describe('kennungAnfragen — die Aufnahme an eine Interpretenkennung haengen (E64b)', () => {
  it('fragt IMMER mit stufe erkannt, nie mit hand', () => {
    // DAS IST DIE SICHERHEITSKRITISCHE STELLE. Mit `hand` duerfte der Server
    // zwei Interpreten ZUSAMMENLEGEN — das darf nur ein Mensch (Regel aus E49,
    // begruendet in interpretenkennung.ts). Hier entscheidet eine Maschine.
    const a = kennungAnfragen('Die Maus')
    strictEqual(a.anlegen.stufe, 'erkannt')
    strictEqual(a.verweis.stufe, 'erkannt')
  })

  it('verweist auf den ORDNERNAMEN, nicht auf den Anzeigenamen', () => {
    // Der Verweis soll sagen, woran man den Interpreten auf der PLATTE
    // wiedererkennt — derselbe Wert, den albumOrdner in den Pfad schreibt.
    const a = kennungAnfragen('🩵Jojo 🩵')
    strictEqual(a.anlegen.name, '🩵Jojo 🩵', 'der Name bleibt, wie er ist')
    strictEqual(a.verweis.kennung, saeubern('🩵Jojo 🩵'))
    strictEqual(a.verweis.dienst, 'aufnahme')
  })

  it('nimmt die Kategorie NICHT mit auf', () => {
    // Eine Kennung gehoert einem Interpreten. Derselbe kann unter music/ und
    // unter audiobook/ liegen; die Kategorie gehoert zum Werk, nicht zur Person.
    const a = kennungAnfragen('Kapelle Petra')
    ok(!a.verweis.kennung.includes('/'), a.verweis.kennung)
  })

  it('fragt gar nicht, wo kein Name steht', () => {
    for (const x of ['', '   ', null, undefined]) {
      strictEqual(kennungAnfragen(x), null, String(x))
    }
  })
})

describe('spurpfade — wo ein vorgemerkter Titel liegen koennte (E66/E73)', () => {
  const basis = '/medien'
  const voll = {
    uri: 'spotify:track:0PyuOAMz1lv0z737JcQNOg',
    titel: 'Die Zukunft wird gross',
    interpret: 'Das Lumpenpack, Gast',
    albumInterpret: 'Das Lumpenpack',
    album: 'Alles Gute',
    nummer: 7,
  }

  it('baut genau den Pfad, den das Ablegen schreiben wuerde', () => {
    // Waeren die beiden je anders, liefe der Abgleich ins Leere und die Box
    // naehme jeden Titel ein zweites Mal auf.
    const erwartet = `${albumOrdner('music', 'Das Lumpenpack', 'Alles Gute', basis)}/${spurname(7, 'Die Zukunft wird gross')}`
    deepStrictEqual(spurpfade(voll, basis, ['music']), [erwartet])
  })

  it('gibt je Kategorie eine Moeglichkeit', () => {
    // Beim Vormerken ist die Kategorie noch nicht bekannt — sie wird erst beim
    // Ablegen beim Original erfragt. Also alle pruefen, eine reicht.
    strictEqual(spurpfade(voll, basis, ['music', 'audiobook']).length, 2)
    strictEqual(spurpfade(voll, basis, []).length, 0)
  })

  it('nimmt den ALBUM-Interpreten fuer den Ordner, nicht den des Titels', () => {
    // Sonst entstuende je Gast ein eigener Ordner — der Fund vom 20.08.2026.
    ok(spurpfade(voll, basis, ['music'])[0].includes('/Das Lumpenpack/'))
    ok(!spurpfade(voll, basis, ['music'])[0].includes('Gast'))
  })

  it('faellt auf den Titel-Interpreten zurueck, wenn kein Album-Interpret da ist', () => {
    const ohne = { ...voll, albumInterpret: '' }
    ok(spurpfade(ohne, basis, ['music'])[0].includes('/Das Lumpenpack, Gast/'))
  })

  it('OHNE TITEL GIBT ES KEINEN PFAD', () => {
    // `spurname` haette hier „Unbenannt.flac" gebildet — und ein Treffer darauf
    // erklaerte einen fremden Titel fuer erledigt. Er wuerde dann NIE
    // aufgenommen: ein stiller Verlust, waehrend ein verpasster Treffer nur
    // eine ueberfluessige Aufnahme kostet.
    for (const x of ['', '   ', null, undefined]) {
      deepStrictEqual(spurpfade({ ...voll, titel: x }, basis, ['music']), [], String(x))
    }
  })

  it('OHNE INTERPRET GIBT ES KEINEN PFAD', () => {
    // Derselbe Grund: `albumOrdner` haette „Unbekannt" eingesetzt.
    deepStrictEqual(spurpfade({ ...voll, albumInterpret: '', interpret: '' }, basis, ['music']), [])
  })

  it('kommt ohne Album aus — der Ordner heisst dann wie beim Ablegen', () => {
    // Hier ist der Ersatzwert richtig: das Ablegen macht es genauso.
    const ohne = { ...voll, album: '' }
    deepStrictEqual(spurpfade(ohne, basis, ['music']), [
      `${albumOrdner('music', 'Das Lumpenpack', '', basis)}/${spurname(7, 'Die Zukunft wird gross')}`,
    ])
  })

  it('ohne Nummer kein Zahlenpraefix', () => {
    ok(spurpfade({ ...voll, nummer: null }, basis, ['music'])[0].endsWith('/Die Zukunft wird gross.flac'))
  })

  it('vertraegt Unsinn statt Kategorien', () => {
    for (const x of [null, undefined, 'music', 42, {}]) {
      deepStrictEqual(spurpfade(voll, basis, x), [], String(x))
    }
  })
})

describe('knotenSuchen findet BEIDE Tonmaschinen (21.08.2026)', () => {
  // DER FEHLER, DER DEN MITSCHNITT AUF DIESER BOX UNMOEGLICH MACHTE: hier
  // stand fest `librespot`. Diese Box spielt mit SOLOIST, dessen Knoten
  // schlicht `spotify` heisst. Jeder Versuch endete mit
  // „der librespot-Knoten kam nicht (spielt gerade nichts?)" — und die
  // Klammer sagte auch noch das Falsche: es spielte sehr wohl.
  const alsLibrespot = [
    '\tid 40, type PipeWire:Interface:Node/3',
    '\t\tnode.name = "alsa_playback.librespot"',
  ].join('\n')
  const alsSoloist = ['\tid 71, type PipeWire:Interface:Node/3', '\t\tnode.name = "spotify"'].join('\n')

  it('findet librespots Knoten', () => {
    deepStrictEqual(knotenSuchen(alsLibrespot), { id: 40, name: 'alsa_playback.librespot' })
  })

  it('findet Soloists Knoten — den, an dem es scheiterte', () => {
    deepStrictEqual(knotenSuchen(alsSoloist), { id: 71, name: 'spotify' })
  })

  it('es duerfen beide Namen nebeneinander stehen', () => {
    // Weil immer nur EINE Maschine laeuft: soloist.service traegt eine
    // ExecCondition auf spotify.engine == "soloist", librespot die umgekehrte.
    ok(MASCHINEN_KNOTEN.includes('spotify'))
    ok(MASCHINEN_KNOTEN.some((n) => n.includes('librespot')))
  })

  it('findet nichts, wo nichts ist', () => {
    const fremd = ['\tid 9, type PipeWire:Interface:Node/3', '\t\tnode.name = "entzerrer"'].join('\n')
    strictEqual(knotenSuchen(fremd), null)
    strictEqual(knotenSuchen(''), null)
    strictEqual(knotenSuchen(null), null)
  })

  it('ein einzelnes Wort geht weiterhin', () => {
    // Der alte Aufruf mit einer Zeichenkette darf nicht brechen.
    deepStrictEqual(knotenSuchen(alsSoloist, 'spotify'), { id: 71, name: 'spotify' })
    strictEqual(knotenSuchen(alsSoloist, 'librespot'), null)
  })
})

describe('Kanonische Metadaten: die Tags tragen Spotify, nicht den Pfad', () => {
  // Der Befund dahinter (06.09.2026, Box .62): 8 von 26 Aufnahme-Kacheln
  // trugen gesaeuberte Namen („Folge 13_ …"), weil die Warteschlange aus
  // PFADEN geboren wird. Betreiber: „der tag muss identisch sein."
  const roh = {
    name: 'Hallo, Haroshee! - Teil 03',
    artists: [{ name: 'Hello Kitty Hörspiele' }, { name: 'Gaststimme' }],
    album: {
      name: 'Folge 13: Der Geist von Cherry Town',
      artists: [{ name: 'Hello Kitty Hörspiele' }],
    },
    track_number: 5,
  }

  it('dampft die rohe Spotify-Antwort auf die sechs Ablage-Felder ein', () => {
    deepStrictEqual(kanonischesAus(roh), {
      name: 'Hallo, Haroshee! - Teil 03',
      kuenstler: 'Hello Kitty Hörspiele, Gaststimme',
      album: 'Folge 13: Der Geist von Cherry Town',
      albumKuenstler: 'Hello Kitty Hörspiele',
      nummer: 5,
      // Ohne `album.images` in der Antwort bleibt es leer — aber es IST da,
      // und genau das war zwei Wochen lang nicht so (E135/1c).
      bild: '',
    })
  })

  it('DAS BILD KOMMT MIT, wenn die Antwort eines traegt (E135/1c)', () => {
    // Die Antwort trug `album.images` von Anfang an; gelesen wurde es nicht.
    // Der Nachschnitt baut seine Aufnahme allein hieraus — fehlt das Feld,
    // entsteht eine Datei ohne Cover, und niemand merkt es: die Kachel steht,
    // sie zeigt nur das Maskottchen.
    const mitBild = kanonischesAus({
      ...roh,
      album: { ...roh.album, images: [{ url: 'https://i.example/gross.jpg', width: 640 },
                                      { url: 'https://i.example/klein.jpg', width: 64 }] },
    })
    strictEqual(mitBild.bild, 'https://i.example/gross.jpg', 'die groesste Fassung, images[0]')
  })

  it('das Bild der Schlange schlaegt das kanonische — es ist das frischere', () => {
    const ausSchlange = { name: 'X', bild: 'https://i.example/aus-dem-zustand.jpg' }
    const heil = mitKanonischem(ausSchlange, { bild: 'https://i.example/nachgeschlagen.jpg' })
    strictEqual(heil.bild, 'https://i.example/aus-dem-zustand.jpg')
    // Umgekehrt fuellt das Kanonische die Luecke — der Fall des Nachschnitts,
    // dessen Eintrag aus der Zeit vor E135/1c stammt und kein Bild hat.
    strictEqual(mitKanonischem({ name: 'X', bild: '' }, { bild: 'https://i.example/n.jpg' }).bild,
                'https://i.example/n.jpg')
  })

  it('gibt bei einer leeren oder kaputten Antwort ehrlich null', () => {
    strictEqual(kanonischesAus(null), null)
    strictEqual(kanonischesAus({}), null)
    strictEqual(kanonischesAus({ error: { status: 404 } }), null)
  })

  it('das Kanonische GEWINNT gegen den Pfad-Namen der Schlange', () => {
    // Genau der Teil-05-Fall: die Schlange kennt nur den gesaeuberten Namen.
    const ausSchlange = {
      uri: 'spotify:track:0G7NUtk2GRgXirBg9RcSxO',
      name: 'Hallo, Haroshee! - Teil 03',
      kuenstler: 'Hello Kitty Hörspiele',
      album: 'Folge 13_ Der Geist von Cherry Town',
      albumKuenstler: '',
      nummer: 5,
    }
    const heil = mitKanonischem(ausSchlange, kanonischesAus(roh))
    strictEqual(heil.album, 'Folge 13: Der Geist von Cherry Town')
    strictEqual(heil.albumKuenstler, 'Hello Kitty Hörspiele')
    strictEqual(heil.uri, ausSchlange.uri, 'die Kennung bleibt die der Schlange')
  })

  it('OHNE Kanonisches bleibt die Schlange unangetastet — der Rueckfall', () => {
    const ausSchlange = { name: 'X', album: 'Y_', nummer: 1 }
    strictEqual(mitKanonischem(ausSchlange, null), ausSchlange)
    const leer = mitKanonischem(ausSchlange, {})
    strictEqual(leer.name, 'X')
    strictEqual(leer.album, 'Y_')
    strictEqual(leer.nummer, 1)
  })

  it('der ORDNER verschiebt sich durch das Kanonische NICHT', () => {
    // saeubern ist idempotent: der huebsche und der gesaeuberte Albumname
    // ergeben denselben Ordner — nur die Tags werden wieder wahr.
    strictEqual(saeubern('Folge 13: Der Geist von Cherry Town'), saeubern('Folge 13_ Der Geist von Cherry Town'))
  })
})

describe('DIE ANNAHME: was am 22.08.2026 durchgerutscht ist', () => {
  /* DIE VIER FUNDSTUECKE, mit ihren ECHTEN Zahlen. Sie standen als `fertig`
   * in der Liste und als spielbare Kacheln in der Mediathek.
   *
   *   Datei                            Bytes   Dauer   mittel   Spitze
   *   02 La-Le-Lu.flac                 30902   175 s   -91,0    -91,0
   *   01 Elea Eluanda Titellied.flac   10850    61 s   -91,0    -91,0
   *   02 Bibi Blocksberg Titellied     15695    89 s   -91,0    -91,0
   *   08 Gute Nacht.flac               31640   179 s   -91,0    -91,0
   *
   * Alle vier liegen UEBER der Byte-Grenze von 10 000 — deshalb hat die alte
   * Pruefung sie durchgelassen. Stille wiegt 177 B/s; die Grenze faellt bei
   * 56,5 Sekunden.
   */
  const STILL = [
    ['02 La-Le-Lu', 30902, 175],
    ['01 Elea Eluanda Titellied', 10850, 61],
    ['02 Bibi Blocksberg Titellied', 15695, 89],
    ['08 Gute Nacht', 31640, 179],
  ]

  it('ALLE VIER WERDEN JETZT ABGELEHNT — und die Byte-Grenze haette sie genommen', () => {
    for (const [name, gross, dauerSek] of STILL) {
      ok(gross > 10_000, `${name}: liegt ueber der alten Grenze, sonst prueft dieser Fall nichts`)
      const u = annahmeUrteil({ gross, spitze: -91, mittel: -91, dauerSek })
      strictEqual(u.ok, false, name)
      strictEqual(u.wort, 'still', name)
    }
  })

  it('DIE ZWEI VERMEINTLICH GESUNDEN DESSELBEN ABENDS GEHEN DURCH', () => {
    // Sonst haette man eine Wache gebaut, die alles anklagt. Beide sind zwar
    // zur Haelfte still, im MITTEL aber weit ueber der Schwelle — sie fallen
    // dem Abgriff-Fix zum Opfer, nicht diesem hier.
    strictEqual(annahmeUrteil({ gross: 14_193_581, spitze: -3.8, mittel: -17.5, dauerSek: 213 }).ok, true)
    strictEqual(annahmeUrteil({ gross: 22_178_973, spitze: -2.5, mittel: -16.8, dauerSek: 206 }).ok, true)
  })

  it('eine LEISE, aber echte Aufnahme wird NICHT verworfen', () => {
    // Der teuerste Fehler waere, echte Mitschnitte wegzuwerfen.
    const u = annahmeUrteil({ gross: 8_000_000, spitze: -12, mittel: -38, dauerSek: 200 })
    strictEqual(u.ok, true)
    strictEqual(u.wort, 'leise')
  })

  it('DIE BYTE-GRENZE BLEIBT — sie faengt den Abbruch, den der Pegel nicht sieht', () => {
    // Eine Datei mit 400 B kann lauten Ton enthalten; sie ist nur nach einer
    // halben Sekunde abgerissen. Beide Pruefungen tragen verschiedene Faelle.
    const u = annahmeUrteil({ gross: 400, spitze: -3, mittel: -14, dauerSek: 0.4 })
    strictEqual(u.ok, false)
    ok(u.grund.includes('nichts aufgenommen'), u.grund)
  })

  it('zu kurz bleibt zu kurz, auch wenn es laut ist', () => {
    strictEqual(annahmeUrteil({ gross: 2_000_000, spitze: -3, mittel: -14, dauerSek: 2 }).ok, false)
  })
})

describe('DIE NACHSCHAU: kaputte Mitschnitte finden, ohne die guten mitzunehmen', () => {
  /* Betreiberwunsch 29.08.2026: „ich habe eine gemischte aufzeichnung
   * gefunden, das kann von unserer entwicklungszeit kommen — da brauchen wir
   * noch einen mechanismus neu aufzeichnen zu lassen."
   *
   * Alle Zahlen hier sind AM GERAET GEMESSEN, nicht ausgedacht.
   */

  it('DIE VIER GANZ STILLEN werden erkannt', () => {
    for (const dauerSek of [175, 61, 89, 179]) {
      const b = mitschnittBefund({ mittel: -91, spitze: -91, dauerSek, stilleAb: 0 })
      strictEqual(b.gut, false, `${dauerSek}s`)
      strictEqual(b.wort, 'ganz still')
    }
  })

  it('DIE ZWEI GEMISCHTEN werden erkannt — im Mittel sind sie unauffaellig', () => {
    // Das ist der Fall, den der Betreiber gefunden hat und den `annahmeUrteil`
    // NICHT sehen kann: -17,5 dB ist ein voellig normaler Pegel.
    const feelings = mitschnittBefund({ mittel: -17.5, spitze: -3.8, dauerSek: 213, stilleAb: 119 })
    strictEqual(feelings.gut, false)
    strictEqual(feelings.wort, 'bricht in Stille ab')
    ok(feelings.anteil > 0.4, `44 % erwartet, gemessen ${feelings.anteil}`)

    const wandertag = mitschnittBefund({ mittel: -16.8, spitze: -2.5, dauerSek: 206, stilleAb: 152 })
    strictEqual(wandertag.gut, false)
    ok(wandertag.anteil > 0.25)

    // GEGENPROBE ZUR ANNAHME: dieselben Zahlen gehen dort durch — die beiden
    // Pruefungen sehen verschiedene Fehler, und das ist der Grund, warum es
    // zwei gibt.
    strictEqual(annahmeUrteil({ gross: 14_193_581, spitze: -3.8, mittel: -17.5, dauerSek: 213 }).ok, true)
  })

  it('VORLAUFSTILLE IST DER NORMALE ANFANG — nicht anfassen', () => {
    // Die wichtigste Zeile. Jede gesunde Aufnahme der Nachtcharge vom
    // 21.08.2026 beginnt mit silence_start: 0. Wer das fuer einen Fehler
    // haelt, wirft 31 einwandfreie Dateien weg.
    strictEqual(mitschnittBefund({ mittel: -12.6, spitze: -1.5, dauerSek: 281, stilleAb: 0 }).gut, true)
  })

  it('ein ABBRUCH faellt trotz gutem Pegel — Zauberbananen Teil 6', () => {
    // Am Geraet gemessen: 12 s bei -12,4 dB. Der Ton ist einwandfrei, die
    // Datei ist es nicht — sie ist nach zwoelf Sekunden abgerissen. Das faengt
    // die Mindestlaenge in `urteil`, nicht die Stille-Regel.
    //
    // Der Zeuge stand hier zuerst falsch herum („muss durchgehen"), weil ich
    // Teil 6 mit den gesunden Zauberbananen in einen Topf geworfen hatte. Die
    // Messung sagte etwas anderes als der Test — und die Messung hatte recht.
    const b = mitschnittBefund({ mittel: -12.4, spitze: -1.2, dauerSek: 12, stilleAb: 0 })
    strictEqual(b.gut, false)
    strictEqual(b.wort, 'zu kurz')
  })

  it('gar keine Stille gefunden heisst in Ordnung', () => {
    // 07 Ich bin ein Star — der passive Weg, an dem Abend der einzige gesunde.
    strictEqual(mitschnittBefund({ mittel: -15.5, spitze: -5.6, dauerSek: 171, stilleAb: null }).gut, true)
  })

  it('EIN AUSKLANG IST KEIN DEFEKT — unter 15 % bleibt es stehen', () => {
    // Hoerspiele enden oft leise. Wer jede Schlussstille anklagt, nimmt dem
    // Kind Titel weg, an denen nichts falsch ist.
    const knapp = mitschnittBefund({ mittel: -18, spitze: -4, dauerSek: 200, stilleAb: 190 })
    strictEqual(knapp.gut, true, '5 % Ausklang muss durchgehen')
    const zuviel = mitschnittBefund({ mittel: -18, spitze: -4, dauerSek: 200, stilleAb: 160 })
    strictEqual(zuviel.gut, false, '20 % ist kein Ausklang mehr')
  })

  it('eine unlesbare Datei wird nicht stillschweigend fuer gut erklaert', () => {
    strictEqual(mitschnittBefund({ mittel: -20, spitze: -3, dauerSek: 0, stilleAb: null }).gut, false)
    strictEqual(mitschnittBefund({ mittel: -20, spitze: -3, dauerSek: Number.NaN, stilleAb: null }).gut, false)
  })
})

/**
 * DIE FREIE FLAECHE DER VERWALTUNG (E97/E98) — `http/liste` und
 * `http/vormerken`, Betreiberwunsch: „mir fehlt noch die verwaltung sowie
 * anstoßen". Derselbe Vertrag wie mixpi-ardsounds: `{status?, inhalt}`.
 */
describe('http — die freie Flaeche der Verwaltung', () => {
  const AURI = 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa'
  const BURI = 'spotify:track:bbbbbbbbbbbbbbbbbbbbbb'
  const CURI = 'spotify:track:cccccccccccccccccccccc'
  const ERLAUBT = { verstanden: true, spotify: true }

  function kontextMit(datenOrdner, einstellungen = {}) {
    return { datenOrdner, einstellungen, protokoll: () => {} }
  }

  async function tempOrdner() {
    return mkdtemp(join(tmpdir(), 'mixpi-http-'))
  }

  describe('GET liste', () => {
    it('meldet einen leeren Bestand ohne etwas zu erfinden', async () => {
      const ordner = await tempOrdner()
      try {
        const antwort = await mitschnitt.http({ methode: 'GET', pfad: 'liste', abfrage: {}, rumpf: null }, kontextMit(ordner))
        // `laufend: null`, wenn nichts aufgenommen wird — E126, Stufe 3.
        deepStrictEqual(antwort, {
          inhalt: { zusammenfassung: { offen: 0, fertig: 0, fehler: 0 }, laufend: null, eintraege: [] },
        })
      } finally {
        await rm(ordner, { recursive: true, force: true })
      }
    })

    it('liefert Zusammenfassung und Eintraege unter den vereinbarten Feldnamen', async () => {
      const ordner = await tempOrdner()
      try {
        // A bleibt offen, B wird fertig, C laeuft dreimal gegen die Wand und
        // bleibt mit Grund liegen (HOECHSTENS_VERSUCHE aus liste.mjs).
        await mitListe(ordner, (l) => {
          let x = vormerken(l, { uri: AURI, titel: 'Erster', interpret: 'Wer A', album: 'Album A' }, 'automatisch').liste
          x = vormerken(x, { uri: BURI, titel: 'Zweiter', interpret: 'Wer B', album: 'Album B' }, 'automatisch').liste
          x = abschliessen(x, BURI).liste
          x = vormerken(x, { uri: CURI, titel: 'Dritter', interpret: 'Wer C', album: 'Album C' }, 'automatisch').liste
          for (let i = 0; i < 3; i++) {
            x = beginnen(x, CURI).liste
            x = scheitern(x, CURI, 'Netzwerk kaputt').liste
          }
          return x
        })

        const antwort = await mitschnitt.http({ methode: 'GET', pfad: 'liste', abfrage: {}, rumpf: null }, kontextMit(ordner))
        strictEqual(antwort.status, undefined, '200 fehlt = 200, wie beim Vertrag mit dem Wirt')
        deepStrictEqual(antwort.inhalt.zusammenfassung, { offen: 1, fertig: 1, fehler: 1 })

        const a = antwort.inhalt.eintraege.find((e) => e.uri === AURI)
        deepStrictEqual(a, { uri: AURI, name: 'Erster', interpret: 'Wer A', album: 'Album A', stand: 'offen' })

        const b = antwort.inhalt.eintraege.find((e) => e.uri === BURI)
        strictEqual(b.stand, 'fertig')
        strictEqual(b.wort, undefined, 'ein leerer Grund ist kein "wort"')

        const c = antwort.inhalt.eintraege.find((e) => e.uri === CURI)
        strictEqual(c.stand, 'fehler')
        strictEqual(c.wort, 'Netzwerk kaputt')

        // KEIN gemerktAm — die Liste fuehrt keinen Zeitstempel.
        for (const e of antwort.inhalt.eintraege) ok(!('gemerktAm' in e), `${e.uri} darf kein gemerktAm erfinden`)
      } finally {
        await rm(ordner, { recursive: true, force: true })
      }
    })

    it('lehnt jedes andere Verb ab', async () => {
      const ordner = await tempOrdner()
      try {
        const antwort = await mitschnitt.http({ methode: 'POST', pfad: 'liste', abfrage: {}, rumpf: null }, kontextMit(ordner))
        strictEqual(antwort.status, 405)
      } finally {
        await rm(ordner, { recursive: true, force: true })
      }
    })
  })

  describe('POST neuladen', () => {
    const ERLAUBT = { verstanden: true, spotify: true }

    it('merkt MIT VORRANG vor — und mit Herkunft „hand"', async () => {
      const ordner = await tempOrdner()
      try {
        const rumpf = { titel: [{ uri: AURI, titel: 'Nochmal', interpret: 'Wer', album: 'Album' }] }
        const antwort = await mitschnitt.http(
          { methode: 'POST', pfad: 'neuladen', abfrage: {}, rumpf },
          kontextMit(ordner, ERLAUBT),
        )
        strictEqual(antwort.inhalt.ok, true)
        strictEqual(antwort.inhalt.vorgemerkt, 1)

        const liste = await mitschnitt.http({ methode: 'GET', pfad: 'liste', abfrage: {}, rumpf: null }, kontextMit(ordner))
        const e = liste.inhalt.eintraege[0]
        strictEqual(e.uri, AURI)
        strictEqual(e.vorrang, true, 'ein Neuladen-Wunsch gehoert nach vorn')
        // 'hand' ist der vorhandene Name (HERKUENFTE, liste.mjs). Ein
        // erfundener faellt still auf 'automatisch' — genau das fand dieser
        // Zeuge beim ersten Lauf.
        strictEqual(e.herkunft, 'hand')
      } finally {
        await rm(ordner, { recursive: true, force: true })
      }
    })

    it('holt einen LIEGENGEBLIEBENEN Titel aus dem Fehlerzustand zurueck', async () => {
      // DER EIGENTLICHE ZWECK DES KNOPFES (04.09.2026). `vormerken` allein
      // aendert an einem vorhandenen Eintrag nur Herkunft und Vorrang —
      // ein Titel auf `fehler` mit drei Versuchen bliebe unerreichbar,
      // denn `naechster()` nimmt nur `offen`. Der Endpunkt haette
      // `ok: true` gemeldet und NICHTS bewirkt.
      const ordner = await tempOrdner()
      try {
        // Erst hineinlegen und dreimal scheitern lassen — wie im Alltag.
        let l = vormerken(LISTE_LEER, { uri: AURI, titel: 'Segelflieger' }).liste
        // BEGINNEN ZAEHLT, SCHEITERN LIEST NUR (liste.mjs, Regel 3) — im
        // Alltag kommt das Paar immer zusammen. Ein Test, der nur
        // `scheitern` ruft, baut eine Lage, die es nie gibt.
        for (let i = 0; i < 3; i++) {
          l = beginnen(l, AURI).liste
          l = scheitern(l, AURI, 'Soloist: login failed: make sure --api-key is valid').liste
        }
        strictEqual(l.eintraege[0].zustand, 'fehler', 'Vorbedingung: der Titel liegt fest')
        await listeSchreiben(ordner, l)

        const antwort = await mitschnitt.http(
          { methode: 'POST', pfad: 'neuladen', abfrage: {}, rumpf: { titel: [{ uri: AURI }] } },
          kontextMit(ordner, ERLAUBT),
        )
        strictEqual(antwort.inhalt.befreit, 1)

        const liste = await mitschnitt.http({ methode: 'GET', pfad: 'liste', abfrage: {}, rumpf: null }, kontextMit(ordner))
        const e = liste.inhalt.eintraege[0]
        strictEqual(e.stand, 'offen', 'nach dem Knopf muss er wieder drankommen')
        strictEqual(e.versuche, undefined, 'die Zaehlung faengt von vorn an')
        strictEqual(e.vorrang, true)
      } finally {
        await rm(ordner, { recursive: true, force: true })
      }
    })

    it('laeuft OHNE kontext.protokoll durch — ein Protokollruf darf nie die Tat kosten', async () => {
      // GENAU DIESER FALL WAR AM 04.09.2026 KAPUTT: der Endpunkt rief ein
      // `protokoll`, das es in der http-Flaeche gar nicht gibt (nur im
      // Arbeiter-Weg wird es durchgereicht). Ergebnis: 502 „protokoll is not
      // defined", und die Verwaltung meldete „Das Vormerken hat nicht
      // geklappt". Die Test-Fixture LIEFERTE protokoll und deckte den Fehler
      // deshalb zu — hier wird ohne geprueft.
      const ordner = await tempOrdner()
      try {
        const rumpf = { titel: [{ uri: AURI, titel: 'Ohne Protokoll' }] }
        const antwort = await mitschnitt.http(
          { methode: 'POST', pfad: 'neuladen', abfrage: {}, rumpf },
          { datenOrdner: ordner, einstellungen: ERLAUBT },
        )
        strictEqual(antwort.inhalt?.ok, true, `statt ok kam: ${JSON.stringify(antwort.inhalt)}`)
      } finally {
        await rm(ordner, { recursive: true, force: true })
      }
    })

    it('ohne bestaetigte Rechtslage: 403, und nichts wird geschrieben', async () => {
      const ordner = await tempOrdner()
      try {
        const rumpf = { titel: [{ uri: AURI, titel: 'X' }] }
        const antwort = await mitschnitt.http(
          { methode: 'POST', pfad: 'neuladen', abfrage: {}, rumpf },
          kontextMit(ordner, {}),
        )
        strictEqual(antwort.status, 403)
        const liste = await mitschnitt.http({ methode: 'GET', pfad: 'liste', abfrage: {}, rumpf: null }, kontextMit(ordner))
        deepStrictEqual(liste.inhalt.eintraege, [])
      } finally {
        await rm(ordner, { recursive: true, force: true })
      }
    })

    it('verlangt einen Titel und laesst nur POST zu', async () => {
      const ordner = await tempOrdner()
      try {
        const leer = await mitschnitt.http(
          { methode: 'POST', pfad: 'neuladen', abfrage: {}, rumpf: { titel: [] } },
          kontextMit(ordner, ERLAUBT),
        )
        strictEqual(leer.status, 400)
        const verb = await mitschnitt.http(
          { methode: 'GET', pfad: 'neuladen', abfrage: {}, rumpf: null },
          kontextMit(ordner, ERLAUBT),
        )
        strictEqual(verb.status, 405)
      } finally {
        await rm(ordner, { recursive: true, force: true })
      }
    })
  })

  describe('POST vormerken', () => {
    it('ohne bestaetigte Rechtslage: 403 mit Klartext — wie der passive Weg', async () => {
      const ordner = await tempOrdner()
      try {
        const rumpf = { titel: [{ uri: AURI, name: 'Erster', interpret: 'Wer', album: 'Album' }] }
        const antwort = await mitschnitt.http({ methode: 'POST', pfad: 'vormerken', abfrage: {}, rumpf }, kontextMit(ordner, {}))
        strictEqual(antwort.status, 403)
        match(antwort.inhalt.fehler, /Rechtslage/)

        const nurDienst = await mitschnitt.http(
          { methode: 'POST', pfad: 'vormerken', abfrage: {}, rumpf },
          kontextMit(ordner, { verstanden: true }),
        )
        strictEqual(nurDienst.status, 403)
        match(nurDienst.inhalt.fehler, /spotify/)

        // NICHTS WURDE GESCHRIEBEN — die Ablehnung darf keine Nebenwirkung haben.
        const liste = await mitschnitt.http({ methode: 'GET', pfad: 'liste', abfrage: {}, rumpf: null }, kontextMit(ordner))
        deepStrictEqual(liste.inhalt.eintraege, [])
      } finally {
        await rm(ordner, { recursive: true, force: true })
      }
    })

    it('lehnt jedes andere Verb ab', async () => {
      const ordner = await tempOrdner()
      try {
        const antwort = await mitschnitt.http({ methode: 'GET', pfad: 'vormerken', abfrage: {}, rumpf: null }, kontextMit(ordner, ERLAUBT))
        strictEqual(antwort.status, 405)
      } finally {
        await rm(ordner, { recursive: true, force: true })
      }
    })

    it('verlangt ein Array "titel"', async () => {
      const ordner = await tempOrdner()
      try {
        const antwort = await mitschnitt.http(
          { methode: 'POST', pfad: 'vormerken', abfrage: {}, rumpf: { titel: 'kein Array' } },
          kontextMit(ordner, ERLAUBT),
        )
        strictEqual(antwort.status, 400)
      } finally {
        await rm(ordner, { recursive: true, force: true })
      }
    })

    it('merkt neue Titel vor — mit HERKUNFT hand, derselbe Schreibpfad wie vormerkenFuerSpaeter', async () => {
      const ordner = await tempOrdner()
      try {
        const rumpf = {
          titel: [
            { uri: AURI, name: 'Erster', interpret: 'Wer A', album: 'Album', albumKuenstler: 'Album-Kuenstler', dauerMs: 12345, kategorie: 'music' },
            { uri: BURI, name: 'Zweiter', interpret: 'Wer B', album: 'Album' },
          ],
        }
        const antwort = await mitschnitt.http({ methode: 'POST', pfad: 'vormerken', abfrage: {}, rumpf }, kontextMit(ordner, ERLAUBT))
        deepStrictEqual(antwort.inhalt, { vorgemerkt: 2, schonDa: 0, fertigUebersprungen: 0 })

        const { liste } = await mitListe(ordner, () => null)
        strictEqual(liste.eintraege.length, 2)
        const a = liste.eintraege.find((e) => e.uri === AURI)
        strictEqual(a.herkunft, 'hand', 'die Verwaltung merkt HAND vor, nicht automatisch')
        strictEqual(a.zustand, 'offen')
        strictEqual(a.titel, 'Erster')
        strictEqual(a.interpret, 'Wer A')
        strictEqual(a.album, 'Album')
        strictEqual(a.albumInterpret, 'Album-Kuenstler', 'albumKuenstler aus dem Rumpf wird zu albumInterpret')
      } finally {
        await rm(ordner, { recursive: true, force: true })
      }
    })

    it('ist idempotent: schon (offen) Vorgemerktes wird nicht doppelt gezaehlt', async () => {
      const ordner = await tempOrdner()
      try {
        const rumpf = { titel: [{ uri: AURI, name: 'Erster', interpret: 'Wer', album: 'Album' }] }
        const erster = await mitschnitt.http({ methode: 'POST', pfad: 'vormerken', abfrage: {}, rumpf }, kontextMit(ordner, ERLAUBT))
        deepStrictEqual(erster.inhalt, { vorgemerkt: 1, schonDa: 0, fertigUebersprungen: 0 })

        const zweiter = await mitschnitt.http({ methode: 'POST', pfad: 'vormerken', abfrage: {}, rumpf }, kontextMit(ordner, ERLAUBT))
        deepStrictEqual(zweiter.inhalt, { vorgemerkt: 0, schonDa: 1, fertigUebersprungen: 0 })

        // GEGENPROBE FUER DIE IDEMPOTENZ: es darf trotz zweier Aufrufe nur
        // EIN Eintrag entstanden sein — keine Dublette in der Liste.
        const { liste } = await mitListe(ordner, () => null)
        strictEqual(liste.eintraege.length, 1, 'zwei POSTs desselben Titels duerfen nur EINEN Eintrag ergeben')
      } finally {
        await rm(ordner, { recursive: true, force: true })
      }
    })

    it('ruehrt einen FERTIGEN Titel nicht an — Regel 1 aus liste.mjs gilt auch hier', async () => {
      const ordner = await tempOrdner()
      try {
        await mitListe(ordner, (l) => {
          const x = vormerken(l, { uri: AURI, titel: 'Erster', interpret: 'Wer', album: 'Album', nummer: 3 }, 'automatisch').liste
          return abschliessen(x, AURI).liste
        })
        const vorher = (await mitListe(ordner, () => null)).liste.eintraege.find((e) => e.uri === AURI)

        const rumpf = { titel: [{ uri: AURI, name: 'ANDERER NAME', interpret: 'ANDERER', album: 'ANDERES ALBUM' }] }
        const antwort = await mitschnitt.http({ methode: 'POST', pfad: 'vormerken', abfrage: {}, rumpf }, kontextMit(ordner, ERLAUBT))
        deepStrictEqual(antwort.inhalt, { vorgemerkt: 0, schonDa: 0, fertigUebersprungen: 1 })

        const nachher = (await mitListe(ordner, () => null)).liste.eintraege.find((e) => e.uri === AURI)
        deepStrictEqual(nachher, vorher, 'ein fertiger Eintrag bleibt byte-gleich stehen')
      } finally {
        await rm(ordner, { recursive: true, force: true })
      }
    })

    it('ignoriert Titel ohne brauchbare Spotify-Adresse, statt zu werfen', async () => {
      const ordner = await tempOrdner()
      try {
        const rumpf = { titel: [{ uri: 'nicht-spotify', name: 'Muell' }, { uri: AURI, name: 'Gueltig', interpret: 'Wer' }] }
        const antwort = await mitschnitt.http({ methode: 'POST', pfad: 'vormerken', abfrage: {}, rumpf }, kontextMit(ordner, ERLAUBT))
        deepStrictEqual(antwort.inhalt, { vorgemerkt: 1, schonDa: 0, fertigUebersprungen: 0 })
      } finally {
        await rm(ordner, { recursive: true, force: true })
      }
    })
  })

  it('unbekannter Pfad: 404 mit Klartext', async () => {
    const ordner = await tempOrdner()
    try {
      const antwort = await mitschnitt.http({ methode: 'GET', pfad: 'irgendwas', abfrage: {}, rumpf: null }, kontextMit(ordner, ERLAUBT))
      strictEqual(antwort.status, 404)
    } finally {
      await rm(ordner, { recursive: true, force: true })
    }
  })
})
