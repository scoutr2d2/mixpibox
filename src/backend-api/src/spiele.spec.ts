import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  APP_IDS,
  APP_WERKE,
  ausVorlesenUebernehmen,
  darfGespieltWerden,
  SPIEL_IDS,
  SPIELE_VORGABE,
  SPIELE_WERKE,
  spieleNormalisieren,
} from './spiele'

describe('spieleNormalisieren — nur ein ausdrueckliches Nein schaltet ab', () => {
  it('laesst den Bereich an, wenn nichts dasteht', () => {
    // Das ist der Zustand jeder Box, die spiele.json noch nicht hat. Ein
    // Schalter, der beim Einbau eine vorhandene Funktion wegnimmt, ist kein
    // Schalter, sondern ein Verlust.
    assert.equal(spieleNormalisieren({}).an, true)
    assert.equal(spieleNormalisieren(null).an, true)
    assert.equal(spieleNormalisieren(undefined).an, true)
    assert.equal(SPIELE_VORGABE.an, true)
  })

  it('nimmt ein ausdrueckliches Nein an', () => {
    assert.equal(spieleNormalisieren({ an: false }).an, false)
    assert.equal(spieleNormalisieren({ an: true }).an, true)
  })

  it('haelt einen verunglueckten Wert fuer „an", nicht fuer „aus"', () => {
    // `!== false` und nicht `=== true`. Eine Zeichenkette aus einem Formular
    // oder eine 0 aus einer aelteren Fassung darf den Bereich nicht still
    // zumachen — die Richtung des Zweifels gehoert dorthin, wo nichts
    // verlorengeht.
    assert.equal(spieleNormalisieren({ an: 'aus' }).an, true)
    assert.equal(spieleNormalisieren({ an: 0 }).an, true)
    assert.equal(spieleNormalisieren({ an: null }).an, true)
  })
})

describe('ausVorlesenUebernehmen — der Umzug vom 20.09.2026', () => {
  /*
   * DIE FRAGE, DIE DIESER BLOCK BEANTWORTET: Was passiert auf einer Box, die
   * den Schalter gestern auf der Vorlesen-Seite abgeschaltet hat?
   *
   * Ohne Uebernahme staende er heute wieder auf „an" — und der Betreiber
   * haette keinen Grund, das zu vermuten. Genau diese Klasse Fehler faellt
   * erst Wochen spaeter auf, wenn ueberhaupt.
   */
  it('rettet ein abgeschaltetes Spiel aus der alten Fassung', () => {
    const gestern = { modus: 'antippen', stimme: 'de_DE-ramona-low', interpret: false, tempo: 1.1, spiele: false }
    assert.equal(ausVorlesenUebernehmen(gestern).an, false)
  })

  it('laesst alles andere an — auch eine Datei ohne den Schluessel', () => {
    // Die Fassung VOR dem 19.09.2026: den Schluessel gab es nicht, die
    // Spielecke lief. Und eine Box ganz ohne vorlesen.json ebenso.
    const davor = { modus: 'aus', stimme: 'de_DE-ramona-low', interpret: true, tempo: 1.1 }
    assert.equal(ausVorlesenUebernehmen(davor).an, true)
    assert.equal(ausVorlesenUebernehmen({}).an, true)
    assert.equal(ausVorlesenUebernehmen(null).an, true)
    assert.equal(ausVorlesenUebernehmen({ spiele: true }).an, true)
  })
})

describe('die Stimme im Spielbereich — neu heisst aus', () => {
  /*
   * DIE FRAGE: Was hoert eine Box, auf der seit gestern eine spiele.json
   * liegt, nach dem Einspielen dieser Fassung?
   *
   * Antwort: nichts. Genau das ist der Zweck von `=== true`. Die Gegenprobe
   * dazu ist der Schalter `an` darueber, der mit `!== false` arbeitet — die
   * beiden Richtungen stehen absichtlich nebeneinander in einer Datei, weil
   * nur der Unterschied sie erklaert.
   */
  it('schweigt, solange es niemand ausdruecklich bestellt hat', () => {
    assert.equal(spieleNormalisieren({ an: true }).vorlesen, false)
    assert.equal(spieleNormalisieren({}).vorlesen, false)
    assert.equal(SPIELE_VORGABE.vorlesen, false)
    // Auch ein Wert, der „irgendwie wahr" aussieht, ist kein Ja.
    assert.equal(spieleNormalisieren({ vorlesen: 'an' }).vorlesen, false)
    assert.equal(spieleNormalisieren({ vorlesen: 1 }).vorlesen, false)
  })

  it('nimmt ein ausdrueckliches Ja an', () => {
    assert.equal(spieleNormalisieren({ vorlesen: true }).vorlesen, true)
  })

  it('haengt NICHT am Kachel-Vorlesen', () => {
    // Der Umzug bringt nur den einen Schalter mit. Wer Kacheln vorlesen
    // laesst, hat damit nicht bestellt, dass ein Spiel spricht.
    const gestern = { modus: 'lernen', stimme: 'de_DE-ramona-low', spiele: true }
    assert.equal(ausVorlesenUebernehmen(gestern).vorlesen, false)
  })
})

