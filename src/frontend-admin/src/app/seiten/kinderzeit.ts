/**
 * Die Kinderzeit-Seite — Elternbereich.
 *
 * Was hier eingestellt wird, setzt der SERVER durch (backend-api,
 * kinderzeit.ts). Das ist kein Detail: der Zähler lief vorher im Browser der
 * Box mit, und ein Kind, das die Seite neu lädt, hätte sein Guthaben
 * zurückgesetzt. Hier wird also nur eingestellt und angezeigt — entschieden
 * wird an der Stelle, die auch den Abspielbefehl in der Hand hat.
 *
 * DREI DINGE, die die Seite bewusst so macht:
 *
 * 1. AUS BEDEUTET AUS. Solange die Kinderzeit nicht eingeschaltet ist,
 *    verhält sich die Box wie immer. Kein halber Zustand, keine Regel, die
 *    „schon mal" gilt.
 * 2. EIN TAG ALS VORLAGE. Wer für Montag etwas einstellt, will es meist für
 *    Dienstag bis Freitag auch — „auf alle Wochentage übertragen" spart das
 *    fünffache Tippen und den fünffachen Tippfehler.
 * 3. GESCHENKTE MINUTEN SIND EIN EIGENER KNOPF, keine Änderung der Regel.
 *    „Heute ausnahmsweise 20 Minuten mehr" darf nicht dazu führen, dass ab
 *    jetzt jeden Tag 20 Minuten mehr erlaubt sind.
 *
 * DER SCHLUMMER-TIMER KAM AM 03.08.2026 VON DER SYSTEMSEITE HIERHER. Er ist
 * dieselbe Sorte Sache wie alles andere auf dieser Seite: eine ZEITGRENZE für
 * ein Kind. Dass er unter „System" stand, war eine Einordnung nach dem
 * Mechanismus (er ruft sleep_timer.sh und schaltet die Box ab) statt nach der
 * Frage, mit der jemand hier sitzt. Zwei Orte für Zeitgrenzen heißen: beim
 * Suchen rät man.
 *
 * ER IST TROTZDEM ETWAS ANDERES als die Regeln darüber, und die Seite sagt
 * das auch: die Kinderzeit gilt JEDEN Tag von selbst, der Schlummer-Timer gilt
 * EINMAL und nur, wenn ihn gerade jemand stellt. Sie zu vermischen — etwa den
 * Timer automatisch aus der Kinderzeit zu füttern — wäre eine dritte Regel,
 * die niemand bestellt hat.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, inject, type OnDestroy, computed, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { RouterLink } from '@angular/router'
import { firstValueFrom } from 'rxjs'

type Tag = 'so' | 'mo' | 'di' | 'mi' | 'do' | 'fr' | 'sa'

interface TagesRegel {
  frei: boolean
  ab: string
  bis: string
  minuten: number
}

interface Regeln {
  aktiv: boolean
  tage: Record<Tag, TagesRegel>
  nachsichtMin: number
}

/** Wie der Server es fuehrt: die Hausregel und die Ausnahmen je Kind (`GET /api/kinderzeit/satz`). */
interface RegelSatz {
  standard: Regeln
  je: Record<string, Regeln>
}

interface Stand {
  erlaubt: boolean
  grund: 'aus' | 'frei' | 'tagGesperrt' | 'zuFrueh' | 'zuSpaet' | 'aufgebraucht'
  restMin: number | null
  fensterAb: string
  fensterBis: string
  aktiv: boolean
  verbrauchtMin: number
  bonusMin: number
  /**
   * WESSEN Konto das hier ist.
   *
   * DER SERVER SCHICKT ES SEIT JEHER, diese Schnittstelle kannte es nur nicht
   * — und damit wusste die Seite nicht, ueber wen sie spricht. Am 08.08.2026
   * gemessen: aktiv war „gast", angezeigt und beschenkt wurde also gast,
   * waehrend die Seite aussah, als gaebe es nur ein Kind.
   */
  profil: string
}

/** Ein Kind, so wie `/api/profile` es nennt. */
interface Profil {
  kennung: string
  name: string
  /** ISO `JJJJ-MM-TT` — oder nichts. Siehe die Geburtstagszeile unten. */
  geburtstag?: string
}

/** Reihenfolge für die ANZEIGE — Montag zuerst, nicht Sonntag. */
const WOCHE: { schluessel: Tag; name: string }[] = [
  { schluessel: 'mo', name: 'Montag' },
  { schluessel: 'di', name: 'Dienstag' },
  { schluessel: 'mi', name: 'Mittwoch' },
  { schluessel: 'do', name: 'Donnerstag' },
  { schluessel: 'fr', name: 'Freitag' },
  { schluessel: 'sa', name: 'Samstag' },
  { schluessel: 'so', name: 'Sonntag' },
]

const WOCHENTAGE: Tag[] = ['mo', 'di', 'mi', 'do', 'fr']

/** Was `GET /api/verlauf` je Profil liefert. */
interface VerlaufProfil {
  kennung: string
  name: string
  sekunden: number
  dienste: { dienst: string; sekunden: number; anzahl: number }[]
  zuletzt: { beginn: number; sekunden: number; dienst: string; titel: string; artist: string }[]
}

/**
 * Aus einem Namen die Kennung eines Profils bilden.
 *
 * SIE WANDERT IN DATEINAMEN (`profile/<kennung>/…`, `gespielt.<kennung>.json`),
 * deshalb muss sie dem engen Muster des Servers genuegen:
 * `^[a-z0-9-]{1,24}$` (KENNUNG_MUSTER in backend-api/src/profile.ts). Was hier
 * herauskommt und dort abgelehnt wird, scheitert erst beim Speichern — und
 * dann steht der Erwachsene vor einer Fehlermeldung statt vor einem Kind.
 *
 * UMLAUTE WERDEN AUFGELOEST, NICHT WEGGEWORFEN: aus „Jörg" wird `joerg` und
 * nicht `jrg`. Das muss VOR dem Zerlegen in Grundzeichen passieren, sonst
 * macht `normalize('NFD')` aus dem ö erst ein o und die Regel greift ins Leere.
 *
 * Exportiert, damit der Test genau diese Fassung prueft und nicht eine
 * nachgebaute.
 */
export function kennungAus(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '')
}

