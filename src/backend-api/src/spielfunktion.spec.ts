import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  folgeWaehlen,
  kennungAus,
  seekZiel,
  spotifyIdAus,
  sprungAngekommen,
  startPlan,
  versuchsQuellen,
  abschnittAb,
  tonmaschine,
  wechselNach,
  wechselpunkte,
  wunschVerfehlt,
} from './spielfunktion'
import type { Quelle, Werk } from './werke'

function werk(teil: Partial<Werk>): Werk {
  return {
    schluessel: 'spotify:x',
    art: 'album',
    titel: 'Titel',
    bild: '/api/bild/x',
    kategorie: 'music',
    quellen: [],
    ...teil,
  } as Werk
}

describe('startPlan — der Umzug von abspielBefehl (E95/V)', () => {
  it('lokal geht ueber die LISTE (E111) — Anzeige und Ton aus derselben Quelle', () => {
    // Bis E111 war das ein Ein-Befehl-Start auf `musicsearch/library`, und der
    // liess den Abspieldienst die playlist.m3u lesen — eine ANDERE Liste als
    // die angezeigte („Guten Morgen": drei Dateien im Ordner, zwei in der
    // m3u). Jede Warteschlangennummer bedeutete auf beiden Seiten etwas
    // anderes; genau das meldete der Betreiber als „track1 fehlt".
    const w = werk({ titel: 'Guten Morgen / Good Morning', interpret: 'Anna', kategorie: 'music' })
    const q: Quelle = {
      dienst: 'lokal',
      kennung: '',
      lokalPfad: { kategorie: 'audiobook', interpret: 'Anna', titel: 'Guten Morgen _ Good Morning (Englisch)' },
    }
    assert.equal(startPlan(w, q).art, 'inhalt')
  })

  it('der lokale RUECKFALL nimmt die Plattenform der Quelle, nie die Anzeige-Metadaten', () => {
    // Der Messfall vom 30.08.2026: die Aufnahme sanitisiert `/` zu `_`,
    // das verschmolzene Werk fuehrt Spotify-Metadaten. Diese Regel gilt
    // unveraendert weiter — nur ist der Befehl seit E111 der Rueckfall fuer
    // Boxen, deren Ordner nichts hergibt (fremder Mount), statt der Hauptweg.
    const w = werk({ titel: 'Guten Morgen / Good Morning', interpret: 'Anna', kategorie: 'music' })
    const q: Quelle = {
      dienst: 'lokal',
      kennung: '',
      lokalPfad: { kategorie: 'audiobook', interpret: 'Anna', titel: 'Guten Morgen _ Good Morning (Englisch)' },
    }
    assert.deepEqual(startPlan(w, q), {
      art: 'inhalt',
      rueckfall: 'musicsearch/library/album/audiobook:Anna:Guten%20Morgen%20_%20Good%20Morning%20(Englisch)',
    })
  })

  it('lokaler Rueckfall ohne Plattenform: Kategorie der Quelle vor der des Werks („Nah", E105)', () => {
    const w = werk({ titel: 'Nah', interpret: 'Alin Coen', kategorie: 'music' })
    const q: Quelle = { dienst: 'lokal', kennung: '', kategorie: 'audiobook' }
    assert.deepEqual(startPlan(w, q), {
      art: 'inhalt',
      rueckfall: 'musicsearch/library/album/audiobook:Alin%20Coen:Nah',
    })
    // Ohne Quell-Kategorie gilt die des Werks; ohne beide 'music'.
    assert.equal(
      (startPlan(w, { dienst: 'lokal', kennung: '' }) as { rueckfall: string }).rueckfall,
      'musicsearch/library/album/music:Alin%20Coen:Nah',
    )
  })

  it('spotify traegt Titelnummer und Millisekunden im STARTBEFEHL, 1-basiert unveraendert', () => {
    const w = werk({ art: 'album' })
    const q: Quelle = { dienst: 'spotify', kennung: '4uLU6hMCjMI75M1A2tKUQC' }
    assert.deepEqual(startPlan(w, q, 3, 45000), {
      art: 'befehl',
      pfad: 'spotify/now/spotify:album:4uLU6hMCjMI75M1A2tKUQC:3:45000',
    })
    // Adresse und Verweis werden zur nackten Id.
    const netz: Quelle = { dienst: 'spotify', kennung: 'https://open.spotify.com/album/4uLU6hMCjMI75M1A2tKUQC' }
    assert.equal((startPlan(w, netz) as { pfad: string }).pfad, 'spotify/now/spotify:album:4uLU6hMCjMI75M1A2tKUQC:0:0')
  })

  it('spotify kennt nur album, playlist und show — der Rest ist unspielbar, nicht geraten', () => {
    const q: Quelle = { dienst: 'spotify', kennung: '4uLU6hMCjMI75M1A2tKUQC' }
    assert.equal(startPlan(werk({ art: 'playlist' }), q).art, 'befehl')
    assert.equal(startPlan(werk({ art: 'show' }), q).art, 'befehl')
    assert.equal(startPlan(werk({ art: 'anderes' }), q).art, 'unspielbar')
    assert.equal(startPlan(werk({ art: 'album' }), { dienst: 'spotify', kennung: '' }).art, 'unspielbar')
  })

  it('eine Interpreten-Kachel oeffnet, sie spielt nie — vor jeder Quelle entschieden', () => {
    const q: Quelle = { dienst: 'spotify', kennung: '4uLU6hMCjMI75M1A2tKUQC' }
    assert.deepEqual(startPlan(werk({ art: 'interpret' }), q), { art: 'seite' })
  })

  it('jellyfin: Einzeltitel direkt, Album ueber /inhalt — und OHNE Rueckfall', () => {
    const q: Quelle = { dienst: 'jellyfin', kennung: 'abc123' }
    // Das `deepEqual` traegt hier eine zweite Aussage (E111): kein
    // `rueckfall`-Feld. Ein Jellyfin-Album hat keinen Ein-Befehl-Weg — seine
    // Tonadressen entstehen erst beim Abruf —, und ein leerer Rueckfall waere
    // ein Start ins Nichts. Nur lokal bringt einen.
    assert.deepEqual(startPlan(werk({ art: 'album' }), q), { art: 'inhalt' })
    assert.equal(
      (startPlan(werk({ art: 'anderes', titel: 'T', interpret: 'I' }), q) as { pfad: string }).pfad,
      'jellyfin/abc123/T:title:artist:I',
    )
  })

  it('ard und plugin sind NIE ein Ein-Befehl-Start — ihre Tonadressen laufen ab', () => {
    assert.deepEqual(startPlan(werk({ art: 'show' }), { dienst: 'ard', kennung: 'urn:ard:show:x' }), { art: 'inhalt' })
    assert.deepEqual(startPlan(werk({ art: 'show' }), { dienst: 'plugin', kennung: 'p:etwas' }), { art: 'inhalt' })
  })

  it('radio und rss bauen die Stromform; ohne Quelle oder Kennung ehrlich unspielbar', () => {
    const w = werk({ titel: 'Maus', interpret: 'WDR' })
    assert.equal(
      (startPlan(w, { dienst: 'radio', kennung: 'http://x/stream' }) as { pfad: string }).pfad,
      'radio/http%3A%2F%2Fx%2Fstream/Maus:title:artist:WDR',
    )
    assert.equal(startPlan(w, { dienst: 'rss', kennung: '' }).art, 'unspielbar')
    assert.equal(startPlan(werk({ quellen: [] }), null).art, 'unspielbar')
  })
})

