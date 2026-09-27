/**
 * Die zentrale Suche der Medien-Seite — ihre drei Zusagen (29.08.2026).
 *
 * Die Seite hatte FUENF Suchfelder mit je eigenem Wirkungskreis; der
 * Betreiber wollte EIN Feld oben. Das Feld gibt drei Zusagen, die man dem
 * Template nicht ansieht:
 *
 *   1. TIPPEN SPEIST ALLE OERTLICHEN SIEBE — Bibliothek, Regal, Sender,
 *      Archiv-Feld und den Meta-Suchtext. Wer tippt, filtert ueberall
 *      zugleich; kein Kasten bleibt heimlich auf dem alten Wort stehen.
 *   2. ERST ENTER GEHT ANS NETZ — Dienste- und Archiv-Suche feuern nicht
 *      je Tastendruck (das Archiv ist eine fremde Schnittstelle), und ein
 *      leeres Feld feuert gar nicht.
 *   3. DIE SENDER SPIELEN MIT — sie liegen erst nach dem ersten Abruf im
 *      Browser; der erste Enter holt sie einmalig nach, ein zweiter holt
 *      sie NICHT erneut.
 *
 * ANGEFASST WIRD DIE SEITE NICHT: Zugriff ueber einen Typ, der genau die
 * gepruefte Oberflaeche nennt (Muster aus kinderzeit.spec.ts) — verschwindet
 * eines der Glieder, faellt es hier auf, nicht erst am Geraet.
 */
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { type ComponentFixture, TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { MedienSeite } from './medien'

/** Nur die Namen, die dieser Test benutzt — bewusst kein `any`. */
interface Innen {
  zentral: () => string
  zentralTippen: (wert: string) => void
  zentralSuchen: () => void
  filter: string
  suchtext: string
  senderSuche: () => string
  regalSuche: () => string
  archivSuche: () => string
  senderGesamt: (() => number) & { set: (n: number) => void }
}

describe('Medien: die zentrale Suche', () => {
  let fixture: ComponentFixture<MedienSeite>
  let innen: Innen
  let http: HttpTestingController

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MedienSeite],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents()
    fixture = TestBed.createComponent(MedienSeite)
    fixture.detectChanges()
    innen = fixture.componentInstance as unknown as Innen
    http = TestBed.inject(HttpTestingController)
    // Die Startladungen der Seite (Bibliothek, Listen, Profile, …) sind hier
    // nicht Gegenstand — leer beantworten, damit der Zaehler danach bei null
    // steht und jede weitere Anfrage eine AUSSAGE dieses Tests ist.
    for (const anfrage of http.match(() => true)) anfrage.flush({})
  })

  afterEach(() => {
    // Absichtlich KEIN http.verify(): die Seite laedt im Hintergrund nach
    // (Verfuegbarkeit, Vorspann), und dieser Test prueft die Suche, nicht
    // den Startablauf. Offene Anfragen raeumt jeder Fall selbst ab.
    for (const anfrage of http.match(() => true)) anfrage.flush({})
  })

  it('Tippen speist alle oertlichen Siebe zugleich', () => {
    innen.zentralTippen('maus')
    expect(innen.zentral()).toBe('maus')
    expect(innen.filter).toBe('maus')
    expect(innen.senderSuche()).toBe('maus')
    expect(innen.regalSuche()).toBe('maus')
    expect(innen.archivSuche()).toBe('maus')
    expect(innen.suchtext).toBe('maus')
    // … und geht dabei NICHT ans Netz.
    expect(http.match(() => true).length).toBe(0)
  })

  it('Enter auf leerem Feld feuert nichts', () => {
    innen.zentralTippen('   ')
    innen.zentralSuchen()
    expect(http.match(() => true).length).toBe(0)
  })

  it('Enter feuert Dienste- und Archiv-Suche und holt die Sender einmalig nach', () => {
    innen.zentralTippen('maus')
    innen.zentralSuchen()
    const dienste = http.match((a) => a.url === '/api/medien/suche')
    expect(dienste.length).toBe(1)
    expect(dienste[0].request.params.get('q')).toBe('maus')
    expect(http.match((a) => a.url.includes('mixpi-archive')).length).toBe(1)
    expect(http.match((a) => a.url.includes('mixpi-ardsounds')).length).toBe(1)
  })

  it('Sender werden nicht erneut geholt, wenn sie schon da sind', () => {
    innen.senderGesamt.set(195)
    innen.zentralTippen('maus')
    innen.zentralSuchen()
    expect(http.match((a) => a.url.includes('mixpi-ardsounds')).length).toBe(0)
    // Die zwei Netz-Suchen feuern trotzdem.
    expect(http.match((a) => a.url === '/api/medien/suche').length).toBe(1)
    expect(http.match((a) => a.url.includes('mixpi-archive')).length).toBe(1)
  })
})
