import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ABSTUFUNGEN,
  aenderungAnwenden,
  dienstVon,
  type Eintrag,
  filtern,
  findeIndex,
  gleicherListenTitel,
  gruppiereMitVerschmelzung,
  gruppiereTreffer,
  interpretSchluesselAus,
  interpretSchluesselTeile,
  istAbstufung,
  coverAufBoxRelativieren,
  spotifyAbruf,
  spotifyTitelPfad,
  jellyfinZugangAus,
  jellyfinZugangAusListe,
  listenTitelAus,
  medienSchluessel,
  meinenDasselbe,
  mitGeputztemTitel,
  mitSchluessel,
  neuerEintrag,
  normal,
  pluginKennungAus,
  REGELN_LOCKER,
  REGELN_NORMAL,
  REGELN_STRENG,
  schonVorhanden,
  titelOhneAdresse,
} from './medien'

/**
 * Tests der Medienverwaltung.
 *
 * Der wichtigste Teil sind die Schlüssel: über sie wird GELÖSCHT. Ein
 * Schlüssel, der zwei Einträge trifft oder sich beim Bearbeiten ändert,
 * löscht irgendwann den falschen — deshalb steht das hier fest.
 *
 * Die Beispiele sind echte Einträge aus der Box (gekürzt).
 */

const spotifyListe: Eintrag = {
  type: 'spotify',
  category: 'music',
  title: 'Guck mal diese Biene da Summ Summ',
  artist: 'Andrea68',
  playlistid: '37i9dQZF1DX5Ejj0EkURtP',
  cover: 'https://mosaic.scdn.co/640/abc',
}

const jellyfinAlbum: Eintrag = {
  type: 'jellyfin-album',
  category: 'music',
  id: 'e131865d504a657a93533722fc88bc90',
  artist: 'Das Lumpenpack',
  title: 'Die Zukunft wird groß',
  cover: 'http://192.168.178.199:8899/Items/e131865d/Images/Primary?api_key=GEHEIM123',
}

describe('Dienst erkennen', () => {
  it('ordnet die Typen den Diensten zu', () => {
    assert.equal(dienstVon(spotifyListe), 'spotify')
    assert.equal(dienstVon(jellyfinAlbum), 'jellyfin')
    assert.equal(dienstVon({ type: 'library' }), 'lokal')
    assert.equal(dienstVon({ type: 'radio' }), 'radio')
    assert.equal(dienstVon({ type: 'rss' }), 'rss')
    assert.equal(dienstVon({ type: 'etwas' }), 'anderes')
    assert.equal(dienstVon({} as Eintrag), 'anderes')
  })
})

describe('Schlüssel', () => {
  it('nimmt die Kennung des Dienstes, wenn es eine gibt', () => {
    assert.equal(medienSchluessel(jellyfinAlbum), 'jellyfin:e131865d504a657a93533722fc88bc90')
    assert.equal(medienSchluessel(spotifyListe), 'spotify:37i9dQZF1DX5Ejj0EkURtP')
  })

  it('bleibt beim Umbenennen und Umsortieren GLEICH', () => {
    // Genau darum geht es: die Verwaltung darf beschriften und die Kategorie
    // ändern, ohne dass der Eintrag seine Identität verliert.
    const vorher = medienSchluessel(jellyfinAlbum)
    const nachher = medienSchluessel(
      aenderungAnwenden(jellyfinAlbum, { title: 'Ganz anders', artist: 'X', category: 'audiobook' }),
    )
    assert.equal(vorher, nachher)
  })

  it('faellt ohne Kennung auf Interpret und Titel zurueck', () => {
    const a: Eintrag = { type: 'library', title: 'Die Grosse Reise', artist: 'Wer Auch Immer' }
    assert.equal(medienSchluessel(a), 'lokal:t:wer auch immer|die grosse reise')
  })

  it('behandelt Umlaute und ss vergleichbar', () => {
    // normal() wirft alles weg, was kein a-z0-9 ist - aus 'gross' wird
    // 'gro s'. Das ist unschoen, aber KONSISTENT, und darauf kommt es an:
    // derselbe Eintrag ergibt immer denselben Schluessel.
    const eins: Eintrag = { type: 'library', title: 'Die Grosse Reise', artist: 'A' }
    const zwei: Eintrag = { type: 'library', title: 'Die  GROSSE   Reise!', artist: 'a' }
    assert.equal(medienSchluessel(eins), medienSchluessel(zwei))
  })

  it('unterscheidet gleiche Titel in verschiedenen Diensten', () => {
    const s: Eintrag = { type: 'spotify', title: 'Gleich', artist: 'Gleich' }
    const j: Eintrag = { type: 'jellyfin-album', title: 'Gleich', artist: 'Gleich' }
    assert.notEqual(medienSchluessel(s), medienSchluessel(j))
  })
})

describe('Eintrag finden', () => {
  const liste = [spotifyListe, jellyfinAlbum]

  it('findet den richtigen', () => {
    assert.equal(findeIndex(liste, medienSchluessel(jellyfinAlbum)), 1)
  })

  it('gibt -1 fuer Unbekanntes', () => {
    assert.equal(findeIndex(liste, 'spotify:gibtesnicht'), -1)
    assert.equal(findeIndex(liste, ''), -1)
  })

  it('gibt -1 bei DOPPELTEN Schluesseln, statt zu raten', () => {
    // Zwei gleiche Eintraege: welcher war gemeint? Keiner - lieber nichts tun
    // als den falschen loeschen.
    assert.equal(findeIndex([jellyfinAlbum, { ...jellyfinAlbum }], medienSchluessel(jellyfinAlbum)), -1)
  })
})

describe('Aenderungen', () => {
  it('uebernimmt Kategorie, Titel, Interpret', () => {
    const n = aenderungAnwenden(spotifyListe, { category: 'audiobook', title: 'Neu', artist: 'Neuer' })
    assert.equal(n.category, 'audiobook')
    assert.equal(n.title, 'Neu')
    assert.equal(n.artist, 'Neuer')
  })

  it('laesst Kennung und Typ IN RUHE, auch wenn jemand sie mitschickt', () => {
    // Sonst zeigt der Eintrag nach dem Bearbeiten auf nichts mehr.
    const n = aenderungAnwenden(jellyfinAlbum, { id: 'gekapert', type: 'spotify', category: 'other' })
    assert.equal(n.id, jellyfinAlbum.id)
    assert.equal(n.type, 'jellyfin-album')
    assert.equal(n.category, 'other')
  })

  it('weist unbekannte Kategorien ab', () => {
    assert.equal(aenderungAnwenden(spotifyListe, { category: 'quatsch' }).category, 'music')
  })

  it('laesst den TITEL nie leer werden', () => {
    // Eine Kachel ohne Beschriftung ist auf der Box nicht wiederzufinden.
    const n = aenderungAnwenden(spotifyListe, { title: '   ' })
    assert.equal(n.title, spotifyListe.title)
  })

  it('laesst den INTERPRETEN leeren', () => {
    // Bei einer Spotify-LISTE ist der voreingetragene "Interpret" oft nur der
    // Benutzer, dem sie gehoert ("Andrea68") - lieber gar nichts als das.
    const n = aenderungAnwenden(spotifyListe, { artist: '  ' })
    assert.equal(n.artist, '')
  })
})

