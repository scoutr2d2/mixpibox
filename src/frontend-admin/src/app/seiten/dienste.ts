/**
 * Die Seite „Systemdienste".
 *
 * SIE HIESS BIS ZUM 03.08.2026 NUR „DIENSTE" — und das ging nicht mehr, seit
 * es daneben „Streaming-Dienste" gibt. Zwei Menüpunkte, die beide „Dienste"
 * heißen und völlig Verschiedenes zeigen (systemd-Units hier, Musikquellen
 * dort), sind kein Ordnungsproblem, sondern ein Fehlgriff, den man täglich
 * macht. Der WEG bleibt `/dienste`: ein Lesezeichen soll nicht zerbrechen,
 * nur weil eine Überschrift genauer geworden ist.
 *
 * Zwei Dinge, die die alte PHP-Seite vermischt hat, sind hier getrennt — weil
 * sie verschiedene Fragen beantworten:
 *   LÄUFT GERADE   (start/stop)    — wirkt sofort, gilt bis zum Neustart
 *   STARTET MIT    (enable/disable) — wirkt erst beim nächsten Hochfahren
 * Wer das verwechselt, schaltet etwas aus und wundert sich, dass es nach dem
 * Einschalten wieder da ist.
 *
 * Dienste, die systemd als "static" führt, bekommen KEINEN Startschalter: er
 * würde nichts bewirken. Ein Schalter, der nichts tut, ist schlimmer als
 * keiner.
 *
 * UND SEIT DEM 03.08.2026 ZWEI ABSCHNITTE. Abgelöste Dienste standen bisher
 * mitten zwischen den laufenden und sahen dort aus wie Wahlmöglichkeiten.
 * Sie stehen jetzt unten, mit der Angabe WOVON sie abgelöst sind. Was
 * lediglich AUS ist (mupi_vnc, mupi_fan, mupi_telegram), bleibt oben — das ist
 * eine Wahl, keine Vergangenheit. Die Einstufung trifft das Backend, damit sie
 * einen Ort und einen Beleg hat.
 *
 * UND SEIT DEM 07.08.2026 SIEHT DER ENDGÜLTIGE SCHALTER AUCH ENDGÜLTIG AUS.
 * Bis dahin war es genau andersherum: `mupibox-server.service` — der eine
 * Prozess, der die Verwaltung, die API UND das Bild auf dem Schirm der Box
 * ausliefert — stand hier als ganz normale Zeile, mit demselben Häkchen wie
 * der Lüfter. Wer es wegnahm, sperrte sich aus; nur nicht sofort, sondern
 * beim nächsten Stromausfall, und dazwischen lagen Tage. Der harmlose Knopf
 * („Anhalten", zurücknehmbar über einen Stromausfall) sah dabei gefährlicher
 * aus als das endgültige Häkchen.
 *
 * DREI DINGE ÄNDERN DAS, und keines davon nimmt jemandem etwas weg:
 *   1. An der Zeile steht, was ohne diesen Dienst am Gerät nicht mehr geht —
 *      VOR dem Klick, getrennt nach „Anhalten" und „Vom Start nehmen".
 *   2. Wo es keinen Weg zurück gibt, steht kein Häkchen mehr, sondern ein
 *      benannter Knopf mit Kante.
 *   3. Der Server fragt zurück (409) und schickt Text und Bestätigungswort
 *      mit. Diese Seite denkt sich die Rückfrage nicht aus — sie zeigt, was
 *      der Server sagt. Eine Warnung, die nur im Browser steht, wäre keine,
 *      sobald jemand die Route direkt ruft.
 * Verboten wird nichts. Es ist seine Box.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { type Aktion, type Dienst, DiensteDienst } from '../dienste.dienst'

@Component({
  selector: 'mupi-dienste',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    h1 { font-size: 1.3rem; margin: 0 0 0.35rem; }
    h2 { font-size: 1.02rem; margin: 2rem 0 0.3rem; }
    p.unter { color: var(--gedaempft); margin: 0 0 1.5rem; font-size: 0.94rem; }
    p.abschnitt { color: var(--gedaempft); margin: 0 0 0.8rem; font-size: 0.88rem; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.6rem; }
    li {
      background: var(--flaeche); border: 1px solid var(--rand); border-radius: 12px;
      padding: 0.9rem 1rem; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;
    }
    li.kaputt { border-color: var(--fehler); }
    /* Der Abgelöst-Abschnitt tritt zurück: er ist Auskunft, keine Aufgabe. */
    li.alt { opacity: 0.72; }
    .wer { flex: 1 1 14rem; min-width: 0; }
    .titel { font-weight: 500; }
    .technisch { color: var(--gedaempft); font-size: 0.8rem; font-family: ui-monospace, monospace; }
    .abgeloest, .anmerkung { color: var(--gedaempft); font-size: 0.82rem; margin-top: 0.3rem; }
    .schild {
      font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em;
      border: 1px solid var(--rand); border-radius: 999px; padding: 0.1rem 0.45rem;
      margin-right: 0.35rem;
    }

    /* ── Tragweite ────────────────────────────────────────────────────────
       Der Unterschied, um den es geht, ist SICHTBAR gemacht: was zurücknehmbar
       ist, steht gedämpft da; was endgültig ist, bekommt Farbe, eine Kante und
       das Wort „kein Weg zurück". Bis heute war es umgekehrt herum — der
       endgültige Schalter (das Häkchen) sah harmloser aus als der harmlose
       Knopf (Anhalten). */
    .folgen { display: grid; gap: 0.25rem; margin-top: 0.45rem; }
    .folge { font-size: 0.82rem; color: var(--gedaempft); }
    .folge .wozu {
      font-weight: 600; color: var(--schrift); margin-right: 0.3rem; white-space: nowrap;
    }
    .folge.schwer {
      color: var(--fehler);
      border-left: 3px solid var(--fehler);
      padding: 0.3rem 0 0.3rem 0.55rem;
      background: color-mix(in srgb, var(--fehler) 8%, transparent);
      border-radius: 0 6px 6px 0;
    }
    .folge.schwer .wozu { color: var(--fehler); }
    .folge .zurueck { display: block; margin-top: 0.15rem; opacity: 0.9; }

    /* Statt eines Häkchens ein benannter Knopf mit Kante: er sagt, was er tut,
       und er sieht nicht aus wie eine Einstellung, die man mal eben umlegt. */
    .endgueltig {
      border: 1px solid var(--fehler); color: var(--fehler); background: transparent;
      padding: 0.4rem 0.7rem; font-size: 0.84rem; border-radius: 8px;
    }

    /* Die Rückfrage steht IN der Zeile, nicht in einem Fenster über der Seite:
       so bleibt sichtbar, um welchen Dienst es geht. */
    .nachfrage {
      flex: 1 1 100%; margin-top: 0.6rem; padding: 0.85rem 0.95rem;
      border: 1px solid var(--fehler); border-radius: 10px;
      background: color-mix(in srgb, var(--fehler) 10%, transparent);
    }
    .nachfrage h3 { margin: 0 0 0.4rem; font-size: 0.95rem; color: var(--fehler); }
    .nachfrage p { margin: 0 0 0.5rem; font-size: 0.88rem; }
    .nachfrage .knoepfe { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.7rem; }
    .nachfrage .trotzdem { border: 1px solid var(--fehler); color: var(--fehler); background: transparent; }
    .lampe { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.86rem; }
    .punkt { width: 0.6rem; height: 0.6rem; border-radius: 50%; background: var(--gedaempft); }
    .punkt.an { background: var(--gut); }
    .punkt.kaputt { background: var(--fehler); }
    .schalter { display: flex; gap: 0.4rem; flex-wrap: wrap; }
    .schalter button { padding: 0.45rem 0.8rem; font-size: 0.88rem; }
    .start { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.86rem; color: var(--gedaempft); }
    .meldung { padding: 0.75rem 0.9rem; border-radius: 10px; margin-bottom: 1rem; font-size: 0.9rem; }
    .meldung.fehler { background: color-mix(in srgb, var(--fehler) 18%, transparent); color: var(--fehler); }
    .meldung.hinweis { background: color-mix(in srgb, var(--warn) 15%, transparent); color: var(--warn); }
    .leer { color: var(--gedaempft); }
  `,
  template: `
    <h1>Systemdienste</h1>
    <p class="unter">
      Die Hintergrunddienste der Box (systemd) — nicht die Musikquellen, die stehen
      unter „Streaming-Dienste".
      <strong>Anhalten</strong> wirkt sofort und gilt bis zum nächsten Hochfahren —
      ein Stromausfall holt den Dienst zurück.
      <strong>Vom Start nehmen</strong> sieht dagegen so aus, als passiere nichts,
      und wirkt erst beim nächsten Hochfahren. Das ist der weitreichendere der
      beiden; wo er die Box unbedienbar macht, steht es an der Zeile.
    </p>

    @if (fehler(); as f) {
      <div class="meldung fehler">{{ f }}</div>
    }
    @if (hinweis(); as h) {
      <div class="meldung hinweis">{{ h }}</div>
    }

    @if (laedt()) {
      <p class="leer">Einen Moment…</p>
    } @else if (dienste().length === 0) {
      <p class="leer">Keine Dienste gefunden.</p>
    } @else {
      <ul>
        @for (d of laufende(); track d.name) {
          <li [class.kaputt]="d.zustand === 'failed'">
            <div class="wer">
              <div class="titel">{{ d.titel }}</div>
              <div class="technisch">{{ d.name }}</div>
              <!-- Auskunft OHNE Urteil. pulseaudio steht hier und nicht unten:
                   auf dem Pi 4 ist es der aktive Tonweg. -->
              @if (d.hinweis) {
                <div class="anmerkung">{{ d.hinweis }}</div>
              }

              <!-- WAS MAN VERLIERT, STEHT AN DER ZEILE — nicht erst nach dem
                   Klick. Eine Warnung nach der Tat ist eine Meldung.
                   „Anhalten" bekommt nur den Satz, was wegfällt: dass es
                   zurücknehmbar ist, steht oben im Vorspann und gilt für alle.
                   „startet mit" bekommt bei „kein Weg zurück" AUCH den
                   Rückweg-Satz — das ist dort die eigentliche Auskunft. -->
              @if (d.tragweite; as t) {
                <div class="folgen">
                  @if (t.anhalten.stufe !== 'normal') {
                    <div class="folge" [class.schwer]="t.anhalten.stufe === 'kein-rueckweg'">
                      <span class="wozu">Anhalten:</span> {{ t.anhalten.verliert }}
                      @if (t.anhalten.stufe === 'kein-rueckweg') {
                        <span class="zurueck">{{ t.anhalten.rueckweg }}</span>
                      }
                    </div>
                  }
                  @if (t.startetMit.stufe !== 'normal') {
                    <div class="folge" [class.schwer]="t.startetMit.stufe === 'kein-rueckweg'">
                      @if (t.startetMit.stufe === 'kein-rueckweg') {
                        <span class="schild">kein Weg zurück</span>
                      }
                      <span class="wozu">Vom Start nehmen:</span> {{ t.startetMit.verliert }}
                      @if (t.startetMit.stufe === 'kein-rueckweg') {
                        <span class="zurueck">{{ t.startetMit.rueckweg }}</span>
                      }
                    </div>
                  }
                </div>
              }
            </div>

            <span class="lampe">
              <span
                class="punkt"
                [class.an]="d.aktiv"
                [class.kaputt]="d.zustand === 'failed'"
              ></span>
              {{ d.zustand === 'failed' ? 'gestört' : d.aktiv ? 'läuft' : 'aus' }}
            </span>

            <!-- DAS HÄKCHEN IST DER ENDGÜLTIGE SCHALTER — und sah bisher aus
                 wie eine Einstellung, die man mal eben umlegt. Wo das Wegnehmen
                 die Box unbedienbar macht, steht deshalb KEIN Häkchen mehr,
                 sondern ein benannter Knopf mit Kante, der eine Rückfrage
                 öffnet. Das EINSCHALTEN bleibt ein Häkchen: da kommt man immer
                 zurück, indem man es wieder auszieht. -->
            @if (d.eingeschaltet && endgueltig(d)) {
              <span class="start">
                <button
                  type="button"
                  class="endgueltig"
                  [disabled]="beschaeftigt() === d.name"
                  (click)="schalten(d, 'disable')"
                >
                  Vom Start nehmen…
                </button>
              </span>
            } @else {
              <label class="start">
                @if (d.eingeschaltet === null) {
                  <span title="Dieser Dienst lässt sich nicht abschalten.">fest</span>
                } @else {
                  <input
                    type="checkbox"
                    [checked]="d.eingeschaltet"
                    [disabled]="beschaeftigt() === d.name"
                    (change)="schalten(d, d.eingeschaltet ? 'disable' : 'enable')"
                  />
                  startet mit
                }
              </label>
            }

            <span class="schalter">
              @if (d.aktiv) {
                <button
                  type="button"
                  class="still"
                  [disabled]="beschaeftigt() === d.name"
                  (click)="schalten(d, 'stop')"
                >
                  Anhalten
                </button>
                <button
                  type="button"
                  class="still"
                  [disabled]="beschaeftigt() === d.name"
                  (click)="schalten(d, 'restart')"
                >
                  Neu starten
                </button>
              } @else {
                <button
                  type="button"
                  [disabled]="beschaeftigt() === d.name"
                  (click)="schalten(d, 'start')"
                >
                  Starten
                </button>
              }
            </span>

            <!-- DIE RÜCKFRAGE KOMMT VOM SERVER, nicht von hier: der 409 bringt
                 Text und Bestätigungswort mit. Damit ist ausgeschlossen, dass
                 die Seite eine Sperre vortäuscht, die es nicht gibt — oder
                 schweigt, wo der Server sperrt. -->
            @if (frage(); as f) {
              @if (f.name === d.name) {
                <div class="nachfrage" role="alertdialog" aria-labelledby="nachfrage-titel">
                  <h3 id="nachfrage-titel">Kein Weg zurück — an der Box selbst</h3>
                  <p>{{ f.verliert }}</p>
                  <p><strong>Zurück:</strong> {{ f.rueckweg }}</p>
                  <p>Es ist bisher nichts geändert worden.</p>
                  <div class="knoepfe">
                    <button type="button" (click)="abbrechen()">Doch nicht</button>
                    <button
                      type="button"
                      class="trotzdem"
                      [disabled]="beschaeftigt() === d.name"
                      (click)="trotzdem()"
                    >
                      Trotzdem vom Start nehmen
                    </button>
                  </div>
                </div>
              }
            }
          </li>
        }
      </ul>

      <!-- ABGELÖST heißt NICHT weg: die Einträge bleiben, weil einer als
           Rückfall taugt und einer nachinstalliert werden könnte. Ein eigener
           Abschnitt sagt, was Sache ist, ohne die Wahl zu nehmen. -->
      @if (abgeloeste().length > 0) {
        <h2>Abgelöst</h2>
        <p class="abschnitt">
          Für diese gibt es etwas Neueres, das dasselbe tut. Sie bleiben bedienbar —
          als Rückfall. Was hier NICHT steht: Dienste, die auf dieser Box nur
          ausgeschaltet sind. Das ist eine Wahl und keine Vergangenheit.
        </p>
        <ul>
          @for (d of abgeloeste(); track d.name) {
            <li class="alt">
              <div class="wer">
                <div class="titel">{{ d.titel }}</div>
                <div class="technisch">{{ d.name }}</div>
                @if (d.abgeloest) {
                  <div class="abgeloest"><span class="schild">abgelöst</span>{{ d.abgeloest }}</div>
                }
              </div>

              <span class="lampe">
                <span
                  class="punkt"
                  [class.an]="d.aktiv"
                  [class.kaputt]="d.zustand === 'failed'"
                ></span>
                {{ d.zustand === 'failed' ? 'gestört' : d.aktiv ? 'läuft' : 'aus' }}
              </span>

              <label class="start">
                @if (d.eingeschaltet === null) {
                  <span title="Dieser Dienst lässt sich nicht abschalten.">fest</span>
                } @else {
                  <input
                    type="checkbox"
                    [checked]="d.eingeschaltet"
                    [disabled]="beschaeftigt() === d.name"
                    (change)="schalten(d, d.eingeschaltet ? 'disable' : 'enable')"
                  />
                  startet mit
                }
              </label>

              <span class="schalter">
                @if (d.aktiv) {
                  <button
                    type="button"
                    class="still"
                    [disabled]="beschaeftigt() === d.name"
                    (click)="schalten(d, 'stop')"
                  >
                    Anhalten
                  </button>
                } @else {
                  <button
                    type="button"
                    class="still"
                    [disabled]="beschaeftigt() === d.name"
                    (click)="schalten(d, 'start')"
                  >
                    Trotzdem starten
                  </button>
                }
              </span>
            </li>
          }
        </ul>
      }
    }
  `,
})
export class DiensteSeite {
  private readonly api = inject(DiensteDienst)

  readonly dienste = signal<Dienst[]>([])
  readonly laedt = signal(true)
  readonly fehler = signal('')
  readonly hinweis = signal('')
  /** Name des Dienstes, an dem gerade gearbeitet wird (sperrt nur DESSEN Knöpfe). */
  readonly beschaeftigt = signal('')

  /**
   * Die zwei Abschnitte.
   *
   * Die Einstufung kommt vom Backend (`abschnitt`); fehlt sie — etwa weil ein
   * älterer Server antwortet —, gilt „normal". Ein Dienst darf nie deshalb
   * verschwinden, weil ein Feld fehlt.
   */
  readonly laufende = computed(() => this.dienste().filter((d) => d.abschnitt !== 'abgeloest'))
  readonly abgeloeste = computed(() => this.dienste().filter((d) => d.abschnitt === 'abgeloest'))

  /**
   * Die offene Rückfrage — Name des Dienstes, Aktion, Text und Wort.
   *
   * Sie steht bewusst NICHT als Feld am Dienst: eine Rückfrage ist ein
   * Zwischenzustand der Bedienung, kein Merkmal des Dienstes. Und es kann
   * immer nur eine offen sein.
   */
  readonly frage = signal<
    { name: string; aktion: Aktion; verliert: string; rueckweg: string; wort: string } | null
  >(null)

  /**
   * Bekommt dieser Dienst statt des Häkchens einen benannten Knopf?
   *
   * Genau dann, wenn das Wegnehmen von „startet mit" laut Server keinen Weg
   * zurück am Gerät lässt. Die Liste dieser Dienste steht NICHT hier — sie
   * kommt mit den Daten; hier steht nur, wie sie aussieht.
   */
  endgueltig(d: Dienst): boolean {
    return d.tragweite?.startetMit.stufe === 'kein-rueckweg'
  }

  constructor() {
    void this.laden()
  }

  private async laden(): Promise<void> {
    this.laedt.set(true)
    try {
      const a = await this.api.liste()
      this.dienste.set(a.dienste)
      // Das Backend meldet einen Grund statt eines 500ers, wenn es kein
      // systemd gibt (Entwicklungsrechner) — den zeigen wir ehrlich an.
      this.hinweis.set(a.fehler ? `Dienste nicht lesbar: ${a.fehler}` : '')
    } catch {
      this.fehler.set('Die Liste der Dienste konnte nicht geladen werden.')
    } finally {
      this.laedt.set(false)
    }
  }

  async schalten(d: Dienst, aktion: Aktion, wort?: string): Promise<void> {
    if (this.beschaeftigt()) return
    this.beschaeftigt.set(d.name)
    this.fehler.set('')
    const e = await this.api.schalten(d.name, aktion, wort)
    this.beschaeftigt.set('')
    if (e.ok) {
      this.frage.set(null)
      this.dienste.set(e.dienste)
      return
    }
    // Der Server hat NICHT geschaltet, sondern gefragt. Das ist kein Fehler —
    // und darf deshalb auch nicht in der roten Meldung landen.
    if (e.nachfrage) {
      this.frage.set({
        name: d.name,
        aktion,
        verliert: e.nachfrage.verliert,
        rueckweg: e.nachfrage.rueckweg,
        wort: e.nachfrage.bestaetigung,
      })
      return
    }
    this.frage.set(null)
    this.fehler.set(`${d.titel}: ${e.grund}`)
    // Nach einem Fehlschlag den echten Stand holen, statt die Anzeige raten
    // zu lassen — vielleicht hat die Aktion halb gewirkt.
    void this.laden()
  }

  /** „Doch nicht" — es ist ohnehin nichts geschehen. */
  abbrechen(): void {
    this.frage.set(null)
  }

  /**
   * Der zweite Schritt: dieselbe Bedienung, diesmal mit dem Wort des Servers.
   *
   * Das Wort wird DURCHGEREICHT, nicht nachgebaut. Stünde die Regel, wie es
   * lautet, auch hier, hätte die Sperre zwei Formulierungen — und eine davon
   * veraltet.
   */
  async trotzdem(): Promise<void> {
    const f = this.frage()
    if (!f) return
    const d = this.dienste().find((x) => x.name === f.name)
    if (!d) {
      this.frage.set(null)
      return
    }
    await this.schalten(d, f.aktion, f.wort)
  }
}
