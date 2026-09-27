/**
 * Pruefung zu tools/verwaltung-wege-schau.mjs.
 *
 * ZWEI FRAGEN, und die zweite ist die wichtigere:
 *   1. Stimmt die Verwaltung, wie sie HEUTE dasteht?
 *   2. Schlaegt der Befund auch an, wenn morgen etwas fehlt?
 *
 * Nur die erste zu stellen ist der teure Fehler dieses Projekts: eine Regel
 * ohne Pruefung ist eine Bitte, und eine Pruefung, die nur den heutigen Stand
 * abnickt, ist eine Regel ohne Pruefung mit mehr Zeilen. Deshalb laeuft die
 * reine Rechnung (befundeAus) hier gegen ERFUNDENE Gliederungen, in denen
 * genau ein Ding kaputt ist.
 *
 * AUFRUF
 *     node --test tools/verwaltung-wege-schau.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { befundeAus, schau, vorlageVon, zweiSchreiberIn } from './verwaltung-wege-schau.mjs'

/** Eine kleine Verwaltung: zwei Leistenseiten, eine Unterseite darunter. */
function gliederung() {
  return {
    kopfleiste: [
      { weg: '/medien', name: 'Medien' },
      { weg: '/system', name: 'System' },
    ],
    wege: [
      { datei: 'medien', weg: '/medien', name: 'Medien' },
      { datei: 'system', weg: '/system', name: 'System' },
      { datei: 'verschmelzung', weg: '/verschmelzung', name: 'Doppelte' },
    ],
    unterseiten: [{ datei: 'verschmelzung', weg: '/verschmelzung', name: 'Doppelte', eltern: ['Medien'] }],
    wegeJeDatei: {
      rahmen: ['/medien', '/system'],
      medien: ['/verschmelzung'],
      system: [],
      verschmelzung: ['/medien'],
    },
    ohneKopfleiste: [],
    gruppen: [
      { titel: 'Was da ist', wege: ['/medien'] },
      { titel: 'Wenn etwas klemmt', wege: ['/system'] },
    ],
    ohneGruppe: [],
    elternBehauptung: { '/verschmelzung': '/medien' },
  }
}