// ══ DIE WACHE GEGEN ADRESSEN IM TITEL (06.08.2026) ═════════════════════════
//
// DER ECHTE WERT VON DER BOX .169, am 04.08.2026 in data.json gefunden:
//
//     "EMMA6 - Completehttp://192.168.178.169:8200/assets/images/nocover_mupi.png"
//
// Die URSACHE ist NICHT belegt — im Quelltext steht fuer dieses Bild ueberall
// der relative Pfad und nirgends eine absolute Adresse mit der IP der Box.
// Deshalb keine Ursachenreparatur, sondern eine Wache am Schreibweg.
//
// DIE HAELFTE DIESER FAELLE PRUEFT, DASS SIE NICHTS TUT. Eine Wache, die einen
// legitimen Titel zerstoert, waere schlimmer als der Fehler, den sie
// verhindert: der eine Eintrag von .169 war sichtbar kaputt, ein still
// beschnittener Titel waere es nicht.
describe('Wache gegen Adressen im Titel', () => {
  it('schneidet die angeklebte Adresse ab — der Fall von der Box', () => {
    assert.equal(
      titelOhneAdresse('EMMA6 - Completehttp://192.168.178.169:8200/assets/images/nocover_mupi.png'),
      'EMMA6 - Complete',
    )
  })

  it('nimmt auch https und eine Adresse mit Leerzeichen davor', () => {
    assert.equal(titelOhneAdresse('Die Maus https://api.ardaudiothek.de/bild/81889970_512.jpg'), 'Die Maus')
    assert.equal(titelOhneAdresse('Vorn http://x.invalid/a.png hinten'), 'Vorn hinten')
  })

  it('LAESST EINEN LEGITIMEN TITEL IN RUHE — Zeichen fuer Zeichen', () => {
    // Alles, was ein Kinderzimmer hergibt: Schraegstriche, Doppelpunkte,
    // Fragezeichen, Umlaute. Keiner davon traegt `://`.
    for (const gut of [
      'Die drei ??? und der Karpatenhund',
      'AC/DC',
      'Folge 12: Der Fluch',
      'Bibi & Tina - Das Lied',
      'TKKG Junior 1/2',
      'Ähm... hallo?',
      'Der Schneemann taut',
    ]) {
      assert.equal(titelOhneAdresse(gut), gut, gut)
    }
  })

  it('MACHT EINEN TITEL NIE LEER — auch wenn nur eine Adresse dasteht', () => {
    // Eine Kachel ohne Beschriftung ist auf der Box nicht wiederzufinden.
    // Bliebe nach dem Schnitt nichts uebrig, bleibt alles wie es war.
    const nur = 'http://192.168.178.169:8200/assets/images/nocover_mupi.png'
    assert.equal(titelOhneAdresse(nur), nur)
  })

  it('gilt an BEIDEN neuen Schreibwegen', () => {
    const dreck = 'EMMA6 - Completehttp://192.168.178.169:8200/assets/images/nocover_mupi.png'
    assert.equal(neuerEintrag({ type: 'spotify', id: 'x', title: dreck })?.title, 'EMMA6 - Complete')
    assert.equal(aenderungAnwenden(spotifyListe, { title: dreck }).title, 'EMMA6 - Complete')
  })

  it('gilt auch am ALTEN Schreibweg, der den Rumpf unveraendert ablegt', () => {
    // `/api/add` und `/api/edit` gehen an `neuerEintrag` VORBEI — sie schreiben
    // `req.body` bzw. `req.body.data` direkt nach data.json. Das ist der Weg,
    // auf dem der Wert von .169 dort gelandet sein kann.
    const roh = { type: 'spotify', id: 'x', title: 'A http://y.invalid/z.png', category: 'music', extra: 1 }
    const raus = mitGeputztemTitel(roh)
    assert.equal(raus.title, 'A')
    // ALLES ANDERE BLEIBT — diese Routen duerfen weiter schreiben, was ein
    // Formular schickt. Nur der Titel geht durch die Wache.
    assert.equal(raus.extra, 1)
    assert.equal(raus.category, 'music')
  })

  it('gibt DASSELBE Objekt zurueck, wenn nichts zu tun ist', () => {
    // Kein unnoetiges Kopieren an einem Weg, der bei jedem Speichern laeuft —
    // und der Beweis, dass ein sauberer Titel wirklich unberuehrt bleibt.
    const roh = { type: 'spotify', id: 'x', title: 'Die drei ???' }
    assert.equal(mitGeputztemTitel(roh), roh)
    assert.equal(mitGeputztemTitel(null), null)
    assert.equal(mitGeputztemTitel(undefined), undefined)
  })
})

describe('Neue Eintraege', () => {
  it('baut einen gueltigen Eintrag aus einem Treffer', () => {
    const e = neuerEintrag({
      type: 'jellyfin-album',
      id: 'abc123',
      title: 'Ein Album',
      artist: 'Wer',
      cover: 'http://x/y',
    })
    assert.equal(e?.type, 'jellyfin-album')
    assert.equal(e?.category, 'music') // Vorgabe
    assert.equal(e?.id, 'abc123')
  })

  it('weist Eintraege ohne Kennung ab', () => {
    // Eine Kachel, die beim Antippen nichts tut, ist schlimmer als keine.
    assert.equal(neuerEintrag({ type: 'spotify', title: 'Ohne alles' }), null)
  })

  it('weist Eintraege ohne Titel und ohne Typ ab', () => {
    assert.equal(neuerEintrag({ type: 'spotify', id: 'x' }), null)
    assert.equal(neuerEintrag({ title: 'Nur Titel' }), null)
  })

  it('erkennt Dubletten', () => {
    assert.equal(schonVorhanden([spotifyListe, jellyfinAlbum], { ...jellyfinAlbum }), true)
    assert.equal(schonVorhanden([spotifyListe], { ...jellyfinAlbum }), false)
  })
})

describe('Suche in der eigenen Bibliothek', () => {
  const liste = mitSchluessel([spotifyListe, jellyfinAlbum])

  it('findet ueber Titel und Interpret', () => {
    assert.equal(filtern(liste, 'lumpenpack').length, 1)
    assert.equal(filtern(liste, 'biene').length, 1)
  })

  it('findet ueber den DIENST', () => {
    assert.equal(filtern(liste, 'jellyfin').length, 1)
    assert.equal(filtern(liste, 'spotify').length, 1)
  })

  it('verlangt ALLE Woerter', () => {
    assert.equal(filtern(liste, 'lumpenpack zukunft').length, 1)
    assert.equal(filtern(liste, 'lumpenpack biene').length, 0)
  })

  it('ist unempfindlich gegen Gross- und Kleinschreibung', () => {
    assert.equal(filtern(liste, 'LUMPENPACK').length, 1)
  })

  it('gibt bei leerer Suche alles zurueck', () => {
    assert.equal(filtern(liste, '  ').length, 2)
  })
})

