/**
 * Tests der Verschmelzung — dasselbe Werk aus mehreren Diensten, EINE Kachel.
 *
 * WARUM DIESE TESTS SCHON JETZT ETWAS WERT SIND, obwohl auf der Box heute
 * nichts zu verschmelzen ist (gemessen 2026-08-02: 21 spotify, 1 jellyfin,
 * 0 lokal — Ueberschneidung null): die Regel entscheidet spaeter, WOMIT
 * gespielt wird. Ein Fehler darin faellt nicht als Absturz auf, sondern als
 * „warum spielt das ueber Spotify, obwohl es hier liegt?" — und das sieht
 * niemand, der nicht gerade danach sucht.
 *
 * DER SCHWERPUNKT LIEGT AUF DEM NICHT-VERSCHMELZEN. Zwei Kacheln zu viel sind
 * ein Schoenheitsfehler; eine Kachel, die das Falsche verspricht, ist ein
 * Vertrauensverlust — und auf einer Kinderbox eine Kachel, die nichts tut.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  type Dienst,
  type InhaltKandidat,
  identitaetsKarte,
  istGanz,
  istStufe,
  metadatenVerschmelzen,
  QUELLEN_REIHENFOLGE,
  quellenOrdnen,
  rang,
  verschmelzeWerke,
  waehleInhalt,
  type Zuordnung,
} from './verschmelzung'
import type { Quelle, Werk } from './werke'

/**
 * Die erste Quelle nach dem Ordnen — frueher `bevorzugteQuelle()`.
 *
 * Die Funktion ist am 19.09.2026 gefallen (AUDIT-2026-09-19 Rang 7): sie
 * hatte ausser dieser Spec keinen Aufrufer, weil `verschmelzeWerke()` die
 * Quellen bereits geordnet ablegt und alle acht Stellen im Baum deshalb
 * direkt `quellen[0]` nehmen. Die ELF Zusicherungen darunter pruefen aber
 * nicht die Huelle, sondern die ORDNUNG — und die lebt. Sie stehen deshalb
 * weiter hier und rufen den Weg, den der Baum wirklich geht.
 */
function ERSTE_GEORDNETE(quellen: Quelle[] | undefined, reihenfolge?: readonly Dienst[]): Quelle | null {
  return (reihenfolge ? quellenOrdnen(quellen, reihenfolge) : quellenOrdnen(quellen))[0] ?? null
}

/** Ein Werk in der Form, die `werkAus()` liefert — gekuerzt auf das Noetige. */
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

const LOKAL = werk('lokal:t:das lumpenpack|die zukunft wird gross', 'lokal')
const JELLYFIN = werk('jellyfin:e131865d504a657a93533722fc88bc90', 'jellyfin')
const SPOTIFY = werk('spotify:4aawyAB9vmqN3uQ7FjRGTy', 'spotify')

/** Die Behauptung: das sind alles dasselbe Album. */
const ZUORDNUNG: Zuordnung = {
  schluessel: JELLYFIN.schluessel,
  auch: [SPOTIFY.schluessel, LOKAL.schluessel],
  stufe: 'locker',
}

describe('rang — der Platz eines Dienstes in der Bevorzugung', () => {
  it('setzt lokal vor jellyfin vor spotify', () => {
    assert.ok(rang('lokal') < rang('jellyfin'))
    assert.ok(rang('jellyfin') < rang('spotify'))
  })

  it('haengt einen unbekannten Dienst hinten an, statt zu werfen', () => {
    // Radio und RSS stehen absichtlich nicht in der Reihenfolge: ein Stream
    // ist keine andere AUSGABE desselben Albums. Sie duerfen aber auch nicht
    // die Startseite kosten.
    assert.ok(rang('radio') > rang('spotify'))
    assert.ok(rang('gibtsnicht') > rang('spotify'))
    assert.ok(rang(undefined) > rang('spotify'))
  })

  it('nimmt eine eigene Reihenfolge an und faellt bei einer leeren zurueck', () => {
    assert.ok(rang('spotify', ['spotify', 'lokal']) < rang('lokal', ['spotify', 'lokal']))
    assert.equal(rang('lokal', []), rang('lokal', QUELLEN_REIHENFOLGE))
  })
})

