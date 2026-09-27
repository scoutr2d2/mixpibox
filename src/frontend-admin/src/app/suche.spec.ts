/**
 * Tests fuer das Suchfeld der Verwaltung — im echten Browser, mit Vorlage.
 *
 * WARUM NEBEN suche.filter.spec.ts NOCH DIESE DATEI: Dort steht, was gefunden
 * wird; hier steht, ob man es auch SIEHT. Die zweite Zusage des Auftrags —
 * „der Treffer nennt die Seite, statt nur hinzuspringen" — liegt vollstaendig
 * in der Vorlage. Sie ist keine Entscheidungsregel und faellt deshalb durch
 * jedes Filter-spec hindurch: das Filter kann tadellos sortieren, waehrend die
 * Spalte mit dem Ort gar nicht gezeichnet wird.
 *
 * DER ZWEITE GRUND ist der Nachschlag bei der Box. Die Felder der
 * Konfigurationsseite entstehen erst zur Laufzeit; die Suche holt sie SELBST
 * bei /api/konfiguration. Daran haengen drei Dinge, die man dem Code nicht
 * ansieht: dass der Abruf nicht schon beim Laden jeder Seite passiert, dass er
 * sich nicht bei jedem Tastendruck wiederholt, und dass ein Fehlschlag die
 * Suche nicht mitreisst — ein Suchfeld darf nie der Grund sein, warum eine
 * Seite meckert.
 */
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { type ComponentFixture, TestBed } from '@angular/core/testing'
import { provideRouter, Router } from '@angular/router'
import { SUCH_BESTAND } from './such-bestand'
import { AKTION_ORT, Suche } from './suche'

const takt = () => new Promise((r) => setTimeout(r, 0))

/** Die Antwort der Box, gekuerzt auf das, was die Suche daraus liest. */
const FELDER = {
  felder: [
    { id: 'maxVolume', titel: 'Höchste Lautstärke', hinweis: 'Weiter dreht die Box nicht auf.' },
    { id: 'host', titel: 'Name der Box', hinweis: 'Zugleich der Name bei Spotify Connect.' },
  ],
}

/**
 * Was GET /api/system an Aktionen herausgibt — gekuerzt auf das, was die Suche
 * liest. Wortlaut und `bereich` stehen so in AKTIONEN
 * (backend-api/src/system.ts); die Attrappe bildet BEIDE Bereiche ab, damit
 * nicht nur der eine Weg geprueft ist.
 */
const AKTIONEN = {
  aktionen: [
    {
      id: 'medien-neu',
      titel: 'Medien neu einlesen',
      hinweis: 'Liest die Musikdateien neu ein.',
      einschneidend: false,
      bereich: 'medien',
    },
    {
      id: 'neustart',
      titel: 'Box neu starten',
      hinweis: 'Die Box fährt herunter und wieder hoch.',
      einschneidend: true,
      bereich: 'box',
    },
    {
      id: 'drehung-zurueck',
      titel: 'Bildschirm-Drehung zurücknehmen',
      hinweis: 'Für den Fall, dass der Bildschirm nach einer Umstellung schwarz bleibt.',
      einschneidend: true,
      bereich: 'box',
    },
  ],
}

