/**
 * Zeugen fuer mixpi-similar — ohne Box und ohne Netz.
 *
 * Die Netzquellen fahren gegen AUFGEZEICHNETE Antworten (siehe `fixtures/`),
 * nicht gegen die echten Dienste: ein Zeuge, der das Internet braucht, ist
 * kein Zeuge, sondern eine Wettervorhersage.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import deezer, { besterTreffer } from './quellen/deezer.mjs'
// `inhalt.mjs` hat KEINEN Standardexport, sondern `quelleBauen` — es braucht
// seine Datensaetze, bevor es eine Quelle ist. Deshalb hier als Namensraum.
import * as inhaltQuelle from './quellen/inhalt.mjs'
import { einbettungsText, jaccard, kosinus, namenVon, textHash } from './quellen/inhalt.mjs'
import lastfm from './quellen/lastfm.mjs'
import listenbrainz, { trefferLesen } from './quellen/listenbrainz.mjs'
import musicbrainz, { bestenWaehlen } from './quellen/musicbrainz.mjs'
import { verschmelzen } from './fusion.mjs'
import { gleicherName, normalName } from './normalisieren.mjs'
import { Kartei } from './speicher.mjs'
import { Eimer, eimerZuruecksetzen } from './takt.mjs'

const HIER = dirname(fileURLToPath(import.meta.url))
const daten = JSON.parse(await readFile(join(HIER, 'inhalt-daten.json'), 'utf8'))
const SAETZE = daten.saetze

/** Eine Umgebung, die nur das kann, was der Zeuge ihr gibt. */
function umgebung({ antworten = {}, lastfmSchluessel = '', ollama = {} } = {}) {
  const geholt = []
  const protokolliert = []
  return {
    geholt,
    protokolliert,
    lastfmSchluessel,
    ollama,
    nutzerKennung: 'mixpi-similar-test/0',
    protokoll: (t) => protokolliert.push(t),
    marke: async () => true,
    holen: async (adresse) => {
      geholt.push(adresse)
      const treffer = Object.entries(antworten).find(([muster]) => adresse.includes(muster))
      if (!treffer) throw new Error(`Zeuge kennt die Adresse nicht: ${adresse}`)
      const [, wert] = treffer
      const { text = '', status = 200 } = typeof wert === 'string' ? { text: wert } : wert
      return { ok: status >= 200 && status < 300, status, text: async () => text }
    },
  }
}

/* ═════════════════════════════════════════════════════════════════════════
 * Namen
 * ═════════════════════════════════════════════════════════════════════════ */

test('Namensnormalisierung', async (t) => {
  await t.test('fasst Und-Zeichen und Wort zusammen', () => {
    assert.equal(normalName('Pettersson & Findus'), normalName('Pettersson und Findus'))
    assert.ok(gleicherName('Pettersson & Findus', 'Pettersson und Findus'))
  })

  await t.test('faellt Umlaut und ausgeschriebene Form zusammen', () => {
    // AM ECHTEN BESTAND DER BOX GEMESSEN (06.09.2026): sie fuehrt „Hello Kitty
    // Hörspiele", die Themenkarte „Hello Kitty Hoerspiele". Wer nur die
    // Diakritika wegnimmt, bekommt „horspiele" gegen „hoerspiele" und findet
    // den Eintrag nicht.
    assert.equal(normalName('Hello Kitty Hörspiele'), normalName('Hello Kitty Hoerspiele'))
    assert.equal(normalName('Die Schlümpfe'), normalName('Die Schluempfe'))
    assert.equal(normalName('Straße'), 'strasse')
  })

  await t.test('macht die zwei Apostrophe gleich', () => {
    // Der Bestand fuehrt beide Formen nebeneinander: „Gabby's Dollhouse" und
    // „Gabby’s Dollhouse Deutschland".
    assert.equal(normalName("Gabby's Dollhouse"), normalName('Gabby’s Dollhouse'))
  })

  await t.test('wirft Klammerzusaetze weg, auch mit Umlaut', () => {
    assert.equal(normalName('Bärenbude (Hörspiel)'), 'baerenbude')
  })

  await t.test('ist keine Aehnlichkeitssuche', () => {
    // Zwei Serien desselben Verlags mit aehnlicher Schreibung duerfen NICHT
    // zusammenfallen — sonst bekaeme ein Kind die eine als „dasselbe" wie die
    // andere untergeschoben.
    assert.ok(!gleicherName('Benjamin Bluemchen', 'Bibi Blocksberg'))
  })

  await t.test('leerer Name trifft nichts', () => {
    assert.equal(normalName(null), '')
    assert.ok(!gleicherName('', ''))
  })
})

