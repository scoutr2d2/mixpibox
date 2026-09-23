/**
 * Tests der Listen-Ablage (E66/E73).
 *
 * DREI FAELLE TRAGEN DIESEN TEST, und der Normalfall ist keiner davon:
 *
 *   1. DIE DATEI IST DA, ABER NICHT LESBAR. Wer daraufhin eine leere Liste
 *      darueberschreibt, loescht den Bestand — und die Box nimmt alles ein
 *      zweites Mal auf. Der teuerste Fehler, den dieses Modul machen kann.
 *   2. DIE DATEI IST KAPUTT. Sie zu ueberschreiben vernichtet den einzigen
 *      Zeugen; sie liegen zu lassen laesst jeden Start daran scheitern.
 *   3. ZWEI AENDERUNGEN UEBERLAPPEN SICH. Beide laden denselben Stand, die
 *      zweite schreibt die erste weg — unteilbar und vollstaendig, aber um
 *      einen Eintrag aermer.
 */
import { deepStrictEqual, match, ok, strictEqual } from 'node:assert'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { laufZuruecksetzen, listeLaden, listeSchreiben, listenpfad, LISTE_DATEI, mitListe, zwischenname } from './ablage.mjs'
import { LISTE_LEER, vormerken } from './liste.mjs'

const LUMPENPACK = 'spotify:track:0PyuOAMz1lv0z737JcQNOg'
const JOJO = 'spotify:track:2QqQXuDKNR8HK1cFxf0NhW'

let ordner
beforeEach(async () => {
  ordner = await mkdtemp(join(tmpdir(), 'mixpi-liste-'))
  laufZuruecksetzen()
})
afterEach(async () => {
  await chmod(join(ordner, LISTE_DATEI), 0o644).catch(() => {})
  await rm(ordner, { recursive: true, force: true })
})

describe('Zwischenname', () => {
  it('zaehlt hoch — zwei gleichzeitige Schreiber teilen ihn nicht', () => {
    // Ohne Zaehler hiessen beide `<ziel>.<pid>.tmp` und schrieben sich
    // gegenseitig mitten hinein. Am Geraet im Backend gemessen.
    const a = zwischenname('/x/liste.json', 4711)
    const b = zwischenname('/x/liste.json', 4711)
    ok(a !== b, `${a} und ${b} muessen sich unterscheiden`)
    match(a, /^\/x\/liste\.json\.4711\.\d+\.tmp$/)
  })

  it('legt die Zwischendatei NEBEN das Ziel, nicht nach /tmp', () => {
    // Nur im selben Verzeichnis ist das Umbenennen unteilbar; ueber eine
    // Dateisystemgrenze wird daraus Kopieren und Loeschen.
    ok(zwischenname('/wo/anders/liste.json', 1).startsWith('/wo/anders/'))
  })
})

describe('Schreiben und Zurueckladen', () => {
  it('geht durch, wie es hineingegangen ist', async () => {
    const liste = vormerken(LISTE_LEER, {
      uri: LUMPENPACK,
      titel: 'Die Zukunft wird gross',
      interpret: 'Das Lumpenpack',
      album: 'Alles Gute',
      albumInterpret: 'Das Lumpenpack',
      nummer: 7,
    }).liste
    strictEqual((await listeSchreiben(ordner, liste)).ok, true)
    const zurueck = await listeLaden(ordner)
    deepStrictEqual(zurueck.liste, liste)
    strictEqual(zurueck.unsicher, false)
  })

  it('laesst keine Zwischendatei liegen', async () => {
    await listeSchreiben(ordner, LISTE_LEER)
    deepStrictEqual(await readdir(ordner), [LISTE_DATEI])
  })

  it('schreibt von Hand lesbar — mehrzeilig, nicht eine lange Zeile', async () => {
    await listeSchreiben(ordner, vormerken(LISTE_LEER, { uri: JOJO, titel: 'Pummel' }).liste)
    const roh = await readFile(join(ordner, LISTE_DATEI), 'utf8')
    ok(roh.split('\n').length > 3, 'diese Datei soll von Hand berichtigt werden koennen')
  })

  it('legt den Ordner an, wenn er fehlt', async () => {
    const tiefer = join(ordner, 'noch', 'tiefer')
    strictEqual((await listeSchreiben(tiefer, LISTE_LEER)).ok, true)
    strictEqual((await listeLaden(tiefer)).unsicher, false)
  })
})

describe('FALL: die Datei fehlt — das ist kein Fehler', () => {
  it('gibt eine leere Liste und erlaubt das Schreiben', async () => {
    const g = await listeLaden(ordner)
    deepStrictEqual(g.liste, LISTE_LEER)
    strictEqual(g.grund, '', 'ein erster Start meldet nichts')
    strictEqual(g.unsicher, false, 'hier DARF geschrieben werden')
  })
})

