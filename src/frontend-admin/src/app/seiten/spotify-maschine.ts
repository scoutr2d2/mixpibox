/**
 * Die SPOTIFY ENGINE (E42) — der Schalter zwischen librespot und Soloist.
 *
 * HIESS BIS 21.08.2026 „Tonmaschine". Betreiber: „koennen wir Tonmaschine auf
 * Spotify Engine umtaufen". Der Grund ist gut: der Konfigurationsschluessel
 * heisst ohnehin `spotify.engine`, und das Wort „Tonmaschine" ist auf dieser
 * Box doppelt vergeben — in spotify-control.ts bezeichnet es die Wahl
 * zwischen Spotify und mplayer, also etwas ganz anderes. Zwei Begriffe, ein
 * Wort, war schon vorher eine Verwechslung, die nur niemand ausgesprochen
 * hatte.
 *
 * SITZT AUF DER STREAMING-SEITE in der Spotify-Karte, nicht auf der Ton-Seite:
 * Ton ist die dienstunabhaengige Geschichte (Entzerrer, Senken, Pegel), WELCHER
 * Spotify-Client spielt, ist eine Eigenschaft des Dienstes (Betreiber,
 * 19.08.2026: "ton ist ja eher wieder die nicht dienst abhaengige geschichte").
 *
 * EHRLICHE BESCHRIFTUNG statt Werbung: Soloist ist offiziell und verlustfrei,
 * aber seine Builds verfallen nach 90 Tagen — der woechentliche Waechter
 * erneuert sie, und GENAU DAS steht am Schalter, nicht in einer Hilfeseite.
 * Dieselbe Regel wie beim Mitschnitt (E28): die Wahrheit wohnt am Schalter.
 *
 * KEINE BACKTICKS in Vorlage und Kommentaren ([[backticks-in-angular-vorlagen]]).
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core'
import { firstValueFrom } from 'rxjs'

interface MaschinenStand {
  engine: string
  hatSchluessel: boolean
  geraeteName: string
  /** In welchem WLAN die Box gerade haengt. `null` = Kabel oder nicht lesbar. */
  netz: { ssid: string; band: string | null } | null
  laeuft: { librespot: string; soloist: string }
  soloist: { build: string | null; alterTage: number | null; verfallInTagen: number | null; warnung: string | null; anmeldung: 'ja' | 'nein' | 'unbekannt' | null }
  /** Bitrate von librespot, aus /etc/librespot/env-librespot gelesen. `null` = nicht lesbar. */
  bitrate: number | null
  /** E82: in Worten, wenn ein Engine-Plugin keine Auskunft gab. Optional, damit ein aelterer Server die Karte nicht kippt. */
  hinweis?: string | null
}