describe('quellenOrdnen — und was quellen[0] daraus macht', () => {
  it('sortiert die Quellen unabhaengig davon, wie sie hereinkommen', () => {
    const q: Quelle[] = [
      { dienst: 'spotify', kennung: 'a' },
      { dienst: 'lokal', kennung: 'b' },
      { dienst: 'jellyfin', kennung: 'c' },
    ]
    assert.deepEqual(
      quellenOrdnen(q).map((x) => x.dienst),
      ['lokal', 'jellyfin', 'spotify'],
    )
    assert.equal(ERSTE_GEORDNETE(q)?.dienst, 'lokal')
  })

  it('laesst die Eingabe unberuehrt', () => {
    const q: Quelle[] = [
      { dienst: 'spotify', kennung: 'a' },
      { dienst: 'lokal', kennung: 'b' },
    ]
    quellenOrdnen(q)
    assert.equal(q[0].dienst, 'spotify')
  })

  it('haelt gleichrangige Quellen in ihrer Reihenfolge', () => {
    // Bei zwei Quellen desselben Dienstes entschiede sonst der Zufall, welche
    // gespielt wird — und zwar bei jedem Abruf neu.
    const q: Quelle[] = [
      { dienst: 'spotify', kennung: 'erste' },
      { dienst: 'spotify', kennung: 'zweite' },
    ]
    assert.equal(ERSTE_GEORDNETE(q)?.kennung, 'erste')
  })

  it('meldet null statt eines Notbehelfs, wenn es keine Quelle gibt', () => {
    assert.equal(ERSTE_GEORDNETE([]), null)
    assert.equal(ERSTE_GEORDNETE(undefined), null)
    assert.equal(ERSTE_GEORDNETE(null as unknown as Quelle[]), null)
  })

  it('folgt einer eigenen Reihenfolge', () => {
    const q: Quelle[] = [
      { dienst: 'lokal', kennung: 'a' },
      { dienst: 'spotify', kennung: 'b' },
    ]
    assert.equal(ERSTE_GEORDNETE(q, ['spotify', 'jellyfin', 'lokal'])?.dienst, 'spotify')
  })
})

describe('istStufe', () => {
  it('kennt genau die vier Stufen', () => {
    for (const s of ['hand', 'locker', 'fingerabdruck', 'acoustid']) assert.equal(istStufe(s), true)
    assert.equal(istStufe('geraten'), false)
    assert.equal(istStufe(''), false)
    assert.equal(istStufe(undefined), false)
  })
})

describe('verschmelzeWerke — ohne Zuordnung passiert nichts', () => {
  it('vertraegt Leeres und Unfug statt einer Liste', () => {
    assert.deepEqual(verschmelzeWerke([], []), [])
    assert.deepEqual(verschmelzeWerke(undefined as unknown as Werk[]), [])
    assert.deepEqual(verschmelzeWerke(null as unknown as Werk[], null as unknown as Zuordnung[]), [])
  })

  it('gibt die Liste unveraendert zurueck — heute der Normalfall auf der Box', () => {
    const aus = verschmelzeWerke([LOKAL, JELLYFIN, SPOTIFY])
    assert.deepEqual(
      aus.map((w) => w.schluessel),
      [LOKAL.schluessel, JELLYFIN.schluessel, SPOTIFY.schluessel],
    )
    for (const w of aus) {
      assert.equal(w.auchSchluessel, undefined)
      assert.equal(w.stufe, undefined)
    }
  })

  it('ordnet trotzdem die Quellen — damit quellen[0] ueberall die bevorzugte ist', () => {
    const zwei = werk('spotify:x', 'spotify', {
      quellen: [
        { dienst: 'spotify', kennung: 'x' },
        { dienst: 'lokal', kennung: 'y' },
      ],
    })
    assert.equal(verschmelzeWerke([zwei])[0].quellen[0].dienst, 'lokal')
  })

  it('uebergeht eine Zuordnung auf Schluessel, die es nicht gibt', () => {
    const aus = verschmelzeWerke([SPOTIFY], [{ schluessel: 'lokal:weg', auch: ['jellyfin:auch-weg'], stufe: 'hand' }])
    assert.equal(aus.length, 1)
    assert.equal(aus[0].auchSchluessel, undefined)
  })
})