@Component({
  selector: 'mupi-kinderzeit',
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `

    /* Die Profilwahl gilt fuer die ganze Seite, also sitzt sie ueber allem
       und sieht nach Reitern aus - nicht nach einer Einstellung unter vielen. */
    .profilwahl { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center;
      margin: 0 0 1rem; padding-bottom: 0.6rem; border-bottom: 1px solid var(--rand); }
    .profilwahl .fuer { color: var(--gedaempft); font-size: 0.75rem;
      text-transform: uppercase; letter-spacing: 0.04em; margin-right: 0.2rem; }
    button.profilknopf { padding: 0.35rem 0.9rem; border-radius: 999px; }
    button.profilknopf.gewaehlt { background: var(--betont, #3182ce); color: #fff; font-weight: 600; }
    button.profilknopf .jetzt { color: #48bb78; margin-left: 0.3rem; }
    .frueher { color: var(--gedaempft); font-size: 0.75rem; margin-left: 0.4rem; }
    /* Das Vorschaubildchen VOR dem Namensfeld (Betreiber 30.08.2026: „das
       ausgewählte bild vor dem profil namen"). Rund, weil auch die Galerie
       darunter runde Bildchen zeigt — wer dort ein rundes sieht und hier ein
       eckiges, sucht zweimal. Ohne eigene Figur steht der Anfangsbuchstabe
       des Namens da (wie bei den Interpreten-Bildchen), statt einer leeren
       Fläche. */
    .bildchen { width: 40px; height: 40px; border-radius: 50%; object-fit: cover;
      background: var(--eingabe, #0e1720); flex: 0 0 auto; }
    .bildchen.ersatz { display: flex; align-items: center; justify-content: center;
      font-weight: 600; color: var(--gedaempft); border: 1px solid var(--rand); }
    .figurwahl { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.6rem; }
    /* KEIN overflow-hidden AM KNOPF MEHR: es hat vorher nur das Bild
       gerundet — das macht jetzt das Bild selbst —, wuerde aber die Lupe
       genau an der Kante abschneiden, an der sie anfaengt. */
    button.figur { width: 56px; height: 56px; padding: 2px; border-radius: 10px; position: relative; }
    button.figur > img { width: 100%; height: 100%; object-fit: cover; border-radius: 8px; display: block; }

    /* Die Lupe sitzt UEBER dem Bildchen, mittig, und laesst es sichtbar —
       man soll sehen, worauf man zeigt. Die Karte schneidet nichts ab
       (nachgesehen: kein overflow), also darf sie ueberstehen. */
    .lupe {
      position: absolute;
      left: 50%;
      bottom: calc(100% + 8px);
      transform: translateX(-50%) scale(0.85);
      transform-origin: bottom center;
      width: 190px;
      padding: 6px;
      border-radius: 12px;
      background: var(--flaeche, #16202b);
      border: 1px solid var(--rand, #24313f);
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
      opacity: 0;
      visibility: hidden;
      /* SIE DARF DEN KLICK NIE FANGEN: sonst zeigt man auf das Bildchen,
         die Lupe schiebt sich unter den Zeiger, und der Klick trifft sie
         statt des Knopfs — das Bild liesse sich dann gar nicht waehlen. */
      pointer-events: none;
      z-index: 20;
      transition: opacity 0.12s ease, transform 0.12s ease, visibility 0s linear 0.12s;
    }
    button.figur:hover .lupe,
    button.figur:focus-visible .lupe {
      opacity: 1;
      visibility: visible;
      transform: translateX(-50%) scale(1);
      transition-delay: 0s;
    }
    .lupe > img { width: 100%; height: 176px; object-fit: contain; border-radius: 8px; display: block;
      background: rgba(0, 0, 0, 0.25); }
    .lupenname { display: block; text-align: center; font-size: 0.75rem; color: var(--gedaempft);
      margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* AUF DEM TOUCHSCREEN GIBT ES KEIN HOVER — dort waere die Lupe entweder
       nie zu sehen oder sie klebte nach dem Antippen fest. Also weg damit;
       800x480 hat fuer sie ohnehin keinen Platz. */
    @media (hover: none) {
      .lupe { display: none; }
    }
    button.figur.gewaehlt { outline: 2px solid var(--betont, #3182ce); outline-offset: 1px; }
    a.knopf { display: inline-block; padding: 0.4rem 0.9rem; border-radius: 6px;
      border: 1px solid var(--rand); text-decoration: none; }
    ul.profilliste { list-style: none; padding: 0; margin: 0.5rem 0 0; }
    ul.profilliste li { display: flex; align-items: center; gap: 0.6rem;
      padding: 0.35rem 0; border-top: 1px solid var(--rand); }
    ul.profilliste .wer { flex: 1 1 auto; }
    .hinweis.warn { color: #fc8181; }
    .statSumme { margin: 0.6rem 0 0.3rem; }
    /* Der Balken vergleicht die Dienste UNTEREINANDER (laengster = 100%), nicht
       gegen eine gedachte Gesamtzeit - sonst sind alle Balken kurz und sagen nichts. */
    ul.dienste { list-style: none; padding: 0; margin: 0 0 0.8rem; }
    ul.dienste li { display: flex; align-items: center; gap: 0.6rem; padding: 0.15rem 0; }
    ul.dienste .wer { flex: 0 0 8rem; }
    .balken { flex: 1 1 auto; height: 10px; background: var(--rand); border-radius: 999px; overflow: hidden; }
    .balken i { display: block; height: 100%; background: var(--betont, #3182ce); }
    table.verlauf { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    table.verlauf th { text-align: left; color: var(--gedaempft); font-weight: 500; font-size: 0.75rem;
      text-transform: uppercase; letter-spacing: 0.04em; padding-bottom: 0.3rem; }
    table.verlauf td { padding: 0.25rem 0.5rem 0.25rem 0; border-top: 1px solid var(--rand); vertical-align: top; }
    table.verlauf td.wann { white-space: nowrap; color: var(--gedaempft); }
    table.verlauf .hinweis { display: block; font-size: 0.8rem; }
    h1 { font-size: 1.3rem; margin: 0 0 0.35rem; }
    p.unter { color: var(--gedaempft); margin: 0 0 1.2rem; font-size: 0.94rem; }
    .karte {
      background: var(--flaeche, #16202b);
      border: 1px solid var(--rand, #24313f);
      border-radius: 12px;
      padding: 1rem;
      margin-bottom: 1.1rem;
    }
    .schalter { display: flex; align-items: center; gap: 0.7rem; }
    .schalter b { font-size: 1.02rem; }
    /* Die Wahl „was beim Einschalten passiert" (20.09.2026) — dieselbe Form
       wie auf der Vorlesen- und der Spiele-Seite, damit eine Entscheidung
       zwischen zwei Moeglichkeiten in dieser Verwaltung ueberall gleich
       aussieht. */
    .wahl { display: flex; flex-direction: column; gap: 0.7rem; }
    .wahl label {
      display: flex; gap: 0.7rem; align-items: flex-start;
      padding: 0.6rem 0.7rem; border-radius: 9px;
      border: 1px solid var(--rand, #24313f); cursor: pointer;
    }
    .wahl label.an { border-color: var(--betont, #2b6cb0); background: rgba(43,108,176,0.12); }
    .wahl input { margin-top: 0.2rem; }
    .wahl b { display: block; font-size: 0.98rem; }
    .wahl span { color: var(--gedaempft); font-size: 0.86rem; line-height: 1.45; }
    .stand { display: flex; gap: 1.4rem; flex-wrap: wrap; margin-top: 0.8rem; }
    .stand div { display: flex; flex-direction: column; }
    .stand span { color: var(--gedaempft); font-size: 0.8rem; }
    .stand b { font-size: 1.25rem; font-variant-numeric: tabular-nums; }
    .zu { color: var(--warnung, #e0a33a); }
    .frei { color: var(--gut, #3dc25a); }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 0.45rem 0.5rem; border-bottom: 1px solid var(--rand, #24313f); }
    th { color: var(--gedaempft); font-weight: 600; font-size: 0.82rem; }
    td.tag { white-space: nowrap; }
    input[type='time'], input[type='number'] {
      background: var(--eingabe, #0e1720);
      border: 1px solid var(--rand, #24313f);
      border-radius: 8px;
      color: inherit;
      padding: 0.35rem 0.5rem;
      font: inherit;
    }
    input[type='number'] { width: 5.5rem; }
    tr.gesperrt td:not(.tag) { opacity: 0.4; }
    button {
      background: var(--eingabe, #0e1720);
      border: 1px solid var(--rand, #24313f);
      border-radius: 8px;
      color: inherit;
      padding: 0.5rem 0.9rem;
      font: inherit;
      cursor: pointer;
    }
    button:disabled { opacity: 0.5; cursor: default; }
    .reihe { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center; margin-top: 0.9rem; }
    /* Die Wahl und der Name stehen ueber dem Konto — nicht daneben: Wer sie
       uebersieht, liest die Zahlen darunter als „die der Box". Genau das war
       der Fehler. */
    .wem { display: flex; align-items: center; gap: 0.6rem; margin: 0.2rem 0 0.9rem; }
    .wem span { color: var(--gedaempft); font-size: 0.88rem; }
    .wessen { margin: 0 0 0.5rem; color: var(--gedaempft); font-size: 0.9rem; }
    .wessen b { color: var(--schrift); }
    .hinweis { color: var(--gedaempft); font-size: 0.86rem; margin: 0.5rem 0 0; line-height: 1.45; }
    .meldung { margin-top: 0.8rem; font-size: 0.9rem; }
    /* Steht OBEN und bleibt stehen — anders als .meldung, die der naechste
       Handgriff ersetzt. Siehe den Kommentar an regelnFehler. */
    .regelnFehler {
      border: 1px solid var(--warn); border-radius: 10px;
      padding: 0.6rem 0.8rem; margin: 0 0 1rem; font-size: 0.9rem; color: var(--warn);
    }
  `,
  template: `
    <h1>Profile</h1>
    <p class="unter">Alles, was zu einem Kind gehört: Name, Bild, Geburtstag, Medien und Spielzeiten.</p>

    <!-- ══ DIE WAHL STEHT OBEN, NICHT IN EINER KARTE ═════════════════════════
         Betreiber (15.08.2026): „ich möchte die kinderzeit umbauen in Profile
         → Profil auswahl".

         DER PFEIL WAR EIN KOMMENTARENDE. Er stand hier als Bindestrich,
         Bindestrich, Grösserzeichen — genau die drei Zeichen, mit denen ein
         HTML-Kommentar AUFHÖRT. Alles danach stand von da an als Text auf der
         Seite, mitten zwischen Überschrift und erster Karte, und endete
         sichtbar mit den drei Zeichen der richtigen Klammer. Gefunden am
         23.09.2026 auf einem Schirmbild für die README, nicht von einer Wache:
         ein Kommentar, der aus Versehen aufhört, meldet sich nicht — er
         erscheint. Wer hier zitiert, schreibt Pfeile als → und niemals als die
         drei Zeichen.

         Die Wahl gilt für ALLES darunter — steckt sie in
         der ersten Karte, sieht sie aus, als gehörte sie zu den Spielzeiten,
         und wer weiter unten etwas verstellt, verstellt es womöglich beim
         falschen Kind. Deshalb eine eigene Leiste über allen Karten. -->
    @if (profile().length) {
      <div class="profilwahl">
        <span class="fuer">Profil</span>
        @for (p of profile(); track p.kennung) {
          <button
            class="profilknopf"
            [class.gewaehlt]="p.kennung === wer()"
            (click)="werWaehlen(p.kennung)"
          >
            {{ p.name }}
            @if (p.kennung === aktivesProfil()) {
              <span class="jetzt" title="hört gerade an der Box">●</span>
            }
          </button>
        }
      </div>
    }

    <!-- WARUM DAS NICHT MEHR IN meldung() STEHT (Gegenlesen 03.08.2026):
         Seit der Schlummer-Timer auf dieser Seite steht, teilen sich zwei
         voellig verschiedene Dinge EINE Meldungszeile — und die untere
         gewinnt. Gemessen gegen die Attrappe: die Seite meldete „Die Regeln
         konnten nicht geladen werden.", ein Tipp auf „Timer starten" ersetzte
         das durch „Die Box schaltet sich in 30 Minuten ab.", und die Warnung
         war weg. Wer dann in der Tabelle etwas verstellt, verstellt LEERE
         Vorgabewerte und nicht die Regeln der Box.
         Deshalb: eigenes Feld, eigener Ort, oben, und es bleibt stehen. -->
    <!-- ══ NAME UND BILD ═════════════════════════════════════════════════
         Betreiber: „mit namen/ bild/ geburtstag/ medien/ spielzeiten".
         UEBER PUT /api/profile, nicht ueber POST /api/profil/figur: letzterer
         aendert per Vertrag nur das AKTIVE Profil (der Besitzer kommt dort vom
         Server, nie aus dem Rumpf). Aus der Verwaltung soll man aber jedes
         Kind bearbeiten koennen, ohne an der Box umzuschalten. -->
    <!-- ══ WAS BEIM EINSCHALTEN PASSIERT (20.09.2026) ═══════════════════════
         Betreiber: „ich möchte eine möglichkeit vom jetzigen modus auf den
         letztes profil startet automatisch, falls kein passwort eingestellt
         ist komplett, ansonsten in die passwort abfrage."

         GANZ OBEN UND OHNE PROFILWAHL: Die Einstellung gilt für die BOX,
         nicht für ein Kind. Stünde sie weiter unten zwischen den Karten,
         die dem gewählten Kind gehören, läse sie sich wie eine Eigenschaft
         dieses Kindes — und wer sie dort verstellt, glaubt, er habe es nur
         für eines getan. -->
    <div class="karte">
      <b>Wenn die Box eingeschaltet wird</b>
      <div class="wahl" style="margin-top:0.7rem">
        <label [class.an]="startModus() === 'fragen'">
          <input type="radio" name="startmodus" [checked]="startModus() === 'fragen'"
                 (change)="setzeStart('fragen')" />
          <span>
            <b>Fragen, wer hört</b>
            <span>Nach dem Einschalten zeigt die Box die Profilauswahl. So ist es bisher.</span>
          </span>
        </label>
        <label [class.an]="startModus() === 'letztes'">
          <input type="radio" name="startmodus" [checked]="startModus() === 'letztes'"
                 (change)="setzeStart('letztes')" />
          <span>
            <b>Mit dem letzten Profil weitermachen</b>
            <span>
              Ohne Passwort geht es sofort weiter. Ist für dieses Profil ein Passwort
              gesetzt, fragt die Box danach — übersprungen wird nur die Frage <em>wer</em>,
              nie das Schloss. „Ich bin jemand anderes" führt zurück zur Auswahl.
            </span>
          </span>
        </label>
      </div>
      @if (startMeldung()) { <p class="hinweis">{{ startMeldung() }}</p> }
    </div>

    <div class="karte">
      <b>Name und Bild</b>
      <!-- Betreiber (30.08.2026): „das ausgewählte bild vor dem profil
           namen" und „die auswahl der icons erst erscheinen beim klick bild
           ändern". Das Vorschaubildchen steht deshalb VOR dem Namensfeld,
           und die Galerie bleibt zu, bis wer auf „Bild ändern" tippt —
           figurSpeichern() klappt sie nach der Wahl selbst wieder zu, das
           Vorschaubildchen zeigt dann von selbst das neue Bild (es liest
           figurVon(wer()), keinen eigenen Zwischenstand). -->
      <div class="reihe">
        @if (figurVon(wer())) {
          <img class="bildchen" [src]="figurOrdner() + '/' + figurVon(wer())" alt="" />
        } @else {
          <span class="bildchen ersatz">{{ anfang(nameVon(wer())) }}</span>
        }
        <label class="wem">
          <span>Name</span>
          <input
            type="text"
            [value]="nameVon(wer())"
            (blur)="namenSpeichern($any($event.target).value)"
            (keydown.enter)="namenSpeichern($any($event.target).value)"
            placeholder="Name des Kindes"
            title="Eingabe speichert"
          />
        </label>
        @if (figuren().length) {
          <button type="button" (click)="bildwahlOffen.set(!bildwahlOffen())">Bild ändern</button>
        }
        @if (profilFehler()) {
          <span class="marke warn">{{ profilFehler() }}</span>
        }
      </div>
      @if (figuren().length) {
        @if (bildwahlOffen()) {
          <div class="figurwahl">
            <button class="figur" [class.gewaehlt]="figurVon(wer()) === ''" (click)="figurSpeichern('')" title="kein Bild">
              ohne
            </button>
            @for (f of figuren(); track f) {
              <button class="figur" [class.gewaehlt]="figurVon(wer()) === f" (click)="figurSpeichern(f)" [title]="f">
                <img [src]="figurOrdner() + '/' + f" [alt]="f" />
                <!-- DIE LUPE (Betreiber: „die bilder sind so doch bisschen
                     klein"). Rein mit CSS: kein Zustand, kein Zuhoerer, nichts
                     was beim Wegscrollen haengenbleibt. aria-hidden steht dran, weil sie
                     dasselbe Bild ZWEIMAL zeigt — eine Vorlesehilfe soll den
                     Namen einmal nennen, nicht doppelt. -->
                <span class="lupe" aria-hidden="true">
                  <img [src]="figurOrdner() + '/' + f" alt="" />
                  <span class="lupenname">{{ f.replace('.png', '').replace('mixpi-', '') }}</span>
                </span>
              </button>
            }
          </div>
        }
      } @else {
        <p class="hinweis">Es liegen keine Bilder auf der Box.</p>
      }
    </div>

    <!-- ══ SCHLOSS ═══════════════════════════════════════════════════════
         Betreiber: „das profil passwort soll noch angezeigt werden und
         verändert werden können". ANZEIGEN GEHT NICHT — gespeichert ist ein
         bcrypt-Abdruck, kein Passwort. Das steht hier auch so, statt das
         Feld leer zu lassen und den Erwachsenen raten zu lassen, ob er
         gerade etwas Vorhandenes sieht oder nicht. -->
    <div class="karte">
      <b>Schloss</b>
      @if (istGast()) {
        <!-- NICHT ERST AM SERVER SCHEITERN LASSEN (Betreiber 15.08.2026:
             „wieso kann man dem ersten account kein passwort zuweisen?").
             Die Karte bot das Setzen an und quittierte es mit
             „gastOhnePasswort" — der Grund stand nirgends, und wer den
             Gast umbenannt hat, haelt ihn fuer ein normales Profil. -->
        <p class="hinweis">
          Dieses Profil ist der <b>Gast</b> — der Zustand „niemand hat gewählt".
          Er kann kein Schloss bekommen, denn das Abmelden muss immer gehen:
          sonst hielte ein Kind mit Passwort das nächste als Geisel.
          @if (nameVon(wer()) !== 'Gast') {
            <br />
            Er heißt bei dir „{{ nameVon(wer()) }}". Wenn du ein eigenes,
            abschließbares Konto willst, leg es unten unter
            <b>Profile verwalten</b> als neues Profil an.
          }
        </p>
      } @else {
      <p class="hinweis">
        @if (schlossArt()) {
          <b>{{ nameVon(wer()) }} ist geschützt</b> — Art: {{ artName(schlossArt()) }}.
          Das Passwort selbst lässt sich nicht anzeigen: gespeichert ist nur ein
          Abdruck davon, aus dem sich das Original nicht zurückrechnen lässt.
          Du kannst es hier neu setzen oder abnehmen.
        } @else {
          <b>{{ nameVon(wer()) }} hat kein Schloss.</b>
          Wer das Profil an der Box wählt, kommt ohne Weiteres hinein.
        }
      </p>
      <div class="reihe">
        <label class="wem">
          <span>Art</span>
          <select [value]="neueArt()" (change)="neueArt.set($any($event.target).value)">
            <option value="zahlen">Zahlen</option>
            <option value="zeichen">Zeichen</option>
            <option value="farben">Farben</option>
            <option value="muster">Muster</option>
            <!-- BILDER fuer Kinder, die noch nicht lesen (16.08.2026). Sie
                 lassen sich hier nicht TIPPEN — an der Box tippt man Tiere
                 an, hier gibt man die Nummern ein, wie sie auf der Box
                 stehen. Deshalb der Hinweis darunter. -->
            <option value="bilder">Bilder</option>
          </select>
        </label>
        <label class="wem">
          <span>Neues Passwort</span>
          <input
            type="text"
            [value]="neuesPasswort()"
            (input)="neuesPasswort.set($any($event.target).value)"
            placeholder="mindestens 3 Zeichen"
            maxlength="64"
          />
        </label>
        <button class="wichtig" (click)="schlossSetzen()" [disabled]="neuesPasswort().trim().length < 3 || schlossLaeuft()">
          {{ schlossLaeuft() ? 'speichert …' : (schlossArt() ? 'Neu setzen' : 'Schloss setzen') }}
        </button>
        @if (schlossArt()) {
          <button class="weg" (click)="schlossAbnehmen()" [disabled]="schlossLaeuft()">Abnehmen</button>
        }
      </div>
      @if (neueArt() === 'bilder') {
        <p class="hinweis">
          Die Bilder heißen der Reihe nach: <b>1</b> Panda, <b>2</b> Katze,
          <b>3</b> Hund, <b>4</b> Einhorn, <b>5</b> Geist, <b>6</b> Papagei,
          <b>7</b> Meerjungfrau, <b>8</b> Bagger, <b>9</b> Kran, <b>10</b> Würfel.
          Trage die Nummern mit Strich ein, etwa <code>1-4-7</code> für
          Panda, Einhorn, Meerjungfrau. An der Box tippt das Kind die Bilder an.
        </p>
      }
      <p class="hinweis">
        Das Feld zeigt die Eingabe im Klartext — hier sitzt kein Fremder,
        sondern der Erwachsene, und ein verdecktes Feld führt bei drei Zeichen
        nur zu Tippfehlern, die niemand bemerkt.
      </p>
      }
    </div>

    <!-- ══ MEDIEN ════════════════════════════════════════════════════════
         Die Zuordnung selbst steht auf der Medien-Seite, wo die Bibliothek
         liegt — sie hierher zu kopieren hiesse, zwei Orte pflegen zu muessen,
         die auseinanderlaufen. Hier steht, WAS gilt, und der Weg dorthin. -->
    <div class="karte">
      <b>Medien</b>
      @if (medienStand(); as m) {
        <p class="hinweis">
          @if (m.alle) {
            <b>{{ nameVon(wer()) }} sieht alles</b> — auch alles, was neu dazukommt.
          } @else {
            <b>{{ nameVon(wer()) }} sieht {{ m.werke.length }} Werke</b> von {{ gesamtWerke() }}.
            Neues kommt nicht mehr von selbst dazu.
          }
        </p>
      } @else {
        <p class="hinweis">Die Zuordnung ist gerade nicht erreichbar.</p>
      }
      <div class="reihe">
        <a class="knopf" routerLink="/medien">In den Medien zuordnen</a>
      </div>
    </div>

    <!-- ══ PROFILE VERWALTEN ═════════════════════════════════════════════
         Betreiber: „was noch fehlt ein neues profil anzulegen" und „und auch
         zu löschen". Bewusst als EIGENE Karte und nicht neben dem Namensfeld:
         dort geht es um DIESES Kind, hier um die Liste. Wer ein Kind
         umbenennen will, soll nicht aus Versehen ein zweites anlegen. -->
    <div class="karte">
      <b>Profile verwalten</b>
      <div class="reihe">
        <label class="wem">
          <span>Neues Profil</span>
          <input
            type="text"
            [value]="neuerName()"
            (input)="neuerName.set($any($event.target).value)"
            (keydown.enter)="profilAnlegen()"
            placeholder="Name des Kindes"
            maxlength="40"
          />
        </label>
        <button class="wichtig" (click)="profilAnlegen()" [disabled]="!neuerName().trim() || legtAn()">
          {{ legtAn() ? 'legt an …' : 'Anlegen' }}
        </button>
      </div>
      @if (kennungVorschau(); as k) {
        <p class="hinweis">Kennung auf der Box: <code>{{ k }}</code></p>
      }
      @if (loeschbar().length) {
        <p class="hinweis">
          Löschen entfernt das Profil samt seiner Einstellungen, Statistik und
          Hörständen. Die Medien selbst bleiben.
        </p>
        <ul class="profilliste">
          @for (p of loeschbar(); track p.kennung) {
            <li>
              <span class="wer"><b>{{ p.name }}</b> <span class="hinweis">{{ p.kennung }}</span></span>
              <button class="weg" (click)="profilLoeschen(p)" [disabled]="loescht() === p.kennung">
                {{ loescht() === p.kennung ? 'löscht …' : 'Löschen' }}
              </button>
            </li>
          }
        </ul>
      } @else {
        <!-- EIN LETZTES KIND LAESST SICH NICHT LOESCHEN, und der Gast schon
             gar nicht — sonst stuende die Box ohne Besitzer da. -->
        <p class="hinweis">Das letzte Profil lässt sich nicht löschen.</p>
      }
      @if (profilFehler()) {
        <p class="hinweis warn">{{ profilFehler() }}</p>
      }
    </div>

    <!-- ══ DER GAST (E39, 16.08.2026) ═════════════════════════════════════
         Betreiber: „vielleicht kann man ja einfach ein gast account
         aktivierbar machen und deativierbar" — mit allem, was er dazu
         bestellt hat: beim Einschalten leer, Listen uebernehmbar (nicht der
         Abspielstand), auf Zeit oder dauerhaft, nicht umbenennbar. -->
    <div class="karte">
      <b>Gast</b>
      <p class="hinweis">
        @if (gastAn()) {
          <b>Der Gast ist an</b>{{ gastBisText() }}. Jeder kann ihn an der Box wählen;
          Abmelden führt zu ihm.
        } @else {
          <b>Der Gast ist aus.</b> Seine Kachel erscheint nicht, und die Box
          verlangt nach dem Einschalten eine Anmeldung. Er bleibt intern der
          Rückfall — löschen lässt er sich nicht, umbenennen auch nicht.
        }
      </p>
      @if (gastAn()) {
        <div class="reihe">
          <button class="weg" (click)="gastSchalten(false)" [disabled]="gastLaeuft()">
            {{ gastLaeuft() ? 'schaltet …' : 'Gast abschalten' }}
          </button>
        </div>
      } @else {
        <div class="reihe">
          <label class="wem">
            <span>Dauer</span>
            <select [value]="gastStunden()" (change)="gastStunden.set($any($event.target).value)">
              <option value="">dauerhaft</option>
              <option value="2">2 Stunden</option>
              <option value="4">4 Stunden</option>
              <option value="8">8 Stunden</option>
              <option value="24">24 Stunden</option>
            </select>
          </label>
          <label class="wem">
            <span>Medienliste übernehmen von</span>
            <select [value]="gastVorbild()" (change)="gastVorbild.set($any($event.target).value)">
              <option value="">— alles sichtbar —</option>
              @for (p of loeschbarOderAlle(); track p.kennung) {
                <option [value]="p.kennung">{{ p.name }}</option>
              }
            </select>
          </label>
          <button class="wichtig" (click)="gastSchalten(true)" [disabled]="gastLaeuft()">
            {{ gastLaeuft() ? 'schaltet …' : 'Gast einschalten' }}
          </button>
        </div>
        <p class="hinweis">
          Beim Einschalten startet der Gast <b>leer</b>: Hörstände, Verlauf und
          Statistik des letzten Besuchs werden entfernt. Übernommen wird nur die
          Medienliste — nie der Abspielstand.
        </p>
      }
    </div>

    <!-- ══ STATISTIKEN ═══════════════════════════════════════════════════
         Betreiber: „statistiken was gespielwurde wann" und „welchen dienst
         wie lange". Die Zahlen kommen aus dem Mitschnitt (verlauf.ts) und
         sind GEMESSENE Hoerzeit, nicht Start-bis-Stopp. -->
    <div class="karte">
      <b>Statistik — was gehört wurde</b>
      <div class="reihe">
        <label class="wem">
          <span>Zeitraum</span>
          <select [value]="statTage()" (change)="statTageSetzen($any($event.target).value)">
            <option value="1">heute</option>
            <option value="7">7 Tage</option>
            <option value="30">30 Tage</option>
            <option value="365">ein Jahr</option>
          </select>
        </label>
        <label class="schalter" title="Alle Profile zusammen statt nur das gewählte">
          <input type="checkbox" [checked]="statAlle()" (change)="statAlleSetzen($any($event.target).checked)" />
          alle Profile
        </label>
      </div>
      @if (statZeilen().length) {
        <p class="statSumme">
          <b>{{ dauerText(statSumme()) }}</b> gehört
          @if (!statAlle()) { von {{ nameVon(wer()) }} }
        </p>
        <ul class="dienste">
          @for (d of statDienste(); track d.dienst) {
            <li>
              <span class="wer"><b>{{ dienstName(d.dienst) }}</b></span>
              <span class="balken"><i [style.width.%]="anteil(d.sekunden)"></i></span>
              <span class="marke">{{ dauerText(d.sekunden) }}</span>
            </li>
          }
        </ul>
        <table class="verlauf">
          <thead><tr><th>wann</th><th>was</th><th>wie lange</th></tr></thead>
          <tbody>
            @for (z of statZeilen(); track z.beginn + z.titel) {
              <tr>
                <td class="wann">{{ wannText(z.beginn) }}</td>
                <td>
                  {{ z.titel }}
                  @if (z.artist) { <span class="hinweis">{{ z.artist }}</span> }
                  @if (statAlle() && z.wer) { <span class="marke">{{ z.wer }}</span> }
                </td>
                <td class="marke">{{ dauerText(z.sekunden) }}</td>
              </tr>
            }
          </tbody>
        </table>
      } @else {
        <!-- EHRLICH STATT LEER: der Mitschnitt kann noch nichts wissen, wenn
             er heute erst eingerichtet wurde. Das ist kein Fehler, und die
             Seite soll es nicht wie einen aussehen lassen. -->
        <p class="hinweis">
          Für diesen Zeitraum ist noch nichts aufgezeichnet. Der Mitschnitt läuft
          seit dem 15.08.2026 mit — rückwirkend gibt es die Daten nicht.
        </p>
      }
    </div>

    @if (regelnFehler()) {
      <p class="regelnFehler">{{ regelnFehler() }}</p>
    }

    <div class="karte">
      <!-- ══ WESSEN REGELN? (25.09.2026) ══════════════════════════════════
           Der Server kennt seit dem 02.08.2026 eine Hausregel und eigene
           Regeln je Kind; die Seite bearbeitete bis heute nur die Hausregel.
           Hier steht jetzt, WAS die Tabelle darunter bearbeitet — und der Weg
           hin und zurueck. Ein Knopf statt eines Umschalters: das Zurueck
           verwirft Regeln und fragt deshalb nach; ein Umschalter, der nach
           „Abbrechen" falsch stehen bliebe, behauptete einen Zustand, den
           die Box nicht hat. Ohne geladenen Satz keine Wahl: dann steht oben
           die Warnung, und ein Knopf, der still nichts tut, hilft niemandem. -->
      @if (wer() && !regelnFehler()) {
        <p class="wessen regelwahl">
          @if (eigeneRegeln()) {
            Regeln für <b>{{ nameVon(wer()) }}</b>: <b>eigene</b>
            <button type="button" (click)="eigeneVerwerfen()">Zurück zur Hausregel</button>
          } @else {
            Regeln für <b>{{ nameVon(wer()) }}</b>: wie die <b>Hausregel</b>
            <button type="button" (click)="eigeneAnlegen()">Eigene Regeln für {{ nameVon(wer()) }}</button>
          }
        </p>
      }
      <label class="schalter">
        <input type="checkbox" [(ngModel)]="regeln().aktiv" (change)="speichern()" />
        <b>Spielzeiten einschalten</b>
        <!-- DAS ALTE WORT BLEIBT AUFFINDBAR: die Seite hiess bis heute
             „Kinderzeit", und wer danach sucht, soll sie finden statt zu
             glauben, die Funktion sei weg. Der Suchbestand wird aus diesem
             Text erzeugt. -->
        <span class="frueher" title="Diese Funktion hieß früher Kinderzeit">Kinderzeit</span>
      </label>
      <p class="hinweis">
        Ist sie aus, verhält sich die Box wie immer — ohne Zeitfenster und ohne Begrenzung.
      </p>

      <!-- ══ WESSEN ZEIT? — DIE FRAGE STAND NIRGENDS ═══════════════════
           Aufgefallen bei der Aufnahme „was gehoert schon dem Kind"
           (08.08.2026): Konto, Rest und die drei Schenk-Knoepfe wirkten auf
           das Kind, das GERADE AN DER BOX dran ist — und das stand nirgends.
           Auf dieser Box war das „gast", nicht „Kalea". Wer 30 Minuten
           schenkt, schenkt sie damit womoeglich dem falschen Kind, und nichts
           am Schirm haette widersprochen.
           DER SERVER KONNTE ES IMMER: /api/kinderzeit/stand, /bonus und
           /zuruecksetzen nehmen alle eine Kennung entgegen (kzKennungAus in
           server.ts) und geben das Feld profil zurueck. Es fehlte allein die
           Frage. -->

      @if (stand(); as s) {
        <!-- DER NAME STEHT AUCH DANN DA, WENN ES NUR EIN KIND GIBT. Die Wahl
             oben faellt dann weg (sie waere eine Liste mit einem Eintrag),
             die Zuordnung darf trotzdem nicht verschwinden. -->
        <p class="wessen">Konto von <b>{{ nameVon(s.profil) }}</b></p>
        <!-- ══ DER GEBURTSTAG (E38, 15.08.2026) ═══════════════════════════
             Betreiber: „ich würde gerne im profil das geburtsdatum angeben
             und basierend darauf die ard sammlungen anzeigen." Er steht
             HIER, weil hier der Erwachsene ohnehin die Einstellungen eines
             Kindes macht — auf dem 800x480-Touchscreen der Box wäre ein
             Datum die mühsamste Eingabe, die es gibt.
             DAS DATUM UND NICHT DAS ALTER: ein Alter veraltet, ein Datum
             rechnet sich selbst um. -->
        <p class="geburtstag">
          <label>
            Geburtstag
            <input
              type="date"
              [value]="geburtstagVon(s.profil)"
              [max]="heute"
              (change)="geburtstagSetzen(s.profil, $any($event.target).value)"
            />
          </label>
          @if (alterVon(s.profil) !== null) {
            <span class="marke">{{ alterVon(s.profil) }} Jahre — danach richten sich die ARD-Sammlungen unter „Medien"</span>
          } @else {
            <span class="hinweis">Leer lassen heißt: nichts wird nach Alter ausgeblendet.</span>
          }
        </p>
        <div class="stand">
          <div>
            <span>Jetzt</span>
            <b [class.frei]="s.erlaubt" [class.zu]="!s.erlaubt">{{ standText(s) }}</b>
          </div>
          <div>
            <span>Heute gehört</span>
            <b>{{ s.verbrauchtMin }} min</b>
          </div>
          <div>
            <span>Rest heute</span>
            <b>{{ s.restMin === null ? 'unbegrenzt' : s.restMin + ' min' }}</b>
          </div>
          @if (s.bonusMin > 0) {
            <div>
              <span>Geschenkt</span>
              <b class="frei">+{{ s.bonusMin }} min</b>
            </div>
          }
        </div>
      }
    </div>

    <div class="karte">
      <table>
        <thead>
          <tr>
            <th>Tag</th>
            <th>erlaubt</th>
            <th>ab</th>
            <th>bis</th>
            <th>Dauer</th>
          </tr>
        </thead>
        <tbody>
          @for (t of woche; track t.schluessel) {
            <tr [class.gesperrt]="!regeln().tage[t.schluessel].frei">
              <td class="tag">{{ t.name }}</td>
              <td>
                <input
                  type="checkbox"
                  [(ngModel)]="regeln().tage[t.schluessel].frei"
                  (change)="speichern()"
                />
              </td>
              <td>
                <input type="time" [(ngModel)]="regeln().tage[t.schluessel].ab" (change)="speichern()" />
              </td>
              <td>
                <input type="time" [(ngModel)]="regeln().tage[t.schluessel].bis" (change)="speichern()" />
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  max="1440"
                  step="5"
                  [(ngModel)]="regeln().tage[t.schluessel].minuten"
                  (change)="speichern()"
                />
                min
              </td>
            </tr>
          }
        </tbody>
      </table>
      <p class="hinweis">
        @if (eigeneRegeln()) {
          <b>Diese Tabelle gilt nur für {{ nameVon(wer()) }}.</b> Die Hausregel für alle anderen
          bleibt, wie sie ist.
        } @else {
          <b>Diese Tabelle ist die Hausregel</b> — sie gilt für jedes Kind ohne eigene Regeln.
          @if (mitEigenenRegeln().length) {
            Eigene Regeln haben: {{ namenVon(mitEigenenRegeln()) }}.
          }
        }
      </p>
      <p class="hinweis">
        Leere Zeiten heißen „keine Grenze", Dauer 0 heißt „unbegrenzt" — das Zeitfenster gilt
        trotzdem weiter. Ist die Dauer aufgebraucht, darf der laufende Titel noch bis zu
        {{ regeln().nachsichtMin }} Minuten zu Ende gehen; erst dann macht die Box Schluss.
      </p>
      <div class="reihe">
        <button (click)="aufWochentage()">Montag auf alle Wochentage übertragen</button>
        <button (click)="aufAlleTage()">Montag auf alle sieben Tage übertragen</button>
      </div>
    </div>

    <div class="karte">
      <b>Für heute etwas dazugeben — an {{ nameVon(wer()) }}</b>
      <p class="hinweis">
        Gilt nur für heute und ändert die Regel nicht. Um Mitternacht ist es wieder weg.
      </p>
      <div class="reihe">
        <button (click)="schenken(15)">+15 min</button>
        <button (click)="schenken(30)">+30 min</button>
        <button (click)="schenken(-15)">−15 min</button>
        <button (click)="zuruecksetzen()">Heutigen Zähler zurücksetzen</button>
      </div>
    </div>

    <!-- SCHLUMMER-TIMER — am 03.08.2026 von der Systemseite hierher geholt.
         Er steht bewusst UNTEN und in einer eigenen Karte: er gilt einmal und
         jetzt, waehrend alles darueber jeden Tag von selbst gilt. -->
    <div class="karte">
      <b>Schlummer-Timer</b>
      <p class="hinweis">
        Einschlafen mit Musik: die Box schaltet sich nach der eingestellten Zeit von
        selbst ab. Gilt nur dieses eine Mal — die Regeln oben bleiben davon unberührt.
      </p>
      <div class="reihe">
        @if (schlummerLaeuft()) {
          <span>Ein Timer läuft.</span>
          <button type="button" (click)="schlummerStoppen()">Timer abbrechen</button>
        } @else {
          <input
            type="number"
            min="1"
            [max]="schlummerMax()"
            [(ngModel)]="schlummerMinuten"
            name="schlummer"
            aria-label="Minuten bis zum Abschalten"
          />
          <span class="hinweis">Minuten</span>
          <button type="button" (click)="schlummerStarten()">Timer starten</button>
        }
      </div>
    </div>

    @if (meldung()) {
      <p class="meldung">{{ meldung() }}</p>
    }
  `,
})
export class KinderzeitSeite implements OnDestroy {
  private readonly http = inject(HttpClient)
  protected readonly woche = WOCHE
  protected readonly regeln = signal<Regeln>(leereRegeln())
  protected readonly stand = signal<Stand | null>(null)
  protected readonly meldung = signal('')
  /**
   * Konnten die Regeln GAR NICHT geladen werden?
   *
   * EIGENES FELD SEIT DEM GEGENLESEN AM 03.08.2026, und der Grund ist der
   * Umzug des Schlummer-Timers auf diese Seite: `meldung` ist die Zeile für
   * „was gerade passiert ist" und wird vom nächsten Handgriff überschrieben.
   * Das ist für „Der Timer wurde abgebrochen." richtig — für „die Regeln, die
   * du hier siehst, sind nicht die der Box" ist es falsch. Diese Auskunft
   * gilt weiter, bis sie behoben ist, und darf nicht verschwinden, weil
   * jemand daneben einen Timer gestellt hat.
   */
  protected readonly regelnFehler = signal('')
  private takt: ReturnType<typeof setInterval> | undefined

