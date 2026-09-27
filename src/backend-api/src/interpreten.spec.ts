/**
 * Tests der Interpreten-Erkennung und der Freischaltungen.
 *
 * DIE ECHTEN NAMEN DER BOX STEHEN HIER DRIN, nicht erfundene. Gemessen am
 * 2026-08-03 mit tools/interpreten-erkennung.mjs (nur lesend: ssh auf
 * data.json, dann je Name ein GET auf die Durchreiche der Box):
 *
 *   26 Eintraege -> 26 Werke -> 16 Interpretennamen
 *   erkannt (9):  EMMA6, Kapelle Petra, Lichterkinder, Das Pummeleinhorn,
 *                 Red Hot Chili Peppers, Das Lumpenpack, Kleine Prinzessin,
 *                 Prinzessin Lillifee, Der kleine Major Tom
 *   nicht (7):    EUROPA Hörspiele & Kinderlieder, kidsclubedutainment,
 *                 lismio: Kids - Hörbücher & Musik, matze.sp.hh, jasche-98,
 *                 𝓛𝓮𝓸𝓷𝓲𝓮♡, 🩵Jojo 🩵
 *
 * DER SCHWERPUNKT LIEGT AUF DEM NEIN. Eine Kachel zu wenig ist ein
 * Schoenheitsfehler; eine fremde Person im Regal des Kindes ist keiner. Und
 * ein „nein", das den Neustart nicht ueberlebt, ist ueberhaupt keines — genau
 * daran ist die Loesung im sessionStorage gescheitert.
 *
 * DER TEUERSTE DENKBARE AUSGANG dieses Auftrags waere ein freigeschalteter
 * Interpret ohne eigene Werke, der STILL aus der Reihe faellt: Der Benutzer
 * sucht ihn, schaltet ihn frei, und auf der Box aendert sich nichts. Dieser
 * Fall wird deshalb ausdruecklich geprueft.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ablehnen,
  bildAusTreffer,
  ERKENNUNG_AUSFALL_MS,
  ERKENNUNG_MS,
  type Erkennung,
  erkennungFortschreiben,
  freischalten,
  INTERPRETEN_ABLAGE_LEER,
  interpretAusTreffern,
  interpretenAblageAus,
  interpretenAblageWandern,
  interpretenReihe,
  istSpotifyKennung,
  namensSchluessel,
  suchtrefferAus,
  urteilFuer,
  zuPruefen,
  zuruecknehmen,
} from './interpreten'
import { interpretSchluesselAus } from './medien'
import type { Werk } from './werke'
import { werkeAus } from './werke'

/** Eine echte Kennung der Box — 22 Zeichen, sonst greift der Waechter. */
const LUMPENPACK = '1yoERhqOE1iKKzKELHhEWM'
const JOJO_SAENGERIN = '5xuNBZoM7z1Vv8IQ6uM0p6'
const ZUCKOWSKI = '2qn4hIXsvRUyFoboMi31XB'

function treffer(name: string, id: string, bilder: string[] = []) {
  return { id, name, images: bilder.map((url) => ({ url })), genres: ['kids'], followers: { total: 4711 } }
}

/**
 * Ein Werk fuer die Attrappe.
 *
 * DER SCHLUESSEL WIRD GERECHNET, nicht abgeschrieben (berichtigt 19.08.2026):
 * Hier stand er als drittes Argument in jeder Zeile, und beim Wechsel auf
 * `interpretSchluesselAus` behaupteten die Attrappen etwas anderes als
 * `werkAus()` — die Tests pruefen dann eine Box, die es nicht gibt. Wer
 * ausdruecklich einen ABWEICHENDEN Schluessel braucht (der Fall „EUROPA"),
 * gibt ihn weiter mit; dann steht die Absicht in der Zeile.
 */
function werk(schluessel: string, interpret: string, interpretSchluessel = interpretSchluesselAus(interpret)): Werk {
  return {
    schluessel,
    art: 'album',
    titel: 'Die Zukunft wird groß',
    interpret,
    interpretSchluessel,
    bild: `/api/bild/${encodeURIComponent(schluessel)}`,
    kategorie: 'music',
    quellen: [{ dienst: 'spotify', kennung: schluessel.slice('spotify:'.length) }],
  }
}

describe('namensSchluessel — der Vergleich der Erkennung', () => {
  it('macht Gross- und Kleinschreibung gleich', () => {
    assert.equal(namensSchluessel('Das Lumpenpack'), namensSchluessel('das lumpenpack'))
  })

  it('macht zusammengesetzte und zerlegte Umlaute gleich', () => {
    // Dieselbe Zeichenkette, einmal als U+00F6 und einmal als o + U+0308.
    assert.equal(namensSchluessel('Hörspiele'), namensSchluessel('Hörspiele'))
  })

  it('fasst mehrfache Leerzeichen zusammen und schneidet Raender ab', () => {
    assert.equal(namensSchluessel('  Kapelle   Petra '), 'kapelle petra')
  })

  it('WIRFT KEINE ZEICHEN WEG — genau das ist der Unterschied zu normal()', () => {
    // GEMESSEN 2026-08-03: `normal("🩵Jojo 🩵")` ergibt "jojo" und trifft damit
    // Spotifys Saengerin "JoJo". Das ist der Fall, um dessentwillen es dieses
    // Feature ueberhaupt gibt — er darf hier NICHT durchrutschen.
    assert.notEqual(namensSchluessel('🩵Jojo 🩵'), namensSchluessel('JoJo'))
    assert.notEqual(namensSchluessel('Die Drei ???'), namensSchluessel('Die Drei'))
  })
})

