/**
 * Die +/- Tasten muessen die ganze Nutzerskala erreichen.
 *
 * DER FALL, DER DIESEN TEST ERZWUNGEN HAT (Betreiber, 05.09.2026): Die
 * Lautstaerke-Tasten im grossen Player und im Cover-Vollbild kamen nur bis
 * „ca 50", der Schieber im Mini-Player bis 100. An der Box gemessen:
 * `maxVolume` = 55. Der relative Weg verglich die Nutzerskala gegen die
 * Kartengrenze und deckelte damit ein zweites Mal.
 *
 * Die Begruendung im Langen steht in lautstaerke-stufe.ts.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { LAUTSTAERKE_SCHRITT, naechsteStufe } from './lautstaerke-stufe'

describe('naechsteStufe — eine Lautstaerke-Stufe weiter', () => {
  it('geht in Fuenferschritten hoch und runter', () => {
    assert.equal(naechsteStufe(50, 1), 55)
    assert.equal(naechsteStufe(50, -1), 45)
    assert.equal(LAUTSTAERKE_SCHRITT, 5)
  })

  it('ERREICHT DIE 100 — auch oberhalb eines kleinen maxVolume', () => {
    // DAS IST DER GEMELDETE FEHLER. Bei maxVolume 55 blieben die Tasten
    // vorher bei 55 stehen; die Grenze der Karte gehoert in
    // mupi-lautstaerke.sh und NICHT ein zweites Mal hierher.
    assert.equal(naechsteStufe(55, 1), 60, 'oberhalb von maxVolume geht es nicht weiter')
    assert.equal(naechsteStufe(95, 1), 100)
  })

  it('klemmt an den Enden der Nutzerskala, nicht davor', () => {
    assert.equal(naechsteStufe(100, 1), 100, 'ueber 100 hinaus')
    assert.equal(naechsteStufe(0, -1), 0, 'unter 0')
    assert.equal(naechsteStufe(2, -1), 0)
  })

  it('macht aus Unsinn keinen NaN — sonst ist der Lautsprecher hinterher stumm', () => {
    // `currentMeta.volume` ist im Zweifel null (noch nichts gelesen) oder ein
    // String aus einer alten Konfiguration.
    assert.equal(naechsteStufe(null, 1), 5)
    assert.equal(naechsteStufe(undefined, 1), 5)
    assert.equal(naechsteStufe('45', 1), 50, 'ein String muss rechnen wie eine Zahl')
    assert.equal(naechsteStufe('quark', -1), 0)
  })

  /**
   * EINE RECHNUNG, DIE NIEMAND RUFT, IST KEINE BEHEBUNG.
   *
   * Die Faelle oben pruefen `naechsteStufe`. Sie blieben alle gruen, wenn
   * jemand im Wiedergabedienst den alten Vergleich wieder einbaute — genau
   * die Falle aus dem Wissenspaket (`gegenprobe-statt-gruen-glauben`:
   * „in-Suchen ueberleben auskommentierte Aufrufe"). Deshalb wird hier die
   * QUELLE des einzigen Aufrufers gelesen.
   *
   * Geprueft wird die SORTE Fehler und nicht ein Wortlaut: kommt
   * `maxVolume` in spotify-control.ts ueberhaupt vor, ist die zweite Grenze
   * zurueck. Der Dienst braucht sie nirgends mehr — die Grenze der Karte
   * steht in `mupi-lautstaerke.sh`, und der Weg dorthin ist die
   * Nutzerskala 0..100.
   */
  it('der Wiedergabedienst kennt maxVolume nicht mehr — sonst deckelt es wieder zweimal', () => {
    // `__dirname` UND NICHT `import.meta` — nachgemessen am 19.09.2026.
    //
    // Hier stand bis dahin `fileURLToPath(import.meta.url)`, begruendet mit
    // „unter tsx ist __dirname undefined, siehe llmwiki
    // tsx-esm-kennt-kein-dirname". Beides stimmt nicht: den Wiki-Eintrag
    // gibt es nicht (0 von 1061), und eine Probe unter genau diesem
    // Testlaeufer liefert `typeof __dirname === 'string'` mit dem richtigen
    // Ordner. Dieses Paket hat kein `"type": "module"` in der package.json,
    // wird von tsx als CommonJS geladen und von esbuild als CommonJS
    // gebuendelt (`--platform=node`) — CommonJS ist hier also kein Versehen,
    // sondern der Zustand, und `__dirname` gehoert dazu.
    //
    // `import.meta` LIEF zwar unter tsx, war aber das einzige Stueck ESM im
    // Paket und damit der einzige Grund, warum `tsc --noEmit` rot war
    // (TS1343). Die tsconfig deshalb auf ESM zu ziehen, waere der teure Weg
    // gewesen: mit `module: es2022` werden aus dem einen Fehler acht, weil
    // parsers.ts, mplayer-wrapper.ts und mpv-wrapper.ts `export =` und
    // `import x = require()` benutzen — echter Laufzeit-Code der Box, nicht
    // Testbeiwerk. Mit `module: nodenext` bleibt der Fehler ueberhaupt
    // stehen (dann als TS1470), weil die Datei ohne `type: module` weiterhin
    // nach CommonJS uebersetzt.
    const quelle = readFileSync(join(__dirname, 'spotify-control.ts'), 'utf8')
    // Kommentare zaehlen nicht: dieser Baum erklaert seine Geschichte, und
    // der Kasten an `setVolume` NENNT den alten Vergleich mit Absicht.
    const ohneKommentar = quelle
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, (_m, v) => v)
    assert.equal(
      /maxVolume/.test(ohneKommentar),
      false,
      'spotify-control.ts liest wieder maxVolume — die zweite Grenze ist zurueck (siehe lautstaerke-stufe.ts)',
    )
    assert.match(ohneKommentar, /naechsteStufe\(/, 'setVolume ruft die gepruefte Rechnung nicht mehr')
  })
})