describe('versuchsQuellen — Ausweichen, Anbieter-Sieb, Nummernraum (E95/V)', () => {
  const spotify: Quelle = { dienst: 'spotify', kennung: 's' }
  const jellyfin: Quelle = { dienst: 'jellyfin', kennung: 'j' }
  const lokal: Quelle = { dienst: 'lokal', kennung: '' }

  it('nimmt die geordnete Quellenliste des Werks, wie sie ist', () => {
    const r = versuchsQuellen(werk({ quellen: [lokal, spotify] }))
    assert.deepEqual(
      r.quellen.map((q) => q.dienst),
      ['lokal', 'spotify'],
    )
    assert.equal(r.alleAus, null)
  })

  it('mit Wunschdienst gibt es GENAU diese Quelle — oder nichts, nie eine andere', () => {
    const r = versuchsQuellen(werk({ quellen: [lokal, spotify] }), { wunschDienst: 'spotify' })
    assert.deepEqual(
      r.quellen.map((q) => q.dienst),
      ['spotify'],
    )
    assert.equal(versuchsQuellen(werk({ quellen: [lokal] }), { wunschDienst: 'spotify' }).quellen.length, 0)
  })

  it('der Anbieter-Schalter wirkt als Sieb: abgeschaltete Quellen werden uebersprungen', () => {
    const r = versuchsQuellen(werk({ quellen: [spotify, jellyfin] }), { abgeschaltet: ['spotify'] })
    assert.deepEqual(
      r.quellen.map((q) => q.dienst),
      ['jellyfin'],
    )
    assert.equal(r.alleAus, null)
  })

  it('sind ALLE Quellen abgeschaltet, traegt alleAus den bevorzugten Dienst fuer den Meldungssatz', () => {
    const r = versuchsQuellen(werk({ quellen: [spotify, jellyfin] }), { abgeschaltet: ['spotify', 'jellyfin'] })
    assert.equal(r.quellen.length, 0)
    assert.equal(r.alleAus, 'spotify')
    // Auch der Wunschdienst kann abgeschaltet sein.
    const w = versuchsQuellen(werk({ quellen: [spotify] }), { wunschDienst: 'spotify', abgeschaltet: ['spotify'] })
    assert.equal(w.quellen.length, 0)
    assert.equal(w.alleAus, 'spotify')
  })

  it('Nummernraum-Regel: fuehrt lokal und wurde woanders gemerkt, rueckt die gemerkte Quelle vor', () => {
    // „Du bedeutest mir die Welt" (30.08.2026): der Mitschnitt traegt nur
    // einen Teil des Albums, Titel 8 der Spotify-Liste existiert dort nicht.
    const r = versuchsQuellen(werk({ quellen: [lokal, jellyfin, spotify] }), { gemerktBei: 'spotify' })
    assert.deepEqual(
      r.quellen.map((q) => q.dienst),
      ['spotify', 'lokal', 'jellyfin'],
    )
  })

  it('die Regel greift NUR in diese eine Richtung und nur, wenn das Werk die gemerkte Quelle traegt', () => {
    // Bevorzugt ist nicht lokal -> volle Listen tauschen frei, nichts rueckt.
    const frei = versuchsQuellen(werk({ quellen: [spotify, jellyfin] }), { gemerktBei: 'jellyfin' })
    assert.deepEqual(
      frei.quellen.map((q) => q.dienst),
      ['spotify', 'jellyfin'],
    )
    // Das Werk traegt die gemerkte Quelle nicht mehr -> es bleibt bei lokal.
    const weg = versuchsQuellen(werk({ quellen: [lokal, jellyfin] }), { gemerktBei: 'spotify' })
    assert.deepEqual(
      weg.quellen.map((q) => q.dienst),
      ['lokal', 'jellyfin'],
    )
    // Ohne gemerktBei (Kacheltipp von vorn) rueckt nie etwas.
    const tipp = versuchsQuellen(werk({ quellen: [lokal, spotify] }))
    assert.equal(tipp.quellen[0].dienst, 'lokal')
  })
})

