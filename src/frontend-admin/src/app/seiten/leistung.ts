/**
 * Die Leistungsseite — wohin der Speicher geht und was den Start aufhält.
 *
 * Betreiber, 20.08.2026: „ich will auch einen performance tab ins admin menu
 * mit prozessen die laufen wann laufen wieviel speicher bentötigen boot zeit
 * aber in graph form." Und danach, als der Punkt zunächst nur im
 * Eltern-Bereich der Box stand: „ich dachte auch ans admin menü browser."
 *
 * SIE STEHT NEBEN „SYSTEM" UND NICHT DARIN. Die Systemseite zeigt den
 * ZUSTAND (Temperatur, Platte, Last) und die Kurve darüber — also „wie viel".
 * Diese hier beantwortet „wofür": welcher Posten belegt den Speicher, seit
 * wann läuft er, welcher Dienst hat den Start aufgehalten. Zwei Fragen, zwei
 * Seiten; zusammengelegt wäre es eine Seite, die man scrollen muss, um die
 * eine Auskunft zu finden, wegen der man gekommen ist.
 *
 * DIESELBE QUELLE WIE DIE BOX-OBERFLÄCHE: `GET /api/leistung`. Der Punkt
 * „Leistung" im Eltern-Bereich der Box zeigt dieselben Zahlen kleiner. Zwei
 * Anzeigen, ein Weg — die Alternative wäre ein zweiter Endpunkt, der beim
 * nächsten Umbau stillschweigend etwas anderes meldet.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, type OnDestroy, computed, inject, signal } from '@angular/core'
import { firstValueFrom } from 'rxjs'

import { dauerText } from '../dauer-text'
import { Systemkurve } from './systemkurve'

/** Eine Gruppe zusammengehöriger Prozesse, wie sie der Server verdichtet. */
export interface Posten {
  name: string
  /** Speicher in Kilobyte (PSS). */
  speicher: number
  anzahl: number
  /** Laufzeit des ältesten Mitglieds in Sekunden. */
  laufzeit: number
  cpu: number
}

/** Ein Dienst auf der Boot-Zeitachse: von wann bis wann er startete. */
export interface Balken {
  name: string
  von: number
  bis: number
}

export interface Leistungslage {
  gruppen: Posten[]
  rest: Posten | null
  gesamtKb: number
  speicherGesamt: number
  speicherFrei: number
  kerne: number
  laeuftSeit: number
  start: { kernel: number | null; userland: number | null; gesamt: number | null }
  bremser: { name: string; sekunden: number }[]
  zeitachse: Balken[]
  kioskBrowser: string | null
}

/*
 * `dauerText` stand bis zum 19.09.2026 HIER und klemmte alles Unbrauchbare
 * auf 0 („0 s" statt „unbekannt"). Sie liegt jetzt in `app/dauer-text.ts`,
 * zusammen mit dem Wächter, den sich diese Seite mit der Systemseite teilt —
 * dort steht auch, WARUM die beiden Formatierer getrennt bleiben.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WEITERGABE AN DIE SERVER-SEITE (offen, 19.09.2026, Rang 10d)
 * ────────────────────────────────────────────────────────────────────────
 * EIN echter Doppelgänger bleibt übrig, und er liegt nicht hier:
 * `l.laeuftSeit` ist dieselbe Größe wie `laufzeitSekunden` in /api/system —
 * die Laufzeit der Box. Die Systemseite zeigt sie seit heute als fertigen
 * Satz vom Server („5 h 23 min"), diese Seite rechnet sie mit `dauerText`
 * gröber nach („5 h"). Zwei Seiten, dieselbe Box, zwei Zahlen.
 *
 * ZUSAMMENLEGEN LÄSST SICH DAS NUR IM SERVER, und der gehört einer anderen
 * Hoheit. Gebraucht wird genau ein Feld, in der Form, die /api/system am
 * 19.09.2026 schon bekommen hat (server.ts:5540):
 *
 *     // src/backend-api/src/server.ts, /api/leistung, neben :5842
 *     laufzeit: laufzeitText(os.uptime()),   // laeuftSeit bleibt daneben
 *
 * Danach hier: `laufzeit?: string` in `Leistungslage` und aus
 * `{{ dauerText(l.laeuftSeit) }}` (unten, „Läuft seit") wird
 * `{{ textOderUnbekannt(l.laufzeit) }}`. `dauerText` bleibt für die
 * Prozess-Laufzeiten, die die feine Einteilung brauchen.
 *
 * NICHT GEBAUT, WEIL es hier nur eine stille zweite Meinung gäbe: Die
 * Formatierung der Box-Laufzeit heute im Frontend nachzubauen wäre genau die
 * Doppelung, die Rang 10d abräumt.
 */

