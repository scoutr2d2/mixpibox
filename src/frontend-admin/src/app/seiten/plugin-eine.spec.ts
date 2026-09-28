/**
 * Die Seite einer Erweiterung (/plugins/<kennung>) — zwei Zusagen vom 28.09.2026.
 *
 *   1. Ein Zahlfeld nimmt Kommazahlen an. Ohne `step="any"` gilt einem
 *      `<input type="number">` nur jede GANZE Zahl als gueltig: das Tempo des
 *      Klexikons (1,1), die Schwelle der Gruppen (0,7) und das Gewicht von
 *      Similar (1,5) stuenden als Fehler markiert da.
 *   2. Das Recht `sprechen` steht in Worten da — der Vertrag will lesbar
 *      haben, dass ein Plugin die Box sprechen laesst.
 */
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { type ComponentFixture, TestBed } from '@angular/core/testing'
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router'
import { PluginEineSeite } from './plugin-eine'

describe('Plugin-Seite: Zahlfelder und Rechte', () => {
  let fixture: ComponentFixture<PluginEineSeite>
  let http: HttpTestingController

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PluginEineSeite],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ kennung: 'mixpi-klexikon' }) } } },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(PluginEineSeite)
    http = TestBed.inject(HttpTestingController)
    http.expectOne('/api/plugins').flush({
      geladen: [
        {
          kennung: 'mixpi-klexikon',
          name: 'Klexikon',
          fassung: '0.1.0',
          rechte: ['medienquelle', 'netz', 'sprechen'],
          zustand: 'bereit',
          kann: { aufloesen: true, suchen: true, befinden: true, ereignis: false },
          felder: [
            { schluessel: 'tempo', art: 'zahl', name: 'Sprechtempo', vorgabe: 1.1 },
            { schluessel: 'themen', art: 'text', name: 'Themen' },
          ],
          aktionen: [],
        },
      ],
    })
    await fixture.whenStable()
    http.expectOne('/api/plugins/mixpi-klexikon/einstellungen').flush({ werte: { tempo: 1.1, themen: 'Tiere und Natur' } })
    await fixture.whenStable()
    fixture.detectChanges()
  })

  afterEach(() => http.match(() => true))

  it('ein Zahlfeld nimmt 1,1 an — step any, sonst waere es im Browser ungueltig', () => {
    const felder = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('input')) as HTMLInputElement[]
    const tempo = felder.find((f) => f.type === 'number')
    expect(tempo).toBeTruthy()
    expect(tempo?.getAttribute('step')).toBe('any')
    expect(tempo?.validity.valid).toBeTrue()
    const text = felder.find((f) => f.type === 'text')
    expect(text?.hasAttribute('step')).toBeFalse()
  })

  it('das Recht sprechen steht in Worten da', () => {
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('lässt die Box vorlesen')
  })
})