describe('interpretAusTreffern — die Automatik', () => {
  it('erkennt den namensgleichen Treffer und nimmt die Kennung mit', () => {
    const u = interpretAusTreffern('Das Lumpenpack', [
      treffer('Lumpenpack Tribute', 'aaaaaaaaaaaaaaaaaaaaaa'),
      treffer('das lumpenpack', LUMPENPACK, ['gross.jpg', 'https://i.scdn.co/image/mittel']),
    ])
    assert.deepEqual(u, { ja: true, id: LUMPENPACK, bild: 'https://i.scdn.co/image/mittel' })
  })

  it('sagt nein, wenn kein Treffer den Namen genau traegt', () => {
    // „🩵Jojo 🩵" auf der echten Box: Spotify liefert die Saengerin „JoJo",
    // und die ist ein anderer Mensch.
    const u = interpretAusTreffern('🩵Jojo 🩵', [treffer('JoJo', JOJO_SAENGERIN)])
    assert.deepEqual(u, { ja: false, id: null })
  })

  it('OHNE BRAUCHBARE KENNUNG KEIN JA — die Kachel fuehrte sonst auf nichts', () => {
    // `istInterpret` (app.js) gab hier `{ja:true, id:''}`; die Kachel stand in
    // der Reihe und wies sich beim Antippen selbst ab.
    assert.deepEqual(interpretAusTreffern('Kapelle Petra', [treffer('Kapelle Petra', '')]), { ja: false, id: null })
    assert.deepEqual(interpretAusTreffern('Kapelle Petra', [treffer('Kapelle Petra', 'zu-kurz')]), {
      ja: false,
      id: null,
    })
  })

  it('bei AUSFALL lieber zeigen — ein leeres Netz darf die Reihe nicht leeren', () => {
    assert.deepEqual(interpretAusTreffern('Kapelle Petra', null), { ja: true, id: null })
  })

  it('eine LEERE Trefferliste ist ein Nein, kein Ausfall', () => {
    assert.deepEqual(interpretAusTreffern('Kapelle Petra', []), { ja: false, id: null })
  })

  it('ohne Namen wird nicht geurteilt', () => {
    assert.deepEqual(interpretAusTreffern('   ', [treffer('irgendwer', LUMPENPACK)]), { ja: false, id: null })
  })

  it('nimmt das MITTLERE Bild — 640 px waeren das Sechsfache des Schirms', () => {
    assert.equal(bildAusTreffer(treffer('x', LUMPENPACK, ['gross', 'mittel', 'klein'])), 'mittel')
    assert.equal(bildAusTreffer(treffer('x', LUMPENPACK, ['nurEins'])), 'nurEins')
    assert.equal(bildAusTreffer(treffer('x', LUMPENPACK, [])), null)
  })
})

