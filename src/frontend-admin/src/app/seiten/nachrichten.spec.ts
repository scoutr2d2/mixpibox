/**
 * Tests für die Nachrichten-Seite.
 *
 * Der Kopf von nachrichten.ts gibt Zusagen, die man dem Code nicht ansieht —
 * hier werden sie geprüft:
 *
 *   1. EIN EINTRAG KOMMT ERST IN DIE LISTE, WENN DIE BOX IHN GENOMMEN HAT.
 *      Die Gegenrichtung zeigte eine Freigabe an, die es auf der Box nicht
 *      gibt — danach wartet jemand auf eine Nachricht, die nie kommt.
 *   2. DER SATZ DER BOX WIRD WÖRTLICH GEZEIGT. „Ging nicht" hilft niemandem;
 *      „die Nummer muss international geschrieben sein" schon.
 *   3. DREI STUFEN JE KIND, und „wie die Box" ist eine eigene davon: sie
 *      schickt `null`, nicht `false`.
 *   4. EIN ABGEWIESENER ABSENDER WIRD GEZEIGT, EINE LEERE ZÄHLUNG NICHT.
 */
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { type ComponentFixture, TestBed } from '@angular/core/testing'
import { NachrichtenSeite } from './nachrichten'
import type { Stand } from '../nachrichten.dienst'

const STAND: Stand = {
  an: true,
  wege: {
    matrix: { an: true, laeuft: true, zuletzt: 0, fehler: '' },
    signal: { an: false, laeuft: false, zuletzt: 0, fehler: '' },
    telegram: { an: false, laeuft: false, zuletzt: 0, fehler: '' },
  },
  abgewiesen: { matrix: { anzahl: 3, zuletzt: '@fremd:server.example', wann: 1 } },
  erlaubte: 1,
  vorlesen: true,
  signalDa: null,
}

describe('Nachrichten-Seite', () => {
  let fixture: ComponentFixture<NachrichtenSeite>
  let seite: NachrichtenSeite
  let http: HttpTestingController

  /**
   * Die vier Rufe beantworten, die `holen()` gleichzeitig absetzt.
   *
   * ASYNCHRON, UND DAS IST KEIN SCHNOERKEL: `holen()` wartet auf ein
   * `Promise.all`. Ein `flush()` ist synchron, die Aufloesung der Promise
   * aber erst eine Mikrotask spaeter — ohne das `await` liest der Test die
   * Signale, bevor sie gesetzt sind, und meldet leere Listen.
   */
  async function ersteLadung(erlaubt: { weg: string; absender: string }[] = []): Promise<void> {
    http.expectOne('/api/nachrichten/stand').flush(STAND)
    http.expectOne('/api/nachrichten/erlaubt').flush({ erlaubt, verworfen: 0 })
    http.expectOne('/api/nachrichten').flush({ nachrichten: [], ungelesen: 0, vorlesen: true })
    http.expectOne('/api/profile').flush({
      profile: [
        { kennung: 'gast', name: 'Gast' },
        { kennung: 'kalea', name: 'Kalea', nachrichtenVorlesen: false },
      ],
    })
    await fixture.whenStable()
    fixture.detectChanges()
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NachrichtenSeite],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents()
    fixture = TestBed.createComponent(NachrichtenSeite)
    seite = fixture.componentInstance
    http = TestBed.inject(HttpTestingController)
    fixture.detectChanges()
  })

  afterEach(() => http.verify())

  it('zeigt den Stand der drei Wege und die Zählung der Abgewiesenen', async () => {
    await ersteLadung()
    expect(seite.wege().map((w) => w.weg)).toEqual(['matrix', 'signal', 'telegram'])
    expect(seite.wege()[0].lage.an).toBe(true)
    // NUR WER WIRKLICH GEKLOPFT HAT: eine leere Zählung ist keine Meldung.
    expect(seite.abgewiesen().length).toBe(1)
    expect(seite.abgewiesen()[0].anzahl).toBe(3)
  })

  it('NIMMT EINEN EINTRAG ERST NACH DEM JA DER BOX in die Liste', async () => {
    await ersteLadung()
    seite.neuWeg.set('matrix')
    seite.neuAbsender.set('@mama:server.example')
    const lauf = seite.hinzufuegen()

    const put = http.expectOne({ method: 'PUT', url: '/api/nachrichten/erlaubt' })
    expect(put.request.body.erlaubt.length).toBe(1)
    put.flush({ ok: true })
    // ERST STABIL WERDEN LASSEN: `setzen()` setzt die zweite Ladung erst ab,
    // nachdem die Antwort auf das PUT durch ist.
    await fixture.whenStable()
    // Die Liste kommt aus der NEUEN Ladung, nicht aus dem Eingabefeld.
    await ersteLadung([{ weg: 'matrix', absender: '@mama:server.example' }])
    await lauf
    expect(seite.liste().length).toBe(1)
    expect(seite.neuAbsender()).toBe('')
  })

  it('ZEIGT DEN SATZ DER BOX WÖRTLICH und lässt die Eingabe stehen', async () => {
    await ersteLadung()
    seite.neuWeg.set('signal')
    seite.neuAbsender.set('0170 0000000')
    const lauf = seite.hinzufuegen()
    http
      .expectOne({ method: 'PUT', url: '/api/nachrichten/erlaubt' })
      .flush({ grund: 'signal', satz: 'Die Nummer muss international geschrieben sein.', zeile: 0 }, { status: 400, statusText: 'Bad Request' })
    await lauf
    expect(seite.listenSatz()).toBe('Die Nummer muss international geschrieben sein.')
    // NICHTS GELADEN, NICHTS GELEERT: wer den Eintrag korrigieren will, soll
    // ihn nicht noch einmal tippen müssen.
    expect(seite.neuAbsender()).toBe('0170 0000000')
    expect(seite.liste().length).toBe(0)
  })

  it('„Wie die Box" schickt null — nicht false', async () => {
    await ersteLadung()
    const lauf = seite.vorlesen({ kennung: 'kalea', name: 'Kalea', nachrichtenVorlesen: false }, null)
    const post = http.expectOne({ method: 'POST', url: '/api/profil/nachrichten-vorlesen' })
    expect(post.request.body).toEqual({ kennung: 'kalea', wert: null })
    post.flush({ ok: true })
    await fixture.whenStable()
    await ersteLadung()
    await lauf
  })

  it('sagt „noch nie etwas", statt eine Zeit zu erfinden', async () => {
    await ersteLadung()
    expect(seite.wann(0)).toBe('noch nie etwas')
    expect(seite.wann(Date.now() - 5 * 60_000)).toBe('vor 5 min')
    expect(seite.wann(Date.now() - 5 * 3_600_000)).toBe('vor 5 h')
  })
})