describe('folgeWaehlen — Kennung, dann weiterAb, dann die Nummer als Schiedsrichter', () => {
  const titel = [
    { id: 'a1', weiterAb: null },
    { id: 'a2', weiterAb: { titelNr: 2 } },
    { id: 'a3', weiterAb: null },
  ]

  it('die Kennung gewinnt immer', () => {
    assert.equal(folgeWaehlen(titel, 'a3', true, 1), 2)
  })

  it('weiterAb gilt nur aus der gemerkten Stelle — ein Kacheltipp meint GENAU seine Folge', () => {
    assert.equal(folgeWaehlen(titel, 'weg', true, 0), 1)
    assert.equal(folgeWaehlen(titel, 'weg', false, 0), -1)
  })

  it('die Nummer faengt die wieder eingesetzte Folge, aber nur in den Grenzen der Liste', () => {
    assert.equal(folgeWaehlen(titel, 'weg', false, 3), 2)
    assert.equal(folgeWaehlen(titel, 'weg', false, 4), -1)
    assert.equal(folgeWaehlen(titel, '', false, 0), -1)
  })
})

describe('seekZiel und sprungAngekommen — der mpv-Nachlauf', () => {
  it('springt nie auf genau 0 (aeltere Box liest das relativ) und klemmt auf 0.1..100', () => {
    assert.equal(seekZiel(0), null)
    assert.equal(seekZiel(-3), null)
    assert.equal(seekZiel('quatsch'), null)
    assert.equal(seekZiel(0.02), 0.1)
    assert.equal(seekZiel(55.5), 55.5)
    assert.equal(seekZiel(140), 100)
  })

  it('angekommen ist nur, was bei offener Datei die Stelle erreicht — Kulanz nur nach unten', () => {
    assert.equal(sprungAngekommen({ duration: 100, timePos: 42 }, 50), true)
    assert.equal(sprungAngekommen({ duration: 100, timePos: 41.9 }, 50), false)
    // Ohne Dauer ist nicht entscheidbar — dann gilt „nicht angekommen".
    assert.equal(sprungAngekommen({ duration: null, timePos: 50 }, 50), false)
    assert.equal(sprungAngekommen({ duration: 100 }, 50), false)
    assert.equal(sprungAngekommen(null, 50), false)
  })
})

