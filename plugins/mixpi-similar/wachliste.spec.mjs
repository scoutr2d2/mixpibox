/**
 * Zeugen fuer die Wachliste — ohne Box, ohne Netz, ohne Uhr.
 *
 * Die Logik in `wachliste.mjs` ist bewusst rein, damit genau das geht: die
 * Entscheidung „ist das eine Neuigkeit?" ist die einzige Stelle, an der ein
 * Fehler jemanden nachts weckt oder eine echte Folge verschluckt.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import ntfy from './kanaele/ntfy.mjs'
import webhook from './kanaele/webhook.mjs'
import {
  grundlinieBauen,
  imFenster,
  istNachGrundlinie,
  jahrVon,
  naechsterDran,
  namenAusBestand,
  neuigkeitenFinden,
  veroeffentlichungsSchluessel,
} from './wachliste.mjs'

const HIER = dirname(fileURLToPath(import.meta.url))

/** Ein Zeitpunkt, gegen den gemessen wird — keine echte Uhr im Zeugen. */
const GRUNDLINIE = '2026-01-01T00:00:00.000Z'

test('Veroeffentlichungs-Schluessel', async (t) => {
  await t.test('die Release-Group-MBID schlaegt alles', () => {
    const a = { titel: 'Folge 12', erschienen: '2026-03-14', gruppeMbid: 'rg-1' }
    const b = { titel: 'Folge 12 (Remaster)', erschienen: '2026', gruppeMbid: 'rg-1' }
    assert.equal(veroeffentlichungsSchluessel(a), veroeffentlichungsSchluessel(b))
  })

  await t.test('ohne MBID entscheiden Titel und JAHR, nicht das Datum', () => {
    // DER FALL, UM DEN ES GEHT: MusicBrainz fuehrt bei Hoerspielen oft nur
    // „2026", Deezer immer „2026-03-14". Auf das Datum verglichen waeren das
    // zwei Werke, und der Nutzer bekaeme dieselbe Folge zweimal gemeldet.
    const mb = { titel: 'Folge 12', erschienen: '2026' }
    const dz = { titel: 'Folge 12', erschienen: '2026-03-14' }
    assert.equal(veroeffentlichungsSchluessel(mb), veroeffentlichungsSchluessel(dz))
  })

  await t.test('dasselbe Werk in zwei Jahren sind zwei Meldungen', () => {
    const alt = { titel: 'Folge 12', erschienen: '2024-05-01' }
    const neu = { titel: 'Folge 12', erschienen: '2026-05-01' }
    assert.notEqual(veroeffentlichungsSchluessel(alt), veroeffentlichungsSchluessel(neu))
  })

  await t.test('Umlautschreibweisen fallen zusammen', () => {
    assert.equal(
      veroeffentlichungsSchluessel({ titel: 'Das Hörspiel', erschienen: '2026' }),
      veroeffentlichungsSchluessel({ titel: 'Das Hoerspiel', erschienen: '2026' }),
    )
  })

  await t.test('jahrVon nimmt beide Formen', () => {
    assert.equal(jahrVon('2026'), 2026)
    assert.equal(jahrVon('2026-03-14'), 2026)
    assert.equal(jahrVon(''), null)
    assert.equal(jahrVon(null), null)
  })
})

test('Grundlinie', async (t) => {
  await t.test('nur was NACH dem Eintragen kommt, ist neu', () => {
    assert.equal(istNachGrundlinie({ erschienen: '2026-06-01' }, GRUNDLINIE), true)
    assert.equal(istNachGrundlinie({ erschienen: '2025-06-01' }, GRUNDLINIE), false)
  })

  await t.test('ein blosses Jahr zaehlt nur, wenn es ECHT spaeter ist', () => {
    // Im Jahr der Grundlinie waere es geraten — und geraten heisst hier
    // „meldet den Altbestand". Der Fehler in die andere Richtung verzoegert
    // eine Meldung um eine Runde; die beiden sind nicht gleich teuer.
    assert.equal(istNachGrundlinie({ erschienen: '2026' }, GRUNDLINIE), false)
    assert.equal(istNachGrundlinie({ erschienen: '2027' }, GRUNDLINIE), true)
    assert.equal(istNachGrundlinie({ erschienen: '2025' }, GRUNDLINIE), false)
  })

  await t.test('ohne Datum ist nichts neu', () => {
    assert.equal(istNachGrundlinie({ erschienen: '' }, GRUNDLINIE), false)
    assert.equal(istNachGrundlinie({}, GRUNDLINIE), false)
  })

  await t.test('grundlinieBauen nimmt alles, was JETZT da ist', () => {
    const jetzt = [
      { titel: 'Folge 1', erschienen: '2020' },
      { titel: 'Folge 2', erschienen: '2021' },
      { titel: '', erschienen: '2022' },
    ]
    assert.equal(grundlinieBauen(jetzt).length, 2, 'ohne Titel zaehlt nicht')
  })
})

