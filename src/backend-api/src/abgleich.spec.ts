/**
 * Tests des Abgleichs — WELCHE Werke sind dasselbe?
 *
 * DIE ECHTEN FAELLE DER BOX STEHEN HIER DRIN, nicht erfundene. Gemessen am
 * 2026-08-03 mit tools/quellen-ueberschneidung.mjs (nur lesend, ssh):
 *
 *   26 Eintraege — 24 spotify, 2 jellyfin
 *   Ueberschneidung:  jellyfin + spotify  „Kapelle Petra — HAMM"
 *                     jellyfin + spotify  „Das Lumpenpack — Die Zukunft wird groß"
 *   mehrdeutig:       spotify:2QqQXuDKNR8HK1cFxf0NhW steht ZWEIMAL
 *                     (Zeile 9 category=music, Zeile 10 category=audiobook)
 *
 * DER SCHWERPUNKT LIEGT WIEDER AUF DEM NICHT-VERSCHMELZEN, aus demselben
 * Grund wie in verschmelzung.spec.ts: zwei Kacheln zu viel sind ein
 * Schoenheitsfehler, eine Kachel, die das Falsche verspricht, ist auf einer
 * Kinderbox ein Vertrauensverlust.
 *
 * UND AUF DER SICHTBARKEIT. Der teuerste denkbare Ausgang dieses Auftrags
 * waere eine eingeschaltete Verschmelzung, die bei einem mehrdeutigen
 * Schluessel STILL nichts tut. Dass sie es sagt, wird deshalb ebenso geprueft
 * wie das, was sie tut.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ABLAGE_LEER,
  type Ablage,
  ablageAus,
  handVerbinden,
  neueVorschlaege,
  paarSchluessel,
  trennen,
  uebernehmen,
  verbinden,
  zuordnungenVorschlagen,
} from './abgleich'
import { auswahlUmZuordnungenErweitern } from './abgleich'
import { REGELN_LOCKER, REGELN_NORMAL, REGELN_STRENG } from './medien'
import { verschmelzeWerke } from './verschmelzung'
import type { Quelle, Werk } from './werke'

function werk(schluessel: string, dienst: Quelle['dienst'], rest: Partial<Werk> = {}): Werk {
  return {
    schluessel,
    art: 'album',
    titel: 'Die Zukunft wird groß',
    interpret: 'Das Lumpenpack',
    bild: `/api/bild/${encodeURIComponent(schluessel)}`,
    kategorie: 'music',
    quellen: [{ dienst, kennung: schluessel.split(':').slice(1).join(':') }],
    ...rest,
  }
}

// Die beiden echten Paare der Box.
const LUMPEN_SPOTIFY = werk('spotify:0PyuOAMz1lv0z737JcQNOg', 'spotify')
const LUMPEN_JELLYFIN = werk('jellyfin:e131865d504a657a93533722fc88bc90', 'jellyfin')
const HAMM_JELLYFIN = werk('jellyfin:7d9a37e2732ca78bc68eacb3232960c0', 'jellyfin', {
  titel: 'HAMM',
  interpret: 'Kapelle Petra',
})
const HAMM_SPOTIFY = werk('spotify:0l0nQidfDmC4SiTdrpHr4v', 'spotify', {
  titel: 'HAMM',
  interpret: 'Kapelle Petra',
})

describe('auswahlUmZuordnungenErweitern — die Auswahl kennt ihre Partner (30.08.2026)', () => {
  // AM GERAET GEMESSEN („Guten Morgen / Good Morning"): das Papa-Profil hat
  // den Spotify-Eintrag in seiner Medienauswahl, der Mitschnitt traegt den
  // lokal-Schluessel — und gefiltert wird VOR der Verschmelzung. Die
  // Mitschnitt-Kachel fiel aus der Liste, die Hand-Zuordnung fand ihr
  // Mitglied nicht, nichts verschmolz, und der Tipp spielte am falschen Ort.
  const zuordnungen = [
    { schluessel: 'spotify:6wMx', auch: ['lokal:t:team karacho rola|guten morgen good morning englisch'], stufe: 'hand' as const },
    { schluessel: 'spotify:fremd', auch: ['lokal:t:andere|platte'], stufe: 'hand' as const },
  ]

  it('zieht die Partner einer gewaehlten Zuordnung in die Auswahl', () => {
    const aus = auswahlUmZuordnungenErweitern({ werke: ['spotify:6wMx'] }, zuordnungen)
    assert.deepEqual(new Set(aus?.werke), new Set(['spotify:6wMx', 'lokal:t:team karacho rola|guten morgen good morning englisch']))
  })

  it('auch andersherum: das gewaehlte Mitglied zieht den Fuehrenden', () => {
    const aus = auswahlUmZuordnungenErweitern(
      { werke: ['lokal:t:team karacho rola|guten morgen good morning englisch'] },
      zuordnungen,
    )
    assert.ok(aus?.werke.includes('spotify:6wMx'))
  })

  it('fremde Zuordnungen bleiben draussen', () => {
    const aus = auswahlUmZuordnungenErweitern({ werke: ['spotify:6wMx'] }, zuordnungen)
    assert.ok(!aus?.werke.includes('spotify:fremd'))
    assert.ok(!aus?.werke.includes('lokal:t:andere|platte'))
  })

  it('ohne Auswahl (alles sichtbar) und ohne Treffer bleibt ALLES unangetastet — dasselbe Objekt', () => {
    assert.equal(auswahlUmZuordnungenErweitern(null, zuordnungen), null)
    const unberuehrt = { werke: ['spotify:ganz-anderes'] }
    assert.equal(auswahlUmZuordnungenErweitern(unberuehrt, zuordnungen), unberuehrt)
  })
})

describe('zuordnungenVorschlagen — die Erkennung (Stufe „locker")', () => {
  it('findet die zwei Paare, die auf der Box wirklich stehen', () => {
    const e = zuordnungenVorschlagen([HAMM_JELLYFIN, LUMPEN_SPOTIFY, LUMPEN_JELLYFIN, HAMM_SPOTIFY])
    assert.equal(e.vorschlaege.length, 2)
    assert.deepEqual(
      e.vorschlaege.map((v) => [v.schluessel, ...v.auch].sort()),
      [
        [HAMM_JELLYFIN.schluessel, HAMM_SPOTIFY.schluessel].sort(),
        [LUMPEN_JELLYFIN.schluessel, LUMPEN_SPOTIFY.schluessel].sort(),
      ],
    )
  })

  it('schreibt die Stufe mit — sie ist keine Verzierung', () => {
    // Die Verwaltung soll „verbunden per Namensvergleich" sagen koennen statt
    // eines Orakels (Wissenspaket [quellen-verschmelzen] Punkt 7). Und
    // `verschmelzeWerke` weist eine Zuordnung ohne gueltige Stufe ab.
    const e = zuordnungenVorschlagen([LUMPEN_SPOTIFY, LUMPEN_JELLYFIN])
    assert.equal(e.vorschlaege[0].stufe, 'locker')
  })

  it('laesst den ERSTEN der Gruppe fuehren — daran haengt der Verlauf', () => {
    // Die Bibliothek waechst hinten. Der erste Treffer ist der aeltere
    // Eintrag, an dem am ehesten schon gespielt.json und resume.json haengen.
    const vorn = zuordnungenVorschlagen([LUMPEN_JELLYFIN, LUMPEN_SPOTIFY]).vorschlaege[0]
    assert.equal(vorn.schluessel, LUMPEN_JELLYFIN.schluessel)
    const hinten = zuordnungenVorschlagen([LUMPEN_SPOTIFY, LUMPEN_JELLYFIN]).vorschlaege[0]
    assert.equal(hinten.schluessel, LUMPEN_SPOTIFY.schluessel)
  })

  it('wirft zwei Werke DESSELBEN Dienstes nicht zusammen', () => {
    // Standard und Deluxe bei Spotify. Dieselbe Zurueckhaltung uebt
    // `gruppiereTreffer` — hier wird nur belegt, dass sie durchschlaegt.
    const zweit = werk('spotify:4aawyAB9vmqN3uQ7FjRGTy', 'spotify')
    assert.equal(zuordnungenVorschlagen([LUMPEN_SPOTIFY, zweit]).vorschlaege.length, 0)
  })

  it('wirft verschiedene `art` nicht zusammen', () => {
    // Ein Album mit einer Playlist zu verschmelzen ergaebe fuer die zweite
    // Quelle einen Abspielbefehl, den der Dienst nicht einloest.
    const alsListe = werk('spotify:0PyuOAMz1lv0z737JcQNOg', 'spotify', { art: 'playlist' })
    assert.equal(zuordnungenVorschlagen([LUMPEN_JELLYFIN, alsListe]).vorschlaege.length, 0)
  })

  it('trennt bei verschiedener Titelanzahl, wenn sie bekannt ist', () => {
    // Der Deluxe-Schutz des Wissenspakets. Heute fuellt niemand diese Karte;
    // ab Stufe 2 tut es der Fingerabdruck. Der Weg dorthin wird hier gehalten.
    const e = zuordnungenVorschlagen([LUMPEN_SPOTIFY, LUMPEN_JELLYFIN], {
      titelAnzahl: { [LUMPEN_SPOTIFY.schluessel]: 14, [LUMPEN_JELLYFIN.schluessel]: 12 },
    })
    assert.equal(e.vorschlaege.length, 0)
  })

  it('verschmilzt bei GLEICHER bekannter Titelanzahl weiterhin', () => {
    const e = zuordnungenVorschlagen([LUMPEN_SPOTIFY, LUMPEN_JELLYFIN], {
      titelAnzahl: { [LUMPEN_SPOTIFY.schluessel]: 12, [LUMPEN_JELLYFIN.schluessel]: 12 },
    })
    assert.equal(e.vorschlaege.length, 1)
  })
})

describe('zuordnungenVorschlagen — was NUR beim Verschmelzen trennt', () => {
  // GEGENGELESEN AM 2026-08-03 mit tools/verschmelzung-grenzfaelle.mjs. Beide
  // Faelle waren vorher echte Ueberverschmelzungen: die Kachel entstand, und
  // ein Kind verlor etwas, ohne dass irgendwo etwas geloescht wurde.
  //
  // Sie stehen HIER und nicht in `gruppiereTreffer`: die ist fuer die SUCHE
  // gebaut, und dort sind beide Regeln falsch.

  it('legt Musik und Hoerbuch NICHT zusammen — die Kachel verliesse einen Abschnitt', () => {
    // Die neue Oberflaeche siebt nach `kategorie`
    // (app.js: `liste.filter(w => w.kategorie === werke.kategorie)`), und
    // `verschmelzeWerke` gibt der Kachel die des FUEHRENDEN Werks. Ein
    // Hoerbuch, das unter „Musik" gefuehrt wird, ist fuer ein Kind weg.
    const musik = werk('spotify:1AAAAAAAAAAAAAAAAAAAAA', 'spotify', {
      titel: 'Der kleine Drache Kokosnuss',
      interpret: 'Ingo Siegner',
      kategorie: 'music',
    })
    const hoerbuch = werk('jellyfin:1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'jellyfin', {
      titel: 'Der kleine Drache Kokosnuss',
      interpret: 'Ingo Siegner',
      kategorie: 'audiobook',
    })
    const e = zuordnungenVorschlagen([musik, hoerbuch])
    assert.equal(e.vorschlaege.length, 0)
    // UND ES FAELLT NICHT STILL HERAUS. Genau das ist die schlimmste Sorte
    // Fehler: eingebaut, gruen, wirkungslos.
    assert.equal(e.uebergangen.length, 1)
    assert.equal(e.uebergangen[0].grund, 'kategorie')
    assert.deepEqual(e.uebergangen[0].schluessel.sort(), [musik.schluessel, hoerbuch.schluessel].sort())
  })

  it('legt ohne Interpret NICHT zusammen — sonst entschiede der Titel allein', () => {
    // `interpretenPassen` gibt bei leerem Feld `true` zurueck. Beim
    // Verschmelzen bliebe dann nur der Titel, und das verbietet das
    // Wissenspaket [quellen-verschmelzen] ausdruecklich. Gerade den schlampig
    // getaggten Dateien fehlt der Interpret — und gerade sie heissen
    // „Weihnachtslieder" oder „Folge 1".
    const mit = werk('spotify:2AAAAAAAAAAAAAAAAAAAAA', 'spotify', {
      titel: 'Weihnachtslieder',
      interpret: 'Rolf Zuckowski',
    })
    const ohne = werk('jellyfin:2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'jellyfin', {
      titel: 'Weihnachtslieder',
      interpret: undefined,
    })
    const e = zuordnungenVorschlagen([mit, ohne])
    assert.equal(e.vorschlaege.length, 0)
    assert.equal(e.uebergangen.length, 1)
    assert.equal(e.uebergangen[0].grund, 'interpretFehlt')
  })

  it('laesst die zwei echten Paare der Box unberuehrt', () => {
    // DER PREIS DER BEIDEN REGELN, gemessen: er ist null. Beide Paare stehen
    // in `music` und tragen einen Interpreten (data.json der Box, 2026-08-03).
    const e = zuordnungenVorschlagen([HAMM_JELLYFIN, LUMPEN_SPOTIFY, LUMPEN_JELLYFIN, HAMM_SPOTIFY])
    assert.equal(e.vorschlaege.length, 2)
    assert.equal(e.uebergangen.length, 0)
  })
})

describe('zuordnungenVorschlagen — mehrdeutige Schluessel', () => {
  // Der gemessene Fall: dieselbe Playlist einmal als Musik, einmal als
  // Hoerbuch. `medienSchluessel()` nimmt `category` nicht auf, also ist der
  // Schluessel beider identisch.
  const JOJO_MUSIK = werk('spotify:2QqQXuDKNR8HK1cFxf0NhW', 'spotify', {
    art: 'playlist',
    titel: 'Das Pummeleinhorn',
    interpret: 'Jojo',
    kategorie: 'music',
  })
  const JOJO_HOERBUCH = { ...JOJO_MUSIK, kategorie: 'audiobook' as const }

  it('meldet den doppelten Schluessel, statt ihn zu verschweigen', () => {
    const e = zuordnungenVorschlagen([JOJO_MUSIK, JOJO_HOERBUCH, LUMPEN_SPOTIFY])
    assert.equal(e.mehrdeutig.length, 1)
    assert.equal(e.mehrdeutig[0].schluessel, JOJO_MUSIK.schluessel)
    assert.equal(e.mehrdeutig[0].anzahl, 2)
    // Die Kategorien reisen mit: nur an ihnen ist zu sehen, WORUEBER die
    // beiden kollidieren — sonst stuenden zwei identische Zeilen da.
    assert.deepEqual(e.mehrdeutig[0].kategorien, ['music', 'audiobook'])
  })

  it('schlaegt eine Gruppe mit doppeltem Schluessel gar nicht erst vor', () => {
    // `verschmelzeWerke` wuerde sie ohnehin abweisen (Fall 3 dort). Sie
    // anzubieten hiesse, einen Knopf anzubieten, der nichts tut — und das ist
    // genau die Sorte Fehler, gegen die dieser ganze Schritt gebaut ist:
    // eingebaut, gruen, wirkungslos.
    const jellyfinGleich = werk('jellyfin:aaaa', 'jellyfin', {
      art: 'playlist',
      titel: 'Das Pummeleinhorn',
      interpret: 'Jojo',
    })
    const e = zuordnungenVorschlagen([JOJO_MUSIK, JOJO_HOERBUCH, jellyfinGleich])
    assert.equal(e.vorschlaege.length, 0)
    assert.equal(e.uebergangen.length, 1)
    assert.equal(e.uebergangen[0].grund, 'mehrdeutig')
    assert.ok(e.uebergangen[0].schluessel.includes(JOJO_MUSIK.schluessel))
  })

  it('laesst die uebrigen Paare davon unberuehrt', () => {
    // Der gemessene Fall auf der Box: der doppelte Schluessel gehoert zu
    // KEINEM der beiden Ueberschneidungspaare. Ein Ausfall dort darf die zwei
    // richtigen Zusammenlegungen nicht mitnehmen.
    const e = zuordnungenVorschlagen([JOJO_MUSIK, JOJO_HOERBUCH, LUMPEN_SPOTIFY, LUMPEN_JELLYFIN])
    assert.equal(e.mehrdeutig.length, 1)
    assert.equal(e.vorschlaege.length, 1)
  })
})

describe('zuordnungenVorschlagen — Handentscheidungen halten', () => {
  it('schlaegt ein getrenntes Paar nicht wieder vor', () => {
    // OHNE DAS WAERE „trennen" EINE BERUHIGUNG: der naechste Abgleich fuende
    // dasselbe Paar wieder und legte es erneut zusammen.
    const e = zuordnungenVorschlagen([LUMPEN_SPOTIFY, LUMPEN_JELLYFIN], {
      getrennt: [[LUMPEN_SPOTIFY.schluessel, LUMPEN_JELLYFIN.schluessel]],
    })
    assert.equal(e.vorschlaege.length, 0)
    assert.equal(e.uebergangen[0].grund, 'getrennt')
  })

  it('achtet nicht auf die Reihenfolge im Paar', () => {
    const e = zuordnungenVorschlagen([LUMPEN_SPOTIFY, LUMPEN_JELLYFIN], {
      getrennt: [[LUMPEN_JELLYFIN.schluessel, LUMPEN_SPOTIFY.schluessel]],
    })
    assert.equal(e.vorschlaege.length, 0)
  })

  it('nimmt bei drei Quellen nur das getrennte Mitglied heraus', () => {
    const lokal = werk('lokal:t:das lumpenpack|die zukunft wird gross', 'lokal')
    const e = zuordnungenVorschlagen([LUMPEN_JELLYFIN, LUMPEN_SPOTIFY, lokal], {
      getrennt: [[LUMPEN_JELLYFIN.schluessel, LUMPEN_SPOTIFY.schluessel]],
    })
    assert.equal(e.vorschlaege.length, 1)
    assert.deepEqual(e.vorschlaege[0].auch, [lokal.schluessel])
  })
})

describe('paarSchluessel', () => {
  it('ist von der Reihenfolge unabhaengig', () => {
    assert.equal(paarSchluessel('a', 'b'), paarSchluessel('b', 'a'))
  })

  it('kann zwei Paare nicht verwechseln, auch wenn Adressen darin stehen', () => {
    // Ein Radioschluessel IST eine Adresse. Mit einem druckbaren Trenner
    // liessen sich verschiedene Paare auf dieselbe Zeichenkette abbilden.
    assert.notEqual(paarSchluessel('radio:http://a/b', 'c'), paarSchluessel('radio:http://a', 'b/c'))
  })
})

describe('ablageAus — die Datei darf von Hand krumm sein', () => {
  it('macht aus nichts eine leere Ablage, statt zu werfen', () => {
    assert.deepEqual(ablageAus(undefined), ABLAGE_LEER)
    assert.deepEqual(ablageAus('kaputt'), ABLAGE_LEER)
    assert.deepEqual(ablageAus({ zuordnungen: 'nein' }), ABLAGE_LEER)
  })

  it('wirft eine Zuordnung ohne gueltige Stufe HERAUS statt sie auf „hand" zu biegen', () => {
    const a = ablageAus({
      zuordnungen: [
        { schluessel: 'a', auch: ['b'], stufe: 'orakel' },
        { schluessel: 'c', auch: ['d'], stufe: 'hand' },
      ],
    })
    assert.deepEqual(
      a.zuordnungen.map((z) => z.schluessel),
      ['c'],
    )
  })

  it('laesst eine Zuordnung ohne Partner fallen', () => {
    // `auch: []` ist keine Behauptung mehr, nur noch Ballast in der Datei.
    assert.equal(ablageAus({ zuordnungen: [{ schluessel: 'a', auch: [], stufe: 'locker' }] }).zuordnungen.length, 0)
    // Und der fuehrende Schluessel zaehlt nicht als sein eigener Partner.
    assert.equal(ablageAus({ zuordnungen: [{ schluessel: 'a', auch: ['a'], stufe: 'locker' }] }).zuordnungen.length, 0)
  })

  it('legt Trennungen immer gleich sortiert ab und entdoppelt sie', () => {
    const a = ablageAus({
      getrennt: [['b', 'a'], ['a', 'b'], ['a'], ['a', 'a']],
    })
    assert.deepEqual(a.getrennt, [['a', 'b']])
  })
})

describe('uebernehmen — was von Hand kam, bleibt', () => {
  const handisch: Ablage = { zuordnungen: [{ schluessel: 'x', auch: ['y'], stufe: 'hand' }], getrennt: [] }

  it('ersetzt die maschinellen Zuordnungen, behaelt die handischen', () => {
    const alt: Ablage = {
      zuordnungen: [...handisch.zuordnungen, { schluessel: 'p', auch: ['q'], stufe: 'locker' }],
      getrennt: [],
    }
    const neu = uebernehmen(alt, [{ schluessel: 'r', auch: ['s'], stufe: 'locker' }])
    assert.deepEqual(
      neu.zuordnungen.map((z) => `${z.stufe}:${z.schluessel}`),
      ['hand:x', 'locker:r'],
    )
  })

  it('faellt keinem Vorschlag in eine Handentscheidung hinein', () => {
    // Dort hat jemand ausdruecklich etwas anderes gewollt. Ein Vorschlag, der
    // denselben Schluessel noch einmal nennt, wuerde in `verschmelzeWerke`
    // ohnehin als „ein Schluessel in zwei Zuordnungen" ganz wegfallen (Fall 4).
    const neu = uebernehmen(handisch, [{ schluessel: 'y', auch: ['z'], stufe: 'locker' }])
    assert.equal(neu.zuordnungen.length, 1)
  })

  it('laesst die Trennungen unberuehrt', () => {
    const mit: Ablage = { zuordnungen: [], getrennt: [['a', 'b']] }
    assert.deepEqual(uebernehmen(mit, []).getrennt, [['a', 'b']])
  })
})

describe('trennen und verbinden — einzeln, ohne die ganze Funktion abzuschalten', () => {
  const ablage: Ablage = {
    zuordnungen: [{ schluessel: 'j', auch: ['s', 'l'], stufe: 'locker' }],
    getrennt: [],
  }

  it('loest die ganze Zuordnung, wenn kein Mitglied genannt ist', () => {
    const nachher = trennen(ablage, 'j')
    assert.equal(nachher.zuordnungen.length, 0)
    assert.deepEqual(nachher.getrennt, [
      ['j', 's'],
      ['j', 'l'],
    ])
  })

  it('nimmt nur EIN Mitglied heraus, wenn es genannt ist', () => {
    const nachher = trennen(ablage, 'j', 's')
    assert.deepEqual(nachher.zuordnungen, [{ schluessel: 'j', auch: ['l'], stufe: 'locker' }])
    assert.deepEqual(nachher.getrennt, [['j', 's']])
  })

  it('merkt sich die Trennung, damit der naechste Abgleich sie achtet', () => {
    const nachher = trennen(ablage, 'j', 's')
    const werke = [werk('j', 'jellyfin'), werk('s', 'spotify')]
    assert.equal(zuordnungenVorschlagen(werke, { getrennt: nachher.getrennt }).vorschlaege.length, 0)
  })

  it('nimmt eine Trennung wieder zurueck', () => {
    // Sonst waere „trennen" eine Einbahnstrasse und ein Fehlgriff teurer als
    // der Fehler, gegen den der Knopf gebaut ist.
    const getrennt = trennen(ablage, 'j', 's')
    const wieder = verbinden(getrennt, 's', 'j')
    assert.deepEqual(wieder.getrennt, [])
  })

  it('laesst eine fremde Zuordnung stehen', () => {
    assert.deepEqual(trennen(ablage, 'unbekannt').zuordnungen, ablage.zuordnungen)
  })
})

/**
 * `handVerbinden` — eine Zuordnung von HAND FESTSCHREIBEN, ohne auf die
 * Heuristik zu warten (W2, Befund 29.08.2026). Der Mitschnitt
 * (plugins/mixpi-mitschnitt) ruft das ueber `/api/verschmelzung/festschreiben`
 * bei JEDEM aufgenommenen Stueck erneut auf — idempotent und mit `getrennt`
 * als letztem Wort muss diese Funktion deshalb wirklich sein, nicht nur im
 * Normalfall.
 */