describe('verschmelzeWerke — die Zuordnung greift', () => {
  it('macht aus drei Kacheln eine, mit den Quellen in der Bevorzugung', () => {
    const aus = verschmelzeWerke([LOKAL, JELLYFIN, SPOTIFY], [ZUORDNUNG])
    assert.equal(aus.length, 1)
    assert.deepEqual(
      aus[0].quellen.map((q) => q.dienst),
      ['lokal', 'jellyfin', 'spotify'],
    )
    assert.equal(ERSTE_GEORDNETE(aus[0].quellen)?.dienst, 'lokal')
  })

  it('behaelt die Identitaet des fuehrenden Werks — Verlauf und Bild haengen daran', () => {
    const aus = verschmelzeWerke([LOKAL, JELLYFIN, SPOTIFY], [ZUORDNUNG])
    assert.equal(aus[0].schluessel, JELLYFIN.schluessel)
    assert.equal(aus[0].bild, JELLYFIN.bild)
    assert.deepEqual(aus[0].auchSchluessel?.sort(), [LOKAL.schluessel, SPOTIFY.schluessel].sort())
  })

  it('laesst die Stufe mitreisen, statt sie zu verschweigen', () => {
    const aus = verschmelzeWerke(
      [JELLYFIN, SPOTIFY],
      [{ ...ZUORDNUNG, auch: [SPOTIFY.schluessel], stufe: 'fingerabdruck' }],
    )
    assert.equal(aus[0].stufe, 'fingerabdruck')
  })

  it('setzt die Kachel an die Stelle des fuehrenden Werks', () => {
    // Kommt spaeter eine Quelle dazu, springt die Kachel nicht weg.
    const aus = verschmelzeWerke([SPOTIFY, JELLYFIN, LOKAL], [{ ...ZUORDNUNG, auch: [SPOTIFY.schluessel] }])
    assert.deepEqual(
      aus.map((w) => w.schluessel),
      [JELLYFIN.schluessel, LOKAL.schluessel],
    )
  })

  it('laesst das erste vorhandene fuehren, wenn das fuehrende Werk geloescht wurde', () => {
    // Die Zuordnung ueberlebt das Loeschen eines Eintrags: die Kachel bleibt,
    // sie heisst nur anders.
    const aus = verschmelzeWerke([SPOTIFY, LOKAL], [ZUORDNUNG])
    assert.equal(aus.length, 1)
    assert.equal(aus[0].schluessel, SPOTIFY.schluessel)
    assert.deepEqual(aus[0].auchSchluessel, [LOKAL.schluessel])
  })

  it('veraendert die hereingereichten Werke nicht', () => {
    verschmelzeWerke([LOKAL, JELLYFIN, SPOTIFY], [ZUORDNUNG])
    assert.equal(JELLYFIN.quellen.length, 1)
    assert.equal((JELLYFIN as Werk & { auchSchluessel?: string[] }).auchSchluessel, undefined)
  })

  it('folgt einer eigenen Reihenfolge auch beim Verschmelzen', () => {
    const aus = verschmelzeWerke([LOKAL, JELLYFIN, SPOTIFY], [ZUORDNUNG], {
      reihenfolge: ['spotify', 'jellyfin', 'lokal'],
    })
    assert.equal(aus[0].quellen[0].dienst, 'spotify')
  })
})