test('Neuigkeiten finden', async (t) => {
  await t.test('der Altbestand wird NICHT gemeldet', () => {
    // Das ist der teuerste Fehler dieses ganzen Bereichs: eine Wachliste mit
    // zwanzig Serien meldet ohne Grundlinie mehrere hundert
    // „Neuerscheinungen", und der Nutzer schaltet ab, bevor je etwas
    // Nuetzliches kam.
    const alles = [
      { titel: 'Folge 1', erschienen: '2019-01-01' },
      { titel: 'Folge 2', erschienen: '2020-01-01' },
    ]
    const grundlinie = grundlinieBauen(alles)
    const { neu } = neuigkeitenFinden(alles, grundlinie, GRUNDLINIE)
    assert.deepEqual(neu, [])
  })

  await t.test('ein Werk aus zwei Quellen wird EINMAL gemeldet', () => {
    // Abnahmekriterium 7 des Entwurfs.
    const beide = [
      { titel: 'Folge 12', erschienen: '2026', gruppeMbid: 'rg-9', quelle: 'musicbrainz' },
      { titel: 'Folge 12', erschienen: '2026-06-14', gruppeMbid: 'rg-9', quelle: 'deezer' },
    ]
    const { neu } = neuigkeitenFinden(beide, [], GRUNDLINIE)
    assert.equal(neu.length, 1)
    assert.equal(neu[0].erschienen, '2026-06-14', 'die genauere Datumsangabe gewinnt')
  })

  await t.test('kein zweites Mal beim naechsten Lauf', () => {
    // Abnahmekriterium 6: „kein zweites bei erneutem Check".
    const liste = [{ titel: 'Folge 13', erschienen: '2026-06-01' }]
    const ersterLauf = neuigkeitenFinden(liste, [], GRUNDLINIE)
    assert.equal(ersterLauf.neu.length, 1)
    const zweiterLauf = neuigkeitenFinden(liste, ersterLauf.bekannt, GRUNDLINIE)
    assert.equal(zweiterLauf.neu.length, 0)
  })

  await t.test('auch Altes wird als bekannt vermerkt', () => {
    // Sonst wird es bei jedem Durchlauf erneut geprueft — und ein
    // Datumsformat, das sich beim Dienst einmal aendert, liesse den ganzen
    // Altbestand auf einen Schlag als „neu" durchgehen.
    const alt = [{ titel: 'Folge 1', erschienen: '2019-01-01' }]
    const { neu, bekannt } = neuigkeitenFinden(alt, [], GRUNDLINIE)
    assert.equal(neu.length, 0)
    assert.equal(bekannt.length, 1)
  })

  await t.test('das Neueste steht oben', () => {
    const liste = [
      { titel: 'A', erschienen: '2026-02-01' },
      { titel: 'B', erschienen: '2026-08-01' },
    ]
    const { neu } = neuigkeitenFinden(liste, [], GRUNDLINIE)
    assert.deepEqual(neu.map((n) => n.titel), ['B', 'A'])
  })

  await t.test('ohne Titel faellt es heraus', () => {
    const { neu } = neuigkeitenFinden([{ erschienen: '2026-06-01' }], [], GRUNDLINIE)
    assert.deepEqual(neu, [])
  })
})

