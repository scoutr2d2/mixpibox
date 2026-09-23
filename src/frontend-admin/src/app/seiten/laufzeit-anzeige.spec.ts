/**
 * Was die beiden Seiten anzeigen, wenn KEINE Laufzeit da ist.
 *
 * WARUM DIESER TEST NEBEN `dauer-text.node.spec.ts` STEHT: Der dort prüft die
 * Regeln. Dieser prüft, dass die Seiten sie auch WIRKLICH BENUTZEN — und das
 * ist die Hälfte, die am 19.09.2026 gefehlt hat. `laufzeitText` im Server war
 * vollständig geprüft, inklusive „unbekannt" für negative und nicht-endliche
 * Werte, und hatte NULL Aufrufer; die Verwaltung rechnete daneben ihre eigene
 * Fassung ohne diesen Wächter. Grüne Tests über einer Funktion, die niemand
 * ruft, beweisen nichts über das, was auf dem Schirm steht.
 *
 * DER PRÜFFALL, UM DEN ES GEHT, ist der zweite: eine Lage OHNE `laufzeit`,
 * aber MIT `laufzeitSekunden`. Die alte Fassung rechnete daraus „3 Tage, 2 h"
 * — eine Anzeige, die aussieht wie eine Messung, in Wahrheit aber aus einem
 * Feld stammt, das die Seite gar nicht mehr anzeigen soll; und stand dort
 * eine 0 oder gar nichts, sagte sie durch `?? 0` „0 min". Beide Male hat
 * niemand etwas gemessen, und beide Male sah es so aus.
 *
 * ANGEFASST WIRD DIE SEITE NICHT (Form wie darstellung.spec.ts): geprüft wird
 * am Bauteil, nicht an gerenderten Bildpunkten. Wo die Zahl auf dem Schirm
 * landet, misst tools/admin-schirmfolge.mjs.
 */
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import type { Type } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { dauerText } from '../dauer-text'
import type { Systemlage } from '../system.dienst'
import { LeistungSeite } from './leistung'
import { SystemSeite } from './system'

const takt = () => new Promise((r) => setTimeout(r, 0))

/** Eine vollständige Lage, der NUR der fertige Laufzeit-Satz fehlt. */
const OHNE_SATZ: Systemlage = {
  laufzeitSekunden: 268344, // „3 Tage, 2 h", wenn jemand wieder selbst rechnet
  speicherGesamt: 8_000_000_000,
  speicherFrei: 4_000_000_000,
  last: [0.1, 0.2, 0.3],
  kerne: 4,
  temperatur: 48,
  platte: null,
  rechner: 'mupibox',
  aktionen: [],
}

describe('Laufzeit-Anzeige der Verwaltung', () => {
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    })
    http = TestBed.inject(HttpTestingController)
  })

  /**
   * Beide Seiten holen im Konstruktor. Die Abrufe werden hier ABSCHLÄGIG
   * beantwortet, und das ist Absicht: so landet die Seite in genau dem
   * Zustand, in dem „unbekannt" hingehört — die Box hat nicht geantwortet.
   * Eine leere Antwort (`{}`) wäre etwas anderes: dann HÄTTE sie geantwortet,
   * nur ohne Inhalt, und die Lage wäre ein leeres Objekt statt `null`.
   */
  async function bauen<T>(art: Type<T>): Promise<T> {
    const fix = TestBed.createComponent(art)
    for (const a of http.match(() => true)) {
      a.flush(null, { status: 503, statusText: 'nicht erreichbar' })
    }
    await takt()
    return fix.componentInstance
  }

  describe('Systemseite — der Satz kommt vom Server', () => {
    it('zeigt den fertigen Satz UNVERÄNDERT', async () => {
      const seite = await bauen(SystemSeite)
      seite.lage.set({ ...OHNE_SATZ, laufzeit: '3 Tage, 2 h' })
      expect(seite.laufzeit()).toBe('3 Tage, 2 h')
    })

    it('reicht auch das „unbekannt" des Servers durch', async () => {
      const seite = await bauen(SystemSeite)
      seite.lage.set({ ...OHNE_SATZ, laufzeit: 'unbekannt' })
      expect(seite.laufzeit()).toBe('unbekannt')
    })

    /** DER FALL, WEGEN DEM ES DIESEN TEST GIBT. */
    it('sagt „unbekannt", wenn kein Satz kam — und rechnet NICHT nach', async () => {
      const seite = await bauen(SystemSeite)
      seite.lage.set(OHNE_SATZ)
      expect(seite.laufzeit()).toBe('unbekannt')
      // Und sonst nichts: weder die nachgerechnete noch die geklemmte Fassung.
      expect(seite.laufzeit()).not.toBe('3 Tage, 2 h')
      expect(seite.laufzeit()).not.toBe('0 min')
    })

    /**
     * Die Box hat gar nicht geantwortet — DER Fall, in dem die alte Fassung
     * am dreistesten war: `?? 0` machte daraus „0 min", also die Behauptung,
     * die Box sei gerade angelaufen.
     */
    it('sagt „unbekannt", solange überhaupt keine Lage da ist', async () => {
      const seite = await bauen(SystemSeite)
      expect(seite.lage()).toBeNull()
      expect(seite.laufzeit()).toBe('unbekannt')
      expect(seite.laufzeit()).not.toBe('0 min')
    })
  })

  describe('Leistungsseite — dieselbe Wächter-Regel', () => {
    it('benutzt die geteilte Fassung und keine eigene Kopie', async () => {
      const seite = await bauen(LeistungSeite)
      expect(seite.dauerText).toBe(dauerText)
    })

    it('sagt „unbekannt" statt „0 s", wo es nichts zu sagen gibt', async () => {
      const seite = await bauen(LeistungSeite)
      expect(seite.dauerText(-5)).toBe('unbekannt')
      expect(seite.dauerText(Number.NaN)).toBe('unbekannt')
      expect(seite.dauerText(undefined)).toBe('unbekannt')
    })

    it('behält die echte Null und die feine Einteilung', async () => {
      const seite = await bauen(LeistungSeite)
      // 0 ist eine Auskunft, kein fehlender Wert.
      expect(seite.dauerText(0)).toBe('0 s')
      // Und Sekunden bleiben Sekunden: DAS ist der Grund, warum diese Seite
      // NICHT auf den groben Satz der Systemseite umgestellt wurde.
      expect(seite.dauerText(42)).toBe('42 s')
    })
  })
})
