/**
 * Interpreten — wer in der runden Reihe der Box steht, und wer nicht.
 *
 * DREI TEILE, und jeder beantwortet eine andere Frage:
 *   AUS DEINER BIBLIOTHEK   Was hat die Box unter „Interpret" gefunden, und was
 *                           hat die Automatik daraus gemacht? Hier steht auch,
 *                           WORAUF sie sich stuetzt — Name, Spotify-Kennung,
 *                           Zahl der eigenen Werke. Ohne diese drei Angaben
 *                           entscheidet man blind.
 *   SUCHE                   Jemanden freischalten, von dem die Box NICHTS hat.
 *   FREIGESCHALTET/ABGELEHNT  Was gilt — und der Weg zurueck.
 *
 * DAS VORBILD IST „Doppelte" (/verschmelzung), bis in die Bauart: Karten, ein
 * Knopf je Zeile, zwei Klicks fuer alles, was wegnimmt, und zu jeder
 * Entscheidung ein Rueckweg. Eine eigene Seite und keine weitere Karte auf
 * „Medien", aus demselben Grund wie dort: die Medienseite AENDERT die
 * Bibliothek, diese hier ruehrt sie nicht an.
 *
 * DIE MEDIENLISTE BLEIBT UNBERUEHRT (so vom Benutzer entschieden). Alles auf
 * dieser Seite landet in config/interpreten.json neben data.json. Die Datei zu
 * loeschen heisst danach wirklich „wie vorher".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DER FALL, DER DIESE SEITE UEBERHAUPT NOETIG MACHT, und er ist der HAEUFIGSTE:
 * ein Interpret der EIGENEN Bibliothek, den Spotify unter DIESEM Namen nicht
 * kennt. Auf der Box sind das sieben von sechzehn (gemessen 03.08.2026,
 * tools/interpreten-erkennung.mjs) — „EUROPA Hörspiele & Kinderlieder",
 * „lismio: Kids - Hörbücher & Musik" und so fort.
 *
 * FUER IHN GIBT ES „bei Spotify suchen" UND DAS ZUORDNEN. Der Knopf legt den
 * BIBLIOTHEKSNAMEN als Ziel fest; freigeschaltet wird danach mit der Kennung
 * des Spotify-Treffers, aber unter dem Namen der Bibliothek. Das ist die ganze
 * Mechanik, und sie steht hier, weil man sie sonst falsch herum baut:
 *
 *     Schluessel der Ablage = interpretSchluesselAus(name)          (interpreten.ts)
 *     Schluessel des Regals = interpretSchluesselAus(werk.interpret) (werke.ts)
 *
 * Beide Male DIESELBE Funktion (bis 19.08.2026 war es `normal()`, das aber
 * „Die drei ???" und „Die drei !!!" zusammenwarf — E45-Bestandsreview, die
 * Begruendung steht in medien.ts). Schaltet man unter dem SPOTIFY-Namen frei,
 * entsteht ein zweiter Schluessel — und damit eine zweite runde Kachel mit
 * „0 Werke" neben der ersten, die weiter ausgeblendet bleibt. Zwei Kacheln fuer
 * eine Person, und keine davon vollstaendig. Deshalb schickt diese Seite beim
 * Zuordnen den Bibliotheksnamen und die fremde Kennung zusammen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WIE SICH „Ganze Diskografie" ZUM FREISCHALTEN VERHAELT — zwei Schalter, zwei
 * Fragen, und sie werden leicht verwechselt:
 *
 *     FREISCHALTEN      entscheidet, WER in der runden Reihe steht.
 *     GANZE DISKOGRAFIE entscheidet, WAS auf seiner Seite steht.
 *
 * Sie haengen an genau einer Stelle zusammen, und die ist wichtig genug fuer
 * einen Hinweis auf dieser Seite: Ein Freigeschalteter OHNE eigene Werke hat
 * keine Reihe „In deiner Box". Steht der Schalter AUS, holt `/api/interpret`
 * Alben, Singles und Sammlungen gar nicht erst (server.ts, `diskografie`) —
 * seine Seite besteht dann aus Kopf und beliebtesten Titeln. GEMESSEN am
 * 03.08.2026 gegen tools/neu-vorschau.mjs: mit Schalter 36 Reihen-Eintraege
 * (10 Titel + 5 Alben + 15 Singles + 6 Sammlungen), ohne ihn 1 Reihe. Wer
 * jemanden per SUCHE freischaltet und den Schalter aus laesst, bekommt also
 * eine Kachel, hinter der fast nichts steht.
 *
 * UMGEKEHRT GILT NICHTS: Der Schalter allein bringt niemanden in die Reihe.
 * ─────────────────────────────────────────────────────────────────────────────
 * WAS GILT, SOLANGE NICHTS ENTSCHIEDEN IST: die Automatik, genau wie bisher.
 * Eine leere Reihe waere ein Rueckschritt gegenueber heute — deshalb faengt
 * diese Seite mit dem an, was die Box schon tut, und nicht mit einer leeren
 * Liste, die man erst fuellen muss.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { RouterLink } from '@angular/router'
import { firstValueFrom } from 'rxjs'

/** Ein Eintrag der runden Reihe — die Form aus interpreten.ts. */
interface Interpret {
  schluessel: string
  name: string
  id: string | null
  /** IMMER ein Weg ueber die Box (`/api/bild/…`), nie eine CDN-Adresse. */
  bild: string | null
  anzahl: number
  werke: string[]
  herkunft: 'bibliothek' | 'frei'
  grund?: 'abgelehnt' | 'nichtErkannt'
}