test('Zeitfenster', async (t) => {
  const um = (h, m = 0) => new Date(2026, 8, 6, h, m)

  await t.test('das gewoehnliche Fenster', () => {
    assert.equal(imFenster(um(3), '02:00', '05:00'), true)
    assert.equal(imFenster(um(12), '02:00', '05:00'), false)
    assert.equal(imFenster(um(2), '02:00', '05:00'), true, 'die Untergrenze zaehlt mit')
    assert.equal(imFenster(um(5), '02:00', '05:00'), false, 'die Obergrenze nicht')
  })

  await t.test('UEBER MITTERNACHT muss gehen', () => {
    // Der stille Killer: bei „22:00 bis 06:00" ist von groesser als bis, und
    // ein naiver Vergleich liefert IMMER falsch — die Wachliste liefe nie,
    // ohne eine einzige Zeile im Journal.
    assert.equal(imFenster(um(23), '22:00', '06:00'), true)
    assert.equal(imFenster(um(2), '22:00', '06:00'), true)
    assert.equal(imFenster(um(12), '22:00', '06:00'), false)
    assert.equal(imFenster(um(21, 59), '22:00', '06:00'), false)
  })

  await t.test('ein krummes Fenster legt nichts still', () => {
    // Der harmlosere Fehler: ungebremst laufen statt gar nicht.
    assert.equal(imFenster(um(12), 'abc', '05:00'), true)
    assert.equal(imFenster(um(12), '', ''), true)
    assert.equal(imFenster(um(12), '25:00', '05:00'), true)
    assert.equal(imFenster(um(12), '03:00', '03:00'), true, 'gleiche Zeiten heissen kein Fenster')
  })
})

test('Wer ist als naechster dran', async (t) => {
  await t.test('noch nie geprueft schlaegt alles', () => {
    const eintraege = [
      { name: 'A', zuletztGeprueft: 1000 },
      { name: 'B' },
      { name: 'C', zuletztGeprueft: 500 },
    ]
    assert.equal(naechsterDran(eintraege).name, 'B')
  })

  await t.test('sonst der aelteste', () => {
    // Ohne diese Regel prueft ein Lauf bei knapper Zeit ewig dieselben ersten
    // Eintraege und erreicht die hinteren nie.
    const eintraege = [
      { name: 'A', zuletztGeprueft: 1000 },
      { name: 'C', zuletztGeprueft: 500 },
    ]
    assert.equal(naechsterDran(eintraege).name, 'C')
  })

  await t.test('eine leere Liste ist kein Fehler', () => {
    assert.equal(naechsterDran([]), null)
    assert.equal(naechsterDran(null), null)
  })
})

test('Namen aus dem Bestand', async (t) => {
  await t.test('zerlegt das Mehrfachfeld', async () => {
    // AM ECHTEN BESTAND GEMESSEN (Box .62, 06.09.2026): „Ruby van der Bogen,
    // 101 fabelhafte Freunde" ist mit 9 Eintraegen der groesste Posten. Wer
    // das Feld als einen Namen in die Wachliste legt, beobachtet einen
    // Interpreten, den kein Dienst kennt.
    const namen = namenAusBestand([
      { artist: 'Ruby van der Bogen, 101 fabelhafte Freunde' },
      { artist: 'Team Karacho, ANOTHER NGUYEN' },
      { artist: 'Team Karacho, Rola' },
    ])
    const liste = namen.map((n) => n.name)
    assert.ok(liste.includes('Ruby van der Bogen'))
    assert.ok(liste.includes('101 fabelhafte Freunde'))
    assert.ok(liste.includes('Team Karacho'))
  })

  await t.test('zaehlt zusammen, was derselbe Name ist', () => {
    const namen = namenAusBestand([
      { artist: 'Team Karacho, Rola' },
      { artist: 'Team Karacho, ANOTHER NGUYEN' },
      { artist: 'Team Karacho' },
    ])
    assert.equal(namen[0].name, 'Team Karacho')
    assert.equal(namen[0].anzahl, 3, 'der haeufigste steht oben')
  })

  await t.test('wirft zu kurze Stuecke weg', () => {
    // „Die Maus, Eva mit Gitarre, Der Elefant" zerfaellt sonst in Teile wie
    // „der", und ein Zweibuchstabe trifft irgendwann irgendetwas.
    const namen = namenAusBestand([{ artist: 'Die Maus, Eva mit Gitarre, Der Elefant' }])
    assert.ok(namen.every((n) => n.name.length >= 4))
  })

  await t.test('leere Felder sind kein Eintrag', () => {
    assert.deepEqual(namenAusBestand([{ artist: '' }, {}, { artist: '   ' }]), [])
  })

  await t.test('gegen den echten Bestand', async () => {
    // AUFGEZEICHNET AM 06.09.2026 von der echten Box (GET /api/data), auf das
    // Feld `artist` eingedampft: alles andere — Titel, Kennungen, Adressen —
    // gehoert dem Betreiber und wird fuer diesen Zeugen nicht gebraucht.
    //
    // Ein Zeuge gegen ausgedachte Daten haette die Mehrfachfelder nie
    // gesehen; sie sind der Grund, warum es `namenAusBestand` gibt.
    const bestand = JSON.parse(await readFile(join(HIER, 'fixtures', 'bestand-artists.json'), 'utf8'))
    const namen = namenAusBestand(bestand)

    assert.ok(namen.some((n) => n.name === '101 fabelhafte Freunde'), 'der Teil hinter dem Komma fehlt')
    assert.ok(namen.some((n) => n.name === 'Ruby van der Bogen'), 'der Teil vor dem Komma fehlt')
    assert.ok(namen.some((n) => n.name === 'Team Karacho'))

    // JEDER NAME MUSS EIN NAME SEIN, kein Bruchstueck. Das faengt die
    // Zerlegung ab, wenn jemand das Trennmuster erweitert.
    assert.ok(
      namen.every((n) => n.name.length >= 4 && !n.name.startsWith(',')),
      `Bruchstueck in ${JSON.stringify(namen.map((n) => n.name))}`,
    )
  })
})

