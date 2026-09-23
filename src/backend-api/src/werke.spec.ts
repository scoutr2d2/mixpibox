/**
 * Tests der Werke — der Form, die die NEUE Box-Oberflaeche anzeigt.
 *
 * Drei Eigenschaften stehen im Vordergrund, weil ihr Bruch sich erst spaet und
 * dann unerklaerlich zeigt:
 *
 *   - DER SCHLUESSEL IST STABIL. Ueber ihn laeuft das Bild (/api/bild/<s>) und
 *     spaeter das Wiederfinden nach einem Neuladen. Waere er eine laufende
 *     Nummer je Aufruf (wie die `gruppe` aus `gruppiereTreffer`), zeigte eine
 *     Kachel nach dem naechsten Abruf ein fremdes Cover.
 *   - `quellen` IST IMMER EINE LISTE MIT GENAU EINEM EINTRAG. Die Mehrzahl ist
 *     jetzt schon in der Form, damit das spaetere Zusammenfassen zweier Dienste
 *     die Oberflaeche nicht anfasst. Ein Werk ohne Quelle oder mit zwei waere
 *     heute ein Fehler in der Fuellung.
 *   - `bild` ZEIGT NIE AUF EINEN DIENST. Eine Jellyfin-Coveradresse traegt den
 *     Zugangsschluessel im Klartext; landete sie in der Seite, stuende er im
 *     Browserverlauf.
 *
 * Die Beispiele sind echte Eintraege aus der Box (gekuerzt).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Eintrag } from './medien'
import { medienSchluessel } from './medien'
import { ARTEN, albumOrdnerPfad, artVon, bildPfad, interpretTaugt, werkAus, werkeAus } from './werke'

const spotifyAlbum: Eintrag = {
  type: 'spotify',
  category: 'music',
  id: '4aawyAB9vmqN3uQ7FjRGTy',
  artist: 'Global Sounds',
  title: 'Spotify-Album',
  cover: 'https://i.scdn.co/image/ab67616d0000b273abc',
}

const spotifyListe: Eintrag = {
  type: 'spotify',
  category: 'music',
  playlistid: '1DYDHYJ98WZbHa2OZ4Dljg',
  artist: 'EUROPA Hörspiele & Kinderlieder',
  title: 'Hello Kitty - Alle Hörspiele',
  cover: 'https://image-cdn-fa.spotifycdn.com/image/abc',
}

const jellyfinAlbum: Eintrag = {
  type: 'jellyfin-album',
  category: 'music',
  id: 'e131865d504a657a93533722fc88bc90',
  artist: 'Das Lumpenpack',
  title: 'Die Zukunft wird groß',
  cover: 'http://192.168.178.199:8899/Items/e131865d/Images/Primary?api_key=GEHEIM123',
}

const lokalesHoerspiel: Eintrag = {
  type: 'library',
  category: 'audiobook',
  artist: 'Das Pummeleinhorn',
  title: 'Pummel kann nicht schlafen',
  cover: 'data:image/jpeg;base64,/9j/4AAQSkZJRg',
}

const radio: Eintrag = {
  type: 'radio',
  category: 'music',
  id: 'http://swr-swr3-live.cast.addradio.de/swr/swr3/live/mp3/128/stream.mp3',
  artist: 'SWR3',
  title: 'Live-Radio',
  cover: 'assets/images/nocover_mupi.png',
}

const podcast: Eintrag = {
  type: 'rss',
  category: 'music',
  id: 'https://example.com/podcast.xml',
  artist: 'Demo-Podcast',
  title: 'Folgen',
  cover: 'assets/images/nocover_mupi.png',
}

const show: Eintrag = {
  type: 'spotify',
  category: 'audiobook',
  showid: '5CfCWKI5pZ28U0uOzXkDHe',
  artist: 'Bibi Blocksberg',
  title: 'Bibi Blocksberg (Show)',
}

const hoerbuch: Eintrag = {
  type: 'spotify',
  category: 'audiobook',
  audiobookid: '7iHfbu1YPACw6oZPAFJtqe',
  artist: 'Astrid Lindgren',
  title: 'Ronja Räubertochter',
}

const interpret: Eintrag = {
  type: 'spotify',
  category: 'music',
  artistid: '0LcJLqbBmaGUft1e9Mm8HV',
  artist: 'ABBA',
  title: 'ABBA',
}

const ALLE = [spotifyAlbum, spotifyListe, jellyfinAlbum, lokalesHoerspiel, radio, podcast, show, hoerbuch, interpret]

describe('Art ableiten', () => {
  it('erkennt jede Art an den Feldern, die der Eintrag traegt', () => {
    assert.equal(artVon(spotifyAlbum), 'album')
    assert.equal(artVon(jellyfinAlbum), 'album')
    assert.equal(artVon(lokalesHoerspiel), 'album')
    assert.equal(artVon(spotifyListe), 'playlist')
    assert.equal(artVon(show), 'show')
    // Ein Hoerbuch ist fuer die Oberflaeche dasselbe wie eine Show; dass es ein
    // Hoerbuch ist, sagt die Kategorie.
    assert.equal(artVon(hoerbuch), 'show')
    assert.equal(artVon(interpret), 'interpret')
    assert.equal(artVon(radio), 'radio')
    assert.equal(artVon(podcast), 'rss')
    assert.equal(artVon({ type: 'irgendwas', title: 'X' }), 'anderes')
  })

  it('haelt Radio und RSS von „Album" fern, obwohl sie eine `id` tragen', () => {
    // Genau hier waere der Fehler leicht: beide haben eine `id` wie ein
    // Spotify-Album — nur ist es eine Stream-Adresse.
    assert.equal(artVon({ type: 'radio', id: 'http://beispiel/stream' }), 'radio')
    assert.equal(artVon({ type: 'rss', id: 'http://beispiel/feed.xml' }), 'rss')
  })

  it('liefert nur bekannte Arten', () => {
    for (const e of ALLE) assert.ok((ARTEN as readonly string[]).includes(artVon(e)), `${e.title}`)
  })
})

describe('werkAus', () => {
  it('nimmt den Schluessel aus medienSchluessel — keinen eigenen', () => {
    for (const e of ALLE) assert.equal(werkAus(e).schluessel, medienSchluessel(e))
  })

  it('gibt demselben Eintrag denselben Schluessel, so oft man fragt', () => {
    // DER Punkt der ganzen Datei: eine laufende Nummer je Aufruf (wie die
    // `gruppe` aus gruppiereTreffer) haette hier zwei verschiedene Werte.
    for (const e of ALLE) {
      const a = werkAus(e)
      const b = werkAus({ ...e })
      assert.equal(a.schluessel, b.schluessel)
      assert.equal(a.bild, b.bild)
    }
  })

  it('unterscheidet Eintraege verschiedener Dienste', () => {
    const alleSchluessel = ALLE.map((e) => werkAus(e).schluessel)
    assert.equal(new Set(alleSchluessel).size, ALLE.length)
  })

  it('uebernimmt Titel und Interpret', () => {
    const w = werkAus(jellyfinAlbum)
    assert.equal(w.titel, 'Die Zukunft wird groß')
    assert.equal(w.interpret, 'Das Lumpenpack')
  })

  it('behaelt die Kategorie und faellt sonst auf `music` zurueck', () => {
    assert.equal(werkAus(lokalesHoerspiel).kategorie, 'audiobook')
    assert.equal(werkAus({ type: 'spotify', id: 'a', category: 'other' }).kategorie, 'other')
    // Unbekannt, leer, fehlend: alles `music`. Eine fremde Kategorie waere eine
    // Kachel, die in keinem Abschnitt der Startseite auftaucht.
    assert.equal(werkAus({ type: 'spotify', id: 'a', category: 'hoerspiel' }).kategorie, 'music')
    assert.equal(werkAus({ type: 'spotify', id: 'a', category: '' }).kategorie, 'music')
    assert.equal(werkAus({ type: 'spotify', id: 'a' }).kategorie, 'music')
  })

  it('gibt der QUELLE ihre eigene Kategorie mit — der Abspielweg braucht sie (30.08.2026)', () => {
    // AM GERAET GEMESSEN: „Nah" fuehrt als Spotify-Werk mit category `music`,
    // der Mitschnitt liegt unter `audiobook/Alin Coen/Nah`. Nach der
    // Verschmelzung baute die Oberflaeche den lokalen Befehl aus der
    // Kategorie des WERKS (`music:…`) — der Abspieldienst suchte in
    // media/music/, das es fuer diesen Interpreten gar nicht gibt, und die
    // Kachel spielte NICHTS. Die Quelle muss ihre Herkunft selbst kennen;
    // die Verschmelzung reicht sie unveraendert durch (verschmelzung.ts:570).
    assert.equal(werkAus(lokalesHoerspiel).quellen[0].kategorie, 'audiobook')
    assert.equal(werkAus({ type: 'spotify', id: 'a', category: 'music' }).quellen[0].kategorie, 'music')
  })

  it('lokale Quellen tragen ihre PLATTENFORM — sanitisierte Namen finden sonst nichts (30.08.2026)', () => {
    // AM GERAET GEMESSEN: Spotify nennt das Album „Guten Morgen / Good
    // Morning (Englisch)", die Aufnahme liegt als „Guten Morgen _ Good
    // Morning (Englisch)" auf der Platte. Die verschmolzene Kachel fuehrt
    // mit den Spotify-Metadaten — ein musicsearch-Befehl daraus sucht den
    // Schraegstrich-Ordner, den es nicht gibt, und faengt im Zweifel etwas
    // AEHNLICHES: falsches Lied, falsche Anzeige, Spruenge beim Pausieren.
    const w = werkAus({
      type: 'library',
      category: 'audiobook',
      artist: 'Team Karacho, Rola',
      title: 'Guten Morgen _ Good Morning (Englisch)',
    })
    assert.deepEqual(w.quellen[0].lokalPfad, {
      kategorie: 'audiobook',
      interpret: 'Team Karacho, Rola',
      titel: 'Guten Morgen _ Good Morning (Englisch)',
    })
    // Fremddienste tragen KEINE Plattenform — es gibt keine Platte.
    assert.equal(werkAus({ type: 'spotify', id: 'a', category: 'music' }).quellen[0].lokalPfad, undefined)
  })
})

describe('fehlende Felder', () => {
  it('macht aus einem leeren Eintrag ein Werk statt eines Fehlers', () => {
    const w = werkAus({} as Eintrag)
    assert.equal(w.titel, '')
    assert.equal(w.interpret, undefined)
    assert.equal(w.art, 'anderes')
    assert.equal(w.kategorie, 'music')
    assert.equal(w.quellen.length, 1)
    assert.equal(w.quellen[0].dienst, 'anderes')
    assert.ok(w.schluessel)
  })

  it('beschriftet eine Kachel ohne Titel mit dem Interpreten', () => {
    // Eine Kachel ganz ohne Beschriftung ist auf der Box nicht wiederzufinden.
    assert.equal(werkAus({ type: 'library', artist: 'Rolf Zuckowski' }).titel, 'Rolf Zuckowski')
  })

  it('laesst `interpret` weg, statt ein leeres Feld zu setzen', () => {
    const w = werkAus({ type: 'radio', id: 'http://beispiel/stream', title: 'Sender' })
    assert.equal(w.interpret, undefined)
    assert.ok(!('interpret' in w))
  })

  it('vertraegt Leerraum in Titel und Interpret', () => {
    // ECHTE Kennung, keine Platzhalter-Kennung: seit `interpretTaugt` haengt
    // `interpret` bei Spotify daran, dass die Kennung wie eine aussieht.
    const w = werkAus({ type: 'spotify', id: '1DFixLWuPkv3KT3TnV35m3', title: '  Album  ', artist: '  Band  ' })
    assert.equal(w.titel, 'Album')
    assert.equal(w.interpret, 'Band')
  })
})

describe('quellen', () => {
  it('ist immer eine Liste mit GENAU EINEM Eintrag', () => {
    for (const e of [...ALLE, {} as Eintrag, { type: '' } as Eintrag]) {
      const q = werkAus(e).quellen
      assert.ok(Array.isArray(q), 'quellen muss eine Liste sein')
      assert.equal(q.length, 1)
    }
  })

  it('benennt den Dienst so wie der Rest der Box', () => {
    assert.equal(werkAus(spotifyAlbum).quellen[0].dienst, 'spotify')
    assert.equal(werkAus(jellyfinAlbum).quellen[0].dienst, 'jellyfin')
    assert.equal(werkAus(lokalesHoerspiel).quellen[0].dienst, 'lokal')
    assert.equal(werkAus(radio).quellen[0].dienst, 'radio')
    assert.equal(werkAus(podcast).quellen[0].dienst, 'rss')
  })

  it('traegt die Kennung des Dienstes', () => {
    assert.equal(werkAus(spotifyAlbum).quellen[0].kennung, '4aawyAB9vmqN3uQ7FjRGTy')
    assert.equal(werkAus(spotifyListe).quellen[0].kennung, '1DYDHYJ98WZbHa2OZ4Dljg')
    assert.equal(werkAus(show).quellen[0].kennung, '5CfCWKI5pZ28U0uOzXkDHe')
    assert.equal(werkAus(hoerbuch).quellen[0].kennung, '7iHfbu1YPACw6oZPAFJtqe')
    assert.equal(werkAus(radio).quellen[0].kennung, radio.id)
  })

  it('bleibt bei Dienst + Kennung genau der Schluessel', () => {
    // Diese Zusicherung haelt Kennung und Schluessel zusammen: waeren es zwei
    // getrennte Ableitungen, koennten sie beim naechsten neuen Feld
    // auseinanderlaufen.
    for (const e of ALLE) {
      const w = werkAus(e)
      assert.equal(`${w.quellen[0].dienst}:${w.quellen[0].kennung}`, w.schluessel)
    }
  })

  it('gibt einem lokalen Eintrag ohne Kennung trotzdem eine', () => {
    // Lokale Aufnahmen haben keine Dienst-Kennung; ihre Identitaet ist der
    // Inhalt. Eine LEERE Kennung waere fuer alle lokalen Werke dieselbe.
    const a = werkAus(lokalesHoerspiel).quellen[0].kennung
    const b = werkAus({ type: 'library', artist: 'Anderer', title: 'Anderes' }).quellen[0].kennung
    assert.ok(a)
    assert.notEqual(a, b)
  })
})

describe('bild', () => {
  it('zeigt IMMER auf die Box, nie auf einen Dienst', () => {
    for (const e of ALLE) {
      const w = werkAus(e)
      assert.equal(w.bild, bildPfad(w.schluessel))
      assert.ok(w.bild.startsWith('/api/bild/'), w.bild)
      assert.ok(!w.bild.includes('scdn.co'), 'keine Spotify-Adresse')
      assert.ok(!w.bild.includes('192.168.'), 'keine Jellyfin-Adresse')
      assert.ok(!w.bild.includes('api_key'), 'kein Zugangsschluessel in der Adresse')
    }
  })

  it('kodiert einen Schluessel, der selbst eine Adresse ist', () => {
    // Der Schluessel eines Senders IST eine Adresse. Unkodiert zerfiele er in
    // mehrere Pfadstuecke und der Endpunkt bekaeme einen anderen Schluessel.
    const w = werkAus(radio)
    assert.equal(w.bild.split('/').length, 4, `zu viele Pfadstuecke: ${w.bild}`)
    assert.equal(decodeURIComponent(w.bild.slice('/api/bild/'.length)), w.schluessel)
  })
})

describe('werkeAus', () => {
  it('macht aus jeder Zeile genau ein Werk, in derselben Reihenfolge', () => {
    const werke = werkeAus(ALLE)
    assert.equal(werke.length, ALLE.length)
    assert.deepEqual(
      werke.map((w) => w.schluessel),
      ALLE.map((e) => medienSchluessel(e)),
    )
  })

  it('vertraegt Leeres und Unfug statt einer Liste', () => {
    assert.deepEqual(werkeAus([]), [])
    assert.deepEqual(werkeAus(undefined as unknown as Eintrag[]), [])
    assert.deepEqual(werkeAus(null as unknown as Eintrag[]), [])
    assert.deepEqual(werkeAus({} as unknown as Eintrag[]), [])
  })

  it('nimmt `verschmelzen: false` an — die Stufe-1-Fuellung', () => {
    assert.equal(werkeAus(ALLE, { verschmelzen: false }).length, ALLE.length)
    assert.equal(werkeAus(ALLE, {}).length, ALLE.length)
  })

  it('laesst die Liste bei `verschmelzen: true` OHNE Zuordnungen unveraendert', () => {
    // Frueher warf das hier, weil es die Zusammenfassung noch gar nicht gab.
    // Jetzt gibt es sie (verschmelzung.ts) — und ohne Zuordnung ist „nichts
    // verschmolzen" die Wahrheit und kein Verschweigen. Auf der Box gemessen
    // (2026-08-02): 21 spotify, 1 jellyfin, 0 lokal, Ueberschneidung null.
    assert.equal(werkeAus(ALLE, { verschmelzen: true }).length, ALLE.length)
  })

  it('fasst mit einer Zuordnung zusammen und ordnet die Quellen', () => {
    // Der ganze Weg von den rohen Eintraegen bis zur Kachel: dieselbe Platte
    // liegt in Jellyfin und bei Spotify, die Zuordnung sagt es, und danach
    // steht in `quellen[0]` die Quelle, mit der gespielt werden soll.
    const werke = werkeAus([jellyfinAlbum, spotifyAlbum], {
      verschmelzen: true,
      zuordnungen: [
        {
          schluessel: medienSchluessel(jellyfinAlbum),
          auch: [medienSchluessel(spotifyAlbum)],
          stufe: 'hand',
        },
      ],
    })
    assert.equal(werke.length, 1)
    assert.equal(werke[0].schluessel, medienSchluessel(jellyfinAlbum))
    assert.deepEqual(
      werke[0].quellen.map((q) => q.dienst),
      ['jellyfin', 'spotify'],
    )
    assert.deepEqual(werke[0].auchSchluessel, [medienSchluessel(spotifyAlbum)])
  })
})

describe('interpretSchluessel — das Regal je Interpret', () => {
  it('fasst denselben Interpreten trotz anderer Schreibweise zusammen', () => {
    // Genau dafuer ist er da: „Die Drei ???" und „die drei ???" sind EIN
    // Interpret. Roh verglichen waeren es zwei Regale, und das Kind faende
    // seine Hoerspiele an zwei Stellen.
    const a = werkAus({
      id: '1DFixLWuPkv3KT3TnV35m3',
      title: 'Folge 1',
      artist: 'Die Drei ???',
      type: 'spotify',
    } as never)
    const b = werkAus({
      id: '4aawyAB9vmqN3uQ7FjRGTy',
      title: 'Folge 2',
      artist: 'die  drei ???',
      type: 'spotify',
    } as never)
    assert.equal(a.interpretSchluessel, b.interpretSchluessel)
    // DAS ZEICHENWORT BLEIBT STEHEN (seit 19.08.2026, E45-Bestandsreview):
    // hier stand „die drei", und unter dem Schluessel fiel „Die drei !!!"
    // — eine ANDERE echte Kosmos-Serie — mit dieser hier zusammen.
    assert.equal(a.interpretSchluessel, 'die drei ???')
    const andere = werkAus({
      id: '2QqQXuDKNR8HK1cFxf0NhW',
      title: 'Folge 1',
      artist: 'Die drei !!!',
      type: 'spotify',
    } as never)
    assert.notEqual(a.interpretSchluessel, andere.interpretSchluessel)
  })

  it('haelt verschiedene Interpreten auseinander', () => {
    const a = werkAus({ id: '1DFixLWuPkv3KT3TnV35m3', title: 'X', artist: 'Bibi Blocksberg', type: 'spotify' } as never)
    const b = werkAus({
      id: '4aawyAB9vmqN3uQ7FjRGTy',
      title: 'X',
      artist: 'Benjamin Bluemchen',
      type: 'spotify',
    } as never)
    assert.notEqual(a.interpretSchluessel, b.interpretSchluessel)
  })

  it('vergibt KEINEN Schluessel ohne Interpret', () => {
    // Ein leerer Schluessel wuerde alle namenlosen Eintraege in EIN Regal
    // werfen - ein Sammelposten, den niemand zuordnen kann.
    const w = werkAus({ id: '1DFixLWuPkv3KT3TnV35m3', title: 'Ohne Interpret', type: 'spotify' } as never)
    assert.equal(w.interpretSchluessel, undefined)
    const leer = werkAus({ id: '4aawyAB9vmqN3uQ7FjRGTy', title: 'Leer', artist: '   ', type: 'spotify' } as never)
    assert.equal(leer.interpretSchluessel, undefined)
  })

  it('vergibt keinen Schluessel, wenn nur Zeichen ohne Buchstaben dastehen', () => {
    // „???" allein ist kein Name, sondern der Platzhalter fuer „unbekannt" —
    // er darf kein Regal aufmachen. Das galt unter `normal()` beilaeufig (dort
    // blieb nichts uebrig) und steht in `interpretSchluesselAus` jetzt
    // ausdruecklich da, weil das Zeichenwort sonst stehenbliebe.
    const w = werkAus({ id: '1DFixLWuPkv3KT3TnV35m3', title: 'X', artist: '???', type: 'spotify' } as never)
    assert.equal(w.interpretSchluessel, undefined)
    // MIT einem Namen davor zaehlt genau dasselbe Zeichenwort — das ist der
    // ganze Unterschied zwischen Platzhalter und Serientitel.
    const drei = werkAus({ id: '4aawyAB9vmqN3uQ7FjRGTy', title: 'X', artist: 'Die drei ???', type: 'spotify' } as never)
    assert.equal(drei.interpretSchluessel, 'die drei ???')
  })

  it('ist unabhaengig vom DIENST — dasselbe Regal ueber Dienste hinweg', () => {
    // Das ist der Sinn: ein Interpret, dessen Alben teils lokal und teils bei
    // Spotify liegen, steht in EINEM Regal. Verschmolzen wird dabei NICHTS -
    // es bleiben zwei Werke, sie stehen nur nebeneinander.
    const a = werkAus({
      id: '1DFixLWuPkv3KT3TnV35m3',
      title: 'Album A',
      artist: 'Rolf Zuckowski',
      type: 'spotify',
    } as never)
    const b = werkAus({ title: 'Album B', artist: 'Rolf Zuckowski', type: 'library' } as never)
    assert.equal(a.interpretSchluessel, b.interpretSchluessel)
    assert.notEqual(a.schluessel, b.schluessel, 'zwei Werke bleiben zwei Werke')
  })
})

describe('interpretTaugt — die Regel gegen „Unknown"', () => {
  it('erkennt den ECHTEN Fall von der Box', () => {
    // GEMESSEN am 2026-08-02 in /api/werke: „External Playback" ist MuPiBox'
    // Markierung fuer Wiedergabe vom Telefon. Der Eintrag hat weder `id` noch
    // `playlistid`, sein Interpret heisst „Unknown" — und weil es bei Spotify
    // wirklich einen Kuenstler dieses Namens gibt, ueberstand er sogar die
    // Namenspruefung der Oberflaeche.
    const w = werkAus({ type: 'spotify', title: 'External Playback', artist: 'Unknown' } as never)
    assert.equal(w.schluessel, 'spotify:t:unknown|external playback')
    assert.equal(w.interpretSchluessel, undefined)
    assert.equal(w.interpret, undefined, 'auch der Untertitel der Kachel bleibt leer')
    assert.equal(w.titel, 'External Playback', 'der Titel bleibt — eine Kachel ohne Beschriftung waere schlimmer')
  })

  it('laesst LOKALE Alben in Ruhe, auch ohne jede Kennung', () => {
    // DER ERSTE ENTWURF WAR HIER FALSCH. „Kein Ersatzschluessel" allein haette
    // auch lokale Alben getroffen: die haben von Haus aus keine Kennung,
    // sondern werden ueber Kategorie/Interpret/Titel angesprochen. Dort IST
    // der Interpret die Adresse — ihn wegzunehmen haette ausgerechnet die
    // Kacheln entwertet, die ohne Netz noch spielen.
    const w = werkAus({ type: 'library', title: 'Album B', artist: 'Rolf Zuckowski' } as never)
    assert.equal(w.interpretSchluessel, 'rolf zuckowski')
    assert.equal(interpretTaugt('lokal', 't:rolf zuckowski|album b'), true)
  })

  it('nimmt Spotify-Kennungen in jeder Schreibweise an — und krumme nicht', () => {
    assert.equal(interpretTaugt('spotify', '1DFixLWuPkv3KT3TnV35m3'), true)
    assert.equal(interpretTaugt('spotify', 'spotify:album:1DFixLWuPkv3KT3TnV35m3'), true)
    assert.equal(interpretTaugt('spotify', 'https://open.spotify.com/intl-de/artist/352PojxBglNK0F7TBbCWJm'), true)
    for (const k of ['', '   ', '1', 'x'.repeat(21), 'x'.repeat(23), 't:unknown|external playback']) {
      assert.equal(interpretTaugt('spotify', k), false, k)
    }
  })

  it('verlangt bei Jellyfin, Radio und RSS eine echte Kennung', () => {
    assert.equal(interpretTaugt('jellyfin', '7d9a37e2732ca78bc68eacb3232960c0'), true)
    assert.equal(interpretTaugt('radio', 'http://beispiel/stream.mp3'), true)
    assert.equal(interpretTaugt('jellyfin', 't:jemand|etwas'), false)
    assert.equal(interpretTaugt('rss', ''), false)
  })
})

describe('Plugin-Werke (E87)', () => {
  it('ein Plugin-Werk ist eine SHOW, keine Kachel „anderes"', () => {
    // Bis E87 kam hier `anderes` heraus — eine Kachel, die sich nicht öffnen
    // lässt. `show` heisst „eine Folge nach der anderen", und genau das
    // liefert `inhalt()`.
    const w = werkAus({ type: 'plugin', id: 'mixpi-archive:faust', title: 'Faust', artist: 'Goethe' })
    assert.equal(w.art, 'show')
    assert.equal(w.quellen[0].dienst, 'plugin')
  })

  it('die Quellenkennung ist die volle Plugin-Medienkennung', () => {
    // Sie wird vom Schlüssel abgeschnitten (`<dienst>:<kennung>`) — steht
    // dort etwas anderes, findet der Server das Plugin nicht wieder.
    const w = werkAus({ type: 'plugin', id: 'mixpi-archive:faust', title: 'Faust' })
    assert.equal(w.quellen[0].kennung, 'mixpi-archive:faust')
    assert.equal(w.schluessel, 'plugin:mixpi-archive:faust')
  })
})

describe('albumOrdnerPfad — der Riegel vor dem Download (E126)', () => {
  const M = '/home/dietpi/MuPiBox/media'

  it('baut den Pfad aus Kategorie, Interpret und Titel', () => {
    assert.equal(
      albumOrdnerPfad(M, { kategorie: 'music', interpret: 'Alin Coen', titel: 'Nah' }),
      '/home/dietpi/MuPiBox/media/music/Alin Coen/Nah',
    )
  })

  it('weist `..` in JEDEM Teil ab — ein Download darf nie aus dem Medienordner fuehren', () => {
    assert.equal(albumOrdnerPfad(M, { kategorie: '..', interpret: 'a', titel: 'b' }), null)
    assert.equal(albumOrdnerPfad(M, { kategorie: 'music', interpret: '..', titel: 'b' }), null)
    assert.equal(albumOrdnerPfad(M, { kategorie: 'music', interpret: 'a', titel: '..' }), null)
  })

  it('weist Trennzeichen und NUL ab — sonst baut der Aufrufer den Pfad selbst', () => {
    assert.equal(albumOrdnerPfad(M, { kategorie: 'music', interpret: 'a/b', titel: 'c' }), null)
    assert.equal(albumOrdnerPfad(M, { kategorie: 'music', interpret: 'a\\b', titel: 'c' }), null)
    assert.equal(albumOrdnerPfad(M, { kategorie: 'music', interpret: 'a\0b', titel: 'c' }), null)
  })

  it('ein FEHLENDER Teil ergaebe den Elternordner — also nein', () => {
    // Ohne diesen Riegel zeigte der Pfad auf ALLE Alben eines Interpreten.
    assert.equal(albumOrdnerPfad(M, { kategorie: 'music', interpret: 'a', titel: '' }), null)
    assert.equal(albumOrdnerPfad(M, null), null)
  })

  it('ein Nachbarordner mit gleichem Praefix zaehlt nicht als drinnen', () => {
    // Die Gegenprobe am ERGEBNIS prueft mit Trennzeichen, nicht per
    // startsWith allein: „/media-fremd" faengt auch mit „/media" an.
    assert.equal(albumOrdnerPfad('/x/media', { kategorie: '..', interpret: 'media-fremd', titel: 'a' }), null)
  })
})
