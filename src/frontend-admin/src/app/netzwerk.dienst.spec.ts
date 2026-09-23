/**
 * Tests fuer den Netzwerk-Zugriff der Verwaltung.
 *
 * ZWEI ZUSAGEN, die hier festgenagelt werden, weil ihr Bruch teuer ist:
 *
 * 1. DAS BACKEND NENNT DEN GRUND. Sagt es „SSID zu lang" oder „verbotenes
 *    Zeichen", zeigt die Oberflaeche genau das — statt es durch ein eigenes
 *    „ungueltig" zu ersetzen, das niemandem weiterhilft. Wer den Fremdtext
 *    beim Aufraeumen wegwirft, macht die Fehlermeldung stumm, ohne dass ein
 *    Test es merkt.
 *
 * 2. `verbinden()` IST NOCH NICHT DAUERHAFT. Die Aenderung gilt nur, bis
 *    `bestaetigen()` sie festschreibt; bleibt das aus, rollt die Box zurueck.
 *    Deshalb traegt die Antwort mit, wie viele Sekunden bleiben — faellt der
 *    Wert weg, zeigt die Oberflaeche keinen Countdown und der Nutzer verliert
 *    das Netz, ohne zu wissen warum.
 */
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { TestBed } from '@angular/core/testing'
import { NetzwerkDienst } from './netzwerk.dienst'

describe('NetzwerkDienst', () => {
  let dienst: NetzwerkDienst
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    })
    dienst = TestBed.inject(NetzwerkDienst)
    http = TestBed.inject(HttpTestingController)
  })

  afterEach(() => http.verify())

  it('zeigt den Grund des Backends woertlich', async () => {
    const lauf = dienst.wlanHinterlegen('MeinNetz', 'kurz')
    http
      .expectOne('/api/netzwerk/wlan')
      .flush({ error: 'Das Passwort ist zu kurz (mindestens 8 Zeichen).' }, {
        status: 400,
        statusText: 'Bad Request',
      })
    expect(await lauf).toEqual({
      ok: false,
      grund: 'Das Passwort ist zu kurz (mindestens 8 Zeichen).',
    })
  })

  it('faellt auf eigene Texte zurueck, wenn das Backend keinen Grund nennt', async () => {
    const abgelaufen = dienst.wlanHinterlegen('N', 'p')
    http.expectOne('/api/netzwerk/wlan').flush(null, { status: 401, statusText: 'x' })
    expect(await abgelaufen).toEqual({ ok: false, grund: 'Die Anmeldung ist abgelaufen.' })

    const weg = dienst.wlanHinterlegen('N', 'p')
    http.expectOne('/api/netzwerk/wlan').error(new ProgressEvent('netzwerk'))
    expect(await weg).toEqual({ ok: false, grund: 'Die Box antwortet nicht.' })

    const sonst = dienst.wlanHinterlegen('N', 'p')
    http.expectOne('/api/netzwerk/wlan').flush(null, { status: 500, statusText: 'x' })
    expect(await sonst).toEqual({ ok: false, grund: 'Das Speichern ist fehlgeschlagen.' })
  })

  it('gibt bei der Suche eine leere Liste statt undefined', async () => {
    const lauf = dienst.suchen()
    http.expectOne('/api/netzwerk/scan').flush({})
    expect(await lauf).toEqual({ ok: true, netze: [] })
  })

  it('reicht das Zeitfenster zum Bestaetigen durch', async () => {
    const lauf = dienst.verbinden('MeinNetz', 'geheim123')
    http.expectOne('/api/netzwerk/verbinden').flush({ bestaetigenBis: 90, gesichert: true })
    expect(await lauf).toEqual({ ok: true, bestaetigenBis: 90, gesichert: true })
  })

  it('haelt ein Netz fuer gesichert, solange das Backend nicht ausdruecklich widerspricht', async () => {
    // `gesichert: a.gesichert !== false` — FEHLT das Feld, gilt "gesichert".
    // Andersherum waere es gefaehrlich: ein offenes Netz faelschlich als
    // gesichert zu melden ist harmlos, ein gesichertes als offen zu zeigen
    // laedt dazu ein, das Passwort wegzulassen.
    const ohneAngabe = dienst.verbinden('N', 'p')
    http.expectOne('/api/netzwerk/verbinden').flush({ bestaetigenBis: 30 })
    expect(await ohneAngabe).toEqual({ ok: true, bestaetigenBis: 30, gesichert: true })

    const offen = dienst.verbinden('N', '')
    http.expectOne('/api/netzwerk/verbinden').flush({ bestaetigenBis: 30, gesichert: false })
    expect(await offen).toEqual({ ok: true, bestaetigenBis: 30, gesichert: false })
  })

  it('meldet ein fehlendes Zeitfenster als 0 statt als undefined', async () => {
    const lauf = dienst.verbinden('N', 'p')
    http.expectOne('/api/netzwerk/verbinden').flush({})
    expect(await lauf).toEqual({ ok: true, bestaetigenBis: 0, gesichert: true })
  })

  it('bestaetigt allein dadurch, dass die Anfrage ankommt', async () => {
    const lauf = dienst.bestaetigen()
    const a = http.expectOne('/api/netzwerk/bestaetigen')
    expect(a.request.method).toBe('POST')
    a.flush({})
    expect(await lauf).toEqual({ ok: true })
  })

  it('nimmt fuer WPS 120 s an, wenn das Backend nichts sagt', async () => {
    const lauf = dienst.wps()
    http.expectOne('/api/netzwerk/wps').flush({})
    expect(await lauf).toEqual({ ok: true, fensterSek: 120 })
  })
})