describe('handVerbinden — eine Zuordnung von Hand festschreiben (W2)', () => {
  it('legt eine neue Zuordnung mit Stufe "hand" an', () => {
    const nachher = handVerbinden(ABLAGE_LEER, 'spotify:abc', 'lokal:t:kuenstler|titel')
    assert.deepEqual(nachher.zuordnungen, [
      { schluessel: 'spotify:abc', auch: ['lokal:t:kuenstler|titel'], stufe: 'hand' },
    ])
    assert.deepEqual(nachher.getrennt, [])
  })

  it('ist IDEMPOTENT — ein zweiter Aufruf mit demselben Paar laesst die Ablage unveraendert', () => {
    // Der Mitschnitt ruft bei jedem weiteren Stueck desselben Albums erneut
    // auf: das darf die Ablage nicht wachsen lassen.
    const einmal = handVerbinden(ABLAGE_LEER, 'spotify:abc', 'lokal:t:k|t')
    const zweimal = handVerbinden(einmal, 'spotify:abc', 'lokal:t:k|t')
    assert.deepEqual(zweimal, einmal)
  })

  it('ist idempotent auch mit VERTAUSCHTEN Argumenten', () => {
    const einmal = handVerbinden(ABLAGE_LEER, 'spotify:abc', 'lokal:t:k|t')
    const vertauscht = handVerbinden(einmal, 'lokal:t:k|t', 'spotify:abc')
    assert.deepEqual(vertauscht, einmal)
  })

  it('GETRENNT GEWINNT — eine ausdrueckliche Trennung wird nicht still aufgehoben', () => {
    const getrennt: Ablage = { zuordnungen: [], getrennt: [['spotify:abc', 'lokal:t:k|t']] }
    const nachher = handVerbinden(getrennt, 'spotify:abc', 'lokal:t:k|t')
    assert.deepEqual(nachher, getrennt, 'die Ablage kommt UNVERAENDERT zurueck')
  })

  it('erweitert eine bestehende Zuordnung, statt eine zweite mit demselben Fuehrenden anzulegen', () => {
    // Fall 4 in verschmelzeWerke(): ein Schluessel in ZWEI Zuordnungen zaehlt
    // nur fuer die erste - eine zweite waere ein stiller Fehlschlag.
    const schonDa: Ablage = {
      zuordnungen: [{ schluessel: 'spotify:abc', auch: ['lokal:t:k|t'], stufe: 'locker' }],
      getrennt: [],
    }
    const nachher = handVerbinden(schonDa, 'spotify:abc', 'lokal:t:zweites-stueck')
    assert.equal(nachher.zuordnungen.length, 1, 'keine zweite Zuordnung zu demselben Fuehrenden')
    assert.deepEqual(nachher.zuordnungen[0], {
      schluessel: 'spotify:abc',
      auch: ['lokal:t:k|t', 'lokal:t:zweites-stueck'],
      stufe: 'locker',
    })
  })

  it('erweitert auch, wenn der NEUE Schluessel bereits als Fuehrender einer anderen Zuordnung dasteht', () => {
    const schonDa: Ablage = {
      zuordnungen: [{ schluessel: 'lokal:t:k|t', auch: ['jellyfin:xyz'], stufe: 'hand' }],
      getrennt: [],
    }
    const nachher = handVerbinden(schonDa, 'spotify:abc', 'lokal:t:k|t')
    assert.equal(nachher.zuordnungen.length, 1)
    assert.deepEqual(nachher.zuordnungen[0], {
      schluessel: 'lokal:t:k|t',
      auch: ['jellyfin:xyz', 'spotify:abc'],
      stufe: 'hand',
    })
  })

  it('erweitert, wenn eines der beiden schon MITGLIED (nicht Fuehrend) einer Zuordnung ist', () => {
    const schonDa: Ablage = {
      zuordnungen: [{ schluessel: 'jellyfin:xyz', auch: ['spotify:abc'], stufe: 'locker' }],
      getrennt: [],
    }
    const nachher = handVerbinden(schonDa, 'spotify:abc', 'lokal:t:k|t')
    assert.equal(nachher.zuordnungen.length, 1)
    assert.deepEqual(nachher.zuordnungen[0].auch, ['spotify:abc', 'lokal:t:k|t'])
  })

  it('tut nichts bei leeren oder gleichen Schluesseln', () => {
    assert.deepEqual(handVerbinden(ABLAGE_LEER, '', 'x'), ABLAGE_LEER)
    assert.deepEqual(handVerbinden(ABLAGE_LEER, 'x', ''), ABLAGE_LEER)
    assert.deepEqual(handVerbinden(ABLAGE_LEER, 'x', 'x'), ABLAGE_LEER)
  })

  it('laesst eine fremde Zuordnung unberuehrt', () => {
    const schonDa: Ablage = { zuordnungen: [{ schluessel: 'a', auch: ['b'], stufe: 'locker' }], getrennt: [] }
    const nachher = handVerbinden(schonDa, 'c', 'd')
    assert.deepEqual(nachher.zuordnungen[0], schonDa.zuordnungen[0])
    assert.deepEqual(nachher.zuordnungen[1], { schluessel: 'c', auch: ['d'], stufe: 'hand' })
  })
})