/** Kilobyte als MB oder GB — mit einer Nachkommastelle, wo sie etwas trägt. */
export function speicherText(kb: number): string {
  const n = Math.max(0, Number(kb) || 0)
  if (n < 1024) return `${Math.round(n)} kB`
  const mb = n / 1024
  if (mb < 1024) return `${Math.round(mb)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

@Component({
  selector: 'mupi-leistung',
  standalone: true,
  imports: [Systemkurve],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    h1 { font-size: 1.3rem; margin: 0 0 0.4rem; }
    h2 { font-size: 1.02rem; margin: 2rem 0 0.7rem; }
    .unter { color: var(--gedaempft); font-size: 0.9rem; margin: 0 0 1.2rem; }
    .kopfzeile { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
    .tat {
      margin-left: auto; background: var(--flaeche); border: 1px solid var(--rand);
      border-radius: 10px; padding: 0.45rem 0.9rem; cursor: pointer; font: inherit;
      color: inherit;
    }
    .tat[disabled] { opacity: 0.5; cursor: default; }
    .werte { display: grid; gap: 0.7rem; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); }
    .wert {
      background: var(--flaeche); border: 1px solid var(--rand);
      border-radius: 12px; padding: 0.85rem 1rem;
    }
    .wert .was { color: var(--gedaempft); font-size: 0.82rem; }
    .wert .zahl { font-size: 1.25rem; margin-top: 0.15rem; }

    /* DIE BALKEN SIND EIGENE KÄSTEN UND KEINE BIBLIOTHEK — dieselbe Regel wie
       auf der Systemseite nebenan, deren Kurve auch von Hand gezeichnet ist.
       Ein Balken ist eine Breite in Prozent; dafür lädt man nichts nach. */
    .posten { display: flex; flex-direction: column; gap: 0.55rem; }
    .zeile { display: grid; grid-template-columns: minmax(9rem, 15rem) 1fr auto; gap: 0.8rem; align-items: center; }
    .zeile .name { font-size: 0.92rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .zeile .name small { color: var(--gedaempft); }
    .bahn { height: 10px; border-radius: 5px; background: var(--rand); overflow: hidden; display: flex; }
    .bahn i { display: block; height: 100%; background: var(--gedaempft); min-width: 2px; }
    /* Der Kiosk ist der Posten, um den es meistens geht — er bekommt die
       Leitfarbe, alles andere bleibt gedämpft. Ein Diagramm, in dem jeder
       Balken schreit, zeigt nichts. */
    .bahn i.leit { background: var(--leit); }
    .bahn i.warn { background: var(--warn); }
    .zeile .zahl { font-variant-numeric: tabular-nums; font-size: 0.9rem; text-align: right; min-width: 5.5rem; }
    .zeile .zahl small { display: block; color: var(--gedaempft); font-size: 0.78rem; }
    .leer { color: var(--gedaempft); }
    .fehler { color: var(--fehler); }
    .fuss { color: var(--gedaempft); font-size: 0.85rem; margin-top: 1.6rem; line-height: 1.5; }
    .live { display: flex; align-items: center; gap: 0.4rem; color: var(--gedaempft); font-size: 0.88rem; margin-left: auto; }
    .live input { accent-color: var(--leit); }
    /* Der Knopf stand mit margin-left:auto rechts; jetzt tut das der
       Live-Schalter, und der Knopf schliesst direkt an.
       KEIN BACKTICK IN DIESEN KOMMENTAREN: der styles-Block IST eine
       Vorlage, und ein Backtick beendet sie mitten im Satz. */
    .tat { background: var(--flaeche); border: 1px solid var(--rand); border-radius: 10px;
           padding: 0.45rem 0.9rem; cursor: pointer; font: inherit; color: inherit; }
    /* ══ DIE ZEITACHSE ══════════════════════════════════════════════════
       .luecke ist der unsichtbare Vorlauf bis zum Start des Dienstes —
       dadurch beginnt jeder Balken an seiner echten Stelle. Ohne ihn
       staenden alle links buendig, und die Achse zeigte wieder nur Dauern. */
    /* ══ DER GESTAPELTE SPEICHERBALKEN ══════════════════════════════════
       Die Felder werden nach hinten leicht durchsichtiger (opacity je Rang).
       Das gibt eine Reihenfolge, ohne acht Farben zu erfinden, die sonst
       nirgends im Haus vorkommen und beim naechsten Thema nicht mitwandern. */
    .stapel { display: flex; height: 22px; border-radius: 11px; overflow: hidden;
              background: var(--rand); margin-bottom: 0.9rem; }
    .stapel .teil { display: block; height: 100%; background: var(--gedaempft);
                    min-width: 2px; }
    .stapel .teil.leit { background: var(--leit); opacity: 1 !important; }
    .legende { display: grid; gap: 0.3rem 1rem;
               grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); }
    .lg-zeile { display: flex; align-items: baseline; gap: 0.5rem; font-size: 0.88rem; }
    .lg-zeile .punkt { width: 10px; height: 10px; border-radius: 3px; flex: 0 0 auto;
                       background: var(--gedaempft); }
    .lg-zeile .punkt.leit { background: var(--leit); opacity: 1 !important; }
    .lg-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lg-name small { color: var(--gedaempft); }
    .lg-wert { margin-left: auto; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .lg-neben { color: var(--gedaempft); font-size: 0.8rem; white-space: nowrap;
                min-width: 4rem; text-align: right; }

    /* ══ DER WASSERFALL — EIN FELD, NICHT ZWANZIG BAHNEN ═════════════════
       Die Gitterlinien laufen durch alle Zeilen: nur so sieht man, was
       GLEICHZEITIG lief. Jede Zeile in einer eigenen Bahn zu zeichnen sah aus
       wie zwanzig Fortschrittsbalken untereinander. */
    .wasserfall { position: relative; padding: 1.4rem 0 0.2rem;
                  border-left: 1px solid var(--rand); }
    .wasserfall .gitter { position: absolute; inset: 1.4rem 0 0.2rem 0; pointer-events: none; }
    .wasserfall .linie { position: absolute; top: -1.4rem; bottom: 0; width: 0;
                         border-left: 1px dashed color-mix(in srgb, var(--rand) 80%, transparent); }
    .wasserfall .linie b { position: absolute; top: 0; left: 0.25rem; font-weight: 400;
                           font-size: 0.72rem; color: var(--gedaempft); white-space: nowrap; }
    .wf-zeile { position: relative; height: 1.55rem; }
    .wf-name { position: absolute; left: 0.4rem; top: 0.15rem; font-size: 0.82rem;
               color: var(--gedaempft); white-space: nowrap; z-index: 1;
               pointer-events: none; }
    /* DER BALKEN LIEGT UEBER DEM NAMEN, nicht daneben: bei 14 Zeilen kostet
       eine eigene Namensspalte die halbe Breite der Achse. Der Name steht
       links am Rand und wird vom Balken ueberdeckt, sobald einer dort
       beginnt — was selten vorkommt, weil frueh startende Dienste kurz sind. */
    .wf-balken { position: absolute; top: 0.3rem; height: 0.95rem; border-radius: 4px;
                 background: var(--gedaempft); min-width: 3px; z-index: 2;
                 display: flex; align-items: center; }
    .wf-balken.leit { background: var(--leit); }
    .wf-balken.warn { background: var(--warn); }
    .wf-balken em { position: absolute; left: calc(100% + 0.35rem); font-style: normal;
                    font-size: 0.72rem; color: var(--gedaempft);
                    font-variant-numeric: tabular-nums; white-space: nowrap; }
  `,
  template: `
    <div class="kopfzeile">
      <h1>Leistung</h1>
      <!-- LIVE IST EIN SCHALTER UND KEINE VORGABE. Jeder Abruf liest rund 150
           Dateien unter /proc; im Dauerbetrieb verändert die Messung genau
           die Zahl, die sie misst. Wer zusieht, schaltet bewusst ein — und
           sieht am Knopf, dass es läuft. -->
      <label class="live">
        <input type="checkbox" [checked]="live()" (change)="liveUmschalten()" />
        Live ({{ TAKT_S }} s)
      </label>
      <button class="tat" type="button" [disabled]="laedt()" (click)="holen()">
        {{ laedt() ? 'Wird gemessen …' : 'Neu messen' }}
      </button>
    </div>
    <p class="unter">
      Wohin der Arbeitsspeicher geht, seit wann die Posten laufen und was den Start aufgehalten hat.
      @if (lage(); as l) {
        @if (l.kioskBrowser) { <span>Kiosk: {{ l.kioskBrowser }}.</span> }
      }
    </p>

    @if (fehler(); as f) {
      <p class="fehler">{{ f }}</p>
    } @else if (!lage()) {
      <p class="leer">Wird gemessen …</p>
    } @else if (lage(); as l) {
      <div class="werte">
        <div class="wert">
          <div class="was">Von Prozessen belegt</div>
          <div class="zahl">{{ speicherText(l.gesamtKb) }}</div>
        </div>
        <div class="wert">
          <div class="was">Frei</div>
          <div class="zahl">{{ speicherText(l.speicherFrei / 1024) }}</div>
        </div>
        <div class="wert">
          <div class="was">Start der Box</div>
          <div class="zahl">{{ l.start.gesamt !== null ? l.start.gesamt + ' s' : 'unbekannt' }}</div>
        </div>
        <div class="wert">
          <div class="was">Läuft seit</div>
          <div class="zahl">{{ dauerText(l.laeuftSeit) }}</div>
        </div>
      </div>

      <!-- ══ EIN GESTAPELTER BALKEN STATT EINER LISTE VON BALKEN ═══════════
           Vorher stand hier je Posten eine eigene graue Bahn mit einem
           Balken darin. Das beantwortet „wie groß ist dieser Posten im
           Vergleich zum größten" — aber nicht die Frage, um die es geht:
           WELCHEN ANTEIL am belegten Speicher hat er. Gestapelt sieht man
           beides auf einen Blick, und der Balken ist zugleich die Summe.
           Betreiber, 20.08.2026: „ich finde die einzelne bar darstellung
           nicht gut." -->
      <h2>Speicher je Posten</h2>
      <div class="stapel">
        @for (p of alle(); track p.name; let i = $index) {
          <span
            class="teil"
            [class.leit]="p.name.startsWith('Kiosk')"
            [style.width.%]="stapelAnteil(p.speicher)"
            [style.opacity]="1 - i * 0.07"
            [title]="p.name + ' · ' + speicherText(p.speicher)"
          ></span>
        }
      </div>
      <!-- DIE LEGENDE TRÄGT DIE ZAHLEN. Ein gestapelter Balken allein sagt
           „viel" und „wenig"; die genauen Werte gehören daneben, sonst muss
           man mit der Maus über jedes Feld fahren. -->
      <div class="legende">
        @for (p of alle(); track p.name; let i = $index) {
          <div class="lg-zeile">
            <span class="punkt" [class.leit]="p.name.startsWith('Kiosk')" [style.opacity]="1 - i * 0.07"></span>
            <span class="lg-name">
              {{ p.name }}
              @if (p.anzahl > 1) { <small>· {{ p.anzahl }}×</small> }
            </span>
            <span class="lg-wert">{{ speicherText(p.speicher) }}</span>
            <span class="lg-neben">{{ dauerText(p.laufzeit) }}</span>
          </div>
        }
      </div>

      <h2>Der Start</h2>
      @if (l.start.kernel !== null || l.start.userland !== null) {
        <div class="zeile">
          <div class="name">Kernel und Dienste</div>
          <div class="bahn">
            <i class="leit" [style.width.%]="startAnteil(l.start.kernel)"></i>
            <i [style.width.%]="startAnteil(l.start.userland)"></i>
          </div>
          <div class="zahl">
            {{ l.start.gesamt }} s
            <small>{{ l.start.kernel }} s + {{ l.start.userland }} s</small>
          </div>
        </div>
      }
      @if (l.bremser.length) {
        <div class="posten" style="margin-top: 0.8rem">
          @for (b of l.bremser; track b.name) {
            <div class="zeile">
              <div class="name">{{ b.name.replace('.service', '') }}</div>
              <div class="bahn"><i [class.warn]="b.sekunden >= 3" [style.width.%]="bremsAnteil(b.sekunden)"></i></div>
              <div class="zahl">{{ b.sekunden }} s</div>
            </div>
          }
        </div>
      } @else {
        <p class="leer">Diese Box sagt nichts über ihre Startzeiten (systemd-analyze fehlt).</p>
      }

      <!-- ══ DER WASSERFALL — wer WANN lief, nicht nur wie lange ═══════════
           Die Balken oben beantworten „wer war langsam". Diese Achse
           beantwortet „wer hat wen aufgehalten": alle Dienste auf EINER
           Zeitachse, Start links, Dauer als Länge. Genau dieser Unterschied
           hat die Kiosk-Kette aufgeklärt (ifup@wlan0 → network.target →
           systemd-user-sessions → getty): ein Dienst kann 3,5 s brauchen und
           niemanden bremsen, wenn er nebenher läuft. -->
      @if (l.zeitachse.length) {
        <!-- ══ EIN DIAGRAMMFELD STATT EINER LISTE VON BAHNEN ════════════════
             Vorher hatte jede Zeile ihre eigene graue Bahn — das sieht aus
             wie zwanzig Fortschrittsbalken untereinander und nicht wie eine
             Zeitachse. Jetzt gibt es EIN Feld mit durchgehenden Gitterlinien;
             die Balken schweben darin an ihrer Stelle. Genau so liest man
             einen Wasserfall: die Linien verbinden, was gleichzeitig lief. -->
        <h2>Zeitachse des Starts</h2>
        <div class="wasserfall">
          <div class="gitter">
            @for (m of achsenMarken(); track m) {
              <span class="linie" [style.left.%]="100 * m / achsenEnde()">
                <b>{{ m }} s</b>
              </span>
            }
          </div>
          @for (b of l.zeitachse; track b.name) {
            <div class="wf-zeile">
              <span class="wf-name">{{ b.name }}</span>
              <span
                class="wf-balken"
                [class.leit]="b.name.startsWith('getty')"
                [class.warn]="b.bis - b.von >= 1"
                [style.left.%]="100 * b.von / achsenEnde()"
                [style.width.%]="breiteVon(b)"
                [title]="b.name + ' · ' + b.von.toFixed(2) + ' s bis ' + b.bis.toFixed(2) + ' s'"
              >
                <em>{{ (b.bis - b.von).toFixed(2) }} s</em>
              </span>
            </div>
          }
        </div>
      }

      <!-- ══ DER VERLAUF — dieselbe Komponente wie auf der Systemseite ═════
           NICHT NACHGEBAUT: mupi-systemkurve zeichnet CPU, Speicher, Wärme
           und Last aus /api/system/verlauf und holt sich selbst, was sie
           braucht. Eine zweite Kurve mit eigener Achsenrechnung wäre der
           Ort, an dem beide eines Tages verschiedene Zahlen zeigen. -->
      <h2>Verlauf</h2>
      <mupi-systemkurve />

      <p class="fuss">
        Gemessen wird PSS (proportional set size): Speicher, den mehrere Prozesse teilen, zählt anteilig —
        sonst käme man bei einem Browser mit dreizehn Prozessen auf mehr, als die Box überhaupt hat.
        Zusammengehörige Prozesse stehen als ein Posten; die Zahl dahinter sagt, wie viele es sind.
        Die Startzeiten stammen vom letzten Start, nicht aus einem Mittel.
      </p>
    }
  `,
})
export class LeistungSeite implements OnDestroy {
  private readonly http = inject(HttpClient)