describe('erkennungFortschreiben — was ein AUSFALL mit dem Gewussten macht', () => {
  it('ein Treffer gilt zwoelf Stunden', () => {
    const { urteil, dauerMs } = erkennungFortschreiben('Das Lumpenpack', [treffer('Das Lumpenpack', LUMPENPACK)])
    assert.deepEqual(urteil, { ja: true, id: LUMPENPACK, bild: null })
    assert.equal(dauerMs, ERKENNUNG_MS)
  })

  it('eine LEERE Trefferliste ist eine Antwort und gilt genauso lang', () => {
    // Spotify hat geantwortet: „diesen Namen kenne ich nicht". Das ist Wissen,
    // kein Ausfall — sonst fragte die Box fuer die sieben Ersteller dieser Box
    // im Minutentakt nach.
    const { urteil, dauerMs } = erkennungFortschreiben('matze.sp.hh', [])
    assert.deepEqual(urteil, { ja: false, id: null })
    assert.equal(dauerMs, ERKENNUNG_MS)
  })

  it('DER AUSFALL BEHAELT DAS JA MIT SEINER KENNUNG — sonst steht eine tote Kachel da', () => {
    // Der Fall, um den es geht: die Box laeuft seit ueber zwoelf Stunden, die
    // Frist ist abgelaufen, und ausgerechnet jetzt ist das WLAN weg. Ohne diese
    // Regel wurde aus {ja:true, id:'0zH…'} ein {ja:true, id:null} — die Kachel
    // blieb stehen und wies sich beim Antippen selbst ab („Zu diesem
    // Interpreten weiß Spotify hier nichts.").
    const gewusst = { ja: true, id: LUMPENPACK, bild: 'https://i.scdn.co/image/mittel' }
    const { urteil, dauerMs } = erkennungFortschreiben('Das Lumpenpack', null, gewusst)
    assert.deepEqual(urteil, gewusst)
    assert.equal(dauerMs, ERKENNUNG_AUSFALL_MS)
  })

  it('DER AUSFALL BEHAELT AUCH DAS NEIN — sonst kommt „Jojo" zurueck', () => {
    // Die andere Haelfte desselben Fehlers, und die schmerzhaftere: „lieber
    // zeigen" holte bei jedem Ausfall die sieben Namen zurueck, die die
    // Automatik aussortiert hatte. Auf dieser Box waeren das 16 Kacheln statt
    // 9 — darunter „🩵Jojo 🩵", der Fall, der dieses Feature ausgeloest hat.
    const gewusst = { ja: false, id: null }
    const { urteil, dauerMs } = erkennungFortschreiben('🩵Jojo 🩵', null, gewusst)
    assert.deepEqual(urteil, gewusst)
    assert.equal(dauerMs, ERKENNUNG_AUSFALL_MS)
  })

  it('nur wenn NICHTS bekannt ist, gilt „lieber zeigen"', () => {
    // Erster Blick nach einem Serverstart, und Spotify antwortet nicht. Jetzt
    // ist eine volle Reihe ohne Kennungen richtig: eine leere Reihe saehe aus,
    // als haette die Box die Bibliothek vergessen.
    for (const vorher of [undefined, null]) {
      const { urteil, dauerMs } = erkennungFortschreiben('Kapelle Petra', null, vorher)
      assert.deepEqual(urteil, { ja: true, id: null })
      assert.equal(dauerMs, ERKENNUNG_AUSFALL_MS)
    }
  })

  it('ein Treffer nach einem Ausfall ueberschreibt das Gemerkte wieder', () => {
    // Die Frist darf nicht zur Einbahnstrasse werden: kommt das Netz zurueck,
    // gilt wieder, was Spotify sagt — auch ein „nein" gegen ein altes „ja".
    const alt = { ja: true, id: LUMPENPACK, bild: null }
    const { urteil, dauerMs } = erkennungFortschreiben('Das Lumpenpack', [], alt)
    assert.deepEqual(urteil, { ja: false, id: null })
    assert.equal(dauerMs, ERKENNUNG_MS)
  })
})

describe('istSpotifyKennung', () => {
  it('genau 22 Zeichen aus Buchstaben und Ziffern', () => {
    assert.equal(istSpotifyKennung(LUMPENPACK), true)
    assert.equal(istSpotifyKennung(`${LUMPENPACK}x`), false)
    assert.equal(istSpotifyKennung('spotify:artist:1yoERhqOE1iKKzKELHhEWM'), false)
    assert.equal(istSpotifyKennung(''), false)
    assert.equal(istSpotifyKennung(null), false)
  })
})

describe('interpretenAblageAus — von Hand aenderbar heisst von Hand krumm', () => {
  it('macht aus nichts eine leere Ablage', () => {
    assert.deepEqual(interpretenAblageAus(undefined), INTERPRETEN_ABLAGE_LEER)
    assert.deepEqual(interpretenAblageAus('kaputt'), INTERPRETEN_ABLAGE_LEER)
    assert.deepEqual(interpretenAblageAus({ frei: 'nein', abgelehnt: 7 }), INTERPRETEN_ABLAGE_LEER)
  })

  it('wirft die kaputte ZEILE weg, nicht die Datei', () => {
    const a = interpretenAblageAus({
      frei: [
        { name: 'Rolf Zuckowski', id: ZUCKOWSKI, quelle: 'suche' },
        { name: 'Ohne Kennung', id: 'xx' },
        { id: LUMPENPACK },
      ],
      abgelehnt: [{ name: '🩵Jojo 🩵' }, { name: '   ' }, null],
    })
    assert.equal(a.frei.length, 1)
    assert.equal(a.frei[0].name, 'Rolf Zuckowski')
    assert.equal(a.abgelehnt.length, 1)
    assert.equal(a.abgelehnt[0].name, '🩵Jojo 🩵')
  })

  it('bildet den Schluessel NEU und glaubt ihn nicht — sonst faende die Reihe die Werke nicht', () => {
    const a = interpretenAblageAus({
      frei: [{ schluessel: 'voellig anders', name: 'Kapelle Petra', id: LUMPENPACK, quelle: 'hand' }],
    })
    assert.equal(a.frei[0].schluessel, 'kapelle petra')
  })

  it('nimmt eine Ablehnung auch als blossen Namen an — so schreibt man sie von Hand hin', () => {
    const a = interpretenAblageAus({ abgelehnt: ['jasche-98'] })
    assert.deepEqual(a.abgelehnt, [{ schluessel: 'jasche 98', name: 'jasche-98' }])
  })

  it('behaelt bei doppeltem Schluessel den ERSTEN', () => {
    const a = interpretenAblageAus({
      frei: [
        { name: 'Kapelle Petra', id: LUMPENPACK, quelle: 'suche' },
        { name: 'kapelle petra', id: ZUCKOWSKI, quelle: 'hand' },
      ],
    })
    assert.equal(a.frei.length, 1)
    assert.equal(a.frei[0].id, LUMPENPACK)
  })

  it('eine unbekannte Quelle wird zu „hand", nicht zum Ausschluss', () => {
    const a = interpretenAblageAus({ frei: [{ name: 'X', id: LUMPENPACK, quelle: 'zauberei' }] })
    assert.equal(a.frei[0].quelle, 'hand')
  })
})