describe('verschmelzeWerke — wann NICHT verschmolzen wird', () => {
  it('fasst zwei Werke DESSELBEN Dienstes nie zusammen (Standard und Deluxe)', () => {
    // Dieselbe Zurueckhaltung wie `gruppiereTreffer` mit
    // `aus[j].dienst === aus[i].dienst`: gleicher Name heisst nicht gleiches
    // Album. Im Zweifel zwei Kacheln.
    const zweitesSpotify = werk('spotify:andereId', 'spotify')
    const aus = verschmelzeWerke(
      [SPOTIFY, zweitesSpotify],
      [{ schluessel: SPOTIFY.schluessel, auch: [zweitesSpotify.schluessel], stufe: 'hand' }],
    )
    assert.equal(aus.length, 2)
    assert.equal(aus[0].auchSchluessel, undefined)
  })

  it('nimmt aber die dritte Quelle mit, wenn nur die zweite kollidiert', () => {
    const zweitesSpotify = werk('spotify:andereId', 'spotify')
    const aus = verschmelzeWerke(
      [SPOTIFY, zweitesSpotify, JELLYFIN],
      [{ schluessel: SPOTIFY.schluessel, auch: [zweitesSpotify.schluessel, JELLYFIN.schluessel], stufe: 'hand' }],
    )
    assert.equal(aus.length, 2)
    assert.deepEqual(aus[0].auchSchluessel, [JELLYFIN.schluessel])
    assert.equal(aus[1].schluessel, zweitesSpotify.schluessel)
  })

  it('verschmilzt nie ueber verschiedene `art` hinweg', () => {
    // Der Abspielbefehl entsteht aus `art` UND `dienst`; eine Kachel hat aber
    // nur eine `art`. Eine Playlist in einem Album ergaebe fuer die zweite
    // Quelle einen Befehl, den der Dienst nicht einloest.
    const liste = werk('spotify:1DYDHYJ98WZbHa2OZ4Dljg', 'spotify', { art: 'playlist' })
    const aus = verschmelzeWerke(
      [JELLYFIN, liste],
      [{ schluessel: JELLYFIN.schluessel, auch: [liste.schluessel], stufe: 'hand' }],
    )
    assert.equal(aus.length, 2)
  })

  it('ruehrt einen MEHRDEUTIGEN Schluessel nicht an (auf der Box gemessen, 2026-08-02)', () => {
    // Zwei Eintraege mit derselben `playlistid`, verschieden nur in
    // `category` — sie haben denselben `medienSchluessel`. Welches der beiden
    // gemeint war, ist nicht entscheidbar; `findeIndex()` antwortet in genau
    // diesem Fall mit -1, statt zu raten.
    const jojoMusik = werk('spotify:5C6xQwoAB1uCcCmQpxLJVs', 'spotify', { kategorie: 'music' })
    const jojoHoerbuch = werk('spotify:5C6xQwoAB1uCcCmQpxLJVs', 'spotify', { kategorie: 'audiobook' })
    const aus = verschmelzeWerke(
      [jojoMusik, jojoHoerbuch, JELLYFIN],
      [{ schluessel: JELLYFIN.schluessel, auch: [jojoMusik.schluessel], stufe: 'locker' }],
    )
    assert.equal(aus.length, 3)
    for (const w of aus) assert.equal(w.auchSchluessel, undefined)
  })

  it('laesst einen Schluessel in HOECHSTENS einer Zuordnung aufgehen', () => {
    // Ketten (A=B, B=C) still zu A=B=C aufzuloesen waere die Sorte
    // Grosszuegigkeit, die man erst auf der Box bemerkt.
    const zweitesLokal = werk('lokal:t:anderes|album', 'lokal')
    const aus = verschmelzeWerke(
      [JELLYFIN, SPOTIFY, zweitesLokal],
      [
        { schluessel: JELLYFIN.schluessel, auch: [SPOTIFY.schluessel], stufe: 'locker' },
        { schluessel: SPOTIFY.schluessel, auch: [zweitesLokal.schluessel], stufe: 'locker' },
      ],
    )
    assert.equal(aus.length, 2)
    assert.deepEqual(aus[0].auchSchluessel, [SPOTIFY.schluessel])
    assert.equal(aus[1].schluessel, zweitesLokal.schluessel)
  })

  it('weist eine Zuordnung mit unbekannter Stufe ab, statt sie auf „hand" zu biegen', () => {
    // Die Stufe ist das, woran der Mensch in der Verwaltung ablesen soll, wem
    // er die Zusammenfassung verdankt. Sie zu erfinden waere eine Luege ueber
    // die Herkunft; zwei Kacheln sind bloss ein sichtbarer Tippfehler.
    const kaputt = { schluessel: JELLYFIN.schluessel, auch: [SPOTIFY.schluessel], stufe: 'geraten' }
    const aus = verschmelzeWerke([JELLYFIN, SPOTIFY], [kaputt as unknown as Zuordnung])
    assert.equal(aus.length, 2)
  })

  it('uebergeht eine Zuordnung, die nur sich selbst nennt', () => {
    const aus = verschmelzeWerke(
      [JELLYFIN],
      [{ schluessel: JELLYFIN.schluessel, auch: [JELLYFIN.schluessel, '', '  '], stufe: 'hand' }],
    )
    assert.equal(aus.length, 1)
    assert.equal(aus[0].auchSchluessel, undefined)
  })
})

