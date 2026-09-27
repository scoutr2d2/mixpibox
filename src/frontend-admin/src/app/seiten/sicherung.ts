/**
 * SICHERN UND ZURUECKSPIELEN — ohne SSH, am Bildschirm.
 *
 * DIE SEITE, DIE AUS „UNWIEDERBRINGLICH" EIN „AERGERLICH" MACHT.
 *
 * Alles, was auf den anderen Seiten dieser Verwaltung schiefgehen kann, ist
 * nur deshalb eine Sackgasse, weil es keinen Rueckweg gab: das Werkzeug
 * (`scripts/mupibox/mupibox-sicherung.py`) war vollstaendig, aber nur ueber
 * SSH erreichbar — und wer eine Kinderbox betreibt, hat kein SSH. Diese Seite
 * ist der Knopf davor.
 *
 * DREI ENTSCHEIDUNGEN, DIE MAN DER SEITE ANSEHEN SOLL:
 *
 * 1. DER DOWNLOAD IST DER PUNKT, NICHT DIE DATEI AUF DER BOX. Ein Stand, der
 *    nur auf derselben SD-Karte liegt, rettet vor einem falschen Handgriff —
 *    nicht vor der muede gewordenen Karte, dem haeufigsten Tod eines Pi. Also
 *    geht die Sicherung in den Browser. Und WOVOR DAS NICHT SCHUETZT steht
 *    daneben, nicht in einer Fussnote: die Saetze kommen aus der API
 *    (`ablageHinweise`) und werden hier NICHT abgeschrieben — zwei Fassungen
 *    desselben Satzes laufen auseinander, und die, die niemand liest,
 *    veraltet zuerst.
 *
 * 2. DAS PASSWORT VERLAESST DIESE KOMPONENTE NUR IM KOERPER EINER ANFRAGE.
 *    Es steht in einem gewoehnlichen Feld, das der Browser selbst haelt; es
 *    wird beim Absenden EINMAL ausgelesen, mitgeschickt und danach geleert.
 *    Was hier ABSICHTLICH FEHLT und fehlen muss:
 *      * kein `ngModel`, kein Signal, kein `[value]` — sonst stuende der Wert
 *        in einem Attribut im DOM, und jede Erweiterung, jedes Bildschirmfoto
 *        des DOM-Baums und jeder Fehlerbericht truege ihn mit.
 *      * kein `localStorage`, kein `sessionStorage`, kein Cookie — ein
 *        Passwort, das einen Neustart des Browsers ueberlebt, ist kein
 *        Passwort mehr.
 *      * kein `console.log` irgendeiner Antwort — die Konsole ist ein
 *        Protokoll, das mitgeschickt wird, wenn jemand um Hilfe bittet.
 *      * keine Adresse mit Geheimnis. Deshalb ist auch der DOWNLOAD ein POST
 *        mit `fetch` und einem Objekt-URL statt eines schlichten Verweises.
 *    `tools/sicherung-ohne-ssh-ring.ts` (Ring 9) sucht in genau dieser Datei
 *    nach jedem dieser Muster. Wer eines einbaut, sieht es als roten Schritt.
 *
 * 3. VOR DEM ZURUECKSPIELEN STEHEN ZAHLEN, NICHT „DATEN WERDEN ERSETZT".
 *    Die Vorschau ist ein eigener Schritt und ein eigener Aufruf; erst danach
 *    gibt es einen Knopf, der wirklich schreibt. Er traegt die Kennung aus der
 *    Vorschau mit sich — es kann also nie ein anderer Stand eingespielt
 *    werden als der, ueber dem die Zahlen standen.
 *
 * WAS DIESE SEITE NICHT KANN und auch nicht koennen soll: `--trotzdem`. Der
 * Schalter uebergeht die Pruefungen, die eine unbrauchbare Box verhindern.
 * Am Bildschirm waere er der Knopf, den man drueckt, weil der andere nicht
 * ging — und danach kommt niemand mehr in die Verwaltung. Die API reicht ihn
 * ausdruecklich nicht durch (src/backend-api/src/sicherung.ts, Frage 3).
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core'
import { firstValueFrom } from 'rxjs'

interface StandZeile {
  name: string
  erzeugt?: string
  grund?: string
  dateien?: number
  zugangsdaten?: number
  bytes?: number
  fehler?: string
}

/**
 * WAS AUF DIESER BOX IN KEINE SICHERUNG GEHT.
 *
 * `null`, solange nichts anliegt — und das ist der Normalfall. Eine Warnung,
 * die bei jeder Sicherung erscheint, ist nach dreimal unsichtbar; diese hier
 * erscheint nur, wenn eine Ablage auf der Box weder auf der Liste zum
 * Mitnehmen noch auf der zum Auslassen steht. Bewusst Ausgelassenes
 * (Schluesselmaterial, Zwischenspeicher, Altlasten) kommt hier NIE an.
 */