  readonly lage = signal<Leistungslage | null>(null)
  readonly fehler = signal('')
  readonly laedt = signal(false)
  readonly live = signal(false)
  private uhr: ReturnType<typeof setInterval> | null = null

  /** Die Posten samt „Übrige" — der Rest wird genannt, nicht weggelassen. */
  readonly alle = computed<Posten[]>(() => {
    const l = this.lage()
    if (!l) return []
    return l.rest ? [...l.gruppen, l.rest] : l.gruppen
  })

  private readonly groesster = computed(() => Math.max(1, ...this.alle().map((p) => p.speicher)))

  readonly speicherText = speicherText
  readonly dauerText = dauerText

  constructor() {
    void this.holen()
  }

  anteil(kb: number): number {
    return Math.max(1, Math.round((100 * kb) / this.groesster()))
  }

  /**
   * Der Anteil AM GANZEN — die Zahl, die der gestapelte Balken braucht.
   *
   * NICHT `anteil()`: Das misst am GRÖSSTEN Posten und ergibt in der Summe
   * weit mehr als 100 %. Beim gestapelten Balken müssen sich die Felder
   * genau zur Breite ergänzen, sonst läuft der letzte hinaus.
   *
   * OHNE MINDESTBREITE, anders als bei den Einzelbalken: ein Posten mit
   * 0,2 % bekäme sonst dieselbe sichtbare Breite wie einer mit 2 %, und in
   * der Summe schöben die Aufrundungen den Balken über den Rand. Die kleinen
   * Posten stehen ohnehin in der Legende mit ihrer Zahl.
   */
  stapelAnteil(kb: number): number {
    const g = this.lage()?.gesamtKb ?? 0
    return g > 0 ? (100 * kb) / g : 0
  }