describe('Jellyfin-Zugang aus einer Bildadresse', () => {
  it('holt Server und Schluessel heraus', () => {
    const z = jellyfinZugangAus(jellyfinAlbum.cover)
    assert.equal(z?.server, 'http://192.168.178.199:8899')
    assert.equal(z?.schluessel, 'GEHEIM123')
  })

  it('gibt null zurueck, wenn nichts drin ist', () => {
    assert.equal(jellyfinZugangAus('http://x/ohne'), null)
    assert.equal(jellyfinZugangAus(undefined), null)
  })

  it('findet ihn in der Bibliothek', () => {
    assert.equal(jellyfinZugangAusListe([spotifyListe, jellyfinAlbum])?.schluessel, 'GEHEIM123')
    assert.equal(jellyfinZugangAusListe([spotifyListe]), null)
  })
})

describe('Spotify-Abrufart: Playlist, Podcast oder Album?', () => {
  // Der Fall, aus dem das entstand (Box .81, 06.09.2026): „Quarks Science
  // Cops" stand als `audiobookid` in der Bibliothek und zeigte NULL Folgen —
  // die Kennung wurde aus `id ?? playlistid` gelesen, beide leer.
  it('erkennt den Podcast, auch wenn er als audiobookid abgelegt ist', () => {
    assert.deepEqual(spotifyAbruf({ type: 'spotify', audiobookid: '0rQTpxXFmKsC8vu6O56KNk' }), {
      kennung: '0rQTpxXFmKsC8vu6O56KNk',
      art: 'show',
    })
    assert.deepEqual(spotifyAbruf({ showid: 'abc' }), { kennung: 'abc', art: 'show' })
  })

  it('nimmt die Playlist ZUERST — sie kann nebenbei ein id-Feld tragen', () => {
    assert.deepEqual(spotifyAbruf({ playlistid: 'pl1', id: 'al1' }), { kennung: 'pl1', art: 'playlist' })
  })

  it('faellt auf Album zurueck und gibt bei Leerem ehrlich null', () => {
    assert.deepEqual(spotifyAbruf({ id: 'al1' }), { kennung: 'al1', art: 'album' })
    assert.equal(spotifyAbruf({}), null)
    assert.equal(spotifyAbruf({ id: '   ' }), null)
    assert.equal(spotifyAbruf(null), null)
  })

  it('baut je Art den richtigen Web-API-Pfad', () => {
    // Der eigentliche Fehler: ein Podcast lief in `albums/<id>/tracks` und
    // bekam 404 — die Kachel blieb still leer.
    assert.match(spotifyTitelPfad({ kennung: 'x', art: 'show' }, 0, 50), /^shows\/x\/episodes\?limit=50/)
    assert.match(spotifyTitelPfad({ kennung: 'x', art: 'album' }, 0, 50), /^albums\/x\/tracks\?/)
    assert.match(spotifyTitelPfad({ kennung: 'x', art: 'playlist' }, 0, 100), /^playlists\/x\/tracks\?/)
  })

  it('rechnet den Versatz je Seite richtig', () => {
    assert.match(spotifyTitelPfad({ kennung: 'x', art: 'show' }, 2, 50), /offset=100/)
  })
})

describe('Cover auf die Box relativieren', () => {
  // Der Geraetebefund dahinter: AUDIT-2026-09-05-B §4 — 35 von 42 Covern
  // trugen den Wirtsnamen, und der loeste zeitweise auf eine tote
  // Schnittstellen-IPv6 auf. Relativ ist immun.
  it('nimmt jedem Box-Cover den Wirt ab — egal unter welchem Namen', () => {
    assert.equal(
      coverAufBoxRelativieren('http://MixPiBox:8200/cover/audiobook/Conni/cover.jpg'),
      '/cover/audiobook/Conni/cover.jpg',
    )
    assert.equal(coverAufBoxRelativieren('http://192.168.178.62:8200/cover/music/A/b.png'), '/cover/music/A/b.png')
    assert.equal(coverAufBoxRelativieren('https://mupibox.fritz.box:8200/cover/x/y.jpg'), '/cover/x/y.jpg')
  })

  it('laesst fremde Adressen IN RUHE — auch die mit api_key', () => {
    // Die Jellyfin-Adresse traegt den Zugang, aus dem jellyfinZugangAus()
    // den Schluessel gewinnt; relativiert waere er verloren.
    const jf = 'http://192.168.178.199:8899/Items/1/Images/Primary?api_key=GEHEIM123'
    assert.equal(coverAufBoxRelativieren(jf), jf)
    const cdn = 'https://i.scdn.co/image/ab67616d0000b273'
    assert.equal(coverAufBoxRelativieren(cdn), cdn)
    // Port 8200, aber KEIN /cover/-Pfad: das ist nicht die Signatur.
    assert.equal(coverAufBoxRelativieren('http://MixPiBox:8200/assets/x.png'), 'http://MixPiBox:8200/assets/x.png')
  })

  it('laesst Relatives, data-URIs und Leeres unveraendert', () => {
    assert.equal(coverAufBoxRelativieren('/cover/music/A/b.jpg'), '/cover/music/A/b.jpg')
    assert.equal(coverAufBoxRelativieren('data:image/jpeg;base64,xyz'), 'data:image/jpeg;base64,xyz')
    assert.equal(coverAufBoxRelativieren(undefined), '')
  })
})

describe('Normalisieren', () => {
  it('macht Vergleichbares vergleichbar', () => {
    assert.equal(normal('Die Zukunft wird groß!'), normal('die zukunft wird groß'))
    assert.equal(normal('  A—B  '), 'a b')
    assert.equal(normal(null), '')
  })

  it('BLEIBT, wie es ist — auf ihm steht die Medienauswahl der Kinder', () => {
    // Diese Zeile ist kein Test einer Eigenschaft, sondern eine SPERRE. Der
    // Ersatzschluessel eines Eintrags ohne Dienstkennung wird hieraus gebaut
    // (medienSchluessel), und profile/<kind>/auswahl.json steht darauf. Wer
    // `normal()` verbessert, verschiebt still die Auswahl jedes Kindes.
    assert.equal(
      medienSchluessel({ type: 'spotify', artist: 'Unknown', title: 'External Playback' }),
      'spotify:t:unknown|external playback',
    )
  })
})