interface Freischaltung {
  schluessel: string
  id: string
  name: string
  quelle: 'suche' | 'erkannt' | 'hand'
  /** ROH, so wie Spotify sie liefert — NICHT in ein `<img src>` (siehe `bildVon`). */
  bild?: string
  seit?: string
}

interface Ablehnung {
  schluessel: string
  name: string
  seit?: string
}

interface Stand {
  reihe: Interpret[]
  versteckt: Interpret[]
  frei: Freischaltung[]
  abgelehnt: Ablehnung[]
}

interface Treffer {
  id: string
  name: string
  /** Ueber die Box. */
  bild: string | null
  /** Die ROHE Adresse — sie wandert beim Freischalten in die Ablage. */
  bildRoh: string | null
  genres: string[]
  follower: number
  urteil: 'frei' | 'abgelehnt' | 'offen'
}

const QUELLE_NAME: Record<string, string> = {
  suche: 'über die Suche',
  erkannt: 'aus der Bibliothek',
  hand: 'von Hand',
}

@Component({
  selector: 'mupi-interpreten',
  standalone: true,
  imports: [RouterLink, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    h1 { font-size: 1.3rem; margin: 0 0 0.35rem; }
    h2 { font-size: 1.05rem; margin: 0 0 0.7rem; }
    h3 { font-size: 0.9rem; margin: 1rem 0 0.2rem; color: var(--gedaempft); font-weight: 600; }
    h3:first-of-type { margin-top: 0.2rem; }
    p.unter { color: var(--gedaempft); margin: 0 0 1.3rem; font-size: 0.94rem; }
    .karte {
      background: var(--flaeche); border: 1px solid var(--rand); border-radius: 14px;
      padding: 1rem 1.1rem; margin-bottom: 1.2rem;
    }
    .karte.warn { border-color: var(--warn); }
    ul { list-style: none; margin: 0.5rem 0 0; padding: 0; display: grid; gap: 0.45rem; }
    li {
      display: flex; gap: 0.7rem; align-items: center; flex-wrap: wrap;
      padding: 0.5rem 0.6rem; border: 1px solid var(--rand); border-radius: 10px;
    }
    .wer { display: flex; flex-direction: column; min-width: 9rem; flex: 1 1 9rem; }
    .wer span { color: var(--gedaempft); font-size: 0.85rem; }
    /* Rund, weil die Kachel auf der Box rund ist. Wer hier eine eckige Miniatur
       sieht und dort eine runde, sucht zweimal. */
    .bildchen {
      width: 44px; height: 44px; border-radius: 50%; object-fit: cover;
      background: var(--grund); flex: 0 0 auto;
    }
    .ersatz {
      display: flex; align-items: center; justify-content: center;
      font-weight: 600; color: var(--gedaempft); border: 1px solid var(--rand);
    }
    .marke {
      font-size: 0.78rem; padding: 0.15rem 0.5rem; border-radius: 999px;
      border: 1px solid var(--rand); color: var(--gedaempft); white-space: nowrap;
    }
    .marke.gut { border-color: var(--gut); color: var(--gut); }
    .marke.warn { border-color: var(--warn); color: var(--warn); }
    .kennung { font-family: ui-monospace, monospace; font-size: 0.76rem; color: var(--gedaempft); }
    .reihe { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
    .hinweis { color: var(--gedaempft); font-size: 0.87rem; margin: 0.6rem 0 0; }
    .leer { color: var(--gedaempft); font-size: 0.9rem; margin: 0; }
    /* Die Knoepfe der Zeilen sind kleiner als die globalen — sonst ist eine
       Liste mit dreissig Namen zwei Bildschirme hoch. Die Hoehe bleibt bei
       rund 40 px; angefasst wird das hier mit der Maus oder am Tablet, nicht
       am 5-Zoll-Schirm der Box. */
    li button, .reihe button {
      background: var(--grund); border: 1px solid var(--rand); color: inherit;
      border-radius: 8px; padding: 0.45rem 0.85rem; font: inherit;
    }
    button.wichtig { background: var(--leit); border-color: transparent; color: #fff; }
    button.gefahr { border-color: #7d3030; color: #ff9b9b; }
    input[type='search'] {
      flex: 1 1 16rem; width: auto; padding: 0.55rem 0.7rem;
      border-radius: 8px; border: 1px solid var(--rand);
      background: var(--grund); color: var(--schrift); font: inherit;
    }
    .ziel {
      border: 1px solid var(--leit); border-radius: 10px; padding: 0.5rem 0.7rem;
      margin: 0.7rem 0 0; display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap;
      font-size: 0.9rem;
    }
    /* Der Rueckweg zur Elternseite — gleiche Bauart wie auf „Doppelte".
       Gedaempft, aber mit Polsterung: die Verwaltung wird meistens am Handy
       bedient, und ein Verweis in Textgroesse ist dort rund 22 px hoch — zu
       wenig fuer einen Daumen. Mit dem Innenabstand sind es gemessene 47 px. */
    a.zurueck {
      display: inline-block; color: var(--gedaempft); text-decoration: none;
      font-size: 0.9rem; padding: 0.8rem 0.7rem 0.8rem 0; margin-bottom: 0.2rem;
    }
    a.zurueck:hover { color: var(--schrift); }
  `,
  template: `
    <!-- DER RUECKWEG. Seit dem 03.08.2026 steht diese Seite nicht mehr in der
         Kopfleiste (Unterseite von „Medien"). Beim Gegenlesen aufgefallen:
         solange man hier steht, leuchtet KEIN Leisteneintrag — wer ueber
         Lesezeichen oder Suche hereinkommt, sieht eine Seite, deren Name in
         der Leiste nicht vorkommt, und keinen Hinweis, wo sie haengt. Der Weg
         HIN steht auf der Medienseite; der Weg ZURUECK stand nirgends.
         Geprueft wird das ab jetzt von tools/verwaltung-wege-schau.mjs. -->
    <a class="zurueck" routerLink="/medien">← Medien</a>
    <h1>Interpreten</h1>
    <p class="unter">
      Die runde Reihe auf der Box zeigt Interpreten. Wer dort steht, entscheidet bisher allein
      Spotifys Namenssuche — hier bekommst du das letzte Wort. Die Bibliothek bleibt dabei
      unangetastet; ein Interpret wird <em>kein</em> Medieneintrag, er lässt sich ja nicht
      abspielen, nur öffnen.
    </p>

    <div class="karte">
      <h2>Wie das mit „Ganze Diskografie“ zusammenhängt</h2>
      <p class="reihe" style="margin: 0">
        <span class="marke" [class.gut]="schalter() === true" [class.warn]="schalter() === false">
          {{ schalter() === null ? 'Die Darstellung antwortet gerade nicht' : schalter() ? 'Ganze Diskografie ist AN' : 'Ganze Diskografie ist AUS' }}
        </span>
        <!-- ZEIGTE BIS ZUM 03.08.2026 AUF /darstellung — dort steht „Ganze
             Diskografie" seit demselben Tag nicht mehr, sie ist auf die
             Medienseite gewandert (G5). Der Verweis blieb stehen und schickte
             damit ausgerechnet die Leute, die den Schalter suchen, auf eine
             Seite ohne ihn. Gefunden beim Gegenlesen. -->
        <a routerLink="/medien">auf der Medienseite umstellen</a>
      </p>
      <p class="hinweis">
        Zwei Schalter, zwei Fragen: <b>Freischalten</b> entscheidet, <em>wer</em> in der runden
        Reihe steht. <b>Ganze Diskografie</b> entscheidet, <em>was</em> auf seiner Seite steht.
      </p>
      @if (schalter() === false && ohneWerke().length) {
        <p class="hinweis">
          Achtung, hier greift beides ineinander: {{ ohneWerke().length }} freigeschaltete(r)
          Interpret(en) haben <b>kein einziges eigenes Werk</b> in dieser Box. Solange „Ganze
          Diskografie“ aus ist, holt die Box für sie keine Alben — ihre Seite besteht dann aus
          Bild und den beliebtesten Titeln. Die Kachel steht da, aber dahinter ist fast nichts.
        </p>
      }
    </div>

    @if (stand(); as s) {
      <div class="karte">
        <h2>Aus deiner Bibliothek ({{ ausserhalb().length + drin().length }})</h2>
        <p class="hinweis" style="margin-top: 0">
          Jeder Name, der in der Bibliothek als Interpret steht. Daneben, worauf sich die
          Erkennung stützt: die Spotify-Kennung und wie viele eigene Werke die Box unter ihm hat.
        </p>

        @if (ausserhalb().length) {
          <h3>Nicht in der Reihe ({{ ausserhalb().length }})</h3>
          <ul>
            @for (p of ausserhalb(); track p.schluessel) {
              <li>
                @if (p.bild) {
                  <img class="bildchen" [src]="p.bild" alt="" />
                } @else {
                  <span class="bildchen ersatz">{{ anfang(p.name) }}</span>
                }
                <span class="wer">
                  <b>{{ p.name }}</b>
                  <span>{{ werkeText(p.anzahl) }}</span>
                </span>
                @if (p.grund === 'abgelehnt') {
                  <span class="marke warn">abgelehnt</span>
                } @else {
                  <span class="marke warn">bei Spotify nicht gefunden</span>
                }
                <!-- Die Kennung steht nur da, wenn es eine gibt. „ohne Kennung"
                     danebenzuschreiben waere dasselbe zweimal: die Marke links
                     sagt es schon, und die Zeile wurde davon zweizeilig. -->
                @if (p.id) {
                  <span class="kennung">{{ p.id }}</span>
                }
                @if (p.id) {
                  <button class="wichtig" [disabled]="arbeitet()" (click)="freischalten(p.id, p.name, null)">
                    freischalten
                  </button>
                } @else {
                  <button [disabled]="arbeitet()" (click)="zuordnenStarten(p.name)">bei Spotify suchen</button>
                }
                @if (p.grund === 'abgelehnt') {
                  <button [disabled]="arbeitet()" (click)="offen(p.name)">zurück zur Automatik</button>
                } @else {
                  <button [disabled]="arbeitet()" (click)="ablehnen(p.name)">
                    {{ fragt() === 'nein:' + p.schluessel ? 'wirklich ablehnen?' : 'endgültig ablehnen' }}
                  </button>
                }
              </li>
            }
          </ul>
          <p class="hinweis">
            „Spotify kennt den Namen nicht“ heißt nicht, dass es ihn nicht gibt — nur, dass er
            dort anders geschrieben steht. Über „bei Spotify suchen“ wird der Treffer dem Namen
            aus <em>deiner</em> Bibliothek zugeordnet; die Kachel behält dann ihre eigenen Werke.
            „Endgültig ablehnen“ ist für alles, was gar kein Interpret ist (Ersteller, Label,
            Sender): es überlebt den Neustart und erspart der Box bei jedem Start eine Anfrage.
          </p>
        }

        @if (drin().length) {
          <h3>In der Reihe ({{ drin().length }})</h3>
          <ul>
            @for (p of drin(); track p.schluessel) {
              <li>
                @if (p.bild) {
                  <img class="bildchen" [src]="p.bild" alt="" />
                } @else {
                  <span class="bildchen ersatz">{{ anfang(p.name) }}</span>
                }
                <span class="wer">
                  <b>{{ p.name }}</b>
                  <span>{{ werkeText(p.anzahl) }}</span>
                </span>
                <span class="marke gut">{{ p.herkunft === 'frei' ? 'freigeschaltet' : 'automatisch erkannt' }}</span>
                <span class="kennung">{{ p.id || 'ohne Kennung' }}</span>
                @if (p.herkunft === 'frei') {
                  <button [disabled]="arbeitet()" (click)="offen(p.name)">zurück zur Automatik</button>
                } @else if (p.id) {
                  <button [disabled]="arbeitet()" (click)="freischalten(p.id, p.name, null)" title="Festschreiben, damit die Automatik es nicht mehr entscheidet">
                    festschreiben
                  </button>
                }
                <button [disabled]="arbeitet()" (click)="ablehnen(p.name)">
                  {{ fragt() === 'nein:' + p.schluessel ? 'wirklich ablehnen?' : 'ablehnen' }}
                </button>
              </li>
            }
          </ul>
        } @else {
          <p class="leer">Zurzeit steht niemand aus der Bibliothek in der Reihe.</p>
        }
      </div>

      <div class="karte">
        <h2>Suchen und freischalten</h2>
        <p class="hinweis" style="margin-top: 0">
          Auch jemand, von dem in dieser Box <em>kein einziges</em> Album liegt, kann in die Reihe
          — die Box führt dann direkt auf seine Diskografie bei Spotify.
        </p>
        <form class="reihe" (submit)="suchen($event)">
          <input
            type="search"
            name="q"
            placeholder="Name des Interpreten"
            [ngModel]="suchtext()"
            (ngModelChange)="suchtext.set($event)"
            [disabled]="sucht()"
          />
          <button class="wichtig" type="submit" [disabled]="sucht() || !suchtext().trim()">
            {{ sucht() ? 'sucht …' : 'suchen' }}
          </button>
        </form>

        @if (zuordnenZu()) {
          <p class="ziel">
            <span>
              Der nächste Treffer wird <b>„{{ zuordnenZu() }}“</b> zugeordnet — dem Namen aus
              deiner Bibliothek. So behält die Kachel ihre eigenen Werke.
            </span>
            <button (click)="zuordnenZu.set('')">doch nicht zuordnen</button>
          </p>
        }

        @if (treffer().length) {
          <ul>
            @for (t of treffer(); track t.id) {
              <li>
                @if (t.bild) {
                  <img class="bildchen" [src]="t.bild" alt="" />
                } @else {
                  <span class="bildchen ersatz">{{ anfang(t.name) }}</span>
                }
                <span class="wer">
                  <b>{{ t.name }}</b>
                  <span>{{ trefferUnter(t) }}</span>
                </span>
                @if (!zuordnenZu() && t.urteil !== 'offen') {
                  <span class="marke" [class.gut]="t.urteil === 'frei'" [class.warn]="t.urteil === 'abgelehnt'">
                    {{ t.urteil === 'frei' ? 'steht schon in der Reihe' : 'abgelehnt' }}
                  </span>
                }
                <span class="kennung">{{ t.id }}</span>
                <button
                  class="wichtig"
                  [disabled]="arbeitet() || (!zuordnenZu() && t.urteil === 'frei')"
                  (click)="freischalten(t.id, zuordnenZu() || t.name, t.bildRoh)"
                >
                  {{ zuordnenZu() ? 'als „' + zuordnenZu() + '“ freischalten' : 'freischalten' }}
                </button>
              </li>
            }
          </ul>
        } @else if (gesucht()) {
          <p class="hinweis">{{ suchfehler() || 'Dazu findet Spotify niemanden.' }}</p>
        }
      </div>

      <div class="karte">
        <h2>Freigeschaltet ({{ s.frei.length }})</h2>
        @if (s.frei.length) {
          <ul>
            @for (f of s.frei; track f.schluessel) {
              <li>
                @if (bildVon(f.schluessel); as b) {
                  <img class="bildchen" [src]="b" alt="" />
                } @else {
                  <span class="bildchen ersatz">{{ anfang(f.name) }}</span>
                }
                <span class="wer">
                  <b>{{ f.name }}</b>
                  <span>{{ werkeText(anzahlVon(f.schluessel)) }} · {{ quelleName(f.quelle) }}</span>
                </span>
                <span class="kennung">{{ f.id }}</span>
                <button [disabled]="arbeitet()" (click)="offen(f.name)">zurück zur Automatik</button>
              </li>
            }
          </ul>
          <p class="hinweis">
            Freigeschaltet heißt: die Box fragt Spotify zu diesem Namen nicht mehr, und die Kachel
            steht — auch wenn nichts von ihm in der Bibliothek liegt.
          </p>
        } @else {
          <p class="leer">
            Noch nichts freigeschaltet. Solange hier nichts steht, verhält sich die Box wie bisher:
            die Automatik entscheidet, und im Zweifel wird gezeigt.
          </p>
        }
      </div>

      @if (s.abgelehnt.length) {
        <div class="karte">
          <h2>Abgelehnt ({{ s.abgelehnt.length }})</h2>
          <p class="hinweis" style="margin-top: 0">
            Diese Namen bleiben aus der Reihe, auch wenn Spotify jemanden dieses Namens führt.
          </p>
          <ul>
            @for (a of s.abgelehnt; track a.schluessel) {
              <li>
                <span class="wer"><b>{{ a.name }}</b></span>
                <button [disabled]="arbeitet()" (click)="offen(a.name)">zurück zur Automatik</button>
              </li>
            }
          </ul>
        </div>
      }

      @if (s.frei.length || s.abgelehnt.length) {
        <div class="karte">
          <h2>Alles zurücknehmen</h2>
          <p class="reihe">
            <button class="gefahr" [disabled]="arbeitet()" (click)="zuruecksetzen()">
              {{ fragt() === 'zuruecksetzen' ? 'wirklich alles vergessen?' : 'alle Entscheidungen vergessen' }}
            </button>
          </p>
          <p class="hinweis">
            Danach entscheidet wieder allein die Automatik — genau wie vor dieser Seite.
          </p>
        </div>
      }

      @if (meldung()) {
        <p class="hinweis">{{ meldung() }}</p>
      }
    } @else {
      <p class="leer">{{ fehler() || 'Einen Moment … die Box fragt dafür bei Spotify nach.' }}</p>
    }
  `,
})
export class InterpretenSeite {
  private readonly http = inject(HttpClient)

  readonly stand = signal<Stand | null>(null)
  /** Der Schalter „Ganze Diskografie". `null` = die Darstellung antwortet nicht. */
  readonly schalter = signal<boolean | null>(null)
  readonly arbeitet = signal(false)
  readonly meldung = signal('')
  readonly fehler = signal('')
  /** Zwei Klicks statt eines Dialogs — dieselbe Form wie auf „Doppelte". */
  readonly fragt = signal('')

  readonly suchtext = signal('')
  readonly treffer = signal<Treffer[]>([])
  readonly sucht = signal(false)
  readonly gesucht = signal(false)
  readonly suchfehler = signal('')
  /**
   * Der BIBLIOTHEKSNAME, unter dem der naechste Treffer freigeschaltet wird.
   *
   * Leer heisst: unter seinem eigenen Spotify-Namen. Warum das ueberhaupt zwei
   * Faelle sind, steht ausfuehrlich im Kopf dieser Datei — kurz: der Schluessel
   * der Ablage ist `interpretSchluesselAus(name)`, und derselbe Schluessel
   * gruppiert die Werke.
   * Der falsche Name ergibt eine zweite Kachel mit „0 Werke".
   */
  readonly zuordnenZu = signal('')

  /**
   * Wer aus der Bibliothek NICHT in der Reihe steht — das, was eine
   * Entscheidung braucht, und deshalb oben.
   */
  readonly ausserhalb = computed(() => this.stand()?.versteckt ?? [])

  /**
   * Wer aus der Bibliothek IN der Reihe steht.
   *
   * `anzahl > 0` ist die Grenze und nicht `herkunft`: ein Freigeschalteter mit
   * eigenen Werken gehoert in diese Liste (er hat ja welche), einer ohne
   * gehoert allein in die Karte „Freigeschaltet". Sonst stuende er zweimal da,
   * einmal unter einer Ueberschrift, die „aus deiner Bibliothek" sagt und bei
   * ihm nicht stimmt.
   */
  readonly drin = computed(() => (this.stand()?.reihe ?? []).filter((p) => p.anzahl > 0))

  /** Freigeschaltete ohne ein einziges eigenes Werk — fuer den Diskografie-Hinweis. */
  readonly ohneWerke = computed(() => (this.stand()?.reihe ?? []).filter((p) => p.anzahl === 0))

  constructor() {
    void this.laden()
  }

  protected anfang(name: string): string {
    return (
      String(name || '?')
        .trim()
        .charAt(0)
        .toUpperCase() || '?'
    )
  }

  protected werkeText(anzahl: number): string {
    if (!anzahl) return 'nichts davon in dieser Box'
    return anzahl === 1 ? '1 eigenes Werk' : `${anzahl} eigene Werke`
  }

  protected quelleName(q: string): string {
    return QUELLE_NAME[q] ?? q
  }

  protected trefferUnter(t: Treffer): string {
    const teile = [...(t.genres ?? [])]
    if (t.follower) teile.push(`${t.follower.toLocaleString('de-DE')} Follower`)
    return teile.join(' · ')
  }

  /**
   * Das Bild eines Freigeschalteten — aus der REIHE, nicht aus der Ablage.
   *
   * In `frei[].bild` steht die ROHE CDN-Adresse; sie hier in ein `<img src>` zu
   * setzen ginge am Coverspeicher der Box vorbei (jeder Blick ein Gang ins
   * Internet, und ohne Netz bleibt es grau). Die Reihe traegt dieselbe Adresse
   * bereits durch `/api/bild/extern` umgebogen — also von dort.
   */
  protected bildVon(schluessel: string): string | null {
    return (this.stand()?.reihe ?? []).find((p) => p.schluessel === schluessel)?.bild ?? null
  }

  protected anzahlVon(schluessel: string): number {
    return (this.stand()?.reihe ?? []).find((p) => p.schluessel === schluessel)?.anzahl ?? 0
  }

  /**
   * Laden — erst die Darstellung, dann die Reihe.
   *
   * NACHEINANDER UND NICHT PARALLEL, weil `verschmelzen` aus der Darstellung
   * kommt und als Abfrageteil an /api/interpreten mitreist. Ohne ihn zaehlte
   * diese Seite zwei Werke, wo die Box eines zeigt — und die Zahl neben dem
   * Namen widerspraeche der Kachel.
   *
   * DER ERSTE ABRUF KANN DAUERN: der Server schlaegt jeden noch offenen Namen
   * bei Spotify nach (auf der Box sechzehn, danach zwoelf Stunden aus der
   * Karte). Deshalb steht unten „Einen Moment …" mit Begruendung und nicht nur
   * ein Punktemuster.
   */
  private async laden(): Promise<void> {
    let verschmelzen = false
    try {
      const d = await firstValueFrom(
        this.http.get<{ aktuell?: { diskografie?: boolean; verschmelzen?: boolean } }>('/api/darstellung'),
      )
      this.schalter.set(d?.aktuell?.diskografie === true)
      verschmelzen = d?.aktuell?.verschmelzen !== false
    } catch {
      this.schalter.set(null)
    }
    try {
      this.stand.set(
        await firstValueFrom(this.http.get<Stand>(`/api/interpreten?verschmelzen=${verschmelzen ? 1 : 0}`)),
      )
    } catch {
      this.fehler.set('Die Interpreten ließen sich nicht laden.')
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

  protected async suchen(e?: Event): Promise<void> {
    e?.preventDefault()
    const q = this.suchtext().trim()
    if (!q) return
    this.sucht.set(true)
    this.suchfehler.set('')
    try {
      const d = await firstValueFrom(
        this.http.get<{ treffer: Treffer[] }>(`/api/interpreten/suche?q=${encodeURIComponent(q)}`),
      )
      this.treffer.set(Array.isArray(d?.treffer) ? d.treffer : [])
    } catch {
      this.treffer.set([])
      // WAS SCHIEFGING, GEHOERT HIN. „Keine Treffer" und „Spotify antwortet
      // nicht" sehen sonst gleich aus, und man sucht am falschen Ende.
      this.suchfehler.set('Spotify antwortet gerade nicht — hängt die Box im Netz, und ist ein Konto verbunden?')
    } finally {
      this.gesucht.set(true)
      this.sucht.set(false)
    }
  }

  /**
   * Einen Bibliotheksnamen zuordnen: Suchfeld fuellen, Ziel merken, losfragen.
   *
   * Das Suchfeld wird mit SEINEM Namen vorbelegt, obwohl gerade der bei Spotify
   * nichts gefunden hat. Das ist Absicht: er ist der Ausgangspunkt zum Kuerzen
   * („EUROPA Hörspiele & Kinderlieder" -> „Europa"), und ein leeres Feld liesse
   * den Benutzer raten, was hier erwartet wird.
   */
  protected zuordnenStarten(name: string): void {
    this.zuordnenZu.set(name)
    this.suchtext.set(name)
    this.meldung.set('')
    void this.suchen()
  }

  protected async freischalten(id: string | null, name: string, bild: string | null): Promise<void> {
    if (!id) return
    this.arbeitet.set(true)
    this.fragt.set('')
    try {
      await firstValueFrom(
        this.http.post('/api/interpreten/frei', {
          id,
          name,
          bild: bild ?? undefined,
          // `suche` wenn die Kennung aus der Suche kommt (dann gibt es ein
          // Bild dazu), sonst `erkannt` — die Automatik hat sie geliefert und
          // ein Mensch hat sie bestaetigt.
          quelle: bild ? 'suche' : 'erkannt',
        }),
      )
      const ziel = this.zuordnenZu()
      this.zuordnenZu.set('')
      await this.laden()
      if (this.treffer().length) void this.suchen()
      this.meldung.set(
        ziel ? `„${ziel}“ ist freigeschaltet und behält seine eigenen Werke.` : `„${name}“ steht jetzt in der Reihe.`,
      )
    } catch {
      this.meldung.set('Das Freischalten ließ sich nicht speichern.')
    } finally {
      this.arbeitet.set(false)
    }
  }

  protected async ablehnen(name: string): Promise<void> {
    const s = (this.stand()?.reihe ?? []).concat(this.stand()?.versteckt ?? []).find((p) => p.name === name)
    if (!this.sicher(`nein:${s?.schluessel ?? name}`)) return
    this.arbeitet.set(true)
    try {
      await firstValueFrom(this.http.post('/api/interpreten/abgelehnt', { name }))
      await this.laden()
      if (this.treffer().length) void this.suchen()
      this.meldung.set(`„${name}“ bleibt aus der Reihe — auch nach einem Neustart.`)
    } catch {
      this.meldung.set('Das Ablehnen ließ sich nicht speichern.')
    } finally {
      this.arbeitet.set(false)
    }
  }

  protected async offen(name: string): Promise<void> {
    this.arbeitet.set(true)
    this.fragt.set('')
    try {
      await firstValueFrom(this.http.post('/api/interpreten/offen', { name }))
      await this.laden()
      if (this.treffer().length) void this.suchen()
      this.meldung.set(`Für „${name}“ entscheidet wieder die Automatik.`)
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
      await firstValueFrom(this.http.post('/api/interpreten/zuruecksetzen', {}))
      await this.laden()
      if (this.treffer().length) void this.suchen()
      this.meldung.set('Alles vergessen. Es entscheidet wieder allein die Automatik.')
    } catch {
      this.meldung.set('Das Zurücksetzen ließ sich nicht speichern.')
    } finally {
      this.arbeitet.set(false)
    }
  }
}
