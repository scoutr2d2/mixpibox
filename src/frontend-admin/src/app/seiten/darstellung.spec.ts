/**
 * Tests fuer die Darstellungs-Seite nach dem Schnitt vom 05.09.2026:
 * EINE Oberflaeche, NUR WIRKSAME FELDER (Betreiber: „da kein altes
 * Theme-System mehr da, gibt es nur noch wirksame").
 *
 * Die Zwei-Schirm-Mechanik (NUR_NEU/NUR_KLASSISCH, zeigen/unwirksam,
 * „auch Unwirksames zeigen") ist gefallen — mit ihr die Tests, die vom
 * Wechsel zwischen klassisch und neu lebten. WELCHE Felder wirksam sind,
 * prueft `tools/darstellung-felder-wer.mjs --pruefen` (in tools/pruefen.sh
 * verdrahtet): jedes Interface-Feld braucht einen Leser in NewDesign/app.js,
 * jeder Format-Anker aus mixpi-thema.ts einen Regler. Hier steht, was der
 * Seite selbst gehoert: Reiterordnung, Vorgaben, Vorschau-Quelle.
 *
 * ANGEFASST WIRD DIE SEITE NICHT. Die geprueften Glieder sind `protected` —
 * zur Laufzeit gewoehnliche Eigenschaften. Der Zugriff laeuft ueber einen Typ,
 * der genau die hier benutzten Namen nennt, statt ueber ein pauschales `any`:
 * so faellt es auf, wenn eines davon verschwindet.
 */
import { TestBed } from '@angular/core/testing'
import { DarstellungSeite } from './darstellung'

/** Nur die Namen, die dieser Test benutzt — bewusst kein `any`. */
interface Innen {
  w: () => Record<string, unknown>
  reiter: () => { id: string; name: string }[]
  reiterAktiv: () => string
  reiterSetzen: (id: string) => void
  optikTeile: () => { id: string; name: string }[]
  optikTeil: { set: (id: string) => void }
  optikTeilEff: () => string
  erklaerungen: () => boolean
  erklaerungenUm: () => void
  quelle: () => unknown
}

const takt = () => new Promise((r) => setTimeout(r, 0))

describe('DarstellungSeite — eine Oberflaeche, nur wirksame Felder', () => {
  let innen: Innen
  let echtesFetch: typeof globalThis.fetch

  /**
   * Die Seite holt beim Aufbau ueber das globale `fetch` (nicht ueber
   * HttpClient) vier Dinge. Alle werden hier mit dem duennstmoeglichen
   * gueltigen Inhalt beantwortet — der Test handelt nicht von ihnen, aber ein
   * unbeantworteter Abruf laesst die Seite in einem Halbzustand stehen.
   */
  beforeEach(async () => {
    echtesFetch = globalThis.fetch
    globalThis.fetch = ((eingabe: RequestInfo | URL) => {
      const weg = String(eingabe)
      const antwort = (o: unknown) =>
        Promise.resolve(new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } }))
      if (weg.startsWith('/api/konfiguration')) return antwort({ felder: [] })
      if (weg.startsWith('/api/darstellung')) return antwort({ aktuell: null, themen: {} })
      if (weg.startsWith('/api/schirm/helligkeit')) return antwort({ da: false, grund: 'kein Panel' })
      if (weg.startsWith('/api/farbthema')) return antwort({ farben: {} })
      if (weg.startsWith('/neu/app.css')) return Promise.resolve(new Response(':root{--bg:#101014;}'))
      return Promise.resolve(new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
    }) as typeof globalThis.fetch

    TestBed.configureTestingModule({ imports: [DarstellungSeite] })
    const fixture = TestBed.createComponent(DarstellungSeite)
    innen = fixture.componentInstance as unknown as Innen
    await takt()
  })

  afterEach(() => {
    globalThis.fetch = echtesFetch
    localStorage.removeItem('mupibox_admin_darstellung_reiter')
  })

  it('traegt die E121-Vorgaben der Lese-Stellen, nicht die der alten Bar', () => {
    // STANDARD muss sagen, was app.js bei FEHLENDEM Feld tut — sonst zeigt
    // die Seite einen Zustand an, den die Box nicht hat. Die vier hier sind
    // die, bei denen die alte Angular-Vorgabe ANDERS war (endeZeit stand auf
    // true, kategorien auf 'reihe', btAkku hiess btAkkuArt 'prozent').
    const w = innen.w()
    expect(w['endeZeit']).withContext('endeZeit folgt w.endeZeit === true').toBe(false)
    expect(w['kategorien']).withContext('liste ist die Vorgabe der einen Leiste').toBe('liste')
    expect(w['btAkku']).withContext('btAkku aus, bis jemand Prozent will').toBe('aus')
    expect(w['albumTipp']).withContext('lanes ist der Ist-Zustand ohne Feld').toBe('lanes')
    expect(w['beimVerlassen']).withContext('weiter wie bisher').toBe('weiter')
    expect(w['startKategorie']).withContext('alle = kein Sprung').toBe('alle')
  })

  it('zeigt die Reiter der einen Oberflaeche — samt Verhalten, Optik zuerst', () => {
    const ids = innen.reiter().map((r) => r.id)
    expect(ids).toContain('verhalten')
    expect(ids).toContain('optik')
    expect(innen.reiter()[0].id).toBe('optik')
    expect(innen.reiterAktiv()).toBe('optik')
  })

  it('fuehrt Anzeigen als echte Gruppe — die Kopfzeile der neuen Oberflaeche', () => {
    // Bis zum 05.09.2026 trug die Gruppe nur Felder der gefallenen
    // Oberflaeche und wurde uebersprungen. Jetzt wohnen dort uhrzeit,
    // titelRest, schlummer, btAkku und die Standanzeigen.
    innen.optikTeil.set('anzeigen')
    expect(innen.optikTeilEff()).toBe('anzeigen')
  })

  it('faellt aus einer Gruppe zurueck, die es nicht gibt', () => {
    innen.optikTeil.set('gruppeDieEsNieGab')
    expect(innen.optikTeilEff()).toBe('mp')
  })

  it('zeigt im Rahmen die eine Oberflaeche', () => {
    expect(String(innen.quelle())).toContain('/neu/?vorschau=')
  })

  it('haelt die Farben bei der Optik, nicht in einem eigenen Reiter', () => {
    expect(innen.optikTeile().map((g) => g.id)).toContain('farben')
    expect(innen.reiter().map((r) => r.id)).withContext('kein eigener Reiter mehr').not.toContain('farben')
  })

  it('haelt die Erklaerungen ab Werk zurueck', () => {
    expect(innen.erklaerungen()).withContext('ab Werk aus').toBe(false)
    innen.erklaerungenUm()
    expect(innen.erklaerungen()).toBe(true)
    innen.erklaerungenUm()
    expect(innen.erklaerungen()).toBe(false)
  })
})