describe('kennungAus und spotifyIdAus — Formen, nicht Glauben', () => {
  it('schneidet den Dienst-Vorsatz nur ab, wenn der Rest keine weitere Gliederung traegt', () => {
    assert.equal(kennungAus({ dienst: 'spotify', kennung: 'spotify:4aBc' }), '4aBc')
    assert.equal(kennungAus({ dienst: 'spotify', kennung: 'spotify:album:4aBc' }), 'spotify:album:4aBc')
    assert.equal(kennungAus(null), '')
  })

  it('holt die nackte Spotify-Id aus Id, Adresse und Verweis', () => {
    assert.equal(spotifyIdAus('4uLU6hMCjMI75M1A2tKUQC'), '4uLU6hMCjMI75M1A2tKUQC')
    assert.equal(
      spotifyIdAus('https://open.spotify.com/intl-de/album/4uLU6hMCjMI75M1A2tKUQC'),
      '4uLU6hMCjMI75M1A2tKUQC',
    )
    assert.equal(spotifyIdAus('spotify:album:4uLU6hMCjMI75M1A2tKUQC'), '4uLU6hMCjMI75M1A2tKUQC')
  })
})

describe('wunschVerfehlt — eine Quelle ohne den gewuenschten Titel', () => {
  it('DER GEMELDETE FALL: Kapitel 3 gewuenscht, Quelle hat einen Titel', () => {
    // `folgeWaehlen` gibt bei 3 auf einer 1-Titel-Liste -1 zurueck.
    assert.equal(folgeWaehlen([{ id: 'a' }], '', false, 3), -1)
    // UND GENAU DAS DARF NICHT ZU „spiel den ersten" werden.
    assert.equal(wunschVerfehlt(3, folgeWaehlen([{ id: 'a' }], '', false, 3)), true)
  })

  it('der Titel ist da: kein verfehlter Wunsch', () => {
    const liste = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    assert.equal(folgeWaehlen(liste, '', false, 3), 2)
    assert.equal(wunschVerfehlt(3, 2), false)
  })

  it('„von vorn" (titelNr 0) ist NIE ein verfehlter Wunsch — sonst kann nichts mehr ausweichen', () => {
    assert.equal(wunschVerfehlt(0, -1), false)
    assert.equal(wunschVerfehlt(0, 0), false)
  })

  it('der erste Titel ist ein gueltiger Wunsch, kein Rueckfall', () => {
    assert.equal(wunschVerfehlt(1, 0), false)
  })

  it('Unsinn wirft nicht und verfehlt nicht', () => {
    assert.equal(wunschVerfehlt(Number.NaN, -1), false)
    assert.equal(wunschVerfehlt(-5, -1), false)
    assert.equal(wunschVerfehlt(2, Number.NaN), true)
  })
})

describe('tonmaschine — welche Maschine spielt diesen Dienst', () => {
  it('Spotify ist die EINZIGE eigene Maschine', () => {
    assert.equal(tonmaschine('spotify'), 'spotify')
    assert.equal(tonmaschine('SPOTIFY'), 'spotify')
    assert.equal(tonmaschine(' spotify '), 'spotify')
  })

  it('alles andere laeuft ueber mpv — auch ein Dienst, den es noch nicht gibt', () => {
    // DIE VORGABE IST ABSICHT, nicht Bequemlichkeit: ein faelschlich als mpv
    // gefuehrter Dienst kostet den Wechsel, den es ohnehin gaebe. Ein
    // faelschlich als Spotify gefuehrter risse ein Cue-Fenster fuer nichts
    // auf — und ein stummes Fenster ohne Grund hoert man.
    for (const d of ['lokal', 'jellyfin', 'ard', 'rss', 'radio', 'plugin', 'was-auch-immer', '', null]) {
      assert.equal(tonmaschine(d), 'mpv', `${d} sollte mpv sein`)
    }
  })
})