@Component({
  selector: 'mupi-spotify-maschine',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .maschine {
      margin-top: 0.9rem;
      padding-top: 0.9rem;
      border-top: 1px solid color-mix(in srgb, currentColor 14%, transparent);
      display: grid;
      gap: 0.55rem;
    }
    .titel { font-weight: 600; }
    /* DIE WEGGABELUNG. Zwei Rahmen nebeneinander, wo Platz ist, sonst
       untereinander — der gewaehlte traegt die Leitfarbe, der andere bleibt
       ruhig. Ohne diesen Unterschied lasen sich die beiden wie zwei Punkte
       einer Aufzaehlung, und dass sie sich AUSSCHLIESSEN, stand nirgends. */
    .wege {
      display: grid; gap: 0.6rem;
      grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
    }
    .weg {
      border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
      border-radius: 10px; padding: 0.65rem 0.75rem;
      display: grid; gap: 0.4rem; cursor: pointer;
    }
    .weg.gewaehlt { border-color: var(--leit, #3b7ddd); }
    .weg-kopf { display: flex; gap: 0.5rem; align-items: baseline; }
    .weg-name { font-weight: 600; display: flex; gap: 0.4rem; align-items: baseline; flex-wrap: wrap; }
    .weg-schild {
      font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em;
      font-weight: 500; padding: 0.1rem 0.45rem; border-radius: 999px;
      border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
      opacity: 0.75;
    }
    .weg-schild.neu { color: var(--leit, #3b7ddd); opacity: 1; }
    .weg-schild.an { color: #2a7; opacity: 1; }
    ul.kann { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.2rem; }
    ul.kann li { font-size: 0.85em; opacity: 0.8; }
    /* WAS ER NICHT KANN ODER WAS ER KOSTET — dieselbe Liste, anderes Zeichen.
       Eine getrennte Liste „Nachteile" liest niemand; hier steht der Preis
       neben dem Gewinn, wo er die Entscheidung trifft. */
    ul.kann li.nicht { list-style-type: '–  '; opacity: 0.62; }
    .klein { font-size: 0.85em; opacity: 0.75; }
    .zeile { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
    input[type='password'] { flex: 1 1 14rem; min-width: 10rem; }
    .hinweis-fehlend {
      margin: 0.5rem 0 0;
      font-size: 0.8rem;
      opacity: 0.7;
    }
    .warnung {
      border-left: 3px solid #c22;
      padding-left: 0.6rem;
      color: #c22;
    }
    .fehler { color: #c22; }
    .fehlt { color: #c22; }
    button.leise { font-size: 0.85em; }
    .getan { color: #2a7; }
    .anmeldung {
      border-left: 3px solid #e90;
      padding: 0.4rem 0 0.4rem 0.6rem;
      display: grid;
      gap: 0.3rem;
    }
    .anmeldung ol { margin: 0; padding-left: 1.2rem; }
  `,
  template: `
    @if (stand(); as m) {
      <div class="maschine">
        <span class="titel">Spotify Engine</span>

        <!-- ZWEI WEGE, ZWEI RAHMEN (21.08.2026). Betreiber: „klarer auch
             optisch unterscheide alter weg und neuer weg". Vorher standen die
             beiden als zwei Zeilen einer Liste untereinander — gleich schwer,
             gleich aussehend, und der Unterschied lebte nur im Fliesstext.
             Zwei Wege, die sich AUSSCHLIESSEN und verschieden viel koennen,
             sind keine zwei Zeilen; das ist eine Weggabelung.
             WAS JEDER KANN steht als Liste da, nicht als Satz — so laesst es
             sich nebeneinanderhalten, und die Luecke faellt auf. -->
        <div class="wege">
          <label class="weg" [class.gewaehlt]="wahl() === 'librespot'">
            <span class="weg-kopf">
              <input
                type="radio"
                name="maschine"
                value="librespot"
                [checked]="wahl() === 'librespot'"
                (change)="wahl.set('librespot')"
              />
              <span class="weg-name">
                librespot
                <span class="weg-schild">bisheriger Weg</span>
                @if (m.laeuft.librespot === 'active') {
                  <span class="weg-schild an">läuft gerade</span>
                }
              </span>
            </span>
            <ul class="kann">
              <li>Ton mit {{ m.bitrate ? m.bitrate + ' kbps' : 'unbekannter Bitrate' }}</li>
              <li>meldet sich selbst an — kein Schlüssel nötig</li>
              <li>verfällt nie, läuft ohne Pflege weiter</li>
              <li class="nicht">ein Gerät — keine getrennten Ströme</li>
            </ul>
          </label>

          <label class="weg" [class.gewaehlt]="wahl() === 'soloist'">
            <span class="weg-kopf">
              <input
                type="radio"
                name="maschine"
                value="soloist"
                [checked]="wahl() === 'soloist'"
                (change)="wahl.set('soloist')"
              />
              <span class="weg-name">
                Soloist
                <span class="weg-schild neu">neuer Weg</span>
                @if (m.laeuft.soloist === 'active') {
                  <span class="weg-schild an">läuft gerade</span>
                }
              </span>
            </span>
            <ul class="kann">
              <li>verlustfrei — daran gibt es nichts zu wählen</li>
              <li>mehrere Ströme möglich, je Kind einer</li>
              <li class="nicht">
                braucht einen eigenen Schlüssel
                @if (!m.hatSchluessel) {
                  <strong class="fehlt">— fehlt noch</strong>
                }
              </li>
              <li class="nicht">
                Builds verfallen nach 90 Tagen; der wöchentliche Wächter erneuert sie
                @if (m.soloist.verfallInTagen !== null) {
                  · noch {{ m.soloist.verfallInTagen }} Tage
                }
              </li>
            </ul>
          </label>
        </div>

        @if (m.soloist.warnung) {
          <p class="warnung">{{ m.soloist.warnung }}</p>
        }
        @if (m.hinweis) {
          <p class="hinweis-fehlend">{{ m.hinweis }}</p>
        }

        <!-- DIE EINMALIGE ANMELDUNG, live angeleitet. Ohne diese Zeilen steht
             nach dem Umschalten eine stumme Box, und nirgends steht warum:
             Soloist meldet sich erst, wenn EINMAL jemand aus der Spotify-App
             die Box waehlt. Die Karte fragt alle drei Sekunden nach und
             schaltet von selbst auf Gruen, sobald die App verbunden hat. -->
        @if (m.engine === 'soloist' && m.soloist.anmeldung === 'nein') {
          <div class="anmeldung">
            <strong>Einmalige Anmeldung fehlt — so geht sie:</strong>
            <ol>
              <!-- DIE BOX SAGT, WO SIE HAENGT, statt zu mahnen. „Gleiches WLAN
                   wie die Box" gibt dem Lesenden nichts, was er nachsehen
                   koennte. Am 22.08.2026 hing sie in ganzschnellimnetz2_2G bei
                   2447 MHz — an dem _2G sieht man, dass dieser Router die
                   Baender in GETRENNTE Netze legt. Ein Handy im 5-GHz-Netz
                   findet die Box dann unter Umstaenden gar nicht, weil Spotify
                   Connect ueber mDNS sucht.

                   NICHT BELEGT und hier bewusst NICHT behauptet: dass am
                   22.08. eine Kopplung DARAN gescheitert waere. Die
                   Kopplungsprobleme dieses Tages sind woanders erklaert — das
                   Koppel-Werkzeug schrieb in den falschen Ordner, und zweimal
                   habe ich das Protokoll falsch gelesen (llmwiki
                   koppelwerkzeug-schrieb-in-den-dienstordner,
                   soloist-pair-endet-nicht-und-meldet-sich-spaet). Das
                   Bandproblem ist eine begruendete Moeglichkeit, kein
                   gemessener Fall. -->
              @if (m.netz; as n) {
                <li>
                  Handy ins <strong>gleiche WLAN</strong> wie die Box:
                  <strong>{{ n.ssid }}</strong>
                  @if (n.band) {
                    <span class="klein">
                      · {{ n.band }} — trennt dein Router die Bänder in zwei Netze, muss es dieses sein
                    </span>
                  }
                </li>
              } @else {
                <li>Spotify-App auf dem Handy öffnen (gleiches WLAN wie die Box)</li>
              }
              <li>Etwas abspielen, dann das Geräte-Symbol antippen</li>
              <li>„{{ m.geraeteName }}" wählen und kurz Play drücken</li>
            </ol>
            <span class="klein">Die Box merkt sich die Anmeldung dauerhaft — diese Karte wartet mit…</span>
          </div>
        }
        @if (m.engine === 'soloist' && m.soloist.anmeldung === 'ja') {
          <p class="getan">Angemeldet — Soloist ist einsatzbereit.</p>
        }

        <!-- DER SCHLUESSEL HAT IMMER EINE ZEILE — auch wenn er hinterlegt ist.
             Vorher erschien das Feld nur, wenn er FEHLTE: wer ihn ersetzen
             wollte oder wissen, ob einer da ist, fand NICHTS (Betreiber,
             19.08.2026: "wo finde ich das"). Ein unsichtbarer Zugang ist kein
             verwalteter Zugang. -->
        <div class="zeile">
          <span class="klein">
            Soloist-Schlüssel:
            @if (m.hatSchluessel) {
              <strong>hinterlegt</strong> (wird nie angezeigt)
            } @else {
              <strong class="fehlt">fehlt</strong>
            }
          </span>
          @if (m.hatSchluessel && !ersetzen()) {
            <button type="button" class="leise" (click)="ersetzen.set(true)">Ersetzen…</button>
          }
        </div>

        @if (!m.hatSchluessel || ersetzen()) {
          <div class="zeile">
            <input
              type="password"
              placeholder="spak_…"
              [value]="schluessel()"
              (input)="schluessel.set(eingabe($event))"
              autocomplete="off"
            />
            @if (schluessel().trim() && wahl() === m.engine) {
              <button type="button" [disabled]="beschaeftigt()" (click)="umschalten()">Schlüssel speichern</button>
            }
          </div>
          <p class="klein">
            Das ist ein EIGENER Schlüssel (beginnt mit spak_), <strong>nicht</strong> die Client-ID des
            Assistenten oben: developer.spotify.com/dashboard → Seite „Spotify Soloist API Key" → mit dem
            Spotify-Konto der Box erzeugen. Er ist kontogebunden, wird nur auf der Box gespeichert und nie
            wieder angezeigt.
          </p>
        }

        <p class="klein">
          Zur Einordnung: der Assistent oben verwaltet die Web-API-App (Client-ID/-Secret, für Suche und
          Steuerung) und die Ton-Anmeldung des Kontos — beides gilt für BEIDE Maschinen. Der
          Soloist-Schlüssel kommt nur dazu, wenn Soloist spielen soll.
        </p>

        <div class="zeile">
          <button type="button" [disabled]="beschaeftigt() || wahl() === m.engine" (click)="umschalten()">
            {{ beschaeftigt() ? 'Schaltet um…' : 'Umschalten' }}
          </button>
          @if (wahl() !== m.engine) {
            <span class="klein">Der Ton bricht dabei kurz ab; die Box meldet sich unter demselben Namen wieder.</span>
          }
        </div>

        @if (fehler()) {
          <p class="fehler">{{ fehler() }}</p>
        }
        @if (getan()) {
          <p class="getan">{{ getan() }}</p>
        }
      </div>
    }
  `,
})
export class SpotifyMaschine implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient)

  readonly stand = signal<MaschinenStand | null>(null)
  readonly wahl = signal<string>('librespot')
  readonly schluessel = signal('')
  readonly beschaeftigt = signal(false)
  readonly fehler = signal('')
  readonly getan = signal('')
  /** Zeigt das Ersetzen-Feld, obwohl ein Schluessel hinterlegt ist. */
  readonly ersetzen = signal(false)

  /** Fragt nach, solange die Anmeldung fehlt. Sonst still. */
  private wache: ReturnType<typeof setInterval> | null = null

  async ngOnInit(): Promise<void> {
    await this.laden()
  }

  ngOnDestroy(): void {
    if (this.wache) clearInterval(this.wache)
  }

  /** Alle 3 s nachsehen, bis die App verbunden hat — dann von selbst Ruhe. */
  private wacheStellen(): void {
    if (this.wache) return
    // MIT WIEDEREINTRITTS-RIEGEL (E82): braucht ein `laden()` laenger als den
    // Takt (Plugin-Neustart nach dem Umschalten!), stapelten sich sonst die
    // Abfragen — und jede traf den Server in der heikelsten Minute erneut.
    let unterwegs = false
    this.wache = setInterval(async () => {
      if (unterwegs) return
      unterwegs = true
      try {
        await this.laden()
      } finally {
        unterwegs = false
      }
      const m = this.stand()
      if (!m || m.engine !== 'soloist' || m.soloist.anmeldung !== 'nein') {
        if (this.wache) clearInterval(this.wache)
        this.wache = null
      }
    }, 3000)
  }

  eingabe(e: Event): string {
    return (e.target as HTMLInputElement).value
  }

  async laden(): Promise<void> {
    try {
      const m = await firstValueFrom(this.http.get<MaschinenStand>('/api/spotify/maschine'))
      this.stand.set(m)
      this.wahl.set(m.engine)
      if (m.engine === 'soloist' && m.soloist.anmeldung === 'nein') this.wacheStellen()
    } catch {
      // Kein Stand ist kein Absturz der Karte: der Baustein zeigt dann nichts,
      // und die uebrige Spotify-Karte bleibt bedienbar.
      this.stand.set(null)
    }
  }

  async umschalten(): Promise<void> {
    if (this.beschaeftigt()) return
    this.beschaeftigt.set(true)
    this.fehler.set('')
    this.getan.set('')
    try {
      const rumpf: Record<string, unknown> = { engine: this.wahl() }
      if (this.schluessel().trim()) rumpf['schluessel'] = this.schluessel().trim()
      await firstValueFrom(this.http.put('/api/spotify/maschine', rumpf))
      this.schluessel.set('')
      this.ersetzen.set(false)
      this.getan.set(
        this.wahl() !== this.stand()?.engine
          ? this.wahl() === 'soloist'
            ? 'Umgeschaltet auf Soloist.'
            : 'Zurück auf librespot.'
          : 'Schlüssel gespeichert.',
      )
      // Der Neustart der Units ist im PUT schon abgewartet — der frische
      // Stand traegt also bereits die Wahrheit.
      await this.laden()
    } catch (f: unknown) {
      const grund = (f as { error?: { grund?: string } })?.error?.grund
      this.fehler.set(grund || 'Umschalten fehlgeschlagen — die bisherige Maschine läuft weiter.')
    } finally {
      this.beschaeftigt.set(false)
    }
  }
}
