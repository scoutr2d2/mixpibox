/**
 * Der Rahmen um alle Verwaltungsseiten: Kopfleiste, Navigation, Abmelden.
 *
 * Er ist bewusst eine eigene Route mit Kindern (statt einer Kopfzeile je
 * Seite): so bleibt beim Seitenwechsel alles stehen ausser dem Inhalt, und die
 * Wache muss nur EINMAL greifen — an dieser Stelle — statt an jeder Unterseite.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'
import { filter, firstValueFrom, map } from 'rxjs'
import { AnmeldeDienst } from './anmeldung.dienst'
import { Suche } from './suche'

/** Der Name, solange die Box noch nichts gesagt hat. Er ist der RUECKFALL,
 *  keine Aussage — steht die Konfiguration bereit, gewinnt immer sie. */
const NAME_RUECKFALL = 'MixPiBox'

/**
 * WELCHE UNTERSEITE UNTER WELCHEM LEISTENEINTRAG HAENGT.
 *
 * WOZU, und es ist die zweite Haelfte eines Befundes vom 03.08.2026: Damals
 * fiel auf, dass auf /verschmelzung und /interpreten KEIN Leisteneintrag mehr
 * leuchtet — sie stehen ja nicht mehr in der Leiste
 * ([[unterseite-ohne-rueckweg]]). Behoben wurde davon nur die eine Haelfte,
 * der „← Medien"-Rueckweg auf der Seite. Die andere blieb liegen: `Medien`
 * leuchtet NICHT mit, weil routerLinkActive Pfade vergleicht und
 * /verschmelzung nicht mit /medien anfaengt. Am 05.08.2026 im Browser
 * nachgemessen — `nav a.hier` war auf beiden Seiten LEER.
 *
 * Wer ueber Lesezeichen oder Suche hereinkommt, sieht deshalb bis heute eine
 * Verwaltung, in der nichts angewaehlt ist. Der Rueckweg sagt ihm, wo es
 * zurueckgeht; die Leiste sagt ihm nicht, wo er IST.
 *
 * WARUM HIER EINE LISTE STEHT, wo dieses Projekt Listen sonst vermeidet: Die
 * Elternschaft laesst sich zur Laufzeit nicht ablesen. /verschmelzung ist im
 * Router ein GESCHWISTER von /medien, kein Kind — und das mit Absicht, damit
 * die Adressen unveraendert bleiben und keine Lesezeichen zerbrechen
 * ([[unterseiten-statt-sechzehn-reiter]]). Der Rahmen kann die Vorlage der
 * Unterseite auch nicht lesen.
 *
 * GEGEN DAS AUSEINANDERLAUFEN hilft dasselbe Mittel wie bei `AKTION_ORT` in
 * suche.ts: die Liste wird GEPRUEFT, nicht geglaubt.
 * tools/verwaltung-wege-schau.mjs haelt sie gegen die ERHOBENE Elternschaft
 * (`unterseitenLesen()`, die den Verweis von der Elternseite liest) und meldet
 * jede Abweichung in beide Richtungen. Eine Unterseite, die hier fehlt, ist
 * ein Befund; ein Eintrag, den es nicht mehr gibt, auch.
 */
export const UNTERSEITE_VON: Record<string, string> = {
  '/verschmelzung': '/medien',
  '/interpreten': '/medien',
}