describe('verschmelzeWerke — „beim Anbieter geloescht" gilt fuer das WERK', () => {
  it('nimmt die Markierung weg, wenn noch eine Quelle spielt', () => {
    // Ein Album, das bei Spotify verschwunden ist, aber in Jellyfin liegt,
    // ist nicht weg. Die einzige Kachel auszugrauen, die noch spielt, waere
    // die falsche Auskunft.
    const totesSpotify = werk('spotify:tot', 'spotify', { fehlt: true })
    const aus = verschmelzeWerke(
      [JELLYFIN, totesSpotify],
      [{ schluessel: JELLYFIN.schluessel, auch: [totesSpotify.schluessel], stufe: 'locker' }],
    )
    assert.equal(aus.length, 1)
    assert.equal(aus[0].fehlt, undefined)
  })

  it('behaelt sie, solange wirklich keine Quelle mehr da ist', () => {
    const totesJellyfin = werk('jellyfin:tot', 'jellyfin', { fehlt: true })
    const totesSpotify = werk('spotify:tot', 'spotify', { fehlt: true })
    const aus = verschmelzeWerke(
      [totesJellyfin, totesSpotify],
      [{ schluessel: totesJellyfin.schluessel, auch: [totesSpotify.schluessel], stufe: 'locker' }],
    )
    assert.equal(aus[0].fehlt, true)
  })

  it('markiert auch dann nicht, wenn das FUEHRENDE Werk lebt', () => {
    const totesSpotify = werk('spotify:tot', 'spotify', { fehlt: true })
    const aus = verschmelzeWerke(
      [LOKAL, totesSpotify],
      [{ schluessel: LOKAL.schluessel, auch: [totesSpotify.schluessel], stufe: 'hand' }],
    )
    assert.equal(aus[0].fehlt, undefined)
    assert.equal(aus[0].quellen[0].dienst, 'lokal')
  })
})

describe('identitaetsKarte — der geschluckte Schluessel findet sein Werk wieder', () => {
  it('fuehrt vom geschluckten zum fuehrenden Schluessel', () => {
    // DER FALL VON DER BOX: „Kapelle Petra — HAMM" fuehrt der Jellyfin-Eintrag,
    // eine gemerkte Stelle kann trotzdem am SPOTIFY-Schluessel haengen (dort
    // wurde zuerst gehoert). Ohne diese Bruecke fuehrt ihre Kachel ins Leere.
    const aus = verschmelzeWerke(
      [JELLYFIN, SPOTIFY],
      [{ schluessel: JELLYFIN.schluessel, auch: [SPOTIFY.schluessel], stufe: 'locker' }],
    )
    const karte = identitaetsKarte(aus)
    assert.equal(karte.get(SPOTIFY.schluessel), JELLYFIN.schluessel)
  })

  it('nennt den fuehrenden Schluessel NICHT — wer ihn hat, braucht keine Bruecke', () => {
    const aus = verschmelzeWerke(
      [JELLYFIN, SPOTIFY],
      [{ schluessel: JELLYFIN.schluessel, auch: [SPOTIFY.schluessel], stufe: 'locker' }],
    )
    assert.equal(identitaetsKarte(aus).has(JELLYFIN.schluessel), false)
  })

  it('bleibt leer, solange nichts verschmolzen ist — „aus" heisst wirklich wie vorher', () => {
    assert.equal(identitaetsKarte(verschmelzeWerke([JELLYFIN, SPOTIFY], [])).size, 0)
  })

  it('vertraegt Unsinn statt zu werfen', () => {
    assert.equal(identitaetsKarte(null).size, 0)
    assert.equal(identitaetsKarte(undefined).size, 0)
    // Eine von Hand geschriebene Ablage kann alles hergeben. Ein Absturz auf
    // der Startseite eines Kindes waere die schlechteste Antwort darauf.
    assert.equal(
      identitaetsKarte([
        { ...JELLYFIN, auchSchluessel: ['', '  ', JELLYFIN.schluessel] },
        { ...SPOTIFY, auchSchluessel: undefined },
      ]).size,
      0,
    )
  })
})

