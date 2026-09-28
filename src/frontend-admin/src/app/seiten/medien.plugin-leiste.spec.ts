/**
 * Die Steckleiste der Sektion `medien` auf der Medien-Seite (05.09.2026).
 *
 * ══ WARUM DIESER ZEUGE ═════════════════════════════════════════════════════
 *
 * Betreiber: „es gibt das plugin internet archive aber es ist nicht nutzbar,
 * wir muessen es zu medien verdrahten." Gemessen fehlte nicht das Suchen —
 * `tools/plugin-kette-probe.mts` ging alle sechs Stellen aus E88 gruen — es
 * fehlte der ORT: `mixpi-archive/plugin.json` meldet sich seit dem ersten Tag
 * unter `"sektion": "medien"` an, und `<mixpi-plugin-abschnitt>` hing im
 * ganzen Baum an genau EINER Stelle, in `seiten/streaming.ts`. Das Manifest
 * war gueltig, die Route antwortete, das Plugin tat seine Arbeit — und kein
 * Icon, kein Zustand, keine Aktion, kein Weg zu den Einstellungen war zu
 * sehen. `plugins/README.md` fuehrte die Zeile als „nirgends".
 *
 * DAS IST GENAU DIE SORTE NAHT, DIE JEDER EINZELTEST DURCHLAESST — beide
 * Seiten sind fuer sich gruen, dazwischen ist nichts. Deshalb wird HIER
 * gemessen, in der zusammengesetzten Seite, und nicht in der Leiste allein:
 * ein Zeuge gegen `MixpiPluginAbschnitt` selbst bliebe gruen, wenn jemand die
 * eine Zeile aus `medien.ts` wieder herausnimmt.
 *
 * DREI ZUSAGEN:
 *   1. Die Seite fragt fuer die Sektion `medien` — und zeigt NUR, wer sich
 *      dafuer gemeldet hat (ein Streaming-Plugin darf nicht hier landen).
 *   2. Die angemeldeten AKTIONEN stehen als Knoepfe da: das war der ganze
 *      Punkt, denn ein Knopf ohne Ort ist kein Knopf.
 *   3. Meldet sich niemand, steht ein SATZ da und nicht eine leere
 *      Ueberschrift — sonst weiss der Betreiber nicht, ob nichts angemeldet
 *      ist oder die Anzeige kaputt.
 */
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { type ComponentFixture, TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { MedienSeite } from './medien'

/** Ein Plugin, wie `/api/plugins` es meldet — nur die Felder der Leiste. */
interface Stand {
  kennung: string
  name: string
  fassung: string
  zustand: 'laedt' | 'bereit' | 'gescheitert' | 'aus'
  sektion?: string
  icon: boolean
  aktionen: { kennung: string; name: string; hinweis?: string }[]
}

const ARCHIV: Stand = {
  kennung: 'mixpi-archive',
  name: 'Internet Archive',
  fassung: '0.1.0',
  zustand: 'bereit',
  sektion: 'medien',
  icon: true,
  aktionen: [{ kennung: 'pruefen', name: 'Erreichbarkeit messen' }],
}

/** Meldet sich fuer eine ANDERE Sektion — darf auf der Medien-Seite nicht auftauchen. */
const FREMD: Stand = {
  kennung: 'mixpi-librespot',
  name: 'Librespot',
  fassung: '0.1.0',
  zustand: 'bereit',
  sektion: 'streaming/spotify',
  icon: false,
  aktionen: [{ kennung: 'neustart', name: 'Neu starten' }],
}

describe('Medien: die Steckleiste der Sektion medien', () => {
  let fixture: ComponentFixture<MedienSeite>
  let http: HttpTestingController

  /**
   * Die Seite aufbauen und `/api/plugins` mit DIESER Liste beantworten.
   *
   * DIE STARTLADUNGEN DER SEITE (Bibliothek, Listen, Profile, …) sind hier
   * nicht Gegenstand und werden leer beantwortet — aber ERST NACH
   * `/api/plugins`, sonst faenge das pauschale Leerbeantworten genau die
   * Anfrage weg, um die es geht, und der Test waere gruen ohne zu messen.
   */
  const aufbauen = async (geladen: Stand[]): Promise<void> => {
    fixture = TestBed.createComponent(MedienSeite)
    fixture.detectChanges()
    http = TestBed.inject(HttpTestingController)

    http.expectOne('/api/plugins').flush({ geladen })
    for (const rest of http.match(() => true)) rest.flush({})
    await fixture.whenStable()

    // Das Befinden holt die Leiste erst NACH dem Aufbau, je bereitem Plugin.
    for (const b of http.match((r) => r.url.endsWith('/befinden'))) {
      b.flush({ ok: true, text: 'Das Archiv antwortet.' })
    }
    await fixture.whenStable()
    fixture.detectChanges()
  }

  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? ''

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MedienSeite],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents()
  })

  afterEach(() => {
    // KEIN verifyNoOutstandingRequests: die Seite laedt vieles nach, und
    // dieser Zeuge hat zu genau EINER Leiste etwas zu sagen.
    TestBed.inject(HttpTestingController).match(() => true)
  })

  it('zeigt das Plugin der Sektion medien mit Namen und Fassung', async () => {
    await aufbauen([ARCHIV])
    const stecker = (fixture.nativeElement as HTMLElement).querySelectorAll('.stecker')
    expect(stecker.length).toBe(1)
    expect(stecker[0].textContent).toContain('Internet Archive')
    expect(stecker[0].textContent).toContain('0.1.0')
  })

  it('zeichnet die angemeldete Aktion als Knopf — ein Knopf ohne Ort ist kein Knopf', async () => {
    await aufbauen([ARCHIV])
    const knoepfe = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.stecker button'))
    expect(knoepfe.map((k) => k.textContent?.trim())).toContain('Erreichbarkeit messen')
  })

  it('zeigt das Befinden, das die Leiste nachgeholt hat', async () => {
    await aufbauen([ARCHIV])
    expect(text()).toContain('Das Archiv antwortet.')
  })

  it('laesst ein Plugin einer FREMDEN Sektion draussen', async () => {
    await aufbauen([ARCHIV, FREMD])
    const stecker = (fixture.nativeElement as HTMLElement).querySelectorAll('.stecker')
    expect(stecker.length).toBe(1)
    expect(text()).not.toContain('Librespot')
  })

  it('sagt es, wenn sich niemand gemeldet hat — statt einer leeren Ueberschrift', async () => {
    await aufbauen([])
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.stecker').length).toBe(0)
    expect(text()).toContain('Kein Medien-Plugin angemeldet')
  })

  it('hat die Ueberschrift, unter der die Leiste haengt', async () => {
    await aufbauen([ARCHIV])
    const h = (fixture.nativeElement as HTMLElement).querySelector('#anker-erweiterungen')
    expect(h?.textContent).toContain('Erweiterungen')
  })

  /* ══ DAS ANGEBOT (28.09.2026) ═════════════════════════════════════════════
   * Jedes bereite Plugin der Sektion wird nach http/angebot gefragt. Gemessen
   * wird wieder an der ZUSAMMENGESETZTEN Seite: die Zusage „ein neues
   * Medien-Plugin braucht keine Zeile in medien.ts" haengt an den drei
   * Bindungen dort (angebot, vorhanden, aufgenommen) — ein Zeuge gegen die
   * Leiste allein bliebe gruen, wenn eine davon fehlt. */
  const NACHRICHTEN: Stand = {
    kennung: 'mixpi-kindernachrichten',
    name: 'Kindernachrichten',
    fassung: '0.1.0',
    zustand: 'bereit',
    sektion: 'medien',
    icon: false,
    aktionen: [],
  }
  const vorschlag = (id: string, title: string) => ({ type: 'plugin', category: 'other', id, title, artist: 'x', cover: '' })
  const ANGEBOT = {
    suche: false,
    gesamt: 2,
    werke: [
      { kennung: 'heute', titel: 'Nachrichten von heute', hinweis: 'neueste Folgen', vorschlag: vorschlag('mixpi-kindernachrichten:heute', 'Nachrichten von heute') },
      { kennung: 'logo', titel: 'logo!', hinweis: 'taeglich', vorschlag: vorschlag('mixpi-kindernachrichten:logo', 'logo!') },
    ],
  }
  const angebotAnfrage = () => http.expectOne((r) => r.url.startsWith('/api/plugins/mixpi-kindernachrichten/http/angebot'))
  const knoepfe = (): string[] =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.angebot button')).map((k) => k.textContent?.trim() ?? '')

  it('fragt ein Plugin der Sektion nach seinem Angebot und zeigt je Eintrag „aufnehmen"', async () => {
    await aufbauen([NACHRICHTEN])
    angebotAnfrage().flush(ANGEBOT)
    await fixture.whenStable()
    fixture.detectChanges()
    expect(text()).toContain('Nachrichten von heute')
    expect(knoepfe()).toEqual(['aufnehmen', 'aufnehmen'])
  })

  it('„schon da" kommt aus der Bibliothek der Seite, nicht vom Plugin', async () => {
    await aufbauen([NACHRICHTEN])
    ;(fixture.componentInstance as unknown as { eintraege: { set(v: unknown[]): void } }).eintraege.set([
      { schluessel: 'plugin:mixpi-kindernachrichten:logo', type: 'plugin', id: 'mixpi-kindernachrichten:logo' },
    ])
    angebotAnfrage().flush(ANGEBOT)
    await fixture.whenStable()
    fixture.detectChanges()
    expect(knoepfe()).toEqual(['aufnehmen', 'schon da'])
  })

  it('schickt beim Aufnehmen den Vorschlag UNVERAENDERT an /api/medien und laedt danach die Bibliothek neu', async () => {
    await aufbauen([NACHRICHTEN])
    angebotAnfrage().flush(ANGEBOT)
    await fixture.whenStable()
    fixture.detectChanges()
    ;((fixture.nativeElement as HTMLElement).querySelector('.angebot button') as HTMLButtonElement).click()
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/medien')
    expect(post.request.body).toEqual(ANGEBOT.werke[0].vorschlag)
    post.flush({})
    await fixture.whenStable()
    expect(http.match((r) => r.method === 'GET' && r.url === '/api/medien').length).toBe(1)
  })

  it('ein Plugin ohne Angebot (404) bleibt ein Stecker wie vorher — kein Kasten, keine Fehlermeldung', async () => {
    await aufbauen([NACHRICHTEN])
    angebotAnfrage().flush({ fehler: 'Unbekannter Pfad' }, { status: 404, statusText: 'Not Found' })
    await fixture.whenStable()
    fixture.detectChanges()
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.angebot').length).toBe(0)
  })

  it('bietet das Plugin eine Suche an, geht das Wort als ?q= an dasselbe Angebot', async () => {
    await aufbauen([NACHRICHTEN])
    angebotAnfrage().flush({ ...ANGEBOT, suche: true, platzhalter: 'z. B. Mond' })
    await fixture.whenStable()
    fixture.detectChanges()
    const feld = (fixture.nativeElement as HTMLElement).querySelector('.angebot input') as HTMLInputElement
    expect(feld.placeholder).toBe('z. B. Mond')
    feld.value = 'Mond'
    feld.dispatchEvent(new Event('input'))
    feld.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }))
    expect(angebotAnfrage().request.urlWithParams).toBe('/api/plugins/mixpi-kindernachrichten/http/angebot?q=Mond')
  })
})
