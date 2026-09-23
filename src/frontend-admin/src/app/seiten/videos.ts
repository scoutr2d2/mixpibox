/**
 * BELOHNUNGS-VIDEOS — die Elternseite.
 *
 * Betreiber am 20.09.2026: „ard videos einzelne videos freischalten mit
 * abspiel haeufigkeit es soll quasi eine belohnung sein. Mal ein
 * freigegebenes Video nicht zum dauer konsumieren."
 *
 * WAS HIER PASSIERT UND WAS NICHT: hier wird gesucht und freigegeben.
 * Entschieden wird im Server (`videofreigabe.ts`) — dieselbe Teilung wie bei
 * der Kinderzeit, und aus demselben Grund: ein Zaehler, der im Browser
 * mitlaeuft, ist beim naechsten Neuladen wieder voll.
 *
 * ZWEI QUELLEN, ZWEI WEGE — das ist kein Versehen:
 *
 *   SUCHEN geht direkt an das GEWAEHLTE Plugin
 *   (`/api/plugins/<quelle>/http/suche`). Das Mediathek-Wissen steckt dort
 *   und soll nirgends sonst stehen; der Kern hat deshalb bewusst KEINE
 *   eigene Suchroute bekommen.
 *
 *   FREIGEBEN geht an den Kern (`/api/video/freigaben`). Nur er fuehrt Buch,
 *   und nur er wird vom Kinderschirm gefragt.
 *
 * ZWEI MEDIATHEKEN, UND EINE WAHL STATT EINER MISCHUNG (20.09.2026): neben
 * der ARD steht `mixpi-mediathekview` mit ZDF, KiKA, 3sat, arte und funk.
 * BEIDE AUF EINMAL ZU FRAGEN WAERE VERLOCKEND UND FALSCH — die ARD liefert
 * Bilder und ein Kindermerkmal, der andere Dienst beides nicht, und dieselbe
 * Maus-Folge kaeme aus beiden Quellen mit verschiedenen Kacheln zurueck. Ein
 * Elternteil saehe Dubletten, die keine sind. Also waehlt man die Quelle, und
 * sie reist mit der Freigabe mit: der Kern fragt spaeter genau die.
 *
 * MARKER UND STUECKE (20.09.2026): Betreiber: „marker im video setzen zu
 * koennen um definerte stuecke zumachen eine 25 min maus ist ggf zu lange und
 * da wuerde ich es gerne teilen". Die Vorschau laeuft HIER, in der
 * Elternflaeche, und schneidet am Abspielkopf. Jedes Stueck wird eine eigene
 * Freigabe mit eigenem Zaehler — drei Teile sind dreimal etwas, nicht einmal
 * etwas in drei Haeppchen (Betreiber auf Rueckfrage).
 *
 * DIE ADRESSE FUER DIE VORSCHAU KOMMT VOM PLUGIN, nicht aus der Freigabe:
 * dieselbe Route, die der Kern beim Start ruft. Sie haelt nicht ewig, und das
 * ist hier egal — sie wird fuer das Schneiden gebraucht und danach vergessen.
 *
 * WARUM DIE ANZAHL EIN KNOPF IST UND KEIN ZAHLENFELD: „noch dreimal" ist
 * eine Entscheidung, die man in einer Sekunde trifft. Ein Feld, in das man
 * tippt, macht daraus eine Eingabe mit Tippfehler — und 30 statt 3 faellt
 * erst auf, wenn das Kind den ganzen Nachmittag geschaut hat.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { RouterLink } from '@angular/router'
import { firstValueFrom } from 'rxjs'

/** Ein Kind, so wie `/api/profile` es nennt. */
interface Profil {
  kennung: string
  name: string
}

/** Ein Suchtreffer, so wie ihn eines der beiden Mediathek-Plugins liefert. */
interface Treffer {
  kennung: string
  name: string
  sendung: string
  bild?: string
  dauerSek?: number
  kinderinhalt: boolean
  verfuegbarBis?: string
  /** Nur `mixpi-mediathekview`: der Sender (WDR, ZDF, KiKA …). */
  sender?: string
}