@Component({
  selector: 'mupi-rahmen',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Suche],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; min-height: 100dvh; }
    header {
      display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
      padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--rand);
      background: var(--flaeche); position: sticky; top: 0; z-index: 10;
    }
    .marke { font-weight: 600; margin-right: 0.5rem; }
    nav { display: flex; gap: 0.35rem 1.4rem; flex-wrap: wrap; align-items: center; }
    nav a {
      color: var(--gedaempft); text-decoration: none; padding: 0.4rem 0.75rem;
      border-radius: 8px; font-size: 0.94rem;
    }
    nav a:hover { background: var(--grund); color: var(--schrift); }
    nav a.hier { background: var(--leit); color: #fff; }
    /* EINE GRUPPE der Kopfleiste — flach gebaut, ohne verschachtelte Kaesten.
       Genau deshalb kann tools/verwaltung-wege-schau.mjs die Zugehoerigkeit
       LESEN statt sie in einer Liste zu pflegen.

       DER TITEL STEHT NEBEN DEN EINTRAEGEN, NICHT DARUEBER, und das ist eine
       GEMESSENE Entscheidung (05.08.2026, im Browser gegen die Attrappe bei
       1440 px Fensterbreite, Hoehe des header-Elements):

           flache Leiste wie vorher      201 px
           gruppiert, Titel DARUEBER     243 px   (+42, +21 %)
           gruppiert, Titel DANEBEN      201 px   (+0)

       Die Titelzeile darueber zwang die vier Gruppen in ZWEI Reihen, und der
       Kopf klebt oben (position sticky) — die 42 px fehlen auf JEDER Seite und
       bei jedem Bildlauf, auf einem 768-px-Schirm ein Zwanzigstel des
       Fensters. Fuer eine Zwischenueberschrift ist das zu teuer, zumal sie
       daneben genauso liest. Wer das wieder umbaut: NACHMESSEN, nicht
       schaetzen — geschaetzt war es vorher naemlich „kostet ja fast nichts".

       KEINE BACKTICKS IN DIESEM KOMMENTAR — auch der styles-Block ist ein
       Template-Literal, und der erste Backtick beendet ihn mitten in der CSS.
       Beim Schreiben dieses Umbaus ZWEIMAL passiert, das zweite Mal in genau
       diesem Absatz: um einen CSS-Namen gesetzt, aus Gewohnheit. Die Warnung
       zu lesen genuegt also nicht — man muss sie beim Tippen befolgen
       ([[backtick-im-html-kommentar-frisst-die-halbe-seite]]). */
    nav .gruppe {
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.2rem 0.35rem;
    }
    nav .gruppentitel {
      color: var(--gedaempft); font-size: 0.72rem; letter-spacing: 0.06em;
      text-transform: uppercase; opacity: 0.75; white-space: nowrap;
    }
    /* KEIN Trennstrich zwischen den Gruppen: die Leiste bricht um, und ein
       Strich am ZEILENANFANG sieht aus wie ein Fehler. Getrennt wird durch den
       groesseren Abstand (1,4rem gegen 0,35rem innerhalb einer Gruppe) und
       durch die Ueberschrift selbst. */
    /* Die Suche sitzt rechts und schiebt das Abmelden vor sich her. Sie steht
       im Rahmen und nicht auf einer Seite, weil sie sonst genau dann nicht da
       waere, wenn man sie braucht: wenn man auf der falschen Seite steht. */
    mupi-suche { margin-left: auto; }
    main { padding: 1.5rem 1.25rem 3rem; max-width: 60rem; }
  `,
  template: `
    <header>
      <span class="marke">{{ boxname() }}</span>
      <!-- VIER GRUPPEN STATT VIERZEHN REITER NEBENEINANDER (05.08.2026).
           Vierzehn gleichrangige Eintraege sind keine Gliederung, sondern eine
           Liste; man liest sie jedes Mal von vorn, weil nichts sagt, wo man
           aufhoeren darf zu suchen.
           DIE UEBERSCHRIFTEN SIND NICHT NEU ERFUNDEN. Sie sind die LEITFRAGE,
           nach der seit dem 03.08.2026 schon die einzelnen FELDER sortiert
           werden (BEREICHE in src/backend-api/src/konfiguration.ts, im Wiki
           [[admin-gliederung-leitfrage]]) — nur auf die Seiten angewandt.
           Wer sie liest, kann die Frage „wohin gehoert das?" selbst
           beantworten; eine zweite Vokabel daneben („Inhalte", „Technik",
           „Wartung") koennte das nicht, sie muesste erst gelernt werden.
           ES IST NICHTS VERSCHWUNDEN. Alle vierzehn Wege stehen weiter hier,
           einen Klick entfernt — die Reihenfolge hat sich geaendert, die
           Erreichbarkeit nicht. Eine Gliederung mit Klappmenues waere die
           naechste Stufe; sie versteckt Seiten und ist deshalb eine
           Entscheidung des Betreibers, nicht dieses Umbaus. -->
      <nav>
        <!-- routerLink STEHT VORN, class dahinter. Das ist keine Marotte:
             tools/verwaltung-suchbestand.mjs liest die Kopfleiste mit einem
             Ausdruck, der routerLink unmittelbar hinter dem a-Tag verlangt.
             Schreibt man class zuerst, faellt der Eintrag lautlos aus der
             Leiste UND aus dem Suchbestand. Beim Umbau am 05.08.2026 genau so
             passiert: 14 Reiter wurden zu 13, 191 Sucheintraege zu 190, und
             die Pruefung blieb gruen. Gegen die Wiederholung meldet dieselbe
             Datei jetzt NICHT GELESEN.
             DEN AUSDRUCK SELBST HINZUSCHREIBEN GEHT HIER NICHT: eine
             Zeichenklasse mit Gegenschraegstrich steht in einem
             Template-Literal, und JavaScript frisst den Gegenschraegstrich
             beim Einlesen — aus der Zeichenklasse fuer Leerraum wurde ein
             blosser Buchstabe, und der Kommentar behauptete etwas Falsches. -->
        <a routerLink="/" routerLinkActive="hier" [routerLinkActiveOptions]="{ exact: true }">Übersicht</a>
        <section class="gruppe">
          <span class="gruppentitel">Was da ist</span>
          <!-- „DOPPELTE" UND „INTERPRETEN" STANDEN BIS ZUM 03.08.2026 HIER und
               sind jetzt UNTERSEITEN von „Medien": den Weg dorthin gibt es auf
               der Medienseite, gleich unter den beiden Schaltern, die sie
               scharf machen. Beide Wege (/verschmelzung, /interpreten) sind
               unveraendert — kein Lesezeichen zerbricht.
               WARUM SIE NICHT ABSCHNITTE DER MEDIENSEITE WURDEN: die traegt
               schon Bibliothek, Meta-Suche, eigene Listen und das Aufraeumen.
               Zwei weitere Bloecke haetten sie auf ueber zweitausend Zeilen und
               ein Dutzend Abschnitte gebracht — und man muesste an der Karte
               vorbeiscrollen, die EINTRAEGE LOESCHT, um an die zu kommen, die
               nur zuordnet. Genau davor warnen die Kopfkommentare beider Seiten
               seit ihrer Entstehung.
               DIE SUCHE FINDET SIE TROTZDEM: tools/verwaltung-suchbestand.mjs
               erhebt Unterseiten ueber den Verweis, der von der Elternseite auf
               sie zeigt — nicht ueber die Kopfleiste. -->
          <!-- LEUCHTET AUCH AUF SEINEN UNTERSEITEN (Doppelte, Interpreten) —
               siehe UNTERSEITE_VON oben. Ohne das steht man dort in einer
               Verwaltung, in der KEIN Eintrag angewaehlt ist.
               HIER STEHT KEIN routerLinkActive, und das ist Absicht: zwei
               Schreiber auf derselben Klasse loeschen einander (Begruendung
               an leuchtet()). Dieser eine Eintrag wird gerechnet, die anderen
               dreizehn ueberlaesst man der Direktive. -->
          <!-- PROFILE STEHEN VOR DEN MEDIEN: erst wer, dann was. Der Punkt
               hiess bis heute „Kinderzeit" und stand unter „Was man sieht und
               hört" — dort hat ihn niemand gesucht, der ein Kind anlegen oder
               seine Statistik sehen wollte (Betreiber: „wo kann ich die
               spielstatistik sehen"). Der Weg /kinderzeit bleibt. -->
          <a routerLink="/kinderzeit" routerLinkActive="hier">Profile</a>
          <a routerLink="/medien" [class.hier]="leuchtet('/medien')">Medien</a>
          <a routerLink="/streaming" routerLinkActive="hier">Streaming-Dienste</a>
          <!-- „Aufzeichnen" GEHOERT ZU „Was da ist": es beschreibt, wie
               Bestand ENTSTEHT (der Mitschnitt fuellt die Platte), nicht wie
               die Box aussieht oder klemmt. Direkt nach den Diensten, aus
               denen aufgezeichnet wird. -->
          <a routerLink="/aufzeichnen" routerLinkActive="hier">Aufzeichnen</a>
        </section>
        <section class="gruppe">
          <span class="gruppentitel">Was man sieht und hört</span>
          <a routerLink="/darstellung" routerLinkActive="hier">Darstellung</a>
          <a routerLink="/vorlesen" routerLinkActive="hier">Vorlesen</a>
          <!-- „Videos" heisst hier die FREIGABE einzelner Mediathek-Videos als
               Belohnung, nicht ein Videoplayer. Sie steht neben Vorlesen und
               Spielen, weil sie dieselbe Frage beantwortet: was das Kind zu
               sehen und zu hoeren bekommt. -->
          <a routerLink="/videos" routerLinkActive="hier">Videos</a>
          <a routerLink="/spiele" routerLinkActive="hier">Spiele</a>
        </section>
        <section class="gruppe">
          <span class="gruppentitel">Was die Box ist</span>
          <a routerLink="/konfiguration" routerLinkActive="hier">Konfiguration</a>
          <a routerLink="/netzwerk" routerLinkActive="hier">Netzwerk</a>
          <a routerLink="/vpn" routerLinkActive="hier">VPN</a>
          <a routerLink="/netzlaufwerk" routerLinkActive="hier">Netzlaufwerk</a>
          <a routerLink="/nachrichten" routerLinkActive="hier">Nachrichten</a>
          <a routerLink="/bluetooth" routerLinkActive="hier">Bluetooth</a>
          <a routerLink="/ton" routerLinkActive="hier">Ton</a>
          <a routerLink="/mupihat" routerLinkActive="hier">MuPiHAT</a>
          <!-- „Plugins" steht bei „Was die Box IST" und nicht bei „Was man
               sieht und hoert": eingestellt wird hier, WELCHE Erweiterung
               laeuft und womit — nicht, was ein Kind zu sehen bekommt. -->
          <!-- OHNE routerLinkActive, wie „Medien" darueber: dieser Eintrag hat
               Unterseiten (/plugins/<kennung>) und wird deshalb gerechnet.
               Zwei Schreiber auf derselben Klasse loeschen einander — die
               Begruendung steht bei leuchtet(). -->
          <a routerLink="/plugins" [class.hier]="leuchtet('/plugins')">Plugins</a>
        </section>
        <section class="gruppe">
          <span class="gruppentitel">Wenn etwas klemmt</span>
          <!-- „Systemdienste", nicht „Dienste": daneben steht seit dem
               03.08.2026 „Streaming-Dienste", und zwei gleich heissende
               Menuepunkte mit voellig verschiedenem Inhalt sind ein Fehlgriff,
               den man taeglich macht. Der WEG bleibt /dienste. -->
          <a routerLink="/dienste" routerLinkActive="hier">Systemdienste</a>
          <a routerLink="/system" routerLinkActive="hier">System</a>
          <!-- „Leistung" DIREKT NACH „System": die beiden beantworten dieselbe
               Frage von zwei Seiten — „wie viel ist belegt" dort, „wofuer"
               hier. Wer das eine sucht, findet oft das andere. -->
          <a routerLink="/leistung" routerLinkActive="hier">Leistung</a>
          <a routerLink="/protokolle" routerLinkActive="hier">Protokolle</a>
          <a routerLink="/aktualisierung" routerLinkActive="hier">Aktualisierung</a>
          <!-- „SICHERUNG" STEHT UNTER „WENN ETWAS KLEMMT", nicht unter „Was die
               Box ist" — die Leitfrage ist hier die des Suchenden, nicht die
               des Bauenden. Wer diese Seite braucht, sucht nicht nach einer
               Einstellung; er sucht nach einem Rueckweg. Und er sucht sie
               NACH „Aktualisierung": das Update ist der Anlass, bei dem man
               zuletzt an eine Sicherung denkt, und der haeufigste, bei dem
               man sie danach braucht. -->
          <a routerLink="/sicherung" routerLinkActive="hier">Sicherung</a>
        </section>
      </nav>
      <mupi-suche />
      @if (lage().anmeldungNoetig) {
        <button type="button" class="still" (click)="abmelden()">Abmelden</button>
      }
    </header>
    <main><router-outlet /></main>
  `,
})
export class Rahmen {
  private readonly dienst = inject(AnmeldeDienst)
  private readonly router = inject(Router)
  private readonly http = inject(HttpClient)
  readonly lage = this.dienst.lage

  /**
   * DER NAME DIESER BOX, nicht der des Produkts.
   *
   * Hier stand bis 2026-08-02 fest verdrahtet „MuPiBox", waehrend die Box laut
   * `mupibox.host` bereits „MixPiBox" hiess. Sobald es zwei Boxen gibt
   * (Backlog E13), ist die Kopfzeile ausserdem die einzige Stelle, an der man
   * beim Verwalten sieht, WELCHE gerade offen ist — ein fester Text waere
   * dann nicht nur falsch, sondern gefaehrlich.
   *
   * `mupibox.host` ist DREIFACH belegt: Anzeigename, Spotify-Connect-Name
   * (LIBRESPOT_NAME) und Systemhostname. Er wird deshalb GELESEN und nirgends
   * im Code nachgebaut.
   */
  readonly boxname = signal(NAME_RUECKFALL)

  /**
   * Der Weg, auf dem wir gerade stehen — ohne Frage- und Rautezeichen.
   *
   * `router.url` allein genuegt nicht: es ist eine Eigenschaft, kein Signal,
   * und der Kopf zeichnet mit OnPush. Ohne das Ereignis bliebe die Leiste beim
   * Seitenwechsel auf dem Stand des ersten Aufrufs stehen.
   */
  private readonly weg = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.split(/[?#]/)[0]),
    ),
    { initialValue: this.router.url.split(/[?#]/)[0] },
  )

  /**
   * Leuchtet dieser Leisteneintrag — entweder weil wir auf ihm stehen, oder
   * weil wir auf einer seiner Unterseiten stehen?
   *
   * EIN AUSDRUCK STATT ZWEIER QUELLEN, und das ist keine Feinheit: der erste
   * Anlauf liess `routerLinkActive="hier"` stehen und setzte DANEBEN ein
   * `[class.hier]="…"`. Beide schreiben dieselbe Klasse, und die Bindung
   * gewinnt — sie ENTFERNT die Klasse, die die Direktive gerade gesetzt hat.
   * Im Browser gemessen (05.08.2026): auf /medien leuchtete danach GAR
   * NICHTS mehr, auf /interpreten ebenfalls nicht, und auf /verschmelzung
   * leuchtete es nur, weil die Auswertung zufaellig anders herum lief. Der
   * Umbau, der das Leuchten reparieren sollte, hatte es auf der Elternseite
   * kaputtgemacht — und zwar genau dort, wo man es am wenigsten nachprueft,
   * weil es „vorher ja ging".
   *
   * Wer diesen Eintrag also mit routerLinkActive versieht, macht ihn dunkel.
   */
  leuchtet(weg: string): boolean {
    if (this.weg() === weg || UNTERSEITE_VON[this.weg()] === weg) return true
    // ── VERSCHACHTELTE WEGE (14.08.2026) ────────────────────────────────
    //
    // `/plugins/<kennung>` ist eine Unterseite von `/plugins`, aber die
    // Kennung steht erst zur Laufzeit fest — in UNTERSEITE_VON, einer festen
    // Tabelle, kann sie nicht stehen.
    //
    // MIT DEM SCHRAEGSTRICH UND NICHT NUR `startsWith(weg)`: sonst liesse
    // `/medien` auch bei einem kuenftigen `/medienarchiv` leuchten, und der
    // Fehler faellt erst auf, wenn es diesen Weg gibt.
    return this.weg().startsWith(`${weg}/`)
  }

  constructor() {
    void this.namenHolen()
  }

  /** Ein Fehlschlag ist kein Fehler: dann bleibt der Rueckfall stehen. Eine
   *  Kopfzeile darf nie der Grund sein, warum die Verwaltung nicht aufgeht. */
  private async namenHolen(): Promise<void> {
    try {
      const k = await firstValueFrom(this.http.get<{ mupibox?: { host?: string } }>('/api/config'))
      const name = (k?.mupibox?.host ?? '').trim()
      if (name) this.boxname.set(name)
    } catch {
      /* Rueckfall bleibt */
    }
  }

  async abmelden(): Promise<void> {
    await this.dienst.abmelden()
    void this.router.navigate(['/anmeldung'])
  }
}
