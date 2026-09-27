/**
 * Doppelte über Dienste hinweg — dasselbe Album aus Jellyfin UND Spotify.
 *
 * ZWEI EBENEN, und beide gehören hierher:
 *   GANZ AUS   der Schalter „Doppelte zusammenfassen" — seit dem 03.08.2026
 *              auf der MEDIENSEITE (bis dahin unter „Darstellung"). Steht er
 *              aus, verhält sich die Box genau wie bisher. Diese Seite ZEIGT
 *              ihn nur — gestellt wird er dort, wo die anderen Schalter stehen,
 *              damit es nicht zwei Stellen gibt, die darstellung.json schreiben.
 *   EINZELN    „trennen" löst eine falsch erkannte Zusammenlegung, ohne die
 *              ganze Funktion abzuschalten — und merkt sich das, sodass der
 *              nächste Abgleich sie nicht zurückholt.
 *
 * DER ABGLEICH LÄUFT NUR AUF KNOPFDRUCK. Erkannt wird nach Stufe „locker":
 * normalisierter Titel plus lose passender Interpret. Das trifft die große
 * Mehrheit — aber Deluxe, Remaster und Live tragen dieselben Namen. Etwas, das
 * ein Kind sieht, still zusammenzulegen, weil ein Namensvergleich es dafür
 * hält, wäre eine Änderung an seiner Mediathek ohne Rückfrage.
 *
 * NICHTS GEHT VERLOREN. Die Bibliothek wird nicht angefasst; es entsteht nur
 * eine Liste daneben (config/verschmelzung.json). Verlauf, Weiterhören und
 * Favoriten hängen am Schlüssel, und der ändert sich bei keinem der beiden
 * Einträge.
 *
 * DIE AUSNAHME IST DER DOPPELTE SCHLÜSSEL. Zwei Einträge mit demselben
 * Schlüssel weist die Verschmelzung ab — still, denn sie kann nicht wissen,
 * welcher gemeint war. Deshalb steht er hier ganz oben und mit Zeilennummern:
 * ohne die wäre der Hinweis eine Klage ohne Abhilfe, weil beide Zeilen
 * identisch aussehen. Entfernt wird über die Zeile, nicht über den Schlüssel —
 * `DELETE /api/medien/:schluessel` meldet bei zwei Treffern „nicht gefunden".
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { RouterLink } from '@angular/router'
import { firstValueFrom } from 'rxjs'

interface Zuordnung {
  schluessel: string
  auch: string[]
  stufe: 'hand' | 'locker' | 'fingerabdruck' | 'acoustid'
}

interface Name {
  titel: string
  interpret?: string
  dienst: string
  kategorie: string
}

interface DoppelZeile {
  nr: number
  category: string
  title: string
  artist: string
}

interface Stand {
  zuordnungen: Zuordnung[]
  getrennt: string[][]
  neu: Zuordnung[]
  uebergangen: {
    grund: 'mehrdeutig' | 'getrennt' | 'kategorie' | 'interpretFehlt'
    schluessel: string[]
    titel: string
    interpret?: string
  }[]
  mehrdeutig: { schluessel: string; anzahl: number; titel: string; interpret?: string; kategorien: string[] }[]
  doppelt: { schluessel: string; eintraege: DoppelZeile[] }[]
  namen: Record<string, Name>
}

const STUFEN_NAME: Record<string, string> = {
  hand: 'von Hand',
  locker: 'per Namensvergleich',
  fingerabdruck: 'per Fingerabdruck',
  acoustid: 'per AcoustID',
}

/**
 * WARUM EINE GEFUNDENE GRUPPE TROTZDEM ZWEI KACHELN BLEIBT — in Worten, die
 * ein Elternteil lesen kann.
 *
 * DASS DAS UEBERHAUPT DASTEHT, IST DER PUNKT. Der Server liefert `uebergangen`
 * seit dem ersten Tag mit, angezeigt wurde es nie (Befund beim Gegenlesen,
 * 2026-08-03). Damit war der haeufigste Verlauf: Abgleich gedrueckt, „nichts
 * Neues" gelesen, und die Erklaerung dafuer blieb im Netzverkehr stecken.
 * Genau davor warnt der Kopf von abgleich.ts — eingebaut, gruen, wirkungslos.
 */