  startAnteil(s: number | null): number {
    const l = this.lage()
    const g = (l?.start.kernel ?? 0) + (l?.start.userland ?? 0)
    return g > 0 ? Math.round((100 * (s ?? 0)) / g) : 0
  }

  bremsAnteil(s: number): number {
    const l = this.lage()
    const g = l?.bremser[0]?.sekunden ?? 1
    return Math.max(1, Math.round((100 * s) / g))
  }

  /**
   * Das rechte Ende der Zeitachse.
   *
   * DER SPAETESTE BALKEN, nicht die Gesamt-Startzeit: Die Achse soll die
   * Dienste zeigen, die dastehen — endete sie erst bei `start.gesamt`, bliebe
   * rechts ein leerer Streifen, und alle Balken würden gestaucht.
   */
  achsenEnde(): number {
    const b = this.lage()?.zeitachse ?? []
    return Math.max(1, ...b.map((x) => x.bis))
  }

  /** Beschriftungen: ganze Sekunden, höchstens sechs — sonst wird es Brei. */
  achsenMarken(): number[] {
    const e = this.achsenEnde()
    const schritt = Math.max(1, Math.ceil(e / 6))
    const aus: number[] = []
    for (let s = 0; s < e; s += schritt) aus.push(s)
    return aus
  }