describe('REGEL 1 — das ganze Werk schlaegt das halbe (E17/V6)', () => {
  const lokalHalb = { dienst: 'lokal' as const, kennung: 'l1', titelGesamt: 12, titelDa: 3 }
  const lokalGanz = { dienst: 'lokal' as const, kennung: 'l2', titelGesamt: 12, titelDa: 12 }
  const spotify = { dienst: 'spotify' as const, kennung: 's1' }

  it('das halbe lokale Album verdraengt NICHT das ganze aus dem Stream', () => {
    // Der Fall, um den es geht: sobald Mitschnitte dazukommen, hat `lokal`
    // den hoeheren Rang — aber eben nur drei von zwoelf Titeln.
    const geordnet = quellenOrdnen([lokalHalb, spotify])
    assert.equal(geordnet[0].dienst, 'spotify')
    assert.equal(ERSTE_GEORDNETE([lokalHalb, spotify])?.dienst, 'spotify')
  })

  it('sobald es ganz ist, gewinnt lokal wieder', () => {
    assert.equal(ERSTE_GEORDNETE([lokalGanz, spotify])?.dienst, 'lokal')
  })

  it('ohne Angabe bleibt alles wie bisher', () => {
    // Ein Streamingdienst fuehrt keine Zahlen. `undefined` heisst
    // vollstaendig — sonst aenderte diese Regel jedes bestehende Werk.
    const ohne = { dienst: 'lokal' as const, kennung: 'l3' }
    assert.equal(ERSTE_GEORDNETE([ohne, spotify])?.dienst, 'lokal')
    assert.equal(istGanz(ohne), true)
    assert.equal(istGanz(undefined), true)
  })

  it('zwischen zwei unvollstaendigen entscheidet weiterhin der Rang', () => {
    const jellyfinHalb = { dienst: 'jellyfin' as const, kennung: 'j1', titelGesamt: 12, titelDa: 5 }
    assert.equal(ERSTE_GEORDNETE([jellyfinHalb, lokalHalb])?.dienst, 'lokal')
  })

  it('mehr als erwartet zaehlt als ganz', () => {
    // Kommt eine Bonusspur dazu, ist das kein Grund, das Album zu verwerfen.
    assert.equal(istGanz({ dienst: 'lokal', kennung: 'x', titelGesamt: 12, titelDa: 13 }), true)
  })

  it('eine Gesamtzahl von null sagt nichts — dann gilt vollstaendig', () => {
    assert.equal(istGanz({ dienst: 'lokal', kennung: 'x', titelGesamt: 0, titelDa: 0 }), true)
  })
})

describe('verschmelzeWerke — der Anbieter-Schalter (E76) folgt der fehlt-Regel', () => {
  it('nimmt quelleAus weg, wenn noch eine Quelle spielt', () => {
    // Ein Werk aus abgeschaltetem Spotify UND lebendigem Jellyfin ist
    // spielbar — die Kachel darf nicht grau werden.
    const spotifyAus = werk('spotify:aus', 'spotify', { quelleAus: 'spotify' })
    const aus = verschmelzeWerke(
      [JELLYFIN, spotifyAus],
      [{ schluessel: JELLYFIN.schluessel, auch: [spotifyAus.schluessel], stufe: 'locker' }],
    )
    assert.equal(aus.length, 1)
    assert.equal(aus[0].quelleAus, undefined)
  })

  it('behaelt quelleAus, wenn ALLE Quellen abgeschaltet sind', () => {
    const jellyfinAus = werk('jellyfin:aus', 'jellyfin', { quelleAus: 'jellyfin' })
    const spotifyAus = werk('spotify:aus', 'spotify', { quelleAus: 'spotify' })
    const aus = verschmelzeWerke(
      [jellyfinAus, spotifyAus],
      [{ schluessel: jellyfinAus.schluessel, auch: [spotifyAus.schluessel], stufe: 'locker' }],
    )
    assert.equal(aus.length, 1)
    // Genannt wird der Dienst der BASIS — die bevorzugte Quelle.
    assert.equal(aus[0].quelleAus, 'jellyfin')
  })

  it('nimmt quelleAus der Basis weg, wenn das GESCHLUCKTE Werk lebt', () => {
    const spotifyAus = werk('spotify:aus', 'spotify', { quelleAus: 'spotify' })
    const aus = verschmelzeWerke(
      [spotifyAus, JELLYFIN],
      [{ schluessel: spotifyAus.schluessel, auch: [JELLYFIN.schluessel], stufe: 'hand' }],
    )
    assert.equal(aus.length, 1)
    assert.equal(aus[0].quelleAus, undefined, 'die Jellyfin-Haelfte spielt ja')
  })
})

/**
 * DIE BESCHRIFTUNG WIRD ZUSAMMENGESETZT (E85).
 *
 * Betreiber, 22.08.2026: „interpret, album, titel gehören der box, die meta
 * infos auch. und setzen sich aus den anbieter infos zusammen. ich würde
 * hauptsächlich spotify als nr 1 quelle bevorzugen."
 *
 * Der wichtigste Zeuge hier ist der, der die IDENTITÄT festhält: dass Titel
 * und Bild wandern dürfen, der Schlüssel aber nicht.
 */