const UEBERGANGEN_NAME: Record<string, string> = {
  mehrdeutig: 'Schlüssel steht zweimal',
  getrennt: 'von Hand getrennt',
  kategorie: 'verschiedene Abschnitte',
  interpretFehlt: 'ohne Interpret',
}

const UEBERGANGEN_HILFE: Record<string, string> = {
  mehrdeutig: 'Erst oben die überzählige Zeile entfernen — dann greift der Abgleich hier.',
  getrennt: 'Bleibt so. Unten unter „Von Hand getrennt“ wieder zulassen.',
  kategorie:
    'Eines steht unter Hörbuch, das andere unter Musik. Zusammengefasst verschwände die Kachel aus einem der beiden Abschnitte — und ein Kind sucht sie dort, wo sie immer war. Auf der Medienseite dieselbe Kategorie setzen, dann noch einmal abgleichen.',
  interpretFehlt:
    'Bei einem der beiden fehlt der Interpret. Dann bliebe nur der Titel als Beweis, und „Weihnachtslieder“ heißen viele. Interpret nachtragen, dann noch einmal abgleichen.',
}

const KATEGORIE_NAME: Record<string, string> = {
  music: 'Musik',
  audiobook: 'Hörspiel',
  other: 'Sonstiges',
}

@Component({
  selector: 'mupi-verschmelzung',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  styles: `
    h1 { font-size: 1.3rem; margin: 0 0 0.35rem; }
    p.unter { color: var(--gedaempft); margin: 0 0 1.3rem; font-size: 0.94rem; }
    .karte {
      background: var(--flaeche); border: 1px solid var(--rand); border-radius: 14px;
      padding: 1rem 1.1rem; margin-bottom: 1.2rem;
    }
    .karte h2 { font-size: 1.05rem; margin: 0 0 0.7rem; }
    .karte.warn { border-color: var(--warn); }
    ul { list-style: none; margin: 0; padding: 0; }
    li { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap;
         padding: 0.5rem 0; border-top: 1px solid var(--rand); }
    li:first-child { border-top: 0; }
    .wer { display: flex; flex-direction: column; min-width: 12rem; }
    .wer span { color: var(--gedaempft); font-size: 0.85rem; }
    .marke {
      font-size: 0.78rem; padding: 0.15rem 0.5rem; border-radius: 999px;
      border: 1px solid var(--rand); color: var(--gedaempft);
    }
    .marke.warn { border-color: var(--warn); color: var(--warn); }
    .reihe { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
    .hinweis { color: var(--gedaempft); font-size: 0.87rem; margin: 0.6rem 0 0; }
    .leer { color: var(--gedaempft); font-size: 0.9rem; margin: 0; }
    code { font-family: ui-monospace, monospace; font-size: 0.82rem; }
    .schluessel { color: var(--gedaempft); font-family: ui-monospace, monospace; font-size: 0.76rem; }
    /* Der Rueckweg zur Elternseite. Gedaempft, aber mit Polsterung: die
       Verwaltung wird meistens am Handy bedient, und ein Verweis in
       Textgroesse ist dort rund 22 px hoch — zu wenig fuer einen Daumen.
       Mit dem Innenabstand sind es gemessene 47 px. */
    a.zurueck {
      display: inline-block; color: var(--gedaempft); text-decoration: none;
      font-size: 0.9rem; padding: 0.8rem 0.7rem 0.8rem 0; margin-bottom: 0.2rem;
    }
    a.zurueck:hover { color: var(--schrift); }
    /* Die Auswahlfelder der Hand-Verschmelzung. Sie tragen lange Werktitel und
       werden am Tablet bedient: die Hoechstbreite haelt sie im Rahmen, die
       Polsterung macht sie daumentauglich (gemessen 44 px hoch).
       KEIN BACKTICK IN DIESEM KOMMENTAR — er steht INNERHALB des
       styles-Literals und wuerde es beenden; genau daran ist der erste Bau
       dieser Aenderung gescheitert (llmwiki backticks-beenden-jede-vorlage). */
    select {
      background: var(--flaeche); color: var(--schrift); border: 1px solid var(--rand);
      border-radius: 8px; padding: 0.6rem 0.5rem; font-size: 0.92rem;
      max-width: min(24rem, 100%); flex: 1 1 14rem;
    }
    select:disabled { opacity: 0.6; }
  `,
  template: `
    <!-- DER RUECKWEG. Diese Seite steht seit dem 03.08.2026 NICHT mehr in der
         Kopfleiste (sie ist Unterseite von „Medien"), und damit ist beim
         Gegenlesen aufgefallen: es leuchtet kein einziger Leisteneintrag mehr,
         solange man hier steht. Wer ueber ein Lesezeichen oder die Suche
         hereinkommt, sieht eine Seite, deren Name nirgends in der Leiste
         vorkommt — und keinen Hinweis, wo sie haengt. Der Weg HIN steht auf
         der Medienseite; der Weg ZURUECK stand nirgends.
         Geprueft wird das ab jetzt von tools/verwaltung-wege-schau.mjs. -->
    <a class="zurueck" routerLink="/medien">← Medien</a>
    <h1>Doppelte über Dienste hinweg</h1>
    <p class="unter">
      Dasselbe Album liegt in Jellyfin <em>und</em> bei Spotify? Dann kann die Box daraus eine
      Kachel machen und beim Abspielen die verlässlichere Quelle nehmen. Die Bibliothek bleibt
      dabei unangetastet — alles hier ist umkehrbar.
    </p>

    <div class="karte">
      <h2>Der Schalter</h2>
      @if (schalter() === null) {
        <p class="leer">Die Darstellung antwortet gerade nicht.</p>
      } @else {
        <p class="reihe">
          <span class="marke" [class.warn]="!schalter()">
            {{ schalter() ? 'Zusammenfassen ist AN' : 'Zusammenfassen ist AUS' }}
          </span>
          <!-- ZEIGTE BIS ZUM 03.08.2026 AUF /darstellung, und dort steht der
               Schalter seit demselben Tag nicht mehr: „Doppelte
               zusammenfassen" ist mit „Ganze Diskografie" auf die Medienseite
               gewandert (G5). Der Verweis blieb stehen und schickte damit
               genau die Leute auf eine Seite ohne diesen Schalter, die ihn
               suchen — dieselbe Sorte Fehler wie die Uebersichts-Kachel, die
               „Anzeige neu starten" versprach. Gefunden beim Gegenlesen. -->
          <a routerLink="/medien">auf der Medienseite umstellen</a>
        </p>
        @if (!schalter()) {
          <p class="hinweis">
            Solange er aus ist, zeigt die Box zwei Kacheln — genau wie bisher. Die Zuordnungen
            unten dürfen trotzdem schon angelegt werden; sie wirken erst, wenn der Schalter an ist.
            Das ist auch der Rückweg, wenn etwas schiefgeht.
          </p>
        }
      }
    </div>

    @if (stand(); as s) {
      @if (s.doppelt.length) {
        <div class="karte warn">
          <h2>Erst hier aufräumen: derselbe Schlüssel steht zweimal</h2>
          <p class="hinweis" style="margin-top: 0">
            Zwei Einträge, die sich nur in der Kategorie unterscheiden, tragen denselben
            Schlüssel. Solange das so ist, lässt die Box sie <b>nicht</b> zusammenfassen — sie
            könnte nicht sagen, welcher gemeint ist. Auch Ändern und Entfernen greifen dort nicht.
            Welche Kategorie richtig ist, kann nur ein Mensch entscheiden: davon hängt ab, in
            welchem Abschnitt der Startseite die Kachel steht.
          </p>
          @for (d of s.doppelt; track d.schluessel) {
            <ul>
              @for (z of d.eintraege; track z.nr) {
                <li>
                  <span class="wer">
                    <b>{{ z.title || '(ohne Titel)' }}</b>
                    <span>{{ z.artist }}</span>
                  </span>
                  <span class="marke">Zeile {{ z.nr + 1 }}</span>
                  <span class="marke">{{ katName(z.category) }}</span>
                  <span class="schluessel">{{ d.schluessel }}</span>
                  <button
                    class="gefahr"
                    [disabled]="arbeitet()"
                    (click)="doppelEntfernen(d.schluessel, z.nr)"
                    [title]="'Diese Zeile aus data.json entfernen'"
                  >
                    {{ fragt() === d.schluessel + '#' + z.nr ? 'wirklich entfernen?' : 'diese Zeile entfernen' }}
                  </button>
                </li>
              }
            </ul>
          }
          <p class="hinweis">
            Vorher wird eine Sicherung der Bibliothek angelegt — sie liegt als Datei neben
            <code>data.json</code> und lässt sich auf der Medienseite zurückspielen.
          </p>
        </div>
      }

      <div class="karte">
        <h2>Zusammengefasst ({{ s.zuordnungen.length }})</h2>
        @if (s.zuordnungen.length) {
          <ul>
            @for (z of s.zuordnungen; track z.schluessel) {
              <li>
                <span class="wer">
                  <b>{{ name(z.schluessel).titel }}</b>
                  <span>{{ name(z.schluessel).interpret }}</span>
                </span>
                <span class="marke">{{ dienstListe(z) }}</span>
                <span class="marke">{{ stufeName(z.stufe) }}</span>
                <button [disabled]="arbeitet()" (click)="trennen(z.schluessel)">
                  {{ fragt() === 'trennen:' + z.schluessel ? 'wirklich trennen?' : 'trennen' }}
                </button>
              </li>
            }
          </ul>
          <p class="hinweis">
            Gespielt wird von oben nach unten: lokal, dann Jellyfin, dann Spotify. Nicht Geschmack,
            sondern Absicherung — Spotify braucht Netz, Premium und ein aktives Konto.
          </p>
        } @else {
          <p class="leer">Noch nichts zusammengefasst.</p>
        }
      </div>

      <div class="karte">
        <h2>Abgleichen</h2>
        <p class="reihe">
          <button class="wichtig" [disabled]="arbeitet()" (click)="abgleichen()">
            {{ arbeitet() ? 'gleicht ab …' : 'jetzt abgleichen' }}
          </button>
          @if (s.neu.length) {
            <span class="marke warn">{{ s.neu.length }} neu gefunden</span>
          } @else {
            <span class="marke">nichts Neues</span>
          }
          @if (s.zuordnungen.length || s.getrennt.length) {
            <button class="gefahr" [disabled]="arbeitet()" (click)="zuruecksetzen()">
              {{ fragt() === 'zuruecksetzen' ? 'wirklich alles vergessen?' : 'alles zurücksetzen' }}
            </button>
          }
        </p>
        @if (s.neu.length) {
          <ul>
            @for (z of s.neu; track z.schluessel) {
              <li>
                <span class="wer">
                  <b>{{ name(z.schluessel).titel }}</b>
                  <span>{{ name(z.schluessel).interpret }}</span>
                </span>
                <span class="marke">{{ dienstListe(z) }}</span>
              </li>
            }
          </ul>
        }
        <p class="hinweis">
          Erkannt wird über Titel und Interpret. Das trifft fast immer — aber „Deluxe", „Remaster"
          und „Live" heißen genauso wie das Original. Deshalb läuft der Abgleich nur, wenn du ihn
          startest, und jede Zusammenfassung lässt sich einzeln wieder trennen.
        </p>
      </div>

      @if (s.uebergangen.length) {
        <div class="karte">
          <h2>Gefunden, aber nicht zusammengefasst ({{ s.uebergangen.length }})</h2>
          <p class="hinweis" style="margin-top: 0">
            Der Namensvergleich hält diese für dasselbe — zusammengelegt werden sie trotzdem
            nicht. Es steht hier, damit „nichts Neues“ oben nicht rätselhaft bleibt.
          </p>
          <ul>
            @for (u of s.uebergangen; track u.schluessel.join('|')) {
              <li>
                <span class="wer">
                  <b>{{ u.titel }}</b>
                  <span>{{ u.interpret }}</span>
                </span>
                <span class="marke warn">{{ uebergangenName(u.grund) }}</span>
                <span class="hinweis" style="margin: 0; flex-basis: 100%">
                  {{ uebergangenHilfe(u.grund) }}
                </span>
              </li>
            }
          </ul>
        </div>
      }

      <!-- VON HAND ZUSAMMENLEGEN (06.09.2026). Der Abgleich vergleicht Titel
           UND Interpret; wo die Dienste sich uneinig sind — die ARD fuehrt den
           SENDER, Spotify das FORMAT —, findet er nichts. Vorher half man sich,
           indem man den Interpreten in der Bibliothek umschrieb; seitdem
           suchten Empfehlungen und Interpreten-Reihe nach dem falschen Namen. -->
      <div class="karte">
        <h2>Von Hand zusammenlegen</h2>
        <p class="hinweis" style="margin-top: 0">
          Für den Fall, dass der Abgleich zwei Kacheln nicht als dasselbe erkennt — etwa weil die
          ARD den Sender nennt und Spotify die Sendung. Hier zählt nur, was <em>Sie</em> sagen;
          Titel und Interpret werden nicht geprüft. Umkehrbar über „trennen“ weiter oben.
        </p>
        @if (wahlliste().length < 2) {
          <p class="leer">Dafür braucht es mindestens zwei Werke in der Mediathek.</p>
        } @else {
          <div class="reihe">
            <select
              [value]="handA()"
              (change)="handA.set($any($event.target).value)"
              [disabled]="arbeitet()"
              aria-label="Erstes Werk"
            >
              <option value="">— erstes Werk —</option>
              @for (w of wahlliste(); track w.schluessel) {
                <option [value]="w.schluessel">{{ w.text }}</option>
              }
            </select>
            <select
              [value]="handB()"
              (change)="handB.set($any($event.target).value)"
              [disabled]="arbeitet()"
              aria-label="Zweites Werk"
            >
              <option value="">— zweites Werk —</option>
              @for (w of wahlliste(); track w.schluessel) {
                <option [value]="w.schluessel">{{ w.text }}</option>
              }
            </select>
            <button class="wichtig" [disabled]="arbeitet() || !handA() || !handB()" (click)="handVerschmelzen()">
              Zusammenlegen
            </button>
          </div>
          <p class="hinweis">
            Das erste Werk führt: seine Kachel bleibt, das zweite geht darin auf. Verlauf und
            Weiterhören hängen am Schlüssel und bleiben bei beiden erhalten.
          </p>
        }
      </div>

      @if (getrennteMitNamen().length) {
        <div class="karte">
          <h2>Von Hand getrennt ({{ getrennteMitNamen().length }})</h2>
          <p class="hinweis" style="margin-top: 0">
            Diese Paare hält die Box auseinander, auch wenn der Abgleich sie für dasselbe hält.
          </p>
          <ul>
            @for (p of getrennteMitNamen(); track p.a + p.b) {
              <li>
                <span class="wer">
                  <b>{{ p.titel }}</b>
                  <span>{{ p.interpret }}</span>
                </span>
                <span class="marke">{{ p.dienste }}</span>
                <button [disabled]="arbeitet()" (click)="verbinden(p.a, p.b)">wieder zulassen</button>
              </li>
            }
          </ul>
        </div>
      }

      @if (meldung()) {
        <p class="hinweis">{{ meldung() }}</p>
      }
    } @else {
      <p class="leer">{{ fehler() || 'Einen Moment …' }}</p>
    }
  `,
})
export class VerschmelzungSeite {
  private readonly http = inject(HttpClient)