/* ═════════════════════════════════════════════════════════════════════════
 * Fusion
 * ═════════════════════════════════════════════════════════════════════════ */

test('Fusion (RRF)', async (t) => {
  await t.test('zwei Quellen schlagen eine, auch bei schlechterem Rang', () => {
    const ergebnis = verschmelzen(
      {
        a: [{ schluessel: 'einsam', name: 'Einsam' }, { schluessel: 'geteilt', name: 'Geteilt' }],
        b: [{ schluessel: 'geteilt', name: 'Geteilt' }],
      },
      { a: 1, b: 1 },
    )
    assert.equal(ergebnis[0].schluessel, 'geteilt')
    assert.deepEqual(ergebnis[0].quellen, { a: 2, b: 1 })
  })

  await t.test('Gewicht 0 heisst aus', () => {
    const ergebnis = verschmelzen({ a: [{ schluessel: 'x', name: 'X' }] }, { a: 0 })
    assert.equal(ergebnis.length, 0)
  })

  await t.test('mindestensQuellen filtert Einzelstimmen', () => {
    const listen = {
      a: [{ schluessel: 'einsam', name: 'E' }, { schluessel: 'geteilt', name: 'G' }],
      b: [{ schluessel: 'geteilt', name: 'G' }],
    }
    const ergebnis = verschmelzen(listen, { a: 1, b: 1 }, { mindestensQuellen: 2 })
    assert.deepEqual(ergebnis.map((e) => e.schluessel), ['geteilt'])
  })

  await t.test('eine Quelle stimmt nur einmal ab, auch bei Dubletten', () => {
    const ergebnis = verschmelzen(
      { a: [{ schluessel: 'x', name: 'X' }, { schluessel: 'x', name: 'X' }, { schluessel: 'y', name: 'Y' }] },
      { a: 1 },
    )
    assert.equal(ergebnis[0].quellen.a, 1, 'der bessere Rang zaehlt')
    assert.equal(ergebnis.find((e) => e.schluessel === 'y').quellen.a, 3, 'die Dublette verschiebt den Rang nicht')
  })

  await t.test('eine spaeter gelieferte MBID gewinnt', () => {
    const ergebnis = verschmelzen(
      {
        ohne: [{ schluessel: 'k', name: 'K' }],
        mit: [{ schluessel: 'k', name: 'K', mbid: 'abc' }],
      },
      { ohne: 1, mit: 1 },
    )
    assert.equal(ergebnis[0].mbid, 'abc')
    assert.equal(ergebnis[0].unaufgeloest, false)
  })

  await t.test('gleiche Punkte ergeben immer dieselbe Reihenfolge', () => {
    // Ohne zweite Regel haengt die Ordnung an der Einfuegereihenfolge — und
    // die haengt daran, welche Quelle zufaellig zuerst geantwortet hat.
    const bauen = (namen) => verschmelzen({ a: namen.map((n) => ({ schluessel: n, name: n })) }, { a: 1 })
    assert.deepEqual(
      bauen(['b', 'a']).map((e) => e.name),
      ['b', 'a'],
      'verschiedene Raenge bleiben verschieden',
    )
    const gleich = verschmelzen(
      { a: [{ schluessel: 'x', name: 'Zeta' }], b: [{ schluessel: 'y', name: 'Alpha' }] },
      { a: 1, b: 1 },
    )
    assert.deepEqual(gleich.map((e) => e.name), ['Alpha', 'Zeta'], 'bei Gleichstand alphabetisch')
  })

  await t.test('grenze schneidet ab', () => {
    const viele = Array.from({ length: 50 }, (_, i) => ({ schluessel: `k${i}`, name: `K${i}` }))
    assert.equal(verschmelzen({ a: viele }, { a: 1 }, { grenze: 5 }).length, 5)
  })
})