describe('neueVorschlaege — was seit dem letzten Abgleich dazukam', () => {
  it('meldet nur, was in der Ablage noch nicht vorkommt', () => {
    const ablage: Ablage = { zuordnungen: [{ schluessel: 'a', auch: ['b'], stufe: 'locker' }], getrennt: [] }
    const neu = neueVorschlaege(ablage, [
      { schluessel: 'a', auch: ['b'], stufe: 'locker' },
      { schluessel: 'c', auch: ['d'], stufe: 'locker' },
    ])
    assert.deepEqual(
      neu.map((z) => z.schluessel),
      ['c'],
    )
  })
})

describe('Erkennung und Aufloesung greifen ineinander', () => {
  it('macht aus den zwei gemessenen Paaren genau zwei Kacheln weniger', () => {
    // DIE ZAHL, AN DER DER GANZE AUFTRAG HAENGT — dieselbe Messung wie mit
    // tools/quellen-ueberschneidung.mjs, nur ohne Box: vier Eintraege, zwei
    // Paare, danach zwei Kacheln. Nicht mehr und nicht weniger.
    const werke = [HAMM_JELLYFIN, LUMPEN_SPOTIFY, LUMPEN_JELLYFIN, HAMM_SPOTIFY]
    const { vorschlaege } = zuordnungenVorschlagen(werke)
    const heraus = verschmelzeWerke(werke, vorschlaege)
    assert.equal(heraus.length, werke.length - 2)
    // Und die bevorzugte Quelle ist jeweils Jellyfin: lokal -> jellyfin ->
    // spotify ist Absicherung, nicht Geschmack (verschmelzung.ts).
    for (const w of heraus) assert.equal(w.quellen[0].dienst, 'jellyfin')
  })

  it('behaelt den Schluessel des fuehrenden Werks — der Verlauf bleibt', () => {
    const werke = [LUMPEN_JELLYFIN, LUMPEN_SPOTIFY]
    const { vorschlaege } = zuordnungenVorschlagen(werke)
    const heraus = verschmelzeWerke(werke, vorschlaege)
    assert.equal(heraus.length, 1)
    assert.equal(heraus[0].schluessel, LUMPEN_JELLYFIN.schluessel)
    assert.deepEqual(heraus[0].auchSchluessel, [LUMPEN_SPOTIFY.schluessel])
    assert.equal(heraus[0].stufe, 'locker')
  })

  it('ist umkehrbar: ohne Zuordnungen stehen wieder zwei Kacheln da', () => {
    // DAS IST DER RUECKWEG. Die Eintraege in data.json werden nie angefasst;
    // ausgeschaltet sieht die Box aus wie vorher, mit beiden Verlaeufen.
    const werke = [LUMPEN_JELLYFIN, LUMPEN_SPOTIFY]
    assert.equal(verschmelzeWerke(werke, []).length, 2)
  })
})

