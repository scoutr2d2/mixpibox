/**
 * Die MuPiHAT-Seite — der Akku hat sein eigenes Zuhause.
 *
 * WOFÜR: der MuPiHAT ist mehr als ein Symbol in der Ecke. Er lädt, er misst,
 * er schaltet die Box bei leerem Pack ab — und all das war bisher nirgends zu
 * sehen. Wer wissen will, ob die Box den Nachmittag durchhält oder ob der Akku
 * altert, braucht die KURVE, nicht den Momentwert.
 *
 * DIE GRAFIK ist der Akku-Anzeige eines Telefons nachempfunden: der Ladestand
 * über der Zeit, Ladephasen farbig hinterlegt. Sie ist bewusst ein reines,
 * selbst gezeichnetes SVG — eine Diagramm-Bibliothek für eine einzige Kurve
 * wäre ein halbes Megabyte, das jedes Mal über das WLAN der Box geht.
 *
 * WAS SIE NICHT KANN, und warum das so ist: der BQ25792 ist ein Laderegler mit
 * ADC, KEIN Fuel-Gauge — er zählt keine Ladungsmenge, er misst Spannung und
 * Strom. Jeder Prozentwert ist daher aus der Entladekurve abgeleitet, und im
 * flachen Mittelteil einer Li-Ion-Zelle (3,90–3,50 V je Zelle, immerhin 60 %
 * der Kapazität) ist er entsprechend unscharf. Deshalb steht die gemessene
 * SPANNUNG gleichberechtigt daneben: sie ist die einzige Größe, die wirklich
 * gemessen wurde.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { firstValueFrom } from 'rxjs'

interface Punkt {
  t: number
  v: number
  i: number
  p: number
}

/**
 * Eine Zeile des Protokolls — bewusst NICHT derselbe Typ wie `Punkt`.
 * Die Kurve rechnet mit jedem Feld; hier darf fast alles fehlen, weil ein
 * Register auch mal nicht lesbar ist.
 */
interface ProtZeile {
  t: number
  vbus?: number
  ibus?: number
  ibat?: number
  quelle?: string
  regs?: Record<string, string>
}

interface Abschnitt {
  art: 'laden' | 'entladen' | 'ruhe'
  von: number
  bis: number
  vonProzent: number
  bisProzent: number
  mA: number
}

interface Befund {
  was: string
  wert: string
  gewicht: 'ok' | 'hinweis' | 'warnung' | 'fehler'
  bedeutung?: string
}

interface Led {
  name: string
  funktion: string
  zustaende: readonly string[]
  hinweis?: string
}

interface RevEintrag {
  stand: string
  datum: string
  aenderungen: readonly string[]
  pd: string
}

interface Diagnose {
  lesbar: boolean
  hinweisOhneZugriff: string | null
  befunde: Befund[]
  revision: Befund[]
  leds: Led[]
  revisionen: RevEintrag[]
}

interface Gelernt {
  rMilliOhm: number | null
  rPaare: number
  kapazitaetMah: number | null
  kapazitaetHub: number
  ladungMah: number
  stand: 'nichts' | 'wenig' | 'brauchbar'
}

interface Verlauf {
  punkte: Punkt[]
  abschnitte: Abschnitt[]
  jetzt: Punkt | null
  restMinuten: number | null
  kapazitaetMah: number | null
  kapazitaetAufkleber: number | null
  gelernt: Gelernt | null
  stunden: number
  gesamt: number
}

interface Stand {
  Vbat?: number
  Ibat?: number
  Vbus?: number
  Temp?: number
  Bat_SOC?: string
  Bat_SOC_fein?: number
  Bat_Stat?: string
  Bat_Type?: string
  Charger_Status?: string
  BatteryConnected?: number
}

/** Maße des Diagramms in Benutzereinheiten des SVG. */
const B = 900
const H = 260
const RAND = { links: 44, rechts: 12, oben: 12, unten: 28 }