  /**
   * Wie breit der Balken eines Dienstes ist.
   *
   * MINDESTENS EIN PROZENT: Ein Dienst, der in 20 ms fertig ist, hätte sonst
   * die Breite null und verschwände — dabei ist gerade die Aussage „der war
   * sofort da" die halbe Information einer Zeitachse.
   */
  breiteVon(b: Balken): number {
    return Math.max(1, (100 * (b.bis - b.von)) / this.achsenEnde())
  }

  /** Der Takt der Live-Ansicht in Sekunden — im Knopf genannt, nicht versteckt. */
  readonly TAKT_S = 5

  liveUmschalten(): void {
    if (this.live()) {
      this.liveAus()
      return
    }
    this.live.set(true)
    // `setInterval` UND NICHT `setTimeout` in der Antwort: ein Abruf, der
    // hängt, soll den nächsten nicht endlos verschieben — und einer, der
    // scheitert, den Takt nicht abreißen lassen.
    this.uhr = setInterval(() => void this.holen(), this.TAKT_S * 1000)
  }

  private liveAus(): void {
    this.live.set(false)
    if (this.uhr !== null) {
      clearInterval(this.uhr)
      this.uhr = null
    }
  }

  /**
   * BEIM VERLASSEN AUSSCHALTEN — sonst misst die Box weiter, während niemand
   * hinsieht. Eine Seite, die nach dem Wegklicken alle fünf Sekunden 150
   * Dateien liest, ist genau die Art Last, die man später nirgends findet.
   */
  ngOnDestroy(): void {
    this.liveAus()
  }

