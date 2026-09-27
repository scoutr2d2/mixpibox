import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type LaneZeile, stelleAmAlbum, stelleAmTitel } from './lane-weiter.js'
import { type Stelle, weiterhoerbare } from './weiterhoeren.js'

/**
 * DER BLAUE KNOPF IN DEN LANES — die Faelle, an denen er sich entscheidet.
 *
 * Der teuerste Fehler waere ein blauer Knopf, der etwas anderes tut als er
 * verspricht. Deshalb steht hier neben jedem „ja" auch das dazugehoerige
 * „nein" mit derselben Zahl: 0 ms ist kein Weiterhoeren, und ein Treffer im
 * Nachbaralbum ist keiner.
 */
describe('lane-weiter', () => {
  /** Eine Weiterhoeren-Zeile, wie /api/weiterhoeren sie liefert. */
  const z = (titelNr: number | null, positionMs: number | null): LaneZeile => ({ titelNr, positionMs })

  describe('stelleAmTitel', () => {
    it('faerbt genau den Titel, auf dem die Stelle liegt (versatz + 1 === titelNr)', () => {
      // Kapitel 47 der Playlist: Versatz 46, gemerkte Nummer 47.
      assert.deepEqual(stelleAmTitel(z(47, 92_500), 46), { titelNr: 47, positionMs: 92_500 })
    })

    it('laesst die Nachbarn neutral — ein Titel daneben ist ein anderes Kapitel', () => {
      assert.equal(stelleAmTitel(z(47, 92_500), 45), null)
      assert.equal(stelleAmTitel(z(47, 92_500), 47), null)
    })

    it('bleibt bei 0 ms neutral: „weiterhoeren" waere hier derselbe Befehl wie „von vorn"', () => {
      assert.equal(stelleAmTitel(z(47, 0), 46), null)
      assert.equal(stelleAmTitel(z(47, null), 46), null)
    })

    it('nimmt „von vorn" (titelNr 0) nicht als Stelle', () => {
      assert.equal(stelleAmTitel(z(0, 92_500), 0), null)
      assert.equal(stelleAmTitel(z(0, 92_500), -1), null)
    })

    it('haelt Unfug aus, ohne etwas zu behaupten', () => {
      assert.equal(stelleAmTitel(null, 3), null)
      assert.equal(stelleAmTitel(undefined, 3), null)
      assert.equal(stelleAmTitel(z(Number.NaN, 1000), 3), null)
      assert.equal(stelleAmTitel(z(4, 1000), Number.NaN), null)
      assert.equal(stelleAmTitel(z(4, 1000), -3), null)
    })
  })

  describe('stelleAmAlbum', () => {
    // Ein Album mit vier Titeln, LUECKENLOS: Versatz 10 bis 13.
    const dicht = [10, 11, 12, 13]

    it('faerbt das Album, in dem die Stelle liegt', () => {
      assert.deepEqual(stelleAmAlbum(z(13, 5_000), dicht), { titelNr: 13, positionMs: 5_000 })
    })

    it('laesst das Nachbaralbum neutral', () => {
      assert.equal(stelleAmAlbum(z(15, 5_000), dicht), null)
      assert.equal(stelleAmAlbum(z(10, 5_000), dicht), null)
    })

    it('DIE LUECKE: gesperrte Stuecke verschieben nichts, weil aufgezaehlt statt gerechnet wird', () => {
      // Versatz 12 fehlt (in Deutschland gesperrt), das Album liegt auf
      // 10, 11, 13, 14. Eine Rechnung `ersterVersatz + anzahl` haette bei 13
      // aufgehoert — und 12 faelschlich eingeschlossen.
      const mitLuecke = [10, 11, 13, 14]
      assert.deepEqual(stelleAmAlbum(z(15, 1), mitLuecke), { titelNr: 15, positionMs: 1 })
      assert.equal(stelleAmAlbum(z(13, 1), mitLuecke), null)
    })

    it('bleibt neutral, wenn die Stelle der ANFANG des Albums bei 0 ms ist', () => {
      // Titel 11 ist Versatz 10, also der erste dieses Albums — bei 0 ms
      // waere der blaue Knopf Zeichen fuer Zeichen derselbe Befehl.
      assert.equal(stelleAmAlbum(z(11, 0), dicht), null)
    })

    it('faerbt dagegen den ANFANG des Albums, sobald es mitten im Titel weitergeht', () => {
      assert.deepEqual(stelleAmAlbum(z(11, 45_000), dicht), { titelNr: 11, positionMs: 45_000 })
    })

    it('faerbt einen SPAETEREN Titel auch bei 0 ms — dort ist es ein anderer Startpunkt', () => {
      assert.deepEqual(stelleAmAlbum(z(13, 0), dicht), { titelNr: 13, positionMs: 0 })
    })

    it('haelt eine leere oder fehlende Versatzliste aus', () => {
      assert.equal(stelleAmAlbum(z(13, 5_000), []), null)
      assert.equal(stelleAmAlbum(z(13, 5_000), null), null)
      assert.equal(stelleAmAlbum(z(13, 5_000), undefined), null)
      assert.equal(stelleAmAlbum(null, dicht), null)
    })
  })

  /**
   * DIE KETTE, NICHT NUR IHR LETZTES GLIED.
   *
   * lane-weiter.ts prueft ausdruecklich NICHT, ob die gemerkte Nummer
   * ueberhaupt die richtige Zaehlweise traegt — das tut `weiterhoerbare()`
   * davor (`nummerVerlaesslich`, `istDurch`). Diese Arbeitsteilung ist im
   * Kopf der Datei beschrieben, war aber an keiner Stelle GEPRUEFT: beide
   * Seiten fuer sich gruen, und trotzdem koennte die Naht offen sein. Genau
   * dort liegt der teuerste Fehler dieses Umbaus — ein blauer Knopf auf einem
   * Stand der ALTEN Zaehlweise springt in ein Kapitel, das das Kind nie
   * gehoert hat, und das klingt nicht nach einem Fehler, sondern nach kaputt
   * (llmwiki resume-playlistposition-schickt-in-die-falsche-folge).
   *
   * NACHGEBAUT WIRD `laneWeiterZeile` AUS server.ts, ohne die zwei
   * Dateizugriffe: `weiterhoerbare(stellen, [], stellen.length)`, dann die
   * Zeile zum Werk, dann lane-weiter. Der Deckel steht auf `stellen.length`
   * und nicht auf 6 — hier wird EINE Zeile gesucht, und ein Deckel gehoert
   * ans Ende einer Kette von Sieben (llmwiki weiterhoeren-deckel-vor-dem-sieb).
   */
  describe('die Kette: was weiterhoerbare() vorsiebt, wird nie blau', () => {
    /** Eine Hoerspiel-Playlist mit 50 Titeln — der Fall der Box. */
    const PLAYLIST = {
      playlistid: 'laneKettePlaylist01',
      title: 'Die grosse Hoerspielreihe',
      artist: 'EUROPA',
      type: 'spotify',
      category: 'resume',
    }

    /** So bauen Server und Oberflaeche die Zeile zusammen — eine Stelle, ein Weg. */
    const zeileZu = (s: Stelle): LaneZeile | null => weiterhoerbare([s], [], 1)[0] ?? null

    it('ALTE ZAEHLWEISE: ohne `resumeVersatzGeprueft` gibt es gar keine Zeile — und damit nirgends Blau', () => {
      // Das Kind hoert Kapitel 47; dieses Stueck ist auf SEINEM Album Titel 3.
      // Ohne die Marke steht in resume.json die 3, und die zeigt in die
      // falsche Folge.
      const alt: Stelle = {
        ...PLAYLIST,
        resumespotifytrack_number: 3,
        resumespotifyprogress_ms: 92_500,
        resumespotifyduration_ms: 1_200_000,
        resumeGesamtTitel: 50,
      }
      const zeile = zeileZu(alt)
      assert.equal(zeile, null, 'ein Playlist-Stand ohne Marke darf gar nicht erst zur Zeile werden')
      // Und der Vollstaendigkeit halber: was nicht da ist, faerbt auch nichts.
      assert.equal(stelleAmTitel(zeile, 2), null)
      assert.equal(stelleAmAlbum(zeile, [0, 1, 2, 3]), null)
    })

    it('GEPRUEFTE ZAEHLWEISE: dieselbe Stelle wird zur Zeile und faerbt genau Kapitel 47', () => {
      const neu: Stelle = {
        ...PLAYLIST,
        resumespotifytrack_number: 47,
        resumeVersatzGeprueft: true,
        resumespotifyprogress_ms: 92_500,
        resumespotifyduration_ms: 1_200_000,
        resumeGesamtTitel: 50,
      }
      const zeile = zeileZu(neu)
      assert.ok(zeile, 'eine geprueste Playlist-Stelle muss durchkommen')
      // Versatz 46 ist Kapitel 47 — die +1 macht `startPlan`, nicht diese
      // Zahl (sie ist schon 1-basiert).
      assert.deepEqual(stelleAmTitel(zeile, 46), { titelNr: 47, positionMs: 92_500 })
      assert.equal(stelleAmTitel(zeile, 45), null, 'der Nachbar bleibt neutral')
      assert.deepEqual(stelleAmAlbum(zeile, [44, 45, 46, 47]), { titelNr: 47, positionMs: 92_500 })
      assert.equal(stelleAmAlbum(zeile, [40, 41, 42, 43]), null, 'das Nachbaralbum bleibt neutral')
    })

    it('DURCHGEHOERT: der letzte Titel der Playlist zu 99 Prozent faerbt nichts mehr', () => {
      // Ohne diese Pruefung saesse der blaue Knopf am ENDE des Werks: er
      // spielte drei Sekunden und waere fertig — fuer ein Kind sieht das aus,
      // als sei nichts passiert.
      const durch: Stelle = {
        ...PLAYLIST,
        resumespotifytrack_number: 50,
        resumeVersatzGeprueft: true,
        resumespotifyprogress_ms: 1_190_000,
        resumespotifyduration_ms: 1_200_000,
        resumeGesamtTitel: 50,
      }
      assert.equal(zeileZu(durch), null, 'ein durchgehoertes Werk darf keinen blauen Knopf tragen')
      assert.equal(stelleAmTitel(zeileZu(durch), 49), null)
      assert.equal(stelleAmAlbum(zeileZu(durch), [46, 47, 48, 49]), null)
    })

    it('KNAPP DAVOR ist es noch keine Stelle am Ende: derselbe Titel bei 50 Prozent bleibt blau', () => {
      // Die Gegenprobe zum Fall darueber. Ohne sie kann der Test oben auch
      // dann gruen sein, wenn `weiterhoerbare` alles wegwirft.
      const knapp: Stelle = {
        ...PLAYLIST,
        resumespotifytrack_number: 50,
        resumeVersatzGeprueft: true,
        resumespotifyprogress_ms: 600_000,
        resumespotifyduration_ms: 1_200_000,
        resumeGesamtTitel: 50,
      }
      assert.deepEqual(stelleAmTitel(zeileZu(knapp), 49), { titelNr: 50, positionMs: 600_000 })
    })

    it('BENANNT, NICHT BEHOBEN: ein Album MITTEN in der Playlist bleibt blau, auch wenn es durch ist', () => {
      // `istDurch` fragt nach dem WERK, nicht nach dem Album: Titel 10 von 50
      // ist zu 99 Prozent durch, die Playlist laengst nicht. Der blaue Knopf
      // auf „Album 1" spielt dann ein paar Sekunden und geht in Album 2
      // ueber. Bei einer PLAYLIST ist genau das die richtige Fortsetzung —
      // deshalb steht der Fall hier festgeschrieben und nicht abgestellt.
      // Wer ihn spaeter aendert, aendert damit auch diese Erwartung bewusst.
      const albumEnde: Stelle = {
        ...PLAYLIST,
        resumespotifytrack_number: 10,
        resumeVersatzGeprueft: true,
        resumespotifyprogress_ms: 1_190_000,
        resumespotifyduration_ms: 1_200_000,
        resumeGesamtTitel: 50,
      }
      assert.deepEqual(stelleAmAlbum(zeileZu(albumEnde), [6, 7, 8, 9]), { titelNr: 10, positionMs: 1_190_000 })
    })

    it('EIN ALBUM ist von der Zaehlweisen-Falle nicht betroffen und kommt ohne Marke durch', () => {
      // Gegenprobe zur ersten Erwartung: Sie darf nicht daran liegen, dass
      // `weiterhoerbare` grundsaetzlich nichts durchlaesst. Bei einem Album
      // sind Album-Nummer und Abspielposition dieselbe Zahl.
      const album: Stelle = {
        id: 'laneKetteAlbum01',
        title: 'Ein ganzes Album',
        artist: 'EUROPA',
        type: 'spotify',
        category: 'resume',
        resumespotifytrack_number: 4,
        resumespotifyprogress_ms: 92_500,
        resumespotifyduration_ms: 1_200_000,
        resumeGesamtTitel: 12,
      }
      assert.deepEqual(stelleAmTitel(zeileZu(album), 3), { titelNr: 4, positionMs: 92_500 })
    })
  })
})
