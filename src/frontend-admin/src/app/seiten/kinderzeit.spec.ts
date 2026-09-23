/**
 * Tests fuer die Kinderzeit-Seite.
 *
 * WARUM AUSGERECHNET DIESE SEITE als erste der fuenfzehn: hier steht das
 * einzige, was ein Kind spuerbar begrenzt. Und der Kopf von kinderzeit.ts gibt
 * drei Zusagen, die man dem Code nicht ansieht:
 *
 *   1. AUS BEDEUTET AUS — kein halber Zustand.
 *   2. EIN TAG ALS VORLAGE — Montag auf die Wochentage, nicht aufs Wochenende.
 *   3. GESCHENKTE MINUTEN AENDERN DIE REGEL NICHT.
 *
 * Dazu kommt eine vierte, stillere: `vollstaendig()` fuellt fehlende Tage auf,
 * weil die Eingabefelder direkt an `tage[x]` binden — fehlt ein Tag, stuerzt
 * die Vorlage ab, statt nur etwas nicht anzuzeigen.
 *
 * ANGEFASST WIRD DIE SEITE NICHT. Die geprueften Glieder sind `protected` bzw.
 * `private` — das ist eine Angabe fuer den Uebersetzer, zur Laufzeit sind es
 * gewoehnliche Eigenschaften. Der Zugriff laeuft deshalb ueber einen Typ, der
 * genau die hier geprueften Namen nennt, statt ueber ein pauschales `any`:
 * so faellt es auf, wenn eines davon verschwindet.
 */
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { type ComponentFixture, TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { KinderzeitSeite } from './kinderzeit'

type Tag = 'so' | 'mo' | 'di' | 'mi' | 'do' | 'fr' | 'sa'
interface TagesRegel {
  frei: boolean
  ab: string
  bis: string
  minuten: number
}
/** Nur die Namen, die dieser Test benutzt — bewusst kein `any`. */
interface Innen {
  regeln: () => { aktiv: boolean; nachsichtMin: number; tage: Record<Tag, TagesRegel> }
  standText: (s: { grund: string; fensterAb?: string; fensterBis?: string }) => string
  aufWochentage: () => void
  aufAlleTage: () => void
  schlummerMinuten: number
  schlummerLaeuft: () => boolean
  schlummerMax: () => number
  schlummerStarten: () => Promise<void>
  schlummerStoppen: () => Promise<void>
  meldung: () => string
  regelnFehler: () => string
  bildwahlOffen: { (): boolean; set: (offen: boolean) => void }
  figurVon: (kennung: string) => string
  figurSpeichern: (figur: string) => Promise<void>
  startModus: () => 'fragen' | 'letztes'
  setzeStart: (modus: 'fragen' | 'letztes') => Promise<void>
  startMeldung: () => string
}

const takt = () => new Promise((r) => setTimeout(r, 0))

const REGEL = (ueber: Partial<TagesRegel> = {}): TagesRegel => ({
  frei: true,
  ab: '07:00',
  bis: '19:00',
  minuten: 45,
  ...ueber,
})

describe('KinderzeitSeite', () => {
  let http: HttpTestingController
  let fixture: ComponentFixture<KinderzeitSeite>
  let innen: Innen

  /**
   * Seite aufbauen und die fuenf Abrufe des Konstruktors bedienen.
   *
   * DREI, nicht zwei, seit dem 03.08.2026: der Schlummer-Timer ist von der
   * Systemseite hierher gewandert und fragt /api/schlummer. VIER seit dem
   * 08.08.2026: die Seite sagt, WESSEN Zeit sie verschenkt, und holt dafuer
   * /api/profile. FUENF seit dem 20.09.2026 (49087e6e): ganz oben steht der
   * Start-Modus der Box, und `startLesen()` holt /api/start. Dass dieser
   * Test dabei jeweils rot wurde (http.verify() meldet den unerwarteten
   * Abruf), ist seine Leistung — er haelt fest, was die Seite bei ihrem
   * Aufbau wirklich tut.
   *
   * /api/start steht NICHT bei den NEBENWEGEN unten, obwohl es dort
   * stillzustellen waere: der Schalter ist eine Einstellung dieser Seite,
   * keine Nebenkarte. Abgeraeumt statt benannt hiesse, dass die naechste
   * Aenderung an ihm unbemerkt durchginge.
   *
   * Die leere Antwort auf /api/profile laesst `wer` leer — der Stand-Abruf
   * bleibt dadurch /api/kinderzeit/stand ohne `?profil=…`-Anhang.
   */
  async function aufbauen(
    regeln: Record<string, unknown>,
    stand: Record<string, unknown> = { grund: 'aus' },
    schlummer: Record<string, unknown> = { laeuft: false, maxMinuten: 600 },
    startModus = 'fragen',
  ) {
    fixture = TestBed.createComponent(KinderzeitSeite)
    innen = fixture.componentInstance as unknown as Innen
    http.expectOne('/api/start').flush({ modus: startModus })
    http.expectOne('/api/profile').flush({ profile: [], aktiv: '' })
    http.expectOne('/api/kinderzeit').flush(regeln)
    http.expectOne('/api/schlummer').flush(schlummer)
    // `laden()` awaitet die Regeln und fragt ERST DANN den Stand ab.
    await takt()
    http.expectOne('/api/kinderzeit/stand').flush(stand)
    await takt()
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [KinderzeitSeite],
      // DER ROUTER GEHOERT DAZU, seit die Seite auf die Medien verweist
      // („In den Medien zuordnen"). Ohne ihn wirft RouterLink beim Aufbau,
      // und zwoelf Tests fielen mit NG0201 um — das war kein Testfehler,
      // sondern eine echte neue Abhaengigkeit der Seite.
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    })
    http = TestBed.inject(HttpTestingController)
  })

  /**
   * Die Nebenkarten der Seite abraeumen.
   *
   * Seit die Seite „Profile" heisst, holt sie beim Aufbau auch Figuren, die
   * Medien-Zuordnung und den Mitschnitt. Diese Tests handeln von den
   * SPIELZEITEN — sie sollen an den Nebenkarten weder haengen noch scheitern.
   * Beantwortet wird trotzdem, statt `verify()` abzuschalten: eine Anfrage,
   * die niemand pruefen darf, ist die erste, die still ins Leere geht.
   */
  const NEBENWEGE = ['/api/figuren', '/api/profil/auswahl', '/api/verlauf', '/api/medien']
  const nebenkartenAbraeumen = (): void => {
    // `match` nimmt kein RegExp — ein Praedikat schon.
    for (const r of http.match((req) => NEBENWEGE.some((w) => req.url.startsWith(w)))) {
      r.flush({})
    }
  }

  afterEach(() => {
    nebenkartenAbraeumen()
    // Zerstoeren, sonst laeuft der 15-Sekunden-Takt der Seite weiter.
    fixture?.destroy()
    http.verify()
  })

  it('fuellt fehlende Tage auf, statt die Vorlage abstuerzen zu lassen', async () => {
    await aufbauen({ aktiv: true, nachsichtMin: 5, tage: { mo: REGEL() } })
    const tage = innen.regeln().tage
    for (const t of ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'] as Tag[]) {
      expect(tage[t]).toBeDefined(`Tag ${t} fehlt`)
    }
    expect(tage.mo.minuten).toBe(45)
    // Der aufgefuellte Tag traegt die leere Vorgabe, nicht die von Montag.
    expect(tage.sa.minuten).toBe(0)
  })

  it('schaltet sich NUR bei echtem true ein — aus bedeutet aus', async () => {
    // `aus.aktiv = r.aktiv === true`. Ein wahrheitsaehnlicher Wert (etwa der
    // String "false" aus einer alten Konfiguration) darf die Begrenzung nicht
    // scharf schalten und, schlimmer, auch nicht faelschlich als scharf
    // anzeigen, waehrend der Server sie anders sieht.
    await aufbauen({ aktiv: 'ja', nachsichtMin: 5, tage: {} })
    expect(innen.regeln().aktiv).toBe(false)
  })

  it('uebernimmt aktiv, wenn der Server es wirklich sagt', async () => {
    await aufbauen({ aktiv: true, nachsichtMin: 5, tage: {} })
    expect(innen.regeln().aktiv).toBe(true)
  })

  it('uebertraegt Montag auf die Wochentage — und laesst das Wochenende in Ruhe', async () => {
    await aufbauen({
      aktiv: true,
      nachsichtMin: 5,
      tage: {
        mo: REGEL({ minuten: 45 }),
        sa: REGEL({ minuten: 120 }),
        so: REGEL({ minuten: 120 }),
      },
    })

    innen.aufWochentage()
    // Das Uebertragen speichert sofort.
    const put = http.expectOne('/api/kinderzeit')
    expect(put.request.method).toBe('PUT')

    const geschickt = put.request.body as { tage: Record<Tag, TagesRegel> }
    for (const t of ['di', 'mi', 'do', 'fr'] as Tag[]) {
      expect(geschickt.tage[t].minuten).toBe(45, `${t} hat Montag nicht uebernommen`)
    }
    expect(geschickt.tage.sa.minuten).toBe(120, 'Samstag wurde ueberschrieben')
    expect(geschickt.tage.so.minuten).toBe(120, 'Sonntag wurde ueberschrieben')

    put.flush(geschickt)
    await takt()
    http.expectOne('/api/kinderzeit/stand').flush({ grund: 'aus' })
    await takt()
  })

  it('uebertraegt Montag auf Wunsch auf alle sieben Tage', async () => {
    await aufbauen({
      aktiv: true,
      nachsichtMin: 5,
      tage: { mo: REGEL({ minuten: 30 }), sa: REGEL({ minuten: 120 }) },
    })

    innen.aufAlleTage()
    const put = http.expectOne('/api/kinderzeit')
    const geschickt = put.request.body as { tage: Record<Tag, TagesRegel> }
    for (const t of ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'] as Tag[]) {
      expect(geschickt.tage[t].minuten).toBe(30, `${t} hat Montag nicht uebernommen`)
    }

    put.flush(geschickt)
    await takt()
    http.expectOne('/api/kinderzeit/stand').flush({ grund: 'aus' })
    await takt()
  })

  it('sagt zu jedem Grund einen Satz, den ein Elternteil versteht', async () => {
    await aufbauen({ aktiv: true, nachsichtMin: 5, tage: {} })
    expect(innen.standText({ grund: 'aus' })).toBe('Kinderzeit aus')
    expect(innen.standText({ grund: 'frei' })).toBe('darf hören')
    expect(innen.standText({ grund: 'frei', fensterBis: '19:00' })).toBe('darf hören (bis 19:00)')
    expect(innen.standText({ grund: 'tagGesperrt' })).toBe('heute gesperrt')
    expect(innen.standText({ grund: 'zuFrueh', fensterAb: '07:00' })).toBe('noch zu früh (ab 07:00)')
    expect(innen.standText({ grund: 'zuSpaet', fensterBis: '19:00' })).toBe(
      'Feierabend (war bis 19:00)',
    )
    expect(innen.standText({ grund: 'aufgebraucht' })).toBe('Zeit aufgebraucht')
    // Ein unbekannter Grund darf keinen Platzhalter wie "undefined" zeigen.
    expect(innen.standText({ grund: 'was-neues' })).toBe('')
  })

  it('bleibt bedienbar, wenn die Regeln nicht zu laden sind', async () => {
    fixture = TestBed.createComponent(KinderzeitSeite)
    innen = fixture.componentInstance as unknown as Innen
    http.expectOne('/api/start').error(new ProgressEvent('netzwerk'))
    http.expectOne('/api/profile').error(new ProgressEvent('netzwerk'))
    http.expectOne('/api/kinderzeit').error(new ProgressEvent('netzwerk'))
    http.expectOne('/api/schlummer').error(new ProgressEvent('netzwerk'))
    await takt()
    http.expectOne('/api/kinderzeit/stand').flush({ grund: 'aus' })
    await takt()
    // Leere Regeln statt Absturz — und ausdruecklich NICHT eingeschaltet.
    expect(innen.regeln().aktiv).toBe(false)
    expect(innen.regeln().tage.mo).toBeDefined()
    // Und der Timer meldet „laeuft nicht" statt gar nichts: sonst stuende der
    // Knopf zum Abbrechen da, obwohl niemand etwas gestellt hat.
    expect(innen.schlummerLaeuft()).toBe(false)
  })

  /**
   * DER SCHLUMMER-TIMER — am 03.08.2026 von der Systemseite hierher.
   *
   * Geprueft wird nicht, dass es ihn gibt (das saehe man), sondern die beiden
   * Zusagen, die man dem Code nicht ansieht:
   *   1. Er schreibt in seinen EIGENEN Endpunkt und nicht in die
   *      Kinderzeit-Regeln — sonst haette der Umzug einer Box ihre Regeln
   *      verbogen ([[umzug-speicherort-festnageln]]).
   *   2. Er behauptet nichts. „Abgebrochen" steht nur da, wenn die Box es
   *      angenommen hat; sonst laeuft der Timer weiter und der Knopf bleibt.
   */
  describe('Schlummer-Timer', () => {
    it('startet ueber /api/schlummer und laesst die Regeln unberuehrt', async () => {
      await aufbauen({ aktiv: true, nachsichtMin: 5, tage: { mo: REGEL() } })
      innen.schlummerMinuten = 20
      void innen.schlummerStarten()
      const post = http.expectOne('/api/schlummer')
      expect(post.request.method).toBe('POST')
      expect(post.request.body).toEqual({ minuten: 20 })
      post.flush({ ok: true })
      await takt()
      expect(innen.schlummerLaeuft()).toBe(true)
      // KEIN PUT auf /api/kinderzeit: der Timer teilt sich mit den Regeln die
      // Seite, nicht die Ablage.
      http.expectNone('/api/kinderzeit')
    })

    it('uebernimmt die Obergrenze der Box, statt eine eigene zu erfinden', async () => {
      await aufbauen({ aktiv: true, nachsichtMin: 5, tage: {} }, { grund: 'aus' }, {
        laeuft: true,
        maxMinuten: 120,
      })
      expect(innen.schlummerLaeuft()).toBe(true)
      expect(innen.schlummerMax()).toBe(120)
    })

    it('behauptet NICHT, abgebrochen zu haben, wenn das Abbrechen fehlschlug', async () => {
      // DIE ALTE FASSUNG AUF DER SYSTEMSEITE TAT GENAU DAS: sie setzte „laeuft
      // nicht" und meldete „Der Timer wurde abgebrochen", egal was die Box
      // sagte. Dann schaltet die Box mitten in der Geschichte ab, und der
      // einzige Knopf, der das noch verhindern koennte, ist verschwunden.
      await aufbauen({ aktiv: true, nachsichtMin: 5, tage: {} }, { grund: 'aus' }, {
        laeuft: true,
        maxMinuten: 600,
      })
      void innen.schlummerStoppen()
      http.expectOne('/api/schlummer').error(new ProgressEvent('netzwerk'))
      await takt()
      // Das Nachfragen misslingt ebenfalls — dann bleibt der letzte bekannte
      // Stand stehen, statt einen erfundenen anzunehmen.
      http.expectOne('/api/schlummer').error(new ProgressEvent('netzwerk'))
      await takt()
      expect(innen.schlummerLaeuft()).toBe(true)
    })

    it('nimmt der Seite NICHT die Warnung weg, dass die Regeln fehlen', async () => {
      // BEFUND VOM GEGENLESEN, 03.08.2026, gemessen gegen die Attrappe: Seit
      // der Timer auf dieser Seite steht, schrieben zwei voellig verschiedene
      // Dinge in DIESELBE Meldungszeile — und die untere gewann. Die Seite
      // sagte „Die Regeln konnten nicht geladen werden."; ein Tipp auf „Timer
      // starten" ersetzte das durch „Die Box schaltet sich in 30 Minuten ab.".
      // Danach steht die Tabelle voller VORGABEWERTE, und nichts sagt es mehr
      // — wer dort etwas verstellt, verstellt nicht die Regeln der Box.
      fixture = TestBed.createComponent(KinderzeitSeite)
      innen = fixture.componentInstance as unknown as Innen
      http.expectOne('/api/start').flush({ modus: 'fragen' })
      http.expectOne('/api/profile').flush({ profile: [], aktiv: '' })
      http.expectOne('/api/kinderzeit').error(new ProgressEvent('netzwerk'))
      http.expectOne('/api/schlummer').flush({ laeuft: false, maxMinuten: 600 })
      await takt()
      http.expectOne('/api/kinderzeit/stand').flush({ grund: 'aus' })
      await takt()
      expect(innen.regelnFehler()).toContain('Vorgabewerte')

      innen.schlummerMinuten = 30
      void innen.schlummerStarten()
      http.expectOne('/api/schlummer').flush({ ok: true })
      await takt()
      expect(innen.meldung()).toContain('30 Minuten')
      // Und die Warnung steht immer noch da.
      expect(innen.regelnFehler()).toContain('Vorgabewerte')
    })

    it('bricht wirklich ab, wenn die Box es annimmt', async () => {
      await aufbauen({ aktiv: true, nachsichtMin: 5, tage: {} }, { grund: 'aus' }, {
        laeuft: true,
        maxMinuten: 600,
      })
      void innen.schlummerStoppen()
      const post = http.expectOne('/api/schlummer')
      expect(post.request.body).toEqual({ stopp: true })
      post.flush({ ok: true })
      await takt()
      expect(innen.schlummerLaeuft()).toBe(false)
    })
  })

  /**
   * DAS BILD VOR DEM NAMEN, DIE GALERIE ERST NACH KLICK (Betreiber
   * 30.08.2026): „das ausgewählte bild vor dem profil namen" und „die
   * auswahl der icons erst erscheinen beim klick bild ändern". Geprüft wird
   * der Ablauf, den man dem Code nicht ansieht: zu, bis zum Klick — offen
   * nach dem Klick — zu nach der Wahl, AUCH wenn die Wahl auf das Bild
   * fällt, das schon galt.
   */
  describe('Bild ändern', () => {
    /** Ein Kind mit einer gesetzten Figur — samt echter Bildergalerie. */
    async function mitEinemKind(figur: string): Promise<void> {
      fixture = TestBed.createComponent(KinderzeitSeite)
      innen = fixture.componentInstance as unknown as Innen
      http.expectOne('/api/start').flush({ modus: 'fragen' })
      http.expectOne('/api/profile').flush({
        profile: [{ kennung: 'kalea', name: 'Kalea', figur }],
        aktiv: 'kalea',
      })
      // NICHT ueber nebenkartenAbraeumen (die antwortet nur mit `{}`): ohne
      // echte Bilder bliebe figuren() leer, und der Knopf „Bild ändern"
      // stuende in der Vorlage gar nicht erst da.
      http.expectOne('/api/figuren').flush({
        ordner: 'figuren',
        webOrdner: '/neu/figuren',
        figuren: ['mixpi-panda.png', 'mixpi-katze.png'],
      })
      await takt()
      http.expectOne('/api/kinderzeit').flush({ aktiv: false, nachsichtMin: 5, tage: {} })
      http.expectOne('/api/schlummer').flush({ laeuft: false, maxMinuten: 600 })
      await takt()
      http.expectOne('/api/kinderzeit/stand?profil=kalea').flush({ grund: 'aus' })
      await takt()
    }

    it('bleibt zu, bis wer sie öffnet — und fällt nach der Wahl wieder zu', async () => {
      await mitEinemKind('mixpi-panda.png')
      expect(innen.bildwahlOffen()).toBe(false)

      // KLICK auf „Bild ändern" — dieselbe Zeile, die die Vorlage bindet.
      innen.bildwahlOffen.set(!innen.bildwahlOffen())
      expect(innen.bildwahlOffen()).toBe(true)

      // WAHL eines ANDEREN Bildes.
      void innen.figurSpeichern('mixpi-katze.png')
      // Zu, noch bevor die Box überhaupt geantwortet hat — die Galerie ist
      // eine Wahl, keine Warteschlange.
      expect(innen.bildwahlOffen()).toBe(false)

      const get = http.expectOne('/api/profile')
      get.flush({ profile: [{ kennung: 'kalea', name: 'Kalea', figur: 'mixpi-panda.png' }] })
      await takt()

      const put = http.expectOne('/api/profile')
      expect(put.request.method).toBe('PUT')
      const geschickt = put.request.body as { profile: { kennung: string; figur?: string }[] }
      expect(geschickt.profile.find((p) => p.kennung === 'kalea')?.figur).toBe('mixpi-katze.png')
      put.flush(geschickt)
      await takt()
      http.expectOne('/api/profile').flush({
        profile: [{ kennung: 'kalea', name: 'Kalea', figur: 'mixpi-katze.png' }],
        aktiv: 'kalea',
      })
      await takt()

      // Das Vorschaubildchen liest figurVon() — kein eigener Zwischenstand,
      // der aus dem Takt geraten könnte.
      expect(innen.figurVon('kalea')).toBe('mixpi-katze.png')
      expect(innen.bildwahlOffen()).toBe(false)
    })

    it('schließt auch dann, wenn die Wahl auf das schon gewählte Bild fällt', async () => {
      await mitEinemKind('mixpi-panda.png')
      innen.bildwahlOffen.set(true)

      void innen.figurSpeichern('mixpi-panda.png')
      expect(innen.bildwahlOffen()).toBe(false)
      // KEIN Aufruf der Box: figurSpeichern() kehrt vor dem PUT um, wenn
      // sich nichts ändert. Ein unerwarteter Aufruf wäre hier ein Befund,
      // keine Randnotiz — deshalb ausdrücklich geprüft und nicht bloß
      // http.verify() (afterEach) überlassen.
      http.expectNone('/api/profile')
    })
  })

  /**
   * DER START-MODUS (Betreiber 20.09.2026, 49087e6e): „letztes profil startet
   * automatisch". Zwei Modi, und die Richtung des Zweifels ist die ganze
   * Sicherheit dieser Einstellung: alles, was NICHT lesbar `letztes` sagt,
   * gilt als `fragen` — der Weg, der am „Wer hoert?"-Fenster und damit am
   * Schloss VORBEI fuehrt, darf nie aus Versehen entstehen.
   *
   * Dass der Schalter hier ueberhaupt Zeugen bekommt, ist der Anlass dieser
   * Sitzung: er kam am 20.09.2026 in die Seite, ohne dass einer der 14
   * Zeugen davon wusste — sie fielen alle ueber den unerwarteten Abruf.
   */
  describe('Start-Modus', () => {
    it('uebernimmt „letztes" nur, wenn die Box es genau so sagt', async () => {
      await aufbauen({ aktiv: true, nachsichtMin: 5, tage: {} }, { grund: 'aus' }, {
        laeuft: false,
        maxMinuten: 600,
      }, 'letztes')
      expect(innen.startModus()).toBe('letztes')
    })

    it('faellt auf „fragen" zurueck, wenn der Wert Unsinn ist', async () => {
      await aufbauen({ aktiv: true, nachsichtMin: 5, tage: {} }, { grund: 'aus' }, {
        laeuft: false,
        maxMinuten: 600,
      }, 'Letztes ')
      expect(innen.startModus()).toBe('fragen')
    })

    it('nimmt den Schalter zurueck, wenn das Speichern misslingt', async () => {
      // EIN SCHALTER, DER UMSPRINGT, OBWOHL NICHTS ANKAM, behauptet eine
      // Einstellung, die die Box nicht hat — und zwar ausgerechnet die, bei
      // der es um das Schloss geht.
      await aufbauen({ aktiv: true, nachsichtMin: 5, tage: {} })
      expect(innen.startModus()).toBe('fragen')

      void innen.setzeStart('letztes')
      const put = http.expectOne('/api/start')
      expect(put.request.method).toBe('PUT')
      expect(put.request.body).toEqual({ modus: 'letztes' })
      put.error(new ProgressEvent('netzwerk'))
      await takt()

      expect(innen.startModus()).toBe('fragen')
      expect(innen.startMeldung()).toContain('fehlgeschlagen')
    })

    it('uebernimmt beim Speichern, was der Server zurueckgibt — nicht, was angetippt wurde', async () => {
      // Der Server biegt zurecht, was nicht geht. Die Seite soll dann SEINEN
      // Stand zeigen, sonst steht hier eine Einstellung, die die Box ablehnt.
      await aufbauen({ aktiv: true, nachsichtMin: 5, tage: {} })
      void innen.setzeStart('letztes')
      http.expectOne('/api/start').flush({ modus: 'fragen' })
      await takt()
      expect(innen.startModus()).toBe('fragen')
      expect(innen.startMeldung()).toContain('Gespeichert')
    })
  })
})