  /* ══ WESSEN KONTO — DIE FRAGE, DIE HIER GEFEHLT HAT ═══════════════════
   *
   * Konto, Rest und die drei Schenk-Knoepfe wirkten auf das Kind, das gerade
   * AN DER BOX dran ist. Das stand nirgends; auf dieser Box war es „gast"
   * und nicht „Kalea". Wer 30 Minuten schenkt, schenkte sie damit womoeglich
   * dem falschen Kind — und nichts am Schirm haette widersprochen.
   *
   * `wer()` IST DIE WAHL, `aktivesProfil()` DER STAND DER BOX. Zwei
   * verschiedene Dinge: Man kann dem Kind Zeit schenken, das gerade NICHT
   * spielt, und genau dafuer gibt es die Wahl. Die Vorgabe ist trotzdem das
   * aktive — das ist der Fall, in dem jemand danebensteht und fragt.
   *
   * DIE REGELN GIBT ES JE KIND — SEIT DEM 25.09.2026 AUCH AUF DIESER SEITE.
   * Der Server fuehrt seit dem 02.08.2026 (d66ee6fc) eine Hausregel
   * (`standard`) und Ausnahmen je Kind (`je`); bis heute bearbeitete die
   * Wochentabelle hier trotzdem nur die Hausregel (README 3.9).
   *
   * GELADEN WIRD DER GANZE SATZ (`GET /api/kinderzeit/satz`), nicht die
   * Einzelregel mit `?profil=`: jene Antwort sagt nicht, ob das Kind EIGENE
   * Regeln hat oder die Hausregel erbt. Haengte man den Anhang einfach an
   * `speichern()`, fror der erste Klick bei einem Kind still eine Kopie der
   * Hausregel ein — und spaetere Aenderungen an ihr erreichten dieses Kind
   * nie mehr. Deshalb bearbeitet die Tabelle, was fuer das gewaehlte Kind
   * GILT: seine eigenen Regeln, wenn es welche hat, sonst die Hausregel —
   * und das Anlegen und Verwerfen eigener Regeln ist ein eigener Handgriff.
   */
  protected readonly profile = signal<Profil[]>([])
  protected readonly aktivesProfil = signal('')
  protected readonly wer = signal('')