/** Eine Freigabe, so wie der Kern sie fuehrt. */
interface Freigabe {
  /**
   * Der Schluessel der ZEILE — bei einem Stueck etwas anderes als `kennung`.
   *
   * OPTIONAL, WEIL EINE AELTERE ANTWORT IHN NICHT HAT. Dann ist die
   * Videokennung der Schluessel, genau wie im Kern.
   */
  id?: string
  kennung: string
  /** Welches Plugin diese Kennung aufloesen kann. */
  quelle: string
  /** Wie das Stueck heisst („Teil 2"); leer bei einem ganzen Video. */
  teil: string
  abSek: number
  bisSek: number
  laengeSek: number
  name: string
  sendung: string
  bild: string
  dauerSek: number
  anzahl: number
  verbraucht: number
  rest: number
  angelegt: number
  zuletzt: number
}

/** Die Zahlen, die der Server vorgibt — abgeschrieben waeren sie zwei Wahrheiten. */
interface Grenzen {
  anzahlMax: number
  videosMax: number
  schwelle: number
}

/** Wie oft auf einmal freigegeben werden kann. */
const STUFEN = [1, 2, 3, 5]

/**
 * WIE VIELE TREFFER EINE SUCHE ZEIGT.
 *
 * ES IST DER DECKEL DIESER SEITE UND NICHT DER DES DIENSTES: „Sendung mit der
 * Maus" hat 476 Treffer, „Löwenzahn" 2159 (gemessen 20.09.2026). Beide
 * Plugins deckeln bei 24, also steht hier 24 — zwoelf war die Zahl des ersten
 * Wurfs und liess die Haelfte der Liste ungenutzt.
 *
 * SORTIERT WIRD NACH DATUM, NICHT NACH TREFFERGUETE, und das ist gemessen
 * besser: ohne Datumssortierung stehen bei „Löwenzahn" ein Trailer, ein
 * Ausschnitt und eine drei Sekunden lange Kachel ganz vorn. Wer eine Belohnung
 * aussucht, meint die letzten Folgen.
 */
const TREFFER = 24

/** Ein Stueck, wie es aus den Markern faellt. */
export interface Stueck {
  abSek: number
  bisSek: number
  teil: string
}

/**
 * MARKER -> STUECKE. Die einzige Rechnung dieser Seite, deshalb steht sie
 * ausserhalb der Klasse und hat Zeugen.
 *
 * EIN MARKER MACHT ZWEI STUECKE, nicht eines: er ist ein SCHNITT und keine
 * Grenze einer Auswahl. Wer bei Minute 8 schneidet, meint „davor" und
 * „danach" — beides.
 *
 * VIER DINGE PASSIEREN HIER, und jedes hat einen Grund:
 *   SORTIEREN   Marker entstehen in der Reihenfolge, in der jemand drueckt,
 *               und das ist nicht die Reihenfolge der Zeit.
 *   RUNDEN      Ganze Sekunden. `currentTime` ist eine Kommazahl, und
 *               `abSek`/`bisSek` sind im Kern ganze Zahlen — ungerundet
 *               faellt die Nachkommastelle dort weg, und zwei Stuecke
 *               ueberlappten sich um Bruchteile.
 *   ENTDOPPELN  Zweimal an derselben Stelle geschnitten gaebe ein Stueck der
 *               Laenge null, das nie zu Ende gesehen werden kann.
 *   ZU KURZES   Unter fuenf Sekunden faellt weg. Ein Marker direkt am Anfang
 *               ist ein Verdrueckt und kein Stueck.
 */
export function stueckeAus(marker: number[], dauerSek: number): Stueck[] {
  const ende = Math.floor(Number(dauerSek) || 0)
  if (ende <= 0) return []
  const punkte = [
    ...new Set(
      marker
        .map((m) => Math.round(Number(m) || 0))
        .filter((m) => m > 0 && m < ende)
        .sort((a, b) => a - b),
    ),
  ]
  const grenzen = [0, ...punkte, ende]
  const raus: Stueck[] = []
  for (let i = 0; i + 1 < grenzen.length; i++) {
    const ab = grenzen[i]
    const bis = grenzen[i + 1]
    if (bis - ab < 5) continue
    raus.push({ abSek: ab, bisSek: bis, teil: `Teil ${raus.length + 1}` })
  }
  // EIN EINZIGES STUECK IST KEIN STUECK: wer alle Marker wieder wegnimmt,
  // will das ganze Video — und das hat keinen Schnitt und keinen Teilnamen.
  return raus.length > 1 ? raus : []
}