describe('Metadaten verschmelzen (E85)', () => {
  const ard = werk('ard:81889970', 'ard', {
    art: 'show',
    titel: 'Quarks Science Cops',
    interpret: 'WDR',
    hatBild: true,
  })
  const spot = werk('spotify:abc', 'spotify', {
    art: 'show',
    titel: 'Science Cops',
    interpret: 'Quarks',
    hatBild: true,
  })

  it('SPOTIFY BESCHRIFTET — auch wenn es beim Abspielen zuletzt drankäme', () => {
    const m = metadatenVerschmelzen([ard, spot])
    assert.equal(m?.titel, 'Science Cops')
    assert.equal(m?.interpret, 'Quarks')
    assert.equal(m?.bild, spot.bild)
  })

  it('FELDWEISE, nicht werkweise: fehlt Spotify der Interpret, springt der nächste ein', () => {
    const ohne = { ...spot, interpret: '' }
    const m = metadatenVerschmelzen([ard, ohne])
    assert.equal(m?.titel, 'Science Cops', 'der Titel bleibt bei Spotify')
    assert.equal(m?.interpret, 'WDR', 'der Interpret kommt von der ARD')
  })

  it('OHNE BILD WIRD NICHT GEWECHSELT — sonst tauscht man ein Cover gegen einen Buchstaben', () => {
    const blind = { ...spot, hatBild: false }
    const m = metadatenVerschmelzen([ard, blind])
    assert.equal(m?.titel, 'Science Cops', 'beschriftet wird trotzdem von Spotify')
    assert.equal(m?.bild, ard.bild, 'das Bild bleibt, wo eines liegt')
  })

  it('hat NIEMAND ein Bild, bleibt es beim führenden Werk', () => {
    const m = metadatenVerschmelzen([
      { ...ard, hatBild: false },
      { ...spot, hatBild: false },
    ])
    assert.equal(m?.bild, ard.bild)
  })

  it('ein leerer Titel überall lässt den des führenden Werks stehen', () => {
    const m = metadatenVerschmelzen([
      { ...ard, titel: 'Nur der hier' },
      { ...spot, titel: '' },
    ])
    assert.equal(m?.titel, 'Nur der hier')
  })

  it('leere Liste ist null, nicht ein leeres Etwas', () => {
    assert.equal(metadatenVerschmelzen([]), null)
  })

  it('DIE IDENTITÄT WANDERT NICHT: der Schlüssel bleibt der des führenden Werks', () => {
    // Der teuerste Fehler an dieser Stelle. Am Schlüssel hängen Verlauf,
    // Weiterhören und Favoriten — wandert er mit der Beschriftung, verliert
    // die Box ihre Stelle genau dann, wenn jemand eine Quelle dazulegt.
    const [v] = verschmelzeWerke([ard, spot], [{ schluessel: ard.schluessel, auch: [spot.schluessel], stufe: 'hand' }])
    assert.equal(v.schluessel, ard.schluessel, 'Identität bleibt bei der ARD')
    assert.equal(v.titel, 'Science Cops', 'Beschriftung kommt von Spotify')
    assert.equal(v.bild, spot.bild, 'und das Bild auch')
    assert.deepEqual(v.auchSchluessel, [spot.schluessel])
  })

  it('die ABSPIEL-Reihenfolge bleibt davon unberührt', () => {
    // Zwei Achsen: beschriften nach Spotify, spielen nach lokal/jellyfin.
    const lokalWerk = werk('lokal:t:x|y', 'lokal', { art: 'show', titel: 'Lokal', hatBild: false })
    const [v] = verschmelzeWerke(
      [lokalWerk, spot],
      [{ schluessel: lokalWerk.schluessel, auch: [spot.schluessel], stufe: 'hand' }],
    )
    assert.equal(v.quellen[0].dienst, 'lokal', 'gespielt wird weiter lokal zuerst')
    assert.equal(v.titel, 'Science Cops', 'beschriftet wird von Spotify')
  })
})