interface NichtEingeordnet {
  stand: string
  erzeugt: string
  pfade: string[]
  satz: string
  rat: string[]
}

interface Lage {
  ok: boolean
  werkzeugDa: boolean
  lesbar: boolean
  host: string
  anmeldungOffen: boolean
  ablageHinweise: string[]
  passwortMin: number
  maxBytes: number
  staende: StandZeile[]
  meldung: string
  nichtEingeordnet: NichtEingeordnet | null
}

interface Feld {
  datei: string
  zeiger: string
  warum: string
}

interface Plan {
  aendert: { ziel: string; bytes: number }[]
  unveraendert: { ziel: string; bytes: number }[]
  uebersprungen: string[]
  /** Stellen, an denen auf DIESER Box ein Verweis liegt — sie bleiben stehen.
   *  Das ist die einzige Zeile im Plan, an der etwas aus dem Stand NICHT
   *  ankommt; sie gehoert deshalb sichtbar hin und nicht ins Protokoll. */
  verweisZiele: string[]
  eingespielt: string[]
  behaelt: string[]
  vonHand: string[]
  verschluesseltLiegenGeblieben: string[]
  anmerkungen: string[]
}

interface Vorschau {
  ok: boolean
  kennung: string
  stand: {
    erzeugt: string
    grund: string
    host: string
    format: number
    dateien: number
    bytes: number
    zugangsdaten: Feld[]
    /** Was dieser Stand nie enthielt. `pfade` leer = nichts zu melden. */
    nichtEingeordnet: { pfade: string[]; satz: string; rat: string[] }
  }
  warnungen: string[]
  plan: Plan
  satz: string
  zeilen: string[]
}

interface Fertig {
  ok: boolean
  satz: string
  plan: Plan
  vorherStand: string | null
  vonHand: string[]
  neustartNoetig: boolean
}