describe('freischalten / ablehnen / zuruecknehmen', () => {
  it('freischalten legt an und merkt sich, woher es kam', () => {
    const a = freischalten(INTERPRETEN_ABLAGE_LEER, { id: ZUCKOWSKI, name: 'Rolf Zuckowski', quelle: 'suche' }, 'JETZT')
    assert.deepEqual(a.frei, [
      { schluessel: 'rolf zuckowski', id: ZUCKOWSKI, name: 'Rolf Zuckowski', quelle: 'suche', seit: 'JETZT' },
    ])
    assert.equal(urteilFuer(a, 'ROLF ZUCKOWSKI'), 'frei')
  })

  it('freischalten raeumt eine Ablehnung desselben Namens WEG — nie beides gleichzeitig', () => {
    const nein = ablehnen(INTERPRETEN_ABLAGE_LEER, 'Rolf Zuckowski', 'GESTERN')
    const ja = freischalten(nein, { id: ZUCKOWSKI, name: 'Rolf Zuckowski' }, 'HEUTE')
    assert.equal(ja.abgelehnt.length, 0)
    assert.equal(urteilFuer(ja, 'Rolf Zuckowski'), 'frei')
  })

  it('ablehnen raeumt umgekehrt die Freischaltung weg', () => {
    const ja = freischalten(INTERPRETEN_ABLAGE_LEER, { id: ZUCKOWSKI, name: 'Rolf Zuckowski' }, 'GESTERN')
    const nein = ablehnen(ja, 'rolf zuckowski', 'HEUTE')
    assert.equal(nein.frei.length, 0)
    assert.equal(urteilFuer(nein, 'Rolf Zuckowski'), 'abgelehnt')
  })

  it('eine zweite Freischaltung desselben Namens ueberschreibt die alte Kennung', () => {
    const eins = freischalten(INTERPRETEN_ABLAGE_LEER, { id: ZUCKOWSKI, name: 'Rolf Zuckowski' })
    const zwei = freischalten(eins, { id: LUMPENPACK, name: 'Rolf Zuckowski' })
    assert.equal(zwei.frei.length, 1)
    assert.equal(zwei.frei[0].id, LUMPENPACK)
  })

  it('ohne brauchbare Kennung wird NICHT freigeschaltet', () => {
    assert.deepEqual(freischalten(INTERPRETEN_ABLAGE_LEER, { id: 'kurz', name: 'X' }), INTERPRETEN_ABLAGE_LEER)
  })

  it('zuruecknehmen fuehrt zurueck zur Automatik — keine Einbahnstrasse', () => {
    const nein = ablehnen(INTERPRETEN_ABLAGE_LEER, '🩵Jojo 🩵')
    assert.equal(urteilFuer(zuruecknehmen(nein, '🩵Jojo 🩵'), '🩵Jojo 🩵'), 'offen')
  })

  it('der Ablage-Schluessel ist `normal()` — „Die drei ???" und „Die Drei ???" sind EINER', () => {
    // HIER ist die Grosszuegigkeit richtig: es geht um Zugehoerigkeit, nicht um
    // Erkennung. Dieselbe Trennung wie im Kopf von `namensSchluessel`.
    const a = ablehnen(INTERPRETEN_ABLAGE_LEER, 'Die drei ???')
    assert.equal(urteilFuer(a, 'Die Drei ???'), 'abgelehnt')
  })
})