  /** Der ganze Regelsatz der Box — `null`, solange er nicht geladen ist. */
  private readonly satz = signal<RegelSatz | null>(null)
  /** Hat das gewaehlte Kind eigene Regeln? */
  protected readonly eigeneRegeln = computed(() => {
    const w = this.wer()
    return !!w && Object.hasOwn(this.satz()?.je ?? {}, w)
  })
  /** Wer ueberhaupt eigene Regeln hat — fuer den Hinweis unter der Hausregel. */
  protected readonly mitEigenenRegeln = computed(() => Object.keys(this.satz()?.je ?? {}))

  /**
   * Der Schlummer-Timer — eigener Endpunkt, eigener Zustand.
   *
   * Er hängt NICHT an /api/kinderzeit: dort stehen Regeln, die dauerhaft
   * gelten, hier steht ein Wecker, der jetzt läuft oder nicht. Sie in eine
   * Ablage zu legen, nur weil sie auf derselben Seite stehen, wäre der
   * teuerste Umzug — der, bei dem eine Box ihre Einstellung verliert.
   */
  protected schlummerMinuten = 30
  protected readonly schlummerLaeuft = signal(false)
  protected readonly schlummerMax = signal(600)

  /**
   * DER START-MODUS DER BOX — eigene Ablage, eigene Route.
   *
   * NICHT in `profile.json`: die schreibt `PUT /api/profile` als GANZES.
   * Eine Zahl daneben abzulegen hiesse, dass die Kinderliste und dieser
   * Schalter sich gegenseitig ueberschreiben, sobald zwei Seiten offen sind
   * — genau der stille Datenverlust, der beim Spiele-Schalter einen Tag
   * zuvor schon einmal drohte.
   */
  protected readonly startModus = signal<'fragen' | 'letztes'>('fragen')
  protected readonly startMeldung = signal('')