test('Kanaele', async (t) => {
  const umgebung = (einstellungen, holen) => ({
    einstellungen,
    holen,
    nutzerKennung: 'test/0',
    protokoll: () => {},
  })
  const ereignis = {
    art: 'veroeffentlichung',
    interpret: 'Benjamin Blümchen',
    nutzlast: { titel: 'Folge 13', erschienen: '2026-06-01' },
    erzeugtAm: '2026-06-02T00:00:00.000Z',
  }

  await t.test('ntfy: nicht eingerichtet ist kein Fehler', async () => {
    const { ok, text } = await ntfy.senden(ereignis, umgebung({}))
    assert.equal(ok, false)
    assert.equal(text, 'nicht eingerichtet')
  })

  await t.test('ntfy: eine halbe Einrichtung sagt, was fehlt', async () => {
    assert.match((await ntfy.senden(ereignis, umgebung({ ntfyThema: 'abc' }))).text, /keine Adresse/)
    assert.match((await ntfy.senden(ereignis, umgebung({ ntfyAdresse: 'https://ntfy.sh' }))).text, /kein Thema/)
  })

  await t.test('ntfy: der Titel-Kopf traegt keine Umlaute', async () => {
    // Kopfzeilen sind latin-1; ein „ü" kaeme als Fragezeichen an oder wuerfe
    // beim Senden.
    let gesehen = null
    const holen = async (adresse, gaben) => {
      gesehen = { adresse, gaben }
      return { ok: true, status: 200, text: async () => '' }
    }
    const { ok } = await ntfy.senden(
      ereignis,
      umgebung({ ntfyAdresse: 'https://ntfy.sh', ntfyThema: 'meinthema' }, holen),
    )
    assert.equal(ok, true)
    assert.equal(gesehen.adresse, 'https://ntfy.sh/meinthema')
    assert.equal(gesehen.gaben.headers.Title, 'Neu von Benjamin Blumchen')
    assert.match(gesehen.gaben.body, /Folge 13/)
  })

  await t.test('ntfy: ein Fehler wird gemeldet, nicht geworfen', async () => {
    const holen = async () => {
      throw new Error('Netz weg')
    }
    const { ok, text } = await ntfy.senden(
      ereignis,
      umgebung({ ntfyAdresse: 'https://ntfy.sh', ntfyThema: 't' }, holen),
    )
    assert.equal(ok, false)
    assert.match(text, /Netz weg/)
  })

  await t.test('webhook: die eigene Box wird abgefangen', async () => {
    // `kontext.holen` verwehrt sie ohnehin — hier steht die Pruefung, damit
    // der Betreiber liest, was er falsch eingetragen hat, statt eine Meldung
    // ueber einen Zaun zu sehen.
    const zustand = webhook.bereit({ webhookAdresse: 'http://localhost:1880/mupibox' })
    assert.equal(zustand.ok, false)
    assert.match(zustand.grund, /eigene Box/)
  })

  await t.test('webhook: schickt das Ereignis woertlich', async () => {
    let gesehen = null
    const holen = async (adresse, gaben) => {
      gesehen = { adresse, gaben }
      return { ok: true, status: 200, text: async () => '' }
    }
    const { ok } = await webhook.senden(ereignis, umgebung({ webhookAdresse: 'https://haus.example/hook' }, holen))
    assert.equal(ok, true)
    assert.deepEqual(JSON.parse(gesehen.gaben.body), ereignis)
  })
})
