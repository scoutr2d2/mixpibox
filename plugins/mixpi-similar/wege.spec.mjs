/**
 * Zeugen fuer die VERDRAHTUNG — der ganze Weg durch `http()`, mit echtem
 * Wirt, echtem Quellen-Scan, echten Karteien auf der Platte, und einem
 * gefaelschten Netz.
 *
 * ══ WARUM DAS EINE EIGENE DATEI IST ═══════════════════════════════════════
 *
 * `index.spec.mjs` prueft die Bausteine, `wachliste.spec.mjs` die reine
 * Logik. Beide waren gruen, als die Wachliste noch von NICHTS aufgerufen
 * wurde — sie fassten die Verdrahtung nicht an und konnten das gar nicht
 * merken. Genau diese Luecke schliesst diese Datei: sie ruft `plugin.http()`
 * so, wie der Wirt es tut.
 *
 * Gefaelscht wird nur, was hinausginge: `kontext.holen`. Alles andere ist
 * echt — auch der Verzeichnis-Scan, der die vier Quellen und die zwei Kanaele
 * wirklich laedt.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import plugin, { weltVergessen } from './index.mjs'

const ordner = []

/**
 * Ein Kontext, wie ihn das Laufwerk baut — mit echtem Datenordner auf der
 * Platte, damit die Karteien wirklich schreiben und wirklich wieder gelesen
 * werden.
 */
async function kontextBauen({ antworten = {}, einstellungen = {} } = {}) {
  const datenOrdner = await mkdtemp(join(tmpdir(), 'mixpi-similar-zeuge-'))
  ordner.push(datenOrdner)
  const geholt = []
  const protokolliert = []

  return {
    datenOrdner,
    geholt,
    protokolliert,
    einstellungen: Object.freeze({
      // Im Zeugen zaehlt nur die Themenkarte, sofern nichts anderes dasteht:
      // die Netzquellen wuerden sonst bei jedem Test die Attrappe befragen
      // und die Erwartungen von der Reihenfolge der Quellen abhaengig machen.
      gewichtDeezer: 0,
      gewichtLastfm: 0,
      gewichtListenbrainz: 0,
      ...einstellungen,
    }),
    protokoll: (t) => protokolliert.push(t),
    holen: async (adresse, gaben) => {
      geholt.push(adresse)
      const treffer = Object.entries(antworten).find(([muster]) => adresse.includes(muster))
      if (!treffer) throw new Error(`Zeuge kennt die Adresse nicht: ${adresse}`)
      const wert = treffer[1]
      const { text = '', status = 200 } = typeof wert === 'string' ? { text: wert } : wert
      return { ok: status >= 200 && status < 300, status, text: async () => text, gaben }
    },
  }
}

/** Ein Ruf, wie der Wirt ihn stellt. */
const ruf = (pfad, { methode = 'GET', abfrage = {}, rumpf = {} } = {}) => ({ methode, pfad, abfrage, rumpf })

after(async () => {
  weltVergessen()
  for (const o of ordner) await rm(o, { recursive: true, force: true })
})

test('Die Wege antworten', async (t) => {
  weltVergessen()
  const kontext = await kontextBauen()

  await t.test('unbekannter Weg nennt die bekannten', async () => {
    const antwort = await plugin.http(ruf('gibtesnicht'), kontext)
    assert.equal(antwort.status, 404)
    assert.ok(antwort.inhalt.wege.length > 5)
  })

  await t.test('/quellen weist den Resolver als eigene Rolle aus', async () => {
    const { inhalt } = await plugin.http(ruf('quellen'), kontext)
    const mb = inhalt.quellen.find((q) => q.id === 'musicbrainz')
    // Ohne diese Unterscheidung saehe der Resolver wie eine abgeschaltete
    // Empfehlungsquelle aus, und jemand drehte an einem Regler, den es nicht
    // gibt.
    assert.equal(mb.rolle, 'identitaet')
    assert.equal(mb.an, true)
    assert.equal(mb.gewicht, null)
    assert.ok(inhalt.quellen.some((q) => q.id === 'inhalt' && q.rolle === 'aehnlichkeit'))
  })

  await t.test('/aehnlich ohne Namen ist ein Fehler, keine leere Liste', async () => {
    const antwort = await plugin.http(ruf('aehnlich'), kontext)
    assert.equal(antwort.status, 400)
  })

  await t.test('/aehnlich liefert aus der Themenkarte, ohne ins Netz zu gehen', async () => {
    const vorher = kontext.geholt.length
    const { inhalt } = await plugin.http(ruf('aehnlich', { abfrage: { name: 'Pettersson und Findus' } }), kontext)
    assert.ok(inhalt.ergebnis.length > 0)
    assert.equal(inhalt.ergebnis[0].name, 'Michel aus Loenneberga')
    assert.deepEqual(inhalt.meta.benutzt, ['inhalt'])
    assert.equal(kontext.geholt.length, vorher, 'mit Gewicht 0 fragt keine Netzquelle')
  })

  await t.test('/roh zeigt die Treffer je Quelle vor der Fusion', async () => {
    const { inhalt } = await plugin.http(ruf('roh', { abfrage: { name: 'Conni' } }), kontext)
    assert.ok(Array.isArray(inhalt.jeQuelle.inhalt))
    assert.ok(inhalt.jeQuelle.inhalt.length > 0)
  })

  await t.test('POST-Wege lehnen GET ab', async () => {
    for (const pfad of ['inhalt', 'kartei-leeren', 'wachliste/eintragen', 'wachliste/pruefen', 'nachrichten/gelesen']) {
      const antwort = await plugin.http(ruf(pfad), kontext)
      assert.equal(antwort.status, 405, `${pfad} nimmt GET an`)
    }
  })
})