describe('Die Wege der Verwaltung', () => {
  it('nimmt eine heile Gliederung ohne Befund an', () => {
    const b = befundeAus(gliederung())
    assert.deepEqual(b.tote, [])
    assert.deepEqual(b.ohneRueckweg, [])
    assert.deepEqual(b.verwaist, [])
  })

  it('findet den Verweis auf einen Pfad, den es nicht gibt', () => {
    const g = gliederung()
    g.wegeJeDatei.system = ['/gibtesnicht']
    const b = befundeAus(g)
    assert.equal(b.tote.length, 1)
    assert.equal(b.tote[0].nach, '/gibtesnicht')
  })

  it('findet die Unterseite ohne Rueckweg — der Befund vom 03.08.2026', () => {
    const g = gliederung()
    g.wegeJeDatei.verschmelzung = ['/darstellung-oder-sonstwohin', '/system']
    const b = befundeAus(g)
    assert.equal(b.ohneRueckweg.length, 1)
    assert.equal(b.ohneRueckweg[0].name, 'Doppelte')
    assert.equal(b.ohneRueckweg[0].elternWeg, '/medien')
  })

  it('ein Weg IRGENDWOHIN ist kein Rueckweg', () => {
    // Der teure Grenzfall: die Seite verlinkt fleissig, nur nicht dorthin,
    // wo sie haengt. Ein Zaehler ueber „hat Verweise" haette hier gruen gemeldet.
    const g = gliederung()
    g.wegeJeDatei.verschmelzung = ['/system']
    assert.equal(befundeAus(g).ohneRueckweg.length, 1)
  })

  it('findet die Seite, zu der gar kein Weg fuehrt', () => {
    const g = gliederung()
    g.wegeJeDatei.medien = []
    const b = befundeAus(g)
    assert.deepEqual(
      b.verwaist.map((v) => v.weg),
      ['/verschmelzung'],
    )
    // Und sie hat dann natuerlich auch keinen Rueckweg mehr zu melden:
    // ohne Elternteil in der Leiste ist sie schlicht nicht mehr eingehaengt.
    assert.equal(b.ohneRueckweg.length, 0)
  })

  it('findet den Eintrag, den die Kopfleiste anbietet und kopfleiseLesen() nicht sieht', () => {
    // DER FALL VOM 05.08.2026, nachgestellt: in rahmen.ts stand
    // <a class="heim" routerLink="/">, und der Ausdruck in
    // verwaltung-suchbestand.mjs verlangt routerLink als ERSTES Attribut.
    // Der Eintrag war anklickbar, stand aber in keiner Leiste — 14 Reiter
    // wurden 13, 191 Sucheintraege 190, und beide Pruefungen blieben gruen.
    const g = gliederung()
    g.wegeJeDatei.rahmen = ['/medien', '/system', '/']
    const b = befundeAus(g)
    assert.deepEqual(
      b.nichtGelesen.map((n) => n.weg),
      ['/'],
    )
  })

  it('findet den Leisteneintrag, der in keiner Gruppe steht', () => {
    const g = gliederung()
    g.kopfleiste.push({ weg: '/neu', name: 'Neuer Reiter' })
    g.wege.push({ datei: 'neu', weg: '/neu', name: 'Neuer Reiter' })
    g.wegeJeDatei.rahmen = ['/medien', '/system', '/neu']
    g.wegeJeDatei.neu = []
    const b = befundeAus(g)
    assert.deepEqual(
      b.ungruppiert.map((u) => u.weg),
      ['/neu'],
    )
  })

  it('NICHT GEMESSEN ist nicht dasselbe wie IN ORDNUNG', () => {
    // Ohne Angabe der Gruppen wird nicht geurteilt. Waere der Vorgabewert
    // eine leere Liste, meldete jede Gliederung ohne Gruppen ALLES als
    // ungruppiert — und wer den Befund dann abstellt, indem er die Angabe
    // weglaesst, haette eine Pruefung, die schweigt statt zu pruefen.
    const g = gliederung()
    g.gruppen = null
    assert.deepEqual(befundeAus(g).ungruppiert, [])
  })

  it('die Uebersicht darf ausserhalb der Gruppen stehen', () => {
    const g = gliederung()
    g.kopfleiste.push({ weg: '/', name: 'Übersicht' })
    g.ohneGruppe = ['/']
    assert.deepEqual(befundeAus(g).ungruppiert, [])
  })

  it('findet die Unterseite, die in UNTERSEITE_VON gar nicht steht', () => {
    // Sie hat dann einen Rueckweg, aber es leuchtet kein Leisteneintrag —
    // genau die Haelfte des Befundes vom 03.08.2026, die bis zum 05.08.
    // liegengeblieben ist.
    const g = gliederung()
    g.elternBehauptung = {}
    const b = befundeAus(g)
    assert.equal(b.elternUneinig.length, 1)
    assert.equal(b.elternUneinig[0].weg, '/verschmelzung')
    assert.equal(b.elternUneinig[0].behauptet, null)
    assert.equal(b.elternUneinig[0].gemessen, '/medien')
  })

  it('findet den Eintrag in UNTERSEITE_VON, zu dem es keine Unterseite mehr gibt', () => {
    // Die andere Richtung, und sie ist die unangenehmere: es leuchtet ein
    // FREMDER Reiter. Wer nur eine Richtung prueft, laesst sie durch.
    const g = gliederung()
    g.elternBehauptung = { '/verschmelzung': '/medien', '/laengstweg': '/system' }
    const b = befundeAus(g)
    assert.deepEqual(
      b.elternUneinig.map((e) => e.weg),
      ['/laengstweg'],
    )
    assert.equal(b.elternUneinig[0].gemessen, null)
  })

  it('findet das FALSCHE Elternteil, nicht nur das fehlende', () => {
    const g = gliederung()
    g.elternBehauptung = { '/verschmelzung': '/system' }
    const b = befundeAus(g)
    assert.equal(b.elternUneinig.length, 1)
    assert.equal(b.elternUneinig[0].gemessen, '/medien')
    assert.equal(b.elternUneinig[0].behauptet, '/system')
  })

  it('ohne Behauptung wird auch hier nicht geurteilt', () => {
    const g = gliederung()
    g.elternBehauptung = null
    assert.deepEqual(befundeAus(g).elternUneinig, [])
  })

  it('findet die zwei Schreiber auf derselben Klasse — die Falle vom 05.08.2026', () => {
    // Genau die Zeile, die am 05.08. in einer Wegwerf-Arbeitskopie gefahren
    // wurde: danach leuchtete auf /verschmelzung und /interpreten NICHTS
    // mehr, und jede andere Pruefung blieb gruen (Kopfleiste 14, Suchbestand
    // 195, ELTERN UNEINIG leer). Ohne diesen Befund faellt das keinem auf.
    const z = zweiSchreiberIn(
      `<a routerLink="/medien" routerLinkActive="hier" [class.hier]="leuchtet('/medien')">Medien</a>`,
    )
    assert.equal(z.length, 1)
    assert.equal(z[0].klasse, 'hier')
    assert.equal(z[0].weg, '/medien')
  })

  it('laesst jede der beiden Schreibweisen ALLEIN in Ruhe', () => {
    // Die Gegenprobe, ohne die der Befund wertlos waere: dreizehn Eintraege
    // der Leiste tragen routerLinkActive und sollen es behalten, und der
    // vierzehnte traegt die Bindung. Verboten ist nur das Nebeneinander.
    assert.deepEqual(zweiSchreiberIn(`<a routerLink="/system" routerLinkActive="hier">System</a>`), [])
    assert.deepEqual(zweiSchreiberIn(`<a routerLink="/medien" [class.hier]="leuchtet('/medien')">Medien</a>`), [])
  })

  it('findet die Kollision auch, wenn routerLinkActive mehrere Klassen nennt', () => {
    // „hier aktiv" ist erlaubte Schreibweise. Wer nur auf Gleichheit der
    // ganzen Zeichenkette prueft, laesst genau diesen Fall durch.
    const z = zweiSchreiberIn(`<a routerLinkActive="hier aktiv" [class.aktiv]="x()">X</a>`)
    assert.deepEqual(
      z.map((e) => e.klasse),
      ['aktiv'],
    )
  })

  it('ein Beispiel im Kommentar ist kein Befund', () => {
    // In rahmen.ts steht die Begruendung neben dem Code, und sie nennt die
    // falsche Schreibweise beim Namen. Ein Werkzeug, das darauf anspringt,
    // zwingt dazu, die Warnung zu loeschen.
    assert.deepEqual(
      zweiSchreiberIn(`<!-- FALSCH: <a routerLinkActive="hier" [class.hier]="x()">Y</a> --><a routerLink="/">Z</a>`),
      [],
    )
  })

  it('NICHT GEMESSEN ist auch hier nicht dasselbe wie IN ORDNUNG', () => {
    const g = gliederung()
    g.zweiSchreiber = null
    assert.deepEqual(befundeAus(g).zweiSchreiber, [])
  })

  it('die ECHTE Verwaltung hat keinen toten Weg und keine Unterseite ohne Rueckweg', () => {
    const b = schau()
    assert.deepEqual(b.tote, [], 'toter Weg in der Verwaltung')
    assert.deepEqual(b.ohneRueckweg, [], 'Unterseite ohne Rueckweg')
    assert.deepEqual(b.verwaist, [], 'Seite ohne jeden Weg dorthin')
    assert.deepEqual(b.nichtGelesen, [], 'Leisteneintrag, den kopfleiseLesen() nicht sieht')
    assert.deepEqual(b.ungruppiert, [], 'Leisteneintrag ohne Gruppe')
    assert.deepEqual(b.elternUneinig, [], 'UNTERSEITE_VON stimmt nicht mit der erhobenen Elternschaft ueberein')
    assert.deepEqual(b.zweiSchreiber, [], 'ein Element bekommt dieselbe Klasse von zwei Stellen')
  })

  it('die ECHTEN Vorlagen sind wirklich abgesucht worden, nicht bloss leer gemeldet', () => {
    // Gegenprobe zur Zeile darueber: „keine zwei Schreiber" waere auch dann
    // gruen, wenn vorlageVon() gar keine Vorlage faende. Erst diese Zahl
    // sagt etwas — dreizehn Leisteneintraege tragen routerLinkActive.
    const roh = readFileSync(new URL('../src/frontend-admin/src/app/rahmen.ts', import.meta.url), 'utf8')
    const treffer = vorlageVon(roh).match(/routerLinkActive="/g) ?? []
    assert.ok(treffer.length >= 10, `nur ${treffer.length} routerLinkActive in der Vorlage des Rahmens gefunden`)
  })

  it('die ECHTE UNTERSEITE_VON ist gefunden worden und ist nicht leer', () => {
    // Gegenprobe: findet elternBehauptungLesen() den Block gar nicht, kaeme
    // `null` zurueck — und `null` heisst „nicht gemessen", also KEIN Befund.
    // Die Zeile darueber waere dann gruen, ohne irgendetwas zu pruefen.
    const b = schau()
    assert.notEqual(b.elternBehauptung, null, 'UNTERSEITE_VON in rahmen.ts nicht gefunden')
    assert.ok(Object.keys(b.elternBehauptung).length > 0, 'UNTERSEITE_VON ist leer')
  })

  it('die ECHTE Kopfleiste ist wirklich gegliedert, nicht bloss als gegliedert gemeldet', () => {
    // Gegenprobe zur Zeile darueber: „keine ungruppierten Eintraege" waere
    // auch dann gruen, wenn gruppenLesen() gar nichts faende und die
    // Kopfleiste leer zurueckkaeme. Erst diese Zahlen sagen etwas.
    const b = schau()
    assert.ok(b.gruppen.length >= 2, 'die Kopfleiste hat keine Gruppen')
    for (const g of b.gruppen) {
      assert.ok(g.titel.length > 0, 'Gruppe ohne Ueberschrift')
      assert.ok(g.wege.length > 0, `Gruppe „${g.titel}" ist leer`)
    }
    const inGruppen = b.gruppen.flatMap((g) => g.wege).length
    assert.equal(
      inGruppen,
      b.kopfleiste.length - 1,
      'nicht jeder Reiter ausser der Uebersicht steht in genau einer Gruppe',
    )
  })
})