describe('interpretenReihe — wer steht in der Reihe', () => {
  const werke = [
    werk('spotify:0PyuOAMz1lv0z737JcQNOg', 'Das Lumpenpack', 'das lumpenpack'),
    werk('spotify:2QqQXuDKNR8HK1cFxf0NhW', '🩵Jojo 🩵'),
    werk('spotify:0fWSpghYzVJdPa8S9k5nmL', 'Kleine Prinzessin', 'kleine prinzessin'),
  ]
  const erkannt = new Map<string, Erkennung>([
    ['das lumpenpack', { ja: true, id: LUMPENPACK }],
    ['🩵 jojo 🩵', { ja: false, id: null }],
    ['kleine prinzessin', { ja: true, id: '5AZz2omkStyDNdnYyDpN7v' }],
  ])

  it('ohne Ablage entscheidet die Automatik — wie bisher', () => {
    const { reihe, versteckt } = interpretenReihe(werke, INTERPRETEN_ABLAGE_LEER, erkannt)
    assert.deepEqual(
      reihe.map((p) => p.name),
      ['Das Lumpenpack', 'Kleine Prinzessin'],
    )
    assert.deepEqual(
      versteckt.map((p) => [p.name, p.grund]),
      [['🩵Jojo 🩵', 'nichtErkannt']],
    )
  })

  it('legt ein Mehrnamen-Werk dem BESTEHENDEN Solo-Kreis dazu — und erfindet keinen neuen', () => {
    // Der Team-Karacho-Fall (12.09.2026): "Du schaffst das schon" gehoert
    // "Team Karacho, ANOTHER NGUYEN" und fiel aus dem Kreis "Team Karacho"
    // heraus — anzahl zaehlte es nicht, die Rundkachel konnte fuer das Album
    // nie den laufenden Rahmen zeigen.
    const kombi = werk('spotify:5PvQvJNQ9lEPYPWcs42nHb', 'Das Lumpenpack, ANOTHER NGUYEN')
    const { reihe } = interpretenReihe([...werke, kombi], INTERPRETEN_ABLAGE_LEER, erkannt)
    const lp = reihe.find((p) => p.name === 'Das Lumpenpack')
    assert.ok(lp)
    assert.equal(lp.anzahl, 2, 'das Kombi-Werk muss beim Solo-Kreis mitzaehlen')
    assert.ok(lp.werke.includes('spotify:5PvQvJNQ9lEPYPWcs42nHb'))
    // UND SONST NICHTS: "ANOTHER NGUYEN" hat keine Solo-Werke — ein eigener
    // Kreis fuer jeden Feature-Gast flutete die Reihe mit Fremden. Der
    // Kombi-Eintrag selbst bleibt, was er war (eigener Schluessel).
    assert.equal(
      reihe.concat().some((p) => p.name === 'ANOTHER NGUYEN'),
      false,
    )
  })

  it('ABGELEHNT SCHLAEGT ALLES — auch eine „ja"-Automatik', () => {
    const ablage = ablehnen(INTERPRETEN_ABLAGE_LEER, 'Das Lumpenpack')
    const { reihe, versteckt } = interpretenReihe(werke, ablage, erkannt)
    assert.equal(
      reihe.some((p) => p.name === 'Das Lumpenpack'),
      false,
    )
    assert.equal(versteckt.find((p) => p.name === 'Das Lumpenpack')?.grund, 'abgelehnt')
  })

  it('FREIGESCHALTET schlaegt eine „nein"-Automatik — der Fall „Jojo" andersherum', () => {
    const ablage = freischalten(INTERPRETEN_ABLAGE_LEER, { id: JOJO_SAENGERIN, name: '🩵Jojo 🩵', quelle: 'hand' })
    const { reihe } = interpretenReihe(werke, ablage, erkannt)
    const jojo = reihe.find((p) => p.name === '🩵Jojo 🩵')
    assert.ok(jojo, 'freigeschaltet und trotzdem nicht in der Reihe')
    assert.equal(jojo?.id, JOJO_SAENGERIN)
    assert.equal(jojo?.anzahl, 1)
    assert.equal(jojo?.herkunft, 'frei')
  })

  it('DER NEUE FALL: freigeschaltet OHNE eigene Werke steht trotzdem in der Reihe', () => {
    const ablage = freischalten(INTERPRETEN_ABLAGE_LEER, {
      id: ZUCKOWSKI,
      name: 'Rolf Zuckowski',
      bild: 'https://i.scdn.co/image/rolf',
      quelle: 'suche',
    })
    const { reihe } = interpretenReihe(werke, ablage, erkannt)
    const rolf = reihe.find((p) => p.name === 'Rolf Zuckowski')
    assert.ok(rolf, 'freigeschaltet ohne Werke und still aus der Reihe gefallen')
    assert.equal(rolf?.anzahl, 0)
    assert.deepEqual(rolf?.werke, [])
    assert.equal(rolf?.id, ZUCKOWSKI)
    // UEBER DIE BOX, nie die CDN-Adresse — sonst faellt der Coverspeicher weg.
    assert.equal(rolf?.bild, `/api/bild/extern?u=${encodeURIComponent('https://i.scdn.co/image/rolf')}`)
  })

  /**
   * DIE FALLE DER VERWALTUNGSSEITE, in zwei Faellen nebeneinander.
   *
   * Der haeufigste Fall der echten Box ist ein Interpret der EIGENEN
   * Bibliothek, den Spotify unter DIESEM Namen nicht kennt (sieben von
   * sechzehn, gemessen 03.08.2026). Die Seite „Interpreten" bietet dafuer „bei
   * Spotify suchen" an — und schickt beim Freischalten den BIBLIOTHEKSNAMEN
   * mit der FREMDEN Kennung. Warum das so herum sein muss, steht sonst nur in
   * einem Kommentar dort; hier steht der Unterschied als Messwert:
   *
   *   unter dem BIBLIOTHEKSNAMEN  -> eine Kachel, die ihre Werke behaelt
   *   unter dem SPOTIFY-NAMEN     -> ZWEI Kacheln, eine davon mit „0 Werke",
   *                                  und die eigentliche bleibt ausgeblendet
   *
   * Der Schluessel der Ablage ist `normal(name)` und der Schluessel des Regals
   * `normal(werk.interpret)` — derselbe `normal()`. Ein anderer Name ist damit
   * ein anderes Regal, ohne dass es irgendwo einen Fehler gaebe.
   */
  it('freigeschaltet unter dem BIBLIOTHEKSNAMEN: eine Kachel, die ihre Werke behaelt', () => {
    const ablage = freischalten(INTERPRETEN_ABLAGE_LEER, {
      id: JOJO_SAENGERIN,
      name: '🩵Jojo 🩵',
      quelle: 'suche',
    })
    const { reihe, versteckt } = interpretenReihe(werke, ablage, erkannt)
    const jojo = reihe.filter((p) => p.schluessel === '🩵 jojo 🩵')
    assert.equal(jojo.length, 1)
    assert.equal(jojo[0]?.anzahl, 1)
    assert.equal(versteckt.length, 0)
  })

  it('… und unter dem SPOTIFY-NAMEN waeren es ZWEI Kacheln — die Falle der Verwaltung', () => {
    // Spotifys Saengerin heisst „JoJo", die Bibliothek fuehrt „🩵Jojo 🩵".
    // normal("JoJo") ist „jojo" — hier zufaellig DERSELBE Schluessel, deshalb
    // taugt dieses Paar nicht als Gegenprobe. Genommen wird das Paar, das die
    // echte Box zeigt: „EUROPA Hörspiele & Kinderlieder" gegen „Europa".
    const eigene = [
      ...werke,
      werk('spotify:3Bo0uFrIvUeMTBFXKGYNHY', 'EUROPA Hörspiele & Kinderlieder', 'europahorspielekinderlieder'),
    ]
    const ablage = freischalten(INTERPRETEN_ABLAGE_LEER, { id: ZUCKOWSKI, name: 'Europa', quelle: 'suche' })
    const { reihe, versteckt } = interpretenReihe(
      eigene,
      ablage,
      new Map([['europahorspielekinderlieder', { ja: false, id: null }]]),
    )
    assert.deepEqual(
      reihe.filter((p) => p.name.toLowerCase().includes('europa')).map((p) => [p.name, p.anzahl]),
      [['Europa', 0]],
    )
    // Die Kachel mit den eigenen Werken steht weiter im Abseits — genau das
    // verhindert die Seite „Interpreten", indem sie den Bibliotheksnamen sendet.
    assert.deepEqual(
      versteckt.map((p) => [p.name, p.anzahl]),
      [['EUROPA Hörspiele & Kinderlieder', 1]],
    )
  })

  it('… und er steht HINTEN, damit die gewohnten Gesichter nicht wandern', () => {
    const ablage = freischalten(INTERPRETEN_ABLAGE_LEER, { id: ZUCKOWSKI, name: 'Rolf Zuckowski' })
    const { reihe } = interpretenReihe(werke, ablage, erkannt)
    assert.equal(reihe.at(-1)?.name, 'Rolf Zuckowski')
  })

  it('eine fremde Bildherkunft wird zu „kein Bild", nicht durchgereicht', () => {
    const ablage = interpretenAblageAus({
      frei: [{ name: 'Rolf Zuckowski', id: ZUCKOWSKI, quelle: 'hand', bild: 'https://angreifer.de/bild.png' }],
    })
    assert.equal(interpretenReihe(werke, ablage, erkannt).reihe.at(-1)?.bild, null)
  })

  it('ohne Erkennung wird GEZEIGT — ein ausgefallener Abruf leert die Reihe nicht', () => {
    const { reihe, versteckt } = interpretenReihe(werke, INTERPRETEN_ABLAGE_LEER, new Map())
    assert.equal(reihe.length, 3)
    assert.equal(versteckt.length, 0)
  })

  it('Werke ohne interpretSchluessel fallen heraus — „External Playback" braucht keine zweite Regel', () => {
    // Genau der Eintrag der echten Box: weder id noch playlistid, Interpret
    // „Unknown". `werkAus` gibt ihm deshalb keinen interpretSchluessel.
    const echt = werkeAus([{ type: 'spotify', artist: 'Unknown', title: 'External Playback' }])
    assert.equal(echt[0].interpretSchluessel, undefined)
    assert.deepEqual(interpretenReihe(echt, INTERPRETEN_ABLAGE_LEER, new Map()).reihe, [])
  })

  it('das Bild einer Freischaltung geht dem Albumcover vor — es zeigt den Menschen', () => {
    const ablage = freischalten(INTERPRETEN_ABLAGE_LEER, {
      id: LUMPENPACK,
      name: 'Das Lumpenpack',
      bild: 'https://i.scdn.co/image/lumpen',
    })
    const p = interpretenReihe(werke, ablage, erkannt).reihe.find((x) => x.name === 'Das Lumpenpack')
    assert.equal(p?.bild, `/api/bild/extern?u=${encodeURIComponent('https://i.scdn.co/image/lumpen')}`)
  })
})

