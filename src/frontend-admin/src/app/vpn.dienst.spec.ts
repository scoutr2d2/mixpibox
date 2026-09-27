/**
 * Tests für den VPN-Zugriff der Verwaltung.
 *
 * Dieselbe Zusage wie beim Netzwerk-Dienst: DAS BACKEND NENNT DEN GRUND.
 * Seine Fehlertexte erklären den Weg („beim Export auf der FRITZ!Box …
 * abwählen") — ersetzt die Oberfläche sie durch ein eigenes „fehlgeschlagen",
 * steht der Mensch vor einer Wand. Und die Hinweise beim Übernehmen (DNS
 * gestrichen, Keepalive ergänzt) müssen ankommen, nicht verschluckt werden.
 */
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { TestBed } from '@angular/core/testing'
import { VpnDienst } from './vpn.dienst'

describe('VpnDienst', () => {
  let dienst: VpnDienst
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    })
    dienst = TestBed.inject(VpnDienst)
    http = TestBed.inject(HttpTestingController)
  })

  afterEach(() => http.verify())

  it('reicht beim Übernehmen Beschreibung UND Hinweise durch', async () => {
    const lauf = dienst.uebernehmen('[Interface]…')
    http.expectOne('/api/vpn/konfiguration').flush({
      ok: true,
      konfiguration: { endpunkt: 'x.myfritz.net:51820', erlaubteNetze: ['192.168.178.0/24'] },
      hinweise: ['DNS-Zeile gestrichen (192.168.178.1): …'],
      neuGestartet: false,
    })
    const a = await lauf
    expect(a.ok).toBeTrue()
    if (!a.ok) return
    expect(a.konfiguration.endpunkt).toBe('x.myfritz.net:51820')
    expect(a.hinweise.length).toBe(1)
  })

  it('zeigt den Grund des Backends wörtlich — er nennt den Export-Weg', async () => {
    const grund = 'Diese Datei schickt ALLES durch den Tunnel (AllowedIPs 0.0.0.0/0) — … auf der FRITZ!Box … ABWÄHLEN …'
    const lauf = dienst.uebernehmen('[Interface]…')
    http.expectOne('/api/vpn/konfiguration').flush({ error: grund }, { status: 400, statusText: 'Bad Request' })
    expect(await lauf).toEqual({ ok: false, grund })
  })

  it('fällt auf eigene Texte zurück, wenn das Backend keinen Grund nennt', async () => {
    const abgelaufen = dienst.schalten({ an: true })
    http.expectOne('/api/vpn/aktiv').flush(null, { status: 401, statusText: 'x' })
    expect(await abgelaufen).toEqual({ ok: false, grund: 'Die Anmeldung ist abgelaufen.' })

    const weg = dienst.lageSicher()
    http.expectOne('/api/vpn').error(new ProgressEvent('netzwerk'))
    expect(await weg).toEqual({ ok: false, grund: 'Die Box antwortet nicht.' })
  })

  it('schaltet mit GENAU dem gewünschten Teil — an lässt beimStart in Ruhe', async () => {
    const lauf = dienst.schalten({ an: false })
    const anfrage = http.expectOne('/api/vpn/aktiv')
    expect(anfrage.request.body).toEqual({ an: false })
    anfrage.flush({ ok: true, einheit: { aktiv: false, beimStart: true }, tunnel: { da: false } })
    const a = await lauf
    expect(a.ok).toBeTrue()
    if (!a.ok) return
    expect(a.einheit.beimStart).toBeTrue()
  })
})