test('Die Themenkarte laesst sich ergaenzen', async (t) => {
  weltVergessen()
  const kontext = await kontextBauen()

  await t.test('ein Satz ohne Inhalt wird abgewiesen', async () => {
    // Er stuende sonst in der Karte, faende nie jemanden und verdeckte den
    // mitgelieferten Eintrag desselben Namens — ein stiller Rueckschritt.
    const antwort = await plugin.http(ruf('inhalt', { methode: 'POST', rumpf: { name: 'Leer' } }), kontext)
    assert.equal(antwort.status, 400)
  })

  await t.test('ein eigener Satz wirkt sofort und ueberlebt den Neustart', async () => {
    const gespeichert = await plugin.http(
      ruf('inhalt', {
        methode: 'POST',
        rumpf: { name: 'Testserie Bauernhof', tags: ['bauernhof', 'tiere', 'ruhig', 'katze'], beschreibung: 'Ein Hof.' },
      }),
      kontext,
    )
    assert.equal(gespeichert.inhalt.gespeichert.name, 'Testserie Bauernhof')

    const gefragt = await plugin.http(ruf('aehnlich', { abfrage: { name: 'Pettersson und Findus' } }), kontext)
    assert.ok(
      gefragt.inhalt.ergebnis.some((e) => e.name === 'Testserie Bauernhof'),
      'der eigene Satz taucht nicht auf',
    )

    // NEUSTART: derselbe Datenordner, frischer Modulzustand. Das ist der
    // Fall, den die Kartei tragen muss — ein Plugin wird bei jeder
    // Einstellungsaenderung neu gestartet.
    weltVergessen()
    const nachher = await plugin.http(ruf('aehnlich', { abfrage: { name: 'Pettersson und Findus' } }), kontext)
    assert.ok(
      nachher.inhalt.ergebnis.some((e) => e.name === 'Testserie Bauernhof'),
      'nach dem Neustart ist der eigene Satz weg',
    )
  })
})

/* ═════════════════════════════════════════════════════════════════════════
 * Die Wachliste — Abnahmekriterien 6 bis 8 des Entwurfs
 * ═════════════════════════════════════════════════════════════════════════ */

/** Deezer-Antworten fuer einen Interpreten mit genau einem Album. */
function deezerMitAlben(alben) {
  return {
    '/search/artist': JSON.stringify({ data: [{ id: 42, name: 'Pettersson und Findus', nb_album: 30, nb_fan: 900 }] }),
    '/albums': JSON.stringify({ data: alben }),
    '/related': JSON.stringify({ data: [] }),
    // Der Resolver fragt MusicBrainz zuerst; hier soll er nichts finden,
    // damit der Zeuge nur ueber Deezer laeuft.
    'musicbrainz.org': JSON.stringify({ artists: [] }),
  }
}

