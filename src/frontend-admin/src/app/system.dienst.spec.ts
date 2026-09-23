/**
 * Tests fuer Systemzustand und Systemaktionen.
 *
 * DER HEIKLE PUNKT steht im Kopf von system.dienst.ts: bei Neustart und
 * Herunterfahren nimmt die Box genau den Prozess mit, der antworten soll. Ein
 * ausbleibender Rueckgabewert ist dort also KEIN Fehler. Der Dienst bildet das
 * ab, indem er nur 401 und 400 als echte Fehler benennt und alles andere
 * neutral als „Die Box hat nicht geantwortet." meldet.
 *
 * Genau diese Abstufung wird hier gehalten: wer sie beim Aufraeumen zu einem
 * schroffen „Fehlgeschlagen" zusammenzieht, laesst die Verwaltung nach jedem
 * geglueckten Neustart eine Fehlermeldung zeigen.
 */
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { TestBed } from '@angular/core/testing'
import { SystemDienst } from './system.dienst'

describe('SystemDienst', () => {
  let dienst: SystemDienst
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    })
    dienst = TestBed.inject(SystemDienst)
    http = TestBed.inject(HttpTestingController)
  })

  afterEach(() => http.verify())

  it('holt die Systemlage', async () => {
    const lauf = dienst.lage()
    const a = http.expectOne('/api/system')
    expect(a.request.method).toBe('GET')
    a.flush({ laufzeitSekunden: 42, kerne: 4, last: [0.1, 0.2, 0.3] })
    expect((await lauf).laufzeitSekunden).toBe(42)
  })

  it('kodiert die Kennung der Aktion in der Adresse', async () => {
    const lauf = dienst.ausloesen('neu starten')
    http.expectOne('/api/system/neu%20starten').flush({})
    expect(await lauf).toEqual({ ok: true })
  })

  it('benennt abgelaufene Anmeldung und unbekannte Aktion einzeln', async () => {
    const abgelaufen = dienst.ausloesen('reboot')
    http.expectOne('/api/system/reboot').flush(null, { status: 401, statusText: 'x' })
    expect(await abgelaufen).toEqual({ ok: false, grund: 'Die Anmeldung ist abgelaufen.' })

    const unbekannt = dienst.ausloesen('quatsch')
    http.expectOne('/api/system/quatsch').flush(null, { status: 400, statusText: 'x' })
    expect(await unbekannt).toEqual({ ok: false, grund: 'Diese Aktion gibt es nicht.' })
  })

  it('bleibt neutral, wenn die Box beim Neustart die Antwort mitnimmt', async () => {
    // KEIN schroffes "fehlgeschlagen": genau so sieht ein GEGLUECKTER Neustart
    // von hier aus. Der Satz muss offenlassen, was war.
    const lauf = dienst.ausloesen('reboot')
    http.expectOne('/api/system/reboot').error(new ProgressEvent('verbindung weg'))
    expect(await lauf).toEqual({ ok: false, grund: 'Die Box hat nicht geantwortet.' })
  })
})