describe('waehleInhalt — E95 Stufe 1: die vollere Quelle schlaegt die Reihenfolge, das Flag entscheidet nichts', () => {
  // DIE FORM, DIE `inhaltFuerEintrag()` (server.ts) LIEFERT — hier von Hand
  // gebaut, damit der Test nicht an Netz, m3u oder Spotify haengt. `titel`
  // ist absichtlich eine Liste aus leeren Objekten: `waehleInhalt` zaehlt nur
  // ihre LAENGE, sie sieht sich keinen einzigen Titel inhaltlich an.
  const erfolg = (anzahlTitel: number, vollstaendig?: boolean): InhaltKandidat => ({
    status: 200,
    body: { vollstaendig, titel: Array.from({ length: anzahlTitel }, () => ({})) },
  })

  // DER FESTNAGEL-TEST AUS DEM KRITIKER-LAUF 30.08. (AUDIT-2026-08-30 §1.1,
  // Rang 1): ein KOMPLETT aufgenommener Mitschnitt (ohne Flag - sein Zweig
  // laesst es bewusst weg) darf gegen die gleich lange Netz-Fassung MIT Flag
  // nicht verlieren. Die erste Fassung dieser Wahl tat genau das: Flag-Sieg
  // vor Titelzahl-Vergleich, die Offline-Reihenfolge war fuer lokal<->spotify
  // tot. Wer den Flag-Vorrang wieder einbaut, faellt hier.
  it('komplett-lokal ohne Flag schlaegt gleich-vollstaendiges Spotify mit Flag', () => {
    const lokal = erfolg(12)
    const spotify = erfolg(12, true)
    assert.equal(waehleInhalt([lokal, spotify]), lokal)
  })

  it('der Teilbestand verliert weiter gegen die vollere Netz-Fassung (Nah-Fall)', () => {
    const lokal = erfolg(3)
    const spotify = erfolg(12, true)
    assert.equal(waehleInhalt([lokal, spotify]), spotify)
  })
  const fehler = (status: number, error: string): InhaltKandidat => ({ status, body: { error } })

  it('unvollstaendig-lokal gegen vollstaendig-spotify: die vollstaendige gewinnt, obwohl sie hinten steht', () => {
    // GENAU DER „NAH"-MESSFALL: die bevorzugte (lokale) Quelle hat weniger
    // Titel, behauptet aber auch gar nicht, vollstaendig zu sein — so, wie es
    // der lokale Zweig seit dieser Stufe tut.
    const lokal = erfolg(3)
    const spotify = erfolg(12, true)
    assert.equal(waehleInhalt([lokal, spotify]), spotify)
  })

  it('beide vollstaendig und gleich viele Titel: die REIHENFOLGE entscheidet, nicht die Zahl', () => {
    const bevorzugt = erfolg(5, true)
    const zweite = erfolg(5, true)
    assert.equal(waehleInhalt([bevorzugt, zweite]), bevorzugt)
  })

  it('keine ist vollstaendig, die bevorzugte hat WENIGER Titel als eine andere: die vollere gewinnt', () => {
    // Der Kern dieser Stufe, losgeloest vom Wortlaut „lokal"/„spotify": egal
    // welcher Dienst vorn steht, wer weniger Titel meldet, verliert gegen
    // eine erfolgreiche Antwort mit mehr.
    const bevorzugt = erfolg(3)
    const zweite = erfolg(12)
    assert.equal(waehleInhalt([bevorzugt, zweite]), zweite)
  })

  it('keine ist vollstaendig, gleich viele Titel: die FRUEHERE in der Reihenfolge gewinnt (stabil)', () => {
    const bevorzugt = erfolg(5)
    const zweite = erfolg(5)
    assert.equal(waehleInhalt([bevorzugt, zweite]), bevorzugt)
  })

  it('scheitern ALLE, kommt der Fehler der BEVORZUGTEN (ersten) Quelle durch', () => {
    const bevorzugterFehler = fehler(502, 'Spotify 404')
    const zweiterFehler = fehler(502, 'nichtErreichbar')
    assert.equal(waehleInhalt([bevorzugterFehler, zweiterFehler]), bevorzugterFehler)
  })

  it('ein Erfolg irgendwo in der Reihe gewinnt gegen Fehler davor', () => {
    const ersterFehler = fehler(502, 'nichtErreichbar')
    const erfolgreiche = erfolg(4)
    assert.equal(waehleInhalt([ersterFehler, erfolgreiche]), erfolgreiche)
  })

  it('wirft bei einer leeren Kandidatenliste, statt stillschweigend etwas zu erfinden', () => {
    // Der Aufrufer (server.ts) prueft `kandidaten.length` VOR dem Aufruf —
    // eine leere Liste hier waere sein Fehler, keine normale Eingabe.
    assert.throws(() => waehleInhalt([]))
  })
})