describe('Suche', () => {
  let http: HttpTestingController
  let fixture: ComponentFixture<Suche>
  let suche: Suche

  /** Was gerade in der Trefferliste steht: Text und Ort, so wie gezeichnet. */
  function zeilen(): { was: string; wo: string }[] {
    fixture.detectChanges()
    // Array.from statt [...]: die Vorgabe fuer die Bibliothek (tsconfig.json)
    // kennt kein Iterieren ueber eine NodeList.
    const knoepfe = Array.from(fixture.nativeElement.querySelectorAll('.liste .zeile') as NodeListOf<HTMLElement>)
    return knoepfe.map((k) => ({
      was: (k.querySelector('.was')?.textContent ?? '').trim(),
      wo: (k.querySelector('.wo')?.textContent ?? '').trim(),
    }))
  }

  function feld(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input') as HTMLInputElement
  }

  /**
   * Hineinklicken — und BEIDE Nachschlaege beantworten.
   *
   * Seit dem 03.08.2026 holt die Suche zwei Listen nach: die
   * Konfigurationsfelder und die Systemaktionen. Wer nur eine beantwortet,
   * faellt im afterEach ueber http.verify() — und zwar in jedem Test, nicht
   * nur in dem, um den es geht. Deshalb steht das an EINER Stelle.
   */
  function wecken(felder: object = FELDER, aktionen: object = AKTIONEN): void {
    suche.aufwachen()
    http.expectOne('/api/konfiguration').flush(felder)
    http.expectOne('/api/system').flush(aktionen)
  }

  /** Tippen wie ein Mensch: ueber das Feld, nicht am Bauteil vorbei. */
  function tippen(text: string): void {
    const e = feld()
    e.value = text
    e.dispatchEvent(new Event('input'))
    fixture.detectChanges()
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Suche],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    })
    http = TestBed.inject(HttpTestingController)
    fixture = TestBed.createComponent(Suche)
    suche = fixture.componentInstance
    fixture.detectChanges()
  })

  afterEach(() => {
    fixture?.destroy()
    http.verify()
  })

  it('nennt an jedem Treffer den Ort — das ist die eigentliche Auskunft', () => {
    wecken()
    tippen('doppelte')

    // GENAU DER FALL, fuer den es die Suche gibt: der Schalter heisst
    // „Doppelte zusammenfassen" und liegt NICHT auf der Seite „Doppelte",
    // sondern unter Medien › Was aus den Quellen wird. Wer das einmal gelesen
    // hat, findet ihn beim naechsten Mal ohne Suche.
    //
    // BIS ZUM 03.08.2026 STAND HIER „Darstellung › Elemente". Der Umzug (G5)
    // hat genau diesen Test rot gemacht, und das war seine Aufgabe: die
    // Zusage lautet nicht „irgendein Ort", sondern „der richtige Ort".
    const schalter = zeilen().find((z) => z.was === 'Doppelte zusammenfassen')
    expect(schalter).toBeDefined()
    expect(schalter?.wo).toBe('Medien › Was aus den Quellen wird')

    // Und keine Zeile bleibt ohne Ort — ein Treffer ohne Ort waere ein
    // blosser Sprung ins Ungewisse.
    for (const z of zeilen()) expect(z.wo.length).toBeGreaterThan(0)
  })

  it('sagt bei einem Seiteneintrag nur die Seite, nicht „Seite › Seite"', () => {
    wecken()
    tippen('bluetooth')
    expect(zeilen()[0]).toEqual({ was: 'Bluetooth', wo: 'Bluetooth' })
  })

  it('zeichnet bei einer Unterseite den Weg dorthin, nicht nur ihren Namen', () => {
    // SEIT DEM 03.08.2026 stehen „Doppelte" und „Interpreten" nicht mehr in
    // der Kopfleiste, sondern hinter einem Weg auf der Medienseite. Stuende
    // hier nur „Doppelte", waere die Auskunft wertlos: in der Leiste heisst
    // nichts so, und man suchte dort weiter.
    wecken()
    tippen('abgleichen')
    const zeile = zeilen().find((z) => z.was === 'Abgleichen')
    expect(zeile).toBeDefined()
    expect(zeile?.wo).toBe('Medien › Doppelte')
  })

  it('haelt sich bei zu kurzer Frage zurueck', () => {
    wecken()
    tippen('d')
    expect(fixture.nativeElement.querySelector('.liste')).toBeNull()
    expect(feld().getAttribute('aria-expanded')).toBe('false')
  })

  it('sagt es, wenn nichts passt — statt eine leere Liste zu zeigen', () => {
    wecken()
    tippen('gibtesnicht')
    expect(zeilen().length).toBe(0)
    expect((fixture.nativeElement.querySelector('.leer') as HTMLElement).textContent).toContain('Nichts gefunden')
  })

  it('fragt die Konfigurationsfelder ERST beim Hineinklicken — und dann nur einmal', async () => {
    // Beim Aufbau darf nichts hinausgehen: der Rahmen steht auf JEDER Seite,
    // ein Abruf hier waere ein Abruf ueberall, nur fuer den Fall, dass jemand
    // sucht.
    http.expectNone('/api/konfiguration')
    http.expectNone('/api/system')

    wecken()
    await takt()

    // Und beim zweiten Mal kein zweiter Abruf — die Felder wechseln waehrend
    // einer Sitzung nicht. Faende hier doch einer statt, fiele das http.verify()
    // im afterEach ueber die unbeantwortete Anfrage; die Felder sind trotzdem
    // noch da, und genau das steht hier als sichtbare Zusage.
    suche.aufwachen()
    tippen('lautstarke')
    // IRGENDWO in den Treffern, nicht auf Platz 0: dieser Fall prueft das
    // EINMAL-LADEN der Felder, nicht die Rangfolge. An Platz 0 hing er
    // trotzdem — und fiel um, als E128 den Gesten-Sucheintrag „Lautstärke"
    // in den statischen Bestand legte (such-bestand.ts, exakterer Treffer
    // gewinnt). Die Rangfolge selbst gehoert dem Fall darunter
    // („findet ein Feld, das es erst zur Laufzeit gibt").
    expect(zeilen().map((z) => z.was)).toContain('Höchste Lautstärke')
  })

  it('findet ein Feld, das es erst zur Laufzeit gibt', async () => {
    wecken()
    await takt()
    // „Höchste Lautstärke" steht in KEINER Vorlage — der Titel kommt aus
    // FELDER im Backend. Ohne den Nachschlag waere die halbe
    // Konfigurationsseite unauffindbar.
    tippen('hochste')
    expect(zeilen()[0]).toEqual({ was: 'Höchste Lautstärke', wo: 'Konfiguration' })
  })

  /**
   * WOHIN ein Feldtreffer zeigt — seit dem 03.08.2026 die eigentliche Frage.
   *
   * Bis dahin schickte die Suche JEDEN Konfigurationstreffer nach
   * /konfiguration. Das war richtig, solange es eine Seite gab; seit die
   * Felder nach der Leitfrage auf drei Seiten stehen, waere es still falsch —
   * und ein Treffer, der auf die falsche Seite fuehrt, ist schlimmer als
   * keiner, weil man dort weitersucht.
   */
  it('schickt einen Feldtreffer auf die Seite SEINES Bereichs', async () => {
    wecken({
      bereiche: [
        { id: 'streaming', titel: 'Zugänge der Anbieter', seite: 'streaming' },
        { id: 'darstellung', titel: 'Aus der Konfiguration der Box', seite: 'darstellung' },
      ],
      felder: [
        { id: 'spotifyClientId', titel: 'Spotify Client-ID', hinweis: '', bereich: 'streaming' },
        {
          id: 'oberflaeche',
          titel: 'Welche Oberfläche auf dem Bildschirm der Box',
          hinweis: '',
          bereich: 'darstellung',
        },
      ],
    })
    await takt()

    tippen('client-id')
    expect(zeilen()[0]).toEqual({
      was: 'Spotify Client-ID',
      wo: 'Streaming-Dienste › Zugänge der Anbieter',
    })

    tippen('welche oberflache')
    expect(zeilen()[0].wo).toBe('Darstellung › Aus der Konfiguration der Box')
  })

  /**
   * Und der Rueckfall: antwortet ein aelterer Server ohne `bereiche`, bleibt
   * es bei der Konfigurationsseite. Lieber der alte, meist richtige Ort als
   * gar keiner — ein Treffer ohne Weg waere ein Sprung ins Nichts.
   */
  it('bleibt ohne Bereichsangabe bei der Konfigurationsseite', async () => {
    wecken()
    await takt()
    tippen('hochste')
    expect(zeilen()[0]).toEqual({ was: 'Höchste Lautstärke', wo: 'Konfiguration' })
  })

  it('sucht im erklaerenden Satz mit, zeigt aber nur den Titel', async () => {
    wecken()
    // Der Takt ist nicht Zierde: die Antwort kommt ueber ein await, die Felder
    // stehen erst im naechsten Durchlauf im Bestand. Ohne ihn sucht dieser
    // Test im festen Bestand allein — und findet nichts.
    await takt()
    // „Spotify Connect" steht im Hinweis unter dem Feld, nicht in seinem Namen.
    // Danach sucht man durchaus — angezeigt wird trotzdem der Titel, weil ein
    // Treffer, der einen Absatz breit ist, niemandem hilft.
    tippen('connect')
    expect(zeilen()[0]).toEqual({ was: 'Name der Box', wo: 'Konfiguration' })
  })

  it('bleibt brauchbar, wenn die Box die Felder nicht liefert', async () => {
    suche.aufwachen()
    http.expectOne('/api/konfiguration').error(new ProgressEvent('netzwerk'))
    http.expectOne('/api/system').error(new ProgressEvent('netzwerk'))
    await takt()

    // Der feste Bestand traegt weiter — nur die Konfigurationsfelder fehlen.
    tippen('kinderzeit')
    expect(zeilen().length).toBeGreaterThan(0)

    // Und beim naechsten Hineinklicken wird BEIDES erneut versucht: der
    // Fehlschlag war vielleicht ein Husten des Backends und kein Dauerzustand.
    wecken()
  })

  /**
   * DIE SYSTEMAKTIONEN — der Befund vom 03.08.2026.
   *
   * „Box neu starten" und „Medien neu einlesen" fehlten in der Suche. Die
   * Titel stehen in AKTIONEN (backend-api/src/system.ts) und kommen ueber
   * GET /api/system; in der Vorlage steht nur {{ a.titel }}, und
   * Interpolationen wirft die Erhebung weg. Dieselbe Lage wie bei den
   * Konfigurationsfeldern — also derselbe Weg: selbst nachholen statt im
   * Frontend nachbauen.
   */
  it('findet eine Systemaktion, deren Titel erst die Box kennt', async () => {
    wecken()
    await takt()

    // „Box neu starten" steht in KEINER Vorlage.
    //
    // GESUCHT WIRD MIT find, NICHT mit [0] — und das ist ein Befund, kein
    // Nachgeben: auf „Systemdienste" gibt es einen Knopf „Neu starten", und
    // der ist bei der Frage „neu starten" der bessere Treffer (sein Text
    // FAENGT damit an). Ein Test auf Platz eins haette hier eine Rangordnung
    // festgeschrieben, die niemand versprochen hat.
    tippen('box neu starten')
    const zeile = zeilen().find((z) => z.was === 'Box neu starten')
    expect(zeile).toBeDefined()
    expect(zeile?.wo).toBe('System › Box aus- und einschalten')
  })

  it('schickt eine Medien-Aktion auf die Medienseite, nicht unter System', async () => {
    // Der Knopf ist am 03.08.2026 von System nach Medien gewandert. Zeigte die
    // Suche weiter auf /system, waere das der teure Fall: man landet auf einer
    // Seite, auf der der Knopf nicht mehr steht, und sucht dort weiter.
    wecken()
    await takt()
    tippen('medien neu einlesen')
    const zeile = zeilen().find((z) => z.was === 'Medien neu einlesen')
    expect(zeile).toBeDefined()
    expect(zeile?.wo).toBe('Medien › Neu einlesen')
  })

  it('sucht im Hinweis der Aktion mit — man kennt den Namen des Knopfes nicht', async () => {
    wecken()
    await takt()
    // Wer den schwarzen Bildschirm hat, tippt nicht „Drehung" — er tippt, was
    // er sieht. Der Hinweis wird mitgesucht, gezeigt wird trotzdem der Titel.
    tippen('bildschirm schwarz')
    expect(zeilen().map((z) => z.was)).toContain('Bildschirm-Drehung zurücknehmen')
  })

  /**
   * DER RUECKFALL — und er ist kein theoretischer Zweig.
   *
   * GEMESSEN AN BOX .169 (04.08.2026, tools/verwaltung-suche-aktionen.mjs):
   * der dort laufende Serverstand schickt `bereich` GAR NICHT mit. Solange
   * nicht ausgerollt ist, ist das der Normalfall, nicht die Ausnahme.
   *
   * Was dann gilt, ist nachgesehen und nicht geraten: seiten/system.ts
   * zeichnet ALLE einschneidenden Aktionen ohne nach `bereich` zu fragen —
   * dort steht der Knopf also wirklich. seiten/medien.ts zeichnet nur die mit
   * bereich 'medien' — eine sanfte Aktion ohne das Feld hat NIRGENDWO einen
   * Knopf, und ein Treffer darauf fuehrte ins Leere.
   */
  it('schickt ohne Bereichsangabe die einschneidenden Aktionen unter System', async () => {
    wecken(FELDER, {
      aktionen: [
        { id: 'neustart', titel: 'Box neu starten', hinweis: 'Dauert etwa eine Minute.', einschneidend: true },
      ],
    })
    await takt()
    tippen('box neu starten')
    const zeile = zeilen().find((z) => z.was === 'Box neu starten')
    expect(zeile).toBeDefined()
    expect(zeile?.wo).toBe('System › Box aus- und einschalten')
  })

  it('bietet ohne Bereichsangabe keine sanfte Aktion an — sie hat dort keinen Knopf', async () => {
    wecken(FELDER, {
      aktionen: [
        {
          id: 'medien-neu',
          titel: 'Medien neu einlesen',
          hinweis: 'Liest die Musikdateien neu ein.',
          einschneidend: false,
        },
      ],
    })
    await takt()
    tippen('medien neu einlesen')
    // KEIN Treffer ist hier die richtige Antwort. Ein Treffer auf /medien
    // fuehrte auf eine Seite, deren Karte auf diesem Serverstand gar nicht
    // gezeichnet wird — und dort sucht man dann weiter.
    expect(zeilen().map((z) => z.was)).not.toContain('Medien neu einlesen')
  })

  it('bleibt brauchbar, wenn die Box die Aktionen nicht liefert', async () => {
    suche.aufwachen()
    http.expectOne('/api/konfiguration').flush(FELDER)
    http.expectOne('/api/system').error(new ProgressEvent('netzwerk'))
    await takt()

    // Die Felder sind trotzdem da — die beiden Nachschlaege haengen nicht
    // aneinander. Faenge einer den anderen mit, waere ein kaputtes df auf der
    // Box der Grund, warum die Konfiguration unauffindbar wird.
    tippen('hochste')
    expect(zeilen()[0].was).toBe('Höchste Lautstärke')
  })

  /**
   * DIE EINZIGE STELLE, an der die Suche etwas ueber eine VORLAGE behauptet.
   *
   * AKTION_ORT nennt zwei Ueberschriften beim Namen. Sie stehen dort, weil der
   * Server sie nicht kennen kann (er sagt 'medien' | 'box', nicht „unter
   * welcher h2"). Damit die Behauptung nicht still veraltet, wird sie gegen
   * den erhobenen Bestand gehalten: benennt jemand die h2 um, sammelt
   * tools/verwaltung-suchbestand.mjs --schreiben den neuen Namen ein und
   * dieser Test wird rot.
   */
  it('nennt Abschnitte, die es auf der Seite wirklich gibt', () => {
    for (const ort of Object.values(AKTION_ORT)) {
      const ueberschrift = SUCH_BESTAND.find(
        (e) => e.seite === ort.name && e.text === ort.abschnitt && e.bereich === '',
      )
      expect(ueberschrift).withContext(`„${ort.abschnitt}" ist auf „${ort.name}" keine Ueberschrift mehr`).toBeDefined()
      // Und der Weg muss zur selben Seite gehoeren — sonst zeigte der Treffer
      // auf Seite A und nennte den Abschnitt von Seite B.
      expect(ueberschrift?.weg).toBe(ort.weg)
    }
  })

  it('geht mit den Pfeiltasten durch und springt mit Enter hin', () => {
    const router = TestBed.inject(Router)
    const hin = spyOn(router, 'navigate').and.resolveTo(true)
    wecken()
    tippen('doppelte')

    const liste = zeilen()
    feld().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    fixture.detectChanges()
    expect(suche.marke()).toBe(1)

    feld().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(hin).toHaveBeenCalled()
    const weg = hin.calls.mostRecent().args[0] as string[]
    expect(weg.length).toBe(1)
    expect(weg[0].startsWith('/')).toBe(true, `kein Weg: ${weg[0]}`)
    expect(liste[1].wo.length).toBeGreaterThan(0)

    // Die Frage bleibt NICHT stehen — sonst liegt auf der Zielseite eine
    // offene Liste ueber dem, was man gerade sehen wollte.
    fixture.detectChanges()
    expect(suche.frage()).toBe('')
    expect(fixture.nativeElement.querySelector('.liste')).toBeNull()
  })

  it('schliesst mit Escape, ohne die Seite zu wechseln', () => {
    const hin = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true)
    wecken()
    tippen('doppelte')
    expect(zeilen().length).toBeGreaterThan(0)

    feld().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    fixture.detectChanges()
    expect(fixture.nativeElement.querySelector('.liste')).toBeNull()
    expect(hin).not.toHaveBeenCalled()
  })

  it('sagt einer Vorlesehilfe, dass unter dem Feld eine Liste steht', () => {
    // Ohne diese Angaben ist ein Feld, unter dem eine Liste auftaucht, fuer
    // eine Vorlesehilfe ein Feld ohne Liste — die Treffer entstehen dann
    // lautlos.
    wecken()
    tippen('doppelte')
    expect(feld().getAttribute('role')).toBe('combobox')
    expect(feld().getAttribute('aria-expanded')).toBe('true')
    expect(feld().getAttribute('aria-controls')).toBe('such-liste')
    const liste = fixture.nativeElement.querySelector('#such-liste') as HTMLElement
    expect(liste.getAttribute('role')).toBe('listbox')
    expect(liste.querySelector('.zeile')?.getAttribute('role')).toBe('option')
  })
})