test('Wachliste: eintragen, pruefen, melden', async (t) => {
  weltVergessen()

  const kontext = await kontextBauen({
    einstellungen: { gewichtDeezer: 1 },
    antworten: deezerMitAlben([
      { id: 1, title: 'Folge 1', release_date: '2019-01-01', link: 'https://deezer.com/album/1' },
      { id: 2, title: 'Folge 2', release_date: '2020-01-01', link: 'https://deezer.com/album/2' },
    ]),
  })

  await t.test('eintragen legt eine Grundlinie an', async () => {
    const { inhalt } = await plugin.http(
      ruf('wachliste/eintragen', { methode: 'POST', rumpf: { name: 'Pettersson und Findus' } }),
      kontext,
    )
    assert.equal(inhalt.eingetragen, 'Pettersson und Findus')
    assert.equal(inhalt.grundlinie, 2, 'beide vorhandenen Alben gelten als bekannt')
  })

  await t.test('derselbe Name zweimal ist ein Konflikt', async () => {
    const antwort = await plugin.http(
      ruf('wachliste/eintragen', { methode: 'POST', rumpf: { name: 'Pettersson und Findus' } }),
      kontext,
    )
    assert.equal(antwort.status, 409)
  })

  await t.test('ohne Neuerscheinung meldet der Lauf nichts', async () => {
    // Das ist der wichtigste Fall ueberhaupt: ohne Grundlinie stuenden hier
    // zwei „Neuerscheinungen" aus dem Altbestand.
    const { inhalt } = await plugin.http(ruf('wachliste/pruefen', { methode: 'POST' }), kontext)
    assert.equal(inhalt.geprueft, 'Pettersson und Findus')
    assert.equal(inhalt.neu, 0)

    const nachrichten = await plugin.http(ruf('nachrichten'), kontext)
    assert.equal(nachrichten.inhalt.gesamt, 0)
  })
})

test('Wachliste: eine echte Neuerscheinung (Abnahmekriterium 6)', async (t) => {
  weltVergessen()

  const alt = [{ id: 1, title: 'Folge 1', release_date: '2019-01-01' }]
  const kontext = await kontextBauen({
    einstellungen: { gewichtDeezer: 1 },
    antworten: deezerMitAlben(alt),
  })

  await plugin.http(ruf('wachliste/eintragen', { methode: 'POST', rumpf: { name: 'Pettersson und Findus' } }), kontext)

  // JETZT ERSCHEINT ETWAS NEUES. Der Zeuge tauscht die Antwort des Dienstes
  // aus, statt die Uhr zu stellen — die Grundlinie steht auf „jetzt", also
  // muss die neue Folge in der Zukunft liegen.
  const spaeter = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const kontext2 = await kontextBauen({
    einstellungen: { gewichtDeezer: 1 },
    antworten: deezerMitAlben([...alt, { id: 9, title: 'Folge 2', release_date: spaeter }]),
  })
  // Derselbe Datenordner — sonst waere die Wachliste im zweiten Kontext leer.
  kontext2.datenOrdner = kontext.datenOrdner
  weltVergessen()

  await t.test('genau EIN Ereignis', async () => {
    const { inhalt } = await plugin.http(ruf('wachliste/pruefen', { methode: 'POST' }), kontext2)
    assert.equal(inhalt.neu, 1)

    const { inhalt: nachrichten } = await plugin.http(ruf('nachrichten'), kontext2)
    assert.equal(nachrichten.gesamt, 1)
    assert.equal(nachrichten.nachrichten[0].art, 'veroeffentlichung')
    assert.equal(nachrichten.nachrichten[0].nutzlast.titel, 'Folge 2')
  })

  await t.test('und kein zweites beim naechsten Lauf', async () => {
    const { inhalt } = await plugin.http(ruf('wachliste/pruefen', { methode: 'POST' }), kontext2)
    assert.equal(inhalt.neu, 0)
    const { inhalt: nachrichten } = await plugin.http(ruf('nachrichten'), kontext2)
    assert.equal(nachrichten.gesamt, 1, 'dieselbe Folge wurde zweimal gemeldet')
  })

  await t.test('gelesen markieren zaehlt herunter', async () => {
    const { inhalt: vorher } = await plugin.http(ruf('nachrichten', { abfrage: { ungelesen: 'true' } }), kontext2)
    assert.equal(vorher.gesamt, 1)

    const nr = vorher.nachrichten[0].nr
    await plugin.http(ruf('nachrichten/gelesen', { methode: 'POST', rumpf: { nr } }), kontext2)

    const { inhalt: nachher } = await plugin.http(ruf('nachrichten', { abfrage: { ungelesen: 'true' } }), kontext2)
    assert.equal(nachher.gesamt, 0)
    assert.equal(nachher.ungelesen, 0)
  })

  await t.test('eine unbekannte Nummer ist ein 404', async () => {
    const antwort = await plugin.http(ruf('nachrichten/gelesen', { methode: 'POST', rumpf: { nr: 'gibtesnicht' } }), kontext2)
    assert.equal(antwort.status, 404)
  })
})