describe('Schlüssel des Interpreten', () => {
  // ══ DER FUND, um den es geht (E45-Bestandsreview, 19.08.2026) ═════════════
  it('haelt „Die drei ???" und „Die drei !!!" AUSEINANDER', () => {
    // Beides sind echte Kosmos-Kinderserien; die Box fuehrt „Die drei ???".
    // Unter `normal()` ergaben beide „die drei" — eine Kachel fuer zwei, und
    // wer die eine freischaltete, loeschte still die andere.
    assert.notEqual(interpretSchluesselAus('Die drei ???'), interpretSchluesselAus('Die drei !!!'))
    assert.equal(interpretSchluesselAus('Die drei ???'), 'die drei ???')
    assert.equal(interpretSchluesselAus('Die drei !!!'), 'die drei !!!')
    // GEGENPROBE: mit der alten Regel faellt genau das zusammen. Steht diese
    // Zeile eines Tages nicht mehr, ist `normal()` nicht mehr die alte Regel —
    // dann gehoert dieser ganze Block noch einmal durchdacht.
    assert.equal(normal('Die drei ???'), normal('Die drei !!!'))
  })

  it('bleibt bei der SCHREIBWEISE so grosszuegig wie vorher', () => {
    const soll = 'die drei ???'
    // Gross/klein, fehlendes Leerzeichen, doppelte Leerzeichen, Gedankenstrich
    // — alles Schreibweisen DESSELBEN Namens.
    for (const n of ['Die drei ???', 'DIE DREI ???', 'Die Drei???', 'die  drei   ???', ' die-drei ??? ']) {
      assert.equal(interpretSchluesselAus(n), soll, n)
    }
  })

  it('zerlegt Mehrnamen-Strings NUR am Komma — der Gruppenname bleibt ein Name', () => {
    // "Team Karacho, ANOTHER NGUYEN" sind zwei Interpreten in einem Feld
    // (12.09.2026: solche Alben fielen aus dem Kreis "Team Karacho").
    assert.deepEqual(interpretSchluesselTeile('Team Karacho, ANOTHER NGUYEN'), ['team karacho', 'another nguyen'])
    // Das & trennt NICHT: "Karsten Glück & die Kita-Frösche" bleibt EIN
    // Teil (das &-Zeichen selbst faellt als Wort-Klebstoff aus dem
    // Schluessel, siehe den Zeugen darueber — getrennt wird daran nichts).
    // Wer hier trennte, erfaende Interpreten, die es nicht gibt.
    assert.deepEqual(interpretSchluesselTeile('Simone Sommerland, Karsten Glück & die Kita-Frösche'), [
      'simone sommerland',
      'karsten gluck die kita frosche',
    ])
    // Ein Einzelname bleibt ein Teil, Leeres faellt ganz heraus.
    assert.deepEqual(interpretSchluesselTeile('Team Karacho'), ['team karacho'])
    assert.deepEqual(interpretSchluesselTeile('  ,  '), [])
  })

  it('wirft den Klebstoff zwischen Woertern weiter weg', () => {
    // Die echten Namen der Box (03.08.2026). Ihr Schluessel darf sich durch
    // die Umstellung NICHT aendern — sonst waere es eine Wanderung statt einer
    // Reparatur.
    for (const n of [
      'EUROPA Hörspiele & Kinderlieder',
      'lismio: Kids - Hörbücher & Musik',
      'matze.sp.hh',
      'jasche-98',
      'Team Karacho, Rola',
      'Ruby van der Bogen, 101 fabelhafte Freunde',
      'Das Lumpenpack',
      'Die Maus',
      'AC/DC',
      "Guns N' Roses",
    ]) {
      assert.equal(interpretSchluesselAus(n), normal(n), n)
    }
  })

  it('haelt zusammengesetzte und zerlegte Umlaute zusammen', () => {
    // „Bjö" kommt aus einer Jellyfin-Datenbank mal so, mal so daher.
    assert.equal(interpretSchluesselAus('Björn'), interpretSchluesselAus('Björn'))
    assert.equal(interpretSchluesselAus('Björn'), 'bjorn')
  })

  it('verliert den ersten Buchstaben einer Zierschrift NICHT MEHR', () => {
    // `normal()` schreibt klein VOR NFKD; „𝓛" hat keine Kleinform, wird erst
    // danach zu „L" — und faellt dann als Nicht-a-z heraus.
    assert.equal(normal('𝓛𝓮𝓸𝓷𝓲𝓮♡'), 'eonie')
    assert.equal(interpretSchluesselAus('𝓛𝓮𝓸𝓷𝓲𝓮♡'), 'leonie ♡')
  })

  it('laesst Buchstaben ausserhalb von a-z stehen', () => {
    // `normal()` machte aus „Straße" ein „stra e" und aus einem kyrillischen
    // Namen die LEERE Zeichenkette — und leer heisst in werkAus() „gar kein
    // Regal". Ein ganzer Interpret war damit unsichtbar.
    assert.equal(normal('Straße'), 'stra e')
    assert.equal(interpretSchluesselAus('Straße'), 'straße')
    assert.equal(normal('Мумий Тролль'), '')
    assert.notEqual(interpretSchluesselAus('Мумий Тролль'), '')
  })

  it('bleibt LEER, wo gar kein Name steht', () => {
    // Sonst landeten alle namenlosen Eintraege in EINEM Regal — llmwiki
    // [regal-je-interpret-gegen-verschmelzen], Regel 1.
    for (const n of ['', '   ', '- . ,', null, undefined]) {
      assert.equal(interpretSchluesselAus(n), '')
    }
  })

  it('bleibt LEER, wo nur Zeichen ohne einen Buchstaben stehen', () => {
    // „???" ist in getaggten Bibliotheken der Platzhalter fuer „unbekannt".
    // Ein Schluessel daraus waere derselbe Sammelposten wie oben — `normal()`
    // hat ihn genauso zurueckgewiesen, nur beilaeufig statt ausgesprochen.
    for (const n of ['???', '!!!', '♡', '🩵 🩵']) {
      assert.equal(interpretSchluesselAus(n), '', n)
      assert.equal(normal(n), '', `${n} — die alte Regel sagte dasselbe`)
    }
    // ABER: mit einem Namen davor zaehlt genau dasselbe Zeichenwort.
    assert.equal(interpretSchluesselAus('Die drei ???'), 'die drei ???')
  })

  it('macht aus einem Emoji EIN Zeichenwort, nicht zwei Haelften', () => {
    // Ueber Codepunkte gelaufen. Sonst zerfiele das Surrogatpaar in zwei
    // Zeichenwoerter, und der Schluessel haette eine Luecke.
    assert.equal(interpretSchluesselAus('🩵Jojo 🩵'), '🩵 jojo 🩵')
  })
})

describe('Gleiches Album in mehreren Diensten', () => {
  const mach = (dienst: string, title: string, artist: string, titelAnzahl?: number) => ({
    dienst,
    art: 'album',
    title,
    artist,
    ...(titelAnzahl === undefined ? {} : { titelAnzahl }),
  })

  it('erkennt dasselbe Album in Spotify und Jellyfin', () => {
    const g = gruppiereTreffer([
      mach('spotify', 'Die Zukunft wird groß', 'Das Lumpenpack', 12),
      mach('jellyfin', 'Die Zukunft wird groß', 'Das Lumpenpack', 12),
    ])
    assert.equal(g[0].gruppe, g[1].gruppe)
    assert.deepEqual(g[0].auchIn, ['jellyfin'])
    assert.deepEqual(g[1].auchIn, ['spotify'])
  })

  it('vergleicht Interpreten LOSE', () => {
    // Jellyfin haengt oft Gaeste an: "Das Lumpenpack; Peter Balboa".
    const g = gruppiereTreffer([
      mach('spotify', 'Diskrepanz', 'Das Lumpenpack'),
      mach('jellyfin', 'Diskrepanz', 'Das Lumpenpack; Peter Balboa'),
    ])
    assert.equal(g[0].gruppe, g[1].gruppe)
  })

  it('wirft Deluxe und Standard NICHT zusammen', () => {
    // Gleicher Name, andere Titelzahl - das ist eine andere Ausgabe.
    const g = gruppiereTreffer([
      mach('spotify', 'Steil II', 'Das Lumpenpack', 14),
      mach('jellyfin', 'Steil II', 'Das Lumpenpack', 12),
    ])
    assert.notEqual(g[0].gruppe, g[1].gruppe)
    assert.deepEqual(g[0].auchIn, [])
  })

  it('fasst ZWEI Ausgaben DESSELBEN Dienstes nicht zusammen', () => {
    // Spotify listet oft mehrere Pressungen - die sind wirklich mehrere.
    const g = gruppiereTreffer([mach('spotify', 'WACH', 'Das Lumpenpack'), mach('spotify', 'WACH', 'Das Lumpenpack')])
    assert.notEqual(g[0].gruppe, g[1].gruppe)
  })

  it('vergleicht nur GLEICHE Arten', () => {
    const g = gruppiereTreffer([
      { dienst: 'spotify', art: 'album', title: 'Gleich', artist: 'A' },
      { dienst: 'jellyfin', art: 'playlist', title: 'Gleich', artist: 'A' },
    ])
    assert.notEqual(g[0].gruppe, g[1].gruppe)
  })

  it('kommt mit fehlenden Angaben zurecht', () => {
    assert.deepEqual(gruppiereTreffer([]), [])
    const g = gruppiereTreffer([
      { dienst: 'spotify', art: 'album', title: 'X' },
      { dienst: 'jellyfin', art: 'album', title: 'X' },
    ])
    assert.equal(g[0].gruppe, g[1].gruppe) // kein Interpret bekannt -> trennt nicht
  })
})