  private async startLesen(): Promise<void> {
    try {
      const a = await firstValueFrom(this.http.get<{ modus: string }>('/api/start'))
      this.startModus.set(a?.modus === 'letztes' ? 'letztes' : 'fragen')
    } catch {
      this.startMeldung.set('Der Start-Modus konnte nicht geladen werden.')
    }
  }

  protected async setzeStart(modus: 'fragen' | 'letztes'): Promise<void> {
    const vorher = this.startModus()
    this.startModus.set(modus)
    try {
      // Der Server biegt zurecht, was nicht geht — hier soll stehen, was gilt.
      const a = await firstValueFrom(this.http.put<{ modus: string }>('/api/start', { modus }))
      this.startModus.set(a?.modus === 'letztes' ? 'letztes' : 'fragen')
      this.startMeldung.set('Gespeichert.')
    } catch {
      // ZURUECK AUF DEN ALTEN WERT: Ein Schalter, der umspringt, obwohl das
      // Speichern misslang, behauptet eine Einstellung, die die Box nicht hat.
      this.startModus.set(vorher)
      this.startMeldung.set('Speichern fehlgeschlagen.')
    }
    setTimeout(() => this.startMeldung.set(''), 2500)
  }

  constructor() {
    void this.startLesen()
    void this.profileLaden()
    void this.figurenHolen()
    void this.medienStandHolen()
    void this.statHolen()
    void this.laden()
    void this.schlummerLesen()
    // Der Stand ändert sich von selbst (die Zeit läuft) — ohne Nachfragen
    // stünde hier eine Zahl von vorhin.
    this.takt = setInterval(() => void this.standHolen(), 15_000)
  }