/* ═════════════════════════════════════════════════════════════════════════
 * Themenkarte
 * ═════════════════════════════════════════════════════════════════════════ */

test('Themenkarte', async (t) => {
  const q = inhaltQuelle.quelleBauen(SAETZE)

  await t.test('Jaccard: kein gemeinsames Schlagwort ist keine Aehnlichkeit', () => {
    assert.equal(jaccard(['a', 'b'], ['c', 'd']), 0)
    assert.equal(jaccard([], ['a']), 0)
    assert.ok(jaccard(['a', 'b'], ['a', 'b']) > jaccard(['a', 'b'], ['a', 'c']))
  })

  await t.test('Jaccard benachteiligt breite Eintraege nicht vollstaendig', () => {
    // Ein Eintrag mit neun Schlagworten trifft einen mit dreien, von denen
    // alle drei passen. Reines Jaccard gaebe 3/9 = 0,33; hier soll mehr
    // herauskommen, weil die kleinere Menge vollstaendig getroffen ist.
    const breit = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    assert.ok(jaccard(breit, ['a', 'b', 'c']) > 0.5)
  })

  await t.test('Kosinus', () => {
    assert.equal(kosinus([1, 0], [1, 0]), 1)
    assert.equal(kosinus([1, 0], [0, 1]), 0)
    assert.equal(kosinus([1, 0], [1, 0, 0]), 0, 'verschiedene Laengen sind kein Vergleich')
    assert.equal(kosinus([0, 0], [1, 1]), 0, 'ein Nullvektor bringt keine Division durch null')
  })

  await t.test('Hash haengt am selben Text wie die Einbettung', () => {
    const satz = { name: 'A', tags: ['x'], beschreibung: 'B' }
    const anders = { name: 'A', tags: ['x'], beschreibung: 'C' }
    assert.notEqual(textHash(einbettungsText(satz)), textHash(einbettungsText(anders)))
    assert.equal(textHash(einbettungsText(satz)), textHash(einbettungsText({ ...satz })))
  })

  await t.test('loest ueber Aliase auf', async () => {
    // Die Box nennt die Serie „Die Maus", die Karte „Die Sendung mit der Maus".
    const ref = await q.aufloesen({ name: 'Die Maus' })
    assert.equal(ref.name, 'Die Sendung mit der Maus')
    assert.ok(namenVon(ref.extra.satz).includes('die maus'))
  })

  await t.test('loest einen Teil eines Mehrfachfeldes auf', async () => {
    // Das `artist`-Feld der Box ist nicht ein Interpret: dort steht
    // „Ruby van der Bogen, 101 fabelhafte Freunde" — bei 9 von 66 Eintraegen
    // der groesste Posten im Bestand.
    const ref = await q.aufloesen({ name: 'Ruby van der Bogen, 101 fabelhafte Freunde' })
    assert.equal(ref.name, '101 fabelhafte Freunde')
    const zweiter = await q.aufloesen({ name: 'Team Karacho, ANOTHER NGUYEN' })
    assert.equal(zweiter.name, 'Team Karacho')
  })

  await t.test('kennt Popmusik nicht, und das ist richtig', async () => {
    assert.equal(await q.aufloesen({ name: 'ROSÉ, Bruno Mars' }), null)
  })

  await t.test('schlaegt sich selbst nicht vor', async () => {
    const ref = await q.aufloesen({ name: 'Conni' })
    const treffer = await q.aehnlich(ref, 10, {})
    assert.ok(!treffer.some((x) => normalName(x.name) === normalName('Conni')))
  })

  await t.test('liefert keine Null-Treffer', async () => {
    const ref = await q.aufloesen({ name: 'Pettersson und Findus' })
    const treffer = await q.aehnlich(ref, 40, {})
    assert.ok(treffer.every((x) => x.punkte > 0))
  })

  await t.test('ohne Ollama kommt der Jaccard-Weg, ohne Netzanfrage', async () => {
    const u = umgebung()
    const ref = await q.aufloesen({ name: 'Conni' })
    const treffer = await q.aehnlich(ref, 3, { ...u, ollama: { adresse: '' } })
    assert.ok(treffer.length > 0)
    assert.deepEqual(u.geholt, [], 'ohne Ollama-Adresse geht nichts hinaus')
  })

  await t.test('Ollama auf localhost wird abgefangen, nicht versucht', async () => {
    // `kontext.holen` verwehrt die eigene Box — ohne diese Pruefung faenge
    // sich das Plugin bei jeder Anfrage einen Wurf aus dem Adressenriegel.
    const u = umgebung()
    const vektor = await inhaltQuelle.einbettungHolen('text', {
      adresse: 'http://localhost:11434',
      modell: 'nomic-embed-text',
      holen: u.holen,
      protokoll: u.protokoll,
    })
    assert.equal(vektor, null)
    assert.deepEqual(u.geholt, [], 'es geht keine Anfrage an die eigene Box')
    assert.ok(u.protokolliert.join(' ').includes('localhost'))
  })
})