/**
 * `gruppiereMitVerschmelzung` — die Verwaltung zeigt, was schon FESTSTEHT
 * (W1, Befund 29.08.2026): bestätigte Zuordnungen (jede Stufe, auch „hand")
 * fassen zusammen, ausdrückliche Trennungen halten auseinander — beides,
 * auch wenn `meinenDasselbe()` allein anders entschiede. Die Bibliothek
 * (data.json) bleibt dabei unberührt: es wird GRUPPIERT, nicht gefiltert —
 * jeder Zeuge unten prüft deshalb auch, dass kein Eintrag verschwindet.
 */
describe('gruppiereMitVerschmelzung — bestaetigte Zuordnungen und Trennungen (W1)', () => {
  const mach = (dienst: string, schluessel: string, title: string, artist: string) => ({
    dienst,
    art: 'album',
    schluessel,
    title,
    artist,
  })

  it('fasst zwei Eintraege zusammen, die die Heuristik ALLEIN nicht zusammengelegt haette', () => {
    // Der Fall aus dem Befund: der Spotify-Eintrag wurde umbenannt oder der
    // Mitschnitt traegt einen anderen Interpreten — meinenDasselbe() sieht
    // keine Aehnlichkeit mehr, aber die Ablage hat die Zuordnung schon.
    const treffer = [
      mach('spotify', 's1', 'Steil II', 'Das Lumpenpack'),
      mach('lokal', 'l1', 'Ganz anderer Name', 'Unbekannt'),
    ]
    const ohne = gruppiereMitVerschmelzung(treffer)
    assert.notEqual(ohne[0].gruppe, ohne[1].gruppe, 'zur Gegenprobe: die Heuristik allein trennt hier wirklich')

    const g = gruppiereMitVerschmelzung(treffer, { zuordnungen: [{ schluessel: 's1', auch: ['l1'] }] })
    assert.equal(g.length, 2, 'nichts geht verloren')
    assert.equal(g[0].gruppe, g[1].gruppe)
    assert.deepEqual(g[0].auchIn, ['lokal'])
    assert.deepEqual(g[1].auchIn, ['spotify'])
  })

  it('haelt eine Zuordnung ohne Stufenangabe genauso zusammen — `gruppiereMitVerschmelzung` fragt nicht nach der Stufe', () => {
    // Die Ablage liefert nur gueltige Stufen (ablageAus verwirft alles
    // andere) — diese Funktion prueft die Stufe deshalb bewusst NICHT noch
    // einmal, auch „hand" gilt genauso wie „locker" oder „fingerabdruck".
    const treffer = [mach('spotify', 's1', 'A', 'X'), mach('lokal', 'l1', 'B', 'Y')]
    const g = gruppiereMitVerschmelzung(treffer, { zuordnungen: [{ schluessel: 's1', auch: ['l1'] }] })
    assert.equal(g[0].gruppe, g[1].gruppe)
  })

  it('haelt ein GETRENNTES Paar auseinander, obwohl die Heuristik sie zusammenwuerfe', () => {
    const treffer = [
      mach('spotify', 's1', 'Die Zukunft wird groß', 'Das Lumpenpack'),
      mach('jellyfin', 'j1', 'Die Zukunft wird groß', 'Das Lumpenpack'),
    ]
    // Zur Gegenprobe: OHNE `getrennt` wuerden sie zusammenfallen — sonst
    // waere der folgende Zeuge kein Beleg fuer irgendetwas.
    const ohne = gruppiereMitVerschmelzung(treffer)
    assert.equal(ohne[0].gruppe, ohne[1].gruppe)

    const g = gruppiereMitVerschmelzung(treffer, { getrennt: [['s1', 'j1']] })
    assert.equal(g.length, 2, 'nichts geht verloren')
    assert.notEqual(g[0].gruppe, g[1].gruppe)
    assert.deepEqual(g[0].auchIn, [])
    assert.deepEqual(g[1].auchIn, [])
  })

  it('trennt nur das GENANNTE Paar — der Rest einer groesseren Gruppe bleibt zusammen', () => {
    const treffer = [
      mach('spotify', 's1', 'Gleich', 'A'),
      mach('jellyfin', 'j1', 'Gleich', 'A'),
      mach('lokal', 'l1', 'Gleich', 'A'),
    ]
    const g = gruppiereMitVerschmelzung(treffer, { getrennt: [['s1', 'j1']] })
    const [s, j, l] = g
    assert.equal(g.length, 3)
    assert.notEqual(s.gruppe, j.gruppe)
    assert.equal(s.gruppe, l.gruppe, 'lokal bleibt beim Anfuehrer, nur jellyfin faellt heraus')
    assert.deepEqual(j.auchIn, [])
    assert.deepEqual(s.auchIn, ['lokal'])
  })

  it('uebergeht eine Zuordnung, die einen Schluessel nennt, den es hier nicht gibt', () => {
    // Dieselbe Zurueckhaltung wie in verschmelzeWerke(): ein geloeschter
    // Eintrag darf die Zuordnung nicht zum Fehler machen.
    const treffer = [mach('spotify', 's1', 'A', 'X')]
    const g = gruppiereMitVerschmelzung(treffer, { zuordnungen: [{ schluessel: 's1', auch: ['geloescht'] }] })
    assert.equal(g.length, 1)
    assert.equal(g[0].schluessel, 's1')
  })

  it('verbindet auch zwei heuristisch VERSCHIEDENE Gruppen ueber eine Zuordnung', () => {
    const treffer = [
      mach('spotify', 's1', 'Album A', 'X'),
      mach('jellyfin', 'j1', 'Album A', 'X'),
      mach('lokal', 'l1', 'Ganz anders', 'Y'),
    ]
    // s1/j1 sind heuristisch schon eine Gruppe; l1 kommt per Zuordnung dazu.
    const g = gruppiereMitVerschmelzung(treffer, { zuordnungen: [{ schluessel: 's1', auch: ['l1'] }] })
    const [s, j, l] = g
    assert.equal(g.length, 3)
    assert.equal(s.gruppe, j.gruppe)
    assert.equal(s.gruppe, l.gruppe)
    assert.deepEqual(s.auchIn, ['jellyfin', 'lokal'])
  })

  it('bleibt ohne jede Angabe BYTE FUER BYTE wie gruppiereTreffer — der Rueckweg', () => {
    const treffer = [mach('spotify', 's1', 'A', 'X'), mach('jellyfin', 'j1', 'B', 'Y')]
    assert.deepEqual(gruppiereMitVerschmelzung(treffer), gruppiereTreffer(treffer))
  })
})