  ngOnDestroy(): void {
    if (this.takt) clearInterval(this.takt)
  }

  private async laden(): Promise<void> {
    try {
      const s = await firstValueFrom(this.http.get<RegelSatz>('/api/kinderzeit/satz'))
      this.satz.set({ standard: vollstaendig(s?.standard ?? null), je: { ...(s?.je ?? {}) } })
      this.regelnZeigen()
      this.regelnFehler.set('')
    } catch {
      this.regelnFehler.set(
        'Die Regeln konnten nicht geladen werden — was unten steht, sind Vorgabewerte und nicht die Einstellung dieser Box. Erst neu laden, dann ändern.',
      )
    }
    await this.standHolen()
  }

  /**
   * Die Kinder holen — und wer gerade dran ist.
   *
   * SCHLAEGT ES FEHL, BLEIBT DIE SEITE BEDIENBAR: `profile` bleibt leer, die
   * Wahl oben faellt weg, und `nameVon` gibt die Kennung heraus. Eine
   * Kennung ist haesslich, aber wahr — und immer noch besser als die
   * namenlose Seite, die es vorher war.
   */
  private async profileLaden(): Promise<void> {
    try {
      const d = await firstValueFrom(
        this.http.get<{ profile: Profil[]; aktiv: string }>('/api/profile'),
      )
      this.profile.set(Array.isArray(d?.profile) ? d.profile : [])
      this.aktivesProfil.set(String(d?.aktiv ?? ''))
      if (!this.wer()) {
        this.wer.set(String(d?.aktiv ?? ''))
        // Profile und Regeln laden nebeneinander; wer zuletzt ankommt,
        // entscheidet, welche Tabelle steht — also hier noch einmal.
        this.regelnZeigen()
      }
      // Die Figur traegt der Typ `Profil` nicht — sie kommt trotzdem mit,
      // also hier abgreifen statt den Typ ueberall zu erweitern.
      const bilder: Record<string, string> = {}
      for (const p of (d?.profile ?? []) as { kennung: string; figur?: string }[]) {
        bilder[p.kennung] = String(p.figur ?? '')
      }
      this.figurenJeProfil.set(bilder)
      // `geschuetzt` und `passwortArt` sind alles, was der Server ueber das
      // Schloss preisgibt — der Abdruck selbst verlaesst ihn nie.
      const schloesser: Record<string, string> = {}
      for (const p of (d?.profile ?? []) as { kennung: string; geschuetzt?: boolean; passwortArt?: string }[]) {
        schloesser[p.kennung] = p.geschuetzt ? String(p.passwortArt ?? 'zeichen') : ''
      }
      this.schlossArten.set(schloesser)
      const roh = d as unknown as { gastAktiv?: boolean; gastBis?: number }
      this.gastAn.set(roh.gastAktiv !== false)
      this.gastBis.set(Number(roh.gastBis) || 0)
    } catch {
      /* ohne Namen weiter — siehe der Kopf dieser Funktion */
    }
  }

  protected nameVon(kennung: string): string {
    const p = this.profile().find((x) => x.kennung === kennung)
    return p?.name || kennung || 'diesem Kind'
  }

  /* ══ GEBURTSTAG UND ALTER (E38) ═════════════════════════════════════════
   * Gerechnet wird HIER nur fuers Anzeigen; die verbindliche Rechnung steht
   * im Server (profile.ts `alterAus`, rein und geprueft) und entscheidet,
   * welche Sammlungen als passend gelten. Zwei Rechnungen fuer dieselbe Zahl
   * liefen frueher oder spaeter auseinander — diese hier darf deshalb nur in
   * die Anzeige, nie in eine Entscheidung. */
  protected readonly heute = new Date().toISOString().slice(0, 10)

  protected geburtstagVon(kennung: string): string {
    return this.profile().find((x) => x.kennung === kennung)?.geburtstag || ''
  }