/**
 * DIE STUFE MUSS ANKOMMEN (E86).
 *
 * Gebaut war die Abstufung in medien.ts, aber `zuordnungenVorschlagen` rief
 * `gruppiereTreffer` ohne Regeln — eine Einstellung, die nirgends ankommt,
 * ist genau die Sorte Schalter, gegen die dieses Projekt schon einmal
 * angetreten ist. Diese Zeugen halten die Kette fest.
 */
describe('Abgleich-Stufe reicht durch (E86)', () => {
  // Der gemessene Fall: dieselben Woerter, anders auf die Felder verteilt.
  const ARD = werk('ard:81889970', 'ard', {
    art: 'show',
    titel: 'Quarks Science Cops',
    interpret: 'WDR',
    kategorie: 'audiobook',
  })
  const SPOT = werk('spotify:abc', 'spotify', {
    art: 'show',
    titel: 'Science Cops',
    interpret: 'Quarks',
    kategorie: 'audiobook',
  })

  it('NORMAL schlaegt das Paar vor', () => {
    const e = zuordnungenVorschlagen([ARD, SPOT], { regeln: REGELN_NORMAL })
    assert.equal(e.vorschlaege.length, 1)
    assert.deepEqual([e.vorschlaege[0].schluessel, ...e.vorschlaege[0].auch].sort(), ['ard:81889970', 'spotify:abc'])
  })

  it('STRENG schlaegt es NICHT vor — die Stufe wirkt wirklich', () => {
    const e = zuordnungenVorschlagen([ARD, SPOT], { regeln: REGELN_STRENG })
    assert.equal(e.vorschlaege.length, 0)
  })

  it('OHNE Angabe gilt normal — die Vorgabe bleibt die Vorgabe', () => {
    assert.equal(zuordnungenVorschlagen([ARD, SPOT]).vorschlaege.length, 1)
  })

  it('LOCKER findet mehr — und der Preis ist sichtbar', () => {
    // „Quarks" ist eine eigenstaendige WDR-Sendung. Auf `locker` faellt sie
    // mit „Quarks Science Cops" zusammen; das ist gewollt und gehoert
    // festgehalten, damit es niemand spaeter fuer einen Fehler haelt.
    const QUARKS = werk('jellyfin:q', 'jellyfin', {
      art: 'show',
      titel: 'Quarks',
      interpret: 'WDR',
      kategorie: 'audiobook',
    })
    assert.equal(zuordnungenVorschlagen([QUARKS, ARD], { regeln: REGELN_NORMAL }).vorschlaege.length, 0)
    assert.equal(zuordnungenVorschlagen([QUARKS, ARD], { regeln: REGELN_LOCKER }).vorschlaege.length, 1)
  })

  it('`getrennt` schlaegt JEDE Stufe — der Handbetrieb bleibt das letzte Wort', () => {
    // Auch auf `locker` darf eine Entscheidung des Menschen nicht ueberrannt
    // werden. Sonst waere der Knopf „trennen" auf der falschen Stufe
    // folgenlos.
    const e = zuordnungenVorschlagen([ARD, SPOT], {
      regeln: REGELN_LOCKER,
      getrennt: [['ard:81889970', 'spotify:abc']],
    })
    assert.equal(e.vorschlaege.length, 0)
    assert.ok(e.uebergangen.some((u) => u.grund === 'getrennt'))
  })
})