/**
 * DER WORTSACK (E85) — dieselben Wörter, anders auf die Felder verteilt.
 *
 * Der Wert dieser Zeugen sind die GEGENBEISPIELE. Eine Regel, die „Science
 * Cops" findet, ist leicht; eine, die dabei „Quarks" nicht mitreißt, ist die
 * eigentliche Arbeit. Beide Fälle sind echt und stehen am 22.08.2026 so in
 * den Diensten.
 */
describe('meinenDasselbe — der Wortsack', () => {
  const t = (dienst: string, title: string, artist: string) => ({ dienst, art: 'show', title, artist })

  it('DER FUND: „Quarks Science Cops"/WDR und „Science Cops"/Quarks sind dasselbe', () => {
    // Betreiber, 22.08.2026: derselbe Podcast in ARD Sounds und Spotify, an
    // beiden Feldern vorbeigelaufen — der Titel trägt hier, was dort der
    // Interpret ist. Am Gerät nachgesehen: die ARD nennt die Sendung wirklich
    // „Quarks Science Cops" bei der Anstalt WDR.
    assert.equal(meinenDasselbe(t('ard', 'Quarks Science Cops', 'WDR'), t('spotify', 'Science Cops', 'Quarks')), true)
  })

  it('GEGENBEISPIEL 1: „Quarks" allein ist eine ANDERE Sendung', () => {
    // Ohne die Titelwort-Deckung risse die Teilmengen-Regel das hier mit:
    // {quarks, wdr} steckt vollständig in {quarks, science, cops, wdr}.
    // Es sind aber zwei Sendungen des WDR, und ein Titelwort von dreien
    // (33 %) ist zu wenig.
    assert.equal(meinenDasselbe(t('spotify', 'Quarks', 'WDR'), t('ard', 'Quarks Science Cops', 'WDR')), false)
  })

  it('GEGENBEISPIEL 2: hat JEDE Seite ein eigenes Wort, trennt die Teilmengen-Regel', () => {
    /* DIESER ZEUGE WAR EINMAL BLIND (Gegenprobe 22.08.2026). Er stand mit
     * GLEICHEN Titeln da („Greatest Hits"/Alpha gegen „Greatest Hits"/Beta) —
     * und gleiche Titel nehmen oben den alten, engeren Weg über
     * `interpretenPassen`. Regel 1 wurde nie erreicht, die Sabotage blieb grün.
     *
     * Hier weichen die Titel ab, damit der Wortsack wirklich rechnet: „alpha"
     * fehlt der einen Seite, „extra"/„beta" der anderen. Keiner steckt ganz
     * im anderen. */
    assert.equal(meinenDasselbe(t('a', 'Live in Berlin', 'Alpha'), t('b', 'Live in Berlin Extra', 'Beta')), false)
  })

  it('gleicher Titel, verschiedene Interpreten — der alte Weg trennt weiter', () => {
    assert.equal(meinenDasselbe(t('a', 'Greatest Hits', 'Alpha'), t('b', 'Greatest Hits', 'Beta')), false)
  })

  it('der alte, engere Weg gilt weiter: gleicher Titel + loser Interpret', () => {
    assert.equal(
      meinenDasselbe(t('spotify', 'Diskrepanz', 'Das Lumpenpack'), t('jellyfin', 'Diskrepanz', 'Das Lumpenpack; Gast')),
      true,
    )
  })

  it('OHNE TITEL KEINE AUSSAGE — zwei Unbeschriftete sind nicht dasselbe', () => {
    assert.equal(meinenDasselbe(t('a', '', 'X'), t('b', '', 'X')), false)
  })

  it('EIN EINZELNES WORT reicht nicht — „Faust" ist nicht „Faust II"', () => {
    /* AUCH DIESER ZEUGE WAR BLIND. Er stand mit „Live" gegen „Live in Berlin"
     * da — das fängt schon Regel 2 (ein Titelwort von dreien, 33 %), also
     * blieb die Sabotage an der Mindestgröße grün.
     *
     * Der Fall, der die Mindestgröße WIRKLICH braucht, ist der kurze: bei
     * „Faust" gegen „Faust II" deckt ein Titelwort von zweien genau 50 % —
     * Regel 2 ließe es durch. Zwei verschiedene Werke wären verschmolzen. */
    assert.equal(meinenDasselbe(t('a', 'Faust', ''), t('b', 'Faust II', '')), false)
  })

  it('und ein Wort gegen einen langen Titel bleibt ebenfalls getrennt', () => {
    assert.equal(meinenDasselbe(t('a', 'Live', ''), t('b', 'Live in Berlin', 'Wer')), false)
  })

  it('und die Gruppierung nimmt die Regel wirklich: der Podcast landet in EINER Gruppe', () => {
    const g = gruppiereTreffer([
      { dienst: 'ard', art: 'show', title: 'Quarks Science Cops', artist: 'WDR' },
      { dienst: 'spotify', art: 'show', title: 'Science Cops', artist: 'Quarks' },
    ])
    assert.equal(g[0].gruppe, g[1].gruppe)
    assert.deepEqual(g[0].auchIn, ['spotify'])
  })

  it('die Titelzahl schlägt den Wortsack weiterhin — Deluxe bleibt getrennt', () => {
    // Der Wortsack darf die vorhandene Sicherung nicht aushebeln.
    const g = gruppiereTreffer([
      { dienst: 'spotify', art: 'album', title: 'Steil II', artist: 'Das Lumpenpack', titelAnzahl: 14 },
      { dienst: 'jellyfin', art: 'album', title: 'Steil II Deluxe', artist: 'Das Lumpenpack', titelAnzahl: 12 },
    ])
    assert.notEqual(g[0].gruppe, g[1].gruppe)
  })
})