  readonly stand = signal<Stand | null>(null)
  readonly schalter = signal<boolean | null>(null)
  readonly arbeitet = signal(false)
  readonly meldung = signal('')
  readonly fehler = signal('')
  /**
   * Welche gefährliche Handlung gerade nachfragt.
   *
   * Zwei Klicks statt eines Dialogs — dieselbe Form wie auf der Medienseite:
   * Entfernen und Trennen sind Handlungen, die man nicht versehentlich tun
   * soll, aber ein Modal für jeden Handgriff ist auf einem Tablet lästiger als
   * hilfreich.
   */
  readonly fragt = signal('')

  /**
   * DIE HAND-VERSCHMELZUNG (06.09.2026, Betreiber-Auftrag).
   *
   * WOZU: Der Abgleich vergleicht Titel UND Interpret. Bei „Quarks Science
   * Cops" führt die ARD den SENDER (WDR), Spotify das FORMAT (Quarks) — für
   * die Heuristik zwei verschiedene Werke, für einen Menschen offensichtlich
   * dasselbe. Der Betreiber half sich, indem er den Interpreten in der
   * Bibliothek auf „WDR" umschrieb; seitdem suchten Empfehlungen und
   * Interpreten-Reihe nach dem Sender statt nach der Sendung.
   *
   * DER ENDPUNKT KONNTE ES IMMER: `/api/verschmelzung/verbinden` nimmt zwei
   * beliebige Schlüssel und schert sich nicht um Namen. Nur führte kein Weg
   * dorthin — der `verbinden`-Knopf erschien ausschließlich bei Paaren, die
   * jemand vorher von HAND GETRENNT hatte. Diese zwei Felder schließen die
   * Lücke, ohne eine Zeile Server-Code.
   */
  readonly handA = signal('')
  readonly handB = signal('')