describe('zuPruefen — wen der Server ueberhaupt nachschlagen muss', () => {
  const werke = [
    werk('spotify:a', 'Das Lumpenpack', 'das lumpenpack'),
    werk('spotify:b', 'Das Lumpenpack', 'das lumpenpack'),
    werk('spotify:c', '🩵Jojo 🩵'),
  ]

  it('jeden Namen nur EINMAL, auch bei mehreren Werken', () => {
    assert.deepEqual(zuPruefen(werke, INTERPRETEN_ABLAGE_LEER), [
      { schluessel: 'das lumpenpack', name: 'Das Lumpenpack' },
      { schluessel: '🩵 jojo 🩵', name: '🩵Jojo 🩵' },
    ])
  })

  it('was entschieden ist, wird nicht mehr gefragt — jede Entscheidung spart einen Abruf', () => {
    const ablage = ablehnen(
      freischalten(INTERPRETEN_ABLAGE_LEER, { id: LUMPENPACK, name: 'Das Lumpenpack' }),
      '🩵Jojo 🩵',
    )
    assert.deepEqual(zuPruefen(werke, ablage), [])
  })
})

describe('suchtrefferAus — was die Verwaltung zu sehen bekommt', () => {
  it('Bild ueber die Box, rohe Adresse daneben fuer die Ablage', () => {
    const [t] = suchtrefferAus([treffer('Rolf Zuckowski', ZUCKOWSKI, ['gross', 'https://i.scdn.co/image/rolf'])])
    assert.equal(t.id, ZUCKOWSKI)
    assert.equal(t.bildRoh, 'https://i.scdn.co/image/rolf')
    assert.equal(t.bild, `/api/bild/extern?u=${encodeURIComponent('https://i.scdn.co/image/rolf')}`)
    assert.equal(t.follower, 4711)
  })

  it('ohne brauchbare Kennung keine Zeile — sie liesse sich nicht freischalten', () => {
    assert.deepEqual(suchtrefferAus([treffer('Ohne', ''), treffer('Kurz', 'abc')]), [])
  })

  it('doppelte Kennungen nur einmal', () => {
    assert.equal(suchtrefferAus([treffer('A', ZUCKOWSKI), treffer('A', ZUCKOWSKI)]).length, 1)
  })

  it('vertraegt null und leere Antwort', () => {
    assert.deepEqual(suchtrefferAus(null), [])
    assert.deepEqual(suchtrefferAus([]), [])
  })
})