describe('Titel einer eigenen Liste', () => {
  it('nimmt einen Spotify-TITEL', () => {
    const t = listenTitelAus({
      dienst: 'spotify',
      title: 'Weserbergland',
      artist: 'Das Lumpenpack',
      uri: 'spotify:track:abc',
    })
    assert.equal(t?.quelle, 'spotify')
    assert.equal(t?.uri, 'spotify:track:abc')
  })

  it('weist ein Spotify-ALBUM ab', () => {
    // Genau der Fehler vom 2026-07-28: ein Album als vermeintlicher Titel.
    // Bei Spotify verraet die URI die Art - hier muss die Pruefung greifen.
    assert.equal(listenTitelAus({ dienst: 'spotify', title: 'Nackt', uri: 'spotify:album:abc' }), null)
    assert.equal(listenTitelAus({ dienst: 'spotify', title: 'X', uri: 'spotify:playlist:abc' }), null)
    assert.equal(listenTitelAus({ dienst: 'spotify', title: 'X' }), null)
  })

  it('nimmt einen Jellyfin-Titel ueber seine Item-Kennung', () => {
    const t = listenTitelAus({ dienst: 'jellyfin', title: 'Nackt', id: 'ea450ea631dd47a3' })
    assert.equal(t?.quelle, 'jellyfin')
    assert.equal(t?.id, 'ea450ea631dd47a3')
    // KEINE fertige Adresse - die traegt den Zugangsschluessel.
    assert.equal((t as unknown as Record<string, unknown>)?.url, undefined)
  })

  it('weist ab, was gar keine Kennung hat', () => {
    assert.equal(listenTitelAus({ dienst: 'jellyfin', title: 'Ohne' }), null)
    assert.equal(listenTitelAus({ dienst: 'lokal', title: 'Ohne' }), null)
    assert.equal(listenTitelAus({ dienst: 'irgendwas', title: 'X', id: 'y' }), null)
    assert.equal(listenTitelAus({ dienst: 'spotify', uri: 'spotify:track:abc' }), null) // ohne Titel
  })

  it('uebernimmt Album, Dauer und Bild, wenn sie da sind', () => {
    const t = listenTitelAus({
      dienst: 'jellyfin',
      title: 'Vorspiel',
      id: 'x',
      album: 'Nackt',
      dauerMs: 208000,
      cover: 'http://x/y',
    })
    assert.equal(t?.album, 'Nackt')
    assert.equal(t?.dauerMs, 208000)
    assert.equal(t?.cover, 'http://x/y')
  })
})

describe('Dubletten in einer Liste', () => {
  it('erkennt denselben Titel derselben Quelle', () => {
    const a = { quelle: 'spotify' as const, title: 'X', uri: 'spotify:track:1' }
    assert.equal(gleicherListenTitel(a, { ...a, title: 'anders geschrieben' }), true)
  })

  it('haelt DENSELBEN Titel aus ZWEI Diensten auseinander', () => {
    // Der darf zweimal in der Liste stehen - es sind zwei Wege, ihn zu spielen.
    assert.equal(
      gleicherListenTitel(
        { quelle: 'spotify', title: 'Nackt', uri: 'spotify:track:1' },
        { quelle: 'jellyfin', title: 'Nackt', id: '1' },
      ),
      false,
    )
  })

  it('unterscheidet verschiedene Titel', () => {
    assert.equal(
      gleicherListenTitel(
        { quelle: 'jellyfin', title: 'A', id: 'eins' },
        { quelle: 'jellyfin', title: 'A', id: 'zwei' },
      ),
      false,
    )
  })
})

/**
 * DIE ABSTUFUNG (E86).
 *
 * Betreiber: „vielleicht mit abstufungs möglichkeit zum ausschalten von bild
 * vergleich oder so". Gebaut ist die Abstufung; `bild` und `fingerabdruck`
 * stehen bewusst NICHT darin, weil ein Schalter, der nichts abschaltet, eine
 * Zusage wäre, die die Box nicht einlöst.
 */
describe('Abgleich-Abstufung (E86)', () => {
  const t = (dienst: string, title: string, artist: string, rest: Record<string, unknown> = {}) => ({
    dienst,
    art: 'show',
    title,
    artist,
    ...rest,
  })
  const ARD = t('ard', 'Quarks Science Cops', 'WDR')
  const SPOT = t('spotify', 'Science Cops', 'Quarks')

  it('STRENG schaltet den Wortsack ab — der Stand vor E85', () => {
    assert.equal(meinenDasselbe(ARD, SPOT, REGELN_STRENG), false)
    // Gleiche Titel gehen weiterhin, auch streng.
    assert.equal(
      meinenDasselbe(t('a', 'Diskrepanz', 'Lumpenpack'), t('b', 'Diskrepanz', 'Lumpenpack; Gast'), REGELN_STRENG),
      true,
    )
  })

  it('NORMAL ist die Vorgabe und findet den Podcast', () => {
    assert.equal(meinenDasselbe(ARD, SPOT), true)
    assert.equal(meinenDasselbe(ARD, SPOT, REGELN_NORMAL), true)
  })

  it('LOCKER greift bewusst weiter — und fasst dabei „Quarks" mit an', () => {
    // Das ist der PREIS dieser Stufe, kein Versehen: ein Titelwort von dreien
    // sind 33 %, und genau darauf steht sie. Wer sie wählt, will lieber
    // einmal zu viel zusammenfassen und von Hand trennen.
    const quarks = t('spotify', 'Quarks', 'WDR')
    assert.equal(meinenDasselbe(quarks, ARD, REGELN_NORMAL), false, 'normal trennt')
    assert.equal(meinenDasselbe(quarks, ARD, REGELN_LOCKER), true, 'locker fasst zusammen')
  })

  it('die TITELZAHL trennt auf jeder Stufe — auch auf locker', () => {
    const a = t('spotify', 'Steil II', 'Lumpenpack', { titelAnzahl: 14 })
    const b = t('jellyfin', 'Steil II Deluxe', 'Lumpenpack', { titelAnzahl: 12 })
    for (const [name, r] of Object.entries(ABSTUFUNGEN)) {
      assert.equal(meinenDasselbe(a, b, r), false, `Stufe ${name} darf Deluxe nicht schlucken`)
    }
  })

  it('die TITELZAHL lässt sich abschalten, wenn jemand sie für unbrauchbar hält', () => {
    const a = t('spotify', 'Steil II', 'Lumpenpack', { titelAnzahl: 14 })
    const b = t('jellyfin', 'Steil II', 'Lumpenpack', { titelAnzahl: 12 })
    assert.equal(meinenDasselbe(a, b, REGELN_NORMAL), false)
    assert.equal(meinenDasselbe(a, b, { ...REGELN_NORMAL, titelzahl: false }), true)
  })

  it('LÄNGE trennt, wenn beide sie nennen und sie auseinandergeht', () => {
    const a = t('spotify', 'Gleich', 'Wer', { dauerMs: 3_000_000 })
    const nah = t('jellyfin', 'Gleich', 'Wer', { dauerMs: 3_030_000 }) // +1 %
    const weit = t('jellyfin', 'Gleich', 'Wer', { dauerMs: 3_600_000 }) // +20 %
    assert.equal(meinenDasselbe(a, nah), true, 'innerhalb der Toleranz')
    assert.equal(meinenDasselbe(a, weit), false, 'darüber nicht mehr')
  })

  it('LÄNGE schweigt, wenn nur EINE Seite eine nennt — wie die Titelzahl auch', () => {
    const a = t('spotify', 'Gleich', 'Wer', { dauerMs: 3_000_000 })
    const ohne = t('jellyfin', 'Gleich', 'Wer')
    assert.equal(meinenDasselbe(a, ohne), true)
  })

  it('LÄNGE lässt sich abschalten', () => {
    const a = t('spotify', 'Gleich', 'Wer', { dauerMs: 3_000_000 })
    const weit = t('jellyfin', 'Gleich', 'Wer', { dauerMs: 3_600_000 })
    assert.equal(meinenDasselbe(a, weit, { ...REGELN_NORMAL, laenge: false }), true)
  })

  it('WIDERSPRUCH SCHLÄGT ÄHNLICHKEIT — auch bei identischem Titel', () => {
    // Der teure Fehler wäre, die Sicherungen erst NACH dem Titelvergleich zu
    // prüfen: gleiche Titel nehmen den kurzen Weg und kämen nie dort an.
    const a = t('spotify', 'Gleich', 'Wer', { dauerMs: 3_000_000 })
    const b = t('jellyfin', 'Gleich', 'Wer', { dauerMs: 9_000_000 })
    assert.equal(meinenDasselbe(a, b), false)
  })

  it('gruppiereTreffer reicht die Stufe durch', () => {
    const streng = gruppiereTreffer([ARD, SPOT], REGELN_STRENG)
    assert.notEqual(streng[0].gruppe, streng[1].gruppe)
    const normal = gruppiereTreffer([ARD, SPOT])
    assert.equal(normal[0].gruppe, normal[1].gruppe)
  })

  it('istAbstufung kennt genau die drei — und faellt nicht auf __proto__ herein', () => {
    assert.equal(istAbstufung('normal'), true)
    assert.equal(istAbstufung('locker'), true)
    assert.equal(istAbstufung('streng'), true)
    assert.equal(istAbstufung('bild'), false, 'bild gibt es hier NICHT')
    assert.equal(istAbstufung('__proto__'), false)
    assert.equal(istAbstufung(undefined), false)
  })
})