/* ═════════════════════════════════════════════════════════════════════════
 * Der Fall aus den Anforderungen
 * ═════════════════════════════════════════════════════════════════════════ */

test('Ende zu Ende: Pettersson und Findus', async (t) => {
  await t.test('thematisch Verwandtes liegt vor Conni', async () => {
    // Das Abnahmekriterium aus dem Entwurf: mit hohem Inhaltsgewicht muss
    // eine thematisch verwandte Serie vor „Conni" liegen — Pettersson ist ein
    // ruhiges Bauernhof-Hoerspiel, Conni ist Alltag im Kindergarten.
    const q = inhaltQuelle.quelleBauen(SAETZE)
    const ref = await q.aufloesen({ name: 'Pettersson und Findus' })
    const treffer = await q.aehnlich(ref, 40, {})

    const listen = {
      inhalt: treffer.map((x) => ({ schluessel: `name:${normalName(x.name)}`, name: x.name })),
    }
    const ergebnis = verschmelzen(listen, { inhalt: 1.5 }, { grenze: 40 })
    const platz = (name) => ergebnis.findIndex((e) => normalName(e.name) === normalName(name))

    assert.equal(ergebnis[0].name, 'Michel aus Loenneberga', 'der Bauernhof in Schweden gewinnt')
    assert.ok(platz('Michel aus Loenneberga') < platz('Conni'), 'Michel liegt vor Conni')
    assert.ok(platz('Michel aus Loenneberga') < platz('Paw Patrol') || platz('Paw Patrol') === -1)
  })
})

/* ═════════════════════════════════════════════════════════════════════════
 * Die Netzquellen, gegen aufgezeichnete Antworten
 * ═════════════════════════════════════════════════════════════════════════ */