  /** Alle Werke, nach Beschriftung sortiert — die Auswahl für die Hand-Verschmelzung. */
  readonly wahlliste = computed(() => {
    const s = this.stand()
    if (!s) return []
    return Object.entries(s.namen ?? {})
      .map(([schluessel, n]) => ({
        schluessel,
        text: `${n.titel}${n.interpret ? ` — ${n.interpret}` : ''}  (${n.dienst})`,
      }))
      .sort((x, y) => x.text.localeCompare(y.text, 'de'))
  })

  /** Die Trennungen mit Beschriftung — ein Schlüsselpaar allein sagt niemandem etwas. */
  readonly getrennteMitNamen = computed(() => {
    const s = this.stand()
    if (!s) return []
    return s.getrennt.map(([a, b]) => {
      const na = s.namen[a]
      const nb = s.namen[b]
      return {
        a,
        b,
        titel: na?.titel || nb?.titel || a,
        interpret: na?.interpret || nb?.interpret || '',
        dienste: [na?.dienst, nb?.dienst].filter(Boolean).join(' + '),
      }
    })
  })

  constructor() {
    void this.laden()
  }

  protected name(schluessel: string): Name {
    // KEIN Notbehelf mit leerem Titel: steht der Eintrag nicht mehr in der
    // Bibliothek, ist der Schlüssel das Ehrlichste, was man zeigen kann.
    return this.stand()?.namen[schluessel] ?? { titel: schluessel, dienst: '?', kategorie: '' }
  }