describe('FALL 1: die Datei ist da, aber nicht lesbar', () => {
  it('meldet unsicher — und dann wird NICHT geschrieben', async (t) => {
    if (process.getuid?.() === 0) return t.skip('als root ist alles lesbar')
    const liste = vormerken(LISTE_LEER, { uri: LUMPENPACK, titel: 'Bestand' }).liste
    await listeSchreiben(ordner, liste)
    await chmod(join(ordner, LISTE_DATEI), 0o000)

    const g = await listeLaden(ordner)
    strictEqual(g.unsicher, true, 'nicht lesbar heisst UNBEKANNT, nicht leer')
    match(g.grund, /nicht lesbar/)

    // Und jetzt der eigentliche Punkt: eine Aenderung darf den Bestand nicht
    // ueberschreiben.
    const erg = await mitListe(ordner, (l) => vormerken(l, { uri: JOJO, titel: 'Neu' }).liste)
    strictEqual(erg.geschrieben, false, 'ueber einen unbekannten Bestand wird nicht geschrieben')

    await chmod(join(ordner, LISTE_DATEI), 0o644)
    deepStrictEqual((await listeLaden(ordner)).liste, liste, 'der Bestand muss unversehrt sein')
  })
})

describe('FALL 2: die Datei ist kaputt', () => {
  it('legt sie beiseite, statt sie zu ueberschreiben', async () => {
    await writeFile(join(ordner, LISTE_DATEI), '{ das ist kein JSON', 'utf8')
    const g = await listeLaden(ordner)
    deepStrictEqual(g.liste, LISTE_LEER)
    strictEqual(g.unsicher, false, 'beiseitegelegt heisst: es darf weitergehen')
    match(g.grund, /beiseitegelegt/)

    const drin = await readdir(ordner)
    ok(
      drin.some((n) => n.includes('.kaputt-')),
      `der Zeuge muss liegen bleiben, gefunden: ${drin.join(', ')}`,
    )
    ok(!drin.includes(LISTE_DATEI), 'die kaputte Datei darf nicht mehr im Weg liegen')
  })

  it('scheitert nicht bei jedem Start neu daran', async () => {
    await writeFile(join(ordner, LISTE_DATEI), 'kaputt', 'utf8')
    await listeLaden(ordner)
    const zweite = await listeLaden(ordner)
    strictEqual(zweite.grund, '', 'nach dem Beiseitelegen ist der Start wieder still')
  })
})

describe('FALL 3: zwei Aenderungen ueberlappen sich', () => {
  it('verliert keine — sie laufen in einer Reihe', async () => {
    // OHNE `mitListe` waere das der klassische Verlust: beide laden den leeren
    // Stand, beide legen EINEN Titel an, und der zweite schreibt den ersten weg.
    const [a, b] = await Promise.all([
      mitListe(ordner, (l) => vormerken(l, { uri: LUMPENPACK, titel: 'Erster' }).liste),
      mitListe(ordner, (l) => vormerken(l, { uri: JOJO, titel: 'Zweiter' }).liste),
    ])
    ok(a.geschrieben && b.geschrieben)
    const drin = await listeLaden(ordner)
    strictEqual(drin.liste.eintraege.length, 2, 'beide muessen ueberleben')
  })

  it('reisst nicht ab, wenn eine Aenderung wirft', async () => {
    await mitListe(ordner, () => {
      throw new Error('etwas ging schief')
    }).catch(() => {})
    // Die naechste muss trotzdem durchgehen — sonst haengt die Reihe fuer immer
    // an einer abgelehnten Zusage.
    const nach = await mitListe(ordner, (l) => vormerken(l, { uri: JOJO, titel: 'Danach' }).liste)
    strictEqual(nach.geschrieben, true)
  })

  it('schreibt nicht, wenn nichts zu tun ist', async () => {
    await mitListe(ordner, (l) => vormerken(l, { uri: JOJO, titel: 'Einmal' }).liste)
    const nochmal = await mitListe(ordner, () => null)
    strictEqual(nochmal.geschrieben, false, 'null heisst: nichts zu schreiben')
    deepStrictEqual(await readdir(ordner), [LISTE_DATEI])
  })
})

describe('ohne Datenordner', () => {
  it('faellt nicht um, meldet aber unsicher', async () => {
    strictEqual(listenpfad(''), null)
    strictEqual(listenpfad(undefined), null)
    const g = await listeLaden('')
    deepStrictEqual(g.liste, LISTE_LEER)
    strictEqual(g.unsicher, true, 'ohne Ordner darf nichts als gesichert gelten')
    strictEqual((await listeSchreiben('', LISTE_LEER)).ok, false)
  })
})