test('Wachliste: ohne Grundlinie wird nicht eingetragen', async (t) => {
  weltVergessen()
  const kontext = await kontextBauen({
    einstellungen: { gewichtDeezer: 1 },
    antworten: {
      '/search/artist': JSON.stringify({ data: [] }),
      'musicbrainz.org': JSON.stringify({ artists: [] }),
    },
  })

  await t.test('lieber gar nicht anlegen und es sagen', async () => {
    // Ein Eintrag mit leerer Grundlinie sieht aus wie ein normaler und meldet
    // beim naechsten Lauf alles, was der Interpret je veroeffentlicht hat.
    const antwort = await plugin.http(
      ruf('wachliste/eintragen', { methode: 'POST', rumpf: { name: 'Unbekannte Serie' } }),
      kontext,
    )
    assert.equal(antwort.status, 502)
    assert.match(antwort.inhalt.fehler, /Altbestand/)

    const { inhalt } = await plugin.http(ruf('wachliste'), kontext)
    assert.equal(inhalt.eintraege.length, 0)
  })
})

test('Der Posteingang traegt auch ohne Kanaele (Abnahmekriterium 8)', async (t) => {
  weltVergessen()

  const spaeter = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const kontext = await kontextBauen({
    einstellungen: {
      gewichtDeezer: 1,
      // ntfy zeigt auf einen Wirt, den die Attrappe nicht kennt — der Ruf
      // wirft also, genau wie ein toter Dienst.
      ntfyAdresse: 'https://ntfy.example',
      ntfyThema: 'meinthema',
    },
    antworten: deezerMitAlben([{ id: 1, title: 'Folge 1', release_date: '2019-01-01' }]),
  })

  await plugin.http(ruf('wachliste/eintragen', { methode: 'POST', rumpf: { name: 'Pettersson und Findus' } }), kontext)

  const kontext2 = await kontextBauen({
    einstellungen: { gewichtDeezer: 1, ntfyAdresse: 'https://ntfy.example', ntfyThema: 'meinthema' },
    antworten: deezerMitAlben([
      { id: 1, title: 'Folge 1', release_date: '2019-01-01' },
      { id: 9, title: 'Folge 2', release_date: spaeter },
    ]),
  })
  kontext2.datenOrdner = kontext.datenOrdner
  weltVergessen()

  await t.test('ntfy faellt aus, die Meldung liegt trotzdem', async () => {
    const { inhalt } = await plugin.http(ruf('wachliste/pruefen', { methode: 'POST' }), kontext2)
    assert.equal(inhalt.neu, 1)

    const { inhalt: nachrichten } = await plugin.http(ruf('nachrichten'), kontext2)
    assert.equal(nachrichten.gesamt, 1, 'ein toter Kanal hat die Meldung verschluckt')

    assert.ok(
      kontext2.protokolliert.some((z) => z.includes('ntfy')),
      'der Ausfall wurde nicht einmal ins Journal geschrieben',
    )
  })
})

test('Wachliste: entfernen und Bestandsvorschlag', async (t) => {
  weltVergessen()
  const kontext = await kontextBauen({
    einstellungen: { gewichtDeezer: 1 },
    antworten: deezerMitAlben([{ id: 1, title: 'Folge 1', release_date: '2019-01-01' }]),
  })

  await t.test('entfernen nimmt den Eintrag weg', async () => {
    await plugin.http(ruf('wachliste/eintragen', { methode: 'POST', rumpf: { name: 'Pettersson und Findus' } }), kontext)
    const { inhalt } = await plugin.http(
      ruf('wachliste/entfernen', { methode: 'POST', rumpf: { name: 'Pettersson und Findus' } }),
      kontext,
    )
    assert.equal(inhalt.entfernt, 'Pettersson und Findus')

    const { inhalt: liste } = await plugin.http(ruf('wachliste'), kontext)
    assert.equal(liste.eintraege.length, 0)
  })

  await t.test('aus-bestand schlaegt vor, statt einzutragen', async () => {
    // Jeder neue Eintrag kostet Anfragen an fremde Dienste; bei zwanzig Namen
    // und MusicBrainz' einer Anfrage pro Sekunde ist das kein Vorgang fuer
    // einen 8-Sekunden-Ruf.
    const antwort = await plugin.http(ruf('wachliste/aus-bestand', { methode: 'POST' }), kontext)
    // Im Zeugen gibt es keine `data.json` zwei Ebenen ueber dem Datenordner —
    // die Antwort muss das SAGEN, nicht still eine leere Liste liefern.
    assert.equal(antwort.status, 502)
    assert.match(antwort.inhalt.fehler, /Bestand nicht lesbar/)
  })
})