  protected dienstListe(z: Zuordnung): string {
    const s = this.stand()
    if (!s) return ''
    return [z.schluessel, ...z.auch]
      .map((k) => s.namen[k]?.dienst)
      .filter(Boolean)
      .join(' + ')
  }

  protected stufeName(stufe: string): string {
    return STUFEN_NAME[stufe] ?? stufe
  }

  // EIN UNBEKANNTER GRUND WIRD ANGEZEIGT, NICHT VERSCHLUCKT. Kommt spaeter ein
  // fuenfter dazu (Stufe 2 bringt Fingerabdruecke mit), steht wenigstens sein
  // Name da statt einer leeren Zeile.
  protected uebergangenName(grund: string): string {
    return UEBERGANGEN_NAME[grund] ?? grund
  }

  protected uebergangenHilfe(grund: string): string {
    return UEBERGANGEN_HILFE[grund] ?? ''
  }

  protected katName(k: string): string {
    return KATEGORIE_NAME[k] ?? (k || '(ohne)')
  }

  private async laden(): Promise<void> {
    try {
      this.stand.set(await firstValueFrom(this.http.get<Stand>('/api/verschmelzung')))
    } catch {
      this.fehler.set('Die Zuordnungen ließen sich nicht laden.')
    }
    try {
      const d = await firstValueFrom(this.http.get<{ aktuell?: { verschmelzen?: boolean } }>('/api/darstellung'))
      // `!== false` — dieselbe Richtung wie darstellung.dienst.ts und der
      // Server (Vorgabe AN seit 06.09.2026). Diese Seite ZEIGT den Stand des
      // Schalters neben den Zuordnungen; stuende hier `=== true`, meldete sie
      // „aus", obwohl die Box verschmilzt, und der Betreiber suchte den
      // Fehler bei den Zuordnungen statt beim Anzeiger.
      this.schalter.set(d?.aktuell?.verschmelzen !== false)
    } catch {
      this.schalter.set(null)
    }
  }