/**
 * PLUGIN-INHALT IN DER MEDIENLISTE (E87).
 *
 * Die Frage, die das Plugin-Handbuch offen liess. Der Wert dieser Zeugen ist
 * die IDENTITAET: der Schluessel muss die volle Plugin-Medienkennung
 * enthalten, sonst findet der Server das Plugin nicht wieder.
 */
describe('Plugin-Einträge (E87)', () => {
  const archive: Eintrag = { type: 'plugin', id: 'mixpi-archive:faust1teil_1412_librivox', title: 'Faust' }

  it('ein Plugin-Eintrag ist EIN Dienst — nicht einer je Plugin', () => {
    assert.equal(dienstVon(archive), 'plugin')
    assert.equal(dienstVon({ type: 'plugin', id: 'mixpi-webdav:x' }), 'plugin')
  })

  it('der SCHLÜSSEL trägt die volle Plugin-Medienkennung', () => {
    // Daran hängen Verlauf, Weiterhören und Favoriten. Stünde hier nur
    // `plugin:faust…`, wüsste der Server nicht mehr, WELCHES Plugin gemeint
    // ist — und die Kachel wäre unauflösbar.
    assert.equal(medienSchluessel(archive), 'plugin:mixpi-archive:faust1teil_1412_librivox')
  })

  it('und er bleibt beim Umbenennen gleich', () => {
    const vorher = medienSchluessel(archive)
    const nachher = medienSchluessel(aenderungAnwenden(archive, { title: 'Ganz anders', category: 'audiobook' }))
    assert.equal(vorher, nachher)
  })

  it('pluginKennungAus liest die Kennung — und weist Halbes ab', () => {
    assert.equal(pluginKennungAus(archive), 'mixpi-archive:faust1teil_1412_librivox')
    // OHNE DOPPELPUNKT ist es keine Medienkennung, sondern ein halber Eintrag.
    assert.equal(pluginKennungAus({ type: 'plugin', id: 'mixpi-archive' }), null)
    // Und ein Doppelpunkt am Rand nennt kein Plugin bzw. keinen Rest.
    assert.equal(pluginKennungAus({ type: 'plugin', id: ':faust' }), null)
    assert.equal(pluginKennungAus({ type: 'plugin', id: 'mixpi-archive:' }), null)
    assert.equal(pluginKennungAus({ type: 'plugin' }), null)
  })

  it('an einem NICHT-Plugin sagt sie null, statt zu raten', () => {
    assert.equal(pluginKennungAus({ type: 'spotify', id: 'a:b' }), null)
    assert.equal(pluginKennungAus({ type: 'ard', id: '81889970' }), null)
  })

  it('ein unbekannter Typ bleibt „anderes" — `plugin` ist ein WORT, kein Muster', () => {
    // Der Grund, warum es das feste Wort braucht: `dienstVon` ist rein und
    // kennt kein Plugin-Register. „mixpi-archive" allein sieht aus wie ein
    // geladenes Plugin UND wie ein Tippfehler.
    assert.equal(dienstVon({ type: 'mixpi-archive' }), 'anderes')
  })
})

/**
 * „KACHEL SAGT ES" (E89) — die Marke fuer abgebrochene Mitschnitte.
 *
 * Betreiberwahl nach dem 101-Meerjungfrauen-Fund: die Kachel soll sichtbar
 * tragen, dass etwas fehlt, statt zu verschwinden oder zu schweigen.
 */
describe('unvollstaendig (E89)', () => {
  const roh = { type: 'library', title: '101 Meerjungfrauen', artist: 'Ruby van der Bogen' }

  it('wird beim ANLEGEN uebernommen — aber nur das echte true', () => {
    assert.equal(neuerEintrag({ ...roh, unvollstaendig: true })?.unvollstaendig, true)
    // Eine ZEICHENKETTE waere in JavaScript wahr und truege eine Behauptung,
    // die niemand geschickt hat.
    assert.equal(neuerEintrag({ ...roh, unvollstaendig: 'true' })?.unvollstaendig, undefined)
    assert.equal(neuerEintrag({ ...roh, unvollstaendig: 1 })?.unvollstaendig, undefined)
  })

  it('FEHLT ES, IST NICHTS BEHAUPTET — nicht „vollstaendig"', () => {
    // Bestandseintraege tragen es nicht. `false` zu speichern hiesse, fuer
    // sie eine Aussage zu erfinden.
    assert.equal(neuerEintrag(roh)?.unvollstaendig, undefined)
    assert.equal('unvollstaendig' in (neuerEintrag(roh) as object), false)
  })

  it('LAESST SICH LOESCHEN — sonst bliebe die Marke fuer immer stehen', () => {
    const mit = neuerEintrag({ ...roh, unvollstaendig: true }) as Eintrag
    assert.equal(mit.unvollstaendig, true)
    const ohne = aenderungAnwenden(mit, { unvollstaendig: false })
    assert.equal(ohne.unvollstaendig, undefined)
    assert.equal('unvollstaendig' in ohne, false, 'geloescht, nicht auf false gesetzt')
  })

  it('und nachtraeglich setzen geht auch', () => {
    const ohne = neuerEintrag(roh) as Eintrag
    assert.equal(aenderungAnwenden(ohne, { unvollstaendig: true }).unvollstaendig, true)
  })

  it('eine Aenderung ohne das Feld laesst die Marke IN RUHE', () => {
    // Sonst raeumte jedes Umbenennen in der Verwaltung die Marke weg.
    const mit = neuerEintrag({ ...roh, unvollstaendig: true }) as Eintrag
    assert.equal(aenderungAnwenden(mit, { title: 'Neu' }).unvollstaendig, true)
  })

  it('DIE IDENTITAET AENDERT SICH DADURCH NICHT', () => {
    // Sonst verlöre die Box Verlauf und Favoriten in dem Moment, in dem ein
    // Mitschnitt fertig wird.
    const mit = neuerEintrag({ ...roh, unvollstaendig: true }) as Eintrag
    assert.equal(medienSchluessel(mit), medienSchluessel(aenderungAnwenden(mit, { unvollstaendig: false })))
  })
})
