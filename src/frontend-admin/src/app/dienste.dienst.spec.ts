/**
 * Tests fuer den Dienste-Zugriff der Verwaltung.
 *
 * WAS HIER WIRKLICH AUF DEM SPIEL STEHT: nicht die Uebermittlung — die ist
 * duenn und absichtlich dumm —, sondern die FEHLERTEXTE. Wenn ein Dienst sich
 * nicht schalten laesst, ist dieser Satz alles, was jemand vor sich hat. „Die
 * Aktion ist fehlgeschlagen" bei einer abgelaufenen Anmeldung schickt einen
 * auf die Suche nach einem Dienstfehler, den es nicht gibt.
 *
 * Deshalb wird hier jede Zuordnung einzeln festgenagelt.
 */
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { TestBed } from '@angular/core/testing'
import { DiensteDienst } from './dienste.dienst'

describe('DiensteDienst', () => {
  let dienst: DiensteDienst
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    })
    dienst = TestBed.inject(DiensteDienst)
    http = TestBed.inject(HttpTestingController)
  })

  afterEach(() => http.verify())

  it('reicht die Liste durch, wie sie kommt', async () => {
    const lauf = dienst.liste()
    const a = http.expectOne('/api/dienste')
    expect(a.request.method).toBe('GET')
    a.flush({ dienste: [{ name: 'librespot', titel: 'Spotify', aktiv: true }] })

    const antwort = await lauf
    expect(antwort.dienste.length).toBe(1)
    expect(antwort.dienste[0]?.name).toBe('librespot')
  })

  it('kodiert den Dienstnamen in der Adresse', async () => {
    // Ein Name mit Leerzeichen oder Schraegstrich darf den Pfad nicht
    // aufbrechen. Ungeprueft faellt so etwas erst auf, wenn es einen solchen
    // Dienst gibt — und dann sieht es aus wie ein Backend-Fehler.
    const lauf = dienst.schalten('mupi box@1', 'restart')
    http.expectOne('/api/dienste/mupi%20box%401/restart').flush({ ok: true, dienste: [] })
    expect(await lauf).toEqual({ ok: true, dienste: [] })
  })

  it('kommt ohne Dienstliste in der Antwort zurecht', async () => {
    const lauf = dienst.schalten('librespot', 'stop')
    http.expectOne('/api/dienste/librespot/stop').flush({ ok: true })
    expect(await lauf).toEqual({ ok: true, dienste: [] })
  })

  it('nennt bei jedem Fehlschlag den passenden Grund', async () => {
    const faelle: Array<[number, string]> = [
      [401, 'Die Anmeldung ist abgelaufen.'],
      [404, 'Diesen Dienst gibt es auf der Box nicht.'],
      [503, 'Die Dienstverwaltung antwortet nicht.'],
      [500, 'Die Aktion ist fehlgeschlagen.'],
    ]
    for (const [status, grund] of faelle) {
      const lauf = dienst.schalten('librespot', 'start')
      http
        .expectOne('/api/dienste/librespot/start')
        .flush(null, { status, statusText: String(status) })
      expect(await lauf).toEqual({ ok: false, grund }, `bei HTTP ${status}`)
    }
  })

  it('unterscheidet "Box antwortet nicht" von einem Serverfehler', async () => {
    const lauf = dienst.schalten('librespot', 'start')
    http.expectOne('/api/dienste/librespot/start').error(new ProgressEvent('netzwerk'))
    expect(await lauf).toEqual({ ok: false, grund: 'Die Box antwortet nicht.' })
  })
})
