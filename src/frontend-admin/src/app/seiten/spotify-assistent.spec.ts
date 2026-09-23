/**
 * Tests für den Spotify-Einrichtungs-Assistenten.
 *
 * Der Kopf von spotify-assistent.ts gibt Zusagen, die man dem Code nicht
 * ansieht — hier werden sie geprüft:
 *
 *   1. ES FRAGT SELBST NACH, ABER NICHT EWIG: der Ton-Takt läuft nur,
 *      solange ein Code offen ist, und ENDET mit Erfolg, Ablehnung und
 *      Abbruch. (Die Gegenprobe ist der eigentliche Test: nach dem Ende darf
 *      KEINE Anfrage mehr kommen — httpMock.verify() fängt jede weitere.)
 *   2. DIE BOX FÜHRT: „Code holen" ist ein POST an die Box; angezeigt wird
 *      nur, was GET /api/spotify/ton sagt.
 *   3. EIN GEGLÜCKTER TEIL FEUERT `fertig` — die Seite darüber lädt neu, und
 *      erst ihr neues Eingabesignal macht Schritt 1 grün (EINE Quelle der
 *      Wahrheit).
 *   4. EIN OFFENER CODE VON WOANDERS (am Gerät geholt) wird beim Laden
 *      übernommen statt ignoriert.
 */
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { type ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { SpotifyAssistent } from './spotify-assistent'

interface TonLage {
  angemeldet: boolean
  laeuft: boolean
  offen: boolean
  geraet: {
    code: string
    restSekunden: number
    wartet: boolean
    fertig: boolean
    meldung: string
  } | null
}

const RUHE: TonLage = { angemeldet: false, laeuft: true, offen: false, geraet: null }
const OFFEN: TonLage = {
  ...RUHE,
  geraet: { code: 'ABC123', restSekunden: 500, wartet: true, fertig: false, meldung: '' },
}
const ANGEMELDET: TonLage = { ...RUHE, angemeldet: true }

describe('SpotifyAssistent', () => {
  let fixture: ComponentFixture<SpotifyAssistent>
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SpotifyAssistent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    })
    fixture = TestBed.createComponent(SpotifyAssistent)
    http = TestBed.inject(HttpTestingController)
  })

  afterEach(() => {
    // DIE GEGENPROBE ZU „NICHT EWIG": jede Anfrage, die ein Test nicht
    // ausdrücklich erwartet hat, lässt ihn hier scheitern.
    http.verify()
    fixture.destroy()
  })

  function tonAntwort(lage: TonLage): void {
    http.expectOne('/api/spotify/ton').flush(lage)
  }

  it('zeigt beide Schritte offen, wenn nichts eingerichtet ist', fakeAsync(() => {
    fixture.componentRef.setInput('warum', 'Es fehlt der Zugang.')
    fixture.detectChanges()
    tonAntwort(RUHE)
    tick()
    fixture.detectChanges()
    const text = (fixture.nativeElement as HTMLElement).textContent ?? ''
    expect(text).toContain('Anmeldeseite öffnen')
    expect(text).toContain('Code holen')
    expect(text).toContain('Es fehlt der Zugang.')
    expect(text).not.toContain('Beide Zugänge stehen')
  }))

  it('Code holen: POST an die Box, dann zeigt der Stand den Code', fakeAsync(() => {
    fixture.detectChanges()
    tonAntwort(RUHE)
    tick()
    fixture.detectChanges()

    const knopf = (fixture.nativeElement as HTMLElement).querySelectorAll('button')[0]
    knopf.click()
    http.expectOne({ method: 'POST', url: '/api/spotify/ton/geraetecode' }).flush({ code: 'ABC123' })
    tick()
    tonAntwort(OFFEN)
    tick()
    fixture.detectChanges()

    const text = (fixture.nativeElement as HTMLElement).textContent ?? ''
    expect(text).toContain('ABC123')
    expect(text).toContain('spotify.com/pair')

    // Der Takt fragt nach — und mit der Anmeldung ENDET er und feuert fertig.
    let gefeuert = 0
    fixture.componentInstance.fertig.subscribe(() => gefeuert++)
    tick(4000)
    tonAntwort(ANGEMELDET)
    tick()
    fixture.detectChanges()
    expect(gefeuert).toBe(1)
    expect(((fixture.nativeElement as HTMLElement).textContent ?? '')).toContain('als Lautsprecher bereit')
    tick(9000) // kein weiterer Abruf — sonst schlägt http.verify() im afterEach an
  }))

  it('eine Ablehnung am Handy wird gezeigt, und der Takt endet', fakeAsync(() => {
    fixture.detectChanges()
    tonAntwort(OFFEN) // ein Code, den jemand am Gerät geholt hat, wird übernommen
    tick()
    fixture.detectChanges()
    expect(((fixture.nativeElement as HTMLElement).textContent ?? '')).toContain('ABC123')

    tick(4000)
    tonAntwort({
      ...RUHE,
      geraet: { code: 'ABC123', restSekunden: 400, wartet: false, fertig: true, meldung: 'Am anderen Gerät abgelehnt. Es wurde nichts geändert.' },
    })
    tick()
    fixture.detectChanges()
    expect(((fixture.nativeElement as HTMLElement).textContent ?? '')).toContain('Am anderen Gerät abgelehnt')
    tick(9000) // Takt ist aus — keine weitere Anfrage
  }))

  it('Abbrechen schickt DELETE und räumt den Code weg', fakeAsync(() => {
    fixture.detectChanges()
    tonAntwort(OFFEN)
    tick()
    fixture.detectChanges()

    const abbrechen = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (k) => k.textContent?.includes('Abbrechen'),
    )
    expect(abbrechen).withContext('Abbrechen-Knopf fehlt').toBeTruthy()
    abbrechen?.click()
    http.expectOne({ method: 'DELETE', url: '/api/spotify/ton/geraetecode' }).flush({ ok: true })
    tick()
    fixture.detectChanges()
    expect(((fixture.nativeElement as HTMLElement).textContent ?? '')).toContain('Code holen')
    tick(9000) // auch hier: Takt aus
  }))

  it('Schritt 1 wird über das Eingabesignal grün, nicht über eigene Wahrheit', fakeAsync(() => {
    fixture.componentRef.setInput('stand', 'bereit')
    fixture.detectChanges()
    tonAntwort(RUHE)
    tick()
    fixture.detectChanges()
    expect(((fixture.nativeElement as HTMLElement).textContent ?? '')).toContain('ein Zugang ist hinterlegt')
  }))

  it('nach der Anmeldeseite fragt Schritt 1 nach und feuert fertig bei bereit', fakeAsync(() => {
    fixture.detectChanges()
    tonAntwort(RUHE)
    tick()
    fixture.detectChanges()

    let gefeuert = 0
    fixture.componentInstance.fertig.subscribe(() => gefeuert++)
    fixture.componentInstance.einsWartenStarten()
    tick(5000)
    http.expectOne('/api/streaming').flush({ anbieter: [{ id: 'spotify', stand: 'bereit' }] })
    tick()
    expect(gefeuert).toBe(1)
    tick(11000) // Takt endet mit dem Erfolg — keine weitere /api/streaming-Anfrage
  }))
})
