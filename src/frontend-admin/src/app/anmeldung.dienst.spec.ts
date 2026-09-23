/**
 * Tests fuer den Anmeldezustand der Verwaltung.
 *
 * WOZU: Gezaehlt am 2026-08-02 hatte `src/frontend-admin` bei 23 Dateien KEINE
 * einzige Testdatei — sie wurde nur gebaut. „Gruen" hiess bis dahin
 * ausschliesslich „laesst sich uebersetzen".
 *
 * WARUM AUSGERECHNET HIER ANGEFANGEN WIRD: Dieser Dienst entscheidet, ob die
 * Verwaltung offensteht. Seine Zusagen sind im Kopf der Datei ausdruecklich
 * formuliert („die Oberflaeche ist NICHT strenger als das Backend", „Fehler =
 * nicht angemeldet, nicht Absturz"). Genau die werden hier geprueft — eine
 * Zusage, die niemand nachhaelt, ist ein Kommentar, keine Eigenschaft.
 */
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { TestBed } from '@angular/core/testing'
import { AnmeldeDienst, UNBEKANNT } from './anmeldung.dienst'

/**
 * Einen Takt weiterlaufen lassen.
 *
 * NOETIG, WEIL `anmelden()` und `abmelden()` INTERN WEITER-AWAITEN: nach dem
 * `flush` der ersten Antwort geht die zweite Anfrage (/api/auth/state) erst im
 * naechsten Takt hinaus. Wer sie sofort erwartet, bekommt "Expected one
 * matching request, found none" — und sucht den Fehler im Dienst, obwohl er
 * im Test sitzt. Genau darueber ist der erste Lauf gestolpert.
 */
const takt = () => new Promise((r) => setTimeout(r, 0))

describe('AnmeldeDienst', () => {
  let dienst: AnmeldeDienst
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    })
    dienst = TestBed.inject(AnmeldeDienst)
    http = TestBed.inject(HttpTestingController)
  })

  afterEach(() => http.verify())

  it('faengt bewusst mit "nicht angemeldet" an', () => {
    // Andersherum blitzte die Oberflaeche kurz auf, bevor sie zurueckwirft.
    expect(dienst.lage()).toEqual(UNBEKANNT)
    expect(dienst.lage().angemeldet).toBe(false)
    expect(dienst.geprueft()).toBe(false)
  })

  it('uebernimmt die Lage, die das Backend meldet', async () => {
    const lauf = dienst.pruefen()
    const a = http.expectOne('/api/auth/state')
    expect(a.request.method).toBe('GET')
    a.flush({ anmeldungNoetig: false, angemeldet: true, passwortGesetzt: false })

    const lage = await lauf
    expect(lage.angemeldet).toBe(true)
    expect(dienst.lage().angemeldet).toBe(true)
    expect(dienst.geprueft()).toBe(true)
  })

  it('nimmt bei unerreichbarem Backend NICHT "angemeldet" an', async () => {
    // Die sicherheitsrelevante Zusage: ein Netzfehler darf die Verwaltung
    // nicht aufsperren. Faellt dieser Test, steht die Box offen, sobald das
    // Backend hustet.
    const lauf = dienst.pruefen()
    http.expectOne('/api/auth/state').error(new ProgressEvent('netzwerk'))

    const lage = await lauf
    expect(lage.angemeldet).toBe(false)
    expect(lage).toEqual(UNBEKANNT)
    // Auch im Fehlerfall gilt die Pruefung als erfolgt — sonst fragt die
    // Wache bei jedem Seitenwechsel neu und die Oberflaeche haengt.
    expect(dienst.geprueft()).toBe(true)
  })

  it('unterscheidet die Gruende beim Anmelden', async () => {
    const falsch = dienst.anmelden('daneben')
    http.expectOne('/api/auth/login').flush(null, { status: 401, statusText: 'Unauthorized' })
    expect(await falsch).toEqual({ ok: false, grund: 'falsch' })

    const weg = dienst.anmelden('egal')
    http.expectOne('/api/auth/login').error(new ProgressEvent('netzwerk'))
    expect(await weg).toEqual({ ok: false, grund: 'keine-verbindung' })

    const sonst = dienst.anmelden('egal')
    http.expectOne('/api/auth/login').flush(null, { status: 500, statusText: 'Serverfehler' })
    expect(await sonst).toEqual({ ok: false, grund: 'unbekannt' })
  })

  it('prueft nach erfolgreichem Anmelden den Zustand nach', async () => {
    // Nicht selbst "angemeldet" setzen, sondern das Backend fragen: nur so
    // kann die Oberflaeche nicht strenger ODER laxer werden als es.
    const lauf = dienst.anmelden('richtig')
    http.expectOne('/api/auth/login').flush({})
    await takt()
    http.expectOne('/api/auth/state').flush({
      anmeldungNoetig: true,
      angemeldet: true,
      passwortGesetzt: true,
    })
    expect(await lauf).toEqual({ ok: true })
    expect(dienst.lage().angemeldet).toBe(true)
  })

  it('setzt die Oberflaeche auch dann zurueck, wenn das Abmelden misslingt', async () => {
    const lauf = dienst.abmelden()
    http.expectOne('/api/auth/logout').error(new ProgressEvent('netzwerk'))
    await takt()
    http.expectOne('/api/auth/state').flush({
      anmeldungNoetig: true,
      angemeldet: false,
      passwortGesetzt: true,
    })
    await lauf
    expect(dienst.lage().angemeldet).toBe(false)
  })
})