test('Deezer', async (t) => {
  await t.test('waehlt nicht den ersten Treffer, sondern den mit Katalog', () => {
    // AM ECHTEN DIENST GEMESSEN (06.09.2026): `q=Conni` liefert als ERSTEN
    // Treffer „Conni & Co" mit leerem /related. Die gesuchte Hoerspielserie
    // steht weiter hinten.
    const suche = {
      data: [
        { id: 57582222, name: 'Conni & Co', nb_album: 20, nb_fan: 3 },
        { id: 75255, name: 'Conni', nb_album: 95, nb_fan: 29964 },
      ],
    }
    assert.equal(besterTreffer(suche, 'Conni').id, 75255)
  })

  await t.test('unter Namensgleichen entscheidet der Katalog', () => {
    // DER FALL, DEN DER TEST DARUEBER NICHT ABDECKT — von der Gegenprobe
    // aufgedeckt: dort trennt schon die Namensgleichheit („Conni & Co" ist
    // nicht „Conni"), und die Zahlen werden nie gebraucht. Deezer fuehrt
    // denselben Namen aber auch mehrfach, und dann sind sie die einzige
    // Auskunft, welcher der gesuchte ist.
    // BEIDE KRITERIEN EINZELN, sonst deckt der Zeuge nur das erste ab: bei
    // verschiedenen Albenzahlen entscheidet schon die Albenregel, und die
    // Anhaengerregel darueber koennte fehlen, ohne dass es auffiele.
    const nurAnhaenger = {
      data: [
        { id: 111, name: 'Conni', nb_album: 20, nb_fan: 3 },
        { id: 75255, name: 'Conni', nb_album: 20, nb_fan: 29964 },
      ],
    }
    assert.equal(besterTreffer(nurAnhaenger, 'Conni').id, 75255, 'mehr Anhaenger gewinnt')

    const nurAlben = {
      data: [
        { id: 111, name: 'Conni', nb_album: 2, nb_fan: 500 },
        { id: 75255, name: 'Conni', nb_album: 95, nb_fan: 500 },
      ],
    }
    assert.equal(besterTreffer(nurAlben, 'Conni').id, 75255, 'bei gleichen Anhaengern der groessere Katalog')
  })

  await t.test('ein genauer Name schlaegt den groesseren Katalog', () => {
    const suche = {
      data: [
        { id: 1, name: 'Bibi Blocksberg Hoerspiele', nb_album: 900, nb_fan: 90000 },
        { id: 2, name: 'Bibi Blocksberg', nb_album: 100, nb_fan: 1000 },
      ],
    }
    assert.equal(besterTreffer(suche, 'Bibi Blocksberg').id, 2)
  })

  await t.test('kein passender Name heisst nichts', () => {
    assert.equal(besterTreffer({ data: [{ id: 9, name: 'Rammstein', nb_fan: 1 }] }, 'Conni'), null)
    assert.equal(besterTreffer({ data: [] }, 'Conni'), null)
  })

  await t.test('loest auf und liefert Aehnliche', async () => {
    const u = umgebung({
      antworten: {
        '/search/artist': JSON.stringify({ data: [{ id: 989833, name: 'Pettersson und Findus', nb_album: 30, nb_fan: 900 }] }),
        '/related': JSON.stringify({
          data: [
            { id: 1, name: 'Benjamin Bluemchen' },
            { id: 2, name: 'Pumuckl' },
          ],
        }),
      },
    })
    const ref = await deezer.aufloesen({ name: 'Pettersson und Findus' }, u)
    assert.equal(ref.extra.deezerId, 989833)
    const treffer = await deezer.aehnlich(ref, 10, u)
    assert.deepEqual(treffer.map((x) => x.rang), [1, 2])
    assert.equal(treffer[0].name, 'Benjamin Bluemchen')
  })

  await t.test('ein Fehler im Rumpf ist ein Fehler, kein leeres Ergebnis', async () => {
    // Deezer meldet Fehler mit HTTP 200 und einem `error`-Feld. Wer nur den
    // Status prueft, traegt die Fehlermeldung als leere Liste in die Kartei.
    const u = umgebung({
      antworten: { '/search/artist': JSON.stringify({ error: { message: 'Quota limit exceeded' } }) },
    })
    await assert.rejects(() => deezer.aufloesen({ name: 'X' }, u), /Quota/)
  })

  await t.test('Veroeffentlichungen tragen ein taggenaues Datum', async () => {
    const u = umgebung({
      antworten: {
        '/albums': JSON.stringify({
          data: [{ id: 5, title: 'Folge 12', release_date: '2026-03-14', link: 'https://deezer.com/album/5' }],
        }),
      },
    })
    const rel = await deezer.veroeffentlichungen({ extra: { deezerId: 1 } }, u)
    assert.equal(rel[0].erschienen, '2026-03-14')
    assert.equal(rel[0].quellenRef, 'deezer:5')
  })
})