  protected alterVon(kennung: string): number | null {
    const g = this.geburtstagVon(kennung)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g)) return null
    const [j, m, t] = g.split('-').map(Number)
    const heute = new Date()
    let alter = heute.getFullYear() - j
    const monat = heute.getMonth() + 1
    if (monat < m || (monat === m && heute.getDate() < t)) alter -= 1
    return alter >= 0 ? alter : null
  }

  protected async geburtstagSetzen(kennung: string, wert: string): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/profil/geburtstag', { kennung, geburtstag: wert || '' }))
      this.profile.update((liste) =>
        liste.map((p) => (p.kennung === kennung ? { ...p, geburtstag: wert || undefined } : p)),
      )
    } catch (f) {
      const g = (f as { error?: { error?: string } })?.error?.error
      this.meldung.set(g || 'Der Geburtstag ließ sich nicht speichern.')
    }
  }

  // ══ NAME UND BILD ═════════════════════════════════════════════════════════
  protected readonly figuren = signal<string[]>([])
  protected readonly figurOrdner = signal('')
  protected readonly profilFehler = signal('')

  /**
   * Zeigt die Galerie der Maskottchen — zu per Vorgabe (Betreiber
   * 30.08.2026: „die auswahl der icons erst erscheinen beim klick bild
   * ändern"). `figurSpeichern` setzt sie nach einer Wahl selbst wieder auf
   * `false`; ein Wechsel des Profils lässt sie bewusst stehen, wie sie war
   * — wer sie gerade aufgeklappt hat, um ein zweites Kind zu vergleichen,
   * soll nicht bei jedem Tab-Wechsel neu klicken müssen.
   */
  protected readonly bildwahlOffen = signal(false)

  /**
   * Die Figur eines Profils.
   *
   * Aus einem EIGENEN Signal und nicht aus `profile()`: der Typ `Profil` der
   * Verwaltung fuehrt `figur` nicht, und ihn nur fuer diese Anzeige zu
   * erweitern hiesse, ihn ueberall mitzuschleppen. Der Server liefert das
   * Feld ohnehin mit; hier wird es beim Laden abgegriffen.
   */
  protected readonly figurenJeProfil = signal<Record<string, string>>({})

  protected figurVon(kennung: string): string {
    return this.figurenJeProfil()[kennung] ?? ''
  }

  /**
   * Der Anfangsbuchstabe eines Namens — fuer das Vorschaubildchen ohne
   * eigene Figur. Dieselbe Regel wie bei den Interpreten-Bildchen
   * (interpreten.ts, `anfang`), damit ein rundes Bildchen ohne Bild ueberall
   * in der Verwaltung gleich aussieht.
   */
  protected anfang(name: string): string {
    return (
      String(name || '?')
        .trim()
        .charAt(0)
        .toUpperCase() || '?'
    )
  }

  private async figurenHolen(): Promise<void> {
    try {
      const d = await firstValueFrom(
        this.http.get<{ ordner: string; webOrdner?: string; figuren: string[] }>('/api/figuren'),
      )
      this.figuren.set(d.figuren ?? [])
      // `webOrdner` ist die Adresse, unter der die Bilder wirklich liegen
      // (/neu/…). `ordner` allein ist relativ zur BOX-Oberflaeche und zeigt
      // von hier aus ins Leere — der Rueckfall bleibt nur fuer den Fall, dass
      // ein aelterer Server antwortet.
      this.figurOrdner.set(d.webOrdner || `/neu/${d.ordner ?? ''}`)
    } catch {
      this.figuren.set([])
    }
  }

  /**
   * Ein Feld an EINEM Profil aendern — ueber die ganze Liste.
   *
   * `PUT /api/profile` nimmt den vollstaendigen Stand entgegen, nicht ein
   * einzelnes Feld. Also: Liste holen, EINEN Eintrag ersetzen, zurueckgeben.
   * Frisch geholt und nicht aus der Anzeige genommen, damit ein Wechsel an
   * der Box in der Zwischenzeit nicht ueberschrieben wird.
   */
  private async profilAendern(kennung: string, feld: Partial<{ name: string; figur: string }>): Promise<void> {
    this.profilFehler.set('')
    try {
      const stand = await firstValueFrom(
        this.http.get<{ profile: { kennung: string; name: string; figur?: string }[] }>('/api/profile'),
      )
      const profile = (stand.profile ?? []).map((p) => (p.kennung === kennung ? { ...p, ...feld } : p))
      await firstValueFrom(this.http.put('/api/profile', { ...stand, profile }))
      await this.profileLaden()
    } catch (f) {
      const g = (f as { error?: { error?: string } })?.error?.error
      this.profilFehler.set(g || 'Nicht gespeichert.')
    }
  }

  protected async namenSpeichern(neu: string): Promise<void> {
    const name = String(neu ?? '').trim()
    if (!name || name === this.nameVon(this.wer())) return
    await this.profilAendern(this.wer(), { name })
  }

  protected async figurSpeichern(figur: string): Promise<void> {
    // Die Galerie ist eine WAHL, keine Ansicht — ein Klick auf ein Bildchen
    // beantwortet sie, auch wenn es zufaellig schon das aktuelle ist. Sonst
    // bliebe die Galerie ausgerechnet dann offen stehen, wenn wer das schon
    // gewaehlte Bild antippt, um sich zu vergewissern.
    this.bildwahlOffen.set(false)
    if (figur === this.figurVon(this.wer())) return
    await this.profilAendern(this.wer(), { figur })
  }

  // ══ PROFILE ANLEGEN UND LOESCHEN ══════════════════════════════════════════
  protected readonly neuerName = signal('')
  protected readonly legtAn = signal(false)
  protected readonly loescht = signal('')

  /**
   * Aus dem Namen eine Kennung machen.
   *
   * Sie wandert in DATEINAMEN (`gespielt.<kennung>.json`,
   * `profile/<kennung>/…`), deshalb das enge Muster des Servers:
   * `^[a-z0-9-]{1,24}$`. Umlaute werden aufgeloest statt weggeworfen — aus
   * „Jörg" wird „joerg" und nicht „jrg".
   */
  protected readonly kennungVorschau = computed(() => this.kennungAus(this.neuerName()))

  private kennungAus = kennungAus

  /** Der Gast gehoert zur Box, nicht zu den Kindern — und eines muss bleiben. */
  protected readonly loeschbar = computed(() => {
    const echte = this.profile().filter((p) => p.kennung !== 'gast')
    return echte.length > 1 ? echte : []
  })

  protected async profilAnlegen(): Promise<void> {
    const name = this.neuerName().trim()
    const kennung = this.kennungAus(name)
    this.profilFehler.set('')
    if (!name) return
    if (!kennung) {
      this.profilFehler.set('Aus diesem Namen lässt sich keine Kennung bilden — bitte Buchstaben verwenden.')
      return
    }
    if (this.profile().some((p) => p.kennung === kennung)) {
      this.profilFehler.set(`Es gibt schon ein Profil mit der Kennung „${kennung}".`)
      return
    }
    this.legtAn.set(true)
    try {
      const stand = await firstValueFrom(
        this.http.get<{ profile: { kennung: string; name: string }[] }>('/api/profile'),
      )
      await firstValueFrom(
        this.http.put('/api/profile', {
          ...stand,
          // `angelegt` als Zeitpunkt mitgeben, damit die Reihenfolge spaeter
          // stimmt — der Server erfindet ihn nicht.
          profile: [...(stand.profile ?? []), { kennung, name, angelegt: Date.now() }],
        }),
      )
      this.neuerName.set('')
      await this.profileLaden()
      // GLEICH HINSCHALTEN: wer ein Kind anlegt, will als Naechstes sein Bild
      // und seine Zeiten setzen — nicht erst wieder suchen.
      this.wer.set(kennung)
      void this.medienStandHolen()
    } catch (f) {
      const g = (f as { error?: { error?: string } })?.error?.error
      this.profilFehler.set(g || 'Das Anlegen ist fehlgeschlagen.')
    } finally {
      this.legtAn.set(false)
    }
  }

  protected async profilLoeschen(p: { kennung: string; name: string }): Promise<void> {
    // EINE LOESCHUNG IST NICHT ZURUECKZUHOLEN, also wird gefragt — und der
    // Text sagt, WAS mitgeht, nicht nur dass etwas weggeht.
    const ok = confirm(
      `„${p.name}" wirklich löschen?\n\nDamit gehen auch die Spielzeiten, die Medien-Zuordnung, die Hörstände und die Statistik dieses Kindes verloren. Die Medien selbst bleiben.\n\nDas lässt sich nicht rückgängig machen.`,
    )
    if (!ok) return
    this.loescht.set(p.kennung)
    this.profilFehler.set('')
    try {
      const stand = await firstValueFrom(
        this.http.get<{ profile: { kennung: string }[] }>('/api/profile'),
      )
      await firstValueFrom(
        this.http.put('/api/profile', {
          ...stand,
          profile: (stand.profile ?? []).filter((x) => x.kennung !== p.kennung),
        }),
      )
      await this.profileLaden()
      // Stand die Seite auf dem geloeschten Kind, muss sie woandershin —
      // sonst zeigt sie Einstellungen, die es nicht mehr gibt.
      if (this.wer() === p.kennung) this.wer.set(this.aktivesProfil() || this.profile()[0]?.kennung || '')
      void this.medienStandHolen()
    } catch (f) {
      const g = (f as { error?: { error?: string } })?.error?.error
      this.profilFehler.set(g || 'Das Löschen ist fehlgeschlagen.')
    } finally {
      this.loescht.set('')
    }
  }

  // ══ GAST (E39) ════════════════════════════════════════════════════════════
  protected readonly gastAn = signal(true)
  protected readonly gastBis = signal(0)
  protected readonly gastStunden = signal('')
  protected readonly gastVorbild = signal('')
  protected readonly gastLaeuft = signal(false)

  /** Alle echten Profile — beim Gast-Vorbild gibt es keine Mindestanzahl. */
  protected loeschbarOderAlle(): { kennung: string; name: string }[] {
    return this.profile().filter((p) => p.kennung !== 'gast')
  }

  protected gastBisText(): string {
    const bis = this.gastBis()
    if (!bis) return ''
    return ` — noch bis ${new Date(bis).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} Uhr`
  }

  protected async gastSchalten(an: boolean): Promise<void> {
    if (!an && !confirm('Den Gast abschalten?\n\nSeine Kachel verschwindet von der Box, und ohne Anmeldung läuft dort nichts mehr.')) {
      return
    }
    this.gastLaeuft.set(true)
    this.profilFehler.set('')
    try {
      const stunden = Number(this.gastStunden())
      await firstValueFrom(
        this.http.post('/api/profil/gast', {
          an,
          ...(an && stunden > 0 ? { stunden } : {}),
          ...(an && this.gastVorbild() ? { uebernehmenVon: this.gastVorbild() } : {}),
        }),
      )
      await this.profileLaden()
    } catch (f) {
      const g = (f as { error?: { error?: string } })?.error?.error
      this.profilFehler.set(
        g === 'nurDerGastIstDa'
          ? 'Der Gast ist das einzige Profil — leg erst ein Kind an, dann lässt er sich abschalten.'
          : g || 'Das Schalten ist fehlgeschlagen.',
      )
    } finally {
      this.gastLaeuft.set(false)
    }
  }

  // ══ SCHLOSS ══════════════════════════════════════════════════════════════
  // Was ueber das Passwort ueberhaupt herauskommt, ist `geschuetzt` und
  // `passwortArt` — mehr gibt der Server nicht her, und das ist richtig so.
  protected readonly schlossArten = signal<Record<string, string>>({})
  protected readonly neueArt = signal('zahlen')
  protected readonly neuesPasswort = signal('')
  protected readonly schlossLaeuft = signal(false)

  /** Der Gast ist kein Kind, sondern ein Zustand — er kann kein Schloss haben. */
  protected istGast(): boolean {
    return this.wer() === 'gast'
  }

  protected schlossArt(): string {
    return this.schlossArten()[this.wer()] ?? ''
  }

  protected artName(a: string): string {
    const namen: Record<string, string> = {
      zahlen: 'Zahlen',
      zeichen: 'Zeichen',
      farben: 'Farben',
      muster: 'Muster',
      bilder: 'Bilder',
    }
    return namen[a] ?? a
  }

  private async schlossSchreiben(neu: string): Promise<void> {
    this.schlossLaeuft.set(true)
    this.profilFehler.set('')
    try {
      await firstValueFrom(
        this.http.put('/api/profil/passwort/verwaltung', {
          profil: this.wer(),
          art: this.neueArt(),
          neu,
        }),
      )
      this.neuesPasswort.set('')
      await this.profileLaden()
    } catch (f) {
      const g = (f as { error?: { error?: string } })?.error?.error
      this.profilFehler.set(
        g === 'zuKurzOderZuLang'
          ? 'Das Passwort muss zwischen 3 und 64 Zeichen lang sein.'
          : g === 'gastOhnePasswort'
            ? 'Der Gast bekommt kein Schloss — er ist der Zustand „niemand hat gewählt".'
            : g || 'Nicht gespeichert.',
      )
    } finally {
      this.schlossLaeuft.set(false)
    }
  }

  protected async schlossSetzen(): Promise<void> {
    const neu = this.neuesPasswort().trim()
    if (neu.length < 3) return
    await this.schlossSchreiben(neu)
  }

  protected async schlossAbnehmen(): Promise<void> {
    // GEFRAGT WIRD, weil danach jeder an der Box in dieses Profil kommt — und
    // das merkt man erst, wenn es passiert ist.
    if (!confirm(`Das Schloss von „${this.nameVon(this.wer())}" abnehmen?\n\nDanach kommt jeder an der Box ohne Weiteres in dieses Profil.`)) {
      return
    }
    await this.schlossSchreiben('')
  }

  // ══ MEDIEN ════════════════════════════════════════════════════════════════
  protected readonly medienStand = signal<{ alle: boolean; werke: string[] } | null>(null)
  protected readonly gesamtWerke = signal(0)

  private async medienStandHolen(): Promise<void> {
    try {
      const a = await firstValueFrom(
        this.http.get<{ alle: boolean; werke: string[] }>(`/api/profil/auswahl?profil=${encodeURIComponent(this.wer())}`),
      )
      this.medienStand.set({ alle: a.alle, werke: a.werke ?? [] })
      const m = await firstValueFrom(this.http.get<{ gesamt: number }>('/api/medien'))
      this.gesamtWerke.set(m.gesamt ?? 0)
    } catch {
      this.medienStand.set(null)
    }
  }

  // ══ STATISTIK ═════════════════════════════════════════════════════════════
  protected readonly statTage = signal('7')
  protected readonly statAlle = signal(false)
  private readonly statRoh = signal<VerlaufProfil[]>([])

  /** Nur das gewaehlte Kind — oder alle, je nach Schalter. */
  private readonly statGewaehlt = computed(() =>
    this.statAlle() ? this.statRoh() : this.statRoh().filter((p) => p.kennung === this.wer()),
  )

  protected readonly statSumme = computed(() => this.statGewaehlt().reduce((a, p) => a + p.sekunden, 0))

  protected readonly statDienste = computed(() => {
    const summe = new Map<string, number>()
    for (const p of this.statGewaehlt()) {
      for (const d of p.dienste) summe.set(d.dienst, (summe.get(d.dienst) ?? 0) + d.sekunden)
    }
    return [...summe.entries()]
      .map(([dienst, sekunden]) => ({ dienst, sekunden }))
      .sort((a, b) => b.sekunden - a.sekunden)
  })

  protected readonly statZeilen = computed(() =>
    this.statGewaehlt()
      .flatMap((p) => p.zuletzt.map((z) => ({ ...z, wer: p.name })))
      .sort((a, b) => b.beginn - a.beginn)
      .slice(0, 80),
  )

  protected anteil(sekunden: number): number {
    const groesste = this.statDienste()[0]?.sekunden ?? 0
    return groesste > 0 ? Math.round((sekunden / groesste) * 100) : 0
  }

  protected dienstName(d: string): string {
    const namen: Record<string, string> = {
      spotify: 'Spotify',
      ard: 'ARD Sounds',
      jellyfin: 'Jellyfin',
      navidrome: 'Navidrome',
      lokal: 'Von der Box',
      sonstige: 'Sonstige',
    }
    return namen[d] ?? d
  }

  /** Sekunden lesbar — „2 h 15 min", nicht „8100". */
  protected dauerText(s: number): string {
    const n = Math.max(0, Math.round(Number(s) || 0))
    if (n < 60) return `${n} s`
    const min = Math.round(n / 60)
    if (min < 60) return `${min} min`
    return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
  }

  /** „heute 16:30", „gestern 7:10", sonst mit Datum — so fragt man auch. */
  protected wannText(ms: number): string {
    const d = new Date(ms)
    const uhr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    const tag = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
    const heute = tag(new Date())
    const diff = Math.round((heute - tag(d)) / 86_400_000)
    if (diff === 0) return `heute ${uhr}`
    if (diff === 1) return `gestern ${uhr}`
    return `${d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })} ${uhr}`
  }

  protected async statTageSetzen(v: string): Promise<void> {
    this.statTage.set(v)
    await this.statHolen()
  }

  protected async statAlleSetzen(an: boolean): Promise<void> {
    this.statAlle.set(an)
  }

  private async statHolen(): Promise<void> {
    try {
      const d = await firstValueFrom(
        this.http.get<{ profile: VerlaufProfil[] }>(`/api/verlauf?tage=${encodeURIComponent(this.statTage())}`),
      )
      this.statRoh.set(d.profile ?? [])
    } catch {
      // Ohne Zahlen zeigt die Karte ihren ehrlichen Satz statt einer Fehlermeldung.
      this.statRoh.set([])
    }
  }

  protected async werWaehlen(kennung: string): Promise<void> {
    // Die Karten unter der Wahl gehoeren zum GEWAEHLTEN Kind — sonst stuende
    // dort die Zuordnung des vorigen, und man verstellte das falsche.
    void this.medienStandHolen()
    this.wer.set(kennung)
    this.meldung.set('')
    this.regelnZeigen()
    await this.standHolen()
  }

  /**
   * Die Tabelle auf das stellen, was fuer das gewaehlte Kind GILT.
   *
   * EINE KOPIE, KEIN VERWEIS: `ngModel` schreibt direkt in `regeln()`. Zeigte
   * das auf den Satz, stuende eine Eingabe schon vor dem Speichern darin —
   * und ein misslungenes Speichern sähe trotzdem gespeichert aus.
   */
  private regelnZeigen(): void {
    const s = this.satz()
    if (!s) return
    const w = this.wer()
    this.regeln.set(vollstaendig(w && Object.hasOwn(s.je, w) ? s.je[w] : s.standard))
  }

  /** Eigene Regeln fuer das gewaehlte Kind — zunaechst als Kopie der Hausregel. */
  protected async eigeneAnlegen(): Promise<void> {
    const w = this.wer()
    const s = this.satz()
    if (!w || !s) return
    this.meldung.set('')
    try {
      const r = vollstaendig(
        await firstValueFrom(this.http.put<Regeln>(`/api/kinderzeit${this.wemAnhang()}`, vollstaendig(s.standard))),
      )
      this.satz.set({ ...s, je: { ...s.je, [w]: r } })
      this.regelnZeigen()
      this.meldung.set(`${this.nameVon(w)} hat jetzt eigene Regeln — zunächst dieselben wie die Hausregel.`)
      await this.standHolen()
    } catch {
      this.meldung.set('Nicht gespeichert.')
    }
  }

  /** Die eigenen Regeln verwerfen — danach gilt fuer das Kind wieder die Hausregel. */
  protected async eigeneVerwerfen(): Promise<void> {
    const w = this.wer()
    const s = this.satz()
    if (!w || !s) return
    if (!confirm(`Die eigenen Regeln von „${this.nameVon(w)}" verwerfen?\n\nDanach gilt für dieses Kind wieder die Hausregel.`)) {
      return
    }
    this.meldung.set('')
    try {
      await firstValueFrom(this.http.delete(`/api/kinderzeit${this.wemAnhang()}`))
      const { [w]: _weg, ...rest } = s.je
      this.satz.set({ ...s, je: rest })
      this.regelnZeigen()
      await this.standHolen()
    } catch {
      this.meldung.set('Hat nicht geklappt.')
    }
  }

  /** Mehrere Kennungen als lesbare Namen. */
  protected namenVon(kennungen: string[]): string {
    return kennungen.map((k) => this.nameVon(k)).join(', ')
  }

  /** Die Abfrage `?profil=…`, wenn eine Wahl getroffen ist. */
  private wemAnhang(): string {
    const w = this.wer()
    return w ? `?profil=${encodeURIComponent(w)}` : ''
  }

  private async standHolen(): Promise<void> {
    try {
      this.stand.set(
        await firstValueFrom(this.http.get<Stand>(`/api/kinderzeit/stand${this.wemAnhang()}`)),
      )
    } catch {
      /* Der Stand ist Beiwerk — ohne ihn bleibt die Seite bedienbar. */
    }
  }

  protected async speichern(): Promise<void> {
    this.meldung.set('')
    // Eigene Regeln des Kindes ODER die Hausregel — nie still die eine statt
    // der anderen (siehe `regelnZeigen`).
    const w = this.wer()
    const eigen = this.eigeneRegeln()
    try {
      const r = vollstaendig(
        await firstValueFrom(this.http.put<Regeln>(`/api/kinderzeit${eigen ? this.wemAnhang() : ''}`, this.regeln())),
      )
      // Was der Server daraus gemacht hat, ist die Wahrheit — er biegt
      // Unsinniges zurecht. Also übernehmen statt hoffen.
      this.regeln.set(vollstaendig(r))
      const s = this.satz()
      if (s) this.satz.set(eigen ? { ...s, je: { ...s.je, [w]: r } } : { ...s, standard: r })
      await this.standHolen()
    } catch {
      this.meldung.set('Nicht gespeichert.')
    }
  }

  /** Montag als Vorlage auf die übrigen Wochentage übertragen. */
  protected aufWochentage(): void {
    this.uebertragen(WOCHENTAGE)
  }

  protected aufAlleTage(): void {
    this.uebertragen(WOCHE.map((w) => w.schluessel))
  }

  private uebertragen(ziele: Tag[]): void {
    const vorlage = this.regeln().tage.mo
    const r = this.regeln()
    for (const z of ziele) r.tage[z] = { ...vorlage }
    this.regeln.set({ ...r })
    void this.speichern()
  }

  protected async schenken(minuten: number): Promise<void> {
    try {
      this.stand.set(
        // MIT DER KENNUNG. Ohne sie ginge das Geschenk an das Kind, das
        // gerade an der Box dran ist — und das ist nicht zwingend das, dessen
        // Name ueber dem Knopf steht.
        await firstValueFrom(
          this.http.post<Stand>(`/api/kinderzeit/bonus${this.wemAnhang()}`, { minuten }),
        ),
      )
      await this.standHolen()
    } catch {
      this.meldung.set('Hat nicht geklappt.')
    }
  }

  protected async zuruecksetzen(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`/api/kinderzeit/zuruecksetzen${this.wemAnhang()}`, {}))
      await this.standHolen()
    } catch {
      this.meldung.set('Hat nicht geklappt.')
    }
  }

  private async schlummerLesen(): Promise<void> {
    try {
      const a = await firstValueFrom(
        this.http.get<{ laeuft: boolean; maxMinuten: number }>('/api/schlummer'),
      )
      this.schlummerLaeuft.set(a.laeuft)
      this.schlummerMax.set(a.maxMinuten)
    } catch {
      // ANGEFASST WIRD NICHTS. Beim ersten Laden steht ohnehin „läuft nicht"
      // da, und das ist die richtige Vorgabe — man sieht den Startknopf. Nach
      // einem misslungenen Abbruch aber wäre ein Zurücksetzen auf „läuft
      // nicht" eine Behauptung über eine Box, die gerade nicht antwortet.
    }
  }

  protected async schlummerStarten(): Promise<void> {
    this.meldung.set('')
    try {
      await firstValueFrom(this.http.post('/api/schlummer', { minuten: this.schlummerMinuten }))
      this.schlummerLaeuft.set(true)
      this.meldung.set(`Die Box schaltet sich in ${this.schlummerMinuten} Minuten ab.`)
    } catch (e) {
      const g = (e as { error?: { error?: string } })?.error?.error
      this.meldung.set(g || 'Der Timer ließ sich nicht starten.')
    }
  }

  /**
   * Den laufenden Timer abbrechen.
   *
   * HIER WURDE BEIM UMZUG ETWAS GERADEGEZOGEN, nicht bloß verschoben: die
   * alte Fassung auf der Systemseite setzte „läuft nicht" und meldete „Der
   * Timer wurde abgebrochen" AUCH DANN, wenn die Anfrage fehlschlug. Das ist
   * die teuerste Sorte Unwahrheit — die Box schaltet trotzdem ab, mitten in
   * der Geschichte, und der einzige Knopf, der das noch verhindern könnte,
   * ist gerade verschwunden. Jetzt gilt: nur was gelungen ist, wird gemeldet.
   */
  protected async schlummerStoppen(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/schlummer', { stopp: true }))
      this.schlummerLaeuft.set(false)
      this.meldung.set('Der Timer wurde abgebrochen.')
    } catch {
      this.meldung.set('Der Timer ließ sich nicht abbrechen — er läuft weiter.')
      // Nachfragen statt behaupten. Antwortet die Box auch darauf nicht,
      // bleibt „läuft" stehen, und der Knopf lässt sich noch einmal drücken.
      await this.schlummerLesen()
    }
  }

  protected standText(s: Stand): string {
    switch (s.grund) {
      case 'aus':
        return 'Kinderzeit aus'
      case 'frei':
        return s.fensterBis ? `darf hören (bis ${s.fensterBis})` : 'darf hören'
      case 'tagGesperrt':
        return 'heute gesperrt'
      case 'zuFrueh':
        return `noch zu früh (ab ${s.fensterAb})`
      case 'zuSpaet':
        return `Feierabend (war bis ${s.fensterBis})`
      case 'aufgebraucht':
        return 'Zeit aufgebraucht'
      default:
        return ''
    }
  }
}

function leerTag(): TagesRegel {
  return { frei: true, ab: '', bis: '', minuten: 0 }
}

function leereRegeln(): Regeln {
  return {
    aktiv: false,
    nachsichtMin: 5,
    tage: { so: leerTag(), mo: leerTag(), di: leerTag(), mi: leerTag(), do: leerTag(), fr: leerTag(), sa: leerTag() },
  }
}

/**
 * Fehlende Tage auffüllen.
 *
 * Die Eingabefelder binden direkt an `tage[x]` — fehlt ein Tag, stürzt die
 * Vorlage ab, statt nur etwas nicht anzuzeigen.
 */
function vollstaendig(r: Regeln | null): Regeln {
  const aus = leereRegeln()
  if (!r) return aus
  aus.aktiv = r.aktiv === true
  aus.nachsichtMin = Number(r.nachsichtMin) || 0
  for (const w of WOCHE) aus.tage[w.schluessel] = { ...leerTag(), ...(r.tage?.[w.schluessel] ?? {}) }
  return aus
}