describe('die einzelnen Spiele — fehlende heissen an, unbekannte fliegen raus', () => {
  it('kennt jedes Werk und laesst es an, wenn nichts dasteht', () => {
    const e = spieleNormalisieren({})
    for (const w of SPIELE_WERKE) assert.equal(e.spiele[w.id], true, `${w.id} sollte an sein`)
    assert.equal(Object.keys(e.spiele).length, SPIELE_WERKE.length)
  })

  it('schaltet genau das ab, was abgeschaltet wurde', () => {
    const e = spieleNormalisieren({ spiele: { schlange: false } })
    assert.equal(e.spiele.schlange, false)
    assert.equal(e.spiele.memory, true)
  })

  it('wirft einen Schluessel weg, den es nicht gibt', () => {
    // Sonst versteinert ein Tippfehler in der Datei und sieht beim naechsten
    // Leser aus wie ein Spiel, das es gibt.
    const e = spieleNormalisieren({ spiele: { tetris: false, schlange: true } })
    assert.equal('tetris' in e.spiele, false)
  })

  it('haelt ein neues Spiel fuer an, auch wenn die Datei es nicht kennt', () => {
    // Die Datei von gestern kannte nur `schlange`. Die drei Spiele von heute
    // duerfen davon nicht abgeschaltet werden — niemand hat sie abgeschaltet,
    // es gab sie nur noch nicht.
    const gestern = { an: true, spiele: { schlange: true } }
    const e = spieleNormalisieren(gestern)
    assert.equal(e.spiele.memory, true)
    assert.equal(e.spiele.dreigewinnt, true)
    assert.equal(e.spiele.farben, true)
  })

  it('gibt jedem Werk eine Kennung, einen Namen und einen Satz', () => {
    // Die Verwaltungsseite zeigt alle drei an; ein leeres Feld faellt dort
    // erst auf, wenn jemand hinsieht.
    for (const w of SPIELE_WERKE) {
      assert.ok(w.id.length > 0 && w.name.length > 0 && w.was.length > 10, w.id)
    }
    assert.equal(new Set(SPIEL_IDS).size, SPIEL_IDS.length, 'Kennungen doppelt')
  })
})

describe('darfGespieltWerden — alles einzeln aus ist auch aus', () => {
  it('sagt ja, solange irgendetwas anbleibt', () => {
    assert.equal(darfGespieltWerden(spieleNormalisieren({})), true)
    assert.equal(darfGespieltWerden(spieleNormalisieren({ spiele: { schlange: false } })), true)
  })

  it('sagt nein, wenn der Bereich aus ist', () => {
    assert.equal(darfGespieltWerden(spieleNormalisieren({ an: false })), false)
  })

  it('sagt nein, wenn JEDES Spiel einzeln aus ist', () => {
    // Sonst ginge die Tuer auf und dahinter stuende eine leere Liste — ein
    // Kind haette keinen Grund, das fuer Absicht zu halten.
    const aus = Object.fromEntries(SPIEL_IDS.map((id) => [id, false]))
    assert.equal(darfGespieltWerden(spieleNormalisieren({ an: true, spiele: aus })), false)
  })
})

describe('die Schublade — derselbe Schalter fuer den zweiten Spielort', () => {
  /*
   * GEFUNDEN AM 20.09.2026 beim Bauen der Einzelschalter: Die Tipp-Apps der
   * Schublade (NewDesign/apps.js, seit 03.09.2026) waren NIRGENDS
   * abschaltbar — genau die Luecke, die die Spielecke bis zum 19.09. hatte.
   * Fuer einen Betreiber ist „was darf mein Kind spielen" EINE Frage, auch
   * wenn die Box zwei Spielorte hat.
   */
  it('kennt die sechs Apps und laesst sie an', () => {
    const e = spieleNormalisieren({})
    for (const w of APP_WERKE) assert.equal(e.apps[w.id], true, w.id)
    assert.equal(Object.keys(e.apps).length, 6)
  })

  it('schaltet genau eine ab und laesst die Spiele in Ruhe', () => {
    // DIE TRENNUNG IST DER PUNKT: `spiele` und `apps` sind zwei Karten in
    // der Verwaltung und zwei Orte auf der Box. Wer „Rechnen" abschaltet,
    // hat an der Spielecke nichts getan.
    const e = spieleNormalisieren({ apps: { rechnen: false } })
    assert.equal(e.apps.rechnen, false)
    assert.equal(e.apps.malen, true)
    assert.equal(e.spiele.schlange, true)
  })

  it('wirft unbekannte Kennungen weg', () => {
    assert.equal('gibtsnicht' in spieleNormalisieren({ apps: { gibtsnicht: false } }).apps, false)
  })

  it('haelt die Kennungen der Schublade von denen der Spielecke getrennt', () => {
    // `memory` gibt es ZWEIMAL: als Tipp-App der Schublade (Bilder aus der
    // Bibliothek) und als „Paare" der Spielecke (Formen, mit dem Kreuz
    // spielbar). Dass beide dieselbe Kennung tragen, ist erlaubt — sie
    // liegen in verschiedenen Faechern. Wer das aendert, muss BEIDE
    // Faecher anfassen; dieser Zeuge steht als Erinnerung daran.
    const e = spieleNormalisieren({ spiele: { memory: false } })
    assert.equal(e.spiele.memory, false)
    assert.equal(e.apps.memory, true, 'die Schublade darf davon nicht betroffen sein')
    assert.equal(APP_IDS.includes('memory'), true)
  })
})