@Component({
  selector: 'mupi-mupihat-seite',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>MuPiHAT</h1>
    <p class="hinweis">
      Ladeteil und Akku der mobilen Box. Die Werte kommen vom Ladebaustein BQ25792 auf
      der Platine.
    </p>

    @if (fehler()) {
      <p class="fehler">{{ fehler() }}</p>
    }

    @if (stand(); as s) {
      @if (s.BatteryConnected === 1) {
        <section class="kacheln">
          <div class="kachel gross">
            <span class="wert">{{ prozent() !== null ? prozent() + '%' : '–' }}</span>
            <span class="was">Ladestand</span>
          </div>
          <div class="kachel">
            <span class="wert">{{ volt(s.Vbat) }}</span>
            <span class="was">Spannung (gemessen)</span>
          </div>
          <div class="kachel">
            <span class="wert" [class.laedt]="laedt()">{{ strom(s.Ibat) }}</span>
            <span class="was">{{ laedt() ? 'Ladestrom' : 'Verbrauch' }}</span>
          </div>
          <div class="kachel">
            <span class="wert">{{ watt() }}</span>
            <span class="was">Leistung</span>
          </div>
          <div class="kachel">
            <span class="wert">{{ restZeit() }}</span>
            <span class="was">{{ laedt() ? 'bis voll' : 'Restzeit' }}</span>
          </div>
          <div class="kachel">
            <span class="wert">{{ s.Temp !== undefined ? s.Temp + ' °C' : '–' }}</span>
            <span class="was">Temperatur</span>
          </div>
        </section>

        <p class="profil">
          Akkuprofil: <strong>{{ s.Bat_Type || 'unbekannt' }}</strong>
          @if (verlauf()?.kapazitaetMah) {
            · {{ verlauf()!.kapazitaetMah }} mAh
          }
          · Zustand {{ s.Bat_Stat || '?' }} · {{ s.Charger_Status || '?' }}
        </p>

        <section class="grafik">
          <div class="kopf">
            <h2>Lade- und Entladekurve</h2>
            <div class="spannen">
              @for (o of SPANNEN; track o.h) {
                <button type="button" [class.hier]="stunden() === o.h" (click)="spanneWaehlen(o.h)">
                  {{ o.text }}
                </button>
              }
            </div>
          </div>

          @if (kurve().length < 2) {
            <p class="hinweis">
              Noch zu wenig aufgezeichnet. Die Box misst jede Minute; nach etwa einer
              Viertelstunde wird die Kurve aussagekräftig.
            </p>
          } @else {
            <svg [attr.viewBox]="'0 0 ' + B + ' ' + H" class="diagramm" role="img"
                 [attr.aria-label]="'Ladestand der letzten ' + stunden() + ' Stunden'">
              <!-- Ladephasen hinterlegen: so sieht man auf einen Blick, ob ein
                   Anstieg vom Kabel kam oder nur eine Messschwankung war. -->
              @for (a of ladeBaender(); track a.x) {
                <rect [attr.x]="a.x" [attr.y]="RAND.oben" [attr.width]="a.breite"
                      [attr.height]="H - RAND.oben - RAND.unten" class="band" />
              }
              <!-- Waagerechte Hilfslinien bei 0/25/50/75/100 % -->
              @for (l of linien(); track l.p) {
                <line [attr.x1]="RAND.links" [attr.x2]="B - RAND.rechts"
                      [attr.y1]="l.y" [attr.y2]="l.y" class="gitter" />
                <text [attr.x]="RAND.links - 8" [attr.y]="l.y + 4" class="achse">{{ l.p }}%</text>
              }
              <path [attr.d]="flaeche()" class="fuellung" />
              <path [attr.d]="pfad()" class="linie" />
              <!-- Erste und letzte Marke am Rand AUSRICHTEN, nicht zentrieren:
                   zentriert ragt die letzte ueber den Rand des Bildes hinaus
                   und wird abgeschnitten (am Bildschirm gesehen). -->
              @for (z of zeiten(); track z.x) {
                <text [attr.x]="z.x" [attr.y]="H - 8" class="achse"
                      [attr.text-anchor]="z.rand">{{ z.text }}</text>
              }
            </svg>

            <p class="legende">
              <span class="marke band"></span> am Ladegerät
              <span class="marke linie"></span> Ladestand
              · {{ kurve().length }} von {{ verlauf()?.gesamt || 0 }} Punkten
            </p>
          }
        </section>

        <!-- WELCHER PACK VERBAUT IST, entscheidet der Mensch — und bis zum
             15.08.2026 KONNTE er es hier nicht: die Wahl lag nur in der
             rohen Konfigurationsdatei. So stand die Box auf „USB-C mode"
             (Kurve aus Einsen), der Ladestand klebte bei 50 %, und der
             Kapazitaets-Lerner mass 3040 mAh an einem neuen 10-Ah-Pack. -->
        <section class="batterie">
          <h2>Batterie</h2>
          @if (batterie(); as b) {
            <div class="batterie-zeile">
              <label for="bat-profil">Verbauter Pack</label>
              <select id="bat-profil" (change)="batterieWaehlen($any($event.target).value)">
                @for (n of b.auswahl; track n) {
                  <option [value]="n" [selected]="b.gewaehlt === n">{{ n }}</option>
                }
              </select>
              <label for="bat-mah">laut Aufkleber</label>
              <input
                id="bat-mah"
                type="number"
                min="100"
                max="100000"
                step="100"
                [value]="b.kapazitaetEingetragen ?? ''"
                [placeholder]="b.kapazitaetMah ?? '–'"
                (change)="batterieKapazitaet($any($event.target).value)"
              />
              <span>mAh</span>
            </div>
            <p class="hinweis">
              Das Profil bestimmt die Spannungskurve (Ladestand) und die
              Abschaltschwellen; die Aufkleber-Zahl ist der Startwert, bis die
              Box die Kapazität selbst gemessen hat (leer = aus dem
              Profilnamen). „USB-C mode" heißt: keine Batterie — Ladestand und
              Kapazitätsmessung sind dann ohne Aussage.
            </p>
          } @else {
            <p class="hinweis">Die Batterie-Einstellung ließ sich nicht laden.</p>
          }
        </section>

        <!-- WAS GEMESSEN IST UND WAS ANGENOMMEN. Ohne diese Unterscheidung
             sieht eine geschaetzte Zahl genauso verbindlich aus wie eine
             gemessene, und niemand weiss, worauf er sich verlassen darf. -->
        <section class="gelernt">
          <h2>Was die Box über den Pack gelernt hat</h2>
          @if (verlauf()?.gelernt; as g) {
            <table>
              <tbody>
                <tr>
                  <th>Innenwiderstand</th>
                  <td>
                    @if (g.rMilliOhm !== null) {
                      <strong>{{ g.rMilliOhm }} mΩ</strong>
                      <span class="quelle gemessen">gemessen</span>
                      <span class="klein">aus {{ g.rPaare }} Lastwechseln</span>
                    } @else {
                      70 mΩ <span class="quelle angenommen">angenommen</span>
                      <span class="klein">
                        braucht Lastwechsel — die Box muss zwischendurch spielen und pausieren
                      </span>
                    }
                  </td>
                </tr>
                <tr>
                  <th>Kapazität</th>
                  <td>
                    @if (g.kapazitaetMah !== null) {
                      <strong>{{ g.kapazitaetMah }} mAh</strong>
                      <span class="quelle gemessen">gemessen</span>
                      <span class="klein">
                        über {{ g.kapazitaetHub }} Prozentpunkte
                        @if (verlauf()?.kapazitaetAufkleber) {
                          · auf dem Pack stehen {{ verlauf()!.kapazitaetAufkleber }} mAh
                          ({{ alterung() }})
                        }
                      </span>
                    } @else {
                      {{ verlauf()?.kapazitaetAufkleber || '?' }} mAh
                      <span class="quelle angenommen">vom Aufkleber</span>
                      <span class="klein">
                        braucht eine Entladung über mindestens 20 Prozentpunkte
                      </span>
                    }
                  </td>
                </tr>
                <tr>
                  <th>Gezählte Ladung</th>
                  <td>
                    {{ g.ladungMah }} mAh
                    <span class="klein">
                      seit Beginn der Aufzeichnung bewegt — die Box zählt selbst mit,
                      der Ladebaustein kann das nicht
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p class="hinweis">{{ standText(g.stand) }}</p>
          } @else {
            <p class="hinweis">Noch nichts gelernt.</p>
          }
        </section>

        <!-- DIAGNOSE. Die Ursache des blinkenden Lichts stand in den
             Statusregistern des Ladereglers - und die las niemand. Eine
             Stunde Suche für etwas, das ein Blick beantwortet. -->
        <section class="diagnose">
          <h2>Diagnose</h2>
          @if (diagnose(); as dg) {
            @if (!dg.lesbar) {
              <p class="fehler">{{ dg.hinweisOhneZugriff }}</p>
            } @else {
              <table>
                <tbody>
                  @for (b of dg.befunde; track b.was) {
                    <tr>
                      <th>{{ b.was }}</th>
                      <td>
                        <span class="wertpille {{ b.gewicht }}">{{ b.wert }}</span>
                        @if (b.bedeutung) { <span class="klein">{{ b.bedeutung }}</span> }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }

            <h3>Platinenstand</h3>
            <p class="hinweis">
              Der Stand steht nirgends elektronisch auf der Platine — er lässt sich
              deshalb nicht auslesen, nur eintragen. Was sich messen lässt, steht hier:
            </p>
            <table>
              <tbody>
                @for (b of dg.revision; track b.was) {
                  <tr>
                    <th>{{ b.was }}</th>
                    <td>
                      <span class="wertpille {{ b.gewicht }}">{{ b.wert }}</span>
                      @if (b.bedeutung) { <span class="klein">{{ b.bedeutung }}</span> }
                    </td>
                  </tr>
                }
              </tbody>
            </table>

            <label class="revwahl">
              Mein Platinenstand:
              <select [value]="revision()" (change)="revisionWaehlen($any($event.target).value)">
                <option value="">— nicht eingetragen —</option>
                @for (r of dg.revisionen; track r.stand) {
                  <option [value]="r.stand">{{ r.stand }} ({{ r.datum }})</option>
                }
              </select>
            </label>
            @if (gewaehlt(); as r) {
              <ul class="revliste">
                @for (a of r.aenderungen; track a) { <li>{{ a }}</li> }
              </ul>
            }

            <details class="ledtab">
              <summary>Was die vier LEDs bedeuten (aus dem Datenblatt)</summary>
              <table>
                <tbody>
                  @for (l of dg.leds; track l.name) {
                    <tr>
                      <th>{{ l.name }}</th>
                      <td>
                        <strong>{{ l.funktion }}</strong>
                        @for (z of l.zustaende; track z) { <span class="klein">{{ z }}</span> }
                        @if (l.hinweis) { <span class="klein wichtig">{{ l.hinweis }}</span> }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </details>
          } @else {
            <p class="hinweis">Wird gemessen … (rund zwölf Sekunden — der Fehler zeigt sich nur über die Zeit)</p>
          }
        </section>

        <!-- PROTOKOLL. Register, Spannungen und Ströme über die Zeit, zum
             Herunterladen. Ein Verlauf lässt sich nur als Reihe festhalten -
             ein einzelner Blick zeigt mal das eine, mal das andere. -->
        <section class="protokoll">
          <h2>Protokoll</h2>
          <p class="hinweis">
            Zeichnet Register, Spannungen und Ströme im Sekundentakt auf und lässt sich
            als Datei herunterladen. Ein Einbruch am Eingang dauert rund 15 Sekunden —
            zwei Minuten zeigen ihn mehrfach.
          </p>
          <div class="knoepfe">
            <button type="button" (click)="messen(120)" [disabled]="protLaeuft()">
              {{ protLaeuft() ? 'misst …' : '2 Minuten aufzeichnen' }}
            </button>
            <button type="button" (click)="messen(300)" [disabled]="protLaeuft()">5 Minuten</button>
            <span class="klein">{{ protAnzahl() }} Messungen aufgezeichnet</span>
          </div>
          @if (protAnzahl() > 0) {
            <div class="knoepfe">
              <a [href]="'/api/mupihat/protokoll.pdf?revision=' + revision()" class="knopf">
                PDF (mit Kurve)
              </a>
              <a href="/api/mupihat/protokoll.xlsx" class="knopf">Excel (.xlsx)</a>
              <a href="/api/mupihat/protokoll.csv" class="knopf">CSV</a>
              <a href="/api/mupihat/protokoll.json" class="knopf">JSON</a>
              <button type="button" class="still" (click)="protLoeschen()">Verwerfen</button>
            </div>
            <!-- INTERAKTIV: die Zahlenkolonne zeigt den Einbruch nicht, die
                 Kurve schon. Beim Überfahren steht der genaue Messwert samt
                 Rohregister daneben — damit lässt sich jede Aussage im PDF
                 an der Stelle nachprüfen, an der sie herkommt. -->
            <div class="protgrafik">
              <svg viewBox="0 0 900 230" class="diagramm"
                   (mousemove)="zeigeAuf($event)" (mouseleave)="markiert.set(null)">
                <!-- Bereiche, in denen die Quelle verworfen wurde -->
                @for (b of verworfenBaender(); track b.x) {
                  <rect [attr.x]="b.x" y="10" [attr.width]="b.breite" height="180" class="band-fehler" />
                }
                @for (l of protLinien(); track l.v) {
                  <line x1="46" x2="890" [attr.y1]="l.y" [attr.y2]="l.y" class="gitter" />
                  <text x="40" [attr.y]="l.y + 4" class="achse">{{ l.v }} V</text>
                }
                <!-- VINDPM: darunter nimmt der Regler von selbst zurück -->
                <line x1="46" x2="890" [attr.y1]="protY(4300)" [attr.y2]="protY(4300)" class="schwelle" />
                <text x="893" [attr.y]="protY(4300) + 3" class="achse links">4,3 V</text>
                <path [attr.d]="protPfadStrom()" class="linie-strom" />
                <path [attr.d]="protPfadSpannung()" class="linie-spannung" />
                @if (markiert(); as m) {
                  <line [attr.x1]="m.x" [attr.x2]="m.x" y1="10" y2="190" class="faden" />
                  <circle [attr.cx]="m.x" [attr.cy]="protY(m.z.vbus || 0)" r="3.5" class="punkt" />
                }
              </svg>
              @if (markiert(); as m) {
                <div class="ablesung">
                  <strong>{{ uhrSek(m.z.t) }}</strong>
                  <span>VBUS <b [class.tief]="(m.z.vbus ?? 0) < 4000">{{ m.z.vbus }} mV</b></span>
                  <span>IBUS <b>{{ m.z.ibus }} mA</b></span>
                  <span>IBAT <b>{{ m.z.ibat }} mA</b></span>
                  <span class="q">{{ m.z.quelle }}</span>
                  <span class="reg">0x1C = {{ m.z.regs?.['0x1c'] }}</span>
                </div>
              } @else {
                <p class="klein">Mit der Maus über die Kurve fahren, um die Messwerte abzulesen.</p>
              }
            </div>

            <details>
              <summary>Die Messungen als Tabelle</summary>
              <table class="protab">
                <thead>
                  <tr><th>Zeit</th><th>VBUS</th><th>IBUS</th><th>IBAT</th><th>Quelle</th><th>0x1C</th></tr>
                </thead>
                <tbody>
                  @for (z of protLetzte(); track z.t) {
                    <tr>
                      <td>{{ uhrSek(z.t) }}</td>
                      <td [class.tief]="(z.vbus ?? 0) < 4000">{{ z.vbus }} mV</td>
                      <td>{{ z.ibus }} mA</td>
                      <td>{{ z.ibat }} mA</td>
                      <td>{{ z.quelle }}</td>
                      <td class="reg">{{ z.regs?.['0x1c'] }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </details>
          }
        </section>

        @if (letzteAbschnitte().length) {
          <section>
            <h2>Letzte Phasen</h2>
            <table>
              <thead>
                <tr><th>Art</th><th>Von</th><th>Bis</th><th>Ladestand</th><th>Dauer</th><th>Strom</th></tr>
              </thead>
              <tbody>
                @for (a of letzteAbschnitte(); track a.von) {
                  <tr>
                    <td><span class="pille {{ a.art }}">{{ artText(a.art) }}</span></td>
                    <td>{{ uhr(a.von) }}</td>
                    <td>{{ uhr(a.bis) }}</td>
                    <td>{{ a.vonProzent }}% → {{ a.bisProzent }}%</td>
                    <td>{{ dauer(a.bis - a.von) }}</td>
                    <td>{{ a.mA }} mA</td>
                  </tr>
                }
              </tbody>
            </table>
          </section>
        }
      } @else {
        <p class="hinweis">
          Kein Akku angeschlossen. Die Box läuft am Netzteil — Ladeteil und Kurve
          bleiben deshalb leer.
        </p>
      }
    } @else if (!fehler()) {
      <p class="hinweis">Wird geladen …</p>
    }
  `,
  styles: [
    `
    :host { display: block; }
    .hinweis { color: var(--gedaempft, #8a8a8a); }
    .fehler { color: #c0392b; }

    .kacheln {
      display: grid; gap: 12px; margin: 18px 0;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    }
    .kachel {
      display: flex; flex-direction: column; gap: 2px;
      padding: 12px 14px; border-radius: 10px;
      background: var(--flaeche, #1e1e22);
    }
    .kachel.gross .wert { font-size: 2rem; }
    .wert { font-size: 1.3rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .wert.laedt { color: #2ecc71; }
    .was { font-size: 0.8rem; color: var(--gedaempft, #8a8a8a); }
    .profil { font-size: 0.9rem; color: var(--gedaempft, #8a8a8a); }

    .grafik { margin-top: 24px; }
    .kopf { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .spannen { display: flex; gap: 4px; }
    .spannen button {
      padding: 4px 10px; border-radius: 999px; border: 1px solid var(--rand, #3a3a40);
      background: transparent; color: inherit; cursor: pointer;
    }
    .spannen button.hier { background: var(--betont, #3d7eff); border-color: transparent; color: #fff; }

    .diagramm { width: 100%; height: auto; }
    .gitter { stroke: currentColor; stroke-opacity: 0.15; stroke-width: 1; }
    .achse { fill: currentColor; fill-opacity: 0.55; font-size: 11px; text-anchor: end; }
    .achse.mitte { text-anchor: middle; }
    .band { fill: #2ecc71; fill-opacity: 0.14; }
    .linie { fill: none; stroke: #3d7eff; stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
    .fuellung { fill: #3d7eff; fill-opacity: 0.12; }

    .legende { font-size: 0.85rem; color: var(--gedaempft, #8a8a8a); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .marke { width: 14px; height: 10px; border-radius: 3px; display: inline-block; }
    .marke.band { background: rgba(46, 204, 113, 0.35); }
    .marke.linie { background: #3d7eff; }

    .protokoll { margin-top: 24px; }
    .knoepfe { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 10px 0; }
    .knoepfe button, .knopf {
      padding: 6px 14px; border-radius: 8px; border: 1px solid var(--rand, #3a3a40);
      background: transparent; color: inherit; cursor: pointer; text-decoration: none;
      font: inherit; display: inline-block;
    }
    .knoepfe button:disabled { opacity: 0.5; cursor: default; }
    .knoepfe .still { border-color: transparent; opacity: 0.7; }
    .protgrafik { margin: 10px 0; }
    .band-fehler { fill: #e74c3c; fill-opacity: 0.1; }
    .schwelle { stroke: #e6a23c; stroke-width: 1; stroke-dasharray: 4 3; }
    .linie-spannung { fill: none; stroke: #e74c3c; stroke-width: 1.6; stroke-linejoin: round; }
    .linie-strom { fill: none; stroke: #3d7eff; stroke-width: 1.1; stroke-linejoin: round; }
    .faden { stroke: currentColor; stroke-opacity: 0.5; stroke-width: 1; }
    .punkt { fill: #e74c3c; }
    .achse.links { text-anchor: start; }
    .ablesung {
      display: flex; gap: 14px; flex-wrap: wrap; align-items: baseline;
      padding: 6px 10px; border-radius: 8px; background: var(--flaeche, #1e1e22);
      font-variant-numeric: tabular-nums; font-size: 0.86rem;
    }
    .ablesung b.tief { color: #e74c3c; }
    .ablesung .q { color: var(--gedaempft, #8a8a8a); }
    .ablesung .reg { font-family: ui-monospace, monospace; color: var(--gedaempft, #8a8a8a); }

    .protab { font-size: 0.82rem; }
    .protab td.tief { color: #e74c3c; font-weight: 700; }
    .protab .reg { font-family: ui-monospace, monospace; }

    .diagnose { margin-top: 24px; }
    .diagnose th, .gelernt th { width: 180px; vertical-align: top; }
    /* NICHT .marke nennen (KEINE Backticks in diesem Kommentar - sie beenden
     * das Template-Literal der styles, siehe Wiki): so heisst schon der
     * Farbklecks der Legende
     * unter der Grafik, und der hat eine FESTE Groesse von 14x10 px. Die
     * Diagnose-Pillen erbten die und schrumpften auf ein Quadrat zusammen,
     * waehrend ihr Text daneben Wort fuer Wort umbrach. */
    .wertpille { display: inline-block; padding: 2px 9px; border-radius: 999px; font-weight: 600; }
    .diagnose td, .gelernt td { width: auto; }
    .wertpille.ok { background: rgba(46, 204, 113, 0.2); }
    .wertpille.hinweis { background: rgba(140, 140, 140, 0.2); }
    .wertpille.warnung { background: rgba(230, 180, 60, 0.24); }
    .wertpille.fehler { background: rgba(231, 76, 60, 0.28); color: inherit; }
    .klein.wichtig { color: var(--betont, #7fa8ff); }
    .revwahl { display: block; margin: 12px 0 6px; }
    .revwahl select { margin-left: 8px; padding: 4px 8px; }
    .revliste { margin: 0 0 8px 18px; font-size: 0.9rem; color: var(--gedaempft, #8a8a8a); }
    .ledtab { margin-top: 12px; }
    .ledtab summary { cursor: pointer; }

    .gelernt { margin-top: 24px; }
    .batterie { margin-top: 24px; }
    .batterie-zeile { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
    .batterie-zeile label { font-weight: 500; }
    .batterie-zeile select, .batterie-zeile input {
      font: inherit; padding: 0.4rem 0.55rem; border-radius: 8px;
      border: 1px solid var(--rand); background: var(--grund); color: var(--schrift);
    }
    .batterie-zeile input { width: 7rem; text-align: right; }
    .gelernt th { width: 180px; vertical-align: top; }
    .quelle { font-size: 0.75rem; padding: 1px 7px; border-radius: 999px; margin-left: 6px; }
    .quelle.gemessen { background: rgba(46, 204, 113, 0.22); }
    .quelle.angenommen { background: rgba(230, 180, 60, 0.22); }
    .klein { display: block; font-size: 0.8rem; color: var(--gedaempft, #8a8a8a); margin-top: 2px; }

    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--rand, #3a3a40); font-variant-numeric: tabular-nums; }
    .pille { padding: 2px 8px; border-radius: 999px; font-size: 0.8rem; }
    .pille.laden { background: rgba(46, 204, 113, 0.2); }
    .pille.entladen { background: rgba(61, 126, 255, 0.2); }
    .pille.ruhe { background: rgba(140, 140, 140, 0.2); }
    `,
  ],
})
export class MupihatSeite {
  private readonly http = inject(HttpClient)

  protected readonly B = B
  protected readonly H = H
  protected readonly RAND = RAND
  protected readonly SPANNEN = [
    { h: 6, text: '6 h' },
    { h: 24, text: '1 Tag' },
    { h: 72, text: '3 Tage' },
    { h: 168, text: '1 Woche' },
  ]

  protected readonly stand = signal<Stand | null>(null)
  protected readonly verlauf = signal<Verlauf | null>(null)
  protected readonly stunden = signal(24)
  protected readonly fehler = signal('')

  protected readonly kurve = computed(() => this.verlauf()?.punkte ?? [])

  protected readonly prozent = computed(() => {
    const s = this.stand()
    if (!s) return null
    const fein = Number(s.Bat_SOC_fein)
    if (Number.isFinite(fein)) return Math.round(fein)
    const roh = String(s.Bat_SOC ?? '').replace('%', '').trim()
    return roh.length ? Number(roh) : null
  })

  /** Laden heißt: es fließt Strom IN den Akku. Siehe akku.ts in der Box-Oberfläche. */
  protected readonly laedt = computed(() => Number(this.stand()?.Ibat ?? 0) > 20)

  protected readonly watt = computed(() => {
    const s = this.stand()
    const w = (Math.abs(Number(s?.Ibat ?? 0)) * Number(s?.Vbat ?? 0)) / 1_000_000
    return w > 0.05 ? w.toFixed(1) + ' W' : '–'
  })

  protected readonly restZeit = computed(() => {
    const m = this.verlauf()?.restMinuten
    return typeof m === 'number' ? this.dauer(m * 60_000) : '–'
  })

  protected readonly letzteAbschnitte = computed(() =>
    [...(this.verlauf()?.abschnitte ?? [])].reverse().slice(0, 12),
  )

  /** Die Ladephasen als Balken hinter der Kurve. */
  protected readonly ladeBaender = computed(() => {
    const k = this.kurve()
    if (k.length < 2) return []
    const [t0, t1] = [k[0].t, k[k.length - 1].t]
    const w = B - RAND.links - RAND.rechts
    const x = (t: number) => RAND.links + ((t - t0) / Math.max(1, t1 - t0)) * w
    return (this.verlauf()?.abschnitte ?? [])
      .filter((a) => a.art === 'laden')
      .map((a) => ({ x: x(a.von), breite: Math.max(1, x(a.bis) - x(a.von)) }))
  })

  protected readonly linien = computed(() =>
    [0, 25, 50, 75, 100].map((p) => ({ p, y: this.y(p) })),
  )

  protected readonly zeiten = computed(() => {
    const k = this.kurve()
    if (k.length < 2) return []
    const [t0, t1] = [k[0].t, k[k.length - 1].t]
    const w = B - RAND.links - RAND.rechts
    return [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      x: RAND.links + f * w,
      text: this.uhr(t0 + f * (t1 - t0)),
      rand: f === 0 ? 'start' : f === 1 ? 'end' : 'middle',
    }))
  })

  protected readonly pfad = computed(() => this.linienPfad())
  protected readonly flaeche = computed(() => {
    const p = this.linienPfad()
    if (!p) return ''
    const k = this.kurve()
    const w = B - RAND.links - RAND.rechts
    const [t0, t1] = [k[0].t, k[k.length - 1].t]
    const xEnde = RAND.links + ((k[k.length - 1].t - t0) / Math.max(1, t1 - t0)) * w
    return `${p} L ${xEnde} ${this.y(0)} L ${RAND.links} ${this.y(0)} Z`
  })

  public constructor() {
    void this.laden()
    void this.batterieLaden()
    // Alle 30 s nachziehen. Die Box misst im Minutentakt; öfter zu fragen
    // brächte nichts als Last.
    setInterval(() => void this.laden(), 30_000)
  }

  protected readonly batterie = signal<{
    auswahl: string[]
    gewaehlt: string
    kapazitaetMah: number | null
    kapazitaetEingetragen: number | null
  } | null>(null)

  private async batterieLaden(): Promise<void> {
    try {
      this.batterie.set(
        await firstValueFrom(
          this.http.get<{
            auswahl: string[]
            gewaehlt: string
            kapazitaetMah: number | null
            kapazitaetEingetragen: number | null
          }>('/api/mupihat/batterie'),
        ),
      )
    } catch {
      this.batterie.set(null)
    }
  }

  protected async batterieWaehlen(name: string): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/mupihat/batterie', { name }))
      await this.batterieLaden()
      // Der HAT rechnet ab jetzt mit der neuen Kurve — Anzeige nachziehen.
      void this.laden()
    } catch {
      await this.batterieLaden()
    }
  }

  protected async batterieKapazitaet(wert: string): Promise<void> {
    const z = Math.round(Number(wert) || 0)
    try {
      await firstValueFrom(this.http.post('/api/mupihat/batterie', { kapazitaetMah: z }))
      await this.batterieLaden()
      void this.laden()
    } catch {
      await this.batterieLaden()
    }
  }

  protected spanneWaehlen(h: number): void {
    this.stunden.set(h)
    void this.laden()
  }

  protected readonly diagnose = signal<Diagnose | null>(null)
  protected readonly protLaeuft = signal(false)
  protected readonly protAnzahl = signal(0)
  protected readonly protLetzte = signal<ProtZeile[]>([])

  protected messen(sekunden: number): void {
    this.protLaeuft.set(true)
    firstValueFrom(this.http.post('/api/mupihat/protokoll/messen', { sekunden })).catch(() => {})
    // Waehrend der Messung mitzaehlen, damit man sieht, dass etwas passiert.
    const takt = setInterval(() => void this.protHolen(), 3000)
    setTimeout(
      () => {
        clearInterval(takt)
        this.protLaeuft.set(false)
        void this.protHolen()
      },
      sekunden * 1000 + 2000,
    )
  }

  protected protLoeschen(): void {
    firstValueFrom(this.http.delete('/api/mupihat/protokoll'))
      .then(() => {
        this.protAnzahl.set(0)
        this.protLetzte.set([])
        this.protAlle.set([])
        this.markiert.set(null)
      })
      .catch(() => {})
  }

  /** Alle Messungen in Aufzeichnungsreihenfolge — die Grafik braucht sie so. */
  protected readonly protAlle = signal<ProtZeile[]>([])
  protected readonly markiert = signal<{ x: number; z: ProtZeile } | null>(null)

  private readonly PG = { l: 46, r: 890, o: 10, u: 190 }

  private protMaxV(): number {
    return Math.max(5500, ...this.protAlle().map((z) => z.vbus ?? 0))
  }

  protected protY(mv: number): number {
    const { o, u } = this.PG
    return u - (mv / this.protMaxV()) * (u - o)
  }

  private protX(k: number): number {
    const n = Math.max(1, this.protAlle().length - 1)
    return this.PG.l + (k / n) * (this.PG.r - this.PG.l)
  }

  protected protLinien(): Array<{ v: number; y: number }> {
    const raus: Array<{ v: number; y: number }> = []
    for (let v = 1; v * 1000 < this.protMaxV(); v++) raus.push({ v, y: this.protY(v * 1000) })
    return raus
  }

  protected protPfadSpannung(): string {
    return this.protAlle()
      .map((z, k) => `${k ? 'L' : 'M'} ${this.protX(k).toFixed(1)} ${this.protY(z.vbus ?? 0).toFixed(1)}`)
      .join(' ')
  }

  protected protPfadStrom(): string {
    const max = Math.max(500, ...this.protAlle().map((z) => z.ibus ?? 0))
    const { o, u } = this.PG
    return this.protAlle()
      .map(
        (z, k) =>
          `${k ? 'L' : 'M'} ${this.protX(k).toFixed(1)} ${(u - ((z.ibus ?? 0) / max) * (u - o)).toFixed(1)}`,
      )
      .join(' ')
  }

  /** Die Abschnitte, in denen der Regler die Quelle verworfen hat. */
  protected verworfenBaender(): Array<{ x: number; breite: number }> {
    const raus: Array<{ x: number; breite: number }> = []
    const z = this.protAlle()
    let ab: number | null = null
    const schlecht = (q?: string) => !q || /NICHT ANERKANNT|kein Eingang/.test(q)
    z.forEach((p, k) => {
      if (schlecht(p.quelle) && ab === null) ab = k
      if (!schlecht(p.quelle) && ab !== null) {
        raus.push({ x: this.protX(ab), breite: Math.max(1, this.protX(k) - this.protX(ab)) })
        ab = null
      }
    })
    if (ab !== null) raus.push({ x: this.protX(ab), breite: Math.max(1, this.protX(z.length - 1) - this.protX(ab)) })
    return raus
  }

  protected zeigeAuf(e: MouseEvent): void {
    const ziel = e.currentTarget as SVGSVGElement
    const kasten = ziel.getBoundingClientRect()
    // Von Bildschirm- in SVG-Koordinaten: das viewBox ist 900 breit, das
    // Element ist es nicht. Ohne diese Umrechnung springt das Fadenkreuz.
    const sx = ((e.clientX - kasten.left) / kasten.width) * 900
    const z = this.protAlle()
    if (!z.length) return
    const n = z.length - 1
    const k = Math.round(((sx - this.PG.l) / (this.PG.r - this.PG.l)) * n)
    const i = Math.max(0, Math.min(n, k))
    this.markiert.set({ x: this.protX(i), z: z[i] })
  }

  protected uhrSek(t: number): string {
    return new Date(t).toLocaleTimeString('de-DE')
  }

  private async protHolen(): Promise<void> {
    try {
      const p = await firstValueFrom(
        this.http.get<{ laeuft: boolean; anzahl: number; zeilen: ProtZeile[] }>('/api/mupihat/protokoll'),
      )
      this.protAnzahl.set(p.anzahl)
      this.protLaeuft.set(p.laeuft)
      this.protLetzte.set(p.zeilen.slice(-25).reverse())
      this.protAlle.set(p.zeilen)
    } catch {
      /* still */
    }
  }

  /** Der Platinenstand ist NICHT auslesbar - er wird eingetragen und bleibt. */
  protected readonly revision = signal(localStorage.getItem('mupihat_revision') || '')

  protected readonly gewaehlt = computed(() =>
    this.diagnose()?.revisionen.find((r) => r.stand === this.revision()),
  )

  protected revisionWaehlen(stand: string): void {
    this.revision.set(stand)
    localStorage.setItem('mupihat_revision', stand)
  }

  /** Wie viel vom Neuzustand noch da ist. */
  protected alterung(): string {
    const v = this.verlauf()
    const ist = v?.gelernt?.kapazitaetMah
    const soll = v?.kapazitaetAufkleber
    if (!ist || !soll) return ''
    return Math.round((ist / soll) * 100) + ' % davon'
  }

  protected standText(stand: Gelernt['stand']): string {
    if (stand === 'brauchbar') {
      return 'Die Box rechnet mit ihren eigenen Messwerten statt mit Annahmen.'
    }
    if (stand === 'wenig') {
      return 'Ein Teil ist gemessen, der Rest noch angenommen — das wird mit jedem Tag besser.'
    }
    return (
      'Noch nichts gelernt. Dafür braucht es Lastwechsel (spielen und pausieren) ' +
      'und eine Entladung über mindestens 20 Prozentpunkte.'
    )
  }

  protected artText(a: Abschnitt['art']): string {
    return a === 'laden' ? 'Laden' : a === 'entladen' ? 'Entladen' : 'Ruhe'
  }

  protected volt(mv: number | undefined): string {
    return Number.isFinite(Number(mv)) ? (Number(mv) / 1000).toFixed(2) + ' V' : '–'
  }

  protected strom(ma: number | undefined): string {
    return Number.isFinite(Number(ma)) ? Math.abs(Number(ma)) + ' mA' : '–'
  }

  protected uhr(t: number): string {
    const d = new Date(t)
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  }

  protected dauer(ms: number): string {
    const m = Math.max(0, Math.round(ms / 60_000))
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
  }

  private y(prozent: number): number {
    const h = H - RAND.oben - RAND.unten
    return RAND.oben + (1 - prozent / 100) * h
  }

  private linienPfad(): string {
    const k = this.kurve()
    if (k.length < 2) return ''
    const w = B - RAND.links - RAND.rechts
    const [t0, t1] = [k[0].t, k[k.length - 1].t]
    return k
      .map((p, i) => {
        const x = RAND.links + ((p.t - t0) / Math.max(1, t1 - t0)) * w
        return `${i ? 'L' : 'M'} ${x.toFixed(1)} ${this.y(p.p).toFixed(1)}`
      })
      .join(' ')
  }

  private async laden(): Promise<void> {
    try {
      const [s, v] = await Promise.all([
        firstValueFrom(this.http.get<Stand>('/api/mupihat')),
        firstValueFrom(this.http.get<Verlauf>(`/api/mupihat/verlauf?stunden=${this.stunden()}`)),
      ])
      // Der Leser legt die Datei auch an, wenn er nichts lesen kann - dann
      // steht dort `[]`. Das ist kein Stand, sondern ein Ausfall.
      this.stand.set(Array.isArray(s) ? null : s)
      this.verlauf.set(v)
      // Die Diagnose misst zwoelf Sekunden - deshalb NICHT im selben
      // Promise.all, sonst wartet die ganze Seite darauf.
      void this.protHolen()
      if (!this.diagnose()) {
        firstValueFrom(this.http.get<Diagnose>('/api/mupihat/diagnose'))
          .then((d) => this.diagnose.set(d))
          .catch(() => {})
      }
      this.fehler.set(
        Array.isArray(s)
          ? 'Der HAT-Dienst liefert keine Werte. Prüfen mit: mupi-check akku'
          : '',
      )
    } catch {
      this.fehler.set('Die Box antwortet nicht.')
    }
  }
}