describe('wechselpunkte — wo eine gemischte Liste die Maschine wechselt', () => {
  /** Eine Liste, wie sie `titelMischen`/`titelQuellenStempeln` hinterlassen. */
  const liste = (...paare: [number, string][]) => paare.map(([nr, quelle]) => ({ nr, quelle }))

  it('DER MESSFALL: ein Album ganz aus einer Maschine hat KEINEN Wechselpunkt', () => {
    // „101 Meerjungfrauen" spielt heute ganz aus der Cloud (E110,
    // GANZ-oder-GAR-NICHT). Ohne Mischliste gibt es nichts vorzubereiten —
    // und das Cue darf dann auch kein Fenster aufreissen.
    assert.deepEqual(wechselpunkte(liste([1, 'spotify'], [2, 'spotify'], [3, 'spotify'])), [])
  })

  it('lokal neben jellyfin ist KEIN Wechsel — dieselbe Maschine', () => {
    // Genau das ist der Grund, warum E108 Stufe 1 hier titelweise mischen
    // DARF: eine mpv-Warteschlange, nahtlos dank --prefetch-playlist.
    assert.deepEqual(wechselpunkte(liste([1, 'lokal'], [2, 'jellyfin'], [3, 'lokal'])), [])
  })

  it('findet den Uebergang mpv -> spotify und zurueck, mit beiden Nummern', () => {
    const w = wechselpunkte(liste([1, 'lokal'], [2, 'spotify'], [3, 'lokal']))
    assert.equal(w.length, 2)
    assert.deepEqual(
      w.map((x) => [x.vonNr, x.nachNr, x.vonMaschine, x.nachMaschine]),
      [
        [1, 2, 'mpv', 'spotify'],
        [2, 3, 'spotify', 'mpv'],
      ],
    )
  })

  it('DER HALB-MITSCHNITT: der Nachfolger von 02 ist 06, nicht 03', () => {
    // Die Falle, die als E110 und E111 schon zweimal bezahlt wurde und im
    // E111-Eintrag als offene Fussnote steht: Position und `nr` sind NICHT
    // dasselbe. Wer hier nr+1 rechnet, findet den Wechselpunkt nie.
    const w = wechselpunkte(liste([1, 'lokal'], [2, 'lokal'], [6, 'spotify'], [8, 'spotify']))
    assert.equal(w.length, 1)
    assert.equal(w[0].vonNr, 2)
    assert.equal(w[0].nachNr, 6, 'der Nachfolger kommt aus der LISTE, nicht aus der Nummer')
    assert.equal(w[0].vonPlatz, 1)
  })

  it('ein Titel OHNE Quelle wird uebersprungen, nicht als mpv geraten', () => {
    // `titelMischen` laesst `quelle` weg, wenn KEINE Quelle den Titel hat.
    // So einer wird gar nicht gespielt — ihn mitzuzaehlen erfaende einen
    // Uebergang, den es nicht gibt, und das Cue spannte ins Leere.
    const w = wechselpunkte([{ nr: 1, quelle: 'spotify' }, { nr: 2, quellen: [] }, { nr: 3, quelle: 'spotify' }])
    assert.deepEqual(w, [], 'die Luecke darf keinen Wechsel erfinden')
  })

  it('haelt kaputte Eingaben aus, statt zu werfen', () => {
    assert.deepEqual(wechselpunkte([]), [])
    assert.deepEqual(wechselpunkte(undefined as unknown as []), [])
    assert.deepEqual(wechselpunkte(liste([1, 'lokal'])), [], 'ein einzelner Titel hat keinen Uebergang')
  })
})