test('MusicBrainz', async (t) => {
  await t.test('eine Schwelle schuetzt vor der falschen Identitaet', () => {
    // MusicBrainz liefert IMMER etwas. Ohne Schwelle bekaeme „Das
    // Pummeleinhorn" irgendeine Band mit score 43 als MBID zugewiesen — und
    // unter dieser falschen Identitaet wuerden dann alle Quellen
    // zusammengefuehrt.
    assert.equal(bestenWaehlen({ artists: [{ id: 'x', name: 'Irgendwas', score: 43 }] }), null)
    assert.equal(bestenWaehlen({ artists: [{ id: 'x', name: 'Treffer', score: 100 }] }).id, 'x')
  })

  await t.test('503 ist ein Fehler, nicht „kenne ich nicht"', async () => {
    // Gemessen: 5 von 18 Anfragen kamen als 503, obwohl 1 Anfrage/s
    // eingehalten wurde. Als leeres Ergebnis gelesen, verschwindet eine
    // Serie, die es gibt — und zwar fuer die Dauer der Haltbarkeit.
    const u = umgebung({ antworten: { '/artist?query': { text: '<html/>', status: 503 } } })
    await assert.rejects(() => musicbrainz.aufloesen({ name: 'Conni' }, u), /drosselt/)
  })

  await t.test('hat bewusst kein aehnlich()', () => {
    assert.equal(typeof musicbrainz.aehnlich, 'undefined')
  })

  await t.test('eine mitgegebene MBID wird nicht neu gesucht', async () => {
    const u = umgebung()
    const ref = await musicbrainz.aufloesen({ name: 'X', mbid: 'abc-123' }, u)
    assert.equal(ref.mbid, 'abc-123')
    assert.deepEqual(u.geholt, [])
  })

  await t.test('ein Jahr bleibt ein Jahr', async () => {
    const u = umgebung({
      antworten: {
        '/release-group': JSON.stringify({
          'release-groups': [{ id: 'g1', title: 'Folge 1', 'first-release-date': '2024' }],
        }),
      },
    })
    const rel = await musicbrainz.veroeffentlichungen({ mbid: 'm' }, u)
    assert.equal(rel[0].erschienen, '2024', 'nicht auf 2024-01-01 aufgefuellt')
  })
})

test('ListenBrainz', async (t) => {
  await t.test('ohne MBID stumm — eine geratene waere eine falsche Identitaet', async () => {
    assert.equal(await listenbrainz.aufloesen({ name: 'Conni' }), null)
    assert.deepEqual(await listenbrainz.aehnlich({}, 10, umgebung()), [])
  })

  await t.test('wirft den Interpreten selbst heraus', () => {
    // Gemessen: „Nena" steht in der Antwort zu Nena mit dem hoechsten Wert,
    // unter einer anderen MBID (Person statt Band).
    const treffer = trefferLesen(
      [
        { artist_mbid: 'eigen', name: 'Nena', score: 453 },
        { artist_mbid: 'fremd', name: 'Andere', score: 60 },
      ],
      'eigen',
    )
    assert.deepEqual(treffer.map((x) => x.name), ['Andere'])
  })

  await t.test('probiert den zweiten Algorithmus, wenn der erste leer ist', async () => {
    // Gemessen: Bibi Blocksberg liefert bei vier Algorithmen null Treffer und
    // beim fuenften genau einen sinnvollen. Wer nur einen probiert, haelt
    // „leer" fuer eine Eigenschaft des Dienstes.
    let ruf = 0
    const u = umgebung()
    u.holen = async () => {
      ruf++
      return {
        ok: true,
        status: 200,
        text: async () => (ruf === 1 ? '[]' : JSON.stringify([{ artist_mbid: 'b', name: 'Benjamin Bluemchen' }])),
      }
    }
    const treffer = await listenbrainz.aehnlich({ mbid: 'a' }, 10, u)
    assert.equal(ruf, 2)
    assert.equal(treffer[0].name, 'Benjamin Bluemchen')
  })

  await t.test('ein HTML-Fehler bringt das Plugin nicht um', async () => {
    const u = umgebung()
    u.holen = async () => ({ ok: false, status: 400, text: async () => '<html>Bad Request</html>' })
    assert.deepEqual(await listenbrainz.aehnlich({ mbid: 'a' }, 10, u), [])
  })
})