  /**
   * Einmal messen — auf Knopfdruck und beim Aufschlagen.
   *
   * KEIN TAKT: Der Server liest für diese Antwort rund 150 Dateien unter
   * /proc. Im Sekundentakt zu wiederholen hieße, genau die Zahl zu
   * verändern, die man misst. Wer neu sehen will, drückt den Knopf.
   */
  async holen(): Promise<void> {
    this.laedt.set(true)
    this.fehler.set('')
    try {
      // RELATIVER PFAD WIE ALLE ANDEREN SEITEN (system.dienst.ts: '/api/system').
      // Die Verwaltung wird vom selben Server ausgeliefert, der sie beantwortet;
      // eine Adresse mit Host waere beim ersten Zugriff ueber einen anderen
      // Namen falsch — und genau dann sucht niemand hier.
      const l = await firstValueFrom(this.http.get<Leistungslage>('/api/leistung'))
      this.lage.set(l)
    } catch {
      // NICHT „Fehler", SONDERN WAS ZU TUN IST: Eine ältere Box kennt den Weg
      // noch nicht, und das ist kein Defekt.
      this.fehler.set(
        'Die Box hat die Leistungsdaten nicht geliefert. Entweder ist ihr Server älter als diese Seite, oder er antwortet gerade nicht.',
      )
    } finally {
      this.laedt.set(false)
    }
  }
}