  /** Zwei Klicks: der erste fragt, der zweite tut. */
  private sicher(was: string): boolean {
    if (this.fragt() === was) {
      this.fragt.set('')
      return true
    }
    this.fragt.set(was)
    return false
  }

  protected async abgleichen(): Promise<void> {
    this.arbeitet.set(true)
    this.meldung.set('')
    try {
      await firstValueFrom(this.http.post('/api/verschmelzung/abgleichen', {}))
      await this.laden()
      const s = this.stand()
      this.meldung.set(s ? `${s.zuordnungen.length} Zuordnung(en) abgelegt.` : 'Abgeglichen.')
    } catch {
      this.meldung.set('Der Abgleich ließ sich nicht speichern.')
    } finally {
      this.arbeitet.set(false)
    }
  }

  protected async trennen(schluessel: string): Promise<void> {
    if (!this.sicher(`trennen:${schluessel}`)) return
    this.arbeitet.set(true)
    try {
      await firstValueFrom(this.http.post('/api/verschmelzung/trennen', { schluessel }))
      await this.laden()
      this.meldung.set('Getrennt. Der nächste Abgleich lässt es getrennt.')
    } catch {
      this.meldung.set('Das Trennen ließ sich nicht speichern.')
    } finally {
      this.arbeitet.set(false)
    }
  }