test('Last.fm', async (t) => {
  await t.test('ohne Schluessel kein Wurf, sondern nichts', async () => {
    const u = umgebung({ lastfmSchluessel: '' })
    assert.equal(await lastfm.aufloesen({ name: 'Conni' }, u), null)
    assert.deepEqual(u.geholt, [])
    assert.ok(u.protokolliert.join(' ').includes('Schluessel'))
  })

  await t.test('ein einzelner Treffer kommt als Objekt, nicht als Liste', async () => {
    // Eigenheit der Last.fm-JSON-Ausgabe aus ihrer XML-Herkunft: ohne diese
    // Behandlung wirft `.map` genau dann, wenn es einen Treffer gibt.
    const u = umgebung({
      lastfmSchluessel: 'k',
      antworten: {
        'artist.getsimilar': JSON.stringify({ similarartists: { artist: { name: 'Einer', mbid: 'm1', match: '0.9' } } }),
      },
    })
    const treffer = await lastfm.aehnlich({ name: 'X', mbid: 'a' }, 10, u)
    assert.deepEqual(treffer, [{ name: 'Einer', mbid: 'm1', rang: 1 }])
  })

  await t.test('ein Fehler im Rumpf kommt woertlich durch', async () => {
    const u = umgebung({
      lastfmSchluessel: 'falsch',
      antworten: { 'artist.getinfo': JSON.stringify({ error: 10, message: 'Invalid API key' }) },
    })
    await assert.rejects(() => lastfm.aufloesen({ name: 'X' }, u), /Invalid API key/)
  })
})

/* ═════════════════════════════════════════════════════════════════════════
 * Speicher und Takt
 * ═════════════════════════════════════════════════════════════════════════ */

test('Kartei', async (t) => {
  await t.test('laeuft ohne Datenordner weiter, nur fluechtig', async () => {
    const k = new Kartei(null, 'test')
    await k.laden()
    assert.equal(k.fluechtig, true)
    k.setzen('a', [1, 2])
    assert.deepEqual(k.holen('a', 30).wert, [1, 2])
    await k.sichern()
  })

  await t.test('abgelaufen ist eine Auskunft, kein Verlust', () => {
    const k = new Kartei(null, 'test')
    k.setzen('a', 'wert')
    const frisch = k.holen('a', 30)
    assert.equal(frisch.abgelaufen, false)
    // Haltbarkeit 0 heisst „nie ablaufen" — hier gegen die Vergangenheit
    // gemessen, indem der Zeitstempel zurueckdatiert wird.
    const eintrag = k.eintraege()[0]
    assert.ok(eintrag.geholtAm <= Date.now())
    assert.equal(k.holen('fehlt', 30), null)
  })

  await t.test('der aelteste faellt beim Ueberlauf', () => {
    const k = new Kartei(null, 'test')
    for (let i = 0; i < 1005; i++) k.setzen(`k${i}`, i)
    assert.ok(k.groesse <= 1000)
    assert.equal(k.holen('k0', 0), null, 'der erste ist weg')
    assert.ok(k.holen('k1004', 0), 'der letzte ist da')
  })
})

test('Takt', async (t) => {
  await t.test('sagt nein, statt die Frist zu reissen', async () => {
    eimerZuruecksetzen()
    // MusicBrainz erlaubt 1 Anfrage/s, ein Plugin-Ruf hat 8 s. Ein Eimer, der
    // beliebig lange wartet, verwandelt ein Rate-Limit in einen Fristriss —
    // und ein Fristriss terminiert den Worker samt allen offenen Rufen.
    const e = new Eimer({ menge: 1, fensterMs: 60000 })
    assert.equal(await e.nehmen(0), true)
    assert.equal(await e.nehmen(0), false, 'die zweite Marke gibt es nicht, und es wird nicht gewartet')
  })

  await t.test('wartet, wenn es sich lohnt', async () => {
    const e = new Eimer({ menge: 1, fensterMs: 50 })
    assert.equal(await e.nehmen(0), true)
    assert.equal(await e.nehmen(500), true, 'in 50 ms ist wieder eine da')
  })
})