@Component({
  selector: 'mupi-sicherung',
  standalone: true,
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
    .karte.warnend { border-color: var(--warnung, #e0a33a); }
    .karte.ernst { border-color: var(--schlecht, #d4553f); }
    h2 { font-size: 1.05rem; margin: 0 0 0.2rem; }
    .karte > p { margin: 0.3rem 0 0.9rem; color: var(--gedaempft); font-size: 0.92rem; }
    ul { margin: 0.4rem 0 0.9rem; padding-left: 1.2rem; }
    li { margin: 0.25rem 0; font-size: 0.9rem; }
    ul.pfade li { font-family: ui-monospace, monospace; font-size: 0.82rem; word-break: break-all; }
    button {
      background: var(--leit, #3b7ddd); color: #fff; border: 0; border-radius: 8px;
      padding: 0.55rem 1rem; font-size: 0.95rem; cursor: pointer;
    }
    button.still { background: transparent; color: var(--leit, #3b7ddd); border: 1px solid var(--rand, #24313f); }
    button.ernst { background: var(--schlecht, #d4553f); }
    button[disabled] { opacity: 0.5; cursor: default; }
    .knoepfe { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center; }
    label.an { display: flex; align-items: center; gap: 0.5rem; margin: 0.9rem 0 0.4rem; font-size: 0.94rem; }
    input[type='password'], input[type='file'] {
      background: var(--eingabe, #0e1720); border: 1px solid var(--rand, #24313f);
      border-radius: 8px; color: inherit; padding: 0.5rem 0.6rem; font-size: 0.95rem;
      width: 100%; max-width: 26rem; box-sizing: border-box;
    }
    .zahlen { display: flex; gap: 1.6rem; flex-wrap: wrap; margin: 0.8rem 0; }
    .zahlen div { display: flex; flex-direction: column; }
    .zahlen span { color: var(--gedaempft); font-size: 0.78rem; }
    .zahlen b { font-size: 1.5rem; font-variant-numeric: tabular-nums; }
    .zahlen b.achtung { color: var(--warnung, #e0a33a); }
    .satz { font-size: 1.02rem; margin: 0.4rem 0 0.6rem; }
    .warnzeile {
      border-left: 3px solid var(--warnung, #e0a33a); padding: 0.35rem 0 0.35rem 0.7rem;
      margin: 0.5rem 0; font-size: 0.92rem;
    }
    .fehlzeile { border-left-color: var(--schlecht, #d4553f); }
    table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    th, td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--rand, #24313f); }
    th { color: var(--gedaempft); font-weight: 600; font-size: 0.8rem; }
    td.zahl { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    details { margin-top: 0.7rem; }
    summary { cursor: pointer; color: var(--gedaempft); font-size: 0.88rem; }
    pre {
      background: var(--eingabe, #0e1720); border-radius: 8px; padding: 0.7rem;
      overflow-x: auto; font-size: 0.8rem; margin: 0.5rem 0 0;
    }
  `,
  template: `
    <h1>Sichern und Zurückspielen</h1>
    <p class="unter">
      Eine Sicherung ist der Rückweg aus jedem Fehlgriff auf allen anderen Seiten.
      Sie können sie hier anlegen, herunterladen und wieder einspielen — ohne
      zweites Gerät und ohne Kommandozeile.
    </p>

    @if (lage(); as l) {
      @if (!l.werkzeugDa) {
        <div class="karte ernst">
          <h2>Das Sicherungswerkzeug fehlt auf dieser Box</h2>
          <p>
            Ohne <code>mupibox-sicherung.py</code> geht von dieser Seite nichts. Es kommt mit
            jedem Update mit; ein Update über „Aktualisierung“ bringt es zurück.
          </p>
        </div>
      }

      @if (l.anmeldungOffen) {
        <!-- DIE ENTSCHEIDUNG AUS sicherung.ts, FRAGE 4, sichtbar gemacht.
             Kein zweites Schloss (das wäre die nächste Sackgasse), sondern ein
             ausgesprochener Hinweis: aus einem stillen Risiko wird ein
             sichtbares. -->
        <div class="karte warnend">
          <h2>Die Anmeldung dieser Verwaltung ist ausgeschaltet</h2>
          <p>
            Damit kann <b>jeder im Heimnetz</b> diese Sicherung anlegen, herunterladen und
            zurückspielen. Ihre Zugangsdaten sind auch dann geschützt — sie gehen nur
            verschlüsselt mit, und ohne Ihr Passwort ist die Datei ein Klumpen. Alles andere
            (Bibliothek, Einstellungen) steht offen. Der Schalter dafür heißt
            „Anmeldung für die Verwaltung“ auf der Seite <b>Konfiguration</b>.
          </p>
        </div>
      }

      <!-- ══ DIE WARNUNG, DIE NIEMAND GEHÖRT HAT ══════════════════════
           Sie stand immer schon da — auf der Standardausgabe von
           mupibox-sicherung.py, das niemand mehr von Hand aufruft. Genau so
           ist server/config/profile.json aus jeder Sicherung gefallen: die
           Datei, die sagt, DASS es die Kinder gibt.

           SIE STEHT HIER OBEN und nicht unter dem grünen Erfolgssatz. Nach
           dem Klick ist der Mensch zufrieden und liest nicht zu Ende; beim
           Zurückspielen ist es zu spät. Hier steht sie, bevor irgendein Knopf
           gedrückt wurde — und nur dann, wenn wirklich etwas herausfällt. -->
      @if (l.nichtEingeordnet; as n) {
        <div class="karte ernst">
          <h2>{{ n.satz }}</h2>
          <ul class="pfade">
            @for (p of n.pfade; track p) {
              <li>{{ p }}</li>
            }
          </ul>
          @for (r of n.rat; track r) {
            <p>{{ r }}</p>
          }
          <p class="unter" style="margin-bottom: 0">
            Festgestellt beim Stand vom {{ zeit(n.erzeugt) }} ({{ n.stand }}).
          </p>
        </div>
      }

      <!-- ══ Sichern ══════════════════════════════════════════════════ -->
      <div class="karte">
        <h2>Jetzt sichern und herunterladen</h2>
        <p>
          Die Box legt einen Stand an und schickt ihn in Ihren Download-Ordner. Der Stand
          bleibt zusätzlich auf der Box liegen.
        </p>

        <label class="an">
          <input
            type="checkbox"
            [checked]="mitZugangsdaten()"
            (change)="mitZugangsdaten.set($any($event.target).checked)"
          />
          Zugangsdaten mitnehmen (Spotify, WLAN, Verwaltungspasswort) — verschlüsselt
        </label>

        @if (mitZugangsdaten()) {
          <p>
            Die Zugangsdaten gehen dann in einem eigenen, mit diesem Passwort verschlüsselten
            Behälter mit. <b>Es steht nirgends</b> — nicht auf der Box, nicht in der Datei.
            Wer es verliert, bekommt trotzdem alles andere zurück; nur WLAN und die
            Musikdienste müssen dann neu eingegeben werden. Mindestens
            {{ l.passwortMin }} Zeichen.
          </p>
          <input
            #pwAnlegen
            type="password"
            autocomplete="new-password"
            placeholder="Passwort für die Zugangsdaten"
            (keyup.enter)="sichern()"
          />
        }

        <div class="knoepfe" style="margin-top: 0.9rem">
          <button [disabled]="laeuft() !== ''" (click)="sichern()">
            {{ laeuft() === 'sichern' ? 'Die Box sichert …' : 'Sichern und herunterladen' }}
          </button>
        </div>

        @if (sicherFehler()) {
          <div class="warnzeile fehlzeile">{{ sicherFehler() }}</div>
        }
        @if (sicherGut()) {
          <div class="warnzeile">{{ sicherGut() }}</div>
        }

        <!-- WOVOR DIESE ABLAGE NICHT SCHÜTZT. Kommt aus der API, damit der
             Wortlaut EINEN Besitzer hat. -->
        <details open>
          <summary>Wovor eine heruntergeladene Sicherung <b>nicht</b> schützt</summary>
          <ul>
            @for (h of l.ablageHinweise; track h) {
              <li>{{ h }}</li>
            }
          </ul>
        </details>
      </div>

      <!-- ══ Stände auf der Box ═══════════════════════════════════════ -->
      <div class="karte">
        <h2>Stände auf der Box</h2>
        <p>
          Die Box sichert auch von selbst — vor jedem Update und wenn sich die Konfiguration
          ändert. Diese Stände können Sie hier herunterladen.
        </p>
        @if (!l.lesbar) {
          <div class="warnzeile fehlzeile">Die Liste ließ sich nicht lesen: {{ l.meldung }}</div>
        } @else if (l.staende.length === 0) {
          <p>Es liegt noch kein Stand auf der Box. Der Knopf oben legt den ersten an.</p>
        } @else {
          <table>
            <thead>
              <tr>
                <th>Zeitpunkt</th>
                <th>Anlass</th>
                <th class="zahl">Dateien</th>
                <th class="zahl">Größe</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (s of l.staende; track s.name) {
                <tr>
                  <td>{{ zeit(s.erzeugt) }}</td>
                  <td>
                    {{ s.grund || '—' }}
                    @if (s.zugangsdaten) {
                      <span class="unter"> · {{ s.zugangsdaten }} Zugangsdaten verschlüsselt</span>
                    }
                  </td>
                  <td class="zahl">{{ s.dateien ?? '—' }}</td>
                  <td class="zahl">{{ groesse(s.bytes) }}</td>
                  <td class="zahl">
                    <button class="still" (click)="standHolen(s.name)">Herunterladen</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>

      <!-- ══ Zurückspielen ════════════════════════════════════════════ -->
      <div class="karte">
        <h2>Eine Sicherung zurückspielen</h2>
        <p>
          Wählen Sie die heruntergeladene Datei. Es passiert zunächst <b>nichts</b> — Sie
          bekommen erst zu sehen, was geschehen würde.
        </p>
        <input
          #datei
          type="file"
          accept=".gz,.tar.gz,application/gzip"
          (change)="pruefen()"
        />

        @if (pruefFehler()) {
          <div class="warnzeile fehlzeile">{{ pruefFehler() }}</div>
        }
        @if (laeuft() === 'pruefen') {
          <p>Die Box sieht sich die Datei an …</p>
        }
      </div>

      @if (vorschau(); as v) {
        <div class="karte warnend">
          <h2>Das würde passieren</h2>
          <p class="satz">{{ v.satz }}</p>

          <div class="zahlen">
            <div>
              <span>werden überschrieben</span>
              <b>{{ v.plan.aendert.length }}</b>
            </div>
            <div>
              <span>stehen schon genau so da</span>
              <b>{{ v.plan.unveraendert.length }}</b>
            </div>
            <div>
              <span>müssen Sie danach neu eingeben</span>
              <b [class.achtung]="v.plan.vonHand.length > 0">{{ v.plan.vonHand.length }}</b>
            </div>
            <div>
              <span>Stand vom</span>
              <b style="font-size: 1rem">{{ zeit(v.stand.erzeugt) }}</b>
            </div>
          </div>

          @for (w of v.warnungen; track w) {
            <div class="warnzeile">{{ w }}</div>
          }

          @if (v.stand.zugangsdaten.length) {
            <label class="an">
              <input
                type="checkbox"
                [checked]="zurueckMitZugangsdaten()"
                (change)="zurueckMitZugangsdaten.set($any($event.target).checked)"
              />
              Die {{ v.stand.zugangsdaten.length }} verschlüsselten Zugangsdaten mit einspielen
            </label>
            @if (zurueckMitZugangsdaten()) {
              <p>
                Dafür brauchen Sie das Passwort, mit dem <b>dieser</b> Stand angelegt wurde.
                Ein falsches Passwort bricht ab, bevor irgendetwas geschrieben wird.
              </p>
              <input
                #pwZurueck
                type="password"
                autocomplete="off"
                placeholder="Passwort dieses Standes"
              />
            } @else {
              <p>
                Ohne Passwort bleiben diese Felder verschlüsselt liegen. Ihre jetzigen Werte
                auf der Box bleiben dann unangetastet — es geht nichts verloren.
              </p>
            }
            <ul>
              @for (f of v.stand.zugangsdaten; track f.zeiger + f.datei) {
                <li>{{ f.warum }}</li>
              }
            </ul>
          }

          @if (v.plan.vonHand.length) {
            <div class="warnzeile fehlzeile">
              Diese Angaben sind weder in der Sicherung noch auf der Box und müssen danach neu
              eingegeben werden:
              <ul>
                @for (h of v.plan.vonHand; track h) {
                  <li>{{ h }}</li>
                }
              </ul>
            </div>
          }

          @for (a of v.plan.anmerkungen; track a) {
            <div class="warnzeile">{{ a }}</div>
          }

          <!-- WAS DIESER STAND NIE ENTHIELT. Zu spät, um es zu ändern — aber
               nicht zu spät, um es zu wissen: wer ihn auf eine neu
               aufgesetzte Box spielt, bekommt genau diese Stellen nicht
               wieder. Steht nur da, wenn die Liste etwas enthält. -->
          @if (v.stand.nichtEingeordnet.pfade.length) {
            <div class="warnzeile fehlzeile">
              {{ v.stand.nichtEingeordnet.satz }}
              <ul class="pfade">
                @for (p of v.stand.nichtEingeordnet.pfade; track p) {
                  <li>{{ p }}</li>
                }
              </ul>
              @for (r of v.stand.nichtEingeordnet.rat; track r) {
                <p>{{ r }}</p>
              }
            </div>
          }

          <details>
            <summary>Welche Dateien genau ({{ v.plan.aendert.length }} + {{ v.plan.unveraendert.length }})</summary>
            <ul class="pfade">
              @for (d of v.plan.aendert; track d.ziel) {
                <li>wird überschrieben: {{ d.ziel }} ({{ groesse(d.bytes) }})</li>
              }
              @for (d of v.plan.unveraendert; track d.ziel) {
                <li>unverändert: {{ d.ziel }}</li>
              }
              @for (d of v.plan.uebersprungen; track d) {
                <li>übersprungen (kein Ziel auf dieser Box): {{ d }}</li>
              }
              @for (d of v.plan.verweisZiele; track d) {
                <li>bleibt stehen (dort liegt auf dieser Box ein Verweis): {{ d }}</li>
              }
            </ul>
          </details>

          @if (v.plan.verweisZiele.length) {
            <div class="warnzeile">
              An {{ v.plan.verweisZiele.length === 1 ? 'einer Stelle' : v.plan.verweisZiele.length + ' Stellen' }}
              liegt auf dieser Box ein Verweis und im Stand eine Datei. Dort wird
              <b>nichts</b> überschrieben — sonst ginge dabei der Bestand des Kindes verloren,
              das gerade an der Box ist. Was dort steht, bleibt so, wie es jetzt ist.
            </div>
          }

          <p>
            Die Box legt <b>vorher</b> von sich aus einen Stand des jetzigen Zustands an. Auch
            dieser Schritt hat also einen Rückweg.
          </p>

          <div class="knoepfe">
            <button class="ernst" [disabled]="laeuft() !== ''" (click)="zurueckspielen()">
              {{ laeuft() === 'zurueck' ? 'Die Box spielt zurück …' : 'Jetzt zurückspielen' }}
            </button>
            <button class="still" [disabled]="laeuft() !== ''" (click)="abbrechen()">Abbrechen</button>
          </div>

          @if (zurueckFehler()) {
            <div class="warnzeile fehlzeile">{{ zurueckFehler() }}</div>
          }
        </div>
      }

      @if (fertig(); as f) {
        <div class="karte">
          <h2>Zurückgespielt</h2>
          <p class="satz">{{ f.satz }}</p>
          @if (f.vorherStand) {
            <p>
              Der Zustand von eben liegt als Stand
              <code>{{ f.vorherStand }}</code> auf der Box — falls Sie es sich anders überlegen.
            </p>
          }
          @if (f.vonHand.length) {
            <div class="warnzeile fehlzeile">
              Diese Angaben müssen Sie noch von Hand eingeben:
              <ul>
                @for (h of f.vonHand; track h) {
                  <li>{{ h }}</li>
                }
              </ul>
            </div>
          }
          @if (f.neustartNoetig) {
            <p>
              Damit alles greift, starten Sie die Box neu — der Knopf dafür steht auf der Seite
              <b>System</b>.
            </p>
          }
          <details>
            <summary>Der ganze Bericht der Box</summary>
            <pre>{{ bericht() }}</pre>
          </details>
        </div>
      }
    } @else {
      <p class="unter">wird geladen …</p>
    }
  `,
})
export class SicherungSeite {
  private readonly http = inject(HttpClient)

  readonly lage = signal<Lage | null>(null)
  readonly vorschau = signal<Vorschau | null>(null)
  readonly fertig = signal<Fertig | null>(null)
  readonly bericht = signal('')
  readonly laeuft = signal<'' | 'sichern' | 'pruefen' | 'zurueck'>('')
  readonly mitZugangsdaten = signal(false)
  readonly zurueckMitZugangsdaten = signal(false)
  readonly sicherFehler = signal('')
  readonly sicherGut = signal('')
  readonly pruefFehler = signal('')
  readonly zurueckFehler = signal('')

  /**
   * DIE PASSWORTFELDER SIND ELEMENTE, KEINE SIGNALE — und das ist der Kern
   * von Entscheidung 2 im Kopfkommentar.
   *
   * Ein Signal, das in die Vorlage gebunden ist, macht aus dem Passwort einen
   * Wert, den Angular in den DOM schreibt. Ein `ElementRef` dagegen liest den
   * Wert genau einmal — beim Absenden — und raeumt ihn danach weg. Der
   * Browser haelt ihn bis dahin dort, wo er ihn ohnehin haelt: in der
   * Eingabe, nicht in einem Attribut.
   */
  private readonly pwAnlegen = viewChild<ElementRef<HTMLInputElement>>('pwAnlegen')
  private readonly pwZurueck = viewChild<ElementRef<HTMLInputElement>>('pwZurueck')
  private readonly datei = viewChild<ElementRef<HTMLInputElement>>('datei')

  constructor() {
    void this.lageLaden()
  }

  private async lageLaden(): Promise<void> {
    try {
      this.lage.set(await firstValueFrom(this.http.get<Lage>('/api/sicherung')))
    } catch {
      this.lage.set({
        ok: false,
        werkzeugDa: false,
        lesbar: false,
        host: '',
        anmeldungOffen: false,
        ablageHinweise: [],
        passwortMin: 8,
        maxBytes: 0,
        staende: [],
        meldung: 'Die Box antwortet nicht.',
        nichtEingeordnet: null,
      })
    }
  }

  /** Das Passwortfeld auslesen UND leeren. Beides in einem Zug, damit es
   *  keinen Weg gibt, das eine ohne das andere zu tun. */
  private passwortNehmen(feld: ElementRef<HTMLInputElement> | undefined): string {
    const e = feld?.nativeElement
    if (!e) return ''
    const wert = e.value
    e.value = ''
    return wert
  }

  /* ── Sichern ─────────────────────────────────────────────────────────── */

  async sichern(): Promise<void> {
    if (this.laeuft()) return
    this.sicherFehler.set('')
    this.sicherGut.set('')
    const mit = this.mitZugangsdaten()
    const passwort = mit ? this.passwortNehmen(this.pwAnlegen()) : ''
    if (mit && !passwort) {
      this.sicherFehler.set('Ohne Passwort können die Zugangsdaten nicht mitgehen.')
      return
    }
    this.laeuft.set('sichern')
    try {
      // POST statt eines Verweises: ein Passwort gehört nie in eine Adresse.
      // fetch statt HttpClient, weil hier BYTES kommen und der Browser sie
      // ohne Umweg als Blob halten kann.
      const a = await fetch('/api/sicherung/anlegen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mit ? { mitZugangsdaten: true, passwort } : {}),
      })
      if (!a.ok) {
        const j = (await a.json().catch(() => ({}))) as { fehler?: string }
        this.sicherFehler.set(j.fehler || 'Die Box konnte keinen Stand anlegen.')
        return
      }
      const blob = await a.blob()
      const name = dateinameAus(a.headers.get('Content-Disposition')) || 'mupibox-sicherung.tar.gz'
      ablegen(blob, name)
      const dateien = a.headers.get('X-Mupi-Dateien') ?? '?'
      const zug = Number(a.headers.get('X-Mupi-Zugangsdaten') ?? '0')
      // DIE ZAHL, DIE DEN GRÜNEN SATZ EINSCHRÄNKT. Sie kommt als Kopfzeile,
      // weil der Rumpf dieser Antwort die Archivbytes SIND — dieselbe Enge,
      // an der die Warnung des Werkzeugs bisher verendet ist. Steht hier
      // etwas, ist „liegt in Ihrem Download-Ordner“ allein eine zu gute
      // Nachricht; die Pfade dazu stehen in der roten Karte oben, die das
      // anschließende Neuladen der Lage hervorholt.
      const nichtEingeordnet = Number(a.headers.get('X-Mupi-Nicht-Eingeordnet') ?? '0')
      this.sicherGut.set(
        `${name} liegt jetzt in Ihrem Download-Ordner — ${dateien} Dateien` +
          (zug ? `, dazu ${zug} Zugangsdaten verschlüsselt.` : '.') +
          (nichtEingeordnet
            ? ` Aber ${nichtEingeordnet === 1 ? 'eine Ablage der Box ist NICHT dabei' : nichtEingeordnet + ' Ablagen der Box sind NICHT dabei'} — siehe die rote Karte oben.`
            : ''),
      )
      this.mitZugangsdaten.set(false)
      await this.lageLaden()
    } catch {
      this.sicherFehler.set('Die Box hat nicht geantwortet. Es wurde nichts heruntergeladen.')
    } finally {
      this.laeuft.set('')
    }
  }

  async standHolen(name: string): Promise<void> {
    // Ein GET ohne Geheimnis — hier ist ein schlichter Weg richtig.
    const a = await fetch(`/api/sicherung/stand/${encodeURIComponent(name)}`)
    if (!a.ok) {
      this.sicherFehler.set('Dieser Stand ließ sich nicht herunterladen.')
      return
    }
    ablegen(await a.blob(), dateinameAus(a.headers.get('Content-Disposition')) || name)
  }

  /* ── Zurückspielen, Schritt 1 ────────────────────────────────────────── */

  async pruefen(): Promise<void> {
    const eingabe = this.datei()?.nativeElement
    const f = eingabe?.files?.[0]
    this.pruefFehler.set('')
    this.zurueckFehler.set('')
    this.vorschau.set(null)
    this.fertig.set(null)
    if (!f) return
    const grenze = this.lage()?.maxBytes ?? 0
    if (grenze && f.size > grenze) {
      this.pruefFehler.set(
        `Diese Datei ist ${Math.round(f.size / 1024)} kB groß — eine MixPiBox-Sicherung ist viel kleiner. Vermutlich ist es die falsche Datei.`,
      )
      return
    }
    this.laeuft.set('pruefen')
    try {
      const a = await fetch('/api/sicherung/pruefen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/gzip' },
        body: await f.arrayBuffer(),
      })
      const j = (await a.json().catch(() => ({}))) as Vorschau & { fehler?: string }
      if (!a.ok || !j.ok) {
        this.pruefFehler.set(j.fehler || 'Die Datei ließ sich nicht prüfen.')
        return
      }
      this.zurueckMitZugangsdaten.set(false)
      this.vorschau.set(j)
    } catch {
      this.pruefFehler.set('Die Box hat nicht geantwortet. Es wurde nichts verändert.')
    } finally {
      this.laeuft.set('')
    }
  }

  /* ── Zurückspielen, Schritt 2 ────────────────────────────────────────── */

  async zurueckspielen(): Promise<void> {
    const v = this.vorschau()
    if (!v || this.laeuft()) return
    this.zurueckFehler.set('')
    const mit = this.zurueckMitZugangsdaten()
    const passwort = mit ? this.passwortNehmen(this.pwZurueck()) : ''
    if (mit && !passwort) {
      this.zurueckFehler.set('Ohne Passwort lassen sich die Zugangsdaten nicht einspielen.')
      return
    }
    this.laeuft.set('zurueck')
    try {
      const a = await fetch('/api/sicherung/zurueckspielen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Die KENNUNG aus der Vorschau geht mit: es kann nie ein anderer
        // Stand eingespielt werden als der, über dem die Zahlen standen.
        body: JSON.stringify(mit ? { kennung: v.kennung, mitZugangsdaten: true, passwort } : { kennung: v.kennung }),
      })
      const j = (await a.json().catch(() => ({}))) as Fertig & {
        fehler?: string
        zeilen?: string[]
        geschrieben?: number
      }
      if (!a.ok || !j.ok) {
        // HIER STAND „— es wurde nichts geschrieben.", UND ZWAR IMMER.
        //
        // Das war die haeufige Wahrheit als Behauptung ueber jeden Fall. Wird
        // der Vorgang MITTEN in der Schreibschleife abgebrochen (Frist,
        // Absturz, Stromausfall), steht die Box halb alt und halb neu da —
        // gemessen am 07.08.2026 im Sandkasten. Wer dann liest, es sei nichts
        // geschrieben worden, sucht den Stand „vorher" nicht, und der ist das
        // einzige, was hier noch hilft.
        //
        // Die Box sagt es jetzt selbst: `fehler` traegt den Befund, `geschrieben`
        // die Zahl. Die Seite schreibt nichts mehr dazu — ein zweiter Satz an
        // dieser Stelle koennte dem ersten nur widersprechen.
        this.zurueckFehler.set(j.fehler || 'Es hat nicht geklappt.')
        return
      }
      this.bericht.set((j.zeilen ?? []).join('\n'))
      this.fertig.set(j)
      this.vorschau.set(null)
      const eingabe = this.datei()?.nativeElement
      if (eingabe) eingabe.value = ''
      await this.lageLaden()
    } catch {
      this.zurueckFehler.set('Die Box hat nicht geantwortet.')
    } finally {
      this.laeuft.set('')
    }
  }

  abbrechen(): void {
    this.vorschau.set(null)
    this.zurueckFehler.set('')
    const eingabe = this.datei()?.nativeElement
    if (eingabe) eingabe.value = ''
    this.passwortNehmen(this.pwZurueck())
  }

  /* ── Anzeige ─────────────────────────────────────────────────────────── */

  zeit(iso?: string): string {
    if (!iso) return '—'
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
  }

  groesse(b?: number): string {
    if (!b && b !== 0) return '—'
    if (b < 1024) return `${b} B`
    if (b < 1024 * 1024) return `${Math.round(b / 1024)} kB`
    return `${(b / 1024 / 1024).toFixed(1)} MB`
  }
}

/** Den Dateinamen aus der Content-Disposition holen. */
function dateinameAus(kopf: string | null): string {
  const m = /filename="([^"]+)"/.exec(kopf ?? '')
  return m?.[1] ?? ''
}

/**
 * Einen Blob im Download-Ordner ablegen.
 *
 * Der Objekt-URL wird sofort wieder freigegeben: er zeigt sonst bis zum
 * Neuladen der Seite auf die vollstaendige Konfiguration der Box im Speicher
 * des Browsers.
 */
function ablegen(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