  /**
   * Zwei Werke von Hand zusammenlegen — auch wenn der Abgleich sie NICHT für
   * dasselbe hält. Derselbe Endpunkt wie „wieder zulassen"; die Regel dahinter
   * (idempotent, GETRENNT gewinnt, bestehende Zuordnung wird erweitert statt
   * verdoppelt) steht in `handVerbinden` (abgleich.ts) und ist dort geprüft.
   */
  protected async handVerschmelzen(): Promise<void> {
    const a = this.handA()
    const b = this.handB()
    if (!a || !b) {
      this.meldung.set('Bitte zwei Werke auswählen.')
      return
    }
    if (a === b) {
      // Sonst legte man ein Werk mit sich selbst zusammen — der Server nähme
      // es klaglos an, und in der Liste stünde eine Zuordnung ohne Wirkung.
      this.meldung.set('Das sind zwei Mal dasselbe Werk.')
      return
    }
    await this.verbinden(a, b)
    this.handA.set('')
    this.handB.set('')
    this.meldung.set('Zusammengelegt. Die Box zeigt beide als EINE Kachel.')
  }

  protected async verbinden(a: string, b: string): Promise<void> {
    this.arbeitet.set(true)
    try {
      await firstValueFrom(this.http.post('/api/verschmelzung/verbinden', { a, b }))
      await this.laden()
      this.meldung.set('Wieder zugelassen. Der nächste Abgleich darf es zusammenlegen.')
    } catch {
      this.meldung.set('Das ließ sich nicht speichern.')
    } finally {
      this.arbeitet.set(false)
    }
  }

  protected async zuruecksetzen(): Promise<void> {
    if (!this.sicher('zuruecksetzen')) return
    this.arbeitet.set(true)
    try {
      await firstValueFrom(this.http.post('/api/verschmelzung/zuruecksetzen', {}))
      await this.laden()
      this.meldung.set('Alles vergessen — auch die Handentscheidungen.')
    } catch {
      this.meldung.set('Das Zurücksetzen ließ sich nicht speichern.')
    } finally {
      this.arbeitet.set(false)
    }
  }

  protected async doppelEntfernen(schluessel: string, nr: number): Promise<void> {
    if (!this.sicher(`${schluessel}#${nr}`)) return
    this.arbeitet.set(true)
    try {
      const a = await firstValueFrom(
        this.http.post<{ sicherung: string }>('/api/medien/doppelte/entfernen', { schluessel, nr }),
      )
      await this.laden()
      this.meldung.set(`Zeile entfernt. Sicherung: ${a.sicherung}`)
    } catch {
      // „gesperrt" heißt: die Box schreibt gerade selbst an data.json. Das ist
      // kein Fehler, sondern eine Bitte um einen zweiten Versuch.
      this.meldung.set('Das Entfernen ging nicht — schreibt die Box gerade selbst? Noch einmal versuchen.')
    } finally {
      this.arbeitet.set(false)
    }
  }
}