/** Sekunden als `m:ss` — fuer Marker und Stuecklaengen. */
export function zeitText(sek: number): string {
  const s = Math.max(0, Math.floor(Number(sek) || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * DIE MEDIATHEKEN, DIE DIESE SEITE FRAGEN KANN.
 *
 * SIE ENTSCHEIDET NICHTS: welche Quelle ein Video aufloesen DARF, steht im
 * Server (`VIDEO_PLUGINS` in server.ts). Diese Liste sagt nur, was die Seite
 * anbietet — wer eine dritte Mediathek baut, traegt sie an beiden Orten ein,
 * und der Server ist der, der zaehlt.
 */
const QUELLEN = [
  { kennung: 'mixpi-mediathek', name: 'ARD', erweiterung: 'ARD Mediathek' },
  { kennung: 'mixpi-mediathekview', name: 'ZDF, KiKA, 3sat, arte', erweiterung: 'Mediatheken' },
] as const

@Component({
  selector: 'mupi-videos',
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    h1 { font-size: 1.3rem; margin: 0 0 0.35rem; }
    p.unter { color: var(--gedaempft); margin: 0 0 1.2rem; font-size: 0.94rem; }
    .karte {
      background: var(--flaeche, #16202b);
      border: 1px solid var(--rand, #24313f);
      border-radius: 12px;
      padding: 1rem;
      margin-bottom: 1.1rem;
    }
    h2 { font-size: 1.02rem; margin: 0 0 0.7rem; }
    .kinder { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-bottom: 0.9rem; }
    .kinder button {
      border: 1px solid var(--rand, #24313f); background: transparent; color: inherit;
      border-radius: 999px; padding: 0.35rem 0.9rem; cursor: pointer; font-size: 0.92rem;
    }
    .kinder button.hier { border-color: var(--betont, #2b6cb0); background: rgba(43,108,176,0.18); }
    .suchzeile { display: flex; gap: 0.5rem; }
    .suchzeile input {
      flex: 1; padding: 0.5rem 0.65rem; border-radius: 9px; font-size: 0.95rem;
      border: 1px solid var(--rand, #24313f); background: var(--eingabe, #0f1720); color: inherit;
    }
    button.tun {
      border: 1px solid var(--betont, #2b6cb0); background: rgba(43,108,176,0.18); color: inherit;
      border-radius: 9px; padding: 0.5rem 0.95rem; cursor: pointer; font-size: 0.92rem;
    }
    button.tun:disabled { opacity: 0.5; cursor: default; }
    ul { list-style: none; margin: 0.9rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
    li {
      display: flex; gap: 0.75rem; align-items: center;
      border: 1px solid var(--rand, #24313f); border-radius: 10px; padding: 0.55rem 0.65rem;
    }
    li.leer { opacity: 0.55; }
    li img { width: 88px; height: 50px; object-fit: cover; border-radius: 6px; background: #0b1119; flex: none; }
    .text { flex: 1; min-width: 0; }
    .text b { display: block; font-size: 0.96rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .text span { color: var(--gedaempft); font-size: 0.84rem; }
    .knoepfe { display: flex; gap: 0.35rem; flex: none; align-items: center; }
    .knoepfe button {
      border: 1px solid var(--rand, #24313f); background: transparent; color: inherit;
      border-radius: 8px; padding: 0.3rem 0.6rem; cursor: pointer; font-size: 0.86rem;
    }
    .knoepfe button.weg { border-color: var(--warnung, #e06c75); }
    .rest { font-variant-numeric: tabular-nums; font-size: 0.9rem; padding: 0 0.35rem; }
    .marke { font-size: 0.76rem; border-radius: 999px; padding: 0.05rem 0.5rem; border: 1px solid var(--rand, #24313f); }
    .hinweis { color: var(--gedaempft); font-size: 0.86rem; line-height: 1.5; margin: 0.8rem 0 0; }
    .meldung { margin-top: 0.8rem; font-size: 0.9rem; }
    .meldung.schlecht { color: var(--warnung, #e06c75); }
    .schnitt video.vorschau {
      width: 100%; max-height: 42vh; border-radius: 10px; background: #000;
      margin: 0 0 0.7rem; display: block;
    }
  `,
  template: `
    <h1>Belohnungs-Videos</h1>
    <p class="unter">
      Einzelne Videos aus den Mediatheken, freigegeben mit einer Anzahl — „noch dreimal
      anschauen“. Ist sie aufgebraucht, verschwindet das Video vom Kinderschirm.
    </p>

    <div class="karte">
      <h2>Für wen</h2>
      <div class="kinder">
        @for (k of profile(); track k.kennung) {
          <button type="button" [class.hier]="k.kennung === profil()" (click)="profilWaehlen(k.kennung)">
            {{ k.name }}
          </button>
        }
      </div>
      <p class="hinweis">
        Freigaben gehören dem Kind, nicht der Box: Was das eine sich verdient hat, ist nicht
        das Guthaben des anderen. Die <a routerLink="/kinderzeit">Hörzeit</a> bleibt davon
        unberührt — ein Video kostet keine Minuten.
      </p>
    </div>

    <div class="karte">
      <h2>Suchen und freigeben</h2>
      <div class="kinder">
        @for (q of quellen; track q.kennung) {
          <button type="button" [class.hier]="q.kennung === quelle()" (click)="quelleWaehlen(q.kennung)">
            {{ q.name }}
          </button>
        }
      </div>
      <div class="suchzeile">
        <input
          type="search"
          [placeholder]="platzhalter()"
          [(ngModel)]="begriff"
          (keyup.enter)="suchen()"
        />
        <button type="button" class="tun" (click)="suchen()" [disabled]="laeuft()">Suchen</button>
      </div>
      @if (treffer().length) {
        <ul>
          @for (t of treffer(); track t.kennung) {
            <li>
              @if (t.bild) {
                <img [src]="t.bild" alt="" />
              }
              <span class="text">
                <b>{{ t.name }}</b>
                <span>
                  {{ t.sendung || 'ohne Sendung' }}
                  @if (t.sender && t.sender !== t.sendung) {
                    · {{ t.sender }}
                  }
                  @if (t.dauerSek) {
                    · {{ minuten(t.dauerSek) }} min
                  }
                  @if (t.kinderinhalt) {
                    · <span class="marke">für Kinder</span>
                  }
                </span>
              </span>
              <span class="knoepfe">
                <button type="button" (click)="schneiden(t)" [disabled]="laeuft()">Teilen…</button>
                @for (n of stufen; track n) {
                  <button type="button" (click)="freigeben(t, n)" [disabled]="laeuft()">{{ n }}×</button>
                }
              </span>
            </li>
          }
        </ul>
      }
      <p class="hinweis">
        Gesucht wird direkt in der Erweiterung „{{ erweiterung() }}“. Ist sie ausgeschaltet,
        findet diese Seite nichts — die Freigaben darunter bleiben trotzdem stehen.
        Mehrfachfassungen (Audiodeskription, Gebärdensprache) sind aussortiert.
        @if (quelle() !== 'mixpi-mediathek') {
          Diese Quelle führt keine Vorschaubilder; Folgen, die nur als Livestream-Format
          vorliegen, fehlen, weil die Box sie nicht abspielen kann.
        }
      </p>
      @if (meldung()) {
        <p class="meldung" [class.schlecht]="meldungSchlecht()">{{ meldung() }}</p>
      }
    </div>

    @if (schnitt(); as s) {
      <div class="karte schnitt">
        <h2>„{{ s.name }}“ teilen</h2>
        <p class="hinweis">
          Lass das Video laufen und drücke „Hier schneiden“, wo ein Teil enden soll.
          Jedes Stück wird eine eigene Belohnung mit eigenem Zähler.
        </p>
        @if (schnittAdresse()) {
          <video
            #vorschau
            class="vorschau"
            [src]="schnittAdresse()"
            controls
            preload="metadata"
            (loadedmetadata)="dauerNehmen(vorschau)"
            (timeupdate)="standNehmen(vorschau)"
          ></video>
          <div class="suchzeile">
            <button type="button" class="tun" (click)="markerSetzen()">
              Hier schneiden ({{ zeit(stand()) }})
            </button>
            @if (marker().length) {
              <button type="button" (click)="markerWeg()">Letzten Marker weg</button>
            }
          </div>
          @if (stuecke().length) {
            <ul>
              @for (st of stuecke(); track st.abSek) {
                <li>
                  <span class="text">
                    <b>{{ st.teil }}</b>
                    <span>{{ zeit(st.abSek) }} – {{ zeit(st.bisSek) }} · {{ minuten(st.bisSek - st.abSek) }} min</span>
                  </span>
                  <span class="knoepfe">
                    <button type="button" (click)="stueckAnspringen(vorschau, st.abSek)">Ansehen</button>
                  </span>
                </li>
              }
            </ul>
            <div class="suchzeile">
              @for (n of stufen; track n) {
                <button type="button" class="tun" (click)="stueckeFreigeben(n)" [disabled]="laeuft()">
                  Alle {{ stuecke().length }} Teile {{ n }}× freigeben
                </button>
              }
            </div>
          } @else {
            <p class="hinweis">Noch kein Schnitt gesetzt — ohne Marker bleibt es ein ganzes Video.</p>
          }
        } @else {
          <p class="hinweis">Die Vorschau wird geholt…</p>
        }
        <button type="button" (click)="schnittSchliessen()">Schließen</button>
        @if (meldung()) {
          <p class="meldung" [class.schlecht]="meldungSchlecht()">{{ meldung() }}</p>
        }
      </div>
    }

    <div class="karte">
      <h2>Freigegeben für {{ name() }}</h2>
      @if (!freigaben().length) {
        <p class="hinweis">Noch nichts freigegeben.</p>
      }
      <ul>
        <!-- ÜBER DIE id: drei Stücke tragen dreimal dieselbe Videokennung,
             und ein track auf ihr ließe Angular zwei Zeilen für eine halten.
             (Keine Backticks in diesem Kommentar: die Vorlage IST ein
             Template-Literal, und einer davon reißt die Datei ab.) -->
        @for (f of freigaben(); track f.id || f.kennung) {
          <li [class.leer]="f.rest === 0">
            @if (f.bild) {
              <img [src]="f.bild" alt="" />
            }
            <span class="text">
              <b>{{ f.teil ? f.name + ' — ' + f.teil : f.name }}</b>
              <span>
                {{ f.sendung || 'ohne Sendung' }}
                @if (f.teil) {
                  · {{ zeit(f.abSek) }}–{{ zeit(f.bisSek) }}
                }
                @if (f.laengeSek || f.dauerSek) {
                  · {{ minuten(f.laengeSek || f.dauerSek) }} min
                }
                · {{ f.verbraucht }}× gesehen
              </span>
            </span>
            <span class="knoepfe">
              <button type="button" (click)="restAendern(f, -1)" [disabled]="laeuft() || f.rest === 0">−</button>
              <span class="rest">{{ f.rest }}×</span>
              <button type="button" (click)="restAendern(f, 1)" [disabled]="laeuft()">+</button>
              <button type="button" class="weg" (click)="entziehen(f)" [disabled]="laeuft()">Weg</button>
            </span>
          </li>
        }
      </ul>
      <p class="hinweis">
        Aufgebrauchte Videos bleiben hier stehen und sind auf dem Kinderschirm nicht mehr zu
        sehen — so lässt sich nachlegen, ohne neu zu suchen. Gezählt wird erst, wenn
        {{ prozent() }} % gesehen sind; ein Abbruch kostet nichts.
      </p>
    </div>
  `,
})
export class VideosSeite {
  private http = inject(HttpClient)

  readonly stufen = STUFEN
  readonly quellen = QUELLEN
  readonly quelle = signal<string>(QUELLEN[0].kennung)
  readonly profile = signal<Profil[]>([])
  readonly profil = signal('')
  readonly freigaben = signal<Freigabe[]>([])
  readonly treffer = signal<Treffer[]>([])
  readonly grenzen = signal<Grenzen>({ anzahlMax: 99, videosMax: 60, schwelle: 0.9 })
  readonly laeuft = signal(false)
  readonly meldung = signal('')
  readonly meldungSchlecht = signal(false)
  begriff = ''

  /* ── DER SCHNITT ──────────────────────────────────────────────────────── */

  /** Der Treffer, der gerade geteilt wird — oder `null`. */
  readonly schnitt = signal<Treffer | null>(null)
  /** Die Adresse fuer die Vorschau. Kommt vom Plugin und haelt nicht ewig. */
  readonly schnittAdresse = signal('')
  /** Die gesetzten Marker, in der Reihenfolge des Drueckens. */
  readonly marker = signal<number[]>([])
  /** Wo der Abspielkopf steht — die Zahl auf dem Schnittknopf. */
  readonly stand = signal(0)
  /** Wie lang das Video ist. Aus der DATEI, nicht aus der Suche. */
  readonly dauer = signal(0)

  /**
   * DIE STUECKE SIND ABGELEITET UND NICHT GESPEICHERT.
   *
   * Gespeichert sind die Marker; die Stuecke fallen daraus. Beides zu halten
   * hiesse, sie bei jedem Marker nachzufuehren — und die eine Stelle zu
   * vergessen, an der das nicht passiert, ist eine Frage der Zeit.
   */
  readonly stuecke = computed(() => stueckeAus(this.marker(), this.dauer()))

  readonly name = computed(() => this.profile().find((p) => p.kennung === this.profil())?.name ?? this.profil())
  readonly prozent = computed(() => Math.round(this.grenzen().schwelle * 100))

  /** Wie die gewaehlte Erweiterung in der Verwaltung heisst. */
  readonly erweiterung = computed(
    () => QUELLEN.find((q) => q.kennung === this.quelle())?.erweiterung ?? this.quelle(),
  )

  readonly platzhalter = computed(() =>
    this.quelle() === 'mixpi-mediathek'
      ? 'Sendung oder Folge, z. B. „Sendung mit der Maus“'
      : 'Sendung oder Folge, z. B. „Löwenzahn“',
  )

  /**
   * Die Quelle wechseln — und die Trefferliste dabei LEEREN.
   *
   * Stehen zu lassen waere die teurere Variante: die Kacheln saehen aus wie
   * Treffer der neuen Quelle, und ein Knopf darauf gaebe ein Video der alten
   * frei. Die Freigabe waere richtig (die Quelle reist mit), die Erwartung
   * nicht.
   */
  quelleWaehlen(kennung: string): void {
    if (kennung === this.quelle()) return
    this.quelle.set(kennung)
    this.treffer.set([])
    this.meldung.set('')
  }

  constructor() {
    void this.laden()
  }

  minuten(sek: number): number {
    return Math.max(1, Math.round(sek / 60))
  }

  zeit(sek: number): string {
    return zeitText(sek)
  }

  /**
   * WELCHE ZEILE GEMEINT IST — `id`, und die Videokennung als Rueckfall.
   *
   * Dieselbe Regel wie im Kern (`videoZeileAus` in server.ts), und aus
   * demselben Grund: bei einem ganzen Video sind beide dieselbe
   * Zeichenfolge, und eine Antwort ohne `id` soll die Seite nicht lahmlegen.
   */
  private zeile(f: Freigabe): string {
    return f.id || f.kennung
  }

  /**
   * Die Vorschau aufziehen: die Adresse beim Plugin holen.
   *
   * DIESELBE ROUTE, DIE DER KERN BEIM START RUFT. Hier ist sie lesend und
   * folgenlos — geschnitten wird auf dem Bild, gezaehlt wird nichts.
   */
  async schneiden(t: Treffer): Promise<void> {
    this.schnitt.set(t)
    this.schnittAdresse.set('')
    this.marker.set([])
    this.stand.set(0)
    // DIE DAUER AUS DER SUCHE IST NUR EIN ANFANGSWERT: sie steht dort nicht
    // immer, und die DATEI weiss es genauer. `loadedmetadata` ueberschreibt.
    this.dauer.set(t.dauerSek ?? 0)
    this.laeuft.set(true)
    try {
      const a = await firstValueFrom(
        this.http.get<{ ok?: boolean; quelle?: { adresse?: string }; dauerSek?: number; grund?: string }>(
          `/api/plugins/${this.quelle()}/http/video/${encodeURIComponent(t.kennung)}`,
        ),
      )
      if (!a?.quelle?.adresse) {
        this.sag(a?.grund ? `Keine Vorschau: ${a.grund}` : 'Die Vorschau ließ sich nicht holen.', true)
        return
      }
      this.schnittAdresse.set(a.quelle.adresse)
      if (a.dauerSek) this.dauer.set(a.dauerSek)
    } catch {
      this.sag('Die Vorschau ließ sich nicht holen.', true)
    } finally {
      this.laeuft.set(false)
    }
  }

  schnittSchliessen(): void {
    this.schnitt.set(null)
    this.schnittAdresse.set('')
    this.marker.set([])
  }

  /**
   * Die Dauer aus der DATEI nehmen.
   *
   * Sie ist die verlaessliche: die Suche nennt gerundete Sekunden oder gar
   * nichts, und ein Stueck, das eine Sekunde hinter dem Ende endet, laeuft
   * nie zu Ende — und verbraucht sich nie.
   */
  dauerNehmen(v: { duration?: number }): void {
    const d = Number(v?.duration)
    if (Number.isFinite(d) && d > 0) this.dauer.set(Math.floor(d))
  }

  standNehmen(v: { currentTime?: number }): void {
    const s = Number(v?.currentTime)
    if (Number.isFinite(s)) this.stand.set(s)
  }

  markerSetzen(): void {
    this.marker.set([...this.marker(), this.stand()])
  }

  markerWeg(): void {
    this.marker.set(this.marker().slice(0, -1))
  }

  /** In die Vorschau an den Anfang eines Stuecks springen. */
  stueckAnspringen(v: { currentTime?: number }, abSek: number): void {
    if (v) v.currentTime = abSek
  }

  /**
   * Alle Stuecke auf einmal freigeben — jedes als eigene Belohnung.
   *
   * NACHEINANDER UND NICHT NEBENEINANDER: der Kern schreibt die Ablage bei
   * jedem Ruf ganz, und zwei gleichzeitige Rufe ueberschrieben einander —
   * der zweite kennt den ersten noch nicht.
   */
  async stueckeFreigeben(anzahl: number): Promise<void> {
    const t = this.schnitt()
    const liste = this.stuecke()
    if (!t || !liste.length) return
    this.laeuft.set(true)
    let gelungen = 0
    try {
      for (const st of liste) {
        await firstValueFrom(
          this.http.post(`/api/video/freigaben?profil=${encodeURIComponent(this.profil())}`, {
            kennung: t.kennung,
            quelle: this.quelle(),
            name: t.name,
            sendung: t.sendung,
            bild: t.bild ?? '',
            dauerSek: this.dauer(),
            abSek: st.abSek,
            bisSek: st.bisSek,
            teil: st.teil,
            anzahl,
          }),
        )
        gelungen++
      }
      await this.freigabenLaden()
      this.sag(`${gelungen} Teile sind ${anzahl}× freigegeben.`, false)
      this.schnittSchliessen()
    } catch {
      // WAS SCHON DRIN IST, BLEIBT DRIN. Die Zahl zu nennen ist wichtiger als
      // eine glatte Meldung: sonst legt jemand alles noch einmal an.
      await this.freigabenLaden()
      this.sag(`Nur ${gelungen} von ${liste.length} Teilen ließen sich freigeben.`, true)
    } finally {
      this.laeuft.set(false)
    }
  }

  private async laden(): Promise<void> {
    try {
      const stand = await firstValueFrom(this.http.get<{ profile: Profil[]; aktiv: string }>('/api/profile'))
      this.profile.set(stand.profile ?? [])
      // DAS AKTIVE PROFIL IST DIE VORGABE, nicht das erste der Liste: wer
      // hier sitzt, meint meistens das Kind, das gerade an der Box ist.
      this.profil.set(stand.aktiv || stand.profile?.[0]?.kennung || 'gast')
    } catch {
      this.profil.set('gast')
    }
    await this.freigabenLaden()
  }

  async profilWaehlen(kennung: string): Promise<void> {
    this.profil.set(kennung)
    await this.freigabenLaden()
  }

  private async freigabenLaden(): Promise<void> {
    try {
      const a = await firstValueFrom(
        this.http.get<{ videos: Freigabe[]; grenzen: Grenzen }>(
          `/api/video/freigaben?profil=${encodeURIComponent(this.profil())}`,
        ),
      )
      this.freigaben.set(a.videos ?? [])
      if (a.grenzen) this.grenzen.set(a.grenzen)
    } catch {
      this.sag('Die Freigaben konnten nicht geladen werden.', true)
    }
  }

  async suchen(): Promise<void> {
    const b = this.begriff.trim()
    if (b.length < 2) {
      this.sag('Bitte mindestens zwei Zeichen eingeben.', true)
      return
    }
    this.laeuft.set(true)
    try {
      // DIREKT ANS GEWAEHLTE PLUGIN. Der Kern hat keine eigene Suchroute,
      // damit das Mediathek-Wissen an genau einer Stelle steht.
      const a = await firstValueFrom(
        this.http.get<{ treffer: Treffer[] }>(
          `/api/plugins/${this.quelle()}/http/suche?begriff=${encodeURIComponent(b)}&anzahl=${TREFFER}`,
        ),
      )
      this.treffer.set(a.treffer ?? [])
      this.sag(a.treffer?.length ? `${a.treffer.length} Treffer.` : 'Nichts gefunden.', false)
    } catch {
      this.treffer.set([])
      this.sag(`Die Suche ging nicht — ist die Erweiterung „${this.erweiterung()}“ eingeschaltet?`, true)
    } finally {
      this.laeuft.set(false)
    }
  }

  async freigeben(t: Treffer, anzahl: number): Promise<void> {
    this.laeuft.set(true)
    try {
      await firstValueFrom(
        this.http.post(`/api/video/freigaben?profil=${encodeURIComponent(this.profil())}`, {
          kennung: t.kennung,
          // DIE QUELLE REIST MIT. Ohne sie fragte der Kern beim Start die ARD
          // nach einer Kennung, die eine andere Mediathek vergeben hat — und
          // das Kind saehe „gibt es nicht mehr".
          quelle: this.quelle(),
          name: t.name,
          sendung: t.sendung,
          bild: t.bild ?? '',
          dauerSek: t.dauerSek ?? 0,
          anzahl,
        }),
      )
      await this.freigabenLaden()
      this.sag(`„${t.name}“ ist ${anzahl}× freigegeben.`, false)
    } catch {
      this.sag('Nicht freigegeben — vielleicht ist die Liste dieses Kindes voll.', true)
    } finally {
      this.laeuft.set(false)
    }
  }

  /**
   * Den Rest um eins aendern.
   *
   * GESETZT WIRD DER REST, nicht die Gesamtzahl — so steht es auch im Server.
   * „Noch zweimal" ist, was auf der Kachel steht; die Gesamtzahl hat niemand
   * im Kopf.
   */
  async restAendern(f: Freigabe, um: number): Promise<void> {
    const neu = Math.max(0, Math.min(this.grenzen().anzahlMax, f.rest + um))
    this.laeuft.set(true)
    try {
      await firstValueFrom(
        this.http.put(`/api/video/freigaben?profil=${encodeURIComponent(this.profil())}`, {
          // UEBER DIE id: drei Stuecke tragen dieselbe Videokennung, und
          // „+" auf Teil 2 meint Teil 2.
          id: this.zeile(f),
          kennung: this.zeile(f),
          rest: neu,
        }),
      )
      await this.freigabenLaden()
    } catch {
      this.sag('Die Zahl ließ sich nicht ändern.', true)
    } finally {
      this.laeuft.set(false)
    }
  }

  async entziehen(f: Freigabe): Promise<void> {
    this.laeuft.set(true)
    try {
      await firstValueFrom(
        this.http.post(`/api/video/entziehen?profil=${encodeURIComponent(this.profil())}`, {
          id: this.zeile(f),
          kennung: this.zeile(f),
        }),
      )
      await this.freigabenLaden()
      this.sag(`„${f.name}“ ist entfernt.`, false)
    } catch {
      this.sag('Das ließ sich nicht entfernen.', true)
    } finally {
      this.laeuft.set(false)
    }
  }

  private sag(text: string, schlecht: boolean): void {
    this.meldung.set(text)
    this.meldungSchlecht.set(schlecht)
  }
}