/*
 * ══ „DIE DREI ???" GEGEN „DIE DREI !!!" ═══════════════════════════════════
 *
 * Zwei echte Kosmos-Kinderserien; die Box fuehrt „Die drei ???" bereits. Unter
 * `normal()` ergaben beide den Schluessel „die drei" — gefunden im
 * E45-Bestandsreview am 19.08.2026, jede der fuenf Ketten am Code nachgezogen.
 * Hier steht jede einzeln, weil sie einzeln kaputtgehen kann.
 *
 * DER TEUERSTE FALL IST DER ZWEITE: die Freischaltung der einen Serie loeschte
 * die der anderen STILL — kein Fehler, keine Meldung, und die Rundkachel fuehrt
 * danach auf die falsche Spotify-Seite.
 */
const DREI_FRAGEZEICHEN = '3meJIgRw7YleJrmbpbJK6S'
const DREI_AUSRUFEZEICHEN = '4A3jGvVpG5Zvz2y0cVUyDG'

describe('Zwei Serien, ein Schluessel — der Fund des E45-Bestandsreviews', () => {
  const werke = [
    werk('spotify:f1', 'Die drei ???', 'die drei ???'),
    werk('spotify:f2', 'Die drei ???', 'die drei ???'),
    werk('spotify:a1', 'Die drei !!!', 'die drei !!!'),
  ]

  it('1. ZWEI Rundkacheln und ZWEI Regale, nicht eines', () => {
    const { reihe } = interpretenReihe(werke, INTERPRETEN_ABLAGE_LEER, new Map())
    assert.deepEqual(
      reihe.map((p) => [p.name, p.anzahl]),
      [
        ['Die drei ???', 2],
        ['Die drei !!!', 1],
      ],
    )
  })

  it('2. wer die eine freischaltet, loescht die andere NICHT', () => {
    const eins = freischalten(INTERPRETEN_ABLAGE_LEER, { id: DREI_FRAGEZEICHEN, name: 'Die drei ???' })
    const beide = freischalten(eins, { id: DREI_AUSRUFEZEICHEN, name: 'Die drei !!!' })
    assert.equal(beide.frei.length, 2)
    // UND JEDE KACHEL FUEHRT AUF IHRE EIGENE SEITE. Das war der eigentliche
    // Schaden: die ueberlebende Kachel trug die Kennung der ANDEREN Serie.
    const reihe = interpretenReihe(werke, beide, new Map()).reihe
    assert.equal(reihe.find((p) => p.name === 'Die drei ???')?.id, DREI_FRAGEZEICHEN)
    assert.equal(reihe.find((p) => p.name === 'Die drei !!!')?.id, DREI_AUSRUFEZEICHEN)
  })

  it('2b. dieselbe Serie zweimal freigeschaltet ueberschreibt sich weiterhin', () => {
    // Die Entdopplung je Schluessel bleibt richtig — sie darf nur nicht mehr
    // zwei VERSCHIEDENE Namen treffen.
    const a = freischalten(INTERPRETEN_ABLAGE_LEER, { id: DREI_AUSRUFEZEICHEN, name: 'Die drei ???' })
    const b = freischalten(a, { id: DREI_FRAGEZEICHEN, name: 'Die Drei???' })
    assert.equal(b.frei.length, 1)
    assert.equal(b.frei[0].id, DREI_FRAGEZEICHEN)
  })

  it('3. eine Ablehnung versteckt nur IHRE Serie', () => {
    const ablage = ablehnen(INTERPRETEN_ABLAGE_LEER, 'Die drei !!!')
    const { reihe, versteckt } = interpretenReihe(werke, ablage, new Map())
    assert.deepEqual(
      reihe.map((p) => p.name),
      ['Die drei ???'],
    )
    assert.deepEqual(
      versteckt.map((p) => [p.name, p.grund]),
      [['Die drei !!!', 'abgelehnt']],
    )
    assert.equal(urteilFuer(ablage, 'Die drei ???'), 'offen')
    assert.equal(urteilFuer(ablage, 'Die drei !!!'), 'abgelehnt')
  })

  it('5. BEIDE Namen werden bei Spotify nachgeschlagen, nicht nur einer', () => {
    assert.deepEqual(zuPruefen(werke, INTERPRETEN_ABLAGE_LEER), [
      { schluessel: 'die drei ???', name: 'Die drei ???' },
      { schluessel: 'die drei !!!', name: 'Die drei !!!' },
    ])
  })

  it('der Schluessel des Werks und der der Ablage sind DERSELBE', () => {
    // Liefen sie auseinander, stuende neben der vollen Kachel eine zweite mit
    // „0 Werke" — der Fall, den llmwiki [interpreten-verwaltungsseite]
    // beschreibt.
    const echt = werkeAus([
      {
        type: 'spotify',
        category: 'audiobook',
        id: 'aaaaaaaaaaaaaaaaaaaaaa',
        title: 'Folge 1',
        artist: 'Die drei ???',
      },
    ])
    const ablage = freischalten(INTERPRETEN_ABLAGE_LEER, { id: DREI_FRAGEZEICHEN, name: 'Die drei ???' })
    assert.equal(echt[0].interpretSchluessel, ablage.frei[0].schluessel)
    assert.equal(interpretenReihe(echt, ablage, new Map()).reihe.length, 1)
  })
})

