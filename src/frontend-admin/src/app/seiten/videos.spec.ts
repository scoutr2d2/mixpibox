/**
 * Tests fuer die Videos-Seite (Belohnungs-Videos).
 *
 * WAS HIER WIRKLICH SCHIEFGEHEN KANN, und deshalb geprueft wird:
 *
 *   1. ZWEI QUELLEN, ZWEI WEGE. Gesucht wird beim PLUGIN
 *      (`/api/plugins/mixpi-mediathek/http/suche`), freigegeben beim KERN
 *      (`/api/video/freigaben`). Wer das vertauscht, bekommt eine Seite, die
 *      sucht und nichts merkt — oder eine, die das ARD-Wissen in den Kern
 *      traegt. Beide Adressen stehen deshalb woertlich in einem Zeugen.
 *   2. DAS PROFIL MUSS AN JEDEN RUF. Eine Freigabe ohne `?profil=` landet
 *      beim aktiven Kind — und das ist beim Einstellen am Laptop fast nie
 *      das gemeinte. Genau dieser Fehler ist der Kinderzeit-Seite am
 *      08.08.2026 schon einmal passiert.
 *   3. DER REST WIRD GESETZT, NICHT DIE GESAMTZAHL. „+" auf einer Kachel mit
 *      „2×" schickt `rest: 3`, nicht `anzahl: 3`.
 *   4. DIE QUELLE MUSS MITREISEN (seit 20.09.2026). Es gibt zwei Mediatheken;
 *      wird beim Freigeben nicht gesagt, WELCHE geantwortet hat, fragt der
 *      Kern beim Start die falsche — und das Kind sieht „gibt es nicht mehr"
 *      bei einem Video, das es sich verdient hat.
 */
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { type ComponentFixture, TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { stueckeAus, VideosSeite, zeitText } from './videos'

interface Innen {
  profil: () => string
  schnitt: () => unknown
  schneiden: (t: unknown) => Promise<void>
  schnittAdresse: () => string
  marker: () => number[]
  markerSetzen: () => void
  markerWeg: () => void
  stand: (v?: number) => void
  dauer: (v?: number) => void
  stuecke: () => { abSek: number; bisSek: number; teil: string }[]
  stueckeFreigeben: (n: number) => Promise<void>
  dauerNehmen: (v: { duration: number }) => void
  standNehmen: (v: { currentTime: number }) => void
  quelle: () => string
  quelleWaehlen: (k: string) => void
  erweiterung: () => string
  freigaben: () => { kennung: string; rest: number }[]
  treffer: () => { kennung: string; name: string }[]
  meldung: () => string
  begriff: string
  suchen: () => Promise<void>
  freigeben: (t: unknown, anzahl: number) => Promise<void>
  restAendern: (f: unknown, um: number) => Promise<void>
  entziehen: (f: unknown) => Promise<void>
  profilWaehlen: (k: string) => Promise<void>
  prozent: () => number
}

const takt = () => new Promise((r) => setTimeout(r, 0))

const FREIGABE = {
  kennung: 'Y3JpZDovL3dkci5kZS9hYmM=',
  name: 'Klima-Maus Teil 6',
  sendung: 'Die Maus',
  bild: 'https://x/y.jpg',
  dauerSek: 1626,
  anzahl: 3,
  verbraucht: 1,
  rest: 2,
  angelegt: 0,
  zuletzt: 0,
}

describe('VideosSeite', () => {
  let http: HttpTestingController
  let fixture: ComponentFixture<VideosSeite>
  let innen: Innen

  /** Seite aufbauen und die beiden Abrufe des Konstruktors bedienen. */
  async function aufbauen(videos = [FREIGABE]): Promise<void> {
    fixture = TestBed.createComponent(VideosSeite)
    innen = fixture.componentInstance as unknown as Innen
    http.expectOne('/api/profile').flush({
      profile: [
        { kennung: 'kalea', name: 'Kalea' },
        { kennung: 'liam', name: 'Liam' },
      ],
      aktiv: 'liam',
    })
    await takt()
    http.expectOne('/api/video/freigaben?profil=liam').flush({
      videos,
      grenzen: { anzahlMax: 99, videosMax: 60, schwelle: 0.9 },
    })
    await takt()
    fixture.detectChanges()
  }

  beforeEach(() => {
    // KONFIGURIEREN UND ERST DANN INJIZIEREN: `TestBed.inject` baut das
    // Testmodul auf, und danach nimmt `configureTestingModule` nichts mehr
    // an („Cannot configure the test module when the test module has already
    // been instantiated"). Die Seite braucht den Router, weil sie auf die
    // Hoerzeit verweist.
    TestBed.configureTestingModule({
      imports: [VideosSeite],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    })
    http = TestBed.inject(HttpTestingController)
  })

  it('nimmt das AKTIVE Profil als Vorgabe, nicht das erste der Liste', async () => {
    await aufbauen()
    expect(innen.profil()).toBe('liam')
    expect(innen.freigaben().length).toBe(1)
  })

  it('haengt das Profil an JEDEN Ruf — auch beim Wechsel', async () => {
    await aufbauen()
    const wechsel = innen.profilWaehlen('kalea')
    await takt()
    http.expectOne('/api/video/freigaben?profil=kalea').flush({ videos: [] })
    await wechsel
    expect(innen.profil()).toBe('kalea')
    expect(innen.freigaben()).toEqual([])
  })

  it('sucht beim PLUGIN und nicht beim Kern', async () => {
    await aufbauen()
    innen.begriff = 'Maus'
    const lauf = innen.suchen()
    await takt()
    const r = http.expectOne('/api/plugins/mixpi-mediathek/http/suche?begriff=Maus&anzahl=24')
    expect(r.request.method).toBe('GET')
    r.flush({ treffer: [{ kennung: 'abc', name: 'Eine Folge', sendung: 'Die Maus', kinderinhalt: true }] })
    await lauf
    expect(innen.treffer().length).toBe(1)
  })

  it('geht bei einem zu kurzen Begriff gar nicht erst ins Netz', async () => {
    await aufbauen()
    innen.begriff = 'a'
    await innen.suchen()
    http.expectNone((r) => r.url.includes('suche'))
    expect(innen.meldung()).toContain('zwei Zeichen')
  })

  it('gibt beim KERN frei — mit Profil, Anzahl und den Angaben aus dem Treffer', async () => {
    await aufbauen()
    const t = { kennung: 'abc', name: 'Eine Folge', sendung: 'Die Maus', bild: 'https://b/i.jpg', dauerSek: 600 }
    const lauf = innen.freigeben(t, 3)
    await takt()
    const r = http.expectOne('/api/video/freigaben?profil=liam')
    expect(r.request.method).toBe('POST')
    expect(r.request.body.anzahl).toBe(3)
    expect(r.request.body.kennung).toBe('abc')
    expect(r.request.body.dauerSek).toBe(600)
    r.flush({ video: null })
    await takt()
    http.expectOne('/api/video/freigaben?profil=liam').flush({ videos: [FREIGABE] })
    await lauf
    expect(innen.meldung()).toContain('3×')
  })

  it('setzt beim Plus den REST auf rest+1 — nicht die Gesamtzahl', async () => {
    await aufbauen()
    const lauf = innen.restAendern(FREIGABE, 1)
    await takt()
    const r = http.expectOne('/api/video/freigaben?profil=liam')
    expect(r.request.method).toBe('PUT')
    expect(r.request.body.rest).toBe(3)
    expect(r.request.body.anzahl).toBeUndefined()
    r.flush({ video: null })
    await takt()
    http.expectOne('/api/video/freigaben?profil=liam').flush({ videos: [FREIGABE] })
    await lauf
  })

  it('geht beim Minus nie unter null', async () => {
    await aufbauen()
    const lauf = innen.restAendern({ ...FREIGABE, rest: 0 }, -1)
    await takt()
    const r = http.expectOne('/api/video/freigaben?profil=liam')
    expect(r.request.body.rest).toBe(0)
    r.flush({ video: null })
    await takt()
    http.expectOne('/api/video/freigaben?profil=liam').flush({ videos: [FREIGABE] })
    await lauf
  })

  it('spricht ein STUECK ueber seine id an, nicht ueber die Videokennung', async () => {
    // Drei Stuecke tragen dreimal dieselbe Videokennung. Ohne die id traefe
    // „Weg" auf Teil 2 irgendeines der drei.
    const STUECK = { ...FREIGABE, id: 't500-1000-abc', teil: 'Teil 2', abSek: 500, bisSek: 1000, laengeSek: 500 }
    await aufbauen([STUECK])
    const lauf = innen.entziehen(STUECK)
    await takt()
    const r = http.expectOne('/api/video/entziehen?profil=liam')
    expect(r.request.body.id).toBe('t500-1000-abc')
    r.flush({ entzogen: 't500-1000-abc' })
    await takt()
    http.expectOne('/api/video/freigaben?profil=liam').flush({ videos: [] })
    await lauf
  })

  it('entzieht ueber den eigenen Weg und laedt danach neu', async () => {
    await aufbauen()
    const lauf = innen.entziehen(FREIGABE)
    await takt()
    const r = http.expectOne('/api/video/entziehen?profil=liam')
    expect(r.request.method).toBe('POST')
    expect(r.request.body.kennung).toBe(FREIGABE.kennung)
    r.flush({ entzogen: FREIGABE.kennung })
    await takt()
    http.expectOne('/api/video/freigaben?profil=liam').flush({ videos: [] })
    await lauf
    expect(innen.freigaben()).toEqual([])
  })

  it('sagt es, wenn die Erweiterung nicht antwortet — statt still nichts zu zeigen', async () => {
    await aufbauen()
    innen.begriff = 'Maus'
    const lauf = innen.suchen()
    await takt()
    http
      .expectOne('/api/plugins/mixpi-mediathek/http/suche?begriff=Maus&anzahl=24')
      .flush({ fehler: 'aus' }, { status: 404, statusText: 'weg' })
    await lauf
    expect(innen.treffer()).toEqual([])
    expect(innen.meldung()).toContain('ARD Mediathek')
  })

  it('nimmt die Schwelle vom Server, statt sie abzuschreiben', async () => {
    await aufbauen()
    expect(innen.prozent()).toBe(90)
  })

  afterEach(() => {
    http.verify()
  })

  /* ══ ZWEI MEDIATHEKEN (20.09.2026) ═════════════════════════════════════ */

  it('sucht in der Mediathek, die gewaehlt ist', async () => {
    await aufbauen()
    innen.quelleWaehlen('mixpi-mediathekview')
    expect(innen.quelle()).toBe('mixpi-mediathekview')
    innen.begriff = 'Löwenzahn'
    const lauf = innen.suchen()
    await takt()
    const r = http.expectOne('/api/plugins/mixpi-mediathekview/http/suche?begriff=L%C3%B6wenzahn&anzahl=24')
    r.flush({ treffer: [{ kennung: 'WkRGHkzDtndlbnphaG4eRm9sZ2U', name: 'Folge', sendung: 'Löwenzahn', sender: 'ZDF' }] })
    await lauf
    expect(innen.treffer().length).toBe(1)
  })

  it('schickt die gewaehlte Quelle mit der Freigabe an den Kern', async () => {
    await aufbauen()
    innen.quelleWaehlen('mixpi-mediathekview')
    const t = { kennung: 'WkRG', name: 'Folge', sendung: 'Löwenzahn' }
    const lauf = innen.freigeben(t, 1)
    await takt()
    const r = http.expectOne('/api/video/freigaben?profil=liam')
    expect(r.request.body.quelle).toBe('mixpi-mediathekview')
    r.flush({ video: null })
    await takt()
    http.expectOne('/api/video/freigaben?profil=liam').flush({ videos: [] })
    await lauf
  })

  it('nennt auch ohne Wechsel eine Quelle — sonst raet der Kern', async () => {
    await aufbauen()
    const lauf = innen.freigeben({ kennung: 'abc', name: 'Folge', sendung: 'Die Maus' }, 1)
    await takt()
    const r = http.expectOne('/api/video/freigaben?profil=liam')
    expect(r.request.body.quelle).toBe('mixpi-mediathek')
    r.flush({ video: null })
    await takt()
    http.expectOne('/api/video/freigaben?profil=liam').flush({ videos: [] })
    await lauf
  })

  it('leert beim Wechsel die Trefferliste', async () => {
    // Stehengelassene Kacheln saehen aus wie Treffer der neuen Quelle, und
    // ein Knopf darauf gaebe ein Video der alten frei.
    await aufbauen()
    innen.begriff = 'Maus'
    const lauf = innen.suchen()
    await takt()
    http.expectOne('/api/plugins/mixpi-mediathek/http/suche?begriff=Maus&anzahl=24').flush({
      treffer: [{ kennung: 'abc', name: 'Eine Folge', sendung: 'Die Maus', kinderinhalt: true }],
    })
    await lauf
    expect(innen.treffer().length).toBe(1)
    innen.quelleWaehlen('mixpi-mediathekview')
    expect(innen.treffer()).toEqual([])
  })

  it('nennt in der Fehlermeldung die Erweiterung, die gemeint ist', async () => {
    await aufbauen()
    innen.quelleWaehlen('mixpi-mediathekview')
    expect(innen.erweiterung()).toBe('Mediatheken')
    innen.begriff = 'Maus'
    const lauf = innen.suchen()
    await takt()
    http.expectOne((q) => q.url.includes('mixpi-mediathekview')).error(new ProgressEvent('aus'))
    await lauf
    expect(innen.meldung()).toContain('Mediatheken')
  })
})

describe('stueckeAus — Marker werden zu Stuecken', () => {
  it('ein Marker macht ZWEI Stuecke, nicht eines', () => {
    // Ein Marker ist ein SCHNITT und keine Auswahlgrenze: wer bei Minute 8
    // schneidet, meint davor UND danach.
    const s = stueckeAus([480], 1500)
    expect(s.length).toBe(2)
    expect(s[0]).toEqual({ abSek: 0, bisSek: 480, teil: 'Teil 1' })
    expect(s[1]).toEqual({ abSek: 480, bisSek: 1500, teil: 'Teil 2' })
  })

  it('sortiert, rundet und entdoppelt', () => {
    // Gedrueckt wird in der Reihenfolge des Findens, nicht der Zeit; und
    // `currentTime` ist eine Kommazahl.
    const s = stueckeAus([900.4, 300.6, 900.2], 1500)
    expect(s.map((x) => x.abSek)).toEqual([0, 301, 900])
    expect(s.length).toBe(3)
  })

  it('wirft zu kurze Stuecke weg', () => {
    // Ein Marker bei Sekunde 2 ist ein Verdrueckt, kein Stueck.
    const s = stueckeAus([2, 750], 1500)
    expect(s.length).toBe(2)
    expect(s[0].bisSek).toBe(750)
  })

  it('ohne Marker gibt es KEINE Stuecke — das waere ein ganzes Video', () => {
    expect(stueckeAus([], 1500)).toEqual([])
    // Marker ausserhalb der Datei zaehlen nicht.
    expect(stueckeAus([1500, 9000], 1500)).toEqual([])
  })

  it('ohne Dauer wird nichts geschnitten', () => {
    // Ohne Ende gaebe es ein Stueck ohne Ende — und eines, das nie zu Ende
    // gesehen werden kann.
    expect(stueckeAus([100], 0)).toEqual([])
  })

  it('zeitText schreibt Minuten und Sekunden', () => {
    expect(zeitText(0)).toBe('0:00')
    expect(zeitText(75)).toBe('1:15')
    expect(zeitText(-5)).toBe('0:00')
  })
})

describe('VideosSeite — teilen', () => {
  let http: HttpTestingController
  let fixture: ComponentFixture<VideosSeite>
  let innen: Innen

  async function aufbauen(): Promise<void> {
    fixture = TestBed.createComponent(VideosSeite)
    innen = fixture.componentInstance as unknown as Innen
    http.expectOne('/api/profile').flush({ profile: [{ kennung: 'liam', name: 'Liam' }], aktiv: 'liam' })
    await takt()
    http.expectOne('/api/video/freigaben?profil=liam').flush({ videos: [] })
    await takt()
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [VideosSeite],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    })
    http = TestBed.inject(HttpTestingController)
  })

  const TREFFER = { kennung: 'Y3JpZDovL3dkci5kZS9hYmM=', name: 'Klima-Maus', sendung: 'Die Maus', dauerSek: 1500 }

  it('holt die Vorschau-Adresse beim PLUGIN, nicht beim Kern', async () => {
    await aufbauen()
    const lauf = innen.schneiden(TREFFER)
    await takt()
    const r = http.expectOne(`/api/plugins/mixpi-mediathek/http/video/${encodeURIComponent(TREFFER.kennung)}`)
    expect(r.request.method).toBe('GET')
    r.flush({ ok: true, quelle: { adresse: 'https://x/y.mp4' }, dauerSek: 1626 })
    await lauf
    expect(innen.schnittAdresse()).toBe('https://x/y.mp4')
    // DIE DAUER DER DATEI SCHLAEGT DIE DER SUCHE.
    expect(innen.stuecke()).toEqual([])
  })

  it('nimmt die Dauer aus der Datei, wenn sie da ist', async () => {
    await aufbauen()
    const lauf = innen.schneiden(TREFFER)
    await takt()
    http.expectOne((q) => q.url.includes('/http/video/')).flush({ ok: true, quelle: { adresse: 'https://x/y.mp4' } })
    await lauf
    innen.dauerNehmen({ duration: 1626.7 })
    innen.standNehmen({ currentTime: 500.2 })
    innen.markerSetzen()
    expect(innen.marker().length).toBe(1)
    expect(innen.stuecke()).toEqual([
      { abSek: 0, bisSek: 500, teil: 'Teil 1' },
      { abSek: 500, bisSek: 1626, teil: 'Teil 2' },
    ])
    innen.markerWeg()
    expect(innen.stuecke()).toEqual([])
  })

  it('gibt jedes Stueck EINZELN frei — mit Schnitt, Teilnamen und Quelle', async () => {
    await aufbauen()
    // AUSDRUECKLICH DIE ANDERE MEDIATHEK: mit der Vorgabe saehe man nicht,
    // ob die Quelle wirklich mitreist oder nur zufaellig stimmt.
    innen.quelleWaehlen('mixpi-mediathekview')
    const lauf = innen.schneiden(TREFFER)
    await takt()
    http.expectOne((q) => q.url.includes('/http/video/')).flush({
      ok: true,
      quelle: { adresse: 'https://x/y.mp4' },
      dauerSek: 1500,
    })
    await lauf
    innen.standNehmen({ currentTime: 500 })
    innen.markerSetzen()
    innen.standNehmen({ currentTime: 1000 })
    innen.markerSetzen()
    expect(innen.stuecke().length).toBe(3)

    const geben = innen.stueckeFreigeben(2)
    // DREI RUFE, NACHEINANDER: der Kern schreibt die Ablage bei jedem ganz.
    for (const [i, [ab, bis]] of [[0, 500], [500, 1000], [1000, 1500]].entries()) {
      await takt()
      const r = http.expectOne('/api/video/freigaben?profil=liam')
      expect(r.request.body.abSek).toBe(ab)
      expect(r.request.body.bisSek).toBe(bis)
      expect(r.request.body.teil).toBe(`Teil ${i + 1}`)
      expect(r.request.body.anzahl).toBe(2)
      expect(r.request.body.quelle).toBe('mixpi-mediathekview')
      expect(r.request.body.kennung).toBe(TREFFER.kennung)
      r.flush({ video: null })
    }
    await takt()
    http.expectOne('/api/video/freigaben?profil=liam').flush({ videos: [] })
    await geben
    expect(innen.schnitt()).toBe(null)
  })

  it('sagt, WIE VIELE Teile durchkamen, wenn einer scheitert', async () => {
    // Was schon drin ist, bleibt drin — eine glatte Fehlermeldung liesse
    // jemanden alles noch einmal anlegen.
    await aufbauen()
    const lauf = innen.schneiden(TREFFER)
    await takt()
    http.expectOne((q) => q.url.includes('/http/video/')).flush({
      ok: true,
      quelle: { adresse: 'https://x/y.mp4' },
      dauerSek: 1500,
    })
    await lauf
    innen.standNehmen({ currentTime: 700 })
    innen.markerSetzen()
    const geben = innen.stueckeFreigeben(1)
    await takt()
    http.expectOne('/api/video/freigaben?profil=liam').flush({ video: null })
    await takt()
    http.expectOne('/api/video/freigaben?profil=liam').error(new ProgressEvent('aus'))
    await takt()
    http.expectOne('/api/video/freigaben?profil=liam').flush({ videos: [] })
    await geben
    expect(innen.meldung()).toContain('1 von 2')
  })
})