describe('wechselNach — steht am Ende DIESES Titels ein Maschinenwechsel', () => {
  const gemischt = [
    { nr: 1, quelle: 'lokal' },
    { nr: 2, quelle: 'spotify' },
    { nr: 3, quelle: 'spotify' },
  ]

  it('sagt VOR dem Uebergang Bescheid — darauf beruht das ganze Cue', () => {
    // Ein Cue, das erst AM Uebergang merkt, dass die Maschine wechselt,
    // kommt zu spaet: Starten, Puffern und Springen kosten genau die 1-2 s,
    // die es zu verstecken gilt.
    const w = wechselNach(gemischt, 1)
    assert.ok(w, 'der Wechsel nach Titel 1 muss gefunden werden')
    assert.equal(w.nachNr, 2)
    assert.equal(w.nachMaschine, 'spotify')
  })

  it('schweigt, wo nichts vorzubereiten ist', () => {
    assert.equal(wechselNach(gemischt, 2), null, 'spotify -> spotify ist kein Wechsel')
    assert.equal(wechselNach(gemischt, 3), null, 'der letzte Titel hat keinen Nachfolger')
    assert.equal(wechselNach(gemischt, 99), null, 'unbekannte Nummer')
    assert.equal(wechselNach(gemischt, Number.NaN), null)
  })

  it('FREIE WAHL IST NICHT VORHERSAGBAR — und das ist die Entscheidung', () => {
    // Betreiber: „falls frei gewaehlt wird gibt es eben einen versatz von
    // 1-2s." Diese Funktion beantwortet AUSSCHLIESSLICH die lineare Frage
    // „was kommt nach diesem Titel". Ein Tipp auf Titel 3 aus dem Stand
    // fragt sie gar nicht — dort bleibt es beim Versatz, ehrlich bezahlt.
    // Der Test haelt das fest, damit niemand es spaeter fuer eine Luecke
    // haelt und ein Cue „auf Verdacht" baut.
    assert.equal(wechselNach(gemischt, 3), null)
  })
})

describe('abschnittAb — die Strecke, die EINE Maschine am Stueck traegt', () => {
  const liste = (...paare: [number, string][]) => paare.map(([nr, quelle]) => ({ nr, quelle }))

  it('DER MESSFALL: lokal 1-2, Spotify ab 3 — die Strecke endet mit Uebergabe', () => {
    const a = abschnittAb(liste([1, 'lokal'], [2, 'lokal'], [3, 'spotify'], [4, 'spotify']), 1)
    assert.equal(a.maschine, 'mpv')
    assert.deepEqual(
      a.titel.map((t) => t.nr),
      [1, 2],
    )
    assert.equal(a.uebergabe?.nachNr, 3)
    assert.equal(a.uebergabe?.nachMaschine, 'spotify')
  })

  it('reicht die Strecke bis zum Schluss, gibt es nichts zu uebergeben', () => {
    const a = abschnittAb(liste([1, 'spotify'], [2, 'spotify']), 1)
    assert.deepEqual(
      a.titel.map((t) => t.nr),
      [1, 2],
    )
    assert.equal(a.uebergabe, null, 'am Ende darf kein Fenster aufgerissen werden')
  })

  it('NIMMT NICHT ALLE LOKALEN, SONDERN DIE ZUSAMMENHAENGENDEN', () => {
    // Liegt lokal 1, 2 und 7 vor, ist die Strecke ab 1 genau [1, 2]. Wer alle
    // lokalen in eine mpv-Warteschlange wirft, spielt 1, 2, 7 hintereinander
    // und ueberspringt 3 bis 6 stillschweigend — dieselbe Sorte Fehlgriff wie
    // E110, nur andersherum: eine Liste, die nicht die angezeigte ist.
    const a = abschnittAb(
      liste([1, 'lokal'], [2, 'lokal'], [3, 'spotify'], [4, 'spotify'], [5, 'spotify'], [6, 'spotify'], [7, 'lokal']),
      1,
    )
    assert.deepEqual(
      a.titel.map((t) => t.nr),
      [1, 2],
      'die 7 gehoert nicht in diese Strecke',
    )
  })

  it('startet MITTEN in einer Strecke, wenn dort angetippt wurde', () => {
    const a = abschnittAb(liste([1, 'lokal'], [2, 'lokal'], [3, 'spotify']), 2)
    assert.deepEqual(
      a.titel.map((t) => t.nr),
      [2],
    )
    assert.equal(a.uebergabe?.nachNr, 3)
  })

  it('mit der Spotify-Strecke geht es genauso zurueck zu mpv', () => {
    const a = abschnittAb(liste([1, 'lokal'], [2, 'spotify'], [3, 'spotify'], [4, 'lokal']), 2)
    assert.equal(a.maschine, 'spotify')
    assert.deepEqual(
      a.titel.map((t) => t.nr),
      [2, 3],
    )
    assert.equal(a.uebergabe?.nachMaschine, 'mpv')
  })

  it('unbekannte Nummer oder kaputte Liste: leere Strecke, nichts erfunden', () => {
    assert.deepEqual(abschnittAb(liste([1, 'lokal']), 99), { titel: [], maschine: 'mpv', uebergabe: null })
    assert.deepEqual(abschnittAb([], 1).titel, [])
    assert.deepEqual(abschnittAb(undefined as unknown as [], 1).titel, [])
  })
})