describe('interpretenAblageWandern — was Bestandsdaten kostet', () => {
  it('nennt die Zeile, deren Schluessel in der Datei veraltet ist', () => {
    const { ablage, wandert } = interpretenAblageWandern({
      frei: [{ schluessel: 'die drei', id: DREI_FRAGEZEICHEN, name: 'Die drei ???', quelle: 'suche' }],
      abgelehnt: [{ schluessel: 'jojo', name: '🩵Jojo 🩵' }],
    })
    assert.deepEqual(wandert, [
      { name: 'Die drei ???', alt: 'die drei', neu: 'die drei ???', liste: 'frei' },
      { name: '🩵Jojo 🩵', alt: 'jojo', neu: '🩵 jojo 🩵', liste: 'abgelehnt' },
    ])
    // UND DIE ABLAGE IST SCHON GEWANDERT — der Schluessel wird beim Lesen neu
    // gebildet, nicht der Datei geglaubt. Deshalb gibt es hier nichts
    // umzuschreiben, nur nachzutragen.
    assert.equal(ablage.frei[0].schluessel, 'die drei ???')
    assert.equal(ablage.abgelehnt[0].schluessel, '🩵 jojo 🩵')
  })

  it('schweigt, wenn nichts wandert — dann schreibt der Server auch nicht', () => {
    const { wandert } = interpretenAblageWandern({
      frei: [{ schluessel: 'das lumpenpack', id: LUMPENPACK, name: 'Das Lumpenpack', quelle: 'hand' }],
      abgelehnt: [{ schluessel: 'europa horspiele kinderlieder', name: 'EUROPA Hörspiele & Kinderlieder' }],
    })
    assert.deepEqual(wandert, [])
  })

  it('holt die Zeile zurueck, die der alte Schluessel STILL verschluckt hat', () => {
    // So sah eine Ablage aus, in der jemand beide Serien freigeschaltet hatte:
    // `gesehenFrei` verwarf die zweite, ohne dass irgendwo etwas dastand.
    const roh = {
      frei: [
        { schluessel: 'die drei', id: DREI_AUSRUFEZEICHEN, name: 'Die drei !!!', quelle: 'suche' },
        { schluessel: 'die drei', id: DREI_FRAGEZEICHEN, name: 'Die drei ???', quelle: 'suche' },
      ],
      abgelehnt: [],
    }
    const { ablage } = interpretenAblageWandern(roh)
    assert.equal(ablage.frei.length, 2)
    assert.deepEqual(ablage.frei.map((f) => f.id).sort(), [DREI_FRAGEZEICHEN, DREI_AUSRUFEZEICHEN].sort())
  })

  it('vertraegt eine von Hand geschriebene Datei ohne jeden Schluessel', () => {
    const { ablage, wandert } = interpretenAblageWandern({ abgelehnt: ['Jojo'] })
    assert.deepEqual(wandert, [{ name: 'Jojo', alt: '', neu: 'jojo', liste: 'abgelehnt' }])
    assert.equal(ablage.abgelehnt[0].schluessel, 'jojo')
  })

  it('vertraegt Unfug, ohne zu werfen', () => {
    assert.deepEqual(interpretenAblageWandern(null).wandert, [])
    assert.deepEqual(interpretenAblageWandern({ frei: 'nein' }).wandert, [])
  })
})
